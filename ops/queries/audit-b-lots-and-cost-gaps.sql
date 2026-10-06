-- DATA-AUDIT lane B (stock & cost), query 12 of 16: lots, products and cost entries that point at each other wrongly, and the stock that has no recorded cost.
-- Owner ask 7 Oct 2026: "compare all the backend data for any inconsistencies or logic that isn't consistent".
--
-- Owner rules: batch identity (29 Aug) -- stock keeps its lot AND branch identity end to end; cost 25 Sep -- the catalog cost is the on-hand weighted cost over
-- lots with a RECORDED cost, where 0 and NULL both mean "not recorded" (owner 6 Oct: a free lot and an unknown-cost lot merge, the merge is UNKNOWN);
-- conflict resolution moves every link and never orphans one (the 0109 residue: 22 deactivated duplicate products still owned lots, one with 28 units). A lot
-- belongs to a product through product_batches.variant_product_id; a lot's stock is its branch_batch_stock rows above 0, summed over branches.
-- Not repeated: lots-exceed-branch-stock.sql, audit-b-stock-ledger-agreement.sql (orphans, inactive lots holding stock), audit-b-catalog-cost.sql (drift).
--
-- One row, zero-expected columns (a non-zero value is a defect, named by the column):
--   stock_lots_of_inactive_products   lots holding stock whose product is inactive (merged away or removed: the stock is invisible to every product surface)
--   inactive_products_with_stock      inactive products that still have branch_stock above 0
--   lots_supplier_missing             lots whose supplier_id names no supplier
--   cost_entries_orphan_product       manual cost entries of a product that no longer exists
--   Info columns (sizing, not defects):
--   lots_total / lots_with_stock      lots / lots holding stock
--   stock_lots_recorded_cost / stock_lots_zero_cost / stock_lots_unknown_cost   lots holding stock by cost class (> 0 / exactly 0 / NULL)
--   stock_units_zero_cost / stock_units_unknown_cost   the units on those lots (a stock valuation at cost leaves them out)
--   stock_lots_without_supplier       lots holding stock with no supplier_id and no supplier_name
--   products_stock_without_any_lot / units_stock_without_any_lot   active products with branch stock and no lot row at all (legacy untracked stock)
--   products_stock_without_costed_lot active products with branch stock and no lot holding stock at a recorded cost (the catalog cost has no on-hand basis)
--   products_cost_zero_with_stock     active products with branch stock whose catalog cost is 0 or NULL
--   lots_stock_exceeds_received       lots whose stock (all branches) is above received_quantity (an upward count is not a purchase; sizing only);
--                                     units_stock_exceeds_received: the excess units
--   lots_received_cost_drift          lots with unit cost, received cost and received quantity whose unit x quantity is more than 0.01 away from received_cost_usd
--   cost_entries / cost_entries_not_positive   manual cost entries / those with a NULL or non-positive cost
--   overridden_lots_cost_differs      lots a manual entry re-prices (id at or below the baseline, holding stock) whose own cost differs from the entry's
--   examples_inactive_product_lots    up to 5 [lot_id, product_id, units], the largest first
-- Needs migration: 0177 (product_cost_entries); production has applied them (a missing table makes the statement fail loudly, never report 0).
-- Measured cost: one pass over product_batches with primary-key probes into products and suppliers, one over positive branch_batch_stock, branch_stock and
-- product_cost_entries; see the scale test output (test-audit-b-scale-workerd.cjs).
-- Measured at production scale (workerd D1, 75 ms best of 5 on an idle host, 268k rows read; fixture = 6 Oct 2026 inventory, test-audit-b-scale-workerd.cjs; a loaded host runs 2-3x slower).
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero stock_lots_of_inactive_products,inactive_products_with_stock,lots_supplier_missing,cost_entries_orphan_product
WITH pos AS MATERIALIZED (
  SELECT batch_id, SUM(quantity) AS q FROM branch_batch_stock WHERE quantity > 0 GROUP BY batch_id
), lt AS MATERIALIZED (
  SELECT pb.id, pb.variant_product_id AS product_id, p.id AS pid, COALESCE(p.is_active, 0) AS active, COALESCE(pos.q, 0) AS q,
    CASE WHEN typeof(pb.unit_cost_usd) IN ('integer', 'real') AND pb.unit_cost_usd > 0 THEN 'recorded' WHEN pb.unit_cost_usd = 0 THEN 'zero' ELSE 'unknown' END AS cc,
    pb.received_quantity, pb.received_cost_usd, pb.unit_cost_usd,
    CASE WHEN pb.supplier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM suppliers s WHERE s.id = pb.supplier_id) THEN 1 ELSE 0 END AS no_supplier_row,
    CASE WHEN pb.supplier_id IS NULL AND trim(COALESCE(pb.supplier_name, '')) = '' THEN 1 ELSE 0 END AS no_supplier
  FROM product_batches pb
  LEFT JOIN products p ON p.id = pb.variant_product_id
  LEFT JOIN pos ON pos.batch_id = pb.id
), bs AS MATERIALIZED (
  SELECT product_id, SUM(quantity) AS q FROM branch_stock WHERE quantity > 0 GROUP BY product_id
), pl AS MATERIALIZED (
  SELECT product_id, COUNT(*) AS lots, SUM(CASE WHEN q > 0 AND cc = 'recorded' THEN 1 ELSE 0 END) AS costed_stock_lots FROM lt GROUP BY product_id
), px AS MATERIALIZED (
  SELECT p.id, bs.q AS stock, COALESCE(pl.lots, 0) AS lots, COALESCE(pl.costed_stock_lots, 0) AS costed_stock_lots, p.cost_price_usd AS cost
  FROM products p
  JOIN bs ON bs.product_id = p.id
  LEFT JOIN pl ON pl.product_id = p.id
  WHERE p.is_active = 1
), ce AS MATERIALIZED (
  SELECT e.id, e.product_id, e.cost_usd, e.baseline_batch_id
  FROM product_cost_entries e
  JOIN (SELECT product_id, MAX(id) AS mid FROM product_cost_entries GROUP BY product_id) m ON m.mid = e.id
), la AS MATERIALIZED (
  SELECT
    COALESCE(SUM(CASE WHEN pid IS NOT NULL AND active = 0 AND q > 0 THEN 1 ELSE 0 END), 0) AS stock_lots_of_inactive_products,
    COALESCE(SUM(no_supplier_row), 0) AS lots_supplier_missing,
    COUNT(*) AS lots_total,
    COALESCE(SUM(CASE WHEN q > 0 THEN 1 ELSE 0 END), 0) AS lots_with_stock,
    COALESCE(SUM(CASE WHEN q > 0 AND cc = 'recorded' THEN 1 ELSE 0 END), 0) AS stock_lots_recorded_cost,
    COALESCE(SUM(CASE WHEN q > 0 AND cc = 'zero' THEN 1 ELSE 0 END), 0) AS stock_lots_zero_cost,
    COALESCE(SUM(CASE WHEN q > 0 AND cc = 'unknown' THEN 1 ELSE 0 END), 0) AS stock_lots_unknown_cost,
    COALESCE(SUM(CASE WHEN cc = 'zero' THEN q END), 0) AS stock_units_zero_cost,
    COALESCE(SUM(CASE WHEN cc = 'unknown' THEN q END), 0) AS stock_units_unknown_cost,
    COALESCE(SUM(CASE WHEN q > 0 AND no_supplier = 1 THEN 1 ELSE 0 END), 0) AS stock_lots_without_supplier,
    COALESCE(SUM(CASE WHEN received_quantity IS NOT NULL AND q > received_quantity + 0.000001 THEN 1 ELSE 0 END), 0) AS lots_stock_exceeds_received,
    COALESCE(SUM(CASE WHEN received_quantity IS NOT NULL AND q > received_quantity + 0.000001 THEN q - received_quantity END), 0) AS units_stock_exceeds_received,
    COALESCE(SUM(CASE WHEN unit_cost_usd IS NOT NULL AND received_cost_usd IS NOT NULL AND received_quantity IS NOT NULL
      AND ABS(unit_cost_usd * received_quantity - received_cost_usd) > 0.01 THEN 1 ELSE 0 END), 0) AS lots_received_cost_drift
  FROM lt
), pa AS MATERIALIZED (
  SELECT
    COALESCE(SUM(CASE WHEN lots = 0 THEN 1 ELSE 0 END), 0) AS products_stock_without_any_lot,
    COALESCE(SUM(CASE WHEN lots = 0 THEN stock END), 0) AS units_stock_without_any_lot,
    COALESCE(SUM(CASE WHEN costed_stock_lots = 0 THEN 1 ELSE 0 END), 0) AS products_stock_without_costed_lot,
    COALESCE(SUM(CASE WHEN COALESCE(cost, 0) = 0 THEN 1 ELSE 0 END), 0) AS products_cost_zero_with_stock
  FROM px
)
SELECT
  la.stock_lots_of_inactive_products,
  (SELECT COUNT(*) FROM products p JOIN bs ON bs.product_id = p.id WHERE COALESCE(p.is_active, 0) <> 1) AS inactive_products_with_stock,
  la.lots_supplier_missing,
  (SELECT COUNT(*) FROM product_cost_entries e WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.id = e.product_id)) AS cost_entries_orphan_product,
  la.lots_total, la.lots_with_stock, la.stock_lots_recorded_cost, la.stock_lots_zero_cost, la.stock_lots_unknown_cost,
  la.stock_units_zero_cost, la.stock_units_unknown_cost, la.stock_lots_without_supplier,
  pa.products_stock_without_any_lot, pa.units_stock_without_any_lot, pa.products_stock_without_costed_lot, pa.products_cost_zero_with_stock,
  la.lots_stock_exceeds_received, la.units_stock_exceeds_received, la.lots_received_cost_drift,
  (SELECT COUNT(*) FROM product_cost_entries) AS cost_entries,
  (SELECT COUNT(*) FROM product_cost_entries WHERE cost_usd IS NULL OR cost_usd <= 0) AS cost_entries_not_positive,
  (SELECT COUNT(*) FROM lt JOIN ce ON ce.product_id = lt.product_id AND lt.id <= ce.baseline_batch_id
    WHERE lt.q > 0 AND ce.cost_usd > 0 AND (lt.unit_cost_usd IS NULL OR ABS(lt.unit_cost_usd - ce.cost_usd) > 0.00001)) AS overridden_lots_cost_differs,
  (SELECT COALESCE(json_group_array(json_array(id, product_id, q)), '[]')
    FROM (SELECT id, product_id, q FROM lt WHERE pid IS NOT NULL AND active = 0 AND q > 0 ORDER BY q DESC, id LIMIT 5)) AS examples_inactive_product_lots
FROM la, pa
