import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { MasterImportForm } from "./MasterImportPage";
import { startMasterImport } from "../workers/masterClient";
const mocks = vi.hoisted(() => ({ send: vi.fn(), clearError: vi.fn() }));
vi.mock("../lib/api", () => ({
  useWrite: () => ({ ...mocks, pending: false, error: null }),
  isAccessError: () => false,
}));
vi.mock("../workers/masterClient", () => ({ startMasterImport: vi.fn() }));
const workbook = {
  fileName: "fixture.xlsx",
  fileSha256: "a".repeat(64),
  sheet: "検証",
  headerRow: 4,
  masterRows: [],
  answers: [],
};
const preview = {
  previewSha256: "b".repeat(64),
  diff: { added: [], removed: [], changed: [], unchanged: 81 },
  counts: { yes: 24, uncertain: 24, no: 28, unanswered: 5, total: 81 },
  star4Excluded: 72,
  dashCount: 5,
  canCommit: true,
  errors: [],
};
beforeEach(() => {
  vi.clearAllMocks();
});
function mount(readOnly = false) {
  return render(
    <MemoryRouter>
      <MasterImportForm assessmentId="assessment" revision={2} readOnly={readOnly} />
    </MemoryRouter>,
  );
}
describe("master import confirmation", () => {
  it("requires confirmation, commits the preview digest, and links to the new assessment", async () => {
    vi.mocked(startMasterImport).mockReturnValue({
      promise: Promise.resolve({ workbook, errors: [] }),
      cancel: vi.fn(),
    });
    mocks.send
      .mockResolvedValueOnce({ data: preview })
      .mockResolvedValueOnce({ data: { assessmentId: "new", standardId: "new-master", preview } });
    const user = userEvent.setup();
    mount();
    await user.upload(
      screen.getByLabelText("評価項目マスタのExcel"),
      new File(["x"], "fixture.xlsx"),
    );
    const save = await screen.findByRole("button", { name: "マスタと自己評価を取り込む" });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(save);
    await screen.findByRole("link", { name: "取り込んだ診断のダッシュボードを開く" });
    expect(mocks.send.mock.calls[1][2]).toEqual({
      expectedRevision: 2,
      workbook,
      previewSha256: preview.previewSha256,
    });
    expect(screen.getByRole("link")).toHaveAttribute("href", "/assessments/new");
  });
  it("does not preview invalid workbooks or allow selection in archived cases", async () => {
    vi.mocked(startMasterImport).mockReturnValue({
      promise: Promise.resolve({
        workbook,
        errors: [{ code: "DUPLICATE_ID", sheet: "検証", row: 5, column: "L" }],
      }),
      cancel: vi.fn(),
    });
    const user = userEvent.setup();
    const view = mount();
    await user.upload(
      screen.getByLabelText("評価項目マスタのExcel"),
      new File(["x"], "fixture.xlsx"),
    );
    await screen.findByRole("heading", { name: "Excelを修正してください" });
    expect(mocks.send).not.toHaveBeenCalled();
    view.unmount();
    mount(true);
    expect(screen.getByLabelText("評価項目マスタのExcel")).toBeDisabled();
  });
  it("cancels inspection on unmount and ignores its later result", async () => {
    let resolve!: (value: { workbook: typeof workbook; errors: [] }) => void;
    const cancel = vi.fn();
    vi.mocked(startMasterImport).mockReturnValue({
      promise: new Promise((done) => {
        resolve = done;
      }),
      cancel,
    });
    const user = userEvent.setup();
    const view = mount();
    await user.upload(
      screen.getByLabelText("評価項目マスタのExcel"),
      new File(["x"], "fixture.xlsx"),
    );
    view.unmount();
    resolve({ workbook, errors: [] });
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
