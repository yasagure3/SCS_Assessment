import { describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, render, screen } from "@testing-library/react";
import { EntityForm } from "./EntityForm";
import { ApiError } from "../../lib/fetcher";

vi.mock("../../lib/api", () => ({
  useWrite: () => ({
    pending: false,
    error: new ApiError(409, {
      error: { code: "CONFLICT", message: "別の担当者が更新しました。" },
      requestId: "test",
    }),
    send: vi.fn().mockResolvedValue(null),
    clearError: vi.fn(),
  }),
}));
describe("EntityForm conflict recovery", () => {
  it("keeps typed input and waits for a newer saved revision before allowing recovery", () => {
    const record = {
      id: "customer",
      name: "保存名",
      revision: 1,
      archivedAt: null,
      createdAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
    };
    const props = {
      record,
      latest: record,
      path: "/api/v1/customers/customer",
      label: "顧客名",
      onSaved: vi.fn(),
      refresh: vi.fn(),
    };
    const view = render(<EntityForm {...props} />);
    fireEvent.change(screen.getByLabelText("顧客名"), { target: { value: "入力中の顧客名" } });
    expect(screen.getByRole("button", { name: "入力を保って再編集する" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存値で入力を置き換える" })).toBeDisabled();
    view.rerender(
      <EntityForm {...props} latest={{ ...record, name: "他の担当者の保存名", revision: 2 }} />,
    );
    expect(screen.getByLabelText("顧客名")).toHaveValue("入力中の顧客名");
    expect(screen.getByText(/他の担当者の保存名/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "入力を保って再編集する" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "保存値で入力を置き換える" }));
    expect(screen.getByLabelText("顧客名")).toHaveValue("他の担当者の保存名");
  });
});
