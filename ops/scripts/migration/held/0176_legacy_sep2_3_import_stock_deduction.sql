-- 0176 (HELD): deduct stock for the 22 legacy-import sales of Sep 2-3 2026
-- (sales 16842-16863, old-system invoices 004435-004456) that were inserted
-- on Sep 4 with stock deliberately untouched.
--
-- HELD, NOT IN THE MIGRATION CHAIN. This file lives under ops/scripts/
-- migration/held/ on purpose: `wrangler d1 migrations apply` applies every
-- file in cloudflare/migrations/, and this one reverses an explicit owner
-- instruction from Sep 4 ("don't affect stock quantity, no deduction",
-- ops/scripts/migration/SEP02-03-IMPORT-RECORD.md). It is applied only if
-- the owner says so, by moving it to cloudflare/migrations/ under the next
-- free number (0176 today) and applying it with the usual command.
-- test-migration-held-0176-pure.cjs pins it from here.
--
-- ============================= THE QUESTION ==============================
-- The Sep 2 "Authoritative Item Export" reconciliation (applied Sep 2
-- ~17:23Z, stamped 15:30Z) set every product's on-hand from the old
-- system's count. Sales 16859-16863 were rung in the old system on Sep 2
-- 10:33Z-13:42Z, i.e. BEFORE that export -- so the export almost certainly
-- already reflects their deduction and deducting them again would
-- double-count. Sales 16842-16858 were rung on Sep 3 in the old system,
-- AFTER the export, and their units were never deducted anywhere: the new
-- system holds no allocation and no movement for them. Whether the export
-- included the Sep 2 evening sales cannot be proven from data (owner:
-- "i'm not sure if they were imported from old system or done sales in
-- this new system. might be mix."). Every line below is therefore tagged
-- with its day, and the owner can strike the Sep 2 block.
--
-- ============================== LINES ====================================
-- Deductible today (a Shop lot holds at least the line quantity). The lot
-- is the receipt-time FIFO lot at branch 2 as audited 2026-09-16, after
-- 0173's own deductions (lots 52209, 52753, 61114, 55125 are shared):
--
--   Sep 3 (invoice day after the export):
--   40134 16842 8801 x1  lot 52634    40136 16843 5411 x1  lot 56759
--   40137 16843 5140 x1  lot 55198    40139 16844 7276 x1  lot 61192
--   40141 16845 1578 x1  lot 51881    40143 16846 6020 x1  lot 52006
--   40145 16847 114  x1  lot 53202    40146 16847 121  x1  lot 51511
--   40148 16848 18   x1  lot 53167    40150 16849 1369 x1  lot 51437
--   40152 16850 2586 x4  lot 52210    40153 16850 2590 x5  lot 52213
--   40154 16850 7875 x5  lot 52206    40155 16851 9552 x3  lot 55099
--   40158 16852 7878 x3  lot 52209    40159 16852 7893 x2  lot 52223
--   40160 16852 7888 x2  lot 52217    40162 16853 5269 x1  lot 55220
--   40164 16854 8074 x1  lot 56988    40165 16855 7876 x10 lot 52207
--   40166 16856 11   x1  lot 55996    40167 16856 9092 x1  lot 52753
--   40169 16857 111  x1  lot 53200    40170 16858 9571 x1  lot 55125
--   40171 16858 6796 x1  lot 61114
--   Sep 2 evening (before the export -- probably already counted):
--   40172 16859 4422 x1  lot 51378    40173 16859 9571 x1  lot 55125
--   40174 16860 9490 x6  lot 55039    40176 16860 9571 x12 lot 55125
--   40177 16860 468  x10 lot 53365    40178 16860 446  x3  lot 53343
--   40179 16860 6403 x4  lot 53345    40180 16860 432  x6  lot 53329
--   40181 16860 6386 x6  lot 53326    40183 16861 6009 x1  lot 53434
--   40185 16862 1610 x1  lot 51908    40188 16863 1723 x2  lot 53783
--   40189 16863 7231 x3  lot 53782
--   = 38 lines / 107 units.
--
-- NOT deductible today (listed for the owner; nothing is done for them):
--   40135 16843 5158 x1   no stock on 5158 "RT Brush Mini Kit 10"; its twin
--                         9631 "Real Techniques Brush Mini Kit 10" (same
--                         barcode 079625042856) has 6 warehouse / 1 shop --
--                         a merge candidate (0174 rule) first, then deduct.
--   40156 16851 4959 x3   Shop lot 55097 holds 1; 6 at the Warehouse.
--   40157 16851 4209 x24  Shop lots 54801 (6) + 61145 (4); 448 Warehouse.
--   40168 16857 9716 x1   Shop 0; 29 at the Warehouse.
--   40175 16860 4834 x6   original 3 units: Shop 0 (the Sep 16 "Quantity
--                         increased" 3->6 amendment already deducted its
--                         own 3 from lot 55037, allocation 512).
--   40182 16860 1868 x4   no stock anywhere.
--   40186 16863 4216 x7   Shop lot 54808 holds 1; 125 total.
--   40187 16863 7157 x5   Shop lot 51909 holds 3 after 0173.
--   Lines with product_id NULL (40138, 40140, 40142, 40144, 40147, 40149,
--   40151, 40161, 40163, 40184; quantity 1, cost 0) are non-stock lines.
--
-- ============================== RULE =====================================
-- Same effect as a completed sale: one live allocation per line (quantity
-- held, released 0), branch_batch_stock / branch_stock / products each
-- minus the quantity, one 'sale' movement with the line cost (falls back
-- to the lot cost when the line carries 0), reason names this file;
-- undo_snapshots row with every before-value, action_history and
-- audit_logs per sale, attributed to 'migration:0176_legacy_sep2_3_import_
-- stock_deduction'. Guards abort the file (CHECK ok = 1) unless the
-- pending set is exactly the 38 lines or empty, every lot belongs to its
-- product and is active, and every lot/branch/product can absorb the
-- deduction.
--
-- ============================== PRE-ASSERTION ============================
--   SELECT COUNT(*) FROM sale_items si JOIN sales s ON s.id=si.sale_id
--   WHERE si.sale_id BETWEEN 16842 AND 16863 AND si.product_id IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM sale_item_batch_allocations a WHERE a.sale_item_id=si.id)
--     AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.reference_id=s.id AND m.product_id=si.product_id AND m.movement_type='sale');
--   -- expect 46 (38 deductible + 8 listed above)
--   SELECT COUNT(*) FROM audit_logs WHERE user_name='migration:0176_legacy_sep2_3_import_stock_deduction'; -- 0
--
-- ============================== POST-ASSERTION ===========================
--   SELECT COUNT(*), SUM(quantity) FROM legacy_import_stock_repair_0176 WHERE applied=1; -- 38, 107
--   SELECT COUNT(*) FROM inventory_movements WHERE user_name='migration:0176_legacy_sep2_3_import_stock_deduction'; -- 38
--   SELECT COUNT(*) FROM sale_item_batch_allocations WHERE sale_item_id IN (SELECT sale_item_id FROM legacy_import_stock_repair_0176); -- 38
--   SELECT COUNT(*) FROM products p WHERE p.id IN (SELECT product_id FROM legacy_import_stock_repair_0176)
--     AND p.stock_quantity <> (SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id=p.id); -- 0
--
-- ============================== RECOVERY =================================
-- Before-values per line in legacy_import_stock_repair_0176 and in the
-- undo_snapshots row (kind 'sale.legacy_import_stock_deduction', source
-- 'repair-0176'). Reverse a line: add quantity back to the three ledgers,
-- delete its allocation (allocation ids are recorded in the work table)
-- and the movement with this file's user_name and its sale/product.

