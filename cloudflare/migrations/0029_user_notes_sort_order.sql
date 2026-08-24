-- Drag-to-reorder for the personal notes list (NotesPage.tsx / NotesWidget.tsx).
-- Notes previously had no user-controlled position -- the list order was
-- purely derived (pinned first, then most-recently-updated), so there was
-- no column to persist a manual drag-and-drop order into and the feature
-- never actually existed despite being expected. sort_order is a simple
-- ascending rank scoped per-user (lower = earlier in the list); ties (e.g.
-- every existing row defaulting to 0) fall back to updated_at DESC, same
-- as before this column existed, so nothing changes for rows that have
-- never been manually reordered.
ALTER TABLE user_notes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- Same access pattern as the existing idx_user_notes_user index (from
-- 0013_user_notes.sql), just with sort_order added ahead of updated_at so
-- the list route's ORDER BY can use the index directly instead of an
-- extra sort step.
CREATE INDEX IF NOT EXISTS idx_user_notes_user_order ON user_notes(user_id, pinned DESC, sort_order ASC, updated_at DESC);
