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
  EVIDENCE_BUCKET: R2Bucket;
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
  AI_STALE: [409, "回答・範囲・証跡が変わりました。送信内容を確認し直してください。"],
  AI_INPUT_CHANGED: [422, "送信内容が確認時と異なります。全文を確認し直してください。"],
  AI_NOT_READY: [409, "AI下書きを採用できる状態ではありません。生成状態を確認してください。"],
  AI_RATE_LIMIT: [429, "AI生成は同時に1件、1分に5回までです。少し待ってから試してください。"],
  FILE_INVALID: [
    422,
    "ファイルの形式を確認してください。暗号化・マクロ・外部参照を含む文書は登録できません。",
  ],
  FILE_HASH_MISMATCH: [422, "ファイルの照合に失敗しました。選び直して送信してください。"],
  FILE_NOT_READY: [409, "このファイルは取得できません。登録状態を確認してください。"],
  FILE_UPLOAD_FAILED: [422, "送信が完了しませんでした。ファイルを選び直してください。"],
  FILE_STORAGE_FAILED: [
    502,
    "ファイルの保存・取得を完了できませんでした。時間を置いてやり直してください。",
  ],
  PROVIDER_TIMEOUT: [
    504,
    "招待処理が時間内に完了しませんでした。招待一覧で状態を確認してください。",
  ],
  LAST_ADMIN: [409, "最後の有効な管理者は停止・降格できません。"],
  INVITATION_EXISTS: [409, "このメールアドレスは登録済みです。招待一覧を確認してください。"],
  INVITATION_NOT_RETRYABLE: [409, "この招待は再発行できません。状態を再読み込みしてください。"],
  PROVIDER_FAILED: [
    502,
    "招待を送信できませんでした。招待一覧から状態を確認し、明示的に再発行してください。",
  ],
  MALFORMED_JSON: [400, "JSONの形式を確認してください。"],
  UNAUTHORIZED: [401, "ログインし直してください。"],
  ACCOUNT_DISABLED: [403, "利用可能な招待またはアカウントがありません。管理者へ確認してください。"],
  FORBIDDEN: [403, "この操作を行う権限がありません。"],
  NOT_FOUND: [404, "対象が見つからないか、閲覧権限がありません。"],
  CONFLICT: [409, "他の担当者が更新しました。再読み込みして内容を確認してください。"],
  ARCHIVED: [409, "保管済みの顧客・案件は編集できません。保管を解除してから操作してください。"],
  IDEMPOTENCY_CONFLICT: [409, "同じ操作番号で異なる更新はできません。"],
  VALIDATION_ERROR: [422, "入力内容を確認してください。"],
  IMPORT_NOT_EMPTY: [
    409,
    "この診断は取込済み、または回答を手動保存済みです。新しい診断へ取り込んでください。",
  ],
  PAYLOAD_TOO_LARGE: [413, "送信内容が大きすぎます。"],
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
    if (code === "AI_RATE_LIMIT") c.header("Retry-After", "60");
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
