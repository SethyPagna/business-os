-- Lane 6.0.938 census: products whose stored barcode still holds Khmer digits (U+17E0-U+17E9).
-- READ-ONLY: one row of counts, no names, codes or ids.
-- Every barcode write now stores ASCII digits (a scanner gun on the Windows Khmer keyboard layout types them),
-- but rows saved before that still hold the Khmer numerals. Rewriting them is a separate production write that
-- needs these counts and an owner decision; this query rewrites nothing.
--   khmer_digit_products       products with any Khmer digit in barcode
--   khmer_digit_active         of those, the active ones
--   collide_with_ascii         of those, rows whose barcode folded to ASCII digits (nothing else changed) EQUALS
--                              another product's stored barcode, so the rewrite would make a shared code
--   collide_same_name          of those, the other product also has the same name_key: after the rewrite the pair
--                              is the same name + same barcode, the exact twin the product-merge tool exists for
--   collide_active_same_name   of those, both rows active (what a reviewer would have to merge)
--   fold_same_among_khmer      Khmer-digit rows sharing one folded barcode with another Khmer-digit row
--   checked_at_utc             when this ran
-- A leading-zero twin ('0334...' beside '334...') is not counted: exact folded text only, because the
-- leading-zero identity fold is not expressible as an indexed lookup. Cost: one pass over products for the GLOB
-- (barcode has no index usable for a contains test), then one indexed barcode lookup per Khmer-digit row.
-- The fold is ten REPLACE() calls, the same 0-9 mapping as lib/searchMatch.ts foldNativeDigits.
-- Paired test: cloudflare/scripts/test-barcode-write-fold-pure.cjs
-- ops:min-rows 1
-- ops:max-rows 1
WITH k AS MATERIALIZED (
  SELECT id, name_key, is_active, barcode,
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(barcode,
      '០', '0'), '១', '1'), '២', '2'), '៣', '3'), '៤', '4'), '៥', '5'), '៦', '6'), '៧', '7'), '៨', '8'), '៩', '9') AS folded
  FROM products
  WHERE barcode GLOB '*[០១២៣៤៥៦៧៨៩]*'
), hit AS MATERIALIZED (
  SELECT k.id, k.is_active,
    EXISTS (SELECT 1 FROM products o WHERE o.barcode = k.folded AND o.id <> k.id) AS collides,
    EXISTS (SELECT 1 FROM products o WHERE o.barcode = k.folded AND o.id <> k.id
      AND o.name_key = k.name_key AND k.name_key <> '') AS same_name,
    EXISTS (SELECT 1 FROM products o WHERE o.barcode = k.folded AND o.id <> k.id
      AND o.name_key = k.name_key AND k.name_key <> '' AND o.is_active = 1 AND k.is_active = 1) AS active_same_name,
    EXISTS (SELECT 1 FROM k other WHERE other.folded = k.folded AND other.id <> k.id) AS shares_fold
  FROM k
)
SELECT
  (SELECT COUNT(*) FROM k) AS khmer_digit_products,
  (SELECT COUNT(*) FROM k WHERE is_active = 1) AS khmer_digit_active,
  (SELECT COUNT(*) FROM hit WHERE collides) AS collide_with_ascii,
  (SELECT COUNT(*) FROM hit WHERE same_name) AS collide_same_name,
  (SELECT COUNT(*) FROM hit WHERE active_same_name) AS collide_active_same_name,
  (SELECT COUNT(*) FROM hit WHERE shares_fold) AS fold_same_among_khmer,
  datetime('now') AS checked_at_utc
