import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Bindings } from "../../../app";
import { readJson } from "../../../http";
import { draftAdviceSchema, confirmAdviceSchema } from "../../../../shared/contracts/advice";
import type { AssessmentRepository } from "../../assessment/domain/assessment";
import type { StandardRepository } from "../../assessment/domain/standard";
import type { AdviceTemplateRepository } from "../domain/templates";
import { updateAdvice } from "../usecase/manualAdvice";
import {
  generateAiSchema,
  adoptAiSchema,
  type AiRunDto,
} from "../../../../shared/contracts/aiAdvice";
import type { AiPort, AiRunRepository } from "../domain/aiPort";
import { generateAdvice, adoptAiAdvice } from "../usecase/generateAdvice";

export function adviceRoutes(
  assessments: (bindings: Bindings) => AssessmentRepository,
  standards: (bindings: Bindings) => StandardRepository,
  templates: (bindings: Bindings) => AdviceTemplateRepository,
  now: () => number,
  runs: (bindings: Bindings) => AiRunRepository,
  ai: (bindings: Bindings) => AiPort,
  timeoutMs = 30000,
) {
  const app = new Hono<AppEnv>();
  app.post("/assessments/:assessmentId/advice/:criterionId/ai-runs", async (c) => {
    const input = generateAiSchema.parse(await readJson(c));
    const run = await generateAdvice(
      assessments(c.env),
      standards(c.env),
      runs(c.env),
      ai(c.env),
      z.uuid().parse(c.req.param("assessmentId")),
      c.req.param("criterionId"),
      input,
      c.get("principal").id,
      z.uuid().parse(c.req.header("Idempotency-Key")),
      c.get("requestId"),
      timeoutMs,
    );
    const failure = runFailure(run);
    return failure
      ? c.json(
          { error: { ...failure.error, runId: run.runId }, requestId: c.get("requestId") },
          failure.status,
        )
      : c.json({ data: run, requestId: c.get("requestId") });
  });
  app.get("/assessments/:assessmentId/ai-runs/:id", async (c) => {
    const run = await runs(c.env).get(
      z.uuid().parse(c.req.param("assessmentId")),
      z.uuid().parse(c.req.param("id")),
      c.get("principal").id,
    );
    if (run.status === "stale")
      return c.json(
        {
          error: {
            code: "AI_STALE",
            message: "回答・範囲・証跡が変わりました。送信内容を確認し直してください。",
            runId: run.runId,
          },
          requestId: c.get("requestId"),
        },
        409,
      );
    return c.json({ data: run, requestId: c.get("requestId") });
  });
  app.post("/assessments/:assessmentId/advice/:criterionId/adopt-ai", async (c) =>
    c.json({
      data: await adoptAiAdvice(
        assessments(c.env),
        standards(c.env),
        runs(c.env),
        z.uuid().parse(c.req.param("assessmentId")),
        c.req.param("criterionId"),
        adoptAiSchema.parse(await readJson(c)),
        c.get("principal").id,
        c.get("requestId"),
      ),
      requestId: c.get("requestId"),
    }),
  );
  app.get("/standards/:id/advice-templates", async (c) => {
    const standard = await standards(c.env).get(c.req.param("id"));
    return c.json({
      data: { items: await templates(c.env).list(standard.id) },
      requestId: c.get("requestId"),
    });
  });
  for (const action of ["draft", "confirm"] as const) {
    app.on(
      action === "draft" ? "PUT" : "POST",
      `/assessments/:assessmentId/advice/:criterionId/${action}`,
      async (c) => {
        const input = (action === "draft" ? draftAdviceSchema : confirmAdviceSchema).parse(
          await readJson(c),
        );
        return c.json({
          data: await updateAdvice(
            assessments(c.env),
            standards(c.env),
            templates(c.env),
            z.uuid().parse(c.req.param("assessmentId")),
            c.req.param("criterionId"),
            input,
            action,
            c.get("principal").id,
            c.get("requestId"),
            now,
          ),
          requestId: c.get("requestId"),
        });
      },
    );
  }
  return app;
}

function runFailure(run: AiRunDto) {
  const failures = {
    AI_NOT_CONFIGURED: { status: 503, message: "AIは未設定です。定型助言と手入力を利用できます。" },
    AI_TIMEOUT: {
      status: 504,
      message: "AI生成が時間内に完了しませんでした。状態を確認してから新しい試行を選べます。",
    },
    AI_PROVIDER_FAILED: {
      status: 502,
      message: "AI生成に失敗しました。手入力は保持されています。",
    },
    AI_INVALID_OUTPUT: {
      status: 502,
      message: "AIの応答形式を確認できませんでした。手入力は保持されています。",
    },
    AI_STALE: {
      status: 409,
      message: "回答・範囲・証跡が変わりました。送信内容を確認し直してください。",
    },
  } as const;
  const code =
    run.status === "stale"
      ? "AI_STALE"
      : run.status === "failed"
        ? (run.errorCode ?? "AI_PROVIDER_FAILED")
        : null;
  if (!code) return null;
  const failure = failures[code as keyof typeof failures] ?? failures.AI_PROVIDER_FAILED;
  return { status: failure.status, error: { code, message: failure.message } };
}
