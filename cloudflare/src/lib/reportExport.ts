import type { D1CompatPreparedStatement } from './db'
import { ReportExactDecimal, ReportMoneyPrecisionError } from './reportMoneyPrecision'

export function reportExportStamp(raw: string): number {
  return new Date(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`).getTime()
}

export async function reportExportToken(payload: unknown): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)))
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function parseReportExport(query: Record<string, string>, values: (key: string) => string[] | undefined) {
  const keys = ['startDate', 'endDate', 'branchId', 'status', 'paymentMethod', 'createdFrom', 'createdTo',
    'startTime', 'endTime', 'q', 'order', 'pageSize', 'snapshotMaxId', 'exportToken', 'afterCreatedAt', 'afterId', 'verifyOnly']
  const has = (key: string) => query[key] !== undefined
  const hasCursor = has('afterId') || has('afterCreatedAt')
  const hasToken = has('exportToken')
  const verifyOnly = query.verifyOnly === '1'
  const snapshotMaxId = has('snapshotMaxId') ? Number(query.snapshotMaxId) : null
  const afterId = Number(query.afterId)
  const afterStamp = reportExportStamp(String(query.afterCreatedAt || ''))
  if (keys.some((key) => (values(key)?.length || 0) > 1)
    || (has('order') && !['asc', 'desc'].includes(query.order))
    || (has('verifyOnly') && !verifyOnly)
    || (has('pageSize') && (!/^\d+$/.test(query.pageSize) || Number(query.pageSize) < 1 || Number(query.pageSize) > 500))
    || hasToken !== has('snapshotMaxId')
    || (hasToken && (!/^[a-f0-9]{64}$/.test(query.exportToken) || !/^\d+$/.test(query.snapshotMaxId)
      || !Number.isSafeInteger(snapshotMaxId) || Number(snapshotMaxId) < 0))
    || (hasCursor && (!hasToken || verifyOnly || !/^\d+$/.test(query.afterId || '') || !Number.isSafeInteger(afterId) || afterId < 1
      || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[zZ]|[+-]\d{2}:?\d{2})?$/.test(query.afterCreatedAt || '') || !Number.isFinite(afterStamp)))
    || (verifyOnly && !hasToken)) return null
  return { hasCursor, hasToken, verifyOnly, snapshotMaxId, afterId, afterStamp, limit: has('pageSize') ? Number(query.pageSize) : 500 }
}

export const RECORD_EXPORT_MAX_ROWS = 10_000
export const RECORD_EXPORT_MAX_BYTES = 4_000_000

export async function readRecordExport(
  db: { prepare(sql: string): D1CompatPreparedStatement },
  sql: string,
  params: Record<string, unknown>,
  columns: readonly string[],
): Promise<Record<string, unknown>[] | null> {
  const json = columns.map(column => `'${column}', ${column}`).join(', ')
  const result = await db.prepare(`WITH report_export_source AS MATERIALIZED (${sql} LIMIT ${RECORD_EXPORT_MAX_ROWS + 1}),
    report_export_encoded AS MATERIALIZED (SELECT json_object(${json}) AS payload FROM report_export_source),
    report_export_bound AS (SELECT COUNT(*) AS row_count, COALESCE(SUM(length(CAST(payload AS BLOB))), 0) AS payload_bytes FROM report_export_encoded)
    SELECT b.row_count, b.payload_bytes, e.payload FROM report_export_bound b LEFT JOIN report_export_encoded e
      ON b.row_count <= ${RECORD_EXPORT_MAX_ROWS} AND b.payload_bytes <= ${RECORD_EXPORT_MAX_BYTES}`)
    .all<{ row_count: number; payload_bytes: number; payload: string | null }>(params)
  const bound = result[0]
  if (!bound || bound.row_count > RECORD_EXPORT_MAX_ROWS || bound.payload_bytes > RECORD_EXPORT_MAX_BYTES) return null
  return result.flatMap(row => {
    if (row.payload === null) return []
    const value = JSON.parse(row.payload) as Record<string, unknown>
    if (!Number.isSafeInteger(value.id) || Number(value.id) < 1 || typeof value.cursor_at !== 'string'
      || !Number.isFinite(reportExportStamp(value.cursor_at))) throw new ReportMoneyPrecisionError('unsupported_row')
    return [value]
  })
}

export function recordExportTotals(kind: 'returns' | 'expenses', rows: readonly Record<string, unknown>[]) {
  const total = (key: string, places: number) => rows.reduce((sum, row) => sum.add(ReportExactDecimal.recorded((row[key] ?? 0) as string | number)),
    ReportExactDecimal.zero()).toNumber(places)
  return kind === 'returns' ? { count: rows.length, refund_usd: total('refund_usd', 2) }
    : { count: rows.length, amount_usd: total('amount_usd', 2), amount_khr: total('amount_khr', 0) }
}
