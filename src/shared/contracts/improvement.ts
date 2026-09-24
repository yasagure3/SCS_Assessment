import { z } from "zod";
import {
  dateSchema,
  mutationSchema,
  taskSchema,
  uuid,
  scopeSchema,
  STANDARD_ID,
  type AssessmentRecord,
  type AssessmentResponse,
  type Scope,
  type Task,
} from "./assessment";

const required = (schema: z.ZodString) =>
  schema.refine((value) => value.trim().length > 0, "必須項目を入力してください。");
export const taskFieldsSchema = z.strictObject({
  title: required(taskSchema.shape.title),
  ownerName: required(taskSchema.shape.ownerName),
  dueDate: dateSchema,
  priority: taskSchema.shape.priority,
  completionCondition: required(taskSchema.shape.completionCondition),
});
export const addTaskSchema = mutationSchema.extend({
  ...taskFieldsSchema.shape,
  criterionId: z.string().min(1),
});
export const editTaskSchema = mutationSchema.extend({
  ...taskFieldsSchema.shape,
  state: z.enum(["todo", "doing", "awaiting_review", "done"]),
  result: taskSchema.shape.result,
  evidenceIds: z
    .array(uuid)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const reviewTaskSchema = mutationSchema.extend({
  state: z.enum(["confirmed", "rejected"]),
  note: taskSchema.shape.review.shape.note,
});
export type TaskCommand =
  | { kind: "add"; input: z.infer<typeof addTaskSchema> }
  | { kind: "edit"; taskId: string; input: z.infer<typeof editTaskSchema> }
  | { kind: "review"; taskId: string; input: z.infer<typeof reviewTaskSchema> };

export const reassessmentSchema = z.strictObject({
  previousAssessmentId: uuid,
  expectedPreviousRevision: z.int().positive(),
  standardId: z.literal(STANDARD_ID),
  diagnosisDate: dateSchema.nullable(),
  scope: scopeSchema,
  copyResponses: z.boolean(),
  copyTaskIds: z
    .array(uuid)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
});
export type ReassessmentInput = z.infer<typeof reassessmentSchema>;
export const comparisonQuerySchema = z.strictObject({
  previous: uuid,
  previousRevision: z.coerce.number().int().positive().optional(),
});
export type TaskComparison = {
  mode: "matched" | "unmatched";
  matched: { before: Task; after: Task; changed: boolean }[];
  notCarried: Task[];
  added: Task[];
  previous: Task[];
  current: Task[];
};
export const responseTextFields = ["reason", "basis", "plannedWork", "supplement"] as const;
export type ComparisonDto = {
  current: AssessmentRecord;
  previous: AssessmentRecord;
  scopeChanges: { field: keyof Scope; before: string; after: string }[];
  standardChanged: boolean;
  rows: {
    criterionId: string;
    beforeStatus: AssessmentResponse["status"];
    afterStatus: AssessmentResponse["status"];
    changed: boolean;
    responseChanges: {
      field: (typeof responseTextFields)[number];
      before: string;
      after: string;
    }[];
    tasks: TaskComparison;
  }[];
  unmatchedIds: { previous: string[]; current: string[] };
};