CREATE TABLE IF NOT EXISTS legacy_import_stock_repair_0176 (
  sale_item_id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL,
  receipt_number TEXT,
  product_id INTEGER NOT NULL,
  product_name TEXT,
  branch_id INTEGER NOT NULL,
  deduct_batch_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  unit_cost_usd REAL NOT NULL DEFAULT 0,
  batch_before REAL,
  branch_before REAL,
  product_before REAL,
  allocation_id INTEGER,
  invoice_day TEXT,
  applied INTEGER NOT NULL DEFAULT 0,
  applied_at TEXT
);

CREATE TABLE IF NOT EXISTS legacy_import_stock_lines_0176 (
  sale_item_id INTEGER PRIMARY KEY,
  deduct_batch_id INTEGER NOT NULL,
  invoice_day TEXT NOT NULL
);
DELETE FROM legacy_import_stock_lines_0176;
INSERT INTO legacy_import_stock_lines_0176 (sale_item_id, deduct_batch_id, invoice_day) VALUES
  (40134, 52634, '2026-09-03'), (40136, 56759, '2026-09-03'), (40137, 55198, '2026-09-03'), (40139, 61192, '2026-09-03'),
  (40141, 51881, '2026-09-03'), (40143, 52006, '2026-09-03'), (40145, 53202, '2026-09-03'), (40146, 51511, '2026-09-03'),
  (40148, 53167, '2026-09-03'), (40150, 51437, '2026-09-03'), (40152, 52210, '2026-09-03'), (40153, 52213, '2026-09-03'),
  (40154, 52206, '2026-09-03'), (40155, 55099, '2026-09-03'), (40158, 52209, '2026-09-03'), (40159, 52223, '2026-09-03'),
  (40160, 52217, '2026-09-03'), (40162, 55220, '2026-09-03'), (40164, 56988, '2026-09-03'), (40165, 52207, '2026-09-03'),
  (40166, 55996, '2026-09-03'), (40167, 52753, '2026-09-03'), (40169, 53200, '2026-09-03'), (40170, 55125, '2026-09-03'),
  (40171, 61114, '2026-09-03'),
  (40172, 51378, '2026-09-02'), (40173, 55125, '2026-09-02'), (40174, 55039, '2026-09-02'), (40176, 55125, '2026-09-02'),
  (40177, 53365, '2026-09-02'), (40178, 53343, '2026-09-02'), (40179, 53345, '2026-09-02'), (40180, 53329, '2026-09-02'),
  (40181, 53326, '2026-09-02'), (40183, 53434, '2026-09-02'), (40185, 51908, '2026-09-02'), (40188, 53783, '2026-09-02'),
  (40189, 53782, '2026-09-02');

