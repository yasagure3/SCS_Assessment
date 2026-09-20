ALTER TABLE ai_runs ADD COLUMN error_code TEXT;
CREATE INDEX ai_runs_actor_time ON ai_runs(requested_by,created_at);
CREATE UNIQUE INDEX ai_runs_one_active_actor ON ai_runs(requested_by) WHERE status IN ('pending','running');
