-- Append-only cost reservations. These are conservative USD cents, not billed usage.
CREATE TABLE ai_budget_reservations (
  run_id TEXT PRIMARY KEY REFERENCES ai_runs(id),
  utc_month TEXT NOT NULL CHECK(length(utc_month)=7),
  mode TEXT NOT NULL CHECK(mode IN ('trial','monthly')),
  reserved_cents INTEGER NOT NULL CHECK(reserved_cents=10),
  model TEXT NOT NULL CHECK(model='gpt-6-sol'),
  created_at TEXT NOT NULL
);
CREATE INDEX ai_budget_month ON ai_budget_reservations(utc_month);
CREATE TRIGGER ai_budget_no_update BEFORE UPDATE ON ai_budget_reservations
BEGIN SELECT RAISE(ABORT,'AI budget reservations are immutable'); END;
CREATE TRIGGER ai_budget_no_delete BEFORE DELETE ON ai_budget_reservations
BEGIN SELECT RAISE(ABORT,'AI budget reservations are immutable'); END;
