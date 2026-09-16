-- 0109: FALLBACK backfill for the Sep 4 2026 identity-rule change
--
-- RENUMBERED 0099 -> 0109 by the coordinator (business-os-v1-c3), Sep 4.
-- 0099 was already taken by 0099_legacy_cashier_identity_backfill.sql, which is
-- APPLIED in production. D1 tracks applied migrations by FILENAME, so a second
-- 0099_*.sql would have been read as unapplied and run out of order, after 0107.
-- Production is applied through 0107 (0107_receipt_numbers_business_format.sql,
-- verified by SELECT against d1_migrations); 0108 is claimed by the S4-19 lane
-- (0108_recon_lot_code_to_adj_date.sql, also unrun).
-- ("only a different barcode forks a child row; a differing cost now
-- MERGES instead of splitting a row" -- see progress.md S4-17 / S4-17b
-- and cloudflare/src/lib/productDetailRule.ts's resolveMergedCost).
--
-- ============================================================================
-- DO NOT RUN THIS FILE. It is a reviewed-but-unexecuted reference, committed
-- by the S4-17b survey lane at the user's request ("write the SQL if you
-- can... but do not run it"). It has NOT been applied to any database, local
-- or remote, and is not a substitute for the recommended path below.
-- ============================================================================
--
-- THE RECOMMENDED PATH IS NOT THIS FILE. It is:
--   1. Merge `s4/identity-cost` (b1463d4b, f4474ea1, c730e5be) to main and
--      deploy. That branch already ships resolveMergedCost (averages the
--      DISTINCT costs per currency, excludes a cost of 0 as "not recorded",
--      rounds UP to 4dp) wired into the existing, tested, undo-capable
--      POST /api/products/merge-duplicates fold (foldDuplicateProductInto).
--   2. Run that endpoint against production (a user-gated production write).
--      It folds branch_stock PER BRANCH (never sums two branches into one
--      row), reassigns/folds product_batches by batch_key, reparents
--      sale_items.product_id and inventory_movements.product_id so a
--      merged product keeps its full sales/stock history, moves images,
--      writes an audit_logs + undo_snapshots entry per merge, and is
--      reversible as one action.
-- That machinery already exists because this exact rule was already
-- implemented once for "same name + same barcode + same cost" duplicates
-- (0076_product_auto_merges.sql / findDuplicateProductGroups) -- rewriting
-- it a second time in raw SQL is precisely the "one rule, three
-- implementations, all three disagreed" failure productDetailRule.ts's own
-- top-of-file comment warns about (import matched on one set of fields,
-- productIdentity.ts compared columns nothing ever wrote, the frontend
-- compared everything minus an ignore list). A hand-written SQL migration
-- would be a FOURTH implementation, untested against mergedCostRule.test.ts,
-- with no undo.
--
-- WHAT THIS FILE COVERS, AND WHAT IT DELIBERATELY DOES NOT
-- ----------------------------------------------------------------------------
-- Scope: cost reconciliation + branch_stock fold + sale_items/
-- inventory_movements reparenting + soft-deactivation, for active,
-- non-group products sharing (name, barcode) whose costs differ.
--
-- Deliberately OUT OF SCOPE, on purpose, because getting them wrong is worse
-- than leaving them for the app-route merge:
--   * product_batches / branch_batch_stock / sale_item_batch_allocations /
--     return_item_batch_allocations. EVERY ONE of the 705 rows this survey
--     found has at least one batch (2,045 batch rows total) -- batch_key
--     carries a UNIQUE(variant_product_id, batch_key) constraint, and the
--     app's fold has real branching logic for a batch_key collision (fold
--     branch_batch_stock into the existing same-key lot) vs no collision
--     (repoint + assign a fresh batch_number). This file does NOT repoint
--     batches. Running it alone would leave a merged product's FIFO lot
--     history split across its own id and the id it absorbed -- silently
--     wrong stock-aging, not silently wrong data, but still wrong. Batches
--     must be reconciled by the app route, or by a follow-up migration
--     written after that collision behaviour is verified against a fresh
--     production snapshot (this survey did not attempt it).
--   * product_images / image_path carry-over.
--   * stock_transfers.product_id / stock_row_moves.*_product_id (2 rows in
--     stock_transfers reference the affected products; the app route does
--     not reparent these either today -- a pre-existing gap, not new here).
--   * groups where the merge is not pure arithmetic -- see the WHERE guard
--     below, which intentionally skips them.
--
-- GUARDED OUT BY THIS FILE'S OWN WHERE CLAUSE (see the eligible_group CTE):
--   * any group where a member's cost_price_usd AND cost_price_khr are both
--     0 -- 258 of the 352 groups this survey found (73%). A 0/0 row is
--     "cost not recorded" under resolveMergedCost's own rule and must be
--     EXCLUDED from the average, not treated as a genuine $0 item -- this
--     file does not average across currencies, so it is safer to skip the
--     group entirely than to risk a subtly different exclusion rule.
--   * any group where more than one member holds branch_stock > 0. All 74
--     such groups in this survey turned out to span exactly 2 branches
--     (one member's stock at branch A, the other's at branch B) -- summing
--     them into a single branch_stock row would misattribute which shop
--     the stock is physically in. The app route's per-branch
--     ON CONFLICT(product_id, branch_id) DO UPDATE fold is what handles
--     this correctly; this file does not attempt it.
-- What is left after both guards: the 21 groups (43 rows) this survey
-- calls "safe arithmetic" -- clean, non-zero costs on every member, and
-- stock (if any) sitting on at most one member.
--
-- Idempotent: re-running finds no eligible groups the second time, because
-- every duplicate is already is_active = 0 and the canonical's cost no
-- longer disagrees with itself.
--
-- Exact command to apply (LOCAL D1 ONLY -- verify with --local first; the
-- user has not approved a remote/production run of this file):
--   cd cloudflare && node scripts/with-wrangler-auth.cjs wrangler d1 migrations apply business-os --local
-- Remote/production apply (DO NOT RUN without explicit user approval):
--   cd cloudflare && node scripts/with-wrangler-auth.cjs wrangler d1 migrations apply business-os --remote

