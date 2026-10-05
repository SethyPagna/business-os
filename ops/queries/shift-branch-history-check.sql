-- SEC-SHIFT (LOOPHOLE-REVIEW-20261006 N7/N4) pre-cutover check. One row of
-- counts only: no names, cash or notes.
--   blank_branch_label        shifts filed under a branch but with no stored
--                             branch_name. The shift UI labels history with
--                             the stored name (never today's), so these would
--                             read "All branches". Must be 0; if not, the
--                             cutover snapshot pass must also fill
--                             shift_sessions.branch_name before Shop is renamed.
--   open_on_inactive_branch   drawers still open on a branch that no longer
--                             trades. Closable since N7; reported so the
--                             cutover can be scheduled after they are closed.
--   on_inactive_branch        all shifts of retired branches (history that
--                             was hidden before N7).
--   close_figures_table       1 once migration 0237 is applied.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero blank_branch_label
SELECT
  (SELECT COUNT(*) FROM shift_sessions
    WHERE branch_id IS NOT NULL AND trim(coalesce(branch_name, '')) = '') AS blank_branch_label,
  (SELECT COUNT(*) FROM shift_sessions
    WHERE closed_at IS NULL AND cancelled_at IS NULL AND branch_id IS NOT NULL
      AND branch_id NOT IN (SELECT id FROM branches WHERE is_active = 1)) AS open_on_inactive_branch,
  (SELECT COUNT(*) FROM shift_sessions
    WHERE branch_id IS NOT NULL
      AND branch_id NOT IN (SELECT id FROM branches WHERE is_active = 1)) AS on_inactive_branch,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'shift_close_figures') AS close_figures_table
