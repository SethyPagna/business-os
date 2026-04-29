export const LIVE_SERVER_SENSITIVE_MIRROR_TABLES = new Set([
  'users',
  'roles',
  'products',
  'branch_stock',
  'customers',
  'suppliers',
  'delivery_contacts',
  'sales',
  'sale_items',
  'returns',
  'audit_logs',
  'inventory_movements',
  'stock_transfers',
])

export const NOTIFICATION_SUMMARY_MISSING_UNTIL_KEY = 'businessos_notifications_summary_missing_until'
export const NOTIFICATION_SUMMARY_MISSING_TTL_MS = 4 * 60 * 60 * 1000
export const DRIVE_SYNC_STATUS_COOLDOWN_KEY = 'businessos_drive_sync_status_cooldown_until'
export const DRIVE_SYNC_STATUS_COOLDOWN_MS = 10 * 60 * 1000

export function shouldPersistLocalMirror(tableName, syncServerUrl = '') {
  return !(String(syncServerUrl || '').trim() && LIVE_SERVER_SENSITIVE_MIRROR_TABLES.has(String(tableName || '').trim()))
}

export function maxStoredNumber(values = []) {
  return values.reduce((max, value) => {
    const num = Number(value || 0)
    return Number.isFinite(num) && num > max ? num : max
  }, 0)
}

export function isCooldownActive(until, now = Date.now()) {
  const numericUntil = Number(until || 0)
  return Number.isFinite(numericUntil) && numericUntil > now
}
