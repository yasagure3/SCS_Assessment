import { Hono } from "hono";
import { authenticate } from "./authenticate";
import type { AccessTokenClaims } from "../domain/verifyAccessToken";

type Env = {
  Bindings: {
    COGNITO_ISSUER: string;
    COGNITO_CLIENT_ID: string;
    COGNITO_JWKS_URL: string;
  };
  Variables: {
    auth: AccessTokenClaims;
  };
};

export const meRoute = new Hono<Env>().get("/me", authenticate, (c) => {
  const { sub } = c.get("auth");
  return c.json({ sub });
});