-- ----------------------------------------------------------------------------
-- Step 0: scratch table of eligible groups + their resolved (canonical,
-- merged-cost) outcome. Mirrors the house style of 0079/0080's `_...`
-- scratch tables -- dropped at the end of this file.
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS _cost_merge_0099_groups;
CREATE TABLE _cost_merge_0099_groups AS
WITH base AS (
  SELECT
    id, name, cost_price_usd, cost_price_khr,
    lower(trim(name)) AS name_key,
    lower(trim(barcode)) AS barcode_key
  FROM products
  WHERE is_active = 1
    AND COALESCE(is_group, 0) = 0
    AND trim(COALESCE(barcode, '')) != ''
),
stock_per_row AS (
  SELECT b.id, b.name_key, b.barcode_key,
         COALESCE((SELECT SUM(quantity) FROM branch_stock WHERE product_id = b.id), 0) AS qty
  FROM base b
),
grp AS (
  SELECT name_key, barcode_key,
    COUNT(*) AS n_rows,
    COUNT(DISTINCT cost_price_usd || '|' || cost_price_khr) AS distinct_costs,
    SUM(CASE WHEN COALESCE(cost_price_usd,0) = 0 AND COALESCE(cost_price_khr,0) = 0 THEN 1 ELSE 0 END) AS zero_cost_rows,
    MIN(id) AS canonical_id
  FROM base
  GROUP BY name_key, barcode_key
  HAVING distinct_costs > 1
),
grp_stock AS (
  SELECT g.name_key, g.barcode_key,
    SUM(CASE WHEN s.qty > 0 THEN 1 ELSE 0 END) AS members_with_stock
  FROM grp g
  JOIN stock_per_row s ON s.name_key = g.name_key AND s.barcode_key = g.barcode_key
  GROUP BY g.name_key, g.barcode_key
),
eligible_group AS (
  -- The two guards described above: no zero/not-recorded cost member, and
  -- stock on at most one member.
  SELECT g.name_key, g.barcode_key, g.canonical_id
  FROM grp g
  JOIN grp_stock gs ON gs.name_key = g.name_key AND gs.barcode_key = g.barcode_key
  WHERE g.zero_cost_rows = 0 AND gs.members_with_stock <= 1
)
SELECT
  eg.name_key, eg.barcode_key, eg.canonical_id,
  -- resolveMergedCost: average of the DISTINCT costs per currency, each
  -- rounded up to 4dp first, then the average itself rounded up to 4dp.
  -- A currency with no member stating a value (every row is exactly 0)
  -- cannot occur here -- the zero_cost_rows guard already excluded it --
  -- so COALESCE is defensive only, not expected to fire.
  (SELECT CEIL(AVG(DISTINCT CEIL(b.cost_price_usd * 10000 - 1e-9) / 10000.0) * 10000 - 1e-9) / 10000.0
     FROM base b WHERE b.name_key = eg.name_key AND b.barcode_key = eg.barcode_key AND b.cost_price_usd > 0) AS merged_cost_usd,
  (SELECT CEIL(AVG(DISTINCT CEIL(b.cost_price_khr * 10000 - 1e-9) / 10000.0) * 10000 - 1e-9) / 10000.0
     FROM base b WHERE b.name_key = eg.name_key AND b.barcode_key = eg.barcode_key AND b.cost_price_khr > 0) AS merged_cost_khr
FROM eligible_group eg;

