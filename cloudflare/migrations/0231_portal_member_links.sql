-- 0231 (G38 Phase 1, design M2): staff links between website members and
-- customers, with an append-only history, and members' link requests.
--
-- PURPOSE
--   portal_accounts.contact_id (0230) is the one CURRENT link. Every change
--   to it appends one row here, written in the same D1 batch as the change:
--     link / unlink / relink      staff action in Contacts > Members
--     revert                      the app's Undo: a compensating record that
--                                 restores the state before an earlier event
--     merge_repoint / merge_unlink a customer merge moved or dropped the link
--                                 (lib/contactMerge.ts)
--     legacy_import               one row per link that existed before G38,
--                                 so every member's history starts complete
--   Rows are never edited or removed: UPDATE and DELETE raise
--   'member_link_events_append_only'. A wrong link is fixed by appending.
--   link_version_after is the member's portal_accounts.link_version once the
--   event applied; a revert is allowed only while the two are still equal.
--   client_request_id makes a double-submitted staff action idempotent.
--
--   portal_member_link_requests holds the storefront "Request link" button
--   (owner answer 6). One pending request per member (partial UNIQUE index);
--   staff approve it through the link action (decided_event_id = that link
--   event) or reject it. The member always sees "In review".
--
--   Neither table is in BACKUP_TABLES or FACTORY_RESET_TABLES, matching
--   portal_accounts itself today (open question in the lane report).
--
-- PRE-ASSERTIONS (read-only)
--   SELECT COUNT(*) FROM sqlite_master
--     WHERE name IN ('portal_member_link_events', 'portal_member_link_requests');  -- 0
--   SELECT COUNT(*) AS linked_accounts FROM portal_accounts WHERE contact_id IS NOT NULL;  -- record it
--   SELECT COUNT(*) FROM pragma_table_info('portal_accounts') WHERE name = 'link_version';  -- 1 (0230 applied)
--
-- IN-FILE ASSERTION (portal_member_links_guard_0231): one legacy_import event
-- per linked account, no more, no less, each at version 0.
-- Both the data step and the guard look only at link_version = 0 (no link
-- change since 0230): a link staff made later already has its own event.
--
-- POST-ASSERTIONS (read-only)
--   SELECT COUNT(*) FROM portal_member_link_events WHERE action = 'legacy_import';  -- = linked_accounts
--   SELECT COUNT(*) FROM portal_member_link_events e JOIN portal_accounts a ON a.id = e.account_id
--     WHERE e.action = 'legacy_import' AND e.to_customer_id IS NOT a.contact_id;  -- 0
--   SELECT COUNT(*) FROM portal_member_link_requests;  -- 0
--   SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger'
--     AND name IN ('portal_member_link_events_no_update', 'portal_member_link_events_no_delete');  -- 2
--
-- IDEMPOTENCE: every object is IF NOT EXISTS; the data step skips accounts that
-- already have a legacy_import event and accounts whose link changed since 0230
-- (link_version > 0), so re-running the file changes nothing.
--
-- RECOVERY
--   Roll the Worker back first (the previous Worker never reads these tables,
--   but contact merges and link routes in the new one write them). Then, as a
--   forward migration if the tables must go:
--     DROP TRIGGER IF EXISTS portal_member_link_events_no_update;
--     DROP TRIGGER IF EXISTS portal_member_link_events_no_delete;
--     DROP TABLE IF EXISTS portal_member_link_requests;
--     DROP TABLE IF EXISTS portal_member_link_events;
--   This loses the link history only; portal_accounts.contact_id (the current
--   links) is untouched. Export both tables first (SELECT *) if any staff
--   action has been recorded.

