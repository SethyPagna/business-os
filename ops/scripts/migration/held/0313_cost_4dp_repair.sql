-- 0313 cost 4dp repair (lane cost-4dp, board item cost-4dp). HELD: kept in ops/scripts/migration/held, outside the deploy chain.
-- Moving it into cloudflare/migrations (keeping the name 0313) is the decision to run it on production: the lead decides, after reading
-- cost-4dp-counts-20261116.sql and cost-4dp-ids-20261116.sql on the same day. The held 0200 sale-cost repair is numbered 0314 (above this file), so
-- production and a fresh database apply 0313 first; test-held-0200-sale-cost-repair-pure.cjs and README.md in this folder name it.
-- Owner rule (30 Sep 2026): prices and costs are stored to 4 decimals, nearest, half away from zero. The writers are fixed in the Worker
-- (same lane; 0312 re-creates the catalog-cost triggers with the sold-out fallback rounded). Values written before those fixes remain:
-- production census 16 Nov 2026 found 123 of 8,690 products with cost_price_usd over 4 decimals (predicate: ABS(c * 10000 - ROUND(c * 10000))
-- > 0.000001 on a numeric value; ops/queries/stock-state-census-exactness-20261116.sql cost_usd_over_4dp). This file rounds them.
--
-- Scope (any row, active or not): products.cost_price_usd, cost_price_khr, purchase_price_usd, purchase_price_khr; product_batches.unit_cost_usd,
-- received_cost_usd; product_cost_entries.cost_usd, cost_khr, previous_cost_usd. Lots and entries are included on purpose: the catalog-cost
-- formula and the merge authority read them, so a long lot or entry would bring the long product cost back at the next stock event.
-- Size them first with ops/queries/cost-4dp-counts-20261116.sql and list the products with cost-4dp-ids-20261116.sql.
--
-- Re-derive: the lot statement runs under the maintenance flag (below), which stands the lot triggers down, so a product whose lots were rounded is
-- not re-derived by them. After the lots and entries are rounded the file re-derives the catalog cost of every ACTIVE product that has a rounded lot
-- or entry, with the formula the triggers use (catalogCostFormulaSql('validated').derive, pinned equal by the test) and the health rule
-- (only where the formula yields a figure; cost and purchase twin both written). Each change is recorded in the same ledger: the row of a product
-- already in it keeps its before value and takes the re-derived after value. POST asserts active_cost_drift = 0 over ALL active products, the
-- predicate of ops/queries/health-catalog-cost.sql.
--
-- NOT touched, asserted unchanged below: sale_items, return_items, inventory_movements (every cost snapshot), the products cost_review_key,
-- is_active, prices, quantities and updated_at, and every row outside the scope. There is no stored daily-totals table in this schema.
-- The history fingerprint is exact: per cost column the sum of the length of its text form and the sum of ROUND(x * 1e6), so history rounded to
-- 4 decimals is seen (a sum of ROUND(x * 10000) cannot see it).
--
-- Rounding: after = nearest 4 places, ties away from zero, the HALF_UP_4DP form of src/lib/catalogCostRecompute.ts, (CAST(ROUND(x * 10000.0000000000036)
-- AS INTEGER) / 10000.0) (not ROUND(x, 4), which rounds the binary double and differs between SQLite versions). Equal to roundMoney4 over
-- magnitudes to 1e8 (scripts/test-half-up-4dp-property-pure.cjs). Each repair change of a lot or entry is at most 0.00005 (asserted).
--
-- Permit: the 0258 guards refuse a write of the cost columns without the stock-transaction permit; the file inserts it and removes it again
-- before the POST checks, exactly like 0269 and lib/stockTransaction.ts. The lot update fires the 0255 lot-update trigger, which would
-- re-derive products and could clear a cost_review_key. The file therefore holds the restore-mode maintenance flag, which those triggers
-- (and the 0124 revision triggers) stand down for, ONLY around the lot statement, and removes it straight after. A request in that window
-- sees maintenance mode for a few milliseconds. Run it in a quiet window.
--
-- PRE:  the stock epoch, when there is one, is legacy-separate-pool-v1; no maintenance flag and no permit; the scope is within the caps
--       (products 500, lots 5000, entries 5000: production census 123 products), every value in scope is below 1e9 in magnitude, and no
--       INACTIVE lot that still holds branch stock needs a write (trigger positive_lot_reject_inactive_update_0154 aborts any update of
--       such a lot, so the file stops first, named cost_4dp_0313_pre_inactive_lot_holds_stock, before any write), or the file aborts.
--       Record the three counts from cost-4dp-counts-20261116.sql beforehand.
-- POST: no row of the scope columns is over 4 decimals; the ledger holds one row per column written and each landed on its after value;
--       each lot or entry change is within 0.00005; active_cost_drift is 0; row counts, is_active, prices, quantities, cost_review_key,
--       every row outside the scope and the exact sale_items / return_items / inventory_movements fingerprints are unchanged; no permit and
--       no maintenance flag is left behind. A failed check reads a malformed JSON path and aborts the file.
-- Re-run: with nothing over 4 decimals the scope is empty and every statement is a no-op. If the file aborts after the ledger insert, DROP
-- TABLE cost_4dp_repair_0313 and the _cost_4dp_* work tables, delete any permit / maintenance flag it left, and run it again.
-- Ledger cost_4dp_repair_0313 (entity, row id, column, before value, after value) makes it reversible; the value columns carry no type so each
-- value is stored exactly as read. Not backed up (a restore replaces the tables with its own copy): excluded in
-- test-backup-tables-completeness-pure.cjs; its row_id column is classified in test-record-orphans-native.cjs (a ledger entry outlives its row).
-- Pinned by scripts/test-migration-0313-cost-4dp-repair-pure.cjs.
--
-- RECOVERY (owner-approved only): put the old values back where nothing has moved them since, inside the permit and the maintenance flag:
--   INSERT INTO system_flags (key, value, updated_at) SELECT 'stock_transaction_permit', value, CURRENT_TIMESTAMP FROM system_flags WHERE key = 'stock_schema_epoch';
--   INSERT INTO system_flags (key, value, updated_at) VALUES ('maintenance', '{"mode":"restore"}', CURRENT_TIMESTAMP);
--   UPDATE products SET cost_price_usd = (SELECT before_value FROM cost_4dp_repair_0313 WHERE entity = 'products' AND row_id = products.id AND col = 'cost_price_usd')
--   WHERE id IN (SELECT l.row_id FROM cost_4dp_repair_0313 l WHERE l.entity = 'products' AND l.col = 'cost_price_usd' AND products.cost_price_usd IS l.after_value);
--   UPDATE products SET cost_price_khr = (SELECT before_value FROM cost_4dp_repair_0313 WHERE entity = 'products' AND row_id = products.id AND col = 'cost_price_khr')
--   WHERE id IN (SELECT l.row_id FROM cost_4dp_repair_0313 l WHERE l.entity = 'products' AND l.col = 'cost_price_khr' AND products.cost_price_khr IS l.after_value);
--   UPDATE products SET purchase_price_usd = (SELECT before_value FROM cost_4dp_repair_0313 WHERE entity = 'products' AND row_id = products.id AND col = 'purchase_price_usd')
--   WHERE id IN (SELECT l.row_id FROM cost_4dp_repair_0313 l WHERE l.entity = 'products' AND l.col = 'purchase_price_usd' AND products.purchase_price_usd IS l.after_value);
--   UPDATE products SET purchase_price_khr = (SELECT before_value FROM cost_4dp_repair_0313 WHERE entity = 'products' AND row_id = products.id AND col = 'purchase_price_khr')
--   WHERE id IN (SELECT l.row_id FROM cost_4dp_repair_0313 l WHERE l.entity = 'products' AND l.col = 'purchase_price_khr' AND products.purchase_price_khr IS l.after_value);
--   UPDATE product_batches SET unit_cost_usd = (SELECT before_value FROM cost_4dp_repair_0313 WHERE entity = 'product_batches' AND row_id = product_batches.id AND col = 'unit_cost_usd')
--   WHERE id IN (SELECT l.row_id FROM cost_4dp_repair_0313 l WHERE l.entity = 'product_batches' AND l.col = 'unit_cost_usd' AND product_batches.unit_cost_usd IS l.after_value);
--   UPDATE product_batches SET received_cost_usd = (SELECT before_value FROM cost_4dp_repair_0313 WHERE entity = 'product_batches' AND row_id = product_batches.id AND col = 'received_cost_usd')
--   WHERE id IN (SELECT l.row_id FROM cost_4dp_repair_0313 l WHERE l.entity = 'product_batches' AND l.col = 'received_cost_usd' AND product_batches.received_cost_usd IS l.after_value);
--   UPDATE product_cost_entries SET cost_usd = (SELECT before_value FROM cost_4dp_repair_0313 WHERE entity = 'product_cost_entries' AND row_id = product_cost_entries.id AND col = 'cost_usd')
--   WHERE id IN (SELECT l.row_id FROM cost_4dp_repair_0313 l WHERE l.entity = 'product_cost_entries' AND l.col = 'cost_usd' AND product_cost_entries.cost_usd IS l.after_value);
--   UPDATE product_cost_entries SET cost_khr = (SELECT before_value FROM cost_4dp_repair_0313 WHERE entity = 'product_cost_entries' AND row_id = product_cost_entries.id AND col = 'cost_khr')
--   WHERE id IN (SELECT l.row_id FROM cost_4dp_repair_0313 l WHERE l.entity = 'product_cost_entries' AND l.col = 'cost_khr' AND product_cost_entries.cost_khr IS l.after_value);
--   UPDATE product_cost_entries SET previous_cost_usd = (SELECT before_value FROM cost_4dp_repair_0313 WHERE entity = 'product_cost_entries' AND row_id = product_cost_entries.id AND col = 'previous_cost_usd')
--   WHERE id IN (SELECT l.row_id FROM cost_4dp_repair_0313 l WHERE l.entity = 'product_cost_entries' AND l.col = 'previous_cost_usd' AND product_cost_entries.previous_cost_usd IS l.after_value);
--   DELETE FROM system_flags WHERE key IN ('stock_transaction_permit', 'maintenance');
--   UPDATE cache_versions SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE namespace = 'products';
-- A row edited after this file keeps its newer value. DROP TABLE cost_4dp_repair_0313 only after the restore is checked.


SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'stock_schema_epoch' AND value IS NOT 'legacy-separate-pool-v1')
    AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key IN ('maintenance', 'stock_transaction_permit'))
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_pre_state]') END;

SELECT CASE WHEN (SELECT COUNT(*) FROM products WHERE (typeof(cost_price_usd) IN ('integer', 'real') AND ABS(cost_price_usd * 10000 - ROUND(cost_price_usd * 10000)) > 0.000001)
    OR (typeof(cost_price_khr) IN ('integer', 'real') AND ABS(cost_price_khr * 10000 - ROUND(cost_price_khr * 10000)) > 0.000001)
    OR (typeof(purchase_price_usd) IN ('integer', 'real') AND ABS(purchase_price_usd * 10000 - ROUND(purchase_price_usd * 10000)) > 0.000001)
    OR (typeof(purchase_price_khr) IN ('integer', 'real') AND ABS(purchase_price_khr * 10000 - ROUND(purchase_price_khr * 10000)) > 0.000001)) <= 500
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_pre_products_scope_over_500]') END;

SELECT CASE WHEN (SELECT COUNT(*) FROM products WHERE ((typeof(cost_price_usd) IN ('integer', 'real') AND ABS(cost_price_usd * 10000 - ROUND(cost_price_usd * 10000)) > 0.000001) AND ABS(cost_price_usd) >= 1000000000) OR ((typeof(cost_price_khr) IN ('integer', 'real') AND ABS(cost_price_khr * 10000 - ROUND(cost_price_khr * 10000)) > 0.000001) AND ABS(cost_price_khr) >= 1000000000) OR ((typeof(purchase_price_usd) IN ('integer', 'real') AND ABS(purchase_price_usd * 10000 - ROUND(purchase_price_usd * 10000)) > 0.000001) AND ABS(purchase_price_usd) >= 1000000000) OR ((typeof(purchase_price_khr) IN ('integer', 'real') AND ABS(purchase_price_khr * 10000 - ROUND(purchase_price_khr * 10000)) > 0.000001) AND ABS(purchase_price_khr) >= 1000000000)) = 0
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_pre_products_value_out_of_range]') END;