-- ----------------------------------------------------------------------------
-- Step 1: reparent transactional history from every non-canonical member
-- onto its group's canonical (lowest id) BEFORE deactivating it, same order
-- foldDuplicateProductInto uses -- so no history is ever briefly orphaned.
-- ----------------------------------------------------------------------------
UPDATE sale_items
SET product_id = (
  SELECT g.canonical_id FROM _cost_merge_0099_groups g
  JOIN products p ON p.id = sale_items.product_id
  WHERE g.name_key = lower(trim(p.name)) AND g.barcode_key = lower(trim(p.barcode))
)
WHERE product_id IN (
  SELECT p.id FROM products p
  JOIN _cost_merge_0099_groups g ON g.name_key = lower(trim(p.name)) AND g.barcode_key = lower(trim(p.barcode))
  WHERE p.id != g.canonical_id
);

UPDATE inventory_movements
SET product_id = (
  SELECT g.canonical_id FROM _cost_merge_0099_groups g
  JOIN products p ON p.id = inventory_movements.product_id
  WHERE g.name_key = lower(trim(p.name)) AND g.barcode_key = lower(trim(p.barcode))
)
WHERE product_id IN (
  SELECT p.id FROM products p
  JOIN _cost_merge_0099_groups g ON g.name_key = lower(trim(p.name)) AND g.barcode_key = lower(trim(p.barcode))
  WHERE p.id != g.canonical_id
);

-- ----------------------------------------------------------------------------
-- Step 2: fold the one non-canonical member's branch_stock (at most one row
-- can be non-zero across the group, by this file's own guard) into the
-- canonical, per branch -- never summed across branches.
-- ----------------------------------------------------------------------------
INSERT INTO branch_stock (product_id, branch_id, quantity)
SELECT g.canonical_id, bs.branch_id, bs.quantity
FROM branch_stock bs
JOIN products p ON p.id = bs.product_id
JOIN _cost_merge_0099_groups g ON g.name_key = lower(trim(p.name)) AND g.barcode_key = lower(trim(p.barcode))
WHERE p.id != g.canonical_id AND bs.quantity != 0
ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity;

DELETE FROM branch_stock
WHERE product_id IN (
  SELECT p.id FROM products p
  JOIN _cost_merge_0099_groups g ON g.name_key = lower(trim(p.name)) AND g.barcode_key = lower(trim(p.barcode))
  WHERE p.id != g.canonical_id
);

-- ----------------------------------------------------------------------------
-- Step 3: write the reconciled cost onto the canonical row, and recompute
-- its denormalized stock_quantity cache (same pattern the app route uses
-- after a branch_stock change).
-- ----------------------------------------------------------------------------
UPDATE products
SET cost_price_usd = COALESCE((SELECT merged_cost_usd FROM _cost_merge_0099_groups g WHERE g.canonical_id = products.id), cost_price_usd),
    cost_price_khr = COALESCE((SELECT merged_cost_khr FROM _cost_merge_0099_groups g WHERE g.canonical_id = products.id), cost_price_khr),
    stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = products.id),
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT canonical_id FROM _cost_merge_0099_groups);

-- ----------------------------------------------------------------------------
-- Step 4: soft-deactivate the merged-away rows -- never a hard DELETE, so
-- any historical reference this file did not reparent (product_batches,
-- stock_transfers, etc. -- see the header) still resolves to a real row.
-- ----------------------------------------------------------------------------
UPDATE products
SET is_active = 0, updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT p.id FROM products p
  JOIN _cost_merge_0099_groups g ON g.name_key = lower(trim(p.name)) AND g.barcode_key = lower(trim(p.barcode))
  WHERE p.id != g.canonical_id
);

-- ----------------------------------------------------------------------------
-- Step 5: audit trail -- one row per merge, cheap and durable, mirroring
-- the app route's per-duplicate audit() call (action 'merge_duplicate').
-- ----------------------------------------------------------------------------
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, created_at)
SELECT NULL, 'migration:0099_barcode_only_cost_merge_fallback', 'merge_duplicate', 'product', p.id,
       json_object('mergedIntoProductId', g.canonical_id, 'note', 'barcode-only identity backfill, cost-only fallback migration'),
       CURRENT_TIMESTAMP
FROM products p
JOIN _cost_merge_0099_groups g ON g.canonical_id = g.canonical_id -- placeholder join kept explicit for readability
WHERE 0 = 1; -- intentionally inert: see note below

-- NOTE on Step 5: left as a documented no-op (WHERE 0 = 1) rather than a
-- real INSERT, because by the time Steps 1-4 run, the non-canonical rows'
-- names/barcodes used to locate them are unchanged (this file never edits
-- name/barcode), so the join in Steps 1-4's own subqueries is what actually
-- targets them -- but audit_logs.entity_id needs the deactivated id captured
-- BEFORE Step 4 runs, not re-derived after. If this file is ever actually
-- used, move a real version of this INSERT to before Step 4 instead of
-- leaving it here inert. Left inert deliberately: a wrong audit row is a
-- smaller mistake than wrong production data, but still a mistake, and this
-- file is not meant to run as-is (see header).

DROP TABLE IF EXISTS _cost_merge_0099_groups;
