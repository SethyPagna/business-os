-- 0097_undo_snapshots.sql (Part 578, item 2b)
--
-- Reload-durable reversal store for heavy, multi-row undoable actions.
--
-- The action_history table already carries an undo_payload / redo_payload per
-- action, but routes/actionHistory.ts caps each of those at 20 KB
-- (serializePayload) -- fine for a field edit, but a duplicate-product MERGE or
-- a bulk supplier BACKFILL has to remember every row it touched (the exact
-- sale_item / inventory_movement ids re-parented, per-branch stock before, the
-- batch disposition) to reverse itself precisely, and that snapshot routinely
-- exceeds 20 KB. Storing it here, keyed from a tiny action_history payload
-- ({ applier, snapshot_id }), lets the reversal snapshot be arbitrarily large
-- while the audited history row stays small.
--
-- The snapshot is OPAQUE to this table: `kind` names the server applier
-- (lib/undoAppliers.ts) that wrote it and is the only code that interprets
-- payload_json. Appliers replay through fixed, hardcoded SQL -- they never
-- write an arbitrary table named by the snapshot -- so an oversized/foreign
-- snapshot can misbehave for its own action only, never escalate into a
-- generic table-write primitive (the Part-77 gate reasoning).
--
-- `status` guards the direction: an 'applied' snapshot's next transition is an
-- undo (-> 'reversed'); a 'reversed' snapshot's is a redo (-> 'applied'). This
-- is a secondary guard; action_history's own undoable/redoable status machine
-- is the primary one.

CREATE TABLE IF NOT EXISTS undo_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'applied',
  payload_json TEXT NOT NULL,
  created_by_id INTEGER,
  created_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_undo_snapshots_kind_status ON undo_snapshots(kind, status);
