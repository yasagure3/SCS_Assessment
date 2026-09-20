import type { AiPort } from "../../src/server/modules/advice/domain/aiPort";
import type { AiInput } from "../../src/shared/contracts/aiAdvice";
import { DomainError } from "../../src/shared/errors";

// Imported only by the serve-only E2E composition, never production.
export class FakeAiProvider implements AiPort {
  received: AiInput[] = [];
  configured = true;
  async generate(input: AiInput) {
    if (!this.configured) throw new DomainError("AI_NOT_CONFIGURED");
    this.received.push(structuredClone(input));
    return {
      origin: "ai",
      templateId: null,
      gap: "承認済みの役割分担が不足しています。",
      steps: ["役員と担当部署の役割を明文化する", "関係者で確認し承認する"],
      evidenceExamples: ["承認済みの役割分担表"],
      completionCheck: "役割と責任を担当者が規程と照合する",
      notes: "匿名 fixture の AI 下書き",
    };
  }
}
