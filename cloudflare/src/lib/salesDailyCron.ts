import type { Env } from '../index'
import { recordAnalytics } from './analytics'
import { businessToday } from './businessDateWindow'
import { getDb } from './db'
import { getPlanLimits, resolvePlanTier } from './planTier'
import { readSwitchState } from './readSwitches'
import { getSalesDailyKernel, type SalesDailyKernel } from './salesDailyKernel'
import {
  SALES_DAILY_FLAGS_SQL, SALES_DAILY_KERNEL_VERSION, SALES_DAILY_SWITCH, SalesDailyStepBudget, claimStatement, commitStatement, dayStatesStatement, encodeSalesDailyPayload,
  pendingDaysStatement, quarantineStatements, reconcileCursorStatement, reconcileOlderStatement, reconcileRecentStatement, recoverStatements,
  salesDailyDifferingPaths, salesDailyFlagsFromRows, salesDailyNeedsRecover,
  type SalesDailyComputed, type SalesDailyFlags, type SalesDailyStatement, type SalesDailyStop, type StoredDayRow,
} from './salesDailyTotals'

// The two rotating-cron steps of the stored daily sales totals (steps `sales-daily-recompute` and `sales-daily-reconcile`, src/index.ts). Both sit
// behind the read switch `sales_daily`: OFF does nothing (one switch read, no D1 read of its own); `on` runs; `shadow` runs on Paid only (a shadow
// never runs on Free, so there is nothing to compare there). Every number comes from getPlanLimits(env). The kernel call is the seam in
// lib/salesDailyKernel.ts.
//
// THE UNIT OF WORK IS ONE BUSINESS DAY, and every visit has a budget (SalesDailyStepBudget: estimated CPU, wall time, D1 queries, all from getPlanLimits)
// that it checks BEFORE starting another day. A Free Worker has 10 ms of CPU and 50 queries per invocation and no CPU clock, so a visit that read several
// days at once could be killed for CPU after it found a problem and before it acted on it. Instead:
// RECOMPUTE: re-cover when the epoch or kernel version moved, then take the newest dirty PAST days one at a time (claim, kernel read, commit; today is never
// stored). The dirty set is its own cursor: a committed day leaves it, a refused one (a write or a newer claim landed in between) stays for the next visit.
// RECONCILE: at most once per salesDailyReconcileMinIntervalSeconds, a CYCLE re-derives the last salesDailyReconcileRecentDays days and a rotating slice of
// older days from the raw records and compares with what is stored, one day at a time, with a persisted cursor (system_flags sales_daily_reconcile_cursor)
// written after every judged day; a cycle that stops at its budget answers { incomplete: true } and the next visit resumes it. A day whose row moved between
// the looks is not judged. A MISMATCH never heals silently: it is acted on in the visit that finds it, before any further day: the day goes dirty, every
// stored read stops (system_flags sales_daily_quarantine), the run is recorded (analytics kind sales_daily_reconcile) and the owner gets a Telegram alert.
export type SalesDailyCronDeps = {
  kernel?: SalesDailyKernel | null
  /** 'on' | 'shadow' | 'off'; the default reads the read switch. */
  mode?: 'on' | 'shadow' | 'off'
  nowMs?: number
  /** The wall clock the visit budget reads (default Date.now); a test moves it to prove the wall budget. */
  clock?: () => number
  /** Sends the owner alert; the default is the Telegram send path. Tests always inject one: a real chat is never reached from a test. */
  alert?: (env: Env, days: readonly string[]) => Promise<boolean>
}

type Skip = 'switch-off' | 'kernel-not-wired' | 'kernel-version' | 'no-epoch' | 'maintenance'
export type SalesDailyRecomputeResult = {
  skipped?: Skip
  recovered?: boolean
  pending?: number
  claimed?: number
  committed?: number
  refused?: number
  more?: boolean
  /** Which budget ended the visit before the pending days did. */
  stopped?: SalesDailyStop
}
export type SalesDailyReconcileResult = {
  skipped?: Skip | 'recovering' | 'quarantined'
  compared?: number
  matched?: number
  mismatched?: string[]
  unjudged?: number
  alerted?: boolean
  /** True while a cycle is unfinished: the rotation reads it and does not arm the step's minimum interval, so the next visit resumes. */
  incomplete?: true
  stopped?: SalesDailyStop
}

async function cronMode(env: Env, deps: SalesDailyCronDeps): Promise<'on' | 'shadow' | 'off'> {
  if (deps.mode) return deps.mode
  return (await readSwitchState(env, SALES_DAILY_SWITCH)).state
}
const runs = (mode: 'on' | 'shadow' | 'off', env: Env): boolean => mode === 'on' || (mode === 'shadow' && resolvePlanTier(env) !== 'free')

type Ready = { kernel: SalesDailyKernel; flags: SalesDailyFlags; today: string; nowIso: string }

async function readFlags(env: Env): Promise<SalesDailyFlags> {
  return salesDailyFlagsFromRows(await getDb(env).prepare(SALES_DAILY_FLAGS_SQL).all<{ key: string; value: string }>())
}