SELECT CASE WHEN (SELECT COUNT(*) FROM product_batches WHERE (typeof(unit_cost_usd) IN ('integer', 'real') AND ABS(unit_cost_usd * 10000 - ROUND(unit_cost_usd * 10000)) > 0.000001)
    OR (typeof(received_cost_usd) IN ('integer', 'real') AND ABS(received_cost_usd * 10000 - ROUND(received_cost_usd * 10000)) > 0.000001)) <= 5000
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_pre_product_batches_scope_over_5000]') END;

SELECT CASE WHEN (SELECT COUNT(*) FROM product_batches WHERE ((typeof(unit_cost_usd) IN ('integer', 'real') AND ABS(unit_cost_usd * 10000 - ROUND(unit_cost_usd * 10000)) > 0.000001) AND ABS(unit_cost_usd) >= 1000000000) OR ((typeof(received_cost_usd) IN ('integer', 'real') AND ABS(received_cost_usd * 10000 - ROUND(received_cost_usd * 10000)) > 0.000001) AND ABS(received_cost_usd) >= 1000000000)) = 0
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_pre_product_batches_value_out_of_range]') END;

SELECT CASE WHEN (SELECT COUNT(*) FROM product_cost_entries WHERE (typeof(cost_usd) IN ('integer', 'real') AND ABS(cost_usd * 10000 - ROUND(cost_usd * 10000)) > 0.000001)
    OR (typeof(cost_khr) IN ('integer', 'real') AND ABS(cost_khr * 10000 - ROUND(cost_khr * 10000)) > 0.000001)
    OR (typeof(previous_cost_usd) IN ('integer', 'real') AND ABS(previous_cost_usd * 10000 - ROUND(previous_cost_usd * 10000)) > 0.000001)) <= 5000
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_pre_product_cost_entries_scope_over_5000]') END;

SELECT CASE WHEN (SELECT COUNT(*) FROM product_cost_entries WHERE ((typeof(cost_usd) IN ('integer', 'real') AND ABS(cost_usd * 10000 - ROUND(cost_usd * 10000)) > 0.000001) AND ABS(cost_usd) >= 1000000000) OR ((typeof(cost_khr) IN ('integer', 'real') AND ABS(cost_khr * 10000 - ROUND(cost_khr * 10000)) > 0.000001) AND ABS(cost_khr) >= 1000000000) OR ((typeof(previous_cost_usd) IN ('integer', 'real') AND ABS(previous_cost_usd * 10000 - ROUND(previous_cost_usd * 10000)) > 0.000001) AND ABS(previous_cost_usd) >= 1000000000)) = 0
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_pre_product_cost_entries_value_out_of_range]') END;

SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM product_batches pb WHERE pb.is_active IS NOT 1
    AND EXISTS (SELECT 1 FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0)
    AND ((typeof(pb.unit_cost_usd) IN ('integer', 'real') AND ABS(pb.unit_cost_usd * 10000 - ROUND(pb.unit_cost_usd * 10000)) > 0.000001) OR (typeof(pb.received_cost_usd) IN ('integer', 'real') AND ABS(pb.received_cost_usd * 10000 - ROUND(pb.received_cost_usd * 10000)) > 0.000001)))
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_pre_inactive_lot_holds_stock]') END;

CREATE TABLE IF NOT EXISTS cost_4dp_repair_0313 (
  entity TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  col TEXT NOT NULL,
  before_value,
  after_value,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entity, row_id, col)
);

