import Gift from 'lucide-react/dist/esm/icons/gift.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { freeRowText, linePaidTotal, type StockSessionLine } from '../../utils/stockSessionDraft.ts'

type Translate = (key: string, fallbackEn?: string, fallbackKm?: string) => string

const DOT: Record<StockSessionLine['status'], string> = {
  queued: 'bg-gray-300 dark:bg-gray-500',
  saving: 'animate-pulse bg-blue-500',
  saved: 'bg-emerald-500',
  error: 'bg-red-500',
}

const ICON_BUTTON = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:opacity-50'

function shortDate(label: string): string {
  const match = /^(\d{2}\/\d{2})\/\d{4}$/.exec(label.trim())
  return match ? match[1] : label
}

/**
 * The session's lines (spec 3.5): one row each, tap to edit, trash to remove.
 * An Add item's free units are its own row underneath (owner, 30 Sep), opened
 * from the item's Free action; only the quantity is typed there.
 */
export default function StockSessionItems({
  lines, tr, usdSymbol, canViewCosts, canFree, busy, editingKey, freeEditKey, invalidKey, onEdit, onRemove, onFree, onFreeQuantity,
}: {
  lines: StockSessionLine[]
  tr: Translate
  usdSymbol: string
  canViewCosts: boolean
  /** Free units are receipt data: only users who may receive with costs add them. */
  canFree: boolean
  busy: boolean
  editingKey: string
  /** The item whose free row is open for typing, even at 0. */
  freeEditKey: string
  /** The item that stops Next (no units at all). */
  invalidKey: string
  onEdit: (line: StockSessionLine) => void
  onRemove: (key: string) => void
  onFree: (key: string | null) => void
  onFreeQuantity: (key: string, value: string) => void
}) {
  if (!lines.length) return null
  const freeLabel = tr('stock_receipt_free_goods', 'Free')
  return (
    <section aria-label={tr('items', 'Items')} className="min-w-0">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {tr('items', 'Items')} <span className="tabular-nums">{lines.length}</span>
      </div>
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
        {lines.map((line) => {
          const editable = !busy && line.status !== 'saved' && !line.needsRemoval
          const amount = line.mode === 'remove' ? `−${line.quantity}` : line.mode === 'set' ? `= ${line.quantity}` : `+${line.quantity}`
          const tone = line.mode === 'remove' ? 'text-red-600 dark:text-red-400' : line.mode === 'set' ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'
          const cost = canViewCosts && line.mode === 'add' ? `${usdSymbol}${linePaidTotal(line).toFixed(2)}` : ''
          const freeOpen = line.mode === 'add' && (line.freeQuantity > 0 || freeEditKey === line.key)
          const canAddFree = editable && canFree && line.mode === 'add' && !freeOpen
          const freeText = freeRowText(line, usdSymbol)
          return (
            <li key={line.key} className={`${editingKey === line.key ? 'bg-blue-50/70 dark:bg-blue-900/20' : ''} ${invalidKey === line.key ? 'ring-2 ring-inset ring-red-400' : ''}`}>
              <div className="flex items-start gap-1 px-2 py-1.5 text-sm">
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() => onEdit(line)}
                  aria-label={`${tr('edit', 'Edit')}: ${line.productName}`}
                  className="flex min-w-0 flex-1 items-start gap-2 text-left disabled:cursor-default"
                >
                  <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[line.status]}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="min-w-0 break-words text-gray-800 dark:text-gray-200">
                        {line.productName}
                        {line.createdProduct ? <span className="ml-1 inline-block rounded bg-emerald-100 px-1 align-middle text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{tr('stock_session_new_product', 'New')}</span> : null}
                      </span>
                      <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-gray-500 dark:text-gray-400">
                        <span className={`font-semibold ${tone}`}>{amount}</span>
                        {line.batchLabel ? ` · ${shortDate(line.batchLabel)}` : ''}
                        {cost ? ` · ${cost}` : ''}
                      </span>
                    </span>
                    {line.product.barcode ? <span className="block break-all dense-id text-[10px] text-gray-400">{line.product.barcode}</span> : null}
                    {line.status === 'error' && line.detail ? <span className="block break-words text-[11px] text-red-600 dark:text-red-400">{line.detail}</span> : null}
                    {line.reason ? <span className="block break-words text-[11px] text-gray-400">{line.reason}</span> : null}
                  </span>
                </button>
                {canAddFree ? (
                  <button type="button" onClick={() => onFree(line.key)} aria-label={tr('stock_receipt_free_goods', 'Free')} title={freeLabel} className={`${ICON_BUTTON} text-emerald-600 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/20`}>
                    <Gift className="h-4 w-4" />
                  </button>
                ) : null}
                {line.status !== 'saved' ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRemove(line.key)}
                    aria-label={tr('remove', 'Remove')}
                    title={tr('remove', 'Remove')}
                    className={`${ICON_BUTTON} hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 ${line.needsRemoval ? 'bg-red-50 text-red-600 dark:bg-red-900/20' : 'text-gray-400'}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              {freeOpen ? (
                <div className="flex items-center gap-1.5 pb-1.5 pl-6 pr-2 text-xs tabular-nums text-emerald-700 dark:text-emerald-300" data-stock-free-row>
                  <Gift className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {editable && canFree ? (
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      autoFocus={freeEditKey === line.key && line.freeQuantity === 0}
                      aria-label={`${freeLabel}: ${line.productName}`}
                      title={freeLabel}
                      value={line.freeQuantity > 0 ? String(line.freeQuantity) : ''}
                      placeholder="0"
                      onChange={(event) => onFreeQuantity(line.key, event.target.value)}
                      onBlur={() => { if (line.freeQuantity === 0) onFree(null) }}
                      className="input h-8 min-h-0 w-16 px-2 py-0.5 text-right text-sm"
                    />
                  ) : <span className="font-semibold">{line.freeQuantity}</span>}
                  <span className="min-w-0 flex-1 break-words">
                    {canViewCosts ? freeText.slice(String(line.freeQuantity).length) : ` ${freeLabel}`}
                  </span>
                  {editable && canFree ? (
                    <button type="button" onClick={() => { onFreeQuantity(line.key, ''); onFree(null) }} aria-label={`${tr('remove', 'Remove')}: ${freeLabel}`} title={tr('remove', 'Remove')} className={`${ICON_BUTTON} h-7 w-7 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20`}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
