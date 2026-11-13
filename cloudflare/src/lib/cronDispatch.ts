// Which job a scheduled firing runs. Kept out of src/index.ts so a test can
// drive it with fake steps and a fake store instead of reading source text.
//
//   CRON_TELEGRAM -> the Telegram drain, nothing else (own invocation)
//   CRON_HEAVY    -> ONE heavy step (full backup / image audit), its own cursor
//   anything else -> ONE retention step, the rotation cursor (this includes the
//                    retired 6-hourly expression during a rollout)

import {
  CRON_HEAVY, CRON_HEAVY_STATE_KEY, CRON_HEAVY_TICK_MS, CRON_ROTATION_TICK_MS, CRON_STATE_KEY, CRON_TELEGRAM,
  runRotationTick, type RotationStep, type RotationStore, type RotationTickOptions, type TickResult,
} from './cronRotation'

export interface CronDispatchDeps {
  drainTelegram(): Promise<unknown>
  heavySteps(): RotationStep[]
  /** Picks the heavy step by schedule (the daily backup) instead of by cursor alternation; see lib/backupSchedule.ts. */
  heavySelect?: RotationTickOptions['select']
  rotationSteps(): RotationStep[]
  storeFor(key: string): RotationStore
}

export type CronDispatchResult = { lane: 'telegram' } | { lane: 'heavy' | 'rotation'; tick: TickResult }

export async function dispatchCron(cron: string | undefined, scheduledTimeMs: number, deps: CronDispatchDeps): Promise<CronDispatchResult> {
  if (cron === CRON_TELEGRAM) {
    // The backstop for a shift overview nothing else has sent.
    try { await deps.drainTelegram() } catch { /* logged by the caller's wrapper */ }
    return { lane: 'telegram' }
  }
  const at = Number.isFinite(scheduledTimeMs) ? scheduledTimeMs : Date.now()
  if (cron === CRON_HEAVY) {
    const slot = Math.floor(at / CRON_HEAVY_TICK_MS)
    return { lane: 'heavy', tick: await runRotationTick(deps.heavySteps(), deps.storeFor(CRON_HEAVY_STATE_KEY), Date.now(), { slot, select: deps.heavySelect }) }
  }
  const slot = Math.floor(at / CRON_ROTATION_TICK_MS)
  return { lane: 'rotation', tick: await runRotationTick(deps.rotationSteps(), deps.storeFor(CRON_STATE_KEY), Date.now(), { slot }) }
}
