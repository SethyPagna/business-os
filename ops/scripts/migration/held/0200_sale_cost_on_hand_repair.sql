-- 0200: past sale lines and customer return lines whose recorded cost came
-- from the buggy catalog average get the cost the stock on hand actually had
-- when they were written.
--
-- ============================== HELD =====================================
-- This file is HELD in ops/scripts/migration/held/, deliberately OUTSIDE
-- cloudflare/migrations, so no deploy applies it (release.cjs stepMigrations
-- and deploy.yml run_migrations apply every waiting file in the chain).
-- Moving it into cloudflare/migrations -- keeping this file name, 0200 -- is
-- itself the "apply" decision. It needs 0195 (catalog_cost_on_hand) applied
-- first AND the post-0195 Worker serving for at least 2 hours (the deploy
-- window below), so the window's lines are settled before the plan reads them.
--
-- ============================== OWNER-RUN AUDIT ==========================
-- Read-only. Run AFTER 0195 is live and BEFORE deciding to apply this file,
-- from the cloudflare/ directory in Git Bash. Always --command, never --file
-- (wrangler d1 execute --file returns no rows). Statements 1-3 are cut from
-- ops/scripts/audit/sale-cost-on-hand-audit.sql, its comment lines dropped.
--
-- A. 0195 is live (one row named 0195_catalog_cost_on_hand.sql; fix_at not
--    NULL -- it is the moment the buggy average stopped writing catalog costs):
--   node scripts/with-wrangler-auth.cjs wrangler d1 execute business-os --remote --command "SELECT id, name, applied_at FROM d1_migrations WHERE name LIKE '0195%' OR name LIKE '0200%'" --json
--   node scripts/with-wrangler-auth.cjs wrangler d1 execute business-os --remote --command "SELECT MIN(created_at) AS fix_at, datetime(MIN(created_at), '+2 hours') AS era_end, COUNT(*) AS products FROM catalog_cost_repair_0195_backup" --json
--
-- B. Bucket summary (one row per bucket, every bucket always listed; counts
--    and sums only -- safe for logs):
--   node scripts/with-wrangler-auth.cjs wrangler d1 execute business-os --remote --command "$(sed -n '/^-- 1\. /,/;$/p' ../ops/scripts/audit/sale-cost-on-hand-audit.sql | grep -v '^--')" --json
--   Read: bucket 'repair' -> lines = R, the sale lines this file rewrites;
--         bucket 'window' -> lines = W, sale lines written by the old Worker
--         in the deploy window, also rewritten;
--         buckets 'returns_sale_linked' and 'returns_walk_in' -> the return
--         lines this file rewrites (RL, RW);
--         cost_delta_usd = D per bucket, SUM(qty x (correct - recorded)) in
--         USD (sale lines: positive = COGS goes up, profit goes down);
--         bucket 'ledger_unverified' -> lines = candidates NOT repaired
--         because a lot they were sold from does not reconcile;
--         bucket 'needs_owner_review' -> lines NOT repaired that are, or may
--         be, affected but cannot be proven (listed row by row in C);
--         bucket 'after_window' -> lines after the window still matching the
--         buggy average: must be 0 (a non-zero count means the old Worker
--         served longer than the window; stop and report);
--         'already_correct' is informational.
--
-- C. Every listed line (row-level: for the encrypted ops export only, never
--    a public log; its per-bucket counts equal B):
--   node scripts/with-wrangler-auth.cjs wrangler d1 execute business-os --remote --command "$(sed -n '/^-- 2\. /,/;$/p' ../ops/scripts/audit/sale-cost-on-hand-audit.sql | grep -v '^--')" --json
--   Read: kind, bucket, reason, receipt/return number, recorded_cost_usd ->
--         correct_cost_usd (the best estimate for the review buckets).
--
-- D. Report effect of the rewritten buckets:
--   node scripts/with-wrangler-auth.cjs wrangler d1 execute business-os --remote --command "$(sed -n '/^-- 3\. /,/;$/p' ../ops/scripts/audit/sale-cost-on-hand-audit.sql | grep -v '^--')" --json
--   Read: sold_cost_delta_usd = COGS change on recognized (not cancelled)
--         sales; returned_cost_delta_usd over restocked rewritten return
--         lines = the return cost COGS subtracts. Net report COGS change =
--         sold_cost_delta_usd - returned_cost_delta_usd; profit moves by
--         minus that.
-- Record R, W, RL, RW, every D, the review counts and D's net figure with the
-- owner's go; the POST ASSERTIONS below compare against them.
--
-- Owner decisions: 2026-09-26 "past sales whose recorded cost came from the
-- buggy average must be corrected"; 2026-09-27 "we did some sales, and
-- previous sales, make sure they are fixed with the correct cost price ...
-- nothing lost/corrupted, everything recoverable". This is a bug repair. It
-- writes ONLY sale_items.cost_price_usd and return_items.cost_price_usd.
-- Never price, revenue, quantity, status, receipts, KHR costs, movements,
-- stock, loyalty or snapshots.
--
-- ============================== WHAT REPORTS READ ========================
-- COGS / profit (lib/salesAnalytics.ts header, routes/reports.ts,
-- lib/productSalesLedger.ts):
--   cost_usd   = SUM(sale_items.cost_price_usd * sale_items.quantity) over
--                recognized sales, MINUS SUM(return_items.cost_price_usd *
--                return_items.quantity) for restocked customer-return lines
--   profit_usd = revenue_usd - cost_usd + delivery_net_usd
--
-- ============================== WRITERS ==================================
-- sale_items.cost_price_usd is a snapshot of products.cost_price_usd read
-- before the sale's write batch (routes/sales.ts, lib/saleLineAddition.ts,
-- lib/salesImportCommit.ts, lib/stockActionCommit.ts, routes/returns.ts
-- replacement lines): two lines of one product in one sale get the same
-- figure. A line added later to an older sale is timed by its own movement.
-- return_items.cost_price_usd (routes/returns.ts create/edit via
-- lib/returnCostAccess.ts recordedReturnCosts):
--   - sale_item_id set: the sale line's cost;
--   - sale-linked, sale_item_id NULL: the cost shared by EVERY line of that
--     product (and branch, when given) in the sale -- recordedReturnCosts
--     refuses when they differ; the repair mirrors that: all those lines
--     rewritten to one figure -> the return line follows, else it is listed
--     for review ('sale_lines_of_product_now_differ' /
--     'follows_unrepaired_sale_line');
--   - walk-in (no sale): the catalog cost at the return
--     (fillOmittedReturnCosts(..., 'catalog')), repaired like a sale line
--     at the return's own time and ledger position;
--   - a return edit copies the previous line's cost ('return' source), so an
--     edited line keeps the figure the create path wrote;
--   - supplier returns (return_scope 'supplier') carry a typed cost and are
--     outside COGS: not candidates.
-- KHR costs: cost_price_khr is copied from products.cost_price_khr, which the
-- buggy average never wrote (no lot records a KHR cost), so it is correct and
-- untouched, including on a KHR-currency sale or refund.
-- No undo or replay path writes these cost columns, so no recorded undo puts
-- the old figure back.
--
-- ============================== WHICH LINES ==============================
-- The buggy average (a5a2169f, committed 2026-09-16 14:04:42 UTC, until 0195
-- and the Worker that ships with it): the mean of the DISTINCT positive unit
-- costs of the product's active lots (after the latest manual override's
-- baseline, plus that override's cost), counting lots that had SOLD OUT.
-- Until 156c67d2 (2026-09-19 20:42 UTC) a dearest cost more than twice the
-- cheapest replaced the mean.
-- Era: era_start = 2026-09-16 14:04:42; fix_at = 0195's apply time
-- (catalog_cost_repair_0195_backup.created_at); era_end = fix_at + 2 hours,
-- covering an old Worker still serving after the migration applied.
-- A line is a candidate only when its recorded cost is positive and EQUALS
-- the buggy average recomputed as of its own time (either variant, either
-- rounding) over the lot state RECONSTRUCTED for that time:
--   - owner: a lot, a sale/return line or a manual cost entry re-pointed by a
--     product merge after the line (undo_snapshots 'product.merge',
--     'product.merge.bulk', 'product.merge.group.child', not 'reversed':
--     repointedBatches, reparentedSaleItemIds, reparentedByTable) is read on
--     the product it belonged to at the line;
--   - unit cost: the latest lot cost edit recorded at or before the line
--     (audit_logs 'batch_update' carrying unit_cost_usd); a lot edited only
--     after the line, or touched after it with a cost that no longer matches
--     its first receipt movement, is read at that receipt cost;
--   - active: a lot inactive now but last updated after the line (a merge
--     fold or write-off, a deactivation) was active at the line.
-- The match is the proof the figure came from that formula, not a legacy
-- import, a merge plan or a hand-typed cost -- and it is what keeps a line
-- written correctly after the fix (window included) from ever being touched:
-- a correct figure that also equals the buggy mean is 'already_correct' and
-- is not written.
--
-- ============================== THE CORRECT COST =========================
-- 0195's rule applied to the shelf AT THE LINE, not today:
-- SUM(on-hand qty x unit cost) / SUM(on-hand qty) over the product's lots
-- (as owned, costed and active at the line) with a recorded (> 0) cost that
-- were on hand just before the line's own stock movement; a manual override
-- prices the on-hand units of the lots at or below its baseline; nearest 4dp
-- half up. Nothing on hand: the newest received lot that existed at the line.
-- On hand is rebuilt per lot from a ledger positioned by
-- inventory_movements.id: every movement stamped with the lot (batch_id);
-- for a multi-lot sale movement (no lot), that line's net
-- sale_item_batch_allocations, read on the lot they had before a merge fold
-- re-pointed them (foldedBatches.saleAllocationIds); and each merge fold or
-- write-off (foldedBatches.dupStockBefore, writtenOffBatches.stockBefore)
-- as a synthetic move at the merge's position.
-- The line's own position: its sale's 'sale' movement for the product whose
-- snapshot cost equals the line's cost; else (a line already rewritten here --
-- inventory_movements.unit_cost_usd keeps the old snapshot -- or edited) its
-- sale's first 'sale' movement for the product; else the first movement at
-- or after its sale time. The second step keeps the audit's post-apply
-- reading stable: a rewritten line is found at its own position, its cost
-- equals the on-hand cost, and it drops off every list.
--
-- ============================== BUCKETS ==================================
-- Rewritten: 'repair' (sale line before fix_at), 'window' (sale line in
-- [fix_at, era_end)), 'returns_sale_linked', 'returns_walk_in'.
-- Listed, NOT rewritten (row by row in sale_cost_repair_0200_plan and audit
-- statement 2, with the best-estimate correct cost and a reason):
--   'ledger_unverified'  -- came from the buggy average, but a lot on the
--                           product at the line does not reconcile (ledger
--                           total <> branch_batch_stock, runs negative, or a
--                           received lot with no ledger event). Checked before
--                           'already_correct': an unreconciled ledger proves
--                           neither a repair nor that none is needed;
--   'needs_owner_review' -- 'no_derivable_cost' (buggy, nothing to price it
--                           by); 'matches_only_todays_lot_state' (matches the
--                           buggy mean over today's lots but not over the
--                           reconstructed ones); 'lot_history_changed_after_sale'
--                           (no match, differs from the on-hand cost, and a lot,
--                           merge or cost entry of its product changed after
--                           the line, so a match cannot be proven either way);
--                           'sold_lot_belongs_to_another_product' (the line's
--                           own lot, sale_items.batch_id, was on a different
--                           product at the line with no merge snapshot to say
--                           why -- the 0109-style SQL re-point that moved lines
--                           and movements but left the lots; priced over that
--                           lot's product as the best estimate);
--                           and return lines following a line not rewritten;
--   'after_window'       -- matches after era_end: a deploy-lag tell, must be 0;
--   'already_correct'    -- informational.
-- A line not listed either did not come from the buggy average (its lot state
-- is known and the mean does not match) or already holds the on-hand cost.
--
-- ============================== LIMITS ===================================
--   - Lot cost edits made outside the batch editor (stock-in line edits,
--     imports) leave no dated trail: a lot touched after the line whose cost
--     no longer equals its first receipt movement is read at that receipt
--     cost, and the buggy-mean match decides whether the line is proven.
--   - A merge undone and redone keeps its original snapshot time.
--   - The ledger guard proves a lot's ledger balances, not that every
--     intermediate step is timed right (two unstamped events that cancel are
--     invisible; a void of a multi-lot line folds into the sale's position).
--   - A line whose sale has no 'sale' movement for it (held / stock-skipped) is positioned at the
--     first movement at or after its sale time (second resolution).
--   - inventory_movements.unit_cost_usd keeps the old snapshot; no report
--     reads it for COGS.
--   - A restock spread over several lots by return_item_batch_allocations
--     with no batch-stamped 'return' movement is not in the lot ledger: the
--     lots it touched fail the reconcile check and their lines are listed as
--     'ledger_unverified', never rewritten.
--   - A walk-in return is timed at returns.created_at and positioned at its
--     first 'return' movement; a later edit of it is not re-timed.
--   - A 0109-style SQL merge leaves no snapshot; only a line whose own lot
--     (sale_items.batch_id) sits on another product reveals it. Such a line
--     is listed ('sold_lot_belongs_to_another_product'), never rewritten; a
--     multi-lot line (batch_id NULL) moved that way is not detectable.
--
-- ============================== AUDIT ====================================
-- ops/scripts/audit/sale-cost-on-hand-audit.sql (SELECT-only) carries the
-- same plan text (pinned by cloudflare/scripts/test-held-0200-sale-cost-repair-pure.cjs;
-- the fixture proof against a fixed-code replay is
-- cloudflare/scripts/test-held-0200-sale-cost-oracle-pure.cjs).
--
-- ============================== PRE ASSERTIONS ===========================
-- Read-only, immediately before applying (record every figure):
--   SELECT COUNT(*), ROUND(SUM(quantity), 4), ROUND(SUM(total_usd), 4), ROUND(SUM(applied_price_usd * quantity), 4),
--          ROUND(SUM(cost_price_khr * quantity), 4), ROUND(SUM(cost_price_usd * quantity), 4) FROM sale_items;   -- S
--   SELECT COUNT(*), ROUND(SUM(quantity), 4), ROUND(SUM(total_usd), 4), ROUND(SUM(cost_price_khr * quantity), 4),
--          ROUND(SUM(cost_price_usd * quantity), 4) FROM return_items;                                            -- RI
--   SELECT COUNT(*), ROUND(SUM(total_usd), 4), ROUND(SUM(subtotal_usd), 4), group_concat(DISTINCT sale_status) FROM sales;         -- SA
--   SELECT COUNT(*), ROUND(SUM(total_refund_usd), 4) FROM returns;                                                                 -- RE
--   The audit's first statement: R, W, RL, RW and every D.
--
-- ============================== IN-FILE ASSERTIONS =======================
-- After the writes, each "INSERT INTO branches(name) SELECT NULL WHERE
-- <violation>" statement aborts the whole migration (branches.name is NOT
-- NULL) if: a rewritten line does not hold its new cost; a rewritten-bucket
-- plan row has no backup; a backup's new cost is not positive or equals the
-- old; or a backup names a line outside the rewritten buckets.
--
-- ============================== POST ASSERTIONS ==========================
--   SELECT bucket, COUNT(*), ROUND(SUM(quantity * (new_cost_price_usd - old_cost_price_usd)), 4)
--     FROM sale_cost_repair_0200 GROUP BY bucket;                                -- R, W and their D
--   SELECT bucket, COUNT(*), ROUND(SUM(quantity * (new_cost_price_usd - old_cost_price_usd)), 4)
--     FROM sale_cost_repair_0200_return_items GROUP BY bucket;                   -- RL, RW and their D
--   S again: every figure equal EXCEPT the last, which moved by exactly
--     D(repair) + D(window).
--   RI again: count, quantity, total_usd and KHR equal; the cost sum moved by
--     D(returns_sale_linked) + D(returns_walk_in).
--   SA and RE again: identical (revenue, refunds, statuses untouched).
--   The audit's first statement again: repair, window, returns_sale_linked
--   and returns_walk_in all 0 lines (a rewritten line no longer matches the
--   buggy average); the review buckets unchanged.
--
-- ============================== RECOVERY =================================
-- Owner-approved only. Puts back the pre-0200 cost of every line that still
-- holds the figure 0200 wrote (a line changed since is left alone and shows
-- in the preview). Preview:
--   SELECT (SELECT COUNT(*) FROM sale_items si JOIN sale_cost_repair_0200 r ON r.sale_item_id = si.id WHERE si.cost_price_usd IS NOT r.new_cost_price_usd)
--     + (SELECT COUNT(*) FROM return_items ri JOIN sale_cost_repair_0200_return_items x ON x.return_item_id = ri.id WHERE ri.cost_price_usd IS NOT x.new_cost_price_usd);
-- Statements:
--   UPDATE sale_items SET cost_price_usd = (SELECT r.old_cost_price_usd FROM sale_cost_repair_0200 r WHERE r.sale_item_id = sale_items.id)
--     WHERE id IN (SELECT r.sale_item_id FROM sale_cost_repair_0200 r WHERE r.new_cost_price_usd IS sale_items.cost_price_usd);
--   UPDATE return_items SET cost_price_usd = (SELECT x.old_cost_price_usd FROM sale_cost_repair_0200_return_items x WHERE x.return_item_id = return_items.id)
--     WHERE id IN (SELECT x.return_item_id FROM sale_cost_repair_0200_return_items x WHERE x.new_cost_price_usd IS return_items.cost_price_usd);
-- The backup and plan tables are never dropped by code; they are the audit
-- trail. Their value columns are declared without a type, so each old value
-- is stored exactly as read and the recovery is byte-exact.
-- D1 applies the migration transactionally. No explicit transaction statements.
-- Re-running this file changes nothing: the tables are IF NOT EXISTS, the
-- inserts OR IGNORE, and a line is only rewritten while it still holds the
-- backed-up old figure. If the plan exceeds D1's limits the migration fails as
-- a whole and nothing is written; run the audit first to size it.

CREATE TABLE IF NOT EXISTS sale_cost_repair_0200_plan (
  kind TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  sale_id INTEGER,
  return_id INTEGER,
  product_id INTEGER,
  quantity,
  recorded_cost_usd,
  correct_cost_usd,
  buggy_mean_usd,
  ledger_position,
  on_hand_units,
  line_at TEXT,
  bucket TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (kind, item_id)
);

CREATE TABLE IF NOT EXISTS sale_cost_repair_0200 (
  sale_item_id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL,
  product_id INTEGER,
  quantity,
  old_cost_price_usd,
  new_cost_price_usd,
  buggy_mean_usd,
  ledger_position INTEGER,
  on_hand_units,
  bucket TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sale_cost_repair_0200_return_items (
  return_item_id INTEGER PRIMARY KEY,
  sale_item_id INTEGER,
  return_id INTEGER,
  quantity,
  old_cost_price_usd,
  new_cost_price_usd,
  bucket TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO sale_cost_repair_0200_plan (kind, item_id, sale_id, return_id, product_id, quantity, recorded_cost_usd,
  correct_cost_usd, buggy_mean_usd, ledger_position, on_hand_units, line_at, bucket, reason)
-- plan:begin
WITH
params AS MATERIALIZED (
  SELECT fx AS fix_at,
    COALESCE(datetime(fx, '+2 hours'), '9999-12-31 23:59:59') AS era_end,
    COALESCE(datetime(fx, '+7 days'), '9999-12-31 23:59:59') AS scan_end
  FROM (SELECT COALESCE(MIN(datetime(created_at)), '9999-12-31 23:59:59') AS fx FROM catalog_cost_repair_0195_backup)
),
merge_rev AS MATERIALIZED (
  SELECT us.id * 1000000 AS ord, datetime(us.created_at) AS at, us.payload_json AS rev
    FROM undo_snapshots us
   WHERE us.kind IN ('product.merge', 'product.merge.group.child') AND us.status <> 'reversed'
     AND datetime(us.created_at) >= '2026-09-16 14:04:42' AND json_valid(us.payload_json)
  UNION ALL
  SELECT us.id * 1000000 + r.key, datetime(us.created_at), r.value
    FROM undo_snapshots us
    JOIN json_each(CASE WHEN json_valid(us.payload_json) THEN us.payload_json ELSE '{}' END, '$.reversals') r
   WHERE us.kind = 'product.merge.bulk' AND us.status <> 'reversed' AND datetime(us.created_at) >= '2026-09-16 14:04:42'
),
row_move AS MATERIALIZED (
  SELECT 'sale_items' AS tbl, CAST(i.value AS INTEGER) AS row_id, CAST(json_extract(m.rev, '$.dupId') AS INTEGER) AS dup_id, m.at, m.ord
    FROM merge_rev m JOIN json_each(m.rev, '$.reparentedSaleItemIds') i
  UNION
  SELECT json_extract(t.value, '$.table'), CAST(i.value AS INTEGER), CAST(json_extract(m.rev, '$.dupId') AS INTEGER), m.at, m.ord
    FROM merge_rev m JOIN json_each(m.rev, '$.reparentedByTable') t JOIN json_each(t.value, '$.ids') i
   WHERE json_extract(t.value, '$.table') IN ('sale_items', 'return_items', 'product_cost_entries')
  UNION
  SELECT 'product_batches', CAST(json_extract(b.value, '$.id') AS INTEGER), CAST(json_extract(m.rev, '$.dupId') AS INTEGER), m.at, m.ord
    FROM merge_rev m JOIN json_each(m.rev, '$.repointedBatches') b
),
merge_lots AS MATERIALIZED (
  SELECT m.at, m.ord, 'fold' AS how, f.value AS lot
    FROM merge_rev m JOIN json_each(m.rev, '$.foldedBatches') f
  UNION ALL
  SELECT m.at, m.ord, 'write_off', w.value
    FROM merge_rev m JOIN json_each(m.rev, '$.writtenOffBatches') w
),
merge_pos AS MATERIALIZED (
  SELECT m2.at, COALESCE((SELECT MIN(im.id) FROM inventory_movements im WHERE im.created_at >= m2.at),
      (SELECT COALESCE(MAX(im.id), 0) + 1 FROM inventory_movements im)) - 0.5 AS pos
  FROM (SELECT DISTINCT at FROM merge_lots) m2
),
lot_edit AS MATERIALIZED (
  SELECT a.id, CAST(a.entity_id AS INTEGER) AS lot_id, datetime(a.created_at) AS at,
    CAST(json_extract(CASE WHEN json_valid(a.details) THEN a.details END, '$.unit_cost_usd') AS REAL) AS cost
  FROM audit_logs a
  WHERE a.action = 'batch_update' AND a.entity = 'product_batch'
    AND json_type(CASE WHEN json_valid(a.details) THEN a.details END, '$.unit_cost_usd') IS NOT NULL
),
sale_lines AS MATERIALIZED (
  SELECT si.id AS item_id, si.sale_id, si.product_id AS product_now, si.quantity, si.cost_price_usd AS recorded,
    datetime(s.created_at) AS sale_at
  FROM sale_items si JOIN sales s ON s.id = si.sale_id
  WHERE si.product_id IS NOT NULL AND si.cost_price_usd > 0 AND datetime(s.created_at) >= '2026-09-16 14:04:42'
  UNION
  SELECT si.id, si.sale_id, si.product_id, si.quantity, si.cost_price_usd, datetime(s.created_at)
  FROM inventory_movements im
  JOIN sale_items si ON si.sale_id = im.reference_id AND si.product_id = im.product_id
  JOIN sales s ON s.id = si.sale_id
  WHERE im.movement_type = 'sale' AND im.created_at >= '2026-09-16 14:04:42'
    AND si.cost_price_usd > 0 AND datetime(s.created_at) < '2026-09-16 14:04:42'
),
items AS MATERIALIZED (
  SELECT 'sale' AS kind, sm.item_id AS ik, sm.item_id, sm.sale_id, NULL AS return_id, sm.product_now, sm.quantity, sm.recorded,
    COALESCE((SELECT datetime(im.created_at) FROM inventory_movements im WHERE im.id = COALESCE(sm.mv_id, sm.mv_any)), sm.sale_at) AS t,
    COALESCE(sm.mv_id, sm.mv_any,
      (SELECT MIN(im.id) FROM inventory_movements im WHERE im.created_at >= sm.sale_at),
      (SELECT COALESCE(MAX(im.id), 0) + 1 FROM inventory_movements im)) AS pos
  FROM (SELECT sl.*,
      (SELECT MIN(im.id) FROM inventory_movements im
        WHERE im.reference_id = sl.sale_id AND im.movement_type = 'sale' AND im.product_id = sl.product_now
          AND im.unit_cost_usd IS NOT NULL AND ABS(im.unit_cost_usd - sl.recorded) < 0.00006) AS mv_id,
      (SELECT MIN(im.id) FROM inventory_movements im
        WHERE im.reference_id = sl.sale_id AND im.movement_type = 'sale' AND im.product_id = sl.product_now) AS mv_any
    FROM sale_lines sl) sm
  UNION ALL
  SELECT 'return', -ri.id, ri.id, NULL, r.id, ri.product_id, ri.quantity, ri.cost_price_usd, datetime(r.created_at),
    COALESCE((SELECT MIN(im.id) FROM inventory_movements im WHERE im.reference_id = r.id AND im.movement_type = 'return'),
      (SELECT MIN(im.id) FROM inventory_movements im WHERE im.created_at >= datetime(r.created_at)),
      (SELECT COALESCE(MAX(im.id), 0) + 1 FROM inventory_movements im))
  FROM return_items ri JOIN returns r ON r.id = ri.return_id
  WHERE r.sale_id IS NULL AND COALESCE(r.return_scope, 'customer') = 'customer' AND ri.sale_item_id IS NULL
    AND ri.product_id IS NOT NULL AND ri.cost_price_usd > 0 AND datetime(r.created_at) >= '2026-09-16 14:04:42'
),
item_ctx AS MATERIALIZED (
  SELECT x.*,
    CASE WHEN x.lot_owner <> COALESCE(x.moved_dup, x.product_now) THEN x.lot_owner ELSE COALESCE(x.moved_dup, x.product_now) END AS prod_at,
    x.moved_dup IS NOT NULL AS moved, COALESCE(x.lot_owner <> COALESCE(x.moved_dup, x.product_now), 0) AS orphan
  FROM (SELECT it.*, p.fix_at, p.era_end,
      (SELECT COALESCE((SELECT rm.dup_id FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = pb.id AND rm.at > it.t
          ORDER BY rm.ord LIMIT 1), pb.variant_product_id)
        FROM product_batches pb
       WHERE pb.id = CASE it.kind WHEN 'sale' THEN (SELECT si.batch_id FROM sale_items si WHERE si.id = it.item_id)
         ELSE (SELECT ri.batch_id FROM return_items ri WHERE ri.id = it.item_id) END) AS lot_owner,
      (SELECT rm.dup_id FROM row_move rm
        WHERE rm.tbl = CASE it.kind WHEN 'sale' THEN 'sale_items' ELSE 'return_items' END
          AND rm.row_id = it.item_id AND rm.at > it.t ORDER BY rm.ord LIMIT 1) AS moved_dup
    FROM items it JOIN params p
    WHERE it.t >= '2026-09-16 14:04:42' AND it.t < p.scan_end) x
),
pce_at AS MATERIALIZED (
  SELECT ic.ik, pce.id, pce.cost_usd, pce.baseline_batch_id
    FROM item_ctx ic JOIN product_cost_entries pce ON pce.product_id = ic.prod_at
   WHERE datetime(pce.created_at) <= ic.t
     AND NOT EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.row_id = pce.id AND rm.at > ic.t)
  UNION
  SELECT ic.ik, pce.id, pce.cost_usd, pce.baseline_batch_id
    FROM item_ctx ic
    JOIN row_move rm ON rm.tbl = 'product_cost_entries' AND rm.dup_id = ic.prod_at AND rm.at > ic.t
    JOIN product_cost_entries pce ON pce.id = rm.row_id
   WHERE datetime(pce.created_at) <= ic.t
     AND NOT EXISTS (SELECT 1 FROM row_move r2 WHERE r2.tbl = 'product_cost_entries' AND r2.row_id = rm.row_id
       AND r2.at > ic.t AND r2.ord < rm.ord)
),
pce_top AS MATERIALIZED (
  SELECT ik, cost_usd, baseline_batch_id FROM (
    SELECT x.*, ROW_NUMBER() OVER (PARTITION BY x.ik ORDER BY x.id DESC) AS rn FROM pce_at x)
  WHERE rn = 1
),
item_me AS MATERIALIZED (
  SELECT ic.*,
    pt.ik IS NOT NULL AS has_me, pt.cost_usd AS me_cost, COALESCE(pt.baseline_batch_id, 0) AS me_baseline,
    EXISTS (SELECT 1 FROM product_cost_entries pce
      WHERE pce.product_id = ic.product_now AND datetime(pce.created_at) <= ic.t) AS now_has_me,
    (SELECT pce.cost_usd FROM product_cost_entries pce
      WHERE pce.product_id = ic.product_now AND datetime(pce.created_at) <= ic.t ORDER BY pce.id DESC LIMIT 1) AS now_me_cost,
    COALESCE((SELECT pce.baseline_batch_id FROM product_cost_entries pce
      WHERE pce.product_id = ic.product_now AND datetime(pce.created_at) <= ic.t ORDER BY pce.id DESC LIMIT 1), 0) AS now_me_baseline,
    EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.dup_id = ic.prod_at AND rm.at > ic.t) AS me_moved
  FROM item_ctx ic LEFT JOIN pce_top pt ON pt.ik = ic.ik
),
item_lot AS MATERIALIZED (
  SELECT m.ik, pb.id AS lot_id
    FROM item_me m JOIN product_batches pb ON pb.variant_product_id = m.prod_at
   WHERE NOT EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = pb.id AND rm.at > m.t)
  UNION
  SELECT m.ik, rm.row_id
    FROM item_me m JOIN row_move rm ON rm.tbl = 'product_batches' AND rm.dup_id = m.prod_at AND rm.at > m.t
   WHERE NOT EXISTS (SELECT 1 FROM row_move r2 WHERE r2.tbl = 'product_batches' AND r2.row_id = rm.row_id
       AND r2.at > m.t AND r2.ord < rm.ord)
),
lot_base AS MATERIALIZED (
  SELECT pb.id AS lot_id, pb.is_active, pb.unit_cost_usd AS cost_now, datetime(pb.updated_at) AS updated_at,
    datetime(COALESCE(pb.created_at, pb.received_at)) AS created, COALESCE(pb.received_at, '') AS received_at,
    COALESCE(pb.received_quantity, 0) AS received_quantity,
    (SELECT im.unit_cost_usd FROM inventory_movements im
      WHERE im.batch_id = pb.id AND im.quantity > 0 AND im.unit_cost_usd > 0 ORDER BY im.id LIMIT 1) AS receipt_cost,
    (SELECT MAX(le.at) FROM lot_edit le WHERE le.lot_id = pb.id) AS last_edit_at
  FROM product_batches pb WHERE pb.id IN (SELECT lot_id FROM item_lot)
),
lot_at AS MATERIALIZED (
  SELECT il.ik, il.lot_id, m.t, m.pos, m.has_me, m.me_cost, m.me_baseline, lb.created, lb.received_at,
    CASE WHEN lb.is_active = 1 OR lb.updated_at > m.t THEN 1 ELSE 0 END AS active_t,
    COALESCE(
      (SELECT le.cost FROM lot_edit le WHERE le.lot_id = il.lot_id AND le.at <= m.t ORDER BY le.id DESC LIMIT 1),
      CASE WHEN lb.last_edit_at > m.t THEN COALESCE(lb.receipt_cost, lb.cost_now)
           WHEN lb.updated_at > m.t AND lb.receipt_cost IS NOT NULL AND ABS(lb.receipt_cost - COALESCE(lb.cost_now, 0)) >= 0.00005
             THEN lb.receipt_cost END,
      lb.cost_now) AS cost_t,
    CASE WHEN (COALESCE(lb.is_active, 0) <> 1 AND lb.updated_at > m.t)
      OR lb.last_edit_at > m.t
      OR (lb.updated_at > m.t AND lb.receipt_cost IS NOT NULL AND ABS(lb.receipt_cost - COALESCE(lb.cost_now, 0)) >= 0.00005)
      OR EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = il.lot_id AND rm.at > m.t)
    THEN 1 ELSE 0 END AS changed
  FROM item_lot il JOIN item_me m ON m.ik = il.ik JOIN lot_base lb ON lb.lot_id = il.lot_id
),
bset AS MATERIALIZED (
  SELECT la.ik, 'h' AS v, la.cost_t AS cost
    FROM lot_at la
   WHERE la.active_t = 1 AND la.cost_t > 0 AND la.created <= la.t AND (la.has_me = 0 OR la.lot_id > la.me_baseline)
  UNION
  SELECT m.ik, 'h', m.me_cost FROM item_me m WHERE m.has_me = 1 AND m.me_cost > 0
  UNION
  SELECT m.ik, 'n', pb.unit_cost_usd
    FROM item_me m JOIN product_batches pb ON pb.variant_product_id = m.product_now
   WHERE pb.is_active = 1 AND pb.unit_cost_usd > 0
     AND datetime(COALESCE(pb.created_at, pb.received_at)) <= m.t
     AND (m.now_has_me = 0 OR pb.id > m.now_me_baseline)
  UNION
  SELECT m.ik, 'n', m.now_me_cost FROM item_me m WHERE m.now_has_me = 1 AND m.now_me_cost > 0
),
item_match AS MATERIALIZED (
  SELECT m.ik,
    MAX(CASE WHEN b.v = 'h' AND (ABS(m.recorded - b.b1) < 0.00006 OR ABS(m.recorded - b.b1h) < 0.00006 OR ABS(m.recorded - b.b2) < 0.00006) THEN 1 ELSE 0 END) AS h_match,
    MAX(CASE WHEN b.v = 'n' AND (ABS(m.recorded - b.b1) < 0.00006 OR ABS(m.recorded - b.b1h) < 0.00006 OR ABS(m.recorded - b.b2) < 0.00006) THEN 1 ELSE 0 END) AS n_match,
    MAX(CASE WHEN b.v = 'h' THEN b.b1 END) AS buggy_mean_usd
  FROM item_me m JOIN (
    SELECT ik, v,
      ROUND(AVG(cost), 4) AS b1,
      CAST(AVG(cost) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 AS b1h,
      CASE WHEN MAX(cost) > 2 * MIN(cost) THEN MAX(cost) ELSE ROUND(AVG(cost), 4) END AS b2
    FROM bset GROUP BY ik, v) b ON b.ik = m.ik
  GROUP BY m.ik
),
cand_lots AS MATERIALIZED (
  SELECT lot_id FROM lot_base
),
ev AS MATERIALIZED (
  SELECT im.batch_id AS lot_id, im.id AS pos, im.quantity AS qty
    FROM inventory_movements im WHERE im.batch_id IN (SELECT lot_id FROM cand_lots)
  UNION ALL
  SELECT x.lot_id, x.pos, -x.q FROM (
    SELECT COALESCE((SELECT CAST(json_extract(ml.lot, '$.dupBatchId') AS INTEGER) FROM merge_lots ml JOIN json_each(ml.lot, '$.saleAllocationIds') ai
          WHERE ml.how = 'fold' AND CAST(ai.value AS INTEGER) = a.id ORDER BY ml.ord LIMIT 1), a.batch_id) AS lot_id,
      a.quantity - COALESCE(a.released_quantity, 0) AS q,
      (SELECT MIN(im.id) FROM sale_items si JOIN inventory_movements im
          ON im.reference_id = si.sale_id AND im.movement_type = 'sale' AND im.product_id = si.product_id AND im.batch_id IS NULL
        WHERE si.id = a.sale_item_id) AS pos
    FROM sale_item_batch_allocations a) x
  WHERE x.pos IS NOT NULL AND x.lot_id IN (SELECT lot_id FROM cand_lots)
  UNION ALL
  SELECT x.lot_id, x.pos, x.qty FROM (
    SELECT CAST(json_extract(ml.lot, CASE ml.how WHEN 'fold' THEN '$.dupBatchId' ELSE '$.batchId' END) AS INTEGER) AS lot_id,
      mp.pos, -json_extract(s.value, '$.quantity') AS qty
      FROM merge_lots ml JOIN json_each(ml.lot, CASE ml.how WHEN 'fold' THEN '$.dupStockBefore' ELSE '$.stockBefore' END) s
      JOIN merge_pos mp ON mp.at = ml.at
    UNION ALL
    SELECT CAST(json_extract(ml.lot, '$.keeperBatchId') AS INTEGER), mp.pos, json_extract(s.value, '$.quantity')
      FROM merge_lots ml JOIN json_each(ml.lot, '$.dupStockBefore') s
      JOIN merge_pos mp ON mp.at = ml.at
     WHERE ml.how = 'fold') x
  WHERE x.lot_id IN (SELECT lot_id FROM cand_lots)
),
bad_lots AS MATERIALIZED (
  SELECT lot_id FROM (
    SELECT e.lot_id, SUM(e.qty) OVER (PARTITION BY e.lot_id ORDER BY e.pos, e.qty DESC ROWS UNBOUNDED PRECEDING) AS running,
      SUM(e.qty) OVER (PARTITION BY e.lot_id) AS total
    FROM ev e) w
  WHERE w.running < 0
     OR w.total <> COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = w.lot_id), 0)
  UNION
  SELECT lb.lot_id FROM lot_base lb
   WHERE NOT EXISTS (SELECT 1 FROM inventory_movements im WHERE im.batch_id = lb.lot_id)
     AND (lb.received_quantity > 0 OR COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = lb.lot_id), 0) <> 0)
),
weighted AS MATERIALIZED (
  SELECT ik,
    CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END AS w,
    SUM(qty) AS on_hand_units
  FROM (
    SELECT o.ik, CASE WHEN o.has_me = 1 AND o.lot_id <= o.me_baseline THEN o.me_cost ELSE o.cost_t END AS cost, o.q AS qty
    FROM (
      SELECT la.ik, la.lot_id, la.cost_t, la.has_me, la.me_cost, la.me_baseline, SUM(e.qty) AS q
        FROM lot_at la JOIN ev e ON e.lot_id = la.lot_id AND e.pos < la.pos
       WHERE la.active_t = 1
       GROUP BY la.ik, la.lot_id, la.cost_t, la.has_me, la.me_cost, la.me_baseline) o
    WHERE o.q > 0 AND (CASE WHEN o.has_me = 1 AND o.lot_id <= o.me_baseline THEN o.me_cost ELSE o.cost_t END) > 0)
  GROUP BY ik
),
lot_agg AS MATERIALIZED (
  SELECT ik,
    MAX(CASE WHEN active_t = 1 AND created <= t AND bad = 1 THEN 1 ELSE 0 END) AS unverified,
    MAX(CASE WHEN changed = 1 AND created <= t THEN 1 ELSE 0 END) AS lot_changed,
    MAX(CASE WHEN fb_rank = 1 AND eligible = 1 THEN cost_t END) AS fallback
  FROM (
    SELECT y.*, ROW_NUMBER() OVER (PARTITION BY y.ik, y.eligible ORDER BY y.received_at DESC, y.lot_id DESC) AS fb_rank
    FROM (
      SELECT la.*, bl.lot_id IS NOT NULL AS bad,
        CASE WHEN la.active_t = 1 AND la.cost_t > 0 AND la.created <= la.t AND (la.has_me = 0 OR la.lot_id > la.me_baseline)
          THEN 1 ELSE 0 END AS eligible
      FROM lot_at la LEFT JOIN bad_lots bl ON bl.lot_id = la.lot_id) y)
  GROUP BY ik
),
classified_items AS MATERIALIZED (
  SELECT g.*,
    CASE
      WHEN g.t >= g.era_end THEN CASE WHEN g.h_match = 1 AND g.differs = 1 THEN 'after_window' END
      WHEN g.orphan = 1 AND g.differs = 1 THEN 'needs_owner_review'
      WHEN g.h_match = 1 AND g.correct IS NULL THEN 'needs_owner_review'
      WHEN g.h_match = 1 AND g.unverified = 1 THEN 'ledger_unverified'
      WHEN g.h_match = 1 AND g.differs = 0 THEN 'already_correct'
      WHEN g.h_match = 1 AND g.kind = 'return' THEN 'returns_walk_in'
      WHEN g.h_match = 1 AND g.t >= g.fix_at THEN 'window'
      WHEN g.h_match = 1 THEN 'repair'
      WHEN g.differs = 0 THEN NULL
      WHEN g.n_match = 1 OR g.uncertain = 1 THEN 'needs_owner_review'
    END AS bucket,
    CASE
      WHEN g.t >= g.era_end THEN 'buggy_average_after_deploy_window'
      WHEN g.orphan = 1 AND g.differs = 1 THEN 'sold_lot_belongs_to_another_product'
      WHEN g.h_match = 1 AND g.correct IS NULL THEN 'no_derivable_cost'
      WHEN g.h_match = 1 AND g.unverified = 1 THEN 'lot_ledger_does_not_reconcile'
      WHEN g.h_match = 1 AND g.differs = 0 THEN 'buggy_average_equalled_on_hand'
      WHEN g.h_match = 1 AND g.t >= g.fix_at THEN 'buggy_average_deploy_window'
      WHEN g.h_match = 1 THEN 'buggy_average'
      WHEN g.n_match = 1 THEN 'matches_only_todays_lot_state'
      ELSE 'lot_history_changed_after_sale'
    END AS reason
  FROM (
    SELECT f.*, CASE WHEN f.correct IS NULL OR ABS(f.recorded - f.correct) < 0.00005 THEN 0 ELSE 1 END AS differs
    FROM (
      SELECT m.kind, m.item_id, m.sale_id, m.return_id, m.product_now AS product_id, m.quantity, m.recorded, m.t, m.pos,
        m.fix_at, m.era_end, COALESCE(w.w, la.fallback) AS correct, COALESCE(w.on_hand_units, 0) AS on_hand_units,
        COALESCE(mt.h_match, 0) AS h_match, COALESCE(mt.n_match, 0) AS n_match, mt.buggy_mean_usd,
        COALESCE(la.unverified, 0) AS unverified, m.orphan,
        CASE WHEN m.moved = 1 OR m.me_moved = 1 OR COALESCE(la.lot_changed, 0) = 1 THEN 1 ELSE 0 END AS uncertain
      FROM item_me m LEFT JOIN weighted w ON w.ik = m.ik LEFT JOIN item_match mt ON mt.ik = m.ik
      LEFT JOIN lot_agg la ON la.ik = m.ik) f) g
),
linked AS MATERIALIZED (
  SELECT ri.id AS return_item_id, r.id AS return_id, r.sale_id, ri.product_id, ri.quantity, ri.cost_price_usd AS recorded,
    datetime(r.created_at) AS t, ri.sale_item_id IS NULL AS by_product,
    COUNT(*) AS n_affected,
    SUM(CASE WHEN c.bucket IN ('repair', 'window') THEN 1 ELSE 0 END) AS n_repaired,
    MIN(c.correct) AS min_correct, MAX(c.correct) AS max_correct, MIN(c.item_id) AS first_line_id,
    MAX(c.buggy_mean_usd) AS buggy_mean_usd,
    (SELECT COUNT(*) FROM sale_items s2 WHERE s2.sale_id = r.sale_id AND (s2.id = ri.sale_item_id
      OR (ri.sale_item_id IS NULL AND s2.product_id = ri.product_id
        AND (ri.branch_id IS NULL OR s2.branch_id IS NULL OR s2.branch_id = ri.branch_id)))) AS n_lines,
    NOT EXISTS (SELECT 1 FROM sale_items s2 WHERE s2.sale_id = r.sale_id AND (s2.id = ri.sale_item_id
      OR (ri.sale_item_id IS NULL AND s2.product_id = ri.product_id
        AND (ri.branch_id IS NULL OR s2.branch_id IS NULL OR s2.branch_id = ri.branch_id)))
      AND NOT (ABS(s2.cost_price_usd - ri.cost_price_usd) < 0.00006)) AS all_equal
  FROM classified_items c
  JOIN sale_items sc ON sc.id = c.item_id
  JOIN returns r ON r.sale_id = c.sale_id
  JOIN return_items ri ON ri.return_id = r.id AND ri.cost_price_usd IS NOT NULL
   AND (ri.sale_item_id = c.item_id OR (ri.sale_item_id IS NULL AND ri.product_id = sc.product_id
     AND (ri.branch_id IS NULL OR sc.branch_id IS NULL OR sc.branch_id = ri.branch_id)))
  WHERE c.kind = 'sale' AND c.bucket IN ('repair', 'window', 'ledger_unverified', 'needs_owner_review')
  GROUP BY ri.id, r.id, r.sale_id, ri.product_id, ri.quantity, ri.cost_price_usd, r.created_at, ri.sale_item_id, ri.branch_id
),
classified AS MATERIALIZED (
  SELECT kind, item_id, sale_id, return_id, product_id, quantity, recorded, correct, buggy_mean_usd, pos, on_hand_units, t, bucket, reason
    FROM classified_items WHERE bucket IS NOT NULL
  UNION ALL
  SELECT 'return', l.return_item_id, l.sale_id, l.return_id, l.product_id, l.quantity, l.recorded,
    COALESCE((SELECT c2.correct FROM classified_items c2 WHERE c2.kind = 'sale' AND c2.item_id = l.first_line_id), l.min_correct),
    l.buggy_mean_usd, NULL, NULL, l.t,
    CASE WHEN l.n_repaired = l.n_lines AND l.min_correct = l.max_correct THEN 'returns_sale_linked' ELSE 'needs_owner_review' END,
    CASE WHEN l.n_repaired = l.n_lines AND l.min_correct = l.max_correct
           THEN CASE WHEN l.by_product = 1 THEN 'copied_from_sale_line_by_product' ELSE 'copied_from_sale_line' END
         WHEN l.n_repaired = l.n_lines THEN 'sale_lines_of_product_now_differ'
         ELSE 'follows_unrepaired_sale_line' END
  FROM linked l WHERE l.all_equal = 1
)
-- plan:stop
SELECT kind, item_id, sale_id, return_id, product_id, quantity, recorded, correct, buggy_mean_usd, pos, on_hand_units, t, bucket, reason
FROM classified;

