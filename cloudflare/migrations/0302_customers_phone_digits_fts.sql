-- 0302: a trigram index over the digits of every customer's phones, so a typed number is found by an index SEARCH instead of a scan of every customer.
--
-- Since 6.0.1537 a typed number of 3 to 15 digits was compared as digits to the primary phone and to every Contact Option phone (JSON in customers.address) of EVERY
-- customer, because a number is stored with the separators it was saved with ("012 345 678", "+855 (12) 345-679", no-break spaces, Khmer digits) and neither customers_fts
-- (word tokens) nor customers_fts_phone (a trigram never spans a separator) can find its contiguous digits. That read the whole table on every search; this
-- makes the search proportional to the matches.
--
-- customers_phone_digits_v is the one definition of what a customer is searched by, two columns:
--   digits  the primary phone with every separator (space - ( ) . + tab line-feed carriage-return no-break-space) stripped and Khmer digits read as ASCII, then the same
--           stripping of the phone of each of the first three Contact Options (CONTACT_OPTION_LIMIT) of a valid JSON array, space-separated
--   key     the cached canonical key phone_normalized (855 folded to 0) between two = signs, so a query for the WHOLE key ("=012345678=") finds it and a fragment does not
-- customers_phone_digits_fts is an FTS5 trigram table over those two columns (a regular FTS5 table, so a row is replaced by rowid with no need to rebuild the old
-- document). Three triggers keep it exact on every writer (the app, a CSV import, merge, undo, restore): INSERT, UPDATE OF id / phone / address /
-- phone_normalized (only when one of them changed) and DELETE. Queries read it as id IN (SELECT rowid FROM customers_phone_digits_fts WHERE
-- customers_phone_digits_fts MATCH '{digits} : ("digits") OR {key} : ("=key=")').
--
-- PRE:  customers exists; the view, the table and the three triggers do not. A failed check reads a malformed JSON path and aborts the file.
-- POST: the table holds one row per customer, and the view, the table and the three triggers exist. customers is not changed.
-- Cost: one backfill write per customer plus its trigram postings (measured in scripts/test-migration-0302-customers-phone-digits-fts-native.cjs), and
-- afterwards a customer save that changes a phone, the address or the cached key rewrites its document; any other save writes nothing here.
-- Append-only, LF-only, generic (no client data), idempotent only through the PRE check (a second run aborts on the existing view).
-- A rowid table (an FTS5 table is never WITHOUT ROWID). The previous Worker never names the new objects and runs unchanged on the new schema.
-- Pinned by scripts/test-migration-0302-customers-phone-digits-fts-native.cjs; checked after a deploy by ops/queries/customers-phone-digits-index-check.sql.
--
-- RECOVERY: derived data only, nothing to restore. Remove the objects (the previous Worker does not need them), or rebuild a drifted index:
--   DROP TRIGGER IF EXISTS customers_phone_digits_ai;  DROP TRIGGER IF EXISTS customers_phone_digits_au;  DROP TRIGGER IF EXISTS customers_phone_digits_ad;
--   DROP TABLE IF EXISTS customers_phone_digits_fts;  DROP VIEW IF EXISTS customers_phone_digits_v;
--   Rebuild: DELETE FROM customers_phone_digits_fts; INSERT INTO customers_phone_digits_fts(rowid, digits, key) SELECT id, digits, key FROM customers_phone_digits_v;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'customers') = 1
  AND (SELECT COUNT(*) FROM sqlite_master WHERE name IN ('customers_phone_digits_v','customers_phone_digits_fts','customers_phone_digits_ai','customers_phone_digits_au','customers_phone_digits_ad')) = 0
THEN 1 ELSE json_extract('[]','$[customers_phone_digits_0302_pre]') END;

CREATE VIEW customers_phone_digits_v AS
SELECT c.id AS id,
  replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(COALESCE(c.phone,''),' ',''),'-',''),'(',''),')',''),'.',''),'+',''),char(9),''),char(10),''),char(13),''),char(6112),'0'),char(6113),'1'),char(6114),'2'),char(6115),'3'),char(6116),'4'),char(6117),'5'),char(6118),'6'),char(6119),'7'),char(6120),'8'),char(6121),'9'),char(160),'') || ' ' ||
  COALESCE((SELECT group_concat(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(option_phone,' ',''),'-',''),'(',''),')',''),'.',''),'+',''),char(9),''),char(10),''),char(13),''),char(6112),'0'),char(6113),'1'),char(6114),'2'),char(6115),'3'),char(6116),'4'),char(6117),'5'),char(6118),'6'),char(6119),'7'),char(6120),'8'),char(6121),'9'),char(160),''),' ') FROM (
    SELECT CASE WHEN json_type(CASE WHEN o.type='object' THEN o.value ELSE '{}' END,'$.phone')='text' THEN json_extract(CASE WHEN o.type='object' THEN o.value ELSE '{}' END,'$.phone') ELSE '' END AS option_phone
    FROM json_each(CASE WHEN json_valid(c.address) THEN CASE WHEN json_type(c.address)='array' THEN c.address ELSE '[]' END ELSE '[]' END) o
    WHERE CAST(o.key AS INTEGER) BETWEEN 0 AND 2)),'') AS digits,
  COALESCE('=' || NULLIF(c.phone_normalized,'') || '=','') AS key
FROM customers c;

CREATE VIRTUAL TABLE customers_phone_digits_fts USING fts5(digits, key, tokenize='trigram');

INSERT INTO customers_phone_digits_fts(rowid, digits, key) SELECT id, digits, key FROM customers_phone_digits_v;

CREATE TRIGGER customers_phone_digits_ai AFTER INSERT ON customers BEGIN
  INSERT INTO customers_phone_digits_fts(rowid, digits, key) SELECT id, digits, key FROM customers_phone_digits_v WHERE id = new.id;
END;

CREATE TRIGGER customers_phone_digits_au AFTER UPDATE OF id, phone, address, phone_normalized ON customers
WHEN old.id IS NOT new.id OR old.phone IS NOT new.phone OR old.address IS NOT new.address OR old.phone_normalized IS NOT new.phone_normalized BEGIN
  DELETE FROM customers_phone_digits_fts WHERE rowid = old.id;
  INSERT INTO customers_phone_digits_fts(rowid, digits, key) SELECT id, digits, key FROM customers_phone_digits_v WHERE id = new.id;
END;

CREATE TRIGGER customers_phone_digits_ad AFTER DELETE ON customers BEGIN
  DELETE FROM customers_phone_digits_fts WHERE rowid = old.id;
END;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE name IN ('customers_phone_digits_v','customers_phone_digits_fts','customers_phone_digits_ai','customers_phone_digits_au','customers_phone_digits_ad')) = 5
  AND (SELECT COUNT(*) FROM customers_phone_digits_fts) = (SELECT COUNT(*) FROM customers)
THEN 1 ELSE json_extract('[]','$[customers_phone_digits_0302_post]') END;
