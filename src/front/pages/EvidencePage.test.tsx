import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SWRConfig } from "swr";
import { createMemoryRouter, RouterProvider } from "react-router";
import { EvidencePage } from "./EvidencePage";
import { assessmentFixture } from "../components/assessments/assessmentFixtures";

const evidenceId = "77777777-7777-4777-8777-777777777777";
function mount() {
  const router = createMemoryRouter(
    [{ path: "/assessments/:assessmentId/evidence", element: <EvidencePage /> }],
    { initialEntries: ["/assessments/assessment/evidence"] },
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
    </SWRConfig>,
  );
}
function network(options: { failure?: string; existing?: boolean; loading?: Promise<void> } = {}) {
  const { record, standard } = assessmentFixture();
  if (options.existing)
    record.document.evidence.push({
      id: evidenceId,
      name: "匿名文書",
      url: "https://example.invalid/document",
      location: "2章",
      fileId: null,
      criterionIds: ["C-1"],
      reviews: { "C-1": { state: "unreviewed", note: "", by: null, at: null, subjectHash: null } },
    });
  const writes: { method: string; body: any }[] = [];
  let archived = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method && init.method !== "GET") {
        if (typeof init.body !== "string") throw new Error("Expected JSON body");
        const body = JSON.parse(init.body);
        writes.push({ method: init.method, body });
        if (writes.length === 1 && options.failure) {
          if (options.failure === "NETWORK") throw new Error("通信が切断されました。");
          if (options.failure === "CONFLICT") {
            record.revision++;
            if (record.document.evidence[0]) record.document.evidence[0].name = "別担当者の保存文";
          }
          if (options.failure === "ARCHIVED") archived = true;
          return Response.json(
            { error: { code: options.failure, message: options.failure } },
            { status: 409 },
          );
        }
        record.revision++;
        return Response.json({ data: structuredClone(record), requestId: "test" });
      }
      await options.loading;
      if (url.endsWith("/standards/standard")) return Response.json({ data: standard });
      if (url.endsWith("/cases/case"))
        return Response.json({
          data: { id: "case", name: "案件", archivedAt: archived ? "2026-09-19" : null },
        });
      if (url.endsWith("/customers/customer"))
        return Response.json({ data: { id: "customer", name: "匿名社", archivedAt: null } });
      return Response.json({ data: structuredClone(record) });
    }),
  );
  return { record, writes };
}
describe("evidence page", () => {
  it("cancels an attachment download when leaving the page before metadata finishes", async () => {
    const f = network({ existing: true });
    f.record.document.evidence[0].fileId = "file-id";
    const otherRequests = globalThis.fetch;
    const files: string[] = [];
    let signal!: AbortSignal;
    let reached!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (!url.startsWith("/api/v1/files/")) return otherRequests(url, init);
      files.push(url);
      signal = init!.signal!;
      reached();
      await waiting;
      return Response.json({ data: { name: "anonymous.txt" } });
    });
    const view = mount();
    fireEvent.click(await screen.findByRole("button", { name: "匿名文書の添付をダウンロード" }));
    await started;
    view.unmount();
    await act(async () => {
      release();
    });
    expect({ files, aborted: signal.aborted }).toEqual({
      files: ["/api/v1/files/file-id"],
      aborted: true,
    });
  });
  it("retries a failed initial load and renders the document after recovery", async () => {
    const { record, standard } = assessmentFixture();
    let failed = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (failed) throw new Error("読込が切断されました。");
        return Response.json({
          data: url.includes("/standards/")
            ? standard
            : url.includes("/assessments/")
              ? record
              : { id: "fixture", name: "匿名", archivedAt: null },
        });
      }),
    );
    mount();
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("読込が切断されました。");
    failed = false;
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(await screen.findByRole("heading", { name: "証跡管理" })).toBeInTheDocument();
    expect(screen.getByText("証跡はまだ関連付けられていません。")).toBeInTheDocument();
  });
  it("prevents an otherwise valid evidence edit that exceeds the assessment byte limit", async () => {
    const f = network({ existing: true });
    for (const response of Object.values(f.record.document.responses))
      response.basis = "あ".repeat(4300);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "匿名文書を編集" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "診断全体が1MiBを超えています。記述を短くしてから保存してください。",
    );
    expect(screen.getByRole("button", { name: "証跡を保存" })).toBeDisabled();
  });
  it("shows loading, permits a name-only document and blocks invalid URL, missing criterion and duplicate save", async () => {
    let release!: () => void;
    const f = network({
      loading: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    mount();
    expect(screen.getByRole("status")).toHaveTextContent("読み込んでいます…");
    release();
    fireEvent.click(await screen.findByRole("button", { name: "証跡を追加" }));
    const save = screen.getByRole("button", { name: "証跡を保存" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("文書名"), { target: { value: "文書名だけの登録" } });
    fireEvent.click(screen.getByLabelText("C-1"));
    fireEvent.change(screen.getByLabelText("参照URL（任意）"), {
      target: { value: "javascript:alert(1)" },
    });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("参照URL（任意）"), { target: { value: "" } });
    fireEvent.click(save);
    fireEvent.click(save);
    await screen.findByText("証跡を保存しました。");
    expect(f.writes).toEqual([
      {
        method: "POST",
        body: {
          expectedRevision: 1,
          mutationId: expect.any(String),
          name: "文書名だけの登録",
          url: null,
          location: "",
          fileId: null,
          criterionIds: ["C-1"],
        },
      },
    ]);
  });
  it.each(["NETWORK", "CONFLICT", "IDEMPOTENCY_CONFLICT"])(
    "preserves draft on %s and retries using the correct revision and mutation ID",
    async (failure) => {
      const f = network({ failure, existing: true });
      mount();
      fireEvent.click(await screen.findByRole("button", { name: "匿名文書を編集" }));
      fireEvent.change(screen.getByLabelText("文書名"), { target: { value: "自分の未保存文" } });
      fireEvent.click(screen.getByRole("button", { name: "証跡を保存" }));
      await screen.findByRole("alert");
      expect(screen.getByLabelText("文書名")).toHaveValue("自分の未保存文");
      if (failure === "CONFLICT") {
        await screen.findByRole("cell", { name: "別担当者の保存文" });
        expect(screen.getByRole("button", { name: "証跡を保存" })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "入力を保って再編集する" }));
      }
      fireEvent.click(screen.getByRole("button", { name: "証跡を保存" }));
      await screen.findByText("証跡を保存しました。");
      expect(
        f.writes.map((w) => ({
          method: w.method,
          name: w.body.name,
          revision: w.body.expectedRevision,
        })),
      ).toEqual([
        { method: "PATCH", name: "自分の未保存文", revision: 1 },
        { method: "PATCH", name: "自分の未保存文", revision: failure === "CONFLICT" ? 2 : 1 },
      ]);
      expect(f.writes[0].body.mutationId === f.writes[1].body.mutationId).toBe(
        failure === "NETWORK",
      );
    },
  );
  it("requires a review note, sends server-owned metadata only from server and deletes with a mutation ID", async () => {
    const f = network({ existing: true });
    mount();
    const link = await screen.findByRole("link", { name: "参照先を開く" });
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    fireEvent.click(screen.getByRole("button", { name: "匿名文書 C-1 の確認を記録" }));
    fireEvent.change(screen.getByLabelText("確認結果"), { target: { value: "confirmed" } });
    const save = screen.getByRole("button", { name: "確認を保存" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("確認メモ"), { target: { value: "原本と照合した" } });
    fireEvent.click(save);
    await screen.findByText("確認を保存しました。");
    expect(f.writes[0]).toEqual({
      method: "POST",
      body: {
        expectedRevision: 1,
        mutationId: expect.any(String),
        state: "confirmed",
        note: "原本と照合した",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "匿名文書を編集" }));
    fireEvent.click(screen.getByRole("button", { name: "証跡の関連をすべて解除" }));
    await screen.findByText("証跡の関連を解除しました。");
    expect(f.writes[1]).toEqual({
      method: "DELETE",
      body: { expectedRevision: 2, mutationId: expect.any(String) },
    });
  });
  it("keeps the draft but disables editing after the server reports an archived case", async () => {
    network({ existing: true, failure: "ARCHIVED" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "匿名文書を編集" }));
    fireEvent.change(screen.getByLabelText("文書名"), { target: { value: "未保存の文書名" } });
    fireEvent.click(screen.getByRole("button", { name: "証跡を保存" }));
    await screen.findByText("ARCHIVED");
    await waitFor(() => expect(screen.getByRole("button", { name: "証跡を保存" })).toBeDisabled());
    expect(screen.getByLabelText("文書名")).toHaveValue("未保存の文書名");
  });
});
