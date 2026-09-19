import { createBusinessApp } from "./businessApp";
import { verifyCognitoToken } from "./modules/auth/adapter/authenticate";
import { D1AccessRepository } from "./modules/auth/adapter/d1AccessRepository";
import { cognitoSessions } from "./modules/auth/adapter/cognitoSessions";

// No request, environment flag, or browser claim can select a test identity.
export default createBusinessApp({
  verify: verifyCognitoToken,
  access: (bindings) => new D1AccessRepository(bindings.DB),
  sessions: (bindings) => cognitoSessions(bindings.COGNITO_ISSUER),
});
