// The one statement that gives the database a new data epoch (system_flags 'data_epoch', migration 0288). It has no imports so a D1
// batch that must rotate atomically with something else (the branch cutover's release of maintenance) can carry it without pulling in
// the rest of the epoch module.
export const ROTATE_DATA_EPOCH_SQL = `INSERT INTO system_flags (key, value, updated_at) VALUES ('data_epoch', lower(hex(randomblob(16))), CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
