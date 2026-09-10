-- 0150: immutable receipts for retry-safe manual expense creation.
--
-- PRE-ASSERTIONS:
--   SELECT COUNT(*) FROM fees;
--   SELECT COUNT(*) FROM audit_logs WHERE entity='fee' AND action='create';
--   SELECT COALESCE(SUM(amount_usd),0),COALESCE(SUM(amount_khr),0) FROM fees;
--
-- POST-ASSERTIONS:
--   SELECT COUNT(*) FROM fee_operation_receipts; -- 0, no backfill.
--   Re-run every pre-assertion; every value must be unchanged.
--
-- RECOVERY: roll application code back while retaining this table. The rows
-- are immutable replay provenance; deleting them would make a previously
-- committed client_request_id unsafe to retry. Backup/restore and factory
-- reset include the table together with its associated fees. No SQL foreign
-- key is intentional: deleting an expense must remain possible while its
-- immutable request receipt continues to suppress a later network retry.

CREATE TABLE fee_operation_receipts (
  id TEXT PRIMARY KEY CHECK (
    length(id)=36 AND lower(id)=id
    AND id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
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
    AND occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
    AND datetime(occurred_at) IS NOT NULL
  ),
  CHECK(json_type(response_json,'$.fee.id')='integer' AND json_extract(response_json,'$.fee.id')=fee_id),
  UNIQUE(fee_id),
  UNIQUE(actor_id,request_id)
);

CREATE INDEX idx_fee_operation_receipts_fee_time
  ON fee_operation_receipts(fee_id,occurred_at,id);

CREATE TRIGGER fee_operation_receipts_append_only_update
BEFORE UPDATE ON fee_operation_receipts
BEGIN
  SELECT RAISE(ABORT,'fee operation receipts are immutable');
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
