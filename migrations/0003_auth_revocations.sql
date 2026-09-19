-- Provider synchronization may fail after application sessions are revoked.
-- This outbox contains no tokens and is retained for operator recovery.
CREATE TABLE auth_revocations (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES app_users(id),
 revoked_before INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','processing','succeeded','failed')),
 error_code TEXT, request_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX auth_revocations_pending ON auth_revocations(status,created_at);
