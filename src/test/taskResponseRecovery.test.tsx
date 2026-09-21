import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { TaskForm, type TaskSelection } from "../front/components/TaskForm";
import { useWrite } from "../front/lib/api";
import { assessmentFixture } from "../front/components/assessments/assessmentFixtures";
import { applyTaskChange, taskSizeContext } from "../shared/taskChange";
import {
  MAX_DOCUMENT_BYTES,
  assessmentDocumentSchema,
  type Task,
} from "../shared/contracts/assessment";
import type { AssessmentDto, StandardDto } from "../shared/contracts/assessments";
import type { TaskCommand } from "../shared/contracts/improvement";
import { addTaskSchema, editTaskSchema, reviewTaskSchema } from "../shared/contracts/improvement";

const families = [
  "add",
  "add-100",
  "add-limit",
  "edit-submit",
  "edit-done-result",
  "edit-limit",
  "confirm",
  "reject",
  "confirm-limit",
] as const;
type Family = (typeof families)[number];
type FailedResponse = { name: string; response: () => Response; message: string };
const genericFailure = "通信を完了できませんでした。もう一度お試しください。";
const responseLosses: FailedResponse[] = [
  {
    name: "TypeError",
    response: () => {
      throw new TypeError("保存応答だけが切断されました。");
    },
    message: "保存応答だけが切断されました。",
  },
  {
    name: "HTML502",
    response: () =>
      new Response("<html>Bad Gateway</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }),
    message: genericFailure,
  },
];
const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
function makeScenario(kind: Family) {
  const { record, standard } = assessmentFixture();
  const evidenceId = "88888888-8888-4888-8888-888888888888";
  const task: Task = {
    id: "77777777-7777-4777-8777-777777777777",
    sourceTaskId: null,
    sourceAssessmentId: null,
    criterionId: "C-1",
    title: "task",
    ownerName: "owner",
    dueDate: "2026-09-20",
    priority: "normal",
    completionCondition: "match",
    result: "done",
    evidenceIds: [evidenceId],
    state:
      kind === "edit-done-result" ? "done" : kind.startsWith("edit") ? "doing" : "awaiting_review",
    review: { state: "unreviewed", note: "", by: null, at: null, subjectHash: null },
  };
  if (task.state === "done")
    task.review = {
      state: "confirmed",
      note: "ok",
      by: taskSizeContext.actorId,
      at: taskSizeContext.reviewedAt,
      subjectHash: taskSizeContext.subjectHash,
    };
  record.document.evidence.push({
    id: evidenceId,
    criterionIds: ["C-1"],
    name: "record",
    url: null,
    location: "",
    fileId: null,
    reviews: { "C-1": { state: "unreviewed", note: "", by: null, at: null, subjectHash: null } },
  });
  if (!kind.startsWith("add")) record.document.tasks.push(task);
  if (kind === "add-100")
    record.document.tasks = Array.from({ length: 99 }, (_, index) => ({
      ...task,
      id: `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`,
    }));
  const selection: TaskSelection = {
    item: kind.startsWith("add") ? null : task,
    review: kind.startsWith("confirm") || kind === "reject",
  };
  const input = {
    expectedRevision: record.revision,
    mutationId: taskSizeContext.newTaskId,
    title: "task",
    ownerName: "owner",
    dueDate: "2026-09-20",
    priority: "normal" as const,
    completionCondition: "match",
  };
  const command: TaskCommand = kind.startsWith("add")
    ? { kind: "add", input: { ...input, criterionId: "C-1" } }
    : selection.review
      ? {
          kind: "review",
          taskId: task.id,
          input: {
            expectedRevision: record.revision,
            mutationId: taskSizeContext.newTaskId,
            state: kind === "reject" ? "rejected" : "confirmed",
            note: "",
          },
        }
      : {
          kind: "edit",
          taskId: task.id,
          input: {
            ...input,
            state: kind === "edit-done-result" ? "done" : "awaiting_review",
            result: kind === "edit-done-result" ? "updated result" : "done",
            evidenceIds: [evidenceId],
          },
        };
  if (kind.endsWith("limit")) {
    let remaining =
      MAX_DOCUMENT_BYTES - size(applyTaskChange(record.document, command, taskSizeContext));
    for (const response of Object.values(record.document.responses))
      for (const field of ["basis", "reason"] as const) {
        const n = Math.min(8000 - response[field].length, remaining);
        response[field] += "x".repeat(n);
        remaining -= n;
      }
    expect(remaining).toBe(0);
    expect(size(applyTaskChange(record.document, command, taskSizeContext))).toBe(
      MAX_DOCUMENT_BYTES,
    );
  }
  expect(assessmentDocumentSchema.safeParse(record.document).success).toBe(true);
  return {
    kind,
    record,
    standard,
    selection,
    command,
    buttonName: selection.review ? "完了確認を保存" : "課題を保存",
  };
}
function RecoveryForm({
  initial,
  standard,
  selection,
  read,
}: {
  initial: AssessmentDto;
  standard: StandardDto;
  selection: TaskSelection;
  read: () => Promise<{ record: AssessmentDto; readOnly: boolean }>;
}) {
  const [record, setRecord] = useState(initial),
    [readOnly, setReadOnly] = useState(false),
    [message, setMessage] = useState("");
  const write = useWrite();
  return (
    <>
      <p aria-label="取得した診断版">{record.revision}</p>
      {message && <p role="status">{message}</p>}
      <TaskForm
        record={record}
        standard={standard}
        selection={selection}
        readOnly={readOnly}
        write={write}
        onSaved={(result, text) => {
          setRecord(result.data);
          setMessage(text);
        }}
        onRefresh={async () => {
          const latest = await read();
          setRecord(latest.record);
          setReadOnly(latest.readOnly);
        }}
        onCancel={() => {}}
      />
    </>
  );
}
async function loseResponse(
  scenario: ReturnType<typeof makeScenario>,
  failure: FailedResponse,
  options: {
    readOnly?: boolean;
    replayDenied?: boolean;
    replayRejection?: { status: number; code: string };
  } = {},
) {
  let stored = scenario.record;
  const writes: { path: string; method: string; key: string; body: Record<string, unknown> }[] = [];
  const receipt = { request: "", response: stored };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      if (!init?.method || init.method === "GET")
        return Response.json({ record: stored, readOnly: options.readOnly ?? false });
      if (typeof init.body !== "string") throw new Error("Expected JSON request");
      const body = JSON.parse(init.body);
      const write = {
        path,
        method: init.method,
        key: new Headers(init.headers).get("Idempotency-Key")!,
        body,
      };
      writes.push(write);
      if (writes.length === 1) {
        const original = scenario.command;
        const command: TaskCommand =
          original.kind === "add"
            ? { kind: "add", input: addTaskSchema.parse(body) }
            : original.kind === "edit"
              ? { kind: "edit", taskId: original.taskId, input: editTaskSchema.parse(body) }
              : { kind: "review", taskId: original.taskId, input: reviewTaskSchema.parse(body) };
        stored = {
          ...stored,
          revision: stored.revision + 1,
          document: applyTaskChange(stored.document, command, taskSizeContext),
        };
        receipt.request = JSON.stringify(write);
        receipt.response = stored;
        return failure.response();
      }
      if (options.replayDenied)
        return Response.json(
          { error: { code: "FORBIDDEN", message: "利用権限がありません。" }, requestId: "denied" },
          { status: 403 },
        );
      if (options.replayRejection)
        return Response.json(
          {
            error: { code: options.replayRejection.code, message: "確定した業務拒否です。" },
            requestId: "application-refusal",
          },
          { status: options.replayRejection.status },
        );
      if (JSON.stringify(write) === receipt.request)
        return Response.json({ data: receipt.response, requestId: "replayed" });
      return Response.json(
        {
          error: {
            code: "CONFLICT",
            message: "他の担当者が更新しました。再読み込みして内容を確認してください。",
          },
          requestId: "conflict",
        },
        { status: 409 },
      );
    }),
  );
  render(
    <SWRConfig
      value={{
        provider: () =>
          new Map([
            ["cognito-session", { data: { accessToken: "test", email: "test@example.invalid" } }],
          ]),
        revalidateIfStale: false,
        revalidateOnFocus: false,
      }}
    >
      <RecoveryForm
        initial={scenario.record}
        standard={scenario.standard}
        selection={scenario.selection}
        read={async () => (await fetch("/api/v1/assessments/assessment")).json()}
      />
    </SWRConfig>,
  );
  if (scenario.command.kind === "add")
    for (const [label, value] of [
      ["課題名", "task"],
      ["関連する評価基準", "C-1"],
      ["担当者名", "owner"],
      ["期日（日本時間）", "2026-09-20"],
      ["完了条件", "match"],
    ])
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
  if (scenario.command.kind === "edit") {
    fireEvent.change(screen.getByLabelText("進捗"), {
      target: { value: scenario.command.input.state },
    });
    fireEvent.change(screen.getByLabelText("結果"), {
      target: { value: scenario.command.input.result },
    });
  }
  if (scenario.kind === "reject")
    fireEvent.change(screen.getByLabelText("確認結果"), { target: { value: "rejected" } });
  expect(screen.getByRole("button", { name: scenario.buttonName })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: scenario.buttonName }));
  await waitFor(() => expect(screen.getByLabelText("取得した診断版")).toHaveTextContent("2"));
  expect(screen.getByText(failure.message)).toBeInTheDocument();
  expect(stored.document).toEqual(
    applyTaskChange(scenario.record.document, scenario.command, taskSizeContext),
  );
  expect(assessmentDocumentSchema.safeParse(stored.document).success).toBe(true);
  expect(writes).toEqual([
    {
      path: `/api/v1/assessments/assessment/tasks${scenario.command.kind === "add" ? "" : `/${scenario.command.taskId}`}${scenario.command.kind === "review" ? "/review" : ""}`,
      method: scenario.command.kind === "edit" ? "PATCH" : "POST",
      key: expect.any(String),
      body: { ...scenario.command.input, mutationId: expect.any(String) },
    },
  ]);
  expect(writes[0].key).toBe(writes[0].body.mutationId);
  return { writes };
}
describe.each(responseLosses)("task response recovery after $name", (failure) => {
  it.each(families)(
    "replays exactly the same body and mutation after committed %s response loss and successful GET",
    async (kind) => {
      const scenario = makeScenario(kind),
        f = await loseResponse(scenario, failure);
      expect(screen.getByRole("button", { name: scenario.buttonName })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: scenario.buttonName }));
      expect((await screen.findByRole("status")).textContent).toBe(
        scenario.selection.review ? "完了確認を保存しました。" : "課題を保存しました。",
      );
      expect(f.writes).toEqual([f.writes[0], f.writes[0]]);
      expect(screen.getByLabelText("取得した診断版")).toHaveTextContent("2");
    },
  );
  it.each(families)(
    "validates edited %s input as a new request and restores exact-body retry if the edit is reverted",
    async (kind) => {
      const scenario = makeScenario(kind),
        f = await loseResponse(scenario, failure);
      const label = scenario.selection.review
        ? "確認メモ"
        : kind.startsWith("edit")
          ? "結果"
          : "課題名";
      const original =
        scenario.command.kind === "review"
          ? scenario.command.input.note
          : scenario.command.kind === "edit"
            ? scenario.command.input.result
            : scenario.command.input.title;
      const edited = kind === "edit-limit" ? "x".repeat(200) : "changed";
      fireEvent.change(screen.getByLabelText(label), { target: { value: edited } });
      const invalidOnLatest = [
        "add-100",
        "add-limit",
        "edit-done-result",
        "edit-limit",
        "confirm",
        "reject",
        "confirm-limit",
      ].includes(kind);
      expect(
        screen.getByRole("button", { name: scenario.buttonName }).hasAttribute("disabled"),
      ).toBe(invalidOnLatest);
      if (kind === "add-limit" || kind === "edit-limit")
        expect(
          screen.getByText("診断全体が1MiBを超えています。記述を短くしてから保存してください。"),
        ).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText(label), { target: { value: original } });
      expect(screen.getByRole("button", { name: scenario.buttonName })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: scenario.buttonName }));
      await screen.findByRole("status");
      expect(f.writes).toEqual([f.writes[0], f.writes[0]]);
    },
  );
  it.each(["add", "edit-submit"] as const)(
    "sends edited %s with a different operation key and preserves the revision conflict",
    async (kind) => {
      const scenario = makeScenario(kind),
        f = await loseResponse(scenario, failure);
      const label = kind === "add" ? "課題名" : "結果";
      fireEvent.change(screen.getByLabelText(label), { target: { value: "別の入力" } });
      expect(screen.getByRole("button", { name: scenario.buttonName })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: scenario.buttonName }));
      await screen.findByText("他の担当者が更新しました。再読み込みして内容を確認してください。");
      expect(screen.getByRole("button", { name: scenario.buttonName })).toBeDisabled();
      expect(f.writes[1]).toEqual({
        ...f.writes[0],
        key: expect.any(String),
        body: {
          ...f.writes[0].body,
          [kind === "add" ? "title" : "result"]: "別の入力",
          mutationId: expect.any(String),
        },
      });
      expect(f.writes[0].key === f.writes[1].key).toBe(false);
    },
  );
  it.each(["add-100", "edit-done-result", "confirm", "reject"] as const)(
    "keeps %s retry disabled when the refreshed case is read only",
    async (kind) => {
      const scenario = makeScenario(kind),
        f = await loseResponse(scenario, failure, { readOnly: true });
      expect(screen.getByRole("button", { name: scenario.buttonName })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: scenario.buttonName }));
      expect(f.writes).toHaveLength(1);
    },
  );
  it("keeps server authorization authoritative on a confirmation replay", async () => {
    const scenario = makeScenario("confirm"),
      f = await loseResponse(scenario, failure, { replayDenied: true });
    expect(screen.getByRole("button", { name: scenario.buttonName })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: scenario.buttonName }));
    await screen.findByText("利用権限がありません。");
    expect(screen.getByRole("button", { name: scenario.buttonName })).toBeDisabled();
    expect(f.writes).toEqual([f.writes[0], f.writes[0]]);
  });
  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [409, "CONFLICT"],
    [409, "IDEMPOTENCY_CONFLICT"],
    [413, "PAYLOAD_TOO_LARGE"],
    [422, "VALIDATION_ERROR"],
    [429, "RATE_LIMIT"],
  ] as const)(
    "does not bypass current validation after a confirmed %s %s rejection",
    async (status, code) => {
      const scenario = makeScenario("confirm");
      const f = await loseResponse(scenario, failure, { replayRejection: { status, code } });
      expect(screen.getByRole("button", { name: scenario.buttonName })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: scenario.buttonName }));
      await screen.findByText("確定した業務拒否です。");
      expect(screen.getByRole("button", { name: scenario.buttonName })).toBeDisabled();
      expect(f.writes).toEqual([f.writes[0], f.writes[0]]);
      expect(screen.getByLabelText("取得した診断版")).toHaveTextContent("2");
    },
  );
});
