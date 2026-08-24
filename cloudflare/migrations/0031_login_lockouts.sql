-- Persistent, escalating login lockout -- see lib/loginLockout.ts for the
-- full reasoning. Deliberately separate from the existing
-- rate_limit_events table (lib/rateLimit.ts): that table backs a sliding
-- *window* limiter (count of recent events, self-expiring), which can't
-- represent "keep growing the wait on every further failure until a
-- success resets it" -- this table tracks one persistent counter and one
-- lock-expiry timestamp per username instead.
CREATE TABLE login_lockouts (
  username TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
