-- 0312: the sold-out fallback of the catalog-cost formula rounds to 4 places (six catalog-cost triggers and the cost-review guard).
--
-- Schema only: no table row is inserted, updated or deleted.
--
-- Owner rule (30 Sep 2026): costs are stored to 4 decimals, nearest, half away from zero. The catalog-cost formula
-- (src/lib/catalogCostRecompute.ts) has two branches. Branch 1, the on-hand weighted mean, has rounded with
-- CAST(x * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 since 0195. Branch 2, the sold-out fallback (nothing is on hand, so the newest
-- eligible lot's cost stands in), copied pb.unit_cost_usd verbatim: a lot at 1.00015 wrote 1.00015 into products.cost_price_usd and
-- purchase_price_usd. The six triggers below carry that formula (0195 names; text last defined by 0261), so they are dropped and
-- created again from catalogCostReviewTriggersSql() with the fallback wrapped in the same rounding. Nothing else in a trigger changes
-- (same events, same WHEN guards, same +is_active plan as 0261, same review-key clearing).
-- The cost-review guard product_cost_review_update_guard_0255 (text last defined by 0257) compares a cleared review key with the same
-- formula, so it is re-created from productCostReviewConfirmationGuardSql() too. Left alone, it would compare the rounded figure a
-- trigger wrote with its own verbatim derive and abort the stock write whenever a sold-out lot is over 4 decimals.
--
-- This migration does not repair a stored value. Products already over 4 decimals are rounded by the data repair 0313; lots over 4
-- decimals are rounded there too, so the triggers and the repair agree.
--
-- Assertions: a failed check reads a malformed JSON path and aborts the file.
-- PRE:  the six triggers and the guard exist.
-- POST: all seven exist, each carries the rounded fallback, and none still has the verbatim fallback text.
-- Idempotent: DROP TRIGGER IF EXISTS + CREATE; a second run lands on the same text.
-- Pinned by scripts/test-migration-0312-catalog-cost-fallback-rounding-pure.cjs.
--
-- RECOVERY (schema only): DROP TRIGGER IF EXISTS for the seven names below, then run the CREATE TRIGGER statement of
-- product_cost_review_update_guard_0255 from 0257_product_cost_review_confirmation.sql (equal to
-- productCostReviewConfirmationGuardSql({ inputPolicy: 'validated-unrounded' })) and the six CREATE TRIGGER statements of
-- 0261_trigger_index_plans.sql (from catalog_cost_on_hand_stock_insert_0195 to catalog_cost_review_lot_update_0255; equal to
-- catalogCostReviewTriggersSql({ inputPolicy: 'validated-unrounded' })).

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('catalog_cost_on_hand_stock_insert_0195','catalog_cost_on_hand_stock_update_0195','catalog_cost_on_hand_stock_delete_0195','catalog_cost_on_hand_lot_insert_0195','catalog_cost_on_hand_lot_delete_0195','catalog_cost_review_lot_update_0255','product_cost_review_update_guard_0255')) = 7
THEN 1 ELSE json_extract('[]','$[fallback_rounding_0312_pre_triggers_missing]') END;

DROP TRIGGER IF EXISTS product_cost_review_update_guard_0255;
CREATE TRIGGER product_cost_review_update_guard_0255 BEFORE UPDATE OF cost_review_key ON products
WHEN NEW.cost_review_key IS NOT OLD.cost_review_key
  AND NOT (NEW.cost_review_key IS NULL AND EXISTS(SELECT 1 FROM products WHERE id=OLD.id AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL))
    AND NEW.cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)))))
  AND NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.action='cost_override' AND a.entity='product' AND a.entity_id=CAST(OLD.id AS TEXT)
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.kind')='product.cost-review-confirm' AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.version')=1
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.version')=1 AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.kind')='confirm'
    AND OLD.cost_review_key IS NOT NULL AND NEW.cost_review_key IS NULL
    AND typeof(OLD.cost_price_usd) IN ('integer','real') AND OLD.cost_price_usd>=0 AND OLD.cost_price_usd<=1.7976931348623157e308
    AND NEW.cost_price_usd IS OLD.cost_price_usd AND NEW.cost_price_khr IS OLD.cost_price_khr AND NEW.selling_price_usd IS OLD.selling_price_usd AND NEW.selling_price_khr IS OLD.selling_price_khr AND NEW.wholesale_price_usd IS OLD.wholesale_price_usd AND NEW.wholesale_price_khr IS OLD.wholesale_price_khr AND NEW.purchase_price_usd IS OLD.purchase_price_usd AND NEW.purchase_price_khr IS OLD.purchase_price_khr
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.before_key') IS OLD.cost_review_key
    AND json_type(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.after_key')='null'
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.revision_before')=COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key=CAST(OLD.id AS TEXT)),0)
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.after_usd') IS NEW.cost_price_usd AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.after_khr') IS NEW.cost_price_khr)
  AND NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.action='cost_override' AND a.entity='product' AND a.entity_id=CAST(OLD.id AS TEXT)
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.version')=1 AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.kind') IN ('merge','merge_undo','merge_redo')
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.before_key') IS OLD.cost_review_key
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.after_key') IS NEW.cost_review_key
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.revision_before')=COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key=CAST(OLD.id AS TEXT)),0)
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.after_usd') IS NEW.cost_price_usd
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.after_khr') IS NEW.cost_price_khr
    AND (json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.kind')='merge_undo' AND EXISTS(SELECT 1 FROM action_history h
      WHERE h.id=json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.history_id')
        AND json_extract(h.undo_payload,'$.snapshot_id')=json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.snapshot_id')
        AND json_extract(h.undo_payload,'$.operation_id')=json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.merge_operation_id')
        AND json_extract(h.undo_payload,'$.generation')=json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.generation'))
      OR json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.kind') IN ('merge','merge_redo') AND (NEW.cost_review_key IS NULL OR json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.operation_key')=NEW.cost_review_key)))
