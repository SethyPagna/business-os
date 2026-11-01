import type { Context, Next } from 'hono'
import { getDb } from './db'
import { recordAnalytics } from './analytics'
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
export const KNOWN_READ_SWITCHES = ['probe'] as const
export const READ_SWITCH_MEMO_MS = 15_000
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

type Memo = { at: number; value: ReadSwitches; dataEpoch: string | null; readable: boolean; seq: number }
type StoreOptions = { now?: () => number; ttlMs?: number }

export function createReadSwitchStore(options: StoreOptions = {}) {
  const now = options.now || Date.now
  const ttlMs = options.ttlMs ?? READ_SWITCH_MEMO_MS
  let memo: Memo | null = null
  let seq = 0

  const fresh = (at: number): boolean => memo !== null && at - memo.at >= 0 && at - memo.at < ttlMs

  async function load(env: Env): Promise<ReadSwitches> {
    const startedAt = now()
    if (memo && fresh(startedAt)) return memo.value
    const mine = ++seq
    let value: ReadSwitches
    let dataEpoch: string | null = null
    let readable = true
    try {
      const statement = getDb(env).prepare(SWITCH_ROWS_SQL)
      const rows = await (statement.allOnce ?? statement.all).call(statement, SWITCH_ROWS_PARAMS) as Array<{ key: string; value: string }>
      const split = splitSwitchRows(rows)
      value = parseReadSwitches(split.switchesRaw)
      dataEpoch = split.dataEpoch
    } catch {
      value = emptyReadSwitches()
      readable = false
      recordAnalytics(env, { kind: 'switch_read', labels: ['fallback'] })
    }
    // Whatever started last wins: a read that began before a prime() or a later read describes an older world.
    if (!memo || mine > memo.seq) memo = { at: startedAt, value, dataEpoch, readable, seq: mine }
    return memo.value
  }

  return {
    async read(env: Env, name: string): Promise<ReadSwitchReading> {
      const switches = await load(env)
      const entry = isKnownReadSwitch(name) ? switches.switches[name] : OFF
      if (isKnownReadSwitch(name)) noteConsulted(name, entry.state)
      return { ...entry, epoch: switches.epoch, on: entry.state === 'on' }
    },
    /** The state a committed flip just wrote, so this isolate answers with it before the next refresh. */
    async epoch(env: Env): Promise<string | null> { await load(env); return memo && memo.readable ? memo.dataEpoch : null },
    prime(value: ReadSwitches): void { memo = { at: now(), value, dataEpoch: memo?.dataEpoch ?? null, readable: true, seq: ++seq } },
    peek(): ReadSwitches | null { return memo ? memo.value : null },
    header(): string | null {
      if (!memo || !memo.readable || !fresh(now())) return null
      return `e=${memo.value.epoch};${KNOWN_READ_SWITCHES.map((name) => `${name}=${memo!.value.switches[name].state === 'on' ? 1 : 0}`).join(';')}`
    },
    salt(): string | null { return memo && memo.readable && fresh(now()) ? `sw${memo.value.epoch}` : null },
    reset(): void { memo = null },
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
export const primeReadSwitches = (value: ReadSwitches): void => store.prime(value)
export const switchHeaderValue = (): string | null => store.header()
export const switchKeySalt = (): string | null => store.salt()
export const readDataEpoch = (env: Env): Promise<string | null> => store.epoch(env)
export const resetReadSwitchMemo = (): void => store.reset()

function applySwitchHeader(headers: Headers): void {
  const value = switchHeaderValue()
  if (value) headers.set(SWITCH_HEADER, value)
}

// Sits behind apiCacheHygiene, so its after-next() code runs before that one's. It adds no I/O: the header is the memo
// as it stands, and a memo older than the refresh period says nothing.
export async function readSwitchHeader(c: Context, next: Next): Promise<void> {
  await next()
  try {
    applySwitchHeader(c.res.headers)
  } catch {
    c.res = new Response(c.res.body, c.res)
    applySwitchHeader(c.res.headers)
  }
}
