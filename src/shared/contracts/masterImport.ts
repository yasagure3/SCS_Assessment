import { z } from "zod";
import { mutationSchema } from "./assessment";
import { importRowSchema } from "./imports";
import type { Criterion } from "./assessment";
import type { StatusCounts } from "./assessments";

const text = z.string().max(8000);
const cells = z.strictObject(
  Object.fromEntries(Array.from({ length: 13 }, (_, i) => [String(i + 2), text])) as Record<
    string,
    typeof text
  >,
);
export const masterWorkbookSchema = z.strictObject({
  fileName: z
    .string()
    .min(1)
    .max(200)
    .refine((v) => !/[\\/]/.test(v)),
  fileSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sheet: z.string().min(1).max(200),
  headerRow: z.int().min(1).max(20),
  // Public columns never contain the customer's O:R answers.
  masterRows: z
    .array(
      z.strictObject({
        id: z.string().regex(/^\d+-\d+-\d+-\d+$/),
        level: z.enum(["★3", "★4"]),
        sourceRow: z.int().min(2).max(2000),
        publicCells: cells,
      }),
    )
    .min(1)
    .max(500),
  answers: z.array(importRowSchema).max(81),
});
export const masterPreviewSchema = z.strictObject({
  expectedRevision: z.int().positive(),
  workbook: masterWorkbookSchema,
});
export const masterCommitSchema = mutationSchema.extend({
  workbook: masterWorkbookSchema,
  previewSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type MasterWorkbook = z.infer<typeof masterWorkbookSchema>;
export type MasterPreviewInput = z.infer<typeof masterPreviewSchema>;
export type MasterCommitInput = z.infer<typeof masterCommitSchema>;
export type MasterDiff = {
  added: Criterion[];
  removed: Criterion[];
  changed: { id: string; fields: { field: string; before: string; after: string }[] }[];
  unchanged: number;
};
export type MasterPreview = {
  previewSha256: string;
  diff: MasterDiff;
  counts: StatusCounts;
  star4Excluded: number;
  dashCount: number;
  canCommit: boolean;
  errors: string[];
};
export type MasterImportResult = {
  assessmentId: string;
  standardId: string;
  preview: MasterPreview;
};
