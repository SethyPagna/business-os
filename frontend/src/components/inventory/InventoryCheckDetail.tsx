import { useCallback, type ReactNode } from 'react'
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3.js'
import Wrench from 'lucide-react/dist/esm/icons/wrench.js'
import ProductDetailModal, { type ProductDetailVisible } from '../products/surfaces/ProductDetailModal.tsx'
import type { EntityNavigate } from '../shared/EntityLink.tsx'
import { calculateProductDiscount } from '../../utils/pricing.ts'
import { fmtDateOnly, fmtDateTime24 } from '../../utils/formatters.ts'
import type { InventoryCheckAccess } from '../../utils/inventoryCheckAccess.ts'
import type { InventoryCheckObservation, InventoryCheckProduct, InventoryCheckTranslator } from '../../types/inventoryChecks.ts'
import type { PromotionRule } from '../../utils/promotionRules.ts'
import { finiteQuantity, signedDelta } from './InventoryCheckCountEditor.tsx'
import { COST_KEYS, costFact, PRICE_KEYS, priceFacts } from './inventoryPriceFacts.ts'

type Props = {
  product: InventoryCheckProduct
  /** This product's check in the open session, if any. Its stock figures are present only for viewers who may see stock. */
  observation?: InventoryCheckObservation
  /** The original session product that no longer exists: only its saved snapshot and check remain. */
  unavailable: boolean
  fields: InventoryCheckAccess['fields']
  /** The rules behind a promotion price (a rule can make a price the product's own discount does not). */
  promotionRules?: readonly PromotionRule[]
  exchangeRate?: number
  /** Money in the display currency, for the one row this component draws itself (a rule's promotion price). */
  priceText?: (usd: unknown, khr?: unknown) => string
  fmtUSD: (value: unknown) => string
  fmtKHR: (value: unknown) => string
  navigateTo?: EntityNavigate
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
const LIST_LABELS = { not_checked: ['inventory_check_status_not_checked', 'Not checked'], in_check: ['inventory_check_status_in_check', 'In check'], ok: ['inventory_check_status_ok', 'Checked OK'], issue: ['inventory_check_issue', 'Issue'] } as const

/** The fields of the Inventory row that ProductDetailModal reads, in the shape it reads them. Only what the viewer's grants left on the row crosses: nothing is guessed, nothing is re-read. */
export function detailRecord(product: InventoryCheckProduct, fields: InventoryCheckAccess['fields']): Record<string, unknown> {
  const row = product as unknown as Record<string, unknown>
  const record: Record<string, unknown> = {
    id: product.id, name: product.name, sku: product.sku ?? undefined, barcode: product.barcode ?? undefined, category: product.category ?? undefined, brand: product.brand ?? undefined,
    unit: product.unit ?? undefined, image_path: product.image_path ?? undefined,
    stock_quantity: fields.stock && finiteQuantity(product.quantity) ? product.quantity : undefined,
    expiry_date: fields.received && product.next_expiry_date ? String(product.next_expiry_date).slice(0, 10) : undefined,
  }
  for (const key of [...PRICE_KEYS, ...COST_KEYS]) if (Object.hasOwn(row, key)) record[key] = row[key]
  return record
}

/** What the viewer may see on this record: a field the grants cut, or the row never carried, is not drawn at all (the modal would print a false 0 or $0). */
export function detailVisibility(product: InventoryCheckProduct, fields: InventoryCheckAccess['fields']): ProductDetailVisible {
  const row = product as unknown as Record<string, unknown>
  return {
    stock: fields.stock && finiteQuantity(product.quantity),
    price: fields.price && Object.hasOwn(row, 'selling_price_usd'),
    cost: fields.cost && costFact(row) !== null,
    barcode: fields.barcode, brand: fields.brand, category: fields.category,
  }
}

/**
 * The Inventory product detail: Products' own detail modal (name as the title, brand · category and barcode in the header, coloured prices, cost for a viewer who may see it) with
 * Inventory's facts in its children slot, and its report switched off: opening a product re-reads nothing (no detail report, no stock ledger).
 */
export default function InventoryCheckDetail({ product, observation, unavailable, fields, promotionRules, exchangeRate = 4100, priceText, fmtUSD, fmtKHR, navigateTo, t, onClose, onFixStock, onSales }: Props) {
  const tr = useCallback((key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }, [t])
  const now = fields.stock && finiteQuantity(product.quantity) ? product.quantity : null
  const start = fields.stock && observation && finiteQuantity(observation.baseline_quantity) ? observation.baseline_quantity : null
  const counted = observation ? (finiteQuantity(observation.counted_quantity) ? observation.counted_quantity : null) : (finiteQuantity(product.check_counted_quantity) ? product.check_counted_quantity : null)
  const received = String(product.latest_received_at ?? '').match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  const amber = 'text-amber-700 dark:text-amber-300'
  const state = observation?.state
  const listStatus = !observation ? product.check_status : undefined
  const lastBy = product.check_by ? `@${product.check_by}` : ''
  // A promotion the product's own discount does not make (a rule's): the modal draws only the product's own, so this is the one price row Inventory adds, with the same rose tone.
  const row = product as unknown as Record<string, unknown>
  const ruleOnly = fields.price && priceText && !calculateProductDiscount(row).active ? priceFacts(row, promotionRules, exchangeRate).promotion : null

  const rows: Array<[string, ReactNode] | null> = [
    start !== null ? [tr('inventory_check_starting_stock', 'Starting stock'), start] : null,
    start !== null && now !== null ? [tr('inventory_check_difference', 'Difference'), <span key="difference" className={now !== start ? amber : undefined}>{signedDelta(now - start)}</span>] : null,
    fields.stock && finiteQuantity(product.damaged_quantity) ? [tr('inventory_check_held', 'Held'), product.damaged_quantity] : null,
    counted !== null ? [tr('inventory_check_counted', 'Counted'), now !== null && counted !== now ? <span key="counted">{counted} <span className={amber}>({signedDelta(counted - now)})</span></span> : counted] : null,
    state ? [tr('inventory_check_state', 'Check status'), <span key="state">{tr(STATE_LABELS[state][0], STATE_LABELS[state][1])}{state === 'issue' && observation?.reason ? <> · <span className={amber}>{observation.reason}</span></> : null}</span>] : null,
    listStatus ? [tr('inventory_check_state', 'Check status'), <span key="status">{tr(LIST_LABELS[listStatus][0], LIST_LABELS[listStatus][1])}{listStatus === 'issue' && product.check_note ? <> · <span className={amber}>{product.check_note}</span></> : null}</span>] : null,
    listStatus && product.check_at ? [tr('inventory_check_last_checked', 'Last checked'), [lastBy, fmtDateTime24(product.check_at)].filter(Boolean).join(' · ')] : null,
    // The overlay already computes the last recorded stock movement; until now nothing showed it. Only for a viewer who sees stock.
    fields.stock && product.last_change_at ? [tr('inventory_check_last_change', 'Last stock change'), fmtDateTime24(product.last_change_at)] : null,
    ruleOnly && priceText ? [tr('product_discount', 'Discounts'), <span key="promotion" className="text-rose-600 dark:text-rose-300">{priceText(ruleOnly.usd, ruleOnly.khr ?? undefined)}</span>] : null,
    fields.received && received ? [tr('received_date', 'Received date'), fmtDateOnly(received)] : null,
  ]
  const shown = rows.flatMap(entry => entry ? [entry] : [])

  return <ProductDetailModal p={detailRecord(product, fields)} visible={detailVisibility(product, fields)} report={false} fmtUSD={fmtUSD} fmtKHR={fmtKHR} navigateTo={navigateTo} t={key => t(key) ?? undefined} onClose={onClose}>
    {unavailable ? <p className={`mb-2 text-xs leading-relaxed ${amber}`}>{tr('inventory_check_unavailable_member_hint', 'This original product is unavailable. Its saved check remains read-only.')}</p> : null}
    {shown.length ? <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs leading-relaxed" data-inventory-check-detail>
      {shown.flatMap(([label, value]) => [<dt key={`${label}-label`} className="text-gray-500 leading-relaxed">{label}</dt>, <dd key={`${label}-value`} className="min-w-0 break-words text-right font-medium tabular-nums text-gray-800 dark:text-gray-100">{value}</dd>])}
    </dl> : null}
    {onFixStock || onSales ? <div className="mt-3 flex min-w-0 items-center justify-end gap-2" data-inventory-check-detail-actions>
      {onSales ? <button type="button" data-check-sales-link onClick={onSales} aria-label={tr('inventory_check_sales_tooltip', 'Sales of this product, last 30 days')} title={tr('inventory_check_sales_tooltip', 'Sales of this product, last 30 days')}
        className="btn-secondary inline-flex h-11 min-h-11 w-11 shrink-0 items-center justify-center rounded-lg p-0 lg:h-10 lg:min-h-10 lg:w-10"><BarChart3 className="h-5 w-5" aria-hidden="true" /></button> : null}
      {onFixStock ? <button type="button" data-check-fix-stock onClick={onFixStock} className="btn-primary inline-flex h-11 min-h-11 shrink-0 items-center gap-1 px-3 text-xs lg:h-10 lg:min-h-10"><Wrench className="h-4 w-4" aria-hidden="true" />{tr('inventory_check_fix_stock', 'Fix stock')}</button> : null}
    </div> : null}
  </ProductDetailModal>
}
