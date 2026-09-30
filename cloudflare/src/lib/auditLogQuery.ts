// WHERE-clause builder for GET /system/audit-logs.
//
// Two rules shape everything here:
//   1. Every read is bounded. The audit log is the biggest table the app owns and
//      D1 bills rows read, so a request always carries a time window (default
//      the last 30 business days, at most 92) and pages by keyset cursor on
//      (created_at, id) -- never OFFSET, never a whole-table COUNT or DISTINCT.
//      The window bounds the READ only once idx_audit_logs_created exists; until
//      then the same statements are correct but scan.
//      A per-record trail (entityId) is the one exception to the window and is
//      NOT index-bounded: CAST(entity_id ...) and LOWER(entity) wrap the columns,
//      so idx_audit_logs_entity_entity_id cannot serve it and it scans the table,
//      as it did before this page was reorganised. Its page is at most 100 rows.
//   2. Nothing the caller types reaches the SQL text. Search words, ids, cursor
//      parts and the section lists are all bound parameters (the section lists
//      as ONE json array each, read back with json_each, so D1's 100-parameter
//      statement cap cannot be hit however many sections are chosen).
//
// Contract with the page: `action`, `entity`, `userId` and `section` are
// COMMA-SEPARATED multi-values (toggleMultiValue joins selections with ','),
// matched case-insensitively; `entity` matches either the `entity` or the legacy
// `table_name` column. Dates are inclusive YYYY-MM-DD on the LOCAL (UTC+7,
// Cambodia) calendar date of the stored-UTC created_at -- server truth,
// deliberately not the device-supplied client_time (see businessDateWindow.ts;
// the created_at prefilter there keeps the index usable).

import { businessToday, localDateExpr } from './businessDateWindow'
import {
  AUDIT_ENTITY_SECTION,
  AUDIT_KEYLESS_ACTION_SECTION,
  AUDIT_OTHER_SECTION,
  isAuditSection,
  type AuditSection,
} from './auditSections'

export const AUDIT_DEFAULT_PAGE_SIZE = 50
export const AUDIT_MAX_PAGE_SIZE = 100
export const AUDIT_DEFAULT_WINDOW_DAYS = 30
export const AUDIT_MAX_WINDOW_DAYS = 92
const AUDIT_MAX_SEARCH_WORDS = 5
const AUDIT_MAX_SEARCH_WORD_LENGTH = 64
const AUDIT_MAX_SEARCH_LENGTH = 200

export type AuditLogFilterInput = {
  search?: string
  action?: string
  entity?: string
  /**
   * ONE record's trail. Added for the per-record "Records" / "Field history"
   * floats (products, contacts): they ask this same endpoint for
   * entity=product&entityId=42 rather than introducing a second audit reader
   * with its own permission story. A SINGLE value, not the comma list the
   * other filters take -- a float is always about one record, and matching a
   * list here would let a caller widen its own scope.
   *
   * entity_id is a TEXT column written by both text and integer writers, and
   * record_id carries the id for rows whose entity_id holds a receipt id
   * instead (a return's create row is the live example), so both are matched.
   */
  entityId?: string
  userId?: string
  /** Set for an own-only caller: this account's rows are the only ones ever returned. */
  lockedUserId?: number
  /** Comma-separated section ids (see lib/auditSections.ts), 'other' included. */
  section?: string
  startDate?: string
  endDate?: string
  order?: string
  cursor?: string
}

export type AuditLogFilterClause = {
  // '' when unfiltered, otherwise 'WHERE ...' -- append verbatim.
  where: string
  params: Record<string, string | number>
}

export type AuditLogFilterOmit = { user?: boolean; section?: boolean; cursor?: boolean }

export type AuditCursor = { createdAt: string; id: number }
export type AuditWindow = { startDate: string | null; endDate: string | null }

