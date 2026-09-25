import type { QueryParams } from '../../../api/query.ts'
import type { SaleRow } from './SalesListReport.tsx'
import type { ReportColumn } from './ReportTable.tsx'
import type { TypedWorksheetInput } from '../../../utils/xlsxExport.ts'
import { fmtDateOnly, fmtDateTime24 } from '../../../utils/formatters.ts'

const MONEY = ['gross_sales_usd', 'store_discount_usd', 'membership_discount_usd', 'tax_usd', 'delivery_usd', 'refund_usd', 'net_revenue_usd', 'pending_revenue_usd', 'collected_total_usd'] as const
const TEXT = ['receipt_number', 'date', 'business_date', 'branch', 'cashier', 'customer', 'customer_phone', 'payment_method', 'status'] as const
const COST = ['cost_usd', 'cost_before_floor_usd', 'gross_profit_usd', 'cost_missing_snapshot_lines'] as const
const QUERY_KEYS = ['startDate', 'endDate', 'branchId', 'createdFrom', 'createdTo', 'startTime', 'endTime', 'status', 'paymentMethod', 'q']
export class SalesExportError extends Error {
  readonly code: 'invalid' | 'empty' | 'large' | 'changed' | 'unavailable'
  constructor(code: SalesExportError['code']) { super(code); this.code = code }
}
function invalid(): never { throw new SalesExportError('invalid') }
function record(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : invalid()
}
function finite(raw: unknown): number { return typeof raw === 'number' && Number.isFinite(raw) ? raw : invalid() }
function integer(raw: unknown, minimum = 0): number { const n = finite(raw); return Number.isSafeInteger(n) && n >= minimum ? n : invalid() }
function timestamp(raw: unknown): number {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]([01]\d|2[0-3]):?[0-5]\d)?$/i.test(raw)) return invalid()
  const calendar = Date.parse(`${raw.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== raw.slice(0, 10)) return invalid()
  const normalized = raw.replace(' ', 'T')
  const value = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`)
  return Number.isFinite(value) ? value : invalid()
}
export function validateExportSale(raw: unknown): SaleRow & { cursor_at: string } {
  const input = record(raw)
  const row = { id: integer(input.id, 1) } as SaleRow & { cursor_at: string }
  for (const key of TEXT) {
    if (typeof input[key] !== 'string') return invalid()
    row[key] = input[key]
  }
  timestamp(row.date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.business_date) || !Number.isFinite(Date.parse(`${row.business_date}T00:00:00Z`))
    || new Date(`${row.business_date}T00:00:00Z`).toISOString().slice(0, 10) !== row.business_date) return invalid()
  timestamp(input.cursor_at)
  row.cursor_at = input.cursor_at as string
  for (const key of MONEY) row[key] = finite(input[key])
  const costPresent = COST.some(key => Object.hasOwn(input, key))
  if (costPresent) for (const key of COST) row[key] = key === 'cost_missing_snapshot_lines' ? integer(input[key]) : finite(input[key])
  return row
}
/** Deliberate kernel-to-table mapping. No total is re-added from receipt rows. */
export function mapExportTotals(raw: unknown): SaleRow {
  const input = record(raw)
  const output = Object.fromEntries(TEXT.map(key => [key, ''])) as unknown as SaleRow
  output.id = 0
  for (const key of MONEY) output[key] = finite(input[key === 'net_revenue_usd' ? 'revenue_usd' : key])
  if (Object.hasOwn(input, 'cost_usd') || Object.hasOwn(input, 'profit_usd')) {
    output.cost_usd = finite(input.cost_usd)
    output.gross_profit_usd = finite(input.profit_usd)
    if (Object.hasOwn(input, 'money_unknown_cost_lines')) output.cost_missing_snapshot_lines = integer(input.money_unknown_cost_lines)
  }
  return output
}
export interface CompletedSalesExport {
  rows: SaleRow[]
  totals: SaleRow
  rowCount: number
  token: string
  snapshot: number
}
export async function collectSalesExport(
  query: QueryParams, fetchPage: (query: QueryParams) => Promise<unknown>, current: () => boolean,
): Promise<CompletedSalesExport> {
  const frozen: QueryParams = {}
  for (const key of QUERY_KEYS) if (query[key] !== undefined) {
    const value = query[key]
    if (typeof value !== 'string' && typeof value !== 'number') return invalid()
    frozen[key] = value
  }
  const assertCurrent = () => { if (!current()) throw new SalesExportError('unavailable') }
  const fetch = async (params: QueryParams) => {
    assertCurrent()
    try {
      const raw = await fetchPage({ ...frozen, ...params, intent: 'export', order: 'desc', pageSize: 500 })
      assertCurrent()
      return record(raw)
    } catch (error) {
      assertCurrent()
      const e = error as { code?: unknown; status?: unknown }
      if (e.code === 'report_export_changed' || e.status === 409) throw new SalesExportError('changed')
      if (e.code === 'report_export_too_large' || e.status === 413) throw new SalesExportError('large')
      throw error
    }
  }
  const rows: SaleRow[] = []
  const ids = new Set<number>()
  let token = '', snapshot = 0, count = 0, totals: SaleRow | null = null, totalsJson = ''
  let cursor: { created_at: string; id: number } | null = null
  let lastStamp = Infinity, lastId = Infinity
  for (let page = 0; page < 20; page++) {
    const response = await fetch(page ? { snapshotMaxId: snapshot, exportToken: token, afterCreatedAt: cursor!.created_at, afterId: cursor!.id } : {})
    if (response.export_version !== 1 || typeof response.export_token !== 'string' || !/^[a-f0-9]{64}$/.test(response.export_token)) return invalid()
    const pageSnapshot = integer(response.snapshot_max_id), pageCount = integer(response.row_count)
    if (pageCount > 10000) throw new SalesExportError('large')
    const pageTotals = mapExportTotals(response.totals)
    if (!page) {
      token = response.export_token; snapshot = pageSnapshot; count = pageCount; totals = pageTotals; totalsJson = JSON.stringify(pageTotals)
    } else if (token !== response.export_token || snapshot !== pageSnapshot || count !== pageCount || totalsJson !== JSON.stringify(pageTotals)) throw new SalesExportError('changed')
    if (!Array.isArray(response.rows) || response.rows.length > 500 || typeof response.has_more !== 'boolean') return invalid()
    if (!response.rows.length && (response.has_more || rows.length || count)) return invalid()
    for (const raw of response.rows) {
      const row = validateExportSale(raw)
      const stamp = timestamp(row.cursor_at)
      if (row.id > snapshot || ids.has(row.id) || stamp > lastStamp || (stamp === lastStamp && row.id >= lastId)) return invalid()
      if (Object.hasOwn(row, 'cost_usd') !== Object.hasOwn(totals!, 'cost_usd')) return invalid()
      ids.add(row.id); rows.push(row); lastStamp = stamp; lastId = row.id
    }
    if (rows.length > count || rows.length > 10000) return invalid()
    if (response.has_more) {
      const next = record(response.next_cursor)
      const tail = response.rows[response.rows.length - 1] as Record<string, unknown>
      if (next.id !== tail.id || next.created_at !== tail.cursor_at || rows.length >= count) return invalid()
      cursor = { id: integer(next.id, 1), created_at: String(next.created_at) }
      if (page === 19) throw new SalesExportError('large')
      continue
    }
    if (response.next_cursor !== null || rows.length !== count) return invalid()
    if (!count) throw new SalesExportError('empty')
    const verification = await fetch({ snapshotMaxId: snapshot, exportToken: token, verifyOnly: 1 })
    if (verification.verified !== true || verification.export_version !== 1 || verification.export_token !== token
      || verification.snapshot_max_id !== snapshot || verification.row_count !== count) throw new SalesExportError('changed')
    assertCurrent()
    return { rows, totals: totals!, rowCount: count, token, snapshot }
  }
  throw new SalesExportError('large')
}

