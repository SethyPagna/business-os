import { localDateRangeClause } from './businessDateWindow'
import { ReportExactDecimal } from './reportMoneyPrecision'

// Stored daily sales totals (migration 0308, read switch `sales_daily`). PURE: no Worker, D1 or analytics imports, so the claim protocol, the
// fraction text and the payload rules are testable without a database (scripts/test-sales-daily-claim-protocol-pure.cjs).
//
// WHAT IS STORED. One row per Cambodia business date holds the report kernel's own RUNNING TOTALS for that day, never the finished figures: the
// kernel's later steps (the cost floor, the "with/without Not Paid" rounding, avg_order, the 2- and 4-place roundings) are not additive and must run
// after summing, so a window is the sum of its days' totals finished by the unchanged kernel. Money in the totals is an exact fraction (the kernel
// works in bigint fractions; a refund pro-rata or a KHR deposit over its rate is not a decimal), stored as canonical text "n" or "n/d".
//
// WHO WRITES IT. Only the recompute cron step (lib/salesDailyCron.ts), never a request and never a sales writer. Four triggers (migration 0308) only
// MARK a day dirty; the recompute claims it, reads the raw records through the kernel and commits. A reader serves a day only while it is CLEAN.
//
// THE PROTOCOL (all of it is plain SQL on one row, so two tills and two recomputes cannot corrupt it):
//   state 0 clean, 1 dirty, 2 being recomputed.
//   claim   UPDATE ... SET state = 2, claim_gen = claim_gen + 1 WHERE business_date IN (...) AND state <> 0       (RETURNING the new generations)
//   commit  UPDATE ... SET state = 0, payload ... WHERE business_date = d AND state = 2 AND claim_gen = mine AND data_epoch row = the epoch read first
//   A write between claim and commit runs the revision trigger, which sets the day back to state 1: the commit matches no row and the day stays
//   dirty (the next visit claims it again with a newer generation). A second recompute that claimed later holds a newer generation: the earlier
//   commit is refused. A restore or reset rotates the data epoch: a commit made under the old epoch is refused, and a stored day is served only
//   under the epoch it was computed in.
export const SALES_DAILY_SWITCH = 'sales_daily'
/** Bump when ANY step of the kernel that feeds a stored day changes meaning (scripts/test-sales-daily-kernel-fingerprint-pure.cjs ties it to the code). */
export const SALES_DAILY_KERNEL_VERSION = 1
export const SALES_DAILY_PAYLOAD_VERSION = 1
export const SALES_DAILY_COVERAGE_KEY = 'sales_daily_coverage'
export const SALES_DAILY_QUARANTINE_KEY = 'sales_daily_quarantine'
export const SALES_DAILY_RECONCILE_CURSOR_KEY = 'sales_daily_reconcile_cursor'
export const SALES_DAILY_DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/
export const SALES_DAILY_STATE = Object.freeze({ clean: 0, dirty: 1, claimed: 2 } as const)
/** The refusal codes that are not the kernel's own: such a day is never served from storage and its readers take the raw path. */
export const SALES_DAILY_OWN_REFUSAL_PREFIX = 'sales_daily_'
export const SALES_DAILY_PAYLOAD_TOO_LARGE = 'sales_daily_payload_too_large'

// ---- exact fractions as canonical text ---------------------------------------------------------------------------------------------------------------------

const FRACTION_TEXT = /^-?(?:0|[1-9]\d*)(?:\/[1-9]\d*)?$/
// ReportExactDecimal.recorded refuses a value above MAX_MONEY_ABS (1e11): a bigint is rebuilt from digit chunks of at most 10 digits (below that bound),
// joined with multiply and add, which carry no bound check.
const CHUNK_DIGITS = 10

