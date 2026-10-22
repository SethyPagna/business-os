-- Business OS schema baseline through migration 0269. GENERATED, do not edit.
-- Rebuild: node ops/scripts/client/build-baseline.mjs   Check: node ops/scripts/client/build-baseline.mjs --check
-- Use: ops/scripts/client/provision-database.mjs (empty database only), then the normal chain applies 0270+.
-- schema-fingerprint: 08658d7306f7db68074b35a01e5ba5f930a3191a97fb6fb23896e1be86f015db
-- chain-digest: d96d1469142bc86bfd8e1ee305745a4e5fbbc86eae87ed4a1d7afb10d44246f8   (sha256 of the manifest name:sha256 lines through 0269)
-- objects: 159 tables (FTS shadow tables are created by their CREATE VIRTUAL TABLE), 208 indexes, 0 views, 220 triggers
-- Rows: only the seed block below. No organization, fee, alias, customer, product, sale or setting.

CREATE TABLE action_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT DEFAULT 'global',
  entity TEXT,
  entity_id TEXT,
  label TEXT NOT NULL,
  undo_label TEXT,
  redo_label TEXT,
  reversible INTEGER DEFAULT 1,
  status TEXT DEFAULT 'undoable',
  undo_payload TEXT DEFAULT '{}',
  redo_payload TEXT DEFAULT '{}',
  last_error TEXT,
  created_by_id INTEGER,
  created_by_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ai_provider_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_type TEXT DEFAULT 'chat',
  account_email TEXT,
  project_name TEXT,
  api_key_encrypted TEXT NOT NULL,
  default_model TEXT,
  supported_models_json TEXT DEFAULT '[]',
  endpoint_override TEXT,
  notes TEXT,
  enabled INTEGER DEFAULT 1,
  last_status TEXT DEFAULT 'untested',
  last_error TEXT,
  last_checked_at TEXT,
  created_by_id INTEGER,
  created_by_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  priority INTEGER DEFAULT 50,
  requests_per_minute INTEGER DEFAULT 10,
  max_input_chars INTEGER DEFAULT 1000,
  max_completion_tokens INTEGER DEFAULT 1200,
  timeout_ms INTEGER DEFAULT 15000,
  cooldown_seconds INTEGER DEFAULT 20
);

CREATE TABLE ai_response_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  surface TEXT DEFAULT 'portal',
  provider_config_id INTEGER,
  provider_name TEXT,
  provider TEXT,
  model TEXT,
  actor_user_id INTEGER,
  actor_user_name TEXT,
  actor_label TEXT,
  prompt_text TEXT,
  question_text TEXT,
  profile_json TEXT DEFAULT '{}',
  candidate_products_json TEXT DEFAULT '[]',
  recommendations_json TEXT DEFAULT '[]',
  citations_json TEXT DEFAULT '[]',
  answer_text TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_name TEXT,
  action TEXT,
  entity TEXT,
  entity_id TEXT,
  details TEXT,
  table_name TEXT,
  record_id TEXT,
  old_value TEXT,
  new_value TEXT,
  device_name TEXT,
  device_tz TEXT,
  client_time TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE branch_batch_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  quantity REAL DEFAULT 0 CHECK (quantity >= 0),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE branch_cutovers (
  operation_id TEXT PRIMARY KEY NOT NULL CHECK(length(operation_id) = 36),
  begin_request_id TEXT NOT NULL UNIQUE CHECK(length(begin_request_id) BETWEEN 8 AND 120),
  actor_id INTEGER NOT NULL CHECK(typeof(actor_id) = 'integer' AND actor_id BETWEEN 1 AND 9007199254740991),
  organization_id TEXT NOT NULL CHECK(length(organization_id) BETWEEN 1 AND 128),
  control_incarnation TEXT NOT NULL CHECK(length(control_incarnation) = 36),
  maintenance_token TEXT NOT NULL CHECK(length(maintenance_token) = 36),
  source_branch_id INTEGER NOT NULL CHECK(typeof(source_branch_id) = 'integer' AND source_branch_id BETWEEN 1 AND 9007199254740991),
  target_branch_id INTEGER NOT NULL CHECK(typeof(target_branch_id) = 'integer' AND target_branch_id BETWEEN 1 AND 9007199254740991 AND target_branch_id <> source_branch_id),
  intent_json TEXT NOT NULL CHECK(length(CAST(intent_json AS BLOB)) <= 16384 AND json_valid(intent_json) AND json_type(intent_json) = 'object'),
  intent_digest TEXT NOT NULL CHECK(length(intent_digest) = 64 AND intent_digest NOT GLOB '*[^0-9a-f]*'),
  source_preimage_json TEXT NOT NULL CHECK(length(CAST(source_preimage_json AS BLOB)) <= 16384 AND json_valid(source_preimage_json) AND json_type(source_preimage_json) = 'object' AND json_extract(source_preimage_json, '$.id') IS source_branch_id),
  target_preimage_json TEXT NOT NULL CHECK(length(CAST(target_preimage_json AS BLOB)) <= 16384 AND json_valid(target_preimage_json) AND json_type(target_preimage_json) = 'object' AND json_extract(target_preimage_json, '$.id') IS target_branch_id),
  maintenance_flag_json TEXT NOT NULL CHECK(length(CAST(maintenance_flag_json AS BLOB)) <= 4096 AND json_valid(maintenance_flag_json) AND json_type(maintenance_flag_json) = 'object'),
  phase TEXT NOT NULL DEFAULT 'capturing' CHECK(phase IN ('capturing','snapshots','moving','verifying','ready','completed','aborted')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision) = 'integer' AND revision BETWEEN 0 AND 9007199254740991),
  capture_cursor_json TEXT NOT NULL DEFAULT '{}' CHECK(length(CAST(capture_cursor_json AS BLOB)) <= 4096 AND json_valid(capture_cursor_json) AND json_type(capture_cursor_json) = 'object'),
  capture_records INTEGER NOT NULL DEFAULT 0 CHECK(typeof(capture_records) = 'integer' AND capture_records BETWEEN 0 AND 9007199254740991),
  capture_digest TEXT NOT NULL CHECK(length(capture_digest) = 64 AND capture_digest NOT GLOB '*[^0-9a-f]*'),
  snapshot_cursor_json TEXT NOT NULL DEFAULT '{}' CHECK(length(CAST(snapshot_cursor_json AS BLOB)) <= 4096 AND json_valid(snapshot_cursor_json) AND json_type(snapshot_cursor_json) = 'object'),
  snapshot_records INTEGER NOT NULL DEFAULT 0 CHECK(typeof(snapshot_records) = 'integer' AND snapshot_records BETWEEN 0 AND 9007199254740991),
  snapshot_digest TEXT NOT NULL CHECK(length(snapshot_digest) = 64 AND snapshot_digest NOT GLOB '*[^0-9a-f]*'),
  verification_cursor_json TEXT NOT NULL DEFAULT '{}' CHECK(length(CAST(verification_cursor_json AS BLOB)) <= 4096 AND json_valid(verification_cursor_json) AND json_type(verification_cursor_json) = 'object'),
  verification_records INTEGER NOT NULL DEFAULT 0 CHECK(typeof(verification_records) = 'integer' AND verification_records BETWEEN 0 AND 9007199254740991),
  verification_digest TEXT NOT NULL CHECK(length(verification_digest) = 64 AND verification_digest NOT GLOB '*[^0-9a-f]*'),
  manifest_json TEXT CHECK(manifest_json IS NULL OR (length(CAST(manifest_json AS BLOB)) <= 16384 AND json_valid(manifest_json) AND json_type(manifest_json) = 'object')),
  manifest_digest TEXT CHECK(manifest_digest IS NULL OR (length(manifest_digest) = 64 AND manifest_digest NOT GLOB '*[^0-9a-f]*')),
  planned_child_json TEXT CHECK(planned_child_json IS NULL OR (length(CAST(planned_child_json AS BLOB)) <= 65536 AND json_valid(planned_child_json) AND json_type(planned_child_json) = 'object')),
  planned_child_key TEXT CHECK(planned_child_key IS NULL OR length(planned_child_key) BETWEEN 8 AND 120),
  planned_child_digest TEXT CHECK(planned_child_digest IS NULL OR (length(planned_child_digest) = 64 AND planned_child_digest NOT GLOB '*[^0-9a-f]*')),
  next_sequence INTEGER NOT NULL DEFAULT 0 CHECK(typeof(next_sequence) = 'integer' AND next_sequence BETWEEN 0 AND 9007199254740991),
  committed_children INTEGER NOT NULL DEFAULT 0 CHECK(typeof(committed_children) = 'integer' AND committed_children = next_sequence),
  terminal_json TEXT CHECK(terminal_json IS NULL OR (length(CAST(terminal_json AS BLOB)) <= 32768 AND json_valid(terminal_json) AND json_type(terminal_json) = 'object')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((manifest_json IS NULL) = (manifest_digest IS NULL)),
  CHECK((planned_child_json IS NULL) = (planned_child_key IS NULL) AND (planned_child_json IS NULL) = (planned_child_digest IS NULL)),
  CHECK((phase IN ('completed','aborted')) = (terminal_json IS NOT NULL)),
  CHECK(phase IN ('capturing','aborted') OR manifest_json IS NOT NULL),
  CHECK(planned_child_json IS NULL OR phase = 'moving'),
  CHECK(terminal_json IS NULL OR (json_extract(terminal_json,'$.version') IS 1 AND json_extract(terminal_json,'$.operationId') IS operation_id AND json_extract(terminal_json,'$.kind') IS phase))
);

CREATE TABLE branch_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  quantity REAL DEFAULT 0 CHECK (quantity >= 0),
  rfid_confirmed_qty REAL DEFAULT 0
);

CREATE TABLE branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT,
  phone TEXT,
  manager TEXT,
  notes TEXT,
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
, role TEXT CHECK (role IS NULL OR role IN ('shop', 'warehouse')), canonical_key TEXT CHECK (canonical_key IS NULL OR canonical_key IN ('shop', 'warehouse')), successor_branch_id INTEGER REFERENCES branches(id)
  CHECK (successor_branch_id IS NULL OR (typeof(successor_branch_id) = 'integer' AND successor_branch_id > 0 AND successor_branch_id <> id AND is_active IS 0 AND is_default IS 0)));

CREATE TABLE bulk_delete_jobs (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,           -- 'products' today; see ENTITY_CONFIGS
  status TEXT DEFAULT 'pending' NOT NULL, -- pending | processing | completed | failed | cancelled
  reason TEXT NOT NULL,                -- same mandatory-reason rule as single delete
  ids_json TEXT NOT NULL,              -- JSON array of the ids to delete, fixed at job creation
  total_count INTEGER NOT NULL,
  processed_count INTEGER DEFAULT 0 NOT NULL, -- doubles as the resume cursor into ids_json
  failed_count INTEGER DEFAULT 0 NOT NULL,
  failed_ids_json TEXT DEFAULT '[]',   -- ids D1 rejected (e.g. FK issue) -- surfaced back to the UI, not silently dropped
  cancel_requested INTEGER DEFAULT 0 NOT NULL,
  last_error TEXT,
  created_by_id INTEGER,
  created_by_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE business_os_migration_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_hash TEXT,
  status TEXT NOT NULL,
  summary_json jsonb DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cache_versions (
  namespace  TEXT PRIMARY KEY,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE catalog_cost_recompute_0175 (
  product_id INTEGER PRIMARY KEY,
  cost_before REAL,
  purchase_before REAL,
  cost_after REAL NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0,
  applied_at TEXT
);

CREATE TABLE catalog_cost_repair_0195_backup (
  product_id INTEGER PRIMARY KEY,
  cost_price_usd,
  purchase_price_usd,
  repaired_cost_price_usd,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);

CREATE TABLE contact_duplicate_dismissals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_table TEXT NOT NULL,
  cluster_type TEXT NOT NULL,
  cluster_value TEXT NOT NULL,
  dismissed_by_id INTEGER,
  dismissed_by_name TEXT,
  dismissed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE custom_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_type TEXT DEFAULT 'TEXT' NOT NULL,
  required INTEGER DEFAULT 0,
  default_value TEXT,
  options TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE custom_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  columns TEXT DEFAULT '[]',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);

CREATE TABLE customer_membership_number_repair (
  customer_id INTEGER PRIMARY KEY,
  old_number TEXT NOT NULL,
  new_number TEXT NOT NULL,
  reason TEXT NOT NULL,
  applied_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customer_merge_map_0166 (
  loser_id INTEGER PRIMARY KEY,
  keeper_id INTEGER NOT NULL,
  cluster_key TEXT NOT NULL,
  loser_json TEXT NOT NULL,
  applied_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customer_receivables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_id INTEGER NOT NULL,
  customer_id INTEGER,
  customer_code TEXT,
  customer_name TEXT NOT NULL,
  invoice_no TEXT,
  invoice_date TEXT NOT NULL,
  taxable_amount_usd REAL NOT NULL DEFAULT 0,
  vat_amount_usd REAL NOT NULL DEFAULT 0,
  total_amount_usd REAL NOT NULL DEFAULT 0,
  amount_paid_usd REAL NOT NULL DEFAULT 0,
  outstanding_balance_usd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  source_file TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_file, legacy_id)
);

CREATE TABLE customer_receivables_paid_multiple_repair (
  receivable_id INTEGER PRIMARY KEY,
  old_amount_paid_usd REAL NOT NULL,
  old_outstanding_balance_usd REAL NOT NULL,
  new_amount_paid_usd REAL NOT NULL,
  new_outstanding_balance_usd REAL NOT NULL,
  reason TEXT NOT NULL,
  repaired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customer_share_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  membership_number TEXT,
  customer_name TEXT,
  platform TEXT,
  note TEXT,
  screenshots_json TEXT DEFAULT '[]',
  status TEXT DEFAULT 'pending',
  reward_points REAL DEFAULT 0,
  review_note TEXT,
  reviewed_by_id INTEGER,
  reviewed_by_name TEXT,
  reviewed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
, reward_points_voided_at TEXT, reward_points_voided_reason TEXT, rights_consent_version TEXT, privacy_consent_version TEXT, consent_at TEXT, consent_locale TEXT, loyalty_eligible INTEGER NOT NULL DEFAULT 0 CHECK (loyalty_eligible IN (0,1)));

CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  company TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  membership_number TEXT,
  updated_at TEXT
, gender TEXT, phone_normalized TEXT, is_anonymous INTEGER NOT NULL DEFAULT 0
  CHECK (is_anonymous IN (0, 1)));

CREATE VIRTUAL TABLE customers_fts USING fts5(
  name, phone, email, company, membership_number, address,
  content='customers',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE customers_fts_phone USING fts5(
  phone, address,
  content='customers',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TABLE damaged_stock_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  product_name TEXT,
  branch_id INTEGER,
  batch_id INTEGER,
  return_id INTEGER,
  quantity REAL NOT NULL DEFAULT 0,
  quantity_remaining REAL NOT NULL DEFAULT 0,
  reason TEXT,
  created_by_user_id INTEGER,
  created_by_user_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
, condition_tag TEXT, source TEXT, unit_cost_usd REAL);

CREATE TABLE dated_stock_count_batch_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  movement_id INTEGER NOT NULL,
  batch_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE delivery_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  area TEXT,
  address TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
, gender TEXT);

CREATE VIRTUAL TABLE delivery_contacts_fts USING fts5(
  name, phone, area, address,
  content='delivery_contacts',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE delivery_contacts_fts_phone USING fts5(
  phone, address,
  content='delivery_contacts',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TABLE "fee_operation_receipts" (
  id TEXT PRIMARY KEY CHECK (
    length(id)=36 AND lower(id)=id
    AND (substr(id,1,6) GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      AND substr(id,7,8) GLOB '[0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-'
      AND substr(id,15,8) GLOB '4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f]'
      AND substr(id,23,7) GLOB '[0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      AND substr(id,30,6) GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      AND substr(id,36,1) GLOB '[0-9a-f]')
  ),
  actor_id INTEGER NOT NULL CHECK(typeof(actor_id)='integer' AND actor_id>0),
  fee_id INTEGER NOT NULL
    CHECK(typeof(fee_id)='integer' AND fee_id>0),
  request_id TEXT NOT NULL
    CHECK(request_id=trim(request_id))
    CHECK(length(CAST(request_id AS BLOB)) BETWEEN 8 AND 120),
  request_digest TEXT NOT NULL CHECK(
    length(request_digest)=64 AND request_digest NOT GLOB '*[^0-9a-f]*'
  ),
  request_json TEXT NOT NULL
    CHECK(json_valid(request_json))
    CHECK(json_type(CASE WHEN json_valid(request_json) THEN request_json ELSE '{}' END)='object')
    CHECK(length(CAST(request_json AS BLOB))<=16384),
  response_json TEXT NOT NULL
    CHECK(json_valid(response_json))
    CHECK(json_type(CASE WHEN json_valid(response_json) THEN response_json ELSE '{}' END)='object')
    CHECK(length(CAST(response_json AS BLOB))<=16384),
  occurred_at TEXT NOT NULL CHECK(
    length(CAST(occurred_at AS BLOB))=24
    AND (substr(occurred_at,1,12) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9]'
      AND substr(occurred_at,13,12) GLOB '[0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
    AND datetime(occurred_at) IS NOT NULL
  ),
  CHECK(json_type(response_json,'$.fee.id')='integer' AND json_extract(response_json,'$.fee.id')=fee_id),
  UNIQUE(fee_id),
  UNIQUE(actor_id,request_id)
);

CREATE TABLE fees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fee_type TEXT NOT NULL DEFAULT 'other',
  label TEXT,
  amount_usd REAL NOT NULL DEFAULT 0,
  amount_khr REAL NOT NULL DEFAULT 0,
  fee_date TEXT NOT NULL,
  sale_id INTEGER,
  branch_id INTEGER,
  notes TEXT,
  created_by INTEGER,
  created_by_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
, delivery_contact_id INTEGER, branch_name TEXT);

CREATE TABLE file_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  public_path TEXT NOT NULL,
  mime_type TEXT,
  media_type TEXT DEFAULT 'image',
  byte_size INTEGER,
  width INTEGER,
  height INTEGER,
  source TEXT DEFAULT 'upload',
  created_by_id INTEGER,
  created_by_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  original_byte_size INTEGER,
  optimized_byte_size INTEGER,
  optimization_status TEXT DEFAULT 'not_optimized',
  optimization_note TEXT,
  duration_seconds REAL
);

CREATE TABLE google_drive_sync_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  relative_path TEXT NOT NULL,
  item_type TEXT DEFAULT 'file',
  remote_file_id TEXT NOT NULL,
  mime_type TEXT,
  md5_checksum TEXT,
  byte_size INTEGER DEFAULT 0,
  local_modified_at TEXT,
  last_synced_at TEXT DEFAULT CURRENT_TIMESTAMP,
  upload_session_url TEXT,
  upload_offset INTEGER DEFAULT 0,
  content_sha256 TEXT,
  last_error TEXT,
  retry_count INTEGER DEFAULT 0
);

CREATE TABLE image_audit (
  -- R2 object key. The identity of the thing being audited.
  key            TEXT PRIMARY KEY,
  byte_size      INTEGER NOT NULL,
  width          INTEGER,
  height         INTEGER,
  format         TEXT,
  -- 'ok'        within the band, nothing to do
  -- 'oversized' above the ceiling, queued for reprocessing
  -- 'optimized' reprocessed successfully; byte_size is the NEW size
  -- 'failed'    reprocessing was attempted and did not succeed
  -- 'skipped'   not a decodable image, or no provider could handle it
  status         TEXT NOT NULL DEFAULT 'ok',
  -- Which provider did the work, so a month's results can be attributed.
  provider       TEXT,
  -- Why it failed or was skipped. Kept so a repeated failure is diagnosable
  -- without re-running the sweep.
  reason         TEXT,
  original_size  INTEGER,
  checked_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  optimized_at   TEXT
);

CREATE TABLE image_audit_state (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  list_cursor  TEXT,
  last_run_at  TEXT,
  swept        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE import_auto_merges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  import_job_id INTEGER,
  row_number INTEGER,
  losing_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE import_job_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  batch_index INTEGER NOT NULL,
  start_row INTEGER DEFAULT 0,
  end_row INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE import_job_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  batch_id INTEGER,
  row_number INTEGER,
  file_name TEXT,
  code TEXT,
  message TEXT NOT NULL,
  raw_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE import_job_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  original_name TEXT,
  stored_path TEXT NOT NULL,
  relative_path TEXT,
  mime_type TEXT,
  byte_size INTEGER DEFAULT 0,
  status TEXT DEFAULT 'stored',
  error_message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
, file_asset_id INTEGER);

CREATE TABLE import_job_image_matches (
  job_id     TEXT NOT NULL,
  -- Original CSV line number, matching ParsedCsvRow._rowNumber -- the key
  -- classifyProducts looks up when deciding which image a row gets.
  row_number INTEGER NOT NULL,
  image_path TEXT NOT NULL,
  PRIMARY KEY (job_id, row_number)
);

CREATE TABLE import_job_image_renames (
  job_id   TEXT NOT NULL,
  file_id  TEXT NOT NULL,
  new_name TEXT NOT NULL,
  PRIMARY KEY (job_id, file_id)
);

CREATE TABLE import_job_row_signatures (
  job_id     TEXT NOT NULL,
  -- productIdentitySignature output: name + barcode + the pricing fields.
  signature  TEXT NOT NULL,
  -- The ORIGINAL CSV line number of the first row carrying this signature.
  -- Reported to the operator as "merges with row #N", so it must be the
  -- number they see in their spreadsheet, not an internal sequence.
  row_number INTEGER NOT NULL,
  PRIMARY KEY (job_id, signature)
);

CREATE TABLE import_job_rows (
  job_id TEXT NOT NULL,
  phase TEXT NOT NULL, -- 'analyze' | 'apply' -- kept separate because apply re-classifies against live DB state (branches/products/contacts created by earlier chunks of the SAME apply run, or edited between analyze and approve), which can legitimately disagree with the last analyze pass -- see runImportApply's own comment on why it always reclassifies rather than trusting analyze's results verbatim.
  row_number INTEGER NOT NULL,
  group_index INTEGER, -- sales imports only: 0-based order-of-first-appearance index of the order_reference group this row belongs to. Null for every other import type. Lets sales chunking window by GROUP (a group's rows must all classify together) instead of by raw row.
  action TEXT NOT NULL, -- 'create' | 'update' | 'skip' | 'error'
  identifier TEXT, -- denormalized copy of ImportRowResult.identifier so GET /:id/review can filter/search with a plain SQL LIKE instead of loading+parsing every row's JSON first
  result_json TEXT NOT NULL, -- JSON-serialized ImportRowResult
  PRIMARY KEY (job_id, phase, row_number)
);

CREATE TABLE import_job_source_rows (
  job_id TEXT NOT NULL,
  sequence INTEGER NOT NULL, -- 0-based order of first appearance among non-blank data rows -- what readMaterializedWindow slices by (cursor, cursor+limit), NOT row_number (which is the original 1-based CSV line and can skip over blank lines)
  row_number INTEGER NOT NULL, -- original CSV line number, matching parseCsvRows' `index + 1` / ParsedCsvRow._rowNumber -- carried through so identifiers/errors still cite the row the user sees in their spreadsheet
  data_json TEXT NOT NULL, -- JSON-serialized ParsedCsvRow (header-keyed values + _rowNumber)
  PRIMARY KEY (job_id, sequence)
);

CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL,
  phase TEXT DEFAULT 'created',
  queue_driver TEXT DEFAULT 'bullmq',
  total_rows INTEGER DEFAULT 0,
  processed_rows INTEGER DEFAULT 0,
  failed_rows INTEGER DEFAULT 0,
  total_images INTEGER DEFAULT 0,
  processed_images INTEGER DEFAULT 0,
  failed_images INTEGER DEFAULT 0,
  warning_count INTEGER DEFAULT 0,
  policy_json TEXT DEFAULT '{}',
  summary_json TEXT DEFAULT '{}',
  cancel_requested INTEGER DEFAULT 0,
  last_error TEXT,
  created_by_id INTEGER,
  created_by_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT
, dismissed_at TEXT, dismissed_status TEXT, chunk_cursor INTEGER NOT NULL DEFAULT 0, chunk_state_json TEXT, materialize_state_json TEXT, materialize_done INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_expires_at TEXT, details_pruned_at TEXT);

