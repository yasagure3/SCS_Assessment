import { expect, it } from "vite-plus/test";
import { render, screen, fireEvent } from "@testing-library/react";
import { EvidenceForm } from "../front/components/EvidenceForm";
import { assessmentFixture } from "../front/components/assessments/assessmentFixtures";
import { MAX_DOCUMENT_BYTES, assessmentDocumentSchema } from "../shared/contracts/assessment";
import { changeEvidence, emptyReview } from "../server/modules/assessment/domain/evidence";
import {
  finalizeChange,
  emptyDocument,
  basisHash,
} from "../server/modules/assessment/domain/assessment";
import { applyEvidenceChange, evidenceSizeContext } from "../shared/evidenceChange";

const evidenceId = "77777777-7777-4777-8777-777777777777";
const actorId = "11111111-1111-4111-8111-111111111111";
const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

// Cross-boundary integration: compare the rendered gate with domain finalization,
// including real SHA-256 replacement. No production front/server import is added.

it.each([
  { state: "unreviewed", target: 100000 },
  { state: "unreviewed", target: MAX_DOCUMENT_BYTES - 16 },
  { state: "confirmed", target: MAX_DOCUMENT_BYTES - 16 },
  { state: "rejected", target: MAX_DOCUMENT_BYTES - 16 },
] as const)(
  "review $state at $target bytes agrees with the actual saved-size gate",
  async ({ state, target }) => {
    const { record, standard } = assessmentFixture();
    record.document = await emptyDocument(standard.criteria.map((c) => c.id));
    record.document.evidence = [
      {
        id: evidenceId,
        name: "doc",
        criterionIds: ["C-1"],
        location: "",
        url: null,
        fileId: null,
        reviews: { "C-1": emptyReview() },
      },
    ];
    let remaining = target - size(record.document);
    for (const response of Object.values(record.document.responses)) {
      for (const field of ["basis", "reason"] as const) {
        const length = Math.min(8000, remaining);
        response[field] = "x".repeat(length);
        remaining -= length;
      }
    }
    expect(remaining).toBe(0);
    expect(size(record.document)).toBe(target);
    expect(assessmentDocumentSchema.safeParse(record.document).success).toBe(true);
    for (const id of Object.keys(record.document.responses))
      record.document.responses[id].basisHash = await basisHash(record.document, id);
    const input = { state, note: "new", expectedRevision: record.revision, mutationId: actorId };
    const actual = await finalizeChange(
      record.document,
      await changeEvidence(
        record.document,
        { kind: "review", evidenceId, criterionId: "C-1", input },
        { actorId, newId: () => evidenceId, now: () => "2026-09-19T00:00:00.000Z" },
      ),
    );
    expect(
      size(
        applyEvidenceChange(
          record.document,
          { kind: "review", evidenceId, criterionId: "C-1", input },
          evidenceSizeContext,
        ),
      ),
    ).toBe(size(actual));
    expect(actual.responses["C-1"].adviceBasisVersion).toBe(2);
    expect(size(actual)).toBe(target + { unreviewed: 3, confirmed: 120, rejected: 119 }[state]);
    expect(actual.evidence[0].reviews["C-1"]).toEqual(
      state === "unreviewed"
        ? { state, note: "new", by: null, at: null, subjectHash: null }
        : {
            state,
            note: "new",
            by: actorId,
            at: "2026-09-19T00:00:00.000Z",
            subjectHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
    );
    render(
      <EvidenceForm
        record={record}
        standard={standard}
        selection={{ item: record.document.evidence[0], criterionId: "C-1" }}
        readOnly={false}
        write={{ pending: false, error: null, clearError: () => {}, send: async () => null }}
        onSaved={() => {}}
        onRefresh={() => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("確認結果"), { target: { value: state } });
    fireEvent.change(screen.getByLabelText("確認メモ"), { target: { value: "new" } });
    expect(screen.getByRole("button", { name: "確認を保存" }).hasAttribute("disabled")).toBe(
      size(actual) > MAX_DOCUMENT_BYTES,
    );
  },
);

it.each(["add", "edit-with-reviewed-task", "delete"] as const)(
  "%s agrees with the actual aggregate limit",
  async (kind) => {
    const { record, standard } = assessmentFixture();
    record.document = await emptyDocument(standard.criteria.map((c) => c.id));
    record.document.responses["C-1"].adviceBasisVersion = 9;
    const evidence = {
      id: evidenceId,
      name: "doc",
      criterionIds: ["C-1"],
      location: "",
      url: null,
      fileId: null,
      reviews: { "C-1": emptyReview() },
    };
    if (kind !== "add") record.document.evidence.push(evidence);
    if (kind === "edit-with-reviewed-task")
      record.document.tasks.push({
        id: actorId,
        sourceTaskId: null,
        sourceAssessmentId: null,
        criterionId: "C-1",
        title: "t",
        ownerName: "staff",
        dueDate: "",
        priority: "normal",
        state: "done",
        completionCondition: "match",
        result: "completed",
        evidenceIds: [evidenceId],
        review: {
          state: "confirmed",
          note: "original checked",
          by: actorId,
          at: "2026-09-19T00:00:00.000Z",
          subjectHash: "a".repeat(64),
        },
      });
    const projection = structuredClone(record.document);
    projection.evidence.push(evidence);
    const target =
      kind === "add"
        ? MAX_DOCUMENT_BYTES - (size(projection) - size(record.document))
        : MAX_DOCUMENT_BYTES - 4;
    let remaining = target - size(record.document);
    for (const response of Object.values(record.document.responses))
      for (const field of ["basis", "reason"] as const) {
        const length = Math.min(8000, remaining);
        response[field] = "x".repeat(length);
        remaining -= length;
      }
    expect(remaining).toBe(0);
    for (const id of Object.keys(record.document.responses))
      record.document.responses[id].basisHash = await basisHash(record.document, id);
    expect(assessmentDocumentSchema.safeParse(record.document).success).toBe(true);
    const mutation = { expectedRevision: 1, mutationId: actorId };
    const fields = {
      name: kind === "edit-with-reviewed-task" ? "document-renamed" : "doc",
      criterionIds: ["C-1"],
      location: "",
      url: null,
    };
    const command =
      kind === "add"
        ? { kind: "add" as const, input: { ...mutation, ...fields, fileId: null } }
        : kind === "delete"
          ? { kind: "delete" as const, evidenceId, input: mutation }
          : { kind: "edit" as const, evidenceId, input: { ...mutation, ...fields } };
    const actual = await finalizeChange(
      record.document,
      await changeEvidence(record.document, command, {
        actorId,
        newId: () => evidenceId,
        now: () => "2026-09-19T00:00:00.000Z",
      }),
    );
    expect(size(applyEvidenceChange(record.document, command, evidenceSizeContext))).toBe(
      size(actual),
    );
    expect(actual.responses["C-1"].adviceBasisVersion).toBe(10);
    expect(size(actual)).toBe(
      MAX_DOCUMENT_BYTES + { add: 1, "edit-with-reviewed-task": -122, delete: -213 }[kind],
    );
    if (kind === "edit-with-reviewed-task")
      expect(actual.tasks).toEqual(
        record.document.tasks.map((task) => ({ ...task, state: "doing", review: emptyReview() })),
      );
    render(
      <EvidenceForm
        record={record}
        standard={standard}
        selection={{ item: kind === "add" ? null : record.document.evidence[0] }}
        readOnly={false}
        write={{ pending: false, error: null, clearError: () => {}, send: async () => null }}
        onSaved={() => {}}
        onRefresh={() => {}}
        onCancel={() => {}}
      />,
    );
    if (kind !== "delete")
      fireEvent.change(screen.getByLabelText("文書名"), { target: { value: fields.name } });
    if (kind === "add") fireEvent.click(screen.getByLabelText("C-1"));
    const button = screen.getByRole("button", {
      name: kind === "delete" ? "証跡の関連をすべて解除" : "証跡を保存",
    });
    expect(button.hasAttribute("disabled")).toBe(size(actual) > MAX_DOCUMENT_BYTES);
  },
);

it.each(["edit", "review"] as const)(
  "%s no-op at exactly 1MiB preserves the reviewed task, metadata and version",
  async (kind) => {
    const { record, standard } = assessmentFixture();
    record.document = await emptyDocument(standard.criteria.map((c) => c.id));
    record.document.responses["C-1"].adviceBasisVersion = 9;
    const review = {
      state: "confirmed" as const,
      note: "checked",
      by: actorId,
      at: "2026-09-19T00:00:00.000Z",
      subjectHash: "a".repeat(64),
    };
    const evidence = {
      id: evidenceId,
      name: "doc",
      criterionIds: ["C-1"],
      location: "",
      url: null,
      fileId: null,
      reviews: { "C-1": review },
    };
    record.document.evidence.push(evidence);
    record.document.tasks.push({
      id: actorId,
      sourceTaskId: null,
      sourceAssessmentId: null,
      criterionId: "C-1",
      title: "t",
      ownerName: "staff",
      dueDate: "",
      priority: "normal",
      state: "done",
      completionCondition: "match",
      result: "completed",
      evidenceIds: [evidenceId],
      review,
    });
    let remaining = MAX_DOCUMENT_BYTES - size(record.document);
    for (const response of Object.values(record.document.responses))
      for (const field of ["basis", "reason"] as const) {
        const length = Math.min(8000, remaining);
        response[field] = "x".repeat(length);
        remaining -= length;
      }
    expect(remaining).toBe(0);
    for (const id of Object.keys(record.document.responses))
      record.document.responses[id].basisHash = await basisHash(record.document, id);
    expect(size(record.document)).toBe(MAX_DOCUMENT_BYTES);
    expect(assessmentDocumentSchema.safeParse(record.document).success).toBe(true);
    const mutation = { expectedRevision: 1, mutationId: actorId };
    const command =
      kind === "edit"
        ? {
            kind,
            evidenceId,
            input: {
              ...mutation,
              name: evidence.name,
              criterionIds: evidence.criterionIds,
              location: evidence.location,
              url: evidence.url,
            },
          }
        : {
            kind,
            evidenceId,
            criterionId: "C-1",
            input: { ...mutation, state: review.state, note: review.note },
          };
    const actual = await finalizeChange(
      record.document,
      await changeEvidence(record.document, command, {
        actorId,
        newId: () => evidenceId,
        now: () => "2026-09-20T00:00:00.000Z",
      }),
    );
    expect(actual).toEqual(record.document);
    expect(applyEvidenceChange(record.document, command, evidenceSizeContext)).toEqual(
      record.document,
    );
    render(
      <EvidenceForm
        record={record}
        standard={standard}
        selection={{ item: evidence, ...(kind === "review" ? { criterionId: "C-1" } : {}) }}
        readOnly={false}
        write={{ pending: false, error: null, clearError: () => {}, send: async () => null }}
        onSaved={() => {}}
        onRefresh={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: kind === "review" ? "確認を保存" : "証跡を保存" }),
    ).toBeEnabled();
  },
);
