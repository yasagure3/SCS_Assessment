import { z } from "zod";
import { adviceSchema, mutationSchema, type Advice } from "./assessment";

export const draftAdviceSchema = mutationSchema.extend({ content: adviceSchema });
export const completeAdviceSchema = adviceSchema.refine(
  (value) =>
    Boolean(
      value.gap.trim() &&
      value.completionCheck.trim() &&
      value.steps.length &&
      value.steps.every((s) => s.trim()) &&
      value.evidenceExamples.length &&
      value.evidenceExamples.every((s) => s.trim()),
    ),
  "不足点・実施手順・証跡例・完了確認をすべて入力してください。",
);
export const confirmAdviceSchema = mutationSchema.extend({
  content: completeAdviceSchema,
  reviewed: z.literal(true),
});
export type DraftAdviceInput = z.infer<typeof draftAdviceSchema>;
export type AdviceTemplate = {
  id: string;
  standardId: string;
  criterionId: string;
  version: number;
  contentSha256: string;
  sourceUrls: string[];
  officialRequirement: string;
  kind: "companyProposal";
  content: Advice;
};
export type AdviceTemplatesDto = { items: AdviceTemplate[] };
