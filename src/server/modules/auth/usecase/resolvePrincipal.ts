import {
  validateAccount,
  DomainError,
  type AccessRepository,
  type Principal,
} from "../domain/authorize";
import type { AccessTokenClaims } from "../domain/verifyAccessToken";

export async function resolvePrincipal(
  claims: AccessTokenClaims,
  repository: AccessRepository,
  requestId: string,
): Promise<Principal> {
  let user = await repository.findBySubject(claims.sub);
  validateAccount(user, claims);
  if (user.status === "invited") {
    await repository.activate(user, claims, requestId);
    user = await repository.findBySubject(claims.sub);
    validateAccount(user, claims);
  }
  if (user.status !== "active") throw new DomainError("ACCOUNT_DISABLED");
  return {
    id: user.id,
    email: user.emailNormalized,
    role: user.role,
    status: "active",
    customerIds: await repository.customerIds(user.id),
    sub: claims.sub,
    authTime: claims.auth_time,
  };
}
