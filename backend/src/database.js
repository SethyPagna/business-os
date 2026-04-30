'use strict'
/**
 * database.js — SQLite schema, migrations, and seed data.
 *
 * SCHEMA MUST MATCH ROUTES EXACTLY.
 * Before editing this file, cross-check with:
 *   src/routes/sales.js      — sale_items, inventory_movements, sales columns
 *   src/routes/returns.js    — return_items, returns columns
 *   src/routes/inventory.js  — inventory_movements columns
 *
 * Column audit (route → table):
 *   sales            : payment_currency, device_tz, device_name  ← were missing
 *   sale_items       : cost_price_usd, cost_price_khr, branch_id, total_usd, total_khr  ← were missing/renamed
 *   inventory_movements: unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, reference_id  ← were missing
 *   returns          : customer_name, branch_id, branch_name, return_type, total_refund_usd, total_refund_khr, exchange_rate, device_name, device_tz  ← were missing
 *   return_items     : ENTIRE TABLE was missing
 */
const path     = require('path')
const fs       = require('fs')
const crypto   = require('crypto')
const Database = require('better-sqlite3')
const bcrypt   = require('bcryptjs')
const { DB_PATH, DEFAULT_ORGANIZATION_BOOTSTRAP } = require('./config')
const { repairMissingUploadReferences } = require('./uploadReferenceCleanup')
// Detailed relational reference: docs/SCHEMA-RELATIONSHIPS.md

// Ensure the DB directory exists before opening the file
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('synchronous = NORMAL')
db.pragma('cache_size = -32000')
db.pragma('temp_store = MEMORY')
db.pragma('mmap_size = 268435456')
db.pragma('wal_autocheckpoint = 1000')

