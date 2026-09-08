-- 0143: immutable receipts and privacy-safe Sales Records for reference fan-out writes.
--
-- PRE-ASSERTIONS:
--   SELECT COUNT(*), COALESCE(SUM(length(CAST(changes_json AS BLOB))),0) FROM sale_record_events;
--   SELECT COUNT(*) FROM sales;
--   SELECT COUNT(*) FROM customers;
--   SELECT COUNT(*) FROM delivery_contacts;
--   SELECT COUNT(*) FROM settings;
--
-- POST-ASSERTIONS:
--   The event count and byte sum exactly match the pre-assertion.
--   SELECT COUNT(*) FROM sale_reference_mutation_receipts; -- 0, no backfill.
--   SELECT COUNT(*) FROM sale_reference_mutation_guards;   -- 0, transient only.
--   Re-run every remaining pre-assertion; every value must be unchanged.
--
-- RECOVERY: retain the rebuilt event table and empty receipt/guard tables if
-- application code is rolled back. No sale, contact, setting, stock, money,
-- action-history, or audit row is changed by this migration.

ALTER TABLE sale_record_events RENAME TO sale_record_events_0140;

CREATE TABLE sale_record_events (
  id TEXT PRIMARY KEY CHECK (
    length(id)=36 AND lower(id)=id
    AND id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
  ),
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL CHECK(source_kind IN (
    'sale_status','sale_customer','sale_settlement','sale_bulk_status',
    'sale_bulk_update','return_create','return_edit','return_bulk',
    'contact_customer_carry','contact_delivery_carry','contact_customer_merge',
    'contact_delivery_merge','customer_link_repair','customer_missing_resolve',
    'payment_method_replace'
  )),
  source_id TEXT NOT NULL CHECK(length(source_id) BETWEEN 1 AND 180),
  generation INTEGER NOT NULL CHECK(typeof(generation)='integer' AND generation BETWEEN 0 AND 1000000),
  kind TEXT NOT NULL CHECK(kind IN (
    'sale_created','driver_changed','delivery_cost_changed','delivery_fee_changed',
    'delivery_added','item_added','item_removed','item_quantity_changed',
    'items_replaced','customer_changed','customer_contact_changed',
    'membership_changed','status_changed','payment_changed','payment_settled','cancelled'
  )),
  via TEXT NOT NULL CHECK(via IN ('apply','undo','redo')),
  subject TEXT CHECK(subject IS NULL OR length(subject)<=240),
  actor_id INTEGER,
  actor_username TEXT CHECK(actor_username IS NULL OR length(actor_username)<=120),
  occurred_at TEXT NOT NULL CHECK(length(trim(occurred_at)) BETWEEN 1 AND 40),
  changes_json TEXT NOT NULL
    CHECK(json_valid(changes_json))
    CHECK(json_type(CASE WHEN json_valid(changes_json) THEN changes_json ELSE '[]' END)='array')
    CHECK(json_array_length(CASE WHEN json_valid(changes_json) THEN changes_json ELSE '[]' END) BETWEEN 0 AND 12)
    CHECK(length(CAST(changes_json AS BLOB))<=65536),
  metadata_json TEXT
    CHECK(metadata_json IS NULL OR json_valid(metadata_json))
    CHECK(metadata_json IS NULL OR json_type(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END)='object')
    CHECK(metadata_json IS NULL OR length(CAST(metadata_json AS BLOB))<=512),
  request_digest TEXT CHECK(request_digest IS NULL OR (
    length(request_digest)=64 AND request_digest NOT GLOB '*[^0-9a-f]*'
  )),
  response_json TEXT
    CHECK(response_json IS NULL OR json_valid(response_json))
    CHECK(response_json IS NULL OR json_type(CASE WHEN json_valid(response_json) THEN response_json ELSE '{}' END)='object')
    CHECK(response_json IS NULL OR length(CAST(response_json AS BLOB))<=65536),
  CHECK (
    (kind='customer_contact_changed' AND changes_json='[]')
    OR (kind<>'customer_contact_changed' AND json_array_length(changes_json) BETWEEN 1 AND 12)
  ),
  CHECK (
    metadata_json IS NULL
    OR (
      kind IN ('customer_changed','customer_contact_changed')
      AND json_remove(metadata_json,'$.changed_contact_fields')='{}'
      AND json_type(metadata_json,'$.changed_contact_fields')='array'
      AND json_array_length(metadata_json,'$.changed_contact_fields') BETWEEN 1 AND 2
      AND json_type(metadata_json,'$.changed_contact_fields[0]')='text'
      AND json_extract(metadata_json,'$.changed_contact_fields[0]') IN ('phone','address')
      AND (
        json_array_length(metadata_json,'$.changed_contact_fields')=1
        OR (
          json_type(metadata_json,'$.changed_contact_fields[1]')='text'
          AND json_extract(metadata_json,'$.changed_contact_fields[1]') IN ('phone','address')
          AND json_extract(metadata_json,'$.changed_contact_fields[0]')<>json_extract(metadata_json,'$.changed_contact_fields[1]')
        )
      )
    )
  ),
  CHECK(kind<>'customer_contact_changed' OR metadata_json IS NOT NULL),
  CHECK (
    (source_kind='sale_status' AND kind IN ('status_changed','cancelled'))
    OR (source_kind='sale_customer' AND kind='customer_changed')
    OR (source_kind='sale_settlement' AND kind IN ('payment_changed','payment_settled'))
    OR (source_kind='sale_bulk_status' AND kind IN ('status_changed','cancelled'))
    OR (source_kind='sale_bulk_update' AND kind IN ('customer_changed','payment_changed','driver_changed'))
    OR (source_kind IN ('return_create','return_edit','return_bulk') AND kind='status_changed')
    OR (source_kind='contact_customer_carry' AND kind IN ('customer_changed','customer_contact_changed'))
    OR (source_kind='contact_delivery_carry' AND kind='driver_changed')
    OR (source_kind='contact_customer_merge' AND kind='customer_changed')
    OR (source_kind='contact_delivery_merge' AND kind='driver_changed')
    OR (source_kind IN ('customer_link_repair','customer_missing_resolve') AND kind='customer_changed')
    OR (source_kind='payment_method_replace' AND kind='payment_changed')
  ),
  CHECK (
    (generation=0 AND via='apply')
    OR (
      source_kind IN ('sale_settlement','sale_bulk_status','sale_bulk_update','return_bulk')
      AND generation>0
      AND ((generation%2=1 AND via='undo') OR (generation%2=0 AND via='redo'))
    )
  ),
  CHECK (
    source_kind NOT IN (
      'contact_customer_carry','contact_delivery_carry','contact_customer_merge',
      'contact_delivery_merge','customer_link_repair','customer_missing_resolve',
      'payment_method_replace'
    )
    OR (
      length(source_id)=36 AND lower(source_id)=source_id
      AND source_id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
    )
  ),
  UNIQUE(source_kind,source_id,generation,sale_id)
);

