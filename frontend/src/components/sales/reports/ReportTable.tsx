// ReportTable -- ONE data presenter for every Reports view. Two styles of
// the same columns/rows (user, Part 581: "multiple view, excel style, do
// receipt style for mobile"):
//   - 'excel'   -> kit DenseTable (sticky header, sortable columns, zebra
//                  rows, a totals row) with the shared ColumnChooser so a
//                  large screen reveals the optional columns
//                  (useColumnPreferences remembers them per view);
//   - 'receipt' -> ReceiptSheet, one block per row, the primary column as
//                  the block title and every visible column as a line.
// Cell formatting is driven by the column `kind`, so a money column reads
// through the display-currency-aware fmtMoney in BOTH styles and in CSV.
import { useMemo, type ReactNode } from 'react'
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import Inbox from 'lucide-react/dist/esm/icons/inbox.js'
import ColumnChooser from '../../shared/ColumnChooser.tsx'
import { useColumnPreferences } from '../../shared/useColumnPreferences.ts'
import type { TableColumnDef } from '../../shared/columnPreferences.ts'
import { DenseTable, EmptyState, Skeleton } from '../../shared/kit'
import { fmtDateOnly, fmtDateTime24 } from '../../../utils/formatters.ts'
import ReceiptSheet, { type ReceiptBlock, type ReceiptLine, type ReceiptLineKind } from './ReceiptSheet.tsx'
import { fmtInt, fmtPct, fmtQty, num, sortRows, toggleSort, type CsvColumn, type ReportStyle, type SortState } from './reportModel.ts'

export type ReportCellKind = 'text' | 'money' | 'int' | 'qty' | 'pct' | 'date' | 'datetime'

export interface ReportColumn<Row> {
  key: string
  /** Already translated. */
  label: string
  kind?: ReportCellKind
  /** Hidden until revealed through the column chooser. */
  defaultVisible?: boolean
  /** The receipt block title / the first spreadsheet column. */
  primary?: boolean
  /** Raw value: drives sorting, CSV and the default rendering. */
  value: (row: Row) => string | number | null | undefined
  /** Second-currency raw amount for dual-currency money (fees, returns). */
  khr?: (row: Row) => number
  /** Display override (badges, links). CSV still uses `value`. */
  render?: (row: Row) => ReactNode
  /** Bold the cell (the basis column). */
  emphasis?: boolean
  /** Default sort direction when the header is first clicked. */
  sortDir?: 'asc' | 'desc'
}

export interface ReportTableLabels {
  columns: string
  reset: string
  total: string
  empty: string
  emptyText?: string
}

export interface ReportTableProps<Row> {
  /** Column-preference storage key, one per view (bos_table_columns_<key>). */
  surfaceKey: string
  columns: Array<ReportColumn<Row>>
  rows: Row[]
  rowKey: (row: Row) => string
  style: ReportStyle
  fmtMoney: (usd: number, khr?: number) => string
  labels: ReportTableLabels
  loading?: boolean
  totalsRow?: Row | null
  sort?: SortState | null
  onSortChange?: (next: SortState) => void
  onRowClick?: (row: Row, el: HTMLElement) => void
  selectedKey?: string | null
  /** Rendered under the rows (Load more, counts). */
  footer?: ReactNode
  /** In-card scroll height for the spreadsheet style (kept compact per the dashboard-card rule). */
  maxHeight?: string
  className?: string
}

export function formatCell<Row>(column: ReportColumn<Row>, row: Row, fmtMoney: (usd: number, khr?: number) => string): ReactNode {
  if (column.render) return column.render(row)
  const raw = column.value(row)
  switch (column.kind) {
    case 'money':
      return fmtMoney(num(raw), column.khr ? column.khr(row) : undefined)
    case 'int':
      return fmtInt(num(raw))
    case 'qty':
      return fmtQty(num(raw))
    case 'pct':
      return fmtPct(raw == null || raw === '' ? null : num(raw))
    case 'date':
      return raw ? fmtDateOnly(raw) : '—'
    case 'datetime':
      return raw ? fmtDateTime24(String(raw)) : '—'
    default:
      return raw == null || raw === '' ? '—' : String(raw)
  }
}

