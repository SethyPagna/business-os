-- 0322 (G38 S3): Telegram sign-in for website members, lean form.
--
-- PURPOSE
--   Adds what the shopper Telegram sign-in needs and nothing else:
--     * portal_accounts.telegram_user_id (the Telegram user id, 1 to 2^52 - 1) and telegram_verified_at (ISO time
--       of the proof), the first UNIQUE through a partial index so members without Telegram do not collide;
--     * portal_telegram_pending, one row per Telegram user who has started a join and not finished it
--       (the user id is the rowid, no AUTOINCREMENT, so no sqlite_sequence write);
--     * the trigger portal_accounts_close_clears_identity: any UPDATE that leaves a row closed with a phone or a
--       Telegram id clears both, so a closed member never blocks a recycled number. The customer record keeps its own
--       phone. telegram_verified_at stays on close. The trigger does not fire on INSERT.
--   No column default anywhere: every time is written by the Worker in the one ISO form (24 characters), and the CHECKs
--   refuse any other shape (CURRENT_TIMESTAMP text is 19 characters). Every table keeps its rowid.
--   Safe on a database with rows: both new columns are nullable with no default, so every existing row passes its CHECK;
--   the partial index over all-NULL rows is empty; no rebuild, no copy.
--
-- LATER REBUILDS OF portal_accounts
--   Any later rebuild (the column-list pattern of 0321) must carry telegram_user_id and telegram_verified_at with their
--   CHECKs, recreate idx_portal_accounts_telegram and portal_accounts_close_clears_identity, and its column-count guard
--   expects 23 columns (0321's 21 plus these 2). test-migration-0322-portal-telegram-pure.cjs fails a later migration
--   that recreates portal_accounts without them.
--
-- PRE-ASSERTIONS (read-only; no pragma function, the ops guard forbids it, as 0321 notes)
--   The last one must be 0, else STOP and do not apply this file: the trigger acts only on future UPDATEs, so a closed
--   row that already kept its phone would keep blocking a recycled number.
--   SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'portal_accounts' AND sql LIKE '%member_code%';  -- 1 (0321 applied)
--   SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'portal_accounts' AND sql LIKE '%telegram_user_id%';  -- 0
--   SELECT COUNT(*) FROM sqlite_master WHERE name IN ('portal_telegram_pending', 'idx_portal_accounts_telegram', 'portal_accounts_close_clears_identity');  -- 0
--   SELECT COUNT(*) FROM portal_accounts;  -- record
--   SELECT COUNT(*) FROM portal_accounts WHERE status = 'closed' AND phone IS NOT NULL;  -- 0, else STOP
--
-- POST-ASSERTIONS (read-only)
--   SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'portal_accounts' AND sql LIKE '%telegram_verified_at%';  -- 1
--   SELECT COUNT(*) FROM sqlite_master WHERE name IN ('portal_telegram_pending', 'idx_portal_accounts_telegram', 'portal_accounts_close_clears_identity');  -- 3
--   SELECT COUNT(*) FROM portal_accounts;  -- equal to the pre-assertion count
--   SELECT COUNT(*) FROM portal_accounts WHERE telegram_user_id IS NOT NULL OR telegram_verified_at IS NOT NULL;  -- 0
--   SELECT COUNT(*) FROM portal_telegram_pending;  -- 0
--
-- RECOVERY
--   A stop part-way (remote D1 may run statements one by one): applying the file again fails on the first ALTER that
--   already ran ("duplicate column name") and changes nothing. Finish by hand with the remaining statements of this
--   file, in order; each later statement is IF NOT EXISTS. After a hand finish, also record this file's name
--   (0322_portal_telegram_lean.sql) in d1_migrations through the ops tool; otherwise every later deploy with
--   run_migrations=true re-runs 0322 and stops at the first ALTER ("duplicate column name"). (On D1 a failed
--   migration is normally rolled back whole, as 0321's note says, so a hand finish should rarely be needed.)
--   Rollback after a full apply: (1) roll the Worker back first (the previous Worker never reads the new objects);
--   (2) export the Telegram members first (id, member_code, name, created_at, telegram_verified_at, no Telegram id)
--   and decide with the owner: once members exist, dropping the column strands every Telegram-only member (no
--   password); (3) then, as a forward file (never an edit of this one), in this order:
--       DROP TRIGGER IF EXISTS portal_accounts_close_clears_identity;
--       DELETE FROM portal_sessions WHERE substr(token_hash, 1, 4) = 'tg1:';
--       DROP TABLE IF EXISTS portal_telegram_pending;
--       DROP INDEX IF EXISTS idx_portal_accounts_telegram;
--       ALTER TABLE portal_accounts DROP COLUMN telegram_verified_at;
--       ALTER TABLE portal_accounts DROP COLUMN telegram_user_id;
--   The trigger goes first (SQLite refuses to drop a column a trigger names) and the index before its column. If 0321
--   is rolled back too, roll this file back first: 0321's recovery rebuild copies a fixed column list and would drop
--   the two Telegram columns silently.
ALTER TABLE portal_accounts ADD COLUMN telegram_user_id INTEGER
  CHECK (telegram_user_id IS NULL
         OR (typeof(telegram_user_id) = 'integer'
             AND telegram_user_id > 0
             AND telegram_user_id <= 4503599627370495));

ALTER TABLE portal_accounts ADD COLUMN telegram_verified_at TEXT
  CHECK (telegram_verified_at IS NULL
         OR (length(telegram_verified_at) = 24
             AND substr(telegram_verified_at, 5, 1) = '-'
             AND substr(telegram_verified_at, 11, 1) = 'T'
             AND substr(telegram_verified_at, 24, 1) = 'Z'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accounts_telegram
  ON portal_accounts (telegram_user_id) WHERE telegram_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS portal_telegram_pending (
  id INTEGER PRIMARY KEY CHECK (typeof(id) = 'integer' AND id > 0 AND id <= 4503599627370495),
  ticket_hash TEXT NOT NULL CHECK (length(ticket_hash) = 68 AND substr(ticket_hash, 1, 4) = 'tg1:'),
  flags INTEGER NOT NULL CHECK (typeof(flags) = 'integer' AND flags BETWEEN 0 AND 65535),
  attempts INTEGER NOT NULL CHECK (attempts >= 1),
  window_started_at TEXT NOT NULL CHECK (length(window_started_at) = 24 AND substr(window_started_at, 11, 1) = 'T'),
  created_at TEXT NOT NULL CHECK (length(created_at) = 24 AND substr(created_at, 11, 1) = 'T'),
  expires_at TEXT NOT NULL CHECK (length(expires_at) = 24 AND substr(expires_at, 11, 1) = 'T')
);

CREATE TRIGGER IF NOT EXISTS portal_accounts_close_clears_identity
AFTER UPDATE OF status, phone, telegram_user_id ON portal_accounts
WHEN NEW.status = 'closed' AND (NEW.phone IS NOT NULL OR NEW.telegram_user_id IS NOT NULL)
BEGIN
  UPDATE portal_accounts SET phone = NULL, telegram_user_id = NULL WHERE id = NEW.id;
END;
