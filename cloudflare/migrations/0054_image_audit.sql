-- The 6-hourly image audit's findings.
--
-- New uploads have been inside the 300-350KB band since the browser pipeline
-- was fixed. Objects already in R2 -- the MB-sized ones uploaded before any
-- of that existed -- were never touched, because this Worker had no
-- server-side image processing at all until the Images binding was added.
--
-- Why a table rather than doing the work inline in the cron: a sweep that
-- both measures AND rewrites thousands of objects cannot finish inside one
-- invocation's CPU budget, and a half-finished sweep with no record of where
-- it got to would restart from the beginning every six hours and never
-- converge. Recording findings separately makes the audit cheap and
-- resumable, and lets the actual reprocessing be paced against the image
-- transformation quota instead of racing it.
--
-- `.info()` on the Images binding is explicitly NOT billed, which is what
-- makes measuring the whole library free. Only the reprocessing costs quota.
CREATE TABLE IF NOT EXISTS image_audit (
  -- R2 object key. The identity of the thing being audited.
  key            TEXT PRIMARY KEY,
  byte_size      INTEGER NOT NULL,
  width          INTEGER,
  height         INTEGER,
  format         TEXT,
  -- 'ok'        within the band, nothing to do
  -- 'oversized' above the ceiling, queued for reprocessing
  -- 'optimized' reprocessed successfully; byte_size is the NEW size
  -- 'failed'    reprocessing was attempted and did not succeed
  -- 'skipped'   not a decodable image, or no provider could handle it
  status         TEXT NOT NULL DEFAULT 'ok',
  -- Which provider did the work, so a month's results can be attributed.
  provider       TEXT,
  -- Why it failed or was skipped. Kept so a repeated failure is diagnosable
  -- without re-running the sweep.
  reason         TEXT,
  original_size  INTEGER,
  checked_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  optimized_at   TEXT
);

-- The sweep's own working order: find the next batch of oversized objects
-- without scanning the whole table.
CREATE INDEX IF NOT EXISTS idx_image_audit_status ON image_audit (status, byte_size DESC);

-- Where the last listing pass stopped, so a sweep resumes rather than
-- restarting. One row, id = 1.
CREATE TABLE IF NOT EXISTS image_audit_state (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  list_cursor  TEXT,
  last_run_at  TEXT,
  swept        INTEGER NOT NULL DEFAULT 0
);
