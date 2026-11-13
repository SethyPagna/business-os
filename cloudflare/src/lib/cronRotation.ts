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
// behind retention. All three triggers (CRON_SCHEDULES) must stay in wrangler.toml and
// wrangler.free.toml (Free allows 5 per ACCOUNT, shared with any other Worker on it);
// a test pins that.
//
// Pure: the step list and the state store are injected so the simulation test
// can run it without a Worker.

export const CRON_TELEGRAM = '*/5 * * * *'
export const CRON_ROTATION = '*/15 * * * *'
// The CPU-heavy steps (full backup, image audit) run on this trigger alone. Interval
// must stay >= 1 hour: Workers Paid grants a cron trigger up to 15 minutes of CPU at
// >= 1 hour and only 30 seconds below it (wall time is 15 minutes for every cron).
// In practice the ceiling is the [limits] cpu_ms in wrangler.toml (5 minutes), still far
// above 30 s.
export const CRON_HEAVY = '17 */3 * * *'
export const CRON_HEAVY_TICK_MS = 3 * 60 * 60 * 1000
export const CRON_SCHEDULES: readonly string[] = [CRON_TELEGRAM, CRON_ROTATION, CRON_HEAVY]
export const CRON_ROTATION_TICK_MS = 15 * 60 * 1000
export const CRON_STATE_KEY = 'cron_rotation_state'
export const CRON_HEAVY_STATE_KEY = 'cron_heavy_state'
export const MAX_RESUME_STREAK = 2
/** A step not started for this many full cycles (+ slack) is starved. */
export const STARVED_CYCLES = 2

/**
 * Steps with no interval gate of their own (they used to ride the 6-hourly tick, about 4 runs a day) are held to the old
 * cadence or slower by the rotation's own record of their last OK run (no extra D1 read): the rotation now comes round
 * every 2.75 h and the heavy trigger every 3 h. 5 h, not 6 h, so jitter between visits cannot make a step skip every second
 * round. Used by the 15-minute rotation's ungated steps and by the heavy lane's image audit.
 */
export const UNGATED_STEP_MIN_INTERVAL_MS = 5 * 60 * 60 * 1000

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
  /** Only for steps with an attemptWindow: the window the counter below belongs to. */
  windowKey?: string
  /** Failed or killed visits within windowKey (a step that keeps failing is bounded per window by its caller). */
  windowFailures?: number
  /** When the last visit only polled unfinished work (result.pollOnly); null/absent otherwise. A lane selector can space such polls out. */
  pollAt?: string | null
}

export interface RotationState {
  cursor: number
  resumeStreak: number
  steps: Record<string, StepState>
  updatedAt: string | null
  /** The scheduled slot (floor(scheduledTime / tick)) last claimed; a second delivery of one firing shares it. */
  lastSlot: number | null
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
  /**
   * Names the window an attempt belongs to (the backup: its business night). The step record then counts failed or
   * killed visits per window (windowKey / windowFailures), which a lane selector can read without any extra I/O.
   */
  attemptWindow?: (nowMs: number) => string
  /**
   * Called after this visit is claimed (and any earlier kill counted) and before run(), with the failed or killed visits already
   * counted in the current window, so run() can add what only it can see (the backup adds the failed sets in R2).
   */
  onClaim?: (info: { windowFailures: number }) => void
}

export interface TickResult {
  stepId: string | null
  ok: boolean
  more: boolean
  error?: string
  /** Not run: gated by minIntervalMs, or another tick took this position. */
  skipped?: 'recent' | 'lost-race' | 'duplicate' | 'claim-failed'
}

const emptyStep = (): StepState => ({ startedAt: null, finishedAt: null, okAt: null, error: null, failures: 0, killed: 0, runs: 0 })

export function emptyRotationState(): RotationState {
  return { cursor: 0, resumeStreak: 0, steps: {}, updatedAt: null, lastSlot: null, version: 0 }
}