async function ready(env: Env, deps: SalesDailyCronDeps): Promise<Ready | { skipped: Skip }> {
  if (!runs(await cronMode(env, deps), env)) return { skipped: 'switch-off' }
  const kernel = deps.kernel === undefined ? getSalesDailyKernel() : deps.kernel
  if (!kernel) return { skipped: 'kernel-not-wired' }
  if (kernel.version !== SALES_DAILY_KERNEL_VERSION) return { skipped: 'kernel-version' }
  // The epoch is read BEFORE any record, and every commit is guarded by it: a stored day is never newer than the epoch it names.
  const flags = await readFlags(env)
  if (flags.maintenance) return { skipped: 'maintenance' }
  if (flags.epoch === null) return { skipped: 'no-epoch' }
  const nowMs = deps.nowMs ?? Date.now()
  return { kernel, flags, today: businessToday(nowMs), nowIso: new Date(nowMs).toISOString() }
}

const asBatch = (statements: readonly SalesDailyStatement[]) => statements.map((statement) => ({ sql: statement.sql, params: statement.params }))
const changesOf = (result: unknown): number => Number((result as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0)

export async function runSalesDailyRecompute(env: Env, deps: SalesDailyCronDeps = {}): Promise<SalesDailyRecomputeResult> {
  const state = await ready(env, deps)
  if ('skipped' in state) return { skipped: state.skipped }
  const { kernel, flags, today, nowIso } = state
  const db = getDb(env)
  const limits = getPlanLimits(env)
  // A restore, reset or cutover (new epoch) or a kernel version change: every row is dirty again and the coverage names what is current. One batch.
  if (salesDailyNeedsRecover(flags)) {
    await db.batch(asBatch(recoverStatements(flags.epoch as string, SALES_DAILY_KERNEL_VERSION, nowIso)))
    return { recovered: true, more: true }
  }
  const budget = new SalesDailyStepBudget(limits, deps.clock)
  budget.spendQueries(2) // the flags read and the pending list
  const limit = limits.salesDailyRecomputeDaysPerRun
  const pending = pendingDaysStatement(today, limit)
  const days = await db.prepare(pending.sql).all<{ business_date: string; source_rows: number }>(pending.params)
  if (!days.length) return { pending: 0, claimed: 0, committed: 0, refused: 0, more: false }
  let claimed = 0
  let committed = 0
  let stopped: SalesDailyStop | undefined
  for (const row of days) {
    if (claimed > 0) {
      const verdict = budget.allowsAnotherDay(Number(row.source_rows) || 0, 2)
      if (!verdict.ok) { stopped = verdict.reason; break }
    }
    const claim = claimStatement([row.business_date])
    const taken = await db.prepare(claim.sql).all<{ business_date: string; claim_gen: number }>(claim.params)
    budget.spendQueries(1)
    if (!taken.length) continue
    claimed += 1
    const computed = await kernel.computeDays(env, [row.business_date])
    const result: SalesDailyComputed | undefined = computed.get(row.business_date)
    budget.spendQueries(result?.queries ?? limits.salesDailyKernelQueriesPerDay)
    budget.spendDay(result?.sourceRows ?? 0)
    if (!result) continue
    const commit = commitStatement({ day: row.business_date, claimGen: taken[0].claim_gen, computed: result, epoch: flags.epoch as string, kernel: SALES_DAILY_KERNEL_VERSION, nowIso }, limits.salesDailyMaxPayloadBytes)
    const results = await db.batch(asBatch([commit]))
    budget.spendQueries(1)
    if (changesOf(results[0]) > 0) committed += 1
  }
  return { pending: days.length, claimed, committed, refused: claimed - committed, more: stopped !== undefined || days.length === limit, ...(stopped ? { stopped } : {}) }
}

async function sendAlert(env: Env, days: readonly string[], deps: SalesDailyCronDeps): Promise<boolean> {
  try {
    if (deps.alert) return await deps.alert(env, days)
    const { sendTelegramSalesDailyMismatchAlert } = await import('./telegram')
    return await sendTelegramSalesDailyMismatchAlert(env, days)
  } catch (error) {
    console.error('[sales_daily] the mismatch alert could not be sent', error)
    return false
  }
}

const dateBefore = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)

