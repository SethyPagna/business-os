-- 0169: repair the denormalized product_name snapshots migrations 0165 and
-- 0168 left stale on every row they repointed.
--
-- PREPARED, NOT APPLIED. Data-only; no DDL. Append-only chain (0168 is the
-- prior migration; numbering coordinated 2026-09-15 -- the efficiency lane
-- decided not to write 0170, and this lane's uncosted-removal review found
-- nothing resolvable, so no 0169/0170 migration exists for either besides
-- this file; this file does not touch routes/compat.ts or routes/sales.ts
-- GROUP BY code, which the efficiency lane owns).
--
-- WHY THIS EXISTS: 0165/0168 repointed product_id on sale_items, inventory_
-- movements, return_items, stock_transfers, damaged_stock_lots, return_
-- replacement_items and stock_row_moves (source_/destination_product_id) to
-- the keeper -- but the sibling product_NAME column on those same rows was
-- never touched, so a merged loser's OLD name keeps showing on every
-- historical receipt/movement/transfer line even though product_id now
-- correctly points at the keeper. syncLinkedProductNameSnapshots (routes/
-- products.ts:98-114) already keeps this column in sync for the RENAME
-- path -- this migration is the one-time backfill for the two merges that
-- ran before that sync existed on the merge path (see migration 0172-and-
-- later note below, which is a code change, not a migration).
--
-- sale_amendments is DELIBERATELY NOT touched: it is an append-only
-- snapshot table (migration 0115's sale_amendments_append_only_update
-- trigger refuses any UPDATE), same rationale as 0165's header.
--
-- ============================== RULE ======================================
-- For every (loser_id, keeper_id) pair in product_merge_map_0165 UNION
-- product_merge_map_0168: on every repointed row (product_id = keeper_id,
-- or for stock_row_moves source_product_id/destination_product_id =
-- keeper_id) whose product_name column STILL reads the loser's captured
-- name (json_extract(loser_json,'$.name')) -- i.e. it was never
-- independently corrected by anything else since -- set it to the keeper's
-- CURRENT products.name. A row whose product_name has already drifted to
-- some OTHER value (renamed again since, or already fixed) is left alone;
-- this migration only repairs the specific stale case it can prove.
--
-- ============================== IDEMPOTENCE ===============================
-- Every UPDATE's WHERE clause requires product_name = the loser's OLD
-- captured name; after the first run product_name reads the keeper's
-- current name (almost certainly different from the loser's old name), so
-- a second run's WHERE clause matches nothing. (In the pathological case
-- where the keeper's name IS byte-identical to the loser's old name, the
-- UPDATE is a true no-op value-wise and remains idempotent by definition.)
--
-- ============================== RECOVERY ==================================
-- This migration does not delete or repoint anything, only corrects a
-- display-only denormalized name column; the previous (stale) value is
-- recoverable by re-deriving it from product_merge_map_0165/_0168.
-- loser_json.'$.name' for the affected rows if ever needed, so no separate
-- audit_logs row is written (the merge migrations' own audit rows already
-- carry the loser's full pre-image, including this exact name).
--
-- ============================== PRE-ASSERTION (run before applying) ======
--   SELECT COUNT(*) FROM sale_items si JOIN product_merge_map_0165 m ON m.keeper_id=si.product_id
--     WHERE si.product_name = json_extract(m.loser_json,'$.name');
--   -- (repeat per table/map to see the stale-row count this migration will fix)
--
-- ============================== POST-ASSERTION ============================
--   SELECT COUNT(*) FROM sale_items si JOIN product_merge_map_0165 m ON m.keeper_id=si.product_id
--     WHERE si.product_name = json_extract(m.loser_json,'$.name')
--       AND si.product_name <> (SELECT name FROM products WHERE id=m.keeper_id);
--   -- expect 0 for every table below (a row can only still match if the
--   -- keeper's OWN current name happens to equal the loser's old name)
--   -- second run touches 0 rows:
--   -- (re-run the file; changes should report 0 across every statement)

UPDATE sale_items SET product_name = (SELECT p.name FROM products p WHERE p.id = sale_items.product_id)
WHERE EXISTS (
  SELECT 1 FROM product_merge_map_0165 m WHERE m.keeper_id = sale_items.product_id
    AND sale_items.product_name = json_extract(m.loser_json, '$.name')
  UNION
  SELECT 1 FROM product_merge_map_0168 m WHERE m.keeper_id = sale_items.product_id
    AND sale_items.product_name = json_extract(m.loser_json, '$.name')
);

UPDATE inventory_movements SET product_name = (SELECT p.name FROM products p WHERE p.id = inventory_movements.product_id)
WHERE EXISTS (
  SELECT 1 FROM product_merge_map_0165 m WHERE m.keeper_id = inventory_movements.product_id
    AND inventory_movements.product_name = json_extract(m.loser_json, '$.name')
  UNION
  SELECT 1 FROM product_merge_map_0168 m WHERE m.keeper_id = inventory_movements.product_id
    AND inventory_movements.product_name = json_extract(m.loser_json, '$.name')
);

UPDATE return_items SET product_name = (SELECT p.name FROM products p WHERE p.id = return_items.product_id)
WHERE EXISTS (
  SELECT 1 FROM product_merge_map_0165 m WHERE m.keeper_id = return_items.product_id
    AND return_items.product_name = json_extract(m.loser_json, '$.name')
  UNION
  SELECT 1 FROM product_merge_map_0168 m WHERE m.keeper_id = return_items.product_id
    AND return_items.product_name = json_extract(m.loser_json, '$.name')
);

UPDATE stock_transfers SET product_name = (SELECT p.name FROM products p WHERE p.id = stock_transfers.product_id)
WHERE EXISTS (
  SELECT 1 FROM product_merge_map_0165 m WHERE m.keeper_id = stock_transfers.product_id
    AND stock_transfers.product_name = json_extract(m.loser_json, '$.name')
  UNION
  SELECT 1 FROM product_merge_map_0168 m WHERE m.keeper_id = stock_transfers.product_id
    AND stock_transfers.product_name = json_extract(m.loser_json, '$.name')
);

UPDATE damaged_stock_lots SET product_name = (SELECT p.name FROM products p WHERE p.id = damaged_stock_lots.product_id)
WHERE EXISTS (
  SELECT 1 FROM product_merge_map_0165 m WHERE m.keeper_id = damaged_stock_lots.product_id
    AND damaged_stock_lots.product_name = json_extract(m.loser_json, '$.name')
  UNION
  SELECT 1 FROM product_merge_map_0168 m WHERE m.keeper_id = damaged_stock_lots.product_id
    AND damaged_stock_lots.product_name = json_extract(m.loser_json, '$.name')
);

UPDATE return_replacement_items SET product_name = (SELECT p.name FROM products p WHERE p.id = return_replacement_items.product_id)
WHERE EXISTS (
  SELECT 1 FROM product_merge_map_0165 m WHERE m.keeper_id = return_replacement_items.product_id
    AND return_replacement_items.product_name = json_extract(m.loser_json, '$.name')
  UNION
  SELECT 1 FROM product_merge_map_0168 m WHERE m.keeper_id = return_replacement_items.product_id
    AND return_replacement_items.product_name = json_extract(m.loser_json, '$.name')
);

UPDATE stock_row_moves SET source_product_name = (SELECT p.name FROM products p WHERE p.id = stock_row_moves.source_product_id)
WHERE EXISTS (
  SELECT 1 FROM product_merge_map_0165 m WHERE m.keeper_id = stock_row_moves.source_product_id
    AND stock_row_moves.source_product_name = json_extract(m.loser_json, '$.name')
  UNION
  SELECT 1 FROM product_merge_map_0168 m WHERE m.keeper_id = stock_row_moves.source_product_id
    AND stock_row_moves.source_product_name = json_extract(m.loser_json, '$.name')
);

UPDATE stock_row_moves SET destination_product_name = (SELECT p.name FROM products p WHERE p.id = stock_row_moves.destination_product_id)
WHERE EXISTS (
  SELECT 1 FROM product_merge_map_0165 m WHERE m.keeper_id = stock_row_moves.destination_product_id
    AND stock_row_moves.destination_product_name = json_extract(m.loser_json, '$.name')
  UNION
  SELECT 1 FROM product_merge_map_0168 m WHERE m.keeper_id = stock_row_moves.destination_product_id
    AND stock_row_moves.destination_product_name = json_extract(m.loser_json, '$.name')
);
-- sale_amendments: DELIBERATELY NOT touched (append-only trigger; see header).
