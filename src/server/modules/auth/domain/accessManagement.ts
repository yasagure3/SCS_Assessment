import type { ApiPage } from "../../../../shared/contracts/api";
import type { ListQuery } from "../../../../shared/contracts/cases";
import type {
  InviteInput,
  UpdateUserInput,
  MembersInput,
  ManagedUser,
  Invitation,
  InvitationResult,
  Members,
} from "../../../../shared/contracts/access";
export type AccessWriteContext = {
  actorId: string;
  key: string;
  requestId: string;
  requestHash: string;
};
export type InvitationAttempt = {
  invitationId: string;
  userId: string;
  email: string;
  sub: string | null;
  attemptId: string;
};
export interface CognitoAdministration {
  provision(user: { id: string; email: string }): Promise<string>;
  sendInvitation(user: { id: string; email: string; sub: string }): Promise<void>;
}
export interface AccessManagementRepository {
  users(actorId: string, query: ListQuery): Promise<ApiPage<ManagedUser>>;
  invitations(actorId: string, query: ListQuery): Promise<ApiPage<Invitation>>;
  reserve(input: InviteInput, context: AccessWriteContext): Promise<string>;
  claim(
    invitationId: string,
    retry: boolean,
    context: AccessWriteContext,
  ): Promise<InvitationAttempt | null>;
  bindSubject(attempt: InvitationAttempt, sub: string, context: AccessWriteContext): Promise<void>;
  finish(
    attempt: InvitationAttempt,
    errorCode: string | null,
    context: AccessWriteContext,
  ): Promise<void>;
  invitationResult(
    id: string,
    actorId: string,
  ): Promise<InvitationResult & { lastErrorCode: string | null }>;
  updateUser(id: string, input: UpdateUserInput, context: AccessWriteContext): Promise<ManagedUser>;
  members(customerId: string, actorId: string): Promise<Members>;
  replaceMembers(
    customerId: string,
    input: MembersInput,
    context: AccessWriteContext,
  ): Promise<Members>;
}
