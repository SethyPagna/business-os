-- 0316: the approver's decision on ONE line of a submitted Inventory Check count (lane/inv-check-requests, owner ask of 17 Nov 2026).
--
-- A submitted count waits as ONE approval row (0286) that was accepted or refused as a whole. An approver can now reject or modify a single line and accept lines one by one; the
-- engine (lib/inventoryCheckApprovals.ts) keeps the one queue. This column holds what the approver decided per product, so the counter's own figures in inventory_check_items are never
-- changed and every decision stays visible next to them:
--   { "<product id>": { "decision": "reject" | "modify", "counted"?: n, "lots"?: [{ "batchId": n, "counted": n }], "note"?: text, "by": account id, "by_name": username, "at": ISO time } }
-- A key is removed again by a reopen. A rejected line is never applied; a modified line is applied as the variance (modified - seen) on live stock, floored at 0, by the same writer as an
-- unmodified one. An approval with no line left to apply ends as approved (something was applied) or rejected (nothing was).
--
-- PRE:  inventory_check_approvals exists with its four 0286 triggers; the column does not exist. A failed check reads a malformed JSON path and aborts the file.
-- POST: the column exists (NOT NULL, default '{}', JSON object CHECK), every existing row holds '{}', the four triggers still exist (the identity trigger names its columns, so the new one
--       is writable on a pending row and, like every other column, frozen once the approval is decided). Pinned by scripts/test-migration-0316-inventory-check-line-decisions-pure.cjs.
-- Cost: schema only. SQLite adds a column with a constant default without rewriting the table: no row is read or written here. At runtime a decision writes one approval row, one session row
--       and one event row.
-- Append-only, LF-only, rowid kept (no WITHOUT ROWID: it breaks backups and BACKUP_TABLES / the branch cutover capture read rowids), generic (no client data), no ANALYZE.
-- Rollback-safe: the previous Worker never names the column and runs unchanged on the new schema (its own INSERTs and UPDATEs leave it at '{}'). A Worker that names the column needs this
-- migration applied first, like every column the engine reads.
-- RECOVERY: nothing to restore: a decision lives in this column only, so dropping it loses decisions on pending approvals (rejected lines would read as open again; nothing was applied
--   for them). Full undo: ALTER TABLE inventory_check_approvals DROP COLUMN line_decisions_json;   -- after the Worker that reads it is rolled back.
--   Partial apply (SQLite adds the column and the d1_migrations row in separate steps, so a crash between them is possible): first check d1_migrations for this file name:
--     SELECT id, name FROM d1_migrations WHERE name = '0316_inventory_check_line_decisions.sql';
--   Not recorded and the column absent: rerun migrations apply.
--   Not recorded but the column exists (a rerun aborts on PRE): drop it with the full-undo line above, then rerun migrations apply.
--   Recorded but the column absent: run the single ALTER TABLE line of this file by hand; do not rerun the file.
--   Recorded and the column exists: nothing to do.

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'inventory_check_approvals') = 1
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'inventory_check_approvals') = 4
  AND (SELECT COUNT(*) FROM pragma_table_info('inventory_check_approvals') WHERE name = 'line_decisions_json') = 0
THEN 1 ELSE json_extract('[]','$[inventory_check_line_decisions_0316_pre]') END;

ALTER TABLE inventory_check_approvals ADD COLUMN line_decisions_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(line_decisions_json) AND json_type(line_decisions_json) = 'object');

SELECT CASE WHEN (SELECT COUNT(*) FROM pragma_table_info('inventory_check_approvals') WHERE name = 'line_decisions_json') = 1
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'inventory_check_approvals') = 4
  AND (SELECT COUNT(*) FROM inventory_check_approvals WHERE line_decisions_json <> '{}') = 0
THEN 1 ELSE json_extract('[]','$[inventory_check_line_decisions_0316_post]') END;
