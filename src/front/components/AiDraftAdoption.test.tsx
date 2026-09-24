import { useState } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { Advice } from "../../shared/contracts/assessment";
import type { AssessmentDto } from "../../shared/contracts/assessments";
import type { ApiSuccess } from "../../shared/contracts/api";
import { AiDraftForm } from "./AiDraftDialog";
import { AdviceEditor } from "./AdviceEditor";
import { useWrite } from "../lib/api";
import { assessmentFixture } from "./assessments/assessmentFixtures";

// jsdom has no native modal implementation; browser behavior is covered by the E2E flow.
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
beforeAll(() =>
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  }),
);
afterAll(() => {
  if (originalShowModal)
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});

const draft: Advice = {
  origin: "ai",
  templateId: null,
  gap: "不足",
  steps: ["確認"],
  evidenceExamples: ["記録"],
  completionCheck: "照合",
  notes: "",
};
const failures = [
  {
    name: "connection loss",
    respond: () => {
      throw new TypeError("通信が切れました。");
    },
  },
  { name: "invalid success JSON", respond: () => new Response("{") },
  { name: "gateway failure", respond: () => new Response("中継エラー", { status: 502 }) },
  {
    name: "incomplete error",
    respond: () => Response.json({ requestId: "proxy" }, { status: 422 }),
  },
] as const;
type Refresh = "unchanged" | "revision" | "basis";

async function startAdoption(
  mode: Refresh,
  failure: (typeof failures)[number],
  refusal?: { status: number; code: string },
  readOnly = false,
  editor = false,
) {
  const { record } = assessmentFixture();
  if (mode === "unchanged") record.document.responses["C-1"].adviceDraft = draft;
  const receipt = structuredClone(record);
  receipt.document.responses["C-1"].adviceDraft = draft;
  receipt.revision = mode === "unchanged" ? record.revision : record.revision + 1;
  const latest = structuredClone(receipt);
  if (mode === "basis") {
    latest.revision++;
    latest.document.responses["C-1"].basisHash = "b".repeat(64);
    if (editor)
      latest.document.responses["C-1"].adviceDraft = {
        ...draft,
        origin: "manual",
        gap: "更新後の手入力",
      };
  }
  const run = {
    runId: "10000000-0000-4000-8000-000000000001",
    criterionId: "C-1",
    status: "succeeded",
    draft,
    inputHash: "a".repeat(64),
    basisHash: record.document.responses["C-1"].basisHash,
    errorCode: null,
  };
  const writes: { path: string; method: string; body: unknown; key: string | null }[] = [];
  const onAdopted = vi.fn<(result: ApiSuccess<AssessmentDto>) => void>();
  const onClose = vi.fn();
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    if (path.endsWith("/ai-runs")) return Response.json({ data: run, requestId: "generated" });
    if (path.endsWith("/adopt-ai")) {
      if (typeof init?.body !== "string") throw new Error("Expected a JSON adoption request");
      writes.push({
        path,
        method: init!.method!,
        body: JSON.parse(init.body),
        key: new Headers(init?.headers).get("Idempotency-Key"),
      });
      if (writes.length === 1) return failure.respond();
      if (refusal)
        return Response.json(
          { error: { code: refusal.code, message: "採用を拒否しました。" }, requestId: "refused" },
          { status: refusal.status },
        );
      if (JSON.stringify(writes[1]) !== JSON.stringify(writes[0]))
        return Response.json(
          { error: { code: "CONFLICT", message: "別の操作です。" }, requestId: "different" },
          { status: 409 },
        );
      return Response.json({ data: receipt, requestId: "replayed" });
    }
    if (path === "/api/v1/assessments/assessment")
      return Response.json({ data: latest, requestId: "latest" });
    throw new Error(`Unexpected URL: ${path}`);
  });
  function Harness() {
    const [current, setCurrent] = useState(record);
    const [refreshed, setRefreshed] = useState(false);
    const write = useWrite();
    const refresh = async () => {
      const result = await write.read<AssessmentDto>("/api/v1/assessments/assessment");
      setCurrent(result.data);
      setRefreshed(true);
    };
    if (editor)
      return (
        <>
          <span data-testid="refreshed">{String(refreshed)}</span>
          <AdviceEditor
            record={current}
            criterionId="C-1"
            readOnly={false}
            write={write}
            template={{
              id: "template",
              standardId: record.standardId,
              criterionId: "C-1",
              version: 1,
              contentSha256: "a".repeat(64),
              sourceUrls: [],
              officialRequirement: "公開要件",
              kind: "companyProposal",
              content: { ...draft, origin: "template", templateId: "template" },
            }}
            onSaved={(result) => {
              onAdopted(result);
              setCurrent(result.data);
            }}
            onRefresh={refresh}
          />
        </>
      );
    return (
      <>
        <span data-testid="refreshed">{String(refreshed)}</span>
        <AiDraftForm
          record={current}
          criterionId="C-1"
          officialRequirement="公開要件"
          readOnly={readOnly && refreshed}
          write={write}
          read={write.read}
          onClose={onClose}
          onAdopted={onAdopted}
          onRefresh={refresh}
        />
      </>
    );
  }
  render(
    <SWRConfig
      value={{
        provider: () =>
          new Map([
            [
              "cognito-session",
              { data: { accessToken: "anonymous-test", email: "test@example.invalid" } },
            ],
          ]),
        revalidateIfStale: false,
        revalidateOnFocus: false,
      }}
    >
      <Harness />
    </SWRConfig>,
  );
  if (editor) fireEvent.click(screen.getByRole("button", { name: "AI 下書きを作成" }));
  fireEvent.change(screen.getByLabelText("匿名化した状況"), { target: { value: "状況" } });
  fireEvent.change(screen.getByLabelText("匿名化した不足点"), { target: { value: "不足" } });
  fireEvent.click(screen.getByLabelText("送信全文を確認し、匿名化しました"));
  fireEvent.click(screen.getByRole("button", { name: "確認した内容で生成" }));
  const adopt = await screen.findByRole("button", { name: "AI案を下書きへ採用" });
  fireEvent.click(adopt);
  await waitFor(() => expect(screen.getByTestId("refreshed")).toHaveTextContent("true"));
  return { writes, receipt, latest, onAdopted, onClose, adopt };
}

