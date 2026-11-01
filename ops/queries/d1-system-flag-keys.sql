-- d1-system-flag-keys: system flag names and value sizes only (no values),
-- to confirm a free name for read-optimisation switches.
-- ops:min-rows 0
SELECT key, length(value) AS bytes, updated_at
FROM system_flags
ORDER BY key;
