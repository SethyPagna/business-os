// The notification bell may be up to 5 minutes old (owner, 11 Nov: the Worker answers its inventory, expiry and supplier-credit
// sections from a cache that ignores data versions, and the panel says "as of HH:MM"). The one exception is the person's OWN
// write: after a sale, a stock change, a product edit or a lot payment made from this tab, the next bell read must show the
// result, so it asks the Worker for `?fresh=1` (a recompute that also refreshes the entry everyone else reads).
//
// No imports: apiFetch (http.ts) calls noteOwnWriteForBell from its after-mutation hook, and notificationSummary.ts imports
// http.ts, so this module has to sit under both.

type BellRead = 'summary' | 'items'

const pending: Record<BellRead, boolean> = { summary: false, items: false }

/**
 * True when a mutation whose cached-read invalidation list is `prefixes` can change a bell count: it moves stock or products
 * (every writer of the inventory, expiry and supplier-credit inputs reaches the 'inventory' or 'products' read prefixes in
 * api/writeInvalidation.ts), or it is unmapped (null: the caller clears every cached read, so the bell is stale too).
 */
export function bellRelevantInvalidations(prefixes: readonly string[] | null): boolean {
  return prefixes === null || prefixes.includes('inventory') || prefixes.includes('products')
}

export function noteOwnWriteForBell(prefixes: readonly string[] | null): void {
  if (!bellRelevantInvalidations(prefixes)) return
  pending.summary = true
  pending.items = true
}

/** Consumes the flag: true once per own write, for the one read that will carry `?fresh=1`. */
export function takeBellFresh(read: BellRead): boolean {
  const value = pending[read]
  pending[read] = false
  return value
}

/** Whether an own write is waiting to be shown (does not consume it). */
export function peekBellFresh(read: BellRead): boolean {
  return pending[read]
}

/** A read that carried the flag and failed puts it back, so the next attempt still asks for the fresh answer. */
export function restoreBellFresh(read: BellRead): void {
  pending[read] = true
}

/** The panel's own refresh button: the next read, summary and items, is a recompute. */
export function requestFreshBell(): void {
  pending.summary = true
  pending.items = true
}

export function bellPath(path: string, fresh: boolean): string {
  if (!fresh) return path
  return `${path}${path.includes('?') ? '&' : '?'}fresh=1`
}
