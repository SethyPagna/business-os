-- 0134: retain the server-normalized basket, tender and driver shown when a
-- sale is created. Existing sales stay NULL: mutable sale_items/current sale
-- fields are not evidence of their original state and must not be backfilled.
--
-- PRE-ASSERTIONS:
--   SELECT COUNT(*) AS sales_before FROM sales;
--
-- POST-ASSERTIONS:
--   SELECT COUNT(*) AS sales_after FROM sales; -- equals sales_before
--   SELECT COUNT(*) FROM sales WHERE creation_snapshot_json IS NOT NULL; -- 0
--
-- RECOVERY: this nullable column is an append-only schema extension. Older
-- application code ignores it. Keep captured snapshots; do not remove or
-- reconstruct them from current product/contact rows.

ALTER TABLE sales ADD COLUMN creation_snapshot_json TEXT
  CHECK (creation_snapshot_json IS NULL OR json_valid(creation_snapshot_json));

CREATE TRIGGER sale_creation_snapshot_immutable
BEFORE UPDATE OF creation_snapshot_json ON sales
WHEN OLD.creation_snapshot_json IS NOT NEW.creation_snapshot_json
BEGIN
  SELECT RAISE(ABORT, 'sale creation snapshot is immutable');
END;
