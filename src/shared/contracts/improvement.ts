import { z } from "zod";
import { dateSchema, mutationSchema, taskSchema, uuid } from "./assessment";

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
