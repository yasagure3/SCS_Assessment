import { jwtVerify, type JWTVerifyGetKey } from "jose";

export type AccessTokenClaims = {
  sub: string;
  client_id: string;
  token_use: "access";
  exp: number;
  iat: number;
  auth_time: number;
};

export type VerifyAccessTokenOptions = {
  issuer: string;
  clientId: string;
  getKey: JWTVerifyGetKey;
};

export async function verifyAccessToken(
  token: string,
  { issuer, clientId, getKey }: VerifyAccessTokenOptions,
): Promise<AccessTokenClaims> {
  if (!issuer || !clientId) throw new Error("authentication configuration is missing");
  const { payload } = await jwtVerify(token, getKey, {
    issuer,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat", "auth_time", "client_id", "token_use"],
    clockTolerance: 5,
  });

  if (payload.token_use !== "access") {
    throw new Error("unexpected token_use");
  }
  if (payload.client_id !== clientId) {
    throw new Error("client_id mismatch");
  }
  const now = Math.floor(Date.now() / 1000);
  const { sub, exp, iat, auth_time: authTime } = payload;
  if (
    typeof sub !== "string" ||
    !sub.trim() ||
    sub.length > 200 ||
    typeof exp !== "number" ||
    !Number.isSafeInteger(exp) ||
    typeof iat !== "number" ||
    !Number.isSafeInteger(iat) ||
    typeof authTime !== "number" ||
    !Number.isSafeInteger(authTime) ||
    iat <= 0 ||
    authTime <= 0 ||
    iat > now + 5 ||
    authTime > iat ||
    exp <= iat
  ) {
    throw new Error("invalid token claims");
  }

  return {
    sub,
    client_id: clientId,
    token_use: "access",
    exp,
    iat,
    auth_time: authTime,
  };
}