type Fraction = { n: bigint; d: bigint }
const abs = (value: bigint): bigint => (value < 0n ? -value : value)
function gcd(left: bigint, right: bigint): bigint {
  while (right !== 0n) { const rest = left % right; left = right; right = rest }
  return left
}
function reduced(n: bigint, d: bigint): Fraction {
  if (d === 0n) throw new RangeError('fraction_zero_denominator')
  if (d < 0n) { n = -n; d = -d }
  const divisor = gcd(abs(n), d)
  return divisor > 1n ? { n: n / divisor, d: d / divisor } : { n, d }
}
const fractionText = (value: Fraction): string => (value.d === 1n ? value.n.toString() : `${value.n}/${value.d}`)

/** True only for the canonical text: reduced, positive denominator, no "+" or leading zeros, no "-0". */
export function isCanonicalFractionText(text: unknown): text is string {
  if (typeof text !== 'string' || text.length > 400 || !FRACTION_TEXT.test(text)) return false
  if (text === '-0') return false
  const slash = text.indexOf('/')
  if (slash < 0) return true
  const n = BigInt(text.slice(0, slash)), d = BigInt(text.slice(slash + 1))
  if (d === 1n) return false
  const back = reduced(n, d)
  return back.n === n && back.d === d
}

function parseFraction(text: string): Fraction {
  if (!isCanonicalFractionText(text)) throw new RangeError('fraction_text_invalid')
  const slash = text.indexOf('/')
  return slash < 0 ? { n: BigInt(text), d: 1n } : { n: BigInt(text.slice(0, slash)), d: BigInt(text.slice(slash + 1)) }
}

/** Exact sum of two canonical fraction texts, canonical again. */
export function addFractionTexts(left: string, right: string): string {
  const a = parseFraction(left), b = parseFraction(right)
  return fractionText(reduced(a.n * b.d + b.n * a.d, a.d * b.d))
}

/** Exact sum of any number of canonical fraction texts ("0" for none). Order cannot change the answer. */
export function sumFractionTexts(texts: Iterable<string>): string {
  let sum: Fraction = { n: 0n, d: 1n }
  for (const text of texts) {
    const next = parseFraction(text)
    sum = reduced(sum.n * next.d + next.n * sum.d, sum.d * next.d)
  }
  return fractionText(sum)
}

function exactFromBigint(value: bigint): ReportExactDecimal {
  if (abs(value) <= BigInt(Number.MAX_SAFE_INTEGER)) return ReportExactDecimal.recorded(Number(value))
  const negative = value < 0n
  const digits = abs(value).toString()
  let result = ReportExactDecimal.zero()
  for (let at = 0; at < digits.length; at += CHUNK_DIGITS) {
    const chunk = digits.slice(at, at + CHUNK_DIGITS)
    result = result.multiply(ReportExactDecimal.recorded(`1${'0'.repeat(chunk.length)}`)).add(ReportExactDecimal.recorded(chunk))
  }
  return negative ? ReportExactDecimal.zero().subtract(result) : result
}

/** The kernel's exact value for a canonical fraction text. */
export function textToExact(text: string): ReportExactDecimal {
  const value = parseFraction(text)
  const n = exactFromBigint(value.n)
  return value.d === 1n ? n : n.divide(exactFromBigint(value.d))
}

/**
 * A kernel exact value as canonical fraction text. ReportExactDecimal exposes no numerator or denominator (reportMoneyPrecision.ts is not edited by this
 * slice), so the runtime field is read; the shape is checked, so a kernel that changes its representation fails loudly here and in the round-trip test
 * instead of storing a wrong total.
 */
export function exactToText(value: ReportExactDecimal): string {
  const inner = (value as unknown as { value?: { n?: unknown; d?: unknown } }).value
  if (!inner || typeof inner.n !== 'bigint' || typeof inner.d !== 'bigint' || inner.d <= 0n) throw new RangeError('exact_value_unreadable')
  return fractionText(reduced(inner.n, inner.d))
}

// ---- the stored payload ---------------------------------------------------------------------------------------------------------------------------------

