import type { QueryParams } from '../../../api/query.ts'
import type { SaleRow } from './SalesListReport.tsx'
import type { ReportColumn } from './ReportTable.tsx'
import type { TypedWorksheetInput } from '../../../utils/xlsxExport.ts'
import { fmtDateOnly, fmtDateTime24 } from '../../../utils/formatters.ts'

const MONEY = ['gross_sales_usd', 'store_discount_usd', 'membership_discount_usd', 'tax_usd', 'delivery_usd', 'refund_usd', 'net_revenue_usd', 'pending_revenue_usd', 'collected_total_usd'] as const
const TEXT = ['receipt_number', 'date', 'business_date', 'branch', 'cashier', 'customer', 'customer_phone', 'payment_method', 'status'] as const
const COST = ['cost_usd', 'cost_before_floor_usd', 'gross_profit_usd', 'cost_missing_snapshot_lines'] as const
const QUERY_KEYS = ['startDate', 'endDate', 'branchId', 'createdFrom', 'createdTo', 'startTime', 'endTime', 'status', 'paymentMethod', 'q']
import { collectReportExport, ReportExportError as SalesExportError, record, finite, nullableFinite, integer, timestamp } from './reportExportCollection.ts'
import { costStateOf, type CostState } from './reportModel.ts'
export { ReportExportError as SalesExportError } from './reportExportCollection.ts'
function invalid(): never { throw new SalesExportError('invalid') }
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
  if (costPresent) {
    for (const key of COST) row[key] = key === 'cost_missing_snapshot_lines' ? integer(input[key]) : nullableFinite(input[key]) ?? 0
    const state = costStateOf({ cost_usd: nullableFinite(input.cost_usd), cost_missing_snapshot_lines: input.cost_missing_snapshot_lines })
    row.cost_state = input.gross_profit_usd === null && state?.coverage !== 'unknown' ? { coverage: 'unknown', count: Math.max(1, row.cost_missing_snapshot_lines ?? 0) } : state ?? undefined
  }
  // L4: a cost viewer's receipt profit is goods only, and the export says so.
  if (costPresent && input.profit_excludes_delivery === true) row.profit_excludes_delivery = true
  return row
}
/** Deliberate kernel-to-table mapping. No total is re-added from receipt rows. */
export function mapExportTotals(raw: unknown): SaleRow {
  const input = record(raw)
  const output = Object.fromEntries(TEXT.map(key => [key, ''])) as unknown as SaleRow
  output.id = 0
  for (const key of MONEY) output[key] = finite(input[key === 'net_revenue_usd' ? 'revenue_usd' : key])
  if (Object.hasOwn(input, 'cost_usd') || Object.hasOwn(input, 'profit_usd')) {
    output.cost_usd = nullableFinite(input.cost_usd) ?? 0
    output.gross_profit_usd = nullableFinite(input.profit_usd) ?? 0
    if (input.profit_excludes_delivery === true) output.profit_excludes_delivery = true
    const missingKey = Object.hasOwn(input, 'cost_missing_snapshot_lines') ? 'cost_missing_snapshot_lines' : 'money_unknown_cost_lines'
    if (Object.hasOwn(input, missingKey)) output.cost_missing_snapshot_lines = integer(input[missingKey])
    const known = Object.hasOwn(input, 'cost_known_lines') ? integer(input.cost_known_lines) : undefined
    const state: CostState | null = costStateOf({ cost_usd: nullableFinite(input.cost_usd), cost_missing_snapshot_lines: output.cost_missing_snapshot_lines, cost_known_lines: known })
    output.cost_state = input.profit_usd === null && state?.coverage !== 'unknown' ? { coverage: 'unknown', count: Math.max(1, output.cost_missing_snapshot_lines ?? 0) } : state ?? undefined
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
 return collectReportExport(query, fetchPage, current, { queryKeys: QUERY_KEYS, validateRow: validateExportSale, validateTotals: mapExportTotals,
  validatePair: (row, totals) => { if (Object.hasOwn(row, 'cost_usd') !== Object.hasOwn(totals, 'cost_usd')) invalid() } })
}

export interface SalesExportDocument extends CompletedSalesExport {
  columns: Array<ReportColumn<SaleRow>>
  title: string
  subtitle: string
  language: string
  metadata: string[]
  filename: string
  fmtMoney: (usd: number) => string
  /** Printed in place of an unknown cost; the CSV leaves the cell blank. */
  unknownLabel?: string
}
export function saleExportObjects(document: SalesExportDocument, display = false, unknown: 'blank' | 'label' = 'blank'): Array<Record<string, unknown>> {
  return [...document.rows, document.totals].map(row => Object.fromEntries(document.columns.map(column => {
    const raw = column.value(row)
    if (column.cost?.(row)?.coverage === 'unknown') return [display ? column.label : column.key, !display ? null : unknown === 'label' ? document.unknownLabel ?? 'Unknown cost' : '']
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
  const objects = saleExportObjects(document, true, 'label')
  return { title: document.title, subtitle: document.subtitle, language: document.language, metadata: document.metadata,
    headers: document.columns.map(column => column.label), rows: objects.slice(0, -1), totals: objects[objects.length - 1],
    numericHeaders: document.columns.filter(column => ['money', 'qty', 'int', 'pct'].includes(column.kind || '')).map(column => column.label), landscape: true }
}
