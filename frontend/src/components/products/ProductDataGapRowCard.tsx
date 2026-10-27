import BadgeCheck from 'lucide-react/dist/esm/icons/badge-check.js'
import Ban from 'lucide-react/dist/esm/icons/ban.js'
import { ConflictIcon, CONFLICT_ICON_CLASS } from '../shared/ConflictIcon.ts'
import PendingReviewTag from '../shared/PendingReviewTag.tsx'
import { ProductImg } from './shared/primitives.tsx'
import type { ProductDataGapKind, ProductDataGapRow } from '../../api/productWriteTransport.ts'

// One row of Products -> Conflicts -> unknown cost / no barcode (see ProductDataGapsSection.tsx for the rules). Its own file so a test can
// render it without the app context.

type TranslateFn = (key: string) => string | undefined

export function ProductDataGapRowCard({ row, kind, t, onOpen, onConfirmZero, onMarkNoBarcode }: {
  row: ProductDataGapRow
  kind: ProductDataGapKind
  t: TranslateFn
  onOpen?: (productId: number) => void
  /** Present only for a user who may confirm a $0 (products edit + the cost-entry permission); a Review-tier account's tap is queued. */
  onConfirmZero?: (row: ProductDataGapRow) => void
  /** Present only for a user who may edit products (Full applies it; Review queues it). */
  onMarkNoBarcode?: (row: ProductDataGapRow) => void
}) {
  const name = row.name || `#${row.id}`
  const reasons: string[] = []
  if (kind === 'unknown_cost') {
    for (const reason of row.reasons || []) {
      if (reason === 'catalog_unknown') reasons.push(t('conflict_unknown_cost_catalog') || 'Product cost unknown')
      else if (reason === 'zero_unconfirmed') reasons.push(t('cost_zero_unconfirmed') || '$0 not confirmed')
      else if (reason === 'lots_unknown') reasons.push((t('conflict_unknown_cost_lots') || '{count} received date(s), {units} pcs with unknown cost').replace('{count}', String(row.unknown_lot_count ?? 0)).replace('{units}', String(row.unknown_units ?? 0)))
      else if (reason === 'held_unknown') reasons.push((t('conflict_unknown_cost_held') || '{units} pcs held as damaged with unknown cost').replace('{units}', String(row.held_unknown_units ?? 0)))
    }
  } else {
    reasons.push(kind === 'placeholder_barcode' ? t('conflict_type_placeholder_barcode') || 'Barcode 0' : t('conflict_type_empty_barcode') || 'No barcode')
  }
  const confirmZeroLabel = t('conflict_confirm_zero') || 'Confirm $0 (free)'
  const noBarcodeLabel = t('conflict_mark_no_barcode') || 'This product has no barcode'
  const showBarcode = kind !== 'empty_barcode' && row.barcode && row.barcode.trim()
  return (
    <div data-product-data-gap-row={row.id} className="relative flex w-full min-w-0 items-start gap-1 rounded-xl border border-amber-200 bg-amber-50 pr-1.5 dark:border-amber-900/40 dark:bg-amber-950/30">
      {/* A Review-tier decision waits for an admin: the same corner hourglass every queued product change shows. */}
      <PendingReviewTag section="products" entityType="product" ids={[row.id]} className="left-px top-px" />
      <button
        type="button"
        onClick={() => onOpen?.(row.id)}
        disabled={!onOpen}
        aria-label={`${t('product_preview_open') || 'Open product preview'}: ${name}`}
        className="flex min-w-0 flex-1 items-start gap-2 rounded-xl px-3 py-2 text-left transition hover:bg-amber-100 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-amber-950/50"
      >
        <ProductImg src={row.image_path || ''} alt="" className="h-8 w-8 flex-shrink-0 rounded-lg object-cover" />
        <span className="min-w-0 flex-1">
          <span className="block whitespace-normal break-words text-sm font-medium leading-relaxed text-gray-900 [overflow-wrap:anywhere] dark:text-white">{name}</span>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
            {reasons.map((reason) => (
              <span key={reason} className="mr-2 inline-flex items-center gap-1 font-semibold text-amber-800 dark:text-amber-300">
                <ConflictIcon aria-hidden="true" className={`h-3 w-3 shrink-0 ${CONFLICT_ICON_CLASS}`} />
                {reason}
              </span>
            ))}
            {showBarcode ? <span className="mr-2">{row.barcode}</span> : null}
            {row.sku ? <span className="mr-2">{row.sku}</span> : null}
            <span>{Number(row.stock_quantity) || 0} {t('pcs') || 'pcs'}</span>
          </span>
        </span>
      </button>
      {kind === 'unknown_cost' && row.reasons?.includes('zero_unconfirmed') && onConfirmZero ? (
        <button type="button" data-product-data-gap-confirm-zero onClick={() => onConfirmZero(row)} title={confirmZeroLabel} aria-label={confirmZeroLabel}
          className="mt-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-emerald-700 transition hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900/30">
          <BadgeCheck aria-hidden="true" className="h-4 w-4" />
        </button>
      ) : null}
      {kind !== 'unknown_cost' && onMarkNoBarcode ? (
        <button type="button" data-product-data-gap-no-barcode onClick={() => onMarkNoBarcode(row)} title={noBarcodeLabel} aria-label={noBarcodeLabel}
          className="mt-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-600 transition hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/10">
          <Ban aria-hidden="true" className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  )
}
