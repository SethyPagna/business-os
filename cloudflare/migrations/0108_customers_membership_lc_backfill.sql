-- Every customer carries a membership number, in one house format.
--
-- The house format is `LC-#####` (Leang Cosmetic): the prefix `LC-` and a
-- zero-padded sequence, gap-filling -- the smallest free number is handed out
-- first, so a number freed by a deleted or merged customer is reused before
-- the sequence grows. lib/membershipNumber.ts is the one minter that produces
-- this shape for every new customer (manual add, spreadsheet import,
-- storefront signup); this migration brings the rows that already exist onto
-- the same sequence.
--
-- Survey of production (SELECT-only, 2026-09-04, wrangler --remote):
--   customers                                   4966
--   with any membership_number                     0
--   with the legacy random `LCMN-` prefix           0
--   duplicate membership numbers                    0
--   portal_accounts rows (mirror membership_id)     0
-- So in production this is a pure backfill of 4966 NULLs to LC-00001 ..
-- LC-04966 in id order (oldest customer first). The LCMN- re-prefix branch
-- below matters only for a dev/staging database that minted numbers under the
-- old random generator; it exists so every environment converges on one
-- format rather than carrying two forever.
--
-- Uniqueness is already enforced by migration 0015's partial UNIQUE index
-- idx_customers_membership_lower_pg on lower(membership_number). This
-- statement can therefore only fail loudly, never silently double-assign.
--
-- Assignment rule, in order:
--   * "taken"  = rows that ALREADY carry a valid `LC-<digits>` number. They
--                are left untouched and their sequence numbers are reserved.
--   * "needy"  = every other row -- NULL, blank, or a non-house number such as
--                a legacy `LCMN-...`. Ordered by id, so the oldest customer
--                gets the lowest free number.
--   * "free"   = 1, 2, 3, ... minus the taken sequences. The cap is
--                count(customers) + max(taken sequence), which is always at
--                least as many free numbers as there are needy rows.
-- Padding keeps the natural width past 5 digits (LC-100000), never truncates.

WITH RECURSIVE
taken(seq) AS (
  SELECT CAST(substr(membership_number, 4) AS INTEGER)
  FROM customers
  WHERE membership_number GLOB 'LC-[0-9]*'
    AND membership_number NOT GLOB 'LC-*[^0-9]*'
    AND CAST(substr(membership_number, 4) AS INTEGER) >= 1
),
cap(n) AS (
  SELECT (SELECT COUNT(*) FROM customers) + (SELECT COALESCE(MAX(seq), 0) FROM taken)
),
candidates(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM candidates WHERE n < (SELECT n FROM cap)
),
free(seq, rn) AS (
  SELECT n, ROW_NUMBER() OVER (ORDER BY n)
  FROM candidates
  WHERE n NOT IN (SELECT seq FROM taken)
),
needy(id, rn) AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id)
  FROM customers
  WHERE membership_number IS NULL
     OR TRIM(membership_number) = ''
     OR NOT (membership_number GLOB 'LC-[0-9]*'
             AND membership_number NOT GLOB 'LC-*[^0-9]*'
             AND CAST(substr(membership_number, 4) AS INTEGER) >= 1)
),
assignment(id, seq) AS (
  SELECT needy.id, free.seq FROM needy JOIN free ON free.rn = needy.rn
)
UPDATE customers
SET membership_number = (
      SELECT 'LC-' || CASE
        WHEN length(CAST(assignment.seq AS TEXT)) >= 5 THEN CAST(assignment.seq AS TEXT)
        ELSE substr('00000', 1, 5 - length(CAST(assignment.seq AS TEXT))) || CAST(assignment.seq AS TEXT)
      END
      FROM assignment WHERE assignment.id = customers.id
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT id FROM assignment);
