import { bodyLimit } from "hono/body-limit";
import { createApp, type AppDependencies } from "./app";
import { D1CaseRepository } from "./modules/cases/adapter/d1CaseRepository";
import { D1AssessmentRepository } from "./modules/assessment/adapter/d1AssessmentRepository";
import { caseRoutes } from "./modules/cases/adapter/routes";
import { assessmentRoutes } from "./modules/assessment/adapter/routes";
import { D1StandardRepository } from "./modules/assessment/adapter/d1StandardRepository";
import { evidenceRoutes } from "./modules/evidence/adapter/routes";

// The composition root selects persistent adapters. Tests replace only external identity services.
export function createBusinessApp(dependencies: AppDependencies) {
  const app = createApp(dependencies);
  app.use(
    "/api/v1/*",
    bodyLimit({
      maxSize: 2 * 1024 * 1024,
      onError: (c) =>
        c.json(
          {
            error: { code: "PAYLOAD_TOO_LARGE", message: "送信内容が大きすぎます。" },
            requestId: c.get("requestId"),
          },
          413,
        ),
    }),
  );
  app.route(
    "/api/v1",
    evidenceRoutes(
      (bindings) => new D1AssessmentRepository(bindings.DB),
      (bindings) => new D1StandardRepository(bindings.DB),
    ),
  );
  app.route(
    "/api/v1",
    assessmentRoutes(
      (bindings) => new D1AssessmentRepository(bindings.DB),
      (bindings) => new D1StandardRepository(bindings.DB),
    ),
  );
  return app.route(
    "/api/v1",
    caseRoutes(
      (bindings) => new D1CaseRepository(bindings.DB),
      (bindings) => new D1AssessmentRepository(bindings.DB),
      (bindings) => new D1StandardRepository(bindings.DB),
    ),
  );
}
