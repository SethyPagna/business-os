import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context, Next } from 'hono'
import { getDb } from './db'
import { recordAnalytics } from './analytics'
import { getPlanLimits } from './planTier'
import type { Env } from '../index'

// Kill switches for read optimizations. One system_flags row holds them all; a name that is absent, unknown or
// unreadable is OFF, and OFF is the exact pre-optimization code path. The row is outside backups (lib/backup.ts), so a
// restore cannot switch anything back on. A D1 Time Travel restore does roll the row back to its older value; the
// release runbook (P0.7-ops) captures it first and re-applies it afterwards.
//
//   readSwitch(env, name)       true only when the switch is ON; shadow and off are false
//   readSwitchState(env, name)  { state, rate, epoch, on }; rate is the shadow sampling share, never above 0.1
//   readDataEpoch(env)          the database's data epoch, null while there is none or it could not be read
//   switchHeaderValue()         the X-BOS-Switches value from the memo alone, null unless the memo is fresh
//   switchKeySalt()             'sw<epoch>' to put in every key of a switched cache or ETag; null means there is no safe
//                               key (store unreadable, memo empty or expired): compute uncached and store nothing
//
// Writers always invalidate; a switch only chooses between two exact reader paths, so no version bump, broadcast or
// change-log write may sit inside a block guarded by readSwitch. One statement refreshes the memo: it reads the switches
// row and the data epoch row together, so the epoch costs no call of its own.
export const READ_SWITCH_KEY = 'read_switches'
export const DATA_EPOCH_KEY = 'data_epoch'
export const SWITCH_ROWS_SQL = 'SELECT key, value FROM system_flags WHERE key IN (@switches, @epoch)'
export const SWITCH_ROWS_PARAMS = { switches: READ_SWITCH_KEY, epoch: DATA_EPOCH_KEY }
// Every switch any slice reads is named here, because a name that is not known parses to OFF whatever is stored. 'probe' is the
// test switch; report_atomic / report_atomic_long are the P1.4 sales-report switches (lib/reportAtomicSwitch.ts); call_counting is
// the P1.1 admission switch (lib/callCounting.ts: a db.batch() is charged as one D1 call); expense_reads is the E1-F Expenses page
// read path (routes/fees.ts, routes/feesCatalog.ts); ic_simple / ic_fix_stock are the Inventory Check switches: the simple list with
// count submissions (ic_simple) and the count approval flow with Fix stock (ic_fix_stock), see lib/inventoryCheckProducts.ts,
// lib/inventoryCheckSessions.ts and lib/inventoryCheckApprovals.ts; dash_overview_5m is the Dashboard stock overview kept for up to 5 minutes
// and stamped with the time it was computed (lib/dashboardStockOverview.ts); ic_wired is the wired Inventory Check read path: GET /api/inventory-checks/list
// and /overlay over the shared Products reader (lib/inventoryCheckList.ts, lib/inventoryCheckOverlay.ts). OFF, both answer 404 and the page keeps its old path; catalog_ranked_scope is the shared ranked scope of the Products list: the ranking of a window of pages
// is cached once and every page reads its rows by key (lib/rankedScope.ts). OFF, GET /api/products/search runs the seek-page statement it always ran.
// ledger_keyset is the Stock Changes list paged by cursor, with the count and summary on page 1 only (lib/stockLedgerKeyset.ts, routes/products.ts GET /stock-ledger).
export const KNOWN_READ_SWITCHES = ['probe', 'report_atomic', 'report_atomic_long', 'call_counting', 'expense_reads', 'ic_simple', 'ic_fix_stock', 'dash_overview_5m', 'ic_wired', 'catalog_ranked_scope', 'ledger_keyset'] as const
/** How long one isolate remembers the flags read: planTier.ts readSwitchMemoSeconds (Free 15 s, Paid 5 s). */
export const readSwitchMemoMs = (env: Env): number => getPlanLimits(env).readSwitchMemoSeconds * 1000
export const READ_SWITCH_SHADOW_MAX_RATE = 0.1
export const SWITCH_HEADER = 'X-BOS-Switches'

