-- An uploading/rejected reservation can have zero received bytes. Ready files cannot.
CREATE TABLE files_next (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, case_id TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL, mime TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 0 AND 10485760), sha256 TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('uploading','ready','rejected')),
 created_by TEXT NOT NULL REFERENCES app_users(id), created_at TEXT NOT NULL,
 CHECK(status!='ready' OR size_bytes>0),
 FOREIGN KEY(case_id,customer_id) REFERENCES cases(id,customer_id)
);
INSERT INTO files_next SELECT * FROM files;
DROP TABLE files;
ALTER TABLE files_next RENAME TO files;