// ── Schema ─────────────────────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS organizations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  public_id     TEXT NOT NULL UNIQUE,
  is_active     INTEGER DEFAULT 1,
  setup_enabled INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS organization_groups (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  is_default      INTEGER DEFAULT 0,
  is_active       INTEGER DEFAULT 1,
  created_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(organization_id, slug),
  FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  organization_id INTEGER,
  organization_group_id INTEGER,
  phone       TEXT,
  phone_lookup TEXT,
  phone_verified INTEGER DEFAULT 0,
  email       TEXT,
  email_verified INTEGER DEFAULT 0,
  avatar_path TEXT,
  firebase_user_id TEXT,
  supabase_user_id TEXT,
  deleted_at  TEXT,
  password    TEXT NOT NULL,
  role_id     INTEGER,
  permissions TEXT DEFAULT '{}',
  otp_enabled INTEGER DEFAULT 0,
  otp_secret  TEXT,
  otp_pending_secret TEXT,
  otp_pending_created_at TEXT,
  is_active   INTEGER DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
  FOREIGN KEY(organization_group_id) REFERENCES organization_groups(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  device_name  TEXT,
  device_tz    TEXT,
  client_time  TEXT,
  user_agent   TEXT,
  last_ip      TEXT,
  last_seen_at TEXT DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  code        TEXT,
  is_system   INTEGER DEFAULT 0,
  permissions TEXT DEFAULT '{}',
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT DEFAULT '#6366f1',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS units (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT DEFAULT '#6366f1',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS branches (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  location   TEXT,
  phone      TEXT,
  manager    TEXT,
  notes      TEXT,
  is_default INTEGER DEFAULT 0,
  is_active  INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  name                    TEXT NOT NULL,
  client_request_id       TEXT,
  sku                     TEXT,
  barcode                 TEXT,
  category                TEXT,
  brand                   TEXT,
  unit                    TEXT DEFAULT 'pcs',
  description             TEXT,
  selling_price_usd       REAL DEFAULT 0,
  selling_price_khr       REAL DEFAULT 0,
  special_price_usd       REAL DEFAULT 0,
  special_price_khr       REAL DEFAULT 0,
  discount_enabled        INTEGER DEFAULT 0,
  discount_type           TEXT DEFAULT 'percent',
  discount_percent        REAL DEFAULT 0,
  discount_amount_usd     REAL DEFAULT 0,
  discount_amount_khr     REAL DEFAULT 0,
  discount_label          TEXT,
  discount_badge_color    TEXT DEFAULT '#e11d48',
  discount_starts_at      TEXT,
  discount_ends_at        TEXT,
  purchase_price_usd      REAL DEFAULT 0,
  purchase_price_khr      REAL DEFAULT 0,
  cost_price_usd          REAL DEFAULT 0,
  cost_price_khr          REAL DEFAULT 0,
  stock_quantity          REAL DEFAULT 0,
  low_stock_threshold     REAL DEFAULT 10,
  out_of_stock_threshold  REAL DEFAULT 0,
  image_path              TEXT,
  is_active               INTEGER DEFAULT 1,
  supplier                TEXT,
  custom_fields           TEXT DEFAULT '{}',
  is_group                INTEGER DEFAULT 0,
  parent_id               INTEGER,
  created_at              TEXT DEFAULT (datetime('now')),
  updated_at              TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  image_path TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, image_path),
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS branch_stock (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  branch_id  INTEGER NOT NULL,
  quantity   REAL DEFAULT 0,
  UNIQUE(product_id, branch_id)
);

CREATE TABLE IF NOT EXISTS custom_fields (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type    TEXT NOT NULL,
  field_name     TEXT NOT NULL,
  field_type     TEXT NOT NULL DEFAULT 'text',
  required       INTEGER DEFAULT 0,
  default_value  TEXT,
  options        TEXT,
  sort_order     INTEGER DEFAULT 0,
  created_at     TEXT DEFAULT (datetime('now')),
  UNIQUE(entity_type, field_name)
);

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  membership_number TEXT,
  phone      TEXT,
  email      TEXT,
  address    TEXT,
  company    TEXT,
  notes      TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL UNIQUE,
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  company        TEXT,
  contact_person TEXT,
  notes          TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS delivery_contacts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT,
  area       TEXT,
  address    TEXT,
  notes      TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ─── SALES ────────────────────────────────────────────────────────────────────
-- payment_currency, device_tz, device_name are REQUIRED by routes/sales.js
CREATE TABLE IF NOT EXISTS sales (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_number           TEXT UNIQUE,
  client_request_id        TEXT,
  cashier_id               INTEGER,
  cashier_name             TEXT,
  branch_id                INTEGER,
  branch_name              TEXT,
  customer_id              INTEGER,
  customer_name            TEXT,
  customer_phone           TEXT,
  customer_address         TEXT,
  payment_method           TEXT DEFAULT 'Cash',
  payment_currency         TEXT DEFAULT 'USD',
  exchange_rate            REAL DEFAULT 4100,
  subtotal_usd             REAL DEFAULT 0,
  subtotal_khr             REAL DEFAULT 0,
  discount_usd             REAL DEFAULT 0,
  discount_khr             REAL DEFAULT 0,
  membership_discount_usd  REAL DEFAULT 0,
  membership_discount_khr  REAL DEFAULT 0,
  membership_points_redeemed REAL DEFAULT 0,
  tax_usd                  REAL DEFAULT 0,
  tax_khr                  REAL DEFAULT 0,
  total_usd                REAL DEFAULT 0,
  total_khr                REAL DEFAULT 0,
  amount_paid_usd          REAL DEFAULT 0,
  amount_paid_khr          REAL DEFAULT 0,
  change_usd               REAL DEFAULT 0,
  change_khr               REAL DEFAULT 0,
  is_delivery              INTEGER DEFAULT 0,
  delivery_contact_id      INTEGER,
  delivery_contact_name    TEXT,
  delivery_contact_phone   TEXT,
  delivery_contact_address TEXT,
  delivery_fee_usd         REAL DEFAULT 0,
  delivery_fee_khr         REAL DEFAULT 0,
  delivery_fee_paid_by     TEXT DEFAULT 'customer',
  sale_status              TEXT DEFAULT 'completed',
  notes                    TEXT,
  items                    TEXT DEFAULT '[]',
  device_name              TEXT,
  device_tz                TEXT,
  created_at               TEXT DEFAULT (datetime('now')),
  updated_at               TEXT DEFAULT (datetime('now'))
);

-- ─── SALE ITEMS ───────────────────────────────────────────────────────────────
-- cost_price_usd, cost_price_khr, branch_id, total_usd, total_khr are REQUIRED
-- by routes/sales.js and routes/inventory.js queries.
-- Note: old schema had subtotal_usd/subtotal_khr — routes use total_usd/total_khr.
CREATE TABLE IF NOT EXISTS sale_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id           INTEGER NOT NULL,
  product_id        INTEGER,
  product_name      TEXT,
  sku               TEXT,
  quantity          REAL DEFAULT 1,
  unit              TEXT,
  applied_price_usd REAL DEFAULT 0,
  applied_price_khr REAL DEFAULT 0,
  price_mode        TEXT DEFAULT 'selling',
  product_discount_type TEXT,
  product_discount_label TEXT,
  product_discount_usd REAL DEFAULT 0,
  product_discount_khr REAL DEFAULT 0,
  cost_price_usd    REAL DEFAULT 0,
  cost_price_khr    REAL DEFAULT 0,
  total_usd         REAL DEFAULT 0,
  total_khr         REAL DEFAULT 0,
  branch_id         INTEGER,
  FOREIGN KEY(sale_id) REFERENCES sales(id) ON DELETE CASCADE
);

-- ─── INVENTORY MOVEMENTS ──────────────────────────────────────────────────────
-- unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, reference_id
-- are REQUIRED by routes/inventory.js and routes/sales.js INSERT statements.
CREATE TABLE IF NOT EXISTS inventory_movements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id     INTEGER,
  product_name   TEXT,
  branch_id      INTEGER,
  branch_name    TEXT,
  movement_type  TEXT,
  quantity       REAL,
  unit_cost_usd  REAL DEFAULT 0,
  unit_cost_khr  REAL DEFAULT 0,
  total_cost_usd REAL DEFAULT 0,
  total_cost_khr REAL DEFAULT 0,
  reason         TEXT,
  reference_id   INTEGER,
  user_id        INTEGER,
  user_name      TEXT,
  created_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  from_branch_id INTEGER,
  to_branch_id   INTEGER,
  product_id     INTEGER,
  product_name   TEXT,
  quantity       REAL,
  notes          TEXT,
  user_id        INTEGER,
  user_name      TEXT,
  created_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_row_moves (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  source_product_id      INTEGER NOT NULL,
  source_product_name    TEXT,
  destination_product_id INTEGER NOT NULL,
  destination_product_name TEXT,
  branch_id             INTEGER,
  branch_name           TEXT,
  quantity              REAL NOT NULL,
  reason                TEXT,
  note                  TEXT,
  user_id               INTEGER,
  user_name             TEXT,
  created_at            TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS action_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  scope          TEXT DEFAULT 'global',
  entity         TEXT,
  entity_id      TEXT,
  label          TEXT NOT NULL,
  undo_label     TEXT,
  redo_label     TEXT,
  reversible     INTEGER DEFAULT 1,
  status         TEXT DEFAULT 'undoable',
  undo_payload   TEXT DEFAULT '{}',
  redo_payload   TEXT DEFAULT '{}',
  last_error     TEXT,
  created_by_id  INTEGER,
  created_by_name TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);

-- ─── RETURNS ──────────────────────────────────────────────────────────────────
-- customer_name, branch_id, branch_name, return_type, total_refund_usd,
-- total_refund_khr, exchange_rate, device_name, device_tz are REQUIRED by routes/returns.js.
CREATE TABLE IF NOT EXISTS returns (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  return_number    TEXT UNIQUE,
  client_request_id TEXT,
  sale_id          INTEGER,
  receipt_number   TEXT,
  cashier_id       INTEGER,
  cashier_name     TEXT,
  customer_id      INTEGER,
  customer_name    TEXT,
  branch_id        INTEGER,
  branch_name      TEXT,
  return_scope     TEXT DEFAULT 'customer',
  reason           TEXT,
  return_type      TEXT DEFAULT 'restock',
  notes            TEXT,
  total_refund_usd REAL DEFAULT 0,
  total_refund_khr REAL DEFAULT 0,
  exchange_rate    REAL DEFAULT 4100,
  supplier_id      INTEGER,
  supplier_name    TEXT,
  supplier_settlement TEXT DEFAULT 'none',
  supplier_compensation_usd REAL DEFAULT 0,
  supplier_compensation_khr REAL DEFAULT 0,
  supplier_loss_usd REAL DEFAULT 0,
  supplier_loss_khr REAL DEFAULT 0,
  status           TEXT DEFAULT 'completed',
  device_name      TEXT,
  device_tz        TEXT,
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now'))
);

-- ─── RETURN ITEMS ─────────────────────────────────────────────────────────────
-- This entire table was missing — causes 500 on every returns, sales, dashboard,
-- analytics, and inventory/summary endpoint because they all JOIN against it.
CREATE TABLE IF NOT EXISTS return_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id         INTEGER NOT NULL,
  sale_item_id      INTEGER,
  product_id        INTEGER,
  product_name      TEXT,
  quantity          REAL DEFAULT 1,
  applied_price_usd REAL DEFAULT 0,
  applied_price_khr REAL DEFAULT 0,
  cost_price_usd    REAL DEFAULT 0,
  cost_price_khr    REAL DEFAULT 0,
  total_usd         REAL DEFAULT 0,
  total_khr         REAL DEFAULT 0,
  return_to_stock   INTEGER DEFAULT 1,
  branch_id         INTEGER,
  FOREIGN KEY(return_id) REFERENCES returns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER,
  user_name    TEXT,
  action       TEXT,
  entity       TEXT,
  entity_id    INTEGER,
  details      TEXT,
  table_name   TEXT,
  record_id    INTEGER,
  old_value    TEXT,
  new_value    TEXT,
  device_name  TEXT,
  device_tz    TEXT,
  client_time  TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS custom_tables (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  columns    TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_share_submissions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id      INTEGER,
  membership_number TEXT,
  customer_name    TEXT,
  platform         TEXT,
  note             TEXT,
  screenshots_json TEXT DEFAULT '[]',
  status           TEXT DEFAULT 'pending',
  reward_points    REAL DEFAULT 0,
  review_note      TEXT,
  reviewed_by_id   INTEGER,
  reviewed_by_name TEXT,
  reviewed_at      TEXT,
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS verification_codes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER,
  purpose      TEXT NOT NULL,
  channel      TEXT NOT NULL,
  destination  TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  code_salt    TEXT NOT NULL,
  meta_json    TEXT DEFAULT '{}',
  expires_at   TEXT NOT NULL,
  consumed_at  TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS file_assets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  original_name   TEXT NOT NULL,
  stored_name     TEXT NOT NULL,
  public_path     TEXT NOT NULL UNIQUE,
  mime_type       TEXT,
  media_type      TEXT DEFAULT 'image',
  byte_size       INTEGER,
  original_byte_size INTEGER,
  optimized_byte_size INTEGER,
  optimization_status TEXT DEFAULT 'not_optimized',
  optimization_note TEXT,
  width           INTEGER,
  height          INTEGER,
  duration_seconds REAL,
  source          TEXT DEFAULT 'upload',
  created_by_id   INTEGER,
  created_by_name TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_provider_configs (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT NOT NULL,
  provider             TEXT NOT NULL,
  provider_type        TEXT DEFAULT 'chat',
  account_email        TEXT,
  project_name         TEXT,
  api_key_encrypted    TEXT NOT NULL,
  default_model        TEXT,
  supported_models_json TEXT DEFAULT '[]',
  endpoint_override    TEXT,
  notes                TEXT,
  enabled              INTEGER DEFAULT 1,
  priority             INTEGER DEFAULT 50,
  requests_per_minute  INTEGER DEFAULT 10,
  max_input_chars      INTEGER DEFAULT 1000,
  max_completion_tokens INTEGER DEFAULT 1200,
  timeout_ms           INTEGER DEFAULT 15000,
  cooldown_seconds     INTEGER DEFAULT 20,
  last_status          TEXT DEFAULT 'untested',
  last_error           TEXT,
  last_checked_at      TEXT,
  created_by_id        INTEGER,
  created_by_name      TEXT,
  created_at           TEXT DEFAULT (datetime('now')),
  updated_at           TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_response_logs (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  surface              TEXT DEFAULT 'portal',
  provider_config_id   INTEGER,
  provider_name        TEXT,
  provider             TEXT,
  model                TEXT,
  actor_user_id        INTEGER,
  actor_user_name      TEXT,
  actor_label          TEXT,
  prompt_text          TEXT,
  question_text        TEXT,
  profile_json         TEXT DEFAULT '{}',
  candidate_products_json TEXT DEFAULT '[]',
  recommendations_json TEXT DEFAULT '[]',
  citations_json       TEXT DEFAULT '[]',
  answer_text          TEXT,
  created_at           TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS google_drive_sync_entries (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  relative_path    TEXT NOT NULL UNIQUE,
  item_type        TEXT DEFAULT 'file',
  remote_file_id   TEXT NOT NULL,
  mime_type        TEXT,
  md5_checksum     TEXT,
  byte_size        INTEGER DEFAULT 0,
  local_modified_at TEXT,
  last_synced_at   TEXT DEFAULT (datetime('now'))
);
`)


// ── Migrations — add columns to EXISTING databases ────────────────────────────
// Each ALTER TABLE is wrapped in try/catch — SQLite throws if the column exists.
// This lets us safely run this list on every server start without data loss.
const migrations = [
  // users
  `ALTER TABLE users ADD COLUMN phone TEXT`,
  `ALTER TABLE users ADD COLUMN phone_lookup TEXT`,
  `ALTER TABLE users ADD COLUMN organization_id INTEGER`,
  `ALTER TABLE users ADD COLUMN organization_group_id INTEGER`,
  `ALTER TABLE users ADD COLUMN email TEXT`,
  `ALTER TABLE users ADD COLUMN phone_verified INTEGER DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN avatar_path TEXT`,
  `ALTER TABLE users ADD COLUMN firebase_user_id TEXT`,
  `ALTER TABLE users ADD COLUMN supabase_user_id TEXT`,
  `ALTER TABLE users ADD COLUMN deleted_at TEXT`,
  `ALTER TABLE users ADD COLUMN otp_enabled INTEGER DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN otp_secret TEXT`,
  `ALTER TABLE users ADD COLUMN otp_pending_secret TEXT`,
  `ALTER TABLE users ADD COLUMN otp_pending_created_at TEXT`,

  // roles
  `ALTER TABLE roles ADD COLUMN code TEXT`,
  `ALTER TABLE roles ADD COLUMN is_system INTEGER DEFAULT 0`,

  // products
  `ALTER TABLE products ADD COLUMN cost_price_usd REAL DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN cost_price_khr REAL DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN out_of_stock_threshold REAL DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN special_price_usd REAL DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN special_price_khr REAL DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN discount_enabled INTEGER DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN discount_type TEXT DEFAULT 'percent'`,
  `ALTER TABLE products ADD COLUMN discount_percent REAL DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN discount_amount_usd REAL DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN discount_amount_khr REAL DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN discount_label TEXT`,
  `ALTER TABLE products ADD COLUMN discount_badge_color TEXT DEFAULT '#e11d48'`,
  `ALTER TABLE products ADD COLUMN discount_starts_at TEXT`,
  `ALTER TABLE products ADD COLUMN discount_ends_at TEXT`,
  `ALTER TABLE products ADD COLUMN is_group INTEGER DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN parent_id INTEGER`,
  `ALTER TABLE products ADD COLUMN brand TEXT`,
  `ALTER TABLE products ADD COLUMN client_request_id TEXT`,

  // customers
  `ALTER TABLE customers ADD COLUMN membership_number TEXT`,

  // sales — columns required by routes/sales.js INSERT
  `ALTER TABLE sales ADD COLUMN payment_currency TEXT DEFAULT 'USD'`,
  `ALTER TABLE sales ADD COLUMN device_name TEXT`,
  `ALTER TABLE sales ADD COLUMN device_tz TEXT`,
  `ALTER TABLE sales ADD COLUMN sale_status TEXT DEFAULT 'completed'`,
  `ALTER TABLE sales ADD COLUMN customer_id INTEGER`,
  `ALTER TABLE sales ADD COLUMN membership_discount_usd REAL DEFAULT 0`,
  `ALTER TABLE sales ADD COLUMN membership_discount_khr REAL DEFAULT 0`,
  `ALTER TABLE sales ADD COLUMN membership_points_redeemed REAL DEFAULT 0`,
  `ALTER TABLE sales ADD COLUMN client_request_id TEXT`,

  // sale_items — columns required by routes/sales.js INSERT and inventory queries
  `ALTER TABLE sale_items ADD COLUMN cost_price_usd REAL DEFAULT 0`,
  `ALTER TABLE sale_items ADD COLUMN cost_price_khr REAL DEFAULT 0`,
  `ALTER TABLE sale_items ADD COLUMN branch_id INTEGER`,
  // old schema used subtotal_usd/subtotal_khr; routes use total_usd/total_khr
  // We keep both for backwards compat with any existing data
  `ALTER TABLE sale_items ADD COLUMN total_usd REAL DEFAULT 0`,
  `ALTER TABLE sale_items ADD COLUMN total_khr REAL DEFAULT 0`,
  `ALTER TABLE sale_items ADD COLUMN price_mode TEXT DEFAULT 'selling'`,
  `ALTER TABLE sale_items ADD COLUMN product_discount_type TEXT`,
  `ALTER TABLE sale_items ADD COLUMN product_discount_label TEXT`,
  `ALTER TABLE sale_items ADD COLUMN product_discount_usd REAL DEFAULT 0`,
  `ALTER TABLE sale_items ADD COLUMN product_discount_khr REAL DEFAULT 0`,
  `ALTER TABLE branches ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))`,
  `ALTER TABLE customers ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))`,
  `ALTER TABLE suppliers ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))`,
  `ALTER TABLE delivery_contacts ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))`,

  // inventory_movements — columns required by routes/inventory.js and routes/sales.js
  `ALTER TABLE inventory_movements ADD COLUMN unit_cost_usd REAL DEFAULT 0`,
  `ALTER TABLE inventory_movements ADD COLUMN unit_cost_khr REAL DEFAULT 0`,
  `ALTER TABLE inventory_movements ADD COLUMN total_cost_usd REAL DEFAULT 0`,
  `ALTER TABLE inventory_movements ADD COLUMN total_cost_khr REAL DEFAULT 0`,
  `ALTER TABLE inventory_movements ADD COLUMN reason TEXT`,
  `ALTER TABLE inventory_movements ADD COLUMN reference_id INTEGER`,

  // file_assets
  `ALTER TABLE file_assets ADD COLUMN source TEXT DEFAULT 'upload'`,
  `ALTER TABLE file_assets ADD COLUMN created_by_id INTEGER`,
  `ALTER TABLE file_assets ADD COLUMN created_by_name TEXT`,
  `ALTER TABLE file_assets ADD COLUMN width INTEGER`,
  `ALTER TABLE file_assets ADD COLUMN height INTEGER`,
  `ALTER TABLE file_assets ADD COLUMN original_byte_size INTEGER`,
  `ALTER TABLE file_assets ADD COLUMN optimized_byte_size INTEGER`,
  `ALTER TABLE file_assets ADD COLUMN optimization_status TEXT DEFAULT 'not_optimized'`,
  `ALTER TABLE file_assets ADD COLUMN optimization_note TEXT`,
  `ALTER TABLE file_assets ADD COLUMN duration_seconds REAL`,
  `ALTER TABLE file_assets ADD COLUMN updated_at TEXT`,

  // ai provider configs
  `ALTER TABLE ai_provider_configs ADD COLUMN priority INTEGER DEFAULT 50`,
  `ALTER TABLE ai_provider_configs ADD COLUMN requests_per_minute INTEGER DEFAULT 10`,
  `ALTER TABLE ai_provider_configs ADD COLUMN max_input_chars INTEGER DEFAULT 1000`,
  `ALTER TABLE ai_provider_configs ADD COLUMN max_completion_tokens INTEGER DEFAULT 1200`,
  `ALTER TABLE ai_provider_configs ADD COLUMN timeout_ms INTEGER DEFAULT 15000`,
  `ALTER TABLE ai_provider_configs ADD COLUMN cooldown_seconds INTEGER DEFAULT 20`,

  // returns — columns required by routes/returns.js INSERT
  `ALTER TABLE returns ADD COLUMN customer_name TEXT`,
  `ALTER TABLE returns ADD COLUMN branch_id INTEGER`,
  `ALTER TABLE returns ADD COLUMN branch_name TEXT`,
  `ALTER TABLE returns ADD COLUMN return_type TEXT DEFAULT 'restock'`,
  `ALTER TABLE returns ADD COLUMN total_refund_usd REAL DEFAULT 0`,
  `ALTER TABLE returns ADD COLUMN total_refund_khr REAL DEFAULT 0`,
  `ALTER TABLE returns ADD COLUMN exchange_rate REAL DEFAULT 4100`,
  `ALTER TABLE returns ADD COLUMN return_scope TEXT DEFAULT 'customer'`,
  `ALTER TABLE returns ADD COLUMN device_name TEXT`,
  `ALTER TABLE returns ADD COLUMN device_tz TEXT`,
  `ALTER TABLE returns ADD COLUMN customer_id INTEGER`,
  `ALTER TABLE returns ADD COLUMN supplier_id INTEGER`,
  `ALTER TABLE returns ADD COLUMN supplier_name TEXT`,
  `ALTER TABLE returns ADD COLUMN supplier_settlement TEXT DEFAULT 'none'`,
  `ALTER TABLE returns ADD COLUMN supplier_compensation_usd REAL DEFAULT 0`,
  `ALTER TABLE returns ADD COLUMN supplier_compensation_khr REAL DEFAULT 0`,
  `ALTER TABLE returns ADD COLUMN supplier_loss_usd REAL DEFAULT 0`,
  `ALTER TABLE returns ADD COLUMN supplier_loss_khr REAL DEFAULT 0`,
  `ALTER TABLE returns ADD COLUMN client_request_id TEXT`,

  // audit_logs
  `ALTER TABLE audit_logs ADD COLUMN old_value TEXT`,
]
for (const sql of migrations) {
  try { db.exec(sql) } catch (_) { /* column already exists — skip */ }
}

// ── Default seed data ─────────────────────────────────────────────────────────
try {
  db.exec(`
    UPDATE users
    SET email_verified = CASE
      WHEN COALESCE(trim(email), '') != '' AND COALESCE(email_verified, 0) = 0 THEN 1
      ELSE COALESCE(email_verified, 0)
    END
  `)
} catch (_) {}

try {
  db.exec(`
    UPDATE users
    SET phone_verified = 0
    WHERE COALESCE(phone_verified, 0) != 0
  `)
} catch (_) {}

function tableHasColumn(tableName, columnName) {
  try {
    const safeTable = String(tableName || '').replace(/"/g, '""')
    const columns = db.prepare(`PRAGMA table_info("${safeTable}")`).all()
    return columns.some((column) => String(column.name).toLowerCase() === String(columnName).toLowerCase())
  } catch (_) {
    return false
  }
}

function ensureColumn(tableName, columnName, sqlType = 'TEXT') {
  if (tableHasColumn(tableName, columnName)) return true
  try {
    const safeTable = String(tableName || '').replace(/"/g, '""')
    const safeColumn = String(columnName || '').replace(/"/g, '""')
    db.exec(`ALTER TABLE "${safeTable}" ADD COLUMN "${safeColumn}" ${sqlType}`)
    return true
  } catch (_) {
    const normalizedType = String(sqlType || '').trim()
    const defaultExpressionMatch = normalizedType.match(/^(.*)\s+DEFAULT\s+\(datetime\('now'\)\)\s*$/i)
    if (defaultExpressionMatch) {
      try {
        const safeTable = String(tableName || '').replace(/"/g, '""')
        const safeColumn = String(columnName || '').replace(/"/g, '""')
        db.exec(`ALTER TABLE "${safeTable}" ADD COLUMN "${safeColumn}" ${defaultExpressionMatch[1].trim()}`)
      } catch (_) {}
    }
    return tableHasColumn(tableName, columnName)
  }
}

function normalizeUserPhoneLookup(value) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length >= 6 && digits.length <= 20 ? digits : ''
}

function slugifyOrgName(value, fallback = 'organization') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}

function generateOrgPublicId() {
  return `org_${crypto.randomBytes(8).toString('hex')}`
}

if (ensureColumn('customers', 'membership_number', 'TEXT')) {
  try {
    db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_membership_number
    ON customers(lower(trim(membership_number)))
    WHERE membership_number IS NOT NULL AND trim(membership_number) != '';
    `)
  } catch (_) {
    // Never crash startup on index creation for legacy/corrupt customer schemas.
  }
}