export type SalesDailyBucket = { money: Record<string, string>; counts: Record<string, number> }
export type SalesDailyBranch = { bucket: SalesDailyBucket; [section: string]: unknown }
/** `branches` is keyed by the sale header's branch id, "0" for a sale with none. The sections beside `bucket` (label, rows, summary, hours, pay, cust, prod, ...) are the kernel's. */
export type SalesDailyPayload = { v: number; branches: Record<string, SalesDailyBranch> }
/** What the kernel hands back for one business date. A refusal day carries the kernel's own code and an empty payload. */
export type SalesDailyComputed = { payload: SalesDailyPayload; sourceRows: number; refusal: string | null }

const BRANCH_KEY = /^(?:0|[1-9]\d{0,15})$/
const MONEY_KEY = /^[a-z][a-zA-Z0-9_]{0,63}$/

/** Key-sorted JSON: two payloads are equal exactly when their canonical texts are equal. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function opaqueIsSafe(value: unknown, depth: number): boolean {
  if (depth > 12) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((item) => opaqueIsSafe(item, depth + 1))
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>).every(([key, item]) => key !== '__proto__' && opaqueIsSafe(item, depth + 1))
  return false
}

/** The reason a payload is not storable, or null. Money is canonical fraction text, counts are non-negative safe integers; nothing else is trusted. */
export function salesDailyPayloadProblem(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'payload_not_object'
  const { v, branches, ...rest } = payload as Record<string, unknown>
  if (v !== SALES_DAILY_PAYLOAD_VERSION) return 'payload_version'
  if (Object.keys(rest).length) return 'payload_unknown_key'
  if (!branches || typeof branches !== 'object' || Array.isArray(branches)) return 'payload_branches'
  for (const [id, entry] of Object.entries(branches as Record<string, unknown>)) {
    if (!BRANCH_KEY.test(id)) return 'payload_branch_key'
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'payload_branch'
    const bucket = (entry as Record<string, unknown>).bucket as SalesDailyBucket | undefined
    if (!bucket || typeof bucket !== 'object' || !bucket.money || typeof bucket.money !== 'object' || !bucket.counts || typeof bucket.counts !== 'object') return 'payload_bucket'
    for (const [key, value] of Object.entries(bucket.money)) if (!MONEY_KEY.test(key) || !isCanonicalFractionText(value)) return 'payload_money'
    for (const [key, value] of Object.entries(bucket.counts)) if (!MONEY_KEY.test(key) || !Number.isSafeInteger(value) || value < 0) return 'payload_count'
    if (!opaqueIsSafe(entry, 0)) return 'payload_section'
  }
  return null
}

/** The text that is stored: validated, then key-sorted. Throws on a payload the rules above refuse (a kernel bug must never reach storage). */
export function encodeSalesDailyPayload(payload: SalesDailyPayload): string {
  const problem = salesDailyPayloadProblem(payload)
  if (problem) throw new RangeError(problem)
  return canonicalJson(payload)
}

/** The payload a stored text holds, or null when it is not valid JSON or breaks the rules (the caller then reads that day raw). */
export function decodeSalesDailyPayload(text: unknown): SalesDailyPayload | null {
  if (typeof text !== 'string' || !text) return null
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return null }
  return salesDailyPayloadProblem(parsed) === null ? (parsed as SalesDailyPayload) : null
}

/** Names of the differing places, two levels deep, never values (an analytics label and an alert must not carry business data). */
export function salesDailyDifferingPaths(left: unknown, right: unknown, limit = 8): string[] {
  const out: string[] = []
  const walk = (a: unknown, b: unknown, path: string, depth: number) => {
    if (out.length >= limit || canonicalJson(a) === canonicalJson(b)) return
    const objects = a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)
    if (!objects || depth === 0) { out.push(path || '(root)'); return }
    const x = a as Record<string, unknown>, y = b as Record<string, unknown>
    for (const key of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) walk(x[key], y[key], path ? `${path}.${key}` : key, depth - 1)
  }
  walk(left, right, '', 3)
  return out
}

// ---- coverage, quarantine and what may be served ----------------------------------------------------------------------------------------------------

/** system_flags 'sales_daily_coverage': the data epoch the seed (or the last re-cover) covered, and the kernel version it was re-cover for. */
export type SalesDailyCoverage = { epoch: string | null; kernel: number }
const EPOCH_TEXT = /^[0-9a-f]{32}$/

