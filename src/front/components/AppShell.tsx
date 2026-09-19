import type { ReactNode } from "react";
import { Link } from "react-router";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        本文へ移動
      </a>
      <header className="app-header">
        <Link className="brand" to="/home">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          SCS Assessment
        </Link>
        <span className="edition">★3 診断・助言サービス</span>
      </header>
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <footer className="app-footer">
        SCS制度に基づく診断支援 · 正式な審査・取得判定は制度所定の手続で行われます。
      </footer>
    </div>
  );
}