;['categories', 'units', 'custom_tables'].forEach((tableName) => {
  if (ensureColumn(tableName, 'updated_at', 'TEXT')) {
    try {
      db.exec(`
        UPDATE "${tableName}"
        SET updated_at = COALESCE(updated_at, created_at, datetime('now'))
        WHERE updated_at IS NULL OR trim(updated_at) = ''
      `)
    } catch (_) {}
  }
})

;['users', 'roles', 'branches', 'customers', 'suppliers', 'delivery_contacts', 'sales', 'returns'].forEach((tableName) => {
  if (ensureColumn(tableName, 'updated_at', 'TEXT DEFAULT (datetime(\'now\'))')) {
    try {
      db.exec(`
        UPDATE "${tableName}"
        SET updated_at = COALESCE(updated_at, created_at, datetime('now'))
        WHERE updated_at IS NULL OR trim(updated_at) = ''
      `)
    } catch (_) {}
  }
})

if (ensureColumn('settings', 'updated_at', 'TEXT DEFAULT (datetime(\'now\'))')) {
  try {
    db.exec(`
      UPDATE settings
      SET updated_at = COALESCE(updated_at, datetime('now'))
      WHERE updated_at IS NULL OR trim(updated_at) = ''
    `)
  } catch (_) {}
}

