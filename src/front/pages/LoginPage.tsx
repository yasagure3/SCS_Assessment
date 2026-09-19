import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useSWRConfig } from "swr";
import {
  completeNewPassword,
  completeTotp,
  signIn,
  signOut,
  type AuthResult,
} from "../lib/cognitoClient";
import { AppShell } from "../components/AppShell";

type Step = { kind: "password" } | Exclude<AuthResult, { kind: "signed-in" }>;
export function LoginPage() {
  const navigate = useNavigate(),
    { mutate } = useSWRConfig();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>({ kind: "password" });
  const [signInError, setSignInError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const attempt = useRef(0);
  async function submit() {
    if (pending) return;
    const epoch = ++attempt.current;
    setPending(true);
    setSignInError(null);
    try {
      const result = await (step.kind === "password"
        ? signIn(email, password)
        : step.kind === "new-password"
          ? completeNewPassword(password)
          : completeTotp(code));
      if (epoch !== attempt.current) return;
      setPassword("");
      setCode("");
      if (result.kind === "signed-in") {
        setStep({ kind: "password" });
        await mutate("cognito-session", result.session, { revalidate: false });
        if (epoch === attempt.current) void navigate("/mypage");
      } else setStep(result);
    } catch (error) {
      if (epoch === attempt.current) {
        setCode("");
        setSignInError(error instanceof Error ? error.message : "ログインできませんでした。");
      }
    } finally {
      if (epoch === attempt.current) setPending(false);
    }
  }
  function cancel() {
    attempt.current++;
    signOut();
    setStep({ kind: "password" });
    setPassword("");
    setCode("");
    setSignInError(null);
    setPending(false);
    void mutate(() => true, undefined, { revalidate: false });
  }
  const isTotp = step.kind === "totp" || step.kind === "totp-setup";
  return (
    <AppShell>
      <section className="login-card">
        <p className="eyebrow">STAFF ACCESS</p>
        <h1>
          {step.kind === "password"
            ? "担当者ログイン"
            : step.kind === "new-password"
              ? "初回パスワードの変更"
              : step.kind === "totp-setup"
                ? "認証アプリの登録"
                : "多要素認証"}
        </h1>
        <p className="subtle">
          {step.kind === "password"
            ? "招待を受けたメールアドレスでログインしてください。"
            : step.kind === "new-password"
              ? "12文字以上で、大文字・小文字・数字・記号を含めて設定してください。"
              : "認証アプリに表示される6桁のコードを入力してください。"}
        </p>
        {step.kind === "totp-setup" && (
          <div className="mfa-setup">
            <p>
              認証アプリで「セットアップキーを入力」を選び、次のキーを登録してください。種類は「時間ベース」です。
            </p>
            <code aria-label="セットアップキー">{step.secret}</code>
            <p className="subtle">キーは他の人と共有しないでください。</p>
          </div>
        )}
        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {step.kind === "password" && (
            <>
              <label htmlFor="email">メールアドレス</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                placeholder="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={pending}
              />
            </>
          )}
          {!isTotp && (
            <>
              <label htmlFor="password">
                {step.kind === "new-password" ? "新しいパスワード" : "パスワード"}
              </label>
              <input
                id="password"
                type="password"
                autoComplete={step.kind === "new-password" ? "new-password" : "current-password"}
                minLength={step.kind === "new-password" ? 12 : undefined}
                required
                placeholder="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={pending}
              />
            </>
          )}
          {isTotp && (
            <>
              <label htmlFor="totp">認証コード</label>
              <input
                id="totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={pending}
              />
            </>
          )}
          <button type="submit" disabled={pending} className="button primary">
            {pending
              ? "確認中…"
              : step.kind === "password"
                ? "ログイン"
                : step.kind === "new-password"
                  ? "パスワードを変更"
                  : "認証する"}
          </button>
          {(step.kind !== "password" || pending) && (
            <button type="button" className="button secondary" onClick={cancel}>
              最初からやり直す
            </button>
          )}
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
