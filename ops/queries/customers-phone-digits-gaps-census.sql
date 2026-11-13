-- customers-phone-digits-gaps-census: the two legacy shapes the digits index (migration 0302) cannot show, so a duplicate-check by number would miss their owner.
-- Read-only, one row of counts (no name, phone or id is returned).
--   numeric_option_phones   customers with a Contact Option phone stored as a JSON number (integer / real): the view reads text only. No current writer stores one;
--                           only a legacy row, a restore or raw SQL could.
--   options_beyond_first3   customers with a phone on a raw option at position 3 or later while one of the raw positions 0-2 carries no data: the classifier keeps the
--                           first 3 options that carry data (lib/contactOptions.ts collectNormalizedContactOptions) and so sees that phone, the view keeps raw positions 0-2 and does not.
-- Expected 0 and 0 today (ops:expect-zero fails the run on a non-zero, D10). A non-zero is a writer to find (the POST write guard still refuses such a number, so the customer-create path answers 409 rather than a 500).
-- POST (after a deploy, after a bulk import and after a restore): watch both. RECOVERY if non-zero: rewrite the customer's address JSON (phone as text, empty options removed); the 0302 triggers re-index it.
-- Cost: one pass over customers with one json_each per customer.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero numeric_option_phones,options_beyond_first3
-- ops:max-rows-read 45444
SELECT
  (SELECT COUNT(*) FROM customers c WHERE json_valid(c.address) AND json_type(c.address) = 'array'
    AND EXISTS (SELECT 1 FROM json_each(c.address) o WHERE o.type = 'object' AND json_type(o.value, '$.phone') IN ('integer', 'real'))) AS numeric_option_phones,
  (SELECT COUNT(*) FROM customers c WHERE json_valid(c.address) AND json_type(c.address) = 'array'
    AND EXISTS (SELECT 1 FROM json_each(c.address) o WHERE CAST(o.key AS INTEGER) >= 3 AND o.type = 'object' AND json_type(o.value, '$.phone') = 'text' AND trim(json_extract(o.value, '$.phone')) <> '')
    AND (SELECT COUNT(*) FROM json_each(c.address) q WHERE CAST(q.key AS INTEGER) BETWEEN 0 AND 2 AND q.type = 'object'
      AND (trim(COALESCE(json_extract(q.value, '$.label'), '')) <> '' OR trim(COALESCE(json_extract(q.value, '$.name'), '')) <> '' OR trim(COALESCE(json_extract(q.value, '$.phone'), '')) <> ''
        OR trim(COALESCE(json_extract(q.value, '$.email'), '')) <> '' OR trim(COALESCE(json_extract(q.value, '$.address'), '')) <> '')) < 3) AS options_beyond_first3
