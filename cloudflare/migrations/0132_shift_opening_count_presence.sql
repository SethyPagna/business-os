-- Preserve the difference between an opening drawer that was counted as zero
-- and a currency that was not counted. The original 0116 money columns are
-- NOT NULL, so presence flags add the missing fact without rebuilding the
-- shift table and its lineage, audit, and restore constraints.
--
-- Precondition: every existing row predates optional opening counts and its
-- stored non-negative amount is therefore a registered amount.
-- Postcondition: existing rows keep presence=1; new writes may store the
-- legacy numeric placeholder 0 with presence=0 and expose that currency as
-- NULL through the Worker API.
-- Recovery: application rollback is safe because the legacy money columns
-- remain populated. The two additive columns may remain in place; do not drop
-- or rebuild shift_sessions during an incident.

ALTER TABLE shift_sessions ADD COLUMN opening_float_usd_registered INTEGER NOT NULL DEFAULT 1
  CHECK (opening_float_usd_registered IN (0, 1));

ALTER TABLE shift_sessions ADD COLUMN opening_float_khr_registered INTEGER NOT NULL DEFAULT 1
  CHECK (opening_float_khr_registered IN (0, 1));
