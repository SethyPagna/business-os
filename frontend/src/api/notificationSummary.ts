import { isCooldownActive } from '../platform/storage/storagePolicy.ts'
import {
  clearNotificationSummaryMissing,
  getNotificationSummaryFallback,
  markNotificationSummaryMissing,
  readNotificationSummaryMissingUntil,
} from './cooldownFallbacks.ts'
import { apiFetch, cacheInvalidate, isTransientGatewayError, route } from './http.ts'
import { bellPath, peekBellFresh, restoreBellFresh, takeBellFresh } from './bellFreshness.ts'

let notificationSummaryRequestPromise: Promise<unknown> | null = null

function buildNotificationSummaryFallback(): unknown {
  const cooldownUntil = readNotificationSummaryMissingUntil()
  const coolingDown = isCooldownActive(cooldownUntil)
  return getNotificationSummaryFallback({
    unavailable: coolingDown,
    transient: coolingDown,
    cooldownUntil: cooldownUntil || undefined,
  })
}

// The summary carries only a preview of a long section (inventory: first 50 rows, exact count);
// this is the explicit "load more" that fetches the whole list for one section.
export async function getNotificationSectionItems(sectionId: string): Promise<unknown> {
  // route() answers from its 20 s channel cache and joins a read in flight before the serverFn below ever runs, so a pending
  // fresh read must retire both first, or ?fresh=1 is never sent.
  if (peekBellFresh('items')) cacheInvalidate('notifications:section-items')
  return route('notifications:section-items', async () => {
    // The Worker serves this list from a cache up to 5 minutes old; this tab's own write asks for a fresh one.
    const fresh = takeBellFresh('items')
    try {
      return await apiFetch('GET', bellPath(`/api/notifications/summary/items?section=${encodeURIComponent(sectionId)}`, fresh))
    } catch (error) {
      if (fresh) restoreBellFresh('items')
      throw error
    }
  })
}

export async function getNotificationSummary(): Promise<unknown> {
  // Same reason as above: drop the client cache entry and any read begun before the write, so this read reaches the network with ?fresh=1.
  if (peekBellFresh('summary')) cacheInvalidate('notifications:summary')
  return route('notifications:summary', async () => {
    const missingUntil = readNotificationSummaryMissingUntil()
    if (isCooldownActive(missingUntil)) {
      return getNotificationSummaryFallback({
        unavailable: true,
        cooldownUntil: missingUntil,
      })
    }

    if (notificationSummaryRequestPromise) {
      // A read already in flight began before this tab's own write, so it may carry the old counts: let it finish, then ask again.
      if (!peekBellFresh('summary')) return await notificationSummaryRequestPromise
      await notificationSummaryRequestPromise.catch(() => undefined)
      if (notificationSummaryRequestPromise) return await notificationSummaryRequestPromise
    }

    notificationSummaryRequestPromise = (async () => {
      const fresh = takeBellFresh('summary')
      try {
        const result = await apiFetch('GET', bellPath('/api/notifications/summary', fresh))
        clearNotificationSummaryMissing()
        return result
      } catch (error) {
        if (fresh) restoreBellFresh('summary')
        const status = Number((error as { status?: unknown })?.status || 0)
        const transientGateway = isTransientGatewayError(status)
        if (status === 404) {
          markNotificationSummaryMissing()
          return getNotificationSummaryFallback({
            unavailable: true,
            cooldownUntil: readNotificationSummaryMissingUntil(),
          })
        }
        if (transientGateway) {
          markNotificationSummaryMissing()
        }
        throw error
      } finally {
        notificationSummaryRequestPromise = null
      }
    })()

    return await notificationSummaryRequestPromise
  }, buildNotificationSummaryFallback)
}
