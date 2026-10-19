SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM roles WHERE code='employee' AND CASE WHEN json_valid(permissions)=1
    THEN json_type(permissions)<>'object' ELSE 1 END
) THEN 1 ELSE json_extract('[]','$[inventory_checks_role_permissions_invalid]') END;

CREATE TABLE inventory_check_sessions (
  id TEXT PRIMARY KEY,
  organization_id INTEGER,
  branch_id INTEGER NOT NULL,
  created_by INTEGER NOT NULL,
  title TEXT NOT NULL CHECK(length(title)<=120),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX inventory_check_sessions_recent ON inventory_check_sessions(organization_id,updated_at DESC,id);

CREATE TABLE inventory_check_items (
  session_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  product_snapshot_json TEXT NOT NULL CHECK(json_valid(product_snapshot_json)),
  baseline_quantity REAL,
  baseline_json TEXT NOT NULL CHECK(json_valid(baseline_json)),
  state TEXT NOT NULL DEFAULT 'unstarted' CHECK(state IN ('unstarted','done','issue')),
  counted_quantity REAL CHECK(counted_quantity>=0),
  reason TEXT CHECK(reason IS NULL OR length(reason)<=500),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  updated_by INTEGER,
  updated_at TEXT,
  PRIMARY KEY(session_id,product_id,branch_id),
  FOREIGN KEY(session_id) REFERENCES inventory_check_sessions(id),
  CHECK((state='issue' AND reason IS NOT NULL AND length(trim(reason))>0)
    OR (state<>'issue' AND reason IS NULL)),
  CHECK(state<>'unstarted' OR counted_quantity IS NULL)
);
CREATE INDEX inventory_check_items_state ON inventory_check_items(session_id,state,product_id);

CREATE TABLE inventory_check_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  product_id INTEGER,
  actor_id INTEGER NOT NULL,
  actor_name TEXT,
  action TEXT NOT NULL CHECK(action IN ('create','observe','close','resume')),
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at TEXT NOT NULL,
  UNIQUE(actor_id,request_id),
  FOREIGN KEY(session_id) REFERENCES inventory_check_sessions(id)
);
CREATE INDEX inventory_check_events_session ON inventory_check_events(session_id,id DESC);
CREATE TRIGGER inventory_check_events_no_update BEFORE UPDATE ON inventory_check_events
BEGIN SELECT RAISE(ABORT,'inventory_check_history_immutable'); END;
CREATE TRIGGER inventory_check_events_no_delete BEFORE DELETE ON inventory_check_events
BEGIN SELECT RAISE(ABORT,'inventory_check_history_immutable'); END;
CREATE TRIGGER inventory_check_sessions_identity BEFORE UPDATE OF
  id,organization_id,branch_id,created_by,title,scope_json,started_at ON inventory_check_sessions
BEGIN SELECT RAISE(ABORT,'inventory_check_baseline_immutable'); END;
CREATE TRIGGER inventory_check_sessions_no_delete BEFORE DELETE ON inventory_check_sessions
BEGIN SELECT RAISE(ABORT,'inventory_check_history_immutable'); END;
CREATE TRIGGER inventory_check_items_baseline BEFORE UPDATE OF
  session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json ON inventory_check_items
BEGIN SELECT RAISE(ABORT,'inventory_check_baseline_immutable'); END;
CREATE TRIGGER inventory_check_items_no_delete BEFORE DELETE ON inventory_check_items
BEGIN SELECT RAISE(ABORT,'inventory_check_history_immutable'); END;

UPDATE roles SET permissions=json_insert(permissions,
  '$.inventory_checks',json('true'),
  '$.inventory_check_show_price',json('true'),
  '$.inventory_check_show_barcode',json('true'),
  '$.inventory_check_show_category',json('true'),
  '$.inventory_check_show_brand',json('true'),
  '$.inventory_check_show_stock',json('true'),
  '$.inventory_check_show_received',json('true'),
  '$.inventory_check_show_sales',json('true'),
  '$.inventory_check_show_customers',json('true'),
  '$.inventory_check_show_cost',json('false'))
WHERE code='employee';
