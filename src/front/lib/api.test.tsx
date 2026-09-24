import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig, useSWRConfig } from "swr";
import { MemoryRouter } from "react-router";
import { useApi } from "./api";
import { RequireAuth } from "../components/RequireAuth";

function Draft() {
  const [text, setText] = useState("");
  return (
    <input
      aria-label="未保存の理由"
      value={text}
      onChange={(event) => setText(event.target.value)}
    />
  );
}
function Resource() {
  const me = useApi<{ role: string }>("/api/v1/me");
  const [path, setPath] = useState("/api/v1/customers/first");
  const value = useApi<{ name: string }>(path);
  return (
    <>
      <button onClick={() => setPath("/api/v1/customers/second")}>別顧客</button>
      {me.data && <p>役割: {me.data.role}</p>}
      {value.error ? (
        <p role="alert">閲覧できません</p>
      ) : (
        value.data && (
          <>
            <p>{value.data.name}</p>
            <Draft />
          </>
        )
      )}
    </>
  );
}
function SessionControls() {
  const { mutate } = useSWRConfig();
  return (
    <>
      <button
        onClick={() =>
          void mutate(
            "cognito-session",
            { accessToken: "fresh", email: "anonymous@example.invalid" },
            { revalidate: false },
          )
        }
      >
        認証を更新
      </button>
      <RequireAuth>
        <Resource />
      </RequireAuth>
    </>
  );
}
describe("resource state during memory-token refresh", () => {
  it("keeps an unsaved draft during revalidation, hides a different resource while loading and removes denied data", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let delayed = false;
    vi.stubGlobal("fetch", async (url: string) => {
      if (delayed) await blocked;
      if (url.endsWith("/second"))
        return Response.json(
          { error: { code: "NOT_FOUND", message: "閲覧できません" }, requestId: "test" },
          { status: 404 },
        );
      return Response.json({
        data: url.endsWith("/me")
          ? {
              id: "operator",
              email: "anonymous@example.invalid",
              role: "staff",
              status: "active",
              customerIds: ["first"],
            }
          : { name: "最初の匿名顧客" },
      });
    });
    render(
      <MemoryRouter>
        <SWRConfig
          value={{
            provider: () =>
              new Map([
                [
                  "cognito-session",
                  { data: { accessToken: "old", email: "anonymous@example.invalid" } },
                ],
              ]),
            revalidateIfStale: false,
            revalidateOnFocus: false,
            dedupingInterval: 0,
          }}
        >
          <SessionControls />
        </SWRConfig>
      </MemoryRouter>,
    );
    await screen.findByText("最初の匿名顧客");
    expect(await screen.findByText("役割: staff")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("未保存の理由"), { target: { value: "編集中の理由" } });
    delayed = true;
    fireEvent.click(screen.getByRole("button", { name: "認証を更新" }));
    await waitFor(() => expect(screen.getByLabelText("未保存の理由")).toHaveValue("編集中の理由"));
    fireEvent.click(screen.getByRole("button", { name: "別顧客" }));
    expect(screen.queryByText("最初の匿名顧客")).not.toBeInTheDocument();
    release();
    expect((await screen.findByRole("alert")).textContent).toBe("閲覧できません");
  });
});
