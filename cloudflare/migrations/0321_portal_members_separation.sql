-- 0321 (G38 slice S1): website members become their own identity.
--
-- PURPOSE
--   A website member (portal_accounts row) is no longer a customer. Later sign-in methods have no phone, no
--   password and no store number, so this rebuilds portal_accounts in place. Every id, session, cart, consent
--   record and age confirmation survives. What changes:
--     * phone, password_hash and membership_id become NULL-able. membership_id keeps the LC-##### an existing
--       account was issued and is never written for a new member.
--     * member_code holds the random W-XXXX-XXXX Member ID. It starts NULL on every existing row and the Worker
--       mints it lazily (compare-and-set), because SQL cannot mint a code with a check character.
--     * status (active / suspended / closed), link_version (the compare-and-set counter every link change bumps),
--       created_contact_id (the customer the old sign-up itself created), last_seen_at and closed_at.
--     * last_seen_at is backfilled from the best evidence of activity (latest session, consent, update, creation).
--     * contact_id becomes UNIQUE where set: one member per customer.
--   The columns of portal_accounts at this migration are the 0087 columns, the three 0130 consent columns and
--   age_confirmed_at (0262): 15 in all. All 15 are carried. The first guard below refuses to run if the table has
--   any other column count, so a column added later cannot be dropped by this rebuild.
--   No table references portal_accounts by foreign key and no trigger or view names it, so the
--   create / copy / drop / rename below touches nothing else.
--
-- ORDER (designed for the worst case: remote D1 may run each statement on its own, so a stop between two
-- statements leaves the database in that state; nothing here relies on the file being one unit)
--   1. guard table, then every guard that can fire on the live data (columns_known_15, no_duplicate_contact_links);
--   2. DROP any leftover portal_accounts_0321_new (only after the guards, so a re-run on a database that is
--      already past step 5 is refused first and can never drop the only copy);
--   3. CREATE portal_accounts_0321_new, copy every row into it, hold the AUTOINCREMENT mark, and run every
--      verification guard (row_count_equal, old_columns_identical, age_confirmed_count_equal, sequence_preserved,
--      member_codes_unminted) against the two tables side by side. The live table is not touched so far;
--   4. the first statement that removes the old table: DROP TABLE portal_accounts;
--   5. ALTER TABLE portal_accounts_0321_new RENAME TO portal_accounts, the five indexes, DROP of the guard table.
--      None of these reads data, so none can fail on valid data.
--   A stop before step 4 loses nothing: portal_accounts is exactly as it was; fix the cause and run the file again.
--   A stop at step 4 or 5 has the rows in portal_accounts_0321_new: see RECOVERY.
--
-- PRE-ASSERTIONS (read-only; ops/queries/g38-s1-premigration.sql runs the data checks; the ops guard forbids
-- pragma functions, so the column count is enforced by this file's first guard, columns_known_15)
--   SELECT COUNT(*) AS account_rows, COALESCE(MAX(id), 0) AS max_id FROM portal_accounts;
--   SELECT seq FROM sqlite_sequence WHERE name = 'portal_accounts';        -- record it
--   SELECT COUNT(*) FROM portal_accounts WHERE age_confirmed_at IS NOT NULL;  -- record it
--   SELECT COUNT(*) FROM pragma_table_info('portal_accounts');             -- expect 15
--   SELECT COUNT(*) FROM pragma_table_info('portal_accounts')
--     WHERE name IN ('member_code', 'status', 'link_version');              -- expect 0
--   SELECT contact_id, COUNT(*) FROM portal_accounts WHERE contact_id IS NOT NULL
--     GROUP BY contact_id HAVING COUNT(*) > 1;                              -- expect no rows
--
-- IN-FILE ASSERTIONS (portal_members_guard_0321: a failed CHECK aborts the file at that statement):
--   columns_known_15             the table has exactly the 15 columns this file copies;
--   no_duplicate_contact_links   two accounts on one customer is a staff decision, so the file refuses to run;
--   row_count_equal              same number of rows after the copy;
--   old_columns_identical        every id and every old column value equal, both directions;
--   age_confirmed_count_equal    the same number of age confirmations after the copy;
--   sequence_preserved           the AUTOINCREMENT high-water mark did not go down;
--   member_codes_unminted        every member_code is NULL (lazy mint).
--
-- POST-ASSERTIONS (read-only)
--   SELECT COUNT(*), COALESCE(MAX(id), 0) FROM portal_accounts;            -- equal to pre
--   SELECT seq FROM sqlite_sequence WHERE name = 'portal_accounts';         -- >= pre
--   SELECT COUNT(*) FROM portal_accounts WHERE age_confirmed_at IS NOT NULL;  -- equal to pre
--   SELECT COUNT(*) FROM pragma_table_info('portal_accounts');             -- 21
--   SELECT COUNT(*) FROM portal_accounts WHERE member_code IS NOT NULL;     -- 0
--   SELECT COUNT(*) FROM portal_accounts WHERE status <> 'active' OR link_version <> 0;  -- 0
--   SELECT COUNT(*) FROM sqlite_master WHERE name IN ('idx_portal_accounts_phone',
--     'idx_portal_accounts_membership', 'idx_portal_accounts_member_code',
--     'idx_portal_accounts_contact', 'idx_portal_accounts_status_seen');     -- 5
--   SELECT COUNT(*) FROM sqlite_master WHERE name IN ('portal_accounts_0321_new', 'portal_members_guard_0321');  -- 0
--
-- RECOVERY IF THE FILE STOPS (each case is run by test-migration-0321-portal-members-separation-pure.cjs)
--   Take a D1 Time Travel bookmark BEFORE applying (7 days on Free).
--   Stop at any statement BEFORE `DROP TABLE portal_accounts;` (a guard fired, or an error in the copy):
--     portal_accounts is unchanged (15 columns, all rows, the 0087 indexes). Leftovers are harmless
--     (portal_members_guard_0321, portal_accounts_0321_new). Fix the cause and apply the file again: it clears
--     both leftovers itself. To clean up without re-running:
--       DROP TABLE IF EXISTS portal_accounts_0321_new;
--       DROP TABLE IF EXISTS portal_members_guard_0321;
--   Stop right AFTER `DROP TABLE portal_accounts;` (no portal_accounts table, every row in
--   portal_accounts_0321_new; applying the file again is refused by columns_known_15 and changes nothing):
--       ALTER TABLE portal_accounts_0321_new RENAME TO portal_accounts;
--     then the five CREATE INDEX statements at the end of this file, then
--       DROP TABLE IF EXISTS portal_members_guard_0321;
--   Stop after the rename (portal_accounts is the new table, some or all indexes missing): run the five
--   CREATE INDEX IF NOT EXISTS statements at the end of this file, then
--       DROP TABLE IF EXISTS portal_members_guard_0321;
--   DELETE FROM sqlite_sequence (before the DROP): removes only the zero-valued row of portal_accounts_0321_new, which
--   the copy INSERT leaves on an empty table. It is the first write to sqlite_sequence in this project's migrations.
--   If a database refuses it, the file stops before DROP TABLE portal_accounts: the old table is intact, but the same
--   database refuses the same statement again, so applying this file again is refused again. It can be applied again
--   only after the lead decides to remove that statement from the file (0321 is applied nowhere yet); accepting the
--   zero row is that decision. On Cloudflare D1 a failed migration is rolled back and the deploy stops before the
--   Worker is published.
--   After a complete apply: roll the Worker back first if needed. The previous Worker reads only columns that
--   still exist, but it would INSERT accounts with a NULL member_code and fail on NULL phone rows, so restore the
--   old shape with a forward file (append-only: never edit this one):
--     ALTER TABLE portal_accounts RENAME TO portal_accounts_0321_new;
--     CREATE TABLE portal_accounts (<0087, 0130 and 0262 columns, NOT NULL as before>);
--     INSERT INTO portal_accounts (<the 15 old columns, age_confirmed_at included>)
--       SELECT <the 15 old columns> FROM portal_accounts_0321_new
--       WHERE phone IS NOT NULL AND password_hash IS NOT NULL AND membership_id IS NOT NULL;
--     (sketch, still to add:) re-create the three 0087 indexes idx_portal_accounts_phone,
--       idx_portal_accounts_membership and idx_portal_accounts_contact; keep the AUTOINCREMENT high-water mark
--       (the new table's sqlite_sequence row must stay at or above the old one); then
--       DROP TABLE portal_accounts_0321_new;
--   Rows created by the new Worker (membership_id NULL) have no LC id and cannot live in the old shape: export
--   them first (SELECT * FROM portal_accounts WHERE membership_id IS NULL) and decide with the owner.

CREATE TABLE IF NOT EXISTS portal_members_guard_0321 (
  check_name TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);
DELETE FROM portal_members_guard_0321;

INSERT INTO portal_members_guard_0321 (check_name, ok)
SELECT 'columns_known_15', CASE WHEN (SELECT COUNT(*) FROM pragma_table_info('portal_accounts')) = 15 THEN 1 ELSE 0 END;

INSERT INTO portal_members_guard_0321 (check_name, ok)
SELECT 'no_duplicate_contact_links', CASE WHEN NOT EXISTS (
  SELECT contact_id FROM portal_accounts
  WHERE contact_id IS NOT NULL
  GROUP BY contact_id HAVING COUNT(*) > 1
) THEN 1 ELSE 0 END;

DROP TABLE IF EXISTS portal_accounts_0321_new;

CREATE TABLE portal_accounts_0321_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  membership_id TEXT,
  name TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT,
  email TEXT,
  contact_id INTEGER,
  cart_json TEXT,
  wishlist_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  consent_version TEXT,
  consent_at TEXT,
  consent_locale TEXT,
  age_confirmed_at TEXT,
  -- Native D1 refuses any LIKE/GLOB pattern over 50 bytes at run time ("LIKE or GLOB pattern too complex"),
  -- so the shape is fixed positions plus four two-character GLOBs of 36 bytes each (pinned by
  -- test-d1-pattern-limit-native.cjs).
  member_code TEXT CHECK (member_code IS NULL OR (
    length(member_code) = 11
    AND substr(member_code, 1, 2) = 'W-'
    AND substr(member_code, 7, 1) = '-'
    AND substr(member_code, 3, 2) GLOB '[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]'
    AND substr(member_code, 5, 2) GLOB '[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]'
    AND substr(member_code, 8, 2) GLOB '[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]'
    AND substr(member_code, 10, 2) GLOB '[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]'
  )),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  link_version INTEGER NOT NULL DEFAULT 0 CHECK (link_version >= 0),
  created_contact_id INTEGER,
  last_seen_at TEXT,
  closed_at TEXT
);

INSERT INTO portal_accounts_0321_new (
  id, membership_id, name, phone, password_hash, email, contact_id,
  cart_json, wishlist_json, created_at, updated_at,
  consent_version, consent_at, consent_locale, age_confirmed_at,
  created_contact_id, last_seen_at
)
SELECT
  o.id, o.membership_id, o.name, o.phone, o.password_hash, o.email, o.contact_id,
  o.cart_json, o.wishlist_json, o.created_at, o.updated_at,
  o.consent_version, o.consent_at, o.consent_locale, o.age_confirmed_at,
  -- The old sign-up created a customer in the same batch as the account and gave both the same LC number.
  -- Remember which link came from that, so staff can tell a sign-up-made record from a real in-store customer.
  (SELECT c.id FROM customers c
    WHERE c.id = o.contact_id
      AND o.membership_id IS NOT NULL
      AND lower(trim(c.membership_number)) = lower(trim(o.membership_id))
      AND c.created_at IS NOT NULL AND o.created_at IS NOT NULL
      AND abs(julianday(c.created_at) - julianday(o.created_at)) * 86400.0 <= 5),
  -- Latest evidence of activity, normalised by datetime() so session columns (ISO or CURRENT_TIMESTAMP text)
  -- compare correctly with the rest.
  NULLIF(max(
    COALESCE((SELECT max(datetime(COALESCE(s.last_seen_at, s.created_at)))
      FROM portal_sessions s WHERE s.account_id = o.id), ''),
    COALESCE(datetime(o.consent_at), ''),
    COALESCE(datetime(o.updated_at), ''),
    COALESCE(datetime(o.created_at), '')
  ), '')
FROM portal_accounts o
ORDER BY o.id;

-- Keep the AUTOINCREMENT high-water mark: copying rows only sets it to MAX(id), so an id above that (a row
-- removed in the past) could be issued again and inherit that account's leftover session rows. A placeholder
-- at the old mark raises it, then leaves. The delete names the placeholder's whole shape (closed, no phone, no
-- password) and an id above every copied row, so no real account can be removed by it.
INSERT INTO portal_accounts_0321_new (id, name, status)
SELECT s.seq, '__portal_members_0321_sequence__', 'closed'
FROM sqlite_sequence s
WHERE s.name = 'portal_accounts'
  AND s.seq > (SELECT COALESCE(MAX(id), 0) FROM portal_accounts_0321_new);
