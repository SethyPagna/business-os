-- Put every sales receipt number back into the project's own format.
--
-- WHAT WENT WRONG.  On 2026-09-02 an out-of-band reconciliation pack (the
-- untracked tmp/latest-data-reconcile/zero-error-migration.sql in the main
-- checkout -- a generated bulk DELETE+INSERT over `sales`, not a committed
-- migration) rewrote 15,004 of the 15,005 rows in `sales.receipt_number` to
-- the OLD SYSTEM's invoice label `NNNNNN@YYYY-MM-DD`, e.g. `004434@2026-09-02`.
-- Because it replaced whole rows it also took 87 of that week's 88 live POS
-- receipts with it; only one sale kept a real id.  The user's rule (Sep 2
-- 2026): "receipt numbers must be changed according to our system format, not
-- nnnnn@yyyymmdd; it must be yyyymmdd-24hour format".
--
-- WHAT THIS DOES.  Every row whose receipt_number still has the `@` shape is
-- relabelled to `YYYYMMDD-HHMMSS` derived from that sale's OWN created_at,
-- rendered in the business timezone (Asia/Phnom_Penh = UTC+07:00, no DST) --
-- exactly what lib/receiptNumber.ts's businessDateTimeId() would have minted
-- at that moment.  Verified against production: `004434@2026-09-02` with
-- created_at `2026-09-02T09:42:28.000Z` becomes `20260902-164228`.
--
-- created_at FORMATS.  Production holds two, and SQLite's datetime() parses
-- both without help (verified, not assumed, on SQLite 3.53.4 and against the
-- production copy):
--   `2026-09-02T09:42:28.000Z`  ISO with T and Z + milliseconds -- 15,004 rows
--                               (every row the reconciliation wrote)
--   `2026-09-01 06:44:55`       CURRENT_TIMESTAMP's shape -- the surviving row
-- A row whose created_at datetime() cannot parse is LEFT ALONE (the guard in
-- the CTE): a receipt with a wrong label is a nuisance, a receipt overwritten
-- with NULL is lost data.
--
-- COLLISIONS.  receipt_number carries no UNIQUE index (deliberate -- see
-- lib/receiptNumber.ts), so two sales in the same business second would
-- otherwise both derive the same label.  The app's own scheme is used: the
-- first row keeps the bare id, later ones take -2, -3, ... ordered by id, so
-- the outcome is deterministic and re-derivable.  `taken` looks at the rows
-- NOT being rewritten that already hold this base (or base-N) and starts the
-- run strictly above the highest index they use, so a repair can never
-- collide with a live POS receipt.  Measured on production 2026-09-03: zero
-- same-second groups among all 15,005 rows, so in practice no suffix is
-- minted at all -- the scheme is the safety net, not the normal path.
--
-- NOTHING IS LOST.  The old label moves to sales.legacy_receipt_number before
-- the rewrite, in FULL (`004434@2026-09-02`, not just the `004434` counter).
-- The full string is load-bearing: legacy_sale_item_corrections.receipt_number
-- (36,037 rows) and legacy_sale_date_corrections.receipt_number (15,100 rows)
-- are the source-backed audit trail for the old-system migration and join to
-- sales on exactly that string -- 14,982 of them matched before this ran.
-- Keeping the whole label keeps those joins, and keeps the number a cashier
-- reads off an old paper receipt searchable (routes/sales.ts folds the column
-- into the sales search haystack).
--
-- IDEMPOTENCE.  Every data statement is a no-op on a second run: after the
-- rewrite no row matches the `@` GLOB, and legacy_receipt_number is only
-- written where it is still NULL.  The ALTER is plain ADD COLUMN (SQLite has
-- no IF NOT EXISTS for it, and this is the house style -- see 0082, 0099,
-- 0106); D1's d1_migrations ledger is what stops it running twice.
--
-- THE `@` FORM ITSELF is now refused at the door: routes/sales.ts runs any
-- client-supplied receipt_number through normalizeClientReceiptNumber() and
-- mints its own when the shape is not ours.

ALTER TABLE sales ADD COLUMN legacy_receipt_number TEXT;

