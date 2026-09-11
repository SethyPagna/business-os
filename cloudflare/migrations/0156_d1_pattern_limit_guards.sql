-- 0156: retain exact UUID/timestamp validation within native D1's 50-byte
-- LIKE/GLOB pattern limit. The old 251-byte UUID CHECK aborts sale events,
-- rolling back settlement/status transactions. Historical migrations remain immutable.
--
-- Run through D1 migrations apply (one atomic transaction including the ledger).
-- No foreign key points INTO these five tables. Their outward references,
-- all rows/IDs, indexes, CHECKs and immutable triggers are preserved.
-- PRE/POST: compare each table's complete rows and sales/returns/fees/stock
-- counters. The EXCEPT assertions below compare every copied column in both
-- directions before dropping any original table. A failure rolls everything back.
-- Recovery: retain this corrected schema when rolling application code back;
-- never delete replay receipts. Use the pre-migration D1 bookmark only under
-- coordinated maintenance if transaction/ledger postflight is inconsistent.

CREATE TABLE _pattern_guard_0156(value INTEGER NOT NULL CHECK(value=1));

CREATE TABLE sale_record_events_0156 (
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
INSERT INTO sale_record_events_0156 SELECT * FROM sale_record_events;
INSERT INTO _pattern_guard_0156 SELECT CASE WHEN
  NOT EXISTS(SELECT * FROM sale_record_events EXCEPT SELECT * FROM sale_record_events_0156)
  AND NOT EXISTS(SELECT * FROM sale_record_events_0156 EXCEPT SELECT * FROM sale_record_events)
  THEN 1 ELSE 0 END;
DROP TRIGGER sale_record_events_append_only_update;
DROP TRIGGER sale_record_events_append_only_delete;
DROP TABLE sale_record_events;
ALTER TABLE sale_record_events_0156 RENAME TO sale_record_events;
CREATE INDEX idx_sale_record_events_sale_time
  ON sale_record_events(sale_id, occurred_at, id);
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

CREATE TABLE return_mutation_receipts_0156 (
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
INSERT INTO return_mutation_receipts_0156 SELECT * FROM return_mutation_receipts;
INSERT INTO _pattern_guard_0156 SELECT CASE WHEN
  NOT EXISTS(SELECT * FROM return_mutation_receipts EXCEPT SELECT * FROM return_mutation_receipts_0156)
  AND NOT EXISTS(SELECT * FROM return_mutation_receipts_0156 EXCEPT SELECT * FROM return_mutation_receipts)
  THEN 1 ELSE 0 END;
DROP TRIGGER return_mutation_receipts_append_only_update;
DROP TRIGGER return_mutation_receipts_append_only_delete;
DROP TABLE return_mutation_receipts;
ALTER TABLE return_mutation_receipts_0156 RENAME TO return_mutation_receipts;
CREATE INDEX idx_return_mutation_receipts_return_time
  ON return_mutation_receipts(return_id,occurred_at,id);
CREATE TRIGGER return_mutation_receipts_append_only_update
BEFORE UPDATE ON return_mutation_receipts BEGIN
  SELECT RAISE(ABORT, 'return mutation receipts are immutable');
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

CREATE TABLE return_create_receipts_0156 (
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
INSERT INTO return_create_receipts_0156 SELECT * FROM return_create_receipts;
INSERT INTO _pattern_guard_0156 SELECT CASE WHEN
  NOT EXISTS(SELECT * FROM return_create_receipts EXCEPT SELECT * FROM return_create_receipts_0156)
  AND NOT EXISTS(SELECT * FROM return_create_receipts_0156 EXCEPT SELECT * FROM return_create_receipts)
  THEN 1 ELSE 0 END;
DROP TRIGGER return_create_receipts_append_only_update;
DROP TRIGGER return_create_receipts_append_only_delete;
DROP TABLE return_create_receipts;
ALTER TABLE return_create_receipts_0156 RENAME TO return_create_receipts;
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

CREATE TABLE return_create_guards_0156 (
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
INSERT INTO return_create_guards_0156 SELECT * FROM return_create_guards;
INSERT INTO _pattern_guard_0156 SELECT CASE WHEN
  NOT EXISTS(SELECT * FROM return_create_guards EXCEPT SELECT * FROM return_create_guards_0156)
  AND NOT EXISTS(SELECT * FROM return_create_guards_0156 EXCEPT SELECT * FROM return_create_guards)
  THEN 1 ELSE 0 END;
DROP TABLE return_create_guards;
ALTER TABLE return_create_guards_0156 RENAME TO return_create_guards;

CREATE TABLE fee_operation_receipts_0156 (
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
INSERT INTO fee_operation_receipts_0156 SELECT * FROM fee_operation_receipts;
INSERT INTO _pattern_guard_0156 SELECT CASE WHEN
  NOT EXISTS(SELECT * FROM fee_operation_receipts EXCEPT SELECT * FROM fee_operation_receipts_0156)
  AND NOT EXISTS(SELECT * FROM fee_operation_receipts_0156 EXCEPT SELECT * FROM fee_operation_receipts)
  THEN 1 ELSE 0 END;
DROP TRIGGER fee_operation_receipts_append_only_update;
DROP TRIGGER fee_operation_receipts_append_only_delete;
DROP TABLE fee_operation_receipts;
ALTER TABLE fee_operation_receipts_0156 RENAME TO fee_operation_receipts;
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

DROP TABLE _pattern_guard_0156;

