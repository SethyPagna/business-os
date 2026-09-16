-- 0111: the tier the app called "VIP" was never a VIP price -- it is the
-- WHOLESALE (បោះដុំ) price, and has been since the data was imported. The
-- shop owner ruled on this 2026-09-04: "the current VIP price is actually
-- wholesale price...so delete VIP price, make it wholesale price".
--
-- This is therefore a DATA MOVE, not a rename. 0093 added
-- wholesale_price_usd/khr defaulting to 0 and nothing has ever written
-- them; the real numbers sit in special_price_usd/khr. Surveyed against
-- production (SELECT-only) on 2026-09-04, 10,272 product rows:
--
--   special_price_* non-zero (the "VIP" tier) .................. 9,552
--   wholesale_price_* non-zero ..................................... 0
--   rows carrying BOTH ............................................. 0
--
-- Zero rows carry both, so the move is unambiguous -- there is no pair of
-- rival numbers to choose between and nothing to ask the owner about.
--
-- The numbers also corroborate the ruling rather than merely permitting it:
-- of the 9,552, exactly 9,546 are BELOW that product's selling price and
-- only 2 equal it. A discount tier applied to virtually every product in
-- the catalogue is a wholesale book, not a VIP perk.
--
-- (That "only 2 equal selling" check was not idle. frontend's
-- buildProductWritePayload() defaults special_price_usd to
-- selling_price_usd when a snapshot omits it, so some of the 9,552 could
-- have been write-path artefacts rather than real prices. Two rows out of
-- 9,552 says the defaulting never meaningfully polluted the column, so the
-- whole set is safe to carry across. The offending client-side defaults are
-- removed in the same commit as this migration.)
--
-- WHY special_price_usd/khr ARE KEPT (ZEROED) AND NOT DROPPED
-- ----------------------------------------------------------
-- The owner said "delete VIP price", and every VIP surface, label and code
-- path IS deleted in this change. What is deliberately not deleted is the
-- two now-empty columns, for three reasons, the third decisive:
--
--   1. In SQLite/D1 an ALTER TABLE ... DROP COLUMN rewrites the whole
--      table. `products` is the largest table in a 166 MB production
--      database; plain SELECT aggregates over it already tripped D1's CPU
--      time limit twice while surveying for this migration. A full rewrite
--      is a real deploy hazard for no functional gain.
--   2. While the column still exists, this move is reversible. Once the
--      column is dropped, the copy below is the only surviving record of
--      9,552 prices.
--   3. Decisive: lib/productWrites.ts's cleanPayload() persists any request
--      body key matching a real table column. This app is a PWA whose till
--      tabs stay open for days (hence the "Restart now" update bar), so
--      older clients WILL keep POSTing special_price_usd after this ships.
--      Against a kept column that write lands as a harmless 0 and is
--      ignored by every reader. Against a DROPPED column it is an unknown
--      column and the whole product save fails -- a stale tab would lose
--      the ability to edit products at all.
--
-- So the columns stay as inert, zeroed ballast. They are read by nothing
-- after this change: no index, trigger or view references them (verified
-- against sqlite_master in production), and every SELECT list, form,
-- importer, exporter and POS path that named them is updated in this same
-- commit. A later migration may drop them once no client old enough to
-- send them can still be running.

-- Carry the wholesale numbers to the column that says what they mean.
-- Guarded on the wholesale side being empty so this can never overwrite a
-- real wholesale price if one is somehow written between survey and deploy.
UPDATE products
   SET wholesale_price_usd = special_price_usd
 WHERE COALESCE(special_price_usd, 0) <> 0
   AND COALESCE(wholesale_price_usd, 0) = 0;

UPDATE products
   SET wholesale_price_khr = special_price_khr
 WHERE COALESCE(special_price_khr, 0) <> 0
   AND COALESCE(wholesale_price_khr, 0) = 0;

-- Retire the VIP tier. The columns remain (see above); their meaning does
-- not. Scoped so the statement only touches rows that actually held a
-- value rather than rewriting all 10,272.
UPDATE products
   SET special_price_usd = 0
 WHERE COALESCE(special_price_usd, 0) <> 0;

UPDATE products
   SET special_price_khr = 0
 WHERE COALESCE(special_price_khr, 0) <> 0;