if (ensureColumn('users', 'phone_lookup', 'TEXT')) {
  try {
    const rows = db.prepare('SELECT id, phone FROM users').all()
    const updatePhoneLookup = db.prepare('UPDATE users SET phone_lookup = ? WHERE id = ?')
    const backfill = db.transaction((items) => {
      items.forEach((row) => {
        const phoneLookup = normalizeUserPhoneLookup(row.phone)
        updatePhoneLookup.run(phoneLookup || null, row.id)
      })
    })
    backfill(rows)
  } catch (_) {}
}

try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lookup
    ON users(lower(trim(username)))
    WHERE username IS NOT NULL AND trim(username) != '';
  `)
} catch (_) {}

try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_name_lookup
    ON users(lower(trim(name)))
    WHERE name IS NOT NULL AND trim(name) != '';
  `)
} catch (_) {}

try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lookup
    ON users(lower(trim(email)))
    WHERE email IS NOT NULL AND trim(email) != '';
  `)
} catch (_) {}

try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_lookup
    ON users(phone_lookup)
    WHERE phone_lookup IS NOT NULL AND trim(phone_lookup) != '';
  `)
} catch (_) {}

if (ensureColumn('users', 'firebase_user_id', 'TEXT')) {
  try {
    db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_user_id
    ON users(firebase_user_id)
    WHERE firebase_user_id IS NOT NULL AND trim(firebase_user_id) != '';
    `)
  } catch (_) {}
}

if (ensureColumn('users', 'supabase_user_id', 'TEXT')) {
  try {
    db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_supabase_user_id
    ON users(supabase_user_id)
    WHERE supabase_user_id IS NOT NULL AND trim(supabase_user_id) != '';
    `)
  } catch (_) {}
}

