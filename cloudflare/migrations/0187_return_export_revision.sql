-- Returns statement freshness only: no financial rows are rewritten.
-- Read contract: returns_export_revision.value is {"revision": N}, where N
-- is an integer from 0 through 9007199254740991, paired with the separately
-- owned business_dataset_generation. Missing/invalid metadata MUST deny export.
-- All six projection/filter dependencies invalidate on every I/U/D, including
-- restore mode. Global invalidation is conservative, not a per-return history.
-- Overflow/corruption poisons the counter (null) without blocking business writes;
-- it never wraps/reseeds. Recovery requires an explicitly coordinated generation
-- rotation before repairing metadata, not rerunning this migration.
-- system_flags stays outside backup/reset business-table manifests.
-- CREATE TRIGGER intentionally has no IF NOT EXISTS: a raw rerun stops before
-- the final seed, preserving both live counters and missing/corrupt tombstones.

CREATE TRIGGER return_export_revision_returns_insert AFTER INSERT ON returns
BEGIN
  UPDATE system_flags
  SET value = CASE WHEN json_valid(value) THEN
    CASE WHEN json_type(value, '$.revision') = 'integer'
      AND json_extract(value, '$.revision') >= 0
      AND json_extract(value, '$.revision') < 9007199254740991
    THEN json_object('revision', json_extract(value, '$.revision') + 1)
    ELSE '{"revision":null}' END
    ELSE '{"revision":null}' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'returns_export_revision';
END;

CREATE TRIGGER return_export_revision_returns_update AFTER UPDATE ON returns
BEGIN
  UPDATE system_flags
  SET value = CASE WHEN json_valid(value) THEN
    CASE WHEN json_type(value, '$.revision') = 'integer'
      AND json_extract(value, '$.revision') >= 0
      AND json_extract(value, '$.revision') < 9007199254740991
    THEN json_object('revision', json_extract(value, '$.revision') + 1)
    ELSE '{"revision":null}' END
    ELSE '{"revision":null}' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'returns_export_revision';
END;

CREATE TRIGGER return_export_revision_returns_delete AFTER DELETE ON returns
BEGIN
  UPDATE system_flags
  SET value = CASE WHEN json_valid(value) THEN
    CASE WHEN json_type(value, '$.revision') = 'integer'
      AND json_extract(value, '$.revision') >= 0
      AND json_extract(value, '$.revision') < 9007199254740991
    THEN json_object('revision', json_extract(value, '$.revision') + 1)
    ELSE '{"revision":null}' END
    ELSE '{"revision":null}' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'returns_export_revision';
END;

CREATE TRIGGER return_export_revision_return_items_insert AFTER INSERT ON return_items
BEGIN
  UPDATE system_flags
  SET value = CASE WHEN json_valid(value) THEN
    CASE WHEN json_type(value, '$.revision') = 'integer'
      AND json_extract(value, '$.revision') >= 0
      AND json_extract(value, '$.revision') < 9007199254740991
    THEN json_object('revision', json_extract(value, '$.revision') + 1)
    ELSE '{"revision":null}' END
    ELSE '{"revision":null}' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'returns_export_revision';
END;

CREATE TRIGGER return_export_revision_return_items_update AFTER UPDATE ON return_items
BEGIN
  UPDATE system_flags
  SET value = CASE WHEN json_valid(value) THEN
    CASE WHEN json_type(value, '$.revision') = 'integer'
      AND json_extract(value, '$.revision') >= 0
      AND json_extract(value, '$.revision') < 9007199254740991
    THEN json_object('revision', json_extract(value, '$.revision') + 1)
    ELSE '{"revision":null}' END
    ELSE '{"revision":null}' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'returns_export_revision';
END;

CREATE TRIGGER return_export_revision_return_items_delete AFTER DELETE ON return_items
BEGIN
  UPDATE system_flags
  SET value = CASE WHEN json_valid(value) THEN
    CASE WHEN json_type(value, '$.revision') = 'integer'
      AND json_extract(value, '$.revision') >= 0
      AND json_extract(value, '$.revision') < 9007199254740991
    THEN json_object('revision', json_extract(value, '$.revision') + 1)
    ELSE '{"revision":null}' END
    ELSE '{"revision":null}' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'returns_export_revision';
END;

CREATE TRIGGER return_export_revision_return_replacement_items_insert AFTER INSERT ON return_replacement_items
BEGIN
  UPDATE system_flags
  SET value = CASE WHEN json_valid(value) THEN
    CASE WHEN json_type(value, '$.revision') = 'integer'
      AND json_extract(value, '$.revision') >= 0
      AND json_extract(value, '$.revision') < 9007199254740991
    THEN json_object('revision', json_extract(value, '$.revision') + 1)
    ELSE '{"revision":null}' END
    ELSE '{"revision":null}' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'returns_export_revision';
END;

CREATE TRIGGER return_export_revision_return_replacement_items_update AFTER UPDATE ON return_replacement_items
BEGIN
  UPDATE system_flags
  SET value = CASE WHEN json_valid(value) THEN
    CASE WHEN json_type(value, '$.revision') = 'integer'
      AND json_extract(value, '$.revision') >= 0
      AND json_extract(value, '$.revision') < 9007199254740991
    THEN json_object('revision', json_extract(value, '$.revision') + 1)
    ELSE '{"revision":null}' END
    ELSE '{"revision":null}' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'returns_export_revision';
END;

