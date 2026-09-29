export type BackupListingItem = {
  uploaded?: string | null
  finalized?: boolean
  status?: string
}

export type BackupListing = {
  items?: BackupListingItem[]
  schedule?: {
    intervalHours?: number
    automatic?: boolean
  }
}

export type BackupFreshness = {
  takenAt: string | null
  ageHours: number | null
  overdue: boolean
  intervalHours: number
  overdueAfterHours: number
}

const HOUR_MS = 60 * 60 * 1000
const DEFAULT_BACKUP_INTERVAL_HOURS = 6
const ASSET_COPY_ALLOWANCE_HOURS = 1

// The newest finished backup normally peaks at one interval plus the asset
// copy; past two intervals at least one scheduled backup never finished.
function backupOverdueAfterHours(intervalHours: number): number {
  return 2 * intervalHours + ASSET_COPY_ALLOWANCE_HOURS
}

function newestFinishedBackup(items: BackupListingItem[]): { takenAt: string; takenAtMs: number } | null {
  let newest: { takenAt: string; takenAtMs: number } | null = null
  for (const item of items) {
    if (item?.finalized !== true || !item.uploaded) continue
    const takenAtMs = Date.parse(item.uploaded)
    if (!Number.isFinite(takenAtMs)) continue
    if (!newest || takenAtMs > newest.takenAtMs) newest = { takenAt: item.uploaded, takenAtMs }
  }
  return newest
}

export function describeBackupFreshness(listing: BackupListing, nowMs: number): BackupFreshness {
  const intervalHours = Number(listing.schedule?.intervalHours) > 0
    ? Number(listing.schedule?.intervalHours)
    : DEFAULT_BACKUP_INTERVAL_HOURS
  const overdueAfterHours = backupOverdueAfterHours(intervalHours)
  const automatic = listing.schedule?.automatic !== false
  const newest = newestFinishedBackup(listing.items || [])
  if (!newest) return { takenAt: null, ageHours: null, overdue: automatic, intervalHours, overdueAfterHours }
  const ageHours = Math.max(0, (nowMs - newest.takenAtMs) / HOUR_MS)
  return {
    takenAt: newest.takenAt,
    ageHours,
    overdue: automatic && ageHours > overdueAfterHours,
    intervalHours,
    overdueAfterHours,
  }
}
