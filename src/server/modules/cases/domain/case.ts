import type {
  Customer,
  CaseRecord,
  CaseCreated,
  AssessmentListItem,
  CreateCase,
  PatchEntity,
  ListQuery,
} from "../../../../shared/contracts/cases";
import type { AssessmentDocument } from "../../../../shared/contracts/assessment";
import type { ApiPage } from "../../../../shared/contracts/api";
export type { CreateCase, EditScope } from "../../../../shared/contracts/cases";
export type WriteContext = { actorId: string; key: string; requestHash: string; requestId: string };
export interface CaseRepository {
  customer(id: string, actorId: string): Promise<Customer>;
  case(id: string, actorId: string): Promise<CaseRecord>;
  customers(actorId: string, query: ListQuery): Promise<ApiPage<Customer>>;
  cases(customerId: string, actorId: string, query: ListQuery): Promise<ApiPage<CaseRecord>>;
  assessments(
    caseId: string,
    actorId: string,
    query: ListQuery,
  ): Promise<ApiPage<AssessmentListItem>>;
  criterionIds(standardId: string): Promise<string[]>;
  createCustomer(name: string, context: WriteContext): Promise<Customer>;
  createCase(
    customerId: string,
    input: CreateCase,
    document: AssessmentDocument,
    context: WriteContext,
  ): Promise<CaseCreated>;
  patchCustomer(id: string, input: PatchEntity, context: WriteContext): Promise<Customer>;
  patchCase(id: string, input: PatchEntity, context: WriteContext): Promise<CaseRecord>;
}
