-- health-movement-balance: does the movement ledger still explain on-hand stock?
-- (DATA-MATCH DM-05). For a product or a (product, branch) pair,
--   implied_opening = on-hand now - SUM(signed movements)
-- where the sign comes from movement_type exactly as the Stock Change ledger
-- derives it (stockLedgerQuery.ts movementSignedQuantitySql, LEDGER_OUT_TYPES).
-- Every correct stock write changes on-hand and adds a movement of the same
-- size, so implied_opening does not move. It moves only when stock changed with
-- no movement (or a movement was written, deleted or re-signed with no stock
-- change). Old rows (legacy imports, direction-less 'set' rows) make it non-zero
-- but CONSTANT, so this is a RATCHET check: compare every column with the last
-- run's decrypted file; any change is new drift -> run health-movement-balance-rows.
-- One pass over inventory_movements, grouped per pair.
-- ops:min-rows 1
-- ops:max-rows 1
WITH mv AS MATERIALIZED (
  SELECT COALESCE(product_id, -1) AS pid, COALESCE(branch_id, -1) AS bid,
    SUM(CASE WHEN movement_type IN ('remove', 'sale', 'supplier_return', 'return_reversal', 'transfer_out',
        'row_move_out', 'move_out', 'write_off', 'damage_out', 'replacement_out', 'out')
      THEN -ABS(COALESCE(quantity, 0)) ELSE ABS(COALESCE(quantity, 0)) END) AS net,
    COUNT(*) AS n
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
  (SELECT MAX(id) FROM inventory_movements) AS max_movement_id,
  datetime('now') AS checked_at_utc