-- Also the index the mint-time uniqueness probe has always wanted:
-- `SELECT 1 FROM sales WHERE receipt_number = ?` runs on EVERY checkout and
-- was a full table scan over 15k rows.  The repair below needs it too (its
-- `taken` sub-select is a range seek on this index, not a 15k x 15k scan).
CREATE INDEX IF NOT EXISTS idx_sales_receipt_number ON sales(receipt_number);
CREATE INDEX IF NOT EXISTS idx_sales_legacy_receipt_number ON sales(legacy_receipt_number);

-- 1. Preserve the old label.  Separate statement, and guarded on NULL, so a
--    rerun can never overwrite a preserved value with a repaired one.
UPDATE sales
   SET legacy_receipt_number = receipt_number
 WHERE legacy_receipt_number IS NULL
   AND receipt_number GLOB '[0-9]*@[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';

-- 2. Relabel.  base = the sale's own moment in Phnom Penh wall-clock time;
--    seq = position among same-base rows being rewritten, ordered by id;
--    taken = the highest suffix index already used by a row NOT being
--    rewritten (0 when the base is free).  The range predicate
--    `>= base AND < base || '.'` covers `base` and every `base-...` while
--    staying an index seek ('-' 0x2D sorts below '.' 0x2E).
WITH cand AS (
  SELECT id,
         strftime('%Y%m%d-%H%M%S', datetime(created_at, '+7 hours')) AS base
    FROM sales
   WHERE receipt_number GLOB '[0-9]*@[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
     AND datetime(created_at, '+7 hours') IS NOT NULL
), ranked AS MATERIALIZED (
  -- MATERIALIZED, not a hint you can drop: `taken` reads the very table this
  -- statement writes.  Forcing the CTE into a transient table means every
  -- index is decided from the PRE-update state, so the result cannot depend
  -- on the order SQLite happens to visit rows in.
  SELECT c.id,
         c.base,
         ROW_NUMBER() OVER (PARTITION BY c.base ORDER BY c.id) AS seq,
         COALESCE((
           SELECT MAX(CASE
                        WHEN k.receipt_number = c.base THEN 1
                        WHEN k.receipt_number GLOB c.base || '-[0-9]*'
                          THEN CAST(substr(k.receipt_number, length(c.base) + 2) AS INTEGER)
                        ELSE 1
                      END)
             FROM sales k
            WHERE k.receipt_number >= c.base
              AND k.receipt_number < c.base || '.'
         ), 0) AS taken
    FROM cand c
), final AS MATERIALIZED (
  SELECT id,
         CASE WHEN taken + seq = 1 THEN base ELSE base || '-' || (taken + seq) END AS new_number
    FROM ranked
)
--
--    UPDATE ... FROM (SQLite >= 3.33, supported by D1), NOT
--    `SET receipt_number = (SELECT new_number FROM final WHERE final.id =
--    sales.id) WHERE id IN (SELECT id FROM final)`.  That correlated-scalar
--    form is a CPU trap and was the first draft of this migration: SQLite
--    builds NO automatic index on a MATERIALIZED CTE, so EXPLAIN QUERY PLAN
--    showed `CORRELATED SCALAR SUBQUERY -> SCAN final` -- a full scan of the
--    15,004-row CTE for each of the 15,004 rows updated, ~225M row visits.
--    Measured on a local copy of production: 30,220 ms for the correlated
--    form vs 1,953 ms this way, 15.5x.  Thirty seconds of single-statement
--    CPU is what trips remote D1's per-statement limit ("exceeded its CPU
--    time limit and was reset", code 7429), and a migration that dies HERE
--    dies half-applied -- the ALTER and both indexes are already committed
--    by then.  The plan below is one pass over `final` plus one rowid seek:
--      SCAN final
--      SEARCH sales USING INTEGER PRIMARY KEY (rowid=?)
UPDATE sales
   SET receipt_number = final.new_number
  FROM final
 WHERE final.id = sales.id;

-- 3. Follow the label onto the denormalized copy a return keeps of the sale
--    it refunds, so a repaired sale and its return never disagree about the
--    receipt they name.  (Production holds 0 returns today; this is here so
--    the repair stays correct whenever one exists.)
UPDATE returns
   SET receipt_number = (SELECT s.receipt_number FROM sales s WHERE s.id = returns.sale_id)
 WHERE sale_id IS NOT NULL
   AND receipt_number GLOB '[0-9]*@[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
   AND EXISTS (
         SELECT 1 FROM sales s
          WHERE s.id = returns.sale_id
            AND s.legacy_receipt_number = returns.receipt_number
       );
