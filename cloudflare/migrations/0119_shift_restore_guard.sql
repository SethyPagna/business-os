-- Keep shift amendments immutable during ordinary application use while
-- allowing the authorized backup restore path to replace the full ledger.
-- system_flags is excluded from backups and the restore route sets this flag
-- before deleting any backed-up table, so a crash remains fail-closed.
DROP TRIGGER IF EXISTS shift_session_amendments_no_delete;
CREATE TRIGGER shift_session_amendments_no_delete
BEFORE DELETE ON shift_session_amendments
WHEN NOT EXISTS (
  SELECT 1 FROM system_flags
  WHERE key = 'maintenance'
    AND json_extract(value, '$.mode') = 'restore'
)
BEGIN
  SELECT RAISE(ABORT, 'shift amendments are immutable');
END;