CREATE TABLE import_sales_commits (
  job_id TEXT NOT NULL,
  group_key TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'applied')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  applied_at TEXT,
  PRIMARY KEY (job_id, group_key)
);

CREATE TABLE import_stock_action_commits (
  job_id TEXT NOT NULL,
  action_key TEXT NOT NULL,
  row_number INTEGER,
  action_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  applied_at TEXT,
  PRIMARY KEY (job_id, action_key)
);

CREATE TABLE import_stock_action_groups (
  job_id TEXT NOT NULL,
  group_key TEXT NOT NULL,
  group_index INTEGER NOT NULL,
  poisoned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (job_id, group_key)
);

CREATE TABLE import_stock_action_guards (
  job_id TEXT NOT NULL,
  action_key TEXT NOT NULL,
  guard_key TEXT NOT NULL,
  guard_value INTEGER NOT NULL CHECK (guard_value = 1),
  PRIMARY KEY (job_id, action_key, guard_key)
);

CREATE TABLE imported_sale_stock_skip_0235 (
  sale_id INTEGER PRIMARY KEY,
  client_request_id TEXT NOT NULL,
  receipt_number TEXT,
  sale_status TEXT,
  updated_at_before TEXT,
  stock_skipped_before INTEGER NOT NULL,
  stock_skipped_at_before TEXT,
  stock_skipped_by_name_before TEXT,
  applied INTEGER NOT NULL DEFAULT 0,
  applied_at TEXT
);

CREATE TABLE imported_sale_stock_skip_guard_0235 (
  check_name TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);

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

CREATE TABLE inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  product_name TEXT,
  branch_id INTEGER,
  branch_name TEXT,
  movement_type TEXT,
  quantity REAL,
  unit_cost_usd REAL DEFAULT 0,
  unit_cost_khr REAL DEFAULT 0,
  total_cost_usd REAL DEFAULT 0,
  total_cost_khr REAL DEFAULT 0,
  reason TEXT,
  reference_id INTEGER,
  user_id INTEGER,
  user_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
, batch_id INTEGER, free_quantity INTEGER NOT NULL DEFAULT 0, addressed_branch_name TEXT);

CREATE TABLE legacy_deleted_sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  event_started_at TEXT,
  event_ended_at TEXT,
  invoice_no TEXT,
  reference_no TEXT,
  cashier_name TEXT,
  bill_delete_reason TEXT,
  deleted_at TEXT,
  deleted_by TEXT,
  deletion_reason TEXT,
  product_id INTEGER,
  source_product_name TEXT NOT NULL,
  product_name TEXT,
  source_code TEXT,
  quantity REAL NOT NULL DEFAULT 0,
  unit_price_usd REAL NOT NULL DEFAULT 0,
  discount_raw TEXT,
  total_usd REAL NOT NULL DEFAULT 0,
  source_file TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, cashier_id INTEGER,
  UNIQUE(source_file, source_row)
);

CREATE TABLE legacy_inventory_effects (
  source_key TEXT PRIMARY KEY,
  product_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  batch_id INTEGER,
  quantity_delta REAL NOT NULL DEFAULT 0,
  movement_quantity REAL NOT NULL,
  movement_type TEXT NOT NULL,
  reason TEXT,
  reference_id INTEGER,
  occurred_at TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, unit_cost_usd REAL, unit_cost_khr REAL);

CREATE TABLE legacy_sale_date_corrections (
  receipt_number TEXT PRIMARY KEY,
  previous_created_at TEXT NOT NULL,
  source_created_at TEXT NOT NULL,
  source_file TEXT NOT NULL,
  corrected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE legacy_sale_item_corrections (
  source_key TEXT PRIMARY KEY,
  receipt_number TEXT NOT NULL,
  line_ordinal INTEGER NOT NULL,
  product_id INTEGER,
  product_name TEXT,
  sku TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  branch_id INTEGER,
  batch_id INTEGER,
  applied_price_usd REAL NOT NULL,
  total_usd REAL NOT NULL,
  base_price_usd REAL NOT NULL,
  manual_discount_usd REAL NOT NULL,
  cost_price_usd REAL NOT NULL,
  source_file TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(receipt_number, line_ordinal)
);

CREATE TABLE login_lockouts (
  username TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE loyalty_point_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  points REAL NOT NULL CHECK (points > 0),
  note TEXT,
  created_by_id INTEGER,
  created_by_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
, voided_at TEXT, voided_reason TEXT);

CREATE TABLE loyalty_points_reset_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reset_at TEXT DEFAULT CURRENT_TIMESTAMP,
  reason TEXT NOT NULL,
  sales_reset_count INTEGER NOT NULL DEFAULT 0,
  sales_reset_ids TEXT,
  adjustments_voided_count INTEGER NOT NULL DEFAULT 0,
  submissions_voided_count INTEGER NOT NULL DEFAULT 0,
  undo_sql TEXT
);

CREATE TABLE organization_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  public_id TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  setup_enabled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE password_reset_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  request_ip TEXT,
  device_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  resolved_by INTEGER,
  resolved_at TEXT
);

CREATE TABLE pending_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL,
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  requested_by INTEGER,
  requested_by_name TEXT,
  reviewed_by INTEGER,
  reviewed_by_name TEXT,
  reviewed_at TEXT,
  reject_reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
, expected_entity_state_json TEXT
  CHECK (expected_entity_state_json IS NULL OR json_valid(expected_entity_state_json)));

CREATE TABLE portal_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  membership_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT,
  contact_id INTEGER,
  cart_json TEXT,
  wishlist_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
, consent_version TEXT, consent_at TEXT, consent_locale TEXT, age_confirmed_at TEXT);

CREATE TABLE portal_auth_lockouts (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, key)
);

CREATE TABLE portal_password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE portal_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  user_agent TEXT,
  last_ip TEXT,
  last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_product_id INTEGER NOT NULL,
  batch_key TEXT NOT NULL,
  lot_code TEXT,
  expiry_date TEXT,
  received_at TEXT,
  is_active INTEGER DEFAULT 1,
  notes TEXT,
  synthetic INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
, batch_number INTEGER, supplier_id INTEGER, supplier_name TEXT, payment_status TEXT, credit_due_date TEXT, unit_cost_usd REAL, received_quantity REAL, received_branch_id INTEGER, received_cost_usd REAL, received_branch_name TEXT);

CREATE TABLE product_conflict_action_group_members (
  review_id TEXT NOT NULL,
  group_ordinal INTEGER NOT NULL,
  member_ordinal INTEGER NOT NULL CHECK (member_ordinal >= 0 AND member_ordinal < 4000),
  -- A reviewed id can disappear between client discovery and authoritative
  -- preview. Retain that id in the blocked receipt instead of failing the
  -- whole review through a products FK.
  product_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'candidate' CHECK (role IN ('candidate', 'keeper', 'merged')),
  status TEXT NOT NULL DEFAULT 'reviewed'
    CHECK (status IN ('reviewed', 'planned', 'committed', 'history_pending', 'undo_ready', 'refused', 'reversed')),
  state_digest TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'),
  operation_id TEXT UNIQUE,
  action_history_id INTEGER REFERENCES action_history(id) ON DELETE SET NULL,
  undo_snapshot_id INTEGER REFERENCES undo_snapshots(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (review_id, group_ordinal, member_ordinal),
  UNIQUE (review_id, product_id),
  FOREIGN KEY (review_id, group_ordinal)
    REFERENCES product_conflict_action_groups(review_id, ordinal) ON DELETE CASCADE
);

CREATE TABLE product_conflict_action_groups (
  review_id TEXT NOT NULL REFERENCES product_conflict_action_reviews(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0 AND ordinal < 1600),
  group_key TEXT NOT NULL,
  source_group_keys_json TEXT NOT NULL CHECK (json_valid(source_group_keys_json) AND json_type(source_group_keys_json) = 'array'),
  member_ids_json TEXT NOT NULL CHECK (json_valid(member_ids_json) AND json_type(member_ids_json) = 'array'),
  eligibility_basis TEXT CHECK (eligibility_basis IS NULL OR eligibility_basis IN ('name', 'barcode')),
  eligibility_value TEXT,
  status TEXT NOT NULL CHECK (status IN ('actionable', 'blocked', 'ready', 'running', 'partial', 'completed', 'refused', 'reversed')),
  blocker_code TEXT,
  blocker_message TEXT,
  state_digest TEXT NOT NULL,
  detail_json TEXT NOT NULL CHECK (json_valid(detail_json) AND json_type(detail_json) = 'object'),
  resolution_json TEXT CHECK (resolution_json IS NULL OR json_valid(resolution_json)),
  final_plan_json TEXT CHECK (final_plan_json IS NULL OR json_valid(final_plan_json)),
  operation_id TEXT UNIQUE,
  action_history_id INTEGER REFERENCES action_history(id) ON DELETE SET NULL,
  reversal_generation INTEGER NOT NULL DEFAULT 0 CHECK (reversal_generation >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (review_id, ordinal),
  UNIQUE (review_id, group_key),
  CHECK ((status = 'blocked') = (blocker_code IS NOT NULL)),
  CHECK ((blocker_code IS NULL) = (blocker_message IS NULL))
);

CREATE TABLE product_conflict_action_reviews (
  id TEXT PRIMARY KEY,
  actor_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  manifest_version INTEGER NOT NULL CHECK (manifest_version = 1),
  resolution_version INTEGER NOT NULL CHECK (resolution_version = 2),
  draft_digest TEXT NOT NULL,
  finalize_digest TEXT,
  manifest_digest TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'finalized', 'running', 'completed', 'interrupted', 'approval_pending', 'expired')),
  requested_action_count INTEGER NOT NULL CHECK (requested_action_count >= 1 AND requested_action_count <= 1600),
  requested_group_count INTEGER NOT NULL CHECK (requested_group_count >= 0 AND requested_group_count <= 1600),
  requested_removal_count INTEGER NOT NULL CHECK (requested_removal_count >= 0 AND requested_removal_count <= 1600),
  actionable_group_count INTEGER NOT NULL CHECK (actionable_group_count >= 0),
  blocked_group_count INTEGER NOT NULL CHECK (blocked_group_count >= 0),
  total_member_count INTEGER NOT NULL CHECK (total_member_count >= 0 AND total_member_count <= 4000),
  expires_at TEXT NOT NULL,
  finalized_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (actor_id, request_id),
  CHECK (requested_action_count = requested_group_count + requested_removal_count)
);

CREATE TABLE product_conflict_merge_run_cases (
  run_id TEXT NOT NULL REFERENCES product_conflict_merge_runs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0 AND ordinal < 12),
  case_key TEXT NOT NULL,
  keeper_product_id INTEGER NOT NULL REFERENCES products(id),
  merged_product_id INTEGER NOT NULL REFERENCES products(id),
  expected_state_digest TEXT NOT NULL,
  stock_choice TEXT CHECK (stock_choice IS NULL OR stock_choice IN ('merge', 'write_off')),
  operation_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'committed', 'history_pending', 'undo_ready', 'refused')),
  action_history_id INTEGER REFERENCES action_history(id) ON DELETE SET NULL,
  refusal_code TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, ordinal),
  UNIQUE (run_id, case_key),
  CHECK (keeper_product_id != merged_product_id)
);

CREATE TABLE product_conflict_merge_runs (
  id TEXT PRIMARY KEY,
  actor_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  manifest_version INTEGER NOT NULL CHECK (manifest_version = 1),
  manifest_digest TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'running', 'completed', 'interrupted')),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (actor_id, request_id)
);

CREATE TABLE product_cost_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  cost_khr REAL,
  source TEXT NOT NULL,            -- 'manual' (product edit form)
  user_id INTEGER,
  user_name TEXT,
  baseline_batch_id INTEGER NOT NULL DEFAULT 0,  -- MAX(product_batches.id) for this product at edit time (0 = none yet); only lots with id > this count again
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, previous_cost_usd REAL);

CREATE TABLE product_cost_mirror_0269 (
  product_id INTEGER PRIMARY KEY,
  cost_price_usd,
  cost_price_khr,
  before_purchase_usd,
  before_purchase_khr,
  after_purchase_usd,
  after_purchase_khr,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_duplicate_dismissals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_type TEXT NOT NULL,
  cluster_value TEXT NOT NULL,
  dismissed_by_id INTEGER,
  dismissed_by_name TEXT,
  dismissed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  image_path TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_merge_map_0165 (
  loser_id INTEGER PRIMARY KEY,
  keeper_id INTEGER NOT NULL,
  name_key TEXT NOT NULL,
  loser_json TEXT NOT NULL,
  applied_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_merge_map_0168 (
  loser_id INTEGER PRIMARY KEY,
  keeper_id INTEGER NOT NULL,
  name_key TEXT NOT NULL,
  loser_json TEXT NOT NULL,
  applied_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_merge_map_0174 (
  loser_id INTEGER PRIMARY KEY,
  keeper_id INTEGER NOT NULL,
  name_key TEXT NOT NULL,
  loser_json TEXT NOT NULL,
  applied_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_merge_pairs_0168 (
  loser_id INTEGER PRIMARY KEY,
  keeper_id INTEGER NOT NULL,
  note TEXT
);

CREATE TABLE product_merge_pairs_0174 (
  loser_id INTEGER PRIMARY KEY,
  keeper_id INTEGER NOT NULL,
  note TEXT
);

CREATE TABLE product_remove_operations (
  operation_id TEXT PRIMARY KEY,
  actor_id INTEGER NOT NULL,
  requester_id INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('direct', 'conflict_review')),
  request_id TEXT NOT NULL,
  review_id TEXT REFERENCES product_conflict_action_reviews(id) ON DELETE CASCADE,
  action_ordinal INTEGER,
  product_id INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  state_digest TEXT NOT NULL,
  plan_digest TEXT NOT NULL,
  plan_json TEXT NOT NULL CHECK (json_valid(plan_json) AND json_type(plan_json) = 'object'),
  status TEXT NOT NULL CHECK (status IN ('reviewed', 'blocked', 'ready', 'approval_pending', 'undo_ready', 'refused', 'reversed')),
  blocker_code TEXT,
  error_message TEXT,
  pending_action_id INTEGER REFERENCES pending_actions(id) ON DELETE SET NULL,
  undo_snapshot_id INTEGER REFERENCES undo_snapshots(id) ON DELETE SET NULL,
  action_history_id INTEGER REFERENCES action_history(id) ON DELETE SET NULL,
  generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
  last_transition_request_id TEXT,
  last_transition_direction TEXT CHECK (last_transition_direction IS NULL OR last_transition_direction IN ('apply', 'undo', 'redo')),
  last_transition_from_generation INTEGER,
  last_transition_to_generation INTEGER,
  response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (actor_id, source, request_id),
  UNIQUE (review_id, action_ordinal),
  UNIQUE (review_id, product_id),
  CHECK ((source = 'conflict_review') = (review_id IS NOT NULL AND action_ordinal IS NOT NULL)),
  CHECK ((status = 'blocked') = (blocker_code IS NOT NULL))
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sku TEXT,
  barcode TEXT,
  category TEXT,
  unit TEXT DEFAULT 'pcs',
  description TEXT,
  selling_price_usd REAL DEFAULT 0,
  selling_price_khr REAL DEFAULT 0,
  purchase_price_usd REAL DEFAULT 0,
  purchase_price_khr REAL DEFAULT 0,
  cost_price_usd REAL DEFAULT 0,
  cost_price_khr REAL DEFAULT 0,
  stock_quantity REAL DEFAULT 0,
  rfid_confirmed_qty REAL DEFAULT 0,
  low_stock_threshold REAL DEFAULT 10,
  out_of_stock_threshold REAL DEFAULT 0,
  image_path TEXT,
  is_active INTEGER DEFAULT 1,
  supplier TEXT,
  custom_fields TEXT DEFAULT '{}',
  parent_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  brand TEXT,
  client_request_id TEXT,
  special_price_usd REAL DEFAULT 0,
  special_price_khr REAL DEFAULT 0,
  is_group INTEGER DEFAULT 0,
  discount_enabled INTEGER DEFAULT 0,
  discount_type TEXT DEFAULT 'percent',
  discount_percent REAL DEFAULT 0,
  discount_amount_usd REAL DEFAULT 0,
  discount_amount_khr REAL DEFAULT 0,
  discount_label TEXT,
  discount_badge_color TEXT DEFAULT '#e11d48',
  discount_starts_at TEXT,
  discount_ends_at TEXT,
  expiry_date TEXT,
  expiry_alert_days REAL DEFAULT 30
, name_key TEXT DEFAULT '', is_grouped_cached INTEGER DEFAULT 0, categories TEXT, brands TEXT, name_normalized TEXT, unit_normalized TEXT, brand_compact TEXT, tag_label TEXT, auto_merged_count INTEGER DEFAULT 0, wholesale_price_usd REAL DEFAULT 0, wholesale_price_khr REAL DEFAULT 0, cost_review_key TEXT DEFAULT NULL
  CHECK(cost_review_key IS NULL OR (typeof(cost_review_key)='text' AND length(cost_review_key)=32 AND cost_review_key NOT GLOB '*[^0-9a-f]*')));

CREATE VIRTUAL TABLE products_fts USING fts5(
  name, sku, barcode, brand, category, supplier, description, unit,
  content='products',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE products_fts_code USING fts5(
  barcode, sku,
  content='products',
  content_rowid='id',
  tokenize='trigram'
);

CREATE VIRTUAL TABLE products_fts_name_trigram USING fts5(
  name,
  content='products',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TABLE promotion_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  show_title INTEGER NOT NULL DEFAULT 1,
  rule_type TEXT NOT NULL DEFAULT 'percent_off',
  min_quantity REAL NOT NULL DEFAULT 0,
  save_usd REAL NOT NULL DEFAULT 0,
  save_khr REAL NOT NULL DEFAULT 0,
  percent_off REAL NOT NULL DEFAULT 0,
  scope_type TEXT NOT NULL DEFAULT 'products',
  product_ids TEXT NOT NULL DEFAULT '[]',
  category TEXT,
  brand TEXT,
  badge_color TEXT DEFAULT '#e11d48',
  starts_at TEXT,
  ends_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
, min_spend_usd REAL NOT NULL DEFAULT 0, min_spend_khr REAL NOT NULL DEFAULT 0, label_style TEXT NOT NULL DEFAULT 'save');

CREATE TABLE promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  subtitle TEXT,
  image_path TEXT,
  link_type TEXT DEFAULT 'none',
  link_product_id INTEGER,
  link_url TEXT,
  badge_text TEXT,
  badge_color TEXT,
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE quota_usage (
  resource   TEXT NOT NULL,
  -- 'YYYY-MM-DD' for daily resources, 'YYYY-MM' for monthly ones. Old rows
  -- are harmless: they simply stop being read once the window rolls over.
  window_key TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (resource, window_key)
);

CREATE TABLE rate_limit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL,
  client_key TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE return_bulk_guards (
  id INTEGER PRIMARY KEY,
  guard_value INTEGER NOT NULL CHECK(guard_value = 1)
);

CREATE TABLE return_bulk_members (
  operation_id TEXT NOT NULL REFERENCES return_bulk_operations(id),
  return_id INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  sale_id INTEGER,
  sale_revision INTEGER,
  stock_fingerprint TEXT NOT NULL,
  PRIMARY KEY(operation_id, return_id)
);

CREATE TABLE return_bulk_operations (
  id TEXT PRIMARY KEY,
  actor_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  request_json TEXT NOT NULL,
  snapshot_id INTEGER REFERENCES undo_snapshots(id),
  history_id INTEGER REFERENCES action_history(id),
  generation INTEGER NOT NULL DEFAULT 0,
  receipt_json TEXT NOT NULL,
  UNIQUE(actor_id, request_id)
);

CREATE TABLE "return_create_guards" (
  operation_id TEXT NOT NULL CHECK (
    length(operation_id)=36 AND lower(operation_id)=operation_id
    AND (substr(operation_id,1,6) GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      AND substr(operation_id,7,8) GLOB '[0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-'
      AND substr(operation_id,15,8) GLOB '4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f]'
      AND substr(operation_id,23,7) GLOB '[0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      AND substr(operation_id,30,6) GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      AND substr(operation_id,36,1) GLOB '[0-9a-f]')
  ),
  phase TEXT NOT NULL CHECK(phase IN ('precondition','postcondition')),
  guard_value INTEGER NOT NULL CHECK(typeof(guard_value)='integer' AND guard_value=1),
  PRIMARY KEY(operation_id,phase)
);

CREATE TABLE "return_create_receipts" (
  id TEXT PRIMARY KEY CHECK (
    length(id)=36 AND lower(id)=id
    AND (substr(id,1,6) GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      AND substr(id,7,8) GLOB '[0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-'
      AND substr(id,15,8) GLOB '4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f]'
      AND substr(id,23,7) GLOB '[0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      AND substr(id,30,6) GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      AND substr(id,36,1) GLOB '[0-9a-f]')
  ),
  actor_id INTEGER NOT NULL CHECK(typeof(actor_id)='integer' AND actor_id>0),
  return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE RESTRICT
    CHECK(typeof(return_id)='integer' AND return_id>0),
  sale_id INTEGER REFERENCES sales(id) ON DELETE RESTRICT
    CHECK(sale_id IS NULL OR (typeof(sale_id)='integer' AND sale_id>0)),
  request_id TEXT NOT NULL
    CHECK(request_id=trim(request_id))
    CHECK(length(CAST(request_id AS BLOB)) BETWEEN 1 AND 120),
  request_digest TEXT NOT NULL CHECK(
    length(request_digest)=64 AND request_digest NOT GLOB '*[^0-9a-f]*'
  ),
  request_json TEXT NOT NULL
    CHECK(json_valid(request_json))
    CHECK(json_type(CASE WHEN json_valid(request_json) THEN request_json ELSE '{}' END)='object')
    CHECK(length(CAST(request_json AS BLOB))<=512000),
  response_json TEXT NOT NULL
    CHECK(json_valid(response_json))
    CHECK(json_type(CASE WHEN json_valid(response_json) THEN response_json ELSE '{}' END)='object')
    CHECK(length(CAST(response_json AS BLOB))<=65536),
  occurred_at TEXT NOT NULL CHECK(
    length(CAST(occurred_at AS BLOB))=24
    AND (substr(occurred_at,1,12) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9]'
      AND substr(occurred_at,13,12) GLOB '[0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
    AND datetime(occurred_at) IS NOT NULL
  ),
  CHECK (
    (sale_id IS NULL AND json_type(request_json,'$.sale_id')='null')
    OR (sale_id IS NOT NULL AND json_type(request_json,'$.sale_id')='integer' AND json_extract(request_json,'$.sale_id')=sale_id)
  ),
  CHECK(json_type(response_json,'$.id')='integer' AND json_extract(response_json,'$.id')=return_id),
  CHECK(
    json_type(response_json,'$.returnNumber')='text'
    AND length(CAST(trim(json_extract(response_json,'$.returnNumber')) AS BLOB)) BETWEEN 1 AND 120
  ),
  CHECK (
    (json_type(response_json,'$.replacementSaleId')='null' AND json_type(response_json,'$.replacementReceiptNumber')='null')
    OR (
      json_type(response_json,'$.replacementSaleId')='integer'
      AND json_extract(response_json,'$.replacementSaleId')>0
      AND json_type(response_json,'$.replacementReceiptNumber')='text'
      AND length(CAST(trim(json_extract(response_json,'$.replacementReceiptNumber')) AS BLOB)) BETWEEN 1 AND 120
    )
  ),
  CHECK(json_remove(response_json,'$.id','$.returnNumber','$.replacementSaleId','$.replacementReceiptNumber')='{}'),
  UNIQUE(return_id),
  UNIQUE(actor_id,request_id)
);

CREATE TABLE return_item_batch_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_item_id INTEGER NOT NULL,
  sale_item_id INTEGER,
  batch_id INTEGER NOT NULL,
  branch_id INTEGER,
  quantity REAL NOT NULL,
  lot_code TEXT,
  expiry_date TEXT,
  reversed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL,
  sale_item_id INTEGER,
  product_id INTEGER,
  product_name TEXT,
  quantity REAL DEFAULT 1,
  applied_price_usd REAL DEFAULT 0,
  applied_price_khr REAL DEFAULT 0,
  cost_price_usd REAL DEFAULT 0,
  cost_price_khr REAL DEFAULT 0,
  total_usd REAL DEFAULT 0,
  total_khr REAL DEFAULT 0,
  return_to_stock INTEGER DEFAULT 1,
  branch_id INTEGER
, batch_id INTEGER, stock_action TEXT, refund_snapshot_json TEXT);

CREATE TABLE "return_mutation_receipts" (
  id TEXT PRIMARY KEY CHECK (
    length(id)=36 AND lower(id)=id
    AND (substr(id,1,6) GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      AND substr(id,7,8) GLOB '[0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-'
      AND substr(id,15,8) GLOB '4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f]'
      AND substr(id,23,7) GLOB '[0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      AND substr(id,30,6) GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      AND substr(id,36,1) GLOB '[0-9a-f]')
  ),
  actor_id INTEGER NOT NULL CHECK(typeof(actor_id)='integer' AND actor_id>0),
  return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE RESTRICT
    CHECK(typeof(return_id)='integer' AND return_id>0),
  sale_id INTEGER REFERENCES sales(id) ON DELETE RESTRICT
    CHECK(sale_id IS NULL OR (typeof(sale_id)='integer' AND sale_id>0)),
  mutation_kind TEXT NOT NULL CHECK(mutation_kind='edit'),
  request_id TEXT NOT NULL CHECK(length(CAST(trim(request_id) AS BLOB)) BETWEEN 1 AND 120),
  request_digest TEXT NOT NULL CHECK(length(request_digest)=64 AND request_digest NOT GLOB '*[^0-9a-f]*'),
  request_json TEXT NOT NULL CHECK(json_valid(request_json))
    CHECK(json_type(CASE WHEN json_valid(request_json) THEN request_json ELSE '{}' END)='object')
    CHECK(length(CAST(request_json AS BLOB))<=131072),
  response_json TEXT NOT NULL CHECK(json_valid(response_json))
    CHECK(json_type(CASE WHEN json_valid(response_json) THEN response_json ELSE '{}' END)='object')
    CHECK(length(CAST(response_json AS BLOB))<=65536)
    CHECK(json_type(response_json,'$.id')='integer' AND json_extract(response_json,'$.id')>0)
    CHECK(json_type(response_json,'$.updated_at')='text' AND length(CAST(json_extract(response_json,'$.updated_at') AS BLOB)) BETWEEN 1 AND 40)
    CHECK(json_remove(response_json,'$.id','$.updated_at')='{}'),
  occurred_at TEXT NOT NULL CHECK(length(trim(occurred_at)) BETWEEN 1 AND 40),
  UNIQUE(actor_id,mutation_kind,request_id)
);

CREATE TABLE return_replacement_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL,
  product_id INTEGER,
  product_name TEXT,
  branch_id INTEGER,
  batch_id INTEGER,
  quantity REAL NOT NULL DEFAULT 0,
  applied_price_usd REAL DEFAULT 0,
  applied_price_khr REAL DEFAULT 0,
  total_usd REAL DEFAULT 0,
  total_khr REAL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
, sale_item_id INTEGER);

CREATE TABLE return_write_revisions (
  return_id INTEGER PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_number TEXT,
  sale_id INTEGER,
  receipt_number TEXT,
  cashier_id INTEGER,
  cashier_name TEXT,
  customer_name TEXT,
  branch_id INTEGER,
  branch_name TEXT,
  reason TEXT,
  return_type TEXT DEFAULT 'restock',
  notes TEXT,
  total_refund_usd REAL DEFAULT 0,
  total_refund_khr REAL DEFAULT 0,
  exchange_rate REAL DEFAULT 4100,
  status TEXT DEFAULT 'completed',
  device_name TEXT,
  device_tz TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  customer_id INTEGER,
  return_scope TEXT DEFAULT 'customer',
  supplier_id INTEGER,
  supplier_name TEXT,
  supplier_settlement TEXT DEFAULT 'none',
  supplier_compensation_usd REAL DEFAULT 0,
  supplier_compensation_khr REAL DEFAULT 0,
  supplier_loss_usd REAL DEFAULT 0,
  supplier_loss_khr REAL DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  client_request_id TEXT
, settlement_mode TEXT, settlement_diff_usd REAL DEFAULT 0, settlement_diff_khr REAL DEFAULT 0, search_normalized TEXT, replacement_sale_id INTEGER, money_precision_version INTEGER NOT NULL DEFAULT 0, calculated_refund_usd REAL, rounding_adjustment_usd REAL NOT NULL DEFAULT 0, addressed_branch_name TEXT, refund_currency TEXT CHECK (refund_currency IS NULL OR refund_currency IN ('USD', 'KHR')), owed_reduction_usd REAL NOT NULL DEFAULT 0 CHECK (typeof(owed_reduction_usd) IN ('integer', 'real') AND owed_reduction_usd >= 0 AND (owed_reduction_usd = 0 OR owed_reduction_usd <= total_refund_usd)));

CREATE TABLE rfid_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  epc_id TEXT NOT NULL,
  tid TEXT,
  product_id INTEGER,
  branch_id INTEGER,
  event_type TEXT NOT NULL,
  antenna TEXT,
  rssi REAL,
  seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  raw_json TEXT,
  dedupe_key TEXT
);

CREATE TABLE rfid_scan_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER NOT NULL,
  area TEXT,
  reader_id TEXT,
  status TEXT DEFAULT 'active',
  ledger_qty REAL DEFAULT 0,
  confirmed_qty REAL DEFAULT 0,
  missing_count INTEGER DEFAULT 0,
  extra_count INTEGER DEFAULT 0,
  wrong_location_count INTEGER DEFAULT 0,
  unknown_count INTEGER DEFAULT 0,
  started_at TEXT DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  applied_at TEXT,
  created_by INTEGER,
  created_by_name TEXT
);

CREATE TABLE rfid_session_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  epc_id TEXT NOT NULL,
  tid TEXT,
  product_id INTEGER,
  expected_branch_id INTEGER,
  seen_branch_id INTEGER,
  status TEXT NOT NULL,
  review_note TEXT,
  first_seen TEXT DEFAULT CURRENT_TIMESTAMP,
  last_seen TEXT DEFAULT CURRENT_TIMESTAMP,
  read_count INTEGER DEFAULT 1
);

CREATE TABLE rfid_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  epc_id TEXT NOT NULL,
  tid TEXT,
  product_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  status TEXT DEFAULT 'active',
  last_seen TEXT,
  last_seen_session_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER,
  updated_by INTEGER
);

CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  permissions TEXT DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  code TEXT,
  is_system INTEGER DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE sale_amendments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  group_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN (
    'line_added',
    'line_quantity_increased',
    'line_quantity_decreased',
    'line_removed',
    'line_updated',
    'delivery_fee_changed',
    'delivery_actual_cost_changed',
    'delivery_added'
  )),
  sale_item_id INTEGER,
  product_id INTEGER,
  product_name TEXT,
  quantity_before REAL,
  quantity_after REAL,
  quantity_delta REAL,
  amount_before_usd REAL,
  amount_after_usd REAL,
  amount_delta_usd REAL,
  total_before_usd REAL,
  total_after_usd REAL,
  units_moved REAL NOT NULL DEFAULT 0,
  stock_skipped INTEGER NOT NULL DEFAULT 0,
  via TEXT NOT NULL DEFAULT 'amend' CHECK (via IN ('amend', 'undo', 'redo')),
  reverses_amendment_id INTEGER,
  undo_action_id INTEGER,
  note TEXT,
  before_json TEXT,
  after_json TEXT,
  user_id INTEGER,
  user_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sale_bulk_guards (id INTEGER PRIMARY KEY, guard_value INTEGER NOT NULL CHECK(guard_value = 1));

