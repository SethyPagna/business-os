CREATE TABLE dated_count_apply_receipts (
  actor_id INTEGER NOT NULL CHECK (actor_id > 0),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 120 AND request_id NOT GLOB '*[^A-Za-z0-9_-]*'),
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  invalidated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (actor_id, request_id)
);
