'use strict'

const DRIVE_SYNC_VERSION_PREFIX = 'datasync'
const DRIVE_SYNC_VERSION_MS = 24 * 60 * 60 * 1000
const DRIVE_SYNC_DEFAULT_RETENTION_DAYS = 30

function toSafeDate(value) {
  const time = Date.parse(String(value || ''))
  return Number.isFinite(time) ? new Date(time) : null
}

function toSafeVersionNumber(value) {
  const number = Number.parseInt(value, 10)
  return Number.isInteger(number) && number > 0 ? number : 0
}

function resolveDriveSyncVersionState({
  currentVersionNumber,
  currentVersionStartedAt,
  now = new Date(),
} = {}) {
  const nowDate = now instanceof Date ? now : toSafeDate(now)
  const safeNow = nowDate || new Date()
  const safeNowIso = safeNow.toISOString()
  const currentNumber = toSafeVersionNumber(currentVersionNumber)
  const currentStarted = toSafeDate(currentVersionStartedAt)

  if (!currentNumber || !currentStarted) {
    return {
      versionNumber: 1,
      versionName: `${DRIVE_SYNC_VERSION_PREFIX}-1`,
      startedAt: safeNowIso,
      rotated: true,
    }
  }

  const ageMs = safeNow.getTime() - currentStarted.getTime()
  if (ageMs >= 0 && ageMs < DRIVE_SYNC_VERSION_MS) {
    return {
      versionNumber: currentNumber,
      versionName: `${DRIVE_SYNC_VERSION_PREFIX}-${currentNumber}`,
      startedAt: currentStarted.toISOString(),
      rotated: false,
    }
  }

  const nextNumber = currentNumber + 1
  return {
    versionNumber: nextNumber,
    versionName: `${DRIVE_SYNC_VERSION_PREFIX}-${nextNumber}`,
    startedAt: safeNowIso,
    rotated: true,
  }
}

function parseVersionName(name) {
  const match = String(name || '').trim().match(/^datasync-(\d+)$/i)
  return match ? Number.parseInt(match[1], 10) : 0
}

function selectExpiredDriveSyncVersions(items = [], retentionCount = DRIVE_SYNC_DEFAULT_RETENTION_DAYS) {
  const safeRetention = Math.max(1, Number.parseInt(retentionCount, 10) || DRIVE_SYNC_DEFAULT_RETENTION_DAYS)
  const versions = (Array.isArray(items) ? items : [])
    .map((item) => ({
      ...item,
      versionNumber: parseVersionName(item?.name),
    }))
    .filter((item) => item.versionNumber > 0)
    .sort((a, b) => b.versionNumber - a.versionNumber)

  return versions.slice(safeRetention).sort((a, b) => a.versionNumber - b.versionNumber)
}

module.exports = {
  DRIVE_SYNC_DEFAULT_RETENTION_DAYS,
  DRIVE_SYNC_VERSION_MS,
  DRIVE_SYNC_VERSION_PREFIX,
  resolveDriveSyncVersionState,
  selectExpiredDriveSyncVersions,
}
