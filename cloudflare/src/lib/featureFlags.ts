// Feature flags for the C3v2 A/B work: one KV key, `rm:flags`, holding JSON
// `{ "<feature>": "off" | "shadow" | "on" }`.
//
//   off     the old path only (the default for anything missing or invalid)
//   shadow  the old path answers; the new path may run alongside to be measured
//   on      the new path answers
//
// Read-only here. Nothing in this Worker writes `rm:flags`: setting a flag is a
// deliberate operator action against the CACHE namespace, never a side effect.
//
// Memoized per isolate for 30 s, so a flag costs one KV read per isolate per
// 30 s and nothing on the other requests. A KV error or unparseable value is
// memoized the same way (as "everything off"), so a broken key cannot turn
// into a KV read on every request. Concurrent first reads share one promise.
//
// Every flag a request reads is recorded on that request's metrics
// (lib/requestMetrics.ts) and the first answer is kept for the rest of the
// request, so a memo expiring mid-request cannot run half of it each way.

import { noteFlagState, type FlagState } from './requestMetrics'

export type { FlagState }

export const FEATURE_FLAGS_KV_KEY = 'rm:flags'
export const FEATURE_FLAGS_TTL_MS = 30_000

const STATES: ReadonlySet<string> = new Set(['off', 'shadow', 'on'])

type FlagMap = Record<string, FlagState>

/** Parses the stored JSON. Anything malformed yields no flags (all off). */
export function parseFeatureFlags(raw: unknown): FlagMap {
  if (typeof raw !== 'string' || !raw.trim()) return {}
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return {} }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: FlagMap = {}
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string' && STATES.has(value) && /^[a-z0-9_.-]{1,64}$/i.test(name)) out[name] = value as FlagState
  }
  return out
}

let memo: { at: number; flags: FlagMap } | null = null
let inflight: Promise<FlagMap> | null = null

/** Test seam: forget the isolate memo. */
export function resetFeatureFlagMemo(): void {
  memo = null
  inflight = null
}

export async function loadFeatureFlags(kv: KVNamespace | undefined, now: number = Date.now()): Promise<FlagMap> {
  if (memo && now - memo.at < FEATURE_FLAGS_TTL_MS) return memo.flags
  if (inflight) return inflight
  inflight = (async () => {
    let flags: FlagMap = {}
    try {
      flags = kv ? parseFeatureFlags(await kv.get(FEATURE_FLAGS_KV_KEY)) : {}
    } catch {
      flags = {}
    }
    memo = { at: now, flags }
    return flags
  })()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}

/** The state of one feature for this request. Never throws; defaults to 'off'. */
export async function flag(c: { env: { CACHE?: KVNamespace } }, name: string, now: number = Date.now()): Promise<FlagState> {
  let state: FlagState = 'off'
  try {
    const flags = await loadFeatureFlags(c?.env?.CACHE, now)
    state = flags[name] || 'off'
  } catch {
    state = 'off'
  }
  return noteFlagState(name, state)
}
