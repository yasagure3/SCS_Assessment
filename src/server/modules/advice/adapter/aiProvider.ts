import type { AiPort } from "../domain/aiPort";
import { DomainError } from "../../../../shared/errors";

// F04 selects the provider and its contract. No environment flag enables a fake provider.
export function unconfiguredAiProvider(): AiPort {
  return {
    generate: async () => {
      throw new DomainError("AI_NOT_CONFIGURED");
    },
  };
}
