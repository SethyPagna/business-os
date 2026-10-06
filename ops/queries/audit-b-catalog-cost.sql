-- DATA-AUDIT lane B (stock & cost), query 11 of 16: the stored catalog cost against the cost recomputed from the lots on hand.
-- Owner ask 7 Oct 2026: "compare all the backend data for any inconsistencies or logic that isn't consistent".
--
-- Owner ruling 25 Sep 2026 (migration 0195, lib/catalogCostRecompute.ts CATALOG_COST_DERIVE_SQL): products.cost_price_usd (mirrored into
-- purchase_price_usd) is the QUANTITY-WEIGHTED cost of the stock ON HAND, SUM(on-hand qty x unit cost) / SUM(on-hand qty), nearest 4dp
-- (half away from zero), over the active lots of the product that have a RECORDED cost (> 0; 0 and NULL mean "not recorded" and leave both sums),
-- on-hand quantity summed over every branch (branch_batch_stock rows above 0). A manual cost entry (product_cost_entries, the latest one) resets the
-- baseline: lots with id above its baseline_batch_id count at their own cost, and the entry's cost counts with the on-hand quantity of the
-- ACTIVE lots at or below the baseline (the stock the owner re-priced). With nothing on hand the newest eligible lot's cost stands in (received_at,
-- then id); with nothing eligible the stored figure is left alone. The 0195 triggers recompute when branch_batch_stock quantity changes or a lot row is
-- inserted / deleted; they do NOT fire when a lot's unit_cost_usd, is_active or received_at is edited or a manual entry is added (the routes recompute).
-- So a non-zero drift here names a path that changed an input and did not recompute. This query restates the formula SET-BASED (the app's text is a
-- correlated per-product sub-query that would trip D1's CPU limit across the catalog); the paired test proves it agrees with the triggers on a migrated
-- database, including an override and a sold-out fallback.
--
-- One row, ACTIVE products only (removed / merged-away rows are frozen history and are never re-derived). Zero-expected:
--   catalog_cost_drift          products whose stored cost_price_usd differs from the derived figure by more than 0.00001
--   Info columns:
--   active_products             the products read
--   products_with_derivation    of them, products the formula can price (a costed lot or a manual entry)
--   drift_stored_zero           drifting products whose stored cost is 0 or NULL (the catalog says free while costed lots exist)
--   drift_stored_higher / drift_stored_lower   drifting products stored above / below the derived figure
--   drift_abs_sum_usd           the sum of |stored - derived| over the drifting products, in USD per unit (a size, not a valuation)
--   cost_without_basis          products with a stored cost above 0 and no costed lot and no manual entry (a figure nothing explains)
--   purchase_cost_differs       products whose purchase_price_usd differs from cost_price_usd (the mirror the triggers keep)
--   manual_entries / overridden_products   product_cost_entries rows / products whose latest entry still re-prices on-hand stock
--   examples                    up to 5 [product_id, stored, derived, on_hand_units], the largest gap first
-- Needs migration: 0195 (catalog cost triggers) and 0177 (product_cost_entries); production has applied them (a missing table makes the statement fail loudly, never report 0).
-- Measured cost: one pass each over branch_batch_stock (positive rows), product_batches and products with set-based joins; see the scale test output
-- (test-audit-b-scale-workerd.cjs).
-- Measured at production scale (workerd D1, 73 ms best of 5 on an idle host, 274k rows read; fixture = 6 Oct 2026 inventory, test-audit-b-scale-workerd.cjs; a loaded host runs 2-3x slower).
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero catalog_cost_drift
WITH pos AS MATERIALIZED (
  SELECT batch_id, SUM(quantity) AS q FROM branch_batch_stock WHERE quantity > 0 GROUP BY batch_id
), ce AS MATERIALIZED (
  SELECT e.product_id, e.cost_usd, e.baseline_batch_id
  FROM product_cost_entries e
  JOIN (SELECT product_id, MAX(id) AS mid FROM product_cost_entries GROUP BY product_id) m ON m.mid = e.id
), el AS MATERIALIZED (
  SELECT pb.variant_product_id AS product_id, pb.id, pb.unit_cost_usd AS cost, pb.received_at, pos.q AS q
  FROM product_batches pb
  LEFT JOIN ce ON ce.product_id = pb.variant_product_id
  LEFT JOIN pos ON pos.batch_id = pb.id
  WHERE pb.is_active = 1 AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
    AND (ce.product_id IS NULL OR pb.id > ce.baseline_batch_id)
), ov AS MATERIALIZED (
  SELECT ce.product_id, ce.cost_usd AS cost, SUM(pos.q) AS q
  FROM ce
  JOIN product_batches ob ON ob.variant_product_id = ce.product_id AND ob.is_active = 1 AND ob.id <= ce.baseline_batch_id
  JOIN pos ON pos.batch_id = ob.id
  WHERE ce.cost_usd IS NOT NULL AND ce.cost_usd > 0
  GROUP BY ce.product_id
), tm AS MATERIALIZED (
  SELECT product_id, cost, q FROM el WHERE q > 0
  UNION ALL
  SELECT product_id, cost, q FROM ov
), dv AS MATERIALIZED (
  SELECT product_id, SUM(q) AS tq, SUM(q * cost) AS tc FROM tm GROUP BY product_id
), nw AS MATERIALIZED (
  SELECT product_id, cost FROM (
    SELECT product_id, cost, ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY COALESCE(received_at, '') DESC, id DESC) AS rn FROM el
  ) WHERE rn = 1
), px AS MATERIALIZED (
  SELECT p.id, p.cost_price_usd AS stored, p.purchase_price_usd AS purchase,
    COALESCE(CASE WHEN dv.tq > 0 THEN CAST(dv.tc / dv.tq * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END, nw.cost) AS derived,
    COALESCE(dv.tq, 0) AS on_hand,
    (ce.product_id IS NOT NULL) AS has_entry
  FROM products p
  LEFT JOIN dv ON dv.product_id = p.id
  LEFT JOIN nw ON nw.product_id = p.id
  LEFT JOIN ce ON ce.product_id = p.id
  WHERE p.is_active = 1
), bad AS MATERIALIZED (
  SELECT id, stored, derived, on_hand FROM px WHERE derived IS NOT NULL AND ABS(COALESCE(stored, 0) - derived) > 0.00001
)
SELECT
  (SELECT COUNT(*) FROM bad) AS catalog_cost_drift,
  (SELECT COUNT(*) FROM px) AS active_products,
  (SELECT COUNT(*) FROM px WHERE derived IS NOT NULL) AS products_with_derivation,
  (SELECT COUNT(*) FROM bad WHERE COALESCE(stored, 0) = 0) AS drift_stored_zero,
  (SELECT COUNT(*) FROM bad WHERE COALESCE(stored, 0) > derived) AS drift_stored_higher,
  (SELECT COUNT(*) FROM bad WHERE COALESCE(stored, 0) < derived AND COALESCE(stored, 0) <> 0) AS drift_stored_lower,
  (SELECT COALESCE(SUM(ABS(COALESCE(stored, 0) - derived)), 0) FROM bad) AS drift_abs_sum_usd,
  (SELECT COUNT(*) FROM px WHERE derived IS NULL AND COALESCE(stored, 0) > 0 AND has_entry = 0) AS cost_without_basis,
  (SELECT COUNT(*) FROM px WHERE ABS(COALESCE(purchase, 0) - COALESCE(stored, 0)) > 0.00001) AS purchase_cost_differs,
  (SELECT COUNT(*) FROM product_cost_entries) AS manual_entries,
  (SELECT COUNT(*) FROM ov) AS overridden_products,
  (SELECT COALESCE(json_group_array(json_array(id, stored, derived, on_hand)), '[]')
    FROM (SELECT id, stored, derived, on_hand FROM bad ORDER BY ABS(COALESCE(stored, 0) - derived) DESC, id LIMIT 5)) AS examples
