import { useSWRConfig } from "swr";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { signOut } from "../lib/cognitoClient";
import { useAccess } from "../lib/useAccess";
import { AppShell } from "../components/AppShell";
import { ApiError, fetcher } from "../lib/fetcher";
export function MyPage() {
  const navigate = useNavigate(),
    { mutate } = useSWRConfig(),
    { me, session } = useAccess();
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const revokeKey = useRef(crypto.randomUUID());
  function logout() {
    signOut();
    void mutate(() => true, undefined, { revalidate: false });
    void navigate("/login");
  }
  async function revoke() {
    if (pending || !session.data) return;
    setPending(true);
    setError("");
    try {
      await fetcher("/api/v1/session/revoke", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.data.accessToken}`,
          "Idempotency-Key": revokeKey.current,
        },
      });
      logout();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        logout();
        return;
      }
      setError("失効結果を確認できませんでした。再試行するか、管理者へ確認してください。");
    } finally {
      setPending(false);
    }
  }
  return (
    <AppShell>
      <section className="login-card">
        <p className="eyebrow">STAFF ACCOUNT</p>
        <h1>担当者アカウント</h1>
        <p>
          <Link className="button primary" to="/customers">
            顧客・案件を開く
          </Link>
        </p>
        {me.data && (
          <>
            <p data-testid="my-email">{me.data.email}</p>
            <p data-testid="my-role">{me.data.role === "admin" ? "管理者" : "担当者"}</p>
            <p className="subtle">
              {me.data.role === "admin"
                ? "すべての顧客を管理できます。"
                : `担当顧客：${me.data.customerIds.length}社`}
            </p>
          </>
        )}
        <button type="button" className="button secondary" onClick={logout}>
          ログアウト
        </button>
        <p className="subtle">共有端末を使った場合などは、ほかの端末のログインも失効できます。</p>
        <button
          type="button"
          className="button secondary"
          disabled={pending}
          onClick={() => void revoke()}
        >
          {pending ? "失効しています…" : "全端末からログアウト"}
        </button>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </section>
    </AppShell>
  );
}