CREATE TABLE sale_bulk_members (
 operation_id TEXT NOT NULL REFERENCES sale_bulk_operations(id), sale_id INTEGER NOT NULL,
 revision INTEGER NOT NULL, movement_fingerprint TEXT NOT NULL, PRIMARY KEY(operation_id, sale_id)
);

CREATE TABLE sale_bulk_operations (
 id TEXT PRIMARY KEY, actor_id INTEGER NOT NULL, request_id TEXT NOT NULL,
 request_json TEXT NOT NULL, snapshot_id INTEGER REFERENCES undo_snapshots(id),
 history_id INTEGER REFERENCES action_history(id), generation INTEGER NOT NULL DEFAULT 0,
 receipt_json TEXT NOT NULL, UNIQUE(actor_id, request_id)
);

CREATE TABLE sale_incident_recovery_guards (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  guard_value INTEGER NOT NULL CHECK(guard_value = 1)
);

CREATE TABLE sale_incident_recovery_members (
  operation_id TEXT NOT NULL REFERENCES sale_incident_recovery_receipts(id),
  sale_id INTEGER NOT NULL UNIQUE CHECK(sale_id IN (16951, 16952, 16953, 16954)),
  history_id INTEGER NOT NULL REFERENCES action_history(id),
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  PRIMARY KEY(operation_id, sale_id)
);

CREATE TABLE sale_incident_recovery_receipts (
  id TEXT PRIMARY KEY,
  incident_key TEXT NOT NULL UNIQUE CHECK(incident_key IN ('sale-zero-items-20260909-v1', 'sale-zero-items-20260909-v2')),
  actor_id INTEGER NOT NULL,
  actor_name TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  request_json TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  backup_created INTEGER NOT NULL CHECK(backup_created = 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sale_item_batch_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_item_id INTEGER NOT NULL,
  batch_id INTEGER NOT NULL,
  branch_id INTEGER,
  quantity REAL NOT NULL,
  lot_code TEXT,
  expiry_date TEXT,
  released_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
, released_quantity REAL NOT NULL DEFAULT 0);

CREATE TABLE sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  product_id INTEGER,
  product_name TEXT,
  sku TEXT,
  quantity REAL DEFAULT 1,
  unit TEXT,
  applied_price_usd REAL DEFAULT 0,
  applied_price_khr REAL DEFAULT 0,
  cost_price_usd REAL DEFAULT 0,
  cost_price_khr REAL DEFAULT 0,
  total_usd REAL DEFAULT 0,
  total_khr REAL DEFAULT 0,
  branch_id INTEGER,
  price_mode TEXT DEFAULT 'selling',
  product_discount_type TEXT,
  product_discount_label TEXT,
  product_discount_usd REAL DEFAULT 0,
  product_discount_khr REAL DEFAULT 0
, base_price_usd REAL DEFAULT 0, base_price_khr REAL DEFAULT 0, manual_discount_type TEXT, manual_discount_value REAL DEFAULT 0, manual_discount_usd REAL DEFAULT 0, manual_discount_khr REAL DEFAULT 0, batch_id INTEGER, batch_label TEXT, batch_expiry_date TEXT, returned_quantity REAL NOT NULL DEFAULT 0 CHECK(returned_quantity >= 0 AND returned_quantity <= quantity), damaged_lot_id INTEGER, pricing_snapshot_json TEXT);

CREATE TABLE sale_mutation_guards (
  id INTEGER PRIMARY KEY,
  guard_value INTEGER NOT NULL CHECK(guard_value = 1)
);

CREATE TABLE sale_mutation_members (
  operation_id TEXT NOT NULL REFERENCES sale_mutation_receipts(id),
  entity_kind TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY(operation_id, entity_kind, ordinal)
);

CREATE TABLE sale_mutation_receipts (
  id TEXT PRIMARY KEY,
  actor_id INTEGER NOT NULL,
  sale_id INTEGER NOT NULL,
  mutation_kind TEXT NOT NULL CHECK(mutation_kind IN ('settlement', 'add_items', 'amendment')),
  request_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  request_json TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  history_id INTEGER REFERENCES action_history(id),
  generation INTEGER NOT NULL DEFAULT 0,
  sale_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(actor_id, mutation_kind, request_id)
);

CREATE TABLE sale_not_paid_repair_0173 (
  sale_item_id INTEGER PRIMARY KEY,
  allocation_id INTEGER NOT NULL,
  sale_id INTEGER NOT NULL,
  receipt_number TEXT,
  product_id INTEGER NOT NULL,
  product_name TEXT,
  branch_id INTEGER NOT NULL,
  allocation_batch_id INTEGER NOT NULL,
  deduct_batch_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  unit_cost_usd REAL NOT NULL DEFAULT 0,
  batch_before REAL,
  branch_before REAL,
  product_before REAL,
  applied INTEGER NOT NULL DEFAULT 0,
  applied_at TEXT
);

CREATE TABLE sale_not_paid_stock_recovery_guards (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  guard_value INTEGER NOT NULL CHECK(guard_value = 1)
);

CREATE TABLE sale_not_paid_stock_recovery_members (
  operation_id TEXT NOT NULL REFERENCES sale_not_paid_stock_recovery_receipts(id),
  sale_id INTEGER NOT NULL UNIQUE CHECK(sale_id IN (16952, 16953, 16954)),
  history_id INTEGER NOT NULL REFERENCES action_history(id),
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  PRIMARY KEY(operation_id, sale_id)
);

CREATE TABLE sale_not_paid_stock_recovery_receipts (
  id TEXT PRIMARY KEY,
  incident_key TEXT NOT NULL UNIQUE CHECK(incident_key = 'sale-not-paid-stock-recovery-20260909-v1'),
  actor_id INTEGER NOT NULL,
  actor_name TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  request_json TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  backup_created INTEGER NOT NULL CHECK(backup_created = 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "sale_record_events" (
  id TEXT PRIMARY KEY CHECK (
    length(id) = 36
    AND lower(id) = id
    AND (substr(id,1,6) GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      AND substr(id,7,8) GLOB '[0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-'
      AND substr(id,15,8) GLOB '4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f]'
      AND substr(id,23,7) GLOB '[0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      AND substr(id,30,6) GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      AND substr(id,36,1) GLOB '[0-9a-f]')
  ),
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'sale_status', 'sale_customer', 'sale_settlement', 'sale_bulk_status',
    'sale_bulk_update', 'return_create', 'return_edit', 'return_bulk'
  )),
  source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 180),
  generation INTEGER NOT NULL CHECK (typeof(generation) = 'integer' AND generation BETWEEN 0 AND 1000000),
  kind TEXT NOT NULL CHECK (kind IN (
    'sale_created', 'driver_changed', 'delivery_cost_changed',
    'delivery_fee_changed', 'delivery_added', 'item_added', 'item_removed',
    'item_quantity_changed', 'items_replaced', 'customer_changed',
    'membership_changed', 'status_changed', 'payment_changed',
    'payment_settled', 'cancelled'
  )),
  via TEXT NOT NULL CHECK (via IN ('apply', 'undo', 'redo')),
  subject TEXT CHECK (subject IS NULL OR length(subject) <= 240),
  actor_id INTEGER,
  actor_username TEXT CHECK (actor_username IS NULL OR length(actor_username) <= 120),
  occurred_at TEXT NOT NULL CHECK (length(trim(occurred_at)) BETWEEN 1 AND 40),
  changes_json TEXT NOT NULL
    CHECK (json_valid(changes_json))
    CHECK (json_type(CASE WHEN json_valid(changes_json) THEN changes_json ELSE '[]' END) = 'array')
    CHECK (json_array_length(CASE WHEN json_valid(changes_json) THEN changes_json ELSE '[]' END) BETWEEN 1 AND 12)
    CHECK (length(CAST(changes_json AS BLOB)) <= 65536),
  request_digest TEXT CHECK (
    request_digest IS NULL OR (
      length(request_digest) = 64 AND request_digest NOT GLOB '*[^0-9a-f]*'
    )
  ),
  response_json TEXT
    CHECK (response_json IS NULL OR json_valid(response_json))
    CHECK (
      response_json IS NULL OR
      json_type(CASE WHEN json_valid(response_json) THEN response_json ELSE '{}' END) = 'object'
    )
    CHECK (response_json IS NULL OR length(CAST(response_json AS BLOB)) <= 65536),
  CHECK (
    (source_kind = 'sale_status' AND kind IN ('status_changed', 'cancelled'))
    OR (source_kind = 'sale_customer' AND kind = 'customer_changed')
    OR (source_kind = 'sale_settlement' AND kind IN ('payment_changed', 'payment_settled'))
    OR (source_kind = 'sale_bulk_status' AND kind IN ('status_changed', 'cancelled'))
    OR (source_kind = 'sale_bulk_update' AND kind IN ('customer_changed', 'payment_changed', 'driver_changed'))
    OR (source_kind IN ('return_create', 'return_edit', 'return_bulk') AND kind = 'status_changed')
  ),
  CHECK (
    (generation = 0 AND via = 'apply')
    OR (
      source_kind IN ('sale_settlement', 'sale_bulk_status', 'sale_bulk_update', 'return_bulk')
      AND generation > 0
      AND ((generation % 2 = 1 AND via = 'undo') OR (generation % 2 = 0 AND via = 'redo'))
    )
  ),
  UNIQUE(source_kind, source_id, generation, sale_id)
);

CREATE TABLE sale_status_normalization_ledger (
  sale_id INTEGER PRIMARY KEY,
  sale_status_before TEXT,
  status_before_return_before TEXT,
  status_before_cancel_before TEXT,
  sale_status_after TEXT NOT NULL,
  status_before_cancel_after TEXT,
  return_state_after TEXT,
  loyalty_accrual_before INTEGER,
  migrated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sale_write_revisions (sale_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0);

CREATE TABLE sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_number TEXT,
  cashier_id INTEGER,
  cashier_name TEXT,
  branch_id INTEGER,
  branch_name TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  payment_method TEXT DEFAULT 'Cash',
  payment_currency TEXT DEFAULT 'USD',
  exchange_rate REAL DEFAULT 4100,
  subtotal_usd REAL DEFAULT 0,
  subtotal_khr REAL DEFAULT 0,
  discount_usd REAL DEFAULT 0,
  discount_khr REAL DEFAULT 0,
  tax_usd REAL DEFAULT 0,
  tax_khr REAL DEFAULT 0,
  total_usd REAL DEFAULT 0,
  total_khr REAL DEFAULT 0,
  amount_paid_usd REAL DEFAULT 0,
  amount_paid_khr REAL DEFAULT 0,
  change_usd REAL DEFAULT 0,
  change_khr REAL DEFAULT 0,
  is_delivery INTEGER DEFAULT 0,
  delivery_contact_id INTEGER,
  delivery_contact_name TEXT,
  delivery_contact_phone TEXT,
  delivery_contact_address TEXT,
  delivery_fee_usd REAL DEFAULT 0,
  delivery_fee_khr REAL DEFAULT 0,
  delivery_fee_paid_by TEXT DEFAULT 'customer',
  sale_status TEXT DEFAULT 'completed',
  notes TEXT,
  items TEXT DEFAULT '[]',
  device_name TEXT,
  device_tz TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  customer_id INTEGER,
  membership_discount_usd REAL DEFAULT 0,
  membership_discount_khr REAL DEFAULT 0,
  membership_points_redeemed REAL DEFAULT 0,
  updated_at TEXT,
  client_request_id TEXT
, payment_details TEXT, loyalty_accrual INTEGER NOT NULL DEFAULT 1, cancel_reason TEXT, cancel_note TEXT, cancelled_at TEXT, cancelled_by_name TEXT, status_before_cancel TEXT, cancel_fee_id INTEGER, delivery_actual_cost_usd REAL, delivery_actual_cost_khr REAL, search_normalized TEXT, credit_due_date TEXT, source_return_id INTEGER, legacy_receipt_number TEXT, stock_skipped INTEGER NOT NULL DEFAULT 0, stock_skipped_at TEXT, stock_skipped_by_name TEXT, status_before_return TEXT, change_is_actual INTEGER NOT NULL DEFAULT 0
  CHECK (change_is_actual IN (0, 1)), change_exchange_rate REAL, creation_snapshot_json TEXT
  CHECK (creation_snapshot_json IS NULL OR json_valid(creation_snapshot_json)), money_precision_version INTEGER NOT NULL DEFAULT 0, calculated_total_usd REAL, rounding_adjustment_usd REAL NOT NULL DEFAULT 0, return_state TEXT CHECK (return_state IS NULL OR return_state IN ('partial','full')), return_review_state TEXT CHECK (return_review_state IS NULL OR return_review_state IN ('pending','confirmed')), return_reviewed_at TEXT, return_reviewed_by_id INTEGER, return_reviewed_by_name TEXT, delivery_pending INTEGER NOT NULL DEFAULT 0 CHECK (delivery_pending IN (0,1)));

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);

CREATE TABLE shift_close_figures (
  shift_session_id INTEGER PRIMARY KEY REFERENCES shift_sessions(id) ON DELETE RESTRICT,
  closed_at TEXT NOT NULL,
  figures_json TEXT NOT NULL CHECK (json_valid(figures_json) AND json_type(figures_json) = 'object'),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE shift_session_amendments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 shift_session_id INTEGER NOT NULL REFERENCES shift_sessions(id) ON DELETE RESTRICT,
 actor_user_id INTEGER NOT NULL, actor_name TEXT, reason TEXT NOT NULL,
 before_json TEXT NOT NULL, after_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE shift_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- S-YYYYMMDD-HHMM, the house session-id format already on the board.
  -- Human-facing and quotable in a handover; the id stays the join key.
  shift_code TEXT NOT NULL,

  user_id INTEGER NOT NULL,
  user_name TEXT,
  branch_id INTEGER,
  branch_name TEXT,

  -- Local (UTC+7) date. This is what "once a day" is counted against.
  business_date TEXT NOT NULL,

  opened_at TEXT NOT NULL,
  opening_float_usd REAL NOT NULL DEFAULT 0,
  opening_float_khr REAL NOT NULL DEFAULT 0,
  opening_note TEXT,
  opened_device_name TEXT,

  -- NULL until the employee ends the shift by hand. NULL is the whole
  -- concurrency guard for "end only once", so it must stay nullable.
  closed_at TEXT,
  closing_counted_usd REAL,
  closing_counted_khr REAL,
  closing_note TEXT,
  closed_device_name TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
, scope_mode TEXT NOT NULL DEFAULT 'per_account'
  CHECK (scope_mode IN ('per_account', 'shop_wide')), closed_by_user_id INTEGER, closed_by_user_name TEXT, revision INTEGER NOT NULL DEFAULT 0, parent_shift_id INTEGER
  REFERENCES shift_sessions(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED, reopen_reason TEXT, reopened_by_user_id INTEGER, reopened_by_user_name TEXT, cancelled_at TEXT, cancelled_by_user_id INTEGER, cancelled_by_user_name TEXT, cancel_reason TEXT, opening_float_usd_registered INTEGER NOT NULL DEFAULT 0
  CHECK (opening_float_usd_registered IN (0, 1)), opening_float_khr_registered INTEGER NOT NULL DEFAULT 0
  CHECK (opening_float_khr_registered IN (0, 1)), additional_cash_usd REAL NOT NULL DEFAULT 0, additional_cash_khr REAL NOT NULL DEFAULT 0);

CREATE TABLE stock_lot_adjustment_operations (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  request_digest TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  revision_json TEXT NOT NULL CHECK(json_valid(revision_json)),
  history_id INTEGER REFERENCES action_history(id),
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation >= 0),
  state TEXT NOT NULL DEFAULT 'applied' CHECK(state IN ('applied','reversed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(actor_id, request_id)
);

CREATE TABLE stock_mutation_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('adjust', 'receive')),
  request_json TEXT NOT NULL,
  written INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER,
  response_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  UNIQUE (actor_id, request_id)
);

