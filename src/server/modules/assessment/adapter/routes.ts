import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Bindings } from "../../../app";
import { readJson } from "../../../http";
import { editResponseSchema } from "../../../../shared/contracts/assessments";
import type { AssessmentRepository } from "../domain/assessment";
import type { StandardRepository } from "../domain/standard";
import { reviewAssessment, updateResponse } from "../usecase/reviewAssessment";
import type { ImportMasterRepository } from "../domain/importAssessment";
import { previewImport, commitImport } from "../usecase/commitImport";
import { previewImportSchema, commitImportSchema } from "../../../../shared/contracts/imports";
export function assessmentRoutes(
  assessments: (bindings: Bindings) => AssessmentRepository,
  standards: (bindings: Bindings) => StandardRepository & ImportMasterRepository,
) {
  const app = new Hono<AppEnv>();
  app.get("/standards/:id/import-master", async (c) =>
    c.json({
      data: await standards(c.env).getImportMaster(c.req.param("id")),
      requestId: c.get("requestId"),
    }),
  );
  app.post("/assessments/:assessmentId/imports/preview", async (c) =>
    c.json({
      data: await previewImport(
        assessments(c.env),
        standards(c.env),
        z.uuid().parse(c.req.param("assessmentId")),
        c.get("principal").id,
        previewImportSchema.parse(await readJson(c)),
      ),
      requestId: c.get("requestId"),
    }),
  );
  app.post("/assessments/:assessmentId/imports", async (c) =>
    c.json({
      data: await commitImport(
        assessments(c.env),
        standards(c.env),
        standards(c.env),
        z.uuid().parse(c.req.param("assessmentId")),
        c.get("principal").id,
        c.get("requestId"),
        commitImportSchema.parse(await readJson(c)),
        () => new Date().toISOString(),
      ),
      requestId: c.get("requestId"),
    }),
  );
  app.get("/standards/:id", async (c) =>
    c.json({ data: await standards(c.env).get(c.req.param("id")), requestId: c.get("requestId") }),
  );
  app.get("/assessments/:assessmentId", async (c) =>
    c.json({
      data: await reviewAssessment(
        assessments(c.env),
        standards(c.env),
        z.uuid().parse(c.req.param("assessmentId")),
        c.get("principal").id,
      ),
      requestId: c.get("requestId"),
    }),
  );
  app.patch("/assessments/:assessmentId/responses/:criterionId", async (c) => {
    const input = editResponseSchema.parse(await readJson(c));
    return c.json({
      data: await updateResponse(
        assessments(c.env),
        standards(c.env),
        z.uuid().parse(c.req.param("assessmentId")),
        c.req.param("criterionId"),
        input,
        c.get("principal").id,
        c.get("requestId"),
      ),
      requestId: c.get("requestId"),
    });
  });
  return app;
}