function splitMulti(raw: string | undefined): string[] {
  return String(raw || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function isIsoDay(value: string | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

export function clampAuditPageSize(raw: unknown): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return AUDIT_DEFAULT_PAGE_SIZE
  return Math.min(AUDIT_MAX_PAGE_SIZE, parsed)
}

export function normalizeAuditOrder(raw: unknown): 'asc' | 'desc' {
  return String(raw || '').toLowerCase() === 'asc' ? 'asc' : 'desc'
}

/**
 * The business-day window a request reads. Omitted dates default to the last
 * 30 business days ending today (UTC+7, never the UTC date); a longer span is
 * clamped to the newest 92 days; a future end is clamped to today; an inverted
 * range is swapped. A per-record trail with no dates is unbounded in time.
 */
export function resolveAuditWindow(
  input: { startDate?: string; endDate?: string; entityId?: string },
  nowMs: number = Date.now(),
): AuditWindow {
  const hasStart = isIsoDay(input.startDate)
  const hasEnd = isIsoDay(input.endDate)
  if (String(input.entityId ?? '').trim() && !hasStart && !hasEnd) return { startDate: null, endDate: null }
  const today = businessToday(nowMs)
  let start = hasStart ? String(input.startDate) : null
  let end = hasEnd ? String(input.endDate) : null
  if (start && end && start > end) [start, end] = [end, start]
  if (!end || end > today) end = today
  if (!start) start = addDays(end, -(AUDIT_DEFAULT_WINDOW_DAYS - 1))
  if (start > end) start = end
  const floor = addDays(end, -(AUDIT_MAX_WINDOW_DAYS - 1))
  if (start < floor) start = floor
  return { startDate: start, endDate: end }
}

const CURSOR_CREATED_AT = /^\d{4}-\d{2}-\d{2}[T ][0-9:.]{1,20}(?:Z|[+-]\d{2}:?\d{2})?$/

export function encodeAuditCursor(createdAt: unknown, id: unknown): string | null {
  const stamp = String(createdAt ?? '')
  const rowId = Number(id)
  if (!CURSOR_CREATED_AT.test(stamp) || !Number.isSafeInteger(rowId) || rowId < 1) return null
  return btoa(JSON.stringify([stamp, rowId])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeAuditCursor(raw: unknown): AuditCursor | null {
  const text = String(raw ?? '')
  if (!text || text.length > 200 || !/^[A-Za-z0-9_-]+$/.test(text)) return null
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/')
    const parsed = JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)))
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    const [createdAt, id] = parsed
    if (typeof createdAt !== 'string' || !CURSOR_CREATED_AT.test(createdAt)) return null
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return null
    return { createdAt, id }
  } catch {
    return null
  }
}

// likelihood() changes only what the planner ESTIMATES, never the rows. Telling it
// the window keeps about half the table makes a sort of the window look costly,
// so after ANALYZE it keeps walking the created_at index in order instead of
// skip-scanning (action, created_at) or (user_id, created_at) and sorting the
// whole window for every page. Measured stable with and without statistics.
const WINDOW_BOUND_LIKELIHOOD = 0.5
function likelyWindowBound(term: string): string {
  return `likelihood(${term}, ${WINDOW_BOUND_LIKELIHOOD})`
}

// The key a row is filed under: its entity, else its table_name, else ''.
const ROW_KEY = "LOWER(COALESCE(NULLIF(TRIM(entity), ''), NULLIF(TRIM(table_name), ''), ''))"
const ROW_ACTION = "LOWER(COALESCE(action, ''))"

function sectionClause(sections: AuditSection[], params: Record<string, string | number>): string | null {
  if (!sections.length) return null
  const wanted = new Set<string>(sections)
  const entityKeys = Object.keys(AUDIT_ENTITY_SECTION).filter((key) => wanted.has(AUDIT_ENTITY_SECTION[key]))
  const actionKeys = Object.keys(AUDIT_KEYLESS_ACTION_SECTION).filter((key) => wanted.has(AUDIT_KEYLESS_ACTION_SECTION[key]))
  const parts: string[] = []
  if (entityKeys.length) {
    params.sectionKeys = JSON.stringify(entityKeys)
    parts.push(`${ROW_KEY} IN (SELECT value FROM json_each(@sectionKeys))`)
  }
  if (actionKeys.length) {
    params.sectionActions = JSON.stringify(actionKeys)
    parts.push(`(${ROW_KEY} = '' AND ${ROW_ACTION} IN (SELECT value FROM json_each(@sectionActions)))`)
  }
  if (wanted.has(AUDIT_OTHER_SECTION)) {
    params.knownKeys = JSON.stringify(Object.keys(AUDIT_ENTITY_SECTION))
    params.knownActions = JSON.stringify(Object.keys(AUDIT_KEYLESS_ACTION_SECTION))
    parts.push(`(${ROW_KEY} <> '' AND ${ROW_KEY} NOT IN (SELECT value FROM json_each(@knownKeys)))`)
    parts.push(`(${ROW_KEY} = '' AND ${ROW_ACTION} NOT IN (SELECT value FROM json_each(@knownActions)))`)
  }
  return parts.length ? `(${parts.join(' OR ')})` : null
}

