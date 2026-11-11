import { useCallback, type ReactNode } from 'react'
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3.js'
import Wrench from 'lucide-react/dist/esm/icons/wrench.js'
import ProductImage from '../pos/ProductImage.tsx'
import Modal from '../shared/Modal.tsx'
import { useCopyFloat } from '../shared/CopyFloat.tsx'
import { todayStr } from '../../utils/dateHelpers.ts'
import { fmtDateOnly, fmtDateTime24 } from '../../utils/formatters.ts'
import type { InventoryCheckAccess } from '../../utils/inventoryCheckAccess.ts'
import type { InventoryCheckObservation, InventoryCheckProduct, InventoryCheckTranslator } from '../../types/inventoryChecks.ts'
import type { PromotionRule } from '../../utils/promotionRules.ts'
import { finiteQuantity, signedDelta } from './InventoryCheckCountEditor.tsx'
import { priceFacts } from './inventoryPriceFacts.ts'

type Props = {
  product: InventoryCheckProduct
  /** This product's check in the open session, if any. Its stock figures are present only for viewers who may see stock. */
  observation?: InventoryCheckObservation
  /** The original session product that no longer exists: only its saved snapshot and check remain. */
  unavailable: boolean
  fields: InventoryCheckAccess['fields']
  /** Price rows (selling, wholesale, promotion) for a row that carries prices, in the display currency. Absent: none are drawn. */
  priceText?: (usd: unknown, khr?: unknown) => string
  promotionRules?: readonly PromotionRule[]
  exchangeRate?: number
  t: InventoryCheckTranslator
  onClose: () => void
  /** Fix stock (ic_fix_stock): opens the Set session with the counted quantity. Absent when the viewer may not, or the product has no counted issue. */
  onFixStock?: () => void
  /** Opens this product's sales in Reports. Absent without Sales view. */
  onSales?: () => void
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

/** Everything the count sheet cannot fit on a row: unit, received and expiry dates, check status, note and who checked last. */
export default function InventoryCheckDetailFloat({ product, observation, unavailable, fields, priceText, promotionRules, exchangeRate = 4100, t, onClose, onFixStock, onSales }: Props) {
  const tr = useCallback((key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }, [t])
  const copy = useCopyFloat(tr)
  const barcode = fields.barcode ? product.barcode || product.sku : null
  const now = fields.stock && finiteQuantity(product.quantity) ? product.quantity : null
  const start = fields.stock && observation && finiteQuantity(observation.baseline_quantity) ? observation.baseline_quantity : null
  const counted = observation ? (finiteQuantity(observation.counted_quantity) ? observation.counted_quantity : null) : (finiteQuantity(product.check_counted_quantity) ? product.check_counted_quantity : null)
  const unit = now !== null ? String(product.unit ?? '').trim() : ''
  const received = String(product.latest_received_at ?? '').match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  const expiry = String(product.next_expiry_date ?? '').match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  const expiryDays = expiry ? daysUntil(expiry) : null
  const amber = 'text-amber-700 dark:text-amber-300'
  const state = observation?.state
  const listStatus = !observation ? product.check_status : undefined
  const listLabels = { not_checked: ['inventory_check_status_not_checked', 'Not checked'], in_check: ['inventory_check_status_in_check', 'In check'], ok: ['inventory_check_status_ok', 'Checked OK'], issue: ['inventory_check_issue', 'Issue'] } as const
  const lastBy = product.check_by ? `@${product.check_by}` : ''
  const prices = fields.price && priceText ? priceFacts(product as unknown as Record<string, unknown>, promotionRules, exchangeRate) : null
  const priceRow = (label: string, money: { usd: number; khr: number | null } | null | undefined): [string, ReactNode] | null => money && priceText ? [label, priceText(money.usd, money.khr ?? undefined)] : null

  const rows: Array<[string, ReactNode] | null> = [
    fields.stock ? [tr('inventory_check_current_stock', 'Current stock'), now !== null ? `${now}${unit ? ` ${unit}` : ''}` : '—'] : null,
    start !== null ? [tr('inventory_check_starting_stock', 'Starting stock'), start] : null,
    start !== null && now !== null ? [tr('inventory_check_difference', 'Difference'), <span key="difference" className={now !== start ? amber : undefined}>{signedDelta(now - start)}</span>] : null,
    fields.stock && finiteQuantity(product.damaged_quantity) ? [tr('inventory_check_held', 'Held'), product.damaged_quantity] : null,
    counted !== null ? [tr('inventory_check_counted', 'Counted'), now !== null && counted !== now ? <span key="counted">{counted} <span className={amber}>({signedDelta(counted - now)})</span></span> : counted] : null,
    state ? [tr('inventory_check_state', 'Check status'), <span key="state">{tr(STATE_LABELS[state][0], STATE_LABELS[state][1])}{state === 'issue' && observation?.reason ? <> · <span className={amber}>{observation.reason}</span></> : null}</span>] : null,
    listStatus ? [tr('inventory_check_state', 'Check status'), <span key="status">{tr(listLabels[listStatus][0], listLabels[listStatus][1])}{listStatus === 'issue' && product.check_note ? <> · <span className={amber}>{product.check_note}</span></> : null}</span>] : null,
    listStatus && product.check_at ? [tr('inventory_check_last_checked', 'Last checked'), [lastBy, fmtDateTime24(product.check_at)].filter(Boolean).join(' · ')] : null,
    priceRow(tr('selling_price', 'Selling price'), prices?.selling),
    priceRow(tr('wholesale_price', 'Wholesale price'), prices?.wholesale),
    priceRow(tr('promotion', 'Promotion'), prices?.promotion),
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
    {onFixStock || onSales ? <div className="mt-3 flex min-w-0 items-center justify-end gap-2" data-inventory-check-detail-actions>
      {onSales ? <button type="button" data-check-sales-link onClick={onSales} aria-label={tr('inventory_check_sales_tooltip', 'Sales of this product, last 30 days')} title={tr('inventory_check_sales_tooltip', 'Sales of this product, last 30 days')}
        className="btn-secondary inline-flex h-11 min-h-11 w-11 shrink-0 items-center justify-center rounded-lg p-0 lg:h-10 lg:min-h-10 lg:w-10"><BarChart3 className="h-5 w-5" aria-hidden="true" /></button> : null}
      {onFixStock ? <button type="button" data-check-fix-stock onClick={onFixStock} className="btn-primary inline-flex h-11 min-h-11 shrink-0 items-center gap-1 px-3 text-xs lg:h-10 lg:min-h-10"><Wrench className="h-4 w-4" aria-hidden="true" />{tr('inventory_check_fix_stock', 'Fix stock')}</button> : null}
    </div> : null}
  </Modal>
}
