// One page of GET /system/audit-logs, and the bounded aggregates beside it.
//
// Split out of routes/compat.ts so the pure test can run the exact production
// SQL against the real audit_logs schema. See lib/auditLogQuery.ts for the two
// rules (every read bounded; nothing typed reaches the SQL text).
//
// Cost per request: one page query (LIMIT size+1, walked on the created_at
// index), plus -- on the FIRST page only, for the one dimension the caller is
// browsing -- one grouped aggregate over the same time window.

import {
  AUDIT_MAX_PAGE_SIZE,
  buildAuditLogFilters,
  clampAuditPageSize,
  encodeAuditCursor,
  normalizeAuditOrder,
  resolveAuditWindow,
  type AuditLogFilterInput,
  type AuditWindow,
} from './auditLogQuery'
import { AUDIT_SECTION_IDS, AUDIT_OTHER_SECTION, auditRowKey, auditSectionOf, type AuditSection } from './auditSections'

const AUDIT_USER_GROUP_LIMIT = 100
const AUDIT_SECTION_GROUP_LIMIT = 400
const ROW_KEY = "LOWER(COALESCE(NULLIF(TRIM(entity), ''), NULLIF(TRIM(table_name), ''), ''))"

export type AuditLogDb = {
  prepare(sql: string): {
    all<T = Record<string, unknown>>(params?: Record<string, unknown>): Promise<T[]>
  }
}

export type AuditLogPageInput = AuditLogFilterInput & {
  pageSize?: unknown
  counts?: string
}

export type AuditLogRow = {
  id: number
  user_id: number | null
  user_name: string | null
  action: string | null
  entity: string | null
  table_name: string | null
  created_at: string | null
  [key: string]: unknown
}

export type AuditLogPage = {
  items: Array<AuditLogRow & { section: AuditSection }>
  nextCursor: string | null
  hasMore: boolean
  pageSize: number
  order: 'asc' | 'desc'
  window: AuditWindow
  counts?: {
    users?: Array<{ id: number | null; name: string | null; count: number }>
    sections?: Array<{ section: AuditSection; count: number }>
  }
}

export async function readAuditLogPage(db: AuditLogDb, input: AuditLogPageInput, nowMs: number = Date.now()): Promise<AuditLogPage> {
  const pageSize = clampAuditPageSize(input.pageSize)
  const order = normalizeAuditOrder(input.order)
  const window = resolveAuditWindow(input, nowMs)
  const scoped: AuditLogFilterInput = {
    ...input,
    order,
    startDate: window.startDate ?? undefined,
    endDate: window.endDate ?? undefined,
  }

  const { where, params } = buildAuditLogFilters(scoped)
  const direction = order === 'asc' ? 'ASC' : 'DESC'
  const rows = await db.prepare(`
    SELECT
      id, user_id, user_name, user_name AS username, action, entity, entity_id, table_name, record_id,
      details, old_value, new_value, device_name, device_tz, client_time, created_at
    FROM audit_logs
    ${where}
    ORDER BY created_at ${direction}, id ${direction}
    LIMIT @limit
  `).all<AuditLogRow>({ ...params, limit: Math.min(pageSize, AUDIT_MAX_PAGE_SIZE) + 1 })

  const hasMore = rows.length > pageSize
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows
  const last = pageRows[pageRows.length - 1]
  const page: AuditLogPage = {
    items: pageRows.map((row) => ({ ...row, section: auditSectionOf(row.entity, row.table_name, row.action) })),
    nextCursor: hasMore && last ? encodeAuditCursor(last.created_at, last.id) : null,
    hasMore: hasMore && Boolean(last) && encodeAuditCursor(last.created_at, last.id) !== null,
    pageSize,
    order,
    window,
  }
  if (!page.hasMore) page.nextCursor = null

  if (!input.cursor && (input.counts === 'users' || input.counts === 'sections')) {
    page.counts = {}
    if (input.counts === 'users') page.counts.users = await countByUser(db, scoped)
    else page.counts.sections = await countBySection(db, scoped)
  }
  return page
}

// Which accounts did how much in this window -- the roster the "User" scope
// browses. It ignores the user filter (choosing a user must not collapse the
// list), but an own-only caller stays locked to themselves inside the builder.
async function countByUser(db: AuditLogDb, scoped: AuditLogFilterInput) {
  const { where, params } = buildAuditLogFilters(scoped, { user: true, cursor: true })
  const rows = await db.prepare(`
    SELECT g.user_id AS id, COALESCE(NULLIF(TRIM(u.username), ''), g.name) AS name, g.count AS count
    FROM (
      SELECT user_id, MAX(user_name) AS name, COUNT(*) AS count
      FROM audit_logs
      ${where}
      GROUP BY user_id
      ORDER BY count DESC
      LIMIT ${AUDIT_USER_GROUP_LIMIT}
    ) g
    LEFT JOIN users u ON u.id = g.user_id
    ORDER BY g.count DESC
  `).all<{ id: number | null; name: string | null; count: number }>(params)
  return rows.map((row) => ({ id: row.id ?? null, name: row.name ?? null, count: Number(row.count) || 0 }))
}

// Rows per section in this window, from a grouped read of the entity key (a
// few dozen distinct values) mapped through the ONE section table.
async function countBySection(db: AuditLogDb, scoped: AuditLogFilterInput) {
  const { where, params } = buildAuditLogFilters(scoped, { section: true, cursor: true })
  const rows = await db.prepare(`
    SELECT ${ROW_KEY} AS row_key,
           CASE WHEN ${ROW_KEY} = '' THEN LOWER(COALESCE(action, '')) ELSE '' END AS row_action,
           COUNT(*) AS count
    FROM audit_logs
    ${where}
    GROUP BY row_key, row_action
    LIMIT ${AUDIT_SECTION_GROUP_LIMIT}
  `).all<{ row_key: string; row_action: string; count: number }>(params)
  const totals = new Map<AuditSection, number>()
  for (const row of rows) {
    const section = auditRowKey(row.row_key, null)
      ? auditSectionOf(row.row_key, null, null)
      : auditSectionOf(null, null, row.row_action)
    totals.set(section, (totals.get(section) || 0) + (Number(row.count) || 0))
  }
  const order: AuditSection[] = [...AUDIT_SECTION_IDS, AUDIT_OTHER_SECTION]
  return order
    .filter((section) => (totals.get(section) || 0) > 0)
    .map((section) => ({ section, count: totals.get(section) || 0 }))
    .sort((left, right) => right.count - left.count)
}