export async function runSalesDailyReconcile(env: Env, deps: SalesDailyCronDeps = {}): Promise<SalesDailyReconcileResult> {
  const state = await ready(env, deps)
  if ('skipped' in state) return { skipped: state.skipped }
  const { kernel, flags, today, nowIso } = state
  if (salesDailyNeedsRecover(flags)) return { skipped: 'recovering' }
  // Already quarantined: the check that found the problem stays the last word until an administrator rebuilds and clears it, and no second alert is sent.
  if (flags.quarantined) return { skipped: 'quarantined' }
  const db = getDb(env)
  const limits = getPlanLimits(env)
  const budget = new SalesDailyStepBudget(limits, deps.clock)
  budget.spendQueries(3) // the flags read and the two day lists
  const cycle = flags.reconcile.cycle ?? { recentFrom: dateBefore(today, limits.salesDailyReconcileRecentDays), recentLast: '', olderLast: flags.reconcile.older, olderCount: 0 }
  const olderWanted = Math.max(0, limits.salesDailyReconcileOlderDaysPerRun - cycle.olderCount)
  const recent = reconcileRecentStatement(cycle.recentFrom, today, cycle.recentLast)
  const older = reconcileOlderStatement(cycle.olderLast, cycle.recentFrom, Math.max(1, olderWanted))
  const [recentRows, olderRows] = await Promise.all([
    db.prepare(recent.sql).all<{ business_date: string; source_rows: number }>(recent.params),
    olderWanted > 0 ? db.prepare(older.sql).all<{ business_date: string; source_rows: number }>(older.params) : Promise.resolve([] as { business_date: string; source_rows: number }[]),
  ])
  const queue = [
    ...recentRows.map((row) => ({ day: row.business_date, rows: Number(row.source_rows) || 0, kind: 'recent' as const })),
    ...olderRows.map((row) => ({ day: row.business_date, rows: Number(row.source_rows) || 0, kind: 'older' as const })),
  ]
  const mismatched: string[] = []
  const paths: string[] = []
  let matched = 0
  let unjudged = 0
  let visited = 0
  let stopped: SalesDailyStop | undefined
  for (const item of queue) {
    if (visited > 0) {
      const verdict = budget.allowsAnotherDay(item.rows, 3)
      if (!verdict.ok) { stopped = verdict.reason; break }
    }
    visited += 1
    const beforeStatement = dayStatesStatement([item.day], true)
    const before = (await db.prepare(beforeStatement.sql).all<StoredDayRow>(beforeStatement.params))[0]
    const computed = await kernel.computeDays(env, [item.day])
    const afterStatement = dayStatesStatement([item.day], false)
    const now = (await db.prepare(afterStatement.sql).all<StoredDayRow>(afterStatement.params))[0]
    const result = computed.get(item.day)
    budget.spendQueries(2 + (result?.queries ?? limits.salesDailyKernelQueriesPerDay))
    budget.spendDay(result?.sourceRows ?? 0)
    // Judged only when the stored row was a finished one for this epoch and kernel, and no write or newer claim touched it while the records were read.
    const comparable = before && before.state === 0 && before.kernel_version === SALES_DAILY_KERNEL_VERSION && before.data_epoch === flags.epoch
      && now && now.state === 0 && now.claim_gen === before.claim_gen && result
    if (!comparable) unjudged += 1
    else {
      const same = result.refusal || before.refusal
        ? (result.refusal ?? null) === (before.refusal ?? null)
        : encodeSalesDailyPayload(result.payload) === before.payload
      if (same) matched += 1
      else {
        mismatched.push(item.day)
        if (!result.refusal && !before.refusal) {
          for (const path of salesDailyDifferingPaths(JSON.parse(String(before.payload)), result.payload, 3)) paths.push(path)
        } else paths.push('refusal')
      }
    }
    if (item.kind === 'recent') cycle.recentLast = item.day
    else { cycle.olderLast = item.day; cycle.olderCount += 1 }
    // A mismatch is acted on BEFORE any further work: this visit quarantines now (every stored read stops) and judges no other day.
    if (mismatched.length) break
    const progress = reconcileCursorStatement({ older: flags.reconcile.older, cycle }, nowIso)
    await db.prepare(progress.sql).run(progress.params)
    budget.spendQueries(1)
  }
  let alerted = false
  if (mismatched.length) {
    const results = await db.batch(asBatch(quarantineStatements(mismatched, paths, nowIso)))
    // Only the call that wrote the quarantine row alerts: a second mismatch in a later run finds the row and stays quiet.
    const newlyQuarantined = changesOf(results[results.length - 1]) > 0
    if (newlyQuarantined) alerted = await sendAlert(env, mismatched.slice(0, limits.salesDailyAlertListedDays), deps)
  }
  const complete = !mismatched.length && stopped === undefined
  if (complete) {
    // The older slice came back short: the history ended, so the next cycle starts from the oldest day; otherwise it continues after the last older day taken.
    const historyEnded = olderWanted > 0 && olderRows.length < olderWanted
    const done = reconcileCursorStatement({ older: historyEnded ? '' : cycle.olderLast, cycle: null }, nowIso)
    await db.prepare(done.sql).run(done.params)
  }
  if (visited > 0) {
    recordAnalytics(env, {
      kind: 'sales_daily_reconcile',
      labels: [mismatched.length ? 'mismatch' : unjudged && !matched ? 'unjudged' : 'match', ...paths.slice(0, 6)],
      values: [visited, matched, mismatched.length, unjudged],
    })
  }
  if (mismatched.length) console.error(`[sales_daily] reconcile mismatch on ${mismatched.length} day(s): ${paths.slice(0, 6).join(',')}`)
  return { compared: matched + mismatched.length, matched, mismatched, unjudged, alerted, ...(complete ? {} : { incomplete: true as const }), ...(stopped ? { stopped } : {}) }
}
