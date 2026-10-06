-- DATA-AUDIT lane B (stock & cost), query 2 of 16: negative, missing or non-numeric quantities and costs, anywhere.
-- Owner ask 7 Oct 2026: "compare all the backend data for any inconsistencies or logic that isn't consistent".
--
-- branch_stock.quantity and branch_batch_stock.quantity carry CHECK (quantity >= 0), but a CHECK lets NULL through and
-- does not look at the stored type (a TEXT '5' passes a >= comparison in SQLite's ordering), products.stock_quantity has
-- no CHECK at all, and a negative can hide in any line, allocation, lot or movement row. This is one pass per table.
-- Sign convention of inventory_movements.quantity (the writers; stockLedgerQuery.ts decides the direction from the TYPE,
-- never from the sign): 'sale', 'replacement_out', 'return_reversal', 'damage_reversal' are stored NEGATIVE; add, remove,
-- return, damage_in, transfer_in/out, supplier_return are stored as a positive magnitude, except the rows a stock-in line
-- edit writes (reference 'stock-in-edit:...'), which are signed deltas and are left out of the positive-type check.
--
-- One row. Zero-expected columns (a non-zero value is a defect, named by the column):
--   products_stock_negative / products_stock_text   products.stock_quantity below 0, or stored as TEXT / BLOB
--   branch_stock_negative / branch_stock_not_number branch_stock.quantity below 0, or NULL / TEXT / BLOB
--   lot_stock_negative / lot_stock_not_number       branch_batch_stock.quantity, same
--   lots_received_quantity_negative                 product_batches.received_quantity below 0
--   lots_cost_negative                              unit_cost_usd or received_cost_usd below 0
--   lots_cost_not_number                            unit_cost_usd / received_cost_usd stored as TEXT / BLOB
--   sale_items_quantity_not_positive                sale_items.quantity NULL, 0 or negative
--   sale_items_returned_out_of_range                returned_quantity below 0 or above the line quantity
--   sale_allocations_not_positive / _released_out_of_range   sale_item_batch_allocations quantity <= 0; released_quantity
--                                                   below 0 or above quantity
--   return_items_quantity_not_positive / return_allocations_not_positive   return lines and their lot rows <= 0
--   transfers_quantity_not_positive                 stock_transfers / stock_row_moves with quantity <= 0
--   transfers_same_branch / transfers_branch_missing stock_transfers from = to, or a NULL end
--   damaged_lots_out_of_range                       damaged_stock_lots quantity <= 0, remaining below 0 or above quantity
--   movements_quantity_not_number                   inventory_movements.quantity NULL / TEXT / BLOB
--   movements_sign_flipped                          a sale / replacement_out / return_reversal / damage_reversal stored
--                                                   positive, or a return / damage_in / transfer / supplier_return stored negative
--   Info columns (not zero-expected):
--   products_stock_null                             products with a NULL stock_quantity (readers COALESCE it to 0)
--   movements_zero_quantity                         movements that moved 0 (a stock-in line edit to the same figure writes one)
--   movements_without_product_or_branch             movements with no product or no branch (cannot be replayed per pair)
--   first_ids                                       json object: the lowest offending id per table family, ids only
-- Needs migration: 0074 (damaged_stock_lots); production has applied them (a missing table makes the statement fail loudly, never report 0).
-- Measured cost: one pass over each of products, branch_stock, branch_batch_stock, product_batches, sale_items,
-- sale_item_batch_allocations, return_items, return_item_batch_allocations, stock_transfers, stock_row_moves,
-- damaged_stock_lots and inventory_movements; no joins. See the scale test output (test-audit-b-scale-workerd.cjs).
-- Measured at production scale (workerd D1, 107 ms best of 5 on an idle host, 221k rows read; fixture = 6 Oct 2026 inventory, test-audit-b-scale-workerd.cjs; a loaded host runs 2-3x slower).
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero products_stock_negative,products_stock_text,branch_stock_negative,branch_stock_not_number,lot_stock_negative,lot_stock_not_number,lots_received_quantity_negative,lots_cost_negative,lots_cost_not_number,sale_items_quantity_not_positive,sale_items_returned_out_of_range,sale_allocations_not_positive,sale_allocations_released_out_of_range,return_items_quantity_not_positive,return_allocations_not_positive,transfers_quantity_not_positive,transfers_same_branch,transfers_branch_missing,damaged_lots_out_of_range,movements_quantity_not_number,movements_sign_flipped
WITH pr AS MATERIALIZED (
  SELECT
    COALESCE(SUM(CASE WHEN stock_quantity < 0 THEN 1 ELSE 0 END), 0) AS neg,
    COALESCE(SUM(CASE WHEN typeof(stock_quantity) IN ('text', 'blob') THEN 1 ELSE 0 END), 0) AS txt,
    COALESCE(SUM(CASE WHEN stock_quantity IS NULL THEN 1 ELSE 0 END), 0) AS nul,
    MIN(CASE WHEN stock_quantity < 0 OR typeof(stock_quantity) IN ('text', 'blob') THEN id END) AS first_id
  FROM products
), bs AS MATERIALIZED (
  SELECT
    COALESCE(SUM(CASE WHEN quantity < 0 THEN 1 ELSE 0 END), 0) AS neg,
    COALESCE(SUM(CASE WHEN quantity IS NULL OR typeof(quantity) NOT IN ('integer', 'real') THEN 1 ELSE 0 END), 0) AS bad,
    MIN(CASE WHEN quantity < 0 OR quantity IS NULL OR typeof(quantity) NOT IN ('integer', 'real') THEN id END) AS first_id
  FROM branch_stock
), bb AS MATERIALIZED (
  SELECT
    COALESCE(SUM(CASE WHEN quantity < 0 THEN 1 ELSE 0 END), 0) AS neg,
    COALESCE(SUM(CASE WHEN quantity IS NULL OR typeof(quantity) NOT IN ('integer', 'real') THEN 1 ELSE 0 END), 0) AS bad,
    MIN(CASE WHEN quantity < 0 OR quantity IS NULL OR typeof(quantity) NOT IN ('integer', 'real') THEN id END) AS first_id
  FROM branch_batch_stock
), lt AS MATERIALIZED (
  SELECT
    COALESCE(SUM(CASE WHEN received_quantity < 0 THEN 1 ELSE 0 END), 0) AS rq_neg,
    COALESCE(SUM(CASE WHEN unit_cost_usd < 0 OR received_cost_usd < 0 THEN 1 ELSE 0 END), 0) AS cost_neg,
    COALESCE(SUM(CASE WHEN typeof(unit_cost_usd) IN ('text', 'blob') OR typeof(received_cost_usd) IN ('text', 'blob') THEN 1 ELSE 0 END), 0) AS cost_bad,
    MIN(CASE WHEN received_quantity < 0 OR unit_cost_usd < 0 OR received_cost_usd < 0
      OR typeof(unit_cost_usd) IN ('text', 'blob') OR typeof(received_cost_usd) IN ('text', 'blob') THEN id END) AS first_id
  FROM product_batches
), si AS MATERIALIZED (
  SELECT
    COALESCE(SUM(CASE WHEN quantity IS NULL OR quantity <= 0 THEN 1 ELSE 0 END), 0) AS qty_bad,
    COALESCE(SUM(CASE WHEN returned_quantity < 0 OR returned_quantity > quantity THEN 1 ELSE 0 END), 0) AS ret_bad,
    MIN(CASE WHEN quantity IS NULL OR quantity <= 0 OR returned_quantity < 0 OR returned_quantity > quantity THEN id END) AS first_id
  FROM sale_items
), sa AS MATERIALIZED (
  SELECT
    COALESCE(SUM(CASE WHEN quantity IS NULL OR quantity <= 0 THEN 1 ELSE 0 END), 0) AS qty_bad,
    COALESCE(SUM(CASE WHEN released_quantity < 0 OR released_quantity > quantity THEN 1 ELSE 0 END), 0) AS rel_bad,
    MIN(CASE WHEN quantity IS NULL OR quantity <= 0 OR released_quantity < 0 OR released_quantity > quantity THEN id END) AS first_id
  FROM sale_item_batch_allocations
), ri AS MATERIALIZED (
  SELECT COALESCE(SUM(CASE WHEN quantity IS NULL OR quantity <= 0 THEN 1 ELSE 0 END), 0) AS bad,
    MIN(CASE WHEN quantity IS NULL OR quantity <= 0 THEN id END) AS first_id
  FROM return_items
), ra AS MATERIALIZED (
  SELECT COALESCE(SUM(CASE WHEN quantity IS NULL OR quantity <= 0 THEN 1 ELSE 0 END), 0) AS bad,
    MIN(CASE WHEN quantity IS NULL OR quantity <= 0 THEN id END) AS first_id
  FROM return_item_batch_allocations
), tr AS MATERIALIZED (
  SELECT
    COALESCE(SUM(CASE WHEN quantity IS NULL OR quantity <= 0 THEN 1 ELSE 0 END), 0) AS qty_bad,
    COALESCE(SUM(CASE WHEN from_branch_id = to_branch_id THEN 1 ELSE 0 END), 0) AS same_branch,
    COALESCE(SUM(CASE WHEN from_branch_id IS NULL OR to_branch_id IS NULL THEN 1 ELSE 0 END), 0) AS no_branch,
    MIN(CASE WHEN quantity IS NULL OR quantity <= 0 OR from_branch_id = to_branch_id OR from_branch_id IS NULL OR to_branch_id IS NULL THEN id END) AS first_id
  FROM stock_transfers
), rm AS MATERIALIZED (
  SELECT COALESCE(SUM(CASE WHEN quantity IS NULL OR quantity <= 0 THEN 1 ELSE 0 END), 0) AS bad
  FROM stock_row_moves
), dl AS MATERIALIZED (
  SELECT COALESCE(SUM(CASE WHEN quantity IS NULL OR quantity <= 0 OR quantity_remaining < 0 OR quantity_remaining > quantity THEN 1 ELSE 0 END), 0) AS bad,
    MIN(CASE WHEN quantity IS NULL OR quantity <= 0 OR quantity_remaining < 0 OR quantity_remaining > quantity THEN id END) AS first_id
  FROM damaged_stock_lots
), mv AS MATERIALIZED (
  SELECT
    COALESCE(SUM(CASE WHEN quantity IS NULL OR typeof(quantity) NOT IN ('integer', 'real') THEN 1 ELSE 0 END), 0) AS bad,
    COALESCE(SUM(CASE WHEN quantity = 0 THEN 1 ELSE 0 END), 0) AS zero,
    COALESCE(SUM(CASE WHEN product_id IS NULL OR branch_id IS NULL THEN 1 ELSE 0 END), 0) AS orphan,
    COALESCE(SUM(CASE
      WHEN movement_type IN ('sale', 'replacement_out', 'return_reversal', 'damage_reversal') AND quantity > 0 THEN 1
      WHEN movement_type IN ('return', 'damage_in', 'transfer_in', 'transfer_out', 'supplier_return') AND quantity < 0 THEN 1
      ELSE 0 END), 0) AS flipped,
    MIN(CASE
      WHEN quantity IS NULL OR typeof(quantity) NOT IN ('integer', 'real') THEN id
      WHEN movement_type IN ('sale', 'replacement_out', 'return_reversal', 'damage_reversal') AND quantity > 0 THEN id
      WHEN movement_type IN ('return', 'damage_in', 'transfer_in', 'transfer_out', 'supplier_return') AND quantity < 0 THEN id END) AS first_id
  FROM inventory_movements
)
SELECT
  (SELECT neg FROM pr) AS products_stock_negative,
  (SELECT txt FROM pr) AS products_stock_text,
  (SELECT neg FROM bs) AS branch_stock_negative,
  (SELECT bad FROM bs) AS branch_stock_not_number,
  (SELECT neg FROM bb) AS lot_stock_negative,
  (SELECT bad FROM bb) AS lot_stock_not_number,
  (SELECT rq_neg FROM lt) AS lots_received_quantity_negative,
  (SELECT cost_neg FROM lt) AS lots_cost_negative,
  (SELECT cost_bad FROM lt) AS lots_cost_not_number,
  (SELECT qty_bad FROM si) AS sale_items_quantity_not_positive,
  (SELECT ret_bad FROM si) AS sale_items_returned_out_of_range,
  (SELECT qty_bad FROM sa) AS sale_allocations_not_positive,
  (SELECT rel_bad FROM sa) AS sale_allocations_released_out_of_range,
  (SELECT bad FROM ri) AS return_items_quantity_not_positive,
  (SELECT bad FROM ra) AS return_allocations_not_positive,
  (SELECT qty_bad FROM tr) + (SELECT bad FROM rm) AS transfers_quantity_not_positive,
  (SELECT same_branch FROM tr) AS transfers_same_branch,
  (SELECT no_branch FROM tr) AS transfers_branch_missing,
  (SELECT bad FROM dl) AS damaged_lots_out_of_range,
  (SELECT bad FROM mv) AS movements_quantity_not_number,
  (SELECT flipped FROM mv) AS movements_sign_flipped,
  (SELECT nul FROM pr) AS products_stock_null,
  (SELECT zero FROM mv) AS movements_zero_quantity,
  (SELECT orphan FROM mv) AS movements_without_product_or_branch,
  json_object('products', (SELECT first_id FROM pr), 'branch_stock', (SELECT first_id FROM bs), 'branch_batch_stock', (SELECT first_id FROM bb),
    'product_batches', (SELECT first_id FROM lt), 'sale_items', (SELECT first_id FROM si), 'sale_item_batch_allocations', (SELECT first_id FROM sa),
    'return_items', (SELECT first_id FROM ri), 'return_item_batch_allocations', (SELECT first_id FROM ra), 'stock_transfers', (SELECT first_id FROM tr),
    'damaged_stock_lots', (SELECT first_id FROM dl), 'inventory_movements', (SELECT first_id FROM mv)) AS first_ids
