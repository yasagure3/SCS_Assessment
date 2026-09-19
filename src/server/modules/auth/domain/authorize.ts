import type { AccessTokenClaims } from "./verifyAccessToken";
import type { AppRole, Me } from "../../../../shared/contracts/access";
import { DomainError } from "../../../../shared/errors";
export { DomainError } from "../../../../shared/errors";
export type AppUser = {
  id: string;
  cognitoSub: string | null;
  emailNormalized: string;
  role: AppRole;
  status: "invited" | "active" | "suspended";
  revokedBefore: number | null;
  revision: number;
};
export type Principal = Me & { sub: string; authTime: number };
export interface AccessRepository {
  findBySubject(sub: string): Promise<AppUser | null>;
  activate(user: AppUser, claims: AccessTokenClaims, requestId: string): Promise<void>;
  customerIds(userId: string): Promise<string[]>;
  claimRevocation(id: string, userId: string): Promise<boolean>;
  revoke(user: AppUser, key: string, requestId: string): Promise<{ id: string; revokedAt: string }>;
  recordRevocationResult(
    id: string,
    userId: string,
    succeeded: boolean,
    requestId: string,
  ): Promise<void>;
}
export interface SessionProvider {
  revoke(token: string): Promise<void>;
}
export function validateAccount(
  user: AppUser | null,
  claims: AccessTokenClaims,
): asserts user is AppUser {
  if (!user || user.cognitoSub !== claims.sub || user.status === "suspended")
    throw new DomainError("ACCOUNT_DISABLED");
  if (user.revokedBefore !== null && claims.auth_time <= user.revokedBefore)
    throw new DomainError("UNAUTHORIZED");
}
export function authorizeCustomer(principal: Principal, customerId: string): void {
  if (principal.role !== "admin" && !principal.customerIds.includes(customerId))
    throw new DomainError("NOT_FOUND");
}
export function requireAdmin(principal: Principal): void {
  if (principal.role !== "admin") throw new DomainError("FORBIDDEN");
}