if (ensureColumn('roles', 'code', 'TEXT')) {
  try {
    db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_code
    ON roles(lower(trim(code)))
    WHERE code IS NOT NULL AND trim(code) != '';
    `)
  } catch (_) {}
}

ensureColumn('roles', 'is_system', 'INTEGER DEFAULT 0')
ensureColumn('units', 'color', "TEXT DEFAULT '#6366f1'")

function seedIfEmpty(table, rows, insertFn) {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()
  if (n === 0) rows.forEach(insertFn)
}

seedIfEmpty('users', [
  { username: 'admin', name: 'Administrator', password: bcrypt.hashSync('admin', 10), permissions: JSON.stringify({ all: true }) },
], (u) => {
  db.prepare(`INSERT OR IGNORE INTO users (username, name, password, permissions) VALUES (?,?,?,?)`).run(u.username, u.name, u.password, u.permissions)
})

function ensureDefaultOrganizationAndGroup() {
  const defaultName = DEFAULT_ORGANIZATION_BOOTSTRAP.name
  const defaultSlug = DEFAULT_ORGANIZATION_BOOTSTRAP.slug
  const defaultPublicId = DEFAULT_ORGANIZATION_BOOTSTRAP.publicId

  let organization = db.prepare(`
    SELECT id, name, slug, public_id
    FROM organizations
    ORDER BY id ASC
    LIMIT 1
  `).get()

  if (!organization) {
    const inserted = db.prepare(`
      INSERT INTO organizations (name, slug, public_id, is_active, setup_enabled)
      VALUES (?, ?, ?, 1, 0)
    `).run(defaultName, defaultSlug, defaultPublicId || generateOrgPublicId())
    organization = {
      id: Number(inserted.lastInsertRowid),
      name: defaultName,
      slug: defaultSlug,
      public_id: '',
    }
  } else {
    const nextName = String(organization.name || '').trim() || defaultName
    const nextSlug = slugifyOrgName(organization.slug || organization.name || defaultSlug, defaultSlug)
    const nextPublicId = String(organization.public_id || '').trim() || defaultPublicId || generateOrgPublicId()
    db.prepare(`
      UPDATE organizations
      SET name = ?, slug = ?, public_id = ?, is_active = 1, setup_enabled = 0
      WHERE id = ?
    `).run(nextName, nextSlug, nextPublicId, organization.id)
    organization = {
      id: organization.id,
      name: nextName,
      slug: nextSlug,
      public_id: nextPublicId,
    }
  }

  let group = db.prepare(`
    SELECT id
    FROM organization_groups
    WHERE organization_id = ?
    ORDER BY is_default DESC, id ASC
    LIMIT 1
  `).get(organization.id)

  if (!group) {
    const insertedGroup = db.prepare(`
      INSERT INTO organization_groups (organization_id, name, slug, is_default, is_active)
      VALUES (?, 'Main Group', 'main', 1, 1)
    `).run(organization.id)
    group = { id: Number(insertedGroup.lastInsertRowid) }
  } else {
    db.prepare(`
      UPDATE organization_groups
      SET is_default = 1, is_active = 1
      WHERE id = ?
    `).run(group.id)
  }

  db.prepare(`
    UPDATE users
    SET organization_id = COALESCE(organization_id, ?),
        organization_group_id = COALESCE(organization_group_id, ?)
    WHERE organization_id IS NULL OR organization_group_id IS NULL
  `).run(organization.id, group.id)

  return { organization, group }
}

function ensurePrimaryAdminRoleAndUser() {
  // Guarantees:
  // 1) A system Admin role exists and keeps full permissions.
  // 2) Primary admin user exists, active, undeleted, and bound to Admin role.
  // 3) Startup/migration can self-heal auth-critical defaults.
  const adminPermissions = JSON.stringify({ all: true })

  let adminRole = db.prepare(`SELECT id FROM roles WHERE lower(trim(code)) = 'admin' LIMIT 1`).get()
  if (!adminRole) {
    adminRole = db.prepare(`SELECT id FROM roles WHERE lower(trim(name)) = 'admin' LIMIT 1`).get()
    if (adminRole) {
      db.prepare(`
        UPDATE roles
        SET name = 'Admin', code = 'admin', is_system = 1, permissions = ?
        WHERE id = ?
      `).run(adminPermissions, adminRole.id)
    } else {
      const inserted = db.prepare(`
        INSERT INTO roles (name, code, is_system, permissions)
        VALUES ('Admin', 'admin', 1, ?)
      `).run(adminPermissions)
      adminRole = { id: Number(inserted.lastInsertRowid) }
    }
  } else {
    db.prepare(`
      UPDATE roles
      SET name = 'Admin', code = 'admin', is_system = 1, permissions = ?
      WHERE id = ?
    `).run(adminPermissions, adminRole.id)
  }

  let primaryAdmin = db.prepare(`SELECT id, password, created_at FROM users WHERE username = 'admin' ORDER BY id LIMIT 1`).get()
  if (!primaryAdmin) {
    const insertedAdmin = db.prepare(`
      INSERT INTO users (username, name, password, permissions, role_id, is_active, deleted_at)
      VALUES ('admin', 'Administrator', ?, ?, ?, 1, NULL)
    `).run(bcrypt.hashSync('admin', 10), adminPermissions, adminRole.id)
    primaryAdmin = {
      id: Number(insertedAdmin.lastInsertRowid),
      password: '',
      created_at: new Date().toISOString(),
    }
  }

  db.prepare(`
    UPDATE users
    SET role_id = ?, permissions = ?, is_active = 1, deleted_at = NULL
    WHERE id = ?
  `).run(adminRole.id, adminPermissions, primaryAdmin.id)
}

function buildDefaultSettingsSeed(defaultOrganizationContext = null) {
  return [
  { key: 'business_name',    value: 'My Business' },
  { key: 'business_phone',   value: '' },
  { key: 'business_address', value: '' },
  { key: 'business_email',   value: '' },
  { key: 'exchange_rate',    value: '4100' },
  { key: 'tax_rate',         value: '0' },
  { key: 'display_currency', value: 'USD' },
  { key: 'language',         value: 'en' },
  { key: 'theme',            value: 'light' },
  { key: 'customer_portal_title', value: 'Customer Portal' },
  { key: 'customer_portal_intro', value: 'Browse products and check membership details.' },
  { key: 'customer_portal_show_about', value: 'true' },
  { key: 'customer_portal_about_title', value: 'About us' },
  { key: 'customer_portal_about_content', value: '' },
  { key: 'customer_portal_about_blocks', value: '[]' },
  { key: 'customer_portal_hero_gradient_start', value: '#0f172a' },
  { key: 'customer_portal_hero_gradient_mid', value: '#14532d' },
  { key: 'customer_portal_hero_gradient_end', value: '#ea580c' },
  { key: 'customer_portal_path', value: defaultOrganizationContext?.organization?.slug ? `/${defaultOrganizationContext.organization.slug}/public` : '/leangcosmetics/public' },
  { key: 'customer_portal_public_url', value: '' },
  { key: 'customer_portal_language', value: 'auto' },
  { key: 'customer_portal_translate_widget_enabled', value: 'false' },
  { key: 'customer_portal_show_catalog', value: 'true' },
  { key: 'customer_portal_show_membership', value: 'true' },
  { key: 'customer_portal_show_prices', value: 'true' },
  { key: 'customer_portal_show_out_of_stock_products', value: 'true' },
  { key: 'customer_portal_price_display', value: 'USD' },
  { key: 'customer_portal_show_top_seller_badge', value: 'true' },
  { key: 'customer_portal_show_top_product_badge', value: 'true' },
  { key: 'customer_portal_show_recommended_badge', value: 'true' },
  { key: 'customer_portal_show_promotion_badge', value: 'true' },
  { key: 'customer_portal_show_new_arrival_badge', value: 'false' },
  { key: 'customer_portal_highlight_rank_limit', value: '3' },
  { key: 'customer_portal_recommended_product_ids', value: '[]' },
  { key: 'customer_portal_refresh_seconds', value: '20' },
  { key: 'customer_portal_stock_threshold_mode', value: 'product' },
  { key: 'customer_portal_low_stock_threshold', value: '10' },
  { key: 'customer_portal_out_of_stock_threshold', value: '0' },
  { key: 'customer_portal_grid_columns_mobile', value: '1' },
  { key: 'customer_portal_grid_columns_desktop', value: '4' },
  { key: 'customer_portal_points_basis', value: 'usd' },
  { key: 'customer_portal_points_per_usd', value: '1' },
  { key: 'customer_portal_points_per_khr', value: '0' },
  { key: 'customer_portal_redeem_points', value: '100' },
  { key: 'customer_portal_redeem_value_usd', value: '1' },
  { key: 'customer_portal_redeem_value_khr', value: '4100' },
  { key: 'customer_portal_show_point_value', value: 'true' },
  { key: 'customer_portal_membership_info_text', value: 'Membership points are reviewed and applied by staff during checkout. Redemption uses whole units only.' },
  { key: 'customer_portal_submission_enabled', value: 'true' },
  { key: 'customer_portal_submission_reward_points', value: '5' },
  { key: 'customer_portal_submission_instructions', value: 'Share the business on social media, then upload screenshots here for staff review.' },
  { key: 'customer_portal_business_tagline', value: '' },
  { key: 'customer_portal_logo_image', value: '' },
  { key: 'customer_portal_logo_size', value: '80' },
  { key: 'customer_portal_logo_fit', value: 'contain' },
  { key: 'customer_portal_cover_image', value: '' },
  { key: 'customer_portal_show_logo', value: 'true' },
  { key: 'customer_portal_show_cover', value: 'true' },
  { key: 'customer_portal_show_phone', value: 'true' },
  { key: 'customer_portal_show_email', value: 'true' },
  { key: 'customer_portal_show_address', value: 'true' },
  { key: 'customer_portal_google_maps_embed', value: '' },
  { key: 'customer_portal_show_google_map', value: 'true' },
  { key: 'customer_portal_show_website', value: 'true' },
  { key: 'customer_portal_show_facebook', value: 'true' },
  { key: 'customer_portal_show_instagram', value: 'true' },
  { key: 'customer_portal_show_telegram', value: 'true' },
  { key: 'customer_portal_website', value: '' },
  { key: 'customer_portal_facebook', value: '' },
  { key: 'customer_portal_instagram', value: '' },
  { key: 'customer_portal_telegram', value: '' },
  { key: 'customer_portal_website_label', value: 'Website' },
  { key: 'customer_portal_facebook_label', value: 'Facebook' },
  { key: 'customer_portal_instagram_label', value: 'Instagram' },
  { key: 'customer_portal_telegram_label', value: 'Telegram' },
  ]
}

const SUPPLEMENTAL_SETTINGS_DEFAULTS = [
  ['customer_portal_show_logo', 'true'],
  ['customer_portal_logo_size', '80'],
  ['customer_portal_logo_fit', 'contain'],
  ['customer_portal_show_cover', 'true'],
  ['customer_portal_show_phone', 'true'],
  ['customer_portal_show_email', 'true'],
  ['customer_portal_show_address', 'true'],
  ['customer_portal_google_maps_embed', ''],
  ['customer_portal_show_google_map', 'true'],
  ['customer_portal_show_about', 'true'],
  ['customer_portal_about_title', 'About us'],
  ['customer_portal_about_content', ''],
  ['customer_portal_about_blocks', '[]'],
  ['customer_portal_ai_enabled', 'true'],
  ['customer_portal_ai_title', 'Beauty Assistant'],
  ['customer_portal_ai_intro', 'Tell us what you are shopping for and the assistant will suggest products from Leang Cosmetics.'],
  ['customer_portal_ai_disclaimer', 'AI generated, for reference only. For more accurate inquiries, please contact our store on Instagram or Facebook.'],
  ['customer_portal_ai_provider_id', ''],
  ['customer_portal_ai_prompt', ''],
  ['customer_portal_show_faq', 'true'],
  ['customer_portal_faq_title', 'Frequently asked questions'],
  ['customer_portal_faq_items', '[]'],
  ['customer_portal_hero_gradient_start', '#0f172a'],
  ['customer_portal_hero_gradient_mid', '#14532d'],
  ['customer_portal_hero_gradient_end', '#ea580c'],
  ['customer_portal_show_website', 'true'],
  ['customer_portal_show_facebook', 'true'],
  ['customer_portal_show_instagram', 'true'],
  ['customer_portal_show_telegram', 'true'],
  ['customer_portal_website_label', 'Website'],
  ['customer_portal_facebook_label', 'Facebook'],
  ['customer_portal_instagram_label', 'Instagram'],
  ['customer_portal_telegram_label', 'Telegram'],
]

const DEFAULT_BRANCH_SEED = [
  { name: 'Main Store', is_default: 1 },
]

const DEFAULT_UNIT_SEED = [
  { name: 'pcs', color: '#6366f1' },
  { name: 'kg', color: '#8b5cf6' },
  { name: 'g', color: '#a855f7' },
  { name: 'L', color: '#06b6d4' },
  { name: 'mL', color: '#0ea5e9' },
  { name: 'box', color: '#f59e0b' },
  { name: 'bag', color: '#10b981' },
]

function ensureDefaultSettings(defaultOrganizationContext = null) {
  seedIfEmpty('settings', buildDefaultSettingsSeed(defaultOrganizationContext), (setting) => {
    db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`).run(setting.key, setting.value)
  })
  SUPPLEMENTAL_SETTINGS_DEFAULTS.forEach(([key, value]) => {
    try {
      db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`).run(key, value)
    } catch (_) {}
  })
}

function ensureDefaultBranches() {
  seedIfEmpty('branches', DEFAULT_BRANCH_SEED, (branch) => {
    db.prepare(`INSERT OR IGNORE INTO branches (name, is_default) VALUES (?, ?)`).run(branch.name, branch.is_default)
  })
}

function ensureDefaultUnits() {
  seedIfEmpty('units', DEFAULT_UNIT_SEED, (unit) => {
    db.prepare(`INSERT OR IGNORE INTO units (name, color) VALUES (?, ?)`).run(unit.name, unit.color || '#6366f1')
  })
}

function ensureCoreDataInvariants(options = {}) {
  const repairUploads = options.repairUploads !== false
  ensurePrimaryAdminRoleAndUser()
  const organizationContext = ensureDefaultOrganizationAndGroup()
  ensureDefaultSettings(organizationContext)
  ensureDefaultBranches()
  ensureDefaultUnits()
  if (repairUploads) repairMissingUploadReferences(db)
  return organizationContext
}

let defaultOrganizationContext = null
try { defaultOrganizationContext = ensureCoreDataInvariants() } catch (_) {}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_product_images_product_sort
    ON product_images(product_id, sort_order, id)
  `)
} catch (_) {}

try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_client_request_id
    ON products(client_request_id)
    WHERE client_request_id IS NOT NULL AND trim(client_request_id) != ''
  `)
} catch (_) {}

try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_request_id
    ON sales(client_request_id)
    WHERE client_request_id IS NOT NULL AND trim(client_request_id) != ''
  `)
} catch (_) {}

