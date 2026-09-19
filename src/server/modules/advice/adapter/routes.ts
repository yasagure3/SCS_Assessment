import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Bindings } from "../../../app";
import { readJson } from "../../../http";
import { draftAdviceSchema, confirmAdviceSchema } from "../../../../shared/contracts/advice";
import type { AssessmentRepository } from "../../assessment/domain/assessment";
import type { StandardRepository } from "../../assessment/domain/standard";
import type { AdviceTemplateRepository } from "../domain/templates";
import { updateAdvice } from "../usecase/manualAdvice";

export function adviceRoutes(
  assessments: (bindings: Bindings) => AssessmentRepository,
  standards: (bindings: Bindings) => StandardRepository,
  templates: (bindings: Bindings) => AdviceTemplateRepository,
  now: () => number,
) {
  const app = new Hono<AppEnv>();
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