CREATE TRIGGER return_export_revision_return_replacement_items_delete AFTER DELETE ON return_replacement_items
BEGIN
  UPDATE system_flags
  SET value = CASE WHEN json_valid(value) THEN
    CASE WHEN json_type(value, '$.revision') = 'integer'
      AND json_extract(value, '$.revision') >= 0
      AND json_extract(value, '$.revision') < 9007199254740991
    THEN json_object('revision', json_extract(value, '$.revision') + 1)
    ELSE '{"revision":null}' END
    ELSE '{"revision":null}' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'returns_export_revision';
END;

CREATE TRIGGER return_export_revision_customers_insert AFTER INSERT ON customers
BEGIN
  UPDATE system_flags
  SET value = CASE WHEN json_valid(value) THEN
    CASE WHEN json_type(value, '$.revision') = 'integer'
      AND json_extract(value, '$.revision') >= 0
      AND json_extract(value, '$.revision') < 9007199254740991
    THEN json_object('revision', json_extract(value, '$.revision') + 1)
    ELSE '{"revision":null}' END
    ELSE '{"revision":null}' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'returns_export_revision';
END;

CREATE TRIGGER return_export_revision_customers_update AFTER UPDATE ON customers
BEGIN
  UPDATE system_flags
  SET value = CASE WHEN json_valid(value) THEN
    CASE WHEN json_type(value, '$.revision') = 'integer'
      AND json_extract(value, '$.revision') >= 0
      AND json_extract(value, '$.revision') < 9007199254740991
    THEN json_object('revision', json_extract(value, '$.revision') + 1)
    ELSE '{"revision":null}' END
    ELSE '{"revision":null}' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'returns_export_revision';
END;

CREATE TRIGGER return_export_revision_customers_delete AFTER DELETE ON customers
BEGIN
  UPDATE system_flags
  SET value = CASE WHEN json_valid(value) THEN
    CASE WHEN json_type(value, '$.revision') = 'integer'
      AND json_extract(value, '$.revision') >= 0
      AND json_extract(value, '$.revision') < 9007199254740991
    THEN json_object('revision', json_extract(value, '$.revision') + 1)
    ELSE '{"revision":null}' END
    ELSE '{"revision":null}' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'returns_export_revision';
END;

CREATE TRIGGER return_export_revision_sales_insert AFTER INSERT ON sales
BEGIN
  UPDATE system_flags
  SET value = CASE WHEN json_valid(value) THEN
    CASE WHEN json_type(value, '$.revision') = 'integer'
      AND json_extract(value, '$.revision') >= 0
      AND json_extract(value, '$.revision') < 9007199254740991
    THEN json_object('revision', json_extract(value, '$.revision') + 1)
    ELSE '{"revision":null}' END
    ELSE '{"revision":null}' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'returns_export_revision';
END;

CREATE TRIGGER return_export_revision_sales_update AFTER UPDATE ON sales
BEGIN
  UPDATE system_flags
  SET value = CASE WHEN json_valid(value) THEN
    CASE WHEN json_type(value, '$.revision') = 'integer'
      AND json_extract(value, '$.revision') >= 0
      AND json_extract(value, '$.revision') < 9007199254740991
    THEN json_object('revision', json_extract(value, '$.revision') + 1)
    ELSE '{"revision":null}' END
    ELSE '{"revision":null}' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'returns_export_revision';
END;

CREATE TRIGGER return_export_revision_sales_delete AFTER DELETE ON sales
BEGIN
  UPDATE system_flags
  SET value = CASE WHEN json_valid(value) THEN
    CASE WHEN json_type(value, '$.revision') = 'integer'
      AND json_extract(value, '$.revision') >= 0
      AND json_extract(value, '$.revision') < 9007199254740991
    THEN json_object('revision', json_extract(value, '$.revision') + 1)
    ELSE '{"revision":null}' END
    ELSE '{"revision":null}' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'returns_export_revision';
END;

CREATE TRIGGER return_export_revision_products_insert AFTER INSERT ON products
BEGIN
  UPDATE system_flags
  SET value = CASE WHEN json_valid(value) THEN
    CASE WHEN json_type(value, '$.revision') = 'integer'
      AND json_extract(value, '$.revision') >= 0
      AND json_extract(value, '$.revision') < 9007199254740991
    THEN json_object('revision', json_extract(value, '$.revision') + 1)
    ELSE '{"revision":null}' END
    ELSE '{"revision":null}' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'returns_export_revision';
END;

CREATE TRIGGER return_export_revision_products_update AFTER UPDATE ON products
BEGIN
  UPDATE system_flags
  SET value = CASE WHEN json_valid(value) THEN
    CASE WHEN json_type(value, '$.revision') = 'integer'
      AND json_extract(value, '$.revision') >= 0
      AND json_extract(value, '$.revision') < 9007199254740991
    THEN json_object('revision', json_extract(value, '$.revision') + 1)
    ELSE '{"revision":null}' END
    ELSE '{"revision":null}' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'returns_export_revision';
END;

CREATE TRIGGER return_export_revision_products_delete AFTER DELETE ON products
BEGIN
  UPDATE system_flags
  SET value = CASE WHEN json_valid(value) THEN
    CASE WHEN json_type(value, '$.revision') = 'integer'
      AND json_extract(value, '$.revision') >= 0
      AND json_extract(value, '$.revision') < 9007199254740991
    THEN json_object('revision', json_extract(value, '$.revision') + 1)
    ELSE '{"revision":null}' END
    ELSE '{"revision":null}' END,
    updated_at = CURRENT_TIMESTAMP
  WHERE key = 'returns_export_revision';
END;

INSERT INTO system_flags(key, value)
VALUES('returns_export_revision', '{"revision":0}')
ON CONFLICT(key) DO NOTHING;

