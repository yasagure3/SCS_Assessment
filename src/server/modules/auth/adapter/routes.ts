import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv, Bindings } from "../../../app";
import { readJson } from "../../../http";
import { inviteSchema, updateUserSchema, membersSchema } from "../../../../shared/contracts/access";
import { listSchema } from "../../../../shared/contracts/cases";
import { requireAdmin } from "../domain/authorize";
import type {
  AccessManagementRepository,
  CognitoAdministration,
  AccessWriteContext,
} from "../domain/accessManagement";
import { operationHash } from "../../assessment/domain/assessment";
import { issueInvitation } from "../usecase/manageAccess";

export function accessRoutes(
  repository: (bindings: Bindings) => AccessManagementRepository,
  administration: (bindings: Bindings) => CognitoAdministration,
) {
  const app = new Hono<AppEnv>();
  async function context(
    c: Context<AppEnv>,
    resourceId: string,
    body: Record<string, unknown>,
    key?: string,
  ): Promise<AccessWriteContext> {
    return {
      actorId: c.get("principal").id,
      requestId: c.get("requestId"),
      key: key ?? z.uuid().parse(c.req.header("Idempotency-Key")),
      requestHash: await operationHash(c.req.method, new URL(c.req.url).pathname, resourceId, body),
    };
  }
  app.use("/users/*", async (c, next) => {
    requireAdmin(c.get("principal"));
    await next();
  });
  app.get("/users", async (c) => {
    requireAdmin(c.get("principal"));
    return c.json({
      data: await repository(c.env).users(c.get("principal").id, listSchema.parse(c.req.query())),
      requestId: c.get("requestId"),
    });
  });
  app.get("/users/invitations", async (c) =>
    c.json({
      data: await repository(c.env).invitations(
        c.get("principal").id,
        listSchema.parse(c.req.query()),
      ),
      requestId: c.get("requestId"),
    }),
  );
  app.post("/users/invitations", async (c) => {
    const body = inviteSchema.parse(await readJson(c)),
      write = await context(c, "invitations", body),
      repo = repository(c.env),
      id = await repo.reserve(body, write);
    return c.json(
      {
        data: await issueInvitation(repo, administration(c.env), id, false, write),
        requestId: c.get("requestId"),
      },
      201,
    );
  });
  app.post("/users/invitations/:id/retry", async (c) => {
    const id = z.uuid().parse(c.req.param("id")),
      write = await context(c, id, {});
    return c.json({
      data: await issueInvitation(repository(c.env), administration(c.env), id, true, write),
      requestId: c.get("requestId"),
    });
  });
  app.patch("/users/:id", async (c) => {
    const id = z.uuid().parse(c.req.param("id")),
      body = updateUserSchema.parse(await readJson(c));
    return c.json({
      data: await repository(c.env).updateUser(
        id,
        body,
        await context(c, id, body, body.mutationId),
      ),
      requestId: c.get("requestId"),
    });
  });
  app.get("/customers/:id/members", async (c) => {
    requireAdmin(c.get("principal"));
    return c.json({
      data: await repository(c.env).members(
        z.uuid().parse(c.req.param("id")),
        c.get("principal").id,
      ),
      requestId: c.get("requestId"),
    });
  });
  app.put("/customers/:id/members", async (c) => {
    requireAdmin(c.get("principal"));
    const id = z.uuid().parse(c.req.param("id")),
      body = membersSchema.parse(await readJson(c));
    return c.json({
      data: await repository(c.env).replaceMembers(
        id,
        body,
        await context(c, id, body, body.mutationId),
      ),
      requestId: c.get("requestId"),
    });
  });
  return app;
}
