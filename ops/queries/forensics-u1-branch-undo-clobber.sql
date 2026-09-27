-- F-forensics U1: branch Undo / Redo replays that overwrote a later edit.
-- The branch.update applier (lib/undoAppliers.ts) writes the whole stored
-- field set and only re-checks name / is_active, so an undo of edit A after
-- someone else's edit B silently puts back A's values for B's fields too.
-- For each replay (audit action_undo / action_redo, applier branch.update) the
-- replayed action is the branch.update history row for that branch whose
-- updated_at is nearest the replay; every other branch.update row for the
-- branch created between that action and the replay is an intervening edit.
-- A field is clobbered when the intervening edit changed it and the replayed
-- payload wrote a different value. No field VALUES are returned.
--   replay_audit_id, replay_at, direction, branch_id, history_id, action_created_at
--   intervening_history_id, intervening_at, field
--   current_equals_intervening   1: the branch now holds the intervening value
--                                  again (someone re-entered it: compensated)
--   later_branch_edits           PUT edits of the branch after the replay
-- ops:min-rows 0
-- ops:max-rows 2000
WITH replays AS (
  SELECT a.id AS replay_audit_id, COALESCE(strftime('%Y-%m-%d %H:%M:%S', a.created_at), a.created_at) AS replay_at,
    CASE WHEN a.action = 'action_undo' THEN 'undo' ELSE 'redo' END AS direction,
    CAST(a.entity_id AS INTEGER) AS branch_id
  FROM audit_logs a
  WHERE a.action IN ('action_undo', 'action_redo') AND a.entity = 'branch'
    AND json_valid(a.details) AND json_extract(a.details, '$.applier') = 'branch.update'
),
hist AS (
  SELECT h.id, CAST(json_extract(h.undo_payload, '$.id') AS INTEGER) AS branch_id,
    COALESCE(strftime('%Y-%m-%d %H:%M:%S', h.created_at), h.created_at) AS created_at, COALESCE(strftime('%Y-%m-%d %H:%M:%S', h.updated_at), h.updated_at) AS updated_at, h.undo_payload, h.redo_payload
  FROM action_history h
  WHERE json_valid(h.undo_payload) AND json_extract(h.undo_payload, '$.applier') = 'branch.update'
),
matched AS (
  SELECT r.*,
    (SELECT h.id FROM hist h WHERE h.branch_id = r.branch_id AND h.created_at <= r.replay_at
      AND ABS(julianday(h.updated_at) - julianday(r.replay_at)) = (SELECT MIN(ABS(julianday(h2.updated_at) - julianday(r.replay_at)))
        FROM hist h2 WHERE h2.branch_id = r.branch_id AND h2.created_at <= r.replay_at)
      ORDER BY h.id DESC LIMIT 1) AS history_id
  FROM replays r
),
fields2(field) AS (
  VALUES ('location'), ('phone'), ('manager'), ('notes'), ('is_default'), ('is_active'), ('name')
),
pairs AS (
  SELECT m.replay_audit_id, m.replay_at, m.direction, m.branch_id, m.history_id, h.created_at AS action_created_at,
    CASE WHEN m.direction = 'undo' THEN h.undo_payload ELSE h.redo_payload END AS applied_payload,
    i.id AS intervening_history_id, i.created_at AS intervening_at, i.undo_payload AS i_before, i.redo_payload AS i_after
  FROM matched m
  JOIN hist h ON h.id = m.history_id
  JOIN hist i ON i.branch_id = m.branch_id AND i.id <> h.id AND i.created_at > h.created_at AND i.created_at < m.replay_at
)
SELECT
  p.replay_audit_id, p.replay_at, p.direction, p.branch_id, p.history_id, p.action_created_at,
  p.intervening_history_id, p.intervening_at, f.field,
  CASE WHEN (SELECT CAST(CASE f.field
      WHEN 'location' THEN b.location WHEN 'phone' THEN b.phone WHEN 'manager' THEN b.manager
      WHEN 'notes' THEN b.notes WHEN 'is_default' THEN b.is_default WHEN 'is_active' THEN b.is_active
      ELSE b.name END AS TEXT) FROM branches b WHERE b.id = p.branch_id)
    IS CAST(json_extract(p.i_after, '$.fields.' || f.field) AS TEXT) THEN 1 ELSE 0 END AS current_equals_intervening,
  (SELECT COUNT(*) FROM audit_logs a WHERE a.action = 'update' AND a.entity = 'branch'
    AND CAST(a.entity_id AS INTEGER) = p.branch_id AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', a.created_at), a.created_at) > p.replay_at) AS later_branch_edits
FROM pairs p
JOIN fields2 f
WHERE json_type(p.i_after, '$.fields.' || f.field) IS NOT NULL
  AND CAST(json_extract(p.i_before, '$.fields.' || f.field) AS TEXT) IS NOT CAST(json_extract(p.i_after, '$.fields.' || f.field) AS TEXT)
  AND CAST(json_extract(p.applied_payload, '$.fields.' || f.field) AS TEXT) IS NOT CAST(json_extract(p.i_after, '$.fields.' || f.field) AS TEXT)
ORDER BY p.replay_at, p.branch_id, f.field
LIMIT 2000
