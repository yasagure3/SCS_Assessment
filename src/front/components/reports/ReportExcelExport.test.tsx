import { describe, expect, it, vi } from "vite-plus/test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReportExcelExport } from "./ReportExcelExport";
import { reportSnapshotFixture } from "../../../../tests/fixtures/reportSnapshot";
import type { ExcelResult } from "../../workers/reportClient";

describe("working Excel export controls", () => {
  it("keeps the selected report after failure and saves only a complete retry with progress", async () => {
    const snapshot = reportSnapshotFixture(),
      save = vi.fn();
    let resolve!: (value: ExcelResult) => void, progress!: (value: number) => void;
    const inputs: (typeof snapshot)[] = [];
    const start = (input: typeof snapshot, notify: (n: number) => void) => {
      inputs.push(input);
      progress = notify;
      return {
        cancel: () => {},
        promise:
          inputs.length === 1
            ? Promise.reject(new Error("EXCEL_FAILED"))
            : new Promise<ExcelResult>((yes) => {
                resolve = yes;
              }),
      };
    };
    render(<ReportExcelExport snapshot={snapshot} start={start} save={save} />);
    expect(
      screen.getByText("作業用Excelは再取込対象外です。PDFと同じ報告版から5シートを生成します。")
        .textContent,
    ).toBe("作業用Excelは再取込対象外です。PDFと同じ報告版から5シートを生成します。");
    fireEvent.click(screen.getByRole("button", { name: "Excelを生成" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Excelを生成できませんでした。同じ報告版で再試行してください。",
    );
    expect(save.mock.calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Excelを生成" }));
    expect(screen.getByRole("button", { name: "Excelを生成しています…" })).toBeDisabled();
    act(() => progress(40));
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "40");
    const result = { bytes: new ArrayBuffer(3), elapsedMs: 2500, reportId: snapshot.reportId };
    await act(async () => resolve(result));
    fireEvent.click(await screen.findByRole("button", { name: "Excelを保存" }));
    expect({ inputs, saves: save.mock.calls }).toEqual({
      inputs: [snapshot, snapshot],
      saves: [[result.bytes, `SCS-${snapshot.reportId}.xlsx`]],
    });
  });
  it.each(["EXCEL_CANCELLED", "EXCEL_TIMEOUT", "REPORT_SNAPSHOT_INVALID"])(
    "shows a recoverable %s failure without offering partial bytes",
    async (code) => {
      const messages = {
        EXCEL_CANCELLED: "生成を取り消しました。同じ報告版で再試行できます。",
        EXCEL_TIMEOUT: "120秒以内に生成できませんでした。同じ報告版で再試行してください。",
        REPORT_SNAPSHOT_INVALID:
          "報告内容の形式またはサイズを確認できません。報告版を読み直してください。",
      };
      render(
        <ReportExcelExport
          snapshot={reportSnapshotFixture()}
          start={() => ({ promise: Promise.reject(new Error(code)), cancel: () => {} })}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Excelを生成" }));
      expect((await screen.findByRole("alert")).textContent).toBe(
        messages[code as keyof typeof messages],
      );
      expect(screen.queryByRole("button", { name: "Excelを保存" })).toBe(null);
    },
  );
  it("terminates a generation when leaving the selected report", async () => {
    let reject!: (error: Error) => void;
    const cancel = vi.fn(() => reject(new Error("EXCEL_CANCELLED")));
    const mounted = render(
      <ReportExcelExport
        snapshot={reportSnapshotFixture()}
        start={() => ({
          cancel,
          promise: new Promise<ExcelResult>((_, no) => {
            reject = no;
          }),
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Excelを生成" }));
    mounted.unmount();
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
  });
});
