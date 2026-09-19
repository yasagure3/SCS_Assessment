import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ImportForm } from "./ImportPage";
import type { ExcelResult } from "../workers/importClient";
import type { ImportPreview } from "../../shared/contracts/imports";
const result: ExcelResult = {
  normalized: {
    standardId: "scs-20260327-star3",
    fileName: "anonymous.xlsx",
    clientFileSha256: "a".repeat(64),
    masterContentSha256: "b".repeat(64),
    star4Excluded: 72,
    rows: [
      { criterionId: "1-2-1-1", sheet: "匿名", row: 6, O: "○", P: "理由", Q: "根拠", R: "補足" },
    ],
  },
  errors: [],
  metrics: { elapsedMs: 24, fileBytes: 1000, expandedBytes: 2000, entries: 10 },
};
const preview: ImportPreview = {
  revision: 1,
  normalizedSha256: "c".repeat(64),
  counts: { yes: 1, uncertain: 0, no: 0, unanswered: 80, total: 81 },
  missingIds: ["1-2-1-2"],
  warnings: [],
  errors: [],
  canCommit: false,
};
describe("import confirmation", () => {
  it("requires explicit acknowledgement and passes only exact missing IDs to commit", async () => {
    let committed: unknown = null;
    render(
      <ImportForm
        revision={1}
        master={{ standardId: "scs-20260327-star3", masterContentSha256: "b".repeat(64), rows: [] }}
        importer={() => ({ promise: Promise.resolve(result), cancel: () => {} })}
        preview={async () => preview}
        commit={async (input) => {
          committed = input;
          return false;
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Excelファイルを選択"), {
      target: { files: [new File(["x"], "anonymous.xlsx")] },
    });
    await screen.findByRole("heading", { name: "取込内容を確認" });
    expect(screen.getByRole("button", { name: "81回答を取り込む" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("欠落した基準を未回答として取り込むことを確認しました"));
    fireEvent.click(screen.getByRole("button", { name: "81回答を取り込む" }));
    await waitFor(() =>
      expect(committed).toEqual({
        expectedRevision: 1,
        mutationId: expect.any(String),
        normalized: result.normalized,
        normalizedSha256: preview.normalizedSha256,
        acknowledgedMissingIds: preview.missingIds,
      }),
    );
    expect(screen.getByRole("heading", { name: "取込内容を確認" })).toBeVisible();
  });
  it("cancels and discards a late parse result so it cannot become a stale preview", async () => {
    let resolve!: (result: ExcelResult) => void,
      cancels = 0,
      previews = 0;
    const deferred = new Promise<ExcelResult>((r) => {
      resolve = r;
    });
    render(
      <ImportForm
        revision={1}
        master={{ standardId: "scs-20260327-star3", masterContentSha256: "b".repeat(64), rows: [] }}
        importer={() => ({
          promise: deferred,
          cancel: () => {
            cancels++;
          },
        })}
        preview={async () => {
          previews++;
          return preview;
        }}
        commit={async () => false}
      />,
    );
    fireEvent.change(screen.getByLabelText("Excelファイルを選択"), {
      target: { files: [new File(["x"], "anonymous.xlsx")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "検査を中止" }));
    resolve(result);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "検査を中止しました。診断は変更していません。",
      ),
    );
    expect({ cancels, previews }).toEqual({ cancels: 1, previews: 0 });
  });
});
