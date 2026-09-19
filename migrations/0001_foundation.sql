PRAGMA foreign_keys = ON;

CREATE TABLE app_users (
 id TEXT PRIMARY KEY, cognito_sub TEXT UNIQUE, email_normalized TEXT NOT NULL UNIQUE,
 role TEXT NOT NULL CHECK(role IN ('admin','staff')),
 status TEXT NOT NULL CHECK(status IN ('invited','active','suspended')),
 revoked_before INTEGER, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE customers (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 archived_at TEXT, revision INTEGER NOT NULL CHECK(revision>=1),
 created_by TEXT NOT NULL REFERENCES app_users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE customer_memberships (
 customer_id TEXT NOT NULL REFERENCES customers(id), user_id TEXT NOT NULL REFERENCES app_users(id),
 created_by TEXT NOT NULL REFERENCES app_users(id), created_at TEXT NOT NULL,
 PRIMARY KEY(customer_id,user_id)
);
CREATE INDEX memberships_user ON customer_memberships(user_id,customer_id);
CREATE TABLE cases (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200), archived_at TEXT,
 revision INTEGER NOT NULL CHECK(revision>=1), created_by TEXT NOT NULL REFERENCES app_users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(id,customer_id)
);
CREATE INDEX cases_customer ON cases(customer_id,updated_at,id);
CREATE TABLE standards (
 id TEXT PRIMARY KEY, publication_date TEXT NOT NULL, level INTEGER NOT NULL CHECK(level=3),
 source_url TEXT NOT NULL, source_sha256 TEXT NOT NULL, content_sha256 TEXT NOT NULL,
 expected_count INTEGER NOT NULL CHECK(expected_count=81), sealed_at TEXT
);
CREATE TABLE criteria (
 standard_id TEXT NOT NULL REFERENCES standards(id), criterion_id TEXT NOT NULL,
 requirement_id TEXT NOT NULL, category TEXT NOT NULL, order_no INTEGER NOT NULL CHECK(order_no BETWEEN 1 AND 81),
 requirement_text TEXT NOT NULL, official_text TEXT NOT NULL, source_row INTEGER NOT NULL,
 PRIMARY KEY(standard_id,criterion_id), UNIQUE(standard_id,order_no)
);
CREATE TABLE advice_templates (
 id TEXT PRIMARY KEY, standard_id TEXT NOT NULL, criterion_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1),
 gap TEXT NOT NULL, steps TEXT NOT NULL CHECK(json_valid(steps)), evidence_examples TEXT NOT NULL CHECK(json_valid(evidence_examples)),
 completion_check TEXT NOT NULL, source_urls TEXT NOT NULL CHECK(json_valid(source_urls)), content_sha256 TEXT NOT NULL, sealed_at TEXT,
 FOREIGN KEY(standard_id,criterion_id) REFERENCES criteria(standard_id,criterion_id), UNIQUE(standard_id,criterion_id,version)
);
CREATE TABLE assessments (
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 standard_id TEXT NOT NULL REFERENCES standards(id), previous_assessment_id TEXT REFERENCES assessments(id),
 revision INTEGER NOT NULL CHECK(revision>=1),
 document_json TEXT NOT NULL CHECK(json_valid(document_json) AND length(CAST(document_json AS BLOB))<=1048576),
 mutation_id TEXT NOT NULL, request_hash TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES app_users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(case_id,customer_id) REFERENCES cases(id,customer_id), UNIQUE(id,customer_id)
);
CREATE INDEX assessments_case ON assessments(case_id,created_at,id);
CREATE TABLE assessment_revisions (
 assessment_id TEXT NOT NULL REFERENCES assessments(id), revision INTEGER NOT NULL,
 document_json TEXT NOT NULL, mutation_id TEXT NOT NULL, request_hash TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES app_users(id), created_at TEXT NOT NULL,
 PRIMARY KEY(assessment_id,revision), UNIQUE(actor_id,mutation_id)
);
CREATE TABLE files (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, case_id TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL, mime TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760), sha256 TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('uploading','ready','rejected')),
 created_by TEXT NOT NULL REFERENCES app_users(id), created_at TEXT NOT NULL,
 FOREIGN KEY(case_id,customer_id) REFERENCES cases(id,customer_id)
);
CREATE TABLE reports (
 id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL, customer_id TEXT NOT NULL, assessment_revision INTEGER NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND length(CAST(snapshot_json AS BLOB))<=1572864),
 snapshot_sha256 TEXT NOT NULL, schema_version INTEGER NOT NULL, renderer_version TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES app_users(id), created_at TEXT NOT NULL,
 FOREIGN KEY(assessment_id,customer_id) REFERENCES assessments(id,customer_id),
 FOREIGN KEY(assessment_id,assessment_revision) REFERENCES assessment_revisions(assessment_id,revision)
);
CREATE INDEX reports_assessment ON reports(assessment_id,created_at,id);
CREATE TABLE invitations (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES app_users(id),
 status TEXT NOT NULL CHECK(status IN ('pending','processing','sent','failed','expired')),
 expires_at TEXT NOT NULL, provider_request_id TEXT, last_error_code TEXT,
 created_by TEXT NOT NULL REFERENCES app_users(id), created_at TEXT NOT NULL
);
CREATE TABLE ai_runs (
 id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL REFERENCES assessments(id), criterion_id TEXT NOT NULL,
 input_hash TEXT NOT NULL, basis_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed','stale')),
 provider_model TEXT, draft_json TEXT, requested_by TEXT NOT NULL REFERENCES app_users(id), created_at TEXT NOT NULL
);
CREATE INDEX ai_runs_assessment ON ai_runs(assessment_id,created_at);
CREATE TABLE operation_receipts (
 actor_id TEXT NOT NULL REFERENCES app_users(id), operation_key TEXT NOT NULL, request_hash TEXT NOT NULL,
 resource_id TEXT NOT NULL, reservation_id TEXT NOT NULL UNIQUE,
 response_json TEXT NOT NULL CHECK(json_valid(response_json) AND length(CAST(response_json AS BLOB))<=1572864),
 created_at TEXT NOT NULL, PRIMARY KEY(actor_id,operation_key)
);
CREATE TABLE audit_events (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES app_users(id), customer_id TEXT REFERENCES customers(id),
 action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
 from_revision INTEGER, to_revision INTEGER, request_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX audit_resource ON audit_events(resource_type,resource_id,created_at);

CREATE TRIGGER standard_seal_count BEFORE UPDATE ON standards
WHEN NEW.sealed_at IS NOT NULL AND (SELECT count(*) FROM criteria WHERE standard_id=NEW.id)!=NEW.expected_count
BEGIN SELECT RAISE(ABORT,'incomplete_standard'); END;
CREATE TRIGGER standards_no_update BEFORE UPDATE ON standards WHEN OLD.sealed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'immutable_standard'); END;
CREATE TRIGGER standards_no_delete BEFORE DELETE ON standards
BEGIN SELECT RAISE(ABORT,'immutable_standard'); END;
CREATE TRIGGER criteria_no_insert BEFORE INSERT ON criteria WHEN (SELECT sealed_at FROM standards WHERE id=NEW.standard_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT,'immutable_criteria'); END;
CREATE TRIGGER criteria_no_update BEFORE UPDATE ON criteria
BEGIN SELECT RAISE(ABORT,'immutable_criteria'); END;
CREATE TRIGGER criteria_no_delete BEFORE DELETE ON criteria
BEGIN SELECT RAISE(ABORT,'immutable_criteria'); END;
CREATE TRIGGER advice_no_update BEFORE UPDATE ON advice_templates WHEN OLD.sealed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'immutable_template'); END;
CREATE TRIGGER advice_no_delete BEFORE DELETE ON advice_templates
BEGIN SELECT RAISE(ABORT,'immutable_template'); END;

