import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv, Bindings } from "../../../app";
import { readJson } from "../../../http";
import {
  createCustomerSchema,
  createCaseSchema,
  patchEntitySchema,
  editScopeSchema,
  listSchema,
} from "../../../../shared/contracts/cases";
import type { CaseRepository, WriteContext } from "../domain/case";
import { createCase, updateScope } from "../usecase/manageCases";
import { operationHash, type AssessmentRepository } from "../../assessment/domain/assessment";
import type { StandardRepository } from "../../assessment/domain/standard";
import { summarize } from "../../assessment/domain/summarize";

export function caseRoutes(
  cases: (bindings: Bindings) => CaseRepository,
  assessments: (bindings: Bindings) => AssessmentRepository,
  standards: (bindings: Bindings) => StandardRepository,
) {
  const app = new Hono<AppEnv>();
  async function context(
    c: Context<AppEnv>,
    resourceId: string,
    body: Record<string, unknown>,
    key?: string,
  ): Promise<WriteContext> {
    return {
      actorId: c.get("principal").id,
      requestId: c.get("requestId"),
      key: key ?? z.uuid().parse(c.req.header("Idempotency-Key")),
      requestHash: await operationHash(c.req.method, new URL(c.req.url).pathname, resourceId, body),
    };
  }
  const id = (c: Context<AppEnv>, name: string) => z.uuid().parse(c.req.param(name));
  app.get("/customers", async (c) =>
    c.json({
      data: await cases(c.env).customers(c.get("principal").id, listSchema.parse(c.req.query())),
      requestId: c.get("requestId"),
    }),
  );
  app.get("/customers/:customerId", async (c) =>
    c.json({
      data: await cases(c.env).customer(id(c, "customerId"), c.get("principal").id),
      requestId: c.get("requestId"),
    }),
  );
  app.post("/customers", async (c) => {
    const body = createCustomerSchema.parse(await readJson(c));
    return c.json(
      {
        data: await cases(c.env).createCustomer(body.name, await context(c, "customers", body)),
        requestId: c.get("requestId"),
      },
      201,
    );
  });
  app.patch("/customers/:customerId", async (c) => {
    const customerId = id(c, "customerId"),
      body = patchEntitySchema.parse(await readJson(c));
    return c.json({
      data: await cases(c.env).patchCustomer(
        customerId,
        body,
        await context(c, customerId, body, body.mutationId),
      ),
      requestId: c.get("requestId"),
    });
  });
  app.get("/customers/:customerId/cases", async (c) =>
    c.json({
      data: await cases(c.env).cases(
        id(c, "customerId"),
        c.get("principal").id,
        listSchema.parse(c.req.query()),
      ),
      requestId: c.get("requestId"),
    }),
  );
  app.post("/customers/:customerId/cases", async (c) => {
    const customerId = id(c, "customerId"),
      body = createCaseSchema.parse(await readJson(c));
    return c.json(
      {
        data: await createCase(cases(c.env), customerId, body, await context(c, customerId, body)),
        requestId: c.get("requestId"),
      },
      201,
    );
  });
  app.get("/cases/:caseId", async (c) =>
    c.json({
      data: await cases(c.env).case(id(c, "caseId"), c.get("principal").id),
      requestId: c.get("requestId"),
    }),
  );
  app.patch("/cases/:caseId", async (c) => {
    const caseId = id(c, "caseId"),
      body = patchEntitySchema.parse(await readJson(c));
    return c.json({
      data: await cases(c.env).patchCase(
        caseId,
        body,
        await context(c, caseId, body, body.mutationId),
      ),
      requestId: c.get("requestId"),
    });
  });
  app.get("/cases/:caseId/assessments", async (c) =>
    c.json({
      data: await cases(c.env).assessments(
        id(c, "caseId"),
        c.get("principal").id,
        listSchema.parse(c.req.query()),
      ),
      requestId: c.get("requestId"),
    }),
  );
  app.patch("/assessments/:assessmentId/scope", async (c) => {
    const body = editScopeSchema.parse(await readJson(c));
    const saved = await updateScope(
      assessments(c.env),
      id(c, "assessmentId"),
      body,
      c.get("principal").id,
      c.get("requestId"),
    );
    const standard = await standards(c.env).get(saved.standardId);
    return c.json({
      data: { ...saved, ...summarize(saved.document, standard.criteria) },
      requestId: c.get("requestId"),
    });
  });
  return app;
}
