import {
  DRIVE_SYNC_STATUS_COOLDOWN_KEY,
  DRIVE_SYNC_STATUS_COOLDOWN_MS,
  NOTIFICATION_SUMMARY_MISSING_TTL_MS,
  NOTIFICATION_SUMMARY_MISSING_UNTIL_KEY,
  maxStoredNumber,
} from '../platform/storage/storagePolicy.ts'

export interface NotificationSummaryFallback extends Record<string, unknown> {
  unreadCount: number
  sections: unknown[]
  preferences: Record<string, unknown>
}

export interface DriveSyncStatusFallback extends Record<string, unknown> {
  item: null
  unavailable: boolean
}

let notificationSummaryMissingUntilMemory = 0
let driveSyncStatusCooldownMemory = 0

function readBrowserStoredNumber(key: string, memoryValue = 0): number {
  if (typeof window === 'undefined') {
    return Number.isFinite(memoryValue) ? memoryValue : 0
  }
  try {
    const sessionValue = Number(window.sessionStorage.getItem(key) || 0)
    const localValue = Number(window.localStorage.getItem(key) || 0)
    return maxStoredNumber([memoryValue, sessionValue, localValue])
  } catch (_) {
    return Number.isFinite(memoryValue) ? memoryValue : 0
  }
}

function writeBrowserStoredNumber(key: string, value: number): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(key, String(value))
    window.localStorage.setItem(key, String(value))
  } catch (_) {}
}

function clearBrowserStoredNumber(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(key)
    window.localStorage.removeItem(key)
  } catch (_) {}
}

export function getNotificationSummaryFallback(
  extra: Record<string, unknown> = {},
): NotificationSummaryFallback {
  return {
    unreadCount: 0,
    sections: [],
    preferences: {},
    ...extra,
  }
}

export function readNotificationSummaryMissingUntil(): number {
  return readBrowserStoredNumber(
    NOTIFICATION_SUMMARY_MISSING_UNTIL_KEY,
    Number(notificationSummaryMissingUntilMemory || 0),
  )
}

export function markNotificationSummaryMissing(now = Date.now()): number {
  notificationSummaryMissingUntilMemory = now + NOTIFICATION_SUMMARY_MISSING_TTL_MS
  writeBrowserStoredNumber(NOTIFICATION_SUMMARY_MISSING_UNTIL_KEY, notificationSummaryMissingUntilMemory)
  return notificationSummaryMissingUntilMemory
}

export function clearNotificationSummaryMissing(): void {
  notificationSummaryMissingUntilMemory = 0
  clearBrowserStoredNumber(NOTIFICATION_SUMMARY_MISSING_UNTIL_KEY)
}

export function getDriveSyncStatusFallback(extra: Record<string, unknown> = {}): DriveSyncStatusFallback {
  return {
    item: null,
    unavailable: true,
    ...extra,
  }
}

export function readDriveSyncStatusCooldown(): number {
  return readBrowserStoredNumber(
    DRIVE_SYNC_STATUS_COOLDOWN_KEY,
    Number(driveSyncStatusCooldownMemory || 0),
  )
}

export function markDriveSyncStatusCooldown(now = Date.now()): number {
  driveSyncStatusCooldownMemory = now + DRIVE_SYNC_STATUS_COOLDOWN_MS
  writeBrowserStoredNumber(DRIVE_SYNC_STATUS_COOLDOWN_KEY, driveSyncStatusCooldownMemory)
  return driveSyncStatusCooldownMemory
}

export function clearDriveSyncStatusCooldown(): void {
  driveSyncStatusCooldownMemory = 0
  clearBrowserStoredNumber(DRIVE_SYNC_STATUS_COOLDOWN_KEY)
}
