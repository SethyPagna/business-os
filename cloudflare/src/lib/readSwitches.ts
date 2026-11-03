import { getDb } from './db'
import type { Env } from '../index'

/*
 * Stand-in for P0.3's lib/readSwitches.ts (lane 6.0.1048), written so that replacing it changes nothing a caller can see: the stored document
 * { epoch, set_at, set_by, switches: { <name>: 'on' | 'off' | 'shadow:<rate>' } }, the tokens and the parser are P0.3's own code, copied unchanged;
 * so are the statement (it also asks for the data_epoch row, which only P0.3 uses), the 15 s per-isolate memo and the exported names it shares.
 * What it leaves out is what the Inventory Check routes never call: flips, the data epoch, the response headers, the build hash.
 *
 * At compose the reconciler replaces this file with P0.3's and adds `ic_simple` and `ic_fix_stock` to its KNOWN_READ_SWITCHES (P0.3 carries
 * ['probe']): a name that is not listed there reads OFF whatever is stored, and P0.3's flip route refuses it. The Switches screen also needs
 * a `read_switch_name_ic_simple` and a `read_switch_name_ic_fix_stock` key in en.json and km.json.
 *
 * ON is only the exact token 'on'. An old-shape entry ({ state: 'on' }), 'ON', 'shadow' without a rate, 'shadow:0', a boolean and every other
 * spelling are OFF, and OFF is the exact pre-switch code path. A read error is OFF too, and the memo keeps that answer for its 15 s.
 * A test that changes the stored row between two requests calls resetReadSwitchMemo() in between.
 */
export const READ_SWITCH_KEY = 'read_switches'
export const DATA_EPOCH_KEY = 'data_epoch'
export const SWITCH_ROWS_SQL = 'SELECT key, value FROM system_flags WHERE key IN (@switches, @epoch)'
export const SWITCH_ROWS_PARAMS = { switches: READ_SWITCH_KEY, epoch: DATA_EPOCH_KEY }
export const KNOWN_READ_SWITCHES = ['ic_simple', 'ic_fix_stock'] as const
export const READ_SWITCH_MEMO_MS = 15_000
export const READ_SWITCH_SHADOW_MAX_RATE = 0.1

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

type Memo = { at: number; value: ReadSwitches; seq: number }

export function createReadSwitchStore(options: { now?: () => number; ttlMs?: number } = {}) {
  const now = options.now || Date.now
  const ttlMs = options.ttlMs ?? READ_SWITCH_MEMO_MS
  let memo: Memo | null = null
  let seq = 0
  let inflight: Promise<ReadSwitches> | null = null

  const fresh = (at: number): boolean => memo !== null && at - memo.at >= 0 && at - memo.at < ttlMs

  async function load(env: Env): Promise<ReadSwitches> {
    const startedAt = now()
    if (memo && fresh(startedAt)) return memo.value
    // Callers that arrive while a read is running share it: a cold isolate reads the row once, not once per caller.
    if (inflight) return inflight
    const run: Promise<ReadSwitches> = readFlags(env, startedAt).finally(() => { if (inflight === run) inflight = null })
    inflight = run
    return run
  }

  async function readFlags(env: Env, startedAt: number): Promise<ReadSwitches> {
    const mine = ++seq
    let value: ReadSwitches
    try {
      const statement = getDb(env).prepare(SWITCH_ROWS_SQL)
      const rows = await (statement.allOnce ?? statement.all).call(statement, SWITCH_ROWS_PARAMS) as Array<{ key: string; value: string }>
      value = parseReadSwitches((rows || []).find((row) => row.key === READ_SWITCH_KEY)?.value)
    } catch {
      value = emptyReadSwitches()
    }
    // Whatever started last wins: a read that began before a reset or a later read describes an older world.
    if (!memo || mine > memo.seq) memo = { at: startedAt, value, seq: mine }
    return memo.value
  }

  return {
    async read(env: Env, name: string): Promise<ReadSwitchReading> {
      const switches = await load(env)
      const entry = isKnownReadSwitch(name) ? switches.switches[name] : OFF
      return { ...entry, epoch: switches.epoch, on: entry.state === 'on' }
    },
    reset(): void { memo = null; inflight = null },
  }
}

const store = createReadSwitchStore()

export const readSwitchState = (env: Env, name: string): Promise<ReadSwitchReading> => store.read(env, name)
export const readSwitch = async (env: Env, name: string): Promise<boolean> => (await store.read(env, name)).on
export const resetReadSwitchMemo = (): void => store.reset()
