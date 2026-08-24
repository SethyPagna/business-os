import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'

type AuditLogParams = QueryParams & {
  pageSize?: string | number
}

const AUDIT_LOG_MIRROR_IDLE_DELAY_MS = 10_000

let localDbModulePromise: Promise<typeof import('./lazyLocalDb.ts')> | null = null
let localMirrorsModulePromise: Promise<typeof import('./localMirrors.ts')> | null = null

function getLocalDbModule(): Promise<typeof import('./lazyLocalDb.ts')> {
  if (!localDbModulePromise) localDbModulePromise = import('./lazyLocalDb.ts')
  return localDbModulePromise
}

function getLocalMirrorsModule(): Promise<typeof import('./localMirrors.ts')> {
  if (!localMirrorsModulePromise) localMirrorsModulePromise = import('./localMirrors.ts')
  return localMirrorsModulePromise
}

function scheduleAuditLogMirror(rows: unknown): void {
  const run = (): void => {
    getLocalMirrorsModule()
      .then(({ mirrorTable }) => mirrorTable('audit_logs')(rows))
      .catch(() => {})
  }
  if (typeof window === 'undefined') {
    Promise.resolve().then(run).catch(() => {})
    return
  }
  window.setTimeout(run, AUDIT_LOG_MIRROR_IDLE_DELAY_MS)
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
      scheduleAuditLogMirror(auditRows)
      return result
    },
    async () => {
      const { getLocalDb } = await getLocalDbModule()
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
    { raceLocalFallback: false },
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
