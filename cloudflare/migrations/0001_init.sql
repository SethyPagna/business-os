-- Business OS D1 (SQLite) schema
-- Mechanically converted from backend/src/db/postgresSchema.sql, then validated
-- statement-by-statement against a real local D1 database via wrangler.
-- bigint->INTEGER, double precision->REAL, text->TEXT, boolean->INTEGER,
-- timestamp[tz]->TEXT (stored as ISO strings, same convention the original
-- schema already used for its text-typed timestamp columns).
-- PRIMARY KEY + IDENTITY sequences merged into inline INTEGER PRIMARY KEY
-- AUTOINCREMENT; text-typed primary keys (import_jobs.id, settings.key) kept
-- as TEXT PRIMARY KEY, not forced to INTEGER.
-- USING btree stripped (SQLite has one index type); functional indexes like
-- lower(name) and partial indexes (WHERE ...) are kept as-is -- D1 supports
-- both natively.

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

CREATE TABLE branch_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  quantity REAL DEFAULT 0,
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
);

CREATE TABLE business_os_migration_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_hash TEXT,
  status TEXT NOT NULL,
  summary_json jsonb DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
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
);

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
);

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

CREATE TABLE product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  image_path TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
);

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
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
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
);

CREATE TABLE units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  color TEXT DEFAULT '#6366f1',
  updated_at TEXT
);

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
);

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
);

CREATE TABLE verification_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  purpose TEXT NOT NULL,
  channel TEXT NOT NULL,
  destination TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  code_salt TEXT NOT NULL,
  meta_json TEXT DEFAULT '{}',
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
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
);

CREATE TABLE branch_batch_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  quantity REAL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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

-- Indexes

