import { z } from "zod";
import { evidenceSchema, mutationSchema, reviewSchema } from "./assessment";

export const evidenceFieldsSchema = evidenceSchema
  .pick({ criterionIds: true, name: true, url: true, location: true })
  .extend({
    name: evidenceSchema.shape.name.refine(
      (value) => value.trim().length > 0,
      "文書名を入力してください。",
    ),
    criterionIds: evidenceSchema.shape.criterionIds.refine(
      (ids) => new Set(ids).size === ids.length,
      "同じ基準を重複指定できません。",
    ),
  });
export const addEvidenceSchema = mutationSchema.extend({
  ...evidenceFieldsSchema.shape,
  url: evidenceSchema.shape.url.default(null),
  location: evidenceSchema.shape.location.default(""),
  fileId: evidenceSchema.shape.fileId.default(null),
});
export const editEvidenceSchema = mutationSchema.extend(evidenceFieldsSchema.shape);
export const reviewEvidenceSchema = mutationSchema
  .extend({ state: reviewSchema.shape.state, note: reviewSchema.shape.note })
  .refine((value) => value.state === "unreviewed" || value.note.trim().length > 0, {
    path: ["note"],
    message: "確認済み・差戻しには確認メモが必要です。",
  });
export type EvidenceFields = z.infer<typeof evidenceFieldsSchema>;
export type EvidenceReviewInput = z.infer<typeof reviewEvidenceSchema>;
export type EvidenceCommand =
  | { kind: "add"; input: z.infer<typeof addEvidenceSchema> }
  | { kind: "edit"; evidenceId: string; input: z.infer<typeof editEvidenceSchema> }
  | { kind: "delete"; evidenceId: string; input: z.infer<typeof mutationSchema> }
  | { kind: "review"; evidenceId: string; criterionId: string; input: EvidenceReviewInput };
