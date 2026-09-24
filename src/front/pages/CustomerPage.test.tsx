import { describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { createMemoryRouter, RouterProvider } from "react-router";
import { CustomerPage } from "./CustomerPage";
vi.mock("../lib/cognitoClient", () => ({
  getSessionGeneration: () => 1,
  getCurrentSession: async () => ({ accessToken: "test", email: "test@example.invalid" }),
}));
describe("customer editing", () => {
  it("retains unsaved input if refreshing a conflict fails, then allows explicit retry", async () => {
    const saved = {
      id: "customer",
      name: "保存名",
      revision: 1,
      archivedAt: null,
      createdAt: "2026-09-19T00:00:00Z",
      updatedAt: "2026-09-19T00:00:00Z",
    };
    let getCount = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH")
        return new Response(
          JSON.stringify({
            error: { code: "CONFLICT", message: "別の担当者が更新しました。" },
            requestId: "test",
          }),
          { status: 409 },
        );
      if (url.endsWith("/cases"))
        return Response.json({ data: { items: [], nextCursor: null }, requestId: "test" });
      getCount++;
      if (getCount === 2) throw new Error("通信が切れました");
      return Response.json({
        data: getCount === 1 ? saved : { ...saved, name: "別の担当者の保存名", revision: 2 },
        requestId: "test",
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const router = createMemoryRouter(
      [{ path: "/customers/:customerId", element: <CustomerPage /> }],
      { initialEntries: ["/customers/customer"] },
    );
    render(
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}
      >
        <RouterProvider router={router} />
      </SWRConfig>,
    );
    const name = await screen.findByLabelText("顧客名");
    fireEvent.click(screen.getByText("顧客名・保管状態を変更"));
    fireEvent.change(name, { target: { value: "入力中" } });
    fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));
    await screen.findByText("通信が切れました");
    expect(screen.getByLabelText("顧客名")).toHaveValue("入力中");
    expect(screen.getByRole("button", { name: "入力を保って再編集する" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "最新の内容を再確認" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "入力を保って再編集する" })).toBeEnabled(),
    );
    expect(screen.getByLabelText("顧客名")).toHaveValue("入力中");
    fireEvent.click(screen.getByRole("button", { name: "入力を保って再編集する" }));
    fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2),
    );
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    const body = writes[1][1]?.body;
    if (typeof body !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(body)).toMatchObject({
      name: "入力中",
      expectedRevision: 2,
    });
  });
});
