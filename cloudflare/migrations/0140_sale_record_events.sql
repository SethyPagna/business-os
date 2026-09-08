-- 0140: immutable, display-safe Sales Records events.
--
-- PRE-ASSERTIONS:
--   SELECT COUNT(*) AS sales_rows FROM sales;
--   SELECT COALESCE(SUM(total_usd), 0) AS sales_total_usd FROM sales;
--   SELECT COUNT(*) AS audit_rows FROM audit_logs;
--
-- POST-ASSERTIONS:
--   SELECT COUNT(*) FROM sale_record_events; -- 0: this migration never backfills.
--   Re-run the three pre-assertions; every value must be unchanged.
--   UPDATE/DELETE of an event must abort outside the explicit restore/reset guards.
--
-- RECOVERY: keep the append-only table if application code is rolled back. It
-- contains no backfill and does not alter sales, stock, money, or audit rows.

CREATE TABLE sale_record_events (
  id TEXT PRIMARY KEY CHECK (
    length(id) = 36
    AND lower(id) = id
    AND id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
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

CREATE INDEX idx_sale_record_events_sale_time
  ON sale_record_events(sale_id, occurred_at, id);

-- Direct request ids are actor-scoped and must never be reused against a
-- second sale/return target. Bulk and receipt-backed sources have their own
-- durable operation identity and intentionally keep per-sale rows.
CREATE UNIQUE INDEX uq_sale_record_events_direct_request
  ON sale_record_events(source_kind, source_id, generation)
  WHERE source_kind IN ('sale_status', 'sale_customer', 'return_edit');

CREATE TRIGGER sale_record_events_append_only_update
BEFORE UPDATE ON sale_record_events
BEGIN
  SELECT RAISE(ABORT, 'sale record events are immutable: append a new event');
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
