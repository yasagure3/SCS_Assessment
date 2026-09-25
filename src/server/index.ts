import { createBusinessApp } from "./businessApp";
import { verifyCognitoToken } from "./modules/auth/adapter/authenticate";
import { D1AccessRepository } from "./modules/auth/adapter/d1AccessRepository";
import { cognitoSessions } from "./modules/auth/adapter/cognitoSessions";
import { cognitoAdmin } from "./modules/auth/adapter/cognitoAdmin";
import { cognitoAdminTransport } from "./modules/auth/adapter/cognitoAdminTransport";
import { D1MalwareScan } from "./modules/evidence/adapter/d1MalwareScan";
import { s3ScanProvider } from "./modules/evidence/adapter/s3ScanProvider";

// No request, environment flag, or browser claim can select a test identity.
export default createBusinessApp({
  verify: verifyCognitoToken,
  access: (bindings) => new D1AccessRepository(bindings.DB),
  sessions: (bindings) => cognitoSessions(bindings.COGNITO_ISSUER),
  administration: (bindings) =>
    cognitoAdmin({
      poolId: bindings.COGNITO_POOL_ID ?? "",
      transport: cognitoAdminTransport(bindings, fetch, () => new Date()),
    }),
  malwareScan: (bindings) =>
    new D1MalwareScan(
      bindings.DB,
      bindings.EVIDENCE_BUCKET,
      s3ScanProvider(bindings, fetch, () => new Date()),
      () => new Date().toISOString(),
      () => crypto.randomUUID(),
      bindings.S3_SCAN_BUCKET?.startsWith("scs-trial-") ?? true,
    ),
});