INSERT OR IGNORE INTO legacy_import_stock_repair_0176 (
  sale_item_id, sale_id, receipt_number, product_id, product_name, branch_id, deduct_batch_id, quantity, unit_cost_usd,
  batch_before, branch_before, product_before, invoice_day
)
SELECT
  si.id, s.id, s.receipt_number, si.product_id, si.product_name, s.branch_id, l.deduct_batch_id, si.quantity,
  COALESCE(NULLIF(si.cost_price_usd, 0), (SELECT pb.unit_cost_usd FROM product_batches pb WHERE pb.id = l.deduct_batch_id), 0),
  (SELECT b.quantity FROM branch_batch_stock b WHERE b.batch_id = l.deduct_batch_id AND b.branch_id = s.branch_id),
  (SELECT bs.quantity FROM branch_stock bs WHERE bs.product_id = si.product_id AND bs.branch_id = s.branch_id),
  (SELECT p.stock_quantity FROM products p WHERE p.id = si.product_id),
  l.invoice_day
FROM legacy_import_stock_lines_0176 l
JOIN sale_items si ON si.id = l.sale_item_id
JOIN sales s ON s.id = si.sale_id
WHERE s.id BETWEEN 16842 AND 16863
  AND s.sale_status = 'completed'
  AND COALESCE(s.stock_skipped, 0) = 0
  AND s.branch_id = 2
  AND si.product_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sale_item_batch_allocations a WHERE a.sale_item_id = si.id)
  AND NOT EXISTS (
    SELECT 1 FROM inventory_movements m
    WHERE m.reference_id = s.id AND m.product_id = si.product_id AND m.movement_type = 'sale'
  );

CREATE TABLE IF NOT EXISTS legacy_import_stock_guard_0176 (
  check_name TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);
DELETE FROM legacy_import_stock_guard_0176;
INSERT INTO legacy_import_stock_guard_0176 (check_name, ok)
SELECT 'pending_count_is_0_or_38', CASE WHEN
  (SELECT COUNT(*) FROM legacy_import_stock_repair_0176 WHERE applied = 0) IN (0, 38) THEN 1 ELSE 0 END;
