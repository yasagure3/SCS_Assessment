import type { ReactNode } from "react";
import { useSWRConfig } from "swr";
import { Navigate, useNavigate } from "react-router";
import { signOut } from "../lib/cognitoClient";
import { useAccess } from "../lib/useAccess";
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, me } = useAccess(),
    { mutate } = useSWRConfig(),
    navigate = useNavigate();
  if (session.isLoading)
    return (
      <p className="loading-state" role="status">
        ログイン状態を確認しています…
      </p>
    );
  if (!session.data) return <Navigate to="/login" replace />;
  if (me.error)
    return (
      <main className="login-card">
        <h1>利用権限を確認できません</h1>
        <p role="alert">
          {me.error instanceof Error ? me.error.message : "管理者へ確認してください。"}
        </p>
        <button
          type="button"
          className="button primary"
          onClick={() => {
            signOut();
            void mutate(() => true, undefined, { revalidate: false });
            void navigate("/login");
          }}
        >
          ログイン画面へ戻る
        </button>
        <button type="button" className="button secondary" onClick={() => void me.mutate()}>
          再確認
        </button>
      </main>
    );
  if (!me.data)
    return (
      <p className="loading-state" role="status">
        利用権限を確認しています…
      </p>
    );
  return children;
}
