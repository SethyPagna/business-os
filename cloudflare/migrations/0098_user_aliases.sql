-- User aliases — legacy/alternate names that map to a live user account (Sep 1 2026).
--
-- The old POS labels each sale's cashier by a short DISPLAY name that does not
-- equal the Business OS user's `username` or `name` (e.g. legacy "Aza" is the
-- account whose username is "Za"; "Dev-Usmart" is the vendor/system account,
-- treated as `admin`). Import matching keyed only on users.name therefore linked
-- none of them, leaving cashier_id NULL on every migrated sale.
--
-- An alias is keyed by the stable `user_id`, NOT by a name string, so it keeps
-- working after a username change — the account id is the source of truth. The
-- import engine consults this table (alias -> user_id) in addition to matching on
-- username and name. Aliases are unique on lower(trim(alias)) so a given legacy
-- name resolves to exactly one account.

CREATE TABLE IF NOT EXISTS user_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_aliases_alias
  ON user_aliases(lower(trim(alias)));
CREATE INDEX IF NOT EXISTS idx_user_aliases_user
  ON user_aliases(user_id);

-- This file also seeded the first client's legacy cashier nicknames when it was applied
-- (Sep 1 2026). Removed 22 Oct 2026, owner-approved: the seed's 7-term compound SELECT stops
-- every new D1 (D1 allows 5), it inserts nothing there (users is empty while migrations run) and
-- the nicknames are one client's data. Databases that applied it keep their rows.
