-- Bring the last customers still carrying a non-house membership id back onto
-- the LC- sequence.
--
-- Owner (Sep 17 2026, P10-12): "customer still have old membership ids".
--
-- WHAT THOSE IDS ARE. lib/membershipNumber.ts is the one membership-number
-- authority and its format is `LC-#####`. Between Sep 5 and Sep 6 2026 a
-- change described as "mint secure IDs" replaced that sequence with eight
-- random A-Z0-9 characters for every NEWLY created customer; migration 0110
-- had already backfilled the existing population onto LC-, so only customers
-- created inside that two-day window got the random shape. The minting paths
-- were restored to LC- on Sep 6 (see membershipNumber.ts's own note), but the
-- rows created while the random path was live were never repaired. In
-- production that is exactly seven customers -- ids 24992, 24996, 24997,
-- 24999, 25000, 25002, 25003 -- out of 5,034.
--
-- WHY IT IS SAFE TO RENUMBER THEM.
--   * `portal_accounts` is EMPTY in production, so no storefront login is
--     keyed to one of these ids. (The two tables share one sequence; this
--     migration reads both when it picks numbers, so it stays correct if that
--     ever stops being true.)
--   * `customers_fts` is an external-content FTS5 index with AI/AD/AU
--     triggers on `customers`, so the UPDATE below re-indexes the row itself.
--   * `customer_share_submissions.membership_number` is the only other place
--     a membership number is denormalised; it is moved in the same migration.
--   * Nothing else joins on the text of a membership number: sales carry
--     `customer_id`.
--
-- WHY APPEND, NOT GAP-FILL. Gap-filling is the rule for MINTING a new number
-- (the smallest free slot). This is a repair of existing rows, and appending
-- after the current maximum can never collide with a slot a concurrent signup
-- is about to take, whereas a gap-fill computed here and applied a moment
-- later can. In production there are no gaps anyway: the house numbers run
-- 1..5027 unbroken, so these seven land on LC-05028..LC-05034 in customer-id
-- order -- the order the sequence would have given them had the random path
-- never existed.
--
-- REVERSIBILITY. `customer_membership_number_repair` keeps the old number
-- beside the new one for every row touched, so a single UPDATE joining that
-- table restores the previous state exactly. The mapping is computed in ONE
-- INSERT ... SELECT before any customer row changes, so the MAX it reads is
-- the pre-repair maximum and cannot drift while the UPDATE runs.
--
-- PRE ASSERTION (run read-only immediately before applying):
--   SELECT COUNT(*) FROM customers
--    WHERE COALESCE(trim(membership_number),'') <> ''
--      AND NOT (lower(trim(membership_number)) GLOB 'lc-[0-9]*'
--               AND lower(trim(membership_number)) NOT GLOB 'lc-*[^0-9]*');
--   -- expected: 7
-- POST ASSERTION (same query): expected 0, and
--   SELECT COUNT(*) FROM customer_membership_number_repair;  -- expected 7
--   SELECT COUNT(*) FROM (SELECT membership_number FROM customers
--     WHERE COALESCE(trim(membership_number),'') <> ''
--     GROUP BY lower(trim(membership_number)) HAVING COUNT(*) > 1);  -- expected 0

CREATE TABLE IF NOT EXISTS customer_membership_number_repair (
  customer_id INTEGER PRIMARY KEY,
  old_number TEXT NOT NULL,
  new_number TEXT NOT NULL,
  reason TEXT NOT NULL,
  applied_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- The mapping, computed once against the pre-repair state. `base.max_seq` is
-- the highest house sequence in EITHER store that shares it, so a portal
-- account with no customer row still reserves its slot. The pad grows past
-- five digits rather than truncating, matching formatMembershipNumber().
INSERT OR IGNORE INTO customer_membership_number_repair (customer_id, old_number, new_number, reason)
SELECT c.id,
       c.membership_number,
       'LC-' || CASE
         WHEN length(CAST(base.max_seq + ROW_NUMBER() OVER (ORDER BY c.id) AS TEXT)) >= 5
           THEN CAST(base.max_seq + ROW_NUMBER() OVER (ORDER BY c.id) AS TEXT)
         ELSE substr('00000' || CAST(base.max_seq + ROW_NUMBER() OVER (ORDER BY c.id) AS TEXT), -5)
       END,
       'legacy_membership_id_repair_2026_09_17'
FROM customers c
CROSS JOIN (
  SELECT MAX(seq) AS max_seq FROM (
    SELECT COALESCE(MAX(CAST(substr(trim(membership_number), 4) AS INTEGER)), 0) AS seq
      FROM customers
     WHERE lower(trim(membership_number)) GLOB 'lc-[0-9]*'
       AND lower(trim(membership_number)) NOT GLOB 'lc-*[^0-9]*'
    UNION ALL
    SELECT COALESCE(MAX(CAST(substr(trim(membership_id), 4) AS INTEGER)), 0)
      FROM portal_accounts
     WHERE lower(trim(membership_id)) GLOB 'lc-[0-9]*'
       AND lower(trim(membership_id)) NOT GLOB 'lc-*[^0-9]*'
  )
) base
WHERE COALESCE(trim(c.membership_number), '') <> ''
  AND NOT (lower(trim(c.membership_number)) GLOB 'lc-[0-9]*'
           AND lower(trim(c.membership_number)) NOT GLOB 'lc-*[^0-9]*');

-- The repair itself. Guarded by the mapping table, so re-running this
-- migration against an already-repaired database changes nothing.
UPDATE customers
   SET membership_number = (SELECT r.new_number FROM customer_membership_number_repair r WHERE r.customer_id = customers.id),
       updated_at = CURRENT_TIMESTAMP
 WHERE id IN (SELECT customer_id FROM customer_membership_number_repair)
   AND membership_number = (SELECT r.old_number FROM customer_membership_number_repair r WHERE r.customer_id = customers.id);

-- The one denormalised copy moves with it, or a share submission would still
-- quote an id its customer no longer has.
UPDATE customer_share_submissions
   SET membership_number = (SELECT r.new_number FROM customer_membership_number_repair r WHERE r.customer_id = customer_share_submissions.customer_id)
 WHERE customer_id IN (SELECT customer_id FROM customer_membership_number_repair)
   AND membership_number = (SELECT r.old_number FROM customer_membership_number_repair r WHERE r.customer_id = customer_share_submissions.customer_id);

INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, table_name, record_id, old_value, new_value)
SELECT NULL, 'migration:0178_legacy_membership_number_repair', 'repair_legacy_membership_number',
  'customer', CAST(r.customer_id AS TEXT),
  json_object('source', 'repair-0178', 'reason', r.reason),
  'customers', CAST(r.customer_id AS TEXT), r.old_number, r.new_number
FROM customer_membership_number_repair r
WHERE r.reason = 'legacy_membership_id_repair_2026_09_17'
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs l
    WHERE l.action = 'repair_legacy_membership_number' AND l.entity_id = CAST(r.customer_id AS TEXT)
  );
