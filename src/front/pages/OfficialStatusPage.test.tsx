import { describe, expect, it } from "vite-plus/test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { OfficialStatusView } from "./OfficialStatusPage";
import { assessmentFixture } from "../components/assessments/assessmentFixtures";
import { emptyOfficialAnswers } from "../../shared/contracts/officialAssessment";

describe("official status view", () => {
  it("filters incomplete and nonconforming criteria independently and links to exact rows", async () => {
    const { record } = assessmentFixture();
    const answers = emptyOfficialAnswers();
    answers.rows["1-2-1-1:1"] = { result: "適合", answer: "役割規程 第2章" };
    answers.rows["1-2-1-1:2"].result = "不適合";
    record.document.officialAnswers = answers;
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <OfficialStatusView record={record} />
      </MemoryRouter>,
    );
    await user.selectOptions(screen.getByLabelText("表示する状況"), "missing");
    expect(screen.getAllByRole("article")).toHaveLength(80);
    expect(screen.queryByRole("article", { name: "評価基準 1-2-1-1" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("表示する状況"), "nonconforming");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    const criterion = screen.getByRole("article");
    await user.click(within(criterion).getByText("基準・質問・回答を確認"));
    expect(within(criterion).getByText("役割規程 第2章")).toBeVisible();
    expect(within(criterion).getByRole("link", { name: "適合基準 2 の回答欄へ" })).toHaveAttribute(
      "href",
      "/assessments/assessment/official?criterion=1-2-1-1#official-row-1-2-1-1:2",
    );
    await user.type(screen.getByLabelText("評価基準ID・内容で検索"), "4-4-4-1");
    expect(screen.getByText("条件に一致する評価基準はありません。")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("表示する状況"), "all");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("article", { name: "評価基準 4-4-4-1" })).toBeVisible();
  });
  it("marks conditional scope questions unnecessary and shows no-save state", async () => {
    const { record } = assessmentFixture();
    const user = userEvent.setup();
    const view = render(
      <MemoryRouter>
        <OfficialStatusView record={record} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/公式回答はまだ保存されていません/)).toBeVisible();
    const next = structuredClone(record);
    next.document.officialAnswers = emptyOfficialAnswers();
    next.document.officialAnswers.scopeAnswers["1."] = "a.法人全体";
    view.rerender(
      <MemoryRouter>
        <OfficialStatusView record={next} />
      </MemoryRouter>,
    );
    await user.click(screen.getByText("登録組織・適用範囲の記入欄"));
    expect(screen.getAllByText("回答不要")).toHaveLength(3);
    expect(screen.getByRole("progressbar", { name: "適用範囲の質問" })).toHaveAttribute(
      "value",
      "1",
    );
    expect(screen.getByRole("progressbar", { name: "適用範囲の質問" })).toHaveAttribute("max", "8");
  });
});