BEGIN SELECT RAISE(ABORT,'product_cost_review_write_refused'); END;
DROP TRIGGER IF EXISTS catalog_cost_on_hand_stock_insert_0195;
DROP TRIGGER IF EXISTS catalog_cost_on_hand_stock_update_0195;
DROP TRIGGER IF EXISTS catalog_cost_on_hand_stock_delete_0195;
DROP TRIGGER IF EXISTS catalog_cost_on_hand_lot_insert_0195;
DROP TRIGGER IF EXISTS catalog_cost_on_hand_lot_delete_0195;
DROP TRIGGER IF EXISTS catalog_cost_review_lot_update_0255;
CREATE TRIGGER catalog_cost_on_hand_stock_insert_0195
AFTER INSERT ON branch_batch_stock
WHEN COALESCE(NEW.quantity, 0) > 0
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  UPDATE products SET
        cost_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE +is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (NEW.batch_id)) AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
  UPDATE products SET cost_review_key=NULL WHERE +is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (NEW.batch_id)) AND cost_review_key IS NOT NULL
    AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)) AND cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)));
END;

CREATE TRIGGER catalog_cost_on_hand_stock_update_0195
AFTER UPDATE OF quantity, batch_id ON branch_batch_stock
WHEN (COALESCE(OLD.quantity, 0) <> COALESCE(NEW.quantity, 0) OR OLD.batch_id IS NOT NEW.batch_id)
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  UPDATE products SET
        cost_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE +is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (OLD.batch_id, NEW.batch_id)) AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
  UPDATE products SET cost_review_key=NULL WHERE +is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (OLD.batch_id, NEW.batch_id)) AND cost_review_key IS NOT NULL
    AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)) AND cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)));
END;

CREATE TRIGGER catalog_cost_on_hand_stock_delete_0195
AFTER DELETE ON branch_batch_stock
WHEN COALESCE(OLD.quantity, 0) > 0
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  UPDATE products SET
        cost_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE +is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (OLD.batch_id)) AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
  UPDATE products SET cost_review_key=NULL WHERE +is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (OLD.batch_id)) AND cost_review_key IS NOT NULL
    AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)) AND cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)));
END;

CREATE TRIGGER catalog_cost_on_hand_lot_insert_0195
AFTER INSERT ON product_batches
WHEN NEW.variant_product_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  UPDATE products SET
        cost_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE +is_active = 1 AND id = NEW.variant_product_id AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
  UPDATE products SET cost_review_key=NULL WHERE +is_active = 1 AND id = NEW.variant_product_id AND cost_review_key IS NOT NULL
    AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)) AND cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)));
END;

CREATE TRIGGER catalog_cost_on_hand_lot_delete_0195
AFTER DELETE ON product_batches
WHEN OLD.variant_product_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  UPDATE products SET
        cost_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE +is_active = 1 AND id = OLD.variant_product_id AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
  UPDATE products SET cost_review_key=NULL WHERE +is_active = 1 AND id = OLD.variant_product_id AND cost_review_key IS NOT NULL
    AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)) AND cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)));
END;

CREATE TRIGGER catalog_cost_review_lot_update_0255
AFTER UPDATE OF unit_cost_usd,is_active,variant_product_id,received_at ON product_batches
WHEN NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  UPDATE products SET
        cost_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE +is_active=1 AND id IN (OLD.variant_product_id,NEW.variant_product_id) AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
  UPDATE products SET cost_review_key=NULL WHERE +is_active=1 AND id IN (OLD.variant_product_id,NEW.variant_product_id) AND cost_review_key IS NOT NULL
    AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)) AND cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)));
END;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('catalog_cost_on_hand_stock_insert_0195','catalog_cost_on_hand_stock_update_0195','catalog_cost_on_hand_stock_delete_0195','catalog_cost_on_hand_lot_insert_0195','catalog_cost_on_hand_lot_delete_0195','catalog_cost_review_lot_update_0255','product_cost_review_update_guard_0255')) = 7
THEN 1 ELSE json_extract('[]','$[fallback_rounding_0312_post_triggers_missing]') END;
SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('catalog_cost_on_hand_stock_insert_0195','catalog_cost_on_hand_stock_update_0195','catalog_cost_on_hand_stock_delete_0195','catalog_cost_on_hand_lot_insert_0195','catalog_cost_on_hand_lot_delete_0195','catalog_cost_review_lot_update_0255','product_cost_review_update_guard_0255')
  AND instr(sql, 'SELECT CAST(pb.unit_cost_usd * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 FROM product_batches pb') > 0) = 7
THEN 1 ELSE json_extract('[]','$[fallback_rounding_0312_post_fallback_not_rounded]') END;
SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('catalog_cost_on_hand_stock_insert_0195','catalog_cost_on_hand_stock_update_0195','catalog_cost_on_hand_stock_delete_0195','catalog_cost_on_hand_lot_insert_0195','catalog_cost_on_hand_lot_delete_0195','catalog_cost_review_lot_update_0255','product_cost_review_update_guard_0255')
  AND instr(sql, '(SELECT pb.unit_cost_usd FROM product_batches pb') > 0) = 0
THEN 1 ELSE json_extract('[]','$[fallback_rounding_0312_post_verbatim_fallback_left]') END;