INSERT OR IGNORE INTO sale_cost_repair_0200 (sale_item_id, sale_id, product_id, quantity, old_cost_price_usd, new_cost_price_usd,
  buggy_mean_usd, ledger_position, on_hand_units, bucket, reason)
SELECT si.id, si.sale_id, si.product_id, si.quantity, si.cost_price_usd, p.correct_cost_usd,
  p.buggy_mean_usd, p.ledger_position, p.on_hand_units, p.bucket, p.reason
FROM sale_cost_repair_0200_plan p JOIN sale_items si ON si.id = p.item_id
WHERE p.kind = 'sale' AND p.bucket IN ('repair', 'window') AND p.correct_cost_usd > 0
  AND ABS(si.cost_price_usd - p.recorded_cost_usd) < 0.00006;

INSERT OR IGNORE INTO sale_cost_repair_0200_return_items (return_item_id, sale_item_id, return_id, quantity, old_cost_price_usd,
  new_cost_price_usd, bucket, reason)
SELECT ri.id, ri.sale_item_id, ri.return_id, ri.quantity, ri.cost_price_usd, p.correct_cost_usd, p.bucket, p.reason
FROM sale_cost_repair_0200_plan p JOIN return_items ri ON ri.id = p.item_id
WHERE p.kind = 'return' AND p.bucket IN ('returns_sale_linked', 'returns_walk_in') AND p.correct_cost_usd > 0
  AND ABS(ri.cost_price_usd - p.recorded_cost_usd) < 0.00006;

