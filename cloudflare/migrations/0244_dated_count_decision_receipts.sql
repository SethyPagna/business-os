CREATE TABLE dated_count_decision_receipts (
  actor_id INTEGER NOT NULL CHECK (actor_id > 0),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 120 AND request_id NOT GLOB '*[^A-Za-z0-9_-]*'),
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  next_index INTEGER NOT NULL DEFAULT 0,
  total_rows INTEGER NOT NULL CHECK (total_rows >= 0),
  invalidated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (actor_id, request_id),
  CHECK (next_index >= 0 AND next_index <= total_rows)
);
