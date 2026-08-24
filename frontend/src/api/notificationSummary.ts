import { isCooldownActive } from '../platform/storage/storagePolicy.ts'
import {
  clearNotificationSummaryMissing,
  getNotificationSummaryFallback,
  markNotificationSummaryMissing,
  readNotificationSummaryMissingUntil,
} from './cooldownFallbacks.ts'
import { apiFetch, isTransientGatewayError, route } from './http.ts'

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

export async function getNotificationSummary(): Promise<unknown> {
  return route('notifications:summary', async () => {
    const missingUntil = readNotificationSummaryMissingUntil()
    if (isCooldownActive(missingUntil)) {
      return getNotificationSummaryFallback({
        unavailable: true,
        cooldownUntil: missingUntil,
      })
    }

    if (notificationSummaryRequestPromise) return await notificationSummaryRequestPromise

    notificationSummaryRequestPromise = (async () => {
      try {
        const result = await apiFetch('GET', '/api/notifications/summary')
        clearNotificationSummaryMissing()
        return result
      } catch (error) {
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
