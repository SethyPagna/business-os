-- 0232 (G38 Telegram, design §4.8 / §5.4 M3): website members sign in and
-- sign up with Telegram, proving their phone through the customer bot.
--
-- PURPOSE
--   portal_login_identities: one verified sign-in method per row (design M3).
--   This file only ever writes provider = 'telegram'; the CHECK already admits
--   the later methods so they need no rebuild. subject_key is the Telegram
--   user id as decimal text. verified_at is set when the row is written: the
--   phone was proven by the bot (message.contact.user_id = message.from.id).
--   lib/ephemeralRetention.ts portalMemberPurgeWhere already exempts a member
--   with a verified identity from the 180-day closure (G38 Phase 1 obligation
--   7: the table name and verified_at column are the ones it reads).
--   One Telegram account per member and one member per Telegram account:
--   UNIQUE (provider, subject_key) plus a partial UNIQUE on account_id.
--
--   portal_telegram_challenges: the short-lived sign-in handshake.
--     pending   the website minted a nonce (deep link t.me/<bot>?start=<nonce>)
--     started   the bot received /start <nonce>; bound to that Telegram user
--     verified  that user shared their OWN contact; phone recorded
--     consumed  the same browser finished the sign-in (single use)
--   Only SHA-256 hashes of the nonce and of the browser-binding cookie are
--   stored, never the values. Rows live 10 minutes (expires_at) and the
--   retention sweep deletes them after expiry; the phone is cleared at consume.
--   Neither table is in BACKUP_TABLES or FACTORY_RESET_TABLES, matching
--   portal_accounts (G38 P1 open question 3).
--
-- PRE-ASSERTIONS (read-only)
--   SELECT COUNT(*) FROM sqlite_master
--     WHERE name IN ('portal_login_identities', 'portal_telegram_challenges');  -- 0
--   SELECT COUNT(*) FROM pragma_table_info('portal_accounts') WHERE name = 'member_code';  -- 1 (0230 applied)
--   SELECT COUNT(*) FROM pragma_table_info('portal_accounts') WHERE name = 'password_hash' AND "notnull" = 0;  -- 1 (0230 applied)
--
-- POST-ASSERTIONS (read-only)
--   SELECT COUNT(*) FROM portal_login_identities;  -- 0
--   SELECT COUNT(*) FROM portal_telegram_challenges;  -- 0
--   SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN (
--     'idx_portal_login_identities_account', 'idx_portal_login_identities_one_telegram',
--     'idx_portal_telegram_challenges_user', 'idx_portal_telegram_challenges_expires');  -- 4
--
-- IDEMPOTENCE: every object is IF NOT EXISTS and the file writes no rows, so
-- re-running it changes nothing.
--
-- RECOVERY
--   Roll the Worker back first: the new Worker reads both tables on every
--   Telegram sign-in, and the staff Members list reads portal_login_identities
--   for the Verified chip. Then, as a forward migration if the tables must go:
--     DROP TABLE IF EXISTS portal_telegram_challenges;
--     DROP TABLE IF EXISTS portal_login_identities;
--   Dropping portal_telegram_challenges loses nothing (10-minute rows).
--   Dropping portal_login_identities strands every Telegram-only member (no
--   password): export it first (SELECT *) and expect the 180-day retention
--   rule to stop exempting those members.

CREATE TABLE IF NOT EXISTS portal_login_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('email', 'telegram', 'google', 'passkey')),
  subject_key TEXT NOT NULL CHECK (length(subject_key) BETWEEN 1 AND 200),
  display_hint TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  UNIQUE (provider, subject_key)
);
CREATE INDEX IF NOT EXISTS idx_portal_login_identities_account
  ON portal_login_identities (account_id, provider);
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_login_identities_one_telegram
  ON portal_login_identities (account_id) WHERE provider = 'telegram';

CREATE TABLE IF NOT EXISTS portal_telegram_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nonce_hash TEXT NOT NULL UNIQUE CHECK (length(nonce_hash) = 64),
  browser_hash TEXT NOT NULL CHECK (length(browser_hash) = 64),
  purpose TEXT NOT NULL CHECK (purpose IN ('signin', 'attach')),
  -- attach only: the signed-in member who passed a fresh password check.
  account_id INTEGER,
  locale TEXT NOT NULL DEFAULT 'km' CHECK (locale IN ('en', 'km')),
  consent_locale TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'started', 'verified', 'consumed')),
  telegram_user_id TEXT CHECK (telegram_user_id IS NULL OR length(telegram_user_id) BETWEEN 1 AND 20),
  phone TEXT,
  telegram_name TEXT CHECK (telegram_name IS NULL OR length(telegram_name) <= 80),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  CHECK ((purpose = 'attach') = (account_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_portal_telegram_challenges_user
  ON portal_telegram_challenges (telegram_user_id, status) WHERE telegram_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_portal_telegram_challenges_expires
  ON portal_telegram_challenges (expires_at);