CREATE TABLE stock_row_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_product_id INTEGER NOT NULL,
  source_product_name TEXT,
  destination_product_id INTEGER NOT NULL,
  destination_product_name TEXT,
  branch_id INTEGER,
  branch_name TEXT,
  quantity REAL NOT NULL,
  reason TEXT,
  note TEXT,
  user_id INTEGER,
  user_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE stock_session_guards (
  id INTEGER PRIMARY KEY,
  guard_value INTEGER NOT NULL CHECK (guard_value = 1)
);

CREATE TABLE stock_session_members (
  operation_id TEXT NOT NULL REFERENCES stock_session_operations(id),
  line_id TEXT NOT NULL,
  command_kind TEXT NOT NULL CHECK (command_kind IN ('receive', 'create_receive')),
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_created INTEGER NOT NULL DEFAULT 0 CHECK (product_created IN (0, 1)),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  batch_id INTEGER REFERENCES product_batches(id),
  movement_id INTEGER REFERENCES inventory_movements(id),
  quantity REAL NOT NULL CHECK (quantity >= 0),
  unit_cost_usd REAL, branch_name TEXT,
  PRIMARY KEY (operation_id, line_id)
);

CREATE TABLE stock_session_operations (
  id TEXT PRIMARY KEY,
  actor_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode = 'stock_in'),
  request_json TEXT NOT NULL,
  receipt_json TEXT NOT NULL DEFAULT '{}',
  snapshot_id INTEGER REFERENCES undo_snapshots(id),
  history_id INTEGER REFERENCES action_history(id),
  generation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (actor_id, request_id)
);

CREATE TABLE stock_session_revisions (
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entity_type, entity_key)
);

CREATE TABLE stock_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_branch_id INTEGER,
  to_branch_id INTEGER,
  product_id INTEGER,
  product_name TEXT,
  quantity REAL,
  notes TEXT,
  user_id INTEGER,
  user_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  client_request_id TEXT
, receipt_id INTEGER, member_ordinal INTEGER, generation INTEGER, from_branch_name TEXT, to_branch_name TEXT);

CREATE TABLE supplier_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_branch TEXT NOT NULL,
  branch_id INTEGER,
  legacy_id INTEGER NOT NULL,
  supplier_id INTEGER,
  supplier_code TEXT,
  supplier_name TEXT NOT NULL,
  invoice_no TEXT,
  invoice_date TEXT NOT NULL,
  due_date TEXT,
  term_days INTEGER NOT NULL DEFAULT 0,
  taxable_amount_usd REAL NOT NULL DEFAULT 0,
  vat_amount_usd REAL NOT NULL DEFAULT 0,
  total_amount_usd REAL NOT NULL DEFAULT 0,
  amount_paid_usd REAL NOT NULL DEFAULT 0,
  outstanding_balance_usd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  source_file TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_branch, legacy_id)
);

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  company TEXT,
  contact_person TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
, gender TEXT);

CREATE VIRTUAL TABLE suppliers_fts USING fts5(
  name, phone, email, company, contact_person,
  content='suppliers',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE suppliers_fts_phone USING fts5(
  phone,
  content='suppliers',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TABLE system_flags (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE telegram_scheduled_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  send_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('shift_overview')),
  shift_id INTEGER NOT NULL,
  -- ISO-8601 UTC from the Worker (Date#toISOString), compared as text.
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'skipped', 'failed')),
  -- How the send was scheduled: the delayed queue message, or the fallback
  -- that the next request or cron tick drains.
  dispatch TEXT NOT NULL DEFAULT 'fallback' CHECK (dispatch IN ('queue', 'fallback')),
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  sent_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE transfer_operation_members (
  receipt_id INTEGER NOT NULL REFERENCES transfer_operation_receipts(id),
  ordinal INTEGER NOT NULL CHECK(ordinal>=0),
  source_product_id INTEGER NOT NULL,
  destination_product_id INTEGER NOT NULL,
  source_branch_id INTEGER NOT NULL,
  destination_branch_id INTEGER NOT NULL,
  quantity REAL NOT NULL CHECK(quantity>0),
  untracked_quantity REAL NOT NULL CHECK(untracked_quantity>=0 AND untracked_quantity<=quantity),
  source_snapshot TEXT NOT NULL CHECK(json_valid(source_snapshot)),
  destination_snapshot TEXT NOT NULL CHECK(json_valid(destination_snapshot)),
  allocations_json TEXT NOT NULL CHECK(json_valid(allocations_json) AND json_type(allocations_json)='array'),
  PRIMARY KEY(receipt_id,ordinal)
);

CREATE TABLE transfer_operation_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER NOT NULL,
  request_id TEXT NOT NULL CHECK(request_id = trim(request_id)),
  request_digest TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_json TEXT,
  status TEXT NOT NULL DEFAULT 'committed',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, operation_id TEXT, provenance_version INTEGER NOT NULL DEFAULT 0, action_history_id INTEGER, replay_state TEXT NOT NULL DEFAULT 'recorded', generation INTEGER NOT NULL DEFAULT 0,
  UNIQUE(actor_id, request_id)
);

CREATE TABLE trusted_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT,
  user_agent TEXT,
  first_ip TEXT,
  last_ip TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT,
  decided_by_user_id INTEGER,
  decided_by_name TEXT,
  last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
, first_country TEXT, last_country TEXT);

CREATE TABLE undo_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'applied',
  payload_json TEXT NOT NULL,
  created_by_id INTEGER,
  created_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  color TEXT DEFAULT '#6366f1',
  updated_at TEXT
);

CREATE TABLE user_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, sort_order INTEGER NOT NULL DEFAULT 0);

CREATE TABLE user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  device_name TEXT,
  device_tz TEXT,
  client_time TEXT,
  user_agent TEXT,
  last_ip TEXT,
  last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
, device_id TEXT, limit_family_id INTEGER);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  name TEXT NOT NULL,
  password TEXT NOT NULL,
  role_id INTEGER,
  permissions TEXT DEFAULT '{}',
  otp_enabled INTEGER DEFAULT 0,
  otp_secret TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  phone TEXT,
  email TEXT,
  avatar_path TEXT,
  phone_verified INTEGER DEFAULT 0,
  email_verified INTEGER DEFAULT 0,
  supabase_user_id TEXT,
  google_subject TEXT,
  google_email TEXT,
  google_email_verified INTEGER DEFAULT 0,
  google_linked_at TEXT,
  deleted_at TEXT,
  firebase_user_id TEXT,
  otp_pending_secret TEXT,
  otp_pending_created_at TEXT,
  phone_lookup TEXT,
  organization_id INTEGER,
  organization_group_id INTEGER,
  updated_at TEXT
, must_change_password INTEGER NOT NULL DEFAULT 0);

CREATE TABLE verification_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
, target TEXT, attempts INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 5, requester_ip TEXT);

CREATE INDEX audit_product_cost_review_0255 ON audit_logs(entity_id,
  json_extract(CASE WHEN json_valid(details) THEN details ELSE '{}' END,'$.cost_review.before_key'),
  json_extract(CASE WHEN json_valid(details) THEN details ELSE '{}' END,'$.cost_review.after_key'),
  json_extract(CASE WHEN json_valid(details) THEN details ELSE '{}' END,'$.cost_review.revision_before'))
  WHERE action='cost_override' AND entity='product' AND json_extract(CASE WHEN json_valid(details) THEN details ELSE '{}' END,'$.cost_review.version')=1;

CREATE UNIQUE INDEX audit_product_cost_review_operation_0255 ON audit_logs(entity_id,
  json_extract(CASE WHEN json_valid(details) THEN details ELSE '{}' END,'$.cost_review.operation_key'))
  WHERE action='cost_override' AND entity='product' AND json_extract(CASE WHEN json_valid(details) THEN details ELSE '{}' END,'$.cost_review.version')=1;

CREATE UNIQUE INDEX branch_cutovers_one_active ON branch_cutovers((1))
WHERE phase NOT IN ('completed','aborted');

CREATE INDEX idx_action_history_created_pg ON action_history (created_at DESC, id DESC);

CREATE INDEX idx_action_history_scope_updated_pg ON action_history (scope, updated_at DESC, id DESC);

CREATE INDEX idx_action_history_scope_user_updated_pg ON action_history (scope, created_by_id, updated_at DESC, id DESC);

CREATE INDEX idx_audit_logs_action_created ON audit_logs(action, created_at);

CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

CREATE INDEX idx_audit_logs_entity_entity_id ON audit_logs(entity, entity_id);

CREATE INDEX idx_audit_logs_sale_ref ON audit_logs(CAST(COALESCE(entity_id, record_id) AS TEXT))
  WHERE entity = 'sale' OR table_name = 'sale';

CREATE INDEX idx_audit_logs_user_created ON audit_logs(user_id, created_at);

CREATE UNIQUE INDEX idx_branch_batch_stock_batch_branch_unique ON branch_batch_stock (batch_id, branch_id);

CREATE INDEX idx_branch_batch_stock_branch_qty ON branch_batch_stock (branch_id, quantity DESC, batch_id);

CREATE INDEX idx_branch_batch_stock_positive_batch_0155
ON branch_batch_stock(batch_id) WHERE quantity>0;

CREATE INDEX idx_branch_stock_branch_qty_product_pg ON branch_stock (branch_id, quantity DESC, product_id);

CREATE UNIQUE INDEX idx_branch_stock_product_branch_unique ON branch_stock (product_id, branch_id);

CREATE UNIQUE INDEX idx_branches_canonical_key ON branches(canonical_key) WHERE canonical_key IS NOT NULL;

CREATE INDEX idx_bulk_delete_jobs_status ON bulk_delete_jobs(status, updated_at);

CREATE UNIQUE INDEX idx_categories_name_normalized_unique
  ON categories(lower(trim(name)));

CREATE UNIQUE INDEX idx_contact_dup_dismissals_key
  ON contact_duplicate_dismissals(contact_table, cluster_type, cluster_value);

CREATE INDEX idx_customer_receivables_customer_date
  ON customer_receivables(customer_id, invoice_date DESC);

CREATE INDEX idx_customer_receivables_date
  ON customer_receivables(invoice_date DESC, id DESC);

CREATE INDEX idx_customer_receivables_invoice_no
  ON customer_receivables(invoice_no, invoice_date DESC);

CREATE INDEX idx_customer_receivables_status
  ON customer_receivables(status, outstanding_balance_usd);

CREATE INDEX idx_customer_share_submissions_status_created_pg ON customer_share_submissions (status, created_at DESC, id DESC);

CREATE UNIQUE INDEX idx_customers_membership_lower_pg
  ON customers (lower(membership_number))
  WHERE membership_number IS NOT NULL AND TRIM(membership_number) != '';

CREATE INDEX idx_customers_membership_normalized
ON customers(lower(trim(membership_number)));

CREATE INDEX idx_customers_phone_normalized
  ON customers (phone_normalized)
  WHERE phone_normalized IS NOT NULL AND phone_normalized != '';

CREATE INDEX idx_damaged_lots_product_branch ON damaged_stock_lots(product_id, branch_id);

CREATE INDEX idx_damaged_lots_product_branch_tag
  ON damaged_stock_lots(product_id, branch_id, condition_tag);

CREATE INDEX idx_damaged_lots_return ON damaged_stock_lots(return_id);

CREATE INDEX idx_dated_stock_count_batch_actions_movement
  ON dated_stock_count_batch_actions (movement_id);

CREATE INDEX idx_fee_operation_receipts_fee_time
  ON fee_operation_receipts(fee_id,occurred_at,id);

CREATE INDEX idx_fees_branch_created_dt ON fees (branch_id, datetime(created_at));

CREATE INDEX idx_fees_branch_id ON fees(branch_id);

CREATE INDEX idx_fees_created_dt ON fees (datetime(created_at));

CREATE INDEX idx_fees_delivery_contact_date
  ON fees(delivery_contact_id, fee_date DESC, id DESC);

CREATE INDEX idx_fees_fee_date ON fees(fee_date);

CREATE INDEX idx_fees_fee_type ON fees(fee_type);

CREATE INDEX idx_fees_sale_id ON fees(sale_id);

CREATE UNIQUE INDEX idx_file_assets_public_path_unique ON file_assets (public_path);

CREATE UNIQUE INDEX idx_google_drive_sync_entries_path_unique ON google_drive_sync_entries (relative_path);

CREATE INDEX idx_image_audit_status ON image_audit (status, byte_size DESC);

CREATE INDEX idx_import_auto_merges_product ON import_auto_merges(product_id);

CREATE UNIQUE INDEX idx_import_job_batches_job_batch_unique ON import_job_batches (job_id, batch_index);

CREATE INDEX idx_import_job_errors_job_batch_pg ON import_job_errors (job_id, batch_id, id);

CREATE INDEX idx_import_job_files_job_kind_pg ON import_job_files (job_id, kind, id);

CREATE INDEX idx_import_job_rows_phase_action ON import_job_rows (job_id, phase, action);

CREATE INDEX idx_import_job_rows_phase_group ON import_job_rows (job_id, phase, group_index);

CREATE INDEX idx_import_sales_commits_job_status
  ON import_sales_commits(job_id, status, row_number);

CREATE INDEX idx_import_stock_action_commits_job_status
  ON import_stock_action_commits(job_id, status, row_number);

CREATE INDEX idx_inventory_movements_batch
  ON inventory_movements (batch_id) WHERE batch_id IS NOT NULL;

CREATE INDEX idx_inventory_movements_branch_created_pg ON inventory_movements (branch_id, created_at DESC, id DESC);

CREATE INDEX idx_inventory_movements_created_pg ON inventory_movements (created_at DESC, id DESC);

CREATE INDEX idx_inventory_movements_created_type_user_branch_id
  ON inventory_movements (created_at, movement_type, user_id, branch_id, id);

CREATE INDEX idx_inventory_movements_product_created_pg ON inventory_movements (product_id, created_at DESC, id DESC);

CREATE INDEX idx_inventory_movements_reference_type_id
  ON inventory_movements (reference_id, movement_type, id);

CREATE INDEX idx_inventory_movements_user_created_pg ON inventory_movements (user_id, created_at DESC, id DESC);

CREATE INDEX idx_legacy_deleted_items_deleted_at
  ON legacy_deleted_sale_items(deleted_at DESC, id DESC);

CREATE INDEX idx_legacy_deleted_items_event
  ON legacy_deleted_sale_items(event_key, source_row);

CREATE INDEX idx_legacy_deleted_items_product
  ON legacy_deleted_sale_items(product_id, deleted_at DESC);

CREATE INDEX idx_legacy_sale_date_corrections_source_date
  ON legacy_sale_date_corrections(source_created_at, receipt_number);

CREATE INDEX idx_legacy_sale_item_corrections_receipt
  ON legacy_sale_item_corrections(receipt_number, line_ordinal);

CREATE INDEX idx_loyalty_point_adjustments_customer ON loyalty_point_adjustments (customer_id);

CREATE INDEX idx_loyalty_point_adjustments_customer_created
  ON loyalty_point_adjustments(customer_id, created_at DESC);

CREATE UNIQUE INDEX idx_password_reset_requests_pending_user
  ON password_reset_requests (user_id) WHERE status = 'pending';

CREATE INDEX idx_password_reset_requests_status_requested
  ON password_reset_requests (status, requested_at);

CREATE INDEX idx_pending_actions_requested_by ON pending_actions(requested_by);

CREATE INDEX idx_pending_actions_section ON pending_actions(section);

CREATE INDEX idx_pending_actions_status ON pending_actions(status);

CREATE INDEX idx_portal_accounts_contact ON portal_accounts (contact_id);

CREATE UNIQUE INDEX idx_portal_accounts_membership ON portal_accounts (lower(trim(membership_id)));

CREATE UNIQUE INDEX idx_portal_accounts_phone ON portal_accounts (phone);

CREATE INDEX idx_portal_password_resets_token ON portal_password_resets (token_hash);

CREATE INDEX idx_portal_sessions_account ON portal_sessions (account_id);

CREATE INDEX idx_portal_sessions_token ON portal_sessions (token_hash);

CREATE INDEX idx_product_batches_credit_due ON product_batches (credit_due_date)
  WHERE payment_status = 'credit' AND is_active = 1;

CREATE INDEX idx_product_batches_received_at ON product_batches (received_at);

CREATE INDEX idx_product_batches_variant_expiry ON product_batches (variant_product_id, expiry_date, received_at, id);

CREATE UNIQUE INDEX idx_product_batches_variant_key_unique ON product_batches (variant_product_id, batch_key);

CREATE INDEX idx_product_batches_variant_number ON product_batches (variant_product_id, batch_number);

CREATE INDEX idx_product_conflict_action_groups_page
ON product_conflict_action_groups(review_id, ordinal, status);

CREATE INDEX idx_product_conflict_action_members_product
ON product_conflict_action_group_members(product_id, review_id);

CREATE INDEX idx_product_conflict_action_reviews_actor_expiry
ON product_conflict_action_reviews(actor_id, expires_at, id);

CREATE INDEX idx_product_conflict_action_reviews_actor_status
ON product_conflict_action_reviews(actor_id, status, updated_at, id);

CREATE INDEX idx_product_conflict_merge_run_cases_status
ON product_conflict_merge_run_cases(run_id, status, ordinal);

CREATE INDEX idx_product_conflict_merge_runs_status
ON product_conflict_merge_runs(status, updated_at, id);

CREATE INDEX idx_product_cost_entries_product ON product_cost_entries(product_id, id);

CREATE UNIQUE INDEX idx_product_dup_dismissals_key
  ON product_duplicate_dismissals(cluster_type, cluster_value);

CREATE INDEX idx_product_images_image_path ON product_images(image_path);

CREATE INDEX idx_product_images_product_sort_pg ON product_images (product_id, sort_order, id);

CREATE INDEX idx_product_merge_map_0165_keeper ON product_merge_map_0165 (keeper_id);

CREATE INDEX idx_product_merge_map_0168_keeper ON product_merge_map_0168 (keeper_id);

CREATE INDEX idx_product_merge_map_0174_keeper ON product_merge_map_0174 (keeper_id);

CREATE INDEX idx_product_remove_operations_product
ON product_remove_operations(product_id, status, operation_id);

CREATE INDEX idx_product_remove_operations_review_status
ON product_remove_operations(review_id, action_ordinal, status);

CREATE INDEX idx_products_active_brand_pg ON products (is_active, brand);

CREATE INDEX idx_products_active_category_pg ON products (is_active, category);

CREATE INDEX idx_products_active_created_pg ON products (is_active, created_at DESC, id DESC);

CREATE INDEX idx_products_active_expiry_day
  ON products(is_active, date(expiry_date))
  WHERE expiry_date IS NOT NULL;

CREATE INDEX idx_products_active_grouped_pg ON products (is_active, is_grouped_cached);

CREATE INDEX idx_products_active_name_id_pg ON products (is_active, name, id);

CREATE INDEX idx_products_active_stock_name_pg ON products (is_active, stock_quantity, name);

CREATE INDEX idx_products_active_supplier_pg ON products (is_active, supplier);

CREATE INDEX idx_products_barcode_pg ON products (barcode);

CREATE INDEX idx_products_brand_compact ON products(brand_compact);

CREATE INDEX idx_products_brand_lower_pg ON products (lower(brand));

CREATE INDEX idx_products_category_lower_pg ON products (lower(category));

CREATE UNIQUE INDEX idx_products_client_request_unique_pg ON products (client_request_id) WHERE ((client_request_id IS NOT NULL) AND (client_request_id <> ''));

CREATE INDEX idx_products_image_path ON products(image_path);

CREATE INDEX idx_products_name_key_pg ON products (name_key);

CREATE INDEX idx_products_name_lower_pg ON products (lower(name));

CREATE INDEX idx_products_parent_pg ON products (parent_id, is_group);

CREATE INDEX idx_products_sku_pg ON products (sku);

CREATE INDEX idx_products_supplier_lower_pg ON products (lower(supplier));

CREATE INDEX idx_products_unit_lower_pg ON products (lower(unit));

CREATE INDEX idx_promotion_rules_active ON promotion_rules (is_active, ends_at);

CREATE INDEX idx_promotions_active_sort ON promotions(is_active, sort_order, id);

CREATE INDEX idx_promotions_image_path ON promotions(image_path);

CREATE INDEX idx_rate_limit_events_lookup ON rate_limit_events (bucket, client_key, created_at);

CREATE INDEX idx_return_create_receipts_return_time
  ON return_create_receipts(return_id,occurred_at,id);

CREATE INDEX idx_return_item_batch_allocations_return_item ON return_item_batch_allocations (return_item_id, reversed_at);

CREATE INDEX idx_return_items_return_id_pg ON return_items (return_id, id);

CREATE INDEX idx_return_items_sale_item ON return_items(sale_item_id);

CREATE INDEX idx_return_mutation_receipts_return_time
  ON return_mutation_receipts(return_id,occurred_at,id);

CREATE INDEX idx_return_replacements_return ON return_replacement_items(return_id);

CREATE INDEX idx_return_replacements_sale_item ON return_replacement_items(sale_item_id);

CREATE UNIQUE INDEX idx_returns_client_request_unique_pg ON returns (client_request_id) WHERE ((client_request_id IS NOT NULL) AND (client_request_id <> ''));

CREATE INDEX idx_returns_created_pg ON returns (created_at DESC, id DESC);

CREATE INDEX idx_returns_replacement_sale ON returns(replacement_sale_id);

CREATE INDEX idx_returns_sale_id ON returns (sale_id);

CREATE INDEX idx_returns_scope_created_pg ON returns (COALESCE(return_scope, 'customer'), created_at DESC, id DESC);

CREATE INDEX idx_returns_status_created_pg ON returns (status, created_at DESC, id DESC);

CREATE UNIQUE INDEX idx_rfid_events_dedupe_key_unique ON rfid_events (dedupe_key) WHERE ((dedupe_key IS NOT NULL) AND (dedupe_key <> ''));

CREATE INDEX idx_rfid_events_session_epc ON rfid_events (session_id, epc_id, seen_at DESC);

CREATE UNIQUE INDEX idx_rfid_session_items_unique ON rfid_session_items (session_id, epc_id);

CREATE UNIQUE INDEX idx_rfid_tags_epc_unique ON rfid_tags (epc_id);

CREATE INDEX idx_rfid_tags_product_branch ON rfid_tags (product_id, branch_id, status);

CREATE INDEX idx_sale_amendments_sale ON sale_amendments(sale_id, id);

CREATE INDEX idx_sale_amendments_sale_kind ON sale_amendments(sale_id, kind);

CREATE INDEX idx_sale_incident_recovery_members_history
  ON sale_incident_recovery_members(history_id);

CREATE INDEX idx_sale_item_batch_allocations_batch
  ON sale_item_batch_allocations (batch_id);

CREATE INDEX idx_sale_item_batch_allocations_sale_item ON sale_item_batch_allocations (sale_item_id, released_at);

CREATE INDEX idx_sale_items_branch_sale
  ON sale_items (branch_id, sale_id);

CREATE INDEX idx_sale_items_product_branch_sale_pg ON sale_items (product_id, branch_id, sale_id);

CREATE INDEX idx_sale_items_sale_id_pg ON sale_items (sale_id, id);

CREATE INDEX idx_sale_mutation_members_entity ON sale_mutation_members(entity_kind, entity_id);

