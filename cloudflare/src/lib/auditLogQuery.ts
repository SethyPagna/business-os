// WHERE-clause builder for GET /system/audit-logs (I2).
//
// Exists because the Audit Log page's filter controls were DEAD: AuditLog.tsx
// has been sending search/action/userId/startDate/endDate since the filters
// were built, and the endpoint read only page/pageSize -- with no client-side
// filtering either, every filter silently did nothing. This module is the
// server half, kept pure (no db, no Hono) so test-audit-log-filters-pure.cjs
// can run the exact production clause against a real SQLite audit_logs.
//
// Contract with the page's FilterMenu: `action`, `entity` and `userId` are
// COMMA-SEPARATED multi-values (toggleMultiValue joins selections with ','),
// matched case-insensitively; `entity` matches either the `entity` or the
// legacy `table_name` column; dates are inclusive YYYY-MM-DD against the LOCAL
// (UTC+7 / Cambodia) calendar date of the stored-UTC created_at -- server
// truth, deliberately not the device-supplied client_time, but bucketed in the
// fixed business timezone so a 00:30-local event filters onto its local day
// (see businessDateWindow.ts). audit_logs has no created_at index, so this stays
// a column-wrapping date() (no sargable rewrite is possible or worth it here).
// Search is a LIKE over the human-searchable columns with %/_ escaped, so a
// literal "100%" in a details payload is findable as typed.

import { localDateExpr } from './businessDateWindow'

export type AuditLogFilterInput = {
  search?: string
  action?: string
  entity?: string
  userId?: string
  startDate?: string
  endDate?: string
}

export type AuditLogFilterClause = {
  // '' when unfiltered, otherwise 'WHERE ...' -- append verbatim.
  where: string
  params: Record<string, string | number>
}

function splitMulti(raw: string | undefined): string[] {
  return String(raw || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function isIsoDay(value: string | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function buildAuditLogFilters(input: AuditLogFilterInput): AuditLogFilterClause {
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

  if (isIsoDay(input.startDate)) {
    params.startDate = input.startDate
    clauses.push(`${localDateExpr('created_at')} >= @startDate`)
  }
  if (isIsoDay(input.endDate)) {
    params.endDate = input.endDate
    clauses.push(`${localDateExpr('created_at')} <= @endDate`)
  }

  const searchTerm = String(input.search || '').trim()
  if (searchTerm) {
    params.search = `%${searchTerm.replace(/([\\%_])/g, '\\$1')}%`
    clauses.push(
      '('
      + [
        'user_name', 'action', 'entity', 'table_name', 'details', 'device_name',
        // ids are numeric-or-text depending on the writer -- CAST makes both searchable
        'CAST(entity_id AS TEXT)', 'CAST(record_id AS TEXT)',
      ].map((column) => `${column} LIKE @search ESCAPE '\\'`).join(' OR ')
      + ')',
    )
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  }
}