UPDATE sale_items SET cost_price_usd = (SELECT r.new_cost_price_usd FROM sale_cost_repair_0200 r WHERE r.sale_item_id = sale_items.id)
WHERE id IN (SELECT r.sale_item_id FROM sale_cost_repair_0200 r WHERE r.old_cost_price_usd IS sale_items.cost_price_usd);

UPDATE return_items SET cost_price_usd = (SELECT x.new_cost_price_usd FROM sale_cost_repair_0200_return_items x WHERE x.return_item_id = return_items.id)
WHERE id IN (SELECT x.return_item_id FROM sale_cost_repair_0200_return_items x WHERE x.old_cost_price_usd IS return_items.cost_price_usd);

-- assert: every rewritten sale line holds its new cost
INSERT INTO branches(name) SELECT NULL WHERE EXISTS (SELECT 1 FROM sale_cost_repair_0200 r JOIN sale_items si ON si.id = r.sale_item_id
  WHERE si.cost_price_usd IS NOT r.new_cost_price_usd);

-- assert: every rewritten return line holds its new cost
INSERT INTO branches(name) SELECT NULL WHERE EXISTS (SELECT 1 FROM sale_cost_repair_0200_return_items x JOIN return_items ri ON ri.id = x.return_item_id
  WHERE ri.cost_price_usd IS NOT x.new_cost_price_usd);

