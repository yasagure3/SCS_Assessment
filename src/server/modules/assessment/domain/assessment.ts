import {
  assessmentDocumentSchema,
  STANDARD_ID,
  type AssessmentDocument,
  type AssessmentRecord,
  type EditResponse,
  type Scope,
} from "../../../../shared/contracts/assessment";

export class DomainError extends Error {
  readonly code: string;
  constructor(code: string, message: string = code) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new DomainError("INVALID_JSON");
  return encoded;
}
export async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}
export function operationHash(
  method: string,
  path: string,
  resourceId: string,
  body: Record<string, unknown>,
): Promise<string> {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#"))
    throw new DomainError("INVALID_PATH");
  const fields = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "mutationId"));
  return digest({ method: method.toUpperCase(), path, resourceId, body: fields });
}
export async function basisHash(document: AssessmentDocument, id: string): Promise<string> {
  const response = document.responses[id];
  if (!response) throw new DomainError("UNKNOWN_CRITERION");
  const evidence = document.evidence
    .filter((item) => item.criterionIds.includes(id))
    .map((item) => ({
      id: item.id,
      name: item.name,
      url: item.url,
      location: item.location,
      fileId: item.fileId,
      review: item.reviews[id],
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return digest({
    standardId: STANDARD_ID,
    id,
    scope: document.scope,
    status: response.status,
    reason: response.reason,
    basis: response.basis,
    plannedWork: response.plannedWork,
    supplement: response.supplement,
    adviceBasisVersion: response.adviceBasisVersion,
    evidence,
  });
}
export function validateDocument(document: unknown, criterionIds: string[]): AssessmentDocument {
  const result = assessmentDocumentSchema.parse(document);
  const known = new Set(criterionIds);
  const keys = Object.keys(result.responses);
  if (known.size !== 81 || keys.length !== 81 || keys.some((id) => !known.has(id)))
    throw new DomainError("INVALID_CRITERIA");
  const evidenceIds = new Set(result.evidence.map((item) => item.id));
  if (
    evidenceIds.size !== result.evidence.length ||
    new Set(result.tasks.map((item) => item.id)).size !== result.tasks.length
  )
    throw new DomainError("DUPLICATE_ID");
  for (const item of result.evidence) {
    if (
      new Set(item.criterionIds).size !== item.criterionIds.length ||
      item.criterionIds.some((id) => !known.has(id)) ||
      canonical(Object.keys(item.reviews).sort()) !== canonical([...item.criterionIds].sort())
    )
      throw new DomainError("INVALID_EVIDENCE_LINK");
  }
  for (const task of result.tasks) {
    if (
      !known.has(task.criterionId) ||
      new Set(task.evidenceIds).size !== task.evidenceIds.length ||
      task.evidenceIds.some(
        (id) =>
          !result.evidence.some(
            (item) => item.id === id && item.criterionIds.includes(task.criterionId),
          ),
      )
    )
      throw new DomainError("INVALID_TASK_LINK");
    if (
      task.state === "done" &&
      (!task.result.trim() ||
        !task.evidenceIds.length ||
        task.review.state !== "confirmed" ||
        !task.review.by ||
        !task.review.at ||
        !task.review.subjectHash)
    )
      throw new DomainError("TASK_REVIEW_REQUIRED");
  }
  return result;
}
export async function emptyDocument(criterionIds: string[]): Promise<AssessmentDocument> {
  const document: AssessmentDocument = {
    schemaVersion: 1,
    diagnosisDate: null,
    copiedFrom: null,
    scope: { companies: "", sites: "", departments: "", systems: "" },
    importInfo: null,
    responses: {},
    evidence: [],
    tasks: [],
  };
  for (const id of criterionIds)
    document.responses[id] = {
      original: null,
      status: "unanswered",
      reason: "",
      basis: "",
      plannedWork: "",
      supplement: "",
      manualEdited: false,
      adviceBasisVersion: 1,
      basisHash: "0".repeat(64),
      adviceDraft: null,
      confirmedAdvice: null,
    };
  for (const id of criterionIds) document.responses[id].basisHash = await basisHash(document, id);
  return validateDocument(document, criterionIds);
}
export async function editResponse(
  document: AssessmentDocument,
  id: string,
  edit: EditResponse,
): Promise<AssessmentDocument> {
  if (!document.responses[id]) throw new DomainError("UNKNOWN_CRITERION");
  const next = structuredClone(document);
  const response = next.responses[id];
  const { status, reason, basis, plannedWork, supplement } = edit;
  const values = { status, reason, basis, plannedWork, supplement };
  const changed = Object.entries(values).some(
    ([key, value]) => response[key as keyof typeof values] !== value,
  );
  Object.assign(response, values, { manualEdited: true });
  if (changed) response.adviceBasisVersion++;
  response.basisHash = await basisHash(next, id);
  return next;
}
export async function editScope(
  document: AssessmentDocument,
  scope: Scope,
  diagnosisDate: string | null,
): Promise<AssessmentDocument> {
  const next = structuredClone(document);
  const changed = canonical(document.scope) !== canonical(scope);
  next.scope = scope;
  next.diagnosisDate = diagnosisDate;
  if (changed)
    for (const id of Object.keys(next.responses)) {
      next.responses[id].adviceBasisVersion++;
      next.responses[id].basisHash = await basisHash(next, id);
    }
  return next;
}
export async function finalizeChange(
  previous: AssessmentDocument,
  proposed: AssessmentDocument,
): Promise<AssessmentDocument> {
  const next = structuredClone(proposed);
  if (previous.importInfo && canonical(previous.importInfo) !== canonical(next.importInfo))
    throw new DomainError("IMMUTABLE_ORIGINAL");
  for (const [id, old] of Object.entries(previous.responses)) {
    const row = next.responses[id];
    if (!row) throw new DomainError("INVALID_CRITERIA");
    if (
      (previous.importInfo || old.original) &&
      canonical(row.original) !== canonical(old.original)
    )
      throw new DomainError("IMMUTABLE_ORIGINAL");
    row.adviceBasisVersion = old.adviceBasisVersion;
    const candidate = await basisHash(next, id);
    if (candidate !== old.basisHash) row.adviceBasisVersion++;
    row.basisHash = await basisHash(next, id);
  }
  return next;
}
export interface AssessmentRepository {
  get(id: string, actorId: string): Promise<AssessmentRecord>;
  save(input: {
    record: AssessmentRecord;
    actorId: string;
    expectedRevision: number;
    mutationId: string;
    requestHash: string;
    action: string;
    requestId: string;
  }): Promise<AssessmentRecord>;
}
