-- 0080: give a lot a CUMULATIVE received cost, so its money and its quantity
-- are recorded the same way.
--
-- The bug this fixes, measured on production. `received_quantity` accumulates
-- on EVERY add to a lot (0067), but `supplier_id`/`supplier_name`/
-- `unit_cost_usd` are fill-if-NULL "first attribution sticks" (0062/0065) --
-- see lib/stockActionCommit.ts. Two receipts of the same product on the same
-- calendar day land on the SAME lot (batch_key is the date code), so the
-- second receipt's units are silently valued at the first receipt's unit
-- cost. The Stock-In Invoice report then multiplies the whole accumulated
-- quantity by that one cost.
--
-- What that cost, in real money: the old system's two independent sources
-- agree exactly -- suppliers-from-po.csv's per-supplier totals and
-- later/stock_in_invoice_lines.csv's net totals BOTH sum to $1,311,701.46.
-- The report showed $1,462,395.81. Wrong in both directions per supplier
-- (bong long +$37,330, dane japan +$24,460, srun -$1,805, piset exact).
-- All 19,914 imported lots ended up carrying a unit cost although only
-- 6,966 source rows recorded one.
--
-- The fix is to stop deriving money from a single unit cost. `unit_cost_usd`
-- stays exactly as it is (first attribution, still the honest answer to
-- "what did a unit of this lot cost when we first recorded it", and still
-- what the pickers show); `received_cost_usd` becomes the sum of each
-- receipt's own quantity x its own cost, which is what a spend report must
-- read. Receipts with no recorded cost contribute nothing rather than
-- borrowing a sibling's -- the report already surfaces `lines_without_cost`,
-- so an unpriced receipt stays visible instead of being invented.

ALTER TABLE product_batches ADD COLUMN received_cost_usd REAL;

-- Backfill. The completed stock-action imports kept every source row in
-- `import_job_source_rows`, so the real per-receipt money is recoverable
-- without re-uploading anything: 21,286 rows carrying 114,277.8 units and
-- $1,338,467.08 of recorded cost, which reproduces the source CSV exactly.
--
-- Materialized rather than written as one correlated statement: the direct
-- form re-parses every row's JSON per candidate lot and D1 returns
-- "exceeded its CPU time limit" on this data size. The helper carries its
-- own index so the join below is a lookup, not a scan.
-- Dropped first so a retry after a partially-applied run does not die on
-- "table already exists" instead of finishing the job.
DROP TABLE IF EXISTS _batch_cost_backfill;
DROP TABLE IF EXISTS _batch_cost_backfill_src;

CREATE TABLE _batch_cost_backfill_src (
  seq INTEGER NOT NULL,
  job_id TEXT NOT NULL,
  barcode TEXT,
  batch_key TEXT,
  qty REAL NOT NULL,
  cost REAL
);

INSERT INTO _batch_cost_backfill_src (seq, job_id, barcode, batch_key, qty, cost)
SELECT sr.sequence,
       sr.job_id,
       json_extract(sr.data_json, '$.barcode'),
       substr(json_extract(sr.data_json, '$.date'), 1, 2)
         || substr(json_extract(sr.data_json, '$.date'), 4, 2)
         || substr(json_extract(sr.data_json, '$.date'), 7, 4),
       CAST(COALESCE(NULLIF(json_extract(sr.data_json, '$.shop'), ''), '0') AS REAL)
         + CAST(COALESCE(NULLIF(json_extract(sr.data_json, '$.warehouse'), ''), '0') AS REAL),
       CAST(NULLIF(json_extract(sr.data_json, '$.cost_price'), '') AS REAL)
FROM import_job_source_rows sr
JOIN import_jobs j ON j.id = sr.job_id AND j.type = 'stock_actions' AND j.status = 'completed';

CREATE INDEX _batch_cost_backfill_src_idx ON _batch_cost_backfill_src (barcode, batch_key);

-- One row per source row, resolved to exactly one lot. A source row reaches
-- its lot by product barcode + the date-derived batch_key, scoped to lots
-- that same job created (`instr(...) = 1` rather than LIKE: the pattern-
-- complexity limit rejects LIKE on this table, the same reason the migration
-- pack's own Step 4e uses instr). 54 barcodes are shared by 346 products
-- (the deliberate identity-merge children), so MIN(pb.id) applies the
-- codebase's standing "lowest id wins" tie-break and guarantees each row is
-- counted once and only once.
CREATE TABLE _batch_cost_backfill (
  batch_id INTEGER PRIMARY KEY,
  received_cost_usd REAL NOT NULL
);

INSERT INTO _batch_cost_backfill (batch_id, received_cost_usd)
SELECT h.batch_id, ROUND(SUM(CASE WHEN s.cost > 0 THEN s.qty * s.cost ELSE 0 END), 4)
FROM (
  SELECT s.seq, s.job_id, MIN(pb.id) AS batch_id
  FROM _batch_cost_backfill_src s
  JOIN products p ON p.barcode = s.barcode
  JOIN product_batches pb
    ON pb.variant_product_id = p.id
   AND pb.batch_key = s.batch_key
   AND instr(pb.notes, 'Unified stock import ' || s.job_id || ',') = 1
  GROUP BY s.seq, s.job_id
) h
JOIN _batch_cost_backfill_src s ON s.seq = h.seq AND s.job_id = h.job_id
GROUP BY h.batch_id;

UPDATE product_batches
SET received_cost_usd = (SELECT b.received_cost_usd FROM _batch_cost_backfill b WHERE b.batch_id = product_batches.id),
    updated_at = datetime('now')
WHERE id IN (SELECT batch_id FROM _batch_cost_backfill);

-- Every other lot -- manual receives, the catalog import's opening-stock
-- lots, and the handful of imported lots whose source row no longer resolves
-- to a product barcode -- keeps the only figure that exists for it. This is
-- the pre-0080 valuation, so nothing regresses; it simply stops being the
-- rule for the lots where the real per-receipt money IS known.
UPDATE product_batches
SET received_cost_usd = ROUND(received_quantity * unit_cost_usd, 4)
WHERE received_cost_usd IS NULL
  AND received_quantity IS NOT NULL
  AND unit_cost_usd IS NOT NULL;

DROP TABLE _batch_cost_backfill;
DROP INDEX _batch_cost_backfill_src_idx;
DROP TABLE _batch_cost_backfill_src;
