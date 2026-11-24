-- G38 S1 pre-deploy check for migration 0321 (portal_accounts rebuild). One row of flags and counts, read-only.
-- Run BEFORE the deploy that carries 0321:
--   age_column_missing       must be 0 (0262 applied: the age confirmation column exists and 0321 will carry it);
--   duplicate_contact_links  must be 0, or 0321 stops itself (two storefront accounts on one customer is a staff decision first);
--   g38_columns_present      must be 0 (0321 not applied yet: no member_code, link_version or created_contact_id);
--   account_rows, max_id, sequence_above_max_id (1 means an id above MAX(id) was removed once; 0321 keeps the mark)
--                            and age_confirmed_rows: record them, the post-check compares.
-- The 15-column count is not read here (the ops guard forbids pragma functions): 0321's own first guard,
-- columns_known_15, refuses to run on any other count, before it changes anything.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero age_column_missing,duplicate_contact_links,g38_columns_present
-- Ceiling: 1,626 rows read on the seed (0 accounts: nearly all of it is the schema text read from sqlite_master) plus 4 reads per account (the duplicate-link, count, max and age scans) for up to 2,500 accounts, rounded up. Leang has 0 accounts.
-- ops:max-rows-read 12000
WITH shape AS (SELECT sql AS table_sql FROM sqlite_master WHERE type = 'table' AND name = 'portal_accounts')
SELECT
  (SELECT CASE WHEN instr(table_sql, 'age_confirmed_at') > 0 THEN 0 ELSE 1 END FROM shape) AS age_column_missing,
  (SELECT COUNT(*) FROM (
    SELECT contact_id FROM portal_accounts WHERE contact_id IS NOT NULL GROUP BY contact_id HAVING COUNT(*) > 1
  )) AS duplicate_contact_links,
  (SELECT (instr(table_sql, 'member_code') > 0) + (instr(table_sql, 'link_version') > 0) + (instr(table_sql, 'created_contact_id') > 0) FROM shape) AS g38_columns_present,
  (SELECT COUNT(*) FROM portal_accounts) AS account_rows,
  (SELECT COALESCE(MAX(id), 0) FROM portal_accounts) AS max_id,
  (SELECT CASE WHEN COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'portal_accounts'), 0)
    > COALESCE((SELECT MAX(id) FROM portal_accounts), 0) THEN 1 ELSE 0 END) AS sequence_above_max_id,
  (SELECT COUNT(*) FROM portal_accounts WHERE age_confirmed_at IS NOT NULL) AS age_confirmed_rows;
