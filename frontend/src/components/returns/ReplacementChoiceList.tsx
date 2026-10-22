import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import Repeat from 'lucide-react/dist/esm/icons/repeat.js'
import InfoHint from '../shared/InfoHint.tsx'
import { answerReady, type ReplacementAnswer, type ReplacementOutstanding } from './helpers/returnReplacementCancel.ts'

type Translate = (key: string, fallbackEn?: string, fallbackKm?: string) => string

export interface ReplacementChoiceItem {
  outstanding: ReplacementOutstanding
  returnNumber: string
  answer: ReplacementAnswer
  /** The units were already taken back for this return (a cancel that was refused after it): the choice can no longer change. */
  locked: boolean
}

interface Props {
  items: ReplacementChoiceItem[]
  /** The replacement items are being looked up; the dialog cannot be applied until they are known. */
  loading: boolean
  /** The look-up failed. The cancel can still be sent: the Worker asks again with the exact lines if any are left. */
  failed: boolean
  /** Taking units back records a return, so it needs permission to add returns (the cancel itself needs bulk returns). */
  canTakeBack: boolean
  disabled: boolean
  tr: Translate
  fmtUSD: (value: number) => string
  onToggleCancel: (returnId: number, cancel: boolean) => void
  onToggleLine: (returnId: number, lineId: number) => void
  onRetry: () => void
}

/**
 * The question a cancel asks when the returns it cancels opened replacement sales that are still with the customer (owner, 22 Oct 2026): "also
 * cancel the replacement items?" -- one box per return, and when it is on, one tick per replacement line (all ticked: some or all). The default is
 * that the replacement stays. Rendered inside the shared bulk review dialog, so it is part of the one confirm, not a second one.
 */
export default function ReplacementChoiceList({ items, loading, failed, canTakeBack, disabled, tr, fmtUSD, onToggleCancel, onToggleLine, onRetry }: Props) {
  if (loading) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
        {tr('return_cancel_replacement_checking', 'Checking the replacement items…', 'កំពុងពិនិត្យទំនិញជំនួស…')}
      </p>
    )
  }
  if (failed) {
    return (
      <div role="alert" className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
        <span className="min-w-0 flex-1">{tr('return_cancel_replacement_load_failed', 'The replacement items could not be checked. Try again, or apply and the server will ask.', 'មិនអាចពិនិត្យទំនិញជំនួសបានទេ។ សូមសាកម្ដងទៀត ឬអនុវត្ត ហើយម៉ាស៊ីនមេនឹងសួរ។')}</span>
        <button type="button" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-amber-100 disabled:opacity-50 dark:hover:bg-amber-800/40" disabled={disabled}
          onClick={onRetry} aria-label={tr('retry', 'Retry', 'សាកល្បងម្តងទៀត')} title={tr('retry', 'Retry', 'សាកល្បងម្តងទៀត')}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    )
  }
  if (!items.length) return null
  return (
    <div data-section="replacement-choices" className="space-y-2">
      {items.map(({ outstanding, returnNumber, answer, locked }) => {
        const ready = answerReady(outstanding, answer)
        const boxDisabled = disabled || locked || !canTakeBack
        return (
          <div key={outstanding.return_id} className="space-y-1.5 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 dark:border-emerald-800 dark:bg-emerald-900/20">
            <label className="flex items-center gap-2 text-sm font-medium text-emerald-900 dark:text-emerald-100">
              <input type="checkbox" className="h-4 w-4 shrink-0 rounded" checked={answer.cancel} disabled={boxDisabled}
                onChange={(event) => onToggleCancel(outstanding.return_id, event.target.checked)} />
              <Repeat className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 break-words">
                {tr('return_cancel_replacement_also', 'Also cancel the replacement items', 'បោះបង់ទំនិញជំនួសផងដែរ')}
                <span className="ml-1 text-xs font-normal text-emerald-700 dark:text-emerald-300">· {returnNumber}{outstanding.receipt_number ? ` → ${outstanding.receipt_number}` : ''}</span>
              </span>
              <InfoHint label={tr('return_cancel_replacement_also', 'Also cancel the replacement items', 'បោះបង់ទំនិញជំនួសផងដែរ')}
                text={tr('return_cancel_replacement_hint', 'The customer gives these items back: each ticked line returns to the shelf it came from and is refunded in the same step as the cancel. Untick a line to leave it with the customer. Undo brings them back out.', 'អតិថិជនប្រគល់ទំនិញទាំងនេះមកវិញ៖ ទំនិញដែលបានធីកនីមួយៗត្រឡប់ទៅធ្នើដើម ហើយសងប្រាក់ក្នុងជំហានតែមួយជាមួយការបោះបង់។ ដោះធីកចេញដើម្បីទុកឱ្យអតិថិជន។ ត្រឡប់វិញនឹងយកទំនិញចេញម្ដងទៀត។')} />
            </label>
            {answer.cancel ? (
              <ul className="space-y-1 pl-6">
                {outstanding.lines.map((line) => (
                  <li key={line.id}>
                    <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                      <input type="checkbox" className="h-4 w-4 shrink-0 rounded" checked={answer.picked.has(line.id)} disabled={boxDisabled}
                        onChange={() => onToggleLine(outstanding.return_id, line.id)} />
                      <span className="min-w-0 flex-1 break-words">{line.product_name || `#${line.product_id ?? line.id}`} × {line.quantity}</span>
                      <span className="shrink-0 font-medium">{fmtUSD(line.quantity * line.applied_price_usd)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            {!canTakeBack ? (
              <p className="text-xs text-emerald-800 dark:text-emerald-200">{tr('return_cancel_replacement_need_add', 'Taking replacement items back needs permission to add returns. They stay with the customer.', 'ការយកទំនិញជំនួសមកវិញត្រូវការសិទ្ធិបន្ថែមការប្រគល់មកវិញ។ ទំនិញនៅជាមួយអតិថិជន។')}</p>
            ) : null}
            {answer.cancel && !ready ? (
              <p role="alert" className="text-xs text-red-600 dark:text-red-300">{tr('return_cancel_replacement_pick_one', 'Tick at least one replacement item, or untick the box to keep them all.', 'សូមធីកទំនិញជំនួសយ៉ាងហោចណាស់មួយ ឬដោះធីកប្រអប់ដើម្បីទុកទាំងអស់។')}</p>
            ) : null}
            {locked ? (
              <p className="text-xs text-emerald-800 dark:text-emerald-200">{tr('return_cancel_replacement_taken', 'These items are already returned. Apply again to finish the cancel.', 'ទំនិញទាំងនេះបានប្រគល់មកវិញរួចហើយ។ អនុវត្តម្ដងទៀតដើម្បីបញ្ចប់ការបោះបង់។')}</p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
