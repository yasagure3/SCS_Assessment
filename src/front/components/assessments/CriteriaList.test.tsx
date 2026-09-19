import { describe, expect, it } from "vite-plus/test";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { CriteriaList } from "./CriteriaList";
import { assessmentFixture } from "./assessmentFixtures";
describe("criteria filtering", () => {
  it("combines category, status, evidence and local edited-text search and clears zero results", () => {
    const { record, standard } = assessmentFixture();
    render(
      <MemoryRouter>
        <CriteriaList record={record} standard={standard} />
      </MemoryRouter>,
    );
    expect(screen.getByText("81 / 81件")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("自己評価で絞り込み"), { target: { value: "no" } });
    fireEvent.change(screen.getByLabelText("大分類"), { target: { value: "組織" } });
    fireEvent.change(screen.getByLabelText("証跡の確認"), { target: { value: "notRegistered" } });
    fireEvent.change(screen.getByLabelText("評価基準を検索"), {
      target: { value: "固有の編集文" },
    });
    expect(screen.getByText("1 / 81件")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "C-1 詳細" })).toHaveAttribute(
      "href",
      "/assessments/assessment/criteria/C-1",
    );
    fireEvent.change(screen.getByLabelText("大分類"), { target: { value: "技術" } });
    expect(screen.getByText("条件に一致する評価基準がありません")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "条件をクリア" }));
    expect(screen.getByText("81 / 81件")).toBeInTheDocument();
  });
});
