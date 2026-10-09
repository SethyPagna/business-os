import type { QueryParams } from '../../../api/query.ts'

export class ReportExportError extends Error {
  readonly code: 'invalid' | 'empty' | 'large' | 'changed' | 'unavailable'
  constructor(code: ReportExportError['code']) { super(code); this.code = code }
}
function invalid(): never { throw new ReportExportError('invalid') }
export function record(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : invalid()
}
export function finite(raw: unknown): number { return typeof raw === 'number' && Number.isFinite(raw) ? raw : invalid() }
export function integer(raw: unknown, minimum = 0): number { const n = finite(raw); return Number.isSafeInteger(n) && n >= minimum ? n : invalid() }
export function timestamp(raw: unknown): number {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]([01]\d|2[0-3]):?[0-5]\d)?$/i.test(raw)) return invalid()
  const calendar = Date.parse(`${raw.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== raw.slice(0, 10)) return invalid()
  const normalized = raw.replace(' ', 'T')
  const value = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`)
  return Number.isFinite(value) ? value : invalid()
}

export interface CompletedReportExport<Row, Totals> { rows: Row[]; totals: Totals; rowCount: number; token: string; snapshot: number }
export async function collectReportExport<Row extends { id: number; cursor_at: string }, Totals>(
 query: QueryParams, fetchPage: (query: QueryParams) => Promise<unknown>, current: () => boolean,
 options: { queryKeys: readonly string[]; validateRow: (raw: unknown) => Row; validateTotals: (raw: unknown) => Totals; validatePair?: (row: Row, totals: Totals) => void },
): Promise<CompletedReportExport<Row, Totals>> {
  const frozen: QueryParams = {}
  for (const key of options.queryKeys) if (query[key] !== undefined) {
    const value = query[key]
    if (typeof value !== 'string' && typeof value !== 'number') return invalid()
    frozen[key] = value
  }
  const assertCurrent = () => { if (!current()) throw new ReportExportError('unavailable') }
  const fetch = async (params: QueryParams) => {
    assertCurrent()
    try {
      const raw = await fetchPage({ ...frozen, ...params, intent: 'export', order: 'desc', pageSize: 500 })
      assertCurrent()
      return record(raw)
    } catch (error) {
      assertCurrent()
      const e = error as { code?: unknown; status?: unknown }
      if (e.code === 'report_export_changed' || e.status === 409) throw new ReportExportError('changed')
      if (e.code === 'report_export_too_large' || e.status === 413) throw new ReportExportError('large')
      throw error
    }
  }
  const rows: Row[] = []
  const ids = new Set<number>()
  let token = '', snapshot = 0, count = 0, totals: Totals | null = null, totalsJson = ''
  let cursor: { created_at: string; id: number } | null = null
  let lastStamp = Infinity, lastId = Infinity
  for (let page = 0; page < 20; page++) {
    const response = await fetch(page ? { snapshotMaxId: snapshot, exportToken: token, afterCreatedAt: cursor!.created_at, afterId: cursor!.id } : {})
    if (response.export_version !== 1 || typeof response.export_token !== 'string' || !/^[a-f0-9]{64}$/.test(response.export_token)) return invalid()
    const pageSnapshot = integer(response.snapshot_max_id), pageCount = integer(response.row_count)
    if (pageCount > 10000) throw new ReportExportError('large')
    const pageTotals = options.validateTotals(response.totals)
    if (!page) {
      token = response.export_token; snapshot = pageSnapshot; count = pageCount; totals = pageTotals; totalsJson = JSON.stringify(pageTotals)
    } else if (token !== response.export_token || snapshot !== pageSnapshot || count !== pageCount || totalsJson !== JSON.stringify(pageTotals)) throw new ReportExportError('changed')
    if (!Array.isArray(response.rows) || response.rows.length > 500 || typeof response.has_more !== 'boolean') return invalid()
    if (!response.rows.length && (response.has_more || rows.length || count)) return invalid()
    for (const raw of response.rows) {
      const row = options.validateRow(raw)
      const stamp = timestamp(row.cursor_at)
      if (row.id > snapshot || ids.has(row.id) || stamp > lastStamp || (stamp === lastStamp && row.id >= lastId)) return invalid()
      options.validatePair?.(row, totals!)
      ids.add(row.id); rows.push(row); lastStamp = stamp; lastId = row.id
    }
    if (rows.length > count || rows.length > 10000) return invalid()
    if (response.has_more) {
      const next = record(response.next_cursor)
      const tail = response.rows[response.rows.length - 1] as Record<string, unknown>
      if (next.id !== tail.id || next.created_at !== tail.cursor_at || rows.length >= count) return invalid()
      cursor = { id: integer(next.id, 1), created_at: String(next.created_at) }
      if (page === 19) throw new ReportExportError('large')
      continue
    }
    if (response.next_cursor !== null || rows.length !== count) return invalid()
    if (!count) throw new ReportExportError('empty')
    const verification = await fetch({ snapshotMaxId: snapshot, exportToken: token, verifyOnly: 1 })
    if (verification.verified !== true || verification.export_version !== 1 || verification.export_token !== token
      || verification.snapshot_max_id !== snapshot || verification.row_count !== count) throw new ReportExportError('changed')
    assertCurrent()
    return { rows, totals: totals!, rowCount: count, token, snapshot }
  }
  throw new ReportExportError('large')
}
