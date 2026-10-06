-- DATA-AUDIT lane B (stock & cost), query 8 of 14: customer-return stock effects against the return lines.
-- Owner ask 7 Oct 2026: "compare all the backend data for any inconsistencies or logic that isn't consistent".
--
-- Rules (lib/returnsStock.ts, routes/returns.ts, lib/returnBulkAction.ts; owner rulings 14-15 Sep and 29 Sep):
--   * each customer return line carries a stock action: restock (units go back on the shelf: a 'return' movement, quantity +), damaged (the units
--     become a tagged damaged_stock_lots row and a 'damage_in' movement, never sellable stock) or none (nothing moves);
--   * an edit reverses the old restock ('return_reversal', stored negative) and writes the new lines; a cancel reverses every line ('return_reversal'
--     and 'damage_reversal'), a restore re-applies them (reason 'Undo grouped return status');
--   * a Replace hands out stock: one 'replacement_out' movement (stored negative) per return_replacement_items row;
--   * lots: every restocked line records the lots it went back into (return_item_batch_allocations, summing to the line); a cancel never marks them.
-- A return against a sale whose stock was never deducted double-counts (forensics-r0-return-on-undeducted-sale.sql, not repeated); over-returned lines,
-- cancelled-return edits, lot inflation and lot misattribution are forensics-s2 / s3 / s4 / s5 (not repeated).
-- Per (return, product, branch) net movement is read through the return id (index reference_id, movement_type) -- movements that name a SALE with
-- the same number are told apart by the reason ('Return: ...', 'Return #...', 'Apply/Undo grouped return status', or a *_reversal / damage type, which only
-- returns write), exactly as forensics-r0 does. Lines with no product or branch write no movement and are left out.
--
-- One row, zero-expected columns (a non-zero value is a defect; counts are GROUPS = (return, product, branch) unless the column says lines):
--   restock_short              a live return whose restock lines moved LESS stock than they claim (including never restocked)
--   restock_excess             a live return that restocked MORE than its restock lines (a damaged / none line, or an edit, that moved sellable stock: the double count)
--   cancelled_return_still_in  a cancelled return whose restock was not taken back (net above 0)
--   cancelled_return_over_reversed  a cancelled return whose restock was taken back more than once (net below 0)
--   damage_movement_mismatch   damage_in minus damage_reversal differs from the damaged lines (0 for a cancelled return)
--   damaged_lot_mismatch       damaged_stock_lots of the return do not add up to its damaged lines
--   replacement_mismatch       replacement_out units differ from the return's replacement items
--   allocation_sum_mismatch    LINES whose lot rows do not add up to the line (restock) or exist at all (damaged / none)
--   allocation_lot_other_product  lot rows of a return line that name another product's lot
--   Info columns:
--   returns_checked / return_groups   customer returns with at least one line / their groups
--   returns_without_any_movement      customer returns with restock or damaged lines and no stock movement at all (mostly old-system rows)
--   restock_lines_without_allocation  restock lines with no lot row (a legacy single-lot line, or a restock that missed its lot ledger)
--   mismatch_first_return_at / _last_return_at   returns.created_at range over the groups counted above (the era)
--   examples                   up to 5 [return_id, product_id, branch_id, status, restock_units, restock_net, damaged_units, damage_net], the largest gap first
-- Measured cost: one grouped pass over return_items (a few hundred to a few thousand rows) and, per group, index probes on reference_id into
-- inventory_movements; see the scale test output (test-audit-b-scale-workerd.cjs).
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero restock_short,restock_excess,cancelled_return_still_in,cancelled_return_over_reversed,damage_movement_mismatch,damaged_lot_mismatch,replacement_mismatch,allocation_sum_mismatch,allocation_lot_other_product
WITH li AS MATERIALIZED (
  SELECT ri.id, ri.return_id, ri.product_id, COALESCE(ri.branch_id, r.branch_id) AS branch_id, ri.quantity AS q, r.status AS status, r.created_at AS return_at,
    COALESCE(ri.stock_action, CASE WHEN ri.return_to_stock = 1 THEN 'restock' ELSE 'none' END) AS act
  FROM return_items ri
  JOIN returns r ON r.id = ri.return_id
  WHERE COALESCE(r.return_scope, 'customer') = 'customer'
), g AS MATERIALIZED (
  SELECT return_id, product_id, branch_id, status, MIN(return_at) AS return_at,
    SUM(CASE WHEN act = 'restock' THEN q ELSE 0 END) AS ru,
    SUM(CASE WHEN act = 'damaged' THEN q ELSE 0 END) AS du
  FROM li
  WHERE product_id IS NOT NULL AND branch_id IS NOT NULL
  GROUP BY return_id, product_id, branch_id
), gm AS MATERIALIZED (
  SELECT g.*,
    COALESCE((SELECT SUM(CASE WHEN m.movement_type = 'return' THEN ABS(m.quantity) ELSE -ABS(m.quantity) END)
      FROM inventory_movements m
      WHERE m.reference_id = g.return_id AND m.product_id = g.product_id AND m.branch_id = g.branch_id
        AND (m.movement_type = 'return_reversal'
          OR (m.movement_type = 'return' AND (COALESCE(m.reason, '') LIKE 'Return: %' OR COALESCE(m.reason, '') LIKE 'Return #%'
            OR COALESCE(m.reason, '') IN ('Apply grouped return status', 'Undo grouped return status'))))), 0) AS rn,
    COALESCE((SELECT SUM(CASE WHEN m.movement_type = 'damage_in' THEN ABS(m.quantity) ELSE -ABS(m.quantity) END)
      FROM inventory_movements m
      WHERE m.reference_id = g.return_id AND m.product_id = g.product_id AND m.branch_id = g.branch_id
        AND (m.movement_type = 'damage_reversal'
          OR (m.movement_type = 'damage_in' AND (COALESCE(m.reason, '') LIKE 'Return: %' OR COALESCE(m.reason, '') LIKE 'Return #%'
            OR COALESCE(m.reason, '') IN ('Apply grouped return status', 'Undo grouped return status'))))), 0) AS dn,
    COALESCE((SELECT SUM(d.quantity) FROM damaged_stock_lots d
      WHERE d.return_id = g.return_id AND d.product_id = g.product_id AND d.branch_id IS g.branch_id), 0) AS dl
  FROM g
), rg AS MATERIALIZED (
  SELECT rp.return_id, rp.product_id, rp.branch_id, SUM(rp.quantity) AS pu,
    COALESCE((SELECT SUM(ABS(m.quantity)) FROM inventory_movements m
      WHERE m.reference_id = rp.return_id AND m.product_id = rp.product_id AND m.branch_id IS rp.branch_id AND m.movement_type = 'replacement_out'), 0) AS pn
  FROM return_replacement_items rp
  WHERE rp.product_id IS NOT NULL
  GROUP BY rp.return_id, rp.product_id, rp.branch_id
), la AS MATERIALIZED (
  SELECT li.id, li.act, li.q, COUNT(a.id) AS n, COALESCE(SUM(a.quantity), 0) AS total,
    SUM(CASE WHEN pb.id IS NOT NULL AND pb.variant_product_id IS NOT li.product_id THEN 1 ELSE 0 END) AS other_product
  FROM li
  LEFT JOIN return_item_batch_allocations a ON a.return_item_id = li.id
  LEFT JOIN product_batches pb ON pb.id = a.batch_id
  GROUP BY li.id
), bad AS MATERIALIZED (
  SELECT return_id, product_id, branch_id, status, ru, rn, du, dn, return_at FROM gm
  WHERE (COALESCE(status, 'completed') <> 'cancelled' AND (ABS(rn - ru) > 0.000001 OR ABS(dn - du) > 0.000001))
    OR (status = 'cancelled' AND (ABS(rn) > 0.000001 OR ABS(dn) > 0.000001))
    OR ABS(dl - du) > 0.000001
)
SELECT
  (SELECT COUNT(*) FROM gm WHERE COALESCE(status, 'completed') <> 'cancelled' AND ru > 0 AND rn < ru - 0.000001) AS restock_short,
  (SELECT COUNT(*) FROM gm WHERE COALESCE(status, 'completed') <> 'cancelled' AND rn > ru + 0.000001) AS restock_excess,
  (SELECT COUNT(*) FROM gm WHERE status = 'cancelled' AND rn > 0.000001) AS cancelled_return_still_in,
  (SELECT COUNT(*) FROM gm WHERE status = 'cancelled' AND rn < -0.000001) AS cancelled_return_over_reversed,
  (SELECT COUNT(*) FROM gm WHERE ABS(dn - CASE WHEN status = 'cancelled' THEN 0 ELSE du END) > 0.000001) AS damage_movement_mismatch,
  (SELECT COUNT(*) FROM gm WHERE ABS(dl - du) > 0.000001) AS damaged_lot_mismatch,
  (SELECT COUNT(*) FROM rg WHERE ABS(pn - pu) > 0.000001) AS replacement_mismatch,
  (SELECT COUNT(*) FROM la WHERE (act = 'restock' AND n > 0 AND ABS(total - q) > 0.000001) OR (act <> 'restock' AND n > 0)) AS allocation_sum_mismatch,
  (SELECT COALESCE(SUM(other_product), 0) FROM la) AS allocation_lot_other_product,
  (SELECT COUNT(DISTINCT return_id) FROM li) AS returns_checked,
  (SELECT COUNT(*) FROM g) AS return_groups,
  (SELECT COUNT(*) FROM (SELECT return_id FROM g GROUP BY return_id HAVING SUM(ru + du) > 0) t
    WHERE NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.reference_id = t.return_id AND m.movement_type IN ('return', 'return_reversal', 'damage_in', 'damage_reversal'))) AS returns_without_any_movement,
  (SELECT COUNT(*) FROM la WHERE act = 'restock' AND n = 0) AS restock_lines_without_allocation,
  (SELECT MIN(return_at) FROM bad) AS mismatch_first_return_at,
  (SELECT MAX(return_at) FROM bad) AS mismatch_last_return_at,
  (SELECT COALESCE(json_group_array(json_array(return_id, product_id, branch_id, status, ru, rn, du, dn)), '[]')
    FROM (SELECT return_id, product_id, branch_id, status, ru, rn, du, dn FROM bad ORDER BY MAX(ABS(rn - ru), ABS(dn - du)) DESC, return_id, product_id LIMIT 5)) AS examples
