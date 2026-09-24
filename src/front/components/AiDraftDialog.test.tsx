import { describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiDraftForm, type AiWriter } from "./AiDraftDialog";
import { assessmentFixture } from "./assessments/assessmentFixtures";
import { ApiError } from "../lib/fetcher";
import { hashAiInput } from "../../shared/contracts/aiAdvice";

function props() {
  const { record } = assessmentFixture();
  return {
    record,
    criterionId: "C-1",
    officialRequirement: "役割を決めること。",
    readOnly: false,
    write: {
      pending: false,
      error: null as Error | null,
      clearError: vi.fn(),
      send: vi.fn(async (..._args: Parameters<AiWriter["send"]>) => null),
    },
    read: vi.fn().mockResolvedValue(null),
    onAdopted: vi.fn(),
    onClose: vi.fn(),
    onRefresh: vi.fn(),
  };
}
describe("AI full-input review", () => {
  it("starts empty, shows exactly the outgoing public fields and invalidates review on text or basis changes", async () => {
    const p = props(),
      view = render(<AiDraftForm {...p} />);
    const answer = screen.getByLabelText("匿名化した状況"),
      gap = screen.getByLabelText("匿名化した不足点");
    expect(answer).toHaveValue("");
    expect(gap).toHaveValue("");
    fireEvent.change(answer, { target: { value: " 担当を検討中 " } });
    fireEvent.change(gap, { target: { value: "分担表がない" } });
    const payload = {
      standardId: p.record.standardId,
      criterionId: "C-1",
      officialRequirement: p.officialRequirement,
      anonymousAnswer: "担当を検討中",
      anonymousGap: "分担表がない",
    };
    expect(screen.getByLabelText("送信全文").textContent).toBe(JSON.stringify(payload, null, 2));
    const confirm = screen.getByLabelText("送信全文を確認し、匿名化しました");
    const generate = screen.getByRole("button", { name: "確認した内容で生成" });
    expect(generate).toBeDisabled();
    fireEvent.click(confirm);
    expect(generate).toBeEnabled();
    fireEvent.change(gap, { target: { value: "承認がない" } });
    expect(confirm).not.toBeChecked();
    expect(generate).toBeDisabled();
    fireEvent.click(confirm);
    const changed = structuredClone(p.record);
    changed.document.responses["C-1"].basisHash = "b".repeat(64);
    view.rerender(<AiDraftForm {...p} record={changed} />);
    expect(confirm).not.toBeChecked();
    expect(generate).toBeDisabled();
    fireEvent.click(confirm);
    fireEvent.click(generate);
    await waitFor(() => expect(p.write.send).toHaveBeenCalledTimes(1));
    expect(p.write.send.mock.calls[0]).toEqual([
      "/api/v1/assessments/assessment/advice/C-1/ai-runs",
      "POST",
      {
        expectedRevision: 1,
        basisHash: "b".repeat(64),
        anonymousAnswer: "担当を検討中",
        anonymousGap: "承認がない",
        anonymizationReviewed: true,
        reviewedInputHash: await hashAiInput({ ...payload, anonymousGap: "承認がない" }),
      },
      { readOnly: true, operationKey: expect.any(String) },
    ]);
  });
  it("preserves inputs on failure, reuses the same request for unknown outcomes, and starts a new key only explicitly", async () => {
    const p = props(),
      view = render(<AiDraftForm {...p} />);
    fireEvent.change(screen.getByLabelText("匿名化した状況"), { target: { value: "状況" } });
    fireEvent.change(screen.getByLabelText("匿名化した不足点"), { target: { value: "不足" } });
    fireEvent.click(screen.getByLabelText("送信全文を確認し、匿名化しました"));
    fireEvent.click(screen.getByRole("button", { name: "確認した内容で生成" }));
    await waitFor(() => expect(p.write.send).toHaveBeenCalledTimes(1));
    view.rerender(<AiDraftForm {...p} write={{ ...p.write, error: new Error("通信断") }} />);
    expect(screen.getByLabelText("匿名化した状況")).toHaveValue("状況");
    fireEvent.click(screen.getByRole("button", { name: "同じ送信の状態を確認" }));
    await waitFor(() => expect(p.write.send).toHaveBeenCalledTimes(2));
    expect(p.write.send.mock.calls[1]).toEqual(p.write.send.mock.calls[0]);
    view.rerender(
      <AiDraftForm
        {...p}
        write={{
          ...p.write,
          error: new ApiError(504, {
            error: { code: "AI_TIMEOUT", message: "時間切れ", runId: "run" },
            requestId: "request",
          }),
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "新しい試行を準備" }));
    expect(screen.getByLabelText("送信全文を確認し、匿名化しました")).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("送信全文を確認し、匿名化しました"));
    fireEvent.click(screen.getByRole("button", { name: "確認した内容で生成" }));
    await waitFor(() => expect(p.write.send).toHaveBeenCalledTimes(3));
    expect(p.write.send.mock.calls[2][3]?.operationKey).not.toBe(
      p.write.send.mock.calls[0][3]?.operationKey,
    );
  });
});
