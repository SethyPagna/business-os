import { getDb } from './db'
import type { Env } from '../index'

// STAND-IN for P0.3's lib/readSwitches.ts (lane 6.0.1041), added by lane 6.0.1053 because P0.3 is not on this base.
// Same API: readSwitch(env, name) is true only when the switch is ON; a missing row, a malformed row, an unknown token or
// a failed read is OFF, and OFF is the exact pre-slice code path. Same storage: the one system_flags row 'read_switches'
// ({ "switches": { "<name>": "on" | "off" | "shadow:<rate>" } }), so flipping through P0.3's route needs no change here.
// The reconciler keeps P0.3's file and adds this slice's name to its KNOWN_READ_SWITCHES.
export const READ_SWITCH_KEY = 'read_switches'
export const KNOWN_READ_SWITCHES = ['expenses_sale_rows'] as const
export type ReadSwitchName = (typeof KNOWN_READ_SWITCHES)[number]
export const READ_SWITCH_MEMO_MS = 15_000

let memo: { at: number; on: ReadonlySet<string> } | null = null

export function resetReadSwitchMemo(): void {
  memo = null
}

function onNames(raw: unknown): Set<string> {
  const names = new Set<string>()
  if (typeof raw !== 'string' || !raw) return names
  try {
    const parsed: unknown = JSON.parse(raw)
    const switches = parsed && typeof parsed === 'object' ? (parsed as { switches?: unknown }).switches : null
    if (!switches || typeof switches !== 'object' || Array.isArray(switches)) return names
    for (const [name, token] of Object.entries(switches as Record<string, unknown>)) if (token === 'on') names.add(name)
  } catch {
    return new Set()
  }
  return names
}

export async function readSwitch(env: Env, name: ReadSwitchName): Promise<boolean> {
  const now = Date.now()
  if (memo && now - memo.at < READ_SWITCH_MEMO_MS) return memo.on.has(name)
  try {
    const row = await getDb(env).prepare('SELECT value FROM system_flags WHERE key = @key').get<{ value: string }>({ key: READ_SWITCH_KEY })
    memo = { at: now, on: onNames(row?.value) }
    return memo.on.has(name)
  } catch {
    return false
  }
}