export type ReadSwitchName = (typeof KNOWN_READ_SWITCHES)[number]
export type ReadSwitchMode = 'off' | 'on' | 'shadow'
export type ReadSwitchEntry = { state: ReadSwitchMode; rate: number }
export type ReadSwitches = {
  epoch: number
  setAt: string | null
  setBy: number | null
  switches: Record<ReadSwitchName, ReadSwitchEntry>
}
export type ReadSwitchReading = ReadSwitchEntry & { epoch: number; on: boolean }

const OFF: ReadSwitchEntry = Object.freeze({ state: 'off', rate: 0 }) as ReadSwitchEntry
const SHADOW_TOKEN = /^shadow:(\d{1,3}(?:\.\d{1,6})?)$/
const STORED_NAME = /^[a-z][a-z0-9_]{0,39}$/

export function isKnownReadSwitch(name: unknown): name is ReadSwitchName {
  return typeof name === 'string' && (KNOWN_READ_SWITCHES as readonly string[]).includes(name)
}

function allOff(): Record<ReadSwitchName, ReadSwitchEntry> {
  return Object.fromEntries(KNOWN_READ_SWITCHES.map((name) => [name, OFF])) as Record<ReadSwitchName, ReadSwitchEntry>
}

export function emptyReadSwitches(): ReadSwitches {
  return { epoch: 0, setAt: null, setBy: null, switches: allOff() }
}

/** One stored token -> its entry; anything but the three exact forms is off. shadow:<rate> is clamped to the share limit. */
export function parseSwitchToken(token: unknown): ReadSwitchEntry {
  if (token === 'on') return { state: 'on', rate: 0 }
  if (typeof token !== 'string') return OFF
  const shadow = SHADOW_TOKEN.exec(token)
  if (!shadow) return OFF
  const rate = Number(shadow[1])
  if (!(rate > 0)) return OFF
  return { state: 'shadow', rate: Math.min(rate, READ_SWITCH_SHADOW_MAX_RATE) }
}

export function formatSwitchToken(entry: ReadSwitchEntry): string {
  return entry.state === 'shadow' ? `shadow:${entry.rate}` : entry.state
}

const DATA_EPOCH_PATTERN = /^[0-9a-f]{32}$/

export function parseDataEpoch(raw: unknown): string | null {
  return typeof raw === 'string' && DATA_EPOCH_PATTERN.test(raw) ? raw : null
}

export function splitSwitchRows(rows: Array<{ key: string; value: string }> | undefined): { switchesRaw: string | null; dataEpoch: string | null } {
  const byKey = new Map((rows || []).map((row) => [row.key, row.value]))
  return { switchesRaw: byKey.get(READ_SWITCH_KEY) ?? null, dataEpoch: parseDataEpoch(byKey.get(DATA_EPOCH_KEY)) }
}

function storedObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** Any parse error, missing row, unknown value or unknown name is off; a non-integer epoch is 0. */
export function parseReadSwitches(raw: string | null | undefined): ReadSwitches {
  const stored = storedObject(raw)
  const result = emptyReadSwitches()
  if (!stored) return result
  const epoch = stored.epoch
  result.epoch = typeof epoch === 'number' && Number.isSafeInteger(epoch) && epoch > 0 ? epoch : 0
  result.setAt = typeof stored.set_at === 'string' && stored.set_at.length <= 40 ? stored.set_at : null
  const by = stored.set_by
  result.setBy = typeof by === 'number' && Number.isSafeInteger(by) && by > 0 ? by : null
  const switches = stored.switches
  if (switches && typeof switches === 'object' && !Array.isArray(switches)) {
    for (const name of KNOWN_READ_SWITCHES) result.switches[name] = parseSwitchToken((switches as Record<string, unknown>)[name])
  }
  return result
}

/**
 * The value to store after one flip: every name this build knows keeps its parsed token, the target takes the new
 * one, and tokens of names a newer build wrote are carried over untouched so a rolled-back Worker does not erase them.
 */