CREATE UNIQUE INDEX idx_user_sessions_token_hash_unique_pg ON user_sessions (token_hash);
CREATE INDEX idx_action_history_created_pg ON action_history (created_at DESC, id DESC);
CREATE INDEX idx_action_history_scope_updated_pg ON action_history (scope, updated_at DESC, id DESC);
CREATE INDEX idx_action_history_scope_user_updated_pg ON action_history (scope, created_by_id, updated_at DESC, id DESC);
CREATE UNIQUE INDEX idx_branch_stock_product_branch_unique ON branch_stock (product_id, branch_id);
CREATE INDEX idx_branch_stock_branch_qty_product_pg ON branch_stock (branch_id, quantity DESC, product_id);
CREATE INDEX idx_customer_share_submissions_status_created_pg ON customer_share_submissions (status, created_at DESC, id DESC);
CREATE INDEX idx_customers_membership_lower_pg ON customers (lower(membership_number));
CREATE UNIQUE INDEX idx_file_assets_public_path_unique ON file_assets (public_path);
CREATE UNIQUE INDEX idx_google_drive_sync_entries_path_unique ON google_drive_sync_entries (relative_path);
CREATE UNIQUE INDEX idx_import_job_batches_job_batch_unique ON import_job_batches (job_id, batch_index);
CREATE INDEX idx_inventory_movements_branch_created_pg ON inventory_movements (branch_id, created_at DESC, id DESC);
CREATE INDEX idx_inventory_movements_created_pg ON inventory_movements (created_at DESC, id DESC);
CREATE INDEX idx_inventory_movements_product_created_pg ON inventory_movements (product_id, created_at DESC, id DESC);
CREATE INDEX idx_inventory_movements_user_created_pg ON inventory_movements (user_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX idx_stock_transfers_client_request_unique ON stock_transfers (client_request_id) WHERE ((client_request_id IS NOT NULL) AND (client_request_id <> ''));
CREATE INDEX idx_products_active_stock_name_pg ON products (is_active, stock_quantity, name);
CREATE INDEX idx_products_active_created_pg ON products (is_active, created_at DESC, id DESC);
CREATE INDEX idx_products_active_name_id_pg ON products (is_active, name, id);
CREATE INDEX idx_products_active_brand_pg ON products (is_active, brand);
CREATE INDEX idx_products_active_category_pg ON products (is_active, category);
CREATE INDEX idx_products_active_supplier_pg ON products (is_active, supplier);
CREATE INDEX idx_products_barcode_pg ON products (barcode);
CREATE INDEX idx_products_brand_lower_pg ON products (lower(brand));
CREATE INDEX idx_products_category_lower_pg ON products (lower(category));
CREATE INDEX idx_products_name_lower_pg ON products (lower(name));
CREATE INDEX idx_products_parent_pg ON products (parent_id, is_group);
CREATE INDEX idx_products_sku_pg ON products (sku);
CREATE INDEX idx_products_supplier_lower_pg ON products (lower(supplier));
CREATE UNIQUE INDEX idx_products_client_request_unique_pg ON products (client_request_id) WHERE ((client_request_id IS NOT NULL) AND (client_request_id <> ''));
CREATE INDEX idx_products_unit_lower_pg ON products (lower(unit));
CREATE INDEX idx_categories_name_lower_pg ON categories (lower(name));
CREATE INDEX idx_units_name_lower_pg ON units (lower(name));
CREATE INDEX idx_returns_created_pg ON returns (created_at DESC, id DESC);
CREATE INDEX idx_returns_status_created_pg ON returns (status, created_at DESC, id DESC);
CREATE INDEX idx_returns_scope_created_pg ON returns (COALESCE(return_scope, 'customer'), created_at DESC, id DESC);
CREATE UNIQUE INDEX idx_returns_client_request_unique_pg ON returns (client_request_id) WHERE ((client_request_id IS NOT NULL) AND (client_request_id <> ''));
CREATE INDEX idx_return_items_return_id_pg ON return_items (return_id, id);
CREATE INDEX idx_sale_items_product_branch_sale_pg ON sale_items (product_id, branch_id, sale_id);
CREATE INDEX idx_sale_items_sale_id_pg ON sale_items (sale_id, id);
CREATE INDEX idx_sales_created_pg ON sales (created_at DESC, id DESC);
CREATE INDEX idx_sales_status_created_pg ON sales (sale_status, created_at DESC, id DESC);
CREATE UNIQUE INDEX idx_sales_client_request_unique_pg ON sales (client_request_id) WHERE ((client_request_id IS NOT NULL) AND (client_request_id <> ''));
CREATE UNIQUE INDEX idx_rfid_tags_epc_unique ON rfid_tags (epc_id);
CREATE INDEX idx_rfid_tags_product_branch ON rfid_tags (product_id, branch_id, status);
CREATE INDEX idx_rfid_events_session_epc ON rfid_events (session_id, epc_id, seen_at DESC);
CREATE UNIQUE INDEX idx_rfid_events_dedupe_key_unique ON rfid_events (dedupe_key) WHERE ((dedupe_key IS NOT NULL) AND (dedupe_key <> ''));
CREATE UNIQUE INDEX idx_rfid_session_items_unique ON rfid_session_items (session_id, epc_id);
CREATE INDEX idx_product_images_product_sort_pg ON product_images (product_id, sort_order, id);
CREATE INDEX idx_import_job_files_job_kind_pg ON import_job_files (job_id, kind, id);
CREATE INDEX idx_import_job_errors_job_batch_pg ON import_job_errors (job_id, batch_id, id);
CREATE UNIQUE INDEX idx_settings_key_unique ON settings (key);
CREATE UNIQUE INDEX idx_product_batches_variant_key_unique ON product_batches (variant_product_id, batch_key);
CREATE INDEX idx_product_batches_variant_expiry ON product_batches (variant_product_id, expiry_date, received_at, id);
CREATE UNIQUE INDEX idx_branch_batch_stock_batch_branch_unique ON branch_batch_stock (batch_id, branch_id);
CREATE INDEX idx_branch_batch_stock_branch_qty ON branch_batch_stock (branch_id, quantity DESC, batch_id);
CREATE INDEX idx_sale_item_batch_allocations_sale_item ON sale_item_batch_allocations (sale_item_id, released_at);
CREATE INDEX idx_return_item_batch_allocations_return_item ON return_item_batch_allocations (return_item_id, reversed_at);