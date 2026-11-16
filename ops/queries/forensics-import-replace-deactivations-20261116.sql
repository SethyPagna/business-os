-- R2-3 one-off forensics: products a replace-all import deactivated although the SAME import named them (R2-3, 16 Nov 2026).
-- The bug (R2-3): a single-chunk replace-all products import with a branch column deactivated products the file listed, because
-- the cutoff it removes by (updated_at < cutoff, finalizeProductReplacement in lib/importEngine.ts) is compared as TEXT between an
-- ISO stamp (the import writes 2026-11-12T08:00:00.000Z, nowIso) and the SQL form (import_jobs.started_at, CURRENT_TIMESTAMP:
-- 2026-11-12 08:00:00), which order wrongly on one date. 6.0.2096 (14 Nov) decides membership from the ids the apply rows name
-- (readNamedProductIds) instead of from the stamp. This file looks for the damage done before that.
-- What it can see, and why that is the whole truth it can offer from the main database:
--   * the removal itself: finalizeProductReplacement writes one audit_logs row per product it deactivates (action 'delete', entity
--     'product', details {source:'replace_all', importJobId, cutoff, ...}), since 8 Oct 2026 (ffe5c80ff). Earlier removals left no row.
--   * "the job named this product": the apply writes an inventory_movements row with reason 'Product import <job id>, row <n>' for every
--     row that carries a branch quantity (a file with a branch column). A product that the job deactivated AND that holds such a row of the
--     same job was listed by it: it must not have been removed (named products are kept). The row-level proof for a listed row without a
--     quantity lives in the import staging database (import_job_rows), which this query cannot reach and which is pruned.
--   * import_jobs rows are pruned after about 7 days, so the job columns are NULL for an old job; the audit and movement rows stay.
-- Two kinds of row, ids and counts only (no names, no personal data):
--   kind 'job'      one per replace-all job that removed products: products_removed, named_and_removed (the suspects), cutoff and
--                   cutoff_form ('iso' = the run's cutoff was an ISO stamp, 'sql' = the stored started_at form), the first removal time,
--                   job_status / job_total_rows / job_created_at (NULL once the job row was pruned).
--   kind 'product'  one per suspect: job_id, product_id, stock_rows (how many import rows of that job hit the product),
--                   product_active_now (1 when someone already reactivated it), removed_at.
-- A healthy world prints job rows with named_and_removed = 0 and no product rows.
-- Repair (proposed, not run): reactivate each listed suspect through the product's own Activate action, after the owner confirms the
-- file really listed it; never by SQL.
-- ops:min-rows 0
-- ops:max-rows 5000
-- ops:max-rows-read 2000
-- Why 2000: the join into inventory_movements is pinned (INDEXED BY ... via CROSS JOIN, removed rows outermost), so it seeks one product's
-- rows at a time whatever the optimizer statistics say: 562 rows read on the read-budget seed without ANALYZE and 562 with it. Unpinned, the
-- same query flipped to a full scan of inventory_movements once ANALYZE had run (34,075 rows on the seed). 2000 is about 3.5 x the seed (the
-- production volume of delete audit rows since 1 Oct is not known) and still 17 x under that scan, so the guard still refuses a plan that flips.
WITH removed AS MATERIALIZED (
  SELECT CAST(a.entity_id AS INTEGER) AS product_id,
    json_extract(a.details, '$.importJobId') AS job_id,
    json_extract(a.details, '$.cutoff') AS cutoff,
    a.created_at AS removed_at
  FROM audit_logs a
  WHERE a.action = 'delete' AND a.created_at >= '2026-10-01' AND a.entity = 'product'
    AND json_valid(a.details) AND json_extract(a.details, '$.source') = 'replace_all'
    AND json_extract(a.details, '$.importJobId') IS NOT NULL
),
named AS MATERIALIZED (
  SELECT r.job_id, r.product_id, COUNT(*) AS stock_rows
  FROM removed r
  CROSS JOIN inventory_movements m INDEXED BY idx_inventory_movements_product_created_pg ON m.product_id = r.product_id
  WHERE substr(m.reason, 1, 15) = 'Product import '
    AND substr(m.reason, 16, length(r.job_id) + 6) = r.job_id || ', row '
  GROUP BY r.job_id, r.product_id
),
per_job AS MATERIALIZED (
  SELECT r.job_id, COUNT(DISTINCT r.product_id) AS products_removed, MIN(r.cutoff) AS cutoff, MIN(r.removed_at) AS removed_at
  FROM removed r
  GROUP BY r.job_id
),
named_per_job AS MATERIALIZED (
  SELECT n.job_id, COUNT(*) AS named_and_removed FROM named n GROUP BY n.job_id
)
SELECT * FROM (
  SELECT 'job' AS kind, pj.job_id, NULL AS product_id,
    pj.products_removed, COALESCE(np.named_and_removed, 0) AS named_and_removed, NULL AS stock_rows,
    pj.cutoff, CASE WHEN instr(pj.cutoff, 'T') = 11 THEN 'iso' ELSE 'sql' END AS cutoff_form, pj.removed_at,
    j.status AS job_status, j.total_rows AS job_total_rows, j.created_at AS job_created_at, NULL AS product_active_now
  FROM per_job pj
  LEFT JOIN named_per_job np ON np.job_id = pj.job_id
  LEFT JOIN import_jobs j ON j.id = pj.job_id
  UNION ALL
  SELECT 'product', n.job_id, n.product_id,
    NULL, NULL, n.stock_rows,
    pj.cutoff, CASE WHEN instr(pj.cutoff, 'T') = 11 THEN 'iso' ELSE 'sql' END, pj.removed_at,
    j.status, j.total_rows, j.created_at, COALESCE(p.is_active, 0)
  FROM named n
  JOIN per_job pj ON pj.job_id = n.job_id
  LEFT JOIN import_jobs j ON j.id = n.job_id
  LEFT JOIN products p ON p.id = n.product_id
)
ORDER BY job_id, kind, product_id
LIMIT 5000
