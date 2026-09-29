import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import { linePaidTotal, type StockSessionLine } from '../../utils/stockSessionDraft.ts'

type Translate = (key: string, fallbackEn?: string, fallbackKm?: string) => string

const DOT: Record<StockSessionLine['status'], string> = {
  queued: 'bg-gray-300 dark:bg-gray-500',
  saving: 'animate-pulse bg-blue-500',
  saved: 'bg-emerald-500',
  error: 'bg-red-500',
}

function shortDate(label: string): string {
  const match = /^(\d{2}\/\d{2})\/\d{4}$/.exec(label.trim())
  return match ? match[1] : label
}

/** The session's lines (spec 3.5): one row each; tap to edit, trash to remove. */
export default function StockSessionItems({ lines, tr, usdSymbol, canViewCosts, busy, editingKey, onEdit, onRemove }: {
  lines: StockSessionLine[]
  tr: Translate
  usdSymbol: string
  canViewCosts: boolean
  busy: boolean
  editingKey: string
  onEdit: (line: StockSessionLine) => void
  onRemove: (key: string) => void
}) {
  if (!lines.length) return null
  return (
    <section aria-label={tr('items', 'Items')} className="min-w-0">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {tr('items', 'Items')} <span className="tabular-nums">{lines.length}</span>
      </div>
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
        {lines.map((line) => {
          const editable = !busy && line.status !== 'saved' && !line.needsRemoval
          const amount = line.mode === 'remove'
            ? `−${line.quantity}`
            : line.mode === 'set'
              ? `= ${line.quantity}`
              : `+${line.quantity}${line.freeQuantity > 0 ? ` (+${line.freeQuantity})` : ''}`
          const tone = line.mode === 'remove' ? 'text-red-600 dark:text-red-400' : line.mode === 'set' ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'
          const cost = canViewCosts && line.mode === 'add' ? `${usdSymbol}${linePaidTotal(line).toFixed(2)}` : ''
          return (
            <li key={line.key} className={`flex items-start gap-2 px-2 py-1.5 text-sm ${editingKey === line.key ? 'bg-blue-50/70 dark:bg-blue-900/20' : ''}`}>
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
                  {line.status === 'error' && line.detail ? <span className="block break-words text-[11px] text-red-600 dark:text-red-400">{line.detail}</span> : null}
                  {line.reason ? <span className="block break-words text-[11px] text-gray-400">{line.reason}</span> : null}
                </span>
              </button>
              {line.status !== 'saved' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRemove(line.key)}
                  aria-label={tr('remove', 'Remove')}
                  title={tr('remove', 'Remove')}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20 ${line.needsRemoval ? 'bg-red-50 text-red-600 dark:bg-red-900/20' : 'text-gray-400'}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