describe("AI adoption response recovery", () => {
  for (const mode of ["unchanged", "revision", "basis"] as const)
    it.each(failures)(
      `retains the original request after $name and ${mode} refresh`,
      async (failure) => {
        const f = await startAdoption(mode, failure);
        expect(f.writes).toEqual([
          {
            path: "/api/v1/assessments/assessment/advice/C-1/adopt-ai",
            method: "POST",
            body: {
              expectedRevision: 1,
              runId: "10000000-0000-4000-8000-000000000001",
              mutationId: expect.any(String),
            },
            key: expect.any(String),
          },
        ]);
        const body = f.writes[0].body as { mutationId: string };
        expect(f.writes[0].key).toBe(body.mutationId);
        expect(f.adopt).toBeDisabled();
        expect(screen.getByRole("button", { name: "新しい試行を準備" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "閉じて手入力を続ける" })).toBeDisabled();
        expect(screen.getByLabelText("匿名化した状況")).toHaveValue("状況");
        fireEvent.click(screen.getByRole("button", { name: "同じ採用の結果を確認" }));
        await waitFor(() =>
          expect(f.onAdopted).toHaveBeenCalledExactlyOnceWith({
            data: f.receipt,
            requestId: "replayed",
          }),
        );
        expect(f.writes).toEqual([f.writes[0], f.writes[0]]);
        expect(f.onClose).toHaveBeenCalledTimes(1);
      },
    );

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [409, "CONFLICT"],
    [409, "IDEMPOTENCY_CONFLICT"],
    [422, "VALIDATION_ERROR"],
  ] as const)("ends result recovery after a confirmed %s %s refusal", async (status, code) => {
    const f = await startAdoption(
      [401, 403, 404].includes(status) ? "revision" : "basis",
      failures[0],
      { status, code },
    );
    fireEvent.click(screen.getByRole("button", { name: "同じ採用の結果を確認" }));
    await screen.findByText("採用を拒否しました。");
    expect(f.writes).toEqual([f.writes[0], f.writes[0]]);
    expect(f.onAdopted).toHaveBeenCalledTimes(0);
    expect(screen.queryByRole("button", { name: "同じ採用の結果を確認" })).toBeNull();
    expect(f.adopt).toBeDisabled();
    expect(screen.getByRole("button", { name: "閉じて手入力を続ける" })).toBeEnabled();
  });

  it("keeps recovery blocked when the current page becomes read-only", async () => {
    const f = await startAdoption("basis", failures[0], undefined, true);
    expect(screen.getByRole("button", { name: "同じ採用の結果を確認" })).toBeDisabled();
    expect(f.writes).toHaveLength(1);
    expect(f.onAdopted).toHaveBeenCalledTimes(0);
  });

  it("preserves the latest diagnosis in the editor when replay returns an earlier adoption receipt", async () => {
    const f = await startAdoption("basis", failures[0], undefined, false, true);
    fireEvent.click(screen.getByRole("button", { name: "同じ採用の結果を確認" }));
    await waitFor(() =>
      expect(f.onAdopted).toHaveBeenCalledExactlyOnceWith({
        data: f.latest,
        requestId: "replayed",
      }),
    );
    expect(screen.getByLabelText("不足点")).toHaveValue("更新後の手入力");
    expect(screen.getByRole("button", { name: "助言を確定" })).toBeDisabled();
  });
});
