import type { AiInput, AiRunDto } from "../../../../shared/contracts/aiAdvice";
import type { AssessmentRecord, Advice } from "../../../../shared/contracts/assessment";
export interface AiPort {
  generate(input: AiInput, signal: AbortSignal): Promise<unknown>;
}
export type AiContext = { actorId: string; key: string; requestHash: string; requestId: string };
export interface AiRunRepository {
  replay(context: AiContext, assessmentId: string): Promise<AiRunDto | null>;
  get(assessmentId: string, runId: string, actorId: string): Promise<AiRunDto>;
  reserve(
    record: AssessmentRecord,
    criterionId: string,
    inputHash: string,
    context: AiContext,
  ): Promise<{ run: AiRunDto; execute: boolean }>;
  finish(
    assessmentId: string,
    runId: string,
    actorId: string,
    draft: Advice | null,
    errorCode: string | null,
  ): Promise<AiRunDto>;
}
