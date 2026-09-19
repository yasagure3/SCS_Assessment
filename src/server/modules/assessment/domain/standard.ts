import type { StandardDto } from "../../../../shared/contracts/assessments";
export interface StandardRepository {
  get(id: string): Promise<StandardDto>;
}