DELETE FROM portal_accounts_0321_new
WHERE name = '__portal_members_0321_sequence__'
  AND status = 'closed'
  AND phone IS NULL
  AND password_hash IS NULL
  AND id > (SELECT COALESCE(MAX(id), 0) FROM portal_accounts);

INSERT INTO portal_members_guard_0321 (check_name, ok)
SELECT 'row_count_equal', CASE WHEN
  (SELECT COUNT(*) FROM portal_accounts_0321_new) = (SELECT COUNT(*) FROM portal_accounts)
THEN 1 ELSE 0 END;

INSERT INTO portal_members_guard_0321 (check_name, ok)
SELECT 'old_columns_identical', CASE WHEN NOT EXISTS (
  SELECT id, membership_id, name, phone, password_hash, email, contact_id, cart_json, wishlist_json,
         created_at, updated_at, consent_version, consent_at, consent_locale, age_confirmed_at FROM portal_accounts
  EXCEPT
  SELECT id, membership_id, name, phone, password_hash, email, contact_id, cart_json, wishlist_json,
         created_at, updated_at, consent_version, consent_at, consent_locale, age_confirmed_at FROM portal_accounts_0321_new
) AND NOT EXISTS (
  SELECT id, membership_id, name, phone, password_hash, email, contact_id, cart_json, wishlist_json,
         created_at, updated_at, consent_version, consent_at, consent_locale, age_confirmed_at FROM portal_accounts_0321_new
  EXCEPT
  SELECT id, membership_id, name, phone, password_hash, email, contact_id, cart_json, wishlist_json,
         created_at, updated_at, consent_version, consent_at, consent_locale, age_confirmed_at FROM portal_accounts
) THEN 1 ELSE 0 END;

