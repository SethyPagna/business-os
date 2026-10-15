DROP TRIGGER product_cost_review_update_guard_0255;
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
    (SELECT pb.unit_cost_usd FROM product_batches pb
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
