import { useCallback, useEffect, useRef, useState } from 'react'
import Modal from '../shared/Modal'
import DateTimeRangePicker, { todayDateTimeRange, type DateTimeRange } from '../shared/DateTimeRangePicker.tsx'
import { getDeliveryContactReport } from '../../api/salesTransport.ts'

// X3 (Part 395): "delivery can also check expenses of delivery by contact" --
// the per-courier drill on a delivery contact, mirroring the supplier
// Purchases modal. Figures come from /api/sales/delivery-contact-report
// (the shared salesAnalytics kernel), scoped by the X1 range picker.
// Old-system courier payments live in Fees as fee_type='delivery' rows
// (migration 0072); THIS view is the new system's structural truth --
// sales linked by delivery_contact_id.

type TranslateFn = (key: string) => string | undefined

interface DeliveryContactReportRow {
  delivery_contact_id: number | null
  delivery_contact_name: string
  deliveries: number
  charged_fee_usd: number
  absorbed_fee_usd: number
  actual_cost_usd: number
  actual_cost_count: number
  linked_expense_count: number
  linked_expense_usd: number
  linked_expense_khr: number
  margin_usd: number
  last_delivery_at: string | null
  last_expense_at: string | null
}

interface DeliveryContactReportModalProps {
  contactId: number | string
  contactName: string
  t: TranslateFn
  onClose: () => void
}

function tr(t: TranslateFn, key: string, fallback: string): string {
  return t(key) || fallback
}

function money(value: unknown): string {
  return `$${(Number(value) || 0).toFixed(2)}`
}

function expenseMoney(usd: unknown, khr: unknown): string {
  return `${money(usd)} · ${(Number(khr) || 0).toLocaleString()}៛`
}

export default function DeliveryContactReportModal({ contactId, contactName, t, onClose }: DeliveryContactReportModalProps) {
  // The loader needs a complete range. Open on the complete known sales
  // window, so a courier's historical deliveries appear immediately instead
  // of looking empty merely because none happened today.
  const [range, setRange] = useState<DateTimeRange>(() => ({ ...todayDateTimeRange(), startDate: '2024-01-01' }))
  const [row, setRow] = useState<DeliveryContactReportRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    if (!range.startDate || !range.endDate) return
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setLoading(true)
    setError('')
    try {
      const params: Record<string, string | number> = {
        startDate: range.startDate,
        endDate: range.endDate,
        contactId: String(contactId),
      }
      if (range.startTime && range.endTime) {
        params.startTime = range.startTime
        params.endTime = range.endTime
        params.tzOffsetMinutes = -new Date().getTimezoneOffset()
      }
      const result = await getDeliveryContactReport(params) as { contacts?: DeliveryContactReportRow[] } | null
      if (requestRef.current !== requestId) return
      setRow(Array.isArray(result?.contacts) && result.contacts.length ? result.contacts[0] : null)
    } catch (err) {
      if (requestRef.current !== requestId) return
      setRow(null)
      setError(err instanceof Error && err.message ? err.message : tr(t, 'daily_report_failed', 'Could not load this report.'))
    } finally {
      if (requestRef.current === requestId) setLoading(false)
    }
  }, [contactId, range, t])

  useEffect(() => { load() }, [load])

  const stat = (label: string, value: string, hint?: string, tone = '') => (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-sm font-semibold ${tone || 'text-slate-900 dark:text-white'}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-[10px] text-slate-400">{hint}</div> : null}
    </div>
  )

  return (
    <Modal title={`${tr(t, 'delivery_report', 'Deliveries')} -- ${contactName}`} onClose={onClose} unsavedChanges="read-only">
      <div className="space-y-3">
        <DateTimeRangePicker
          value={range}
          onChange={setRange}
          t={t}
          triggerClassName="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2"
        />

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
            {error}
            <button type="button" className="ml-2 font-medium underline underline-offset-2" onClick={() => load()}>{tr(t, 'try_again', 'Try again')}</button>
          </div>
        ) : loading ? (
          <div className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((cell) => <div key={cell} className="h-16 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)}
          </div>
        ) : !row ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
            {tr(t, 'no_deliveries_in_range', 'No deliveries for this contact in the selected range.')}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {stat(tr(t, 'deliveries', 'Deliveries'), String(row.deliveries),
                row.last_delivery_at ? `${tr(t, 'last_delivery', 'Last')}: ${String(row.last_delivery_at).slice(0, 10)}` : undefined)}
              {stat(tr(t, 'delivery_charged', 'Charged to customers'), money(row.charged_fee_usd))}
              {stat(tr(t, 'delivery_absorbed', 'Absorbed by store'), money(row.absorbed_fee_usd))}
              {stat(
                tr(t, 'delivery_actual_cost', 'Actual cost paid'),
                money(row.actual_cost_usd),
                `${row.actual_cost_count}/${row.deliveries} ${tr(t, 'recorded', 'recorded')}`,
              )}
              {stat(
                tr(t, 'linked_delivery_expenses', 'Linked expenses'),
                expenseMoney(row.linked_expense_usd, row.linked_expense_khr),
                `${row.linked_expense_count} ${tr(t, 'expense_rows', 'expense rows')}${row.last_expense_at ? ` · ${tr(t, 'last_delivery', 'Last')}: ${String(row.last_expense_at).slice(0, 10)}` : ''}`,
              )}
            </div>
            <div className={`rounded-xl border px-3 py-2 text-sm font-semibold ${row.margin_usd < 0
              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300'}`}>
              {tr(t, 'delivery_margin', 'Delivery margin')}: {money(row.margin_usd)}
              <span className="ml-1.5 text-xs font-normal opacity-75">({tr(t, 'delivery_margin_hint', 'charged minus actual cost paid')})</span>
            </div>
            {row.actual_cost_count < row.deliveries ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {tr(t, 'delivery_cost_partial_hint', 'Some deliveries have no recorded courier cost yet, so the actual total covers only the recorded ones -- it is not read as zero cost.')}
              </p>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  )
}