-- assert: every rewritten-bucket plan row has its backup
INSERT INTO branches(name) SELECT NULL WHERE EXISTS (SELECT 1 FROM sale_cost_repair_0200_plan p
  WHERE (p.kind = 'sale' AND p.bucket IN ('repair', 'window') AND p.item_id NOT IN (SELECT sale_item_id FROM sale_cost_repair_0200))
     OR (p.kind = 'return' AND p.bucket IN ('returns_sale_linked', 'returns_walk_in') AND p.item_id NOT IN (SELECT return_item_id FROM sale_cost_repair_0200_return_items)));

-- assert: every backup moves a cost to a different positive figure, and only in a rewritten bucket
INSERT INTO branches(name) SELECT NULL WHERE EXISTS (SELECT 1 FROM sale_cost_repair_0200
  WHERE NOT (new_cost_price_usd > 0) OR ABS(new_cost_price_usd - old_cost_price_usd) < 0.00005 OR bucket NOT IN ('repair', 'window'))
  OR EXISTS (SELECT 1 FROM sale_cost_repair_0200_return_items
  WHERE NOT (new_cost_price_usd > 0) OR ABS(new_cost_price_usd - old_cost_price_usd) < 0.00005 OR bucket NOT IN ('returns_sale_linked', 'returns_walk_in'));
