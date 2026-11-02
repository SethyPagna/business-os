import { getDb } from './db'

/*
 * Stand-in for P0.3's lib/readSwitches.ts, with the same public API (`readSwitch(env, name): Promise<boolean>`, default false).
 * The reconciler replaces this file with P0.3's and keeps the `ic_*` names in KNOWN_READ_SWITCHES.
 * The stored value is the same document P0.3 writes: { epoch, switches: { <name>: { state: 'off'|'on'|'shadow' } } }.
 * No isolate memo and no Cache API entry here (CACHE-LIFECYCLE section 5): one indexed system_flags read per consulting request.
 */
export const READ_SWITCH_KEY = 'read_switches'
export const KNOWN_READ_SWITCHES = ['ic_simple', 'ic_fix_stock'] as const
export type ReadSwitchName = typeof KNOWN_READ_SWITCHES[number]
export type ReadSwitchState = 'off' | 'on' | 'shadow'
export type ReadSwitches = { epoch: number; switches: Partial<Record<ReadSwitchName, { state: ReadSwitchState }>> }

const OFF: ReadSwitches = { epoch: 0, switches: {} }

/** Anything unreadable, unknown or malformed means off. */
export function parseReadSwitches(raw: string | null | undefined): ReadSwitches {
  if (typeof raw !== 'string') return OFF
  let value: unknown
  try { value = JSON.parse(raw) } catch { return OFF }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return OFF
  const document = value as { epoch?: unknown; switches?: unknown }
  const epoch = Number.isSafeInteger(document.epoch) ? Number(document.epoch) : 0
  const table = document.switches
  if (!table || typeof table !== 'object' || Array.isArray(table)) return { epoch, switches: {} }
  const switches: ReadSwitches['switches'] = {}
  for (const name of KNOWN_READ_SWITCHES) {
    if (!Object.hasOwn(table, name)) continue
    const entry = (table as Record<string, unknown>)[name]
    const state = entry && typeof entry === 'object' ? (entry as { state?: unknown }).state : undefined
    if (state === 'on' || state === 'shadow' || state === 'off') switches[name] = { state }
  }
  return { epoch, switches }
}

/** True only when the switch is explicitly `on`. A missing row, a read error or `shadow` is the old path. */
export async function readSwitch(env: { DB: D1Database }, name: ReadSwitchName): Promise<boolean> {
  try {
    const row = await getDb(env).prepare('SELECT value FROM system_flags WHERE key = @key').get<{ value: string }>({ key: READ_SWITCH_KEY })
    return parseReadSwitches(row?.value).switches[name]?.state === 'on'
  } catch { return false }
}
