-- Branch cutover post-check, comparable half: stock (G12-CUTOVER-READINESS.md 3.4 items 2, 3, 4, 5, 6).
-- Read-only. Run it TWICE through the Ops d1-export task: at P7 (right after begin, under the
-- fence) and at P10 (after finalize). PASS = every column not prefixed info_ is equal in the two
-- outputs (ops/scripts/branch-cutover-post-compare.mjs does the comparison). Values that the
-- owner's lot-merge rulings (5-6 Oct) change on purpose are put back from the run's own fold
-- audit rows (audit_logs action branch_cutover_lot_fold), so a correct run compares equal:
--   lot_checksum_pair     per batch: Shop + Warehouse lot quantity, minus each fold's (after -
--                         before) at the target (item 3: same batch id, nothing lost)
--   lot_checksum_other    per batch and branch, every other branch (untouched)
--   lot_units_micro       all Shop + Warehouse lot units (folds conserve units)
--   product_checksum_pair per product: Shop + Warehouse branch_stock (item 2: LC Store after =
--                         Warehouse before + Shop before, once the source is empty - post-checks)
--   product_checksum_other, product_units_micro   as above for branch_stock
--   untracked_checksum    per product: Shop + Warehouse branch_stock minus lot units (item 5)
--   value_lots            Shop + Warehouse lot value (qty x unit_cost_usd above 0) with each fold
--                         put back: the survivor's cost before, each lot's quantity before (item 6)
--   batch_checksum, batches  every product_batches row (item 4): numbers exactly; dates by their
--                         instant to the second, length, separator and last character; other text
--                         by length and the first 6 / last 4 characters; a re-costed survivor counts with
--                         its cost before. updated_at is left out (a fold re-costs the survivor;
--                         branch-cutover-post-checks.sql allows no other row updated since begin)
--                         and received_branch_name is the label check (branch-cutover-post-labels.sql)
--   info_*                expected to differ: phase, children, folds, the raw value and the
--                         revaluation the merges made (info_fold_value_delta = after - before)
-- Checksums are sums of position-weighted terms mod 2^31-1 (not cryptographic): any one wrong
-- quantity, cost, id or date changes them, and any change to a sampled character; a change in
-- the middle of a long text is not seen. Quantities compare in millionths.
-- Cost: one pass over branch_batch_stock, branch_stock and product_batches each; the fold rows
-- come through the audit action index. D1 refuses a LIKE/GLOB pattern over 50 bytes; there is none.
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
), fold AS MATERIALIZED (
  -- the run's own fold decisions (branchCutoverParent.ts, BRANCH_CUTOVER_FOLD_AUDIT_ACTION), read through the action index
  SELECT a.details AS d FROM op JOIN audit_logs a ON a.action = 'branch_cutover_lot_fold' AND json_extract(a.details, '$.operationId') = op.id
), fl AS MATERIALIZED (
  -- one row per lot a fold touched at the target: quantity before / after, and for the survivor its cost before / after
  SELECT CAST(json_extract(b.value, '$[0]') AS INTEGER) AS id, json_extract(b.value, '$[1]') AS qb,
    json_extract(f.d, '$.after[' || b.key || '][1]') AS qa,
    CASE WHEN CAST(json_extract(b.value, '$[0]') AS INTEGER) = json_extract(f.d, '$.survivorBatchId')
      AND json_extract(f.d, '$.unitCostUsdAfter') IS NOT json_extract(f.d, '$.unitCostUsdBefore') THEN 1 ELSE 0 END AS recost,
    json_extract(f.d, '$.unitCostUsdBefore') AS cb, json_extract(f.d, '$.unitCostUsdAfter') AS ca,
    CAST(json_extract(f.d, '$.after[' || b.key || '][0]') AS INTEGER) AS id_after
  FROM fold f, json_each(f.d, '$.before') b
), lots AS MATERIALIZED (
  SELECT s.batch_id,
    SUM(CASE WHEN s.branch_id IN (op.src, op.tgt) THEN s.quantity ELSE 0 END) AS pair,
    SUM(CASE WHEN s.branch_id IN (op.src, op.tgt) THEN 0 ELSE (((((s.batch_id * 64 + s.branch_id) % 2147483647) + 2147483647) % 2147483647 * 48271 % 2147483647 + 1) * ((((CAST(round((s.quantity) * 1000000) AS INTEGER)) % 2147483647) + 2147483647) % 2147483647) % 2147483647) END) AS other_ck
  FROM op, branch_batch_stock s GROUP BY s.batch_id
), lb AS MATERIALIZED (
  SELECT l.batch_id, l.pair, l.other_ck, b.variant_product_id AS p, b.unit_cost_usd AS cost, fl.qa, fl.qb, fl.recost, fl.cb
  FROM lots l JOIN product_batches b ON b.id = l.batch_id LEFT JOIN fl ON fl.id = l.batch_id
), bs AS MATERIALIZED (
  SELECT x.product_id AS p,
    SUM(CASE WHEN x.branch_id IN (op.src, op.tgt) THEN x.quantity ELSE 0 END) AS pair,
    SUM(CASE WHEN x.branch_id IN (op.src, op.tgt) THEN 0 ELSE (((((x.product_id * 64 + x.branch_id) % 2147483647) + 2147483647) % 2147483647 * 48271 % 2147483647 + 1) * ((((CAST(round((x.quantity) * 1000000) AS INTEGER)) % 2147483647) + 2147483647) % 2147483647) % 2147483647) END) AS other_ck
  FROM op, branch_stock x GROUP BY x.product_id
), lp AS MATERIALIZED (
  SELECT p, SUM(pair) AS lots FROM lb GROUP BY p
), bt AS MATERIALIZED (
  SELECT b.id,
    (((((b.id) % 2147483647) + 2147483647) % 2147483647 * 48271 % 2147483647 + 1) * ((((CAST(round((b.variant_product_id) * 1000000) AS INTEGER) * 3 + CASE WHEN (b.received_branch_id) IS NULL THEN 7 ELSE CAST(round((b.received_branch_id) * 1000000) AS INTEGER) END * 5 + CASE WHEN (b.supplier_id) IS NULL THEN 11 ELSE CAST(round((b.supplier_id) * 1000000) AS INTEGER) END * 7
      + CASE WHEN (b.is_active) IS NULL THEN 13 ELSE CAST(round((b.is_active) * 1000000) AS INTEGER) END * 11 + CASE WHEN (b.batch_number) IS NULL THEN 17 ELSE CAST(round((b.batch_number) * 1000000) AS INTEGER) END * 13 + CASE WHEN (b.synthetic) IS NULL THEN 19 ELSE CAST(round((b.synthetic) * 1000000) AS INTEGER) END * 17) % 2147483647) + 2147483647) % 2147483647) % 2147483647) AS n1,
    (((((b.id + 7) % 2147483647) + 2147483647) % 2147483647 * 48271 % 2147483647 + 1) * ((((CASE WHEN (b.received_quantity) IS NULL THEN 23 ELSE CAST(round((b.received_quantity) * 1000000) AS INTEGER) END % 2147483647 * 3 + CASE WHEN (b.received_cost_usd) IS NULL THEN 29 ELSE CAST(round((b.received_cost_usd) * 1000000) AS INTEGER) END % 2147483647 * 5
      + CASE WHEN (CASE WHEN fl.recost = 1 THEN fl.cb ELSE b.unit_cost_usd END) IS NULL THEN 31 ELSE CAST(round((CASE WHEN fl.recost = 1 THEN fl.cb ELSE b.unit_cost_usd END) * 1000000) AS INTEGER) END % 2147483647 * 7) % 2147483647) + 2147483647) % 2147483647) % 2147483647) AS n2,
    (((((b.id + 13) % 2147483647) + 2147483647) % 2147483647 * 48271 % 2147483647 + 1) * (((((CASE WHEN b.received_at IS NULL THEN 1 WHEN julianday(b.received_at) IS NULL THEN CASE WHEN b.received_at IS NULL THEN 1 ELSE length(b.received_at) * 1000003 + coalesce(unicode(substr(b.received_at, 1, 1)), 0) * 3 + coalesce(unicode(substr(b.received_at, 2, 1)), 0) * 5 + coalesce(unicode(substr(b.received_at, 3, 1)), 0) * 7 + coalesce(unicode(substr(b.received_at, 4, 1)), 0) * 11 + coalesce(unicode(substr(b.received_at, 5, 1)), 0) * 13 + coalesce(unicode(substr(b.received_at, 6, 1)), 0) * 17
      + coalesce(unicode(substr(b.received_at, -1, 1)), 0) * 19 + coalesce(unicode(substr(b.received_at, -2, 1)), 0) * 23 + coalesce(unicode(substr(b.received_at, -3, 1)), 0) * 29 + coalesce(unicode(substr(b.received_at, -4, 1)), 0) * 31 END
      ELSE length(b.received_at) * 1000003 + CAST(round(julianday(b.received_at) * 86400) AS INTEGER) % 1000000007 * 3 + coalesce(unicode(substr(b.received_at, 11, 1)), 0) * 5
        + coalesce(unicode(substr(b.received_at, -1, 1)), 0) * 7 END) % 2147483647 * 3 + (CASE WHEN b.expiry_date IS NULL THEN 1 WHEN julianday(b.expiry_date) IS NULL THEN CASE WHEN b.expiry_date IS NULL THEN 1 ELSE length(b.expiry_date) * 1000003 + coalesce(unicode(substr(b.expiry_date, 1, 1)), 0) * 3 + coalesce(unicode(substr(b.expiry_date, 2, 1)), 0) * 5 + coalesce(unicode(substr(b.expiry_date, 3, 1)), 0) * 7 + coalesce(unicode(substr(b.expiry_date, 4, 1)), 0) * 11 + coalesce(unicode(substr(b.expiry_date, 5, 1)), 0) * 13 + coalesce(unicode(substr(b.expiry_date, 6, 1)), 0) * 17
      + coalesce(unicode(substr(b.expiry_date, -1, 1)), 0) * 19 + coalesce(unicode(substr(b.expiry_date, -2, 1)), 0) * 23 + coalesce(unicode(substr(b.expiry_date, -3, 1)), 0) * 29 + coalesce(unicode(substr(b.expiry_date, -4, 1)), 0) * 31 END
      ELSE length(b.expiry_date) * 1000003 + CAST(round(julianday(b.expiry_date) * 86400) AS INTEGER) % 1000000007 * 3 + coalesce(unicode(substr(b.expiry_date, 11, 1)), 0) * 5
        + coalesce(unicode(substr(b.expiry_date, -1, 1)), 0) * 7 END) % 2147483647 * 5 + (CASE WHEN b.created_at IS NULL THEN 1 WHEN julianday(b.created_at) IS NULL THEN CASE WHEN b.created_at IS NULL THEN 1 ELSE length(b.created_at) * 1000003 + coalesce(unicode(substr(b.created_at, 1, 1)), 0) * 3 + coalesce(unicode(substr(b.created_at, 2, 1)), 0) * 5 + coalesce(unicode(substr(b.created_at, 3, 1)), 0) * 7 + coalesce(unicode(substr(b.created_at, 4, 1)), 0) * 11 + coalesce(unicode(substr(b.created_at, 5, 1)), 0) * 13 + coalesce(unicode(substr(b.created_at, 6, 1)), 0) * 17
      + coalesce(unicode(substr(b.created_at, -1, 1)), 0) * 19 + coalesce(unicode(substr(b.created_at, -2, 1)), 0) * 23 + coalesce(unicode(substr(b.created_at, -3, 1)), 0) * 29 + coalesce(unicode(substr(b.created_at, -4, 1)), 0) * 31 END
      ELSE length(b.created_at) * 1000003 + CAST(round(julianday(b.created_at) * 86400) AS INTEGER) % 1000000007 * 3 + coalesce(unicode(substr(b.created_at, 11, 1)), 0) * 5
        + coalesce(unicode(substr(b.created_at, -1, 1)), 0) * 7 END) % 2147483647 * 7
      + (CASE WHEN b.credit_due_date IS NULL THEN 1 WHEN julianday(b.credit_due_date) IS NULL THEN CASE WHEN b.credit_due_date IS NULL THEN 1 ELSE length(b.credit_due_date) * 1000003 + coalesce(unicode(substr(b.credit_due_date, 1, 1)), 0) * 3 + coalesce(unicode(substr(b.credit_due_date, 2, 1)), 0) * 5 + coalesce(unicode(substr(b.credit_due_date, 3, 1)), 0) * 7 + coalesce(unicode(substr(b.credit_due_date, 4, 1)), 0) * 11 + coalesce(unicode(substr(b.credit_due_date, 5, 1)), 0) * 13 + coalesce(unicode(substr(b.credit_due_date, 6, 1)), 0) * 17
      + coalesce(unicode(substr(b.credit_due_date, -1, 1)), 0) * 19 + coalesce(unicode(substr(b.credit_due_date, -2, 1)), 0) * 23 + coalesce(unicode(substr(b.credit_due_date, -3, 1)), 0) * 29 + coalesce(unicode(substr(b.credit_due_date, -4, 1)), 0) * 31 END
      ELSE length(b.credit_due_date) * 1000003 + CAST(round(julianday(b.credit_due_date) * 86400) AS INTEGER) % 1000000007 * 3 + coalesce(unicode(substr(b.credit_due_date, 11, 1)), 0) * 5
        + coalesce(unicode(substr(b.credit_due_date, -1, 1)), 0) * 7 END) % 2147483647 * 11) % 2147483647) + 2147483647) % 2147483647) % 2147483647) AS n3,
    (((((b.id + 29) % 2147483647) + 2147483647) % 2147483647 * 48271 % 2147483647 + 1) * (((((CASE WHEN b.batch_key IS NULL THEN 1 ELSE length(b.batch_key) * 1000003 + coalesce(unicode(substr(b.batch_key, 1, 1)), 0) * 3 + coalesce(unicode(substr(b.batch_key, 2, 1)), 0) * 5 + coalesce(unicode(substr(b.batch_key, 3, 1)), 0) * 7 + coalesce(unicode(substr(b.batch_key, 4, 1)), 0) * 11 + coalesce(unicode(substr(b.batch_key, 5, 1)), 0) * 13 + coalesce(unicode(substr(b.batch_key, 6, 1)), 0) * 17
      + coalesce(unicode(substr(b.batch_key, -1, 1)), 0) * 19 + coalesce(unicode(substr(b.batch_key, -2, 1)), 0) * 23 + coalesce(unicode(substr(b.batch_key, -3, 1)), 0) * 29 + coalesce(unicode(substr(b.batch_key, -4, 1)), 0) * 31 END) % 2147483647 * 3 + (CASE WHEN b.lot_code IS NULL THEN 1 ELSE length(b.lot_code) * 1000003 + coalesce(unicode(substr(b.lot_code, 1, 1)), 0) * 3 + coalesce(unicode(substr(b.lot_code, 2, 1)), 0) * 5 + coalesce(unicode(substr(b.lot_code, 3, 1)), 0) * 7 + coalesce(unicode(substr(b.lot_code, 4, 1)), 0) * 11 + coalesce(unicode(substr(b.lot_code, 5, 1)), 0) * 13 + coalesce(unicode(substr(b.lot_code, 6, 1)), 0) * 17
      + coalesce(unicode(substr(b.lot_code, -1, 1)), 0) * 19 + coalesce(unicode(substr(b.lot_code, -2, 1)), 0) * 23 + coalesce(unicode(substr(b.lot_code, -3, 1)), 0) * 29 + coalesce(unicode(substr(b.lot_code, -4, 1)), 0) * 31 END) % 2147483647 * 5 + (CASE WHEN b.notes IS NULL THEN 1 ELSE length(b.notes) * 1000003 + coalesce(unicode(substr(b.notes, 1, 1)), 0) * 3 + coalesce(unicode(substr(b.notes, 2, 1)), 0) * 5 + coalesce(unicode(substr(b.notes, 3, 1)), 0) * 7 + coalesce(unicode(substr(b.notes, 4, 1)), 0) * 11 + coalesce(unicode(substr(b.notes, 5, 1)), 0) * 13 + coalesce(unicode(substr(b.notes, 6, 1)), 0) * 17
      + coalesce(unicode(substr(b.notes, -1, 1)), 0) * 19 + coalesce(unicode(substr(b.notes, -2, 1)), 0) * 23 + coalesce(unicode(substr(b.notes, -3, 1)), 0) * 29 + coalesce(unicode(substr(b.notes, -4, 1)), 0) * 31 END) % 2147483647 * 7
      + (CASE WHEN b.supplier_name IS NULL THEN 1 ELSE length(b.supplier_name) * 1000003 + coalesce(unicode(substr(b.supplier_name, 1, 1)), 0) * 3 + coalesce(unicode(substr(b.supplier_name, 2, 1)), 0) * 5 + coalesce(unicode(substr(b.supplier_name, 3, 1)), 0) * 7 + coalesce(unicode(substr(b.supplier_name, 4, 1)), 0) * 11 + coalesce(unicode(substr(b.supplier_name, 5, 1)), 0) * 13 + coalesce(unicode(substr(b.supplier_name, 6, 1)), 0) * 17
      + coalesce(unicode(substr(b.supplier_name, -1, 1)), 0) * 19 + coalesce(unicode(substr(b.supplier_name, -2, 1)), 0) * 23 + coalesce(unicode(substr(b.supplier_name, -3, 1)), 0) * 29 + coalesce(unicode(substr(b.supplier_name, -4, 1)), 0) * 31 END) % 2147483647 * 11 + (CASE WHEN b.payment_status IS NULL THEN 1 ELSE length(b.payment_status) * 1000003 + coalesce(unicode(substr(b.payment_status, 1, 1)), 0) * 3 + coalesce(unicode(substr(b.payment_status, 2, 1)), 0) * 5 + coalesce(unicode(substr(b.payment_status, 3, 1)), 0) * 7 + coalesce(unicode(substr(b.payment_status, 4, 1)), 0) * 11 + coalesce(unicode(substr(b.payment_status, 5, 1)), 0) * 13 + coalesce(unicode(substr(b.payment_status, 6, 1)), 0) * 17
      + coalesce(unicode(substr(b.payment_status, -1, 1)), 0) * 19 + coalesce(unicode(substr(b.payment_status, -2, 1)), 0) * 23 + coalesce(unicode(substr(b.payment_status, -3, 1)), 0) * 29 + coalesce(unicode(substr(b.payment_status, -4, 1)), 0) * 31 END) % 2147483647 * 13) % 2147483647) + 2147483647) % 2147483647) % 2147483647) AS n4
  FROM product_batches b LEFT JOIN fl ON fl.id = b.id
)
SELECT
  (SELECT COALESCE(SUM((((((batch_id) % 2147483647) + 2147483647) % 2147483647 * 48271 % 2147483647 + 1) * ((((CAST(round((pair - COALESCE(qa - qb, 0)) * 1000000) AS INTEGER)) % 2147483647) + 2147483647) % 2147483647) % 2147483647)), 0) % 2147483647 FROM lb) AS lot_checksum_pair,
  (SELECT COALESCE(SUM(other_ck), 0) % 2147483647 FROM lots) AS lot_checksum_other,
  (SELECT COALESCE(SUM(CAST(round((pair) * 1000000) AS INTEGER)), 0) FROM lots) AS lot_units_micro,
  (SELECT COALESCE(SUM((((((p) % 2147483647) + 2147483647) % 2147483647 * 48271 % 2147483647 + 1) * ((((CAST(round((pair) * 1000000) AS INTEGER)) % 2147483647) + 2147483647) % 2147483647) % 2147483647)), 0) % 2147483647 FROM bs) AS product_checksum_pair,
  (SELECT COALESCE(SUM(other_ck), 0) % 2147483647 FROM bs) AS product_checksum_other,
  (SELECT COALESCE(SUM(CAST(round((pair) * 1000000) AS INTEGER)), 0) FROM bs) AS product_units_micro,
  (SELECT COALESCE(SUM((((((bs.p) % 2147483647) + 2147483647) % 2147483647 * 48271 % 2147483647 + 1) * ((((CAST(round((bs.pair - COALESCE(lp.lots, 0)) * 1000000) AS INTEGER)) % 2147483647) + 2147483647) % 2147483647) % 2147483647)), 0) % 2147483647 FROM bs LEFT JOIN lp ON lp.p = bs.p) AS untracked_checksum,
  (SELECT round(COALESCE(SUM(pair * CASE WHEN typeof(cost) IN ('integer', 'real') AND cost > 0 THEN cost ELSE 0 END), 0)
      + COALESCE(SUM(CASE WHEN qb IS NULL THEN 0 ELSE qb * CASE WHEN typeof(CASE WHEN recost = 1 THEN cb ELSE cost END) IN ('integer', 'real') AND CASE WHEN recost = 1 THEN cb ELSE cost END > 0 THEN CASE WHEN recost = 1 THEN cb ELSE cost END ELSE 0 END - qa * CASE WHEN typeof(cost) IN ('integer', 'real') AND cost > 0 THEN cost ELSE 0 END END), 0), 6) FROM lb) AS value_lots,
  (SELECT (COALESCE(SUM(n1), 0) % 2147483647 + COALESCE(SUM(n2), 0) % 2147483647 + COALESCE(SUM(n3), 0) % 2147483647 + COALESCE(SUM(n4), 0) % 2147483647) % 2147483647 FROM bt) AS batch_checksum,
  (SELECT count(*) FROM product_batches) AS batches,
  op.phase AS info_phase, op.children AS info_children, (SELECT count(*) FROM fold) AS info_folds,
  (SELECT round(COALESCE(SUM(pair * CASE WHEN typeof(cost) IN ('integer', 'real') AND cost > 0 THEN cost ELSE 0 END), 0), 6) FROM lb) AS info_value_raw,
  (SELECT round(COALESCE(SUM(CASE WHEN qb IS NULL THEN 0 ELSE qa * CASE WHEN typeof(cost) IN ('integer', 'real') AND cost > 0 THEN cost ELSE 0 END - qb * CASE WHEN typeof(CASE WHEN recost = 1 THEN cb ELSE cost END) IN ('integer', 'real') AND CASE WHEN recost = 1 THEN cb ELSE cost END > 0 THEN CASE WHEN recost = 1 THEN cb ELSE cost END ELSE 0 END END), 0), 6) FROM lb) AS info_fold_value_delta
FROM op
