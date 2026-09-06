import History from 'lucide-react/dist/esm/icons/history.js'
import Modal from '../shared/Modal'
import { translateMovementType } from './movementGroups'
// N13: the same row model the Stock Change ledger and the movement drill
// use. This preview used to DROP the branch span and silently omit the
// actor and reason when they were absent, so one movement read three ways.
// The same model also answers WHICH RECORD a movement belongs to, so a sale
// row here names its receipt exactly as the Stock Change ledger and the
// movement drill do -- this line used to read "13:22 · james · " with nothing
// on it identifying the sale.
import { buildHistoryRowModel, formatHistoryReference } from '../../utils/historyRowModel.ts'
import TruncatedText from '../shared/TruncatedText.tsx'

type TranslateFn = (key: string) => string | undefined
type TimeFormatter = (value: unknown) => string
type MovementRow = Record<string, any>

interface HistoryPreviewProduct {
  id?: string | number
  name?: string
  unit?: string
}

export interface HistoryPreviewState {
  product: HistoryPreviewProduct
  movements: MovementRow[] | null
  loading: boolean
  error: string | null
}

interface ProductHistoryPreviewModalProps {
  state: HistoryPreviewState
  onClose: () => void
  onRetry: (product: HistoryPreviewProduct) => void
  onViewFullHistory: (product: HistoryPreviewProduct) => void
  fmtTime: TimeFormatter
  movementColorClass: (movement: MovementRow) => string
  t?: TranslateFn
}

// Quick, scoped preview of a single product's stock movements -- opened from
// the "View stock history" row in ProductDetailModal. Distinct from the full
// Movements tab (openProductHistoryFromDetail in Inventory.tsx), which stays
// available below via "View full movement log" for anyone who wants the
// complete filterable list. This preview uses the precise `productId`-scoped
// `/api/inventory/movements` query (landed part 39) instead of the fuzzy
// name-based `search` filter the Movements tab still uses, so it can't
// under/over-match a renamed or similarly-named product.
export default function ProductHistoryPreviewModal({ state, onClose, onRetry, onViewFullHistory, fmtTime, movementColorClass, t }: ProductHistoryPreviewModalProps) {
  // Same fallback fix as ProductDetailModal.tsx's T() -- t() returns the
  // raw key (never falsy) on a miss, so `t(key) || fallback` never
  // actually falls back. Compare against the key itself instead.
  const T = (key: string, fallback: string): string => {
    const value = typeof t === 'function' ? t(key) : undefined
    return value && value !== key ? value : fallback
  }
  const { product, movements, loading, error } = state

  const badgeClass = (movement: MovementRow): string => movementColorClass(movement)

  const title = product?.name
    ? `${T('view_stock_history', 'Stock history')}: ${product.name}`
    : T('view_stock_history', 'Stock history')

  return (
    <Modal title={title} onClose={onClose} size="sm" unsavedChanges="read-only">
      {loading ? (
        <div className="py-8 text-center text-sm text-gray-400">{T('loading', 'Loading...')}</div>
      ) : error ? (
        <div className="py-6 text-center">
          <p className="text-sm text-red-500">{error}</p>
          <button
            type="button"
            onClick={() => onRetry(product)}
            className="btn-secondary mt-3 px-3 py-1.5 text-xs"
          >
            {T('retry', 'Retry')}
          </button>
        </div>
      ) : !movements || movements.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">
          <History className="mx-auto mb-2 h-6 w-6 text-gray-300" />
          {T('no_stock_history', 'No stock movements recorded for this product yet.')}
        </div>
      ) : (
        <div className="max-h-[50vh] space-y-1.5 overflow-y-auto pr-1">
          {movements.map((movement, index) => {
            const qty = Number(movement.quantity || 0)
            const signed = qty > 0 ? `+${qty}` : String(qty)
            const model = buildHistoryRowModel(movement)
            // The receipt sits between the actor and the free-text reason,
            // the same order the ledger's Reason cell uses; a row with no
            // record (add / remove / transfer) drops the segment entirely
            // rather than printing an empty one.
            const receipt = formatHistoryReference(model.reference, {
              sale: T('sale', 'Sale'),
              return: T('return', 'Return'),
            })
            const factLine = [fmtTime(movement.created_at), model.actor, receipt, model.reason].filter(Boolean).join(' · ')
            return (
              <div
                key={String(movement.id ?? index)}
                className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-2.5 py-2 text-xs dark:border-gray-700"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badgeClass(movement)}`}>
                      {translateMovementType(movement.movement_type, t)}
                    </span>
                    <span className="truncate text-gray-500 dark:text-gray-400" title={model.branch}>{model.branch}</span>
                  </div>
                  {/* Through TruncatedText, like the ledger's own receipt
                      line: this line now carries a receipt id, and a `title`
                      on a clipped span is unreachable by tap. */}
                  <TruncatedText text={factLine} className="mt-0.5 text-[11px] text-gray-400" />
                </div>
                <div className={`flex-shrink-0 text-sm font-bold ${qty > 0 ? 'text-green-600' : qty < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                  {signed} {product?.unit || ''}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => onViewFullHistory(product)}
        className="btn-secondary mt-3 w-full text-xs"
      >
        {T('view_full_history', 'View full movement log')}
      </button>
    </Modal>
  )
}
