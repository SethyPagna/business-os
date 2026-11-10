-- Customer search miss census (read-only, SELECT only, counts only: no name, phone, e-mail or id is returned).
-- Owner report 10 Nov 2026: "some search of customers wasn't able to search even though certain that they existed".
-- Answers which stored shapes the Contacts / POS customer search could not reach before lane customer-search-miss:
--   customers                    profile rows (anonymous General rows excluded)
--   phone_with_separator         phone holds a space, dash, dot, bracket or plus: the word and trigram indexes cannot read its
--                                digits as one run, so a contiguous typed number missed it on the Contacts list
--   phone_digits_only            phone is bare digits (always found)
--   phone_blank                  no phone at all (found by name only)
--   phone_letters                phone holds a letter (legacy "Tel012..." text; found by its digit run only)
--   cache_stale                  phone_normalized differs from the digits of phone (folded 855 -> 0): a lookup by the cache column misses
--   cache_missing                phone has digits but phone_normalized is empty
--   option_phone_rows            address is a Contact Option array holding a phone member
--   name_is_number               name is wholly a phone number (read as empty by a no-grant digit word)
--   fts_word_unindexed           customers_fts holds no document for the row: no name or word search can ever find it
--   fts_trigram_unindexed        customers_fts_phone holds no document for the row
--   name_single_long_token       Latin name of one token of 7+ letters: reachable only from its first letters (word-prefix index),
--                                never by a middle fragment
--   checked_at_utc               when this ran
-- Proves: fts_*_unindexed > 0 is an index that drifted from the table (rebuild needed); cache_stale or cache_missing > 0 is a row the
-- phone_normalized lookup cannot find; phone_with_separator > 0 is the population the digit-run fix newly reaches.
-- Cost: about 4 reads per customer (about 20,000 on the 5,000-customer seed): one pass over customers, one primary-key probe per row into each FTS document-size table.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 22722
WITH d AS MATERIALIZED (
  SELECT id, name, COALESCE(phone, '') AS phone, COALESCE(phone_normalized, '') AS pn, address,
    replace(replace(replace(replace(replace(replace(COALESCE(phone, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), '+', '') AS digits
  FROM customers
  WHERE NOT (COALESCE(is_anonymous, 0) = 1)
)
SELECT
  COUNT(*) AS customers,
  SUM(phone GLOB '*[ ().+-]*') AS phone_with_separator,
  SUM(phone <> '' AND phone NOT GLOB '*[^0-9]*') AS phone_digits_only,
  SUM(trim(phone) = '') AS phone_blank,
  SUM(phone GLOB '*[A-Za-z]*') AS phone_letters,
  SUM(pn <> '' AND digits NOT GLOB '*[^0-9]*'
      AND pn <> CASE WHEN length(digits) IN (11, 12) AND digits LIKE '855%' THEN '0' || substr(digits, 4) ELSE digits END) AS cache_stale,
  SUM(pn = '' AND digits GLOB '*[0-9]*' AND digits NOT GLOB '*[^0-9]*') AS cache_missing,
  SUM(json_valid(address) AND json_type(address) = 'array' AND address LIKE '%"phone"%') AS option_phone_rows,
  SUM(length(digits) >= 8 AND digits NOT GLOB '*[^0-9]*' AND replace(replace(replace(replace(replace(replace(name, ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), '+', '') NOT GLOB '*[^0-9]*') AS name_is_number,
  SUM(NOT EXISTS (SELECT 1 FROM customers_fts_docsize f WHERE f.id = d.id)) AS fts_word_unindexed,
  SUM(NOT EXISTS (SELECT 1 FROM customers_fts_phone_docsize f WHERE f.id = d.id)) AS fts_trigram_unindexed,
  SUM(length(name) >= 7 AND name NOT GLOB '*[^A-Za-z]*') AS name_single_long_token,
  datetime('now') AS checked_at_utc
FROM d;
