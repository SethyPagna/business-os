import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.js'
import Scale from 'lucide-react/dist/esm/icons/scale.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import DateEntryInput from '../shared/DateEntryInput.tsx'
import { linePaidTotal, type PaymentStatus, type StockSessionLine } from '../../utils/stockSessionDraft.ts'
import { IconField, InsetNumberField, INVALID_RING } from './StockSessionSharedDetails.tsx'

type Translate = (key: string, fallbackEn?: string, fallbackKm?: string) => string

const ICON_BUTTON = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'

/**
 * Step 2 of an Add session (spec 4.2): Paid | Not Yet Paid, the due date, what
 * the supplier was paid against the Items total, and each line's unit cost.
 */
export default function StockSessionPaymentStep({
  tr, packLookup, usdSymbol, busy, paymentStatus, onPaymentStatus, creditDueDate, onCreditDueDate, dueInvalid,
  canViewCosts, canEditCosts, paidAmount, onPaidAmount, onPaidBlur, paidInvalid, itemsTotal, difference,
  lines, onLineCost, onMatch, onReset, canReset,
}: {
  tr: Translate
  packLookup: (key: string) => string | undefined
  usdSymbol: string
  busy: boolean
  paymentStatus: PaymentStatus
  onPaymentStatus: (next: PaymentStatus) => void
  creditDueDate: string
  onCreditDueDate: (iso: string) => void
  dueInvalid: boolean
  canViewCosts: boolean
  canEditCosts: boolean
  /** Shown value: the typed amount, or the Items total while the operator has typed none. */
  paidAmount: string
  onPaidAmount: (next: string) => void
  onPaidBlur: () => void
  paidInvalid: boolean
  itemsTotal: number
  difference: number
  /** The Add lines still to be written, in Items order. */
  lines: StockSessionLine[]
  onLineCost: (key: string, next: string) => void
  onMatch: () => void
  onReset: () => void
  canReset: boolean
}) {
  const amountKey = paymentStatus === 'credit' ? 'owed_to_supplier' : 'paid_to_supplier'
  const amountFallback = paymentStatus === 'credit' ? 'Owed to supplier' : 'Paid to supplier'
  const dueLabel = tr('due_date', 'Due date')
  const money4 = (value: number): string => `${value < 0 ? '−' : ''}${usdSymbol}${Math.abs(value).toFixed(4)}`
  return (
    <div className="space-y-2" data-stock-session-payment>
      <div role="radiogroup" aria-label={tr('payment', 'Payment')} className="grid h-10 grid-cols-2 gap-0.5 rounded-xl bg-gray-100 p-0.5 dark:bg-gray-900/60">
        {(['paid', 'credit'] as const).map((status) => (
          <button
            key={status}
            type="button"
            role="radio"
            aria-checked={paymentStatus === status}
            disabled={busy}
            onClick={() => onPaymentStatus(status)}
            className={`rounded-[0.6rem] text-sm font-semibold ${paymentStatus === status ? 'bg-white text-blue-700 shadow-sm dark:bg-gray-800 dark:text-blue-300' : 'text-gray-600 dark:text-gray-300'}`}
          >
            {status === 'paid' ? tr('paid', 'Paid') : tr('on_credit', 'Not Yet Paid')}
          </button>
        ))}
      </div>
      <div className={`grid gap-1.5 ${canViewCosts ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <IconField icon={CalendarClock} title={dueLabel}>
          <DateEntryInput
            className={`h-10 w-full pl-8 text-sm ${dueInvalid ? INVALID_RING : ''}`}
            t={packLookup}
            ariaLabel={dueLabel}
            placeholder={dueLabel}
            disabled={busy || paymentStatus !== 'credit'}
            value={paymentStatus === 'credit' ? creditDueDate : ''}
            onChange={onCreditDueDate}
          />
        </IconField>
        {canViewCosts ? (
          <InsetNumberField
            label={`${tr(amountKey, amountFallback)} (${usdSymbol})`}
            value={paidAmount}
            onChange={onPaidAmount}
            onBlur={onPaidBlur}
            step="0.0001"
            disabled={busy || !canEditCosts}
            invalid={paidInvalid}
          />
        ) : null}
      </div>
      {canViewCosts ? (
        <>
          <div className="flex items-center gap-1.5">
            <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 text-xs leading-5 tabular-nums text-gray-600 dark:text-gray-300">
              <span className="whitespace-nowrap">{tr('items_total', 'Items total')} <span className="font-semibold">{money4(itemsTotal)}</span></span>
              {Math.abs(difference) > 0.005 ? (
                <span className="whitespace-nowrap font-semibold text-red-600 dark:text-red-400">{tr('stock_difference', 'Difference')} {money4(difference)}</span>
              ) : null}
            </p>
            <button type="button" className={ICON_BUTTON} disabled={busy || !canEditCosts} onClick={onMatch} aria-label={tr('match_cost_to_paid', 'Match cost to paid amount')} title={tr('match_cost_to_paid', 'Match cost to paid amount')}>
              <Scale className="h-4 w-4" />
            </button>
            <button type="button" className={ICON_BUTTON} disabled={busy || !canEditCosts || !canReset} onClick={onReset} aria-label={tr('reset_costs', 'Reset costs')} title={tr('reset_costs', 'Reset costs')}>
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
            {lines.map((line) => (
              <li key={line.key} className="grid grid-cols-[minmax(0,1fr)_6rem_4rem] items-center gap-x-2 gap-y-0.5 px-2 py-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto_6rem_4rem]">
                <span className="col-span-3 min-w-0 break-words text-gray-800 sm:col-span-1 dark:text-gray-200">{line.productName}</span>
                <span className="whitespace-nowrap text-xs tabular-nums text-gray-500">{line.quantity}{line.freeQuantity > 0 ? ` (+${line.freeQuantity})` : ''}</span>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  inputMode="decimal"
                  aria-label={`${tr('cost', 'Cost')}: ${line.productName}`}
                  title={tr('cost', 'Cost')}
                  disabled={busy || !canEditCosts || line.quantity <= 0}
                  value={line.unitCost}
                  onChange={(event) => onLineCost(line.key, event.target.value)}
                  className="input h-9 min-h-0 w-full px-2 py-1 text-right text-sm tabular-nums"
                />
                <span className="whitespace-nowrap text-right text-xs tabular-nums text-gray-600 dark:text-gray-300">{usdSymbol}{linePaidTotal(line).toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}
