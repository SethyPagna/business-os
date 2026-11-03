import { getDb } from './db'
import { ROTATE_DATA_EPOCH_SQL } from './dataEpochSql'
import { DATA_EPOCH_KEY, resetReadSwitchMemo } from './readSwitches'
import type { Env } from '../index'

// The data epoch (system_flags 'data_epoch', migration 0288) is part of every server cache key, ETag and X-BOS-Epoch header.
// Rotating it makes every entry stored under the old value unreachable in every isolate once that isolate's memo refreshes (15 s),
// and in this one at once. It is rotated at maintenance entry, BEFORE the hold is released (a restore, a branch cutover, a
// force-clear), and by the Time Travel runbook; if the rotation fails the caller keeps the hold.
const READ_SQL = 'SELECT value FROM system_flags WHERE key = @key'

export async function rotateDataEpoch(env: Env): Promise<string> {
  const db = getDb(env)
  await db.prepare(ROTATE_DATA_EPOCH_SQL).run()
  const row = await db.prepare(READ_SQL).get<{ value: string }>({ key: DATA_EPOCH_KEY })
  const value = row?.value
  if (typeof value !== 'string' || !/^[0-9a-f]{32}$/.test(value)) throw new Error('The data epoch was written but could not be read back')
  resetReadSwitchMemo()
  return value
}
