// Costly work that several requests of one isolate want at the same moment (a storefront build, the Dashboard overview, the core-data
// check, the stock-session column probe) is done once, WITHOUT any request awaiting a promise another request created.
//
// WHY NOT A SHARED PROMISE. workerd ties a promise to the request that created it. A request that started the work and answered, or was
// cancelled, before the work settled leaves a pending promise that never settles; every later request that awaits it waits for good, and
// a map that held it until it settled held it forever (the 6.0.1048 review, B1; HANG-2 found the same in six more places).
//
// WHAT IS SHARED INSTEAD. Two plain values:
//   * a marker "building since <time>" per key, set by the request that starts the work and removed when its work ends (success or
//     failure). A request that dies leaves its marker behind, so a marker older than buildShareStaleMs is ignored;
//   * the FINISHED result, in the caller's own memo (peek) or in the short memo kept here (remember), which only a request that waited on
//     the builder reads (it is not a cache: a request that finds no builder running builds for itself, as it did before this module).
// A request that finds a fresh marker waits in its own context: a timer of its own every buildSharePollMs, looking at the memo, for at
// most buildShareWaitMs. If the result appears it uses it. If the marker goes away without a result (the builder failed, or its result
// is not storable, e.g. while a restore holds maintenance), or goes stale, or the wait is used up, it does the work itself. It never
// awaits anything the other request created, so a dead builder costs a waiter at most the wait, never a hang.
//
// The three durations are plan limits (lib/planTier.ts). The module is reached through a global Symbol.for hook, like the request-metrics
// and device hooks: coreDataInvariants.ts and lowStockSettings.ts keep their import lists as they are, and the hand-written module maps of
// the portal and Dashboard tests need no new entry. index.ts imports this file for the side effect of installing the hook. With no hook (a
// test that loads one module alone) nothing is shared and every caller does its own work. The key below must stay identical in every file
// that reads the hook (scripts/test-build-share-pure.cjs enforces it).
import type { Env } from '../index'
import { getPlanLimits } from './planTier'

export const BUILD_SHARE_HOOK_KEY = 'business-os.build-share.v1'

type Marker = { at: number }
const building = new Map<string, Marker>()
const remembered = new Map<string, { value: unknown; at: number; until: number }>()
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// The remembered result of `key` if it was stored at or after `since` (the moment the builder a waiter waits on started) and is still live.
function recall<T>(key: string, since: number): T | undefined {
  const entry = remembered.get(key)
  if (!entry) return undefined
  if (Date.now() >= entry.until) { remembered.delete(key); return undefined }
  return entry.at >= since ? entry.value as T : undefined
}

/**
 * Keeps a finished result for the longest any waiter waits, or for `lifetimeMs` if that is shorter (a stored entry's own lifetime: the memo
 * must never outlive it). Call it where the result is stored (the storefront's edge write). The memo holds whole bodies, so it is bounded by
 * count as well as by time (buildShareMemoMaxEntries): past it the oldest entry goes first, and the waiter that wanted it rebuilds.
 */
function remember(env: Env, key: string, value: unknown, lifetimeMs = Number.POSITIVE_INFINITY): void {
  const limits = getPlanLimits(env)
  const now = Date.now()
  for (const [other, entry] of remembered) if (now >= entry.until) remembered.delete(other)
  remembered.delete(key) // a key stored again is the newest, not the oldest
  remembered.set(key, { value, at: now, until: now + Math.min(limits.buildShareWaitMs, lifetimeMs) })
  while (remembered.size > limits.buildShareMemoMaxEntries) remembered.delete(remembered.keys().next().value as string)
}

/**
 * Runs `build` for `key`, or waits for the request that already is. `peek` reads the caller's own memo of the finished result (a memo that
 * is a cache in its own right, so it is also read before anything else) and returns undefined while there is none. Without it the short
 * memo kept here (see remember) is used, and only by a request that WAITED on a builder: it takes a result stored after that builder
 * started. A request that arrives with no builder running never takes it, so the memo is not a cache layer of its own and a repeat
 * request sees what it would have seen without this module.
 */
async function run<T>(env: Env, key: string, build: () => Promise<T>, peek?: () => T | undefined): Promise<T> {
  const found = peek?.()
  if (found !== undefined) return found
  const limits = getPlanLimits(env)
  const marker = building.get(key)
  if (marker && Date.now() - marker.at < limits.buildShareStaleMs) {
    const since = marker.at
    const look = (): T | undefined => (peek ? peek() : recall<T>(key, since))
    const deadline = Math.min(Date.now() + limits.buildShareWaitMs, marker.at + limits.buildShareStaleMs)
    // Two bounds: the clock, and a count of steps (each one a real timer), so a clock that does not move cannot lengthen the wait.
    let steps = Math.ceil(limits.buildShareWaitMs / limits.buildSharePollMs)
    while (steps-- > 0 && Date.now() < deadline) {
      await sleep(limits.buildSharePollMs)
      const ready = look()
      if (ready !== undefined) return ready
      const current = building.get(key)
      if (!current || Date.now() - current.at >= limits.buildShareStaleMs) break
    }
  }
  const mine: Marker = { at: Date.now() }
  for (const [other, entry] of building) if (mine.at - entry.at >= limits.buildShareStaleMs) building.delete(other)
  building.set(key, mine)
  try {
    return await build()
  } finally {
    if (building.get(key) === mine) building.delete(key)
  }
}

export type BuildShareHook = {
  run<T>(env: Env, key: string, build: () => Promise<T>, peek?: () => T | undefined): Promise<T>
  remember(env: Env, key: string, value: unknown, lifetimeMs?: number): void
}

;(globalThis as unknown as Record<symbol, BuildShareHook>)[Symbol.for(BUILD_SHARE_HOOK_KEY)] = { run, remember }
