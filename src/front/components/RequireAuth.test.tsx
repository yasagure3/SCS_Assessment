import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { SWRConfig } from "swr";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RequireAuth } from "./RequireAuth";
import { getCurrentSession } from "../lib/cognitoClient";

vi.mock("../lib/cognitoClient", () => ({
  getSessionGeneration: () => 1,
  getCurrentSession: vi.fn(),
  signOut: vi.fn(),
}));

function renderWithRouter() {
  const router = createMemoryRouter(
    [
      {
        path: "/mypage",
        element: (
          <SWRConfig value={{ provider: () => new Map() }}>
            <RequireAuth>
              <p data-testid="protected-content">Protected</p>
            </RequireAuth>
          </SWRConfig>
        ),
      },
      { path: "/login", element: <p data-testid="login-stub">Login</p> },
    ],
    { initialEntries: ["/mypage"] },
  );
  render(<RouterProvider router={router} />);
}

describe("RequireAuth", () => {
  beforeEach(() => {
    vi.mocked(getCurrentSession).mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            id: "test",
            role: "staff",
            email: "test@example.invalid",
            status: "active",
            customerIds: [],
          },
          requestId: "test",
        }),
      }),
    );
  });

  it("renders children when a session exists", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      accessToken: "token",
      email: "test@example.com",
    });

    renderWithRouter();

    expect(await screen.findByTestId("protected-content")).toBeInTheDocument();
  });

  it("redirects to /login when no session exists", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null);

    renderWithRouter();

    expect(await screen.findByTestId("login-stub")).toBeInTheDocument();
  });

  it("hides all protected content if the server rejects the account", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      accessToken: "token",
      email: "test@example.invalid",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          error: { code: "ACCOUNT_DISABLED", message: "利用停止されています。" },
          requestId: "test",
        }),
      }),
    );
    renderWithRouter();
    expect(await screen.findByRole("alert")).toHaveTextContent("利用停止");
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
  });
});
