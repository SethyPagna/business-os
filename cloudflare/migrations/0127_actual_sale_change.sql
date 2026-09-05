-- Preserve forward-only, server-validated native change without guessing at
-- historical rows. Existing change_usd/change_khr values are dual currency
-- representations unless a later write explicitly marks them as actual.
--
-- Pre/post: all existing sale money values and row counts are unchanged;
-- every existing row reads change_is_actual = 0 and change_exchange_rate NULL.
-- Recovery: old code ignores both additive columns. Retain them on rollback so
-- validated provenance is not discarded; no destructive down migration.
ALTER TABLE sales ADD COLUMN change_is_actual INTEGER NOT NULL DEFAULT 0
  CHECK (change_is_actual IN (0, 1));

ALTER TABLE sales ADD COLUMN change_exchange_rate REAL;
