-- T10 (owner, 23 Sep 2026): "One minute after a shift closes, the Reports
-- overview is sent to Telegram too", with one send per shift.
--
-- One row per scheduled Telegram message, keyed by `send_key`. For the shift
-- overview the key is `shift-overview:<shift id>:r<revision after the close>`
-- (lib/telegram.ts shiftOverviewKey). A shift segment closes exactly once (the
-- close UPDATE is guarded by `closed_at IS NULL AND revision=@revision`), and a
-- reopen creates a NEW segment row with its own id, so a reopen + reclose is a
-- new key and sends again -- the same rule the shift report itself follows,
-- which is pushed on every close of every segment.
--
-- The row is written BEFORE anything is sent, and a send happens only after
-- the one conditional UPDATE that moves it pending -> sending succeeds. That
-- claim is what makes a duplicate queue delivery, a retried close, and the
-- request/cron fallback racing the queue all converge on a single send.
-- Delivery is AT MOST ONCE: a claim whose Worker dies mid-send is marked
-- `failed` by the drain after ten minutes and is never re-sent, because a
-- Telegram sendMessage that was accepted cannot be told from one that was not.
--
-- Schema-only. No existing table is read or written.
-- Pre-assert:  SELECT COUNT(*) FROM sqlite_master WHERE name='telegram_scheduled_sends' = 0
-- Post-assert: SELECT COUNT(*) FROM telegram_scheduled_sends = 0;
--              SELECT COUNT(*) FROM sqlite_master WHERE name='idx_telegram_scheduled_sends_due' = 1
-- Deploy order: EITHER order is safe. lib/telegram.ts probes for the table
--              (memoising only a positive result) and, while it is absent,
--              schedules nothing: without the dedupe row there is no way to
--              promise one send, so the overview is skipped rather than risked
--              twice. The shift report itself is unaffected either way.
-- Recovery:    roll the Worker back; the table is inert without it. Pending
--              rows left behind are harmless and can be dropped with the table.
-- Retention:   one row per closed shift segment -- the same order of magnitude
--              as shift_sessions, which is never pruned. No pruner.
-- Backup:      deliberately NOT in lib/backup.ts BACKUP_TABLES. It is a send
--              log, not business data; a restore that brought back `pending`
--              rows would replay old messages into the chat.
CREATE TABLE telegram_scheduled_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  send_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('shift_overview')),
  shift_id INTEGER NOT NULL,
  -- ISO-8601 UTC from the Worker (Date#toISOString), compared as text.
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'skipped', 'failed')),
  -- How the send was scheduled: the delayed queue message, or the fallback
  -- that the next request or cron tick drains.
  dispatch TEXT NOT NULL DEFAULT 'fallback' CHECK (dispatch IN ('queue', 'fallback')),
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  sent_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_telegram_scheduled_sends_due ON telegram_scheduled_sends (status, due_at);
