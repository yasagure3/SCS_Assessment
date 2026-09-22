import { expect, it } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { TaskForm } from "../front/components/TaskForm";
import { assessmentFixture } from "../front/components/assessments/assessmentFixtures";
import { MAX_DOCUMENT_BYTES, assessmentDocumentSchema } from "../shared/contracts/assessment";
import { changeTask } from "../server/modules/assessment/domain/tasks";
import {
  finalizeChange,
  emptyDocument,
  basisHash,
} from "../server/modules/assessment/domain/assessment";
import { applyTaskChange, taskSizeContext } from "../shared/taskChange";

const actorId = "11111111-1111-4111-8111-111111111111";
const taskId = "77777777-7777-4777-8777-777777777777";
const evidenceId = "88888888-8888-4888-8888-888888888888";
const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
it.each([MAX_DOCUMENT_BYTES, MAX_DOCUMENT_BYTES + 1])(
  "task confirmation projects the exact server size at %s bytes",
  async (target) => {
    const { record, standard } = assessmentFixture();
    record.document = await emptyDocument(standard.criteria.map((c) => c.id));
    const review = {
      state: "unreviewed" as const,
      note: "",
      by: null,
      at: null,
      subjectHash: null,
    };
    record.document.evidence.push({
      id: evidenceId,
      name: "doc",
      criterionIds: ["C-1"],
      location: "",
      url: null,
      fileId: null,
      reviews: { "C-1": review },
    });
    record.document.tasks.push({
      id: taskId,
      sourceTaskId: null,
      sourceAssessmentId: null,
      criterionId: "C-1",
      title: "task",
      ownerName: "owner",
      dueDate: "2026-09-20",
      priority: "normal",
      state: "awaiting_review",
      completionCondition: "match",
      result: "done",
      evidenceIds: [evidenceId],
      review,
    });
    const command = {
      kind: "review" as const,
      taskId,
      input: { expectedRevision: 1, mutationId: actorId, state: "confirmed" as const, note: "" },
    };
    const expansion =
      size(applyTaskChange(record.document, command, taskSizeContext)) - size(record.document);
    let remaining = target - expansion - size(record.document);
    for (const response of Object.values(record.document.responses))
      for (const field of ["basis", "reason"] as const) {
        const n = Math.min(8000, remaining);
        response[field] = "x".repeat(n);
        remaining -= n;
      }
    expect(remaining).toBe(0);
    for (const id of Object.keys(record.document.responses))
      record.document.responses[id].basisHash = await basisHash(record.document, id);
    expect(assessmentDocumentSchema.safeParse(record.document).success).toBe(true);
    const actual = await finalizeChange(
      record.document,
      await changeTask(record.document, command, {
        actorId,
        newId: () => taskId,
        now: () => "2026-09-20T00:00:00.000Z",
      }),
    );
    expect(size(actual)).toBe(target);
    expect(size(applyTaskChange(record.document, command, taskSizeContext))).toBe(target);
    expect(actual.responses).toEqual(record.document.responses);
    expect(assessmentDocumentSchema.safeParse(actual).success).toBe(target <= MAX_DOCUMENT_BYTES);
    render(
      <TaskForm
        record={record}
        standard={standard}
        selection={{ item: record.document.tasks[0], review: true }}
        readOnly={false}
        write={{ pending: false, error: null, clearError: () => {}, send: async () => null }}
        onSaved={() => {}}
        onRefresh={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "完了確認を保存" }).hasAttribute("disabled")).toBe(
      target > MAX_DOCUMENT_BYTES,
    );
  },
);