INSERT INTO sale_record_events(
  id,sale_id,source_kind,source_id,generation,kind,via,subject,actor_id,
  actor_username,occurred_at,changes_json,metadata_json,request_digest,response_json
)
SELECT id,sale_id,source_kind,source_id,generation,kind,via,subject,actor_id,
  actor_username,occurred_at,changes_json,NULL,request_digest,response_json
FROM sale_record_events_0140;

DROP TABLE sale_record_events_0140;

CREATE INDEX idx_sale_record_events_sale_time
  ON sale_record_events(sale_id,occurred_at,id);

CREATE UNIQUE INDEX uq_sale_record_events_direct_request
  ON sale_record_events(source_kind,source_id,generation)
  WHERE source_kind IN ('sale_status','sale_customer','return_edit');

CREATE TRIGGER sale_record_events_append_only_update
BEFORE UPDATE ON sale_record_events
BEGIN
  SELECT RAISE(ABORT,'sale record events are immutable: append a new event');
END;

CREATE TRIGGER sale_record_events_append_only_delete
BEFORE DELETE ON sale_record_events
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
  SELECT RAISE(ABORT,'sale record events are immutable: delete only during restore or reset');
END;

CREATE TABLE sale_reference_mutation_receipts (
  id TEXT PRIMARY KEY CHECK (
    length(id)=36 AND lower(id)=id
    AND id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
  ),
  actor_id INTEGER NOT NULL CHECK(typeof(actor_id)='integer' AND actor_id>0),
  mutation_kind TEXT NOT NULL CHECK(mutation_kind IN (
    'customer_profile_carry','delivery_contact_carry','customer_merge',
    'delivery_contact_merge','customer_link_repair','customer_missing_resolve',
    'payment_method_replace'
  )),
  target_key TEXT NOT NULL
    CHECK(target_key=trim(target_key))
    CHECK(length(CAST(target_key AS BLOB)) BETWEEN 1 AND 160),
  request_id TEXT NOT NULL
    CHECK(request_id=trim(request_id))
    CHECK(length(CAST(request_id AS BLOB)) BETWEEN 1 AND 120),
  request_digest TEXT NOT NULL CHECK(
    length(request_digest)=64 AND request_digest NOT GLOB '*[^0-9a-f]*'
  ),
  response_json TEXT NOT NULL
    CHECK(json_valid(response_json))
    CHECK(json_type(CASE WHEN json_valid(response_json) THEN response_json ELSE '{}' END)='object')
    CHECK(length(CAST(response_json AS BLOB))<=4096),
  occurred_at TEXT NOT NULL CHECK(
    length(CAST(occurred_at AS BLOB))=24
    AND occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
    AND datetime(occurred_at) IS NOT NULL
  ),
  CHECK(json_type(response_json,'$.success')='true'),
  CHECK(json_type(response_json,'$.receipt_id')='text' AND json_extract(response_json,'$.receipt_id')=id),
  CHECK(json_type(response_json,'$.updated_at')='text' AND json_extract(response_json,'$.updated_at')=occurred_at),
  CHECK(json_type(response_json,'$.affected_sales')='integer' AND json_extract(response_json,'$.affected_sales')>=0),
  CHECK (
    CASE mutation_kind
      WHEN 'customer_profile_carry' THEN
        json_type(response_json,'$.target_id')='integer' AND json_extract(response_json,'$.target_id')>0
        AND json_type(response_json,'$.affected_returns')='integer' AND json_extract(response_json,'$.affected_returns')>=0
        AND json_remove(response_json,'$.success','$.receipt_id','$.target_id','$.affected_sales','$.affected_returns','$.updated_at')='{}'
      WHEN 'delivery_contact_carry' THEN
        json_type(response_json,'$.target_id')='integer' AND json_extract(response_json,'$.target_id')>0
        AND json_remove(response_json,'$.success','$.receipt_id','$.target_id','$.affected_sales','$.updated_at')='{}'
      WHEN 'customer_merge' THEN
        json_type(response_json,'$.keep_id')='integer' AND json_extract(response_json,'$.keep_id')>0
        AND json_type(response_json,'$.merge_id')='integer' AND json_extract(response_json,'$.merge_id')>0
        AND json_extract(response_json,'$.keep_id')<>json_extract(response_json,'$.merge_id')
        AND json_remove(response_json,'$.success','$.receipt_id','$.keep_id','$.merge_id','$.affected_sales','$.updated_at')='{}'
      WHEN 'delivery_contact_merge' THEN
        json_type(response_json,'$.keep_id')='integer' AND json_extract(response_json,'$.keep_id')>0
        AND json_type(response_json,'$.merge_id')='integer' AND json_extract(response_json,'$.merge_id')>0
        AND json_extract(response_json,'$.keep_id')<>json_extract(response_json,'$.merge_id')
        AND json_remove(response_json,'$.success','$.receipt_id','$.keep_id','$.merge_id','$.affected_sales','$.updated_at')='{}'
      WHEN 'customer_link_repair' THEN
        json_type(response_json,'$.target_id')='integer' AND json_extract(response_json,'$.target_id')>0
        AND json_remove(response_json,'$.success','$.receipt_id','$.target_id','$.affected_sales','$.updated_at')='{}'
      WHEN 'customer_missing_resolve' THEN
        json_type(response_json,'$.target_id')='integer' AND json_extract(response_json,'$.target_id')>0
        AND json_type(response_json,'$.created') IN ('true','false')
        AND json_remove(response_json,'$.success','$.receipt_id','$.target_id','$.created','$.affected_sales','$.updated_at')='{}'
      WHEN 'payment_method_replace' THEN
        json_type(response_json,'$.affected_payment_lines')='integer'
        AND json_extract(response_json,'$.affected_payment_lines')>=0
        AND json_remove(response_json,'$.success','$.receipt_id','$.affected_sales','$.affected_payment_lines','$.updated_at')='{}'
      ELSE 0
    END
  ),
  CHECK (
    CASE mutation_kind
      WHEN 'customer_profile_carry' THEN
        substr(target_key,1,9)='customer:' AND CAST(substr(target_key,10) AS INTEGER)>0
        AND target_key='customer:'||CAST(CAST(substr(target_key,10) AS INTEGER) AS TEXT)
      WHEN 'delivery_contact_carry' THEN
        substr(target_key,1,17)='delivery_contact:' AND CAST(substr(target_key,18) AS INTEGER)>0
        AND target_key='delivery_contact:'||CAST(CAST(substr(target_key,18) AS INTEGER) AS TEXT)
      WHEN 'customer_merge' THEN
        substr(target_key,1,15)='customer_merge:'
        AND instr(substr(target_key,16),':')>1
        AND CAST(substr(target_key,16,instr(substr(target_key,16),':')-1) AS INTEGER)>0
        AND CAST(substr(substr(target_key,16),instr(substr(target_key,16),':')+1) AS INTEGER)>0
        AND target_key='customer_merge:'
          ||CAST(CAST(substr(target_key,16,instr(substr(target_key,16),':')-1) AS INTEGER) AS TEXT)||':'
          ||CAST(CAST(substr(substr(target_key,16),instr(substr(target_key,16),':')+1) AS INTEGER) AS TEXT)
      WHEN 'delivery_contact_merge' THEN
        substr(target_key,1,23)='delivery_contact_merge:'
        AND instr(substr(target_key,24),':')>1
        AND CAST(substr(target_key,24,instr(substr(target_key,24),':')-1) AS INTEGER)>0
        AND CAST(substr(substr(target_key,24),instr(substr(target_key,24),':')+1) AS INTEGER)>0
        AND target_key='delivery_contact_merge:'
          ||CAST(CAST(substr(target_key,24,instr(substr(target_key,24),':')-1) AS INTEGER) AS TEXT)||':'
          ||CAST(CAST(substr(substr(target_key,24),instr(substr(target_key,24),':')+1) AS INTEGER) AS TEXT)
      WHEN 'customer_link_repair' THEN
        substr(target_key,1,14)='customer_link:'
        AND instr(substr(target_key,15),':')>1
        AND CAST(substr(target_key,15,instr(substr(target_key,15),':')-1) AS INTEGER)>0
        AND length(substr(substr(target_key,15),instr(substr(target_key,15),':')+1))=64
        AND substr(substr(target_key,15),instr(substr(target_key,15),':')+1) NOT GLOB '*[^0-9a-f]*'
        AND target_key='customer_link:'
          ||CAST(CAST(substr(target_key,15,instr(substr(target_key,15),':')-1) AS INTEGER) AS TEXT)||':'
          ||substr(substr(target_key,15),instr(substr(target_key,15),':')+1)
      WHEN 'customer_missing_resolve' THEN
        substr(target_key,1,17)='customer_missing:' AND length(substr(target_key,18))=64
        AND substr(target_key,18) NOT GLOB '*[^0-9a-f]*'
      WHEN 'payment_method_replace' THEN
        substr(target_key,1,15)='payment_method:' AND length(substr(target_key,16))=64
        AND substr(target_key,16) NOT GLOB '*[^0-9a-f]*'
      ELSE 0
    END
  ),
  UNIQUE(actor_id,mutation_kind,request_id)
);

CREATE INDEX idx_sale_reference_mutation_receipts_time
  ON sale_reference_mutation_receipts(occurred_at,id);

CREATE TRIGGER sale_reference_mutation_receipts_append_only_update
BEFORE UPDATE ON sale_reference_mutation_receipts
BEGIN
  SELECT RAISE(ABORT,'sale reference mutation receipts are immutable');
END;

CREATE TRIGGER sale_reference_mutation_receipts_append_only_delete
BEFORE DELETE ON sale_reference_mutation_receipts
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
  SELECT RAISE(ABORT,'sale reference mutation receipts are immutable: delete only during restore or reset');
END;

CREATE TABLE sale_reference_mutation_guards (
  operation_id TEXT PRIMARY KEY CHECK (
    length(operation_id)=36 AND lower(operation_id)=operation_id
    AND operation_id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
  ),
  guard_value INTEGER NOT NULL CHECK(typeof(guard_value)='integer' AND guard_value=1)
);
