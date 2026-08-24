-- Per-user autosaved notes. Purely personal scratchpad, not shared with
-- other users and not tied to any specific record (sale/product/contact
-- notes already exist as free-text fields on those tables and are
-- untouched by this). A user can keep any number of notes; each note
-- autosaves from the UI via debounced PUT calls, so the schema only needs
-- to track content + timestamps, no versioning/locking beyond the
-- optimistic-concurrency `updated_at` pattern every other table here uses.
CREATE TABLE IF NOT EXISTS user_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every list/autosave read is scoped to one user's own notes, ordered by
-- recency -- this is the only access pattern the route ever needs.
CREATE INDEX IF NOT EXISTS idx_user_notes_user ON user_notes(user_id, pinned DESC, updated_at DESC);
