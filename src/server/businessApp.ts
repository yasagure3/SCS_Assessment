import { bodyLimit } from "hono/body-limit";
import { createApp, type AppDependencies } from "./app";
import { D1CaseRepository } from "./modules/cases/adapter/d1CaseRepository";
import { D1AssessmentRepository } from "./modules/assessment/adapter/d1AssessmentRepository";
import { caseRoutes } from "./modules/cases/adapter/routes";
import { accessRoutes } from "./modules/auth/adapter/routes";
import { D1AccessManagementRepository } from "./modules/auth/adapter/d1AccessManagementRepository";
import type { CognitoAdministration } from "./modules/auth/domain/accessManagement";
import type { Bindings } from "./app";
import { cognitoAdmin } from "./modules/auth/adapter/cognitoAdmin";
import { assessmentRoutes } from "./modules/assessment/adapter/routes";
import { D1StandardRepository } from "./modules/assessment/adapter/d1StandardRepository";
import { evidenceRoutes } from "./modules/evidence/adapter/routes";
import { fileRoutes } from "./modules/evidence/adapter/fileRoutes";
import { D1FileRepository } from "./modules/evidence/adapter/d1FileRepository";
import { R2EvidenceStore } from "./modules/evidence/adapter/r2EvidenceStore";
import { adviceRoutes } from "./modules/advice/adapter/routes";
import { D1AdviceRepository } from "./modules/advice/adapter/d1AdviceRepository";
import { D1AiRunRepository } from "./modules/advice/adapter/d1AiRunRepository";
import { unconfiguredAiProvider } from "./modules/advice/adapter/aiProvider";
import type { AiPort } from "./modules/advice/domain/aiPort";
import { reportRoutes } from "./modules/reports/adapter/routes";
import { D1ReportRepository } from "./modules/reports/adapter/d1ReportRepository";

// The composition root selects persistent adapters. Tests replace only external identity services.
export function createBusinessApp(
  dependencies: AppDependencies & {
    administration?: (bindings: Bindings) => CognitoAdministration;
    now?: () => number;
    ai?: (bindings: Bindings) => AiPort;
    aiTimeoutMs?: number;
  },
) {
  const app = createApp(dependencies);
  // The file route counts/cancels its binary stream before the JSON body limiter.
  app.route(
    "/api/v1",
    fileRoutes(
      (b) => new D1FileRepository(b.DB),
      (b) => new R2EvidenceStore(b.EVIDENCE_BUCKET),
    ),
  );
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
    adviceRoutes(
      (bindings) => new D1AssessmentRepository(bindings.DB),
      (bindings) => new D1StandardRepository(bindings.DB),
      (bindings) => new D1AdviceRepository(bindings.DB),
      dependencies.now ?? Date.now,
      (bindings) => new D1AiRunRepository(bindings.DB, dependencies.now ?? Date.now),
      dependencies.ai ?? unconfiguredAiProvider,
      dependencies.aiTimeoutMs,
    ),
  );
  app.route(
    "/api/v1",
    reportRoutes(
      (bindings) => new D1ReportRepository(bindings.DB),
      () => new Date((dependencies.now ?? Date.now)()).toISOString(),
      () => crypto.randomUUID(),
    ),
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
    accessRoutes(
      (bindings) => new D1AccessManagementRepository(bindings.DB, dependencies.now ?? Date.now),
      dependencies.administration ?? (() => cognitoAdmin()),
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
