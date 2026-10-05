-- G38 Phase 1 pre-deploy check for migrations 0230 (portal_accounts rebuild) and 0231 (member link history).
-- One row of flags and counts, read-only. Run BEFORE the deploy that carries 0230:
--   duplicate_contact_links  must be 0, or 0230 stops itself (guard no_duplicate_contact_links);
--                            two storefront accounts on one customer is a staff decision first.
--   g38_columns_present      must be 0 (0230 not applied yet).
--   g38_tables_present       must be 0 (0231 not applied yet).
--   sequence_above_max_id    1 means an account id above MAX(id) was removed once; 0230 keeps the mark.
--   links_to_missing_customers / links_to_marked_customers  accounts that will show the
--                            customer_unavailable conflict in Contacts > Members after the deploy.
--   linked_accounts          the number of legacy_import events 0231 will write.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero duplicate_contact_links,g38_columns_present,g38_tables_present
SELECT
  (SELECT COUNT(*) FROM (
    SELECT contact_id FROM portal_accounts WHERE contact_id IS NOT NULL GROUP BY contact_id HAVING COUNT(*) > 1
  )) AS duplicate_contact_links,
  (SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'table' AND name = 'portal_accounts' AND (sql LIKE '%member_code%' OR sql LIKE '%link_version%')) AS g38_columns_present,
  (SELECT COUNT(*) FROM sqlite_master
    WHERE name IN ('portal_member_link_events', 'portal_member_link_requests')) AS g38_tables_present,
  (SELECT CASE WHEN COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'portal_accounts'), 0)
    > COALESCE((SELECT MAX(id) FROM portal_accounts), 0) THEN 1 ELSE 0 END) AS sequence_above_max_id,
  (SELECT COUNT(*) FROM portal_accounts a
    WHERE a.contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = a.contact_id)) AS links_to_missing_customers,
  (SELECT COUNT(*) FROM portal_accounts a JOIN customers c ON c.id = a.contact_id
    WHERE COALESCE(c.is_anonymous, 0) = 1) AS links_to_marked_customers,
  (SELECT COUNT(*) FROM portal_accounts WHERE contact_id IS NOT NULL) AS linked_accounts;