CREATE TRIGGER validate_assessment_insert BEFORE INSERT ON assessments
WHEN json_extract(NEW.document_json,'$.schemaVersion') IS NOT 1
 OR (SELECT count(DISTINCT key) FROM json_each(NEW.document_json,'$.responses'))!=81
 OR (SELECT count(*) FROM json_each(NEW.document_json,'$.responses'))!=81
 OR EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.responses') r WHERE NOT EXISTS(SELECT 1 FROM criteria c WHERE c.standard_id=NEW.standard_id AND c.criterion_id=r.key))
 OR (NEW.previous_assessment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM assessments a WHERE a.id=NEW.previous_assessment_id AND a.case_id=NEW.case_id AND a.standard_id=NEW.standard_id))
BEGIN SELECT RAISE(ABORT,'invalid_assessment'); END;
CREATE TRIGGER validate_assessment_update BEFORE UPDATE ON assessments
WHEN NEW.revision!=OLD.revision+1 OR NEW.id!=OLD.id OR NEW.case_id!=OLD.case_id
 OR NEW.customer_id!=OLD.customer_id OR NEW.standard_id!=OLD.standard_id OR NEW.previous_assessment_id IS NOT OLD.previous_assessment_id
 OR NEW.created_at!=OLD.created_at OR json_extract(NEW.document_json,'$.schemaVersion') IS NOT 1
 OR (SELECT count(DISTINCT key) FROM json_each(NEW.document_json,'$.responses'))!=81
 OR (SELECT count(*) FROM json_each(NEW.document_json,'$.responses'))!=81
 OR EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.responses') r WHERE NOT EXISTS(SELECT 1 FROM criteria c WHERE c.standard_id=NEW.standard_id AND c.criterion_id=r.key))
 OR EXISTS(SELECT 1 FROM json_each(OLD.document_json,'$.responses') o JOIN json_each(NEW.document_json,'$.responses') n ON n.key=o.key WHERE (json_extract(OLD.document_json,'$.importInfo') IS NOT NULL OR json_extract(o.value,'$.original') IS NOT NULL) AND json_extract(o.value,'$.original') IS NOT json_extract(n.value,'$.original'))
 OR (json_extract(OLD.document_json,'$.importInfo') IS NOT NULL AND json_extract(OLD.document_json,'$.importInfo') IS NOT json_extract(NEW.document_json,'$.importInfo'))
 OR EXISTS(SELECT 1 FROM json_each(OLD.document_json,'$.responses') o JOIN json_each(NEW.document_json,'$.responses') n ON n.key=o.key WHERE json_extract(n.value,'$.adviceBasisVersion')<json_extract(o.value,'$.adviceBasisVersion'))
