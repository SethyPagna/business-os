-- Generic D1-backed rate limiter for public/unauthenticated Worker endpoints
-- (e.g. the customer portal's membership lookup and screenshot submission).
-- Mirrors the legacy Docker backend's in-memory `checkRateLimit` (security.ts),
-- which can't carry over as-is since Workers isolates don't share memory --
-- see cloudflare/src/lib/verification.ts for the same pattern already used
-- for password-reset rate limiting.
CREATE TABLE IF NOT EXISTS rate_limit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL,
  client_key TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_lookup ON rate_limit_events (bucket, client_key, created_at);