export function serializeReadSwitches(
  previousRaw: string | null | undefined,
  change: { name: ReadSwitchName; entry: ReadSwitchEntry },
  actor: { epoch: number; setAt: string; setBy: number },
): string {
  const previous = parseReadSwitches(previousRaw)
  const stored = storedObject(previousRaw)
  const kept: Record<string, string> = {}
  const rawSwitches = stored?.switches
  if (rawSwitches && typeof rawSwitches === 'object' && !Array.isArray(rawSwitches)) {
    for (const [name, token] of Object.entries(rawSwitches as Record<string, unknown>)) {
      if (!isKnownReadSwitch(name) && STORED_NAME.test(name) && typeof token === 'string' && token.length <= 24 && Object.keys(kept).length < 32) kept[name] = token
    }
  }
  const switches: Record<string, string> = { ...kept }
  for (const name of KNOWN_READ_SWITCHES) switches[name] = formatSwitchToken(previous.switches[name])
  switches[change.name] = formatSwitchToken(change.entry)
  return JSON.stringify({ epoch: actor.epoch, set_at: actor.setAt, set_by: actor.setBy, switches })
}

/** The body grammar of a flip: 'off', 'on' or 'shadow:<rate>' exactly; shadow is clamped, 'shadow:0' and every other spelling is refused. */
export function parseFlipState(input: unknown): ReadSwitchEntry | null {
  if (input === 'off') return OFF
  if (input === 'on') return { state: 'on', rate: 0 }
  if (typeof input !== 'string') return null
  const entry = parseSwitchToken(input)
  return entry.state === 'shadow' ? entry : null
}

type Hook = { flag?(name: string, state: ReadSwitchMode): void }
const REQUEST_METRICS_HOOK = Symbol.for('business-os.request-metrics.v1')

function noteConsulted(name: ReadSwitchName, state: ReadSwitchMode): void {
  try { (globalThis as unknown as Record<symbol, Hook | undefined>)[REQUEST_METRICS_HOOK]?.flag?.(name, state) } catch { /* an observer never fails a read */ }
}