INSERT INTO legacy_import_stock_guard_0176 (check_name, ok)
SELECT 'deduct_lots_belong_and_active', CASE WHEN NOT EXISTS (
  SELECT 1 FROM legacy_import_stock_repair_0176 r
  LEFT JOIN product_batches pb ON pb.id = r.deduct_batch_id
  WHERE r.applied = 0 AND (pb.id IS NULL OR pb.variant_product_id <> r.product_id OR COALESCE(pb.is_active, 0) <> 1)
) THEN 1 ELSE 0 END;
INSERT INTO legacy_import_stock_guard_0176 (check_name, ok)
SELECT 'lot_stock_sufficient', CASE WHEN NOT EXISTS (
  SELECT 1 FROM legacy_import_stock_repair_0176 r
  WHERE r.applied = 0
  GROUP BY r.deduct_batch_id, r.branch_id
  HAVING SUM(r.quantity) > COALESCE((SELECT b.quantity FROM branch_batch_stock b
    WHERE b.batch_id = r.deduct_batch_id AND b.branch_id = r.branch_id), 0)
) THEN 1 ELSE 0 END;
INSERT INTO legacy_import_stock_guard_0176 (check_name, ok)
SELECT 'branch_stock_sufficient', CASE WHEN NOT EXISTS (
  SELECT 1 FROM legacy_import_stock_repair_0176 r
  WHERE r.applied = 0
  GROUP BY r.product_id, r.branch_id
  HAVING SUM(r.quantity) > COALESCE((SELECT bs.quantity FROM branch_stock bs
    WHERE bs.product_id = r.product_id AND bs.branch_id = r.branch_id), 0)
) THEN 1 ELSE 0 END;
INSERT INTO legacy_import_stock_guard_0176 (check_name, ok)
SELECT 'product_stock_sufficient', CASE WHEN NOT EXISTS (
  SELECT 1 FROM legacy_import_stock_repair_0176 r
  WHERE r.applied = 0
  GROUP BY r.product_id
  HAVING SUM(r.quantity) > COALESCE((SELECT p.stock_quantity FROM products p WHERE p.id = r.product_id), 0)
) THEN 1 ELSE 0 END;

INSERT INTO undo_snapshots (kind, status, payload_json, created_by_id, created_by_name)
SELECT
  'sale.legacy_import_stock_deduction', 'applied',
  json_object(
    'source', 'repair-0176',
    'lines', json_group_array(json_object(
      'sale_item_id', r.sale_item_id, 'sale_id', r.sale_id, 'receipt_number', r.receipt_number,
      'product_id', r.product_id, 'branch_id', r.branch_id, 'deduct_batch_id', r.deduct_batch_id,
      'quantity', r.quantity, 'unit_cost_usd', r.unit_cost_usd, 'invoice_day', r.invoice_day,
      'batch_before', r.batch_before, 'branch_before', r.branch_before, 'product_before', r.product_before))
  ),
  NULL, 'migration:0176_legacy_sep2_3_import_stock_deduction'
FROM legacy_import_stock_repair_0176 r
WHERE r.applied = 0
GROUP BY r.applied;

UPDATE branch_batch_stock SET
  quantity = quantity - (SELECT SUM(r.quantity) FROM legacy_import_stock_repair_0176 r
    WHERE r.applied = 0 AND r.deduct_batch_id = branch_batch_stock.batch_id AND r.branch_id = branch_batch_stock.branch_id),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM legacy_import_stock_repair_0176 r
  WHERE r.applied = 0 AND r.deduct_batch_id = branch_batch_stock.batch_id AND r.branch_id = branch_batch_stock.branch_id);

UPDATE branch_stock SET
  quantity = quantity - (SELECT SUM(r.quantity) FROM legacy_import_stock_repair_0176 r
    WHERE r.applied = 0 AND r.product_id = branch_stock.product_id AND r.branch_id = branch_stock.branch_id)
WHERE EXISTS (SELECT 1 FROM legacy_import_stock_repair_0176 r
  WHERE r.applied = 0 AND r.product_id = branch_stock.product_id AND r.branch_id = branch_stock.branch_id);

UPDATE products SET
  stock_quantity = stock_quantity - (SELECT SUM(r.quantity) FROM legacy_import_stock_repair_0176 r
    WHERE r.applied = 0 AND r.product_id = products.id),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM legacy_import_stock_repair_0176 r WHERE r.applied = 0 AND r.product_id = products.id);

