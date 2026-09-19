import type { AdviceTemplate } from "../../../../shared/contracts/advice";
export interface AdviceTemplateRepository {
  list(standardId: string): Promise<AdviceTemplate[]>;
}
