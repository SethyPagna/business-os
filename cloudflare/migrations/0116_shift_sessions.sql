-- Cash-drawer shift registration: one per employee per business day.
--
-- THE RULE (owner, 2026-09-04): "make the shift cash change amount register
-- applied as quick as possible for deploy for first login each day for
-- employees, and end of shift each time, the first use of POS will prompt
-- until it is registered, only need registered once... for end shift it is
-- manual, and also end only once."
--
-- Four separable promises live in that sentence, and three of them are
-- enforced HERE rather than in the route, because a rule that lives only in
-- application code is one concurrent request away from being false:
--
--   1. "only need registered once"   -> UNIQUE(user_id, branch_id, business_date).
--      Two POS tabs opening the same morning race constantly; the second
--      INSERT is refused by the index, not by a check-then-write in the route
--      that both tabs can pass simultaneously.
--   2. "end only once"               -> the close is `WHERE closed_at IS NULL`,
--      and closed_at/closing_* are the only columns a close touches. A second
--      close matches no row and changes nothing, so a double-tap or a retried
--      request cannot overwrite the first count.
--   3. "first use of POS will prompt until it is registered" -> the ABSENCE of
--      a row for (user, branch, today) is the prompt condition. Nothing has to
--      be scheduled at login, and a shift that was never registered stays
--      prompting through a reload, a new tab or a different device.
--   4. End of shift is MANUAL -- nothing here closes a shift on a timer. A
--      shift left open overnight stays open and visible, which is the honest
--      record; inventing a closing count nobody performed would be worse than
--      an obviously unclosed shift.
--
-- BUSINESS DATE, NOT UTC DATE.  business_date is the local (UTC+7) day, the
-- same window every report and receipt uses (lib/businessDateWindow.ts). A
-- shift opened at 08:00 local on Sep 4 is stored '2026-09-04' even though it
-- is still Sep 3 in UTC. Keying the daily prompt on the UTC date would make
-- the till re-prompt in the middle of the evening, every evening.
--
-- STORED, NOT COMPUTED, on purpose: business_date is written by the route from
-- the same offset the rest of the system uses, so the UNIQUE index can cover
-- it. A generated expression over opened_at could not be indexed for
-- uniqueness in D1's SQLite build.
--
-- BOTH CURRENCIES, NEVER CONVERTED.  The drawer holds dollars and riel side by
-- side and the shop counts them separately. Folding riel into USD would invent
-- an exchange rate and silently restate what the employee actually counted --
-- the same convention every fee surface already follows.

CREATE TABLE IF NOT EXISTS shift_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- S-YYYYMMDD-HHMM, the house session-id format already on the board.
  -- Human-facing and quotable in a handover; the id stays the join key.
  shift_code TEXT NOT NULL,

  user_id INTEGER NOT NULL,
  user_name TEXT,
  branch_id INTEGER,
  branch_name TEXT,

  -- Local (UTC+7) date. This is what "once a day" is counted against.
  business_date TEXT NOT NULL,

  opened_at TEXT NOT NULL,
  opening_float_usd REAL NOT NULL DEFAULT 0,
  opening_float_khr REAL NOT NULL DEFAULT 0,
  opening_note TEXT,
  opened_device_name TEXT,

  -- NULL until the employee ends the shift by hand. NULL is the whole
  -- concurrency guard for "end only once", so it must stay nullable.
  closed_at TEXT,
  closing_counted_usd REAL,
  closing_counted_khr REAL,
  closing_note TEXT,
  closed_device_name TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

-- Promise 1, as a constraint. Branch is part of the key because one employee
-- can legitimately work a second branch's till on the same day; that is a
-- separate drawer with a separate float, not a duplicate registration.
--
-- COALESCE(branch_id, -1), NOT branch_id.  In SQLite every NULL is DISTINCT
-- from every other NULL for uniqueness purposes, so a plain
-- UNIQUE(user_id, branch_id, business_date) does not constrain rows at all
-- when branch_id is NULL -- which is exactly a single-branch till, the most
-- common shop in this system. The index would have looked correct, and the
-- "register once a day" promise would have been silently false for almost
-- everyone. -1 is safe as the sentinel because branch ids are AUTOINCREMENT
-- and therefore always positive. Caught by test-shift-sessions-pure.cjs,
-- which registers the same NULL-branch till twice and requires the second to
-- be refused.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_sessions_user_day
  ON shift_sessions(user_id, COALESCE(branch_id, -1), business_date);

-- The prompt check runs on every POS open, so it gets its own covering index.
CREATE INDEX IF NOT EXISTS idx_shift_sessions_open
  ON shift_sessions(user_id, branch_id) WHERE closed_at IS NULL;

-- Reporting: "which shifts are still unclosed", and per-day rollups.
CREATE INDEX IF NOT EXISTS idx_shift_sessions_business_date
  ON shift_sessions(business_date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_sessions_code
  ON shift_sessions(shift_code);
