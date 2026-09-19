import { z } from "zod";
import { STANDARD_ID, dateSchema, mutationSchema, scopeSchema } from "./assessment";
export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => Array.from(value).length <= 200, "200文字以内で入力してください");
export const createCustomerSchema = z.strictObject({ name: nameSchema });
export const patchEntitySchema = mutationSchema
  .extend({ name: nameSchema.optional(), archived: z.boolean().optional() })
  .refine(
    (value) => value.name !== undefined || value.archived !== undefined,
    "変更内容がありません",
  );
export const createCaseSchema = z.strictObject({
  name: nameSchema,
  standardId: z.literal(STANDARD_ID),
  diagnosisDate: dateSchema.nullable().optional(),
  scope: scopeSchema.optional(),
});
export const editScopeSchema = mutationSchema.extend({
  scope: scopeSchema,
  diagnosisDate: dateSchema.nullable(),
});
export const listSchema = z.strictObject({
  q: z.string().max(400).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(400).optional(),
});
export type Customer = {
  id: string;
  name: string;
  revision: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type CaseRecord = Customer & { customerId: string };
export type CaseCreated = { case: CaseRecord; assessmentId: string; assessmentRevision: 1 };
export type AssessmentListItem = {
  id: string;
  standardId: string;
  diagnosisDate: string | null;
  revision: number;
  previousAssessmentId: string | null;
  createdAt: string;
  updatedAt: string;
};
export type CreateCase = z.infer<typeof createCaseSchema>;
export type PatchEntity = z.infer<typeof patchEntitySchema>;
export type EditScope = z.infer<typeof editScopeSchema>;
export type ListQuery = z.infer<typeof listSchema>;
