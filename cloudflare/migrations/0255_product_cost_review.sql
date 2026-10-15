ALTER TABLE products ADD COLUMN cost_review_key TEXT DEFAULT NULL
  CHECK(cost_review_key IS NULL OR (typeof(cost_review_key)='text' AND length(cost_review_key)=32 AND cost_review_key NOT GLOB '*[^0-9a-f]*'));
CREATE INDEX audit_product_cost_review_0255 ON audit_logs(entity_id,
  json_extract(CASE WHEN json_valid(details) THEN details ELSE '{}' END,'$.cost_review.before_key'),
  json_extract(CASE WHEN json_valid(details) THEN details ELSE '{}' END,'$.cost_review.after_key'),
  json_extract(CASE WHEN json_valid(details) THEN details ELSE '{}' END,'$.cost_review.revision_before'))
  WHERE action='cost_override' AND entity='product' AND json_extract(CASE WHEN json_valid(details) THEN details ELSE '{}' END,'$.cost_review.version')=1;
CREATE TRIGGER product_cost_review_insert_guard_0255 BEFORE INSERT ON products
WHEN NEW.cost_review_key IS NOT NULL
BEGIN SELECT RAISE(ABORT,'product_cost_review_write_refused'); END;
CREATE TRIGGER product_cost_review_update_guard_0255 BEFORE UPDATE OF cost_review_key ON products
WHEN NEW.cost_review_key IS NOT OLD.cost_review_key
  AND NOT (NEW.cost_review_key IS NULL AND EXISTS(SELECT 1 FROM products WHERE id=OLD.id AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL))
    AND NEW.cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)))))
  AND NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.action='cost_override' AND a.entity='product' AND a.entity_id=CAST(OLD.id AS TEXT)
    AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.version')=1 AND json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.kind') IN ('merge','merge_undo')
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
      OR json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.kind')='merge' AND (NEW.cost_review_key IS NULL OR json_extract(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END,'$.cost_review.operation_key')=NEW.cost_review_key)))
BEGIN SELECT RAISE(ABORT,'product_cost_review_write_refused'); END;
DROP TRIGGER catalog_cost_on_hand_stock_insert_0195;
DROP TRIGGER catalog_cost_on_hand_stock_update_0195;
DROP TRIGGER catalog_cost_on_hand_stock_delete_0195;
DROP TRIGGER catalog_cost_on_hand_lot_insert_0195;
DROP TRIGGER catalog_cost_on_hand_lot_delete_0195;
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
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (NEW.batch_id)) AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
  UPDATE products SET cost_review_key=NULL WHERE is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (NEW.batch_id)) AND cost_review_key IS NOT NULL
    AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)) AND cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
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
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (OLD.batch_id, NEW.batch_id)) AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
  UPDATE products SET cost_review_key=NULL WHERE is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (OLD.batch_id, NEW.batch_id)) AND cost_review_key IS NOT NULL
    AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)) AND cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
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
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (OLD.batch_id)) AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
  UPDATE products SET cost_review_key=NULL WHERE is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (OLD.batch_id)) AND cost_review_key IS NOT NULL
    AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)) AND cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
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
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE is_active = 1 AND id = NEW.variant_product_id AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
  UPDATE products SET cost_review_key=NULL WHERE is_active = 1 AND id = NEW.variant_product_id AND cost_review_key IS NOT NULL
    AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)) AND cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
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
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE is_active = 1 AND id = OLD.variant_product_id AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
  UPDATE products SET cost_review_key=NULL WHERE is_active = 1 AND id = OLD.variant_product_id AND cost_review_key IS NOT NULL
    AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)) AND cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
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
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE is_active=1 AND id IN (OLD.variant_product_id,NEW.variant_product_id) AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
  UPDATE products SET cost_review_key=NULL WHERE is_active=1 AND id IN (OLD.variant_product_id,NEW.variant_product_id) AND cost_review_key IS NOT NULL
    AND EXISTS(SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)) AND cost_price_usd IS (COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)));
END;