CREATE INDEX idx_sale_mutation_receipts_history ON sale_mutation_receipts(history_id) WHERE history_id IS NOT NULL;

CREATE INDEX idx_sale_mutation_receipts_sale ON sale_mutation_receipts(sale_id, created_at);

CREATE INDEX idx_sale_record_events_sale_time
  ON sale_record_events(sale_id, occurred_at, id);

CREATE INDEX idx_sales_branch_created
  ON sales (branch_id, created_at DESC, id DESC);

CREATE INDEX idx_sales_cancel_fee_revision ON sales(cancel_fee_id) WHERE cancel_fee_id IS NOT NULL;

CREATE INDEX idx_sales_cashier_created
  ON sales (cashier_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX idx_sales_client_request_unique_pg ON sales (client_request_id) WHERE ((client_request_id IS NOT NULL) AND (client_request_id <> ''));

CREATE INDEX idx_sales_created_pg ON sales (created_at DESC, id DESC);

CREATE INDEX idx_sales_credit_due
  ON sales(credit_due_date)
  WHERE credit_due_date IS NOT NULL;

CREATE INDEX idx_sales_customer_created ON sales (customer_id, created_at DESC);

CREATE INDEX idx_sales_delivery_pending_created ON sales (delivery_pending, created_at DESC, id DESC) WHERE delivery_pending = 1;

CREATE INDEX idx_sales_legacy_receipt_base
  ON sales (
    CASE WHEN instr(legacy_receipt_number, '@') > 0
         THEN substr(legacy_receipt_number, 1, instr(legacy_receipt_number, '@') - 1)
         ELSE legacy_receipt_number END
  );

CREATE INDEX idx_sales_legacy_receipt_number ON sales(legacy_receipt_number);

CREATE INDEX idx_sales_receipt_number ON sales(receipt_number);

CREATE INDEX idx_sales_return_state_created ON sales (return_state, created_at DESC, id DESC) WHERE return_state IS NOT NULL;

CREATE INDEX idx_sales_source_return ON sales(source_return_id);

CREATE INDEX idx_sales_status_created_pg ON sales (sale_status, created_at DESC, id DESC);

CREATE INDEX idx_sales_stock_skipped ON sales(stock_skipped) WHERE stock_skipped = 1;

CREATE UNIQUE INDEX idx_settings_key_unique ON settings (key);

CREATE INDEX idx_shift_amendments_shift_time ON shift_session_amendments(shift_session_id, created_at, id);

CREATE UNIQUE INDEX idx_shift_sessions_account_day
  ON shift_sessions(user_id, COALESCE(branch_id, -1), business_date)
  WHERE scope_mode = 'per_account' AND parent_shift_id IS NULL;

CREATE INDEX idx_shift_sessions_business_date
  ON shift_sessions(business_date);

CREATE UNIQUE INDEX idx_shift_sessions_code
  ON shift_sessions(shift_code);

CREATE INDEX idx_shift_sessions_open
  ON shift_sessions(user_id, branch_id) WHERE closed_at IS NULL;

CREATE UNIQUE INDEX idx_shift_sessions_parent
  ON shift_sessions(parent_shift_id) WHERE parent_shift_id IS NOT NULL;

CREATE UNIQUE INDEX idx_shift_sessions_shop_day
  ON shift_sessions(COALESCE(branch_id, -1), business_date)
  WHERE scope_mode = 'shop_wide' AND parent_shift_id IS NULL;

CREATE INDEX idx_stock_session_members_batch ON stock_session_members(batch_id) WHERE batch_id IS NOT NULL;

CREATE INDEX idx_stock_session_members_movement
  ON stock_session_members(movement_id) WHERE movement_id IS NOT NULL;

CREATE INDEX idx_stock_session_members_product ON stock_session_members(product_id, operation_id);

CREATE UNIQUE INDEX idx_stock_transfers_client_request_unique ON stock_transfers(client_request_id)
  WHERE receipt_id IS NULL AND client_request_id IS NOT NULL AND client_request_id<>'';

CREATE INDEX idx_stock_transfers_created
  ON stock_transfers (created_at DESC, id DESC);

CREATE INDEX idx_stock_transfers_from_created
  ON stock_transfers (from_branch_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX idx_stock_transfers_operation_member_generation ON stock_transfers(receipt_id,member_ordinal,generation)
  WHERE receipt_id IS NOT NULL;

CREATE INDEX idx_stock_transfers_to_created
  ON stock_transfers (to_branch_id, created_at DESC, id DESC);

CREATE INDEX idx_supplier_invoices_branch_date
  ON supplier_invoices(branch_id, invoice_date DESC);

CREATE INDEX idx_supplier_invoices_date
  ON supplier_invoices(invoice_date DESC, id DESC);

CREATE INDEX idx_supplier_invoices_status_due
  ON supplier_invoices(status, due_date);

CREATE INDEX idx_supplier_invoices_supplier_date
  ON supplier_invoices(supplier_id, invoice_date DESC);

CREATE INDEX idx_telegram_scheduled_sends_due ON telegram_scheduled_sends (status, due_at);

CREATE INDEX idx_transfer_member_destination ON transfer_operation_members(destination_product_id);

CREATE INDEX idx_transfer_member_source ON transfer_operation_members(source_product_id);

CREATE UNIQUE INDEX idx_transfer_operation_id ON transfer_operation_receipts(operation_id) WHERE operation_id IS NOT NULL;

CREATE INDEX idx_transfer_operation_receipts_created
  ON transfer_operation_receipts (created_at DESC, id DESC);

CREATE INDEX idx_trusted_devices_status ON trusted_devices (status);

CREATE UNIQUE INDEX idx_trusted_devices_user_device ON trusted_devices (user_id, device_id);

CREATE INDEX idx_undo_product_merge_invalid_json
ON undo_snapshots(id)
WHERE kind = 'product.merge' AND status = 'applied' AND json_valid(payload_json) = 0;

CREATE INDEX idx_undo_product_merge_plan_keeper
ON undo_snapshots(
  CASE WHEN json_valid(payload_json)
    THEN CAST(json_extract(payload_json, '$.bulkClusterPlan.keeperId') AS INTEGER)
    ELSE NULL END,
  CASE WHEN json_valid(payload_json)
    THEN json_extract(payload_json, '$.bulkClusterPlan.identityKey')
    ELSE NULL END,
  id DESC
)
WHERE kind = 'product.merge' AND status = 'applied' AND json_valid(payload_json) = 1;

CREATE INDEX idx_undo_snapshots_kind_status ON undo_snapshots(kind, status);

CREATE UNIQUE INDEX idx_units_name_normalized_unique
  ON units(lower(trim(name)));

CREATE UNIQUE INDEX idx_user_aliases_alias
  ON user_aliases(lower(trim(alias)));

CREATE INDEX idx_user_aliases_user
  ON user_aliases(user_id);

CREATE INDEX idx_user_notes_user ON user_notes(user_id, pinned DESC, updated_at DESC);

CREATE INDEX idx_user_notes_user_order ON user_notes(user_id, pinned DESC, sort_order ASC, updated_at DESC);

CREATE UNIQUE INDEX idx_user_sessions_token_hash_unique_pg ON user_sessions (token_hash);

CREATE INDEX idx_user_sessions_user_device ON user_sessions (user_id, device_id);

CREATE INDEX idx_verification_codes_ip_created ON verification_codes(requester_ip, created_at);

CREATE INDEX idx_verification_codes_user_purpose ON verification_codes(user_id, purpose, created_at);

CREATE INDEX inventory_check_events_session ON inventory_check_events(session_id,id DESC);

CREATE INDEX inventory_check_items_state ON inventory_check_items(session_id,state,product_id);

CREATE INDEX inventory_check_sessions_recent ON inventory_check_sessions(organization_id,updated_at DESC,id);

CREATE UNIQUE INDEX uq_sale_record_events_direct_request
  ON sale_record_events(source_kind, source_id, generation)
  WHERE source_kind IN ('sale_status', 'sale_customer', 'return_edit');

-- SEED: constants the stock triggers require. See SEED_ROWS in cloudflare/scripts/harness/client_baseline.cjs.
INSERT INTO system_flags (key, value, updated_at) VALUES ('stock_schema_epoch', 'legacy-separate-pool-v1', CURRENT_TIMESTAMP);
INSERT INTO system_flags (key, value, updated_at) VALUES ('stock_schema_receipt_boundary', '0', CURRENT_TIMESTAMP);
INSERT INTO system_flags (key, value, updated_at) VALUES ('multilot_revert_watermark', '0', CURRENT_TIMESTAMP);

CREATE TRIGGER batch_product_active_0242
BEFORE UPDATE OF variant_product_id ON product_batches
WHEN NEW.variant_product_id IS NOT OLD.variant_product_id
 AND EXISTS(SELECT 1 FROM products WHERE id=NEW.variant_product_id AND is_active IS NOT 1)
 AND EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=OLD.id AND quantity<>0)
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER batch_product_insert_active_0242
BEFORE INSERT ON product_batches
WHEN EXISTS(SELECT 1 FROM products WHERE id=NEW.variant_product_id AND is_active IS NOT 1)
 AND EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=NEW.id AND quantity<>0)
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER batch_stock_insert_active_0242
BEFORE INSERT ON branch_batch_stock
WHEN NEW.quantity<>0 AND EXISTS(SELECT 1 FROM product_batches b JOIN products p ON p.id=b.variant_product_id WHERE b.id=NEW.batch_id AND p.is_active IS NOT 1)
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER batch_stock_update_active_0242
BEFORE UPDATE OF batch_id,quantity ON branch_batch_stock
WHEN NEW.quantity<>0 AND EXISTS(SELECT 1 FROM product_batches b JOIN products p ON p.id=b.variant_product_id WHERE b.id=NEW.batch_id AND p.is_active IS NOT 1)
 AND (NEW.batch_id IS NOT OLD.batch_id OR NEW.quantity>MAX(OLD.quantity,0) OR NEW.quantity<MIN(OLD.quantity,0))
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER branch_cutovers_capture_progress BEFORE UPDATE ON branch_cutovers
WHEN NEW.capture_records < OLD.capture_records OR (
  (NEW.capture_cursor_json IS NOT OLD.capture_cursor_json OR NEW.capture_records IS NOT OLD.capture_records OR NEW.capture_digest IS NOT OLD.capture_digest)
  AND NOT (OLD.phase = 'capturing' AND NEW.phase = 'capturing')
)
BEGIN SELECT RAISE(ABORT, 'branch_cutover_invalid_capture_progress'); END;

CREATE TRIGGER branch_cutovers_child_progress BEFORE UPDATE ON branch_cutovers
WHEN NOT (
  (NEW.next_sequence = OLD.next_sequence AND (
    (NEW.planned_child_json IS OLD.planned_child_json AND NEW.planned_child_key IS OLD.planned_child_key AND NEW.planned_child_digest IS OLD.planned_child_digest)
    OR (OLD.planned_child_json IS NULL AND NEW.planned_child_json IS NOT NULL AND OLD.phase = 'moving' AND NEW.phase = 'moving')
  ))
  OR (NEW.next_sequence = OLD.next_sequence + 1 AND OLD.planned_child_json IS NOT NULL AND NEW.planned_child_json IS NULL AND OLD.phase = 'moving' AND NEW.phase IN ('moving','verifying'))
)
BEGIN SELECT RAISE(ABORT, 'branch_cutover_invalid_child_progress'); END;

CREATE TRIGGER branch_cutovers_flag_delete BEFORE DELETE ON system_flags
WHEN OLD.key IN ('maintenance','branch_cutover_control_incarnation')
  AND EXISTS (SELECT 1 FROM branch_cutovers WHERE phase NOT IN ('completed','aborted'))
BEGIN SELECT RAISE(ABORT, 'branch_cutover_active_control_protected'); END;

CREATE TRIGGER branch_cutovers_flag_insert BEFORE INSERT ON system_flags
WHEN NEW.key IN ('maintenance','branch_cutover_control_incarnation')
  AND EXISTS (SELECT 1 FROM branch_cutovers WHERE phase NOT IN ('completed','aborted'))
BEGIN SELECT RAISE(ABORT, 'branch_cutover_active_control_protected'); END;

CREATE TRIGGER branch_cutovers_flag_update BEFORE UPDATE ON system_flags
WHEN (OLD.key IN ('maintenance','branch_cutover_control_incarnation') OR NEW.key IN ('maintenance','branch_cutover_control_incarnation'))
  AND EXISTS (SELECT 1 FROM branch_cutovers WHERE phase NOT IN ('completed','aborted'))
BEGIN SELECT RAISE(ABORT, 'branch_cutover_active_control_protected'); END;

CREATE TRIGGER branch_cutovers_identity BEFORE UPDATE ON branch_cutovers
WHEN NEW.operation_id IS NOT OLD.operation_id OR NEW.begin_request_id IS NOT OLD.begin_request_id
  OR NEW.actor_id IS NOT OLD.actor_id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.control_incarnation IS NOT OLD.control_incarnation OR NEW.maintenance_token IS NOT OLD.maintenance_token
  OR NEW.source_branch_id IS NOT OLD.source_branch_id OR NEW.target_branch_id IS NOT OLD.target_branch_id
  OR NEW.intent_json IS NOT OLD.intent_json OR NEW.intent_digest IS NOT OLD.intent_digest
  OR NEW.source_preimage_json IS NOT OLD.source_preimage_json OR NEW.target_preimage_json IS NOT OLD.target_preimage_json
  OR NEW.maintenance_flag_json IS NOT OLD.maintenance_flag_json OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'branch_cutover_identity_immutable'); END;

CREATE TRIGGER branch_cutovers_initial BEFORE INSERT ON branch_cutovers
WHEN (EXISTS (SELECT 1 FROM branch_cutovers WHERE operation_id = NEW.operation_id OR begin_request_id = NEW.begin_request_id)
  OR NEW.phase <> 'capturing' OR NEW.revision <> 0 OR NEW.next_sequence <> 0 OR NEW.committed_children <> 0
  OR NEW.capture_records <> 0 OR NEW.snapshot_records <> 0 OR NEW.verification_records <> 0
  OR NEW.capture_cursor_json <> '{}' OR NEW.snapshot_cursor_json <> '{}' OR NEW.verification_cursor_json <> '{}'
  OR NEW.manifest_json IS NOT NULL OR NEW.planned_child_json IS NOT NULL OR NEW.terminal_json IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN SELECT RAISE(ABORT, 'branch_cutover_invalid_initial_state'); END;

CREATE TRIGGER branch_cutovers_no_active_insert BEFORE INSERT ON branch_cutovers
WHEN (EXISTS (SELECT 1 FROM branch_cutovers WHERE phase NOT IN ('completed','aborted')))
  AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN SELECT RAISE(ABORT, 'branch_cutover_active_insert_refused'); END;

CREATE TRIGGER branch_cutovers_no_delete BEFORE DELETE ON branch_cutovers
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN SELECT RAISE(ABORT, 'branch_cutover_no_delete'); END;

CREATE TRIGGER branch_cutovers_sealed_manifest BEFORE UPDATE ON branch_cutovers
WHEN (OLD.manifest_json IS NOT NULL AND (NEW.manifest_json IS NOT OLD.manifest_json OR NEW.manifest_digest IS NOT OLD.manifest_digest))
  OR (OLD.manifest_json IS NULL AND NEW.manifest_json IS NOT NULL AND NOT (OLD.phase = 'capturing' AND NEW.phase = 'snapshots'))
BEGIN SELECT RAISE(ABORT, 'branch_cutover_manifest_immutable'); END;

CREATE TRIGGER branch_cutovers_snapshot_progress BEFORE UPDATE ON branch_cutovers
WHEN NEW.snapshot_records < OLD.snapshot_records OR (
  (NEW.snapshot_cursor_json IS NOT OLD.snapshot_cursor_json OR NEW.snapshot_records IS NOT OLD.snapshot_records OR NEW.snapshot_digest IS NOT OLD.snapshot_digest)
  AND NOT (OLD.phase = 'snapshots' AND NEW.phase = 'snapshots')
)
BEGIN SELECT RAISE(ABORT, 'branch_cutover_invalid_snapshot_progress'); END;

CREATE TRIGGER branch_cutovers_terminal BEFORE UPDATE ON branch_cutovers
WHEN OLD.phase IN ('completed','aborted')
BEGIN SELECT RAISE(ABORT, 'branch_cutover_terminal_immutable'); END;

CREATE TRIGGER branch_cutovers_transition BEFORE UPDATE ON branch_cutovers
WHEN NEW.revision <> OLD.revision + 1 OR NOT (
  NEW.phase = OLD.phase
  OR (OLD.phase = 'capturing' AND NEW.phase = 'snapshots')
  OR (OLD.phase = 'snapshots' AND NEW.phase IN ('moving','verifying'))
  OR (OLD.phase = 'moving' AND NEW.phase = 'verifying' AND NEW.planned_child_json IS NULL)
  OR (OLD.phase = 'verifying' AND NEW.phase = 'ready')
  OR (OLD.phase = 'ready' AND NEW.phase = 'completed')
  OR (NEW.phase = 'aborted' AND OLD.next_sequence = 0 AND OLD.planned_child_json IS NULL)
)
BEGIN SELECT RAISE(ABORT, 'branch_cutover_invalid_transition'); END;

CREATE TRIGGER branch_cutovers_verification_progress BEFORE UPDATE ON branch_cutovers
WHEN NEW.verification_records < OLD.verification_records OR (
  (NEW.verification_cursor_json IS NOT OLD.verification_cursor_json OR NEW.verification_records IS NOT OLD.verification_records OR NEW.verification_digest IS NOT OLD.verification_digest)
  AND NOT (OLD.phase = 'verifying' AND NEW.phase = 'verifying')
)
BEGIN SELECT RAISE(ABORT, 'branch_cutover_invalid_verification_progress'); END;

CREATE TRIGGER branch_stock_insert_active_0242
BEFORE INSERT ON branch_stock
WHEN NEW.quantity<>0 AND EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND is_active IS NOT 1)
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER branch_stock_update_active_0242
BEFORE UPDATE OF product_id,quantity ON branch_stock
WHEN NEW.quantity<>0 AND EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND is_active IS NOT 1)
 AND (NEW.product_id IS NOT OLD.product_id OR NEW.quantity>MAX(OLD.quantity,0) OR NEW.quantity<MIN(OLD.quantity,0))
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER branches_canonical_key_immutable BEFORE UPDATE OF canonical_key ON branches
WHEN OLD.canonical_key IS NOT NULL AND NEW.canonical_key IS NOT OLD.canonical_key
BEGIN SELECT RAISE(ABORT, 'branch_canonical_key_immutable'); END;

CREATE TRIGGER catalog_cost_admission_entry_delete_0258
BEFORE DELETE ON product_cost_entries
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER catalog_cost_admission_entry_insert_0258
BEFORE INSERT ON product_cost_entries
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER catalog_cost_admission_entry_update_0258
BEFORE UPDATE ON product_cost_entries
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER catalog_cost_admission_lot_update_0258
BEFORE UPDATE OF unit_cost_usd ON product_batches
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER catalog_cost_admission_product_update_0258
BEFORE UPDATE OF cost_price_usd,cost_price_khr,purchase_price_usd,purchase_price_khr ON products
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER catalog_cost_on_hand_lot_delete_0195
AFTER DELETE ON product_batches
WHEN OLD.variant_product_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  UPDATE products SET
        cost_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE +is_active = 1 AND id = OLD.variant_product_id AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
  UPDATE products SET cost_review_key=NULL WHERE +is_active = 1 AND id = OLD.variant_product_id AND cost_review_key IS NOT NULL
    AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)) AND cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)));
END;

CREATE TRIGGER catalog_cost_on_hand_lot_insert_0195
AFTER INSERT ON product_batches
WHEN NEW.variant_product_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  UPDATE products SET
        cost_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE +is_active = 1 AND id = NEW.variant_product_id AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
  UPDATE products SET cost_review_key=NULL WHERE +is_active = 1 AND id = NEW.variant_product_id AND cost_review_key IS NOT NULL
    AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)) AND cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)));
END;

CREATE TRIGGER catalog_cost_on_hand_stock_delete_0195
AFTER DELETE ON branch_batch_stock
WHEN COALESCE(OLD.quantity, 0) > 0
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  UPDATE products SET
        cost_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE +is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (OLD.batch_id)) AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
  UPDATE products SET cost_review_key=NULL WHERE +is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (OLD.batch_id)) AND cost_review_key IS NOT NULL
    AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)) AND cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)));
END;

CREATE TRIGGER catalog_cost_on_hand_stock_insert_0195
AFTER INSERT ON branch_batch_stock
WHEN COALESCE(NEW.quantity, 0) > 0
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  UPDATE products SET
        cost_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE +is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (NEW.batch_id)) AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
  UPDATE products SET cost_review_key=NULL WHERE +is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (NEW.batch_id)) AND cost_review_key IS NOT NULL
    AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)) AND cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)));
END;

CREATE TRIGGER catalog_cost_on_hand_stock_update_0195
AFTER UPDATE OF quantity, batch_id ON branch_batch_stock
WHEN (COALESCE(OLD.quantity, 0) <> COALESCE(NEW.quantity, 0) OR OLD.batch_id IS NOT NEW.batch_id)
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  UPDATE products SET
        cost_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE +is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (OLD.batch_id, NEW.batch_id)) AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
  UPDATE products SET cost_review_key=NULL WHERE +is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (OLD.batch_id, NEW.batch_id)) AND cost_review_key IS NOT NULL
    AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)) AND cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)));
END;

CREATE TRIGGER catalog_cost_review_lot_update_0255
AFTER UPDATE OF unit_cost_usd,is_active,variant_product_id,received_at ON product_batches
WHEN NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  UPDATE products SET
        cost_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE +is_active=1 AND id IN (OLD.variant_product_id,NEW.variant_product_id) AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
  UPDATE products SET cost_review_key=NULL WHERE +is_active=1 AND id IN (OLD.variant_product_id,NEW.variant_product_id) AND cost_review_key IS NOT NULL
    AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)) AND cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)));
END;

CREATE TRIGGER customers_fts_ad AFTER DELETE ON customers BEGIN
  INSERT INTO customers_fts(customers_fts, rowid, name, phone, email, company, membership_number, address)
  VALUES ('delete', old.id, old.name, old.phone, old.email, old.company, old.membership_number, old.address);
END;

CREATE TRIGGER customers_fts_ai AFTER INSERT ON customers BEGIN
  INSERT INTO customers_fts(rowid, name, phone, email, company, membership_number, address)
  VALUES (new.id, new.name, new.phone, new.email, new.company, new.membership_number, new.address);
END;

CREATE TRIGGER customers_fts_au AFTER UPDATE ON customers BEGIN
  INSERT INTO customers_fts(customers_fts, rowid, name, phone, email, company, membership_number, address)
  VALUES ('delete', old.id, old.name, old.phone, old.email, old.company, old.membership_number, old.address);
  INSERT INTO customers_fts(rowid, name, phone, email, company, membership_number, address)
  VALUES (new.id, new.name, new.phone, new.email, new.company, new.membership_number, new.address);
END;

CREATE TRIGGER customers_fts_phone_ad AFTER DELETE ON customers BEGIN
  INSERT INTO customers_fts_phone(customers_fts_phone, rowid, phone, address)
  VALUES ('delete', old.id, old.phone, old.address);
END;

CREATE TRIGGER customers_fts_phone_ai AFTER INSERT ON customers BEGIN
  INSERT INTO customers_fts_phone(rowid, phone, address)
  VALUES (new.id, new.phone, new.address);
END;

CREATE TRIGGER customers_fts_phone_au AFTER UPDATE ON customers BEGIN
  INSERT INTO customers_fts_phone(customers_fts_phone, rowid, phone, address)
  VALUES ('delete', old.id, old.phone, old.address);
  INSERT INTO customers_fts_phone(rowid, phone, address)
  VALUES (new.id, new.phone, new.address);
