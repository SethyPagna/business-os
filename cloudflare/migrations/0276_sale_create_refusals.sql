-- Durable request-control state: retain across application restores and resets.
-- This migration changes no sale, tender, item, stock, or accounting value.
-- PRE: record existing sale/item counts, financial totals and stock quantities.
-- POST: those values match; the control table is empty and both barriers exist.
-- RECOVERY: preserve control rows and barriers during application rollback.
-- Keep the barriers when rolling application code back. Physical recovery must
-- preserve these rows separately before replacing an older database snapshot.
CREATE TABLE sale_create_refusals (
  client_request_id TEXT PRIMARY KEY NOT NULL
    CHECK(length(client_request_id) BETWEEN 1 AND 120 AND client_request_id = trim(client_request_id)),
  actor_id INTEGER NOT NULL CHECK(actor_id > 0),
  owner_json TEXT NOT NULL CHECK(json_valid(owner_json) AND length(CAST(owner_json AS BLOB)) <= 1024),
  reason TEXT NOT NULL CHECK(reason = 'sale_snapshot_too_large'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER sales_create_refusal_insert_0276
BEFORE INSERT ON sales
WHEN NEW.client_request_id IS NOT NULL AND NEW.client_request_id <> ''
  AND EXISTS(SELECT 1 FROM sale_create_refusals WHERE client_request_id = NEW.client_request_id)
  AND NOT EXISTS(
    SELECT 1 FROM system_flags e
    JOIN system_flags p ON p.key = 'stock_transaction_permit' AND p.value = e.value
    JOIN system_flags m ON m.key = 'maintenance'
    WHERE e.key = 'stock_schema_epoch' AND e.value = 'legacy-separate-pool-v1'
      AND CASE WHEN json_valid(m.value) THEN json_extract(m.value,'$.mode') END = 'restore'
  )
BEGIN
  SELECT RAISE(ABORT,'sale_create_terminal_refusal');
END;

CREATE TRIGGER sales_create_refusal_update_0276
BEFORE UPDATE OF client_request_id ON sales
WHEN NEW.client_request_id IS NOT OLD.client_request_id
  AND NEW.client_request_id IS NOT NULL AND NEW.client_request_id <> ''
  AND EXISTS(SELECT 1 FROM sale_create_refusals WHERE client_request_id = NEW.client_request_id)
  AND NOT EXISTS(
    SELECT 1 FROM system_flags e
    JOIN system_flags p ON p.key = 'stock_transaction_permit' AND p.value = e.value
    JOIN system_flags m ON m.key = 'maintenance'
    WHERE e.key = 'stock_schema_epoch' AND e.value = 'legacy-separate-pool-v1'
      AND CASE WHEN json_valid(m.value) THEN json_extract(m.value,'$.mode') END = 'restore'
  )
BEGIN
  SELECT RAISE(ABORT,'sale_create_terminal_refusal');
END;
