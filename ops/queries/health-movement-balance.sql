-- health-movement-balance: does the movement ledger still explain on-hand stock?
-- (DATA-MATCH DM-05). For a product or a (product, branch) pair,
--   implied_opening = on-hand now - SUM(signed movements)
-- on-hand is branch_stock; the sign comes from movement_type exactly as the Stock Change
-- ledger derives it (stockLedgerQuery.ts movementSignedQuantitySql, LEDGER_OUT_TYPES).
-- A correct stock write changes on-hand and adds a movement of the same size, so
-- implied_opening does not move. Old rows (legacy imports, direction-less 'set' rows) make
-- it non-zero but CONSTANT, so this is a RATCHET check: compare every column with the last
-- run's decrypted file. Take the pair of runs at the same instant (before and after a deploy,
-- shop closed) and any change is a change the deploy made.
-- Four writers move it WITHOUT a missing movement, so a change is explained only when the
-- context counters moved too:
--   * product merge that carries stock (routes/products.ts): the keeper gets an 'adjustment' for
--     the duplicate's stock AND the duplicate's own movements -> merge_adjustment_rows; the
--     keeper's implied_opening drops by the duplicate's on-hand (the F1 double count)
--   * damaged pool (lib/returnsStock.ts, routes/sales.ts, lib/damagedLotActions.ts): units held in
--     damaged_stock_lots are not in branch_stock but 'damage_in' / 'damage_out' / 'write_off' /
--     'damage_reversal' rows are in the ledger -> held_movement_rows, held_pool_units
--   * products import: writes stock with no movement; the rows query names its lot (import_lot_id)
--   * branch cutover: moves mass between pairs, so only the pair_* columns move, never product_*
--   * a backup restore resets everything: take a new baseline after one
-- product_checksum / pair_checksum moved while merge_adjustment_rows, held_movement_rows and
-- held_pool_units did not and no import or restore ran: stock moved with no movement ->
-- run health-movement-balance-rows.
-- One pass over inventory_movements, grouped per pair.
-- ops:min-rows 1
-- ops:max-rows 1
WITH mv AS MATERIALIZED (
  SELECT COALESCE(product_id, -1) AS pid, COALESCE(branch_id, -1) AS bid,
    SUM(CASE WHEN movement_type IN ('remove', 'sale', 'supplier_return', 'return_reversal', 'transfer_out',
        'row_move_out', 'move_out', 'write_off', 'damage_out', 'replacement_out', 'out')
      THEN -ABS(COALESCE(quantity, 0)) ELSE ABS(COALESCE(quantity, 0)) END) AS net,
    COUNT(*) AS n,
    SUM(CASE WHEN movement_type IN ('damage_in', 'damage_out', 'damage_reversal') OR COALESCE(reference_id, '') LIKE 'damaged_lot:%' THEN 1 ELSE 0 END) AS held_rows,
    SUM(CASE WHEN movement_type = 'adjustment' AND COALESCE(reason, '') LIKE 'Merged duplicate product %' THEN 1 ELSE 0 END) AS merge_rows
  FROM inventory_movements
  GROUP BY COALESCE(product_id, -1), COALESCE(branch_id, -1)
),
pair_imp AS MATERIALIZED (
  SELECT pid, bid, SUM(v) AS implied FROM (
    SELECT product_id AS pid, branch_id AS bid, quantity AS v FROM branch_stock
    UNION ALL
    SELECT pid, bid, -net FROM mv
  ) GROUP BY pid, bid
),
prod_imp AS MATERIALIZED (
  SELECT pid, SUM(implied) AS implied FROM pair_imp GROUP BY pid
)
SELECT
  (SELECT COUNT(*) FROM prod_imp) AS products_seen,
  (SELECT COUNT(*) FROM prod_imp WHERE ABS(implied) > 0.000001) AS products_unbalanced,
  (SELECT ROUND(COALESCE(SUM(ABS(implied)), 0), 4) FROM prod_imp) AS product_abs_implied,
  (SELECT ROUND(COALESCE(SUM(implied * ((pid % 997) + 1)), 0), 4) FROM prod_imp) AS product_checksum,
  (SELECT COUNT(*) FROM pair_imp WHERE ABS(implied) > 0.000001) AS pairs_unbalanced,
  (SELECT ROUND(COALESCE(SUM(ABS(implied)), 0), 4) FROM pair_imp) AS pair_abs_implied,
  (SELECT ROUND(COALESCE(SUM(implied * ((pid % 997) + 1) * ((bid % 13) + 2)), 0), 4) FROM pair_imp) AS pair_checksum,
  (SELECT COALESCE(SUM(n), 0) FROM mv) AS movement_rows,
  (SELECT COALESCE(SUM(merge_rows), 0) FROM mv) AS merge_adjustment_rows,
  (SELECT COALESCE(SUM(held_rows), 0) FROM mv) AS held_movement_rows,
  (SELECT ROUND(COALESCE(SUM(quantity_remaining), 0), 4) FROM damaged_stock_lots) AS held_pool_units,
  (SELECT MAX(id) FROM inventory_movements) AS max_movement_id,
  datetime('now') AS checked_at_utc
