ALTER TABLE invitations ADD COLUMN attempt_id TEXT;
ALTER TABLE invitations ADD COLUMN processing_started_at TEXT;
CREATE INDEX invitations_user ON invitations(user_id);
