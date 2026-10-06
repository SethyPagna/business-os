-- DATA-AUDIT lane B (stock & cost), query 3 of 14: replay the movement ledger against current branch stock.
-- Owner ask 7 Oct 2026: "compare all the backend data for any inconsistencies or logic that isn't consistent".
--
-- For every (product, branch) pair that has movements, the net stock effect of its inventory_movements is summed with the
-- direction the TYPE implies (stockLedgerQuery.ts LEDGER_OUT_TYPES; never the stored sign, except the signed deltas a stock-in
-- line edit writes, reference 'stock-in-edit:...', and 'adjustment', which is stored signed). The balance the movements cannot
-- explain is the pair's OPENING balance:
--     opening = branch_stock.quantity - net movement effect
-- An opening above 0 is stock the log does not explain: it was on the shelf before the movement log began or arrived with no
-- movement (a legacy import, a dated count that set the figure), or an outflow was logged that never took the units. Mostly
-- legitimate (opening stock), and sized here. An opening BELOW 0 means the log claims MORE units than the shelf holds: units
-- left (or never arrived) without a movement row -- a silent lot drain, a deleted outflow row, an inflow logged but not applied
-- -- and no starting stock can explain it. The Stock Changes ledger hides this: it walks "before" backwards from the current
-- stock, so a negative opening only shows as a negative "before" on the pair's oldest row.
-- Pairs holding any type with no single sellable-stock effect ('set' legacy, damage_in / damage_out / write_off / damage_reversal,
-- supplier_return_reversal, or an unknown type) are COUNTED but not replayed: damage_out is both a tagged hold (sellable down)
-- and a sale from a damaged lot (no sellable change), and a legacy 'set' carries no direction.
-- Related, not repeated (run them as they are): forensics-s1-movement-id-gaps.sql (deleted movement rows),
-- forensics-s6-double-reverts.sql (reverts applied twice), stk-c-lot-drain-without-movement.sql (lot drains with no row).
--
-- One row. Zero-expected:
--   replay_pairs_opening_negative   replayable pairs whose log claims more units than the shelf holds (see above)
--   Info columns:
--   movement_pairs                  distinct (product, branch) pairs with at least one movement
--   replay_pairs                    of those, pairs replayed (no ambiguous type)
--   replay_pairs_exact              replayed pairs whose opening is 0 (the log explains the shelf exactly)
--   replay_pairs_opening_positive   replayed pairs with stock the log does not explain (mostly legacy opening stock)
--   replay_opening_positive_units   the units in those openings
--   replay_opening_negative_units   the units the log claims beyond the shelf, summed over those pairs (a positive number)
--   unreplayable_pairs              pairs holding an ambiguous type, not replayed
--   stock_pairs_without_movements   branch_stock rows above 0 whose pair has no movement at all
--   stock_units_without_movements   the units on them
--   movement_pairs_without_stock_row  pairs with movements, a net effect above 0 and no branch_stock row (the row was deleted)
--   examples_opening_negative       up to 5 [product_id, branch_id, opening, stock, net], the most negative first
-- Measured cost: one pass and one GROUP BY over inventory_movements (an index-less sort), then one probe per pair into
-- branch_stock; see the scale test output (test-audit-b-scale-workerd.cjs).
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero replay_pairs_opening_negative
WITH pair AS MATERIALIZED (
  SELECT product_id, branch_id,
    SUM(CASE
      WHEN typeof(quantity) NOT IN ('integer', 'real') THEN 0
      WHEN reference_id GLOB 'stock-in-edit:*' THEN quantity
      WHEN movement_type IN ('add', 'stock_in', 'in', 'csv_import', 'return', 'transfer_in', 'move_in') THEN ABS(quantity)
      WHEN movement_type IN ('remove', 'out', 'sale', 'supplier_return', 'return_reversal', 'transfer_out', 'move_out', 'row_move_out', 'replacement_out') THEN -ABS(quantity)
      WHEN movement_type = 'adjustment' THEN quantity
      ELSE 0 END) AS net,
    SUM(CASE
      WHEN reference_id GLOB 'stock-in-edit:*' THEN 0
      WHEN movement_type IN ('add', 'stock_in', 'in', 'csv_import', 'return', 'transfer_in', 'move_in', 'remove', 'out', 'sale', 'supplier_return',
        'return_reversal', 'transfer_out', 'move_out', 'row_move_out', 'replacement_out', 'adjustment') THEN 0
      ELSE 1 END) AS ambiguous
  FROM inventory_movements
  WHERE product_id IS NOT NULL AND branch_id IS NOT NULL
  GROUP BY product_id, branch_id
), joined AS MATERIALIZED (
  SELECT p.product_id, p.branch_id, p.net, p.ambiguous, bs.quantity AS stock, bs.id AS bs_id,
    COALESCE(bs.quantity, 0) - p.net AS opening
  FROM pair p
  LEFT JOIN branch_stock bs ON bs.product_id = p.product_id AND bs.branch_id = p.branch_id
), bad AS (
  SELECT product_id, branch_id, opening, stock, net FROM joined WHERE ambiguous = 0 AND opening < -0.000001
), orphan AS (
  SELECT COUNT(*) AS n, COALESCE(SUM(bs.quantity), 0) AS units
  FROM branch_stock bs
  WHERE bs.quantity > 0.000001
    AND NOT EXISTS (SELECT 1 FROM pair p WHERE p.product_id = bs.product_id AND p.branch_id = bs.branch_id)
)
SELECT
  (SELECT COUNT(*) FROM joined WHERE ambiguous = 0 AND opening < -0.000001) AS replay_pairs_opening_negative,
  (SELECT COUNT(*) FROM joined) AS movement_pairs,
  (SELECT COUNT(*) FROM joined WHERE ambiguous = 0) AS replay_pairs,
  (SELECT COUNT(*) FROM joined WHERE ambiguous = 0 AND ABS(opening) <= 0.000001) AS replay_pairs_exact,
  (SELECT COUNT(*) FROM joined WHERE ambiguous = 0 AND opening > 0.000001) AS replay_pairs_opening_positive,
  (SELECT COALESCE(SUM(opening), 0) FROM joined WHERE ambiguous = 0 AND opening > 0.000001) AS replay_opening_positive_units,
  (SELECT COALESCE(-SUM(opening), 0) FROM joined WHERE ambiguous = 0 AND opening < -0.000001) AS replay_opening_negative_units,
  (SELECT COUNT(*) FROM joined WHERE ambiguous <> 0) AS unreplayable_pairs,
  (SELECT n FROM orphan) AS stock_pairs_without_movements,
  (SELECT units FROM orphan) AS stock_units_without_movements,
  (SELECT COUNT(*) FROM joined WHERE bs_id IS NULL AND net > 0.000001) AS movement_pairs_without_stock_row,
  (SELECT COALESCE(json_group_array(json_array(product_id, branch_id, opening, stock, net)), '[]')
    FROM (SELECT product_id, branch_id, opening, stock, net FROM bad ORDER BY opening, product_id, branch_id LIMIT 5)) AS examples_opening_negative
