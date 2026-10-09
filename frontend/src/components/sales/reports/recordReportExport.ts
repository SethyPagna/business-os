import type { QueryParams } from '../../../api/query.ts'
import type { ReturnRow } from './ReturnsReport.tsx'
import type { ExpenseRow } from './ExpensesReport.tsx'
import type { ReportColumn } from './ReportTable.tsx'
import type { TypedWorksheetInput } from '../../../utils/xlsxExport.ts'
import { actualUsdValue, actualKhrValue } from '../../../utils/financialPrecision.ts'
import { subtractDecimalSum, MAX_MONEY_ABS } from '../../../utils/moneyPrecision.ts'
import { fmtDateOnly, fmtDateTime24 } from '../../../utils/formatters.ts'
import { collectReportExport, record, finite, integer, timestamp, ReportExportError, type CompletedReportExport } from './reportExportCollection.ts'

export type RecordExportKind = 'returns' | 'expenses'
export type RecordExportRow = ReturnRow | ExpenseRow
export type RecordExportTotals = { count: number; refund_usd?: number; amount_usd?: number; amount_khr?: number }
export type CompletedRecordExport = CompletedReportExport<RecordExportRow, RecordExportTotals>
const QUERY_KEYS = ['startDate', 'endDate', 'branchId', 'createdFrom', 'createdTo', 'startTime', 'endTime', 'status', 'paymentMethod', 'scope']
const RETURN_TEXT = ['return_number', 'date', 'business_date', 'sale_receipt_number', 'party', 'scope', 'type', 'reason', 'status']
const EXPENSE_TEXT = ['date', 'created_at', 'type', 'label', 'branch', 'linked_sale_receipt_number', 'notes']
function invalid(): never { throw new ReportExportError('invalid') }
function date(value: unknown) { timestamp(`${value}T00:00:00Z`); if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid() }
function visibleTimestamp(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:[T ]([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]([01]\d|2[0-3]):?[0-5]\d)?)?$/i.test(value)) invalid()
  const normalized = value.length === 10 ? `${value}T00:00:00Z`
    : value.replace(/([T ]\d{2}:\d{2})(?=Z|[+-]\d{2}:?\d{2}$|$)/i, '$1:00')
  timestamp(normalized)
  return normalized
}
export function validateRecordExportRow(kind: RecordExportKind, raw: unknown): RecordExportRow & { cursor_at: string } {
  const input = record(raw), output: Record<string, unknown> = { id: integer(input.id, 1) }
  for (const key of kind === 'returns' ? RETURN_TEXT : EXPENSE_TEXT) {
    if (input[key] !== null && typeof input[key] !== 'string') invalid()
    output[key] = input[key] ?? ''
  }
  timestamp(input.cursor_at); output.cursor_at = input.cursor_at
  if (kind === 'returns') { visibleTimestamp(output.date); date(output.business_date); output.scope ||= 'customer' }
  else { date(output.date); visibleTimestamp(output.created_at) }
  for (const key of kind === 'returns' ? ['refund_usd'] : ['amount_usd', 'amount_khr']) {
    output[key] = input[key] === null ? 0 : finite(input[key])
    if (Math.abs(output[key] as number) > MAX_MONEY_ABS) invalid()
  }
  return output as unknown as RecordExportRow & { cursor_at: string }
}
export function validateRecordExportTotals(kind: RecordExportKind, raw: unknown): RecordExportTotals {
  const input = record(raw), output: RecordExportTotals = { count: integer(input.count) }
  for (const key of kind === 'returns' ? ['refund_usd'] as const : ['amount_usd', 'amount_khr'] as const) output[key] = finite(input[key])
  return output
}
function exactTotal(values: number[], khr = false): number {
  const negative = subtractDecimalSum(0, values)
  const value = -(khr ? actualKhrValue(negative) : actualUsdValue(negative)) || 0
  if (Math.abs(value) > MAX_MONEY_ABS) invalid()
  return value
}
export function recordExportTotals(kind: RecordExportKind, rows: RecordExportRow[]): RecordExportTotals {
  return kind === 'returns' ? { count: rows.length, refund_usd: exactTotal((rows as ReturnRow[]).map(row => row.refund_usd)) }
    : { count: rows.length, amount_usd: exactTotal((rows as ExpenseRow[]).map(row => row.amount_usd)), amount_khr: exactTotal((rows as ExpenseRow[]).map(row => row.amount_khr), true) }
}
export async function collectRecordExport(kind: RecordExportKind, query: QueryParams, fetchPage: (query: QueryParams) => Promise<unknown>, current: () => boolean): Promise<CompletedRecordExport> {
  return collectReportExport(query, fetchPage, current, { queryKeys: QUERY_KEYS, validateRow: raw => validateRecordExportRow(kind, raw), validateTotals: raw => validateRecordExportTotals(kind, raw) })
}
export function selectRecordExport(kind: RecordExportKind, result: CompletedRecordExport, predicate: (row: RecordExportRow) => boolean): CompletedRecordExport {
  const rows = result.rows.filter(predicate)
  if (!rows.length) throw new ReportExportError('empty')
  return { ...result, rows, rowCount: rows.length, totals: recordExportTotals(kind, rows) }
}
export interface RecordExportDocument extends Omit<CompletedRecordExport, 'totals'> {
  totals: RecordExportRow; columns: Array<ReportColumn<RecordExportRow>>; title: string; subtitle: string; language: string;
  metadata: string[]; filename: string; fmtMoney: (usd: number, khr?: number) => string
}
export function recordExportObjects(document: RecordExportDocument, display = false): Array<Record<string, unknown>> {
  return [...document.rows, document.totals].map(row => Object.fromEntries(document.columns.map(column => {
    const raw = column.value(row)
    const value = !display || raw == null || raw === '' ? raw : column.kind === 'money' ? document.fmtMoney(Number(raw), column.khr?.(row))
      : column.kind === 'datetime' ? fmtDateTime24(String(raw)) : column.kind === 'date' ? fmtDateOnly(raw) : raw
    return [display ? column.label : column.key, value]
  })))
}
export function recordExportWorksheet(document: RecordExportDocument): TypedWorksheetInput {
  const columns = document.columns.flatMap(column => column.khr ? [
    { key: `${column.key}_usd`, label: `${column.label} (USD)`, kind: 'money' as const },
    { key: `${column.key}_khr`, label: `${column.label} (KHR)`, kind: 'int' as const },
  ] : [{ key: column.key, label: column.kind === 'money' ? `${column.label} (USD)` : column.label, kind: column.kind || 'text' }])
  const rows = [...document.rows, document.totals].map(row => Object.fromEntries(document.columns.flatMap(column => column.khr
    ? [[`${column.key}_usd`, column.value(row)], [`${column.key}_khr`, column.khr(row)]]
    : [[column.key, column.kind === 'datetime' ? visibleTimestamp(column.value(row)) : column.value(row)]])))
  return { sheetName: document.title, columns, rows: rows.slice(0, -1), totals: rows.at(-1), metadata: [document.title, document.subtitle, ...document.metadata] }
}
export function recordExportPrint(document: RecordExportDocument) {
  const rows = recordExportObjects(document, true)
  return { title: document.title, subtitle: document.subtitle, language: document.language, metadata: document.metadata,
    headers: document.columns.map(column => column.label), rows: rows.slice(0, -1), totals: rows.at(-1),
    numericHeaders: document.columns.filter(column => ['money', 'int', 'qty', 'pct'].includes(column.kind || '')).map(column => column.label), landscape: true }
}
