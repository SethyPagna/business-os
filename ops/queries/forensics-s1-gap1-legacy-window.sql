-- F-forensics S1 gap 1 follow-up: the real write window of the
-- inventory_movements hole 44517..44520, and whether the legacy
-- reconciliation wrote (and lost) those rows.
-- forensics-s1-gap-cause bracketed the hole by its neighbours' created_at
-- (2026-09-01 06:45:57 .. 14:42:27). But trg_legacy_inventory_effect_apply
-- (migrations 0088, 0101) inserts every legacy movement with
-- created_at = the OLD system's occurred_at. When the rows after the hole are
-- legacy effects, 14:42:27 is when the old system recorded them, not when D1
-- inserted them. legacy_inventory_effects.imported_at is the insert time.
-- The trigger copies product, branch, batch, type, quantity and reason
-- verbatim, so an effect's surviving movement matches on those six columns
-- (created_at is left out: the Aug 31 importer re-stamps it). Effects that
-- share all six columns ("twins") are compared as a count, so one surviving
-- twin cannot hide a lost one.
-- Read-only. Ids, times, types, quantities and source-key prefixes only.
-- Sections:
--   movement      one row per surviving movement 44514..44530, with the legacy
--                 effects it matches (if any) and their imported_at
--   effect_batch  legacy effects imported 2026-09-01 .. 2026-09-03, grouped by
--                 imported_at, source and type
--   orphan        each of those effects whose six-column tuple has fewer
--                 surviving movements than effects: a candidate for the
--                 deleted rows
--   action        action_history rows (kept 180 days, unlike audit_logs'
--                 21) created or updated from 2026-09-01 06:45:57 to the end
--                 of 2 Sep: what else was done in the window, and whether it
--                 was later undone. The label is not output.
-- Columns:
--   section, id (movement id), at (movement created_at | effect imported_at),
--   occurred_at, kind, product_id, branch_id, batch_id, quantity,
--   source (source_key up to its first ':'), n, orphan_n, ids (json)
--   movement:     n = matching effects (any date), ids = their imported_at
--   effect_batch: n = effects, orphan_n = effects flagged orphan,
--                 ids = [first, last] surviving movement id
--   orphan:       n = effects sharing the tuple, orphan_n = how many of them
--                 have no movement, ids = movements matching without the
--                 reason (non-empty: the row may survive with an edited reason)
--   action:       id = action_history.id, at = created_at, occurred_at = updated_at,
--                 kind = status, source = entity, product_id = entity_id when
--                 numeric, n = reversible
-- ops:min-rows 1
-- ops:max-rows 2000
WITH mv AS MATERIALIZED (
  SELECT m.id, COALESCE(strftime('%Y-%m-%d %H:%M:%S', m.created_at), m.created_at) AS at,
    m.movement_type, m.product_id, m.branch_id, m.batch_id, m.quantity, m.reason
  FROM inventory_movements m
  WHERE m.id BETWEEN 44514 AND 44530
),
eff AS MATERIALIZED (
  SELECT e.product_id, e.branch_id, e.batch_id, e.movement_type, e.movement_quantity, e.reason,
    COALESCE(strftime('%Y-%m-%d %H:%M:%S', e.imported_at), e.imported_at) AS imported_at,
    COALESCE(strftime('%Y-%m-%d %H:%M:%S', e.occurred_at), e.occurred_at) AS occurred_at,
    CASE WHEN instr(e.source_key, ':') > 0 THEN substr(e.source_key, 1, instr(e.source_key, ':') - 1) ELSE e.source_key END AS source
  FROM legacy_inventory_effects e
  WHERE COALESCE(strftime('%Y-%m-%d %H:%M:%S', e.imported_at), e.imported_at) >= '2026-09-01 00:00:00'
    AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', e.imported_at), e.imported_at) < '2026-09-04 00:00:00'
),
tw AS MATERIALIZED (
  SELECT e.product_id, e.branch_id, e.batch_id, e.movement_type, e.movement_quantity, e.reason, COUNT(*) AS n,
    json_group_array(COALESCE(strftime('%Y-%m-%d %H:%M:%S', e.imported_at), e.imported_at)) AS imported,
    MIN(COALESCE(strftime('%Y-%m-%d %H:%M:%S', e.occurred_at), e.occurred_at)) AS occurred_at,
    MIN(CASE WHEN instr(e.source_key, ':') > 0 THEN substr(e.source_key, 1, instr(e.source_key, ':') - 1) ELSE e.source_key END) AS source
  FROM legacy_inventory_effects e
  WHERE e.product_id IN (SELECT product_id FROM eff) OR e.product_id IN (SELECT product_id FROM mv)
  GROUP BY e.product_id, e.branch_id, e.batch_id, e.movement_type, e.movement_quantity, e.reason
),
em AS MATERIALIZED (
  SELECT f.*,
    (SELECT t.n FROM tw t WHERE t.product_id = f.product_id AND t.branch_id = f.branch_id
       AND t.movement_type = f.movement_type AND t.movement_quantity = f.movement_quantity
       AND t.batch_id IS f.batch_id AND t.reason IS f.reason) AS twins,
    (SELECT json_object(
        'loose', json_group_array(m.id),
        'strict', COALESCE(SUM(CASE WHEN m.reason IS f.reason THEN 1 ELSE 0 END), 0),
        'min_id', MIN(CASE WHEN m.reason IS f.reason THEN m.id END),
        'max_id', MAX(CASE WHEN m.reason IS f.reason THEN m.id END))
      FROM inventory_movements m
      WHERE m.product_id = f.product_id AND m.branch_id = f.branch_id
        AND m.movement_type = f.movement_type AND m.quantity = f.movement_quantity
        AND m.batch_id IS f.batch_id) AS hit
  FROM eff f
)
SELECT * FROM (
  SELECT 'movement' AS section, v.id, v.at, t.occurred_at, v.movement_type AS kind,
    v.product_id, v.branch_id, v.batch_id, v.quantity, t.source,
    COALESCE(t.n, 0) AS n, NULL AS orphan_n, COALESCE(t.imported, '[]') AS ids
  FROM mv v
  LEFT JOIN tw t ON t.product_id = v.product_id AND t.branch_id = v.branch_id
    AND t.movement_type = v.movement_type AND t.movement_quantity = v.quantity
    AND t.batch_id IS v.batch_id AND t.reason IS v.reason
  UNION ALL
  SELECT 'effect_batch', NULL, e.imported_at, MIN(e.occurred_at) || ' .. ' || MAX(e.occurred_at),
    e.movement_type, NULL, NULL, NULL, SUM(e.movement_quantity), e.source,
    COUNT(*), SUM(CASE WHEN json_extract(e.hit, '$.strict') < e.twins THEN 1 ELSE 0 END),
    json_array(MIN(json_extract(e.hit, '$.min_id')), MAX(json_extract(e.hit, '$.max_id')))
  FROM em e
  GROUP BY e.imported_at, e.source, e.movement_type
  UNION ALL
  SELECT 'orphan', NULL, e.imported_at, e.occurred_at, e.movement_type, e.product_id, e.branch_id, e.batch_id,
    e.movement_quantity, e.source, e.twins, e.twins - json_extract(e.hit, '$.strict'), json_extract(e.hit, '$.loose')
  FROM em e
  WHERE json_extract(e.hit, '$.strict') < e.twins
  UNION ALL
  SELECT * FROM (
    SELECT 'action', h.id, COALESCE(strftime('%Y-%m-%d %H:%M:%S', h.created_at), h.created_at),
      COALESCE(strftime('%Y-%m-%d %H:%M:%S', h.updated_at), h.updated_at), h.status,
      CASE WHEN CAST(h.entity_id AS INTEGER) > 0 THEN CAST(h.entity_id AS INTEGER) END, NULL, NULL, NULL,
      h.entity, h.reversible, NULL, NULL
    FROM action_history h
    WHERE (COALESCE(strftime('%Y-%m-%d %H:%M:%S', h.created_at), h.created_at) >= '2026-09-01 06:45:57'
        AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', h.created_at), h.created_at) < '2026-09-03 00:00:00')
      OR (COALESCE(strftime('%Y-%m-%d %H:%M:%S', h.updated_at), h.updated_at) >= '2026-09-01 06:45:57'
        AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', h.updated_at), h.updated_at) < '2026-09-03 00:00:00')
    ORDER BY h.id
    LIMIT 500
  )
)
ORDER BY CASE section WHEN 'movement' THEN 0 WHEN 'effect_batch' THEN 1 WHEN 'orphan' THEN 2 ELSE 3 END, id, at, source, kind, product_id
LIMIT 2000
