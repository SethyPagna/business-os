-- 0168: transfer-aware same-name merge for the pair 0165 was forced to leave
-- unmerged because it carries transfer replay provenance.
--
-- PREPARED, NOT APPLIED. Append-only chain (0167 is the prior migration;
-- 0165-0167 are applied in production). DDL inside this file is limited to
-- the persistent map/pairs tables and their indexes, plus two guard triggers
-- that are dropped and recreated byte-identically around the two statements
-- migration 0151's replay-provenance trigger family would otherwise block
-- (see "TRANSFER-AWARE REPOINT" below); a scratch table used once and
-- dropped at the end.
--
-- ============================= WHY THIS EXISTS ===========================
-- 0165's header ("Transfer-provenance exclusion") deliberately excluded any
-- product referenced by transfer_operation_members.source_product_id/
-- destination_product_id, or owning a product_batches lot referenced by an
-- allocations_json entry, because migration 0151's trigger family makes
-- such a row's id/parentage immutable so a committed transfer can be
-- exactly replayed. Owner ruling (2026-09-15, verbatim): "transfer aware
-- merge" -- do it, for the one pair production evidence shows this left
-- behind: "dior addict lip glow new 075", ids 1616 (barcode
-- 03348901737289) and 7161 (barcode 3348901737289). These two ids ARE
-- exactly the source/destination of transfer_operation_members receipt 7,
-- ordinal 0 (branch 1 -> branch 2, quantity 3, 2026-09-13): a transfer
-- receiving branch had no local row for this product, so the transfer
-- pipeline minted a second product identity (7161) to receive it, rather
-- than moving stock onto the existing row (1616). That receipt's
-- allocations_json also references product_batches lot 61190 (on 1616,
-- source_batch_id) and lot 61204 (on 7161, destination_batch_id).
--
-- Unlike 0165's blanket exclusion, this migration performs the merge AND
-- rewrites the transfer provenance itself so the committed receipt still
-- describes a coherent transfer -- after this migration it describes a
-- same-product, cross-branch movement (source_product_id =
-- destination_product_id = the keeper), which is what actually happened to
-- the merchandise. This is safe specifically BECAUSE both sides of the
-- transfer are being folded into ONE product identity: the replay
-- invariant 0151 protects (committed history can be exactly replayed
-- against live product/lot ROWS) is preserved, since the rows keep
-- existing under the keeper's id, only their old secondary id is retired,
-- and the header snapshots captured at transfer time (source_snapshot/
-- destination_snapshot/cost_snapshot) are historical JSON, never re-read
-- structurally by id.
--
-- Pair source: TABLE-DRIVEN via product_merge_pairs_0168, not a hand-typed
-- DELETE/UPDATE list, so the same file can carry more pairs later (add a
-- row here in a NEW migration -- this file's own row is frozen once
-- applied) without repeating the trigger-drop machinery. Today it carries
-- exactly the one pair the owner named. A pair is only actually merged if,
-- at apply time, BOTH ids still exist, are active, share a name, and the
-- loser is not already merged (guards make a second run and a stale row a
-- no-op rather than an error).
--
-- ============================= KEEPER RULE ==============================
-- Same real-code-group rule as 0165 step 2: within a same-real-barcode-
-- modulo-leading-zeros group, the row already spelled WITHOUT leading
-- zeros is the keeper. 1616's barcode is '03348901737289' (leading zero);
-- 7161's is '3348901737289' (clean spelling) -> keeper = 7161, loser =
-- 1616. (Not decided by live stock here since both rows share one real
-- code -- the leading-zero-spelling rule applies before any stock
-- tie-break, exactly as 0165 step 2 does.)
--
-- ============================== KEEPER FIELDS ============================
-- Identical formulas to 0165: cost = AVG of DISTINCT non-zero cost across
-- keeper+loser; barcode = keeper's own real barcode, zero-stripped;
-- selling/wholesale price = keeper's value unless 0, else MAX across the
-- pair; brand/category/supplier/image_path/description = keeper's value
-- unless blank, else the loser's; stock_quantity recomputed from
-- branch_stock after the fold; auto_merged_count incremented.
--
-- ============================= REPOINTED TABLES ==========================
-- Same table list as 0165 (branch_stock folded by SUM-on-overlap,
-- product_batches repointed with batch_key collision suffixing,
-- product_images deduped by path, promotion_rules.product_ids rewritten,
-- the MERGE_REPARENT_TABLES set + legacy_*/import_auto_merges, products.
-- parent_id, stock_row_moves). sale_amendments is DELIBERATELY NOT
-- repointed, same rationale as 0165 (append-only trigger).
--
-- ========================= TRANSFER-AWARE REPOINT =========================
-- transfer_operation_members.source_product_id/destination_product_id are,
-- for THIS migration only, rewritten from loser to keeper (both become the
-- keeper id for receipt 7/ordinal 0, correctly describing a same-product
-- cross-branch move). This UPDATE is blocked unconditionally by 0151's
-- transfer_members_immutable_update trigger (no WHEN clause at all), so
-- that trigger is dropped immediately before this one statement and
-- recreated byte-identically immediately after, with a one-shot guard
-- (product_merge_guard_0168) asserting afterwards that it exists again and
-- that no member row still references a loser id.
--
-- product_batches.variant_product_id repoint (loser's lots -> keeper,
-- collision-suffixed batch_key exactly like 0165) is blocked for any lot
-- referenced by an allocations_json entry (lot 61190 here) by 0151's
-- transfer_batch_identity_update trigger, which checks allocations_json
-- membership directly and is unaffected by the members-table rewrite above
-- (it matches on batch id, not product id). That trigger is dropped
-- immediately before the product_batches UPDATE and recreated byte-
-- identically immediately after, guarded the same way.
--
-- transfer_product_delete/transfer_product_identity_update are NOT touched:
-- both check `EXISTS(... transfer_operation_members WHERE source_product_id
-- =OLD.id OR destination_product_id=OLD.id)` at the moment products is
-- written, and by the time this file reaches the final DELETE FROM
-- products, the transfer_operation_members repoint above has already moved
-- every reference off the loser id onto the keeper -- so the EXISTS check
-- is naturally false and the ordinary DELETE proceeds without needing to
-- touch those two triggers at all. Statement ORDER inside this file is
-- load-bearing: the members repoint MUST run before the final products
-- DELETE.
--
-- migration 0155's positive_lot_reject_parent_update_orphan_0155 trigger is
-- LEFT IN PLACE (not dropped): it only aborts if a positive branch_batch_
-- stock row's batch id goes missing from product_batches, and this
-- migration never removes a batch row, only repoints variant_product_id --
-- for a single-pair scale (well under a hundred lots) its per-row EXISTS
-- check costs nothing close to 0165's bulk-scale CPU budget problem, so
-- unlike 0165 there is no reason to drop it here.
--
-- ============================== IDEMPOTENCE ==============================
-- The map INSERT is guarded by `NOT EXISTS (... WHERE loser_id = ...)` and
-- only pulls rows still present as BOTH sides of a pairs row with a live
-- products join -- after the first run the loser id no longer exists, so
-- the join finds nothing and every downstream statement (scoped by `IN
-- (SELECT loser_id FROM product_merge_map_0168)`) is a no-op on a second
-- run, exactly like 0165.
--
-- ============================== RECOVERY ==================================
-- Every merged loser's full pre-image lives in product_merge_map_0168.
-- loser_json (also duplicated into audit_logs.old_value, user_name =
-- 'migration:0168_transfer_aware_merge', record_id = the loser id). Product-
-- row recovery uses the exact same INSERT template as 0165's RECOVERY
-- section (substitute product_merge_map_0168 for product_merge_map_0165).
-- Recovering the row does NOT restore transfer_operation_members.source_
-- product_id back to the loser -- that rewrite is the migration's whole
-- point (the receipt now correctly describes a same-product move) and is
-- not reversed by re-inserting the product row; a manual UPDATE against
-- transfer_operation_members would itself need the same trigger-drop
-- treatment as above, at the coordinator's discretion, not automatically
-- here.
--
-- ============================== PRE-ASSERTION (run before applying) ======
--   SELECT id, name, barcode, is_active, stock_quantity FROM products WHERE id IN (1616,7161);
--   SELECT COUNT(*) FROM audit_logs WHERE user_name='migration:0168_transfer_aware_merge'; -- expect 0
--   SELECT COUNT(*) FROM product_merge_map_0168; -- expect 0 or "table does not exist" pre-first-run
--
-- ============================== POST-ASSERTION ===========================
--   SELECT COUNT(*) FROM product_merge_map_0168; -- 1 (one row: loser 1616)
--   SELECT COUNT(*) FROM products WHERE id = 1616; -- 0
--   SELECT id, barcode, stock_quantity FROM products WHERE id = 7161; -- barcode '3348901737289', stock summed
--   SELECT COUNT(*) FROM transfer_operation_members WHERE source_product_id=1616 OR destination_product_id=1616; -- 0
--   SELECT source_product_id, destination_product_id FROM transfer_operation_members WHERE receipt_id=7 AND ordinal=0; -- 7161, 7161
--   SELECT variant_product_id FROM product_batches WHERE id=61190; -- 7161
--   SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('transfer_members_immutable_update','transfer_batch_identity_update'); -- 2
--   -- second run is a no-op:
--   SELECT COUNT(*) FROM product_merge_map_0168; -- unchanged after re-applying this file

