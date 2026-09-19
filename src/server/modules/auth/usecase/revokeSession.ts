import {
  DomainError,
  type AccessRepository,
  type Principal,
  type SessionProvider,
} from "../domain/authorize";
export async function revokeSession(
  principal: Principal,
  token: string,
  key: string,
  requestId: string,
  repository: AccessRepository,
  provider: SessionProvider,
) {
  const user = await repository.findBySubject(principal.sub);
  if (!user || user.status !== "active") throw new DomainError("ACCOUNT_DISABLED");
  const result = await repository.revoke(user, key, requestId);
  if (!(await repository.claimRevocation(result.id, user.id)))
    return { revokedAt: result.revokedAt };
  let succeeded = false;
  try {
    await provider.revoke(token);
    succeeded = true;
  } catch {
    /* The application revocation remains effective; never persist the token. */
  }
  await repository.recordRevocationResult(result.id, user.id, succeeded, requestId);
  return { revokedAt: result.revokedAt };
}
