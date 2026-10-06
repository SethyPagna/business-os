-- Branch cutover post-check, comparable half: history labels (G12-CUTOVER-READINESS.md 3.4 item 9).
-- Read-only. Run it at P7 (right after begin) and at P10 (after finalize); PASS = every column
-- equal in the two outputs (ops/scripts/branch-cutover-post-compare.mjs). One checksum per label
-- column the snapshot pass may fill (branchCutoverCapture.ts snapshots), over the rows of the two
-- branches that existed before the run (the children's own movements and transfers are excluded
-- by created_at). A label counts as blank when it is blank OR equals the name the snapshot pass
-- writes for its branch (the journal's preimage names), so filling a blank label is no change,
-- while any other label that changed - or vanished - changes its column. Blank labels left after
-- the run are counted by branch-cutover-post-checks.sql. Checksums are position-weighted sums mod
-- 2^31-1 over each label's length and first 4 / last 3 characters (not cryptographic).
-- Cost: one scan of each table; D1 refuses a LIKE/GLOB pattern over 50 bytes; there is none.
-- Paired test: cloudflare/scripts/test-branch-cutover-post-checks-native.cjs
-- ops:min-rows 1
-- ops:max-rows 1
WITH op AS MATERIALIZED (
  -- the newest cutover that was not aborted: at P7 (just begun) and at P10 (completed) it is the same row
  SELECT c.operation_id AS id, c.source_branch_id AS src, c.target_branch_id AS tgt, c.created_at AS began, datetime(c.created_at) AS began_t, c.phase, c.terminal_json,
    c.committed_children AS children, c.manifest_json AS manifest, c.intent_json AS intent,
    json_extract(c.source_preimage_json, '$.name') AS src_name, json_extract(c.target_preimage_json, '$.name') AS tgt_name,
    c.source_preimage_json AS src_pre
  FROM branch_cutovers c WHERE c.phase <> 'aborted' ORDER BY c.created_at DESC, c.operation_id LIMIT 1
)
SELECT
  (SELECT COALESCE(SUM((((((x.id * 16 + 0) % 2147483647) + 2147483647) % 2147483647 * 48271 % 2147483647 + 1) * ((((CASE WHEN x.branch_name IS NULL
      OR x.branch_name = CASE x.branch_id WHEN op.src THEN op.src_name ELSE op.tgt_name END OR trim(x.branch_name, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '' THEN 0 ELSE CASE WHEN x.branch_name IS NULL THEN 1 ELSE length(x.branch_name) * 1000003 + coalesce(unicode(x.branch_name), 0) * 3 + coalesce(unicode(substr(x.branch_name, 2, 1)), 0) * 5
      + coalesce(unicode(substr(x.branch_name, 3, 1)), 0) * 7 + coalesce(unicode(substr(x.branch_name, 4, 1)), 0) * 11 + coalesce(unicode(substr(x.branch_name, -1, 1)), 0) * 13
      + coalesce(unicode(substr(x.branch_name, -2, 1)), 0) * 17 + coalesce(unicode(substr(x.branch_name, -3, 1)), 0) * 19 END END) % 2147483647) + 2147483647) % 2147483647) % 2147483647)), 0) % 2147483647
    FROM op, sales x WHERE x.branch_id IN (op.src, op.tgt)) AS sales,
  (SELECT COALESCE(SUM((((((x.id * 16 + 1) % 2147483647) + 2147483647) % 2147483647 * 48271 % 2147483647 + 1) * ((((CASE WHEN x.branch_name IS NULL
      OR x.branch_name = CASE x.branch_id WHEN op.src THEN op.src_name ELSE op.tgt_name END OR trim(x.branch_name, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '' THEN 0 ELSE CASE WHEN x.branch_name IS NULL THEN 1 ELSE length(x.branch_name) * 1000003 + coalesce(unicode(x.branch_name), 0) * 3 + coalesce(unicode(substr(x.branch_name, 2, 1)), 0) * 5
      + coalesce(unicode(substr(x.branch_name, 3, 1)), 0) * 7 + coalesce(unicode(substr(x.branch_name, 4, 1)), 0) * 11 + coalesce(unicode(substr(x.branch_name, -1, 1)), 0) * 13
      + coalesce(unicode(substr(x.branch_name, -2, 1)), 0) * 17 + coalesce(unicode(substr(x.branch_name, -3, 1)), 0) * 19 END END) % 2147483647) + 2147483647) % 2147483647) % 2147483647)), 0) % 2147483647
    FROM op, returns x WHERE x.branch_id IN (op.src, op.tgt)) AS returns,
  (SELECT COALESCE(SUM((((((x.id * 16 + 2) % 2147483647) + 2147483647) % 2147483647 * 48271 % 2147483647 + 1) * ((((CASE WHEN x.branch_name IS NULL
      OR x.branch_name = CASE x.branch_id WHEN op.src THEN op.src_name ELSE op.tgt_name END OR trim(x.branch_name, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '' THEN 0 ELSE CASE WHEN x.branch_name IS NULL THEN 1 ELSE length(x.branch_name) * 1000003 + coalesce(unicode(x.branch_name), 0) * 3 + coalesce(unicode(substr(x.branch_name, 2, 1)), 0) * 5
      + coalesce(unicode(substr(x.branch_name, 3, 1)), 0) * 7 + coalesce(unicode(substr(x.branch_name, 4, 1)), 0) * 11 + coalesce(unicode(substr(x.branch_name, -1, 1)), 0) * 13
      + coalesce(unicode(substr(x.branch_name, -2, 1)), 0) * 17 + coalesce(unicode(substr(x.branch_name, -3, 1)), 0) * 19 END END) % 2147483647) + 2147483647) % 2147483647) % 2147483647)), 0) % 2147483647
    FROM op, inventory_movements x WHERE x.branch_id IN (op.src, op.tgt)
      AND (x.created_at < op.began_t OR x.created_at IS NULL OR julianday(x.created_at) IS NULL OR julianday(x.created_at) < julianday(op.began_t))) AS inventory_movements,
  (SELECT COALESCE(SUM((((((x.id * 16 + 3) % 2147483647) + 2147483647) % 2147483647 * 48271 % 2147483647 + 1) * ((((CASE WHEN x.branch_name IS NULL
      OR x.branch_name = CASE x.branch_id WHEN op.src THEN op.src_name ELSE op.tgt_name END OR trim(x.branch_name, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '' THEN 0 ELSE CASE WHEN x.branch_name IS NULL THEN 1 ELSE length(x.branch_name) * 1000003 + coalesce(unicode(x.branch_name), 0) * 3 + coalesce(unicode(substr(x.branch_name, 2, 1)), 0) * 5
      + coalesce(unicode(substr(x.branch_name, 3, 1)), 0) * 7 + coalesce(unicode(substr(x.branch_name, 4, 1)), 0) * 11 + coalesce(unicode(substr(x.branch_name, -1, 1)), 0) * 13
      + coalesce(unicode(substr(x.branch_name, -2, 1)), 0) * 17 + coalesce(unicode(substr(x.branch_name, -3, 1)), 0) * 19 END END) % 2147483647) + 2147483647) % 2147483647) % 2147483647)), 0) % 2147483647
    FROM op, stock_row_moves x WHERE x.branch_id IN (op.src, op.tgt)) AS stock_row_moves,
  (SELECT COALESCE(SUM((((((x.rowid * 16 + 4) % 2147483647) + 2147483647) % 2147483647 * 48271 % 2147483647 + 1) * ((((CASE WHEN x.branch_name IS NULL
      OR x.branch_name = CASE x.branch_id WHEN op.src THEN op.src_name ELSE op.tgt_name END OR trim(x.branch_name, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '' THEN 0 ELSE CASE WHEN x.branch_name IS NULL THEN 1 ELSE length(x.branch_name) * 1000003 + coalesce(unicode(x.branch_name), 0) * 3 + coalesce(unicode(substr(x.branch_name, 2, 1)), 0) * 5
      + coalesce(unicode(substr(x.branch_name, 3, 1)), 0) * 7 + coalesce(unicode(substr(x.branch_name, 4, 1)), 0) * 11 + coalesce(unicode(substr(x.branch_name, -1, 1)), 0) * 13
      + coalesce(unicode(substr(x.branch_name, -2, 1)), 0) * 17 + coalesce(unicode(substr(x.branch_name, -3, 1)), 0) * 19 END END) % 2147483647) + 2147483647) % 2147483647) % 2147483647)), 0) % 2147483647
    FROM op, stock_session_members x WHERE x.branch_id IN (op.src, op.tgt)) AS stock_session_members,
  (SELECT COALESCE(SUM((((((x.id * 16 + 5) % 2147483647) + 2147483647) % 2147483647 * 48271 % 2147483647 + 1) * ((((CASE WHEN x.from_branch_name IS NULL
      OR x.from_branch_name = CASE x.from_branch_id WHEN op.src THEN op.src_name ELSE op.tgt_name END OR trim(x.from_branch_name, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '' THEN 0 ELSE CASE WHEN x.from_branch_name IS NULL THEN 1 ELSE length(x.from_branch_name) * 1000003 + coalesce(unicode(x.from_branch_name), 0) * 3 + coalesce(unicode(substr(x.from_branch_name, 2, 1)), 0) * 5
      + coalesce(unicode(substr(x.from_branch_name, 3, 1)), 0) * 7 + coalesce(unicode(substr(x.from_branch_name, 4, 1)), 0) * 11 + coalesce(unicode(substr(x.from_branch_name, -1, 1)), 0) * 13
      + coalesce(unicode(substr(x.from_branch_name, -2, 1)), 0) * 17 + coalesce(unicode(substr(x.from_branch_name, -3, 1)), 0) * 19 END END) % 2147483647) + 2147483647) % 2147483647) % 2147483647)), 0) % 2147483647
    FROM op, stock_transfers x WHERE x.from_branch_id IN (op.src, op.tgt)
      AND (x.created_at < op.began_t OR x.created_at IS NULL OR julianday(x.created_at) IS NULL OR julianday(x.created_at) < julianday(op.began_t))) AS from_stock_transfers,
  (SELECT COALESCE(SUM((((((x.id * 16 + 6) % 2147483647) + 2147483647) % 2147483647 * 48271 % 2147483647 + 1) * ((((CASE WHEN x.to_branch_name IS NULL
      OR x.to_branch_name = CASE x.to_branch_id WHEN op.src THEN op.src_name ELSE op.tgt_name END OR trim(x.to_branch_name, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '' THEN 0 ELSE CASE WHEN x.to_branch_name IS NULL THEN 1 ELSE length(x.to_branch_name) * 1000003 + coalesce(unicode(x.to_branch_name), 0) * 3 + coalesce(unicode(substr(x.to_branch_name, 2, 1)), 0) * 5
      + coalesce(unicode(substr(x.to_branch_name, 3, 1)), 0) * 7 + coalesce(unicode(substr(x.to_branch_name, 4, 1)), 0) * 11 + coalesce(unicode(substr(x.to_branch_name, -1, 1)), 0) * 13
      + coalesce(unicode(substr(x.to_branch_name, -2, 1)), 0) * 17 + coalesce(unicode(substr(x.to_branch_name, -3, 1)), 0) * 19 END END) % 2147483647) + 2147483647) % 2147483647) % 2147483647)), 0) % 2147483647
    FROM op, stock_transfers x WHERE x.to_branch_id IN (op.src, op.tgt)
      AND (x.created_at < op.began_t OR x.created_at IS NULL OR julianday(x.created_at) IS NULL OR julianday(x.created_at) < julianday(op.began_t))) AS to_stock_transfers,
  (SELECT COALESCE(SUM((((((x.id * 16 + 7) % 2147483647) + 2147483647) % 2147483647 * 48271 % 2147483647 + 1) * ((((CASE WHEN x.branch_name IS NULL
      OR x.branch_name = CASE x.branch_id WHEN op.src THEN op.src_name ELSE op.tgt_name END OR trim(x.branch_name, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '' THEN 0 ELSE CASE WHEN x.branch_name IS NULL THEN 1 ELSE length(x.branch_name) * 1000003 + coalesce(unicode(x.branch_name), 0) * 3 + coalesce(unicode(substr(x.branch_name, 2, 1)), 0) * 5
      + coalesce(unicode(substr(x.branch_name, 3, 1)), 0) * 7 + coalesce(unicode(substr(x.branch_name, 4, 1)), 0) * 11 + coalesce(unicode(substr(x.branch_name, -1, 1)), 0) * 13
      + coalesce(unicode(substr(x.branch_name, -2, 1)), 0) * 17 + coalesce(unicode(substr(x.branch_name, -3, 1)), 0) * 19 END END) % 2147483647) + 2147483647) % 2147483647) % 2147483647)), 0) % 2147483647
    FROM op, fees x WHERE x.branch_id IN (op.src, op.tgt)) AS fees,
  (SELECT COALESCE(SUM((((((x.id * 16 + 8) % 2147483647) + 2147483647) % 2147483647 * 48271 % 2147483647 + 1) * ((((CASE WHEN x.received_branch_name IS NULL
      OR x.received_branch_name = CASE x.received_branch_id WHEN op.src THEN op.src_name ELSE op.tgt_name END OR trim(x.received_branch_name, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '' THEN 0 ELSE CASE WHEN x.received_branch_name IS NULL THEN 1 ELSE length(x.received_branch_name) * 1000003 + coalesce(unicode(x.received_branch_name), 0) * 3 + coalesce(unicode(substr(x.received_branch_name, 2, 1)), 0) * 5
      + coalesce(unicode(substr(x.received_branch_name, 3, 1)), 0) * 7 + coalesce(unicode(substr(x.received_branch_name, 4, 1)), 0) * 11 + coalesce(unicode(substr(x.received_branch_name, -1, 1)), 0) * 13
      + coalesce(unicode(substr(x.received_branch_name, -2, 1)), 0) * 17 + coalesce(unicode(substr(x.received_branch_name, -3, 1)), 0) * 19 END END) % 2147483647) + 2147483647) % 2147483647) % 2147483647)), 0) % 2147483647
    FROM op, product_batches x WHERE x.received_branch_id IN (op.src, op.tgt)) AS product_batches,
  (SELECT COALESCE(SUM((((((x.id * 16 + 9) % 2147483647) + 2147483647) % 2147483647 * 48271 % 2147483647 + 1) * ((((CASE WHEN x.branch_name IS NULL
      OR x.branch_name = CASE x.branch_id WHEN op.src THEN op.src_name ELSE op.tgt_name END OR trim(x.branch_name, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '' THEN 0 ELSE CASE WHEN x.branch_name IS NULL THEN 1 ELSE length(x.branch_name) * 1000003 + coalesce(unicode(x.branch_name), 0) * 3 + coalesce(unicode(substr(x.branch_name, 2, 1)), 0) * 5
      + coalesce(unicode(substr(x.branch_name, 3, 1)), 0) * 7 + coalesce(unicode(substr(x.branch_name, 4, 1)), 0) * 11 + coalesce(unicode(substr(x.branch_name, -1, 1)), 0) * 13
      + coalesce(unicode(substr(x.branch_name, -2, 1)), 0) * 17 + coalesce(unicode(substr(x.branch_name, -3, 1)), 0) * 19 END END) % 2147483647) + 2147483647) % 2147483647) % 2147483647)), 0) % 2147483647
    FROM op, shift_sessions x WHERE x.branch_id IN (op.src, op.tgt)) AS shift_sessions
FROM op