CREATE TABLE IF NOT EXISTS product_merge_pairs_0168 (
  loser_id INTEGER PRIMARY KEY,
  keeper_id INTEGER NOT NULL,
  note TEXT
);
-- Seeded conditionally (both ids must exist as real products right now) so
-- this table never carries a dangling keeper_id/loser_id on a database where
-- the pair does not exist (e.g. a synthetic test fixture) -- the orphan
-- sweep (scripts/test-record-orphans-native.cjs) checks every *_id column,
-- and a bare literal INSERT would fail that check anywhere but production.
INSERT INTO product_merge_pairs_0168 (loser_id, keeper_id, note)
SELECT 1616, 7161, 'dior addict lip glow new 075: leading-zero twin of a transfer-provenance destination row (receipt 7, ordinal 0)'
WHERE NOT EXISTS (SELECT 1 FROM product_merge_pairs_0168 WHERE loser_id = 1616)
  AND EXISTS (SELECT 1 FROM products WHERE id = 1616)
  AND EXISTS (SELECT 1 FROM products WHERE id = 7161);

CREATE TABLE IF NOT EXISTS product_merge_map_0168 (
  loser_id INTEGER PRIMARY KEY,
  keeper_id INTEGER NOT NULL,
  name_key TEXT NOT NULL,
  loser_json TEXT NOT NULL,
  applied_at TEXT DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO product_merge_map_0168 (loser_id, keeper_id, name_key, loser_json)
SELECT
  pr.id, pk.id, LOWER(TRIM(pr.name)),
  json_object(
      'id', pr.id, 'name', pr.name, 'sku', pr.sku, 'barcode', pr.barcode, 'category', pr.category,
      'unit', pr.unit, 'description', pr.description,
      'selling_price_usd', pr.selling_price_usd, 'selling_price_khr', pr.selling_price_khr,
      'wholesale_price_usd', pr.wholesale_price_usd, 'wholesale_price_khr', pr.wholesale_price_khr,
      'cost_price_usd', pr.cost_price_usd, 'cost_price_khr', pr.cost_price_khr,
      'stock_quantity', pr.stock_quantity, 'image_path', pr.image_path, 'supplier', pr.supplier,
      'brand', pr.brand, 'parent_id', pr.parent_id, 'is_active', pr.is_active, 'created_at', pr.created_at,
      'special_price_usd', pr.special_price_usd, 'special_price_khr', pr.special_price_khr)
FROM product_merge_pairs_0168 mp
JOIN products pr ON pr.id = mp.loser_id
JOIN products pk ON pk.id = mp.keeper_id
WHERE pr.is_active = 1 AND pk.is_active = 1
  AND LOWER(TRIM(pr.name)) = LOWER(TRIM(pk.name))
  AND NOT EXISTS (SELECT 1 FROM product_merge_map_0168 m WHERE m.loser_id = mp.loser_id);
CREATE INDEX IF NOT EXISTS idx_product_merge_map_0168_keeper ON product_merge_map_0168 (keeper_id);

-- Keeper cost: AVG of DISTINCT non-zero cost across keeper + loser.
UPDATE products SET
  cost_price_usd = COALESCE((
    SELECT AVG(v) FROM (
      SELECT DISTINCT val AS v FROM (
        SELECT products.cost_price_usd AS val
        UNION ALL
        SELECT CAST(json_extract(m.loser_json, '$.cost_price_usd') AS REAL)
        FROM product_merge_map_0168 m WHERE m.keeper_id = products.id
      ) WHERE v IS NOT NULL AND v <> 0
    )
  ), products.cost_price_usd),
  cost_price_khr = COALESCE((
    SELECT AVG(v) FROM (
      SELECT DISTINCT val AS v FROM (
        SELECT products.cost_price_khr AS val
        UNION ALL
        SELECT CAST(json_extract(m.loser_json, '$.cost_price_khr') AS REAL)
        FROM product_merge_map_0168 m WHERE m.keeper_id = products.id
      ) WHERE v IS NOT NULL AND v <> 0
    )
  ), products.cost_price_khr)
WHERE id IN (SELECT DISTINCT keeper_id FROM product_merge_map_0168);

-- Keeper barcode: canonical zero-stripped spelling if the keeper's OWN
-- barcode is real, else ''.
UPDATE products SET
  barcode = CASE
    WHEN LENGTH(TRIM(COALESCE(barcode, ''))) >= 6
      AND TRIM(barcode) NOT GLOB '*[^0-9]*'
      AND CAST(TRIM(barcode) AS INTEGER) <> 0
    THEN LTRIM(TRIM(barcode), '0')
    ELSE ''
  END,
  auto_merged_count = COALESCE(auto_merged_count, 0) + (
    SELECT COUNT(*) FROM product_merge_map_0168 m WHERE m.keeper_id = products.id
  ),
  updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT DISTINCT keeper_id FROM product_merge_map_0168);

