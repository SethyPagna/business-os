-- DATA-AUDIT lane B (stock & cost), query 14 of 16: the cost a lot carries against the cost its receipt movements recorded.
-- Owner ask 7 Oct 2026: "compare all the backend data for any inconsistencies or logic that isn't consistent".
--
-- Owner rule (cost, 25 Sep 2026; cutover lots 6 Oct): the cost of a lot is the cost it was RECEIVED at (an 'add' movement with unit_cost_usd and batch_id), until a
-- manual cost entry or a stock-in edit re-prices it on purpose. So a lot whose unit cost matches none of its receipts is either a deliberate edit (sized here, never
-- a defect by itself) or a path that rewrote the cost without a record. The arithmetic of a receipt row, unit x quantity = total, has no legitimate exception.
-- Kept separate from audit-b-lots-and-cost-gaps.sql because this one reads inventory_movements (add rows only, reached through idx_inventory_movements_batch_id).
-- Not repeated: audit-b-catalog-cost.sql (the product figure), audit-b-lots-and-cost-gaps.sql (zero / unknown cost sizing, received_cost drift).
--
-- One row. Zero-expected:
--   add_movements_total_mismatch       'add' movements with unit cost and total cost whose unit x quantity is more than 0.01 away from the total
--   add_movements_cost_without_lot_cost  'add' movements on a lot carrying a recorded cost > 0 while the lot's unit cost is NULL (cost was recorded, then lost)
--   Info columns:
--   lots_with_receipts                 lots with at least one 'add' movement
--   lots_cost_differs_from_all_receipts  lots with a recorded cost whose receipts all carry a different recorded cost (an edit, a manual entry, or an unrecorded rewrite)
--   lots_cost_differs_units            the stock units on hand in those lots
--   lots_costed_without_receipts       lots with a recorded cost and no 'add' movement at all (imports, cutover, hand-made lots)
--   lots_receipts_without_cost         lots with receipts but none carries a cost, while the lot itself does
--   add_movements_zero_cost            'add' movements on a lot recorded at exactly 0
--   examples                           up to 5 [lot_id, product_id, lot_cost, newest_receipt_cost], the largest gap first
-- Measured cost: one pass over the add movements that name a lot and one over product_batches; see the scale test output (test-audit-b-scale-workerd.cjs).
-- Measured at production scale (workerd D1, 121 ms best of 5 on an idle host, 161k rows read; fixture = 6 Oct 2026 inventory, test-audit-b-scale-workerd.cjs; a loaded host runs 2-3x slower).
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero add_movements_total_mismatch,add_movements_cost_without_lot_cost
WITH rc AS MATERIALIZED (
  SELECT m.batch_id AS batch_id,
    COUNT(*) AS n,
    COALESCE(SUM(CASE WHEN typeof(m.unit_cost_usd) IN ('integer', 'real') AND m.unit_cost_usd > 0 THEN 1 ELSE 0 END), 0) AS costed,
    COALESCE(SUM(CASE WHEN typeof(m.unit_cost_usd) IN ('integer', 'real') AND m.unit_cost_usd > 0 AND ABS(m.unit_cost_usd - COALESCE(b.unit_cost_usd, -1)) <= 0.00001 THEN 1 ELSE 0 END), 0) AS matching,
    MAX(CASE WHEN typeof(m.unit_cost_usd) IN ('integer', 'real') AND m.unit_cost_usd > 0 THEN m.unit_cost_usd END) AS max_cost,
    COALESCE(SUM(CASE WHEN m.unit_cost_usd = 0 THEN 1 ELSE 0 END), 0) AS zero_cost,
    COALESCE(SUM(CASE WHEN m.unit_cost_usd IS NOT NULL AND m.total_cost_usd IS NOT NULL AND ABS(m.unit_cost_usd * m.quantity - m.total_cost_usd) > 0.01 THEN 1 ELSE 0 END), 0) AS bad_total
  FROM inventory_movements m
  LEFT JOIN product_batches b ON b.id = m.batch_id
  WHERE m.movement_type = 'add' AND m.batch_id IS NOT NULL
  GROUP BY m.batch_id
), lt AS MATERIALIZED (
  SELECT b.id, b.variant_product_id AS p, b.unit_cost_usd AS cost, (typeof(b.unit_cost_usd) IN ('integer', 'real') AND b.unit_cost_usd > 0) AS rc_cost, rc.n, rc.costed, rc.matching, rc.max_cost, rc.zero_cost, rc.bad_total,
    COALESCE((SELECT SUM(quantity) FROM branch_batch_stock s WHERE s.batch_id = b.id AND s.quantity > 0), 0) AS q
  FROM product_batches b
  LEFT JOIN rc ON rc.batch_id = b.id
), ag AS MATERIALIZED (
  SELECT
    COALESCE(SUM(bad_total), 0) AS add_movements_total_mismatch,
    COALESCE(SUM(CASE WHEN cost IS NULL THEN costed END), 0) AS add_movements_cost_without_lot_cost,
    COALESCE(SUM(CASE WHEN n > 0 THEN 1 ELSE 0 END), 0) AS lots_with_receipts,
    COALESCE(SUM(CASE WHEN rc_cost = 1 AND costed > 0 AND matching = 0 THEN 1 ELSE 0 END), 0) AS lots_cost_differs_from_all_receipts,
    COALESCE(SUM(CASE WHEN rc_cost = 1 AND costed > 0 AND matching = 0 THEN q END), 0) AS lots_cost_differs_units,
    COALESCE(SUM(CASE WHEN rc_cost = 1 AND n IS NULL THEN 1 ELSE 0 END), 0) AS lots_costed_without_receipts,
    COALESCE(SUM(CASE WHEN rc_cost = 1 AND n > 0 AND costed = 0 THEN 1 ELSE 0 END), 0) AS lots_receipts_without_cost,
    COALESCE(SUM(zero_cost), 0) AS add_movements_zero_cost
  FROM lt
)
SELECT ag.*,
  (SELECT COALESCE(json_group_array(json_array(id, p, cost, max_cost)), '[]')
    FROM (SELECT id, p, cost, max_cost FROM lt WHERE rc_cost = 1 AND costed > 0 AND matching = 0
      ORDER BY ABS(cost - max_cost) DESC, id LIMIT 5)) AS examples
FROM ag
