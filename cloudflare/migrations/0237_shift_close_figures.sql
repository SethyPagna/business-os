-- SHIFT-CLOSE-FIGURES (N4, LOOPHOLE-REVIEW-20261006): the drawer figures a
-- shift was closed on, stored once at the close and never recomputed.
--
-- Why: a closed shift's expected cash was recomputed on every read from sale
-- rows that stay mutable (lib/shiftReconciliation.ts: tender belongs to
-- sales.created_at). A later bulk payment-method relabel, a cancel or an
-- amendment therefore changed a closed shift's expected drawer with no trace:
-- close $50 short, relabel $50 of Cash sales as ABA, and the closed shift
-- balanced. The close now writes the figures it was closed on here, in the
-- same D1 batch as the close; the report shows them and lists any later drift
-- as a separate "changed after close" line instead of silently absorbing it.
--
-- Creates shift_close_figures, one row per closed shift segment:
--   shift_session_id  the closed segment (shift_sessions.id), primary key
--   closed_at         the shift_sessions.closed_at the figures were taken for
--   figures_json      a JSON object written by lib/shiftReconciliation.ts
--                     buildShiftCloseFigures: { v, taken_at, window,
--                     reconciliation (opening, additional, cash sales,
--                     refunds, expenses, courier, expected, counted,
--                     difference in USD and KHR), other_tenders, sales: the
--                     per-sale tender fingerprint [id, cash $, cash riel,
--                     other $, other riel], or null past the cap }
--   created_at
-- plus two triggers: no UPDATE ever, and no DELETE outside a restore
-- maintenance window (the 0119 pattern for shift_session_amendments).
-- shift_session_id is not a *_branch_id column, so the cutover capture
-- registry is unchanged, and the table is not one the capture streams.
--
-- Additive and idempotent: CREATE TABLE / CREATE TRIGGER IF NOT EXISTS, so a
-- second run is a no-op. No existing row is read or changed. Shifts closed
-- before this file have NO row (NULL stored figures); readers fall back to
-- today's computed figures and label them "computed".
--
-- Pre-assert:  SELECT COUNT(*) FROM sqlite_master WHERE name IN
--                ('shift_close_figures','shift_close_figures_no_update',
--                 'shift_close_figures_no_delete')           -- expected 0
--              SELECT COUNT(*) FROM shift_sessions           -- record it
-- Post-assert: the same sqlite_master query                   -- expected 3
--              SELECT COUNT(*) FROM shift_close_figures       -- expected 0
--              SELECT COUNT(*) FROM shift_sessions            -- unchanged
-- Deploy order: MIGRATION FIRST. The candidate Worker inserts into this table
--              in the close batch and reads it on shift reads, with no table
--              probe ("no such table" would fail a close that computed its
--              figures). The previous Worker runs unchanged on the new schema:
--              it never names the table.
-- Recovery:    roll the Worker back first, then
--              DROP TRIGGER IF EXISTS shift_close_figures_no_delete;
--              DROP TRIGGER IF EXISTS shift_close_figures_no_update;
--              DROP TABLE IF EXISTS shift_close_figures;
--              Loses only the stored close figures; every shift report then
--              shows today's computed figures labelled "computed", exactly as
--              for shifts closed before this file. No other table changes.

CREATE TABLE IF NOT EXISTS shift_close_figures (
  shift_session_id INTEGER PRIMARY KEY REFERENCES shift_sessions(id) ON DELETE RESTRICT,
  closed_at TEXT NOT NULL,
  figures_json TEXT NOT NULL CHECK (json_valid(figures_json) AND json_type(figures_json) = 'object'),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS shift_close_figures_no_update
BEFORE UPDATE ON shift_close_figures
BEGIN
  SELECT RAISE(ABORT, 'shift close figures are immutable');
END;

CREATE TRIGGER IF NOT EXISTS shift_close_figures_no_delete
BEFORE DELETE ON shift_close_figures
WHEN NOT EXISTS (
  SELECT 1 FROM system_flags
  WHERE key = 'maintenance'
    AND json_extract(value, '$.mode') = 'restore'
)
BEGIN
  SELECT RAISE(ABORT, 'shift close figures are immutable');
END;