-- Keeper selling/wholesale price: keeper's value unless 0, else MAX across pair.
UPDATE products SET
  selling_price_usd = CASE WHEN selling_price_usd <> 0 THEN selling_price_usd ELSE COALESCE((
    SELECT MAX(v) FROM (SELECT products.selling_price_usd AS v UNION ALL
      SELECT CAST(json_extract(m.loser_json, '$.selling_price_usd') AS REAL) FROM product_merge_map_0168 m WHERE m.keeper_id = products.id)
  ), selling_price_usd) END,
  selling_price_khr = CASE WHEN selling_price_khr <> 0 THEN selling_price_khr ELSE COALESCE((
    SELECT MAX(v) FROM (SELECT products.selling_price_khr AS v UNION ALL
      SELECT CAST(json_extract(m.loser_json, '$.selling_price_khr') AS REAL) FROM product_merge_map_0168 m WHERE m.keeper_id = products.id)
  ), selling_price_khr) END,
  wholesale_price_usd = CASE WHEN wholesale_price_usd <> 0 THEN wholesale_price_usd ELSE COALESCE((
    SELECT MAX(v) FROM (SELECT products.wholesale_price_usd AS v UNION ALL
      SELECT CAST(json_extract(m.loser_json, '$.wholesale_price_usd') AS REAL) FROM product_merge_map_0168 m WHERE m.keeper_id = products.id)
  ), wholesale_price_usd) END,
  wholesale_price_khr = CASE WHEN wholesale_price_khr <> 0 THEN wholesale_price_khr ELSE COALESCE((
    SELECT MAX(v) FROM (SELECT products.wholesale_price_khr AS v UNION ALL
      SELECT CAST(json_extract(m.loser_json, '$.wholesale_price_khr') AS REAL) FROM product_merge_map_0168 m WHERE m.keeper_id = products.id)
  ), wholesale_price_khr) END
