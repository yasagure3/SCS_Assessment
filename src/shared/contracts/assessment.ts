import { z } from "zod";

export const STANDARD_ID = "scs-20260327-star3";
export const MAX_DOCUMENT_BYTES = 1_048_576;
export const MAX_REPORT_BYTES = 1_572_864;
const text = (max: number) =>
  z.string().refine((value) => Array.from(value).length <= max, `最大${max}文字です`);
export const uuid = z.uuid();
export const statusSchema = z.enum(["yes", "uncertain", "no", "unanswered"]);
export const dateSchema = z.iso.date();
export const scopeSchema = z.strictObject({
  companies: text(2000),
  sites: text(2000),
  departments: text(2000),
  systems: text(2000),
});
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const reviewSchema = z.strictObject({
  state: z.enum(["unreviewed", "confirmed", "rejected"]),
  note: text(2000),
  by: uuid.nullable(),
  at: z.iso.datetime().nullable(),
  subjectHash: hash.nullable(),
});
export const adviceSchema = z
  .strictObject({
    origin: z.enum(["template", "manual", "ai"]),
    templateId: z.string().nullable(),
    gap: text(12000),
    steps: z.array(text(12000)).max(30),
    evidenceExamples: z.array(text(12000)).max(30),
    completionCheck: text(12000),
    notes: text(12000),
  })
  .refine(
    (value) =>
      Array.from(
        [
          value.gap,
          ...value.steps,
          ...value.evidenceExamples,
          value.completionCheck,
          value.notes,
        ].join(""),
      ).length <= 12000,
    "助言は合計12000文字以内です",
  );
export const responseSchema = z.strictObject({
  original: z
    .strictObject({
      sheet: text(200),
      row: z.int().min(1).max(2000),
      O: text(8000),
      P: text(8000),
      Q: text(8000),
      R: text(8000),
    })
    .nullable(),
  status: statusSchema,
  reason: text(8000),
  basis: text(8000),
  plannedWork: text(8000),
  supplement: text(8000),
  manualEdited: z.boolean(),
  adviceBasisVersion: z.int().min(1),
  basisHash: hash,
  adviceDraft: adviceSchema.nullable(),
  confirmedAdvice: z
    .strictObject({
      content: adviceSchema,
      basisHash: hash,
      by: uuid,
      at: z.iso.datetime(),
      version: z.int().min(1),
    })
    .nullable(),
});
export const evidenceSchema = z.strictObject({
  id: uuid,
  criterionIds: z.array(z.string()).min(1).max(81),
  name: text(200),
  url: text(2048)
    .refine((value) => {
      try {
        return ["https:", "http:"].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    })
    .nullable(),
  location: text(2000),
  fileId: uuid.nullable(),
  reviews: z.record(z.string(), reviewSchema),
});
export const taskSchema = z.strictObject({
  id: uuid,
  sourceTaskId: uuid.nullable(),
  sourceAssessmentId: uuid.nullable(),
  criterionId: z.string(),
  title: text(200),
  ownerName: text(200),
  dueDate: dateSchema.or(z.literal("")),
  priority: z.enum(["high", "normal", "low"]),
  state: z.enum(["todo", "doing", "awaiting_review", "done"]),
  completionCondition: text(8000),
  result: text(8000),
  evidenceIds: z.array(uuid).max(100),
  review: reviewSchema,
});
export const assessmentDocumentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    diagnosisDate: dateSchema.nullable(),
    copiedFrom: z.strictObject({ assessmentId: uuid, revision: z.int().positive() }).nullable(),
    scope: scopeSchema,
    importInfo: z
      .strictObject({
        fileName: text(200),
        clientFileSha256: hash,
        normalizedSha256: hash,
        importedAt: z.iso.datetime(),
        importedBy: uuid,
        star4Excluded: z.int().min(0),
        missingIds: z.array(z.string()).max(81),
      })
      .nullable(),
    responses: z.record(z.string(), responseSchema),
    evidence: z.array(evidenceSchema).max(100),
    tasks: z.array(taskSchema).max(100),
  })
  .refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_DOCUMENT_BYTES,
    "診断全体が1MiBを超えています",
  );
export const mutationSchema = z.strictObject({
  expectedRevision: z.int().positive(),
  mutationId: uuid,
});
export const editResponseSchema = mutationSchema.extend({
  status: statusSchema,
  reason: text(8000),
  basis: text(8000),
  plannedWork: text(8000),
  supplement: text(8000),
});
export type AssessmentDocument = z.infer<typeof assessmentDocumentSchema>;
export type AssessmentResponse = z.infer<typeof responseSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type Advice = z.infer<typeof adviceSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Scope = z.infer<typeof scopeSchema>;
export type EditResponse = z.infer<typeof editResponseSchema>;
export type AssessmentRecord = {
  id: string;
  caseId: string;
  customerId: string;
  standardId: string;
  previousAssessmentId: string | null;
  revision: number;
  document: AssessmentDocument;
  createdAt: string;
  updatedAt: string;
};
export type Criterion = {
  id: string;
  requirementId: string;
  category: string;
  requirementText: string;
  officialText: string;
  orderNo: number;
  sourceRow: number;
};
