import type { Env } from '../index'
import { recordAnalytics } from './analytics'
import { businessToday } from './businessDateWindow'
import { getDb } from './db'
import { getPlanLimits, resolvePlanTier } from './planTier'
import { readSwitchState } from './readSwitches'
import { getSalesDailyKernel, type SalesDailyKernel } from './salesDailyKernel'
import {
  SALES_DAILY_FLAGS_SQL, SALES_DAILY_KERNEL_VERSION, SALES_DAILY_SWITCH, claimStatement, commitStatement, dayStatesStatement, encodeSalesDailyPayload,
  pendingDaysStatement, quarantineStatements, reconcileCursorStatement, reconcileOlderStatement, reconcileRecentStatement, recoverStatements,
  salesDailyDifferingPaths, salesDailyFlagsFromRows, salesDailyNeedsRecover,
  type SalesDailyComputed, type SalesDailyFlags, type SalesDailyStatement, type StoredDayRow,
} from './salesDailyTotals'

// The two rotating-cron steps of the stored daily sales totals (steps `sales-daily-recompute` and `sales-daily-reconcile`, src/index.ts). Both sit
// behind the read switch `sales_daily`: OFF does nothing (one switch read, no D1 read of its own); `on` runs; `shadow` runs on Paid only (a shadow
// never runs on Free, so there is nothing to compare there). Every number comes from getPlanLimits(env). The kernel call is the seam in
// lib/salesDailyKernel.ts.
//
// RECOMPUTE: re-cover when the epoch or kernel version moved, then claim up to salesDailyRecomputeDaysPerRun dirty PAST days (today is never stored),
// read them through the kernel in one bounded read, commit each. A refused commit (a write or a newer claim landed in between) leaves the day for the
// next visit. RECONCILE: at most once per salesDailyReconcileMinIntervalSeconds (the step's own interval gate), re-derive the last
// salesDailyReconcileRecentDays days and a rotating slice of older days from the raw records and compare with what is stored. A day whose row
// moved between the looks is not judged. A MISMATCH never heals silently: the day goes dirty, every stored read stops (system_flags
// sales_daily_quarantine), the run is recorded (analytics kind sales_daily_reconcile) and the owner gets ONE Telegram alert.
export type SalesDailyCronDeps = {
  kernel?: SalesDailyKernel | null
  /** 'on' | 'shadow' | 'off'; the default reads the read switch. */
  mode?: 'on' | 'shadow' | 'off'
  nowMs?: number
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
}
export type SalesDailyReconcileResult = {
  skipped?: Skip | 'recovering' | 'quarantined'
  compared?: number
  matched?: number
  mismatched?: string[]
  unjudged?: number
  alerted?: boolean
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
  const limit = limits.salesDailyRecomputeDaysPerRun
  const pending = pendingDaysStatement(today, limit)
  const days = (await db.prepare(pending.sql).all<{ business_date: string }>(pending.params)).map((row) => row.business_date)
  if (!days.length) return { pending: 0, claimed: 0, committed: 0, refused: 0, more: false }
  const claim = claimStatement(days)
  const claimed = await db.prepare(claim.sql).all<{ business_date: string; claim_gen: number }>(claim.params)
  if (!claimed.length) return { pending: days.length, claimed: 0, committed: 0, refused: 0, more: days.length === limit }
  const computed = await kernel.computeDays(env, claimed.map((row) => row.business_date))
  const commits: SalesDailyStatement[] = []
  for (const row of claimed) {
    const result: SalesDailyComputed | undefined = computed.get(row.business_date)
    if (!result) continue
    commits.push(commitStatement({ day: row.business_date, claimGen: row.claim_gen, computed: result, epoch: flags.epoch as string, kernel: SALES_DAILY_KERNEL_VERSION, nowIso }, limits.salesDailyMaxPayloadBytes))
  }
  const results = commits.length ? await db.batch(asBatch(commits)) : []
  const committed = results.filter((result) => changesOf(result) > 0).length
  return { pending: days.length, claimed: claimed.length, committed, refused: claimed.length - committed, more: days.length === limit }
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
  const recentFrom = dateBefore(today, limits.salesDailyReconcileRecentDays)
  const recent = reconcileRecentStatement(recentFrom, today)
  const older = reconcileOlderStatement(flags.reconcileCursor, recentFrom, limits.salesDailyReconcileOlderDaysPerRun)
  const [recentRows, olderRows] = await Promise.all([
    db.prepare(recent.sql).all<{ business_date: string }>(recent.params),
    db.prepare(older.sql).all<{ business_date: string }>(older.params),
  ])
  const days = [...new Set([...olderRows, ...recentRows].map((row) => row.business_date))]
  // The rotation reaches the end of the history when a slice comes back short: the next night starts over from the oldest day.
  const nextCursor = olderRows.length < limits.salesDailyReconcileOlderDaysPerRun ? '' : olderRows[olderRows.length - 1].business_date
  const cursor = reconcileCursorStatement(nextCursor, nowIso)
  if (!days.length) {
    await db.prepare(cursor.sql).run(cursor.params)
    return { compared: 0, matched: 0, mismatched: [], unjudged: 0 }
  }
  const beforeStatement = dayStatesStatement(days, true)
  const before = await db.prepare(beforeStatement.sql).all<StoredDayRow>(beforeStatement.params)
  const computed = await kernel.computeDays(env, days)
  const afterStatement = dayStatesStatement(days, false)
  const after = await db.prepare(afterStatement.sql).all<StoredDayRow>(afterStatement.params)
  const afterByDay = new Map(after.map((row) => [row.business_date, row]))
  const mismatched: string[] = []
  const paths: string[] = []
  let matched = 0
  let unjudged = 0
  for (const stored of before) {
    const now = afterByDay.get(stored.business_date)
    const result = computed.get(stored.business_date)
    // Judged only when the stored row was a finished one for this epoch and kernel, and no write or newer claim touched it while the records were read.
    const comparable = stored.state === 0 && stored.kernel_version === SALES_DAILY_KERNEL_VERSION && stored.data_epoch === flags.epoch
      && now && now.state === 0 && now.claim_gen === stored.claim_gen && result
    if (!comparable) { unjudged += 1; continue }
    const same = result.refusal || stored.refusal
      ? (result.refusal ?? null) === (stored.refusal ?? null)
      : encodeSalesDailyPayload(result.payload) === stored.payload
    if (same) { matched += 1; continue }
    mismatched.push(stored.business_date)
    if (!result.refusal && !stored.refusal) {
      for (const path of salesDailyDifferingPaths(JSON.parse(String(stored.payload)), result.payload, 3)) paths.push(path)
    } else paths.push('refusal')
  }
  let alerted = false
  if (mismatched.length) {
    const results = await db.batch(asBatch(quarantineStatements(mismatched, paths, nowIso)))
    // Only the call that wrote the quarantine row alerts: a second mismatch in a later run finds the row and stays quiet.
    const newlyQuarantined = changesOf(results[results.length - 1]) > 0
    if (newlyQuarantined) alerted = await sendAlert(env, mismatched.slice(0, limits.salesDailyAlertListedDays), deps)
  }
  await db.prepare(cursor.sql).run(cursor.params)
  recordAnalytics(env, {
    kind: 'sales_daily_reconcile',
    labels: [mismatched.length ? 'mismatch' : unjudged && !matched ? 'unjudged' : 'match', ...paths.slice(0, 6)],
    values: [days.length, matched, mismatched.length, unjudged],
  })
  if (mismatched.length) console.error(`[sales_daily] reconcile mismatch on ${mismatched.length} day(s): ${paths.slice(0, 6).join(',')}`)
  return { compared: matched + mismatched.length, matched, mismatched, unjudged, alerted }
}
