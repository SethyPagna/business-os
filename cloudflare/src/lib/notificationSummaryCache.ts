// Short server-side cache for GET /api/notifications/summary.
//
// One build of that summary is ~10 D1 queries over products, batches, sales,
// customers and portal rows (60k+ rows read in the 27 Sep lab), and every open
// admin tab re-asks for it on each sync broadcast -- so N tabs x a burst of
// broadcasts multiplied that cost. This collapses concurrent and back-to-back
// asks into one build per isolate per key.
//
// WHY THE TTL IS THIS SHORT. Nothing invalidates the entry when data changes
// (the writers are spread over every route and isolate), so a served entry is
// only as fresh as its age. The client (NotificationCenter's coalesced refresh)
// waits SYNC_QUIET_MS after the last broadcast it saw before it asks again, and
// that wait must be LONGER than this TTL: then any entry it can be handed was
// built after the write that caused the broadcast, so a change is never hidden
// behind a stale entry until the next 2 h poll. test-notification-summary-cache
// -pure.cjs pins the two numbers against each other.
//
// An entry is reusable from the moment its build STARTS until TTL later, pending
// or finished, so a slow build cannot be joined by a caller that arrived after
// the write it would miss. Failures are never cached.

export const NOTIFICATION_SUMMARY_TTL_MS = 1000

const MAX_ENTRIES = 64

type Entry = { startedAt: number; result: Promise<unknown> }

const entries = new Map<string, Entry>()

export async function cachedNotificationSummary<T>(key: string, build: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = entries.get(key)
  if (hit && now - hit.startedAt >= 0 && now - hit.startedAt < NOTIFICATION_SUMMARY_TTL_MS) {
    return hit.result as Promise<T>
  }

  const result = build()
  const entry: Entry = { startedAt: now, result }
  if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value as string)
  entries.set(key, entry)
  // Only this attempt's own entry is dropped, so a newer build that already
  // replaced it is left alone.
  result.catch(() => { if (entries.get(key) === entry) entries.delete(key) })
  return result
}

export function clearNotificationSummaryCache(): void {
  entries.clear()
}
