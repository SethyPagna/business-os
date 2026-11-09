-- 0293 online orders (KHQR lane, slice S2: expand step; schema only).
-- The storefront's paid-online order and everything that happens to it, in four tables, plus the one column that lets a
-- customer refund leave through ABA instead of the cash drawer.
--   online_orders          one row per order. The state is stored only up to fulfilment (awaiting_payment, qr_failed,
--                          paid, review, expired, cancelled, fulfilled); what happens after the sale is read from the
--                          sale and its returns, never copied here. sale_id is the only link, and a UNIQUE index keeps it
--                          one order to one sale. state='fulfilled' and sale_id IS NOT NULL always travel together.
--   online_order_payments  one row per PayWay transaction (the order's own, or a top-up for a change request).
--   online_order_requests  a customer's change or return request, insert-only. Pending means no decision event exists, so the
--                          in-app alert (the bell) reads pending requests directly and no copy of the state is kept.
--                          attachments_json holds references to uploaded files (never inline data) for the customer's photos.
--   online_order_events    the order's Records: every transition, decision and outcome. Insert-only. attachments_json holds the
--                          references to images staff attached to a decision.
--   returns.refund_channel NULL = today's reading (the refund leaves the cash drawer); 'drawer' = the same, said
--                          explicitly; 'aba' = refunded in ABA, no drawer effect. Nothing writes it yet.
-- Contact data (name, phone, address, social handles) is personal data: scrubbed_at marks the 90 day scrub of unpaid orders.
-- Append-only like 0271 for requests and events: UPDATE always aborts; DELETE aborts unless the restore maintenance flag
-- is set (a restore deletes then inserts every backed-up table) or the factory reset guard is open (the reset must be able
-- to clear personal data; it opens the same flag the sale record events use).
-- Rowid tables, LF-only. No foreign keys, so the admin data reset is never blocked and a restore may insert in any order.
-- Schema only: no row of any table is inserted, updated or deleted, no Worker code reads or writes these tables yet,
-- so a Worker that predates this file behaves exactly as before.
--
-- PRE:  none of the four tables exists and returns has no refund_channel (CREATE TABLE or ADD COLUMN would fail half
--       way). Record SELECT COUNT(*), ROUND(SUM(total_refund_usd),4), SUM(total_refund_khr) FROM returns.
-- POST: those three values are identical; every returns.refund_channel is NULL; all four tables are empty; the 12 indexes
--       and 4 triggers exist. A failed check reads a malformed JSON path and aborts the file.
-- Pinned by scripts/test-migration-0293-online-orders-native.cjs.
--
-- RECOVERY: roll the Worker back first (it will read these tables), then remove the four tables from BACKUP_TABLES
--   (or a restore aborts on a missing table), from branchCutoverCapture and from FACTORY_RESET_TABLES, then
--   DROP TRIGGER IF EXISTS online_order_requests_append_only_update;
--   DROP TRIGGER IF EXISTS online_order_requests_append_only_delete;
--   DROP TRIGGER IF EXISTS online_order_events_append_only_update;
--   DROP TRIGGER IF EXISTS online_order_events_append_only_delete;
--   (the tables are dropped only while empty: the delete guard refuses otherwise, so set the restore maintenance flag if rows must go)
--   DROP TABLE IF EXISTS online_order_events;
--   DROP TABLE IF EXISTS online_order_requests;
--   DROP TABLE IF EXISTS online_order_payments;
--   DROP TABLE IF EXISTS online_orders;
--   returns.refund_channel stays: NULL is the old reading, and dropping a column of a live money table is the riskier step.

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE name IN ('online_orders','online_order_payments','online_order_requests','online_order_events')) = 0
  AND (SELECT COUNT(*) FROM pragma_table_info('returns') WHERE name = 'refund_channel') = 0
THEN 1 ELSE json_extract('[]','$[online_orders_0293_pre]') END;