export function parseSalesDailyCoverage(raw: unknown): SalesDailyCoverage | null {
  if (typeof raw !== 'string') return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const { epoch, kernel } = parsed as { epoch?: unknown; kernel?: unknown }
  return { epoch: typeof epoch === 'string' && EPOCH_TEXT.test(epoch) ? epoch : null, kernel: Number.isSafeInteger(kernel) ? (kernel as number) : 0 }
}

export const salesDailyCoverageText = (epoch: string, kernel: number = SALES_DAILY_KERNEL_VERSION): string => JSON.stringify({ epoch, kernel })

export type SalesDailyFlags = { epoch: string | null; coverage: SalesDailyCoverage | null; quarantined: boolean; maintenance: boolean; reconcileCursor: string }

/** The one statement that reads everything a reader or a cron visit needs to decide, keyed rows of system_flags. */
export const SALES_DAILY_FLAGS_SQL = `SELECT key, value FROM system_flags WHERE key IN ('data_epoch', '${SALES_DAILY_COVERAGE_KEY}', '${SALES_DAILY_QUARANTINE_KEY}', '${SALES_DAILY_RECONCILE_CURSOR_KEY}', 'maintenance')`

export function salesDailyFlagsFromRows(rows: ReadonlyArray<{ key?: unknown; value?: unknown }>): SalesDailyFlags {
  const byKey = new Map<string, unknown>(rows.map((row) => [String(row.key), row.value]))
  const epoch = byKey.get('data_epoch')
  return {
    epoch: typeof epoch === 'string' && EPOCH_TEXT.test(epoch) ? epoch : null,
    coverage: parseSalesDailyCoverage(byKey.get(SALES_DAILY_COVERAGE_KEY)),
    quarantined: byKey.has(SALES_DAILY_QUARANTINE_KEY),
    maintenance: byKey.has('maintenance'),
    reconcileCursor: typeof byKey.get(SALES_DAILY_RECONCILE_CURSOR_KEY) === 'string' && SALES_DAILY_DATE.test(String(byKey.get(SALES_DAILY_RECONCILE_CURSOR_KEY))) ? String(byKey.get(SALES_DAILY_RECONCILE_CURSOR_KEY)) : '',
  }
}

/** A reader may use ANY stored day only when this is true: a readable epoch, covered by the seed, no quarantine and no maintenance. */
export function salesDailyStoredReadAllowed(flags: SalesDailyFlags): boolean {
  return !flags.quarantined && !flags.maintenance && flags.epoch !== null && flags.coverage !== null && flags.coverage.epoch === flags.epoch
}

/** The cron must re-seed and re-cover when the coverage names another epoch or another kernel version than now. */
export function salesDailyNeedsRecover(flags: SalesDailyFlags, kernel: number = SALES_DAILY_KERNEL_VERSION): boolean {
  return flags.epoch !== null && (flags.coverage === null || flags.coverage.epoch !== flags.epoch || flags.coverage.kernel !== kernel)
}

export type StoredDayRow = {
  business_date: string
  state: number
  claim_gen: number
  kernel_version: number
  data_epoch: string
  refusal: string | null
  payload?: string
  source_rows?: number
  computed_at?: string | null
}
export type SalesDailyDayUse = 'serve' | 'refuse' | 'missing' | 'dirty' | 'claimed' | 'old_kernel' | 'old_epoch' | 'unusable'

/**
 * What a reader does with one day. Only 'serve' (the stored totals) and 'refuse' (the kernel refused this day's records: the window raises the same
 * code the raw path would) answer from storage; every other value means "read this day raw", in the same batch as the other days.
 */
export function classifyStoredDay(row: StoredDayRow | undefined | null, flags: SalesDailyFlags, kernel: number = SALES_DAILY_KERNEL_VERSION): SalesDailyDayUse {
  if (!row) return 'missing'
  if (row.state === SALES_DAILY_STATE.dirty) return 'dirty'
  if (row.state === SALES_DAILY_STATE.claimed) return 'claimed'
  if (row.state !== SALES_DAILY_STATE.clean) return 'unusable'
  if (row.kernel_version !== kernel) return 'old_kernel'
  if (flags.epoch === null || row.data_epoch !== flags.epoch) return 'old_epoch'
  if (row.refusal) return row.refusal.startsWith(SALES_DAILY_OWN_REFUSAL_PREFIX) ? 'unusable' : 'refuse'
  return 'serve'
}

