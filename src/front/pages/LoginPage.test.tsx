import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { SWRConfig } from "swr";
import { LoginPage } from "./LoginPage";
import { signIn, completeNewPassword, completeTotp, signOut } from "../lib/cognitoClient";
vi.mock("../lib/cognitoClient", () => ({
  getSessionGeneration: () => 1,
  signIn: vi.fn(),
  completeNewPassword: vi.fn(),
  completeTotp: vi.fn(),
  signOut: vi.fn(),
}));
function renderLoginPage() {
  const router = createMemoryRouter(
    [
      { path: "/login", element: <LoginPage /> },
      { path: "/mypage", element: <p data-testid="mypage-stub">MyPage</p> },
    ],
    { initialEntries: ["/login"] },
  );
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <RouterProvider router={router} />
    </SWRConfig>,
  );
}
async function login() {
  const user = userEvent.setup();
  renderLoginPage();
  await user.type(screen.getByLabelText("メールアドレス"), "test@example.invalid");
  await user.type(screen.getByLabelText("パスワード"), "temporary");
  await user.click(screen.getByRole("button", { name: "ログイン" }));
  return user;
}
const signedIn = {
  kind: "signed-in" as const,
  session: { accessToken: "token", email: "test@example.invalid" },
};
beforeEach(() => vi.clearAllMocks());
describe("MFA login screens", () => {
  it("navigates after a completed MFA session", async () => {
    vi.mocked(signIn).mockResolvedValue(signedIn);
    await login();
    expect(await screen.findByTestId("mypage-stub")).toBeInTheDocument();
  });
  it("waits for TOTP and preserves the challenge after an incorrect code", async () => {
    vi.mocked(signIn).mockResolvedValue({ kind: "totp" });
    vi.mocked(completeTotp)
      .mockRejectedValueOnce(new Error("認証コードを確認してください。"))
      .mockResolvedValueOnce(signedIn);
    const user = await login();
    expect(await screen.findByRole("heading", { name: "多要素認証" })).toBeInTheDocument();
    expect(screen.queryByTestId("mypage-stub")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("認証コード"), "123456");
    await user.click(screen.getByRole("button", { name: "認証する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("認証コード");
    expect(screen.getByLabelText("認証コード")).toHaveValue("");
    await user.type(screen.getByLabelText("認証コード"), "654321");
    await user.click(screen.getByRole("button", { name: "認証する" }));
    expect(await screen.findByTestId("mypage-stub")).toBeInTheDocument();
  });
  it("renders enrollment only after initial password change and removes the secret on cancel", async () => {
    vi.mocked(signIn).mockResolvedValue({ kind: "new-password" });
    vi.mocked(completeNewPassword).mockResolvedValue({
      kind: "totp-setup",
      secret: "TEST-ONLY-KEY",
    });
    const user = await login();
    expect(await screen.findByLabelText("新しいパスワード")).toHaveValue("");
    await user.type(screen.getByLabelText("新しいパスワード"), "NewPassword123!");
    await user.click(screen.getByRole("button", { name: "パスワードを変更" }));
    expect(await screen.findByLabelText("セットアップキー")).toHaveTextContent("TEST-ONLY-KEY");
    await user.click(screen.getByRole("button", { name: "最初からやり直す" }));
    expect(signOut).toHaveBeenCalled();
    expect(screen.queryByText("TEST-ONLY-KEY")).not.toBeInTheDocument();
    expect(screen.getByLabelText("パスワード")).toHaveValue("");
  });
  it("shows a readable provider-unconfigured error", async () => {
    vi.mocked(signIn).mockRejectedValue(new Error("認証サービスはまだ設定されていません。"));
    await login();
    expect(await screen.findByRole("alert")).toHaveTextContent("設定されていません");
  });
});
