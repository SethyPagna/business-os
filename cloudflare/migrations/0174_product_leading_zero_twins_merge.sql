-- 0174: fold the four remaining same-product twins whose barcodes differ
-- only by a leading zero (or are identical) into one product each.
--
-- PREPARED FOR THE PROGRAM 10 CHECKPOINT B APPLY (announced in the status).
-- Append-only chain: 0173 is the prior migration. DDL is limited to this
-- file's own pairs/map/scratch/guard tables. Owner rule (2026-09-15/16,
-- product-merge-barcode-and-cost-rules): same product, barcode differing
-- only by a leading zero -> one product, the stored barcode loses the
-- leading zero, cost = mean of the distinct non-zero costs, no prompt; and
-- message F (2026-09-16): "make sure you fix previous data because of these
-- issues" -> the existing rows are folded here, not left for the UI.
--
-- ============================= WHY THIS EXISTS ===========================
-- 0165 and 0168 merged same-NAME rows. The Sep 16 audit of every active
-- product (barcode digits compared after stripping leading zeros) found
-- four pairs that 0165's exact-name key could not see because the two
-- spellings differ by punctuation, accent or case, yet are one article:
--
--   loser  name (loser)                                keeper  name (keeper)                                barcode (loser / keeper)
--   9709   "Secret Powder Fresh (ប្រអប់)"               5205    "Secret Powder Fresh ប្រអប់"                  037000256823 / 037000256823
--   7117   "Degree Shower Clean (set)"                 1560    "Degree Shower Clean Set"                    079400490704 / 079400490704
--   9609   "Rare Powder Blush-Happy"                   5063    "Rare Powder Blush Happy"                     840122906596 / 0840122906596
--   3470   "Lancome Absolue Riche Cream Refill 60ml"   8660    "Lancôme Absolue Riche Cream Refill 60ml"    03614272049154 / 3614272049154
--
-- Keeper = the row carrying the product's history (lots, sale lines,
-- import provenance): 5205 (import lot), 1560 (import lot), 5063 (22 lots,
-- 56 sale lines), 8660 (4 lots incl. the 272.00 receipt, sale line 28039).
-- Losers: 9709/7117 hold one empty RECON lot each; 9609 holds RECON lot
-- 55156 (5 units at the Shop, 24.394739) which moves to 5063; 3470 holds
-- one empty lot. None of the eight ids appears in transfer_operation_
-- members, stock_session_members, stock_row_moves, promotions, rfid_*,
-- damaged_stock_lots, return_items or product_images (audited 2026-09-16),
-- so no 0151 transfer trigger needs dropping here.
--
-- ============================== RULE =====================================
-- Same body as 0168 (which is 0165's per-pair body): pairs table -> map
-- with the loser's full pre-image -> keeper fields -> branch_stock fold ->
-- lot repoint with batch_key collision suffix -> 1:1 repoints -> keeper
-- stock recompute -> audit row per loser -> DELETE loser. Two additions:
--   * keeper cost is recomputed from its ACTIVE LOTS after the repoint with
--     the catalog formula (lib/catalogCostRecompute.ts: distinct non-zero
--     unit_cost_usd; dearest if > 2x the cheapest, else the mean rounded
--     to 4 dp; purchase_price_usd mirrored) -- the pair-average of 0168
--     runs first as a fallback for a keeper with no costed lot;
--   * one undo_snapshots row of kind 'product.merge' per pair, written
--     BEFORE sale_items are repointed, listing the reparented sale item
--     ids (the lineage evidence lib/productMergeLineage.ts requires; 0171
--     had to backfill it for 0165/0168).
-- A pair is merged only if, at apply time, both ids exist and are active,
-- the loser is not already mapped, and the two barcodes are equal after
-- stripping leading zeros -- so the fold rule itself is the guard, not the
-- name spelling.
--
-- ============================== IDEMPOTENCE ==============================
-- After the first run the loser ids no longer exist, the pairs join finds
-- nothing, the working set (map rows whose loser still exists) is empty and
-- every statement scoped by it is a no-op. On a database
-- without these ids (fixture) the pairs table stays empty.
--
-- ============================== PRE-ASSERTION (run before applying) ======
--   SELECT id, name, barcode, is_active, stock_quantity, cost_price_usd FROM products WHERE id IN (9709,5205,7117,1560,9609,5063,3470,8660);
--   SELECT COUNT(*) FROM audit_logs WHERE user_name='migration:0174_product_leading_zero_twins_merge'; -- 0
--   SELECT SUM(quantity) FROM branch_stock WHERE product_id IN (9609,5063); -- 5 (moves onto 5063)
--
-- ============================== POST-ASSERTION ===========================
--   SELECT COUNT(*) FROM product_merge_map_0174; -- 4
--   SELECT COUNT(*) FROM products WHERE id IN (9709,7117,9609,3470); -- 0
--   SELECT id, barcode FROM products WHERE id IN (5205,1560,5063,8660); -- 37000256823, 79400490704, 840122906596, 3614272049154
--   SELECT variant_product_id FROM product_batches WHERE id=55156; -- 5063
--   SELECT SUM(quantity) FROM branch_stock WHERE product_id=5063; -- 5
--   SELECT COUNT(*) FROM undo_snapshots WHERE kind='product.merge' AND json_extract(payload_json,'$.source')='repair-0174'; -- 4
--   SELECT COUNT(*) FROM sale_items WHERE product_id IN (9709,7117,9609,3470); -- 0
--
-- ============================== RECOVERY =================================
-- product_merge_map_0174.loser_json holds each loser's full pre-image (also
-- in audit_logs.old_value, user_name 'migration:0174_product_leading_zero_
-- twins_merge', record_id = loser id). Re-insert with 0165's RECOVERY
-- template (substitute product_merge_map_0174); lots and stock can be
-- moved back by variant_product_id/product_id using the ids recorded in
-- the undo_snapshots payload (reparentedSaleItemIds, lotIds).

CREATE TABLE IF NOT EXISTS product_merge_pairs_0174 (
  loser_id INTEGER PRIMARY KEY,
  keeper_id INTEGER NOT NULL,
  note TEXT
);
INSERT INTO product_merge_pairs_0174 (loser_id, keeper_id, note)
SELECT 9709, 5205, 'secret powder fresh: identical barcode 037000256823, punctuation-only name difference'
WHERE NOT EXISTS (SELECT 1 FROM product_merge_pairs_0174 WHERE loser_id = 9709)
  AND EXISTS (SELECT 1 FROM products WHERE id = 9709) AND EXISTS (SELECT 1 FROM products WHERE id = 5205);
INSERT INTO product_merge_pairs_0174 (loser_id, keeper_id, note)
SELECT 7117, 1560, 'degree shower clean set: identical barcode 079400490704, case/parentheses-only name difference'
WHERE NOT EXISTS (SELECT 1 FROM product_merge_pairs_0174 WHERE loser_id = 7117)
  AND EXISTS (SELECT 1 FROM products WHERE id = 7117) AND EXISTS (SELECT 1 FROM products WHERE id = 1560);
INSERT INTO product_merge_pairs_0174 (loser_id, keeper_id, note)
SELECT 9609, 5063, 'rare powder blush happy: 840122906596 vs 0840122906596, hyphen-only name difference'
WHERE NOT EXISTS (SELECT 1 FROM product_merge_pairs_0174 WHERE loser_id = 9609)
  AND EXISTS (SELECT 1 FROM products WHERE id = 9609) AND EXISTS (SELECT 1 FROM products WHERE id = 5063);
INSERT INTO product_merge_pairs_0174 (loser_id, keeper_id, note)
SELECT 3470, 8660, 'lancome absolue riche cream refill 60ml: 03614272049154 vs 3614272049154, accent-only name difference'
WHERE NOT EXISTS (SELECT 1 FROM product_merge_pairs_0174 WHERE loser_id = 3470)
  AND EXISTS (SELECT 1 FROM products WHERE id = 3470) AND EXISTS (SELECT 1 FROM products WHERE id = 8660);

CREATE TABLE IF NOT EXISTS product_merge_map_0174 (
  loser_id INTEGER PRIMARY KEY,
  keeper_id INTEGER NOT NULL,
  name_key TEXT NOT NULL,
  loser_json TEXT NOT NULL,
  applied_at TEXT DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO product_merge_map_0174 (loser_id, keeper_id, name_key, loser_json)
SELECT
  pr.id, pk.id, LOWER(TRIM(pk.name)),
  json_object(
      'id', pr.id, 'name', pr.name, 'sku', pr.sku, 'barcode', pr.barcode, 'category', pr.category,
      'unit', pr.unit, 'description', pr.description,
      'selling_price_usd', pr.selling_price_usd, 'selling_price_khr', pr.selling_price_khr,
      'wholesale_price_usd', pr.wholesale_price_usd, 'wholesale_price_khr', pr.wholesale_price_khr,
      'cost_price_usd', pr.cost_price_usd, 'cost_price_khr', pr.cost_price_khr,
      'purchase_price_usd', pr.purchase_price_usd,
      'stock_quantity', pr.stock_quantity, 'image_path', pr.image_path, 'supplier', pr.supplier,
      'brand', pr.brand, 'parent_id', pr.parent_id, 'is_active', pr.is_active, 'created_at', pr.created_at,
      'special_price_usd', pr.special_price_usd, 'special_price_khr', pr.special_price_khr,
      'lot_ids', (SELECT json_group_array(pb.id) FROM product_batches pb WHERE pb.variant_product_id = pr.id),
      'branch_stock', (SELECT json_group_array(json_object('branch_id', bs.branch_id, 'quantity', bs.quantity)) FROM branch_stock bs WHERE bs.product_id = pr.id))
FROM product_merge_pairs_0174 mp
JOIN products pr ON pr.id = mp.loser_id
JOIN products pk ON pk.id = mp.keeper_id
WHERE pr.is_active = 1 AND pk.is_active = 1
  AND LENGTH(LTRIM(TRIM(COALESCE(pr.barcode, '')), '0')) >= 6
  AND LTRIM(TRIM(COALESCE(pr.barcode, '')), '0') = LTRIM(TRIM(COALESCE(pk.barcode, '')), '0')
  AND NOT EXISTS (SELECT 1 FROM product_merge_map_0174 m WHERE m.loser_id = mp.loser_id);
CREATE INDEX IF NOT EXISTS idx_product_merge_map_0174_keeper ON product_merge_map_0174 (keeper_id);

-- Working set = map rows whose loser still exists. Every statement below is
-- scoped by it, so a re-run (loser already deleted) is a true no-op, and the
-- persistent map keeps its recovery pre-images untouched.
CREATE TABLE IF NOT EXISTS product_merge_active_0174 (
  loser_id INTEGER PRIMARY KEY,
  keeper_id INTEGER NOT NULL,
  name_key TEXT NOT NULL,
  loser_json TEXT NOT NULL
);
DELETE FROM product_merge_active_0174;
INSERT INTO product_merge_active_0174 (loser_id, keeper_id, name_key, loser_json)
SELECT m.loser_id, m.keeper_id, m.name_key, m.loser_json FROM product_merge_map_0174 m
WHERE EXISTS (SELECT 1 FROM products p WHERE p.id = m.loser_id);

-- Lineage evidence BEFORE the sale_items repoint (see header).
INSERT INTO undo_snapshots (kind, status, payload_json, created_by_id, created_by_name)
SELECT
  'product.merge', 'applied',
  json_object(
    'dupId', m.loser_id, 'keeperId', m.keeper_id,
    'reparentedSaleItemIds', (SELECT json_group_array(si.id) FROM sale_items si WHERE si.product_id = m.loser_id),
    'lotIds', (SELECT json_group_array(pb.id) FROM product_batches pb WHERE pb.variant_product_id = m.loser_id),
    'source', 'repair-0174'
  ),
  NULL, 'migration:0174_product_leading_zero_twins_merge'
FROM product_merge_active_0174 m
WHERE NOT EXISTS (
  SELECT 1 FROM undo_snapshots u
  WHERE u.kind = 'product.merge' AND json_valid(u.payload_json) = 1
    AND json_extract(u.payload_json, '$.source') = 'repair-0174'
    AND json_extract(u.payload_json, '$.dupId') = m.loser_id
);

-- Keeper cost fallback: AVG of DISTINCT non-zero cost across keeper + loser
-- (superseded below by the lot-derived figure whenever the keeper has a
-- costed active lot).
UPDATE products SET
  cost_price_usd = COALESCE((
    SELECT AVG(v) FROM (
      SELECT DISTINCT val AS v FROM (
        SELECT products.cost_price_usd AS val
        UNION ALL
        SELECT CAST(json_extract(m.loser_json, '$.cost_price_usd') AS REAL)
        FROM product_merge_active_0174 m WHERE m.keeper_id = products.id
      ) WHERE v IS NOT NULL AND v <> 0
    )
  ), products.cost_price_usd),
  cost_price_khr = COALESCE((
    SELECT AVG(v) FROM (
      SELECT DISTINCT val AS v FROM (
        SELECT products.cost_price_khr AS val
        UNION ALL
        SELECT CAST(json_extract(m.loser_json, '$.cost_price_khr') AS REAL)
        FROM product_merge_active_0174 m WHERE m.keeper_id = products.id
      ) WHERE v IS NOT NULL AND v <> 0
    )
  ), products.cost_price_khr)
WHERE id IN (SELECT DISTINCT keeper_id FROM product_merge_active_0174);

-- Keeper barcode: zero-stripped spelling of the (shared) real barcode.
UPDATE products SET
  barcode = CASE
    WHEN LENGTH(TRIM(COALESCE(barcode, ''))) >= 6
      AND TRIM(barcode) NOT GLOB '*[^0-9]*'
      AND CAST(TRIM(barcode) AS INTEGER) <> 0
    THEN LTRIM(TRIM(barcode), '0')
    ELSE barcode
  END,
  auto_merged_count = COALESCE(auto_merged_count, 0) + (
    SELECT COUNT(*) FROM product_merge_active_0174 m WHERE m.keeper_id = products.id
  ),
  updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT DISTINCT keeper_id FROM product_merge_active_0174);

-- Keeper selling/wholesale price: keeper's value unless 0, else MAX across pair.
UPDATE products SET
  selling_price_usd = CASE WHEN selling_price_usd <> 0 THEN selling_price_usd ELSE COALESCE((
    SELECT MAX(v) FROM (SELECT products.selling_price_usd AS v UNION ALL
      SELECT CAST(json_extract(m.loser_json, '$.selling_price_usd') AS REAL) FROM product_merge_active_0174 m WHERE m.keeper_id = products.id)
  ), selling_price_usd) END,
  selling_price_khr = CASE WHEN selling_price_khr <> 0 THEN selling_price_khr ELSE COALESCE((
    SELECT MAX(v) FROM (SELECT products.selling_price_khr AS v UNION ALL
      SELECT CAST(json_extract(m.loser_json, '$.selling_price_khr') AS REAL) FROM product_merge_active_0174 m WHERE m.keeper_id = products.id)
  ), selling_price_khr) END,
  wholesale_price_usd = CASE WHEN wholesale_price_usd <> 0 THEN wholesale_price_usd ELSE COALESCE((
    SELECT MAX(v) FROM (SELECT products.wholesale_price_usd AS v UNION ALL
      SELECT CAST(json_extract(m.loser_json, '$.wholesale_price_usd') AS REAL) FROM product_merge_active_0174 m WHERE m.keeper_id = products.id)
  ), wholesale_price_usd) END,
  wholesale_price_khr = CASE WHEN wholesale_price_khr <> 0 THEN wholesale_price_khr ELSE COALESCE((
    SELECT MAX(v) FROM (SELECT products.wholesale_price_khr AS v UNION ALL
      SELECT CAST(json_extract(m.loser_json, '$.wholesale_price_khr') AS REAL) FROM product_merge_active_0174 m WHERE m.keeper_id = products.id)
  ), wholesale_price_khr) END
WHERE id IN (SELECT DISTINCT keeper_id FROM product_merge_active_0174);

-- Keeper brand/category/supplier/image_path/description: keeper's value unless blank, else the loser's.
UPDATE products SET
  brand = CASE WHEN COALESCE(NULLIF(TRIM(brand), ''), '') <> '' THEN brand ELSE (
    SELECT json_extract(m.loser_json, '$.brand') FROM product_merge_active_0174 m
    WHERE m.keeper_id = products.id AND COALESCE(NULLIF(TRIM(json_extract(m.loser_json, '$.brand')), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END,
  category = CASE WHEN COALESCE(NULLIF(TRIM(category), ''), '') <> '' THEN category ELSE (
    SELECT json_extract(m.loser_json, '$.category') FROM product_merge_active_0174 m
    WHERE m.keeper_id = products.id AND COALESCE(NULLIF(TRIM(json_extract(m.loser_json, '$.category')), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END,
  supplier = CASE WHEN COALESCE(NULLIF(TRIM(supplier), ''), '') <> '' THEN supplier ELSE (
    SELECT json_extract(m.loser_json, '$.supplier') FROM product_merge_active_0174 m
    WHERE m.keeper_id = products.id AND COALESCE(NULLIF(TRIM(json_extract(m.loser_json, '$.supplier')), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END,
  image_path = CASE WHEN COALESCE(NULLIF(TRIM(image_path), ''), '') <> '' THEN image_path ELSE (
    SELECT json_extract(m.loser_json, '$.image_path') FROM product_merge_active_0174 m
    WHERE m.keeper_id = products.id AND COALESCE(NULLIF(TRIM(json_extract(m.loser_json, '$.image_path')), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END,
  description = CASE WHEN COALESCE(NULLIF(TRIM(description), ''), '') <> '' THEN description ELSE (
    SELECT json_extract(m.loser_json, '$.description') FROM product_merge_active_0174 m
    WHERE m.keeper_id = products.id AND COALESCE(NULLIF(TRIM(json_extract(m.loser_json, '$.description')), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END
WHERE id IN (SELECT DISTINCT keeper_id FROM product_merge_active_0174);

-- branch_stock: fold overlapping (keeper+loser share a branch) quantities by SUM.
CREATE TABLE IF NOT EXISTS product_merge_fold_0174 (
  keeper_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  rfid_confirmed_qty REAL NOT NULL,
  PRIMARY KEY (keeper_id, branch_id)
);
DELETE FROM product_merge_fold_0174;
INSERT INTO product_merge_fold_0174 (keeper_id, branch_id, quantity, rfid_confirmed_qty)
SELECT m.keeper_id, bs.branch_id, SUM(bs.quantity), SUM(COALESCE(bs.rfid_confirmed_qty, 0))
FROM branch_stock bs
JOIN product_merge_active_0174 m ON m.loser_id = bs.product_id
GROUP BY m.keeper_id, bs.branch_id;
UPDATE branch_stock SET
  quantity = quantity + (SELECT f.quantity FROM product_merge_fold_0174 f WHERE f.keeper_id = branch_stock.product_id AND f.branch_id = branch_stock.branch_id),
  rfid_confirmed_qty = rfid_confirmed_qty + (SELECT f.rfid_confirmed_qty FROM product_merge_fold_0174 f WHERE f.keeper_id = branch_stock.product_id AND f.branch_id = branch_stock.branch_id)
WHERE EXISTS (SELECT 1 FROM product_merge_fold_0174 f WHERE f.keeper_id = branch_stock.product_id AND f.branch_id = branch_stock.branch_id);
DELETE FROM branch_stock
WHERE product_id IN (SELECT loser_id FROM product_merge_active_0174)
  AND EXISTS (
    SELECT 1 FROM branch_stock bk
    JOIN product_merge_active_0174 m ON m.keeper_id = bk.product_id
    WHERE m.loser_id = branch_stock.product_id AND bk.branch_id = branch_stock.branch_id
  );
UPDATE branch_stock SET
  product_id = (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = branch_stock.product_id)
WHERE product_id IN (SELECT loser_id FROM product_merge_active_0174);

-- product_batches: repoint, disambiguating a batch_key collision with an
-- existing keeper batch (UNIQUE(variant_product_id, batch_key)). No lot of
-- these losers carries transfer provenance (audited), so 0151's
-- transfer_batch_identity_update trigger simply does not fire.
UPDATE product_batches SET
  batch_key = CASE WHEN EXISTS (
      SELECT 1 FROM product_batches pb2
      JOIN product_merge_active_0174 m ON m.loser_id = product_batches.variant_product_id
      WHERE pb2.variant_product_id = m.keeper_id AND pb2.batch_key = product_batches.batch_key
    ) THEN product_batches.batch_key || '-merged-' || product_batches.variant_product_id || '-' || product_batches.id
    ELSE product_batches.batch_key END,
  variant_product_id = (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = product_batches.variant_product_id),
  updated_at = CURRENT_TIMESTAMP
WHERE variant_product_id IN (SELECT loser_id FROM product_merge_active_0174);

-- Keeper cost from its active lots (catalog formula), now that the loser's
-- lots belong to it; a keeper with no costed active lot keeps the fallback.
UPDATE products SET
  cost_price_usd = COALESCE((SELECT CASE
      WHEN COUNT(*) = 0 THEN NULL
      WHEN MAX(cost) > 2 * MIN(cost) THEN MAX(cost)
      ELSE ROUND(SUM(cost) * 1.0 / COUNT(*), 4)
    END FROM (SELECT DISTINCT unit_cost_usd AS cost FROM product_batches
      WHERE variant_product_id = products.id AND is_active = 1
        AND unit_cost_usd IS NOT NULL AND unit_cost_usd <> 0)), cost_price_usd),
  purchase_price_usd = COALESCE((SELECT CASE
      WHEN COUNT(*) = 0 THEN NULL
      WHEN MAX(cost) > 2 * MIN(cost) THEN MAX(cost)
      ELSE ROUND(SUM(cost) * 1.0 / COUNT(*), 4)
    END FROM (SELECT DISTINCT unit_cost_usd AS cost FROM product_batches
      WHERE variant_product_id = products.id AND is_active = 1
        AND unit_cost_usd IS NOT NULL AND unit_cost_usd <> 0)), purchase_price_usd)
WHERE id IN (SELECT DISTINCT keeper_id FROM product_merge_active_0174);

-- Simple 1:1 product_id/link repoints, driven by the map (same list as 0165/0168).
UPDATE inventory_movements SET product_id = (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = inventory_movements.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_active_0174);
UPDATE sale_items SET product_id = (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = sale_items.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_active_0174);
UPDATE return_items SET product_id = (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = return_items.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_active_0174);
UPDATE return_replacement_items SET product_id = (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = return_replacement_items.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_active_0174);
UPDATE damaged_stock_lots SET product_id = (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = damaged_stock_lots.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_active_0174);
UPDATE stock_transfers SET product_id = (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = stock_transfers.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_active_0174);
UPDATE rfid_tags SET product_id = (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = rfid_tags.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_active_0174);
UPDATE rfid_events SET product_id = (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = rfid_events.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_active_0174);
UPDATE rfid_session_items SET product_id = (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = rfid_session_items.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_active_0174);
-- sale_amendments: DELIBERATELY NOT repointed (append-only trigger; see 0165 header).
UPDATE import_auto_merges SET product_id = (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = import_auto_merges.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_active_0174);
UPDATE legacy_deleted_sale_items SET product_id = (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = legacy_deleted_sale_items.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_active_0174);
UPDATE legacy_inventory_effects SET product_id = (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = legacy_inventory_effects.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_active_0174);
UPDATE legacy_sale_item_corrections SET product_id = (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = legacy_sale_item_corrections.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_active_0174);
UPDATE promotions SET link_product_id = (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = promotions.link_product_id) WHERE link_product_id IN (SELECT loser_id FROM product_merge_active_0174);
UPDATE products SET parent_id = (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = products.parent_id), updated_at = CURRENT_TIMESTAMP WHERE parent_id IN (SELECT loser_id FROM product_merge_active_0174);
UPDATE stock_row_moves SET source_product_id = (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = stock_row_moves.source_product_id) WHERE source_product_id IN (SELECT loser_id FROM product_merge_active_0174);
UPDATE stock_row_moves SET destination_product_id = (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = stock_row_moves.destination_product_id) WHERE destination_product_id IN (SELECT loser_id FROM product_merge_active_0174);

-- product_images: dedupe against the keeper's existing gallery by image_path, then repoint.
DELETE FROM product_images
WHERE product_id IN (SELECT loser_id FROM product_merge_active_0174)
  AND EXISTS (
    SELECT 1 FROM product_images pk
    JOIN product_merge_active_0174 m ON m.keeper_id = pk.product_id
    WHERE m.loser_id = product_images.product_id AND pk.image_path = product_images.image_path
  );
UPDATE product_images SET product_id = (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = product_images.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_active_0174);

-- promotion_rules.product_ids: rewrite the JSON array, replacing any loser id with its keeper id.
UPDATE promotion_rules SET
  product_ids = (
    SELECT json_group_array(COALESCE(
      (SELECT keeper_id FROM product_merge_active_0174 WHERE loser_id = CAST(je.value AS INTEGER)),
      CAST(je.value AS INTEGER)
    ))
    FROM json_each(promotion_rules.product_ids) je
  ),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM json_each(promotion_rules.product_ids) je2
  WHERE CAST(je2.value AS INTEGER) IN (SELECT loser_id FROM product_merge_active_0174)
);

-- Recompute keeper stock_quantity from the truth (branch_stock), now folded.
UPDATE products SET
  stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = products.id),
  updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT DISTINCT keeper_id FROM product_merge_active_0174);

-- One audit_logs row per merged loser, carrying its full pre-image (recovery).
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0174_product_leading_zero_twins_merge', 'product_leading_zero_twin_merge', 'product', CAST(m.keeper_id AS TEXT),
  'products', CAST(m.loser_id AS TEXT), m.loser_json,
  json_object('keeper_id', m.keeper_id, 'name_key', m.name_key, 'source', 'repair-0174')
FROM product_merge_active_0174 m
WHERE NOT EXISTS (
  SELECT 1 FROM audit_logs a WHERE a.user_name = 'migration:0174_product_leading_zero_twins_merge' AND a.record_id = CAST(m.loser_id AS TEXT)
);

-- Finally, remove the merged loser (single-row scale; every trigger fires normally).
DELETE FROM products WHERE id IN (SELECT loser_id FROM product_merge_active_0174);

CREATE TABLE IF NOT EXISTS product_merge_guard_0174 (
  check_name TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);
DELETE FROM product_merge_guard_0174;
INSERT INTO product_merge_guard_0174 (check_name, ok)
SELECT 'no_loser_products_remain', CASE WHEN NOT EXISTS (
  SELECT 1 FROM products WHERE id IN (SELECT loser_id FROM product_merge_active_0174)
) THEN 1 ELSE 0 END;
INSERT INTO product_merge_guard_0174 (check_name, ok)
SELECT 'no_loser_lots_or_stock_remain', CASE WHEN NOT EXISTS (
  SELECT 1 FROM product_batches WHERE variant_product_id IN (SELECT loser_id FROM product_merge_active_0174)
  UNION ALL
  SELECT 1 FROM branch_stock WHERE product_id IN (SELECT loser_id FROM product_merge_active_0174)
  UNION ALL
  SELECT 1 FROM sale_items WHERE product_id IN (SELECT loser_id FROM product_merge_active_0174)
) THEN 1 ELSE 0 END;
INSERT INTO product_merge_guard_0174 (check_name, ok)
SELECT 'keeper_ledgers_agree', CASE WHEN NOT EXISTS (
  SELECT 1 FROM products p
  WHERE p.id IN (SELECT keeper_id FROM product_merge_active_0174)
    AND ABS(p.stock_quantity - (SELECT COALESCE(SUM(bs.quantity), 0) FROM branch_stock bs WHERE bs.product_id = p.id)) > 0.0001
) THEN 1 ELSE 0 END;

DROP TABLE IF EXISTS product_merge_guard_0174;
DROP TABLE IF EXISTS product_merge_fold_0174;
DROP TABLE IF EXISTS product_merge_active_0174;
