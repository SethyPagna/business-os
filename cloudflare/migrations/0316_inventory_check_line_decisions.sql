-- 0316: the approver's decision on ONE line of a submitted Inventory Check count, and the set of lines each approval was created with (lane/inv-check-requests, owner ask of 17 Nov 2026).
--
-- A submitted count waits as ONE approval row (0286) that was accepted or refused as a whole. An approver can now reject or modify a single line and accept lines one by one; the
-- engine (lib/inventoryCheckApprovals.ts) keeps the one queue. Two columns are added:
--
--   line_decisions_json  what the approver decided per product, so the counter's own figures in inventory_check_items are never changed and every decision stays visible next to them:
--     { "<product id>": { "decision": "reject" | "modify", "counted"?: n, "lots"?: [{ "batchId": n, "counted": n }], "note"?: text, "by": account id, "by_name": username, "at": ISO time } }
--     A key is removed again by a reopen. A rejected line is never applied; a modified line is applied as the variance (modified - seen) on live stock, floored at 0, by the same writer as an
--     unmodified one. An approval with no line left to apply ends as approved (something was applied) or rejected (nothing was).
--   line_set_json  the LINES of the approval, fixed when it is created: { "<product id>": 1, ... }, one key per product the count found different from stock (the same rule that counts `lines`,
--     including a product whose received dates differ although their totals agree). Every reader of "does this line wait for approval" (the list, the overlay, the Fix stock and Set holds,
--     the replacement of an older count by a newer one, the engine) reads this one set instead of re-deriving the rule from the items, so they can never disagree and none of them scans the
--     session's items. NULL means "not recorded": an approval created by a Worker that does not know the column (during a deploy) keeps the earlier rule for its readers.
--
-- PRE:  inventory_check_approvals exists with its four 0286 triggers; neither column exists. A failed check reads a malformed JSON path and aborts the file.
-- POST: both columns exist (line_decisions_json NOT NULL default '{}' and a JSON-object CHECK; line_set_json nullable with a JSON-object CHECK), every existing row holds no decision ('{}'), the
--       set is recorded for no decided row, the four triggers still exist and the identity trigger now also names line_set_json (the set never changes after the approval is created).
--       Pinned by scripts/test-migration-0316-inventory-check-line-decisions-pure.cjs.
-- Backfill: PENDING approvals only get their set, computed from their items by the creation rule, and only where it agrees with `lines`; a decided row is frozen by the 0286 triggers and is never
--   a waiting line, so its set stays NULL. The backfill runs before the identity trigger is re-created, so it is not refused by it; a claimed pending row takes it like any other update.
-- Cost: SQLite tests an added CHECK against the rows already in the table (a scan of it), and the backfill reads the items of each PENDING approval by the table's primary key and writes
--       that row once. The table holds one row per submitted count that differs from stock, so this is a handful of rows; no other table is read or written. At runtime a decision writes one
--       approval row, one session row and one event row; creating an approval computes the set inside the statement that already counts the lines (no extra read or write).
-- Append-only, LF-only, rowid kept (no WITHOUT ROWID: it breaks backups and BACKUP_TABLES / the branch cutover capture read rowids), generic (no client data), no ANALYZE.
-- Rollback-safe: the previous Worker never names either column and runs unchanged on the new schema (its own INSERTs and UPDATEs leave them at '{}' / NULL; its approvals keep the earlier rule).
-- A Worker that names a column needs this migration applied first, like every column the engine reads (deploy order: migrations, then the Worker).
-- RECOVERY: nothing to restore: a decision lives in line_decisions_json only, so dropping it loses decisions on pending approvals (rejected lines would read as open again; nothing was applied
--   for them), and line_set_json is derived from the items and can be recomputed by the UPDATE of this file. Full undo (after the Worker that reads them is rolled back), in this order,
--   because a trigger that names a column blocks dropping it:
--     DROP TRIGGER IF EXISTS inventory_check_approvals_identity;
--     CREATE TRIGGER inventory_check_approvals_identity BEFORE UPDATE OF session_id,organization_id,branch_id,lines,submitted_by,submitted_at,baselines_json ON inventory_check_approvals BEGIN SELECT RAISE(ABORT,'inventory_check_approval_immutable'); END;
--     ALTER TABLE inventory_check_approvals DROP COLUMN line_set_json;
--     ALTER TABLE inventory_check_approvals DROP COLUMN line_decisions_json;
--   Partial apply (the statements of this file and the d1_migrations row are separate steps, so a crash between them is possible). First check d1_migrations for this file name:
--     SELECT id, name FROM d1_migrations WHERE name = '0316_inventory_check_line_decisions.sql';
--   and what the database holds (three facts):
--     SELECT (SELECT COUNT(*) FROM pragma_table_info('inventory_check_approvals') WHERE name = 'line_decisions_json') AS decisions_col,
--            (SELECT COUNT(*) FROM pragma_table_info('inventory_check_approvals') WHERE name = 'line_set_json') AS set_col,
--            (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'inventory_check_approvals') AS triggers,
--            (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'inventory_check_approvals_identity' AND sql LIKE '%line_set_json%') AS identity_with_set;
--   Not recorded and decisions_col = 0, set_col = 0, triggers = 4, identity_with_set = 0: nothing ran; rerun migrations apply.
--   Not recorded and anything else (a rerun would abort on PRE): bring the database back by the full undo above (skip the lines whose object is already absent; if triggers is 3 the identity trigger
--     is missing: run only its CREATE TRIGGER line), then rerun migrations apply.
--   Recorded and something is missing: run, from this file and in its order, only the statements the facts say are missing (each ALTER TABLE line; the UPDATE is safe to repeat; then, if identity_with_set
--     is 0, DROP TRIGGER IF EXISTS and CREATE TRIGGER inventory_check_approvals_identity); do not rerun the file.
--   Recorded and decisions_col = 1, set_col = 1, triggers = 4, identity_with_set = 1: nothing to do.

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'inventory_check_approvals') = 1
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'inventory_check_approvals') = 4
  AND (SELECT COUNT(*) FROM pragma_table_info('inventory_check_approvals') WHERE name IN ('line_decisions_json', 'line_set_json')) = 0