END;

CREATE TRIGGER damaged_stock_insert_active_0242
BEFORE INSERT ON damaged_stock_lots
WHEN NEW.quantity_remaining<>0 AND EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND is_active IS NOT 1)
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER damaged_stock_update_active_0242
BEFORE UPDATE OF product_id,quantity_remaining ON damaged_stock_lots
WHEN NEW.quantity_remaining<>0 AND EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND is_active IS NOT 1)
 AND (NEW.product_id IS NOT OLD.product_id OR NEW.quantity_remaining>MAX(OLD.quantity_remaining,0) OR NEW.quantity_remaining<MIN(OLD.quantity_remaining,0))
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER delivery_contacts_fts_ad AFTER DELETE ON delivery_contacts BEGIN
  INSERT INTO delivery_contacts_fts(delivery_contacts_fts, rowid, name, phone, area, address)
  VALUES ('delete', old.id, old.name, old.phone, old.area, old.address);
END;

CREATE TRIGGER delivery_contacts_fts_ai AFTER INSERT ON delivery_contacts BEGIN
  INSERT INTO delivery_contacts_fts(rowid, name, phone, area, address)
  VALUES (new.id, new.name, new.phone, new.area, new.address);
END;

CREATE TRIGGER delivery_contacts_fts_au AFTER UPDATE ON delivery_contacts BEGIN
  INSERT INTO delivery_contacts_fts(delivery_contacts_fts, rowid, name, phone, area, address)
  VALUES ('delete', old.id, old.name, old.phone, old.area, old.address);
  INSERT INTO delivery_contacts_fts(rowid, name, phone, area, address)
  VALUES (new.id, new.name, new.phone, new.area, new.address);
END;

CREATE TRIGGER delivery_contacts_fts_phone_ad AFTER DELETE ON delivery_contacts BEGIN
  INSERT INTO delivery_contacts_fts_phone(delivery_contacts_fts_phone, rowid, phone, address)
  VALUES ('delete', old.id, old.phone, old.address);
END;

CREATE TRIGGER delivery_contacts_fts_phone_ai AFTER INSERT ON delivery_contacts BEGIN
  INSERT INTO delivery_contacts_fts_phone(rowid, phone, address)
  VALUES (new.id, new.phone, new.address);
END;

CREATE TRIGGER delivery_contacts_fts_phone_au AFTER UPDATE ON delivery_contacts BEGIN
  INSERT INTO delivery_contacts_fts_phone(delivery_contacts_fts_phone, rowid, phone, address)
  VALUES ('delete', old.id, old.phone, old.address);
  INSERT INTO delivery_contacts_fts_phone(rowid, phone, address)
  VALUES (new.id, new.phone, new.address);
END;

CREATE TRIGGER fee_operation_receipts_append_only_delete
BEFORE DELETE ON fee_operation_receipts
WHEN NOT EXISTS (
  SELECT 1 FROM system_flags
  WHERE key='maintenance' AND json_extract(value,'$.mode')='restore'
)
AND NOT EXISTS (
  SELECT 1 FROM system_flags
  WHERE key='sale_record_events_reset_guard'
    AND json_extract(value,'$.mode')='reset'
    AND length(trim(COALESCE(json_extract(value,'$.token'),'')))>0
)
BEGIN
  SELECT RAISE(ABORT,'fee operation receipts are immutable: delete only during restore or reset');
END;

CREATE TRIGGER fee_operation_receipts_append_only_update
BEFORE UPDATE ON fee_operation_receipts
BEGIN
  SELECT RAISE(ABORT,'fee operation receipts are immutable');
END;

CREATE TRIGGER inventory_check_events_no_delete BEFORE DELETE ON inventory_check_events
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN SELECT RAISE(ABORT,'inventory_check_history_immutable'); END;

CREATE TRIGGER inventory_check_events_no_update BEFORE UPDATE ON inventory_check_events
BEGIN SELECT RAISE(ABORT,'inventory_check_history_immutable'); END;

CREATE TRIGGER inventory_check_items_baseline BEFORE UPDATE OF
  session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json ON inventory_check_items
BEGIN SELECT RAISE(ABORT,'inventory_check_baseline_immutable'); END;

CREATE TRIGGER inventory_check_items_no_delete BEFORE DELETE ON inventory_check_items
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN SELECT RAISE(ABORT,'inventory_check_history_immutable'); END;

CREATE TRIGGER inventory_check_sessions_identity BEFORE UPDATE OF
  id,organization_id,branch_id,created_by,title,scope_json,started_at ON inventory_check_sessions
BEGIN SELECT RAISE(ABORT,'inventory_check_baseline_immutable'); END;

CREATE TRIGGER inventory_check_sessions_no_delete BEFORE DELETE ON inventory_check_sessions
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN SELECT RAISE(ABORT,'inventory_check_history_immutable'); END;

CREATE TRIGGER loyalty_award_on_insert BEFORE INSERT ON loyalty_point_adjustments
WHEN NEW.points > 0 AND NOT (lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'), ''))) IN ('1','true','yes','on')) AND NOT (EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore'))
BEGIN
  SELECT RAISE(ABORT, 'loyalty_points_disabled');
END;

CREATE TRIGGER loyalty_reward_on_update BEFORE UPDATE OF status, reward_points ON customer_share_submissions
WHEN NEW.status = 'approved' AND NEW.reward_points > 0
  AND (OLD.status <> 'approved' OR NEW.reward_points > OLD.reward_points)
  AND (NEW.loyalty_eligible <> 1
    OR NEW.id <= COALESCE((SELECT json_extract(value,'$.submissions') FROM system_flags WHERE key='loyalty_points_reset'),0)
    OR NOT (lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'), ''))) IN ('1','true','yes','on')))
  AND NOT (EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore'))
BEGIN
  SELECT RAISE(ABORT, 'loyalty_points_disabled');
END;

CREATE TRIGGER loyalty_sale_birth_immutable BEFORE UPDATE OF loyalty_accrual ON sales
WHEN COALESCE(NEW.loyalty_accrual,1) <> 0 AND (COALESCE(OLD.loyalty_accrual,1) = 0 OR EXISTS (SELECT 1 FROM system_flags WHERE key = printf('loyalty_sale_earning:%d:%s',NEW.id,hex(NEW.client_request_id)) AND value = 'skipped'))
BEGIN
  SELECT RAISE(ABORT, 'loyalty_creation_eligibility_immutable');
END;

CREATE TRIGGER loyalty_sale_birth_off AFTER INSERT ON sales
WHEN (NOT (lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'), ''))) IN ('1','true','yes','on')) AND NOT (EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore'))) OR EXISTS (SELECT 1 FROM system_flags WHERE key = printf('loyalty_sale_earning:%d:%s',NEW.id,hex(NEW.client_request_id)) AND value = 'skipped')
BEGIN
  UPDATE sales SET loyalty_accrual = 0 WHERE id = NEW.id;
END;

CREATE TRIGGER loyalty_sale_earning_on_insert AFTER INSERT ON sales
WHEN NEW.loyalty_accrual = 1 AND NULLIF(NEW.client_request_id,'') IS NOT NULL
  AND COALESCE(NULLIF(NEW.sale_status,''),'completed') NOT IN ('awaiting_payment','cancelled')
  AND ((lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'), ''))) IN ('1','true','yes','on')) OR EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')) AND NOT (EXISTS (SELECT 1 FROM system_flags WHERE key = printf('loyalty_sale_earning:%d:%s',NEW.id,hex(NEW.client_request_id)) AND value = 'skipped'))
BEGIN
  INSERT OR IGNORE INTO system_flags(key,value,updated_at)
    VALUES(printf('loyalty_sale_earning:%d:%s',NEW.id,hex(NEW.client_request_id)),'earned',CURRENT_TIMESTAMP);
END;

CREATE TRIGGER loyalty_sale_first_earning AFTER UPDATE OF sale_status ON sales
WHEN NEW.loyalty_accrual = 1 AND COALESCE(NULLIF(NEW.sale_status,''),'completed') NOT IN ('awaiting_payment','cancelled') AND NOT (EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore'))
BEGIN
  INSERT OR IGNORE INTO system_flags(key,value,updated_at)
    SELECT printf('loyalty_sale_earning:%d:%s',NEW.id,hex(NEW.client_request_id)),CASE WHEN lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'), ''))) IN ('1','true','yes','on') THEN 'earned' ELSE 'skipped' END,CURRENT_TIMESTAMP
    WHERE NULLIF(NEW.client_request_id,'') IS NOT NULL OR NOT (lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'), ''))) IN ('1','true','yes','on'));
  UPDATE sales SET loyalty_accrual = 0 WHERE id = NEW.id AND EXISTS (SELECT 1 FROM system_flags WHERE key = printf('loyalty_sale_earning:%d:%s',NEW.id,hex(NEW.client_request_id)) AND value = 'skipped');
END;

CREATE TRIGGER loyalty_sale_request_identity_immutable BEFORE UPDATE OF client_request_id ON sales
WHEN NEW.client_request_id IS NOT OLD.client_request_id
BEGIN
  SELECT RAISE(ABORT, 'loyalty_sale_identity_immutable');
END;

CREATE TRIGGER loyalty_submission_birth_immutable BEFORE UPDATE OF loyalty_eligible ON customer_share_submissions
WHEN NEW.loyalty_eligible <> OLD.loyalty_eligible AND NOT (OLD.loyalty_eligible = 1 AND NEW.loyalty_eligible = 0 AND NOT (lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'), ''))) IN ('1','true','yes','on')))
BEGIN
  SELECT RAISE(ABORT, 'loyalty_creation_eligibility_immutable');
END;

CREATE TRIGGER loyalty_submission_birth_off AFTER INSERT ON customer_share_submissions
WHEN NOT (lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'), ''))) IN ('1','true','yes','on')) AND NOT (EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore'))
BEGIN
  UPDATE customer_share_submissions SET loyalty_eligible = 0 WHERE id = NEW.id;
END;

CREATE TRIGGER positive_lot_reject_inactive_insert_0154
BEFORE INSERT ON product_batches
WHEN NEW.is_active IS NOT 1
 AND EXISTS (SELECT 1 FROM branch_batch_stock WHERE batch_id=NEW.id AND quantity>0)
BEGIN
  SELECT RAISE(ABORT,'Cannot deactivate a received lot with positive branch stock');
END;

CREATE TRIGGER positive_lot_reject_inactive_update_0154
BEFORE UPDATE ON product_batches
WHEN NEW.is_active IS NOT 1
 AND EXISTS (SELECT 1 FROM branch_batch_stock WHERE batch_id=NEW.id AND quantity>0)
BEGIN
  SELECT RAISE(ABORT,'Cannot deactivate a received lot with positive branch stock');
END;

CREATE TRIGGER positive_lot_reject_parent_delete_0155
BEFORE DELETE ON product_batches
WHEN EXISTS (SELECT 1 FROM branch_batch_stock WHERE batch_id=OLD.id AND quantity>0)
BEGIN
  SELECT RAISE(ABORT,'Cannot delete a received lot with positive branch stock');
END;

CREATE TRIGGER positive_lot_reject_parent_id_update_0155
BEFORE UPDATE OF id ON product_batches
WHEN OLD.id!=NEW.id
 AND EXISTS (SELECT 1 FROM branch_batch_stock WHERE batch_id=OLD.id AND quantity>0)
BEGIN
  SELECT RAISE(ABORT,'Cannot change the identity of a received lot with positive branch stock');
END;

CREATE TRIGGER positive_lot_reject_parent_insert_orphan_0155
AFTER INSERT ON product_batches
WHEN EXISTS (
  SELECT 1 FROM branch_batch_stock bbs INDEXED BY idx_branch_batch_stock_positive_batch_0155
  WHERE bbs.quantity>0 AND NOT EXISTS (SELECT 1 FROM product_batches WHERE id=bbs.batch_id)
)
BEGIN
  SELECT RAISE(ABORT,'Cannot orphan positive branch stock by replacing a received lot');
END;

CREATE TRIGGER positive_lot_reject_parent_update_orphan_0155
AFTER UPDATE ON product_batches
WHEN (OLD.id IS NOT NEW.id OR OLD.variant_product_id IS NOT NEW.variant_product_id OR OLD.batch_key IS NOT NEW.batch_key)
 AND EXISTS (
  SELECT 1 FROM branch_batch_stock bbs INDEXED BY idx_branch_batch_stock_positive_batch_0155
  WHERE bbs.quantity>0 AND NOT EXISTS (SELECT 1 FROM product_batches WHERE id=bbs.batch_id)
)
BEGIN
  SELECT RAISE(ABORT,'Cannot orphan positive branch stock by replacing a received lot');
END;

CREATE TRIGGER positive_lot_require_active_insert_0154
BEFORE INSERT ON branch_batch_stock
WHEN NEW.quantity>0
BEGIN
  SELECT RAISE(ABORT,'Positive lot stock requires an active received lot')
  WHERE NOT EXISTS (SELECT 1 FROM product_batches WHERE id=NEW.batch_id AND is_active=1);
END;

CREATE TRIGGER positive_lot_require_active_update_0154
BEFORE UPDATE ON branch_batch_stock
WHEN NEW.quantity>0
BEGIN
  SELECT RAISE(ABORT,'Positive lot stock requires an active received lot')
  WHERE NOT EXISTS (SELECT 1 FROM product_batches WHERE id=NEW.batch_id AND is_active=1);
END;

CREATE TRIGGER product_cache_stock_0242
BEFORE UPDATE OF stock_quantity ON products
WHEN NEW.is_active IS NOT 1 AND NEW.stock_quantity<>0
 AND (NEW.stock_quantity>MAX(COALESCE(OLD.stock_quantity,0),0) OR NEW.stock_quantity<MIN(COALESCE(OLD.stock_quantity,0),0))
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER product_cost_review_insert_guard_0255 BEFORE INSERT ON products
WHEN NEW.cost_review_key IS NOT NULL
BEGIN SELECT RAISE(ABORT,'product_cost_review_write_refused'); END;

CREATE TRIGGER product_cost_review_update_guard_0255 BEFORE UPDATE OF cost_review_key ON products
WHEN NEW.cost_review_key IS NOT OLD.cost_review_key
  AND NOT (NEW.cost_review_key IS NULL AND EXISTS(SELECT 1 FROM products WHERE id=OLD.id AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL))
    AND NEW.cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)))))
  AND NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.action='cost_override' AND a.entity='product' AND a.entity_id=CAST(OLD.id AS TEXT)
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.kind')='product.cost-review-confirm' AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.version')=1
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.version')=1 AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.kind')='confirm'
    AND OLD.cost_review_key IS NOT NULL AND NEW.cost_review_key IS NULL
    AND typeof(OLD.cost_price_usd) IN ('integer','real') AND OLD.cost_price_usd>=0 AND OLD.cost_price_usd<=1.7976931348623157e308
    AND NEW.cost_price_usd IS OLD.cost_price_usd AND NEW.cost_price_khr IS OLD.cost_price_khr AND NEW.selling_price_usd IS OLD.selling_price_usd AND NEW.selling_price_khr IS OLD.selling_price_khr AND NEW.wholesale_price_usd IS OLD.wholesale_price_usd AND NEW.wholesale_price_khr IS OLD.wholesale_price_khr AND NEW.purchase_price_usd IS OLD.purchase_price_usd AND NEW.purchase_price_khr IS OLD.purchase_price_khr
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.before_key') IS OLD.cost_review_key
    AND json_type(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.after_key')='null'
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.revision_before')=COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key=CAST(OLD.id AS TEXT)),0)
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.after_usd') IS NEW.cost_price_usd AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.after_khr') IS NEW.cost_price_khr)
  AND NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.action='cost_override' AND a.entity='product' AND a.entity_id=CAST(OLD.id AS TEXT)
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.version')=1 AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.kind') IN ('merge','merge_undo','merge_redo')
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.before_key') IS OLD.cost_review_key
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.after_key') IS NEW.cost_review_key
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.revision_before')=COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key=CAST(OLD.id AS TEXT)),0)
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.after_usd') IS NEW.cost_price_usd
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.after_khr') IS NEW.cost_price_khr
    AND (json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.kind')='merge_undo' AND EXISTS(SELECT 1 FROM action_history h
      WHERE h.id=json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.history_id')
        AND json_extract(h.undo_payload,'$.snapshot_id')=json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.snapshot_id')
        AND json_extract(h.undo_payload,'$.operation_id')=json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.merge_operation_id')
        AND json_extract(h.undo_payload,'$.generation')=json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.generation'))
      OR json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.kind') IN ('merge','merge_redo') AND (NEW.cost_review_key IS NULL OR json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.operation_key')=NEW.cost_review_key)))
BEGIN SELECT RAISE(ABORT,'product_cost_review_write_refused'); END;

CREATE TRIGGER product_deactivate_stock_0242
BEFORE UPDATE OF is_active ON products
WHEN NEW.is_active IS NOT 1 AND OLD.is_active IS 1
 AND (COALESCE(OLD.stock_quantity,0)<>0 OR COALESCE(NEW.stock_quantity,0)<>0
  OR EXISTS(SELECT 1 FROM branch_stock WHERE product_id=OLD.id AND quantity<>0)
  OR EXISTS(SELECT 1 FROM product_batches b JOIN branch_batch_stock s ON s.batch_id=b.id WHERE b.variant_product_id=OLD.id AND s.quantity<>0)
  OR EXISTS(SELECT 1 FROM damaged_stock_lots WHERE product_id=OLD.id AND quantity_remaining<>0))
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER product_delete_stock_0242
BEFORE DELETE ON products
WHEN COALESCE(OLD.stock_quantity,0)<>0
 OR EXISTS(SELECT 1 FROM branch_stock WHERE product_id=OLD.id AND quantity<>0)
 OR EXISTS(SELECT 1 FROM product_batches b JOIN branch_batch_stock s ON s.batch_id=b.id WHERE b.variant_product_id=OLD.id AND s.quantity<>0)
 OR EXISTS(SELECT 1 FROM damaged_stock_lots WHERE product_id=OLD.id AND quantity_remaining<>0)
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER product_insert_stock_0242
BEFORE INSERT ON products
WHEN NEW.is_active IS NOT 1 AND (COALESCE(NEW.stock_quantity,0)<>0
 OR EXISTS(SELECT 1 FROM products WHERE id=NEW.id AND stock_quantity<>0)
 OR EXISTS(SELECT 1 FROM branch_stock WHERE product_id=NEW.id AND quantity<>0)
 OR EXISTS(SELECT 1 FROM product_batches b JOIN branch_batch_stock s ON s.batch_id=b.id WHERE b.variant_product_id=NEW.id AND s.quantity<>0)
 OR EXISTS(SELECT 1 FROM damaged_stock_lots WHERE product_id=NEW.id AND quantity_remaining<>0))
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER products_fts_ad AFTER DELETE ON products BEGIN
  INSERT INTO products_fts(products_fts, rowid, name, sku, barcode, brand, category, supplier, description, unit)
  VALUES ('delete', old.id, old.name, old.sku, old.barcode, old.brand, old.category, old.supplier, old.description, old.unit);
END;

CREATE TRIGGER products_fts_ai AFTER INSERT ON products BEGIN
  INSERT INTO products_fts(rowid, name, sku, barcode, brand, category, supplier, description, unit)
  VALUES (new.id, new.name, new.sku, new.barcode, new.brand, new.category, new.supplier, new.description, new.unit);
END;

CREATE TRIGGER products_fts_au
AFTER UPDATE OF id, name, sku, barcode, brand, category, supplier, description, unit ON products
WHEN NEW.id IS NOT OLD.id OR NEW.name IS NOT OLD.name OR NEW.sku IS NOT OLD.sku
  OR NEW.barcode IS NOT OLD.barcode OR NEW.brand IS NOT OLD.brand OR NEW.category IS NOT OLD.category
  OR NEW.supplier IS NOT OLD.supplier OR NEW.description IS NOT OLD.description OR NEW.unit IS NOT OLD.unit
BEGIN
  INSERT INTO products_fts(products_fts, rowid, name, sku, barcode, brand, category, supplier, description, unit)
  VALUES ('delete', old.id, old.name, old.sku, old.barcode, old.brand, old.category, old.supplier, old.description, old.unit);
  INSERT INTO products_fts(rowid, name, sku, barcode, brand, category, supplier, description, unit)
  VALUES (new.id, new.name, new.sku, new.barcode, new.brand, new.category, new.supplier, new.description, new.unit);
END;

CREATE TRIGGER products_fts_code_ad AFTER DELETE ON products BEGIN
  INSERT INTO products_fts_code(products_fts_code, rowid, barcode, sku)
  VALUES ('delete', old.id, old.barcode, old.sku);
END;

CREATE TRIGGER products_fts_code_ai AFTER INSERT ON products BEGIN
  INSERT INTO products_fts_code(rowid, barcode, sku)
  VALUES (new.id, new.barcode, new.sku);
END;

CREATE TRIGGER products_fts_code_au
AFTER UPDATE OF id, barcode, sku ON products
WHEN NEW.id IS NOT OLD.id OR NEW.barcode IS NOT OLD.barcode OR NEW.sku IS NOT OLD.sku
BEGIN
  INSERT INTO products_fts_code(products_fts_code, rowid, barcode, sku)
  VALUES ('delete', old.id, old.barcode, old.sku);
  INSERT INTO products_fts_code(rowid, barcode, sku)
  VALUES (new.id, new.barcode, new.sku);
END;

CREATE TRIGGER products_fts_name_trigram_ad AFTER DELETE ON products BEGIN
  INSERT INTO products_fts_name_trigram(products_fts_name_trigram, rowid, name)
  VALUES ('delete', old.id, old.name);
END;

CREATE TRIGGER products_fts_name_trigram_ai AFTER INSERT ON products BEGIN
  INSERT INTO products_fts_name_trigram(rowid, name)
  VALUES (new.id, new.name);
END;

CREATE TRIGGER products_fts_name_trigram_au
AFTER UPDATE OF id, name ON products
WHEN NEW.id IS NOT OLD.id OR NEW.name IS NOT OLD.name
BEGIN
  INSERT INTO products_fts_name_trigram(products_fts_name_trigram, rowid, name)
  VALUES ('delete', old.id, old.name);
  INSERT INTO products_fts_name_trigram(rowid, name)
  VALUES (new.id, new.name);
END;

CREATE TRIGGER return_create_receipts_append_only_delete
BEFORE DELETE ON return_create_receipts
WHEN NOT EXISTS (
  SELECT 1 FROM system_flags
  WHERE key='maintenance' AND json_extract(value,'$.mode')='restore'
)
AND NOT EXISTS (
  SELECT 1 FROM system_flags
  WHERE key='sale_record_events_reset_guard'
    AND json_extract(value,'$.mode')='reset'
    AND length(trim(COALESCE(json_extract(value,'$.token'),'')))>0
)
BEGIN
  SELECT RAISE(ABORT,'return create receipts are immutable: delete only during restore or reset');
END;

CREATE TRIGGER return_create_receipts_append_only_update
BEFORE UPDATE ON return_create_receipts
BEGIN
  SELECT RAISE(ABORT,'return create receipts are immutable');
END;

CREATE TRIGGER return_mutation_receipts_append_only_delete
BEFORE DELETE ON return_mutation_receipts
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
AND NOT EXISTS (
  SELECT 1 FROM system_flags WHERE key='sale_record_events_reset_guard'
    AND json_extract(value,'$.mode')='reset'
    AND length(trim(COALESCE(json_extract(value,'$.token'),'')))>0
)
BEGIN
  SELECT RAISE(ABORT, 'return mutation receipts are immutable: delete only during restore or reset');
END;

