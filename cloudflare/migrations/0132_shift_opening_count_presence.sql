-- Preserve the difference between an opening drawer that was counted as zero
-- and a currency that was not counted. The original 0116 money columns are
-- NOT NULL, so presence flags add the missing fact without rebuilding the
-- shift table and its lineage, audit, and restore constraints.
--
-- Preflight census (record the result before applying):
-- SELECT COUNT(*) AS rows_total,
--   SUM(opening_float_usd = 0) AS usd_zero_ambiguous,
--   SUM(opening_float_khr = 0) AS khr_zero_ambiguous
-- FROM shift_sessions;
-- Historical zero is ambiguous because the old form converted blank to zero.
-- Preserve the raw amount, but mark only historical nonzero values registered.
-- New Worker writes always supply each flag, so an explicit new zero is 1.
-- Postcondition (expected violations=0 immediately after this migration):
-- SELECT COUNT(*) AS violations FROM shift_sessions
-- WHERE opening_float_usd_registered != (opening_float_usd != 0)
--    OR opening_float_khr_registered != (opening_float_khr != 0);
-- Recovery: application rollback is safe because the legacy money columns
-- and their raw values remain unchanged. The two additive columns may remain
-- in place; do not drop or rebuild shift_sessions during an incident. Old code
-- will display an unknown historical zero as zero until the new code returns.

ALTER TABLE shift_sessions ADD COLUMN opening_float_usd_registered INTEGER NOT NULL DEFAULT 0
  CHECK (opening_float_usd_registered IN (0, 1));

ALTER TABLE shift_sessions ADD COLUMN opening_float_khr_registered INTEGER NOT NULL DEFAULT 0
  CHECK (opening_float_khr_registered IN (0, 1));

UPDATE shift_sessions SET
  opening_float_usd_registered = CASE WHEN opening_float_usd != 0 THEN 1 ELSE 0 END,
  opening_float_khr_registered = CASE WHEN opening_float_khr != 0 THEN 1 ELSE 0 END;
