import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  unique,
  foreignKey,
  index,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import type { AssessmentDocument } from "../../shared/contracts/assessment";

// CHECKs and immutable/history triggers are maintained in numbered SQL migrations.
const id = () => text("id").primaryKey();
const required = (name: string) => text(name).notNull();
const revision = () => integer("revision").notNull();
const stamps = () => ({ createdAt: required("created_at"), updatedAt: required("updated_at") });
export const appUsers = sqliteTable("app_users", {
  id: id(),
  cognitoSub: text("cognito_sub").unique(),
  emailNormalized: required("email_normalized").unique(),
  role: text("role", { enum: ["admin", "staff"] }).notNull(),
  status: text("status", { enum: ["invited", "active", "suspended"] }).notNull(),
  revokedBefore: integer("revoked_before"),
  revision: revision().default(1),
  ...stamps(),
});
export const authRevocations = sqliteTable(
  "auth_revocations",
  {
    id: id(),
    userId: required("user_id").references(() => appUsers.id),
    revokedBefore: integer("revoked_before").notNull(),
    status: text("status", { enum: ["pending", "processing", "succeeded", "failed"] }).notNull(),
    errorCode: text("error_code"),
    requestId: required("request_id"),
    ...stamps(),
  },
  (table) => [index("auth_revocations_pending").on(table.status, table.createdAt)],
);
export const customers = sqliteTable("customers", {
  id: id(),
  name: required("name"),
  archivedAt: text("archived_at"),
  revision: revision(),
  createdBy: required("created_by").references(() => appUsers.id),
  ...stamps(),
});
export const customerMemberships = sqliteTable(
  "customer_memberships",
  {
    customerId: required("customer_id").references(() => customers.id),
    userId: required("user_id").references(() => appUsers.id),
    createdBy: required("created_by").references(() => appUsers.id),
    createdAt: required("created_at"),
  },
  (t) => [
    primaryKey({ columns: [t.customerId, t.userId] }),
    index("memberships_user").on(t.userId, t.customerId),
  ],
);
export const cases = sqliteTable(
  "cases",
  {
    id: id(),
    customerId: required("customer_id").references(() => customers.id),
    name: required("name"),
    archivedAt: text("archived_at"),
    revision: revision(),
    createdBy: required("created_by").references(() => appUsers.id),
    ...stamps(),
  },
  (t) => [
    unique().on(t.id, t.customerId),
    index("cases_customer").on(t.customerId, t.updatedAt, t.id),
  ],
);
export const standards = sqliteTable("standards", {
  id: id(),
  publicationDate: required("publication_date"),
  level: integer("level").notNull(),
  sourceUrl: required("source_url"),
  sourceSha256: required("source_sha256"),
  contentSha256: required("content_sha256"),
  expectedCount: integer("expected_count").notNull(),
  sealedAt: text("sealed_at"),
});
export const criteria = sqliteTable(
  "criteria",
  {
    standardId: required("standard_id").references(() => standards.id),
    criterionId: required("criterion_id"),
    requirementId: required("requirement_id"),
    category: required("category"),
    orderNo: integer("order_no").notNull(),
    requirementText: required("requirement_text"),
    officialText: required("official_text"),
    sourceRow: integer("source_row").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.standardId, t.criterionId] }),
    unique().on(t.standardId, t.orderNo),
  ],
);
export const adviceTemplates = sqliteTable(
  "advice_templates",
  {
    id: id(),
    standardId: required("standard_id"),
    criterionId: required("criterion_id"),
    version: integer("version").notNull(),
    gap: required("gap"),
    steps: text("steps", { mode: "json" }).$type<string[]>().notNull(),
    evidenceExamples: text("evidence_examples", { mode: "json" }).$type<string[]>().notNull(),
    completionCheck: required("completion_check"),
    sourceUrls: text("source_urls", { mode: "json" }).$type<string[]>().notNull(),
    contentSha256: required("content_sha256"),
    sealedAt: text("sealed_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.standardId, t.criterionId],
      foreignColumns: [criteria.standardId, criteria.criterionId],
    }),
    unique().on(t.standardId, t.criterionId, t.version),
  ],
);
export const assessments = sqliteTable(
  "assessments",
  {
    id: id(),
    caseId: required("case_id"),
    customerId: required("customer_id"),
    standardId: required("standard_id").references(() => standards.id),
    previousAssessmentId: text("previous_assessment_id").references(
      (): AnySQLiteColumn => assessments.id,
    ),
    revision: revision(),
    document: text("document_json", { mode: "json" }).$type<AssessmentDocument>().notNull(),
    mutationId: required("mutation_id"),
    requestHash: required("request_hash"),
    actorId: required("actor_id").references(() => appUsers.id),
    ...stamps(),
  },
  (t) => [
    foreignKey({ columns: [t.caseId, t.customerId], foreignColumns: [cases.id, cases.customerId] }),
    unique().on(t.id, t.customerId),
    index("assessments_case").on(t.caseId, t.createdAt, t.id),
  ],
);
export const assessmentRevisions = sqliteTable(
  "assessment_revisions",
  {
    assessmentId: required("assessment_id").references(() => assessments.id),
    revision: revision(),
    document: text("document_json", { mode: "json" }).$type<AssessmentDocument>().notNull(),
    mutationId: required("mutation_id"),
    requestHash: required("request_hash"),
    actorId: required("actor_id").references(() => appUsers.id),
    createdAt: required("created_at"),
  },
  (t) => [
    primaryKey({ columns: [t.assessmentId, t.revision] }),
    unique().on(t.actorId, t.mutationId),
  ],
);
export const files = sqliteTable(
  "files",
  {
    id: id(),
    customerId: required("customer_id"),
    caseId: required("case_id"),
    objectKey: required("object_key").unique(),
    originalName: required("original_name"),
    mime: required("mime"),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: required("sha256"),
    status: text("status", { enum: ["uploading", "ready", "rejected"] }).notNull(),
    createdBy: required("created_by").references(() => appUsers.id),
    createdAt: required("created_at"),
  },
  (t) => [
    foreignKey({ columns: [t.caseId, t.customerId], foreignColumns: [cases.id, cases.customerId] }),
  ],
);
export const reports = sqliteTable(
  "reports",
  {
    id: id(),
    assessmentId: required("assessment_id"),
    customerId: required("customer_id"),
    assessmentRevision: integer("assessment_revision").notNull(),
    snapshotJson: required("snapshot_json"),
    snapshotSha256: required("snapshot_sha256"),
    schemaVersion: integer("schema_version").notNull(),
    rendererVersion: required("renderer_version"),
    createdBy: required("created_by").references(() => appUsers.id),
    createdAt: required("created_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.assessmentId, t.customerId],
      foreignColumns: [assessments.id, assessments.customerId],
    }),
    foreignKey({
      columns: [t.assessmentId, t.assessmentRevision],
      foreignColumns: [assessmentRevisions.assessmentId, assessmentRevisions.revision],
    }),
    index("reports_assessment").on(t.assessmentId, t.createdAt, t.id),
  ],
);
export const invitations = sqliteTable("invitations", {
  id: id(),
  userId: required("user_id").references(() => appUsers.id),
  status: text("status", {
    enum: ["pending", "processing", "sent", "failed", "expired"],
  }).notNull(),
  expiresAt: required("expires_at"),
  providerRequestId: text("provider_request_id"),
  attemptId: text("attempt_id"),
  processingStartedAt: text("processing_started_at"),
  lastErrorCode: text("last_error_code"),
  createdBy: required("created_by").references(() => appUsers.id),
  createdAt: required("created_at"),
});
export const aiRuns = sqliteTable(
  "ai_runs",
  {
    id: id(),
    assessmentId: required("assessment_id").references(() => assessments.id),
    criterionId: required("criterion_id"),
    inputHash: required("input_hash"),
    basisHash: required("basis_hash"),
    status: text("status", {
      enum: ["pending", "running", "succeeded", "failed", "stale"],
    }).notNull(),
    providerModel: text("provider_model"),
    draftJson: text("draft_json"),
    requestedBy: required("requested_by").references(() => appUsers.id),
    createdAt: required("created_at"),
  },
  (t) => [index("ai_runs_assessment").on(t.assessmentId, t.createdAt)],
);
export const operationReceipts = sqliteTable(
  "operation_receipts",
  {
    actorId: required("actor_id").references(() => appUsers.id),
    operationKey: required("operation_key"),
    requestHash: required("request_hash"),
    resourceId: required("resource_id"),
    reservationId: required("reservation_id").unique(),
    responseJson: required("response_json"),
    createdAt: required("created_at"),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.operationKey] })],
);
export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: id(),
    actorId: required("actor_id").references(() => appUsers.id),
    customerId: text("customer_id").references(() => customers.id),
    action: required("action"),
    resourceType: required("resource_type"),
    resourceId: required("resource_id"),
    fromRevision: integer("from_revision"),
    toRevision: integer("to_revision"),
    requestId: required("request_id"),
    createdAt: required("created_at"),
  },
  (t) => [index("audit_resource").on(t.resourceType, t.resourceId, t.createdAt)],
);