CREATE TRIGGER return_mutation_receipts_append_only_update
BEFORE UPDATE ON return_mutation_receipts BEGIN
  SELECT RAISE(ABORT, 'return mutation receipts are immutable');
END;

CREATE TRIGGER return_revision_allocations_delete AFTER DELETE ON return_item_batch_allocations
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision)
  SELECT return_id, 1 FROM return_items WHERE id = OLD.return_item_id
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_allocations_insert AFTER INSERT ON return_item_batch_allocations
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision)
  SELECT return_id, 1 FROM return_items WHERE id = NEW.return_item_id
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_allocations_update AFTER UPDATE ON return_item_batch_allocations
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision)
  SELECT return_id, 1 FROM return_items WHERE id IN (OLD.return_item_id, NEW.return_item_id)
  GROUP BY return_id
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_damaged_delete AFTER DELETE ON damaged_stock_lots
WHEN OLD.return_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision) VALUES(OLD.return_id, 1)
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_damaged_insert AFTER INSERT ON damaged_stock_lots
WHEN NEW.return_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision) VALUES(NEW.return_id, 1)
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_damaged_update AFTER UPDATE ON damaged_stock_lots
WHEN (OLD.return_id IS NOT NULL OR NEW.return_id IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision)
  SELECT return_id, 1 FROM (SELECT OLD.return_id AS return_id UNION SELECT NEW.return_id) WHERE return_id IS NOT NULL
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_items_delete AFTER DELETE ON return_items
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision) VALUES(OLD.return_id, 1)
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_items_insert AFTER INSERT ON return_items
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision) VALUES(NEW.return_id, 1)
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_items_update AFTER UPDATE ON return_items
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision)
  SELECT return_id, 1 FROM (SELECT OLD.return_id AS return_id UNION SELECT NEW.return_id) WHERE return_id IS NOT NULL
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_returns_delete AFTER DELETE ON returns
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision) VALUES(OLD.id, 1)
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_returns_insert AFTER INSERT ON returns
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision) VALUES(NEW.id, 1)
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_returns_update AFTER UPDATE ON returns
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision)
  SELECT return_id, 1 FROM (SELECT OLD.id AS return_id UNION SELECT NEW.id) WHERE return_id IS NOT NULL
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER returns_money_precision_insert
BEFORE INSERT ON returns
WHEN NOT COALESCE((typeof(NEW.money_precision_version) = 'integer' AND (
    (NEW.money_precision_version = 0 AND NEW.calculated_refund_usd IS NULL AND NEW.rounding_adjustment_usd = 0)
    OR (NEW.money_precision_version = 1
      AND typeof(NEW.calculated_refund_usd) IN ('integer', 'real') AND NEW.calculated_refund_usd BETWEEN -100000000000 AND 100000000000 AND NEW.calculated_refund_usd = CAST(ROUND(NEW.calculated_refund_usd * 10000) AS INTEGER) / 10000.0
      AND typeof(NEW.total_refund_usd) IN ('integer', 'real') AND NEW.total_refund_usd BETWEEN -100000000000 AND 100000000000 AND NEW.total_refund_usd = CAST(ROUND(NEW.total_refund_usd * 10000) AS INTEGER) / 10000.0
      AND typeof(NEW.rounding_adjustment_usd) IN ('integer', 'real') AND NEW.rounding_adjustment_usd BETWEEN -100000000000 AND 100000000000 AND NEW.rounding_adjustment_usd = CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER) / 10000.0
      AND NEW.calculated_refund_usd >= 0 AND NEW.total_refund_usd >= 0
      AND CAST(ROUND(NEW.total_refund_usd * 10000) AS INTEGER) % 100 = 0
      AND CAST(ROUND(NEW.calculated_refund_usd * 10000) AS INTEGER) + CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER) = CAST(ROUND(NEW.total_refund_usd * 10000) AS INTEGER)
      AND ABS(CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER)) < 100
    )
  )), 0)
BEGIN
  SELECT RAISE(ABORT, 'money_precision_invalid_returns');
END;

CREATE TRIGGER returns_money_precision_update
BEFORE UPDATE ON returns
WHEN NOT COALESCE((typeof(NEW.money_precision_version) = 'integer' AND (
    (NEW.money_precision_version = 0 AND NEW.calculated_refund_usd IS NULL AND NEW.rounding_adjustment_usd = 0)
    OR (NEW.money_precision_version = 1
      AND typeof(NEW.calculated_refund_usd) IN ('integer', 'real') AND NEW.calculated_refund_usd BETWEEN -100000000000 AND 100000000000 AND NEW.calculated_refund_usd = CAST(ROUND(NEW.calculated_refund_usd * 10000) AS INTEGER) / 10000.0
      AND typeof(NEW.total_refund_usd) IN ('integer', 'real') AND NEW.total_refund_usd BETWEEN -100000000000 AND 100000000000 AND NEW.total_refund_usd = CAST(ROUND(NEW.total_refund_usd * 10000) AS INTEGER) / 10000.0
      AND typeof(NEW.rounding_adjustment_usd) IN ('integer', 'real') AND NEW.rounding_adjustment_usd BETWEEN -100000000000 AND 100000000000 AND NEW.rounding_adjustment_usd = CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER) / 10000.0
      AND NEW.calculated_refund_usd >= 0 AND NEW.total_refund_usd >= 0
      AND CAST(ROUND(NEW.total_refund_usd * 10000) AS INTEGER) % 100 = 0
      AND CAST(ROUND(NEW.calculated_refund_usd * 10000) AS INTEGER) + CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER) = CAST(ROUND(NEW.total_refund_usd * 10000) AS INTEGER)
      AND ABS(CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER)) < 100
    )
  )), 0)
BEGIN
  SELECT RAISE(ABORT, 'money_precision_invalid_returns');
END;

CREATE TRIGGER sale_amendments_append_only_delete
BEFORE DELETE ON sale_amendments
WHEN NOT EXISTS (
  SELECT 1 FROM system_flags
  WHERE key = 'maintenance'
    AND json_extract(value, '$.mode') = 'restore'
)
BEGIN
  SELECT RAISE(ABORT, 'sale amendments are immutable: append-only');
END;

CREATE TRIGGER sale_amendments_append_only_update
BEFORE UPDATE ON sale_amendments
BEGIN
  SELECT RAISE(ABORT, 'sale_amendments is append-only: correct an entry by appending a compensating entry, never by rewriting one');
END;

CREATE TRIGGER sale_creation_snapshot_immutable
BEFORE UPDATE OF creation_snapshot_json ON sales
WHEN OLD.creation_snapshot_json IS NOT NEW.creation_snapshot_json
BEGIN
  SELECT RAISE(ABORT, 'sale creation snapshot is immutable');
END;

CREATE TRIGGER sale_incident_recovery_members_append_only_delete
BEFORE DELETE ON sale_incident_recovery_members
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key='sale_incident_recovery_reset_guard' AND json_extract(value,'$.mode')='reset')
BEGIN
  SELECT RAISE(ABORT, 'sale incident recovery members are append-only');
END;

CREATE TRIGGER sale_incident_recovery_members_append_only_update
BEFORE UPDATE ON sale_incident_recovery_members
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key='sale_incident_recovery_reset_guard' AND json_extract(value,'$.mode')='reset')
BEGIN
  SELECT RAISE(ABORT, 'sale incident recovery members are append-only');
END;

CREATE TRIGGER sale_incident_recovery_receipts_append_only_delete
BEFORE DELETE ON sale_incident_recovery_receipts
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key='sale_incident_recovery_reset_guard' AND json_extract(value,'$.mode')='reset')
BEGIN
  SELECT RAISE(ABORT, 'sale incident recovery receipts are append-only');
END;

CREATE TRIGGER sale_incident_recovery_receipts_append_only_update
BEFORE UPDATE ON sale_incident_recovery_receipts
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key='sale_incident_recovery_reset_guard' AND json_extract(value,'$.mode')='reset')
BEGIN
  SELECT RAISE(ABORT, 'sale incident recovery receipts are append-only');
END;

CREATE TRIGGER sale_not_paid_stock_recovery_members_append_only_delete
BEFORE DELETE ON sale_not_paid_stock_recovery_members
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key='sale_not_paid_stock_recovery_reset_guard' AND json_extract(value,'$.mode')='reset' AND length(json_extract(value,'$.token'))>0)
BEGIN
  SELECT RAISE(ABORT, 'not paid stock recovery members are append-only');
END;

CREATE TRIGGER sale_not_paid_stock_recovery_members_append_only_update
BEFORE UPDATE ON sale_not_paid_stock_recovery_members
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key='sale_not_paid_stock_recovery_reset_guard' AND json_extract(value,'$.mode')='reset' AND length(json_extract(value,'$.token'))>0)
BEGIN
  SELECT RAISE(ABORT, 'not paid stock recovery members are append-only');
END;

CREATE TRIGGER sale_not_paid_stock_recovery_receipts_append_only_delete
BEFORE DELETE ON sale_not_paid_stock_recovery_receipts
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key='sale_not_paid_stock_recovery_reset_guard' AND json_extract(value,'$.mode')='reset' AND length(json_extract(value,'$.token'))>0)
BEGIN
  SELECT RAISE(ABORT, 'not paid stock recovery receipts are append-only');
END;

CREATE TRIGGER sale_not_paid_stock_recovery_receipts_append_only_update
BEFORE UPDATE ON sale_not_paid_stock_recovery_receipts
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key='sale_not_paid_stock_recovery_reset_guard' AND json_extract(value,'$.mode')='reset' AND length(json_extract(value,'$.token'))>0)
BEGIN
  SELECT RAISE(ABORT, 'not paid stock recovery receipts are append-only');
END;

CREATE TRIGGER sale_record_events_append_only_delete
BEFORE DELETE ON sale_record_events
WHEN NOT EXISTS (
  SELECT 1 FROM system_flags
  WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore'
)
AND NOT EXISTS (
  SELECT 1 FROM system_flags
  WHERE key = 'sale_record_events_reset_guard'
    AND json_extract(value, '$.mode') = 'reset'
    AND length(trim(COALESCE(json_extract(value, '$.token'), ''))) > 0
)
BEGIN
  SELECT RAISE(ABORT, 'sale record events are immutable: delete only during restore or reset');
END;

CREATE TRIGGER sale_record_events_append_only_update
BEFORE UPDATE ON sale_record_events
BEGIN
  SELECT RAISE(ABORT, 'sale record events are immutable: append a new event');
END;

CREATE TRIGGER sale_revision_fees_delete AFTER DELETE ON fees
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id,revision) SELECT sale_id,1 FROM (SELECT OLD.sale_id AS sale_id UNION SELECT id FROM sales WHERE cancel_fee_id=OLD.id) WHERE sale_id IS NOT NULL
 ON CONFLICT(sale_id) DO UPDATE SET revision=revision+1;
END;

CREATE TRIGGER sale_revision_fees_insert AFTER INSERT ON fees
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id,revision) SELECT sale_id,1 FROM (SELECT NEW.sale_id AS sale_id UNION SELECT id FROM sales WHERE cancel_fee_id=NEW.id) WHERE sale_id IS NOT NULL
 ON CONFLICT(sale_id) DO UPDATE SET revision=revision+1;
END;

CREATE TRIGGER sale_revision_fees_update AFTER UPDATE ON fees
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id,revision) SELECT sale_id,1 FROM (SELECT OLD.sale_id AS sale_id UNION SELECT id FROM sales WHERE cancel_fee_id=OLD.id UNION SELECT NEW.sale_id AS sale_id UNION SELECT id FROM sales WHERE cancel_fee_id=NEW.id) WHERE sale_id IS NOT NULL
 ON CONFLICT(sale_id) DO UPDATE SET revision=revision+1;
END;

CREATE TRIGGER sale_revision_return_item_batch_allocations_delete AFTER DELETE ON return_item_batch_allocations
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT (SELECT r.sale_id FROM returns r JOIN return_items ri ON ri.return_id = r.id WHERE ri.id = OLD.return_item_id), 1 WHERE (SELECT r.sale_id FROM returns r JOIN return_items ri ON ri.return_id = r.id WHERE ri.id = OLD.return_item_id) IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sale_revision_return_item_batch_allocations_insert AFTER INSERT ON return_item_batch_allocations
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT (SELECT r.sale_id FROM returns r JOIN return_items ri ON ri.return_id = r.id WHERE ri.id = NEW.return_item_id), 1 WHERE (SELECT r.sale_id FROM returns r JOIN return_items ri ON ri.return_id = r.id WHERE ri.id = NEW.return_item_id) IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sale_revision_return_item_batch_allocations_update AFTER UPDATE ON return_item_batch_allocations
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision)
 SELECT sale_id, 1 FROM (SELECT (SELECT r.sale_id FROM returns r JOIN return_items ri ON ri.return_id = r.id WHERE ri.id = OLD.return_item_id) AS sale_id UNION SELECT (SELECT r.sale_id FROM returns r JOIN return_items ri ON ri.return_id = r.id WHERE ri.id = NEW.return_item_id)) WHERE sale_id IS NOT NULL
 ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sale_revision_return_items_delete AFTER DELETE ON return_items
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT (SELECT sale_id FROM returns WHERE id = OLD.return_id), 1 WHERE (SELECT sale_id FROM returns WHERE id = OLD.return_id) IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sale_revision_return_items_insert AFTER INSERT ON return_items
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT (SELECT sale_id FROM returns WHERE id = NEW.return_id), 1 WHERE (SELECT sale_id FROM returns WHERE id = NEW.return_id) IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sale_revision_return_items_update AFTER UPDATE ON return_items
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision)
 SELECT sale_id, 1 FROM (SELECT (SELECT sale_id FROM returns WHERE id = OLD.return_id) AS sale_id UNION SELECT (SELECT sale_id FROM returns WHERE id = NEW.return_id)) WHERE sale_id IS NOT NULL
 ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sale_revision_returns_delete AFTER DELETE ON returns
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT OLD.sale_id, 1 WHERE OLD.sale_id IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sale_revision_returns_insert AFTER INSERT ON returns
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT NEW.sale_id, 1 WHERE NEW.sale_id IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sale_revision_returns_update AFTER UPDATE ON returns
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision)
 SELECT sale_id, 1 FROM (SELECT OLD.sale_id AS sale_id UNION SELECT NEW.sale_id) WHERE sale_id IS NOT NULL
 ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sale_revision_sale_amendments_delete AFTER DELETE ON sale_amendments
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO sale_write_revisions(sale_id, revision) SELECT OLD.sale_id, 1 WHERE OLD.sale_id IS NOT NULL
  ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sale_revision_sale_amendments_insert AFTER INSERT ON sale_amendments
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO sale_write_revisions(sale_id, revision) SELECT NEW.sale_id, 1 WHERE NEW.sale_id IS NOT NULL
  ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sale_revision_sale_amendments_update AFTER UPDATE ON sale_amendments
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO sale_write_revisions(sale_id, revision)
  SELECT sale_id, 1 FROM (SELECT OLD.sale_id AS sale_id UNION SELECT NEW.sale_id) WHERE sale_id IS NOT NULL
  ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sale_revision_sale_item_batch_allocations_delete AFTER DELETE ON sale_item_batch_allocations
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT (SELECT sale_id FROM sale_items WHERE id = OLD.sale_item_id), 1 WHERE (SELECT sale_id FROM sale_items WHERE id = OLD.sale_item_id) IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sale_revision_sale_item_batch_allocations_insert AFTER INSERT ON sale_item_batch_allocations
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT (SELECT sale_id FROM sale_items WHERE id = NEW.sale_item_id), 1 WHERE (SELECT sale_id FROM sale_items WHERE id = NEW.sale_item_id) IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sale_revision_sale_item_batch_allocations_update AFTER UPDATE ON sale_item_batch_allocations
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision)
 SELECT sale_id, 1 FROM (SELECT (SELECT sale_id FROM sale_items WHERE id = OLD.sale_item_id) AS sale_id UNION SELECT (SELECT sale_id FROM sale_items WHERE id = NEW.sale_item_id)) WHERE sale_id IS NOT NULL
 ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sale_revision_sale_items_delete AFTER DELETE ON sale_items
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT OLD.sale_id, 1 WHERE OLD.sale_id IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sale_revision_sale_items_insert AFTER INSERT ON sale_items
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT NEW.sale_id, 1 WHERE NEW.sale_id IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sale_revision_sale_items_update AFTER UPDATE ON sale_items
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision)
 SELECT sale_id, 1 FROM (SELECT OLD.sale_id AS sale_id UNION SELECT NEW.sale_id) WHERE sale_id IS NOT NULL
 ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sale_revision_sales_delete AFTER DELETE ON sales
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT OLD.id, 1 WHERE OLD.id IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sale_revision_sales_insert AFTER INSERT ON sales
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT NEW.id, 1 WHERE NEW.id IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sale_revision_sales_update AFTER UPDATE ON sales
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision)
 SELECT sale_id, 1 FROM (SELECT OLD.id AS sale_id UNION SELECT NEW.id) WHERE sale_id IS NOT NULL
 ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER sales_money_precision_insert
BEFORE INSERT ON sales
WHEN NOT COALESCE((typeof(NEW.money_precision_version) = 'integer' AND (
    (NEW.money_precision_version = 0 AND NEW.calculated_total_usd IS NULL AND NEW.rounding_adjustment_usd = 0)
    OR (NEW.money_precision_version = 1
      AND typeof(NEW.calculated_total_usd) IN ('integer', 'real') AND NEW.calculated_total_usd BETWEEN -100000000000 AND 100000000000 AND NEW.calculated_total_usd = CAST(ROUND(NEW.calculated_total_usd * 10000) AS INTEGER) / 10000.0
      AND typeof(NEW.total_usd) IN ('integer', 'real') AND NEW.total_usd BETWEEN -100000000000 AND 100000000000 AND NEW.total_usd = CAST(ROUND(NEW.total_usd * 10000) AS INTEGER) / 10000.0
      AND typeof(NEW.rounding_adjustment_usd) IN ('integer', 'real') AND NEW.rounding_adjustment_usd BETWEEN -100000000000 AND 100000000000 AND NEW.rounding_adjustment_usd = CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER) / 10000.0
      AND NEW.calculated_total_usd >= 0 AND NEW.total_usd >= 0
      AND CAST(ROUND(NEW.total_usd * 10000) AS INTEGER) % 100 = 0
      AND CAST(ROUND(NEW.calculated_total_usd * 10000) AS INTEGER) + CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER) = CAST(ROUND(NEW.total_usd * 10000) AS INTEGER)
      AND ABS(CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER)) <= 50
      AND ((CAST(ROUND(NEW.calculated_total_usd * 10000) AS INTEGER) + 50) / 100) * 100 = CAST(ROUND(NEW.total_usd * 10000) AS INTEGER)
    )
  )), 0)
BEGIN
  SELECT RAISE(ABORT, 'money_precision_invalid_sales');
END;

CREATE TRIGGER sales_money_precision_update_0161
BEFORE UPDATE ON sales
WHEN NOT COALESCE((typeof(NEW.money_precision_version) = 'integer' AND (
    (NEW.money_precision_version = 0 AND NEW.calculated_total_usd IS NULL AND NEW.rounding_adjustment_usd = 0)
    OR (NEW.money_precision_version IN (0, 1)
      AND typeof(NEW.calculated_total_usd) IN ('integer', 'real') AND NEW.calculated_total_usd BETWEEN 0 AND 100000000000 AND NEW.calculated_total_usd = CAST(ROUND(NEW.calculated_total_usd * 10000) AS INTEGER) / 10000.0
      AND typeof(NEW.total_usd) IN ('integer', 'real') AND NEW.total_usd BETWEEN 0 AND 100000000000 AND NEW.total_usd = CAST(ROUND(NEW.total_usd * 10000) AS INTEGER) / 10000.0
      AND typeof(NEW.rounding_adjustment_usd) IN ('integer', 'real') AND NEW.rounding_adjustment_usd BETWEEN -0.005 AND 0.005 AND NEW.rounding_adjustment_usd = CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER) / 10000.0
      AND CAST(ROUND(NEW.total_usd * 10000) AS INTEGER) % 100 = 0
      AND CAST(ROUND(NEW.calculated_total_usd * 10000) AS INTEGER) + CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER) = CAST(ROUND(NEW.total_usd * 10000) AS INTEGER)
      AND ((CAST(ROUND(NEW.calculated_total_usd * 10000) AS INTEGER) + 50) / 100) * 100 = CAST(ROUND(NEW.total_usd * 10000) AS INTEGER)
    )
  )), 0)
BEGIN
  SELECT RAISE(ABORT, 'money_precision_invalid_sales');
END;

CREATE TRIGGER shift_cancel_original_details_immutable
BEFORE UPDATE ON shift_sessions
WHEN OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL AND (
  OLD.shift_code IS NOT NEW.shift_code OR OLD.scope_mode IS NOT NEW.scope_mode
  OR OLD.user_id IS NOT NEW.user_id OR OLD.user_name IS NOT NEW.user_name
  OR OLD.branch_id IS NOT NEW.branch_id OR OLD.branch_name IS NOT NEW.branch_name
  OR OLD.business_date IS NOT NEW.business_date OR OLD.opened_at IS NOT NEW.opened_at
  OR OLD.opening_float_usd IS NOT NEW.opening_float_usd OR OLD.opening_float_khr IS NOT NEW.opening_float_khr
  OR OLD.opening_note IS NOT NEW.opening_note OR OLD.closed_at IS NOT NEW.closed_at
  OR OLD.closing_counted_usd IS NOT NEW.closing_counted_usd OR OLD.closing_counted_khr IS NOT NEW.closing_counted_khr
  OR OLD.closing_note IS NOT NEW.closing_note OR OLD.closed_by_user_id IS NOT NEW.closed_by_user_id
  OR OLD.closed_by_user_name IS NOT NEW.closed_by_user_name
)
BEGIN
  SELECT RAISE(ABORT, 'cancelling cannot rewrite shift details');
END;

CREATE TRIGGER shift_cancel_provenance_immutable
BEFORE UPDATE ON shift_sessions
WHEN OLD.cancelled_at IS NOT NULL AND (
  OLD.cancelled_at IS NOT NEW.cancelled_at
  OR OLD.cancelled_by_user_id IS NOT NEW.cancelled_by_user_id
  OR OLD.cancelled_by_user_name IS NOT NEW.cancelled_by_user_name
  OR OLD.cancel_reason IS NOT NEW.cancel_reason
)
BEGIN
  SELECT RAISE(ABORT, 'shift cancellation is immutable');
END;

CREATE TRIGGER shift_cancel_validate_insert
BEFORE INSERT ON shift_sessions
WHEN NEW.cancelled_at IS NOT NULL AND (
  NEW.cancelled_by_user_id IS NULL OR TRIM(COALESCE(NEW.cancel_reason, '')) = ''
  OR LENGTH(TRIM(NEW.cancel_reason)) > 500
)
BEGIN
  SELECT RAISE(ABORT, 'cancel reason and actor are required');
END;

CREATE TRIGGER shift_cancel_validate_update
BEFORE UPDATE ON shift_sessions
WHEN NEW.cancelled_at IS NOT NULL AND (
  NEW.cancelled_by_user_id IS NULL OR TRIM(COALESCE(NEW.cancel_reason, '')) = ''
  OR LENGTH(TRIM(NEW.cancel_reason)) > 500
)
BEGIN
  SELECT RAISE(ABORT, 'cancel reason and actor are required');
END;

CREATE TRIGGER shift_close_figures_no_delete
BEFORE DELETE ON shift_close_figures
WHEN NOT EXISTS (
  SELECT 1 FROM system_flags
  WHERE key = 'maintenance'
    AND json_extract(value, '$.mode') = 'restore'
)
BEGIN
  SELECT RAISE(ABORT, 'shift close figures are immutable');
END;

