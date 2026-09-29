import type { Env } from '../index'
import { reportError, scrubValue } from './errorReporting'
import { runBackground } from './requestMetrics'

// system_flags, not settings: runtime state that a restore must not roll back
// and that GET /api/settings must not hand to every signed-in user.
export const CRON_STEP_FLAG_PREFIX = 'cron_step:'
const STORED_ERROR_MAX_CHARS = 300

const EXISTING_JSON = `CASE WHEN json_valid(system_flags.value) THEN system_flags.value ELSE '{}' END`

const RECORD_STEP_OK_SQL = `INSERT INTO system_flags (key, value, updated_at)
  VALUES (?1, json_object('lastOkAt', ?2), CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET
    value = json_set(${EXISTING_JSON}, '$.lastOkAt', ?2),
    updated_at = CURRENT_TIMESTAMP`

const RECORD_STEP_ERROR_SQL = `INSERT INTO system_flags (key, value, updated_at)
  VALUES (?1, json_object('lastErrorAt', ?2, 'lastError', ?3), CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET
    value = json_set(${EXISTING_JSON}, '$.lastErrorAt', ?2, '$.lastError', ?3),
    updated_at = CURRENT_TIMESTAMP`

export type CronStepOutcome<T> = { ok: true; value: T } | { ok: false }

function storedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error')
  return String(scrubValue(message)).slice(0, STORED_ERROR_MAX_CHARS)
}

async function recordStepStatus(env: Env, sql: string, values: string[]): Promise<void> {
  try {
    await env.DB.prepare(sql).bind(...values).run()
  } catch (error) {
    console.error('[scheduled] could not record step status', values[0], (error as Error)?.message || error)
  }
}

/**
 * Runs one scheduled step in isolation: a throw is logged, sent to Sentry and
 * stored as the step's lastError instead of aborting the steps behind it.
 * Never rejects.
 */
export async function runCronStep<T>(env: Env, label: string, step: () => Promise<T>): Promise<CronStepOutcome<T>> {
  const key = `${CRON_STEP_FLAG_PREFIX}${label}`
  try {
    const value = await runBackground(env, `cron:${label}`, step)
    await recordStepStatus(env, RECORD_STEP_OK_SQL, [key, new Date().toISOString()])
    return { ok: true, value }
  } catch (error) {
    console.error(`[scheduled] ${label} failed`, (error as Error)?.message || error)
    await reportError(env.SENTRY_DSN, error, { source: 'worker', location: `cron:${label}`, method: 'CRON', release: null, role: null })
    await recordStepStatus(env, RECORD_STEP_ERROR_SQL, [key, new Date().toISOString(), storedErrorMessage(error)])
    return { ok: false }
  }
}
