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
const Database = require('better-sqlite3')
const bcrypt   = require('bcryptjs')
const { DB_PATH } = require('./config')
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
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  phone       TEXT,
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
  created_at  TEXT DEFAULT (datetime('now'))
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
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT DEFAULT '#6366f1',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS units (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
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
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  name                    TEXT NOT NULL,
  sku                     TEXT,
  barcode                 TEXT,
  category                TEXT,
  brand                   TEXT,
  unit                    TEXT DEFAULT 'pcs',
  description             TEXT,
  selling_price_usd       REAL DEFAULT 0,
  selling_price_khr       REAL DEFAULT 0,
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
  created_at TEXT DEFAULT (datetime('now'))
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
  created_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS delivery_contacts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT,
  area       TEXT,
  address    TEXT,
  notes      TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ─── SALES ────────────────────────────────────────────────────────────────────
-- payment_currency, device_tz, device_name are REQUIRED by routes/sales.js
CREATE TABLE IF NOT EXISTS sales (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_number           TEXT UNIQUE,
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
  created_at               TEXT DEFAULT (datetime('now'))
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

-- ─── RETURNS ──────────────────────────────────────────────────────────────────
-- customer_name, branch_id, branch_name, return_type, total_refund_usd,
-- total_refund_khr, exchange_rate, device_name, device_tz are REQUIRED by routes/returns.js.
CREATE TABLE IF NOT EXISTS returns (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  return_number    TEXT UNIQUE,
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
  created_at       TEXT DEFAULT (datetime('now'))
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
  created_at TEXT DEFAULT (datetime('now'))
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
  width           INTEGER,
  height          INTEGER,
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
`)


// ── Migrations — add columns to EXISTING databases ────────────────────────────
// Each ALTER TABLE is wrapped in try/catch — SQLite throws if the column exists.
// This lets us safely run this list on every server start without data loss.
const migrations = [
  // users
  `ALTER TABLE users ADD COLUMN phone TEXT`,
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
  `ALTER TABLE products ADD COLUMN parent_id INTEGER`,
  `ALTER TABLE products ADD COLUMN brand TEXT`,

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

  // sale_items — columns required by routes/sales.js INSERT and inventory queries
  `ALTER TABLE sale_items ADD COLUMN cost_price_usd REAL DEFAULT 0`,
  `ALTER TABLE sale_items ADD COLUMN cost_price_khr REAL DEFAULT 0`,
  `ALTER TABLE sale_items ADD COLUMN branch_id INTEGER`,
  // old schema used subtotal_usd/subtotal_khr; routes use total_usd/total_khr
  // We keep both for backwards compat with any existing data
  `ALTER TABLE sale_items ADD COLUMN total_usd REAL DEFAULT 0`,
  `ALTER TABLE sale_items ADD COLUMN total_khr REAL DEFAULT 0`,

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
    return tableHasColumn(tableName, columnName)
  }
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

function seedIfEmpty(table, rows, insertFn) {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()
  if (n === 0) rows.forEach(insertFn)
}

seedIfEmpty('users', [
  { username: 'admin', name: 'Administrator', password: bcrypt.hashSync('admin', 10), permissions: JSON.stringify({ all: true }) },
], (u) => {
  db.prepare(`INSERT OR IGNORE INTO users (username, name, password, permissions) VALUES (?,?,?,?)`).run(u.username, u.name, u.password, u.permissions)
})

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

try { ensurePrimaryAdminRoleAndUser() } catch (_) {}

seedIfEmpty('settings', [
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
  { key: 'customer_portal_path', value: '/customer-portal' },
  { key: 'customer_portal_public_url', value: '' },
  { key: 'customer_portal_language', value: 'auto' },
  { key: 'customer_portal_translate_widget_enabled', value: 'false' },
  { key: 'customer_portal_show_catalog', value: 'true' },
  { key: 'customer_portal_show_membership', value: 'true' },
  { key: 'customer_portal_show_prices', value: 'true' },
  { key: 'customer_portal_price_display', value: 'USD' },
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
], (s) => {
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)`).run(s.key, s.value)
})

;[
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
].forEach(([key, value]) => {
  try {
    db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`).run(key, value)
  } catch (_) {}
})

seedIfEmpty('branches', [
  { name: 'Main Store', is_default: 1 },
], (b) => {
  db.prepare(`INSERT OR IGNORE INTO branches (name, is_default) VALUES (?,?)`).run(b.name, b.is_default)
})

seedIfEmpty('units', [
  { name: 'pcs' }, { name: 'kg' }, { name: 'g' },
  { name: 'L' }, { name: 'mL' }, { name: 'box' }, { name: 'bag' },
], (u) => {
  db.prepare(`INSERT OR IGNORE INTO units (name) VALUES (?)`).run(u.name)
})

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_product_images_product_sort
    ON product_images(product_id, sort_order, id)
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

module.exports = { db }
