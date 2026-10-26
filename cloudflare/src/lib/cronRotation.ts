// Rotating cron: ONE background step per scheduled invocation.
//
// The scheduled handler used to run about ten steps in a single invocation.
// A cron invocation gets the SAME CPU budget as a request (10 ms on the
// Workers Free plan), and a Worker killed for CPU is not an exception the
// handler can catch: everything after the step that ran out simply never
// happens. Retention, pruning and the image audit sat at the back of that
// chain and starved silently once the account returned to Free.
//
// Now the cron fires often (CRON_ROTATION) and each tick runs exactly ONE
// step, chosen by a cursor persisted in the settings table:
//   - the cursor is advanced and saved BEFORE the step runs, so a step that is
//     killed (no catch, no finally) cannot pin the cursor and starve the
//     steps behind it; the next tick simply moves on;
//   - a step that reports `more: true` (it stopped at its own batch bound
//     with work left) is resumed on the next tick, at most MAX_RESUME_STREAK
//     times in a row, so a big backlog drains without monopolising the cron;
//   - every step has a health record (started / finished / ok / error /
//     killed) so a starved or perpetually killed step is visible at
//     GET /api/runtime/cron-health instead of failing silently.
//
// Telegram is deliberately NOT in the rotation: it has its own, more frequent
// trigger (CRON_TELEGRAM) so a scheduled after-shift summary is never waiting
// behind retention. Both triggers must stay in wrangler.toml and
// wrangler.free.toml (Free allows 5 per account); a test pins that.
//
// Pure: the step list and the state store are injected so the simulation test
// can run it without a Worker.

export const CRON_TELEGRAM = '*/5 * * * *'
export const CRON_ROTATION = '*/15 * * * *'
export const CRON_SCHEDULES: readonly string[] = [CRON_TELEGRAM, CRON_ROTATION]
export const CRON_ROTATION_TICK_MS = 15 * 60 * 1000
export const CRON_STATE_KEY = 'cron_rotation_state'
export const MAX_RESUME_STREAK = 2
/** A step not started for this many full cycles (+ slack) is starved. */
export const STARVED_CYCLES = 2

export interface StepState {
  startedAt: string | null
  finishedAt: string | null
  okAt: string | null
  error: string | null
  /** Consecutive failed or killed visits. */
  failures: number
  /** Visits that started and never finished (isolate killed mid-step). */
  killed: number
  runs: number
}

export interface RotationState {
  cursor: number
  resumeStreak: number
  steps: Record<string, StepState>
  updatedAt: string | null
  /** Bumped by every successful save; the store only writes over the version it was loaded at. */
  version: number
}

export interface RotationStore {
  load(): Promise<RotationState | null>
  /**
   * Compare-and-set: write only if the stored state is still at
   * `expectedVersion` (null = no row yet). Resolves false when another tick
   * got there first -- the caller must not treat its view as current.
   */
  save(state: RotationState, expectedVersion: number | null): Promise<boolean>
}

export interface RotationStep {
  id: string
  run(): Promise<unknown>
  /** Skip the visit when this step last finished OK less than this long ago. */
  minIntervalMs?: number
}

export interface TickResult {
  stepId: string | null
  ok: boolean
  more: boolean
  error?: string
  /** Not run: gated by minIntervalMs, or another tick took this position. */
  skipped?: 'recent' | 'lost-race'
}

const emptyStep = (): StepState => ({ startedAt: null, finishedAt: null, okAt: null, error: null, failures: 0, killed: 0, runs: 0 })

export function emptyRotationState(): RotationState {
  return { cursor: 0, resumeStreak: 0, steps: {}, updatedAt: null, version: 0 }
}

function sanitize(raw: unknown): RotationState {
  const base = emptyRotationState()
  if (!raw || typeof raw !== 'object') return base
  const src = raw as Partial<RotationState>
  base.cursor = Number.isInteger(src.cursor) && (src.cursor as number) >= 0 ? (src.cursor as number) : 0
  base.resumeStreak = Number.isInteger(src.resumeStreak) && (src.resumeStreak as number) >= 0 ? (src.resumeStreak as number) : 0
  base.updatedAt = typeof src.updatedAt === 'string' ? src.updatedAt : null
  base.version = Number.isInteger(src.version) && (src.version as number) >= 0 ? (src.version as number) : 0
  if (src.steps && typeof src.steps === 'object') {
    for (const [id, value] of Object.entries(src.steps)) {
      const v = (value || {}) as Partial<StepState>
      base.steps[id] = {
        startedAt: typeof v.startedAt === 'string' ? v.startedAt : null,
        finishedAt: typeof v.finishedAt === 'string' ? v.finishedAt : null,
        okAt: typeof v.okAt === 'string' ? v.okAt : null,
        error: typeof v.error === 'string' ? v.error : null,
        failures: Number(v.failures) > 0 ? Math.floor(Number(v.failures)) : 0,
        killed: Number(v.killed) > 0 ? Math.floor(Number(v.killed)) : 0,
        runs: Number(v.runs) > 0 ? Math.floor(Number(v.runs)) : 0,
      }
    }
  }
  return base
}

export function parseRotationState(text: string | null | undefined): RotationState {
  if (!text) return emptyRotationState()
  try { return sanitize(JSON.parse(text)) } catch { return emptyRotationState() }
}

const shortError = (error: unknown) => String((error as Error)?.message || error || 'error').replace(/\s+/g, ' ').slice(0, 200)