CREATE TABLE IF NOT EXISTS portal_member_link_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'link', 'unlink', 'relink', 'revert', 'merge_repoint', 'merge_unlink', 'legacy_import'
  )),
  from_customer_id INTEGER,
  to_customer_id INTEGER,
  evidence TEXT CHECK (evidence IS NULL OR evidence IN ('in_person', 'called_number_on_file', 'owner_override', 'system')),
  reason_code TEXT,
  note TEXT,
  -- JSON: which suggestion signals staff were shown ({"strength":"strong","basis":["phone","name"]}).
  match_basis TEXT CHECK (match_basis IS NULL OR json_valid(match_basis)),
  -- Ties the halves of one action together (a Move, a merge, a group revert).
  group_id TEXT,
  reverts_event_id INTEGER,
  link_request_id INTEGER,
  link_version_after INTEGER NOT NULL CHECK (link_version_after >= 0),
  client_request_id TEXT,
  actor_user_id INTEGER,
  -- Snapshot only; actor_user_id stays the source of truth.
  actor_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pmle_account ON portal_member_link_events (account_id, id);
CREATE INDEX IF NOT EXISTS idx_pmle_to_customer ON portal_member_link_events (to_customer_id);
CREATE INDEX IF NOT EXISTS idx_pmle_group ON portal_member_link_events (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pmle_reverts ON portal_member_link_events (reverts_event_id) WHERE reverts_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pmle_client_request
  ON portal_member_link_events (account_id, client_request_id) WHERE client_request_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS portal_member_link_events_no_update
BEFORE UPDATE ON portal_member_link_events
BEGIN
  SELECT RAISE(ABORT, 'member_link_events_append_only');
END;

CREATE TRIGGER IF NOT EXISTS portal_member_link_events_no_delete
BEFORE DELETE ON portal_member_link_events
BEGIN
  SELECT RAISE(ABORT, 'member_link_events_append_only');
END;

CREATE TABLE IF NOT EXISTS portal_member_link_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_event_id INTEGER,
  decided_by_id INTEGER,
  decided_by_name TEXT,
  decided_note TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pmlr_one_pending
  ON portal_member_link_requests (account_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pmlr_status ON portal_member_link_requests (status, id);
CREATE INDEX IF NOT EXISTS idx_pmlr_account ON portal_member_link_requests (account_id, id);

-- History from day one: every link that already exists becomes one
-- legacy_import event. reason_code says whether the old sign-up itself made
-- that customer (0230 created_contact_id) or the account claimed an existing one.
INSERT INTO portal_member_link_events (
  account_id, action, from_customer_id, to_customer_id, evidence, reason_code,
  link_version_after, actor_name
)
SELECT a.id, 'legacy_import', NULL, a.contact_id, 'system',
  CASE WHEN a.created_contact_id IS NOT NULL AND a.created_contact_id = a.contact_id
    THEN 'signup_created_customer' ELSE 'signup_claimed_customer' END,
  a.link_version, 'system'
FROM portal_accounts a
WHERE a.contact_id IS NOT NULL
  AND a.link_version = 0
  AND NOT EXISTS (
    SELECT 1 FROM portal_member_link_events e
    WHERE e.account_id = a.id AND e.action = 'legacy_import'
  )
ORDER BY a.id;

CREATE TABLE IF NOT EXISTS portal_member_links_guard_0231 (
  check_name TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);
DELETE FROM portal_member_links_guard_0231;
INSERT INTO portal_member_links_guard_0231 (check_name, ok)
SELECT 'one_legacy_import_per_linked_account', CASE WHEN
  (SELECT COUNT(*) FROM portal_member_link_events WHERE action = 'legacy_import')
    = (SELECT COUNT(DISTINCT account_id) FROM portal_member_link_events WHERE action = 'legacy_import')
  -- Versions move only through code that needs this file's tables, so a
  -- legacy import is always at version 0.
  AND NOT EXISTS (
    SELECT 1 FROM portal_member_link_events
    WHERE action = 'legacy_import' AND link_version_after <> 0
  )
  AND NOT EXISTS (
    SELECT 1 FROM portal_accounts a
    WHERE a.contact_id IS NOT NULL AND a.link_version = 0 AND NOT EXISTS (
      SELECT 1 FROM portal_member_link_events e
      WHERE e.account_id = a.id AND e.action = 'legacy_import'
        AND e.to_customer_id = a.contact_id AND e.link_version_after = a.link_version
    )
  )
THEN 1 ELSE 0 END;
DROP TABLE IF EXISTS portal_member_links_guard_0231;