const SEARCH_COLUMNS = [
  'user_name', 'action', "REPLACE(action, '_', ' ')", 'entity', 'table_name', 'details',
  // The changed-field text: what a row recorded before and after.
  'old_value', 'new_value', 'device_name',
  // ids are numeric-or-text depending on the writer -- CAST makes both searchable
  'CAST(entity_id AS TEXT)', 'CAST(record_id AS TEXT)',
]

export function buildAuditLogFilters(input: AuditLogFilterInput, omit: AuditLogFilterOmit = {}): AuditLogFilterClause {
  const clauses: string[] = []
  const params: Record<string, string | number> = {}

  const actions = splitMulti(input.action).map((value) => value.toLowerCase())
  if (actions.length) {
    const names = actions.map((value, index) => {
      params[`action${index}`] = value
      return `@action${index}`
    })
    clauses.push(`LOWER(COALESCE(action, '')) IN (${names.join(', ')})`)
  }

  const entities = splitMulti(input.entity).map((value) => value.toLowerCase())
  if (entities.length) {
    const names = entities.map((value, index) => {
      params[`entity${index}`] = value
      return `@entity${index}`
    })
    const list = names.join(', ')
    clauses.push(`(LOWER(COALESCE(entity, '')) IN (${list}) OR LOWER(COALESCE(table_name, '')) IN (${list}))`)
  }

  const entityId = String(input.entityId ?? '').trim()
  if (entityId) {
    params.entityId = entityId
    clauses.push('(CAST(entity_id AS TEXT) = @entityId OR CAST(record_id AS TEXT) = @entityId)')
  }

  if (Number.isInteger(input.lockedUserId) && Number(input.lockedUserId) > 0) {
    params.lockedUserId = Number(input.lockedUserId)
    clauses.push('user_id = @lockedUserId')
  } else if (!omit.user) {
    const userIds = splitMulti(input.userId)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
    if (userIds.length) {
      const names = userIds.map((value, index) => {
        params[`userId${index}`] = value
        return `@userId${index}`
      })
      clauses.push(`user_id IN (${names.join(', ')})`)
    }
  }

  if (!omit.section) {
    const sections = [...new Set(splitMulti(input.section).map((value) => value.toLowerCase()).filter(isAuditSection))]
    const clause = sectionClause(sections, params)
    if (clause) clauses.push(clause)
  }

  const cursor = omit.cursor ? null : decodeAuditCursor(input.cursor)
  const ascending = normalizeAuditOrder(input.order) === 'asc'
  // The cursor row is itself a tight bound on the walk direction, so it replaces
  // the window's date-only prefilter on that side. Two bounds on one column
  // leave the choice of which one seeks to the planner, and a wrong pick would
  // re-read every row between the window edge and the cursor on each page.
  if (isIsoDay(input.startDate)) {
    params.startDate = input.startDate
    clauses.push(`${localDateExpr('created_at')} >= @startDate`)
    if (!(cursor && ascending)) clauses.push(`${likelyWindowBound("created_at >= date(@startDate, '-1 day')")}`)
  }
  if (isIsoDay(input.endDate)) {
    params.endDate = input.endDate
    clauses.push(`${localDateExpr('created_at')} <= @endDate`)
    if (!(cursor && !ascending)) clauses.push(`${likelyWindowBound("created_at < date(@endDate, '+1 day')")}`)
  }

  const searchWords = String(input.search || '')
    .slice(0, AUDIT_MAX_SEARCH_LENGTH)
    .split(/\s+/)
    .map((word) => word.trim().slice(0, AUDIT_MAX_SEARCH_WORD_LENGTH))
    .filter(Boolean)
    .slice(0, AUDIT_MAX_SEARCH_WORDS)
  searchWords.forEach((word, index) => {
    params[`search${index}`] = `%${word.replace(/([\\%_])/g, '\\$1')}%`
    clauses.push(`(${SEARCH_COLUMNS.map((column) => `${column} LIKE @search${index} ESCAPE '\\'`).join(' OR ')})`)
  })

  if (cursor) {
    params.cursorCreatedAt = cursor.createdAt
    params.cursorId = cursor.id
    clauses.push(ascending ? 'created_at >= @cursorCreatedAt' : 'created_at <= @cursorCreatedAt')
    clauses.push(`(created_at, id) ${ascending ? '>' : '<'} (@cursorCreatedAt, @cursorId)`)
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  }
}
