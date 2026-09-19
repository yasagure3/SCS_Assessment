import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ResponseForm, type ResponseWriter } from "./ResponseForm";
import { assessmentFixture } from "./assessmentFixtures";
import { ApiError } from "../../lib/fetcher";
describe("criterion editing", () => {
  it("prevents a save when otherwise valid text would exceed the assessment byte limit", () => {
    const { record } = assessmentFixture();
    for (const response of Object.values(record.document.responses))
      response.basis = "あ".repeat(4300);
    const send = vi.fn<ResponseWriter["send"]>().mockResolvedValue(null);
    render(
      <ResponseForm
        record={record}
        criterionId="C-1"
        readOnly={false}
        write={{ send, pending: false, error: null, clearError: vi.fn() }}
        onSaved={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(
      screen.getByText("診断全体が1MiBを超えています。記述を短くしてから保存してください。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "判定を保存" })).toBeDisabled();
  });
  it("keeps unsaved text on conflict, displays exact differences and changes revision only after an explicit choice", async () => {
    const { record } = assessmentFixture();
    const send = vi.fn<ResponseWriter["send"]>().mockResolvedValue(null),
      clearError = vi.fn(),
      refresh = vi.fn();
    const write = { send, clearError, pending: false, error: null as Error | null };
    const view = render(
      <ResponseForm
        record={record}
        criterionId="C-1"
        readOnly={false}
        write={write}
        onSaved={vi.fn()}
        onRefresh={refresh}
      />,
    );
    fireEvent.change(screen.getByLabelText("判定理由・確認メモ"), {
      target: { value: "自分の未保存文" },
    });
    fireEvent.click(screen.getByRole("button", { name: "判定を保存" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const latest = structuredClone(record);
    latest.revision = 2;
    latest.document.responses["C-1"].reason = "最新の保存文";
    view.rerender(
      <ResponseForm
        record={latest}
        criterionId="C-1"
        readOnly={false}
        write={{
          ...write,
          error: new ApiError(409, {
            error: { code: "CONFLICT", message: "別の担当者が更新しました。" },
            requestId: "test",
          }),
        }}
        onSaved={vi.fn()}
        onRefresh={refresh}
      />,
    );
    expect(screen.getByLabelText("判定理由・確認メモ")).toHaveValue("自分の未保存文");
    const row = screen.getByRole("row", {
      name: "判定理由・確認メモ 自分の未保存文 最新の保存文 変更あり",
    });
    expect(
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["自分の未保存文", "最新の保存文", "変更あり"]);
    expect(screen.getByRole("button", { name: "判定を保存" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "入力を保って再編集する" }));
    expect(clearError).toHaveBeenCalledTimes(1);
    view.rerender(
      <ResponseForm
        record={latest}
        criterionId="C-1"
        readOnly={false}
        write={write}
        onSaved={vi.fn()}
        onRefresh={refresh}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "判定を保存" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]).toEqual([
      "/api/v1/assessments/assessment/responses/C-1",
      "PATCH",
      {
        expectedRevision: 2,
        status: "no",
        reason: "自分の未保存文",
        basis: "",
        plannedWork: "",
        supplement: "",
      },
    ]);
  });
  it("retains input after network failure, exposes validation and only shows success after API success", async () => {
    const { record } = assessmentFixture();
    const send = vi.fn<ResponseWriter["send"]>().mockResolvedValue(null),
      onSaved = vi.fn();
    const write = { send, clearError: vi.fn(), pending: false, error: null as Error | null };
    const view = render(
      <ResponseForm
        record={record}
        criterionId="C-1"
        readOnly={false}
        write={write}
        onSaved={onSaved}
        onRefresh={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("判定理由・確認メモ"), {
      target: { value: "保存したい文" },
    });
    view.rerender(
      <ResponseForm
        record={record}
        criterionId="C-1"
        readOnly={false}
        write={{ ...write, error: new Error("通信が切れました") }}
        onSaved={onSaved}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/^通信が切れました$/);
    expect(screen.getByLabelText("判定理由・確認メモ")).toHaveValue("保存したい文");
    fireEvent.change(screen.getByLabelText("補足情報"), { target: { value: "あ".repeat(8001) } });
    expect(screen.getByText("補足情報は8000文字以内で入力してください。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "判定を保存" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("補足情報"), { target: { value: "" } });
    send.mockResolvedValue({ data: { ...record, revision: 2 }, requestId: "success" });
    view.rerender(
      <ResponseForm
        record={record}
        criterionId="C-1"
        readOnly={false}
        write={write}
        onSaved={onSaved}
        onRefresh={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "判定を保存" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/^保存しました。$/);
    expect(onSaved).toHaveBeenCalledWith({
      data: { ...record, revision: 2 },
      requestId: "success",
    });
  });
});