INSERT INTO cost_4dp_repair_0313 (entity, row_id, col, before_value, after_value)
SELECT 'products', id, 'cost_price_usd', cost_price_usd, (CAST(ROUND((cost_price_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) FROM products WHERE (typeof(cost_price_usd) IN ('integer', 'real') AND ABS(cost_price_usd * 10000 - ROUND(cost_price_usd * 10000)) > 0.000001);

INSERT INTO cost_4dp_repair_0313 (entity, row_id, col, before_value, after_value)
SELECT 'products', id, 'cost_price_khr', cost_price_khr, (CAST(ROUND((cost_price_khr) * 10000.0000000000036) AS INTEGER) / 10000.0) FROM products WHERE (typeof(cost_price_khr) IN ('integer', 'real') AND ABS(cost_price_khr * 10000 - ROUND(cost_price_khr * 10000)) > 0.000001);

INSERT INTO cost_4dp_repair_0313 (entity, row_id, col, before_value, after_value)
SELECT 'products', id, 'purchase_price_usd', purchase_price_usd, (CAST(ROUND((purchase_price_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) FROM products WHERE (typeof(purchase_price_usd) IN ('integer', 'real') AND ABS(purchase_price_usd * 10000 - ROUND(purchase_price_usd * 10000)) > 0.000001);

INSERT INTO cost_4dp_repair_0313 (entity, row_id, col, before_value, after_value)
SELECT 'products', id, 'purchase_price_khr', purchase_price_khr, (CAST(ROUND((purchase_price_khr) * 10000.0000000000036) AS INTEGER) / 10000.0) FROM products WHERE (typeof(purchase_price_khr) IN ('integer', 'real') AND ABS(purchase_price_khr * 10000 - ROUND(purchase_price_khr * 10000)) > 0.000001);

INSERT INTO cost_4dp_repair_0313 (entity, row_id, col, before_value, after_value)
SELECT 'product_batches', id, 'unit_cost_usd', unit_cost_usd, (CAST(ROUND((unit_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) FROM product_batches WHERE (typeof(unit_cost_usd) IN ('integer', 'real') AND ABS(unit_cost_usd * 10000 - ROUND(unit_cost_usd * 10000)) > 0.000001);

INSERT INTO cost_4dp_repair_0313 (entity, row_id, col, before_value, after_value)
SELECT 'product_batches', id, 'received_cost_usd', received_cost_usd, (CAST(ROUND((received_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) FROM product_batches WHERE (typeof(received_cost_usd) IN ('integer', 'real') AND ABS(received_cost_usd * 10000 - ROUND(received_cost_usd * 10000)) > 0.000001);

INSERT INTO cost_4dp_repair_0313 (entity, row_id, col, before_value, after_value)
SELECT 'product_cost_entries', id, 'cost_usd', cost_usd, (CAST(ROUND((cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) FROM product_cost_entries WHERE (typeof(cost_usd) IN ('integer', 'real') AND ABS(cost_usd * 10000 - ROUND(cost_usd * 10000)) > 0.000001);

INSERT INTO cost_4dp_repair_0313 (entity, row_id, col, before_value, after_value)
SELECT 'product_cost_entries', id, 'cost_khr', cost_khr, (CAST(ROUND((cost_khr) * 10000.0000000000036) AS INTEGER) / 10000.0) FROM product_cost_entries WHERE (typeof(cost_khr) IN ('integer', 'real') AND ABS(cost_khr * 10000 - ROUND(cost_khr * 10000)) > 0.000001);

INSERT INTO cost_4dp_repair_0313 (entity, row_id, col, before_value, after_value)
SELECT 'product_cost_entries', id, 'previous_cost_usd', previous_cost_usd, (CAST(ROUND((previous_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) FROM product_cost_entries WHERE (typeof(previous_cost_usd) IN ('integer', 'real') AND ABS(previous_cost_usd * 10000 - ROUND(previous_cost_usd * 10000)) > 0.000001);

CREATE TABLE _cost_4dp_fingerprint_0313 (
  k INTEGER PRIMARY KEY CHECK (k = 1),
  products_total, products_active, products_prices, products_stock, products_keys, products_updated,
  lots_total, lots_active, lots_quantity, lots_outside_unit, lots_outside_received,
  entries_total, entries_outside_usd, entries_outside_khr, entries_outside_previous,
  sale_items_n, sale_items_len, sale_items_micro, return_items_n, return_items_len, return_items_micro, movements_n, movements_len, movements_micro
);

INSERT INTO _cost_4dp_fingerprint_0313
SELECT 1,
  (SELECT COUNT(*) FROM products), (SELECT COALESCE(SUM(is_active), 0) FROM products),
  (SELECT COALESCE(SUM(CAST(ROUND(COALESCE(selling_price_usd, 0) * 10000.0) AS INTEGER)), 0) + COALESCE(SUM(CAST(ROUND(COALESCE(selling_price_khr, 0) * 10000.0) AS INTEGER)), 0) + COALESCE(SUM(CAST(ROUND(COALESCE(wholesale_price_usd, 0) * 10000.0) AS INTEGER)), 0) + COALESCE(SUM(CAST(ROUND(COALESCE(wholesale_price_khr, 0) * 10000.0) AS INTEGER)), 0) FROM products),
  (SELECT COALESCE(SUM(CAST(ROUND(COALESCE(stock_quantity, 0) * 10000.0) AS INTEGER)), 0) FROM products),
  (SELECT COUNT(cost_review_key) FROM products), (SELECT COALESCE(SUM(COALESCE(unicode(substr(updated_at, -2, 1)), 0) * 100 + COALESCE(unicode(substr(updated_at, -1, 1)), 0)), 0) + COUNT(updated_at) FROM products),
  (SELECT COUNT(*) FROM product_batches), (SELECT COALESCE(SUM(is_active), 0) FROM product_batches), (SELECT COALESCE(SUM(CAST(ROUND(COALESCE(received_quantity, 0) * 10000.0) AS INTEGER)), 0) FROM product_batches),
  (SELECT COALESCE(SUM(CASE WHEN id NOT IN (SELECT row_id FROM cost_4dp_repair_0313 WHERE entity = 'product_batches' AND col = 'unit_cost_usd') THEN CAST(ROUND(COALESCE(unit_cost_usd, 0) * 10000.0) AS INTEGER) ELSE 0 END), 0) FROM product_batches),
  (SELECT COALESCE(SUM(CASE WHEN id NOT IN (SELECT row_id FROM cost_4dp_repair_0313 WHERE entity = 'product_batches' AND col = 'received_cost_usd') THEN CAST(ROUND(COALESCE(received_cost_usd, 0) * 10000.0) AS INTEGER) ELSE 0 END), 0) FROM product_batches),
  (SELECT COUNT(*) FROM product_cost_entries),
  (SELECT COALESCE(SUM(CASE WHEN id NOT IN (SELECT row_id FROM cost_4dp_repair_0313 WHERE entity = 'product_cost_entries' AND col = 'cost_usd') THEN CAST(ROUND(COALESCE(cost_usd, 0) * 10000.0) AS INTEGER) ELSE 0 END), 0) FROM product_cost_entries),
  (SELECT COALESCE(SUM(CASE WHEN id NOT IN (SELECT row_id FROM cost_4dp_repair_0313 WHERE entity = 'product_cost_entries' AND col = 'cost_khr') THEN CAST(ROUND(COALESCE(cost_khr, 0) * 10000.0) AS INTEGER) ELSE 0 END), 0) FROM product_cost_entries),
  (SELECT COALESCE(SUM(CASE WHEN id NOT IN (SELECT row_id FROM cost_4dp_repair_0313 WHERE entity = 'product_cost_entries' AND col = 'previous_cost_usd') THEN CAST(ROUND(COALESCE(previous_cost_usd, 0) * 10000.0) AS INTEGER) ELSE 0 END), 0) FROM product_cost_entries),
  (SELECT COUNT(*) FROM sale_items), (SELECT COALESCE(SUM(length(CAST(cost_price_usd AS TEXT))), 0) + COALESCE(SUM(length(CAST(cost_price_khr AS TEXT))), 0) FROM sale_items), (SELECT COALESCE(SUM(CAST(ROUND(COALESCE(cost_price_usd, 0) * 1000000.0) AS INTEGER)), 0) + COALESCE(SUM(CAST(ROUND(COALESCE(cost_price_khr, 0) * 1000000.0) AS INTEGER)), 0) FROM sale_items),
  (SELECT COUNT(*) FROM return_items), (SELECT COALESCE(SUM(length(CAST(cost_price_usd AS TEXT))), 0) + COALESCE(SUM(length(CAST(cost_price_khr AS TEXT))), 0) FROM return_items), (SELECT COALESCE(SUM(CAST(ROUND(COALESCE(cost_price_usd, 0) * 1000000.0) AS INTEGER)), 0) + COALESCE(SUM(CAST(ROUND(COALESCE(cost_price_khr, 0) * 1000000.0) AS INTEGER)), 0) FROM return_items),
  (SELECT COUNT(*) FROM inventory_movements), (SELECT COALESCE(SUM(length(CAST(unit_cost_usd AS TEXT))), 0) + COALESCE(SUM(length(CAST(unit_cost_khr AS TEXT))), 0) + COALESCE(SUM(length(CAST(total_cost_usd AS TEXT))), 0) + COALESCE(SUM(length(CAST(total_cost_khr AS TEXT))), 0) FROM inventory_movements), (SELECT COALESCE(SUM(CAST(ROUND(COALESCE(unit_cost_usd, 0) * 1000000.0) AS INTEGER)), 0) + COALESCE(SUM(CAST(ROUND(COALESCE(unit_cost_khr, 0) * 1000000.0) AS INTEGER)), 0) + COALESCE(SUM(CAST(ROUND(COALESCE(total_cost_usd, 0) * 1000000.0) AS INTEGER)), 0) + COALESCE(SUM(CAST(ROUND(COALESCE(total_cost_khr, 0) * 1000000.0) AS INTEGER)), 0) FROM inventory_movements);

CREATE TABLE _cost_4dp_keys_0313 (
  id INTEGER PRIMARY KEY,
  cost_review_key
);

INSERT INTO _cost_4dp_keys_0313 (id, cost_review_key) SELECT id, cost_review_key FROM products WHERE cost_review_key IS NOT NULL;

CREATE TABLE _cost_4dp_products_0313 (
  id INTEGER PRIMARY KEY,
  cost_usd, cost_khr, purchase_usd, purchase_khr
);

INSERT INTO _cost_4dp_products_0313 (id, cost_usd, cost_khr, purchase_usd, purchase_khr) SELECT id, cost_price_usd, cost_price_khr, purchase_price_usd, purchase_price_khr FROM products;

INSERT INTO system_flags (key, value, updated_at)
SELECT 'stock_transaction_permit', value, CURRENT_TIMESTAMP FROM system_flags WHERE key = 'stock_schema_epoch';

UPDATE products SET
  cost_price_usd = COALESCE((SELECT after_value FROM cost_4dp_repair_0313 WHERE entity = 'products' AND row_id = products.id AND col = 'cost_price_usd'), cost_price_usd),
  cost_price_khr = COALESCE((SELECT after_value FROM cost_4dp_repair_0313 WHERE entity = 'products' AND row_id = products.id AND col = 'cost_price_khr'), cost_price_khr),
  purchase_price_usd = COALESCE((SELECT after_value FROM cost_4dp_repair_0313 WHERE entity = 'products' AND row_id = products.id AND col = 'purchase_price_usd'), purchase_price_usd),
  purchase_price_khr = COALESCE((SELECT after_value FROM cost_4dp_repair_0313 WHERE entity = 'products' AND row_id = products.id AND col = 'purchase_price_khr'), purchase_price_khr)
WHERE id IN (SELECT row_id FROM cost_4dp_repair_0313 WHERE entity = 'products');

INSERT INTO system_flags (key, value, updated_at) VALUES ('maintenance', '{"mode":"restore"}', CURRENT_TIMESTAMP);

UPDATE product_batches SET unit_cost_usd = COALESCE((SELECT after_value FROM cost_4dp_repair_0313 WHERE entity = 'product_batches' AND row_id = product_batches.id AND col = 'unit_cost_usd'), unit_cost_usd)
WHERE id IN (SELECT row_id FROM cost_4dp_repair_0313 WHERE entity = 'product_batches' AND col = 'unit_cost_usd');

UPDATE product_batches SET received_cost_usd = COALESCE((SELECT after_value FROM cost_4dp_repair_0313 WHERE entity = 'product_batches' AND row_id = product_batches.id AND col = 'received_cost_usd'), received_cost_usd)
WHERE id IN (SELECT row_id FROM cost_4dp_repair_0313 WHERE entity = 'product_batches' AND col = 'received_cost_usd');

DELETE FROM system_flags WHERE key = 'maintenance' AND value = '{"mode":"restore"}';

UPDATE product_cost_entries SET
  cost_usd = COALESCE((SELECT after_value FROM cost_4dp_repair_0313 WHERE entity = 'product_cost_entries' AND row_id = product_cost_entries.id AND col = 'cost_usd'), cost_usd),
  cost_khr = COALESCE((SELECT after_value FROM cost_4dp_repair_0313 WHERE entity = 'product_cost_entries' AND row_id = product_cost_entries.id AND col = 'cost_khr'), cost_khr),
  previous_cost_usd = COALESCE((SELECT after_value FROM cost_4dp_repair_0313 WHERE entity = 'product_cost_entries' AND row_id = product_cost_entries.id AND col = 'previous_cost_usd'), previous_cost_usd)
WHERE id IN (SELECT row_id FROM cost_4dp_repair_0313 WHERE entity = 'product_cost_entries');

WITH d AS MATERIALIZED (
  SELECT products.id AS id, products.cost_price_usd AS c, products.purchase_price_usd AS p, COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN (CAST(ROUND((SUM(qty * cost) / SUM(qty)) * 10000.0000000000036) AS INTEGER) / 10000.0) END
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
    (SELECT (CAST(ROUND((pb.unit_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived
  FROM products WHERE products.is_active = 1 AND (products.id IN (SELECT pb.variant_product_id FROM product_batches pb JOIN cost_4dp_repair_0313 l ON l.entity = 'product_batches' AND l.row_id = pb.id)
      OR products.id IN (SELECT pce.product_id FROM product_cost_entries pce JOIN cost_4dp_repair_0313 l ON l.entity = 'product_cost_entries' AND l.row_id = pce.id))
)
INSERT INTO cost_4dp_repair_0313 (entity, row_id, col, before_value, after_value)
SELECT 'products', id, 'cost_price_usd', c, derived FROM d WHERE derived IS NOT NULL AND (c IS NOT derived OR p IS NOT derived)
ON CONFLICT (entity, row_id, col) DO UPDATE SET after_value = excluded.after_value;

WITH d AS MATERIALIZED (
  SELECT products.id AS id, products.cost_price_usd AS c, products.purchase_price_usd AS p, COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN (CAST(ROUND((SUM(qty * cost) / SUM(qty)) * 10000.0000000000036) AS INTEGER) / 10000.0) END
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
    (SELECT (CAST(ROUND((pb.unit_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived
  FROM products WHERE products.is_active = 1 AND (products.id IN (SELECT pb.variant_product_id FROM product_batches pb JOIN cost_4dp_repair_0313 l ON l.entity = 'product_batches' AND l.row_id = pb.id)
      OR products.id IN (SELECT pce.product_id FROM product_cost_entries pce JOIN cost_4dp_repair_0313 l ON l.entity = 'product_cost_entries' AND l.row_id = pce.id))
)
INSERT INTO cost_4dp_repair_0313 (entity, row_id, col, before_value, after_value)
SELECT 'products', id, 'purchase_price_usd', p, derived FROM d WHERE derived IS NOT NULL AND (c IS NOT derived OR p IS NOT derived)
ON CONFLICT (entity, row_id, col) DO UPDATE SET after_value = excluded.after_value;

UPDATE products SET
  cost_price_usd = COALESCE((SELECT after_value FROM cost_4dp_repair_0313 WHERE entity = 'products' AND row_id = products.id AND col = 'cost_price_usd'), cost_price_usd),
  purchase_price_usd = COALESCE((SELECT after_value FROM cost_4dp_repair_0313 WHERE entity = 'products' AND row_id = products.id AND col = 'purchase_price_usd'), purchase_price_usd)
WHERE id IN (SELECT row_id FROM cost_4dp_repair_0313 WHERE entity = 'products' AND col IN ('cost_price_usd', 'purchase_price_usd'));

DELETE FROM system_flags WHERE key = 'stock_transaction_permit' AND value = 'legacy-separate-pool-v1';

UPDATE cache_versions SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE namespace = 'products';

SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key IN ('maintenance', 'stock_transaction_permit'))
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_post_flag_left]') END;

SELECT CASE WHEN (SELECT COUNT(*) FROM products WHERE (typeof(cost_price_usd) IN ('integer', 'real') AND ABS(cost_price_usd * 10000 - ROUND(cost_price_usd * 10000)) > 0.000001)
    OR (typeof(cost_price_khr) IN ('integer', 'real') AND ABS(cost_price_khr * 10000 - ROUND(cost_price_khr * 10000)) > 0.000001)
    OR (typeof(purchase_price_usd) IN ('integer', 'real') AND ABS(purchase_price_usd * 10000 - ROUND(purchase_price_usd * 10000)) > 0.000001)
    OR (typeof(purchase_price_khr) IN ('integer', 'real') AND ABS(purchase_price_khr * 10000 - ROUND(purchase_price_khr * 10000)) > 0.000001)) = 0
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_post_products_still_over_4dp]') END;

SELECT CASE WHEN (SELECT COUNT(*) FROM cost_4dp_repair_0313 l JOIN products r ON r.id = l.row_id WHERE l.entity = 'products'
    AND (CASE l.col WHEN 'cost_price_usd' THEN r.cost_price_usd WHEN 'cost_price_khr' THEN r.cost_price_khr WHEN 'purchase_price_usd' THEN r.purchase_price_usd WHEN 'purchase_price_khr' THEN r.purchase_price_khr END) IS l.after_value) = (SELECT COUNT(*) FROM cost_4dp_repair_0313 WHERE entity = 'products')
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_post_products_ledger]') END;

SELECT CASE WHEN (SELECT COUNT(*) FROM product_batches WHERE (typeof(unit_cost_usd) IN ('integer', 'real') AND ABS(unit_cost_usd * 10000 - ROUND(unit_cost_usd * 10000)) > 0.000001)
    OR (typeof(received_cost_usd) IN ('integer', 'real') AND ABS(received_cost_usd * 10000 - ROUND(received_cost_usd * 10000)) > 0.000001)) = 0
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_post_product_batches_still_over_4dp]') END;

SELECT CASE WHEN (SELECT COUNT(*) FROM cost_4dp_repair_0313 l JOIN product_batches r ON r.id = l.row_id WHERE l.entity = 'product_batches'
    AND (CASE l.col WHEN 'unit_cost_usd' THEN r.unit_cost_usd WHEN 'received_cost_usd' THEN r.received_cost_usd END) IS l.after_value) = (SELECT COUNT(*) FROM cost_4dp_repair_0313 WHERE entity = 'product_batches')
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_post_product_batches_ledger]') END;

SELECT CASE WHEN (SELECT COUNT(*) FROM product_cost_entries WHERE (typeof(cost_usd) IN ('integer', 'real') AND ABS(cost_usd * 10000 - ROUND(cost_usd * 10000)) > 0.000001)
    OR (typeof(cost_khr) IN ('integer', 'real') AND ABS(cost_khr * 10000 - ROUND(cost_khr * 10000)) > 0.000001)
    OR (typeof(previous_cost_usd) IN ('integer', 'real') AND ABS(previous_cost_usd * 10000 - ROUND(previous_cost_usd * 10000)) > 0.000001)) = 0
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_post_product_cost_entries_still_over_4dp]') END;

SELECT CASE WHEN (SELECT COUNT(*) FROM cost_4dp_repair_0313 l JOIN product_cost_entries r ON r.id = l.row_id WHERE l.entity = 'product_cost_entries'
    AND (CASE l.col WHEN 'cost_usd' THEN r.cost_usd WHEN 'cost_khr' THEN r.cost_khr WHEN 'previous_cost_usd' THEN r.previous_cost_usd END) IS l.after_value) = (SELECT COUNT(*) FROM cost_4dp_repair_0313 WHERE entity = 'product_cost_entries')
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_post_product_cost_entries_ledger]') END;

SELECT CASE WHEN (SELECT COUNT(*) FROM cost_4dp_repair_0313 WHERE entity IN ('product_batches', 'product_cost_entries') AND ABS(after_value - before_value) > 0.00005 + 1e-9) = 0
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_post_change_over_half_tick]') END;

SELECT CASE WHEN (WITH d AS MATERIALIZED (
  SELECT products.id AS id, products.cost_price_usd AS c, products.purchase_price_usd AS p, COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN (CAST(ROUND((SUM(qty * cost) / SUM(qty)) * 10000.0000000000036) AS INTEGER) / 10000.0) END
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
    (SELECT (CAST(ROUND((pb.unit_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived
  FROM products WHERE products.is_active = 1
)
  SELECT COALESCE(SUM(derived IS NOT NULL AND (c IS NOT derived OR p IS NOT derived)), 0) FROM d) = 0
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_post_active_cost_drift]') END;

SELECT CASE WHEN (SELECT COUNT(*) FROM products) = (SELECT products_total FROM _cost_4dp_fingerprint_0313)
  AND (SELECT COUNT(*) FROM product_batches) = (SELECT lots_total FROM _cost_4dp_fingerprint_0313)
  AND (SELECT COUNT(*) FROM product_cost_entries) = (SELECT entries_total FROM _cost_4dp_fingerprint_0313)
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_post_row_counts_changed]') END;

CREATE TABLE _cost_4dp_after_0313 (
  k INTEGER PRIMARY KEY CHECK (k = 1),
  products_total, products_active, products_prices, products_stock, products_keys, products_updated,
  lots_total, lots_active, lots_quantity, lots_outside_unit, lots_outside_received,
  entries_total, entries_outside_usd, entries_outside_khr, entries_outside_previous,
  sale_items_n, sale_items_len, sale_items_micro, return_items_n, return_items_len, return_items_micro, movements_n, movements_len, movements_micro
);

INSERT INTO _cost_4dp_after_0313
SELECT 1,
  (SELECT COUNT(*) FROM products), (SELECT COALESCE(SUM(is_active), 0) FROM products),
  (SELECT COALESCE(SUM(CAST(ROUND(COALESCE(selling_price_usd, 0) * 10000.0) AS INTEGER)), 0) + COALESCE(SUM(CAST(ROUND(COALESCE(selling_price_khr, 0) * 10000.0) AS INTEGER)), 0) + COALESCE(SUM(CAST(ROUND(COALESCE(wholesale_price_usd, 0) * 10000.0) AS INTEGER)), 0) + COALESCE(SUM(CAST(ROUND(COALESCE(wholesale_price_khr, 0) * 10000.0) AS INTEGER)), 0) FROM products),
  (SELECT COALESCE(SUM(CAST(ROUND(COALESCE(stock_quantity, 0) * 10000.0) AS INTEGER)), 0) FROM products),
  (SELECT COUNT(cost_review_key) FROM products), (SELECT COALESCE(SUM(COALESCE(unicode(substr(updated_at, -2, 1)), 0) * 100 + COALESCE(unicode(substr(updated_at, -1, 1)), 0)), 0) + COUNT(updated_at) FROM products),
  (SELECT COUNT(*) FROM product_batches), (SELECT COALESCE(SUM(is_active), 0) FROM product_batches), (SELECT COALESCE(SUM(CAST(ROUND(COALESCE(received_quantity, 0) * 10000.0) AS INTEGER)), 0) FROM product_batches),
  (SELECT COALESCE(SUM(CASE WHEN id NOT IN (SELECT row_id FROM cost_4dp_repair_0313 WHERE entity = 'product_batches' AND col = 'unit_cost_usd') THEN CAST(ROUND(COALESCE(unit_cost_usd, 0) * 10000.0) AS INTEGER) ELSE 0 END), 0) FROM product_batches),
  (SELECT COALESCE(SUM(CASE WHEN id NOT IN (SELECT row_id FROM cost_4dp_repair_0313 WHERE entity = 'product_batches' AND col = 'received_cost_usd') THEN CAST(ROUND(COALESCE(received_cost_usd, 0) * 10000.0) AS INTEGER) ELSE 0 END), 0) FROM product_batches),
  (SELECT COUNT(*) FROM product_cost_entries),
  (SELECT COALESCE(SUM(CASE WHEN id NOT IN (SELECT row_id FROM cost_4dp_repair_0313 WHERE entity = 'product_cost_entries' AND col = 'cost_usd') THEN CAST(ROUND(COALESCE(cost_usd, 0) * 10000.0) AS INTEGER) ELSE 0 END), 0) FROM product_cost_entries),
  (SELECT COALESCE(SUM(CASE WHEN id NOT IN (SELECT row_id FROM cost_4dp_repair_0313 WHERE entity = 'product_cost_entries' AND col = 'cost_khr') THEN CAST(ROUND(COALESCE(cost_khr, 0) * 10000.0) AS INTEGER) ELSE 0 END), 0) FROM product_cost_entries),
  (SELECT COALESCE(SUM(CASE WHEN id NOT IN (SELECT row_id FROM cost_4dp_repair_0313 WHERE entity = 'product_cost_entries' AND col = 'previous_cost_usd') THEN CAST(ROUND(COALESCE(previous_cost_usd, 0) * 10000.0) AS INTEGER) ELSE 0 END), 0) FROM product_cost_entries),
  (SELECT COUNT(*) FROM sale_items), (SELECT COALESCE(SUM(length(CAST(cost_price_usd AS TEXT))), 0) + COALESCE(SUM(length(CAST(cost_price_khr AS TEXT))), 0) FROM sale_items), (SELECT COALESCE(SUM(CAST(ROUND(COALESCE(cost_price_usd, 0) * 1000000.0) AS INTEGER)), 0) + COALESCE(SUM(CAST(ROUND(COALESCE(cost_price_khr, 0) * 1000000.0) AS INTEGER)), 0) FROM sale_items),
  (SELECT COUNT(*) FROM return_items), (SELECT COALESCE(SUM(length(CAST(cost_price_usd AS TEXT))), 0) + COALESCE(SUM(length(CAST(cost_price_khr AS TEXT))), 0) FROM return_items), (SELECT COALESCE(SUM(CAST(ROUND(COALESCE(cost_price_usd, 0) * 1000000.0) AS INTEGER)), 0) + COALESCE(SUM(CAST(ROUND(COALESCE(cost_price_khr, 0) * 1000000.0) AS INTEGER)), 0) FROM return_items),
  (SELECT COUNT(*) FROM inventory_movements), (SELECT COALESCE(SUM(length(CAST(unit_cost_usd AS TEXT))), 0) + COALESCE(SUM(length(CAST(unit_cost_khr AS TEXT))), 0) + COALESCE(SUM(length(CAST(total_cost_usd AS TEXT))), 0) + COALESCE(SUM(length(CAST(total_cost_khr AS TEXT))), 0) FROM inventory_movements), (SELECT COALESCE(SUM(CAST(ROUND(COALESCE(unit_cost_usd, 0) * 1000000.0) AS INTEGER)), 0) + COALESCE(SUM(CAST(ROUND(COALESCE(unit_cost_khr, 0) * 1000000.0) AS INTEGER)), 0) + COALESCE(SUM(CAST(ROUND(COALESCE(total_cost_usd, 0) * 1000000.0) AS INTEGER)), 0) + COALESCE(SUM(CAST(ROUND(COALESCE(total_cost_khr, 0) * 1000000.0) AS INTEGER)), 0) FROM inventory_movements);

SELECT CASE WHEN (SELECT COUNT(*) FROM _cost_4dp_fingerprint_0313 f JOIN _cost_4dp_after_0313 a ON a.k = f.k WHERE f.products_total IS a.products_total AND f.products_active IS a.products_active AND f.products_prices IS a.products_prices AND f.products_stock IS a.products_stock AND f.products_keys IS a.products_keys AND f.products_updated IS a.products_updated AND f.lots_total IS a.lots_total AND f.lots_active IS a.lots_active AND f.lots_quantity IS a.lots_quantity AND f.lots_outside_unit IS a.lots_outside_unit AND f.lots_outside_received IS a.lots_outside_received AND f.entries_total IS a.entries_total AND f.entries_outside_usd IS a.entries_outside_usd AND f.entries_outside_khr IS a.entries_outside_khr AND f.entries_outside_previous IS a.entries_outside_previous AND f.sale_items_n IS a.sale_items_n AND f.sale_items_len IS a.sale_items_len AND f.sale_items_micro IS a.sale_items_micro AND f.return_items_n IS a.return_items_n AND f.return_items_len IS a.return_items_len AND f.return_items_micro IS a.return_items_micro AND f.movements_n IS a.movements_n AND f.movements_len IS a.movements_len AND f.movements_micro IS a.movements_micro) = 1
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_post_untouched_changed]') END;

SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM _cost_4dp_products_0313 s JOIN products p ON p.id = s.id WHERE
  (p.cost_price_usd IS NOT s.cost_usd AND NOT EXISTS (SELECT 1 FROM cost_4dp_repair_0313 l WHERE l.entity = 'products' AND l.row_id = s.id AND l.col = 'cost_price_usd'))
  OR (p.cost_price_khr IS NOT s.cost_khr AND NOT EXISTS (SELECT 1 FROM cost_4dp_repair_0313 l WHERE l.entity = 'products' AND l.row_id = s.id AND l.col = 'cost_price_khr'))
  OR (p.purchase_price_usd IS NOT s.purchase_usd AND NOT EXISTS (SELECT 1 FROM cost_4dp_repair_0313 l WHERE l.entity = 'products' AND l.row_id = s.id AND l.col = 'purchase_price_usd'))
  OR (p.purchase_price_khr IS NOT s.purchase_khr AND NOT EXISTS (SELECT 1 FROM cost_4dp_repair_0313 l WHERE l.entity = 'products' AND l.row_id = s.id AND l.col = 'purchase_price_khr')))
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_post_product_cost_outside_ledger_changed]') END;

SELECT CASE WHEN (SELECT COUNT(*) FROM _cost_4dp_keys_0313 k JOIN products p ON p.id = k.id WHERE p.cost_review_key IS k.cost_review_key) = (SELECT COUNT(*) FROM _cost_4dp_keys_0313)
  AND (SELECT COUNT(cost_review_key) FROM products) = (SELECT COUNT(*) FROM _cost_4dp_keys_0313)
THEN 1 ELSE json_extract('[]', '$[cost_4dp_0313_post_cost_review_key_changed]') END;

DROP TABLE _cost_4dp_after_0313;

DROP TABLE _cost_4dp_fingerprint_0313;

DROP TABLE _cost_4dp_keys_0313;

DROP TABLE _cost_4dp_products_0313;