CREATE TRIGGER shift_close_figures_no_update
BEFORE UPDATE ON shift_close_figures
BEGIN
  SELECT RAISE(ABORT, 'shift close figures are immutable');
END;

CREATE TRIGGER shift_reopen_child_update_validate
BEFORE UPDATE ON shift_sessions
WHEN OLD.parent_shift_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM shift_sessions parent
    WHERE parent.id = OLD.parent_shift_id
      AND COALESCE(parent.cancelled_at, parent.closed_at) IS NOT NULL
      AND parent.user_id = NEW.user_id
      AND parent.scope_mode = NEW.scope_mode
      AND parent.business_date = NEW.business_date
      AND ((parent.branch_id IS NULL AND NEW.branch_id IS NULL) OR parent.branch_id = NEW.branch_id)
      AND NEW.opened_at >= COALESCE(parent.cancelled_at, parent.closed_at)
  ) THEN RAISE(ABORT, 'amendment breaks reopen lineage') END;
END;

CREATE TRIGGER shift_reopen_parent_update_validate
BEFORE UPDATE ON shift_sessions
WHEN EXISTS (SELECT 1 FROM shift_sessions child WHERE child.parent_shift_id = OLD.id)
BEGIN
  SELECT CASE WHEN COALESCE(NEW.cancelled_at, NEW.closed_at) IS NULL OR EXISTS (
    SELECT 1 FROM shift_sessions child
    WHERE child.parent_shift_id = OLD.id AND (
      child.user_id != NEW.user_id
      OR child.scope_mode != NEW.scope_mode
      OR child.business_date != NEW.business_date
      OR NOT ((child.branch_id IS NULL AND NEW.branch_id IS NULL) OR child.branch_id = NEW.branch_id)
      OR child.opened_at < COALESCE(NEW.cancelled_at, NEW.closed_at)
    )
  ) THEN RAISE(ABORT, 'amendment breaks reopened child') END;
END;

CREATE TRIGGER shift_reopen_provenance_immutable
BEFORE UPDATE ON shift_sessions
WHEN OLD.parent_shift_id IS NOT NEW.parent_shift_id
  OR OLD.reopen_reason IS NOT NEW.reopen_reason
  OR OLD.reopened_by_user_id IS NOT NEW.reopened_by_user_id
  OR OLD.reopened_by_user_name IS NOT NEW.reopened_by_user_name
BEGIN
  SELECT RAISE(ABORT, 'shift reopen provenance is immutable');
END;

CREATE TRIGGER shift_reopen_root_has_no_provenance
BEFORE INSERT ON shift_sessions
WHEN NEW.parent_shift_id IS NULL AND (
  NEW.reopen_reason IS NOT NULL OR NEW.reopened_by_user_id IS NOT NULL OR NEW.reopened_by_user_name IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'root shift cannot carry reopen provenance');
END;

CREATE TRIGGER shift_reopen_segment_validate_insert
BEFORE INSERT ON shift_sessions
WHEN NEW.parent_shift_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM system_flags
  WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore'
)
BEGIN
  SELECT CASE WHEN TRIM(COALESCE(NEW.reopen_reason, '')) = ''
      OR LENGTH(TRIM(NEW.reopen_reason)) > 500 OR NEW.reopened_by_user_id IS NULL
    THEN RAISE(ABORT, 'reopen reason and actor are required') END;
  SELECT CASE WHEN NEW.closed_at IS NOT NULL OR NEW.closing_counted_usd IS NOT NULL
      OR NEW.closing_counted_khr IS NOT NULL OR NEW.closing_note IS NOT NULL
    THEN RAISE(ABORT, 'reopen segment must start open') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM shift_sessions parent
    WHERE parent.id = NEW.parent_shift_id
      AND COALESCE(parent.cancelled_at, parent.closed_at) IS NOT NULL
      AND parent.user_id = NEW.user_id
      AND parent.scope_mode = NEW.scope_mode
      AND parent.business_date = NEW.business_date
      AND ((parent.branch_id IS NULL AND NEW.branch_id IS NULL) OR parent.branch_id = NEW.branch_id)
      AND NEW.opened_at >= COALESCE(parent.cancelled_at, parent.closed_at)
  ) THEN RAISE(ABORT, 'invalid reopen parent') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM shift_sessions child WHERE child.parent_shift_id = NEW.parent_shift_id
  ) THEN RAISE(ABORT, 'shift segment was already reopened') END;
END;

CREATE TRIGGER shift_session_amendments_no_delete
BEFORE DELETE ON shift_session_amendments
WHEN NOT EXISTS (
  SELECT 1 FROM system_flags
  WHERE key = 'maintenance'
    AND json_extract(value, '$.mode') = 'restore'
)
BEGIN
  SELECT RAISE(ABORT, 'shift amendments are immutable');
END;

CREATE TRIGGER shift_session_amendments_no_update
BEFORE UPDATE ON shift_session_amendments
BEGIN SELECT RAISE(ABORT, 'shift amendments are immutable'); END;

CREATE TRIGGER stock_epoch_branch_batch_stock_delete_0243
BEFORE DELETE ON branch_batch_stock
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_branch_batch_stock_insert_0243
BEFORE INSERT ON branch_batch_stock
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_branch_batch_stock_update_0243
BEFORE UPDATE ON branch_batch_stock
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_branch_stock_delete_0243
BEFORE DELETE ON branch_stock
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_branch_stock_insert_0243
BEFORE INSERT ON branch_stock
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_branch_stock_update_0243
BEFORE UPDATE ON branch_stock
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_damaged_stock_lots_delete_0243
BEFORE DELETE ON damaged_stock_lots
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_damaged_stock_lots_insert_0243
BEFORE INSERT ON damaged_stock_lots
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_damaged_stock_lots_update_0243
BEFORE UPDATE ON damaged_stock_lots
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_maintenance_insert_0243
BEFORE INSERT ON system_flags
WHEN NEW.key='maintenance' AND NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_maintenance_update_0243
BEFORE UPDATE OF key,value ON system_flags
WHEN NEW.key='maintenance' AND NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_product_batches_delete_0243
BEFORE DELETE ON product_batches
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_product_batches_insert_0243
BEFORE INSERT ON product_batches
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_product_batches_update_0243
BEFORE UPDATE OF id,variant_product_id,is_active ON product_batches
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_products_delete_0243
BEFORE DELETE ON products
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_products_insert_0243
BEFORE INSERT ON products
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_products_update_0243
BEFORE UPDATE OF stock_quantity,id,is_active ON products
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_reset_admission_0243
BEFORE INSERT ON system_flags
WHEN NEW.key IN ('sale_record_events_reset_guard','sale_incident_recovery_reset_guard','sale_not_paid_stock_recovery_reset_guard')
 AND NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_revision_branch_batch_stock_delete AFTER DELETE ON branch_batch_stock
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  VALUES('branch_batch_stock', CAST(OLD.batch_id AS TEXT) || ':' || CAST(OLD.branch_id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_branch_batch_stock_insert AFTER INSERT ON branch_batch_stock
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  VALUES('branch_batch_stock', CAST(NEW.batch_id AS TEXT) || ':' || CAST(NEW.branch_id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_branch_batch_stock_update AFTER UPDATE ON branch_batch_stock
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  SELECT 'branch_batch_stock', entity_key, 1 FROM (
    SELECT CAST(OLD.batch_id AS TEXT) || ':' || CAST(OLD.branch_id AS TEXT) entity_key
    UNION SELECT CAST(NEW.batch_id AS TEXT) || ':' || CAST(NEW.branch_id AS TEXT)
  ) WHERE 1
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_branch_stock_delete AFTER DELETE ON branch_stock
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  VALUES('branch_stock', CAST(OLD.product_id AS TEXT) || ':' || CAST(OLD.branch_id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_branch_stock_insert AFTER INSERT ON branch_stock
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  VALUES('branch_stock', CAST(NEW.product_id AS TEXT) || ':' || CAST(NEW.branch_id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_branch_stock_update AFTER UPDATE ON branch_stock
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  SELECT 'branch_stock', entity_key, 1 FROM (
    SELECT CAST(OLD.product_id AS TEXT) || ':' || CAST(OLD.branch_id AS TEXT) entity_key
    UNION SELECT CAST(NEW.product_id AS TEXT) || ':' || CAST(NEW.branch_id AS TEXT)
  ) WHERE 1
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_branches_delete AFTER DELETE ON branches
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('branch', CAST(OLD.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('branch_catalog', 'all', 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_branches_insert AFTER INSERT ON branches
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('branch', CAST(NEW.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('branch_catalog', 'all', 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_branches_update AFTER UPDATE ON branches
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  SELECT 'branch', entity_key, 1 FROM (SELECT CAST(OLD.id AS TEXT) entity_key UNION SELECT CAST(NEW.id AS TEXT))
  WHERE 1
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('branch_catalog', 'all', 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_file_assets_delete AFTER DELETE ON file_assets
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('asset', CAST(OLD.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_file_assets_insert AFTER INSERT ON file_assets
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('asset', CAST(NEW.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_file_assets_update AFTER UPDATE ON file_assets
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  SELECT 'asset', entity_key, 1 FROM (SELECT CAST(OLD.id AS TEXT) entity_key UNION SELECT CAST(NEW.id AS TEXT))
  WHERE 1
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_product_batches_delete AFTER DELETE ON product_batches
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('batch', CAST(OLD.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  VALUES('batch_identity', CAST(OLD.variant_product_id AS TEXT) || ':' || OLD.batch_key, 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_product_batches_insert AFTER INSERT ON product_batches
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('batch', CAST(NEW.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  VALUES('batch_identity', CAST(NEW.variant_product_id AS TEXT) || ':' || NEW.batch_key, 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_product_batches_update AFTER UPDATE OF
  id, variant_product_id, batch_key, lot_code, expiry_date, received_at, is_active, notes, synthetic,
  created_at, updated_at, batch_number, supplier_id, supplier_name, payment_status, credit_due_date,
  unit_cost_usd, received_quantity, received_branch_id, received_cost_usd
ON product_batches
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  SELECT 'batch', entity_key, 1 FROM (SELECT CAST(OLD.id AS TEXT) entity_key UNION SELECT CAST(NEW.id AS TEXT))
  WHERE 1
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  SELECT 'batch_identity', entity_key, 1 FROM (
    SELECT CAST(OLD.variant_product_id AS TEXT) || ':' || OLD.batch_key entity_key
    UNION SELECT CAST(NEW.variant_product_id AS TEXT) || ':' || NEW.batch_key
  )
  WHERE 1
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_product_images_delete AFTER DELETE ON product_images
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('product_image', CAST(OLD.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_product_images_insert AFTER INSERT ON product_images
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('product_image', CAST(NEW.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_product_images_update AFTER UPDATE ON product_images
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  SELECT 'product_image', entity_key, 1 FROM (SELECT CAST(OLD.id AS TEXT) entity_key UNION SELECT CAST(NEW.id AS TEXT))
  WHERE 1
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_products_delete AFTER DELETE ON products
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('product', CAST(OLD.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('product_catalog', 'all', 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_products_insert AFTER INSERT ON products
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('product', CAST(NEW.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('product_catalog', 'all', 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_products_update AFTER UPDATE ON products
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  SELECT 'product', entity_key, 1 FROM (SELECT CAST(OLD.id AS TEXT) entity_key UNION SELECT CAST(NEW.id AS TEXT))
  WHERE 1
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('product_catalog', 'all', 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_suppliers_delete AFTER DELETE ON suppliers
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('supplier', CAST(OLD.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_suppliers_insert AFTER INSERT ON suppliers
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('supplier', CAST(NEW.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_suppliers_update AFTER UPDATE ON suppliers
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  SELECT 'supplier', entity_key, 1 FROM (SELECT CAST(OLD.id AS TEXT) entity_key UNION SELECT CAST(NEW.id AS TEXT))
  WHERE 1
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER suppliers_fts_ad AFTER DELETE ON suppliers BEGIN
  INSERT INTO suppliers_fts(suppliers_fts, rowid, name, phone, email, company, contact_person)
  VALUES ('delete', old.id, old.name, old.phone, old.email, old.company, old.contact_person);
END;

CREATE TRIGGER suppliers_fts_ai AFTER INSERT ON suppliers BEGIN
  INSERT INTO suppliers_fts(rowid, name, phone, email, company, contact_person)
  VALUES (new.id, new.name, new.phone, new.email, new.company, new.contact_person);
END;

CREATE TRIGGER suppliers_fts_au AFTER UPDATE ON suppliers BEGIN
  INSERT INTO suppliers_fts(suppliers_fts, rowid, name, phone, email, company, contact_person)
  VALUES ('delete', old.id, old.name, old.phone, old.email, old.company, old.contact_person);
  INSERT INTO suppliers_fts(rowid, name, phone, email, company, contact_person)
  VALUES (new.id, new.name, new.phone, new.email, new.company, new.contact_person);
END;

CREATE TRIGGER suppliers_fts_phone_ad AFTER DELETE ON suppliers BEGIN
  INSERT INTO suppliers_fts_phone(suppliers_fts_phone, rowid, phone) VALUES ('delete', old.id, old.phone);
END;

CREATE TRIGGER suppliers_fts_phone_ai AFTER INSERT ON suppliers BEGIN
  INSERT INTO suppliers_fts_phone(rowid, phone) VALUES (new.id, new.phone);
END;

CREATE TRIGGER suppliers_fts_phone_au AFTER UPDATE ON suppliers BEGIN
  INSERT INTO suppliers_fts_phone(suppliers_fts_phone, rowid, phone) VALUES ('delete', old.id, old.phone);
  INSERT INTO suppliers_fts_phone(rowid, phone) VALUES (new.id, new.phone);
END;

CREATE TRIGGER transfer_batch_delete BEFORE DELETE ON product_batches
WHEN EXISTS(SELECT 1 FROM transfer_operation_members m,json_each(m.allocations_json) a
   WHERE json_extract(a.value,'$.source_batch_id')=OLD.id OR json_extract(a.value,'$.destination_batch_id')=OLD.id)
BEGIN SELECT RAISE(ABORT,'lot has immutable transfer provenance'); END;

CREATE TRIGGER transfer_batch_identity_update BEFORE UPDATE OF id,variant_product_id ON product_batches
WHEN (NEW.id IS NOT OLD.id OR NEW.variant_product_id IS NOT OLD.variant_product_id)
 AND EXISTS(SELECT 1 FROM transfer_operation_members m,json_each(m.allocations_json) a
   WHERE json_extract(a.value,'$.source_batch_id')=OLD.id OR json_extract(a.value,'$.destination_batch_id')=OLD.id)
BEGIN SELECT RAISE(ABORT,'lot has immutable transfer provenance'); END;

CREATE TRIGGER transfer_members_immutable_delete BEFORE DELETE ON transfer_operation_members
WHEN NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
 AND NOT EXISTS(SELECT 1 FROM system_flags WHERE key='sale_record_events_reset_guard' AND json_extract(value,'$.mode')='reset' AND length(trim(COALESCE(json_extract(value,'$.token'),'')))>0)
BEGIN SELECT RAISE(ABORT,'transfer provenance is immutable: reset or restore required'); END;

CREATE TRIGGER transfer_members_immutable_update BEFORE UPDATE ON transfer_operation_members
BEGIN SELECT RAISE(ABORT,'transfer provenance is immutable'); END;

CREATE TRIGGER transfer_members_sealed_insert BEFORE INSERT ON transfer_operation_members
WHEN EXISTS(SELECT 1 FROM transfer_operation_receipts WHERE id=NEW.receipt_id AND status='committed')
 AND NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN SELECT RAISE(ABORT,'committed transfer provenance is sealed'); END;

CREATE TRIGGER transfer_product_delete BEFORE DELETE ON products
WHEN EXISTS(SELECT 1 FROM transfer_operation_members WHERE source_product_id=OLD.id OR destination_product_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'product has immutable transfer provenance'); END;

CREATE TRIGGER transfer_product_identity_update BEFORE UPDATE OF id,is_active ON products
WHEN (NEW.id IS NOT OLD.id OR NEW.is_active IS NOT OLD.is_active)
 AND EXISTS(SELECT 1 FROM transfer_operation_members WHERE source_product_id=OLD.id OR destination_product_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'product has immutable transfer provenance'); END;

CREATE TRIGGER transfer_receipts_generation_update BEFORE UPDATE OF generation,replay_state ON transfer_operation_receipts
WHEN OLD.status='committed' AND (NEW.generation<>OLD.generation+1
 OR NOT ((OLD.replay_state='applied' AND NEW.replay_state='reversed') OR (OLD.replay_state='reversed' AND NEW.replay_state='applied')))
BEGIN SELECT RAISE(ABORT,'transfer replay generation conflict'); END;

CREATE TRIGGER transfer_receipts_identity_update BEFORE UPDATE ON transfer_operation_receipts
WHEN OLD.status='committed' AND (NEW.actor_id IS NOT OLD.actor_id OR NEW.request_id IS NOT OLD.request_id
 OR NEW.request_digest IS NOT OLD.request_digest OR NEW.request_json IS NOT OLD.request_json
 OR NEW.response_json IS NOT OLD.response_json OR NEW.operation_id IS NOT OLD.operation_id
 OR NEW.provenance_version IS NOT OLD.provenance_version OR NEW.action_history_id IS NOT OLD.action_history_id
 OR NEW.status IS NOT OLD.status)
BEGIN SELECT RAISE(ABORT,'transfer receipt identity is immutable'); END;

CREATE TRIGGER transfer_receipts_immutable_delete BEFORE DELETE ON transfer_operation_receipts
WHEN NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
 AND NOT EXISTS(SELECT 1 FROM system_flags WHERE key='sale_record_events_reset_guard' AND json_extract(value,'$.mode')='reset' AND length(trim(COALESCE(json_extract(value,'$.token'),'')))>0)
BEGIN SELECT RAISE(ABORT,'transfer receipts are immutable: reset or restore required'); END;

CREATE TRIGGER transfer_receipts_require_provenance_insert
BEFORE INSERT ON transfer_operation_receipts
WHEN COALESCE(NEW.provenance_version,0)<>1
 AND NOT EXISTS(
   SELECT 1 FROM system_flags WHERE key='maintenance'
   AND json_extract(CASE WHEN json_valid(value) THEN value ELSE '{}' END,'$.mode')='restore'
   AND json_type(CASE WHEN json_valid(value) THEN value ELSE '{}' END,'$.token')='text'
   AND length(trim(COALESCE(json_extract(CASE WHEN json_valid(value) THEN value ELSE '{}' END,'$.token'),'')))>0
   AND COALESCE(json_extract(CASE WHEN json_valid(value) THEN value ELSE '{}' END,'$.backupKey'),'') NOT LIKE 'deployment:%'
 )
BEGIN SELECT RAISE(ABORT,'transfer provenance version 1 required: upgrade Worker'); END;

CREATE TRIGGER trg_legacy_inventory_effect_apply
AFTER INSERT ON legacy_inventory_effects
BEGIN
  UPDATE products
  SET stock_quantity = stock_quantity + NEW.quantity_delta,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.product_id;

  UPDATE branch_stock
  SET quantity = quantity + NEW.quantity_delta
  WHERE product_id = NEW.product_id AND branch_id = NEW.branch_id;

  UPDATE branch_batch_stock
  SET quantity = quantity + NEW.quantity_delta,
      updated_at = CURRENT_TIMESTAMP
  WHERE NEW.batch_id IS NOT NULL
    AND batch_id = NEW.batch_id AND branch_id = NEW.branch_id;

  INSERT INTO inventory_movements (
    product_id, product_name, branch_id, branch_name, movement_type,
    quantity, unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr,
    reason, reference_id, user_id, user_name, created_at, batch_id
  )
  SELECT
    p.id, p.name, b.id, b.name, NEW.movement_type,
    NEW.movement_quantity,
    COALESCE(NEW.unit_cost_usd, p.cost_price_usd, 0),
    COALESCE(NEW.unit_cost_khr, p.cost_price_khr, 0),
    NEW.movement_quantity * COALESCE(NEW.unit_cost_usd, p.cost_price_usd, 0),
    NEW.movement_quantity * COALESCE(NEW.unit_cost_khr, p.cost_price_khr, 0),
    NEW.reason, NEW.reference_id, NULL, 'Old system', NEW.occurred_at,
    NEW.batch_id
  FROM products p
  JOIN branches b ON b.id = NEW.branch_id
  WHERE p.id = NEW.product_id;
END;

CREATE TRIGGER trg_legacy_inventory_effect_stock_guard
BEFORE INSERT ON legacy_inventory_effects
WHEN NOT EXISTS (
  SELECT 1 FROM legacy_inventory_effects WHERE source_key=NEW.source_key
) AND NEW.quantity_delta < 0 AND (
  COALESCE((
    SELECT quantity FROM branch_stock
    WHERE product_id=NEW.product_id AND branch_id=NEW.branch_id
  ), 0) + NEW.quantity_delta < 0
  OR COALESCE((
    SELECT stock_quantity FROM products WHERE id=NEW.product_id
  ), 0) + NEW.quantity_delta < 0
  OR (
    NEW.batch_id IS NOT NULL AND COALESCE((
      SELECT quantity FROM branch_batch_stock
      WHERE batch_id=NEW.batch_id AND branch_id=NEW.branch_id
    ), 0) + NEW.quantity_delta < 0
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Legacy inventory effect would make stock negative');
END;

CREATE TRIGGER trg_products_ad_name_key
AFTER DELETE ON products
BEGIN
  UPDATE products
    SET is_grouped_cached = (
      (SELECT COUNT(*) FROM products p2 WHERE p2.name_key = OLD.name_key AND +p2.is_active = 1) > 1
    )
    WHERE name_key = OLD.name_key AND +is_active = 1 AND OLD.name_key <> '';
END;

CREATE TRIGGER trg_products_ai_name_key
AFTER INSERT ON products
BEGIN
  UPDATE products SET name_key = lower(trim(NEW.name)) WHERE id = NEW.id;
  UPDATE products
    SET is_grouped_cached = (
      (SELECT COUNT(*) FROM products p2 WHERE p2.name_key = lower(trim(NEW.name)) AND +p2.is_active = 1) > 1
    )
    WHERE name_key = lower(trim(NEW.name)) AND +is_active = 1 AND lower(trim(NEW.name)) <> '';
END;

CREATE TRIGGER trg_products_au_name_active
AFTER UPDATE OF name, is_active ON products
WHEN NEW.name IS NOT OLD.name OR NEW.is_active IS NOT OLD.is_active
BEGIN
  UPDATE products SET name_key = lower(trim(NEW.name)) WHERE id = NEW.id AND name_key IS NOT lower(trim(NEW.name));

  -- Recompute the group this row is LEAVING (its old name_key), if it
  -- actually changed name_key.
  UPDATE products
    SET is_grouped_cached = (
      (SELECT COUNT(*) FROM products p2 WHERE p2.name_key = OLD.name_key AND +p2.is_active = 1) > 1
    )
    WHERE name_key = OLD.name_key AND +is_active = 1 AND OLD.name_key <> '' AND OLD.name_key IS NOT lower(trim(NEW.name));

  -- Recompute the group this row is now IN (its new name_key / new active
  -- state -- covers plain (de)activation with no name change too).
  UPDATE products
    SET is_grouped_cached = (
      (SELECT COUNT(*) FROM products p2 WHERE p2.name_key = lower(trim(NEW.name)) AND +p2.is_active = 1) > 1
    )
    WHERE name_key = lower(trim(NEW.name)) AND +is_active = 1 AND lower(trim(NEW.name)) <> '';

  -- If this row itself just went inactive or blank-named, the two updates
  -- above won't have touched it (they only target is_active=1 / non-blank
  -- rows) -- clear its own flag explicitly so it doesn't keep a stale 1.
  UPDATE products SET is_grouped_cached = 0
    WHERE id = NEW.id AND (NEW.is_active = 0 OR lower(trim(NEW.name)) = '');
END;
