import { describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdviceEditor, type AdviceWriter } from "./AdviceEditor";
import { assessmentFixture } from "./assessments/assessmentFixtures";
import type { AdviceTemplate } from "../../shared/contracts/advice";
import { ApiError } from "../lib/fetcher";

const template: AdviceTemplate = {
  id: "template-1",
  standardId: "standard",
  criterionId: "C-1",
  version: 1,
  contentSha256: "c".repeat(64),
  sourceUrls: ["https://example.invalid/official"],
  officialRequirement: "役割・責任を定めること。",
  kind: "companyProposal",
  content: {
    origin: "template",
    templateId: "template-1",
    gap: "役割分担が未確認の場合",
    steps: ["役員と担当部署の責任を割り当てる", "規程を承認する"],
    evidenceExamples: ["役割分担表"],
    completionCheck: "双方の責任を規程と照合する",
    notes: "",
  },
};
function props() {
  const { record } = assessmentFixture();
  return {
    record,
    criterionId: "C-1",
    readOnly: false,
    template,
    write: {
      pending: false,
      error: null as Error | null,
      clearError: vi.fn(),
      send: vi.fn<AdviceWriter["send"]>().mockResolvedValue(null),
    },
    onSaved: vi.fn(),
    onRefresh: vi.fn(),
  };
}
describe("AdviceEditor", () => {
  it("copies a labelled company proposal, edits and saves its draft, then requires an explicit review to confirm", async () => {
    const p = props();
    render(<AdviceEditor {...p} />);
    expect(screen.getByRole("heading", { name: "当社の実施例・助言案" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "助言を確定" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "定型助言を下書きへコピー" }));
    for (const [name, value] of [
      ["不足点", template.content.gap],
      ["実施手順（1行1件）", template.content.steps.join("\n")],
      ["証跡例（1行1件）", template.content.evidenceExamples.join("\n")],
      ["完了確認", template.content.completionCheck],
      ["補足", template.content.notes],
    ]) {
      expect(screen.getByRole("textbox", { name })).toHaveValue(value);
    }
    expect(screen.getByLabelText("実施手順（1行1件）")).toHaveValue(
      template.content.steps.join("\n"),
    );
    fireEvent.change(screen.getByLabelText("不足点"), {
      target: { value: "顧客の実態に合わせた不足点" },
    });
    fireEvent.click(screen.getByRole("button", { name: "下書きを保存" }));
    await waitFor(() => expect(p.write.send).toHaveBeenCalledTimes(1));
    expect(p.write.send.mock.calls[0]).toEqual([
      "/api/v1/assessments/assessment/advice/C-1/draft",
      "PUT",
      { expectedRevision: 1, content: { ...template.content, gap: "顧客の実態に合わせた不足点" } },
    ]);
    fireEvent.click(screen.getByLabelText("現在の回答・範囲・証跡と助言内容を確認しました"));
    fireEvent.click(screen.getByRole("button", { name: "助言を確定" }));
    await waitFor(() => expect(p.write.send).toHaveBeenCalledTimes(2));
    expect(p.write.send.mock.calls[1]).toEqual([
      "/api/v1/assessments/assessment/advice/C-1/confirm",
      "POST",
      {
        expectedRevision: 1,
        content: { ...template.content, gap: "顧客の実態に合わせた不足点" },
        reviewed: true,
      },
    ]);
  });
  it("allows partial manual drafts while rejecting blank confirmation fields and excessive content", () => {
    const p = props();
    render(<AdviceEditor {...p} />);
    fireEvent.change(screen.getByLabelText("不足点"), { target: { value: "途中まで" } });
    expect(screen.getByRole("button", { name: "下書きを保存" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "助言を確定" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("不足点"), { target: { value: "😀".repeat(12001) } });
    expect(
      screen.getByText("助言は合計12000文字以内、手順・証跡例は各30件以内で入力してください。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下書きを保存" })).toBeDisabled();
  });
  it("preserves failed input, compares latest draft and requires review again after adopting the latest revision", async () => {
    const p = props(),
      view = render(<AdviceEditor {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "定型助言を下書きへコピー" }));
    fireEvent.change(screen.getByLabelText("不足点"), { target: { value: "自分の未保存案" } });
    fireEvent.click(screen.getByLabelText("現在の回答・範囲・証跡と助言内容を確認しました"));
    fireEvent.click(screen.getByRole("button", { name: "助言を確定" }));
    await waitFor(() => expect(p.onRefresh).toHaveBeenCalledTimes(1));
    const latest = structuredClone(p.record);
    latest.revision = 2;
    latest.document.responses["C-1"].adviceDraft = { ...template.content, gap: "別担当者の案" };
    view.rerender(
      <AdviceEditor
        {...p}
        record={latest}
        write={{
          ...p.write,
          error: new ApiError(409, {
            error: { code: "CONFLICT", message: "別担当者が保存しました。" },
            requestId: "test",
          }),
        }}
      />,
    );
    expect(
      screen.getByRole("row", { name: "不足点 自分の未保存案 別担当者の案 変更あり" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("不足点")).toHaveValue("自分の未保存案");
    expect(screen.getByRole("button", { name: "下書きを保存" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "助言の入力を保って再編集する" }));
    view.rerender(<AdviceEditor {...p} record={latest} />);
    expect(screen.getByRole("button", { name: "助言を確定" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "下書きを保存" }));
    await waitFor(() => expect(p.write.send).toHaveBeenCalledTimes(2));
    expect(p.write.send.mock.calls[1]).toEqual([
      "/api/v1/assessments/assessment/advice/C-1/draft",
      "PUT",
      { expectedRevision: 2, content: { ...template.content, gap: "自分の未保存案" } },
    ]);
  });
  it("keeps content on a network error and applies pending/read-only and document-size guards", async () => {
    const p = props(),
      view = render(<AdviceEditor {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "定型助言を下書きへコピー" }));
    fireEvent.click(screen.getByRole("button", { name: "下書きを保存" }));
    await waitFor(() => expect(p.onRefresh).toHaveBeenCalledTimes(1));
    view.rerender(
      <AdviceEditor {...p} write={{ ...p.write, error: new Error("通信が切断されました。") }} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("通信が切断されました。");
    expect(screen.getByLabelText("不足点")).toHaveValue(template.content.gap);
    expect(screen.getByRole("button", { name: "下書きを保存" })).toBeEnabled();
    view.rerender(<AdviceEditor {...p} write={{ ...p.write, pending: true }} />);
    expect(screen.getByRole("button", { name: "下書きを保存" })).toBeDisabled();
    view.rerender(<AdviceEditor {...p} readOnly />);
    expect(screen.getByLabelText("不足点")).toBeDisabled();
    const large = structuredClone(p.record);
    Object.values(large.document.responses).forEach((r) => {
      r.reason = "あ".repeat(4400);
    });
    view.rerender(<AdviceEditor {...p} record={large} />);
    expect(
      screen.getByText("診断全体が1MiBを超えています。記述を短くしてから保存してください。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下書きを保存" })).toBeDisabled();
  });
});
