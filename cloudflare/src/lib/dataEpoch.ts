import { getDb } from './db'
import { ROTATE_DATA_EPOCH_SQL } from './dataEpochSql'
import { DATA_EPOCH_KEY, readSwitchMemoMs, resetReadSwitchMemo } from './readSwitches'
import type { Env } from '../index'

// The data epoch (system_flags 'data_epoch', migration 0288) is part of every server cache key, ETag and X-BOS-Epoch header.
// Rotating it makes every entry stored under the old value unreachable in every isolate once that isolate's memo refreshes (planTier.ts readSwitchMemoSeconds),
// and in this one at once. It is rotated at maintenance entry, BEFORE the hold is released (a restore, a branch cutover, a
// force-clear), and by the Time Travel runbook; if the rotation fails the caller keeps the hold.
const READ_SQL = 'SELECT value FROM system_flags WHERE key = @key'

// Every isolate learns a new epoch when its own memo expires, up to one memo period (readSwitchMemoMs) after the rotation: until then it still keys
// reads, and stores, under the old value. A rotation that is followed by the end of a maintenance hold waits that long first (settle), so
// that when reads are admitted again no isolate can still reach an entry stored under the old epoch (6.0.1048 review N2).
// EPOCH_SETTLE_MS overrides the wait; the test worlds set it to 0 or to a few seconds, no deployment sets it.
const EPOCH_SETTLE_MARGIN_MS = 500
export function epochSettleMs(env: Env): number {
  const override = Number(env.EPOCH_SETTLE_MS)
  return env.EPOCH_SETTLE_MS !== undefined && Number.isFinite(override) && override >= 0 ? Math.min(override, 60_000) : readSwitchMemoMs(env) + EPOCH_SETTLE_MARGIN_MS
}

export async function rotateDataEpoch(env: Env, options: { settle?: boolean } = {}): Promise<string> {
  const db = getDb(env)
  await db.prepare(ROTATE_DATA_EPOCH_SQL).run()
  const row = await db.prepare(READ_SQL).get<{ value: string }>({ key: DATA_EPOCH_KEY })
  const value = row?.value
  if (typeof value !== 'string' || !/^[0-9a-f]{32}$/.test(value)) throw new Error('The data epoch was written but could not be read back')
  resetReadSwitchMemo()
  if (options.settle) {
    const wait = epochSettleMs(env)
    if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait))
  }
  return value
}
