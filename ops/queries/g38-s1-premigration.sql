-- G38 S1 pre-deploy check for migration 0321 (portal_accounts rebuild). One row of flags and counts, read-only.
-- Run BEFORE the deploy that carries 0321:
--   column_count             must be 15 (0321 refuses to run on any other count, so a new column is never dropped);
--   duplicate_contact_links  must be 0, or 0321 stops itself (two storefront accounts on one customer is a staff decision first);
--   g38_columns_present      must be 0 (0321 not applied yet);
--   account_rows, max_id, sequence_above_max_id (1 means an id above MAX(id) was removed once; 0321 keeps the mark)
--                            and age_confirmed_rows: record them, the post-check compares.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero duplicate_contact_links,g38_columns_present
SELECT
  (SELECT COUNT(*) FROM pragma_table_info('portal_accounts')) AS column_count,
  (SELECT COUNT(*) FROM (
    SELECT contact_id FROM portal_accounts WHERE contact_id IS NOT NULL GROUP BY contact_id HAVING COUNT(*) > 1
  )) AS duplicate_contact_links,
  (SELECT COUNT(*) FROM pragma_table_info('portal_accounts') WHERE name IN ('member_code', 'status', 'link_version')) AS g38_columns_present,
  (SELECT COUNT(*) FROM portal_accounts) AS account_rows,
  (SELECT COALESCE(MAX(id), 0) FROM portal_accounts) AS max_id,
  (SELECT CASE WHEN COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'portal_accounts'), 0)
    > COALESCE((SELECT MAX(id) FROM portal_accounts), 0) THEN 1 ELSE 0 END) AS sequence_above_max_id,
  (SELECT COUNT(*) FROM portal_accounts WHERE age_confirmed_at IS NOT NULL) AS age_confirmed_rows;