/**
 * Run the next step. Never throws: a store failure falls back to a
 * time-derived position (still rotates, only loses resume and health), and a
 * step failure is recorded and swallowed.
 */
export async function runRotationTick(steps: readonly RotationStep[], store: RotationStore, nowMs: number = Date.now()): Promise<TickResult> {
  if (!steps.length) return { stepId: null, ok: true, more: false }
  const nowIso = new Date(nowMs).toISOString()

  let state: RotationState | null = null
  let persisted = true
  try { state = await store.load() } catch { persisted = false }
  // null = there is no row yet (the first ever write inserts it).
  let expected: number | null = state ? sanitize(state).version : null
  const current = state ? sanitize(state) : emptyRotationState()
  // No readable cursor: derive one from the clock so rotation still advances.
  const index = persisted ? current.cursor % steps.length : Math.floor(nowMs / CRON_ROTATION_TICK_MS) % steps.length
  const step = steps[index]
  const record = current.steps[step.id] ?? emptyStep()
  // Write the state over the version we read. A false answer means another
  // overlapping tick moved the cursor first: this one must neither rewind it
  // nor run the step that tick already claimed (a scheduled paid backup must
  // not run twice). A thrown save is only a missing health row, not a reason
  // to skip the job.
  const commit = async (): Promise<boolean> => {
    if (!persisted) { try { await store.save(current, null) } catch { /* best effort */ } return true }
    current.version = (expected ?? -1) + 1
    try {
      const won = await store.save(current, expected)
      if (won) expected = current.version
      return won
    } catch { return true }
  }
  // Gated step, visited too soon: advance past it and do nothing else.
  if (step.minIntervalMs && record.okAt && nowMs - Date.parse(record.okAt) < step.minIntervalMs) {
    current.cursor = (index + 1) % steps.length
    current.resumeStreak = 0
    current.updatedAt = nowIso
    record.startedAt = nowIso
    record.finishedAt = nowIso
    current.steps[step.id] = record
    await commit()
    return { stepId: step.id, ok: true, more: false, skipped: 'recent' }
  }
  // Started on an earlier visit and never finished: the isolate was killed.
  if (record.startedAt && (!record.finishedAt || record.finishedAt < record.startedAt)) {
    record.killed += 1
    record.failures += 1
    record.error = 'killed before finishing (CPU or wall limit)'
  }
  record.startedAt = nowIso
  current.steps[step.id] = record
  // Advance first; fixed up below if the step asks to be resumed.
  current.cursor = (index + 1) % steps.length
  current.updatedAt = nowIso
  if (!(await commit())) return { stepId: step.id, ok: true, more: false, skipped: 'lost-race' }

  let ok = true
  let more = false
  let error: string | undefined
  try {
    const result = await step.run()
    more = !!result && typeof result === 'object' && (result as { more?: unknown }).more === true
  } catch (caught) {
    ok = false
    error = shortError(caught)
  }

  record.finishedAt = new Date(Math.max(Date.now(), nowMs)).toISOString()
  record.runs += 1
  if (ok) { record.okAt = record.finishedAt; record.error = null; record.failures = 0 } else { record.error = error ?? 'error'; record.failures += 1 }
  if (ok && more && current.resumeStreak < MAX_RESUME_STREAK) {
    current.cursor = index
    current.resumeStreak += 1
  } else {
    current.resumeStreak = 0
  }
  await commit() // losing here only drops this visit's health row; the cursor never rewinds
  return { stepId: step.id, ok, more, ...(error ? { error } : {}) }
}

export type StepHealthStatus = 'never' | 'ok' | 'failing' | 'killed' | 'starved'

export interface CronHealthRow {
  id: string
  status: StepHealthStatus
  lastStartedAt: string | null
  lastOkAt: string | null
  failures: number
  killed: number
  error: string | null
}

export interface CronHealth {
  healthy: boolean
  stateUpdatedAt: string | null
  stale: boolean
  steps: CronHealthRow[]
  problems: string[]
}

/** Classify every rotation step; `problems` lists the ids that need a look. */
export function evaluateCronHealth(state: RotationState, stepIds: readonly string[], nowMs: number = Date.now(), tickMs: number = CRON_ROTATION_TICK_MS): CronHealth {
  const cycleMs = Math.max(1, stepIds.length) * tickMs
  const limit = cycleMs * STARVED_CYCLES + tickMs * (MAX_RESUME_STREAK + 1)
  const updated = state.updatedAt ? Date.parse(state.updatedAt) : NaN
  const stale = !Number.isFinite(updated) || nowMs - updated > limit
  const rows: CronHealthRow[] = stepIds.map((id) => {
    const s = state.steps[id] ?? emptyStep()
    const started = s.startedAt ? Date.parse(s.startedAt) : NaN
    let status: StepHealthStatus
    if (!s.startedAt) status = 'never'
    else if (s.failures > 0 && String(s.error || '').startsWith('killed')) status = 'killed'
    else if (s.failures > 0) status = 'failing'
    else if (nowMs - started > limit) status = 'starved'
    else status = 'ok'
    return { id, status, lastStartedAt: s.startedAt, lastOkAt: s.okAt, failures: s.failures, killed: s.killed, error: s.error }
  })
  // 'never' is only a problem once a whole cycle should have visited it.
  const problems = rows.filter((r) => r.status !== 'ok' && (r.status !== 'never' || stale)).map((r) => r.id)
  return { healthy: !stale && problems.length === 0, stateUpdatedAt: state.updatedAt, stale, steps: rows, problems }
}
