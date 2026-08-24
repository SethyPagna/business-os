-- membership_number uniqueness was app-layer-only (import engine's
-- usedMembershipNumbers set, routes/contacts.ts's generateMembershipNumber
-- loop) -- both check-then-write, so two concurrent writers (two import
-- jobs, or an import racing a manual create/edit) could still land on the
-- same number. This adds a real DB-level constraint as the backstop.
--
-- Partial + on lower(membership_number) so it matches how the app already
-- treats the column: case-insensitive (see byMembership matching and
-- idx_customers_membership_lower_pg in 0001_init.sql), and blank/NULL
-- customers (never assigned one, or a legacy row from before this column
-- existed) don't collide with each other.
--
-- Before applying against a real database with existing data, check for
-- pre-existing duplicates first -- this statement will fail loudly (not
-- silently skip) if any are found:
--   SELECT lower(membership_number) AS number, COUNT(*) AS n
--   FROM customers
--   WHERE membership_number IS NOT NULL AND TRIM(membership_number) != ''
--   GROUP BY lower(membership_number)
--   HAVING COUNT(*) > 1;
-- Resolve any rows that query returns (merge the duplicate customers, or
-- clear/reassign one side's number) before this migration will apply.

DROP INDEX IF EXISTS idx_customers_membership_lower_pg;

CREATE UNIQUE INDEX idx_customers_membership_lower_pg
  ON customers (lower(membership_number))
  WHERE membership_number IS NOT NULL AND TRIM(membership_number) != '';
