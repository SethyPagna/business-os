import History from 'lucide-react/dist/esm/icons/history.js'
import Modal from '../shared/Modal'
import { translateMovementType } from './movementGroups'

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
                    {movement.branch_name ? (
                      <span className="truncate text-gray-500 dark:text-gray-400">{movement.branch_name}</span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-gray-400">
                    {fmtTime(movement.created_at)}
                    {movement.user_name ? ` \u00b7 ${movement.user_name}` : ''}
                    {movement.reason ? ` \u00b7 ${movement.reason}` : ''}
                  </div>
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
