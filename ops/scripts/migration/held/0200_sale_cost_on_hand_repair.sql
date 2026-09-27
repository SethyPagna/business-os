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
-- The file enforces both: its first statement aborts the whole migration
-- when catalog_cost_repair_0195_backup is missing ("no such table"), or --
-- on a database holding any sale or return -- empty or younger than 2 hours;
-- nothing is written. A database with no sale and no return (a fresh one
-- applying the whole chain at once) has nothing to repair and passes.
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
--         served longer than the window; stop and report -- the file
--         refuses to apply while any exists);
--         'already_correct' (came from the buggy average, which equalled
--         the on-hand cost) and 'unaffected' (every other line in scope)
--         are informational;
--         'unbucketed' -> lines in scope the plan failed to place: must be 0
--         (the file refuses to apply otherwise).
--
-- C. Every listed line (row-level: for the encrypted ops export only, never
--    a public log; its per-bucket counts equal B for every bucket but
--    'unaffected', which it leaves out):
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
-- nothing lost/corrupted, everything recoverable". This is a bug repair.
-- Besides its own three tables it UPDATEs ONLY sale_items.cost_price_usd and
-- return_items.cost_price_usd. Those UPDATEs fire the existing revision
-- triggers, which is intended and the only other write: every rewritten
-- sale line bumps sale_write_revisions for its sale
-- (sale_revision_sale_items_update, 0120); every rewritten return line bumps
-- return_write_revisions for its return (return_revision_items_update, 0125)
-- and, for a sale-linked return, sale_write_revisions for that sale
-- (sale_revision_return_items_update, 0120). Open sale and return editors
-- therefore see a new revision and reload rather than save over the repair.
-- The recovery statements bump them again the same way.
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
-- A line snapshots the STORED catalog figure (products.cost_price_usd), and
-- before 0195 only these writers set it ("setters"): a receipt (a
-- batch-stamped 'add'/'stock_in' movement), a lot edit (audit_logs
-- 'batch_update'; it re-derives only since ee46a74e, 2026-09-19, which is why
-- every edit is only a CANDIDATE moment), a manual cost entry
-- (product_cost_entries) -- each wrote the buggy average over the lot state
-- at that moment -- and an app merge, which wrote the keeper the merge
-- scalar (resolveMergedCostDetail over the keeper's and the duplicate's
-- stored costs, or the reviewer's chosen cost). A lot deactivation (DELETE
-- /batches), a receipt revert that retires its lot, a transfer's new lot and
-- a merge changed the lot set WITHOUT re-deriving, so the stored figure --
-- and every line snapshotting it -- stayed on a stale average.
-- A line is a candidate only when its recorded cost is positive and EQUALS
-- one of these producers (any variant, either rounding):
--   'buggy_average'        the buggy average over the lot state at the
--                          line's own time;
--   'stale_buggy_average'  the buggy average over the lot state at a setter
--                          moment of its product in [since, line time];
--   'stale_merge_cost'     the merge scalar of an app merge INTO its product
--                          in [since, line time] (keeperPricingBefore and the
--                          duplicate's frozen cost, or keeperChoice's cost);
-- where since = era_start for a line before fix_at, and fix_at for a line in
-- the deploy window (0195 re-derived every active product at fix_at, so only
-- an old-Worker setter after it can have written a buggy figure again).
-- Every lot state is RECONSTRUCTED for its moment:
--   - owner: a lot, a sale/return line or a manual cost entry re-pointed by a
--     product merge after the line (undo_snapshots 'product.merge',
--     'product.merge.bulk', 'product.merge.group.child', not 'reversed':
--     repointedBatches, reparentedSaleItemIds, reparentedByTable) is read on
--     the product it belonged to at the line;
--   - unit cost: the latest lot cost edit recorded at or before the line
--     (audit_logs 'batch_update' carrying unit_cost_usd); a lot edited only
--     after the line, or touched after it with a cost that no longer matches
--     its first receipt movement, is read at that receipt cost;
--   - active: a lot inactive now but last updated after the moment (a merge
--     fold or write-off, a deactivation) was active at it.
-- The match is the proof the figure came from the buggy era's producers, not
-- a legacy import or a hand-typed cost -- and it is what keeps a line
-- written correctly after the fix (window included) from ever being touched:
-- a correct figure that also equals a buggy figure is 'already_correct' and
-- is not written.
-- Scope: every sale line (product set, cost > 0) of a sale created in
-- [era_start, era_end), wherever its movement falls; every line added to an
-- older sale by a movement from era_start; every walk-in customer return
-- line in the era; and every customer return line (product set, cost > 0)
-- of a sale with a line in the plan. Each is placed in exactly one bucket
-- (the plan's primary key is (kind, item_id)); a line the plan fails to
-- place is written as 'unbucketed' and the file aborts before any UPDATE.
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
--                           'recorded_cost_unexplained' (in scope, matches no
--                           producer, differs from the on-hand cost, and its
--                           product had a setter or merge in [since, line
--                           time] -- or it is a deploy-window line);
--                           'no_matching_sale_line' (a sale-linked return
--                           line whose sale has no line it could copy);
--                           and return lines following a sale line not
--                           rewritten ('follows_unrepaired_sale_line',
--                           'sale_lines_of_product_now_differ');
--   'after_window'       -- matches after era_end: a deploy-lag tell; the file
--                           aborts while any exists;
--   'already_correct'    -- matched a producer, which equalled the on-hand cost;
--   'unaffected'         -- everything else in scope: 'recorded_equals_on_hand',
--                           'no_lot_cost_at_line', 'catalog_cost_set_before_era'
--                           (no setter or merge of its product in the era
--                           before the line: the figure is not the bug's),
--                           'return_cost_not_copied_from_sale', 'follows_sale_line',
--                           'after_deploy_window' (a later line of an era sale);
--   'unbucketed'         -- a line in scope the plan failed to place; the file
--                           aborts while any exists.
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
--   - A walk-in return is timed at returns.created_at and positioned at the
--     'return' movement of the same product written closest to it, within
--     60 seconds either side; a line with none (stock action 'none' or
--     'damaged' writes no 'return' movement) at the first movement at or
--     after its time. The product and both time bounds are required:
--     'return' is also written by a cancelled sale with a SALE id in
--     reference_id (lib/movementReference.ts), so a return id alone can name
--     an older -- or, for a line with no restock, a later -- cancellation's
--     restock. A later edit of it is not re-timed.
--   - Lot edits before ee46a74e did not re-derive the stored figure; every
--     edit is therefore a candidate setter moment, never a required one. A
--     match against a moment that did not in fact set the figure would need
--     the recorded cost to coincide with a buggy average of that product.
--   - After fix_at the 0195 triggers keep the stored figure current except
--     on a lot UPDATE: DELETE /batches and a receipt revert that retired a
--     lot with nothing on hand left the fallback on the retired lot's cost
--     until the next stock write (fixed in app code with U-cost3). Such a
--     line after the window is not detectable here (it matches no buggy
--     producer) and is not in scope.
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
-- Each "INSERT INTO branches(name) SELECT NULL WHERE <violation>" statement
-- aborts the whole migration (branches.name is NOT NULL); D1 rolls back
-- everything, the plan included. Before any write: 0195 not applied, or its
-- deploy window not yet over while sales or returns exist (the first
-- statement). After the plan, before
-- any backup or UPDATE: an 'after_window' line, or an 'unbucketed' line.
-- After the writes: a backed-up line still holds its OLD cost (a line
-- changed since its backup -- e.g. after a recovery -- is left alone, not an
-- abort); a rewritten-bucket plan row has no backup; a backup's new cost is
-- not positive or equals the old; or a backup names a line outside the
-- rewritten buckets.
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
--   and returns_walk_in all 0 lines (a rewritten line now holds the on-hand
--   cost: it moves to 'unaffected', or to 'already_correct' when a setter
--   moment's buggy figure also equals that cost, so those two buckets
--   together grow by exactly R + W + RL + RW); the review buckets unchanged;
--   after_window and unbucketed 0.
--
-- ============================== RECOVERY =================================
-- Owner-approved only. Puts back the pre-0200 cost of every line that still
-- holds the figure 0200 wrote (a line changed since is left alone and shows
-- in the preview). Preview:
--   SELECT (SELECT COUNT(*) FROM sale_items si JOIN sale_cost_repair_0200 r ON r.sale_item_id = si.id WHERE si.cost_price_usd IS NOT r.new_cost_price_usd)
--     + (SELECT COUNT(*) FROM return_items ri JOIN sale_cost_repair_0200_return_items x ON x.return_item_id = ri.id WHERE ri.cost_price_usd IS NOT x.new_cost_price_usd);
-- Statements:
--   UPDATE sale_items SET cost_price_usd = (SELECT r.old_cost_price_usd FROM sale_cost_repair_0200 r WHERE r.sale_item_id = sale_items.id)
--     WHERE id IN (SELECT sale_item_id FROM sale_cost_repair_0200)
--       AND EXISTS (SELECT 1 FROM sale_cost_repair_0200 r WHERE r.sale_item_id = sale_items.id AND r.new_cost_price_usd IS sale_items.cost_price_usd);
--   UPDATE return_items SET cost_price_usd = (SELECT x.old_cost_price_usd FROM sale_cost_repair_0200_return_items x WHERE x.return_item_id = return_items.id)
--     WHERE id IN (SELECT return_item_id FROM sale_cost_repair_0200_return_items)
--       AND EXISTS (SELECT 1 FROM sale_cost_repair_0200_return_items x WHERE x.return_item_id = return_items.id AND x.new_cost_price_usd IS return_items.cost_price_usd);
-- The backup and plan tables are never dropped by code; they are the audit
-- trail. Their value columns are declared without a type, so each old value
-- is stored exactly as read and the recovery is byte-exact.
-- D1 applies the migration transactionally. No explicit transaction statements.
-- Re-running this file changes nothing: the tables are IF NOT EXISTS, the
-- inserts OR IGNORE, and a line is only rewritten while it still holds the
-- backed-up old figure. If the plan exceeds D1's limits the migration fails as
-- a whole and nothing is written; run the audit first to size it: statement
-- 1 (B above) evaluates this file's plan verbatim, so its duration is the
-- duration of the plan INSERT below, the one heavy statement here.
-- Every UPDATE is keyed on the backup table's primary key (id IN (...) plus a
-- correlated EXISTS on the same key), never a per-row scan of the backups.
-- Plan shape: SQLite expands a CTE again for EVERY reference to it, correlated
-- subqueries included, and MATERIALIZED does not stop that at prepare time;
-- so each heavy step below is read once by the next (a pipeline, not a
-- graph), and on-hand quantities are one window running sum over the lot
-- ledger rather than a correlated SUM per line and lot. Measured locally
-- (node:sqlite; 25,570 in-scope lines over 3,000 products, 7,565 lots and
-- 33,287 movements): prepare 0.4-0.5 s, run 17-29 s by machine load; the
-- keyed UPDATEs 1.6 s for 18,370 lines, revision triggers included.

-- guard: 0195 applied (the table exists and is filled) and its deploy window is over,
-- unless the database has no sale or return at all (a fresh one: nothing to repair)
INSERT INTO branches(name) SELECT NULL WHERE (SELECT COUNT(*) = 0 OR datetime('now') < datetime(MIN(datetime(created_at)), '+2 hours')
  FROM catalog_cost_repair_0195_backup) AND (EXISTS (SELECT 1 FROM sales) OR EXISTS (SELECT 1 FROM returns));

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
merge_ev AS MATERIALIZED (
  SELECT m.ord, m.at, CAST(json_extract(m.rev, '$.keeperId') AS INTEGER) AS keeper_id,
    CAST(json_extract(m.rev, '$.keeperPricingBefore.cost_price_usd') AS REAL) AS keeper_before,
    (SELECT pd.cost_price_usd FROM products pd WHERE pd.id = CAST(json_extract(m.rev, '$.dupId') AS INTEGER)) AS dup_cost,
    CAST(json_extract(m.rev, '$.keeperChoice.cost.cost_price_usd') AS REAL) AS chosen
  FROM merge_rev m
),
merge_b AS MATERIALIZED (
  SELECT v.keeper_id, v.at,
    ROUND(AVG(v.c), 4) AS b1,
    CAST(AVG(v.c) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 AS b1h,
    CASE WHEN MAX(v.c) > 2 * MIN(v.c) THEN MAX(v.c) ELSE ROUND(AVG(v.c), 4) END AS b2
  FROM (SELECT ord, keeper_id, at, keeper_before AS c FROM merge_ev UNION SELECT ord, keeper_id, at, dup_cost FROM merge_ev) v
  WHERE v.c > 0
  GROUP BY v.ord, v.keeper_id, v.at
  UNION ALL
  SELECT keeper_id, at, chosen, chosen, chosen FROM merge_ev WHERE chosen > 0
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
    sm.sale_at AS born,
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
  SELECT 'return', -ri.id, ri.id, NULL, r.id, ri.product_id, ri.quantity, ri.cost_price_usd, datetime(r.created_at), datetime(r.created_at),
    COALESCE((SELECT m.id FROM (SELECT im.id, ABS(julianday(im.created_at) - julianday(r.created_at)) AS gap FROM inventory_movements im
          WHERE im.reference_id = r.id AND im.movement_type = 'return' AND im.product_id = ri.product_id
            AND datetime(im.created_at) BETWEEN datetime(r.created_at, '-60 seconds') AND datetime(r.created_at, '+60 seconds')) m
        ORDER BY m.gap, m.id LIMIT 1),
      (SELECT MIN(im.id) FROM inventory_movements im WHERE im.created_at >= datetime(r.created_at)),
      (SELECT COALESCE(MAX(im.id), 0) + 1 FROM inventory_movements im))
  FROM return_items ri JOIN returns r ON r.id = ri.return_id
  WHERE r.sale_id IS NULL AND COALESCE(r.return_scope, 'customer') = 'customer' AND ri.sale_item_id IS NULL
    AND ri.product_id IS NOT NULL AND ri.cost_price_usd > 0 AND datetime(r.created_at) >= '2026-09-16 14:04:42'
),
item_ctx AS MATERIALIZED (
  SELECT x.*,
    CASE WHEN x.lot_owner <> COALESCE(x.moved_dup, x.product_now) THEN x.lot_owner ELSE COALESCE(x.moved_dup, x.product_now) END AS prod_at,
    x.moved_dup IS NOT NULL AS moved, COALESCE(x.lot_owner <> COALESCE(x.moved_dup, x.product_now), 0) AS orphan,
    CASE WHEN x.t >= x.fix_at THEN x.fix_at ELSE '2026-09-16 14:04:42' END AS since
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
    WHERE (it.t >= '2026-09-16 14:04:42' OR it.born >= '2026-09-16 14:04:42')
      AND (it.t < p.scan_end OR it.born < p.era_end)) x
),
lot_touch AS MATERIALIZED (
  SELECT im.batch_id AS lot_id, datetime(im.created_at) AS at
    FROM inventory_movements im
   WHERE im.movement_type IN ('add', 'stock_in') AND im.quantity > 0 AND im.batch_id IS NOT NULL
     AND im.created_at >= '2026-09-16 14:04:42'
  UNION
  SELECT CAST(a.entity_id AS INTEGER), datetime(a.created_at)
    FROM audit_logs a
   WHERE a.action = 'batch_update' AND a.entity = 'product_batch' AND datetime(a.created_at) >= '2026-09-16 14:04:42'
     AND (json_type(CASE WHEN json_valid(a.details) THEN a.details END, '$.unit_cost_usd') IS NOT NULL
       OR json_type(CASE WHEN json_valid(a.details) THEN a.details END, '$.is_active') IS NOT NULL)
),
setter AS MATERIALIZED (
  SELECT DISTINCT o.p, o.at FROM (
    SELECT COALESCE((SELECT rm.dup_id FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = lt.lot_id AND rm.at > lt.at
        ORDER BY rm.ord LIMIT 1), pb.variant_product_id) AS p, lt.at
      FROM lot_touch lt JOIN product_batches pb ON pb.id = lt.lot_id
    UNION
    SELECT COALESCE((SELECT rm.dup_id FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.row_id = pce.id
        AND rm.at > datetime(pce.created_at) ORDER BY rm.ord LIMIT 1), pce.product_id), datetime(pce.created_at)
      FROM product_cost_entries pce WHERE datetime(pce.created_at) >= '2026-09-16 14:04:42') o
  WHERE o.p IN (SELECT prod_at FROM item_ctx) AND o.at IS NOT NULL
),
anchor AS MATERIALIZED (
  SELECT ic.ik AS ak, ic.prod_at AS p, ic.t AS at, ic.kind, ic.item_id, ic.sale_id, ic.return_id, ic.product_now, ic.quantity,
    ic.recorded, ic.born, ic.t, ic.pos, ic.fix_at, ic.era_end, ic.moved, ic.orphan, ic.since
  FROM item_ctx ic
  UNION ALL
  SELECT 1000000000000 + ROW_NUMBER() OVER (ORDER BY s.p, s.at), s.p, s.at, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  FROM setter s
),
anchor_me AS MATERIALIZED (
  SELECT x.*, pce.id IS NOT NULL AS has_me, pce.cost_usd AS me_cost, COALESCE(pce.baseline_batch_id, 0) AS me_baseline,
    nm.id IS NOT NULL AS now_has_me, nm.cost_usd AS now_me_cost, COALESCE(nm.baseline_batch_id, 0) AS now_me_baseline
  FROM (SELECT a.*,
      (SELECT pc.id FROM product_cost_entries pc
        WHERE (pc.product_id = a.p OR pc.id IN (SELECT rm.row_id FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.dup_id = a.p))
          AND datetime(pc.created_at) <= a.at
          AND COALESCE((SELECT rm.dup_id FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.row_id = pc.id AND rm.at > a.at
            ORDER BY rm.ord LIMIT 1), pc.product_id) = a.p
        ORDER BY pc.id DESC LIMIT 1) AS me_id,
      (SELECT pc.id FROM product_cost_entries pc WHERE pc.product_id = a.product_now AND datetime(pc.created_at) <= a.t
        ORDER BY pc.id DESC LIMIT 1) AS now_me_id,
      EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.dup_id = a.p AND rm.at > a.t) AS me_moved
    FROM anchor a) x
  LEFT JOIN product_cost_entries pce ON pce.id = x.me_id
  LEFT JOIN product_cost_entries nm ON nm.id = x.now_me_id
),
cand_lots AS MATERIALIZED (
  SELECT pb.id AS lot_id FROM product_batches pb WHERE pb.variant_product_id IN (SELECT prod_at FROM item_ctx)
  UNION
  SELECT rm.row_id FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.dup_id IN (SELECT prod_at FROM item_ctx)
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
lot_base AS MATERIALIZED (
  SELECT pb.id AS lot_id, pb.is_active, pb.unit_cost_usd AS cost_now, datetime(pb.updated_at) AS updated_at,
    datetime(COALESCE(pb.created_at, pb.received_at)) AS created, COALESCE(pb.received_at, '') AS received_at,
    (SELECT im.unit_cost_usd FROM inventory_movements im
      WHERE im.batch_id = pb.id AND im.quantity > 0 AND im.unit_cost_usd > 0 ORDER BY im.id LIMIT 1) AS receipt_cost,
    (SELECT MAX(le.at) FROM lot_edit le WHERE le.lot_id = pb.id) AS last_edit_at,
    CASE WHEN b.lot_id IS NOT NULL
      OR (NOT EXISTS (SELECT 1 FROM inventory_movements im WHERE im.batch_id = pb.id)
        AND (COALESCE(pb.received_quantity, 0) > 0 OR COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id), 0) <> 0))
    THEN 1 ELSE 0 END AS bad
  FROM product_batches pb
  LEFT JOIN (
    SELECT DISTINCT w.lot_id FROM (
      SELECT e.lot_id, SUM(e.qty) OVER (PARTITION BY e.lot_id ORDER BY e.pos, e.qty DESC ROWS UNBOUNDED PRECEDING) AS running,
        SUM(e.qty) OVER (PARTITION BY e.lot_id) AS total
      FROM ev e) w
    WHERE w.running < 0
       OR w.total <> COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = w.lot_id), 0)) b ON b.lot_id = pb.id
  WHERE pb.id IN (SELECT lot_id FROM cand_lots)
),
lot_x AS MATERIALIZED (
  SELECT am.*, lb.lot_id, lb.created, lb.received_at, lb.bad,
    CASE WHEN lb.is_active = 1 OR lb.updated_at > am.at THEN 1 ELSE 0 END AS active_t,
    COALESCE(
      (SELECT le.cost FROM lot_edit le WHERE le.lot_id = lb.lot_id AND le.at <= am.at ORDER BY le.id DESC LIMIT 1),
      CASE WHEN lb.last_edit_at > am.at THEN COALESCE(lb.receipt_cost, lb.cost_now)
           WHEN lb.updated_at > am.at AND lb.receipt_cost IS NOT NULL AND ABS(lb.receipt_cost - COALESCE(lb.cost_now, 0)) >= 0.00005
             THEN lb.receipt_cost END,
      lb.cost_now) AS cost_t,
    CASE WHEN (COALESCE(lb.is_active, 0) <> 1 AND lb.updated_at > am.at)
      OR lb.last_edit_at > am.at
      OR (lb.updated_at > am.at AND lb.receipt_cost IS NOT NULL AND ABS(lb.receipt_cost - COALESCE(lb.cost_now, 0)) >= 0.00005)
      OR EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = lb.lot_id AND rm.at > am.at)
    THEN 1 ELSE 0 END AS changed
  FROM anchor_me am
  LEFT JOIN (
    SELECT pb.id AS lot_id, pb.variant_product_id AS key_p, pb.variant_product_id AS cur_p FROM product_batches pb
    UNION
    SELECT rm.row_id, rm.dup_id, pb.variant_product_id
      FROM row_move rm JOIN product_batches pb ON pb.id = rm.row_id WHERE rm.tbl = 'product_batches') lk
    ON lk.key_p = am.p
   AND COALESCE((SELECT rm.dup_id FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = lk.lot_id AND rm.at > am.at
         ORDER BY rm.ord LIMIT 1), lk.cur_p) = am.p
  LEFT JOIN lot_base lb ON lb.lot_id = lk.lot_id
),
lot_q AS MATERIALIZED (
  SELECT w.ak, w.lot_id, w.q FROM (
    SELECT u.ak, u.lot_id, u.is_ev,
      SUM(u.qty) OVER (PARTITION BY u.lot_id ORDER BY u.pos, u.is_ev ROWS UNBOUNDED PRECEDING) AS q
    FROM (SELECT lx.ak, lx.lot_id, lx.pos, 0 AS is_ev, 0 AS qty FROM lot_x lx
           WHERE lx.lot_id IS NOT NULL AND lx.active_t = 1 AND lx.ak < 1000000000000
          UNION ALL
          SELECT NULL, e.lot_id, e.pos, 1, e.qty FROM ev e) u) w
  WHERE w.is_ev = 0
),
lot_rows AS MATERIALIZED (
  SELECT y.*, ROW_NUMBER() OVER (PARTITION BY y.ak, y.eligible ORDER BY y.received_at DESC, y.lot_id DESC) AS fb_rank
  FROM (
    SELECT lx.*,
      CASE WHEN lx.lot_id IS NOT NULL AND lx.active_t = 1 AND lx.cost_t > 0 AND lx.created <= lx.at AND (lx.has_me = 0 OR lx.lot_id > lx.me_baseline)
        THEN 1 ELSE 0 END AS eligible,
      lq.q
    FROM lot_x lx LEFT JOIN lot_q lq ON lq.ak = lx.ak AND lq.lot_id = lx.lot_id) y
),
ak_agg AS MATERIALIZED (
  SELECT r.ak, r.p, r.at, r.kind, r.item_id, r.sale_id, r.return_id, r.product_now, r.quantity, r.recorded, r.born, r.t, r.pos,
    r.fix_at, r.era_end, r.moved, r.orphan, r.since, r.me_moved, r.now_has_me, r.now_me_cost, r.now_me_baseline,
    ROUND(AVG(DISTINCT r.hc), 4) AS b1,
    CAST(AVG(DISTINCT r.hc) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 AS b1h,
    CASE WHEN MAX(r.hc) > 2 * MIN(r.hc) THEN MAX(r.hc) ELSE ROUND(AVG(DISTINCT r.hc), 4) END AS b2,
    CASE WHEN SUM(r.wq) > 0 THEN CAST(SUM(r.wq * r.wc) / SUM(r.wq) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END AS w,
    SUM(r.wq) AS on_hand_units,
    MAX(CASE WHEN r.u = 0 AND r.active_t = 1 AND r.created <= r.at AND r.bad = 1 THEN 1 ELSE 0 END) AS unverified,
    MAX(CASE WHEN r.u = 0 AND r.changed = 1 AND r.created <= r.at THEN 1 ELSE 0 END) AS lot_changed,
    MAX(CASE WHEN r.u = 0 AND r.fb_rank = 1 AND r.eligible = 1 THEN r.cost_t END) AS fallback
  FROM (
    SELECT lr.*, u.k AS u,
      CASE WHEN u.k = 0 THEN CASE WHEN lr.eligible = 1 THEN lr.cost_t END
           ELSE CASE WHEN lr.has_me = 1 AND lr.me_cost > 0 THEN lr.me_cost END END AS hc,
      CASE WHEN lr.has_me = 1 AND lr.lot_id <= lr.me_baseline THEN lr.me_cost ELSE lr.cost_t END AS wc,
      CASE WHEN u.k = 0 AND lr.q > 0 AND (CASE WHEN lr.has_me = 1 AND lr.lot_id <= lr.me_baseline THEN lr.me_cost ELSE lr.cost_t END) > 0
        THEN lr.q END AS wq
    FROM lot_rows lr CROSS JOIN (SELECT 0 AS k UNION ALL SELECT 1) u) r
  GROUP BY r.ak
),
item_match AS MATERIALIZED (
  SELECT g.*,
    CASE WHEN ABS(g.recorded - g.b1) < 0.00006 OR ABS(g.recorded - g.b1h) < 0.00006 OR ABS(g.recorded - g.b2) < 0.00006 THEN 1 ELSE 0 END AS h_match,
    CASE WHEN EXISTS (SELECT 1 FROM merge_b mb WHERE mb.keeper_id = g.p AND mb.at >= g.since AND mb.at <= g.t
      AND (ABS(g.recorded - mb.b1) < 0.00006 OR ABS(g.recorded - mb.b1h) < 0.00006 OR ABS(g.recorded - mb.b2) < 0.00006)) THEN 1 ELSE 0 END AS m_match,
    CASE WHEN g.s_any = 1 OR EXISTS (SELECT 1 FROM merge_ev me WHERE me.keeper_id = g.p AND me.at >= g.since AND me.at <= g.t)
      THEN 1 ELSE 0 END AS has_setter,
    COALESCE((SELECT CASE WHEN ABS(g.recorded - ROUND(AVG(n.c), 4)) < 0.00006
          OR ABS(g.recorded - CAST(AVG(n.c) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0) < 0.00006
          OR ABS(g.recorded - CASE WHEN MAX(n.c) > 2 * MIN(n.c) THEN MAX(n.c) ELSE ROUND(AVG(n.c), 4) END) < 0.00006 THEN 1 ELSE 0 END
        FROM (SELECT pb.unit_cost_usd AS c FROM product_batches pb
               WHERE pb.variant_product_id = g.product_now AND pb.is_active = 1 AND pb.unit_cost_usd > 0
                 AND datetime(COALESCE(pb.created_at, pb.received_at)) <= g.t
                 AND (g.now_has_me = 0 OR pb.id > g.now_me_baseline)
              UNION
              SELECT g.now_me_cost WHERE g.now_has_me = 1 AND g.now_me_cost > 0) n), 0) AS n_match
  FROM (
    SELECT i.*,
      MAX(CASE WHEN ABS(i.recorded - s.b1) < 0.00006 OR ABS(i.recorded - s.b1h) < 0.00006 OR ABS(i.recorded - s.b2) < 0.00006
        THEN 1 ELSE 0 END) AS s_match,
      MAX(CASE WHEN s.ak IS NOT NULL THEN 1 ELSE 0 END) AS s_any
    FROM ak_agg i LEFT JOIN ak_agg s ON s.ak >= 1000000000000 AND s.p = i.p AND s.at >= i.since AND s.at <= i.t
    WHERE i.ak < 1000000000000
    GROUP BY i.ak) g
),
classified_items AS MATERIALIZED (
  SELECT g.*,
    CASE
      WHEN g.t >= g.era_end THEN CASE WHEN g.matched = 1 AND g.differs = 1 THEN 'after_window'
        WHEN g.born < g.era_end THEN 'unaffected' END
      WHEN g.orphan = 1 AND g.differs = 1 THEN 'needs_owner_review'
      WHEN g.matched = 1 AND g.correct IS NULL THEN 'needs_owner_review'
      WHEN g.matched = 1 AND g.unverified = 1 THEN 'ledger_unverified'
      WHEN g.matched = 1 AND g.differs = 0 THEN 'already_correct'
      WHEN g.matched = 1 AND g.kind = 'return' THEN 'returns_walk_in'
      WHEN g.matched = 1 AND g.t >= g.fix_at THEN 'window'
      WHEN g.matched = 1 THEN 'repair'
      WHEN g.differs = 0 THEN 'unaffected'
      WHEN g.n_match = 1 OR g.uncertain = 1 THEN 'needs_owner_review'
      WHEN g.t < g.fix_at AND g.has_setter = 0 THEN 'unaffected'
      ELSE 'needs_owner_review'
    END AS bucket,
    CASE
      WHEN g.t >= g.era_end THEN CASE WHEN g.matched = 1 AND g.differs = 1 THEN 'buggy_average_after_deploy_window' ELSE 'after_deploy_window' END
      WHEN g.orphan = 1 AND g.differs = 1 THEN 'sold_lot_belongs_to_another_product'
      WHEN g.matched = 1 AND g.correct IS NULL THEN 'no_derivable_cost'
      WHEN g.matched = 1 AND g.unverified = 1 THEN 'lot_ledger_does_not_reconcile'
      WHEN g.matched = 1 AND g.differs = 0 THEN 'buggy_average_equalled_on_hand'
      WHEN g.matched = 1 AND g.kind = 'sale' AND g.t >= g.fix_at THEN g.producer || '_deploy_window'
      WHEN g.matched = 1 THEN g.producer
      WHEN g.differs = 0 THEN CASE WHEN g.correct IS NULL THEN 'no_lot_cost_at_line' ELSE 'recorded_equals_on_hand' END
      WHEN g.n_match = 1 THEN 'matches_only_todays_lot_state'
      WHEN g.uncertain = 1 THEN 'lot_history_changed_after_sale'
      WHEN g.t < g.fix_at AND g.has_setter = 0 THEN 'catalog_cost_set_before_era'
      ELSE 'recorded_cost_unexplained'
    END AS reason
  FROM (
    SELECT f.*, CASE WHEN f.correct IS NULL OR ABS(f.recorded - f.correct) < 0.00005 THEN 0 ELSE 1 END AS differs,
      CASE WHEN f.h_match = 1 OR f.s_match = 1 OR f.m_match = 1 THEN 1 ELSE 0 END AS matched,
      CASE WHEN f.h_match = 1 THEN 'buggy_average' WHEN f.s_match = 1 THEN 'stale_buggy_average' ELSE 'stale_merge_cost' END AS producer
    FROM (
      SELECT m.kind, m.item_id, m.sale_id, m.return_id, m.product_now AS product_id, m.quantity, m.recorded, m.t, m.born, m.pos,
        m.fix_at, m.era_end, COALESCE(m.w, m.fallback) AS correct, COALESCE(m.on_hand_units, 0) AS on_hand_units,
        m.h_match, m.s_match, m.m_match, m.n_match, m.has_setter, m.b1 AS buggy_mean_usd,
        COALESCE(m.unverified, 0) AS unverified, m.orphan,
        CASE WHEN m.moved = 1 OR m.me_moved = 1 OR COALESCE(m.lot_changed, 0) = 1 THEN 1 ELSE 0 END AS uncertain
      FROM item_match m) f) g
),
linked AS MATERIALIZED (
  SELECT y.return_item_id, y.return_id, y.sale_id, y.product_id, y.quantity, y.recorded, y.t, y.by_product, y.n_lines, y.n_unequal,
    SUM(CASE WHEN y.hit = 1 AND y.bucket IN ('repair', 'window') THEN 1 ELSE 0 END) AS n_repaired,
    SUM(CASE WHEN y.hit = 1 AND y.bucket IN ('ledger_unverified', 'needs_owner_review', 'after_window') THEN 1 ELSE 0 END) AS n_review,
    MIN(CASE WHEN y.hit = 1 THEN y.correct END) AS min_correct,
    MAX(CASE WHEN y.hit = 1 THEN y.correct END) AS max_correct,
    MAX(CASE WHEN y.item_id = y.first_line_id THEN y.correct END) AS first_correct,
    MAX(CASE WHEN y.hit = 1 THEN y.buggy_mean_usd END) AS buggy_mean_usd
  FROM (
    SELECT rl.*, c.item_id, c.bucket, c.correct, c.buggy_mean_usd,
      CASE WHEN c.item_id = rl.sale_item_id OR (rl.sale_item_id IS NULL AND sc.product_id = rl.product_id
        AND (rl.branch_id IS NULL OR sc.branch_id IS NULL OR sc.branch_id = rl.branch_id)) THEN 1 ELSE 0 END AS hit
    FROM (
      SELECT z.*,
        (SELECT COUNT(*) FROM sale_items sc WHERE sc.sale_id = z.sale_id AND (sc.id = z.sale_item_id OR (z.sale_item_id IS NULL
          AND sc.product_id = z.product_id AND (z.branch_id IS NULL OR sc.branch_id IS NULL OR sc.branch_id = z.branch_id)))) AS n_lines,
        (SELECT COALESCE(SUM(CASE WHEN ABS(sc.cost_price_usd - z.recorded) < 0.00006 THEN 0 ELSE 1 END), 0) FROM sale_items sc
          WHERE sc.sale_id = z.sale_id AND (sc.id = z.sale_item_id OR (z.sale_item_id IS NULL
          AND sc.product_id = z.product_id AND (z.branch_id IS NULL OR sc.branch_id IS NULL OR sc.branch_id = z.branch_id)))) AS n_unequal,
        (SELECT MIN(sc.id) FROM sale_items sc WHERE sc.sale_id = z.sale_id AND (sc.id = z.sale_item_id OR (z.sale_item_id IS NULL
          AND sc.product_id = z.product_id AND (z.branch_id IS NULL OR sc.branch_id IS NULL OR sc.branch_id = z.branch_id)))) AS first_line_id
      FROM (
        SELECT ri.id AS return_item_id, r.id AS return_id, r.sale_id, ri.product_id, ri.quantity, ri.cost_price_usd AS recorded,
          datetime(r.created_at) AS t, ri.sale_item_id IS NULL AS by_product, ri.sale_item_id, ri.branch_id
        FROM returns r JOIN return_items ri ON ri.return_id = r.id
        WHERE r.sale_id IS NOT NULL AND COALESCE(r.return_scope, 'customer') = 'customer'
          AND ri.product_id IS NOT NULL AND ri.cost_price_usd > 0) z) rl
    JOIN classified_items c ON c.kind = 'sale' AND c.sale_id = rl.sale_id
    JOIN sale_items sc ON sc.id = c.item_id) y
  GROUP BY y.return_item_id
  HAVING MAX(CASE WHEN y.bucket IS NOT NULL THEN 1 ELSE 0 END) = 1
),
scope AS MATERIALIZED (
  SELECT 'sale' AS kind, si.id AS item_id, si.sale_id, NULL AS return_id, si.product_id, si.quantity, si.cost_price_usd AS recorded,
    datetime(s.created_at) AS t
  FROM sales s JOIN sale_items si ON si.sale_id = s.id JOIN params p
  WHERE si.product_id IS NOT NULL AND si.cost_price_usd > 0
    AND datetime(s.created_at) >= '2026-09-16 14:04:42' AND datetime(s.created_at) < p.era_end
  UNION ALL
  SELECT 'return', ri.id, r.sale_id, r.id, ri.product_id, ri.quantity, ri.cost_price_usd, datetime(r.created_at)
  FROM returns r JOIN return_items ri ON ri.return_id = r.id JOIN params p
  WHERE COALESCE(r.return_scope, 'customer') = 'customer' AND ri.product_id IS NOT NULL AND ri.cost_price_usd > 0
    AND r.sale_id IS NULL AND ri.sale_item_id IS NULL
    AND datetime(r.created_at) >= '2026-09-16 14:04:42' AND datetime(r.created_at) < p.era_end
),
classified AS MATERIALIZED (
  SELECT v.kind, v.item_id, v.sale_id, v.return_id, v.product_id, v.quantity, v.recorded, v.correct, v.buggy_mean_usd, v.pos,
    v.on_hand_units, v.t, v.bucket, v.reason
  FROM (
    SELECT u.*, MAX(u.src) OVER (PARTITION BY u.kind, u.item_id) AS covered
    FROM (
      SELECT c.kind, c.item_id, c.sale_id, c.return_id, c.product_id, c.quantity, c.recorded, c.correct, c.buggy_mean_usd, c.pos,
        c.on_hand_units, c.t, c.bucket, c.reason, 1 AS src
      FROM classified_items c WHERE c.bucket IS NOT NULL
      UNION ALL
      SELECT 'return', l.return_item_id, l.sale_id, l.return_id, l.product_id, l.quantity, l.recorded,
        COALESCE(l.first_correct, l.min_correct), l.buggy_mean_usd, NULL, NULL, l.t,
        CASE WHEN l.n_lines = 0 THEN 'needs_owner_review'
             WHEN l.n_unequal > 0 THEN 'unaffected'
             WHEN l.n_review > 0 THEN 'needs_owner_review'
             WHEN l.n_repaired = l.n_lines AND l.min_correct = l.max_correct THEN 'returns_sale_linked'
             WHEN l.n_repaired > 0 THEN 'needs_owner_review'
             ELSE 'unaffected' END,
        CASE WHEN l.n_lines = 0 THEN 'no_matching_sale_line'
             WHEN l.n_unequal > 0 THEN 'return_cost_not_copied_from_sale'
             WHEN l.n_review > 0 THEN 'follows_unrepaired_sale_line'
             WHEN l.n_repaired = l.n_lines AND l.min_correct = l.max_correct
               THEN CASE WHEN l.by_product = 1 THEN 'copied_from_sale_line_by_product' ELSE 'copied_from_sale_line' END
             WHEN l.n_repaired > 0 THEN 'sale_lines_of_product_now_differ'
             ELSE 'follows_sale_line' END,
        1
      FROM linked l
      UNION ALL
      SELECT s.kind, s.item_id, s.sale_id, s.return_id, s.product_id, s.quantity, s.recorded, NULL, NULL, NULL, NULL, s.t,
        'unbucketed', 'in_scope_line_not_classified', 0
      FROM scope s) u) v
  WHERE v.src = 1 OR v.covered = 0
)
-- plan:stop
SELECT kind, item_id, sale_id, return_id, product_id, quantity, recorded, correct, buggy_mean_usd, pos, on_hand_units, t, bucket, reason
FROM classified;

-- assert: no in-scope line left unbucketed
INSERT INTO branches(name) SELECT NULL WHERE EXISTS (SELECT 1 FROM sale_cost_repair_0200_plan WHERE bucket = 'unbucketed');

-- assert: no line after the deploy window still carries a buggy figure (the old Worker served longer than the window)
INSERT INTO branches(name) SELECT NULL WHERE EXISTS (SELECT 1 FROM sale_cost_repair_0200_plan WHERE bucket = 'after_window');

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
WHERE id IN (SELECT sale_item_id FROM sale_cost_repair_0200)
  AND EXISTS (SELECT 1 FROM sale_cost_repair_0200 r WHERE r.sale_item_id = sale_items.id AND r.old_cost_price_usd IS sale_items.cost_price_usd);

UPDATE return_items SET cost_price_usd = (SELECT x.new_cost_price_usd FROM sale_cost_repair_0200_return_items x WHERE x.return_item_id = return_items.id)
WHERE id IN (SELECT return_item_id FROM sale_cost_repair_0200_return_items)
  AND EXISTS (SELECT 1 FROM sale_cost_repair_0200_return_items x WHERE x.return_item_id = return_items.id AND x.old_cost_price_usd IS return_items.cost_price_usd);

-- assert: no backed-up sale line still holds its old cost
INSERT INTO branches(name) SELECT NULL WHERE EXISTS (SELECT 1 FROM sale_cost_repair_0200 r JOIN sale_items si ON si.id = r.sale_item_id
  WHERE si.cost_price_usd IS r.old_cost_price_usd);

-- assert: no backed-up return line still holds its old cost
INSERT INTO branches(name) SELECT NULL WHERE EXISTS (SELECT 1 FROM sale_cost_repair_0200_return_items x JOIN return_items ri ON ri.id = x.return_item_id
  WHERE ri.cost_price_usd IS x.old_cost_price_usd);

-- assert: every rewritten-bucket plan row has its backup
INSERT INTO branches(name) SELECT NULL WHERE EXISTS (SELECT 1 FROM sale_cost_repair_0200_plan p
  WHERE (p.kind = 'sale' AND p.bucket IN ('repair', 'window') AND p.item_id NOT IN (SELECT sale_item_id FROM sale_cost_repair_0200))
     OR (p.kind = 'return' AND p.bucket IN ('returns_sale_linked', 'returns_walk_in') AND p.item_id NOT IN (SELECT return_item_id FROM sale_cost_repair_0200_return_items)));

-- assert: every backup moves a cost to a different positive figure, and only in a rewritten bucket
INSERT INTO branches(name) SELECT NULL WHERE EXISTS (SELECT 1 FROM sale_cost_repair_0200
  WHERE NOT (new_cost_price_usd > 0) OR ABS(new_cost_price_usd - old_cost_price_usd) < 0.00005 OR bucket NOT IN ('repair', 'window'))
  OR EXISTS (SELECT 1 FROM sale_cost_repair_0200_return_items
  WHERE NOT (new_cost_price_usd > 0) OR ABS(new_cost_price_usd - old_cost_price_usd) < 0.00005 OR bucket NOT IN ('returns_sale_linked', 'returns_walk_in'));
