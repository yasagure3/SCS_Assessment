PRAGMA foreign_keys = ON;
CREATE TABLE assessments (
 id TEXT PRIMARY KEY,
 customer_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision > 0),
 document TEXT NOT NULL CHECK(json_valid(document) AND length(CAST(document AS BLOB)) <= 1048576),
 actor_id TEXT NOT NULL,
 mutation_id TEXT NOT NULL UNIQUE,
 updated_at TEXT NOT NULL
);
CREATE TABLE assessment_revisions (
 assessment_id TEXT NOT NULL REFERENCES assessments(id),
 revision INTEGER NOT NULL,
 document TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 mutation_id TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL,
 PRIMARY KEY(assessment_id, revision)
);
CREATE TRIGGER record_initial_revision AFTER INSERT ON assessments BEGIN
 INSERT INTO assessment_revisions VALUES(NEW.id,NEW.revision,NEW.document,NEW.actor_id,NEW.mutation_id,NEW.updated_at);
END;
CREATE TRIGGER record_revision AFTER UPDATE ON assessments BEGIN
 INSERT INTO assessment_revisions VALUES(NEW.id,NEW.revision,NEW.document,NEW.actor_id,NEW.mutation_id,NEW.updated_at);
END;
CREATE TRIGGER guard_revision BEFORE UPDATE ON assessments
WHEN NEW.revision != OLD.revision+1 OR NEW.customer_id != OLD.customer_id
BEGIN SELECT RAISE(ABORT,'invalid_revision'); END;
