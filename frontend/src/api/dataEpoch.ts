// The database's data epoch as this tab knows it (CACHE-LIFECYCLE R2). The Worker names it with 8 hex characters, on every /api
// response (X-BOS-Epoch) and in the bootstrap runtime (dataEpoch). A restore, a cutover or a forced maintenance clear gives the
// database a new epoch, so the first response that carries a different tag tells this tab that what it cached describes another
// database state: it drops its memory caches and its search index and refreshes the page it is showing. Drafts and carts stay.
//
// The epoch is random, never ordered, and an isolate that has not yet refreshed its own 15 s memo can answer with the previous tag
// right after a rotation. A tag this tab already left is therefore an echo, not a second change: reacting to it would reset the
// caches again and again while the isolates converge.

export const DATA_EPOCH_EVENT = 'sync:data-epoch'
const TAG = /^[0-9a-f]{8}$/
const REMEMBERED_RETIRED_TAGS = 8

export type EpochDecision = 'first' | 'same' | 'changed' | 'echo' | 'invalid'

export function isEpochTag(value: unknown): value is string {
  return typeof value === 'string' && TAG.test(value)
}

export function createEpochTracker(initial: unknown = null) {
  let current: string | null = isEpochTag(initial) ? initial : null
  const retired: string[] = []
  return {
    current: (): string | null => current,
    /** Adopts a stored tag from an earlier session when nothing newer has been seen; never replaces one already in use. */
    seed(stored: unknown): void {
      if (current === null && isEpochTag(stored)) current = stored
    },
    observe(tag: unknown): EpochDecision {
      if (!isEpochTag(tag)) return 'invalid'
      if (current === null) { current = tag; return 'first' }
      if (tag === current) return 'same'
      if (retired.includes(tag)) return 'echo'
      retired.push(current)
      if (retired.length > REMEMBERED_RETIRED_TAGS) retired.shift()
      current = tag
      return 'changed'
    },
  }
}

let tracker = createEpochTracker()

function announce(epoch: string, source: 'header' | 'bootstrap'): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  try { window.dispatchEvent(new CustomEvent(DATA_EPOCH_EVENT, { detail: { epoch, source, ts: Date.now() } })) } catch { /* an observer never fails a response */ }
}

/** One tag from a response header or the bootstrap. A change fires DATA_EPOCH_EVENT once; everything else is silent. */
export function observeDataEpoch(tag: unknown, source: 'header' | 'bootstrap'): EpochDecision {
  const decision = tracker.observe(tag)
  if (decision === 'changed') announce(tag as string, source)
  return decision
}

/** The tag the earlier session stored, so a restore that happened while the browser was closed is still noticed. */
export function seedDataEpoch(stored: unknown): void {
  tracker.seed(stored)
}

export const currentDataEpoch = (): string | null => tracker.current()

export function __resetDataEpochForTests(initial: unknown = null): void {
  tracker = createEpochTracker(initial)
}
