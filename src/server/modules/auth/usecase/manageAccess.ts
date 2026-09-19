import { DomainError } from "../domain/authorize";
import type {
  AccessManagementRepository,
  AccessWriteContext,
  CognitoAdministration,
} from "../domain/accessManagement";

export async function issueInvitation(
  repository: AccessManagementRepository,
  provider: CognitoAdministration,
  invitationId: string,
  retry: boolean,
  context: AccessWriteContext,
) {
  const attempt = await repository.claim(invitationId, retry, context);
  if (attempt) {
    let errorCode: string | null = null;
    try {
      const sub =
        attempt.sub ?? (await provider.provision({ id: attempt.userId, email: attempt.email }));
      if (!attempt.sub) await repository.bindSubject(attempt, sub, context);
      await provider.sendInvitation({ id: attempt.userId, email: attempt.email, sub });
    } catch (error) {
      errorCode =
        error instanceof DomainError &&
        ["SERVICE_UNAVAILABLE", "PROVIDER_TIMEOUT"].includes(error.code)
          ? error.code
          : "PROVIDER_FAILED";
    }
    await repository.finish(attempt, errorCode, context);
    if (errorCode) throw new DomainError(errorCode);
  }
  const { lastErrorCode, ...result } = await repository.invitationResult(
    invitationId,
    context.actorId,
  );
  if (result.status === "failed")
    throw new DomainError(
      lastErrorCode === "SERVICE_UNAVAILABLE" || lastErrorCode === "PROVIDER_TIMEOUT"
        ? lastErrorCode
        : "PROVIDER_FAILED",
    );
  return result;
}