/**
 * The second-round check of a stored read: the (date, state, claim_gen) the first round saw must be what a second read of the same days sees. A
 * change means a write or a recompute landed between the two reads, so the caller retries once and then takes the raw path.
 */
export function storedDaysHeldStill(first: ReadonlyArray<StoredDayRow>, second: ReadonlyArray<StoredDayRow>): boolean {
  if (first.length !== second.length) return false
  const key = (row: StoredDayRow) => `${row.business_date}|${row.state}|${row.claim_gen}`
  const seen = new Set(second.map(key))
  return first.every((row) => seen.has(key(row)))
}

// ---- statements (named parameters, as lib/db.ts translates them) ------------------------------------------------------------------------------------

export type SalesDailyStatement = { sql: string; params: Record<string, unknown> }

/** The dirty (or half-done) past days, newest first: the partial index idx_sales_daily_totals_pending holds exactly these. Today is never recomputed. */
export function pendingDaysStatement(today: string, limit: number): SalesDailyStatement {
  return { sql: 'SELECT business_date FROM sales_daily_totals WHERE state <> 0 AND business_date < @today ORDER BY business_date DESC LIMIT @limit', params: { today, limit } }
}

/** One statement claims every named day that is not clean (a still-claimed day is taken over: its older commit will be refused). */
export function claimStatement(days: readonly string[]): SalesDailyStatement {
  return {
    sql: 'UPDATE sales_daily_totals SET state = 2, claim_gen = claim_gen + 1 WHERE business_date IN (SELECT value FROM json_each(@days)) AND state <> 0 RETURNING business_date, claim_gen',
    params: { days: JSON.stringify(days) },
  }
}

export type SalesDailyCommit = { day: string; claimGen: number; computed: SalesDailyComputed; epoch: string; kernel: number; nowIso: string }

/**
 * One day's commit. It writes only the row this recompute still holds (state 2, its own generation) and only while the data epoch is still the one read
 * BEFORE the records were. A refused commit changes no row and the day stays dirty or claimed, to be claimed again.
 */
export function commitStatement(commit: SalesDailyCommit, maxPayloadBytes: number): SalesDailyStatement {
  let payload = '{}'
  let refusal = commit.computed.refusal
  if (!refusal) {
    payload = encodeSalesDailyPayload(commit.computed.payload)
    if (new TextEncoder().encode(payload).length > maxPayloadBytes) { payload = '{}'; refusal = SALES_DAILY_PAYLOAD_TOO_LARGE }
  }
  return {
    sql: `UPDATE sales_daily_totals SET state = 0, kernel_version = @kernel, data_epoch = @epoch, refusal = @refusal, payload = @payload, source_rows = @sourceRows, computed_at = @nowIso
      WHERE business_date = @day AND state = 2 AND claim_gen = @claimGen AND (SELECT value FROM system_flags WHERE key = 'data_epoch') = @epoch`,
    params: { day: commit.day, claimGen: commit.claimGen, kernel: commit.kernel, epoch: commit.epoch, refusal, payload, sourceRows: commit.computed.sourceRows, nowIso: commit.nowIso },
  }
}

/** Reads the (state, claim_gen) of named days: the reconcile's before and after look. */
export function dayStatesStatement(days: readonly string[], withPayload = false): SalesDailyStatement {
  return {
    sql: `SELECT business_date, state, claim_gen, kernel_version, data_epoch, refusal${withPayload ? ', payload' : ''} FROM sales_daily_totals WHERE business_date IN (SELECT value FROM json_each(@days))`,
    params: { days: JSON.stringify(days) },
  }
}

