import { Hono } from "hono";
import { z, ZodError } from "zod";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { DomainError } from "../shared/errors";
import type { AccessTokenClaims } from "./modules/auth/domain/verifyAccessToken";
import type { AccessRepository, Principal, SessionProvider } from "./modules/auth/domain/authorize";
import { resolvePrincipal } from "./modules/auth/usecase/resolvePrincipal";
import { revokeSession } from "./modules/auth/usecase/revokeSession";

export type Bindings = {
  DB: D1Database;
  COGNITO_ISSUER: string;
  COGNITO_CLIENT_ID: string;
  COGNITO_JWKS_URL?: string;
};
export type AppEnv = { Bindings: Bindings; Variables: { principal: Principal; requestId: string } };
export type AppDependencies = {
  verify: (token: string, bindings: Bindings) => Promise<AccessTokenClaims>;
  access: (bindings: Bindings) => AccessRepository;
  sessions: (bindings: Bindings) => SessionProvider;
};
const errors: Record<string, [ContentfulStatusCode, string]> = {
  MALFORMED_JSON: [400, "JSONの形式を確認してください。"],
  UNAUTHORIZED: [401, "ログインし直してください。"],
  ACCOUNT_DISABLED: [403, "利用可能な招待またはアカウントがありません。管理者へ確認してください。"],
  FORBIDDEN: [403, "この操作を行う権限がありません。"],
  NOT_FOUND: [404, "対象が見つからないか、閲覧権限がありません。"],
  CONFLICT: [409, "他の担当者が更新しました。再読み込みして内容を確認してください。"],
  ARCHIVED: [409, "保管済みの顧客・案件は編集できません。保管を解除してから操作してください。"],
  IDEMPOTENCY_CONFLICT: [409, "同じ操作番号で異なる更新はできません。"],
  VALIDATION_ERROR: [422, "入力内容を確認してください。"],
  SERVICE_UNAVAILABLE: [503, "認証サービスはまだ設定されていません。"],
};

export function createApp(dependencies: AppDependencies) {
  const app = new Hono<AppEnv>();
  app.use("/api/*", async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    await next();
  });
  app.onError((error, c) => {
    const code =
      error instanceof DomainError
        ? error.code
        : error instanceof ZodError
          ? "VALIDATION_ERROR"
          : "INTERNAL_ERROR";
    const [status, message] = errors[code] ?? [
      500,
      "処理を完了できませんでした。問い合わせ番号を管理者へお伝えください。",
    ];
    // Request bodies, tokens and evidence URLs must never appear in error responses/logs.
    return c.json(
      {
        error: { code: errors[code] ? code : "INTERNAL_ERROR", message },
        requestId: c.get("requestId"),
      },
      status,
    );
  });
  app.get("/api/health", (c) => c.json({ status: "ok" }));
  app.use("/api/v1/*", async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ") || header.length <= 7 || header.length > 16384)
      throw new DomainError("UNAUTHORIZED");
    const claims = await dependencies.verify(header.slice(7), c.env);
    c.set(
      "principal",
      await resolvePrincipal(claims, dependencies.access(c.env), c.get("requestId")),
    );
    await next();
  });
  app.get("/api/v1/me", (c) => {
    const { id, email, role, status, customerIds } = c.get("principal");
    return c.json({
      data: { id, email, role, status, customerIds },
      requestId: c.get("requestId"),
    });
  });
  app.post("/api/v1/session/revoke", async (c) => {
    const key = z.uuid().parse(c.req.header("Idempotency-Key"));
    const result = await revokeSession(
      c.get("principal"),
      c.req.header("Authorization")!.slice(7),
      key,
      c.get("requestId"),
      dependencies.access(c.env),
      dependencies.sessions(c.env),
    );
    return c.json({ data: result, requestId: c.get("requestId") });
  });
  app.notFound((c) =>
    c.json(
      {
        error: { code: "NOT_FOUND", message: "対象が見つかりません。" },
        requestId: c.get("requestId") ?? crypto.randomUUID(),
      },
      404,
    ),
  );
  return app;
}
