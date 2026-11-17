-- read-switches-value-20261117: the read-switch states (switch names to on/off/shadow) and when they last changed.
-- Holds no customer or business data. Read-only; one row.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 14
SELECT value, updated_at
FROM system_flags
WHERE key = 'read_switches';
