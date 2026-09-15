-- 0165: merge every same-NAME product duplicate cluster in production under
-- the owner's Sep-15-2026 ruling (verbatim): "for same name 100% products:
-- same barcode (difference only leading barcode), or different barcode but
-- the barcode is empty or words or broken not actual barcode, use the one
-- with actual barcode.... or if both is empty merge into one empty. etc...
-- so current group/child rules only apply to completely different barcode
-- (correct barcodes) and the damage tag/label. price we do the add
-- different together and divide by number of different costs. (not
-- including empty/0 value cost which is wrong."
--
-- PREPARED, NOT APPLIED. Data-only; no DDL. Append-only chain (0164 is the
-- prior migration). TABLE-DRIVEN, not one statement per cluster -- 0164's
-- 127-statements-for-14-rows shape does not scale to the 1838 production
-- groups / 3700 rows this migration covers, so every cluster is computed
-- IN SQL from the live `products` table at apply time via
-- product_merge_map_0165, and every downstream table is repointed with one
-- UPDATE driven by that map, not one block per row.
--
-- Verified by scripts/verify-0165-0166-merges.cjs (rehearsed against a copy
-- of the production replica once scripts/harness builds one) and
-- scripts/test-migration-0165-0166-pure.cjs (a small synthetic fixture
-- covering every clause below, runnable without production data).
--
-- ============================= DEFINITIONS =============================
-- "Real barcode": TRIM(barcode) is non-empty, every character is a digit,
--   LENGTH >= 6, and the value is not all zeros. Anything else -- NULL,
--   empty, '0', a short/placeholder numeric string, or a barcode holding
--   letters/words -- is "no barcode" for THIS migration. (This is a
--   stricter, migration-specific definition than lib/productDetailRule.ts's
--   general identityBarcodeKey fold, which the owner's ruling here
--   supersedes for the one-time backfill: identityBarcodeKey treats a
--   3-digit stripped code as real, e.g. the MAC shade codes; this migration
--   only ever classifies >=6-digit codes as "actual barcode".)
-- "Same real code": two real barcodes whose value with leading zeros
--   stripped (LTRIM(barcode,'0')) is identical -- a leading-zero twin.
-- Eligible rows: is_active=1, COALESCE(is_group,0)=0, tag_label IS NULL, and
--   NOT transfer-evidenced (see below). Inactive rows are left alone (not
--   merged, not repointed). Tagged (damaged) child rows are NEVER merged and
--   never keepers -- the Sep-14-2026 broken/damaged child-row rule stays
--   untouched by this migration; only ordinary catalog rows cluster here.
--
-- Transfer-provenance exclusion: a product referenced as source_product_id/
--   destination_product_id in transfer_operation_members, or that owns a
--   product_batches row referenced as source_batch_id/destination_batch_id in
--   any transfer_operation_members.allocations_json, is excluded from
--   clustering entirely -- it can never be a loser OR a keeper-of-a-loser
--   that would require repointing it. Migration 0151's replay-provenance
--   trigger family (transfer_product_delete, transfer_product_identity_
--   update, transfer_batch_identity_update, transfer_batch_delete,
--   transfer_members_immutable_update) makes such a product/lot's id and
--   parentage immutable so committed transfer history can be exactly
--   replayed; forcing the merge through by dropping/recreating those
--   triggers would satisfy the schema but not the invariant they protect,
--   since replay also compares live product-row content against captured
--   JSON snapshots (lib/transferOperation.ts) which a cost/barcode/field
--   rewrite already breaks regardless of whether the id columns move. This
--   is exactly the refusal the live merge-duplicates route already applies
--   (routes/products.ts: `merge_state_conflict: Product has immutable
--   transfer provenance and cannot be merged.`) -- this migration mirrors
--   that business rule instead of overriding it. A transfer-evidenced
--   duplicate is left as a live, unmerged row; it will merge cleanly once
--   its transfer history ages out of relevance, at the coordinator's
--   discretion, not automatically here.
--
-- ============================= KEEPER RULE ==============================
-- Cluster = eligible rows sharing LOWER(TRIM(name)).
--   * No real barcode anywhere in the cluster: keeper = lowest id; every
--     other row in the cluster is a loser ("both empty... merge into one
--     empty").
--   * One or more real barcodes in the cluster: group the real-barcode rows
--     by their same-real-code key. EACH distinct real code gets its OWN
--     keeper (rows with two different real -- correct -- barcodes are NOT
--     merged into each other, exactly as the ruling says: "current
--     group/child rules only apply to completely different barcode"). The
--     keeper within one real-code group is the row already spelled without
--     leading zeros, else the lowest id; every other row sharing that real
--     code (a leading-zero twin) is a loser. No-barcode rows in a cluster
--     that DOES have a real code attach as losers to whichever real-code
--     keeper has the highest live stock_quantity, tie-broken by lowest id.
--
-- ============================== KEEPER FIELDS ===========================
-- cost_price_usd/khr = AVG of DISTINCT non-zero values across keeper +
--   losers (a 0/NULL cost is never a real cost and is excluded, per the
--   ruling), rounded to 6 places.
-- barcode = the keeper's own barcode, folded past leading zeros, when the
--   keeper itself carries a real barcode; otherwise ''. (Non-keeper spelling
--   is never written back onto a DIFFERENT identity, matching
--   canonicalProductBarcode's "comparison only" rule -- this is the one
--   place production intentionally rewrites the stored column, because the
--   duplicate rows themselves are being removed.)
-- selling_price_usd/khr, wholesale_price_usd/khr = keeper's value unless it
--   is 0, in which case MAX across keeper + losers.
-- brand/category/supplier/image_path/description = keeper's value unless
--   blank, in which case the first non-blank value among losers (by
--   ascending loser id).
-- stock_quantity = recomputed from branch_stock AFTER the branch_stock fold
--   below (never trusted as a carried column).
-- auto_merged_count += number of losers folded into this keeper.
--
-- ============================= REPOINTED TABLES =========================
-- branch_stock       -- SUM(quantity) and SUM(rfid_confirmed_qty) per branch
--                        where keeper and a loser both carry a row for that
--                        branch (UNIQUE(product_id,branch_id) forbids a
--                        blind repoint); loser-only branch rows are simply
--                        repointed.
-- product_batches    -- variant_product_id repointed; batch_key disambiguated
--                        with a '-merged-<oldProductId>-<batchId>' suffix on
--                        the rare collision with an existing keeper batch_key
--                        (UNIQUE(variant_product_id,batch_key)).
-- branch_batch_stock -- no action needed: keyed by batch_id, which does not
--                        change: it follows product_batches automatically.
-- sale_item_batch_allocations / return_item_batch_allocations -- same: keyed
--                        by batch_id, follow product_batches automatically.
-- inventory_movements, sale_items, return_items, return_replacement_items,
-- damaged_stock_lots, stock_transfers, rfid_tags, rfid_events,
-- rfid_session_items, import_auto_merges, legacy_deleted_sale_items,
-- legacy_inventory_effects, legacy_sale_item_corrections -- product_id
--                        repointed 1:1 (MERGE_REPARENT_TABLES in lib/
--                        undoAppliers.ts is the authoritative list the live
--                        merge route uses; the legacy_*/import_auto_merges
--                        additions here are the extra product_id-bearing
--                        tables that list does not need to cover because the
--                        live route never deletes a row, only this one-time
--                        backfill does).
-- promotions.link_product_id, products.parent_id, stock_row_moves.source_/
-- destination_product_id -- repointed 1:1.
-- sale_amendments -- DELIBERATELY NOT repointed: migration 0115's
--                        sale_amendments_append_only_update trigger
--                        unconditionally refuses any UPDATE (append-only
--                        audit trail: "correct an entry by appending a
--                        compensating entry, never by rewriting one"). A
--                        merged loser's id can still appear in old
--                        sale_amendments.product_id rows after this
--                        migration -- that is the correct outcome for an
--                        append-only ledger, same treatment as product_
--                        conflict_*/product_duplicate_dismissals below.
-- transfer_operation_members.source_/destination_product_id -- DELIBERATELY
--                        NOT repointed: unreachable by construction, since
--                        the transfer-provenance exclusion above guarantees
--                        no product referenced here is ever a loser. Also
--                        migration 0151's transfer_members_immutable_update
--                        trigger refuses any UPDATE on this table
--                        unconditionally, and (per the note above) repointing
--                        the id columns would not restore replay-ability
--                        anyway since replay compares live product-row
--                        content against a captured snapshot.
-- latest_data_cache_fix_runs, latest_data_reconciliation_runs -- NOT
--                        repointed (outside the migration chain, historical):
--                        keyed by run_id only, no product/customer entity id.
-- latest_data_reconciliation_removed_rows -- NOT repointed (outside the
--                        migration chain, historical): archived row_json by
--                        (run_id, table_name, record_id TEXT), a frozen
--                        archive, not a live reference.
-- latest_data_source_links -- NOT repointed (outside the migration chain,
--                        historical): target_table/target_id TEXT is an
--                        import-audit link never read by the app's runtime
--                        paths; also outside the migration chain, so a
--                        migration statement against it would fail on a
--                        fresh DB.
-- product_conflict_cleanup_backup_20260903 -- NOT repointed (outside the
--                        migration chain, historical): a frozen snapshot copy
--                        of products taken on 2026-09-03, not a live table.
-- product_images     -- deduplicated by image_path against the keeper's
--                        existing gallery, then repointed.
-- promotion_rules.product_ids (JSON array) -- rewritten in place with
--                        json_each/json_group_array, replacing any loser id
--                        with its keeper id.
-- product_conflict_action_group_members, product_conflict_merge_run_cases,
-- product_remove_operations, stock_session_members -- DELIBERATELY NOT
--                        repointed. These are ephemeral review/undo-history
--                        state guarded by state_digest/plan_digest
--                        fingerprints and, in several cases, UNIQUE(review_
--                        id, product_id) constraints; silently repointing
--                        them here would either violate those constraints or
--                        make a fingerprint recompute to something the
--                        in-flight review never produced. None of them can
--                        be open against a row this migration deletes and
--                        also correct after a blind UPDATE -- the app's own
--                        conflict-refresh path already recomputes a clean
--                        state when a member id goes missing. FOLLOW-UP for
--                        the coordinator: after applying, check
--                        `SELECT * FROM product_remove_operations WHERE
--                        product_id NOT IN (SELECT id FROM products) AND
--                        status NOT IN ('reversed')` and the equivalent for
--                        product_conflict_action_group_members/
--                        product_conflict_merge_run_cases; any hit needs a
--                        manual review-cancel, not a migration.
-- product_duplicate_dismissals -- NOT repointed: cluster_value is a name/
--                        barcode key, not a product id (confirm on the
--                        table before assuming otherwise if this migration
--                        is ever adapted).
--
-- ============================== IDEMPOTENCE =============================
-- The map INSERT recomputes clusters from LIVE products data every run and
-- guards on `NOT EXISTS (... WHERE loser_id = ...)`. After the first run the
-- loser rows are gone, so the clustering CTEs see only the keepers -- no new
-- map rows, so every downstream statement (all scoped by `WHERE ... IN
-- (SELECT loser_id FROM product_merge_map_0165)`) is a no-op on a second run.
--
-- ============================== RECOVERY =================================
-- Every merged loser's full pre-image lives in product_merge_map_0165.
-- loser_json (also duplicated into audit_logs.old_value, user_name =
-- 'migration:0165_product_same_name_merge', record_id = the loser id).
-- Reinserting the row restores the product itself (branch_stock/batches/
-- sale history are NOT reversed automatically -- same rationale as 0164:
-- consolidating a genuine duplicate is the intended, permanent effect):
--   INSERT INTO products (id, name, sku, barcode, category, unit, description,
--     selling_price_usd, selling_price_khr, wholesale_price_usd, wholesale_price_khr,
--     cost_price_usd, cost_price_khr, stock_quantity, image_path, supplier, brand,
--     parent_id, is_active, created_at, special_price_usd, special_price_khr)
--   SELECT CAST(m.loser_id AS INTEGER), json_extract(m.loser_json,'$.name'),
--     json_extract(m.loser_json,'$.sku'), json_extract(m.loser_json,'$.barcode'),
--     json_extract(m.loser_json,'$.category'), json_extract(m.loser_json,'$.unit'),
--     json_extract(m.loser_json,'$.description'), json_extract(m.loser_json,'$.selling_price_usd'),
--     json_extract(m.loser_json,'$.selling_price_khr'), json_extract(m.loser_json,'$.wholesale_price_usd'),
--     json_extract(m.loser_json,'$.wholesale_price_khr'), json_extract(m.loser_json,'$.cost_price_usd'),
--     json_extract(m.loser_json,'$.cost_price_khr'), 0, json_extract(m.loser_json,'$.image_path'),
--     json_extract(m.loser_json,'$.supplier'), json_extract(m.loser_json,'$.brand'),
--     json_extract(m.loser_json,'$.parent_id'), json_extract(m.loser_json,'$.is_active'),
--     json_extract(m.loser_json,'$.created_at'), json_extract(m.loser_json,'$.special_price_usd'),
--     json_extract(m.loser_json,'$.special_price_khr')
--   FROM product_merge_map_0165 m WHERE m.loser_id = <loser id>
--     AND NOT EXISTS (SELECT 1 FROM products WHERE id = CAST(m.loser_id AS INTEGER));
-- (stock_quantity restored 0 deliberately -- the loser's branch_stock rows
-- were folded into the keeper's quantities, not preserved separately, so a
-- restored row starts with no stock until someone re-counts it.)
--
-- ============================== PRE-ASSERTION (run before applying) ======
--   SELECT COUNT(*) FROM products WHERE is_active=1 AND COALESCE(is_group,0)=0 AND tag_label IS NULL;
--   SELECT COUNT(*) FROM audit_logs WHERE user_name='migration:0165_product_same_name_merge'; -- expect 0
--   SELECT COUNT(*) FROM product_merge_map_0165; -- expect 0 or "table does not exist" pre-first-run
--
-- ============================== POST-ASSERTION ===========================
--   SELECT COUNT(*) FROM product_merge_map_0165; -- one row per merged loser
--   SELECT COUNT(*) FROM products WHERE id IN (SELECT loser_id FROM product_merge_map_0165); -- 0
--   SELECT COUNT(*) FROM audit_logs WHERE user_name='migration:0165_product_same_name_merge'; -- = map row count
--   -- no repointed table still references a deleted loser id:
--   SELECT COUNT(*) FROM sale_items WHERE product_id IN (SELECT loser_id FROM product_merge_map_0165); -- 0
--   SELECT COUNT(*) FROM branch_stock WHERE product_id IN (SELECT loser_id FROM product_merge_map_0165); -- 0
--   -- second run is a no-op:
--   SELECT COUNT(*) FROM product_merge_map_0165; -- unchanged after re-applying this file

CREATE TABLE IF NOT EXISTS product_merge_map_0165 (
  loser_id INTEGER PRIMARY KEY,
  keeper_id INTEGER NOT NULL,
  name_key TEXT NOT NULL,
  loser_json TEXT NOT NULL,
  applied_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Populate the map from LIVE data: cluster, classify barcodes, pick keepers.
INSERT INTO product_merge_map_0165 (loser_id, keeper_id, name_key, loser_json)
WITH cluster_rows AS (
  SELECT
    id,
    LOWER(TRIM(name)) AS name_key,
    TRIM(COALESCE(barcode, '')) AS bc,
    -- Live stock, not the denormalized products.stock_quantity column (which
    -- can be stale) -- same precedent as lib/productIdentity.ts's
    -- findIdentityMatch, which sources live_stock_quantity from branch_stock
    -- to choose a merge survivor.
    (SELECT COALESCE(SUM(bs.quantity), 0) FROM branch_stock bs WHERE bs.product_id = products.id) AS live_stock,
    CASE
      WHEN LENGTH(TRIM(COALESCE(barcode, ''))) >= 6
        AND TRIM(barcode) NOT GLOB '*[^0-9]*'
        AND CAST(TRIM(barcode) AS INTEGER) <> 0
      THEN 1 ELSE 0
    END AS is_real
  FROM products
  WHERE is_active = 1 AND COALESCE(is_group, 0) = 0 AND tag_label IS NULL
    -- Transfer-provenance exclusion (see header): never cluster a product
    -- that migration 0151's triggers would refuse to reparent or delete.
    AND id NOT IN (
      SELECT source_product_id FROM transfer_operation_members
      UNION
      SELECT destination_product_id FROM transfer_operation_members
      UNION
      SELECT pb.variant_product_id FROM product_batches pb
      WHERE EXISTS (
        SELECT 1 FROM transfer_operation_members m, json_each(m.allocations_json) a
        WHERE json_extract(a.value, '$.source_batch_id') = pb.id
           OR json_extract(a.value, '$.destination_batch_id') = pb.id
      )
    )
),
real_rows AS (
  SELECT id, name_key, bc, live_stock, LTRIM(bc, '0') AS real_code_key
  FROM cluster_rows WHERE is_real = 1
),
real_keepers AS (
  SELECT id, name_key, real_code_key, live_stock,
    ROW_NUMBER() OVER (
      PARTITION BY name_key, real_code_key
      ORDER BY (CASE WHEN bc = real_code_key THEN 0 ELSE 1 END), id ASC
    ) AS rn
  FROM real_rows
),
cluster_best_keeper AS (
  SELECT name_key, id AS keeper_id,
    ROW_NUMBER() OVER (PARTITION BY name_key ORDER BY live_stock DESC, id ASC) AS brn
  FROM real_keepers WHERE rn = 1
),
empty_only_keepers AS (
  SELECT cr.name_key, MIN(cr.id) AS keeper_id
  FROM cluster_rows cr
  WHERE cr.is_real = 0
    AND NOT EXISTS (SELECT 1 FROM cluster_rows r2 WHERE r2.name_key = cr.name_key AND r2.is_real = 1)
  GROUP BY cr.name_key
),
assigned AS (
  SELECT
    cr.id AS row_id,
    cr.name_key,
    CASE
      WHEN cr.is_real = 1 THEN (
        SELECT rk.id FROM real_keepers rk
        WHERE rk.name_key = cr.name_key AND rk.real_code_key = LTRIM(cr.bc, '0') AND rk.rn = 1
      )
      WHEN EXISTS (SELECT 1 FROM cluster_rows r2 WHERE r2.name_key = cr.name_key AND r2.is_real = 1) THEN (
        SELECT bk.keeper_id FROM cluster_best_keeper bk WHERE bk.name_key = cr.name_key AND bk.brn = 1
      )
      ELSE (SELECT eok.keeper_id FROM empty_only_keepers eok WHERE eok.name_key = cr.name_key)
    END AS keeper_id
  FROM cluster_rows cr
)
SELECT
  a.row_id,
  a.keeper_id,
  a.name_key,
  (SELECT json_object(
      'id', p.id, 'name', p.name, 'sku', p.sku, 'barcode', p.barcode, 'category', p.category,
      'unit', p.unit, 'description', p.description,
      'selling_price_usd', p.selling_price_usd, 'selling_price_khr', p.selling_price_khr,
      'wholesale_price_usd', p.wholesale_price_usd, 'wholesale_price_khr', p.wholesale_price_khr,
      'cost_price_usd', p.cost_price_usd, 'cost_price_khr', p.cost_price_khr,
      'stock_quantity', p.stock_quantity, 'image_path', p.image_path, 'supplier', p.supplier,
      'brand', p.brand, 'parent_id', p.parent_id, 'is_active', p.is_active, 'created_at', p.created_at,
      'special_price_usd', p.special_price_usd, 'special_price_khr', p.special_price_khr)
   FROM products p WHERE p.id = a.row_id)
FROM assigned a
WHERE a.keeper_id IS NOT NULL
  AND a.row_id <> a.keeper_id
  AND NOT EXISTS (SELECT 1 FROM product_merge_map_0165 m WHERE m.loser_id = a.row_id);

-- Keeper cost: AVG of DISTINCT non-zero cost across keeper + its losers.
UPDATE products SET
  cost_price_usd = COALESCE((
    SELECT AVG(v) FROM (
      SELECT DISTINCT val AS v FROM (
        SELECT products.cost_price_usd AS val
        UNION ALL
        SELECT CAST(json_extract(m.loser_json, '$.cost_price_usd') AS REAL)
        FROM product_merge_map_0165 m WHERE m.keeper_id = products.id
      ) WHERE v IS NOT NULL AND v <> 0
    )
  ), products.cost_price_usd),
  cost_price_khr = COALESCE((
    SELECT AVG(v) FROM (
      SELECT DISTINCT val AS v FROM (
        SELECT products.cost_price_khr AS val
        UNION ALL
        SELECT CAST(json_extract(m.loser_json, '$.cost_price_khr') AS REAL)
        FROM product_merge_map_0165 m WHERE m.keeper_id = products.id
      ) WHERE v IS NOT NULL AND v <> 0
    )
  ), products.cost_price_khr)
WHERE id IN (SELECT DISTINCT keeper_id FROM product_merge_map_0165);

-- Keeper barcode: canonical zero-stripped spelling if the keeper's OWN
-- barcode is real, else '' (no real code exists anywhere in this keeper's
-- assigned sub-cluster by construction of the keeper rule above).
UPDATE products SET
  barcode = CASE
    WHEN LENGTH(TRIM(COALESCE(barcode, ''))) >= 6
      AND TRIM(barcode) NOT GLOB '*[^0-9]*'
      AND CAST(TRIM(barcode) AS INTEGER) <> 0
    THEN LTRIM(TRIM(barcode), '0')
    ELSE ''
  END,
  auto_merged_count = COALESCE(auto_merged_count, 0) + (
    SELECT COUNT(*) FROM product_merge_map_0165 m WHERE m.keeper_id = products.id
  ),
  updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT DISTINCT keeper_id FROM product_merge_map_0165);

-- Keeper selling/wholesale price: keeper's value unless 0, else MAX across cluster.
UPDATE products SET
  selling_price_usd = CASE WHEN selling_price_usd <> 0 THEN selling_price_usd ELSE COALESCE((
    SELECT MAX(v) FROM (SELECT products.selling_price_usd AS v UNION ALL
      SELECT CAST(json_extract(m.loser_json, '$.selling_price_usd') AS REAL) FROM product_merge_map_0165 m WHERE m.keeper_id = products.id)
  ), selling_price_usd) END,
  selling_price_khr = CASE WHEN selling_price_khr <> 0 THEN selling_price_khr ELSE COALESCE((
    SELECT MAX(v) FROM (SELECT products.selling_price_khr AS v UNION ALL
      SELECT CAST(json_extract(m.loser_json, '$.selling_price_khr') AS REAL) FROM product_merge_map_0165 m WHERE m.keeper_id = products.id)
  ), selling_price_khr) END,
  wholesale_price_usd = CASE WHEN wholesale_price_usd <> 0 THEN wholesale_price_usd ELSE COALESCE((
    SELECT MAX(v) FROM (SELECT products.wholesale_price_usd AS v UNION ALL
      SELECT CAST(json_extract(m.loser_json, '$.wholesale_price_usd') AS REAL) FROM product_merge_map_0165 m WHERE m.keeper_id = products.id)
  ), wholesale_price_usd) END,
  wholesale_price_khr = CASE WHEN wholesale_price_khr <> 0 THEN wholesale_price_khr ELSE COALESCE((
    SELECT MAX(v) FROM (SELECT products.wholesale_price_khr AS v UNION ALL
      SELECT CAST(json_extract(m.loser_json, '$.wholesale_price_khr') AS REAL) FROM product_merge_map_0165 m WHERE m.keeper_id = products.id)
  ), wholesale_price_khr) END
WHERE id IN (SELECT DISTINCT keeper_id FROM product_merge_map_0165);

-- Keeper brand/category/supplier/image_path/description: keeper's value
-- unless blank, else the first non-blank loser value (ascending loser id).
UPDATE products SET
  brand = CASE WHEN COALESCE(NULLIF(TRIM(brand), ''), '') <> '' THEN brand ELSE (
    SELECT json_extract(m.loser_json, '$.brand') FROM product_merge_map_0165 m
    WHERE m.keeper_id = products.id AND COALESCE(NULLIF(TRIM(json_extract(m.loser_json, '$.brand')), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END,
  category = CASE WHEN COALESCE(NULLIF(TRIM(category), ''), '') <> '' THEN category ELSE (
    SELECT json_extract(m.loser_json, '$.category') FROM product_merge_map_0165 m
    WHERE m.keeper_id = products.id AND COALESCE(NULLIF(TRIM(json_extract(m.loser_json, '$.category')), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END,
  supplier = CASE WHEN COALESCE(NULLIF(TRIM(supplier), ''), '') <> '' THEN supplier ELSE (
    SELECT json_extract(m.loser_json, '$.supplier') FROM product_merge_map_0165 m
    WHERE m.keeper_id = products.id AND COALESCE(NULLIF(TRIM(json_extract(m.loser_json, '$.supplier')), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END,
  image_path = CASE WHEN COALESCE(NULLIF(TRIM(image_path), ''), '') <> '' THEN image_path ELSE (
    SELECT json_extract(m.loser_json, '$.image_path') FROM product_merge_map_0165 m
    WHERE m.keeper_id = products.id AND COALESCE(NULLIF(TRIM(json_extract(m.loser_json, '$.image_path')), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END,
  description = CASE WHEN COALESCE(NULLIF(TRIM(description), ''), '') <> '' THEN description ELSE (
    SELECT json_extract(m.loser_json, '$.description') FROM product_merge_map_0165 m
    WHERE m.keeper_id = products.id AND COALESCE(NULLIF(TRIM(json_extract(m.loser_json, '$.description')), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END
WHERE id IN (SELECT DISTINCT keeper_id FROM product_merge_map_0165);

-- branch_stock: fold overlapping (keeper+loser share a branch) quantities by SUM.
UPDATE branch_stock SET
  quantity = quantity + (
    SELECT COALESCE(SUM(bs2.quantity), 0) FROM branch_stock bs2
    JOIN product_merge_map_0165 m ON m.loser_id = bs2.product_id
    WHERE m.keeper_id = branch_stock.product_id AND bs2.branch_id = branch_stock.branch_id
  ),
  rfid_confirmed_qty = rfid_confirmed_qty + (
    SELECT COALESCE(SUM(bs2.rfid_confirmed_qty), 0) FROM branch_stock bs2
    JOIN product_merge_map_0165 m ON m.loser_id = bs2.product_id
    WHERE m.keeper_id = branch_stock.product_id AND bs2.branch_id = branch_stock.branch_id
  )
WHERE product_id IN (SELECT DISTINCT keeper_id FROM product_merge_map_0165);

-- Delete loser branch rows already folded into a matching keeper branch row.
DELETE FROM branch_stock
WHERE product_id IN (SELECT loser_id FROM product_merge_map_0165)
  AND EXISTS (
    SELECT 1 FROM branch_stock bk
    JOIN product_merge_map_0165 m ON m.keeper_id = bk.product_id
    WHERE m.loser_id = branch_stock.product_id AND bk.branch_id = branch_stock.branch_id
  );

-- Repoint the remaining loser-only branch rows (no keeper row for that branch).
UPDATE branch_stock SET
  product_id = (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = branch_stock.product_id)
WHERE product_id IN (SELECT loser_id FROM product_merge_map_0165);

-- product_batches: repoint, disambiguating a batch_key collision with an
-- existing keeper batch (UNIQUE(variant_product_id,batch_key)).
UPDATE product_batches SET
  batch_key = CASE WHEN EXISTS (
      SELECT 1 FROM product_batches pb2
      JOIN product_merge_map_0165 m ON m.loser_id = product_batches.variant_product_id
      WHERE pb2.variant_product_id = m.keeper_id AND pb2.batch_key = product_batches.batch_key
    ) THEN product_batches.batch_key || '-merged-' || product_batches.variant_product_id || '-' || product_batches.id
    ELSE product_batches.batch_key END,
  variant_product_id = (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = product_batches.variant_product_id),
  updated_at = CURRENT_TIMESTAMP
WHERE variant_product_id IN (SELECT loser_id FROM product_merge_map_0165);

-- Simple 1:1 product_id/link repoints, driven by the map.
UPDATE inventory_movements SET product_id = (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = inventory_movements.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0165);
UPDATE sale_items SET product_id = (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = sale_items.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0165);
UPDATE return_items SET product_id = (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = return_items.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0165);
UPDATE return_replacement_items SET product_id = (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = return_replacement_items.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0165);
UPDATE damaged_stock_lots SET product_id = (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = damaged_stock_lots.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0165);
UPDATE stock_transfers SET product_id = (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = stock_transfers.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0165);
UPDATE rfid_tags SET product_id = (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = rfid_tags.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0165);
UPDATE rfid_events SET product_id = (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = rfid_events.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0165);
UPDATE rfid_session_items SET product_id = (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = rfid_session_items.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0165);
-- sale_amendments: DELIBERATELY NOT repointed (append-only trigger; see header).
UPDATE import_auto_merges SET product_id = (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = import_auto_merges.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0165);
UPDATE legacy_deleted_sale_items SET product_id = (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = legacy_deleted_sale_items.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0165);
UPDATE legacy_inventory_effects SET product_id = (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = legacy_inventory_effects.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0165);
UPDATE legacy_sale_item_corrections SET product_id = (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = legacy_sale_item_corrections.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0165);
UPDATE promotions SET link_product_id = (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = promotions.link_product_id) WHERE link_product_id IN (SELECT loser_id FROM product_merge_map_0165);
UPDATE products SET parent_id = (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = products.parent_id), updated_at = CURRENT_TIMESTAMP WHERE parent_id IN (SELECT loser_id FROM product_merge_map_0165);
UPDATE stock_row_moves SET source_product_id = (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = stock_row_moves.source_product_id) WHERE source_product_id IN (SELECT loser_id FROM product_merge_map_0165);
UPDATE stock_row_moves SET destination_product_id = (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = stock_row_moves.destination_product_id) WHERE destination_product_id IN (SELECT loser_id FROM product_merge_map_0165);
-- transfer_operation_members: DELIBERATELY NOT repointed (unreachable by
-- construction -- transfer-evidenced products are excluded from clustering
-- above -- and blocked unconditionally by migration 0151's
-- transfer_members_immutable_update trigger; see header).

-- product_images: dedupe against the keeper's existing gallery by image_path, then repoint.
DELETE FROM product_images
WHERE product_id IN (SELECT loser_id FROM product_merge_map_0165)
  AND EXISTS (
    SELECT 1 FROM product_images pk
    JOIN product_merge_map_0165 m ON m.keeper_id = pk.product_id
    WHERE m.loser_id = product_images.product_id AND pk.image_path = product_images.image_path
  );
UPDATE product_images SET product_id = (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = product_images.product_id) WHERE product_id IN (SELECT loser_id FROM product_merge_map_0165);

-- promotion_rules.product_ids: rewrite the JSON array, replacing any loser id with its keeper id.
UPDATE promotion_rules SET
  product_ids = (
    SELECT json_group_array(COALESCE(
      (SELECT keeper_id FROM product_merge_map_0165 WHERE loser_id = CAST(je.value AS INTEGER)),
      CAST(je.value AS INTEGER)
    ))
    FROM json_each(promotion_rules.product_ids) je
  ),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM json_each(promotion_rules.product_ids) je2
  WHERE CAST(je2.value AS INTEGER) IN (SELECT loser_id FROM product_merge_map_0165)
);

-- Recompute keeper stock_quantity from the truth (branch_stock), now folded.
UPDATE products SET
  stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = products.id),
  updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT DISTINCT keeper_id FROM product_merge_map_0165);

-- One audit_logs row per merged loser, carrying its full pre-image (recovery).
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0165_product_same_name_merge', 'product_same_name_merge', 'product', CAST(m.keeper_id AS TEXT),
  'products', CAST(m.loser_id AS TEXT), m.loser_json,
  json_object('keeper_id', m.keeper_id, 'name_key', m.name_key)
FROM product_merge_map_0165 m
WHERE NOT EXISTS (
  SELECT 1 FROM audit_logs a WHERE a.user_name = 'migration:0165_product_same_name_merge' AND a.record_id = CAST(m.loser_id AS TEXT)
);

-- Finally, remove the merged losers. products_fts/_fts_code/_fts_name_trigram
-- are external-content FTS5 tables synced by the products_fts_ad/products_
-- fts_code_ad/products_fts_name_trigram_ad AFTER DELETE triggers (migrations
-- 0018/0019/0021) -- this DELETE keeps them in sync without any extra
-- statement here.
DELETE FROM products WHERE id IN (SELECT loser_id FROM product_merge_map_0165);
