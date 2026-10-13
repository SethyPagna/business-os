// How long the audit trail is kept before the daily purge deletes it. The owner's
// retention rule sets the floor: nobody shortens the window below 21 days,
// whatever is stored in the settings row.
export const AUDIT_LOG_RETENTION_FLOOR_DAYS = 21
export const AUDIT_LOG_RETENTION_MAX_DAYS = 3650

export function parseAuditRetentionDays(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!/^\d{1,4}$/.test(text)) return null
  const days = Number(text)
  return days >= AUDIT_LOG_RETENTION_FLOOR_DAYS && days <= AUDIT_LOG_RETENTION_MAX_DAYS ? days : null
}