CREATE TABLE online_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  client_request_id TEXT UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('awaiting_payment','qr_failed','paid','review','expired','cancelled','fulfilled')),
  fulfilment TEXT NOT NULL CHECK (fulfilment IN ('pickup','delivery')),
  branch_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL CHECK (length(trim(customer_name)) > 0 AND length(customer_name) <= 60),
  customer_phone TEXT NOT NULL CHECK (length(trim(customer_phone)) > 0 AND length(customer_phone) <= 32),
  customer_address TEXT CHECK (customer_address IS NULL OR length(customer_address) <= 300),
  contact_telegram TEXT CHECK (contact_telegram IS NULL OR length(contact_telegram) <= 100),
  contact_instagram TEXT CHECK (contact_instagram IS NULL OR length(contact_instagram) <= 100),
  contact_facebook TEXT CHECK (contact_facebook IS NULL OR length(contact_facebook) <= 100),
  contact_tiktok TEXT CHECK (contact_tiktok IS NULL OR length(contact_tiktok) <= 100),
  contact_whatsapp TEXT CHECK (contact_whatsapp IS NULL OR length(contact_whatsapp) <= 100),
  contact_other TEXT CHECK (contact_other IS NULL OR length(contact_other) <= 100),
  note TEXT CHECK (note IS NULL OR length(note) <= 300),
  portal_account_id INTEGER,
  currency TEXT NOT NULL CHECK (currency IN ('USD','KHR')),
  goods_total_usd REAL NOT NULL CHECK (goods_total_usd > 0),
  goods_total_khr INTEGER CHECK (goods_total_khr IS NULL OR goods_total_khr >= 0),
  exchange_rate REAL CHECK (exchange_rate IS NULL OR exchange_rate > 0),
  items_json TEXT NOT NULL CHECK (json_valid(items_json) AND json_type(items_json) = 'array'),
  pricing_version INTEGER NOT NULL,
  sale_id INTEGER,
  paid_at TEXT,
  network_key TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  scrubbed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  CHECK (fulfilment = 'pickup' OR length(trim(COALESCE(customer_address, ''))) > 0),
  CHECK ((state = 'fulfilled') = (sale_id IS NOT NULL))
);
CREATE INDEX idx_online_orders_created ON online_orders (created_at, id);
CREATE UNIQUE INDEX idx_online_orders_sale ON online_orders (sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX idx_online_orders_attention ON online_orders (state, created_at) WHERE state IN ('paid','review');

CREATE TABLE online_order_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  tran_id TEXT NOT NULL UNIQUE CHECK (length(tran_id) <= 20),
  purpose TEXT NOT NULL CHECK (purpose IN ('order','top_up')),
  request_id INTEGER,
  amount REAL NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency IN ('USD','KHR')),
  state TEXT NOT NULL DEFAULT 'awaiting' CHECK (state IN ('awaiting','paid','expired','cancelled','review','failed')),
  qr_string TEXT,
  deeplink TEXT,
  expires_at TEXT,
  last_checked_at TEXT,
  paid_at TEXT,
  paid_amount REAL,
  paid_currency TEXT,
  payway_apv TEXT,
  payway_bank_ref TEXT,
  payway_payment_type TEXT,
  payway_bank_name TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  CHECK (purpose = 'order' OR request_id IS NOT NULL),
  CHECK (state <> 'paid' OR (paid_at IS NOT NULL AND paid_amount IS NOT NULL))
);
CREATE INDEX idx_online_order_payments_order ON online_order_payments (order_id, id);
CREATE INDEX idx_online_order_payments_open ON online_order_payments (expires_at) WHERE state = 'awaiting';

CREATE TABLE online_order_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('items','fulfilment','address','contact','note','cancel','return')),
  stage TEXT NOT NULL CHECK (stage IN ('paid','after_sale')),
  before_json TEXT NOT NULL CHECK (json_valid(before_json)),
  after_json TEXT NOT NULL CHECK (json_valid(after_json)),
  customer_comment TEXT CHECK (customer_comment IS NULL OR length(customer_comment) <= 300),
  attachments_json TEXT CHECK (attachments_json IS NULL OR (json_valid(attachments_json) AND json_type(attachments_json) = 'array' AND length(attachments_json) <= 4000)),
  network_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_online_order_requests_order ON online_order_requests (order_id, id);
CREATE INDEX idx_online_order_requests_created ON online_order_requests (created_at, id);

