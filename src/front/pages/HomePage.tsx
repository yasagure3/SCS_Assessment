import useSWR from "swr";
import { fetcher } from "../lib/fetcher";
import { AppShell } from "../components/AppShell";

type HealthResponse = { status: string };

export function HomePage() {
  const { data, error, isLoading } = useSWR<HealthResponse>("/api/health", fetcher);
  const status = isLoading ? "loading" : error ? "error" : (data?.status ?? "error");

  return (
    <AppShell>
      <section className="welcome">
        <p className="eyebrow">SCS ★3 ASSESSMENT</p>
        <h1>
          課題を整理し、
          <br />
          次の対策を明確に。
        </h1>
        <p className="welcome-description">
          顧客ごとの回答・証跡・改善計画をひとつにまとめ、
          <br />
          SCS ★3の取得に向けた取り組みを支援します。
        </p>
        <a className="button primary" href="/login">
          担当者ログイン →
        </a>
        <p className="subtle">招待された社内担当者向けのサービスです。</p>
        <div
          className="service-status"
          role="status"
          data-testid="api-health-status"
          data-status={status}
        >
          <span className={`status-dot ${status}`} aria-hidden="true" />
          {isLoading
            ? "サービスの接続を確認しています…"
            : error
              ? "サービスに接続できません。時間をおいて再度お試しください。"
              : data?.status === "ok"
                ? "サービスに接続しています"
                : "サービスの状態を確認できません"}
        </div>
      </section>
    </AppShell>
  );
}
