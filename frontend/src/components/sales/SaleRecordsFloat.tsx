// The RECORDS float for one sale (N41).
//
// The owner, Sep 6 2026: "one line called Records with total records when press
// it pops up a float with who made changes in this sales record (by default
// should show change status / add sale / edit product quantity / change
// delivery fee / or + for matching conditions, and click on specific
// information/record row can see more details before and after."
//
// Read literally, and each clause is a decision:
//
//   "a float"                 the shared Modal -- portalled above the content,
//                             ONE close affordance (its header X), and
//                             declared read-only so nothing here can be lost.
//                             It is not a new float primitive: a second one
//                             would be a second set of escape/backdrop/
//                             safe-area bugs.
//   "who made changes"        the acting account's USERNAME leads every row,
//                             with the branch/username/dd-mm-yyyy HH:mm
//                             convention every other history surface uses.
//   "by default should show   the default list is UNFILTERED and every kind is
//    ... or +"                labelled; the filter narrows to the kinds this
//                             sale actually has, through the shared
//                             FilterMenu, so the chosen filters live inside
//                             the menu and never spill into the header.
//   "click on specific ...    selecting a row expands its before -> after
//    can see more details     INSIDE the float. One row is open at a time:
//    before and after"        this is a comparison, and two comparisons open
//                             side by side is how a reader ends up reading the
//                             wrong sale's numbers.
import { useEffect, useMemo, useState } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import Modal from '../shared/Modal.tsx'
import FilterMenu from '../shared/FilterMenu.tsx'
import { getSaleRecords } from '../../api/salesTransport.ts'
import { fmtDateTime24 } from '../../utils/formatters.ts'
import { getStatusLabel } from './StatusBadge.tsx'
import { formatSaleRecordValueLines } from './saleRecordValue.ts'
import {
  SALE_RECORD_KIND_KEYS,
  filterSaleRecords,
  normalizeSaleRecordsResponse,
  saleRecordFieldRows,
  saleRecordKind,
  saleRecordKindCounts,
  type SaleRecord,
  type SaleRecordFieldRow,
} from '../../utils/saleRecords.ts'

type TranslateFn = (key: string) => string

interface SaleRecordsFloatProps {
  sale: { id: number | string; receipt_number?: string | null }
  onClose: () => void
  t: TranslateFn
  fmtUSD: (value: number | string) => string
  fmtKHR: (value: number | string) => string
}

const KIND_FALLBACKS: Record<string, string> = {
  record_kind_sale_created: 'Sale recorded',
  record_kind_status_changed: 'Status changed',
  record_kind_item_added: 'Product added',
  record_kind_item_removed: 'Product removed',
  record_kind_item_qty_changed: 'Quantity changed',
  record_kind_item_price_changed: 'Price changed',
  record_kind_delivery_fee_changed: 'Delivery fee changed',
  record_kind_delivery_cost_changed: 'Delivery cost changed',
  record_kind_delivery_added: 'Delivery added',
  record_kind_discount_changed: 'Discount changed',
  record_kind_customer_changed: 'Customer changed',
  record_kind_payment_settled: 'Payment settled',
  record_kind_cancelled: 'Sale cancelled',
  record_kind_undone: 'Action undone',
  record_kind_other: 'Other change',
}

const FIELD_FALLBACKS: Record<string, string> = {
  amount: 'Amount',
  amount_paid: 'Amount paid',
  amount_paid_khr: 'Amount paid (KHR)',
  change: 'Change',
  change_khr: 'Change (KHR)',
  total: 'Sale total',
  quantity: 'Quantity',
  status: 'Status',
  refund: 'Refund',
  receipt_number: 'Receipt',
  customer: 'Customer',
  membership_number: 'Membership',
  reason: 'Reason',
  note: 'Note',
  payment_method: 'Payment method',
  payment_details: 'Payment details',
  products: 'Products',
  action: 'Action',
  stock: 'Stock',
  delivery: 'Delivery',
  id: 'ID',
  driver: 'Driver',
  driver_phone: 'Driver phone',
  address: 'Address',
  delivery_fee: 'Delivery fee',
  paid_by: 'Paid by',
  delivery_actual_cost: 'Actual delivery cost',
  exchange_rate: 'Exchange rate',
}