function isNumericKind(kind: ReportCellKind | undefined): boolean {
  return kind === 'money' || kind === 'int' || kind === 'qty' || kind === 'pct'
}

function isCountKind(kind: ReportCellKind | undefined): boolean {
  return kind === 'int' || kind === 'qty'
}

// Receipt cards read in the order the owner's old-POS reference cards do
// (Sep 5 2026, screenshots #6 / #10: one entity = one card, money block
// first, the headline total closing it, then the counts in muted text, then
// any detail). The column order stays the spreadsheet order; only the card
// reorders, so the two styles keep the same columns and the same numbers.
export function orderReceiptColumns<T>(columns: Array<ReportColumn<T>>): Array<ReportColumn<T>> {
  const money = columns.filter((c) => !c.emphasis && (c.kind === 'money' || c.kind === 'pct'))
  const totals = columns.filter((c) => c.emphasis)
  const counts = columns.filter((c) => !c.emphasis && isCountKind(c.kind))
  const detail = columns.filter((c) => !c.emphasis && !isNumericKind(c.kind))
  return [...money, ...totals, ...counts, ...detail]
}

export function receiptLineKind<T>(column: ReportColumn<T>): ReceiptLineKind | undefined {
  if (column.emphasis) return 'total'
  if (isCountKind(column.kind)) return 'muted'
  if (isNumericKind(column.kind)) return undefined
  return 'info'
}

/** CSV columns for the visible set (or all), values formatted the same way the table shows them, money as plain numbers. */
export function csvColumnsFor<Row>(columns: Array<ReportColumn<Row>>, fmtMoney: (usd: number, khr?: number) => string): Array<CsvColumn<Row>> {
  return columns.map((c) => ({
    header: c.label,
    value: (row: Row) => {
      const raw = c.value(row)
      if (c.kind === 'money') {
        const khr = c.khr ? c.khr(row) : 0
        return khr ? fmtMoney(num(raw), khr) : num(raw)
      }
      if (c.kind === 'date') return raw ? fmtDateOnly(raw) : ''
      if (c.kind === 'datetime') return raw ? fmtDateTime24(String(raw)) : ''
      return raw ?? ''
    },
  }))
}

