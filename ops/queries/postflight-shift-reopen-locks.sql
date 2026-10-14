-- Release 2e postflight, review checklist item 8: reopened shifts and their
-- parents. READ-ONLY: one row of counts over shift_sessions, no names, cash or
-- reasons. A reopened shift is a child segment (parent_shift_id IS NOT NULL,
-- migration 0123); a reopen is only legal on a closed parent, so
-- parents_not_closed must be 0 and children_with_missing_parent must be 0.
--   reopened_total             every reopened (child) segment ever
--   reopened_since_2e          of those, opened at or after 2026-10-14T15:33:00Z
--   parents_closed             reopened segments whose parent has a closed_at
--   parents_not_closed         reopened segments whose parent has no closed_at
--   children_with_missing_parent  parent_shift_id points at no row
--   parents_cancelled          parents that are also marked cancelled
--   reopened_still_open        children not closed yet (live reopens)
--   reopened_closed            children already closed again
--   parents_with_two_children  must be 0 (unique index idx_shift_sessions_parent)
-- ops:min-rows 1
-- ops:max-rows 1
SELECT
  (SELECT COUNT(*) FROM shift_sessions WHERE parent_shift_id IS NOT NULL) AS reopened_total,
  (SELECT COUNT(*) FROM shift_sessions
    WHERE parent_shift_id IS NOT NULL
      AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', opened_at), opened_at) >= '2026-10-14 15:33:00') AS reopened_since_2e,
  (SELECT COUNT(*) FROM shift_sessions child
    JOIN shift_sessions parent ON parent.id = child.parent_shift_id
    WHERE child.parent_shift_id IS NOT NULL AND parent.closed_at IS NOT NULL) AS parents_closed,
  (SELECT COUNT(*) FROM shift_sessions child
    JOIN shift_sessions parent ON parent.id = child.parent_shift_id
    WHERE child.parent_shift_id IS NOT NULL AND parent.closed_at IS NULL) AS parents_not_closed,
  (SELECT COUNT(*) FROM shift_sessions child
    WHERE child.parent_shift_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM shift_sessions parent WHERE parent.id = child.parent_shift_id)) AS children_with_missing_parent,
  (SELECT COUNT(*) FROM shift_sessions child
    JOIN shift_sessions parent ON parent.id = child.parent_shift_id
    WHERE child.parent_shift_id IS NOT NULL AND parent.cancelled_at IS NOT NULL) AS parents_cancelled,
  (SELECT COUNT(*) FROM shift_sessions
    WHERE parent_shift_id IS NOT NULL AND closed_at IS NULL AND cancelled_at IS NULL) AS reopened_still_open,
  (SELECT COUNT(*) FROM shift_sessions
    WHERE parent_shift_id IS NOT NULL AND closed_at IS NOT NULL) AS reopened_closed,
  (SELECT COUNT(*) FROM (
    SELECT parent_shift_id FROM shift_sessions
    WHERE parent_shift_id IS NOT NULL
    GROUP BY parent_shift_id HAVING COUNT(*) > 1)) AS parents_with_two_children
