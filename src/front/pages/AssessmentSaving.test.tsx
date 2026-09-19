import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig, useSWRConfig } from "swr";
import { createMemoryRouter, RouterProvider } from "react-router";
import { DashboardPage } from "./DashboardPage";
import { CriterionPage } from "./CriterionPage";
import { assessmentFixture } from "../components/assessments/assessmentFixtures";
import type { AssessmentDto } from "../../shared/contracts/assessments";

const ok = (data: unknown) => Response.json({ data, requestId: "regression" });
const customer = { id: "customer", name: "匿名社", archivedAt: null, revision: 1 };
const caseRecord = {
  id: "case",
  customerId: "customer",
  name: "匿名案件",
  archivedAt: null,
  revision: 1,
};
function mount(mode: "scope" | "response") {
  function Refresh() {
    const { mutate } = useSWRConfig();
    return (
      <button
        onClick={() =>
          void mutate(["/api/v1/assessments/assessment", "test"]).catch(() => undefined)
        }
      >
        保存後の取得を検証
      </button>
    );
  }
  const router = createMemoryRouter(
    [
      {
        path:
          mode === "scope"
            ? "/assessments/:assessmentId"
            : "/assessments/:assessmentId/criteria/:criterionId",
        element: mode === "scope" ? <DashboardPage /> : <CriterionPage />,
      },
    ],
    {
      initialEntries: [
        mode === "scope" ? "/assessments/assessment" : "/assessments/assessment/criteria/C-1",
      ],
    },
  );
  return render(
    <SWRConfig
      value={{
        provider: () =>
          new Map([
            ["cognito-session", { data: { accessToken: "test", email: "test@example.invalid" } }],
          ]),
        dedupingInterval: 0,
        revalidateIfStale: false,
        revalidateOnFocus: false,
      }}
    >
      <RouterProvider router={router} />
      <Refresh />
    </SWRConfig>,
  );
}
function addConfirmedAdvice(record: AssessmentDto) {
  record.adviceSummary = { currentConfirmed: 1, stale: 0, draftOnly: 0, none: 80, draftPending: 0 };
  record.document.responses["C-1"].confirmedAdvice = {
    basisHash: record.document.responses["C-1"].basisHash,
    by: "actor",
    at: "2026-09-19T00:00:00.000Z",
    version: 1,
    content: {
      origin: "manual",
      templateId: null,
      gap: "不足",
      steps: [],
      evidenceExamples: [],
      completionCheck: "確認",
      notes: "",
    },
  };
}
describe("assessment save recovery", () => {
  it.each(["scope", "response"] as const)(
    "keeps the successful %s revision and stale advice when a later GET fails",
    async (mode) => {
      const { record, standard } = assessmentFixture();
      addConfirmedAdvice(record);
      let stored = structuredClone(record),
        patched = false,
        reads = 0;
      const writes: Record<string, unknown>[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          if (init?.method === "PATCH") {
            if (typeof init.body !== "string") throw new Error("Expected a JSON request body");
            const body = JSON.parse(init.body);
            writes.push(body);
            stored = structuredClone(stored);
            stored.revision++;
            if (mode === "scope") stored.document.scope = body.scope;
            else stored.document.responses["C-1"].reason = body.reason;
            stored.document.responses["C-1"].basisHash = "b".repeat(64);
            stored.document.responses["C-1"].adviceBasisVersion = 2;
            stored.adviceSummary = {
              currentConfirmed: 0,
              stale: 1,
              draftOnly: 0,
              none: 80,
              draftPending: 0,
            };
            patched = true;
            return ok(stored);
          }
          if (url.endsWith("/standards/standard")) return ok(standard);
          if (url.endsWith("/cases/case")) return ok(caseRecord);
          if (url.endsWith("/customers/customer")) return ok(customer);
          reads++;
          if (patched) throw new Error("保存後の取得が切断されました");
          return ok(stored);
        }),
      );
      mount(mode);
      const field =
        mode === "scope"
          ? await screen.findByLabelText(/^対象会社/)
          : await screen.findByLabelText("判定理由・確認メモ");
      fireEvent.change(field, { target: { value: "保存する新しい内容" } });
      const save = screen.getByRole("button", {
        name: mode === "scope" ? "対象範囲を保存" : "判定を保存",
      });
      fireEvent.click(save);
      await screen.findByText("保存しました。");
      fireEvent.click(screen.getByRole("button", { name: "保存後の取得を検証" }));
      await screen.findByText("保存後の取得が切断されました");
      if (mode === "scope") {
        expect(screen.getByText("再確認が必要").parentElement?.textContent).toBe("再確認が必要1件");
        expect(screen.getByText("確定済み").parentElement?.textContent).toBe("確定済み0件");
      } else
        expect(
          screen.getByText("回答・根拠が変更されたため、助言の再確認が必要です。"),
        ).toBeInTheDocument();
      expect(field).toHaveValue("保存する新しい内容");
      expect(reads).toBeGreaterThanOrEqual(2);
      fireEvent.click(save);
      await waitFor(() => expect(writes).toHaveLength(2));
      expect(writes.map(({ expectedRevision }) => expectedRevision)).toEqual([1, 2]);
    },
  );
  // The scope and response paths share the writer and refresh boundary. NETWORK is the
  // negative control: unlike a known rejected key, an unknown outcome must keep its key.
  it.each(
    (["scope", "response"] as const).flatMap((mode) =>
      ["CONFLICT", "ARCHIVED", "IDEMPOTENCY_CONFLICT", "NETWORK"].map((code) => ({ mode, code })),
    ),
  )(
    "recovers $mode from $code with draft intact and the appropriate revision/key",
    async ({ mode, code }) => {
      const { record, standard } = assessmentFixture();
      let stored = structuredClone(record),
        archived = false;
      const writes: {
        expectedRevision: number;
        mutationId: string;
        reason?: string;
        scope?: { companies: string };
      }[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          if (init?.method === "PATCH") {
            if (typeof init.body !== "string") throw new Error("Expected a JSON request body");
            const body = JSON.parse(init.body);
            writes.push(body);
            if (writes.length === 1) {
              if (code === "CONFLICT") {
                stored = { ...stored, revision: 2 };
                stored.document.responses["C-1"].reason = "別担当者の内容";
              }
              if (code === "ARCHIVED") archived = true;
              if (code === "NETWORK") throw new Error("NETWORK");
              return Response.json(
                { error: { code, message: code }, requestId: "regression" },
                { status: 409 },
              );
            }
            if (code === "IDEMPOTENCY_CONFLICT" && body.mutationId === writes[0].mutationId)
              return Response.json(
                { error: { code, message: code }, requestId: "regression" },
                { status: 409 },
              );
            stored = structuredClone(stored);
            if (mode === "scope") stored.document.scope = body.scope;
            else stored.document.responses["C-1"].reason = body.reason;
            stored.revision++;
            return ok(stored);
          }
          if (url.endsWith("/standards/standard")) return ok(standard);
          if (url.endsWith("/cases/case"))
            return ok({ ...caseRecord, archivedAt: archived ? "2026-09-19T00:00:00.000Z" : null });
          if (url.endsWith("/customers/customer")) return ok(customer);
          return ok(stored);
        }),
      );
      mount(mode);
      const field =
        mode === "scope"
          ? await screen.findByLabelText(/^対象会社/)
          : await screen.findByLabelText("判定理由・確認メモ");
      fireEvent.change(field, { target: { value: "自分の未保存文" } });
      const save = screen.getByRole("button", {
        name: mode === "scope" ? "対象範囲を保存" : "判定を保存",
      });
      fireEvent.click(save);
      await screen.findByText(code);
      if (code === "CONFLICT") {
        await waitFor(() =>
          expect(screen.getByRole("button", { name: "入力を保って再編集する" })).toBeEnabled(),
        );
        expect(save).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "入力を保って再編集する" }));
      } else if (code === "ARCHIVED") {
        await screen.findByText("この顧客または案件は保管済みです。診断内容は閲覧専用です。");
        expect(save).toBeDisabled();
        archived = false;
        fireEvent.click(screen.getByRole("button", { name: "最新の内容を再確認" }));
      }
      await waitFor(() => expect(save).toBeEnabled());
      expect(field).toHaveValue("自分の未保存文");
      fireEvent.click(save);
      await screen.findByText("保存しました。");
      expect(
        writes.map(({ expectedRevision, reason, scope }) => ({
          expectedRevision,
          value: mode === "scope" ? scope?.companies : reason,
        })),
      ).toEqual([
        { expectedRevision: 1, value: "自分の未保存文" },
        { expectedRevision: code === "CONFLICT" ? 2 : 1, value: "自分の未保存文" },
      ]);
      expect(writes[1].mutationId === writes[0].mutationId).toBe(
        code === "ARCHIVED" || code === "NETWORK",
      );
    },
  );
});