export default function SaleRecordsFloat({ sale, onClose, t, fmtUSD, fmtKHR }: SaleRecordsFloatProps) {
  const [records, setRecords] = useState<SaleRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [kinds, setKinds] = useState<Set<string>>(new Set())

  const label = (key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }

  // The via badge. Only the two replay directions are named here on purpose:
  // 'amend' is how nearly every record was made and a badge on nearly every row
  // is noise, and an unknown value from a newer Worker prints nothing rather
  // than an English identifier.
  const viaLabel = (record: SaleRecord): string | null => (
    record.via === 'undo' ? label('undo', 'Undo')
      : record.via === 'redo' ? label('redo', 'Redo')
      : null
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getSaleRecords(sale.id)
      .then((payload) => {
        if (cancelled) return
        setRecords(normalizeSaleRecordsResponse(payload))
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        // An empty list would read as "nobody ever touched this sale", which is
        // a different and wrong answer. A failed read says it failed.
        setError((cause as Error)?.message || label('records_load_failed', 'Could not load the records for this sale.'))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale.id])

  const visible = useMemo(() => filterSaleRecords(records, kinds), [records, kinds])
  const counts = useMemo(() => saleRecordKindCounts(records), [records])

  const kindLabel = (kind: string): string => {
    const key = SALE_RECORD_KIND_KEYS[saleRecordKind(kind)]
    return label(key, KIND_FALLBACKS[key] || key)
  }

  const renderValue = (row: SaleRecordFieldRow, value: unknown) => {
    if (value === null || value === undefined || value === '') return label('not_recorded', 'Not recorded')
    if (row.format === 'money') {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? fmtUSD(parsed) : String(value)
    }
    if (row.format === 'money_khr') {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? fmtKHR(parsed) : String(value)
    }
    if (row.format === 'status') return getStatusLabel(value, t)
    if (row.format === 'boolean') return value ? label('yes', 'Yes') : label('no', 'No')
    if (row.format === 'quantity') return String(value)
    const lines = formatSaleRecordValueLines(row.field, value, fmtUSD)
    if (lines.length === 0) return label('not_recorded', 'Not recorded')
    return (
      <span className="inline-flex max-w-full flex-col items-end gap-0.5">
        {lines.map((line, index) => <span key={`${index}:${line}`} className="max-w-full break-words">{line}</span>)}
      </span>
    )
  }

  const toggleKind = (kind: string): void => {
    setKinds((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  const title = sale.receipt_number
    ? `${label('sale_records', 'Records')} · ${sale.receipt_number}`
    : label('sale_records', 'Records')

  return (
    <Modal title={title} onClose={onClose} size="lg" unsavedChanges="read-only">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {visible.length === records.length
              ? `${records.length} ${label('records', 'records')}`
              : `${visible.length} / ${records.length}`}
          </span>
          {/* Chosen filters live INSIDE the menu -- never as chips beside it. */}
          <FilterMenu
            compact
            label={t('filter') || 'Filter'}
            activeCount={kinds.size}
            onClear={kinds.size ? () => setKinds(new Set()) : null}
            sections={[{
              id: 'record_kind',
              label: label('record_kind', 'Change type'),
              options: counts.map(({ kind, count }) => ({
                id: kind,
                label: `${kindLabel(kind)} (${count})`,
                active: kinds.has(kind),
                onClick: () => toggleKind(kind),
              })),
            }]}
          />
        </div>

        {loading ? (
          <div className="py-8 text-center text-xs text-gray-400">{t('loading') || 'Loading…'}</div>
        ) : error ? (
          <div role="alert" className="rounded border border-red-200 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:text-red-400">{error}</div>
        ) : visible.length === 0 ? (
          <div className="py-8 text-center text-xs text-gray-400">{t('no_data')}</div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {visible.map((record) => {
              const rows = saleRecordFieldRows(record)
              const isOpen = openId === record.id
              return (
                <li key={record.id}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenId(isOpen ? null : record.id)}
                    className="flex w-full items-start gap-2 px-1 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    {isOpen ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-[13px] font-medium text-gray-800 dark:text-gray-100">{kindLabel(String(record.kind || ''))}</span>
                        {record.subject ? <span className="truncate text-xs text-gray-500">{record.subject}</span> : null}
                      </span>
                      {/* The history convention: acting USERNAME, then the
                          dd/mm/yyyy HH:mm stamp. */}
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-gray-400">
                        <span>{record.provenance_unknown
                          ? label('unknown', 'Unknown')
                          : record.actor_username || (t('system') || 'System')}</span>
                        <span>{fmtDateTime24(record.at)}</span>
                        {/* HOW it was done. `via` is a Worker enum -- amend /
                            undo / redo -- not a display string: printing it raw
                            put the English word "undo" into the Khmer pack, on
                            the one surface whose whole job is explaining what
                            happened. The pack already owns both words. */}
                        {viaLabel(record) ? <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{viaLabel(record)}</span> : null}
                      </span>
                    </span>
                  </button>
                  {isOpen ? (
                    <div className="px-1 pb-3 pl-6">
                      {rows.length === 0 ? (
                        <p className="text-xs text-gray-400">{record.summary || t('no_data')}</p>
                      ) : (
                        <table className="w-full text-[11px]">
                          <thead className="text-gray-400">
                            <tr>
                              <th className="py-1 text-left font-medium">{label('field', 'Field')}</th>
                              <th className="py-1 text-right font-medium">{label('before', 'Before')}</th>
                              <th className="py-1 text-right font-medium">{label('after', 'After')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row) => (
                              <tr key={row.field} className={row.changed ? '' : 'text-gray-400'}>
                                <td className="py-0.5 pr-2">{row.labelKey ? label(row.labelKey, FIELD_FALLBACKS[row.labelKey] || row.labelKey) : row.field}</td>
                                <td className="py-0.5 text-right tabular-nums">{renderValue(row, row.before)}</td>
                                <td className={`py-0.5 text-right tabular-nums ${row.changed ? 'font-semibold text-gray-800 dark:text-gray-100' : ''}`}>{renderValue(row, row.after)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Modal>
  )
}