-- One live allocation per line, so a later return/cancel releases to the right lot.
INSERT INTO sale_item_batch_allocations (sale_item_id, batch_id, branch_id, quantity, lot_code, expiry_date, released_quantity)
SELECT r.sale_item_id, r.deduct_batch_id, r.branch_id, r.quantity, pb.lot_code, pb.expiry_date, 0
FROM legacy_import_stock_repair_0176 r
JOIN product_batches pb ON pb.id = r.deduct_batch_id
WHERE r.applied = 0
ORDER BY r.sale_item_id;
UPDATE legacy_import_stock_repair_0176 SET
  allocation_id = (SELECT a.id FROM sale_item_batch_allocations a WHERE a.sale_item_id = legacy_import_stock_repair_0176.sale_item_id AND a.batch_id = legacy_import_stock_repair_0176.deduct_batch_id ORDER BY a.id DESC LIMIT 1)
WHERE applied = 0;

INSERT INTO inventory_movements (
  product_id, product_name, branch_id, branch_name, movement_type, quantity,
  unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name, batch_id
)
SELECT
  r.product_id, r.product_name, r.branch_id, (SELECT b.name FROM branches b WHERE b.id = r.branch_id),
  'sale', -r.quantity, r.unit_cost_usd, 0,
  'Legacy old-system sale of ' || r.invoice_day || ' imported Sep 4 without deduction (migration 0176)',
  r.sale_id, NULL, 'migration:0176_legacy_sep2_3_import_stock_deduction', r.deduct_batch_id
FROM legacy_import_stock_repair_0176 r
WHERE r.applied = 0
ORDER BY r.sale_item_id;

INSERT INTO action_history (scope, entity, entity_id, label, reversible, status, undo_payload, redo_payload, created_by_id, created_by_name)
SELECT
  'global', 'sale_legacy_import_stock_deduction', CAST(r.sale_id AS TEXT),
  'Deduct stock for legacy sale ' || COALESCE(r.receipt_number, CAST(r.sale_id AS TEXT)),
  0, 'recorded', '{}',
  json_object('kind', 'sale_stock_corrected', 'source', 'migration:0176_legacy_sep2_3_import_stock_deduction',
    'sale_id', r.sale_id, 'invoice_day', MIN(r.invoice_day), 'units', SUM(r.quantity),
    'sale_item_ids', json_group_array(r.sale_item_id), 'reversible', json('false')),
  NULL, 'migration:0176_legacy_sep2_3_import_stock_deduction'
FROM legacy_import_stock_repair_0176 r
WHERE r.applied = 0
GROUP BY r.sale_id, r.receipt_number;

INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, table_name, record_id, old_value, new_value)
SELECT
  NULL, 'migration:0176_legacy_sep2_3_import_stock_deduction', 'deduct_legacy_import_sale_stock', 'sale', CAST(r.sale_id AS TEXT),
  json_object('source', 'repair-0176', 'sale_item_ids', json_group_array(r.sale_item_id), 'units', SUM(r.quantity)),
  'sales', CAST(r.sale_id AS TEXT),
  json_object('stock_effect', 'none'), json_object('stock_effect', 'deducted_now')
FROM legacy_import_stock_repair_0176 r
WHERE r.applied = 0
GROUP BY r.sale_id;

UPDATE legacy_import_stock_repair_0176 SET applied = 1, applied_at = CURRENT_TIMESTAMP WHERE applied = 0;

INSERT INTO legacy_import_stock_guard_0176 (check_name, ok)
SELECT 'ledgers_agree_after', CASE WHEN NOT EXISTS (
  SELECT 1 FROM products p
  WHERE p.id IN (SELECT product_id FROM legacy_import_stock_repair_0176)
    AND ABS(p.stock_quantity - (SELECT COALESCE(SUM(bs.quantity), 0) FROM branch_stock bs WHERE bs.product_id = p.id)) > 0.0001
) THEN 1 ELSE 0 END;
INSERT INTO legacy_import_stock_guard_0176 (check_name, ok)
SELECT 'every_applied_line_has_allocation', CASE WHEN NOT EXISTS (
  SELECT 1 FROM legacy_import_stock_repair_0176 r WHERE r.applied = 1 AND r.allocation_id IS NULL
) THEN 1 ELSE 0 END;

DROP TABLE IF EXISTS legacy_import_stock_guard_0176;
DROP TABLE IF EXISTS legacy_import_stock_lines_0176;
