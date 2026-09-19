import { z } from "zod";
import { mutationSchema, STANDARD_ID } from "./assessment";
import type { StatusCounts, AssessmentDto } from "./assessments";
const text = (max: number) => z.string().refine((v) => Array.from(v).length <= max);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const importRowSchema = z.strictObject({
  criterionId: z.string().regex(/^\d+-\d+-\d+-\d+$/),
  sheet: text(200).refine((v) => v.length > 0),
  row: z.int().min(3).max(2000),
  O: text(8000),
  P: text(8000),
  Q: text(8000),
  R: text(8000),
});
export const normalizedImportSchema = z.strictObject({
  standardId: z.literal(STANDARD_ID),
  fileName: text(2000)
    .transform((v) => v.split(/[\\/]/).at(-1) ?? "")
    .pipe(text(200).refine((v) => v.length > 0)),
  clientFileSha256: hash,
  masterContentSha256: hash,
  star4Excluded: z.int().min(0).max(72),
  rows: z.array(importRowSchema).max(81),
});
export const previewImportSchema = z.strictObject({
  expectedRevision: z.int().positive(),
  normalized: normalizedImportSchema,
});
export const commitImportSchema = mutationSchema.extend({
  normalized: normalizedImportSchema,
  normalizedSha256: hash,
  acknowledgedMissingIds: z.array(z.string()).max(81),
});
export type ImportRow = z.infer<typeof importRowSchema>;
export type NormalizedImport = z.infer<typeof normalizedImportSchema>;
export type PreviewImport = z.infer<typeof previewImportSchema>;
export type CommitImport = z.infer<typeof commitImportSchema>;
export type ImportIssue = { code: string; sheet: string; row: number; column: string };
export type ImportMaster = {
  standardId: string;
  masterContentSha256: string;
  rows: { id: string; level: string; publicCells: Record<string, string> }[];
};
export type ImportPreview = {
  revision: number;
  normalizedSha256: string;
  counts: StatusCounts;
  missingIds: string[];
  warnings: ImportIssue[];
  errors: ImportIssue[];
  canCommit: boolean;
};
export type ImportCommitted = { assessment: AssessmentDto; counts: StatusCounts };
