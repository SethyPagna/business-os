import { SYNC } from '../constants.ts'
import { isCooldownActive } from '../platform/storage/storagePolicy.ts'
import {
  clearDriveSyncStatusCooldown,
  getDriveSyncStatusFallback,
  markDriveSyncStatusCooldown,
  readDriveSyncStatusCooldown,
} from './cooldownFallbacks.ts'
import { apiFetch, isNetErr, route } from './http.ts'

type DriveSyncPayload = Record<string, unknown>

let driveSyncStatusRequestPromise: Promise<unknown> | null = null

export function getGoogleDriveSyncStatus(): Promise<unknown> {
  return route('system:driveSyncStatus', async () => {
    const cooldownUntil = readDriveSyncStatusCooldown()
    if (isCooldownActive(cooldownUntil)) {
      return getDriveSyncStatusFallback({ cooldownUntil })
    }
    if (driveSyncStatusRequestPromise) return await driveSyncStatusRequestPromise
    driveSyncStatusRequestPromise = (async () => {
      try {
        const result = await apiFetch('GET', '/api/system/drive-sync/status')
        clearDriveSyncStatusCooldown()
        return result
      } catch (error) {
        const status = Number((error as { status?: unknown })?.status || 0)
        const message = String((error as { message?: unknown })?.message || '').toLowerCase()
        const retryable = isNetErr(error)
          || message.includes('insufficient_resources')
          || [404, 429, 500, 502, 503, 504].includes(status)
        if (retryable) {
          const nextUntil = markDriveSyncStatusCooldown()
          return getDriveSyncStatusFallback({
            cooldownUntil: nextUntil,
            lastError: (error as { message?: string })?.message || 'Drive sync status temporarily unavailable',
          })
        }
        throw error
      } finally {
        driveSyncStatusRequestPromise = null
      }
    })()
    return await driveSyncStatusRequestPromise
  }, () => getDriveSyncStatusFallback())
}

export function saveGoogleDriveSyncPreferences(payload: DriveSyncPayload): Promise<unknown> {
  return route(
    'system:driveSyncPreferences',
    () => apiFetch('POST', '/api/system/drive-sync/preferences', payload),
    null,
    true,
  )
}

export function startGoogleDriveSyncOauth(payload: DriveSyncPayload): Promise<unknown> {
  return route(
    'system:driveSyncOauthStart',
    () => apiFetch('POST', '/api/system/drive-sync/oauth/start', payload),
    null,
    true,
  )
}

export function disconnectGoogleDriveSync(): Promise<unknown> {
  return route(
    'system:driveSyncDisconnect',
    () => apiFetch('POST', '/api/system/drive-sync/disconnect', {}),
    null,
    true,
  )
}

export function forgetGoogleDriveSyncCredentials(payload: DriveSyncPayload = {}): Promise<unknown> {
  return route(
    'system:driveSyncForgetCredentials',
    () => apiFetch('POST', '/api/system/drive-sync/forget-credentials', payload),
    null,
    true,
  )
}

export function queueGoogleDriveSyncNow(): Promise<unknown> {
  return route(
    'system:driveSyncNow:queue',
    () => apiFetch('POST', '/api/system/drive-sync/jobs', {}, SYNC.REQUEST_TIMEOUT_MS),
    null,
    true,
  )
}

export function queueGoogleDriveRestoreStage(): Promise<unknown> {
  return route(
    'system:driveRestoreStage:queue',
    () => apiFetch('POST', '/api/system/drive-sync/restore-stage/jobs', {}, SYNC.REQUEST_TIMEOUT_MS),
    null,
    true,
  )
}

export function syncGoogleDriveNow(): Promise<unknown> {
  return route('system:driveSyncNow', () => queueGoogleDriveSyncNow(), null, true)
}
