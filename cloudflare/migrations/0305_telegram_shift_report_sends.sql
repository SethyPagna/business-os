-- 0305: the Telegram shift report as its own send (wave 3, shift close under Free's 50 D1 calls per invocation).
--
-- Until now a shift close, cancel, reopen, amend or open pushed its Telegram report from the SAME invocation as the till's request (waitUntil). On Free that invocation
-- allows 50 D1 calls and the close alone needs ~50, so the report's ~43 calls ran past the cap and the report was lost. The route now only writes one row here and
-- puts one message on BACKUP_QUEUE; the queue consumer (its own invocation) builds and sends the text. Owner 13 Nov 2026: the report may arrive a few seconds later.
--
-- send_key   UNIQUE, 'shift-report:<shift id>:r<revision the write produced>:<action>'. A write is one revision, so a retried request, a duplicate queue delivery and the
--             cron fallback racing the queue all meet this key, and only the one conditional UPDATE pending -> sending that changes a row sends.
-- payload_json  what the route knew and the sender cannot recompute: the clock reading the text prints (nowMs), the closer / reopener / amender name and id, and the
--             shift row as the write read it back (so the message says what the write said, not the row as it reads when the queue delivers).
-- dispatch    'queue' = a queue message carries it; 'fallback' = no queue (or the send threw): the */5 cron drains it, never an API request.
-- Delivery is AT MOST ONCE (as the inline send always was): a claim whose Worker died mid-send is marked failed by the cron sweep and not re-sent, and a Telegram error is
-- recorded failed (last_error) and NOT retried, because a message part may already be in the chat. There are no retries; attempts counts claims (0 or 1).
--
-- PRE:  telegram_shift_report_sends and idx_telegram_shift_report_sends_due do not exist. A failed check reads a malformed JSON path and aborts the file.
-- POST: telegram_shift_report_sends exists with 12 columns and 0 rows; idx_telegram_shift_report_sends_due exists; no other table is read or written.
-- Deploy order: EITHER order is safe. lib/telegram.ts schedules with one INSERT; while the table is absent that INSERT fails with "no such table" and the route sends the
--   report the way it always did (waitUntil, same invocation). Rollback of the Worker leaves an inert table.
-- Retention: one row per shift write that reports (open, close, cancel, reopen, amend): the order of magnitude of audit_logs shift rows. Sent rows older than 30 days
--   may be deleted by hand; no pruner.
-- Backup: deliberately NOT in lib/backup.ts BACKUP_TABLES. A send log, not business data; a restore that brought back pending rows would replay old messages into the chat.
-- Append-only, LF-only, rowid kept (no WITHOUT ROWID: it breaks backups), generic (no client data).
-- RECOVERY: schema only. Full undo: DROP INDEX IF EXISTS idx_telegram_shift_report_sends_due; DROP TABLE IF EXISTS telegram_shift_report_sends;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE name IN ('telegram_shift_report_sends', 'idx_telegram_shift_report_sends_due')) = 0
THEN 1 ELSE json_extract('[]','$[telegram_shift_report_sends_0305_pre]') END;

CREATE TABLE telegram_shift_report_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  send_key TEXT NOT NULL UNIQUE,
  shift_id INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  -- ISO-8601 UTC from the Worker (Date#toISOString), compared as text.
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'skipped', 'failed')),
  dispatch TEXT NOT NULL DEFAULT 'fallback' CHECK (dispatch IN ('queue', 'fallback')),
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  sent_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_telegram_shift_report_sends_due ON telegram_shift_report_sends (status, due_at);
