import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Bindings } from "../../../app";
import { readJson } from "../../../http";
import { mutationSchema } from "../../../../shared/contracts/assessment";
import {
  addEvidenceSchema,
  editEvidenceSchema,
  reviewEvidenceSchema,
  type EvidenceCommand,
} from "../../../../shared/contracts/evidence";
import type { EvidenceRepository } from "../../assessment/domain/evidence";
import type { StandardRepository } from "../../assessment/domain/standard";
import { manageEvidence } from "../usecase/manageEvidence";

export function evidenceRoutes(
  assessments: (bindings: Bindings) => EvidenceRepository,
  standards: (bindings: Bindings) => StandardRepository,
  runtime = { now: () => new Date().toISOString(), newId: () => crypto.randomUUID() },
) {
  const app = new Hono<AppEnv>();
  for (const kind of ["add", "edit", "delete", "review"] as const) {
    const method = kind === "edit" ? "PATCH" : kind === "delete" ? "DELETE" : "POST";
    const path = `/assessments/:assessmentId/evidence${kind === "add" ? "" : "/:evidenceId"}${kind === "review" ? "/reviews/:criterionId" : ""}`;
    app.on(method, path, async (c) => {
      const body = await readJson(c);
      let command: EvidenceCommand;
      if (kind === "add") command = { kind, input: addEvidenceSchema.parse(body) };
      else {
        const evidenceId = z.uuid().parse(c.req.param("evidenceId"));
        if (kind === "edit") command = { kind, evidenceId, input: editEvidenceSchema.parse(body) };
        else if (kind === "delete")
          command = { kind, evidenceId, input: mutationSchema.parse(body) };
        else
          command = {
            kind,
            evidenceId,
            criterionId: c.req.param("criterionId")!,
            input: reviewEvidenceSchema.parse(body),
          };
      }
      return c.json({
        data: await manageEvidence(
          assessments(c.env),
          standards(c.env),
          z.uuid().parse(c.req.param("assessmentId")),
          command,
          { actorId: c.get("principal").id, requestId: c.get("requestId"), ...runtime },
        ),
        requestId: c.get("requestId"),
      });
    });
  }
  return app;
}
