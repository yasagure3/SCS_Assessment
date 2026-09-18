import { useState } from "react";
import { useNavigate } from "react-router";
import { useSWRConfig } from "swr";
import { signIn } from "../lib/cognitoClient";
import { AppShell } from "../components/AppShell";

export function LoginPage() {
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signInError, setSignInError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <AppShell>
      <section className="login-card">
        <p className="eyebrow">STAFF ACCESS</p>
        <h1>担当者ログイン</h1>
        <p className="subtle">招待を受けたメールアドレスでログインしてください。</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            setPending(true);
            setSignInError(null);
            signIn(email, password)
              .then((session) => {
                // RequireAuth/MyPage が同じキーで購読するセッションキャッシュを
                // 即座に最新化する。未ログイン時に一度 /mypage を訪れてキャッシュ
                // が空 (null) のまま残っていると、遷移直後に再度リダイレクトされる。
                return mutate("cognito-session", session, { revalidate: false });
              })
              .then(() => {
                void navigate("/mypage");
              })
              .catch((error: unknown) => {
                setSignInError(error instanceof Error ? error.message : "サインインに失敗しました");
              })
              .finally(() => setPending(false));
          }}
          className="login-form"
        >
          <label htmlFor="email">メールアドレス</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border p-2"
          />
          <label htmlFor="password">パスワード</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border p-2"
          />
          <button type="submit" disabled={pending} className="button primary">
            {pending ? "ログイン中…" : "ログイン"}
          </button>
        </form>
        {signInError && (
          <p role="alert" className="form-error" data-testid="sign-in-error">
            {signInError}
          </p>
        )}
      </section>
    </AppShell>
  );
}