export interface SalesExportDocument extends CompletedSalesExport {
  columns: Array<ReportColumn<SaleRow>>
  title: string
  subtitle: string
  language: string
  metadata: string[]
  filename: string
  fmtMoney: (usd: number) => string
}
export function saleExportObjects(document: SalesExportDocument, display = false): Array<Record<string, unknown>> {
  return [...document.rows, document.totals].map(row => Object.fromEntries(document.columns.map(column => {
    const raw = column.value(row)
    const value = !display || raw == null || raw === '' ? raw
      : column.kind === 'money' ? document.fmtMoney(Number(raw))
        : column.kind === 'datetime' ? fmtDateTime24(String(raw))
          : column.kind === 'date' ? fmtDateOnly(raw)
            : column.kind === 'pct' ? `${Number(raw).toFixed(2)}%` : raw
    return [display ? column.label : column.key, value]
  })))
}
export function saleExportWorksheet(document: SalesExportDocument): TypedWorksheetInput {
  const objects = saleExportObjects(document)
  return { sheetName: document.title, columns: document.columns.map(column => ({ key: column.key,
    label: column.kind === 'money' ? `${column.label} (USD)` : column.label, kind: column.kind || 'text' })),
    rows: objects.slice(0, -1), totals: objects[objects.length - 1],
    metadata: [document.title, document.subtitle, ...document.metadata, 'USD'] }
}
export function saleExportPrint(document: SalesExportDocument) {
  const objects = saleExportObjects(document, true)
  return { title: document.title, subtitle: document.subtitle, language: document.language, metadata: document.metadata,
    headers: document.columns.map(column => column.label), rows: objects.slice(0, -1), totals: objects[objects.length - 1],
    numericHeaders: document.columns.filter(column => ['money', 'qty', 'int', 'pct'].includes(column.kind || '')).map(column => column.label), landscape: true }
}
