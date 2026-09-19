import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK, type JWK } from "jose";
import { verifyAccessToken } from "../../src/server/modules/auth/domain/verifyAccessToken";

const issuer = "http://localhost:9229/local_test-pool";
const clientId = "test-client-id";

let privateKey: CryptoKey;
let jwks: { keys: JWK[] };

async function signAccessToken(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    token_use: "access",
    client_id: clientId,
    iss: issuer,
    sub: "user-123",
    iat: now,
    auth_time: now,
    exp: now + 3600,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .sign(privateKey);
}

describe("verifyAccessToken", () => {
  beforeAll(async () => {
    const { publicKey, privateKey: generatedPrivateKey } = await generateKeyPair("RS256");
    privateKey = generatedPrivateKey;
    const publicJwk = await exportJWK(publicKey);
    jwks = { keys: [{ ...publicJwk, kid: "test-key", alg: "RS256", use: "sig" }] };
  });

  it("returns the claims when the token is valid", async () => {
    const token = await signAccessToken();

    const claims = await verifyAccessToken(token, {
      issuer,
      clientId,
      getKey: createLocalJWKSet(jwks),
    });

    expect(claims.sub).toBe("user-123");
    expect(claims.client_id).toBe(clientId);
    expect(claims.token_use).toBe("access");
  });

  it("rejects a token from a different issuer", async () => {
    const token = await new SignJWT({ token_use: "access", client_id: clientId })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuedAt()
      .setIssuer("http://localhost:9229/local_other-pool")
      .setSubject("user-123")
      .setExpirationTime("1h")
      .sign(privateKey);

    await expect(
      verifyAccessToken(token, { issuer, clientId, getKey: createLocalJWKSet(jwks) }),
    ).rejects.toThrow();
  });

  it("rejects a token issued for a different client_id", async () => {
    const token = await signAccessToken({ client_id: "another-client-id" });

    await expect(
      verifyAccessToken(token, { issuer, clientId, getKey: createLocalJWKSet(jwks) }),
    ).rejects.toThrow("client_id mismatch");
  });

  it("rejects a token whose token_use is not access", async () => {
    const token = await signAccessToken({ token_use: "id" });

    await expect(
      verifyAccessToken(token, { issuer, clientId, getKey: createLocalJWKSet(jwks) }),
    ).rejects.toThrow("unexpected token_use");
  });

  it("rejects an expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signAccessToken({
      iat: now - 7200,
      auth_time: now - 7200,
      exp: now - 3600,
    });

    await expect(
      verifyAccessToken(token, { issuer, clientId, getKey: createLocalJWKSet(jwks) }),
    ).rejects.toThrow();
  });
  it.each(["sub", "exp", "iat", "auth_time"])("requires claim %s", async (claim) => {
    const token = await signAccessToken({ [claim]: undefined });
    await expect(
      verifyAccessToken(token, { issuer, clientId, getKey: createLocalJWKSet(jwks) }),
    ).rejects.toThrow();
  });
  it.each(["iat", "auth_time"])("rejects non-integer or future %s", async (claim) => {
    for (const value of ["123", 1.5, -1, Math.floor(Date.now() / 1000) + 60]) {
      const token = await signAccessToken({ [claim]: value });
      await expect(
        verifyAccessToken(token, { issuer, clientId, getKey: createLocalJWKSet(jwks) }),
      ).rejects.toThrow();
    }
  });
});
