import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Bindings } from "../../../app";
import { readJson } from "../../../http";
import {
  previewReportSchema,
  finalizeReportSchema,
  reportListSchema,
} from "../../../../shared/contracts/reports";
import { reportPreview, type ReportRepository } from "../domain/reportSnapshot";
import { finalizeReport } from "../usecase/finalizeReport";
export function reportRoutes(
  reports: (bindings: Bindings) => ReportRepository,
  now: () => string,
  newId: () => string,
) {
  const app = new Hono<AppEnv>();
  app.post("/assessments/:assessmentId/report-preview", async (c) => {
    const input = previewReportSchema.parse(await readJson(c));
    const source = await reports(c.env).source(
      z.uuid().parse(c.req.param("assessmentId")),
      c.get("principal").id,
    );
    return c.json({ data: await reportPreview(source, input), requestId: c.get("requestId") });
  });
  app.post("/assessments/:assessmentId/reports", async (c) =>
    c.json(
      {
        data: await finalizeReport(
          reports(c.env),
          z.uuid().parse(c.req.param("assessmentId")),
          finalizeReportSchema.parse(await readJson(c)),
          {
            actorId: c.get("principal").id,
            key: z.uuid().parse(c.req.header("Idempotency-Key")),
            requestId: c.get("requestId"),
          },
          now,
          newId,
        ),
        requestId: c.get("requestId"),
      },
      201,
    ),
  );
  app.get("/assessments/:assessmentId/reports", async (c) =>
    c.json({
      data: await reports(c.env).list(
        z.uuid().parse(c.req.param("assessmentId")),
        c.get("principal").id,
        reportListSchema.parse(c.req.query()),
      ),
      requestId: c.get("requestId"),
    }),
  );
  app.get("/reports/:id", async (c) =>
    c.json({
      data: await reports(c.env).get(z.uuid().parse(c.req.param("id")), c.get("principal").id),
      requestId: c.get("requestId"),
    }),
  );
  return app;
}