THEN 1 ELSE json_extract('[]','$[inventory_check_line_decisions_0316_pre]') END;

ALTER TABLE inventory_check_approvals ADD COLUMN line_decisions_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(line_decisions_json) AND json_type(line_decisions_json) = 'object');

ALTER TABLE inventory_check_approvals ADD COLUMN line_set_json TEXT CHECK(line_set_json IS NULL OR (json_valid(line_set_json) AND json_type(line_set_json) = 'object'));

UPDATE inventory_check_approvals SET line_set_json = (SELECT json_group_object(CAST(i.product_id AS TEXT), 1) FROM inventory_check_items i
    WHERE i.session_id = inventory_check_approvals.session_id AND i.branch_id = inventory_check_approvals.branch_id
      AND i.baseline_quantity IS NOT NULL AND (abs(i.baseline_quantity - i.counted_quantity) > 0.000000001
        OR EXISTS(SELECT 1 FROM inventory_check_lot_lines l WHERE l.session_id = i.session_id AND l.product_id = i.product_id AND abs(l.seen_quantity - l.counted_quantity) > 0.000000001)))
  WHERE status = 'pending' AND lines = (SELECT COUNT(*) FROM inventory_check_items i
    WHERE i.session_id = inventory_check_approvals.session_id AND i.branch_id = inventory_check_approvals.branch_id
      AND i.baseline_quantity IS NOT NULL AND (abs(i.baseline_quantity - i.counted_quantity) > 0.000000001
        OR EXISTS(SELECT 1 FROM inventory_check_lot_lines l WHERE l.session_id = i.session_id AND l.product_id = i.product_id AND abs(l.seen_quantity - l.counted_quantity) > 0.000000001)));

DROP TRIGGER inventory_check_approvals_identity;

CREATE TRIGGER inventory_check_approvals_identity BEFORE UPDATE OF
  session_id,organization_id,branch_id,lines,submitted_by,submitted_at,baselines_json,line_set_json ON inventory_check_approvals
BEGIN SELECT RAISE(ABORT,'inventory_check_approval_immutable'); END;

SELECT CASE WHEN (SELECT COUNT(*) FROM pragma_table_info('inventory_check_approvals') WHERE name IN ('line_decisions_json', 'line_set_json')) = 2
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'inventory_check_approvals') = 4
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'inventory_check_approvals_identity' AND sql LIKE '%line_set_json%') = 1
  AND (SELECT COUNT(*) FROM inventory_check_approvals WHERE line_decisions_json <> '{}') = 0
  AND (SELECT COUNT(*) FROM inventory_check_approvals WHERE line_set_json IS NOT NULL AND status <> 'pending') = 0
THEN 1 ELSE json_extract('[]','$[inventory_check_line_decisions_0316_post]') END;