try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_returns_client_request_id
    ON returns(client_request_id)
    WHERE client_request_id IS NOT NULL AND trim(client_request_id) != ''
  `)
} catch (_) {}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sales_created_at
    ON sales(created_at DESC, id DESC)
  `)
} catch (_) {}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sales_status_created_at
    ON sales(sale_status, created_at DESC, id DESC)
  `)
} catch (_) {}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale_product_branch
    ON sale_items(sale_id, product_id, branch_id)
  `)
} catch (_) {}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_returns_sale_created_at
    ON returns(sale_id, created_at DESC, id DESC)
  `)
} catch (_) {}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_return_items_return_product
    ON return_items(return_id, product_id)
  `)
} catch (_) {}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_branch_created_at
    ON inventory_movements(branch_id, created_at DESC, id DESC)
  `)
} catch (_) {}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_created_at
    ON inventory_movements(product_id, created_at DESC, id DESC)
  `)
} catch (_) {}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_file_assets_created_at
    ON file_assets(created_at DESC, id DESC)
  `)
} catch (_) {}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_file_assets_media_type
    ON file_assets(media_type)
  `)
} catch (_) {}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ai_provider_configs_enabled
    ON ai_provider_configs(enabled, provider, updated_at DESC)
  `)
} catch (_) {}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ai_response_logs_created_at
    ON ai_response_logs(created_at DESC, id DESC)
  `)
} catch (_) {}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ai_response_logs_surface
    ON ai_response_logs(surface, created_at DESC)
  `)
} catch (_) {}

module.exports = {
  db,
  ensureCoreDataInvariants,
  ensureDefaultOrganizationAndGroup,
  ensurePrimaryAdminRoleAndUser,
}
