import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Bindings } from "../../../app";
import { readJson } from "../../../http";
import { editResponseSchema } from "../../../../shared/contracts/assessments";
import type { ReassessmentRepository } from "../domain/reassessment";
import type { StandardRepository } from "../domain/standard";
import { reviewAssessment, updateResponse } from "../usecase/reviewAssessment";
import type { ImportMasterRepository } from "../domain/importAssessment";
import { previewImport, commitImport } from "../usecase/commitImport";
import { previewImportSchema, commitImportSchema } from "../../../../shared/contracts/imports";
import {
  addTaskSchema,
  editTaskSchema,
  reviewTaskSchema,
  reassessmentSchema,
  comparisonQuerySchema,
  type TaskCommand,
} from "../../../../shared/contracts/improvement";
import { manageTasks } from "../usecase/manageTasks";
import { reassess, comparison } from "../usecase/reassess";
export function assessmentRoutes(
  assessments: (bindings: Bindings) => ReassessmentRepository,
  standards: (bindings: Bindings) => StandardRepository & ImportMasterRepository,
  runtime = { now: () => new Date().toISOString(), newId: () => crypto.randomUUID() },
) {
  const app = new Hono<AppEnv>();
  app.post("/cases/:caseId/reassessments", async (c) =>
    c.json(
      {
        data: await reassess(
          assessments(c.env),
          standards(c.env),
          z.uuid().parse(c.req.param("caseId")),
          reassessmentSchema.parse(await readJson(c)),
          {
            actorId: c.get("principal").id,
            requestId: c.get("requestId"),
            key: z.uuid().parse(c.req.header("Idempotency-Key")),
            ...runtime,
          },
        ),
        requestId: c.get("requestId"),
      },
      201,
    ),
  );
  app.get("/assessments/:assessmentId/comparison", async (c) => {
    const query = comparisonQuerySchema.parse(c.req.query());
    return c.json({
      data: await comparison(
        assessments(c.env),
        z.uuid().parse(c.req.param("assessmentId")),
        query.previous,
        query.previousRevision,
        c.get("principal").id,
      ),
      requestId: c.get("requestId"),
    });
  });
  for (const kind of ["add", "edit", "review"] as const) {
    app.on(
      kind === "edit" ? "PATCH" : "POST",
      `/assessments/:assessmentId/tasks${kind === "add" ? "" : "/:taskId"}${kind === "review" ? "/review" : ""}`,
      async (c) => {
        const body = await readJson(c);
        const command: TaskCommand =
          kind === "add"
            ? { kind, input: addTaskSchema.parse(body) }
            : kind === "edit"
              ? {
                  kind,
                  taskId: z.uuid().parse(c.req.param("taskId")),
                  input: editTaskSchema.parse(body),
                }
              : {
                  kind,
                  taskId: z.uuid().parse(c.req.param("taskId")),
                  input: reviewTaskSchema.parse(body),
                };
        return c.json({
          data: await manageTasks(
            assessments(c.env),
            standards(c.env),
            z.uuid().parse(c.req.param("assessmentId")),
            command,
            { actorId: c.get("principal").id, requestId: c.get("requestId"), ...runtime },
          ),
          requestId: c.get("requestId"),
        });
      },
    );
  }
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
