// Settings-table persistence for the rotating cron (lib/cronRotation.ts).
// One row, written twice per tick (before the step, after it).

import { getDb } from './db'
import { CRON_STATE_KEY, parseRotationState, type RotationState, type RotationStore } from './cronRotation'
import type { Env } from '../index'

export async function loadRotationState(env: Env): Promise<RotationState | null> {
  const row = await getDb(env).prepare('SELECT value FROM settings WHERE key = @key').get<{ value: string }>({ key: CRON_STATE_KEY })
  return row?.value ? parseRotationState(row.value) : null
}

export function settingsRotationStore(env: Env): RotationStore {
  return {
    load: () => loadRotationState(env),
    async save(state) {
      await getDb(env).prepare(`
        INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run({ key: CRON_STATE_KEY, value: JSON.stringify(state) })
    },
  }
}
