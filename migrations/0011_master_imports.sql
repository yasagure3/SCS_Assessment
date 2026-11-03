-- Immutable source metadata. Customer O:R answers remain in assessment documents.
CREATE TABLE master_import_sources (
  standard_id TEXT PRIMARY KEY REFERENCES standards(id),
  baseline_standard_id TEXT NOT NULL REFERENCES standards(id),
  file_name TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  header_row INTEGER NOT NULL,
  public_rows_json TEXT NOT NULL CHECK(json_valid(public_rows_json)),
  imported_by TEXT NOT NULL REFERENCES app_users(id),
  imported_at TEXT NOT NULL
);
CREATE TRIGGER master_import_sources_no_update BEFORE UPDATE ON master_import_sources
BEGIN SELECT RAISE(ABORT,'immutable_master_import'); END;
CREATE TRIGGER master_import_sources_no_delete BEFORE DELETE ON master_import_sources
BEGIN SELECT RAISE(ABORT,'immutable_master_import'); END;