/** The days between two dates that have a row (the reconcile's recent window) and the older days after a cursor, oldest first. */
export function reconcileRecentStatement(from: string, today: string): SalesDailyStatement {
  return { sql: 'SELECT business_date FROM sales_daily_totals WHERE business_date >= @from AND business_date < @today AND state = 0 ORDER BY business_date', params: { from, today } }
}
export function reconcileOlderStatement(cursor: string, before: string, limit: number): SalesDailyStatement {
  return { sql: 'SELECT business_date FROM sales_daily_totals WHERE business_date > @cursor AND business_date < @before AND state = 0 ORDER BY business_date LIMIT @limit', params: { cursor, before, limit } }
}

/**
 * A mismatch: every differing day goes dirty and every stored read stops. The quarantine row is written once (the first reason stays); the LAST
 * statement's meta.changes tells the caller whether THIS call set it, which is what decides the single owner alert. Names of days only, no figures.
 */
export function quarantineStatements(days: readonly string[], paths: readonly string[], nowIso: string): SalesDailyStatement[] {
  return [
    ...days.map((day) => ({ sql: 'UPDATE sales_daily_totals SET state = 1 WHERE business_date = @day AND state <> 1', params: { day } })),
    {
      sql: `INSERT INTO system_flags (key, value, updated_at) VALUES ('${SALES_DAILY_QUARANTINE_KEY}', @value, @nowIso) ON CONFLICT(key) DO NOTHING`,
      params: { value: JSON.stringify({ at: nowIso, days: days.slice(0, 6), paths: paths.slice(0, 6) }), nowIso },
    },
  ]
}

/** The reconcile's place in the older days, written once per run (one row). */
export function reconcileCursorStatement(cursor: string, nowIso: string): SalesDailyStatement {
  return {
    sql: `INSERT INTO system_flags (key, value, updated_at) VALUES ('${SALES_DAILY_RECONCILE_CURSOR_KEY}', @cursor, @nowIso) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    params: { cursor, nowIso },
  }
}

/** Re-seed every day that has a sale (a missing row is "not covered"), mark every row dirty, and cover the current epoch and kernel version. One batch. */
export function recoverStatements(epoch: string, kernel: number, nowIso: string): SalesDailyStatement[] {
  return [
    { sql: 'UPDATE sales_daily_totals SET state = 1 WHERE state <> 1', params: {} },
    { sql: "INSERT INTO sales_daily_totals(business_date, state) SELECT DISTINCT COALESCE(date(created_at, '+7 hours'), ''), 1 FROM sales WHERE 1 ON CONFLICT(business_date) DO NOTHING", params: {} },
    {
      sql: `INSERT INTO system_flags (key, value, updated_at) SELECT '${SALES_DAILY_COVERAGE_KEY}', @coverage, @nowIso WHERE (SELECT value FROM system_flags WHERE key = 'data_epoch') = @epoch
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      params: { coverage: salesDailyCoverageText(epoch, kernel), epoch, nowIso },
    },
  ]
}

/** The admin rebuild of a range: re-seed the days that have sales and are missing, mark every day of the range dirty. The cron does the recompute. */
export function rebuildRangeStatements(from: string, to: string): SalesDailyStatement[] {
  return [
    {
      sql: `INSERT INTO sales_daily_totals(business_date, state) SELECT DISTINCT COALESCE(date(created_at, '+7 hours'), ''), 1 FROM sales WHERE ${localDateRangeClause('created_at', '@from', '@to')} ON CONFLICT(business_date) DO NOTHING`,
      params: { from, to },
    },
    { sql: 'UPDATE sales_daily_totals SET state = 1 WHERE business_date >= @from AND business_date <= @to AND state <> 1', params: { from, to } },
  ]
}

/** A real calendar date in YYYY-MM-DD (2026-02-30 is not one). */
export function isSalesDailyDate(value: unknown): value is string {
  if (typeof value !== 'string' || !SALES_DAILY_DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** Days from `from` to `to` inclusive; 0 when the range is reversed. */
export function salesDailyRangeDays(from: string, to: string): number {
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  return span < 0 ? 0 : span + 1
}
