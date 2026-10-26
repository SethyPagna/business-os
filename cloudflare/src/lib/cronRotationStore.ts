// Settings-table persistence for the rotating cron (lib/cronRotation.ts).
// One row, written twice per tick (before the step, after it), always as a
// compare-and-set on the state's version so two overlapping ticks (a tick that
// outlives 15 minutes, or the old and new triggers firing together while a
// deploy propagates) cannot rewind the cursor or both claim the same step.

import { getDb } from './db'
import { CRON_STATE_KEY, parseRotationState, type RotationState, type RotationStore } from './cronRotation'
import type { Env } from '../index'

export async function loadRotationState(env: Env, key: string = CRON_STATE_KEY): Promise<RotationState | null> {
  const row = await getDb(env).prepare('SELECT value FROM settings WHERE key = @key').get<{ value: string }>({ key })
  return row ? parseRotationState(row.value) : null
}

export function settingsRotationStore(env: Env, key: string = CRON_STATE_KEY): RotationStore {
  return {
    load: () => loadRotationState(env, key),
    async save(state, expectedVersion) {
      const db = getDb(env)
      const value = JSON.stringify(state)
      if (expectedVersion === null) {
        // First ever write: lose cleanly to a concurrent first writer.
        const inserted = await db.prepare(`
          INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, CURRENT_TIMESTAMP)
          ON CONFLICT(key) DO NOTHING
        `).run({ key, value })
        return (inserted.changes ?? 0) > 0
      }
      // A row with no version (or unparseable JSON) counts as version 0.
      const updated = await db.prepare(`
        UPDATE settings SET value = @value, updated_at = CURRENT_TIMESTAMP
        WHERE key = @key AND COALESCE(CASE WHEN json_valid(value) THEN json_extract(value, '$.version') END, 0) = @expected
      `).run({ key, value, expected: expectedVersion })
      return (updated.changes ?? 0) > 0
    },
  }
}