BEGIN SELECT RAISE(ABORT,'invalid_assessment_update'); END;
CREATE TRIGGER record_assessment_insert AFTER INSERT ON assessments BEGIN
 INSERT INTO assessment_revisions VALUES(NEW.id,NEW.revision,NEW.document_json,NEW.mutation_id,NEW.request_hash,NEW.actor_id,NEW.updated_at);
END;
CREATE TRIGGER record_assessment_update AFTER UPDATE ON assessments BEGIN
 INSERT INTO assessment_revisions VALUES(NEW.id,NEW.revision,NEW.document_json,NEW.mutation_id,NEW.request_hash,NEW.actor_id,NEW.updated_at);
END;
CREATE TRIGGER history_no_update BEFORE UPDATE ON assessment_revisions BEGIN SELECT RAISE(ABORT,'immutable_history'); END;
CREATE TRIGGER history_no_delete BEFORE DELETE ON assessment_revisions BEGIN SELECT RAISE(ABORT,'immutable_history'); END;
CREATE TRIGGER assessment_no_delete BEFORE DELETE ON assessments BEGIN SELECT RAISE(ABORT,'immutable_history'); END;
CREATE TRIGGER reports_no_update BEFORE UPDATE ON reports BEGIN SELECT RAISE(ABORT,'immutable_report'); END;
CREATE TRIGGER reports_no_delete BEFORE DELETE ON reports BEGIN SELECT RAISE(ABORT,'immutable_report'); END;
CREATE TRIGGER receipts_no_update BEFORE UPDATE ON operation_receipts BEGIN SELECT RAISE(ABORT,'immutable_receipt'); END;
CREATE TRIGGER receipts_no_delete BEFORE DELETE ON operation_receipts BEGIN SELECT RAISE(ABORT,'immutable_receipt'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'immutable_audit'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'immutable_audit'); END;
CREATE TRIGGER last_admin_update BEFORE UPDATE ON app_users
WHEN OLD.status='active' AND OLD.role='admin' AND (NEW.status!='active' OR NEW.role!='admin') AND (SELECT count(*) FROM app_users WHERE status='active' AND role='admin')<=1
BEGIN SELECT RAISE(ABORT,'last_admin'); END;
CREATE TRIGGER last_admin_delete BEFORE DELETE ON app_users
WHEN OLD.status='active' AND OLD.role='admin' AND (SELECT count(*) FROM app_users WHERE status='active' AND role='admin')<=1
BEGIN SELECT RAISE(ABORT,'last_admin'); END;
