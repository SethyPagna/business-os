import { getDb } from './db'
import { recordAnalytics } from './analytics'
import type { Env } from '../index'

// Stand-in for P0.3's lib/readSwitches.ts, which is not on this base. Same names, same stored row, same lazy 15 s memo;
// the reconciler replaces this file with P0.3's and adds `report_atomic` and `report_atomic_long` to its KNOWN_READ_SWITCHES.
// A name that is absent, unknown or unreadable is OFF, and OFF is the exact pre-optimization code path.
// Only the parsed value is kept between requests: a promise begun by one request is never awaited by another, so every caller that
// finds the memo stale reads the row itself.
export const READ_SWITCH_KEY = 'read_switches'
export const DATA_EPOCH_KEY = 'data_epoch'
export const SWITCH_ROWS_SQL = 'SELECT key, value FROM system_flags WHERE key IN (@switches, @epoch)'
export const SWITCH_ROWS_PARAMS = { switches: READ_SWITCH_KEY, epoch: DATA_EPOCH_KEY }
export const KNOWN_READ_SWITCHES = ['report_atomic', 'report_atomic_long'] as const
export const READ_SWITCH_MEMO_MS = 15_000
export const READ_SWITCH_SHADOW_MAX_RATE = 0.1

export type ReadSwitchName = (typeof KNOWN_READ_SWITCHES)[number]
export type ReadSwitchMode = 'off' | 'on' | 'shadow'
export type ReadSwitchEntry = { state: ReadSwitchMode; rate: number }
export type ReadSwitchReading = ReadSwitchEntry & { epoch: number; on: boolean }

const OFF: ReadSwitchEntry = Object.freeze({ state: 'off', rate: 0 }) as ReadSwitchEntry
const SHADOW_TOKEN = /^shadow:(\d{1,3}(?:\.\d{1,6})?)$/

export function isKnownReadSwitch(name: unknown): name is ReadSwitchName {
  return typeof name === 'string' && (KNOWN_READ_SWITCHES as readonly string[]).includes(name)
}

/** One stored token to its entry; anything but `on` and `shadow:<rate>` is off, and a shadow rate is clamped to the share limit. */
export function parseSwitchToken(token: unknown): ReadSwitchEntry {
  if (token === 'on') return { state: 'on', rate: 0 }
  if (typeof token !== 'string') return OFF
  const shadow = SHADOW_TOKEN.exec(token)
  if (!shadow) return OFF
  const rate = Number(shadow[1])
  return rate > 0 ? { state: 'shadow', rate: Math.min(rate, READ_SWITCH_SHADOW_MAX_RATE) } : OFF
}

/** Any parse error, missing row or unknown name is off. */
export function parseReadSwitches(raw: string | null | undefined): { epoch: number; switches: Record<ReadSwitchName, ReadSwitchEntry> } {
  const result = { epoch: 0, switches: Object.fromEntries(KNOWN_READ_SWITCHES.map((name) => [name, OFF])) as Record<ReadSwitchName, ReadSwitchEntry> }
  if (typeof raw !== 'string' || !raw) return result
  let stored: unknown
  try { stored = JSON.parse(raw) } catch { return result }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return result
  const record = stored as Record<string, unknown>
  if (typeof record.epoch === 'number' && Number.isSafeInteger(record.epoch) && record.epoch > 0) result.epoch = record.epoch
  const switches = record.switches
  if (switches && typeof switches === 'object' && !Array.isArray(switches)) {
    for (const name of KNOWN_READ_SWITCHES) result.switches[name] = parseSwitchToken(Object.hasOwn(switches, name) ? (switches as Record<string, unknown>)[name] : undefined)
  }
  return result
}

type Loaded = ReturnType<typeof parseReadSwitches>
let memo: { at: number; value: Loaded } | null = null

async function load(env: Env): Promise<Loaded> {
  if (memo && Date.now() - memo.at >= 0 && Date.now() - memo.at < READ_SWITCH_MEMO_MS) return memo.value
  const startedAt = Date.now()
  let value = parseReadSwitches(null)
  try {
    const statement = getDb(env).prepare(SWITCH_ROWS_SQL)
    const rows = await (statement.allOnce ?? statement.all).call(statement, SWITCH_ROWS_PARAMS) as Array<{ key: string; value: string }>
    value = parseReadSwitches((rows || []).find((row) => row.key === READ_SWITCH_KEY)?.value)
  } catch {
    recordAnalytics(env, { kind: 'switch_read', labels: ['fallback'] })
  }
  memo = { at: startedAt, value }
  return value
}

export async function readSwitchState(env: Env, name: string): Promise<ReadSwitchReading> {
  const loaded = await load(env)
  const entry = isKnownReadSwitch(name) ? loaded.switches[name] : OFF
  return { ...entry, epoch: loaded.epoch, on: entry.state === 'on' }
}

export async function readSwitch(env: Env, name: string): Promise<boolean> {
  return (await readSwitchState(env, name)).on
}

export function resetReadSwitchMemo(): void {
  memo = null
}
