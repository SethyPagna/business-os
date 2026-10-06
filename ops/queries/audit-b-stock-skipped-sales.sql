-- DATA-AUDIT lane B (stock & cost), query 7 of 14: sales that are outside the stock ledger (sales.stock_skipped) must never have moved stock.
-- Owner ask 7 Oct 2026: "compare all the backend data for any inconsistencies or logic that isn't consistent".
--
-- Rule (lib/saleTransitions.ts planSaleStockTransition, migrations 0114 and 0235): a sale with stock_skipped = 1 was never in the
-- stock ledger -- the historical sales import writes sales WITHOUT deducting stock (the real units left the shelf long before the file
-- existed), and 0235 marks every 'sales-import:<job>:<row>' sale. Every later transition of such a sale moves ZERO: "an
-- inventory_movements row asserts that units physically moved, and none did". A skipped sale with a 'sale' movement, or with lot
-- allocations still holding units, means a transition ran on it anyway (a cancel that handed back units never taken = phantom stock).
-- Real customer returns against a skipped sale DO restock normally (they name the return, reason 'Return: ...'); they are counted as info.
-- Needs only the sales table (stock_skipped, migration 0114): it does not read the 0235 work tables, so it runs whether or not 0235 is applied.
-- Related, not repeated (run it as it is): forensics-f4-imported-sales-stock-skipped.sql (sizing BEFORE 0235: to_mark, phantom units).
--
-- One row, zero-expected columns (a non-zero value is a defect, named by the column):
--   skipped_sale_movement_rows     sale / return / damage movements that name a stock_skipped sale (customer-return rows, which name the
--                                  return, are left out)
--   skipped_sale_allocations_held  lot allocation units still held (quantity - released_quantity) by the lines of a stock_skipped sale
--   Info columns:
--   skipped_sales                  sales with stock_skipped = 1;  skipped_import / skipped_legacy / skipped_other: by client_request_id prefix
--                                  ('sales-import:' / 'legacy-sale:' / anything else: an admin chose "skip stock" on a POS sale)
--   skipped_cancelled              of them, cancelled
--   skipped_with_customer_returns  skipped sales that have at least one non-cancelled customer return; skipped_return_restock_units: the units those returns restocked
--   skipped_movement_net_units     the net units (restocks positive, deductions negative) of the offending rows above
--   import_sales                   sales carrying the sales-import: key;  import_sales_unmarked: of them stock_skipped = 0 (must be 0 once 0235 is applied)
--   import_unmarked_cancelled      unmarked import sales that are cancelled
--   import_unmarked_cancel_restock_units  units a cancel handed back on unmarked import sales (phantom stock; forensics-f4 moved_net_units)
--   examples                       up to 5 [sale_id, movement_id, type, quantity] of the offending rows, lowest sale first
-- Measured cost: the partial index on stock_skipped = 1 and the (reference_id, movement_type, id) index make it a few hundred reads; the import
-- prefix is a range read on the unique client_request_id index; see the scale test output (test-audit-b-scale-workerd.cjs).
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero skipped_sale_movement_rows,skipped_sale_allocations_held
WITH sk AS MATERIALIZED (
  SELECT id, sale_status, client_request_id FROM sales WHERE stock_skipped = 1
), mvs AS MATERIALIZED (
  SELECT sk.id AS sale_id, m.id AS movement_id, m.movement_type, m.quantity
  FROM sk
  JOIN inventory_movements m ON m.reference_id = sk.id AND m.movement_type IN ('sale', 'return', 'damage_in', 'damage_out')
  WHERE NOT (COALESCE(m.reason, '') LIKE 'Return: %' OR COALESCE(m.reason, '') LIKE 'Return #%'
    OR COALESCE(m.reason, '') IN ('Apply grouped return status', 'Undo grouped return status'))
), held AS (
  SELECT COALESCE(SUM(a.quantity - a.released_quantity), 0) AS units
  FROM sk
  JOIN sale_items si ON si.sale_id = sk.id
  JOIN sale_item_batch_allocations a ON a.sale_item_id = si.id
), imp AS MATERIALIZED (
  SELECT id, sale_status, COALESCE(stock_skipped, 0) AS skipped
  FROM sales
  WHERE client_request_id >= 'sales-import:' AND client_request_id < 'sales-import;'
), cr AS (
  SELECT COUNT(DISTINCT sk.id) AS sales, COALESCE(SUM(ri.quantity), 0) AS units
  FROM sk
  JOIN returns r ON r.sale_id = sk.id AND COALESCE(r.status, 'completed') <> 'cancelled' AND COALESCE(r.return_scope, 'customer') = 'customer'
  JOIN return_items ri ON ri.return_id = r.id AND COALESCE(ri.stock_action, CASE WHEN ri.return_to_stock = 1 THEN 'restock' END) = 'restock'
)
SELECT
  (SELECT COUNT(*) FROM mvs) AS skipped_sale_movement_rows,
  (SELECT units FROM held) AS skipped_sale_allocations_held,
  (SELECT COUNT(*) FROM sk) AS skipped_sales,
  (SELECT COUNT(*) FROM sk WHERE client_request_id >= 'sales-import:' AND client_request_id < 'sales-import;') AS skipped_import,
  (SELECT COUNT(*) FROM sk WHERE client_request_id >= 'legacy-sale:' AND client_request_id < 'legacy-sale;') AS skipped_legacy,
  (SELECT COUNT(*) FROM sk WHERE NOT (client_request_id >= 'sales-import:' AND client_request_id < 'sales-import;')
    AND NOT (client_request_id >= 'legacy-sale:' AND client_request_id < 'legacy-sale;')) AS skipped_other,
  (SELECT COUNT(*) FROM sk WHERE sale_status = 'cancelled') AS skipped_cancelled,
  (SELECT sales FROM cr) AS skipped_with_customer_returns,
  (SELECT units FROM cr) AS skipped_return_restock_units,
  (SELECT COALESCE(SUM(CASE WHEN movement_type IN ('sale', 'damage_out') THEN -ABS(COALESCE(quantity, 0)) ELSE ABS(COALESCE(quantity, 0)) END), 0) FROM mvs) AS skipped_movement_net_units,
  (SELECT COUNT(*) FROM imp) AS import_sales,
  (SELECT COUNT(*) FROM imp WHERE skipped = 0) AS import_sales_unmarked,
  (SELECT COUNT(*) FROM imp WHERE skipped = 0 AND sale_status = 'cancelled') AS import_unmarked_cancelled,
  (SELECT COALESCE(SUM(m.quantity), 0) FROM imp
    JOIN inventory_movements m ON m.reference_id = imp.id AND m.movement_type = 'return'
    WHERE imp.skipped = 0 AND imp.sale_status = 'cancelled'
      AND NOT (COALESCE(m.reason, '') LIKE 'Return: %' OR COALESCE(m.reason, '') LIKE 'Return #%'
        OR COALESCE(m.reason, '') IN ('Apply grouped return status', 'Undo grouped return status'))) AS import_unmarked_cancel_restock_units,
  (SELECT COALESCE(json_group_array(json_array(sale_id, movement_id, movement_type, quantity)), '[]')
    FROM (SELECT sale_id, movement_id, movement_type, quantity FROM mvs ORDER BY sale_id, movement_id LIMIT 5)) AS examples