INSERT INTO portal_members_guard_0321 (check_name, ok)
SELECT 'age_confirmed_count_equal', CASE WHEN
  (SELECT COUNT(*) FROM portal_accounts_0321_new WHERE age_confirmed_at IS NOT NULL)
    = (SELECT COUNT(*) FROM portal_accounts WHERE age_confirmed_at IS NOT NULL)
THEN 1 ELSE 0 END;

INSERT INTO portal_members_guard_0321 (check_name, ok)
SELECT 'sequence_preserved', CASE WHEN
  COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'portal_accounts_0321_new'), 0)
    >= COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'portal_accounts'), 0)
THEN 1 ELSE 0 END;

INSERT INTO portal_members_guard_0321 (check_name, ok)
SELECT 'member_codes_unminted', CASE WHEN NOT EXISTS (
  SELECT 1 FROM portal_accounts_0321_new WHERE member_code IS NOT NULL
) THEN 1 ELSE 0 END;

-- An AUTOINCREMENT insert that copied no row still leaves a sequence row at 0, which is the same as no row. Remove it
-- so an empty table leaves the same sqlite_sequence as before (a fresh database stays identical whatever order its
-- later migrations ran in). Only a 0 row is removed, so a real high-water mark is never touched.
DELETE FROM sqlite_sequence WHERE name = 'portal_accounts_0321_new' AND seq = 0;

DROP TABLE portal_accounts;

ALTER TABLE portal_accounts_0321_new RENAME TO portal_accounts;

-- One account per phone, where a phone is set (the sign-in key for phone + password accounts).
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accounts_phone
  ON portal_accounts (phone) WHERE phone IS NOT NULL;
-- Legacy LC ids stay case-insensitively unique (same rule as 0087). Not partial: SQLite UNIQUE allows many NULLs,
-- and a partial index would not serve the lookups in lib/membershipNumber.ts and lib/importEngine.ts
-- (lower(trim(membership_id)) GLOB / = ...), which do not repeat the partial predicate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accounts_membership
  ON portal_accounts (lower(trim(membership_id)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accounts_member_code
  ON portal_accounts (member_code) WHERE member_code IS NOT NULL;
-- One member per customer: the link is a pointer, never shared.
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accounts_contact
  ON portal_accounts (contact_id) WHERE contact_id IS NOT NULL;
-- Retention and the staff list filter on these.
CREATE INDEX IF NOT EXISTS idx_portal_accounts_status_seen
  ON portal_accounts (status, last_seen_at);

DROP TABLE IF EXISTS portal_members_guard_0321;
