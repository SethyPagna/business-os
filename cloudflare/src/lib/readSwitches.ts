import { getDb } from './db'
import type { Env } from '../index'

// STAND-IN for P0.3's lib/readSwitches.ts (not on this base): same readSwitch export and the same system_flags row. The
// reconciler takes P0.3's file and adds `call_counting` to its KNOWN_READ_SWITCHES (the real store answers OFF for an unknown name).
// Only the exact token "on" is ON; an absent, misspelled or unreadable switch is OFF, the pre-optimization path.
export const READ_SWITCH_KEY = 'read_switches'
export const READ_SWITCH_MEMO_MS = 15_000

type Memo = { at: number; tokens: Record<string, unknown> }
const memos = new WeakMap<object, Memo>()

function tokensOf(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    const switches = parsed && typeof parsed === 'object' ? (parsed as { switches?: unknown }).switches : null
    return switches && typeof switches === 'object' && !Array.isArray(switches) ? switches as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export async function readSwitch(env: Env, name: string): Promise<boolean> {
  const now = Date.now()
  let memo = memos.get(env.DB)
  if (!memo || now - memo.at < 0 || now - memo.at >= READ_SWITCH_MEMO_MS) {
    let tokens: Record<string, unknown> = {}
    try {
      const statement = getDb(env).prepare('SELECT value FROM system_flags WHERE key = @key')
      const rows = await (statement.allOnce ?? statement.all).call(statement, { key: READ_SWITCH_KEY }) as Array<{ value: string }>
      tokens = tokensOf(rows[0]?.value)
    } catch {
      tokens = {}
    }
    memo = { at: now, tokens }
    memos.set(env.DB, memo)
  }
  return memo.tokens[name] === 'on'
}

/** Forget what was read, so the next call reads the row again (tests and the flip route). */
export function resetReadSwitchMemo(env?: Env): void {
  if (env) memos.delete(env.DB)
}
