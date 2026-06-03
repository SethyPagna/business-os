import { apiFetch, route } from './http.ts'
import { getLocalDb } from './lazyLocalDb.ts'
import { mirrorTable } from './localMirrors.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'

type AuditLogParams = QueryParams & {
  pageSize?: string | number
}

function normalizeAuditPageSize(params: AuditLogParams = {}): number {
  const pageSize = Number(params?.pageSize || 50)
  return Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 50
}

export function getAuditLogs(params: AuditLogParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  const pageSize = normalizeAuditPageSize(params)
  return route(
    `audit_log:get:${query}`,
    async () => {
      const result = await apiFetch('GET', appendQuery('/api/system/audit-logs', query))
      const auditRows = Array.isArray(result) ? result : (result?.items || [])
      await mirrorTable('audit_logs')(auditRows).catch(() => {})
      return result
    },
    async () => {
      const db = await getLocalDb()
      const rows = await db.table('audit_logs').orderBy('created_at').reverse().limit(pageSize).toArray()
      return {
        items: rows,
        total: rows.length,
        page: 1,
        pageSize: rows.length || pageSize,
        totalPages: 1,
        filters: { users: [] },
        source: 'local',
        partial: true,
      }
    },
  )
}

export function deleteAuditLogsRetention(olderThanDays = 30): Promise<unknown> {
  const days = encodeURIComponent(String(olderThanDays))
  return route(
    'audit_log:retention:delete',
    () => apiFetch('DELETE', `/api/system/audit-logs/retention?olderThanDays=${days}&confirm=1`, undefined),
    null,
    true,
  )
}
