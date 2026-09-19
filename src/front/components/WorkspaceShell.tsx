import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { AppShell } from "./AppShell";
export function WorkspaceShell({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <div className="workspace">
        <aside className="workspace-sidebar">
          <p className="eyebrow">WORKSPACE</p>
          <nav aria-label="業務メニュー">
            <NavLink to="/customers">顧客・案件</NavLink>
            <NavLink to="/mypage">担当者アカウント</NavLink>
            <NavLink to="/settings">管理・利用設定</NavLink>
          </nav>
          <p className="sidebar-note">
            SCS ★3
            <br />
            2026年3月27日版
            <br />
            26要求事項・81評価基準
          </p>
        </aside>
        <div className="workspace-content">{children}</div>
      </div>
    </AppShell>
  );
}
export function LoadState({
  error,
  loading,
  retry,
}: {
  error: unknown;
  loading: boolean;
  retry: () => unknown;
}) {
  if (loading)
    return (
      <p className="loading-state" role="status">
        読み込んでいます…
      </p>
    );
  if (error)
    return (
      <section className="panel">
        <p role="alert">{error instanceof Error ? error.message : "読み込めませんでした。"}</p>
        <button type="button" className="button secondary" onClick={() => void retry()}>
          再試行
        </button>
      </section>
    );
  return null;
}
