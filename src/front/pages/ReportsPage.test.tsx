import { describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { SWRConfig } from "swr";
import { ReportsPage } from "./ReportsPage";
import { assessmentFixture } from "../components/assessments/assessmentFixtures";
import type { ReportPreview, SavedReport } from "../../shared/contracts/reports";
const hash = "a".repeat(64);
function mount() {
  const router = createMemoryRouter(
    [
      {
        path: "/assessments/:assessmentId/reports",
        element: <ReportsPage hashLimitations={async () => hash} />,
      },
    ],
    { initialEntries: ["/assessments/assessment/reports"] },
  );
  return render(
    <SWRConfig
      value={{
        provider: () =>
          new Map([
            ["cognito-session", { data: { accessToken: "test", email: "test@example.invalid" } }],
          ]),
        revalidateIfStale: false,
        revalidateOnFocus: false,
        dedupingInterval: 0,
      }}
    >
      <RouterProvider router={router} />
    </SWRConfig>,
  );
}
function network(
  options: {
    failure?: string;
    loading?: Promise<void>;
    saving?: Promise<void>;
    missing?: boolean;
    previewFailure?: boolean;
    historyDenied?: boolean;
  } = {},
) {
  const { record, standard } = assessmentFixture();
  const limitations = {
    unanswered: ["C-1"],
    notRegistered: ["C-1"],
    unreviewed: [],
    rejected: [],
    unconfirmedAdvice: [],
    staleAdvice: [],
    draftPendingIds: ["C-1"],
  };
  const preview: ReportPreview = {
    previewHash: hash,
    revision: 1,
    content: {
      schemaVersion: 1,
      rendererVersion: "scs-report-1",
      customer: { id: "customer", name: "匿名社" },
      case: { id: "case", name: "案件" },
      assessment: {
        id: "assessment",
        revision: 1,
        standardId: "standard",
        diagnosisDate: "2026-09-22",
        scope: { companies: "匿名社", sites: "本社", departments: "全社", systems: "業務" },
        copiedFrom: null,
      },
      standard: {
        publicationDate: "2026-03-27",
        sourceUrl: "https://example.invalid/standard",
        contentSha256: hash,
        criteria: standard.criteria,
      },
      counts: record.counts,
      categoryCounts: record.categoryCounts,
      limitations,
      majorIssues: ["C-1"],
      responses: {},
      evidence: [],
      tasks: [],
    },
    limitations,
    blockingErrors: options.missing
      ? [{ path: "scope.sites", reason: "対象範囲を入力してください。" }]
      : [],
  };
  const saved: SavedReport = {
    reportId: "report",
    snapshotSha256: hash,
    snapshot: {
      ...preview.content,
      reportId: "report",
      createdAt: "2026-09-22T00:00:00.000Z",
      createdBy: "staff",
    },
  };
  const writes: { path: string; body: any; key: string }[] = [];
  let reports: unknown[] = [],
    failRead = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        if (typeof init.body !== "string") throw new Error("Expected JSON body");
        const body = JSON.parse(init.body);
        writes.push({
          path,
          body,
          key: (init.headers as Record<string, string>)["Idempotency-Key"],
        });
        if (path.endsWith("/report-preview")) {
          if (options.previewFailure && writes.length === 1)
            throw new Error("事前確認を読み込めませんでした。");
          return Response.json({
            data: {
              ...preview,
              revision: record.revision,
              content: { ...preview.content, majorIssues: body.majorIssueCriterionIds ?? ["C-1"] },
            },
          });
        }
        await options.saving;
        if (writes.filter((w) => w.path.endsWith("/reports")).length === 1 && options.failure) {
          if (options.failure === "NETWORK") throw new Error("通信が切断されました。");
          record.revision++;
          return Response.json(
            {
              error: {
                code: options.failure,
                message: "内容が更新されました。再確認してください。",
              },
            },
            { status: 409 },
          );
        }
        reports = [
          {
            id: "report",
            assessmentRevision: 1,
            createdAt: saved.snapshot.createdAt,
            createdBy: "staff",
          },
        ];
        return Response.json({ data: saved });
      }
      await options.loading;
      if (failRead) throw new Error("読込が切断されました。");
      if (path.endsWith("/standards/standard")) return Response.json({ data: standard });
      if (path.endsWith("/cases/case"))
        return Response.json({ data: { id: "case", name: "案件", archivedAt: null } });
      if (path.endsWith("/customers/customer"))
        return Response.json({ data: { id: "customer", name: "匿名社", archivedAt: null } });
      if (path.startsWith("/api/v1/assessments/assessment/reports") && options.historyDenied)
        return Response.json(
          {
            error: { code: "NOT_FOUND", message: "レポートの閲覧権限がありません。" },
            requestId: "test",
          },
          { status: 404 },
        );
      if (path.startsWith("/api/v1/assessments/assessment/reports"))
        return Response.json({ data: { items: reports, nextCursor: null } });
      if (path.endsWith("/reports/report")) return Response.json({ data: saved });
      return Response.json({ data: structuredClone(record) });
    }),
  );
  return {
    writes,
    preview,
    saved,
    setFailRead: (value: boolean) => {
      failRead = value;
    },
  };
}
describe("report confirmation page", () => {
  it("shows permission failure and hides report actions when history access is revoked", async () => {
    network({ historyDenied: true });
    mount();
    expect((await screen.findByRole("alert")).textContent).toBe("レポートの閲覧権限がありません。");
    expect(screen.queryByRole("button", { name: "出力内容を事前確認" })).not.toBeInTheDocument();
  });
  it("allows retry after a preview network failure without treating the read as an uncertain finalization", async () => {
    network({ previewFailure: true });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "出力内容を事前確認" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "出力内容を事前確認" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "出力内容を事前確認" }));
    expect(await screen.findByLabelText("留意事項と出力内容を確認しました")).not.toBeChecked();
  });
  it("loads a preview, requires acknowledgement, excludes draft text and prevents duplicate finalization", async () => {
    let release!: () => void;
    const f = network({
      saving: new Promise<void>((r) => {
        release = r;
      }),
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "出力内容を事前確認" }));
    expect(await screen.findByText("確定済み版を出力。新しい下書きは含めない")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "この内容で版を確定" });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByLabelText("留意事項と出力内容を確認しました"));
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "確定しています…" })).toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "確定しています…" }));
    release();
    expect(await screen.findByText("レポート版を確定しました。")).toBeInTheDocument();
    expect(f.writes.map(({ path, body }) => ({ path, body }))).toEqual([
      { path: "/api/v1/assessments/assessment/report-preview", body: { expectedRevision: 1 } },
      {
        path: "/api/v1/assessments/assessment/reports",
        body: {
          expectedRevision: 1,
          previewHash: hash,
          majorIssueCriterionIds: ["C-1"],
          acknowledgedLimitationHash: hash,
        },
      },
    ]);
    expect(await screen.findByText("report", { exact: true })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "作業用Excelの保存" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excelを生成" })).toBeEnabled();
  });
  it("clears acknowledgement and preview when the selected major issues change", async () => {
    network();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "出力内容を事前確認" }));
    fireEvent.click(await screen.findByLabelText("留意事項と出力内容を確認しました"));
    fireEvent.click(screen.getByRole("checkbox", { name: "主要課題 C-1" }));
    expect(screen.queryByRole("button", { name: "この内容で版を確定" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "出力内容を事前確認" }));
    expect(await screen.findByLabelText("留意事項と出力内容を確認しました")).not.toBeChecked();
  });
  it.each(["NETWORK", "CONFLICT"])(
    "preserves selected issues after %s and requires another preview only for a known conflict",
    async (failure) => {
      const f = network({ failure });
      mount();
      fireEvent.click(await screen.findByRole("button", { name: "出力内容を事前確認" }));
      fireEvent.click(await screen.findByLabelText("留意事項と出力内容を確認しました"));
      fireEvent.click(screen.getByRole("button", { name: "この内容で版を確定" }));
      await screen.findByRole("alert");
      expect(screen.getByRole("checkbox", { name: "主要課題 C-1" })).toBeChecked();
      if (failure === "CONFLICT") {
        expect(
          screen.queryByRole("button", { name: "この内容で版を確定" }),
        ).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "出力内容を事前確認" }));
        fireEvent.click(await screen.findByLabelText("留意事項と出力内容を確認しました"));
      }
      fireEvent.click(screen.getByRole("button", { name: "この内容で版を確定" }));
      await screen.findByText("レポート版を確定しました。");
      const saves = f.writes.filter((w) => w.path.endsWith("/reports"));
      expect(saves.map((w) => w.body.expectedRevision)).toEqual([
        1,
        failure === "CONFLICT" ? 2 : 1,
      ]);
      expect(saves[0].key === saves[1].key).toBe(failure === "NETWORK");
    },
  );
  it("shows missing scope, disables finalization and gives access to the scope form", async () => {
    network({ missing: true });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "出力内容を事前確認" }));
    expect(await screen.findByText("対象拠点: 対象範囲を入力してください。")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("留意事項と出力内容を確認しました"));
    expect(screen.getByRole("button", { name: "この内容で版を確定" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "対象範囲・診断日を編集" })).toHaveAttribute(
      "href",
      "/assessments/assessment#assessment-scope",
    );
    const confirmation = screen.getByRole("group", { name: "レポート版の確定" });
    expect(
      within(confirmation).getByText("対象拠点: 対象範囲を入力してください。"),
    ).toBeInTheDocument();
    expect(within(confirmation).getByRole("link", { name: "不足項目を入力する" })).toHaveAttribute(
      "href",
      "/assessments/assessment#assessment-scope",
    );
  });
  it("recovers an initial load failure with the retry button", async () => {
    const f = network();
    f.setFailRead(true);
    mount();
    expect((await screen.findByRole("alert")).textContent).toBe("読込が切断されました。");
    f.setFailRead(false);
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(await screen.findByRole("heading", { name: "レポート" })).toBeInTheDocument();
    expect(await screen.findByText("確定したレポートはまだありません。")).toBeInTheDocument();
  });
});
