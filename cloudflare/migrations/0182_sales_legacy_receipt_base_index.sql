-- Expression index so "which sale does this legacy AR/AP invoice number
-- belong to" (P11-11, cloudflare/src/routes/contacts.ts's /customers/reports/
-- ar-invoices) can SEEK instead of scanning every one of sales' 15k+ legacy
-- rows for each of the (up to) 13,304 customer_receivables rows on a page.
--
-- sales.legacy_receipt_number carries either the retired old-system label
-- 'NNNNNN@YYYY-MM-DD' (migration 0107) or, for a sale created after that
-- rewrite, the bare business-format receipt number with no '@' at all.
-- customer_receivables.invoice_no is always the bare number. Matching
-- therefore needs the "base number" (the part before '@', or the whole
-- string when there is none) -- and idx_sales_legacy_receipt_number (0107)
-- indexes the RAW column, so an OR/LIKE-based match on it degrades to a full
-- index SCAN (verified: EXPLAIN QUERY PLAN on a local migrated copy shows
-- "SCAN s USING COVERING INDEX idx_sales_legacy_receipt_number" for an OR of
-- an exact match and a LIKE 'base@%' pattern, since the LIKE prefix is
-- per-row/correlated, not a literal SQLite can range-scan).
--
-- This expression index lets `(CASE WHEN instr(legacy_receipt_number,'@') > 0
-- THEN substr(legacy_receipt_number, 1, instr(legacy_receipt_number,'@') - 1)
-- ELSE legacy_receipt_number END) = @baseNumber` SEEK directly (verified:
-- "SEARCH s USING INDEX idx_sales_legacy_receipt_base" on the same local
-- copy) -- the call site must use this EXACT expression (same functions,
-- same argument order) for SQLite to recognize it as the indexed one.
--
-- Purely additive: a new index on an existing column, no data changed, no
-- existing query's plan can regress (nothing before this migration used this
-- expression).
--
-- PRE ASSERTION: none needed -- CREATE INDEX IF NOT EXISTS is idempotent and
-- changes no row.
-- POST ASSERTION:
--   SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_sales_legacy_receipt_base';
--   -- expected: 1
--
-- RECOVERY: DROP INDEX IF EXISTS idx_sales_legacy_receipt_base; -- purely
-- additive, so dropping it only removes the seek path, never any data.

CREATE INDEX IF NOT EXISTS idx_sales_legacy_receipt_base
  ON sales (
    CASE WHEN instr(legacy_receipt_number, '@') > 0
         THEN substr(legacy_receipt_number, 1, instr(legacy_receipt_number, '@') - 1)
         ELSE legacy_receipt_number END
  );
