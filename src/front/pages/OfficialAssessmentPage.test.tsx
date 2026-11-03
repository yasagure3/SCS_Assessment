import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { OfficialAssessmentForm } from "./OfficialAssessmentPage";
import { assessmentFixture } from "../components/assessments/assessmentFixtures";
import { emptyOfficialAnswers } from "../../shared/contracts/officialAssessment";
import { ApiError } from "../lib/fetcher";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  read: vi.fn(),
  clearError: vi.fn(),
  error: null as Error | null,
}));
vi.mock("../lib/api", () => ({
  useWrite: () => ({ ...mocks, pending: false }),
  isAccessError: () => false,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.error = null;
});
function fixture() {
  const { record } = assessmentFixture();
  record.document.responses = {
    "1-2-1-1": {
      ...record.document.responses["C-1"],
      status: "yes",
      basis: "根拠資料",
      supplement: "補足説明",
    },
  };
  record.document.officialAnswers = emptyOfficialAnswers();
  return record;
}
describe("official draft review and saving", () => {
  it("preserves saved and unsaved answers, requires review, and sends only the reviewed form on save", async () => {
    const record = fixture();
    record.document.officialAnswers!.rows["1-2-1-1:1"].result = "不適合";
    const saved = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/official?criterion=1-2-1-1"]}>
        <OfficialAssessmentForm record={record} readOnly={false} onSaved={saved} />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText("質問への回答 1"), "手入力の途中");
    await user.click(screen.getByRole("button", { name: "空欄に下書きを作成" }));
    expect(screen.getByRole("combobox", { name: "自己評価結果 1" })).toHaveValue("不適合");
    expect(screen.getByRole("combobox", { name: "自己評価結果 2" })).toHaveValue("適合");
    expect(screen.getByLabelText("質問への回答 1")).toHaveValue("手入力の途中");
    expect(mocks.send).not.toHaveBeenCalled();
    const save = screen.getByRole("button", { name: "公式回答を保存" });
    expect(save).toBeDisabled();
    fireEvent.submit(save.closest("form")!);
    expect(mocks.send).not.toHaveBeenCalled();
    await user.click(
      screen.getByLabelText("作成した下書きを各質問・適合基準に照らして確認・修正しました"),
    );
    await user.type(screen.getByLabelText("質問への回答 1"), "を修正");
    expect(save).toBeDisabled();
    await user.click(
      screen.getByLabelText("作成した下書きを各質問・適合基準に照らして確認・修正しました"),
    );
    mocks.send.mockImplementation(async (_path, _method, body) => ({
      data: {
        ...record,
        revision: 2,
        document: { ...record.document, officialAnswers: body.answers },
      },
      requestId: "draft",
    }));
    await user.click(save);
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    const submitted = mocks.send.mock.calls[0][2];
    expect(submitted.expectedRevision).toBe(1);
    expect(submitted.answers.rows["1-2-1-1:1"]).toEqual({
      result: "不適合",
      answer: "手入力の途中を修正",
    });
    expect(submitted.answers.rows["1-2-1-1:2"].result).toBe("適合");
  });
  it("shows editable source text in the draft and keeps a failed save available for retry", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <OfficialAssessmentForm record={fixture()} readOnly={false} onSaved={vi.fn()} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "空欄に下書きを作成" }));
    expect((screen.getByLabelText("質問への回答 1") as HTMLTextAreaElement).value).toContain(
      "根拠資料",
    );
    expect((screen.getByLabelText("質問への回答 1") as HTMLTextAreaElement).value).toContain(
      "補足説明",
    );
    await user.clear(screen.getByLabelText("質問への回答 1"));
    await user.type(screen.getByLabelText("質問への回答 1"), "確認した組織規程 第2章");
    await user.click(
      screen.getByLabelText("作成した下書きを各質問・適合基準に照らして確認・修正しました"),
    );
    mocks.send.mockResolvedValue(null);
    await user.click(screen.getByRole("button", { name: "公式回答を保存" }));
    expect(screen.getByLabelText("質問への回答 1")).toHaveValue("確認した組織規程 第2章");
    expect(screen.getByRole("button", { name: "公式回答を保存" })).toBeEnabled();
  });
  it.each(["archived", "conflict", "stale"])("disables drafting for %s records", (mode) => {
    const record = fixture();
    if (mode === "conflict")
      mocks.error = new ApiError(409, {
        error: { code: "CONFLICT", message: "更新競合" },
        requestId: "test",
      });
    const view = render(
      <MemoryRouter>
        <OfficialAssessmentForm record={record} readOnly={mode === "archived"} onSaved={vi.fn()} />
      </MemoryRouter>,
    );
    if (mode === "stale")
      view.rerender(
        <MemoryRouter>
          <OfficialAssessmentForm
            record={{ ...record, revision: 2 }}
            readOnly={false}
            onSaved={vi.fn()}
          />
        </MemoryRouter>,
      );
    expect(screen.getByRole("button", { name: "空欄に下書きを作成" })).toBeDisabled();
  });
});