WHERE id IN (SELECT DISTINCT keeper_id FROM product_merge_map_0168);

-- Keeper brand/category/supplier/image_path/description: keeper's value
-- unless blank, else the loser's.
UPDATE products SET
  brand = CASE WHEN COALESCE(NULLIF(TRIM(brand), ''), '') <> '' THEN brand ELSE (
    SELECT json_extract(m.loser_json, '$.brand') FROM product_merge_map_0168 m
    WHERE m.keeper_id = products.id AND COALESCE(NULLIF(TRIM(json_extract(m.loser_json, '$.brand')), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END,
  category = CASE WHEN COALESCE(NULLIF(TRIM(category), ''), '') <> '' THEN category ELSE (
    SELECT json_extract(m.loser_json, '$.category') FROM product_merge_map_0168 m
    WHERE m.keeper_id = products.id AND COALESCE(NULLIF(TRIM(json_extract(m.loser_json, '$.category')), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END,
  supplier = CASE WHEN COALESCE(NULLIF(TRIM(supplier), ''), '') <> '' THEN supplier ELSE (
    SELECT json_extract(m.loser_json, '$.supplier') FROM product_merge_map_0168 m
    WHERE m.keeper_id = products.id AND COALESCE(NULLIF(TRIM(json_extract(m.loser_json, '$.supplier')), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END,
  image_path = CASE WHEN COALESCE(NULLIF(TRIM(image_path), ''), '') <> '' THEN image_path ELSE (
    SELECT json_extract(m.loser_json, '$.image_path') FROM product_merge_map_0168 m
    WHERE m.keeper_id = products.id AND COALESCE(NULLIF(TRIM(json_extract(m.loser_json, '$.image_path')), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END,
  description = CASE WHEN COALESCE(NULLIF(TRIM(description), ''), '') <> '' THEN description ELSE (
    SELECT json_extract(m.loser_json, '$.description') FROM product_merge_map_0168 m
    WHERE m.keeper_id = products.id AND COALESCE(NULLIF(TRIM(json_extract(m.loser_json, '$.description')), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END
WHERE id IN (SELECT DISTINCT keeper_id FROM product_merge_map_0168);

-- branch_stock: fold overlapping (keeper+loser share a branch) quantities by SUM.
CREATE TABLE IF NOT EXISTS product_merge_fold_0168 (
  keeper_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  rfid_confirmed_qty REAL NOT NULL,
  PRIMARY KEY (keeper_id, branch_id)
);
DELETE FROM product_merge_fold_0168;
INSERT INTO product_merge_fold_0168 (keeper_id, branch_id, quantity, rfid_confirmed_qty)
SELECT m.keeper_id, bs.branch_id, SUM(bs.quantity), SUM(COALESCE(bs.rfid_confirmed_qty, 0))
FROM branch_stock bs
JOIN product_merge_map_0168 m ON m.loser_id = bs.product_id
GROUP BY m.keeper_id, bs.branch_id;
UPDATE branch_stock SET
  quantity = quantity + (SELECT f.quantity FROM product_merge_fold_0168 f WHERE f.keeper_id = branch_stock.product_id AND f.branch_id = branch_stock.branch_id),
  rfid_confirmed_qty = rfid_confirmed_qty + (SELECT f.rfid_confirmed_qty FROM product_merge_fold_0168 f WHERE f.keeper_id = branch_stock.product_id AND f.branch_id = branch_stock.branch_id)
WHERE EXISTS (SELECT 1 FROM product_merge_fold_0168 f WHERE f.keeper_id = branch_stock.product_id AND f.branch_id = branch_stock.branch_id);

DELETE FROM branch_stock
WHERE product_id IN (SELECT loser_id FROM product_merge_map_0168)
  AND EXISTS (
    SELECT 1 FROM branch_stock bk
    JOIN product_merge_map_0168 m ON m.keeper_id = bk.product_id
    WHERE m.loser_id = branch_stock.product_id AND bk.branch_id = branch_stock.branch_id
  );

UPDATE branch_stock SET
  product_id = (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = branch_stock.product_id)
WHERE product_id IN (SELECT loser_id FROM product_merge_map_0168);

-- product_batches: repoint, disambiguating a batch_key collision with an
-- existing keeper batch (UNIQUE(variant_product_id,batch_key)). 0151's
-- transfer_batch_identity_update trigger (checks allocations_json
-- membership by batch id, unconditional otherwise) would refuse the
-- rewrite for any loser lot referenced there (lot 61190 here) -- dropped
-- for this one statement, recreated byte-identically immediately after.
DROP TRIGGER IF EXISTS transfer_batch_identity_update;
UPDATE product_batches SET
  batch_key = CASE WHEN EXISTS (
      SELECT 1 FROM product_batches pb2
      JOIN product_merge_map_0168 m ON m.loser_id = product_batches.variant_product_id
      WHERE pb2.variant_product_id = m.keeper_id AND pb2.batch_key = product_batches.batch_key
    ) THEN product_batches.batch_key || '-merged-' || product_batches.variant_product_id || '-' || product_batches.id
    ELSE product_batches.batch_key END,
  variant_product_id = (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = product_batches.variant_product_id),
  updated_at = CURRENT_TIMESTAMP
WHERE variant_product_id IN (SELECT loser_id FROM product_merge_map_0168);
CREATE TRIGGER transfer_batch_identity_update BEFORE UPDATE OF id,variant_product_id ON product_batches
WHEN (NEW.id IS NOT OLD.id OR NEW.variant_product_id IS NOT OLD.variant_product_id)
 AND EXISTS(SELECT 1 FROM transfer_operation_members m,json_each(m.allocations_json) a
   WHERE json_extract(a.value,'$.source_batch_id')=OLD.id OR json_extract(a.value,'$.destination_batch_id')=OLD.id)
BEGIN SELECT RAISE(ABORT,'lot has immutable transfer provenance'); END;

CREATE TABLE IF NOT EXISTS product_merge_guard_0168 (
  check_name TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);
DELETE FROM product_merge_guard_0168;
INSERT INTO product_merge_guard_0168 (check_name, ok)
SELECT 'transfer_batch_identity_update_restored', CASE WHEN (
  SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'transfer_batch_identity_update'
) = 1 THEN 1 ELSE 0 END;

-- transfer_operation_members: rewrite provenance so the committed receipt
-- still describes a coherent transfer (source and destination now both the
-- keeper). Blocked unconditionally by transfer_members_immutable_update --
-- dropped for this one statement, recreated byte-identically after. MUST
-- run before the final DELETE FROM products below (see header).
DROP TRIGGER IF EXISTS transfer_members_immutable_update;
UPDATE transfer_operation_members SET
  source_product_id = COALESCE((SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = transfer_operation_members.source_product_id), source_product_id)
WHERE source_product_id IN (SELECT loser_id FROM product_merge_map_0168);
UPDATE transfer_operation_members SET
  destination_product_id = COALESCE((SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = transfer_operation_members.destination_product_id), destination_product_id)
WHERE destination_product_id IN (SELECT loser_id FROM product_merge_map_0168);
CREATE TRIGGER transfer_members_immutable_update BEFORE UPDATE ON transfer_operation_members
BEGIN SELECT RAISE(ABORT,'transfer provenance is immutable'); END;

INSERT INTO product_merge_guard_0168 (check_name, ok)
SELECT 'transfer_members_immutable_update_restored', CASE WHEN (
  SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'transfer_members_immutable_update'
) = 1 THEN 1 ELSE 0 END;
INSERT INTO product_merge_guard_0168 (check_name, ok)
SELECT 'no_transfer_member_still_refs_loser', CASE WHEN NOT EXISTS (
  SELECT 1 FROM transfer_operation_members
  WHERE source_product_id IN (SELECT loser_id FROM product_merge_map_0168)
     OR destination_product_id IN (SELECT loser_id FROM product_merge_map_0168)
) THEN 1 ELSE 0 END;

-- Simple 1:1 product_id/link repoints, driven by the map (same list as 0165).
UPDATE inventory_movements SET product_id = (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = inventory_movements.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0168);
UPDATE sale_items SET product_id = (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = sale_items.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0168);
UPDATE return_items SET product_id = (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = return_items.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0168);
UPDATE return_replacement_items SET product_id = (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = return_replacement_items.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0168);
UPDATE damaged_stock_lots SET product_id = (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = damaged_stock_lots.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0168);
UPDATE stock_transfers SET product_id = (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = stock_transfers.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0168);
UPDATE rfid_tags SET product_id = (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = rfid_tags.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0168);
UPDATE rfid_events SET product_id = (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = rfid_events.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0168);
UPDATE rfid_session_items SET product_id = (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = rfid_session_items.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0168);
-- sale_amendments: DELIBERATELY NOT repointed (append-only trigger; see 0165 header).
UPDATE import_auto_merges SET product_id = (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = import_auto_merges.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0168);
UPDATE legacy_deleted_sale_items SET product_id = (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = legacy_deleted_sale_items.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0168);
UPDATE legacy_inventory_effects SET product_id = (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = legacy_inventory_effects.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0168);
UPDATE legacy_sale_item_corrections SET product_id = (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = legacy_sale_item_corrections.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0168);
UPDATE promotions SET link_product_id = (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = promotions.link_product_id) WHERE link_product_id IN (SELECT loser_id FROM product_merge_map_0168);
UPDATE products SET parent_id = (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = products.parent_id), updated_at = CURRENT_TIMESTAMP WHERE parent_id IN (SELECT loser_id FROM product_merge_map_0168);
UPDATE stock_row_moves SET source_product_id = (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = stock_row_moves.source_product_id) WHERE source_product_id IN (SELECT loser_id FROM product_merge_map_0168);
UPDATE stock_row_moves SET destination_product_id = (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = stock_row_moves.destination_product_id) WHERE destination_product_id IN (SELECT loser_id FROM product_merge_map_0168);

-- product_images: dedupe against the keeper's existing gallery by image_path, then repoint.
DELETE FROM product_images
WHERE product_id IN (SELECT loser_id FROM product_merge_map_0168)
  AND EXISTS (
    SELECT 1 FROM product_images pk
    JOIN product_merge_map_0168 m ON m.keeper_id = pk.product_id
    WHERE m.loser_id = product_images.product_id AND pk.image_path = product_images.image_path
  );
UPDATE product_images SET product_id = (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = product_images.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0168);

-- promotion_rules.product_ids: rewrite the JSON array, replacing any loser id with its keeper id.
UPDATE promotion_rules SET
  product_ids = (
    SELECT json_group_array(COALESCE(
      (SELECT keeper_id FROM product_merge_map_0168 WHERE loser_id = CAST(je.value AS INTEGER)),
      CAST(je.value AS INTEGER)
    ))
    FROM json_each(promotion_rules.product_ids) je
  ),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM json_each(promotion_rules.product_ids) je2
  WHERE CAST(je2.value AS INTEGER) IN (SELECT loser_id FROM product_merge_map_0168)
);

-- Recompute keeper stock_quantity from the truth (branch_stock), now folded.
UPDATE products SET
  stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = products.id),
  updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT DISTINCT keeper_id FROM product_merge_map_0168);

-- One audit_logs row per merged loser, carrying its full pre-image (recovery).
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0168_transfer_aware_merge', 'product_transfer_aware_merge', 'product', CAST(m.keeper_id AS TEXT),
  'products', CAST(m.loser_id AS TEXT), m.loser_json,
  json_object('keeper_id', m.keeper_id, 'name_key', m.name_key)
FROM product_merge_map_0168 m
WHERE NOT EXISTS (
  SELECT 1 FROM audit_logs a WHERE a.user_name = 'migration:0168_transfer_aware_merge' AND a.record_id = CAST(m.loser_id AS TEXT)
);

-- Finally, remove the merged loser. transfer_product_delete no longer
-- refuses this -- the members repoint above already moved every reference
-- off this id. trg_products_ad_name_key/FTS5/revision triggers stay in
-- place and fire normally (single-row scale; no CPU budget concern).
DELETE FROM products WHERE id IN (SELECT loser_id FROM product_merge_map_0168);

INSERT INTO product_merge_guard_0168 (check_name, ok)
SELECT 'no_loser_products_remain', CASE WHEN NOT EXISTS (
  SELECT 1 FROM products WHERE id IN (SELECT loser_id FROM product_merge_map_0168)
) THEN 1 ELSE 0 END;

DROP TABLE IF EXISTS product_merge_guard_0168;
DROP TABLE IF EXISTS product_merge_fold_0168;
