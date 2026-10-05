-- 0230 (G38 Phase 1, design M1): website members become their own identity.
--
-- PURPOSE
--   A website member (portal_accounts row) is no longer a customer. Sign-up
--   stops reading or writing customers; a member is connected to a customer
--   only by a staff link (0231). This rebuilds portal_accounts in place so
--   that every id, session, cart and consent record survives, and:
--     * phone and password_hash become NULL-able (later sign-in methods have
--       neither; a closed member's personal fields are cleared);
--     * membership_id becomes NULL-able and is frozen: it keeps the LC-#####
--       an existing account was issued (shown to staff as the legacy id, and
--       still reserved by lib/membershipNumber.ts) and is never written for a
--       new member;
--     * member_code holds the new random W-XXXX-XXXX Member ID. It starts
--       NULL on every existing row and is minted lazily by the Worker
--       (compare-and-set), because SQL cannot mint Crockford codes with a
--       check character;
--     * status (active / suspended / closed), link_version (the compare-and-
--       set counter every link change bumps), created_contact_id (the customer
--       the old sign-up itself created, for staff review), last_seen_at and
--       closed_at;
--     * last_seen_at is backfilled for every existing account from the best
--       evidence of activity it has (its latest session, consent, update or
--       creation time), so the 180-day retention rule never treats an account
--       that was used recently as never seen;
--     * contact_id becomes UNIQUE where set: one member per customer.
--   No table references portal_accounts by foreign key and no trigger or view
--   names it (checked at write time: grep of cloudflare/migrations), so the
--   rename/create/copy/drop below touches nothing else.
--
-- PRE-ASSERTIONS (read-only; ops/queries/g38-p1-premigration.sql runs all of them)
--   SELECT COUNT(*) AS account_rows, COALESCE(MAX(id), 0) AS max_id FROM portal_accounts;
--   SELECT seq FROM sqlite_sequence WHERE name = 'portal_accounts';     -- record it
--   SELECT contact_id, COUNT(*) FROM portal_accounts
--     WHERE contact_id IS NOT NULL GROUP BY contact_id HAVING COUNT(*) > 1;
--                                    -- MUST be empty. Two accounts on one customer
--                                    -- is a staff decision; this file refuses to run
--                                    -- (guard 'no_duplicate_contact_links' below).
--   SELECT COUNT(*) FROM pragma_table_info('portal_accounts')
--     WHERE name IN ('member_code', 'status', 'link_version');          -- expect 0
--
-- IN-FILE ASSERTIONS (portal_members_guard_0230: a failed CHECK aborts the file,
-- and D1 applies a migration file as one unit, so nothing is half-done):
--   no_duplicate_contact_links  before the rebuild (the pre-assertion above);
--   row_count_equal             same number of rows after the copy;
--   old_columns_identical       every id and every old column value equal, both directions;
--   sequence_preserved          the AUTOINCREMENT high-water mark did not go down;
--   member_codes_unminted       every member_code is NULL (lazy mint).
--
-- POST-ASSERTIONS (read-only)
--   SELECT COUNT(*), COALESCE(MAX(id), 0) FROM portal_accounts;        -- equal to pre
--   SELECT seq FROM sqlite_sequence WHERE name = 'portal_accounts';     -- >= pre
--   SELECT COUNT(*) FROM portal_accounts WHERE member_code IS NOT NULL;  -- 0
--   SELECT COUNT(*) FROM portal_accounts WHERE status <> 'active' OR link_version <> 0;  -- 0
--   SELECT COUNT(*) FROM portal_accounts WHERE last_seen_at IS NULL
--     AND COALESCE(created_at, updated_at, consent_at) IS NOT NULL;   -- 0 (backfilled)
--   SELECT COUNT(*) FROM sqlite_master WHERE name IN ('idx_portal_accounts_phone',
--     'idx_portal_accounts_membership', 'idx_portal_accounts_member_code',
--     'idx_portal_accounts_contact', 'idx_portal_accounts_status_seen');  -- 5
--   SELECT COUNT(*) FROM sqlite_master WHERE name = 'portal_accounts_0230_old';  -- 0
--
-- RECOVERY
--   Before apply: nothing to undo (the file is all-or-nothing).
--   After apply (append-only rule: a forward migration, never an edit of this
--   file). Roll the Worker back first; the previous Worker reads only columns
--   that still exist, but it would INSERT accounts with a NULL member_code and
--   fail on NULL phone rows, so restore the old shape with a forward file:
--     ALTER TABLE portal_accounts RENAME TO portal_accounts_0230_new;
--     CREATE TABLE portal_accounts (<0087 + 0130 columns, NOT NULL as before>);
--     INSERT INTO portal_accounts (<old columns>) SELECT <old columns>
--       FROM portal_accounts_0230_new WHERE phone IS NOT NULL AND password_hash IS NOT NULL
--       AND membership_id IS NOT NULL;
--   Rows created by the new Worker (membership_id NULL) have no LC id and cannot
--   live in the old shape: export them first (SELECT * FROM portal_accounts
--   WHERE membership_id IS NULL) and decide with the owner.

CREATE TABLE IF NOT EXISTS portal_members_guard_0230 (
  check_name TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);
DELETE FROM portal_members_guard_0230;

INSERT INTO portal_members_guard_0230 (check_name, ok)
SELECT 'no_duplicate_contact_links', CASE WHEN NOT EXISTS (
  SELECT contact_id FROM portal_accounts
  WHERE contact_id IS NOT NULL
  GROUP BY contact_id HAVING COUNT(*) > 1
) THEN 1 ELSE 0 END;

ALTER TABLE portal_accounts RENAME TO portal_accounts_0230_old;

CREATE TABLE portal_accounts (
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
  -- Native D1 refuses any LIKE/GLOB pattern over 50 bytes at run time
  -- ("LIKE or GLOB pattern too complex"), so the shape is checked as fixed
  -- positions plus four two-character GLOBs of 36 bytes each (same rule as
  -- 0156; pinned by test-d1-pattern-limit-native.cjs).
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

INSERT INTO portal_accounts (
  id, membership_id, name, phone, password_hash, email, contact_id,
  cart_json, wishlist_json, created_at, updated_at,
  consent_version, consent_at, consent_locale,
  created_contact_id, last_seen_at
)
SELECT
  o.id, o.membership_id, o.name, o.phone, o.password_hash, o.email, o.contact_id,
  o.cart_json, o.wishlist_json, o.created_at, o.updated_at,
  o.consent_version, o.consent_at, o.consent_locale,
  -- The old sign-up created a customer in the same batch as the account and
  -- gave both the same LC number. Remember which link came from that, so
  -- staff can tell a sign-up-made record from a real in-store customer.
  (SELECT c.id FROM customers c
    WHERE c.id = o.contact_id
      AND o.membership_id IS NOT NULL
      AND lower(trim(c.membership_number)) = lower(trim(o.membership_id))
      AND c.created_at IS NOT NULL AND o.created_at IS NOT NULL
      AND abs(julianday(c.created_at) - julianday(o.created_at)) * 86400.0 <= 5),
  -- Latest evidence of activity, normalised by datetime() so the session
  -- columns (ISO or CURRENT_TIMESTAMP text) compare correctly with the rest.
  NULLIF(max(
    COALESCE((SELECT max(datetime(COALESCE(s.last_seen_at, s.created_at)))
      FROM portal_sessions s WHERE s.account_id = o.id), ''),
    COALESCE(datetime(o.consent_at), ''),
    COALESCE(datetime(o.updated_at), ''),
    COALESCE(datetime(o.created_at), '')
  ), '')
FROM portal_accounts_0230_old o
ORDER BY o.id;

-- Keep the AUTOINCREMENT high-water mark: copying rows only sets it to
-- MAX(id), so an id above that (a row removed in the past) could otherwise
-- be issued again and inherit that account's leftover session rows. A
-- placeholder at the old mark raises it, then leaves.
INSERT INTO portal_accounts (id, name, status)
SELECT s.seq, '__portal_members_0230_sequence__', 'closed'
FROM sqlite_sequence s
WHERE s.name = 'portal_accounts_0230_old'
  AND s.seq > (SELECT COALESCE(MAX(id), 0) FROM portal_accounts);
DELETE FROM portal_accounts WHERE name = '__portal_members_0230_sequence__';

INSERT INTO portal_members_guard_0230 (check_name, ok)
SELECT 'row_count_equal', CASE WHEN
  (SELECT COUNT(*) FROM portal_accounts) = (SELECT COUNT(*) FROM portal_accounts_0230_old)
THEN 1 ELSE 0 END;

INSERT INTO portal_members_guard_0230 (check_name, ok)
SELECT 'old_columns_identical', CASE WHEN NOT EXISTS (
  SELECT id, membership_id, name, phone, password_hash, email, contact_id, cart_json, wishlist_json,
         created_at, updated_at, consent_version, consent_at, consent_locale FROM portal_accounts_0230_old
  EXCEPT
  SELECT id, membership_id, name, phone, password_hash, email, contact_id, cart_json, wishlist_json,
         created_at, updated_at, consent_version, consent_at, consent_locale FROM portal_accounts
) AND NOT EXISTS (
  SELECT id, membership_id, name, phone, password_hash, email, contact_id, cart_json, wishlist_json,
         created_at, updated_at, consent_version, consent_at, consent_locale FROM portal_accounts
  EXCEPT
  SELECT id, membership_id, name, phone, password_hash, email, contact_id, cart_json, wishlist_json,
         created_at, updated_at, consent_version, consent_at, consent_locale FROM portal_accounts_0230_old
) THEN 1 ELSE 0 END;

INSERT INTO portal_members_guard_0230 (check_name, ok)
SELECT 'sequence_preserved', CASE WHEN
  COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'portal_accounts'), 0)
    >= COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'portal_accounts_0230_old'), 0)
THEN 1 ELSE 0 END;

INSERT INTO portal_members_guard_0230 (check_name, ok)
SELECT 'member_codes_unminted', CASE WHEN NOT EXISTS (
  SELECT 1 FROM portal_accounts WHERE member_code IS NOT NULL
) THEN 1 ELSE 0 END;

DROP TABLE portal_accounts_0230_old;

-- One account per phone, where a phone is set (the sign-in key for legacy
-- phone + password accounts).
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accounts_phone
  ON portal_accounts (phone) WHERE phone IS NOT NULL;
-- Legacy LC ids stay case-insensitively unique (same rule as 0087).
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accounts_membership
  ON portal_accounts (lower(trim(membership_id))) WHERE membership_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accounts_member_code
  ON portal_accounts (member_code) WHERE member_code IS NOT NULL;
-- One member per customer: the link is a pointer, never shared.
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accounts_contact
  ON portal_accounts (contact_id) WHERE contact_id IS NOT NULL;
-- Retention (lib/ephemeralRetention.ts) and the staff list filter on these.
CREATE INDEX IF NOT EXISTS idx_portal_accounts_status_seen
  ON portal_accounts (status, last_seen_at);

DROP TABLE IF EXISTS portal_members_guard_0230;