function sanitize(raw: unknown): RotationState {
  const base = emptyRotationState()
  if (!raw || typeof raw !== 'object') return base
  const src = raw as Partial<RotationState>
  base.cursor = Number.isInteger(src.cursor) && (src.cursor as number) >= 0 ? (src.cursor as number) : 0
  base.resumeStreak = Number.isInteger(src.resumeStreak) && (src.resumeStreak as number) >= 0 ? (src.resumeStreak as number) : 0
  base.updatedAt = typeof src.updatedAt === 'string' ? src.updatedAt : null
  base.lastSlot = Number.isInteger(src.lastSlot) ? (src.lastSlot as number) : null
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
        ...(typeof v.pollAt === 'string' ? { pollAt: v.pollAt } : {}),
        ...(typeof v.windowKey === 'string' ? { windowKey: v.windowKey, windowFailures: Number(v.windowFailures) > 0 ? Math.floor(Number(v.windowFailures)) : 0 } : {}),
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
export interface RotationTickOptions {
  slot?: number
  /**
   * Choose the step by something other than the cursor (the heavy lane runs the
   * backup on its after-close tick, not on every other tick). Only consulted when
   * the state was read; return undefined, or an index out of range, to keep the
   * cursor's choice.
   */
  select?: (steps: readonly RotationStep[], state: RotationState, nowMs: number) => number | undefined
}

export async function runRotationTick(steps: readonly RotationStep[], store: RotationStore, nowMs: number = Date.now(), options: RotationTickOptions = {}): Promise<TickResult> {
  if (!steps.length) return { stepId: null, ok: true, more: false }
  const nowIso = new Date(nowMs).toISOString()
  const realStart = Date.now()

  let state: RotationState | null = null
  let persisted = true
  try { state = await store.load() } catch { persisted = false }
  // null = there is no row yet (the first ever write inserts it).
  let expected: number | null = state ? sanitize(state).version : null
  const current = state ? sanitize(state) : emptyRotationState()
  // No readable cursor: derive one from the clock so rotation still advances.
  // (the slot, when given, is the scheduled firing's own number, so it alternates per trigger).
  const slot = options.slot
  // A second delivery of the SAME firing (Cloudflare may deliver a cron more than once) shares its
  // scheduledTime, hence its slot: it must not take the next step, shifting the alternation.
  if (persisted && slot !== undefined && current.lastSlot === slot) return { stepId: null, ok: true, more: false, skipped: 'duplicate' }
  const selected = persisted ? options.select?.(steps, current, nowMs) : undefined
  const index = selected !== undefined && Number.isInteger(selected) && selected >= 0 && selected < steps.length
    ? selected
    : persisted ? current.cursor % steps.length : (slot ?? Math.floor(nowMs / CRON_ROTATION_TICK_MS)) % steps.length
  const step = steps[index]
  const record = current.steps[step.id] ?? emptyStep()
  // Write the state over the version we read. A false answer means another
  // overlapping tick moved the cursor first: this one must neither rewind it
  // nor run the step that tick already claimed (a scheduled paid backup must
  // not run twice). A save that THROWS is treated the same way: with the claim
  // unconfirmed, skipping is safe (the step is picked up on its next visit) and
  // running could duplicate a backup, which is the worse outcome.
  const commit = async (): Promise<boolean> => {
    if (!persisted) { try { await store.save(current, null) } catch { /* best effort */ } return true }
    current.version = (expected ?? -1) + 1
    if (slot !== undefined) current.lastSlot = slot
    try {
      const won = await store.save(current, expected)
      if (won) expected = current.version
      return won
    } catch { return false }
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
    if (record.windowKey !== undefined) record.windowFailures = (record.windowFailures || 0) + 1 // counts against the window it died in
    record.error = 'killed before finishing (CPU or wall limit)'
  }
  if (step.attemptWindow) {
    const window = step.attemptWindow(nowMs)
    if (record.windowKey !== window) { record.windowKey = window; record.windowFailures = 0 }
  }
  record.startedAt = nowIso
  current.steps[step.id] = record
  // Advance first; fixed up below if the step asks to be resumed.
  current.cursor = (index + 1) % steps.length
  current.updatedAt = nowIso
  if (!(await commit())) return { stepId: step.id, ok: true, more: false, skipped: 'lost-race' }

  let ok = true
  step.onClaim?.({ windowFailures: record.windowFailures || 0 })
  let more = false
  // A visit that ran fine but whose work is not finished (a backup whose asset copy is still running in the queue):
  // it is not an error, but it must not count as done, or the step's okAt would satisfy a lane gate for the whole day.
  let incomplete = false
  let pollOnly = false
  let error: string | undefined
  try {
    const result = await step.run()
    more = !!result && typeof result === 'object' && (result as { more?: unknown }).more === true
    incomplete = !!result && typeof result === 'object' && (result as { incomplete?: unknown }).incomplete === true
    pollOnly = !!result && typeof result === 'object' && (result as { pollOnly?: unknown }).pollOnly === true
  } catch (caught) {
    ok = false
    error = shortError(caught)
  }

  record.finishedAt = new Date(nowMs + Math.max(0, Date.now() - realStart)).toISOString()
  record.runs += 1
  if (ok && pollOnly) record.pollAt = record.finishedAt
  else if (record.pollAt !== undefined) record.pollAt = null
  // An OK visit that left its work unfinished (incomplete) is not a recovery: the failure count and error stay visible to cron-health.
  if (ok) { if (!incomplete) { record.okAt = record.finishedAt; record.error = null; record.failures = 0 } } else { record.error = error ?? 'error'; record.failures += 1; if (step.attemptWindow) record.windowFailures = (record.windowFailures || 0) + 1 }
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
  /** No state yet, but the deploy is younger than the first scheduled visit: nothing is wrong. */
  pending: boolean
  steps: CronHealthRow[]
  problems: string[]
}

/** Classify every rotation step; `problems` lists the ids that need a look. */
export function evaluateCronHealth(state: RotationState, stepIds: readonly string[], nowMs: number = Date.now(), tickMs: number = CRON_ROTATION_TICK_MS, deployedAtMs?: number, stepIntervalMs: Readonly<Record<string, number>> = {}): CronHealth {
  const cycleMs = Math.max(1, stepIds.length) * tickMs
  const limit = cycleMs * STARVED_CYCLES + tickMs * (MAX_RESUME_STREAK + 1)
  const updated = state.updatedAt ? Date.parse(state.updatedAt) : NaN
  const stale = !Number.isFinite(updated) || nowMs - updated > limit
  // Never written, and this build is younger than one tick (+30 min slack): the first visit has not had its turn.
  const pending = !state.updatedAt && deployedAtMs !== undefined && Number.isFinite(deployedAtMs) && nowMs - deployedAtMs < tickMs + 30 * 60 * 1000
  // A step that is only visited once per `stepIntervalMs` (the daily backup) is starved after two missed visits, not after the lane's own short limit.
  const stepLimit = (id: string) => (stepIntervalMs[id] ? Math.max(limit, stepIntervalMs[id] * STARVED_CYCLES + tickMs * (MAX_RESUME_STREAK + 1)) : limit)
  const rows: CronHealthRow[] = stepIds.map((id) => {
    const s = state.steps[id] ?? emptyStep()
    const started = s.startedAt ? Date.parse(s.startedAt) : NaN
    let status: StepHealthStatus
    if (!s.startedAt) status = 'never'
    else if (s.failures > 0 && String(s.error || '').startsWith('killed')) status = 'killed'
    else if (s.failures > 0) status = 'failing'
    else if (nowMs - started > stepLimit(id)) status = 'starved'
    else status = 'ok'
    return { id, status, lastStartedAt: s.startedAt, lastOkAt: s.okAt, failures: s.failures, killed: s.killed, error: s.error }
  })
  // 'never' is only a problem once a whole cycle should have visited it.
  const problems = rows.filter((r) => r.status !== 'ok' && (r.status !== 'never' || stale)).map((r) => r.id)
  if (pending) return { healthy: true, stateUpdatedAt: null, stale: false, pending: true, steps: rows, problems: [] }
  return { healthy: !stale && problems.length === 0, stateUpdatedAt: state.updatedAt, stale, pending: false, steps: rows, problems }
}
