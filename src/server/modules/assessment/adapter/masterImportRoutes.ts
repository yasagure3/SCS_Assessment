import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Bindings } from "../../../app";
import { readJson } from "../../../http";
import { requireAdmin } from "../../auth/domain/authorize";
import type { AssessmentRepository } from "../domain/assessment";
import type { StandardRepository } from "../domain/standard";
import type { MasterImportRepository } from "../domain/masterImport";
import { previewMaster, commitMaster } from "../usecase/importMaster";
import { masterPreviewSchema, masterCommitSchema } from "../../../../shared/contracts/masterImport";

export function masterImportRoutes(
  assessments: (b: Bindings) => AssessmentRepository,
  standards: (b: Bindings) => StandardRepository,
  imports: (b: Bindings) => MasterImportRepository,
) {
  const app = new Hono<AppEnv>();
  app.post("/assessments/:id/master-imports/preview", async (c) => {
    requireAdmin(c.get("principal"));
    const data = await previewMaster(
      assessments(c.env),
      standards(c.env),
      z.uuid().parse(c.req.param("id")),
      c.get("principal").id,
      masterPreviewSchema.parse(await readJson(c)),
    );
    return c.json({ data, requestId: c.get("requestId") });
  });
  app.post("/assessments/:id/master-imports", async (c) => {
    requireAdmin(c.get("principal"));
    const data = await commitMaster(
      assessments(c.env),
      standards(c.env),
      imports(c.env),
      z.uuid().parse(c.req.param("id")),
      c.get("principal").id,
      c.get("requestId"),
      masterCommitSchema.parse(await readJson(c)),
    );
    return c.json({ data, requestId: c.get("requestId") }, 201);
  });
  return app;
}