CREATE TABLE online_order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  payment_id INTEGER,
  request_id INTEGER,
  event TEXT NOT NULL CHECK (event IN ('created','edited','qr_issued','qr_failed','callback','verified_paid','late_paid','mismatch','expired',
    'cancelled','resolved','fulfilled','payment_recorded_on_sale','refund_noted','request_submitted','request_withdrawn','request_accepted',
    'request_rejected','request_applied','order_edited','note','scrubbed')),
  from_state TEXT,
  to_state TEXT,
  source TEXT NOT NULL CHECK (source IN ('customer','payway','sweep','staff')),
  actor_id INTEGER,
  actor_name TEXT,
  public_comment TEXT CHECK (public_comment IS NULL OR length(public_comment) <= 300),
  internal_note TEXT CHECK (internal_note IS NULL OR length(internal_note) <= 500),
  amount_usd REAL,
  amount_khr REAL,
  reference TEXT CHECK (reference IS NULL OR length(reference) <= 60),
  attachments_json TEXT CHECK (attachments_json IS NULL OR (json_valid(attachments_json) AND json_type(attachments_json) = 'array' AND length(attachments_json) <= 4000)),
  sale_id INTEGER,
  return_id INTEGER,
  amendment_group_id TEXT,
  action_history_id INTEGER,
  detail_json TEXT CHECK (detail_json IS NULL OR json_valid(detail_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_online_order_events_order ON online_order_events (order_id, id);
CREATE INDEX idx_online_order_events_request ON online_order_events (request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX idx_online_order_events_recorded ON online_order_events (payment_id) WHERE event = 'payment_recorded_on_sale';
CREATE UNIQUE INDEX idx_online_order_events_decision ON online_order_events (request_id) WHERE event IN ('request_accepted','request_rejected','request_withdrawn');
CREATE UNIQUE INDEX idx_online_order_events_applied ON online_order_events (request_id) WHERE event = 'request_applied';

CREATE TRIGGER online_order_requests_append_only_update
BEFORE UPDATE ON online_order_requests
BEGIN
  SELECT RAISE(ABORT, 'online_order_requests is append-only: a decision is a new event, never a rewrite of the request');
END;

CREATE TRIGGER online_order_requests_append_only_delete
BEFORE DELETE ON online_order_requests
WHEN NOT EXISTS (
  SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore'
)
AND NOT EXISTS (
  SELECT 1 FROM system_flags WHERE key = 'sale_record_events_reset_guard'
    AND json_extract(value, '$.mode') = 'reset'
    AND length(trim(COALESCE(json_extract(value, '$.token'), ''))) > 0
)
BEGIN
  SELECT RAISE(ABORT, 'online order requests are immutable: delete only during restore or reset');
END;

CREATE TRIGGER online_order_events_append_only_update
BEFORE UPDATE ON online_order_events
BEGIN
  SELECT RAISE(ABORT, 'online_order_events is append-only: correct an entry by appending a new one, never by rewriting one');
END;

CREATE TRIGGER online_order_events_append_only_delete
BEFORE DELETE ON online_order_events
WHEN NOT EXISTS (
  SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore'
)
AND NOT EXISTS (
  SELECT 1 FROM system_flags WHERE key = 'sale_record_events_reset_guard'
    AND json_extract(value, '$.mode') = 'reset'
    AND length(trim(COALESCE(json_extract(value, '$.token'), ''))) > 0
)
BEGIN
  SELECT RAISE(ABORT, 'online order events are immutable: delete only during restore or reset');
END;

ALTER TABLE returns ADD COLUMN refund_channel TEXT CHECK (refund_channel IS NULL OR refund_channel IN ('drawer','aba'));

SELECT CASE WHEN (SELECT COUNT(*) FROM online_orders) = 0
  AND (SELECT COUNT(*) FROM online_order_payments) = 0
  AND (SELECT COUNT(*) FROM online_order_requests) = 0
  AND (SELECT COUNT(*) FROM online_order_events) = 0
  AND (SELECT COUNT(*) FROM returns WHERE refund_channel IS NOT NULL) = 0
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL AND tbl_name IN ('online_orders','online_order_payments','online_order_requests','online_order_events')) = 12
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN ('online_order_requests','online_order_events')) = 4
THEN 1 ELSE json_extract('[]','$[online_orders_0293_post]') END;
