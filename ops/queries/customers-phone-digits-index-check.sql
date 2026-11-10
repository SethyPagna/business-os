-- customers-phone-digits-index-check: the index of migration 0302 (customers_phone_digits_fts) against the one definition it is built from (customers_phone_digits_v).
-- Read-only, counts only (no name, phone or id is returned).
-- PRE (run after the migration is applied, before the Worker that reads it ships): missing = 0, stale = 0, orphaned = 0, and indexed equals customers.
-- POST (after the deploy and again after a bulk import, a merge or a restore): the same three zeros. The triggers keep the index exact on every writer, so a non-zero is a writer that bypassed them.
--   missing   customers with no document: a search by number can never find them
--   stale     customers whose document differs from the view (a phone, an address or the cached key changed without the trigger)
--   orphaned  documents of a customer that no longer exists
-- RECOVERY when any is non-zero (derived data, nothing to restore): in a maintenance window run the rebuild named in migrations/0302_customers_phone_digits_fts.sql:
--   DELETE FROM customers_phone_digits_fts; INSERT INTO customers_phone_digits_fts(rowid, digits) SELECT id, digits FROM customers_phone_digits_v;
-- Cost: one pass over customers, one view row and one document probe per customer.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero missing,stale,orphaned
-- ops:max-rows-read 45444
SELECT
  (SELECT COUNT(*) FROM customers) AS customers,
  (SELECT COUNT(*) FROM customers_phone_digits_fts) AS indexed,
  (SELECT COUNT(*) FROM customers_phone_digits_v v LEFT JOIN customers_phone_digits_fts f ON f.rowid = v.id WHERE f.rowid IS NULL) AS missing,
  (SELECT COUNT(*) FROM customers_phone_digits_v v JOIN customers_phone_digits_fts f ON f.rowid = v.id WHERE f.digits <> v.digits) AS stale,
  (SELECT COUNT(*) FROM customers_phone_digits_fts f WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = f.rowid)) AS orphaned