export default function ReportTable<Row>({
  surfaceKey,
  columns,
  rows,
  rowKey,
  style,
  fmtMoney,
  labels,
  loading = false,
  totalsRow = null,
  sort = null,
  onSortChange,
  onRowClick,
  selectedKey = null,
  footer,
  maxHeight,
  className = '',
}: ReportTableProps<Row>) {
  const columnDefs = useMemo<TableColumnDef[]>(() => columns.map((c) => ({ key: c.key, label: c.label, defaultVisible: c.defaultVisible !== false })), [columns])
  const prefs = useColumnPreferences(surfaceKey, columnDefs)
  const visibleColumns = useMemo(() => columns.filter((c) => c.primary || prefs.isVisible(c.key)), [columns, prefs])
  const hasOptional = columns.some((c) => !c.primary)

  const sortedRows = useMemo(() => {
    if (!sort) return rows
    const column = columns.find((c) => c.key === sort.key)
    if (!column) return rows
    return sortRows(rows, column.value, sort.dir)
  }, [rows, columns, sort])

  if (loading && rows.length === 0) {
    return <Skeleton rows={6} variant={style === 'receipt' ? 'cards' : 'table'} className={className} />
  }
  if (!loading && rows.length === 0) {
    return <EmptyState icon={<Inbox className="h-5 w-5" />} title={labels.empty} text={labels.emptyText} className={className} />
  }

  if (style === 'receipt') {
    const primary = columns.find((c) => c.primary) || columns[0]
    const lineColumns = orderReceiptColumns(visibleColumns.filter((c) => c !== primary))
    const blocks: ReceiptBlock[] = sortedRows.map((row) => {
      const key = rowKey(row)
      const lines: ReceiptLine[] = lineColumns.map((c) => ({
        key: c.key,
        label: c.label,
        value: formatCell(c, row, fmtMoney),
        kind: receiptLineKind(c),
      }))
      return {
        key,
        title: formatCell(primary, row, fmtMoney),
        lines,
        onClick: onRowClick ? (el) => onRowClick(row, el) : undefined,
        selected: selectedKey != null && selectedKey === key,
      }
    })
    if (totalsRow) {
      blocks.push({
        key: '__totals',
        title: labels.total,
        lines: lineColumns.filter((c) => isNumericKind(c.kind)).map((c) => ({ key: c.key, label: c.label, value: formatCell(c, totalsRow, fmtMoney), kind: receiptLineKind(c) })),
      })
    }
    return (
      <div className={className}>
        {hasOptional ? (
          <div className="mb-1.5 flex justify-end">
            <ColumnChooser columns={columnDefs.filter((c) => !columns.find((col) => col.key === c.key)?.primary)} isVisible={prefs.isVisible} toggle={prefs.toggle} reset={prefs.reset} label={labels.columns} resetLabel={labels.reset} />
          </div>
        ) : null}
        <ReceiptSheet blocks={blocks} />
        {footer ? <div className="mt-2">{footer}</div> : null}
      </div>
    )
  }

  const headerCell = (c: ReportColumn<Row>) => {
    const active = sort?.key === c.key
    const numeric = isNumericKind(c.kind)
    const content = (
      <span className={['inline-flex items-center gap-0.5', numeric ? 'justify-end' : ''].join(' ').trim()}>
        {c.label}
        {active ? (sort?.dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : null}
      </span>
    )
    return (
      <th key={c.key} className={[numeric ? '!text-right' : '', 'whitespace-nowrap'].join(' ').trim()} aria-sort={active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
        {onSortChange ? (
          <button type="button" className="h-[var(--ui-row-h)] w-full cursor-pointer text-inherit hover:text-[var(--ui-ink)]" style={{ textAlign: numeric ? 'right' : 'left' }} onClick={() => onSortChange(toggleSort(sort, c.key, c.sortDir || (numeric ? 'desc' : 'asc')))}>
            {content}
          </button>
        ) : (
          content
        )}
      </th>
    )
  }

  return (
    <div className={className}>
      <DenseTable
        fit
        columnChooser={hasOptional ? <ColumnChooser columns={columnDefs.filter((c) => !columns.find((col) => col.key === c.key)?.primary)} isVisible={prefs.isVisible} toggle={prefs.toggle} reset={prefs.reset} label={labels.columns} resetLabel={labels.reset} /> : undefined}
        className={maxHeight ? '[&>div:last-child]:max-h-[var(--report-max-h)] [&>div:last-child]:overflow-y-auto' : ''}
      >
        <thead>
          <tr>{visibleColumns.map(headerCell)}</tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const key = rowKey(row)
            const selected = selectedKey != null && selectedKey === key
            return (
              <tr
                key={key}
                className={[onRowClick ? 'cursor-pointer hover:!bg-[var(--ui-accent-soft)]' : '', selected ? '!bg-[var(--ui-accent-soft)]' : ''].join(' ').trim()}
                onClick={onRowClick ? (e) => onRowClick(row, e.currentTarget) : undefined}
              >
                {visibleColumns.map((c) => (
                  <td key={c.key} className={[isNumericKind(c.kind) ? 'text-right whitespace-nowrap' : 'max-w-[200px] truncate', c.emphasis ? 'font-semibold' : '', !c.emphasis && isCountKind(c.kind) ? 'text-[var(--ui-ink-2)]' : ''].join(' ').trim()} title={c.kind === 'text' || !c.kind ? String(c.value(row) ?? '') : undefined}>
                    {formatCell(c, row, fmtMoney)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
        {totalsRow ? (
          <tfoot>
            <tr className="h-[var(--ui-row-h)] bg-[var(--ui-surface-2)] font-semibold">
              {visibleColumns.map((c, i) => (
                <td key={c.key} className={['px-[var(--ui-cell-px,12px)] border-t border-[var(--ui-line-2)]', isNumericKind(c.kind) ? 'text-right whitespace-nowrap' : ''].join(' ').trim()}>
                  {i === 0 ? labels.total : isNumericKind(c.kind) ? formatCell(c, totalsRow, fmtMoney) : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </DenseTable>
      {footer ? <div className="mt-2">{footer}</div> : null}
      {maxHeight ? <style>{`:root{--report-max-h:${maxHeight}}`}</style> : null}
    </div>
  )
}
