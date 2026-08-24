-- Backing table for the Review Required permission tier (see progress.md's
-- "Permissions UI redesign" item -- three-tier per-section model + a real
-- approval-queue/review system). This is step (1) of that item's own
-- documented build order: the schema only. Step (2) -- every
-- Review-Required-gated write route actually branching to insert a row
-- here instead of writing directly -- is NOT part of this migration and
-- is still open.
--
-- One row per pending write. `action_type` + `entity_type` describe what
-- the row is (e.g. action_type='delete', entity_type='product'),
-- `entity_id` is the target row's id when the action applies to an
-- existing record (NULL for a pending create, where there's no id yet).
-- `payload_json` carries whatever the write route would otherwise have
-- applied directly -- same shape as that route's own request body, so
-- approving a row is just "replay this payload through the real write
-- path now that it's approved" rather than a second, parallel
-- implementation of each write.
--
-- `status` is a plain TEXT enum (open/approved/rejected), not a CHECK
-- constraint -- D1/SQLite has no native enum, matching how every other
-- free-text-with-a-known-set column in this schema (fees.fee_type,
-- customers.gender) is already handled; the known set is enforced at the
-- edges (lib/pendingActions.ts, the future approval-page UI), not in SQL.
--
-- No FOREIGN KEY on entity_id -- like fees.sale_id, a pending row must
-- stay readable/reviewable even if the entity it targets is deleted out
-- from under it by a separate action before this one is reviewed (rare,
-- but the reviewer needs to see that happened, not get a broken row).
--
-- requested_by/reviewed_by store both the user id and a snapshotted name
-- (requested_by_name/reviewed_by_name), same "snapshot the display name
-- alongside the id" pattern fees.created_by_name and sales.cashier_name
-- already use -- so the queue and its history still read correctly if the
-- requesting or reviewing user is later deactivated/deleted.

CREATE TABLE pending_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL,
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  requested_by INTEGER,
  requested_by_name TEXT,
  reviewed_by INTEGER,
  reviewed_by_name TEXT,
  reviewed_at TEXT,
  reject_reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pending_actions_status ON pending_actions(status);
CREATE INDEX idx_pending_actions_section ON pending_actions(section);
CREATE INDEX idx_pending_actions_requested_by ON pending_actions(requested_by);
