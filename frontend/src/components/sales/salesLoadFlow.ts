// Decisions the Sales list makes about its reads, kept out of the 3000-line page so they can be tested.

export type SalesLoadPlan = 'start' | 'coalesce' | 'preempt'

/**
 * What a load request does when another read may already be in flight.
 *  - nothing in flight: start;
 *  - the same query (a push, a manual refresh): coalesce into one trailing load;
 *  - a different query (the person typed, filtered or paged): the answer being waited for is
 *    already wrong, so abort it and start the new one at once. A newer query is never queued
 *    behind an older one, and never dropped because the older one failed or timed out.
 */
export function planSalesLoad(inFlightKey: string | null, nextKey: string): SalesLoadPlan {
  if (inFlightKey == null) return 'start'
  return inFlightKey === nextKey ? 'coalesce' : 'preempt'
}

export function salesLoadKey(params: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(params).sort().map((key) => [key, params[key]]))
}

export type SalesPageCache<T> = {
  get: (key: string) => T | undefined
  has: (key: string) => boolean
  set: (key: string, value: T) => void
  clear: () => void
}

/** A few recently read pages, so Next/Previous is instant. Oldest out first; stale entries are not served. */
export function createSalesPageCache<T>(maxEntries = 6, ttlMs = 60_000, now: () => number = Date.now): SalesPageCache<T> {
  const entries = new Map<string, { at: number; value: T }>()
  const fresh = (key: string) => {
    const entry = entries.get(key)
    if (!entry) return undefined
    if (now() - entry.at > ttlMs) { entries.delete(key); return undefined }
    return entry
  }
  return {
    get: (key) => fresh(key)?.value,
    has: (key) => fresh(key) != null,
    set(key, value) {
      entries.delete(key)
      entries.set(key, { at: now(), value })
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string)
    },
    clear: () => entries.clear(),
  }
}

export const SALES_PREFETCH_AHEAD = 2
export const SALES_PREFETCH_BEHIND = 1

/**
 * Pages worth reading quietly after `page` has loaded: the next two, then the previous one, in
 * that order. `total` is the true match count when known; without it the next pages are only
 * worth reading if this one came back full.
 */
export function pagesToPrefetch(page: number, pageSize: number, total: number | null, pageWasFull: boolean): number[] {
  const lastPage = total == null ? (pageWasFull ? Infinity : page) : Math.max(1, Math.ceil(total / pageSize))
  const wanted: number[] = []
  for (let step = 1; step <= SALES_PREFETCH_AHEAD; step += 1) wanted.push(page + step)
  for (let step = 1; step <= SALES_PREFETCH_BEHIND; step += 1) wanted.push(page - step)
  return wanted.filter((candidate) => candidate >= 1 && candidate <= lastPage)
}