/** First 8 hex characters of the SHA-256 of the epoch: what X-BOS-Epoch and the bootstrap's runtime.dataEpoch carry, never the epoch itself. */
export async function epochTag(epoch: string | null): Promise<string | null> {
  if (!epoch) return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(epoch))
  return [...new Uint8Array(digest).slice(0, 4)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

// dataEpoch: undefined = not read yet (a flip primed the memo before any read), null = read and absent or malformed.
type Memo = { at: number; value: ReadSwitches; dataEpoch: string | null | undefined; epochTag: string | null; readable: boolean; seq: number; ttlMs: number }
type StoreOptions = { now?: () => number; ttlMs?: number }
// What the callers of ONE request share. A Worker isolate serves many requests at once and a promise belongs to the request that
// created it: awaiting another request's promise can hang for good when that request has already answered (6.0.1048 review B1). So a
// pending read is shared inside one request only (the notification bell's sections cost one statement, not three), and across
// requests only the finished result, the memo, is shared.
type RequestScope = { pending: Promise<Memo> | null }

export function createReadSwitchStore(options: StoreOptions = {}) {
  const now = options.now || Date.now
  const ttlFor = (env: Env): number => options.ttlMs ?? readSwitchMemoMs(env)
  const requests = new AsyncLocalStorage<RequestScope>()
  let memo: Memo | null = null
  let seq = 0
  // A reset raises it: a read that started at or below it describes the world before the reset and stores nothing.
  let floor = 0

  const fresh = (at: number): boolean => memo !== null && at - memo.at >= 0 && at - memo.at < memo.ttlMs

  function dropPending(): void {
    const scope = requests.getStore()
    if (scope) scope.pending = null
  }

  async function load(env: Env, needEpoch: boolean): Promise<Memo> {
    const startedAt = now()
    const have = memo
    if (have && fresh(startedAt) && (!needEpoch || have.dataEpoch !== undefined)) return have
    // A flip's value is the newest word on the switches: an epoch read that only has to fill in the epoch keeps it.
    const keep = have && fresh(startedAt) && have.dataEpoch === undefined ? have : null
    const scope = requests.getStore()
    if (scope?.pending) return scope.pending
    const run = readFlags(env, startedAt, keep)
    if (scope) {
      scope.pending = run
      const clear = (): void => { if (scope.pending === run) scope.pending = null }
      run.then(clear, clear)
    }
    return run
  }

  async function readFlags(env: Env, startedAt: number, keep: Memo | null): Promise<Memo> {
    const mine = ++seq
    let value: ReadSwitches
    let dataEpoch: string | null = null
    let tag: string | null = null
    let readable = true
    try {
      const statement = getDb(env).prepare(SWITCH_ROWS_SQL)
      const rows = await (statement.allOnce ?? statement.all).call(statement, SWITCH_ROWS_PARAMS) as Array<{ key: string; value: string }>
      const split = splitSwitchRows(rows)
      value = parseReadSwitches(split.switchesRaw)
      dataEpoch = split.dataEpoch
      tag = await epochTag(dataEpoch)
    } catch {
      value = emptyReadSwitches()
      readable = false
      recordAnalytics(env, { kind: 'switch_read', labels: ['fallback'] })
    }
    const ttlMs = ttlFor(env)
    const next: Memo = keep && readable
      ? { at: keep.at, value: keep.value, dataEpoch, epochTag: tag, readable, seq: mine, ttlMs }
      : { at: startedAt, value, dataEpoch, epochTag: tag, readable, seq: mine, ttlMs }
    // Whatever started last wins: a read that began before a prime() or a later read, or before a reset, describes an older world.
    if (mine > floor && (!memo || mine > memo.seq)) memo = next
    return memo && memo.seq > mine ? memo : next
  }

  return {
    /** Runs one request: callers inside it share a pending read. Outside one, every caller reads for itself. */
    inRequest<T>(run: () => T): T { return requests.run({ pending: null }, run) },
    async read(env: Env, name: string): Promise<ReadSwitchReading> {
      const switches = (await load(env, false)).value
      const entry = isKnownReadSwitch(name) ? switches.switches[name] : OFF
      if (isKnownReadSwitch(name)) noteConsulted(name, entry.state)
      return { ...entry, epoch: switches.epoch, on: entry.state === 'on' }
    },
    /** The data epoch: null while there is none or the store could not be read. */
    async epoch(env: Env): Promise<string | null> {
      const reading = await load(env, true)
      return reading.readable ? reading.dataEpoch ?? null : null
    },
    /** The epoch tag from the memo as it stands: no read, null unless the memo is fresh and readable. */
    epochTagNow(): string | null { return memo && memo.readable && fresh(now()) ? memo.epochTag : null },
    /** The state a committed flip just wrote, so this isolate answers with it before the next refresh. A flip knows the switches, not the data epoch: that half is left unread, so the next epoch read asks the database (a restore may have rotated it since the last read) and keeps the flip's value. */
    prime(env: Env, value: ReadSwitches): void { dropPending(); memo = { at: now(), value, dataEpoch: undefined, epochTag: null, readable: true, seq: ++seq, ttlMs: ttlFor(env) } },
    peek(): ReadSwitches | null { return memo ? memo.value : null },
    header(): string | null {
      if (!memo || !memo.readable || !fresh(now())) return null
      return `e=${memo.value.epoch};${KNOWN_READ_SWITCHES.map((name) => `${name}=${memo!.value.switches[name].state === 'on' ? 1 : 0}`).join(';')}`
    },
    salt(): string | null { return memo && memo.readable && fresh(now()) ? `sw${memo.value.epoch}` : null },
    reset(): void { dropPending(); memo = null; floor = ++seq },
  }
}

// The flip is one compare-and-swap on the exact stored text, its audit row tied to the swap (WHERE changes() = 1), and a guard
// that aborts the batch when the swap matched nothing. Turning something ON also refuses while a restore or cutover holds
// writes; an OFF flip always may.
export const SWITCH_FLIP_UPSERT_SQL = `INSERT INTO system_flags (key, value, updated_at)
  SELECT @key, @value, CURRENT_TIMESTAMP
  WHERE (@off = 1 OR NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  WHERE system_flags.value = @expected AND (@off = 1 OR NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance'))`
export const SWITCH_FLIP_GUARD_SQL = `SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('[1]', '$[read_switch_conflict]') END`

export function buildFlipStatements(flip: { record: { sql: string; params: Record<string, unknown> }; value: string; expected: string | null; off: boolean }): Array<{ sql: string; params?: Record<string, unknown> }> {
  return [
    { sql: SWITCH_FLIP_UPSERT_SQL, params: { key: READ_SWITCH_KEY, value: flip.value, expected: flip.expected, off: flip.off ? 1 : 0 } },
    { sql: `${flip.record.sql} WHERE changes() = 1`, params: flip.record.params },
    { sql: SWITCH_FLIP_GUARD_SQL },
  ]
}

const store = createReadSwitchStore()

export const readSwitchState = (env: Env, name: string): Promise<ReadSwitchReading> => store.read(env, name)
export const readSwitch = async (env: Env, name: string): Promise<boolean> => (await store.read(env, name)).on
export const primeReadSwitches = (env: Env, value: ReadSwitches): void => store.prime(env, value)
export const switchHeaderValue = (): string | null => store.header()
export const switchKeySalt = (): string | null => store.salt()
export const readDataEpoch = (env: Env): Promise<string | null> => store.epoch(env)
export const epochTagNow = (): string | null => store.epochTagNow()
export const resetReadSwitchMemo = (): void => store.reset()
export const runInReadScope = <T>(run: () => T): T => store.inRequest(run)

// The frontend build hash of the assets bound to THIS Worker version, for X-BOS-Build. Read once per isolate from the bound assets
// (business-os-build.json; its hash equals __FRONTEND_BUILD_HASH__ and the precache manifest's), so the header names the assets
// deployed together with the code answering. No D1, no KV. A failed read is remembered for BUILD_RETRY_MS, so a missing binding
// costs one attempt a minute and not one per response.
const BUILD_PATHS = ['/business-os-build.json', '/business-os-precache.json'] as const
const BUILD_RETRY_MS = 60_000
const BUILD_HASH = /^[A-Za-z0-9._-]{1,64}$/
const BUILD_PENDING_MS = 10_000
let builtHash: { at: number; hash: string | null; pending: boolean } | null = null

async function readBuildHash(env: Env): Promise<string | null> {
  const assets = env?.STATIC_ASSETS
  if (!assets) return null
  for (const path of BUILD_PATHS) {
    try {
      const response = await assets.fetch(new Request(`https://assets.invalid${path}`))
      if (!response.ok) continue
      const body = await response.json() as { hash?: unknown }
      if (typeof body.hash === 'string' && BUILD_HASH.test(body.hash)) return body.hash
    } catch { /* try the next file */ }
  }
  return null
}

// While another request is reading it, a response goes without X-BOS-Build instead of waiting on a promise that belongs to that
// request (it may have answered already and never settle). A read that never settles is given up after BUILD_PENDING_MS.
export async function frontendBuildHash(env: Env, at: number = Date.now()): Promise<string | null> {
  if (builtHash?.hash) return builtHash.hash
  if (builtHash?.pending && at - builtHash.at < BUILD_PENDING_MS) return null
  if (builtHash && !builtHash.pending && at - builtHash.at < BUILD_RETRY_MS) return null
  const attempt = { at, hash: null as string | null, pending: true }
  builtHash = attempt
  const hash = await readBuildHash(env)
  if (builtHash === attempt) builtHash = { at, hash, pending: false }
  return hash
}

export const resetBuildHash = (): void => { builtHash = null }

export const BUILD_HEADER = 'X-BOS-Build'
export const EPOCH_HEADER = 'X-BOS-Epoch'

function applySignalHeaders(headers: Headers, build: string | null): void {
  const value = switchHeaderValue()
  if (value) headers.set(SWITCH_HEADER, value)
  const tag = epochTagNow()
  if (tag) headers.set(EPOCH_HEADER, tag)
  if (build) headers.set(BUILD_HEADER, build)
}

// Sits behind apiCacheHygiene, so its after-next() code runs before that one's. It reads no database: X-BOS-Switches and
// X-BOS-Epoch are the memo as it stands (a memo older than the refresh period, or never loaded, says nothing) and X-BOS-Build
// is the isolate's one asset read. Every /api/* response carries them, errors and the maintenance 503 included.
export async function readSwitchHeader(c: Context, next: Next): Promise<void> {
  await runInReadScope(() => next())
  let build: string | null = null
  try { build = await frontendBuildHash(c.env as Env) } catch { /* the header is omitted */ }
  try {
    applySignalHeaders(c.res.headers, build)
  } catch {
    c.res = new Response(c.res.body, c.res)
    applySignalHeaders(c.res.headers, build)
  }
}
