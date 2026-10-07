-- STOCK-REVISION-IGNORES-BATCH-LABEL: a label-only write to a lot must not
-- bump the stock-session revision.
--
-- 0124's stock_revision_product_batches_update fires on ANY UPDATE of
-- product_batches and bumps the 'batch' and 'batch_identity' revisions that a
-- recorded stock session (and its Undo/Redo) is guarded by. 0236 added
-- product_batches.received_branch_name, a display-only snapshot of the receiving
-- branch's name, and the cutover snapshot pass fills it on every lot before the
-- branch rename. Without this file that fill bumps every lot's revision, so
-- every UNTOUCHED stock-in session at the target branch then refuses Undo as
-- stale. Owner rule: untouched products still undo.
--
-- Recreates only that one trigger as AFTER UPDATE OF <every product_batches
-- column except received_branch_name>, with the same WHEN clause and the same
-- body. An UPDATE that sets received_branch_name alone no longer fires it; an
-- UPDATE that sets any other column (or that also sets one, as the attribution
-- statements do together with received_branch_id) fires it exactly as before.
-- The insert and delete triggers are untouched. No data is read or written.
-- A later migration that adds a product_batches column must add it to the OF
-- list: test-stock-revision-ignores-batch-label-native.cjs fails until it does.
--
-- Pre-assert:  SELECT sql FROM sqlite_master
--                WHERE name = 'stock_revision_product_batches_update'
--                                      -- expected 1 row, no "UPDATE OF" in it
-- Post-assert: the same query                -- expected 1 row, "UPDATE OF" in it
--              SELECT COUNT(*) FROM sqlite_master
--                WHERE type = 'trigger' AND tbl_name = 'product_batches'
--                                      -- expected unchanged (13)
--              no table row count changes
-- Deploy order: 0236 first, then this file, then the Worker. The Worker of this
--              release writes and reads the four 0236 label columns (fees, lots,
--              movements, returns, the stock-in report, History); a Worker
--              deployed before 0236 fails on the missing columns. This file
--              itself changes no column and no row. Apply it before the cutover
--              snapshot pass so the label fill is revision-neutral.
-- Recovery:    DROP TRIGGER stock_revision_product_batches_update; then
--              recreate it from 0124_stock_session_operations.sql (AFTER UPDATE
--              ON product_batches, same WHEN and body). Revisions already bumped
--              stay bumped; nothing else is affected.

DROP TRIGGER IF EXISTS stock_revision_product_batches_update;
CREATE TRIGGER stock_revision_product_batches_update AFTER UPDATE OF
  id, variant_product_id, batch_key, lot_code, expiry_date, received_at, is_active, notes, synthetic,
  created_at, updated_at, batch_number, supplier_id, supplier_name, payment_status, credit_due_date,
  unit_cost_usd, received_quantity, received_branch_id, received_cost_usd
ON product_batches
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  SELECT 'batch', entity_key, 1 FROM (SELECT CAST(OLD.id AS TEXT) entity_key UNION SELECT CAST(NEW.id AS TEXT))
  WHERE 1
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  SELECT 'batch_identity', entity_key, 1 FROM (
    SELECT CAST(OLD.variant_product_id AS TEXT) || ':' || OLD.batch_key entity_key
    UNION SELECT CAST(NEW.variant_product_id AS TEXT) || ':' || NEW.batch_key
  )
  WHERE 1
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;
