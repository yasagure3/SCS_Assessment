import { createRemoteJWKSet } from "jose";
import { verifyAccessToken } from "../domain/verifyAccessToken";
import { DomainError } from "../../../../shared/errors";

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export function resolveJwksUrl(issuer: string, jwksUrl: string | undefined): string {
  return jwksUrl ? jwksUrl : `${issuer}/.well-known/jwks.json`;
}
function getJwks(url: string) {
  const cached = jwksCache.get(url);
  if (cached) return cached;
  const jwks = createRemoteJWKSet(new URL(url));
  jwksCache.set(url, jwks);
  return jwks;
}
export async function verifyCognitoToken(
  token: string,
  bindings: { COGNITO_ISSUER: string; COGNITO_CLIENT_ID: string; COGNITO_JWKS_URL?: string },
) {
  if (!bindings.COGNITO_ISSUER || !bindings.COGNITO_CLIENT_ID)
    throw new DomainError("SERVICE_UNAVAILABLE");
  try {
    return await verifyAccessToken(token, {
      issuer: bindings.COGNITO_ISSUER,
      clientId: bindings.COGNITO_CLIENT_ID,
      getKey: getJwks(resolveJwksUrl(bindings.COGNITO_ISSUER, bindings.COGNITO_JWKS_URL)),
    });
  } catch {
    throw new DomainError("UNAUTHORIZED");
  }
}
