-- Part 533 (§2): public storefront customer accounts.
--
-- The storefront (leangbeauty.com) had no customer accounts -- only an
-- anonymous membership lookup (now disabled for privacy) and a
-- localStorage-only "bucket". This adds real sign-up/sign-in with a password,
-- an auto-issued membership id, a server-persisted cart + wishlist, and the
-- abuse controls a public unauthenticated surface needs. Every table here is
-- deliberately SEPARATE from the staff-facing equivalents (users,
-- user_sessions, login_lockouts, verification_codes): the two audiences must
-- never share a session, a lockout counter, or a password-reset token space
-- (a shared verification_codes.user_id would let a portal reset overwrite a
-- staff users row -- see lib/portalReset.ts for that reasoning).

-- --- Canonical phone key on existing contacts -------------------------------
-- customers.phone is stored space-formatted (formatPhoneP8, e.g. "012 345
-- 678"), so signup's "is this phone already a customer?" probe cannot compare
-- it to a normalized input directly. This canonical column (digits only, the
-- Cambodian 855-country-code folded to its 0-leading national form) is the
-- comparison key. lib/phone.ts::canonicalizePhone is the authority for new
-- writes (routes/contacts.ts keeps this column in sync); the UPDATEs below
-- backfill the rows that already exist.
ALTER TABLE customers ADD COLUMN phone_normalized TEXT;

UPDATE customers
SET phone_normalized = replace(replace(replace(replace(replace(replace(phone, ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), '+', '')
WHERE phone IS NOT NULL AND trim(phone) != '';

-- Fold 855… -> 0… so "+855 12 345 678", "85512345678" and "012 345 678" all
-- collapse to the same key (011/012 mobile = 9-10 national digits => 11-12
-- with the country code). Matches formatPhoneP8's own conservative rule.
UPDATE customers
SET phone_normalized = '0' || substr(phone_normalized, 4)
WHERE phone_normalized LIKE '855%' AND length(phone_normalized) IN (11, 12);

CREATE INDEX IF NOT EXISTS idx_customers_phone_normalized
  ON customers (phone_normalized)
  WHERE phone_normalized IS NOT NULL AND phone_normalized != '';

-- --- Accounts ---------------------------------------------------------------
-- phone is the canonical national form and is the AUTHORITATIVE uniqueness
-- gate (one account per phone -- deliberately unlike contacts, which allow
-- shared numbers). D1 has no interactive transaction, so signup relies on
-- this UNIQUE constraint (a thrown "constraint failed") to arbitrate races,
-- never on a prior read.
CREATE TABLE portal_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  membership_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT,
  contact_id INTEGER,
  cart_json TEXT,
  wishlist_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_portal_accounts_phone ON portal_accounts (phone);
-- Case-insensitive membership-id uniqueness, mirroring 0015 for customers.
CREATE UNIQUE INDEX idx_portal_accounts_membership ON portal_accounts (lower(trim(membership_id)));
CREATE INDEX idx_portal_accounts_contact ON portal_accounts (contact_id);

-- --- Sessions (fork of user_sessions; separate cookie bos_portal) -----------
CREATE TABLE portal_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  user_agent TEXT,
  last_ip TEXT,
  last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_portal_sessions_token ON portal_sessions (token_hash);
CREATE INDEX idx_portal_sessions_account ON portal_sessions (account_id);

-- --- Password reset (portal-scoped; never the shared verification_codes) -----
CREATE TABLE portal_password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_portal_password_resets_token ON portal_password_resets (token_hash);

-- --- Auth lockouts (flat 10-fail cap per flow, then a cooldown) -------------
-- scope is 'signup' or 'signin'; key is the canonical phone (signin, so one
-- targeted account can't be hammered) or the client IP (signup, no stable
-- account yet). Separate from login_lockouts (staff, username-keyed,
-- escalating) so the two philosophies never fight over one row.
CREATE TABLE portal_auth_lockouts (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, key)
);
