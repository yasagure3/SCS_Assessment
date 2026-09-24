import { describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReportPdfExport } from "./ReportPdfExport";
import { reportSnapshotFixture } from "../../../../tests/fixtures/reportSnapshot";
import type { PdfResult } from "../../workers/reportClient";

describe("PDF export controls", () => {
  it("preserves the report after failure, shows progress, and offers only the completed PDF for saving", async () => {
    const snapshot = reportSnapshotFixture(),
      save = vi.fn();
    let resolve!: (value: PdfResult) => void;
    let progress!: (value: number) => void;
    let attempts = 0;
    const start = vi.fn((input: typeof snapshot, notify: (n: number) => void) => {
      expect(input).toEqual(snapshot);
      progress = notify;
      attempts++;
      return {
        cancel: () => {},
        promise:
          attempts === 1
            ? Promise.reject(new Error("PDF_FONT_FAILED"))
            : new Promise<PdfResult>((yes) => {
                resolve = yes;
              }),
      };
    });
    render(<ReportPdfExport snapshot={snapshot} start={start} save={save} />);
    fireEvent.click(screen.getByRole("button", { name: "PDFを生成" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "フォントを読み込めませんでした。同じ報告版で再試行してください。",
    );
    expect(save.mock.calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "PDFを生成" }));
    expect(screen.getByRole("button", { name: "生成しています…" })).toBeDisabled();
    progress(40);
    const result = {
      bytes: new ArrayBuffer(3),
      pages: 85,
      elapsedMs: 2500,
      reportId: snapshot.reportId,
    };
    resolve(result);
    await waitFor(() => expect(screen.getByRole("button", { name: "PDFを保存" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "PDFを保存" }));
    expect(save.mock.calls).toEqual([[result.bytes, `SCS-${snapshot.reportId}.pdf`]]);
    expect(start).toHaveBeenCalledTimes(2);
  });
  it("terminates a running worker when the selected report is unmounted", async () => {
    let reject!: (error: Error) => void;
    const cancel = vi.fn(() => reject(new Error("PDF_CANCELLED")));
    const mounted = render(
      <ReportPdfExport
        snapshot={reportSnapshotFixture()}
        start={() => ({
          cancel,
          promise: new Promise<PdfResult>((_, no) => {
            reject = no;
          }),
        })}
        save={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "PDFを生成" }));
    mounted.unmount();
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
  });
});
