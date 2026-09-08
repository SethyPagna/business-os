-- 0142: immutable customer-return creation receipts and transient atomic guards.
--
-- PRE-ASSERTIONS:
--   SELECT COUNT(*) FROM sales;
--   SELECT COUNT(*) FROM returns;
--   SELECT COUNT(*) FROM return_items;
--   SELECT COUNT(*) FROM return_item_batch_allocations;
--   SELECT COUNT(*) FROM return_replacement_items;
--   SELECT COUNT(*) FROM inventory_movements;
--   SELECT COUNT(*) FROM damaged_stock_lots;
--   SELECT COUNT(*) FROM audit_logs;
--   SELECT COALESCE(SUM(quantity),0) FROM branch_stock;
--   SELECT COALESCE(SUM(quantity),0) FROM branch_batch_stock;
--   SELECT COALESCE(SUM(total_usd),0) FROM sales;
--
-- POST-ASSERTIONS:
--   SELECT COUNT(*) FROM return_create_receipts; -- 0, no backfill.
--   SELECT COUNT(*) FROM return_create_guards;   -- 0, transient only.
--   Re-run every pre-assertion; every value must be unchanged.
--
-- RECOVERY: retain both tables if application code is rolled back. Receipts
-- are immutable replay provenance. Guards are transaction-local scratch rows
-- whose successful action always deletes them before committing its receipt.

CREATE TABLE return_create_receipts (
  id TEXT PRIMARY KEY CHECK (
    length(id)=36 AND lower(id)=id
    AND id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
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
    AND occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
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

CREATE INDEX idx_return_create_receipts_return_time
  ON return_create_receipts(return_id,occurred_at,id);

CREATE TRIGGER return_create_receipts_append_only_update
BEFORE UPDATE ON return_create_receipts
BEGIN
  SELECT RAISE(ABORT,'return create receipts are immutable');
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

CREATE TABLE return_create_guards (
  operation_id TEXT NOT NULL CHECK (
    length(operation_id)=36 AND lower(operation_id)=operation_id
    AND operation_id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
  ),
  phase TEXT NOT NULL CHECK(phase IN ('precondition','postcondition')),
  guard_value INTEGER NOT NULL CHECK(typeof(guard_value)='integer' AND guard_value=1),
  PRIMARY KEY(operation_id,phase)
);
