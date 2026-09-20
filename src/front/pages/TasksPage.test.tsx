import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { createMemoryRouter, RouterProvider } from "react-router";
import { TasksPage } from "./TasksPage";
import { assessmentFixture } from "../components/assessments/assessmentFixtures";
import type { Task } from "../../shared/contracts/assessment";

const taskId = "77777777-7777-4777-8777-777777777777";
const task: Task = {
  id: taskId,
  sourceTaskId: null,
  sourceAssessmentId: null,
  criterionId: "C-1",
  title: "規程整備",
  ownerName: "匿名担当",
  dueDate: "2026-09-20",
  priority: "normal",
  completionCondition: "実施記録を照合",
  state: "todo",
  result: "",
  evidenceIds: [],
  review: { state: "unreviewed", note: "", by: null, at: null, subjectHash: null },
};
function mount() {
  const router = createMemoryRouter(
    [
      {
        path: "/assessments/:assessmentId/tasks",
        element: <TasksPage now={() => "2026-09-20T15:00:00.000Z"} />,
      },
    ],
    { initialEntries: ["/assessments/assessment/tasks"] },
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
function network(
  options: {
    failure?: string;
    existing?: boolean;
    loading?: Promise<void>;
    saving?: Promise<void>;
  } = {},
) {
  const { record, standard } = assessmentFixture();
  if (options.existing) record.document.tasks.push(structuredClone(task));
  const writes: { method: string; body: any }[] = [];
  let archived = false,
    initialFailure = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method && init.method !== "GET") {
        if (typeof init.body !== "string") throw new Error("Expected JSON body");
        const body = JSON.parse(init.body);
        writes.push({ method: init.method, body });
        await options.saving;
        if (writes.length === 1 && options.failure) {
          if (options.failure === "NETWORK") throw new Error("通信が切断されました。");
          if (options.failure === "CONFLICT") {
            record.revision++;
            record.document.tasks[0].ownerName = "別担当者の保存文";
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
      if (initialFailure) throw new Error("読込が切断されました。");
      if (url.endsWith("/standards/standard")) return Response.json({ data: standard });
      if (url.endsWith("/cases/case"))
        return Response.json({
          data: { id: "case", name: "案件", archivedAt: archived ? "2026-09-20" : null },
        });
      if (url.endsWith("/customers/customer"))
        return Response.json({ data: { id: "customer", name: "匿名社", archivedAt: null } });
      return Response.json({ data: structuredClone(record) });
    }),
  );
  return {
    record,
    writes,
    setInitialFailure: (value: boolean) => {
      initialFailure = value;
    },
  };
}
function enterNew() {
  fireEvent.change(screen.getByLabelText("課題名"), { target: { value: task.title } });
  fireEvent.change(screen.getByLabelText("関連する評価基準"), {
    target: { value: task.criterionId },
  });
  fireEvent.change(screen.getByLabelText("担当者名"), { target: { value: task.ownerName } });
  fireEvent.change(screen.getByLabelText("期日（日本時間）"), { target: { value: task.dueDate } });
  fireEvent.change(screen.getByLabelText("完了条件"), {
    target: { value: task.completionCondition },
  });
}
describe("tasks page", () => {
  it("shows loading and empty state, blocks duplicate saves and submits only the task fields", async () => {
    let release!: () => void, saved!: () => void;
    const f = network({
      loading: new Promise<void>((resolve) => {
        release = resolve;
      }),
      saving: new Promise<void>((resolve) => {
        saved = resolve;
      }),
    });
    mount();
    expect(screen.getByRole("status").textContent).toBe("読み込んでいます…");
    release();
    await screen.findByText("改善課題はまだ登録されていません。");
    fireEvent.click(screen.getByRole("button", { name: "課題を追加" }));
    enterNew();
    fireEvent.click(screen.getByRole("button", { name: "課題を保存" }));
    const pending = screen.getByRole("button", { name: "保存しています…" });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(screen.getByLabelText("担当者名")).toBeDisabled();
    saved();
    await screen.findByText("課題を保存しました。");
    expect(f.writes).toEqual([
      {
        method: "POST",
        body: {
          expectedRevision: 1,
          mutationId: expect.any(String),
          criterionId: task.criterionId,
          title: task.title,
          ownerName: task.ownerName,
          dueDate: task.dueDate,
          priority: "normal",
          completionCondition: task.completionCondition,
        },
      },
    ]);
  });
  it("recovers an initial read failure through retry", async () => {
    const f = network();
    f.setInitialFailure(true);
    mount();
    expect((await screen.findByRole("alert")).textContent).toBe("読込が切断されました。");
    f.setInitialFailure(false);
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(await screen.findByRole("heading", { name: "改善課題" })).toBeInTheDocument();
    expect(screen.getByText("改善課題はまだ登録されていません。")).toBeInTheDocument();
  });
  it.each(["NETWORK", "CONFLICT", "IDEMPOTENCY_CONFLICT"])(
    "preserves task draft after %s and retries with correct mutation and revision",
    async (failure) => {
      const f = network({ existing: true, failure });
      mount();
      fireEvent.click(await screen.findByRole("button", { name: "規程整備を編集" }));
      expect(screen.getByText("期限超過")).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("担当者名"), { target: { value: "自分の入力" } });
      fireEvent.click(screen.getByRole("button", { name: "課題を保存" }));
      await screen.findByRole("alert");
      expect(screen.getByLabelText("担当者名")).toHaveValue("自分の入力");
      if (failure === "CONFLICT") {
        await screen.findByRole("cell", { name: "別担当者の保存文" });
        expect(screen.getByRole("button", { name: "課題を保存" })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "入力を保って再編集する" }));
      }
      fireEvent.click(screen.getByRole("button", { name: "課題を保存" }));
      await screen.findByText("課題を保存しました。");
      expect(
        f.writes.map((w) => ({
          method: w.method,
          owner: w.body.ownerName,
          revision: w.body.expectedRevision,
        })),
      ).toEqual([
        { method: "PATCH", owner: "自分の入力", revision: 1 },
        { method: "PATCH", owner: "自分の入力", revision: failure === "CONFLICT" ? 2 : 1 },
      ]);
      expect(f.writes[0].body.mutationId === f.writes[1].body.mutationId).toBe(
        failure === "NETWORK",
      );
    },
  );
  it("requires result and related evidence for completion report and never offers direct done", async () => {
    const f = network({ existing: true });
    f.record.document.evidence.push({
      id: "88888888-8888-4888-8888-888888888888",
      criterionIds: ["C-1"],
      name: "実施記録",
      url: null,
      location: "2章",
      fileId: null,
      reviews: { "C-1": task.review },
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "規程整備を編集" }));
    expect(
      Array.from(screen.getByLabelText("進捗").querySelectorAll("option")).map(
        (item) => item.value,
      ),
    ).toEqual(["todo", "doing", "awaiting_review"]);
    fireEvent.change(screen.getByLabelText("進捗"), { target: { value: "awaiting_review" } });
    expect(screen.getByRole("button", { name: "課題を保存" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("結果"), { target: { value: "確認記録あり" } });
    expect(screen.getByRole("button", { name: "課題を保存" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("実施記録"));
    fireEvent.click(screen.getByRole("button", { name: "課題を保存" }));
    await screen.findByText("課題を保存しました。");
    expect(f.writes).toEqual([
      {
        method: "PATCH",
        body: {
          expectedRevision: 1,
          mutationId: expect.any(String),
          title: task.title,
          ownerName: task.ownerName,
          dueDate: task.dueDate,
          priority: task.priority,
          completionCondition: task.completionCondition,
          state: "awaiting_review",
          result: "確認記録あり",
          evidenceIds: ["88888888-8888-4888-8888-888888888888"],
        },
      },
    ]);
  });
  it("retains inputs but disables writing when case becomes archived", async () => {
    network({ existing: true, failure: "ARCHIVED" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "規程整備を編集" }));
    fireEvent.change(screen.getByLabelText("担当者名"), { target: { value: "未保存の担当" } });
    fireEvent.click(screen.getByRole("button", { name: "課題を保存" }));
    await screen.findByText("ARCHIVED");
    await waitFor(() => expect(screen.getByRole("button", { name: "課題を保存" })).toBeDisabled());
    expect(screen.getByLabelText("担当者名")).toHaveValue("未保存の担当");
  });
});
