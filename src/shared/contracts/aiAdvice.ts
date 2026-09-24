import { z } from "zod";
import { adviceSchema, mutationSchema } from "./assessment";

const anonymousText = z
  .string()
  .trim()
  .min(1)
  .refine((value) => Array.from(value).length <= 2000, "2000文字以内で入力してください。");
export const generateAiSchema = z.strictObject({
  expectedRevision: z.int().positive(),
  basisHash: z.string().regex(/^[a-f0-9]{64}$/),
  anonymousAnswer: anonymousText,
  anonymousGap: anonymousText,
  reviewedInputHash: z.string().regex(/^[a-f0-9]{64}$/),
  anonymizationReviewed: z.literal(true),
});
export const adoptAiSchema = mutationSchema.extend({ runId: z.uuid() });
export const aiDraftSchema = adviceSchema.refine(
  (value) => value.origin === "ai" && value.templateId === null,
);
export type GenerateAiInput = z.infer<typeof generateAiSchema>;
export type AdoptAiInput = z.infer<typeof adoptAiSchema>;
export type AiInput = {
  standardId: string;
  criterionId: string;
  officialRequirement: string;
  anonymousAnswer: string;
  anonymousGap: string;
};
export type AiRunDto = {
  runId: string;
  criterionId: string;
  status: "pending" | "running" | "succeeded" | "failed" | "stale";
  draft: z.infer<typeof aiDraftSchema> | null;
  inputHash: string;
  basisHash: string;
  errorCode: string | null;
};
// All values are strings; sorting the five public keys matches the canonical API hash.
export function canonicalAiInput(input: AiInput) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(input).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  );
}
export async function hashAiInput(input: AiInput) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalAiInput(input)),
  );
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
