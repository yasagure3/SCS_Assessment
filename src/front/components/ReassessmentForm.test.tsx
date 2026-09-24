import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReassessmentForm } from "./ReassessmentForm";
import { assessmentFixture } from "./assessments/assessmentFixtures";
import {
  STANDARD_ID,
  MAX_DOCUMENT_BYTES,
  assessmentDocumentSchema,
} from "../../shared/contracts/assessment";
import { reassessmentCopy } from "../../shared/reassessmentCopy";
import { ApiError } from "../lib/fetcher";
import type { useWrite } from "../lib/api";

const fixture = () => {
  const { record } = assessmentFixture();
  record.id = "11111111-1111-4111-8111-111111111111";
  record.standardId = STANDARD_ID;
  return record;
};
function writer(overrides: Partial<ReturnType<typeof useWrite>> = {}): ReturnType<typeof useWrite> {
  return {
    pending: false,
    error: null,
    send: vi.fn(async () => null),
    clearError: vi.fn(),
    ...overrides,
  };
}
describe("reassessment form", () => {
  it.each([MAX_DOCUMENT_BYTES, MAX_DOCUMENT_BYTES + 1])(
    "enforces the copied aggregate boundary at %s bytes",
    (target) => {
      const record = fixture();
      for (const response of Object.values(record.document.responses)) {
        response.reason = "";
        response.basis = "";
      }
      const scope = { ...record.document.scope, sites: "x".repeat(2000) };
      const input = {
        previousAssessmentId: record.id,
        expectedPreviousRevision: 1,
        standardId: STANDARD_ID,
        diagnosisDate: null,
        scope,
        copyResponses: true,
        copyTaskIds: [],
      } as const;
      const projected = () =>
        reassessmentCopy(
          record,
          { ...input, copyTaskIds: [] },
          () => "00000000-0000-4000-8000-000000000000",
        );
      const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
      let remaining = target - size(projected());
      for (const response of Object.values(record.document.responses))
        for (const field of ["reason", "basis"] as const) {
          const count = Math.min(8000, remaining);
          response[field] = "x".repeat(count);
          remaining -= count;
        }
      expect({
        remaining,
        sourceValid: assessmentDocumentSchema.safeParse(record.document).success,
        copiedBytes: size(projected()),
      }).toEqual({ remaining: 0, sourceValid: true, copiedBytes: target });
      render(
        <ReassessmentForm
          record={record}
          readOnly={false}
          write={writer()}
          onRefresh={vi.fn()}
          onCreated={vi.fn()}
        />,
      );
      fireEvent.change(screen.getByLabelText("対象拠点"), { target: { value: scope.sites } });
      expect(screen.getByRole("button", { name: "再診断を作成" }).hasAttribute("disabled")).toBe(
        target > MAX_DOCUMENT_BYTES,
      );
    },
  );
  it("submits a validated copy with source revision and preserves inputs on failure", async () => {
    const record = fixture(),
      write = writer(),
      refresh = vi.fn();
    const { rerender } = render(
      <ReassessmentForm
        record={record}
        readOnly={false}
        write={write}
        onRefresh={refresh}
        onCreated={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("再診断日"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("対象拠点"), { target: { value: "新拠点" } });
    fireEvent.click(screen.getByRole("button", { name: "再診断を作成" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(write.send).toHaveBeenCalledWith("/api/v1/cases/case/reassessments", "POST", {
      previousAssessmentId: record.id,
      expectedPreviousRevision: 1,
      standardId: STANDARD_ID,
      diagnosisDate: "2026-10-01",
      scope: { companies: "", sites: "新拠点", departments: "", systems: "" },
      copyResponses: true,
      copyTaskIds: [],
    });
    rerender(
      <ReassessmentForm
        record={record}
        readOnly={false}
        write={{ ...write, error: new Error("通信が切断されました。") }}
        onRefresh={refresh}
        onCreated={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("通信が切断されました。");
    expect(screen.getByLabelText("対象拠点")).toHaveValue("新拠点");
  });
  it("retains the selected source until the user accepts the conflict and shows the old and latest content", async () => {
    const record = fixture(),
      latest = structuredClone(record);
    latest.revision = 2;
    latest.document.responses["C-1"].reason = "更新された前回回答";
    const write = writer(),
      refresh = vi.fn(),
      created = vi.fn();
    const { rerender } = render(
      <ReassessmentForm
        record={record}
        readOnly={false}
        write={write}
        onRefresh={refresh}
        onCreated={created}
      />,
    );
    fireEvent.change(screen.getByLabelText("対象拠点"), { target: { value: "入力保持" } });
    const error = new ApiError(409, {
      error: { code: "CONFLICT", message: "前回が更新されました。" },
      requestId: "fixture",
    });
    rerender(
      <ReassessmentForm
        record={latest}
        readOnly={false}
        write={{ ...write, error }}
        onRefresh={refresh}
        onCreated={created}
      />,
    );
    expect(screen.getByRole("button", { name: "再診断を作成" })).toBeDisabled();
    expect(screen.getByText("更新された前回回答")).toBeInTheDocument();
    expect(screen.getByText("固有の編集文")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "入力を保って最新の前回を選び直す" }));
    rerender(
      <ReassessmentForm
        record={latest}
        readOnly={false}
        write={write}
        onRefresh={refresh}
        onCreated={created}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "再診断を作成" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(vi.mocked(write.send).mock.calls[0][2]).toEqual({
      previousAssessmentId: record.id,
      expectedPreviousRevision: 2,
      standardId: STANDARD_ID,
      diagnosisDate: null,
      scope: { companies: "", sites: "入力保持", departments: "", systems: "" },
      copyResponses: true,
      copyTaskIds: [],
    });
  });
  it.each([
    { pending: true, readOnly: false },
    { pending: false, readOnly: true },
  ])("blocks creation and editing during %j", ({ pending, readOnly }) => {
    render(
      <ReassessmentForm
        record={fixture()}
        readOnly={readOnly}
        write={writer({ pending })}
        onRefresh={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("対象拠点")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: pending ? "作成しています…" : "再診断を作成" }),
    ).toBeDisabled();
  });
  it("validates scope length before submitting", () => {
    render(
      <ReassessmentForm
        record={fixture()}
        readOnly={false}
        write={writer()}
        onRefresh={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("対象拠点"), { target: { value: "あ".repeat(2001) } });
    expect(screen.getByRole("button", { name: "再診断を作成" })).toBeDisabled();
    expect(
      screen.getByText("対象範囲は各2000文字以内、日付は実在する日付を入力してください。"),
    ).toBeInTheDocument();
  });
});
