import { useCallback, type ReactNode } from 'react'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import ProductImage from '../pos/ProductImage.tsx'
import Modal from '../shared/Modal.tsx'
import { useCopyFloat } from '../shared/CopyFloat.tsx'
import { knownCost } from '../../utils/costDisplay.ts'
import { todayStr } from '../../utils/dateHelpers.ts'
import { fmtDateOnly } from '../../utils/formatters.ts'
import { formatUsd4 } from '../../utils/reportMoney.ts'
import type { InventoryCheckAccess } from '../../utils/inventoryCheckAccess.ts'
import type { InventoryCheckObservation, InventoryCheckProduct, InventoryCheckTranslator } from '../../types/inventoryChecks.ts'
import { finiteQuantity, signedDelta } from './InventoryCheckCountEditor.tsx'

type Props = {
  product: InventoryCheckProduct
  /** This product's check in the open session, if any. Its stock figures are present only for viewers who may see stock. */
  observation?: InventoryCheckObservation
  /** The original session product that no longer exists: only its saved snapshot and check remain. */
  unavailable: boolean
  fields: InventoryCheckAccess['fields']
  t: InventoryCheckTranslator
  onClose: () => void
}

const STATE_LABELS = {
  unstarted: ['inventory_check_unstarted', 'Not started'],
  done: ['inventory_check_done', 'Done'],
  issue: ['inventory_check_issue', 'Issue'],
} as const

/** Days from today (Cambodia business day) to a 'YYYY-MM-DD' date; negative once it has passed. */
function daysUntil(day: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${todayStr()}T00:00:00Z`)) / 86400000)
}

/** Everything the count sheet cannot fit on a row: unit, received and expiry dates, status and reason, cost for those allowed to see it. */
export default function InventoryCheckDetailFloat({ product, observation, unavailable, fields, t, onClose }: Props) {
  const tr = useCallback((key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }, [t])
  const copy = useCopyFloat(tr)
  const barcode = fields.barcode ? product.barcode || product.sku : null
  const price = knownCost(product.selling_price_usd), cost = knownCost(product.cost_price_usd)
  const now = fields.stock && finiteQuantity(product.quantity) ? product.quantity : null
  const start = fields.stock && observation && finiteQuantity(observation.baseline_quantity) ? observation.baseline_quantity : null
  const counted = observation && finiteQuantity(observation.counted_quantity) ? observation.counted_quantity : null
  const unit = now !== null ? String(product.unit ?? '').trim() : ''
  const received = String(product.latest_received_at ?? '').match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  const expiry = String(product.next_expiry_date ?? '').match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  const expiryDays = expiry ? daysUntil(expiry) : null
  const amber = 'text-amber-700 dark:text-amber-300'
  const state = observation?.state

  const rows: Array<[string, ReactNode] | null> = [
    fields.stock ? [tr('inventory_check_current_stock', 'Current stock'), now !== null ? `${now}${unit ? ` ${unit}` : ''}` : '—'] : null,
    start !== null ? [tr('inventory_check_starting_stock', 'Starting stock'), start] : null,
    start !== null && now !== null ? [tr('inventory_check_difference', 'Difference'), <span key="difference" className={now !== start ? amber : undefined}>{signedDelta(now - start)}</span>] : null,
    fields.stock && finiteQuantity(product.damaged_quantity) ? [tr('inventory_check_damaged', 'Damaged'), product.damaged_quantity] : null,
    counted !== null ? [tr('inventory_check_counted', 'Counted'), now !== null && counted !== now ? <span key="counted">{counted} <span className={amber}>({signedDelta(counted - now)})</span></span> : counted] : null,
    state ? [tr('inventory_check_state', 'Check status'), <span key="state">{tr(STATE_LABELS[state][0], STATE_LABELS[state][1])}{state === 'issue' && observation?.reason ? <> · <span className={amber}>{observation.reason}</span></> : null}</span>] : null,
    fields.price ? [tr('inventory_check_price', 'Price'), price === null ? '—' : formatUsd4(price)] : null,
    fields.cost ? [tr('inventory_check_cost', 'Cost'), <span key="cost">{cost === null ? '—' : formatUsd4(cost)}{product.cost_needs_review === true ? <span className={`ml-1 ${amber}`}>{tr('merge_cost_needs_review', 'Cost needs review')}</span> : null}</span>] : null,
    fields.sales && finiteQuantity(product.qty_sold) ? [tr('inventory_check_sold', 'Sold'), product.qty_sold] : null,
    fields.customers && finiteQuantity(product.customer_count) ? [tr('inventory_check_customers', 'Customers'), product.customer_count] : null,
    fields.brand ? [tr('brand', 'Brand'), product.brand ? <span key="brand" {...copy(product.brand)}>{product.brand}</span> : '—'] : null,
    fields.category ? [tr('category', 'Category'), product.category || '—'] : null,
    fields.received && received ? [tr('received_date', 'Received date'), fmtDateOnly(received)] : null,
    expiry && expiryDays !== null ? [tr('expiry', 'Expiry'), <span key="expiry" data-expiry={expiryDays < 0 ? 'expired' : expiryDays <= 30 ? 'soon' : 'ok'} className={expiryDays < 0 ? 'text-red-700 dark:text-red-300' : expiryDays <= 30 ? amber : undefined}>
      {fmtDateOnly(expiry)}{expiryDays < 0 ? ` · ${tr('inventory_check_expired', 'Expired')}` : expiryDays <= 30 ? ` · ${tr('inventory_check_expires_soon', 'Expires soon')}` : ''}</span>] : null,
  ]

  return <Modal title={tr('product', 'Product')} onClose={onClose} keyboard size="sm" unsavedChanges="read-only">
    <div className="flex min-w-0 items-center gap-3" data-inventory-check-detail-head>
      <ProductImage src={product.image_path || undefined} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
      <div className="min-w-0 flex-1">
        <p className="min-w-0 break-words text-sm font-semibold leading-snug text-gray-900 dark:text-gray-100" {...copy(product.name)}>{product.name}</p>
        {barcode ? <p className="min-w-0 break-all text-xs leading-relaxed text-gray-500" {...copy(barcode)}>{barcode}</p> : null}
      </div>
    </div>
    {unavailable ? <p className={`mt-2 text-xs leading-relaxed ${amber}`}>{tr('inventory_check_unavailable_member_hint', 'This original product is unavailable. Its saved check remains read-only.')}</p> : null}
    <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs leading-relaxed" data-inventory-check-detail>
      {rows.flatMap(row => row ? [<dt key={`${row[0]}-label`} className="text-gray-500">{row[0]}</dt>, <dd key={`${row[0]}-value`} className="min-w-0 break-words text-right font-medium tabular-nums text-gray-800 dark:text-gray-100">{row[1]}</dd>] : [])}
    </dl>
    {product.stock_consistent === false ? <p className={`mt-3 flex items-start gap-1.5 text-xs leading-relaxed ${amber}`} data-stock-inconsistent>
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{tr('inventory_check_stock_inconsistent_hint', 'Stock records for this product disagree. Check its stock before counting.')}
    </p> : null}
  </Modal>
}
