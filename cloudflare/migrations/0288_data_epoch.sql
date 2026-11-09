-- 0288: the database's data epoch (lane 6.0.1048, P0.7 cache-lifecycle base).
--
-- One random value per database, kept in system_flags under 'data_epoch'. Every server cache key, ETag and X-BOS-Epoch header carries it,
-- so rotating it (maintenance entry, before the hold is released, a Time Travel restore, a force-clear) makes every older cache entry
-- unreachable at once, in every isolate, without enumerating anything. Two databases never share a value, so two deployments that share
-- one Cache API namespace cannot serve each other's bodies.
--
-- Nothing existing is read for update or changed. The row is outside in-app backups (system_flags is excluded), so a restore cannot bring an
-- older value back; a D1 Time Travel restore does roll it back, and the Time Travel runbook rotates it afterwards (CACHE-LIFECYCLE R9).
--
-- LF-only, append-only, generic. Applying it twice aborts at the PRE assertion.
--
-- PRE:  no 'data_epoch' flag exists. Asserted below (the first SELECT aborts otherwise).
-- POST: exactly one 'data_epoch' flag, 32 lower-case hex characters. Asserted below.
-- RECOVERY: a Worker that does not know the row ignores it; one that does treats a missing or malformed row as "no safe key" and
--       computes uncached. To start over:  UPDATE system_flags SET value = lower(hex(randomblob(16))), updated_at = CURRENT_TIMESTAMP
--       WHERE key = 'data_epoch';

SELECT CASE WHEN (SELECT COUNT(*) FROM system_flags WHERE key = 'data_epoch') = 0
THEN 1 ELSE json_extract('[]','$[data_epoch_0288_pre]') END;

INSERT INTO system_flags (key, value, updated_at) VALUES ('data_epoch', lower(hex(randomblob(16))), CURRENT_TIMESTAMP);

SELECT CASE WHEN (SELECT COUNT(*) FROM system_flags WHERE key = 'data_epoch') = 1
  AND (SELECT length(value) FROM system_flags WHERE key = 'data_epoch') = 32
  AND (SELECT value NOT GLOB '*[^0-9a-f]*' FROM system_flags WHERE key = 'data_epoch') = 1
THEN 1 ELSE json_extract('[]','$[data_epoch_0288_post]') END;
