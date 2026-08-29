// POS
/**
 * Point-of-Sale screen.
 * Sub-components (ProductImage, CartItem) are imported from
 * sibling files.
 *
 * Key features:
 *   - Multiple concurrent orders (tabs) so cashiers can hold up to 6 open orders
 *   - Fully scrollable cart panel
 *   - Collapsible customer and delivery sections
 *   - Inline "add new" modals for customers and delivery contacts
 *   - Receipt shown as an overlay
 *
 * Layout (desktop >= md):  [Products] | [Cart + Payment] side-by-side, full height.
 * Layout (mobile  < md):   Tab bar toggles between Products and Cart views.
 */

import { Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { useDebouncedValue } from '../../utils/useDebouncedValue.ts'
import ImageOff from 'lucide-react/dist/esm/icons/image-off.js'
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart.js'
import { useApp, useSync } from '../../AppContext'
import {
  PAYMENT_METHODS,
  DELIVERY_FEE_PAYER,
  CURRENCY,
  LAYOUT,
  EMPTY_CUSTOMER,
  createEmptyOrder,
} from '../../constants'
import ProductImage from './ProductImage'
import CartItem     from './CartItem'
import PaginationControls, { POS_DEFAULT_PAGE_SIZE } from '../shared/PaginationControls'
import ScanSearchButton from '../shared/ScanSearchButton'
import InfoHint from '../shared/InfoHint'
import { useIsPageActive } from '../shared/pageActivity'
import {
  buildProductsById,
  buildVariantChildrenByParentId,
  buildVisibleProductCards,
  getVariantChoices as getVariantChoicesForProduct,
  resolveCartPriceValues,
  getCartLineId,
  findMatchingCartLineIndex,
  applyManualDiscount,
  computeExpiryStatus,
  repricePromotionCartLines,
  isSaleRecorded,
  findCheckoutBlocker,
  type ManualDiscountType,
} from './posCore.ts'
import { promotionBadgeForProduct, evaluatePromotionPricing, type PromotionRule } from '../../utils/promotionRules.ts'
import { getClientDeviceInfo } from '../../utils/deviceInfo'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import type { QueryParams } from '../../api/query.ts'
import { calculateProductDiscount, normalizePriceValue } from '../../utils/pricing.ts'
import { aggregateInitialOptions } from '../../utils/initials.ts'
import AlphaIndexRail from '../shared/AlphaIndexRail'
import { getKhmerTextProps } from '../../utils/scriptTypography.ts'
import {
  buildProductLightboxState,
  getProductGalleryImages,
} from '../products/helpers/productGalleryHelpers.ts'
import { buildProductSearchTerms } from '../../utils/searchTerms.ts'
import { matchesSearchTermGroups } from '../../utils/searchMatch.ts'
import { toggleMultiValue, toggleMultiValues, matchesMulti, parseMultiValues } from '../../utils/multiSelect.ts'
import { buildProductBrandOptions } from '../products/helpers/productDisplayHelpers.ts'
import { buildProductSupplierOptions } from '../products/helpers/productSupplierOptions.ts'
import { getTrackedBatchProductIds } from '../../api/batchesTransport.ts'
import type { BatchSelection } from '../../api/batchesTransport.ts'
const Receipt = lazyRetry(() => import('../receipt/Receipt'), 'pos-receipt')
const ImageGalleryLightbox = lazyRetry(() => import('../shared/ImageGalleryLightbox'), 'pos-image-gallery-lightbox')
const FilterPanel = lazyRetry(() => import('./FilterPanel'), 'pos-filter-panel')
const ProductDetailSheet = lazyRetry(() => import('./ProductDetailSheet'), 'pos-product-detail-sheet')
const POSQuickAddModals = lazyRetry(() => import('./POSQuickAddModals'), 'pos-quick-add-modals')

const POS_CATALOG_LOAD_TIMEOUT_MS = 15000
const POS_CONTACT_OPTIONS_TIMEOUT_MS = 8000
const POS_FILTER_META_TIMEOUT_MS = 8000
const POS_CATEGORY_OPTIONS_TIMEOUT_MS = 8000
const POS_MEMBERSHIP_LOOKUP_TIMEOUT_MS = 12000
const POS_CUSTOMER_CREATE_TIMEOUT_MS = 12000
const POS_DELIVERY_CREATE_TIMEOUT_MS = 12000
// Y2: 20s produced FALSE failures -- a Worker busy with an import apply can
// take longer than that to commit a sale, so the client reported an error
// while the sale landed (the user hit exactly this). The write is deduped
// server-side by client_request_id, so a longer wait + a safe-retry message
// beats a short race that lies about the outcome.
const POS_CHECKOUT_TIMEOUT_MS = 45000
import type { ContactOption } from '../contacts/contactOptionUtils'
// P7-a: quick-add saves through the SAME option serialization the full
// contact forms use, so a quick-added contact's phone/name/address land as a
// proper primary option row (editable later in the full form) instead of a
// bare string in the address column.
import { createContactOption, serializeContactOptions } from '../contacts/contactOptionUtils'

type ContactOptionUtilsModule = typeof import('../contacts/contactOptionUtils')

let contactOptionUtilsModulePromise: Promise<ContactOptionUtilsModule> | null = null

type PosSaleStatus = 'completed' | 'awaiting_payment' | 'awaiting_delivery'

const POS_STATUS_LABELS: Record<PosSaleStatus, string> = {
  completed: 'Completed',
  awaiting_payment: 'Awaiting Payment',
  awaiting_delivery: 'Awaiting Delivery',
}

const POS_STATUS_TRANSLATION_KEYS: Record<PosSaleStatus, string> = {
  completed: 'status_completed',
  awaiting_payment: 'status_awaiting_payment',
  awaiting_delivery: 'status_awaiting_delivery',
}

function getPosStatusLabel(status: PosSaleStatus, t?: (key: string) => string): string {
  const key = POS_STATUS_TRANSLATION_KEYS[status]
  const translated = typeof t === 'function' ? t(key) : ''
  return translated && translated !== key ? translated : POS_STATUS_LABELS[status]
}

function loadContactOptionUtilsModule(): Promise<ContactOptionUtilsModule> {
  if (!contactOptionUtilsModulePromise) contactOptionUtilsModulePromise = import('../contacts/contactOptionUtils')
  return contactOptionUtilsModulePromise
}

type AppSettings = Record<string, unknown> & {
  customer_portal_redeem_points?: string | number
  customer_portal_redeem_value_khr?: string | number
  customer_portal_redeem_value_usd?: string | number
  language?: string
  pos_payment_methods?: string
  product_brand_options?: string
  tax_rate?: string | number
}

type AppContextValue = {
  exchangeRate: number
  fmtKHR: (value: unknown) => string
  fmtUSD: (value: unknown) => string
  khrSymbol: string
  notify: (message: unknown, type?: string, duration?: number) => void
  settings: AppSettings
  t: (key: string) => string
  usdSymbol: string
  user: { id?: string | number; name?: string } | null
}

type SyncContextValue = {
  syncChannel?: { channel?: string; ts?: unknown } | null
}

async function parseContactOptions(raw: unknown): Promise<ContactOption[]> {
  const { parseStoredContactOptions } = await loadContactOptionUtilsModule()
  return parseStoredContactOptions(raw, { legacyField: 'address' })
}

type BranchRecord = {
  id: string | number
  is_active?: boolean
  is_default?: boolean
  name: string
}

type CategoryRecord = {
  color?: string
  id?: string | number
  name: string
}

type BranchStockRecord = {
  branch_id?: string | number
  quantity?: string | number
}

type ProductGroupMeta = {
  groupKind?: string
  hasExplicitGroup?: boolean
  hasMultipleItems?: boolean
  maxSellingPriceUsd?: number
  minSellingPriceUsd?: number
  stockTotal?: number
}

type ProductRecord = Record<string, unknown> & {
  __displayName?: string
  __groupChoices?: ProductRecord[]
  __groupKey?: string
  __groupMeta?: ProductGroupMeta
  __variantLabel?: string
  applied_price_khr?: number
  applied_price_usd?: number
  barcode?: string
  branch_id?: string | number | null
  branch_stock?: BranchStockRecord[]
  brand?: string
  cart_line_id?: string
  category?: string
  cost_price_khr?: string | number
  cost_price_usd?: string | number
  description?: string
  discount_label?: string
  tag_label?: string | null
  // Flat, non-batch expiry tracking -- distinct from the per-lot expiry
  // carried by the batch/lot system. See ProductDetailSheet.tsx.
  expiry_date?: string | null
  expiry_alert_days?: string | number
  id: string | number
  image_gallery?: string | string[]
  image_path?: string
  // D1 stores this as INTEGER 0/1, so it arrives as a number over the wire
  // even though `boolean` alone type-checked -- the mismatch is why the
  // `is_active !== 0` guard below needs the wider type to be honest.
  is_active?: boolean | number
  is_group?: boolean
  low_stock_threshold?: string | number
  name: string
  out_of_stock_threshold?: string | number
  parent_id?: string | number | null
  price_mode?: string
  product_discount_khr?: number
  product_discount_label?: string
  product_discount_type?: string | null
  product_discount_usd?: number
  purchase_price_khr?: string | number
  purchase_price_usd?: string | number
  quantity?: number
  selling_price_khr?: string | number
  selling_price_usd?: string | number
  sku?: string
  special_price_khr?: string | number
  special_price_usd?: string | number
  stock_quantity?: string | number
  supplier?: string
  unit?: string
}

type CartLineRecord = ProductRecord & {
  applied_price_khr: number
  applied_price_usd: number
  // Price before any manual, cashier-entered discount -- the resolved
  // selling/special/promotion price. See posCore.ts's applyManualDiscount.
  base_price_usd?: number
  base_price_khr?: number
  manual_discount_type?: 'percent' | 'fixed' | null
  manual_discount_value?: number
  manual_discount_usd?: number
  manual_discount_khr?: number
  cart_line_id: string
  id: string | number
  name: string
  quantity: number
  // Present only when this line was added via the batch/expiry picker (see
  // ProductDetailSheet) -- the specific lot picked, and that lot's
  // remaining stock at pick time, used as this line's quantity ceiling
  // instead of the product's overall stock (see getDisplayStock/updateQty).
  batch_id?: number | null
  batch_label?: string | null
  batch_expiry_date?: string | null
  batch_available_quantity?: number
  // 11.9: this line draws from a damaged lot -- capped by that lot's
  // quantity_remaining, and the checkout sends damaged_lot_id so the
  // server consumes the LOT, never branch/batch stock.
  damaged_lot_id?: number | null
  damaged_lot_label?: string | null
  damaged_available_quantity?: number
}

type CustomerRecord = Record<string, unknown> & {
  address?: string
  email?: string
  id?: string | number | null
  membership_number?: string
  name: string
  phone?: string
}

type DeliveryContactRecord = Record<string, unknown> & {
  address?: string
  area?: string
  id?: string | number | null
  name: string
  phone?: string
}

type CustomerOption = {
  address?: string
  email?: string
  label?: string
  name?: string
  phone?: string
}

type CustomerFormState = {
  address: string
  membership_number: string
  name: string
  phone: string
}

type DeliveryFormState = {
  area: string
  name: string
  phone: string
}

type PosOrder = Record<string, unknown> & {
  cart: CartLineRecord[]
  customPayment?: boolean
  customer: CustomerRecord & {
    _baseCustomer?: CustomerRecord
    _optionLabel?: string
    _rawOptions?: string
  }
  customerSearch: string
  deliveryFeePaidBy: string
  deliveryFeeUsd: string
  deliveryActualCostUsd: string
  deliverySearch: string
  discountKhr: string
  discountUsd: string
  // Added alongside discountUsd/discountKhr for the percent-of-subtotal
  // discount mode (see discUsd/discKhr below) -- discountType defaults to
  // 'fixed' so existing carts/orders that never set it keep behaving
  // exactly as the USD/KHR fields already did.
  discountType: 'fixed' | 'percent'
  discountPercent: string
  id: string
  isDelivery: boolean
  label?: string
  // Whether this sale EARNS loyalty points. Optional with "on" semantics
  // (only an explicit false turns accrual off), so carts persisted before
  // the field existed keep the long-standing always-accrue behavior.
  loyaltyAccrual?: boolean
  membershipDiscountKhr: string
  membershipDiscountUsd: string
  membershipRedeemUnits: string
  paidKhr: string
  paidUsd: string
  // Y12: actual change handed back per currency (see constants.ts PosOrder).
  changeGivenUsd: string
  changeGivenKhr: string
  paymentDetails: PaymentDetail[]
  paymentMethod: string
  selectedDelivery: DeliveryContactRecord | null
}

type PaymentDetail = {
  id: string
  method: string
  usd: string
  khr: string
}

type MembershipInfo = {
  customer?: { membership_number?: string }
  points?: { balance?: number }
}

type ProductFilterMeta = {
  brands: string[]
  initials: Array<Record<string, unknown>>
  suppliers: string[]
}

type CatalogLoadOptions = {
  forceMetadata?: boolean
}

type ProductPayload = {
  filters?: Partial<ProductFilterMeta>
  initials?: unknown[]
  items?: ProductRecord[]
  total?: number
  // G1: active promotion rules ride every search/bootstrap payload.
  promotion_rules?: PromotionRule[]
}

// /api/products/bootstrap responds with the same envelope as
// searchProductsPayload() -- items/total/page/pageSize/totalPages -- plus
// filters/initials/branches layered on top. There has never been a
// top-level `products` key here; ProductPayload already models this
// shape (see loadCatalogData's use of payloadRecord.items below), so
// bootstrap's payload just extends it with the branches array.
type ProductBootstrapPayload = ProductPayload & {
  branches?: BranchRecord[]
}

type SaleResult = {
  error?: string
  id?: string | number
  receipt_number?: string
  receiptNumber?: string
  success?: boolean
}

type ImageLightboxState = {
  images: string[]
  index: number
  title: string
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeCategory(category: unknown): CategoryRecord | null {
  if (typeof category === 'string') {
    const name = category.trim()
    return name ? { name } : null
  }
  if (!isPlainRecord(category)) return null
  const name = String(category.name || '').trim()
  if (!name) return null
  return {
    color: typeof category.color === 'string' ? category.color : undefined,
    id: typeof category.id === 'string' || typeof category.id === 'number' ? category.id : name,
    name,
  }
}

let productReadTransportPromise: Promise<typeof import('../../api/productReadTransport.ts')> | null = null
let lookupTransportPromise: Promise<typeof import('../../api/lookupTransport.ts')> | null = null
let contactReadTransportPromise: Promise<typeof import('../../api/contactReadTransport.ts')> | null = null
let contactWriteTransportPromise: Promise<typeof import('../../api/contactWriteTransport.ts')> | null = null
let portalTransportPromise: Promise<typeof import('../../api/portalTransport.ts')> | null = null
let saleWriteTransportPromise: Promise<typeof import('../../api/saleWriteTransport.ts')> | null = null

function getProductReadTransport(): Promise<typeof import('../../api/productReadTransport.ts')> {
  if (!productReadTransportPromise) productReadTransportPromise = import('../../api/productReadTransport.ts')
  return productReadTransportPromise
}

function getLookupTransport(): Promise<typeof import('../../api/lookupTransport.ts')> {
  if (!lookupTransportPromise) lookupTransportPromise = import('../../api/lookupTransport.ts')
  return lookupTransportPromise
}

function getContactReadTransport(): Promise<typeof import('../../api/contactReadTransport.ts')> {
  if (!contactReadTransportPromise) contactReadTransportPromise = import('../../api/contactReadTransport.ts')
  return contactReadTransportPromise
}

function getContactWriteTransport(): Promise<typeof import('../../api/contactWriteTransport.ts')> {
  if (!contactWriteTransportPromise) contactWriteTransportPromise = import('../../api/contactWriteTransport.ts')
  return contactWriteTransportPromise
}

function getPortalTransport(): Promise<typeof import('../../api/portalTransport.ts')> {
  if (!portalTransportPromise) portalTransportPromise = import('../../api/portalTransport.ts')
  return portalTransportPromise
}

function getSaleWriteTransport(): Promise<typeof import('../../api/saleWriteTransport.ts')> {
  if (!saleWriteTransportPromise) saleWriteTransportPromise = import('../../api/saleWriteTransport.ts')
  return saleWriteTransportPromise
}

async function loadPosProductBootstrap(query: QueryParams): Promise<ProductBootstrapPayload> {
  const { getProductBootstrap } = await getProductReadTransport()
  return getProductBootstrap(query) as Promise<ProductBootstrapPayload>
}

async function searchPosCatalogProducts(query: QueryParams): Promise<ProductPayload | ProductRecord[]> {
  const { searchProducts } = await getProductReadTransport()
  return searchProducts(query) as Promise<ProductPayload | ProductRecord[]>
}

async function loadPosProductFilters(query: QueryParams = {}): Promise<Partial<ProductFilterMeta>> {
  const { getProductFilters } = await getProductReadTransport()
  return getProductFilters(query) as Promise<Partial<ProductFilterMeta>>
}

async function loadPosCategories(): Promise<unknown[]> {
  const { getCategories } = await getLookupTransport()
  return getCategories() as Promise<unknown[]>
}

async function loadPosCustomers(): Promise<CustomerRecord[]> {
  const { getCustomers } = await getContactReadTransport()
  return getCustomers() as Promise<CustomerRecord[]>
}

async function loadPosDeliveryContacts(): Promise<DeliveryContactRecord[]> {
  const { getDeliveryContacts } = await getContactReadTransport()
  return getDeliveryContacts() as Promise<DeliveryContactRecord[]>
}

async function createPosCustomer(payload: CustomerFormState & { confirmDuplicate?: boolean }): Promise<Partial<CustomerRecord>> {
  const { createCustomer } = await getContactWriteTransport()
  return createCustomer(payload) as Promise<Partial<CustomerRecord>>
}

async function createPosDeliveryContact(payload: DeliveryFormState & { confirmDuplicate?: boolean; address?: string }): Promise<Partial<DeliveryContactRecord>> {
  const { createDeliveryContact } = await getContactWriteTransport()
  return createDeliveryContact(payload) as Promise<Partial<DeliveryContactRecord>>
}

async function lookupPosPortalMembership(membershipNumber: string): Promise<MembershipInfo | null> {
  const { lookupPortalMembership } = await getPortalTransport()
  return lookupPortalMembership(membershipNumber) as Promise<MembershipInfo | null>
}

async function createPosSale(payload: Record<string, unknown>): Promise<SaleResult> {
  const { createSale } = await getSaleWriteTransport()
  return createSale(payload) as Promise<SaleResult>
}

function normalizeOrder(order: Partial<PosOrder> = {}, fallbackIndex = 1): PosOrder {
  const base = createEmptyOrder(fallbackIndex) as PosOrder
  const legacyDetail: PaymentDetail = {
    id: `payment-${fallbackIndex}-1`,
    method: String(order.paymentMethod || base.paymentMethod || 'Cash'),
    usd: String(order.paidUsd || ''),
    khr: String(order.paidKhr || ''),
  }
  const paymentDetails = Array.isArray(order.paymentDetails) && order.paymentDetails.length
    ? order.paymentDetails.map((detail, index) => ({
        id: String(detail?.id || `payment-${fallbackIndex}-${index + 1}`),
        method: String(detail?.method || base.paymentMethod || 'Cash'),
        usd: String(detail?.usd || ''),
        khr: String(detail?.khr || ''),
      }))
    : [legacyDetail]
  return {
    ...base,
    ...order,
    cart: Array.isArray(order.cart) ? order.cart : base.cart,
    customer: { ...base.customer, ...(order.customer || {}) },
    paymentDetails,
    selectedDelivery: order.selectedDelivery || null,
  }
}

function getErrorMessage(error: unknown, fallback = 'Failed'): string {
  return error instanceof Error ? error.message : fallback
}

function asText(value: unknown): string {
  return String(value || '')
}

function asNumber(value: unknown): number {
  return Number(value || 0)
}

function paymentMethodSummary(details: PaymentDetail[]): string {
  const methods = Array.from(new Set(details.map((detail) => detail.method.trim()).filter(Boolean)))
  return methods.join(' + ') || 'Cash'
}

function ProductDiscountBadge({
  product,
  exchangeRate,
  fmtUSD,
  label = 'Discounts',
  promotionRules = [],
}: {
  exchangeRate: number
  fmtUSD: (value: unknown) => string
  label?: string
  product: ProductRecord
  promotionRules?: readonly PromotionRule[]
}) {
  // G1: one kernel decides what the card advertises -- the product's own
  // discount OR the best promotion rule, including "buy >= X" deals that
  // don't cut the qty-1 price but must still be visible on the card.
  const badge = promotionBadgeForProduct(product, promotionRules)
  if (!badge.active) return null
  const text = badge.kind === 'quantity_hint'
    ? ((badge.show_title && badge.title) || `${label} ${badge.min_quantity}+`)
    : `${(badge.show_title && badge.title) || String(product?.discount_label || '') || label} ${fmtUSD(evaluatePromotionPricing(product, 1, promotionRules, exchangeRate).unit_price_usd || 0)}`
  return (
    <span className="absolute bottom-1 left-1 right-1 z-10 truncate rounded-md px-1.5 py-0.5 text-center text-[10px] font-bold text-white shadow-sm" style={{ backgroundColor: badge.badge_color || '#e11d48' }} title={text}>
      {text}
    </span>
  )
}
export default function POS() {
  const { t, user, notify, settings, fmtUSD, fmtKHR, usdSymbol, khrSymbol, exchangeRate } = useApp() as AppContextValue
  const { syncChannel } = useSync() as SyncContextValue
  const isActive = useIsPageActive('pos')
  const posCopy = useCallback((en: string, km = en) => ((settings.language || 'en') === 'km' ? km : en), [settings.language])

// Remote data shared across all orders
  const [products,         setProducts]         = useState<ProductRecord[]>([])
  // G1: active promotion rules, refreshed with every catalog payload (the
  // search/bootstrap responses carry them) -- POS offline inherits the
  // last cached payload's rules the same way it inherits its products.
  const [promotionRules,   setPromotionRules]   = useState<PromotionRule[]>([])
  const [categories,       setCategories]       = useState<CategoryRecord[]>([])
  const [branches,         setBranches]         = useState<BranchRecord[]>([])
  const [customers,        setCustomers]        = useState<CustomerRecord[]>([])
  const [deliveryContacts, setDeliveryContacts] = useState<DeliveryContactRecord[]>([])
  const [defaultBranchId,  setDefaultBranchId]  = useState<string | number | null>(null)

// Product filter state is persisted in sessionStorage so navigation does not reset it
  // Persisted in sessionStorage like the other pos_* filters below --
  // was plain useState(''), so a full page reload (e.g. AppContext.tsx's
  // runtime-mismatch auto-reload on a fresh backend deploy) silently threw
  // away whatever the person had typed, while every OTHER filter dimension
  // survived the same reload. Reported as "sometimes it causes the page to
  // refresh thus losing search results".
  const [search,          setSearch]          = useState(() => sessionStorage.getItem('pos_search') || '')
  // AND/OR toggle restored (Aug 20 2026) -- no longer a standalone button
  // next to the search box (that's still gone, per the Aug 19 2026 UI
  // request), but reachable again from inside the Filter menu itself, via
  // buildSearchModeFilterSection (components/shared/SearchModeFilterOptions.tsx).
  // AND stays the default, matching the initial state below.
  const [searchMode, setSearchMode] = useState<'AND' | 'OR'>('AND')
  const [categoryFilter,  setCategoryFilter]  = useState(() => sessionStorage.getItem('pos_cat')      || 'all')
  const [brandFilter,     setBrandFilter]     = useState(() => sessionStorage.getItem('pos_brand')    || 'all')
  const [branchFilter,    setBranchFilter]    = useState(() => sessionStorage.getItem('pos_branch')   || 'all')
  const [stockFilter,     setStockFilter]     = useState(() => sessionStorage.getItem('pos_stock')    || 'all')
  const [groupFilter,     setGroupFilter]     = useState(() => sessionStorage.getItem('pos_group')    || 'all')
  const [supplierFilter,  setSupplierFilter]  = useState(() => sessionStorage.getItem('pos_supplier') || 'all')
  const [initialFilter,   setInitialFilter]   = useState(() => sessionStorage.getItem('pos_initial')  || 'all')
  const [filterOpen,      setFilterOpen]      = useState(false)

  const [productPage, setProductPage] = useState(1)
  const [productPageSize, setProductPageSize] = useState(POS_DEFAULT_PAGE_SIZE)
  const [productTotal, setProductTotal] = useState(0)
  const [productFilterMeta, setProductFilterMeta] = useState<ProductFilterMeta>({ brands: [], suppliers: [], initials: [] })
  const [catalogRefreshing, setCatalogRefreshing] = useState(false)
  // Surfaced when loadCatalogData's fetch actually fails (auth hiccup, timeout,
  // server error) -- previously this was only console.error'd, so a real
  // failure and "filters legitimately match nothing" looked identical to the
  // cashier: an empty grid with a generic "No data found" message and no way
  // to tell which one it was or how to recover.
  const [catalogLoadError, setCatalogLoadError] = useState('')
  // Product ids that carry active batch/expiry tracking, scoped to the
  // current branch filter -- see batchesTransport.ts. Drives whether
  // tapping a product forces the detail sheet's batch-picker step (see
  // openProductCard) instead of the normal one-tap/detail-sheet flow.
  const [trackedBatchProductIds, setTrackedBatchProductIds] = useState<Set<number>>(new Set())
  // True when the tracked-ids lookup above actually FAILED, as opposed to
  // legitimately returning nothing. Drives the conservative routing in
  // openProductCard plus a visible warning, so a cashier is never quietly
  // handed a one-tap add for stock that needed a lot chosen.
  const [trackedBatchLoadFailed, setTrackedBatchLoadFailed] = useState(false)
  // Bumped by the warning banner's "Try again" to re-run the lookup effect
  // below without needing the branch filter to change.
  const [batchTrackingReloadKey, setBatchTrackingReloadKey] = useState(0)
  // Persist filter changes. Each setter now *toggles* the given value in/out
  // of a comma-joined multi-select set (passing 'all' clears the whole filter).
  const setPersistedCat      = (v: string) => { const next = toggleMultiValue(categoryFilter, v); sessionStorage.setItem('pos_cat',      next); setCategoryFilter(next) }
  // Batch variant of setPersistedCat -- applies one checked/unchecked state
  // to several category values at once (selecting a whole "Main - Sub"
  // hierarchical group from the Category filter in one tap, same as
  // Products/Inventory). See utils/multiSelect.ts's toggleMultiValues and
  // components/shared/CategoryFilterOptions.tsx.
  const setPersistedCatBatch = (values: string[], checked: boolean) => { const next = toggleMultiValues(categoryFilter, values, checked); sessionStorage.setItem('pos_cat', next); setCategoryFilter(next) }
  const setPersistedBrand    = (v: string) => { const next = toggleMultiValue(brandFilter,    v); sessionStorage.setItem('pos_brand',    next); setBrandFilter(next) }
  const setPersistedBranch   = (v: string) => { const next = toggleMultiValue(branchFilter,   v); sessionStorage.setItem('pos_branch',   next); setBranchFilter(next) }
  const setPersistedStock    = (v: string) => { const next = toggleMultiValue(stockFilter,    v); sessionStorage.setItem('pos_stock',    next); setStockFilter(next) }
  const setPersistedGroup    = (v: string) => { const next = toggleMultiValue(groupFilter,    v); sessionStorage.setItem('pos_group',    next); setGroupFilter(next) }
  const setPersistedSupplier = (v: string) => { const next = toggleMultiValue(supplierFilter, v); sessionStorage.setItem('pos_supplier', next); setSupplierFilter(next) }
  const setPersistedInitial  = (v: string) => { sessionStorage.setItem('pos_initial',  v); setInitialFilter(v) }
  // A stale filter value (e.g. a category/brand/supplier that was renamed or
  // deleted, or an old branch selection) silently matches zero products
  // server-side forever, since these persist in sessionStorage across visits
  // -- and nothing else here re-validates them against the live catalog. This
  // resets every filter dimension in one action so a cashier isn't stuck
  // hunting for which one is the culprit.
  const clearAllPosFilters = () => {
    setSearch('')
    ;['pos_cat', 'pos_brand', 'pos_branch', 'pos_stock', 'pos_group', 'pos_supplier', 'pos_initial', 'pos_search'].forEach((key) => sessionStorage.removeItem(key))
    setCategoryFilter('all')
    setBrandFilter('all')
    setBranchFilter('all')
    setStockFilter('all')
    setGroupFilter('all')
    setSupplierFilter('all')
    setInitialFilter('all')
  }
// Multi-order state
  // Restore orders from sessionStorage so navigating away and back preserves
  // all open orders, carts, customer info, and delivery details.
  const [orders, setOrders] = useState<PosOrder[]>(() => {
    try {
      const saved = sessionStorage.getItem('bos_pos_orders')
      if (saved) {
        const parsed = JSON.parse(saved) as unknown
        if (Array.isArray(parsed) && parsed.length) return parsed.map((order, index) => normalizeOrder(order as Partial<PosOrder>, index + 1))
      }
    } catch {}
    return [normalizeOrder({}, 1)]
  })
  const [activeId, setActiveId] = useState<string | null>(() => {
    try {
      const saved = sessionStorage.getItem('bos_pos_active')
      if (saved) return saved
    } catch {}
    return null
  })
  const [orderCounter, setOrderCounter] = useState(() => {
    try { return parseInt(sessionStorage.getItem('bos_pos_counter') || '2', 10) } catch { return 2 }
  })

  // The currently visible order. Derived, not stored separately.
  const resolvedActiveId = activeId && orders.find(o => o.id === activeId) ? activeId : orders[0]?.id
  const active = orders.find(o => o.id === resolvedActiveId) || orders[0] || normalizeOrder({}, 1)

// Sync payment method default when settings load
  useEffect(() => {
    if (!settings.pos_payment_methods) return
    try {
      const methods = JSON.parse(settings.pos_payment_methods)
      if (!methods.length) return
      const firstMethod = methods[0]
      // Update any orders still on the hardcoded 'Cash' default
      setOrders(prev => prev.map(o =>
        o.paymentMethod === 'Cash' && !o.customPayment && !o.cart.length
          ? {
              ...o,
              paymentMethod: firstMethod,
              paymentDetails: o.paymentDetails.map((detail) => ({
                ...detail,
                method: detail.method === 'Cash' ? firstMethod : detail.method,
              })),
            }
          : o
      ))
    } catch {}
  }, [settings.pos_payment_methods]) // eslint-disable-line

  // Persist whenever orders or activeId change
  useEffect(() => {
    try { sessionStorage.setItem('bos_pos_orders', JSON.stringify(orders)) } catch {}
  }, [orders])
  useEffect(() => {
    try { if (resolvedActiveId) sessionStorage.setItem('bos_pos_active', resolvedActiveId) } catch {}
  }, [resolvedActiveId])
  useEffect(() => {
    try { sessionStorage.setItem('bos_pos_counter', String(orderCounter)) } catch {}
  }, [orderCounter])

  /** Apply a partial update to the active order. Mirrors React's setState signature. */
  const patchActive = useCallback((patch: Partial<PosOrder>) => {
    setOrders(prev => prev.map(o => o.id === resolvedActiveId ? { ...o, ...patch } : o))
  }, [resolvedActiveId])

  const addNewOrder = () => {
    if (orders.length >= LAYOUT.MAX_CONCURRENT_ORDERS) {
      notify(`Maximum ${LAYOUT.MAX_CONCURRENT_ORDERS} open orders at once`, 'info')
      return
    }
    const nextNum = orders.length + 1
    const newOrder = normalizeOrder(createEmptyOrder(nextNum) as Partial<PosOrder>, nextNum)
    setOrders(prev => [...prev, newOrder])
    setActiveId(newOrder.id)
    setOrderCounter(nextNum + 1)
  }

  const closeOrder = (orderId: string) => {
    if (orders.length === 1) {
      const reset = normalizeOrder({}, 1)
      setOrders([reset])
      setActiveId(reset.id)
      setOrderCounter(2)
      return
    }
    const idx = orders.findIndex(o => o.id === orderId)
    const remaining = orders.filter(o => o.id !== orderId)
    // Renumber labels sequentially so tabs always show Order 1, 2, 3...
    const renumbered = remaining.map((o, i) => ({ ...o, label: `Order ${i + 1}` }))
    setOrders(renumbered)
    setOrderCounter(renumbered.length + 1)
    if (resolvedActiveId === orderId) setActiveId(renumbered[Math.max(0, idx - 1)].id)
  }

// Collapsible section visibility
  const [showCustomer,  setShowCustomer]  = useState(false)
  const [showDelivery,  setShowDelivery]  = useState(false)

  // Auto-open the relevant section when the active order already has data
  useEffect(() => {
    if (active?.customer?.name)  setShowCustomer(true)
    if (active?.isDelivery)      setShowDelivery(true)
  }, [activeId]) // eslint-disable-line ??intentionally only on tab switch

// Autocomplete suggestions (UI-level, not per-order)
  const [customerSuggestions,  setCustomerSuggestions]  = useState<CustomerRecord[]>([])
  const [deliverySuggestions,  setDeliverySuggestions]  = useState<DeliveryContactRecord[]>([])
  const [showCustomerDrop,     setShowCustomerDrop]     = useState(false)
  const [showDeliveryDrop,     setShowDeliveryDrop]     = useState(false)

// Inline quick-add modals
  const [showAddCustomer,  setShowAddCustomer]  = useState(false)
  const [newCustomerForm,  setNewCustomerForm]  = useState<CustomerFormState>({ name: '', membership_number: '', phone: '', address: '' })
  const [savingCustomer,   setSavingCustomer]   = useState(false)

  const [showAddDelivery,  setShowAddDelivery]  = useState(false)
  const [newDeliveryForm,  setNewDeliveryForm]  = useState<DeliveryFormState>({ name: '', phone: '', area: '' })

// Customer option picker shown after selecting a customer with multiple options
  const [customerOptionsList, setCustomerOptionsList] = useState<ContactOption[]>([])
  const [showOptionPicker,    setShowOptionPicker]    = useState(false)
  const [savingDelivery,   setSavingDelivery]   = useState(false)

// Other UI state
  const [mobileView,       setMobileView]       = useState<'products' | 'cart'>('products')

  // Cart panel content view -- addresses a real user report: the cart
  // panel always showed product line-items and the customer/delivery/
  // discount/payment section as two separately-scrolling regions stacked
  // on top of each other, with no way to focus on just one or the other.
  // 'all' keeps that exact existing behavior (default, so nobody's layout
  // changes unless they actively pick something else). 'products'/'details'
  // let the person collapse to just the section they're working with --
  // each then gets the panel's full height instead of the items list
  // always taking the majority share and the details section always
  // being capped short. Persisted across visits the same way the other
  // POS display toggles (pos_cat, pos_branch, etc.) are.
  const [cartViewMode, setCartViewMode] = useState<'all' | 'products' | 'details'>(
    () => {
      const stored = sessionStorage.getItem('pos_cart_view')
      return stored === 'products' || stored === 'details' ? stored : 'all'
    },
  )
  const setPersistedCartViewMode = (mode: 'all' | 'products' | 'details') => {
    sessionStorage.setItem('pos_cart_view', mode)
    setCartViewMode(mode)
  }

  // Cart panel width -- draggable, persisted (desktop/tablet only; mobile
  // stays on the products/cart tab split above and never uses this). Was
  // previously a fixed width per breakpoint (22rem/26rem/30rem), which
  // meant a cart with many edited line items had no way to get more room
  // without the products panel shrinking to compensate -- this lets the
  // cashier drag the divider once and keep that width across sessions.
  const CART_WIDTH_STORAGE_KEY = 'pos_cart_width_px'
  const CART_WIDTH_DEFAULT_PX = 400   // wider default so a cart with a few
  // edited lines (branch/price/discount rows) doesn't need the drag straight
  // away; was 352 (the old md:w-[22rem] default)
  const CART_WIDTH_MIN_PX = 300
  const CART_WIDTH_MAX_PX = 860       // was 720 -- some cashiers want the cart
  // to take most of the screen while reconciling a large order
  const [cartWidthPx, setCartWidthPx] = useState<number>(() => {
    const stored = Number(window.localStorage.getItem(CART_WIDTH_STORAGE_KEY))
    return Number.isFinite(stored) && stored >= CART_WIDTH_MIN_PX && stored <= CART_WIDTH_MAX_PX
      ? stored
      : CART_WIDTH_DEFAULT_PX
  })
  const [cartResizing, setCartResizing] = useState(false)
  const mainPanelsRef = useRef<HTMLDivElement | null>(null)
  // Tracks whether we're above the md breakpoint, so the drag-resized cart
  // width (a px style, which always wins over the `w-full` class) only
  // ever applies on desktop/tablet -- on mobile the cart is a full-width
  // tab, not a side panel, and must never be squeezed to a fixed px width.
  const [isDesktopViewport, setIsDesktopViewport] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handleChange = () => setIsDesktopViewport(mq.matches)
    mq.addEventListener('change', handleChange)
    return () => mq.removeEventListener('change', handleChange)
  }, [])
  const clampCartWidth = useCallback((px: number) => {
    if (!mainPanelsRef.current) return Math.min(CART_WIDTH_MAX_PX, Math.max(CART_WIDTH_MIN_PX, px))
    // Leave the products panel at least this wide so it never gets
    // squeezed into an unusable sliver when someone drags the cart very wide.
    const PRODUCTS_MIN_PX = 280
    const containerWidth = mainPanelsRef.current.getBoundingClientRect().width
    const maxByContainer = Math.max(CART_WIDTH_MIN_PX, containerWidth - PRODUCTS_MIN_PX)
    return Math.min(CART_WIDTH_MAX_PX, maxByContainer, Math.max(CART_WIDTH_MIN_PX, px))
  }, [])

  const startCartResize = useCallback((clientX: number) => {
    if (!mainPanelsRef.current) return
    const containerRect = mainPanelsRef.current.getBoundingClientRect()
    setCartResizing(true)
    const previousUserSelect = document.body.style.userSelect
    const previousCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    const handleMove = (moveClientX: number) => {
      const nextWidth = clampCartWidth(containerRect.right - moveClientX)
      setCartWidthPx(nextWidth)
    }
    const onMouseMove = (event: MouseEvent) => handleMove(event.clientX)
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches[0]) handleMove(event.touches[0].clientX)
    }
    const stop = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', stop)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', stop)
      document.body.style.userSelect = previousUserSelect
      document.body.style.cursor = previousCursor
      setCartResizing(false)
      setCartWidthPx((current) => {
        window.localStorage.setItem(CART_WIDTH_STORAGE_KEY, String(current))
        return current
      })
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', stop)
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', stop)
    handleMove(clientX)
  }, [clampCartWidth])

  const resetCartWidth = useCallback(() => {
    setCartWidthPx(CART_WIDTH_DEFAULT_PX)
    window.localStorage.setItem(CART_WIDTH_STORAGE_KEY, String(CART_WIDTH_DEFAULT_PX))
  }, [])

  // Re-clamp a stored/dragged width against the window itself resizing
  // (e.g. moving to a smaller monitor, or a browser window shrink) so the
  // products panel never gets pushed to an unusably small width just by
  // the window changing size -- clampCartWidth otherwise only runs live
  // while actively dragging.
  useEffect(() => {
    const handleResize = () => setCartWidthPx((current) => clampCartWidth(current))
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [clampCartWidth])

  const [detailProduct,    setDetailProduct]    = useState<ProductRecord | null>(null)
  const [loading,          setLoading]          = useState(false)
  const [contactOptionsReady, setContactOptionsReady] = useState(false)
  const [filterMetaReady, setFilterMetaReady] = useState(false)
  const [categoryOptionsReady, setCategoryOptionsReady] = useState(false)
  const [showStatusPicker, setShowStatusPicker] = useState(false)
  const [membershipInfo,   setMembershipInfo]   = useState<MembershipInfo | null>(null)
  const [membershipLoading, setMembershipLoading] = useState(false)
  const [membershipError,  setMembershipError]  = useState('')
  const [imageLightbox, setImageLightbox] = useState<ImageLightboxState | null>(null)

  // Completed receipts shown as overlay modals (queue so multiple can stack)
  const [receiptQueue, setReceiptQueue] = useState<Record<string, unknown>[]>([])

  const searchRef = useRef<HTMLInputElement | null>(null)
  const catalogRequestRef = useRef(0)
  const catalogLoadPromiseRef = useRef<Promise<{ prods: ProductRecord[] } | null> | null>(null)
  const pendingCatalogLoadRef = useRef<{ label: string, options?: CatalogLoadOptions } | null>(null)
  const latestLoadCatalogRef = useRef<((label?: string, options?: CatalogLoadOptions) => Promise<{ prods: ProductRecord[] } | null>) | null>(null)
  const catalogMetadataLoadedRef = useRef(false)
  const catalogMetadataScopeRef = useRef('')
  const catalogLoadedOnceRef = useRef(false)
  const categoryOptionsLoadedRef = useRef(false)
  const categoryOptionsRequestRef = useRef(0)
  const filterMetaLoadedRef = useRef(false)
  const filterMetaRequestRef = useRef(0)
  const customerRequestRef = useRef(0)
  const deliveryRequestRef = useRef(0)
  const membershipRequestRef = useRef(0)
  const membershipInfoRef = useRef<MembershipInfo | null>(null)
  const savingCustomerRef = useRef(false)
  const savingDeliveryRef = useRef(false)
  const checkoutInFlightRef = useRef(false)
  // Y2: per-order idempotency key for checkout -- kept across failed/timed-out
  // attempts (so a retry dedupes server-side), cleared on success.
  const checkoutRequestIdsRef = useRef(new Map<string, string>())
  const taxRate   = parseFloat(asText(settings.tax_rate || '0')) / 100
  // Settings > POS Settings > "Show Discount in Cart" (pos_show_item_discount).
  // Unset/anything but the literal string 'false' means shown -- same
  // default-on convention as the notifications toggles in Settings.tsx.
  const showItemDiscountInCart = asText(settings.pos_show_item_discount ?? 'true') !== 'false'
  const redeemPointsStep = Math.max(1, parseInt(asText(settings.customer_portal_redeem_points || '100'), 10) || 100)
  const redeemValueUsdStep = Math.max(0, Math.round(parseFloat(asText(settings.customer_portal_redeem_value_usd || '1')) || 1))
  const rawRedeemValueKhrStep = Math.max(0, Math.round(parseFloat(asText(settings.customer_portal_redeem_value_khr || String(exchangeRate))) || exchangeRate))
  const redeemValueKhrStep = rawRedeemValueKhrStep === 0 ? 0 : Math.max(1000, Math.ceil(rawRedeemValueKhrStep / 1000) * 1000)
  const debouncedProductSearch = useDebouncedValue(search, 180)
  const hasProductDiscoveryQuery = useMemo(
    () => String(debouncedProductSearch || '').trim().length > 0 || initialFilter !== 'all',
    [debouncedProductSearch, initialFilter],
  )
  const productCountLabel = useMemo(() => {
    if (stockFilter === 'all' && !hasProductDiscoveryQuery) return t('products') || 'products'
    if (stockFilter === 'positive' || stockFilter === 'in_stock') return t('products') || 'products'
    if (stockFilter === 'low') return t('low_stock') || 'low-stock products'
    if (stockFilter === 'out' || stockFilter === 'out_of_stock') return t('out_of_stock') || 'out-of-stock products'
    return t('products') || 'products'
  }, [hasProductDiscoveryQuery, stockFilter, t])

  // A row is hidden only when the server explicitly says it is inactive.
  // `is_active === undefined` means "the response didn't carry that column",
  // NOT "this product is archived" -- every product list endpoint already
  // filters `WHERE p.is_active = 1` server-side (routes/products.ts), so
  // anything that arrives here is active by construction and a missing
  // column must not be read as a business value.
  //
  // The old `.filter((p) => p?.is_active)` conflated the two and silently
  // emptied the entire grid whenever a response omitted the column -- which
  // is exactly what a field-restricted role produced (restrictToImageOnly-
  // Fields strips everything outside its allowlist, and `is_active` isn't in
  // it). HTTP 200, no error banner, so POS fell through to the bare "No data
  // found" empty state while the pagination count and A-Z rail still showed
  // real numbers. Reported as "for employees and other roles, i enter pos,
  // and it says No Data Found".
  const applyCatalogProducts = useCallback((prods: ProductRecord[]) => {
    setProducts(Array.isArray(prods) ? prods.filter((product) => product && product.is_active !== 0 && product.is_active !== false) : [])
  }, [])

  const applyCategoryOptions = useCallback((cats: unknown[]) => {
    // Alphabetical by default, same as posBrands (buildProductBrandOptions
    // sorts) and posSuppliers (buildProductSupplierOptions sorts) -- this
    // was the one list still rendering in raw backend order.
    setCategories(
      Array.isArray(cats)
        ? cats.map(normalizeCategory).filter((category): category is CategoryRecord => Boolean(category))
          .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
        : [],
    )
  }, [])

  const applyBranchMetadata = useCallback((brs: BranchRecord[]) => {
    const activeBranches = Array.isArray(brs) ? brs.filter((branch) => branch?.is_active) : []
    setBranches(activeBranches)
    setDefaultBranchId((current) => {
      if (current && activeBranches.some((branch) => Number(branch.id) === Number(current))) {
        return current
      }
      const fallbackBranch = activeBranches.find((branch) => branch.is_default) || activeBranches[0]
      return fallbackBranch ? fallbackBranch.id : null
    })
  }, [])

  const applyProductFilterMeta = useCallback((filters: Record<string, unknown>, fallbackInitials: unknown[] = []) => {
    setProductFilterMeta({
      brands: Array.isArray(filters?.brands) ? filters.brands as string[] : [],
      suppliers: Array.isArray(filters?.suppliers) ? filters.suppliers as string[] : [],
      initials: aggregateInitialOptions((filters?.initials || fallbackInitials) as Array<Record<string, unknown>>),
    })
  }, [])

  useEffect(() => {
    membershipInfoRef.current = membershipInfo
  }, [membershipInfo])

  // Filters are persisted in sessionStorage across visits (see setPersistedBranch
  // etc. above) so a value picked in a previous session -- a branch that's since
  // been deactivated/deleted, a brand/category/supplier that was renamed -- can
  // stick around and silently match zero products *forever*, with no error and
  // no visible reason: the grid just looks permanently empty ("No data found")
  // while server-side counts (alphabet bar, brand/category lists) look fine,
  // because those are computed from the live catalog, not from this stale
  // client-side selection. This re-validates every multi-select filter dimension
  // against what the server actually returned as soon as branches/metadata load,
  // dropping any selected value that no longer exists rather than letting it
  // quietly zero out the grid on every subsequent visit.
  useEffect(() => {
    if (!catalogLoadedOnceRef.current) return
    const activeBranchIds = new Set((branches || []).map((b) => Number(b?.id)))
    const knownBrands = new Set((productFilterMeta.brands || []).map((v) => String(v).toLowerCase()))
    const knownSuppliers = new Set((productFilterMeta.suppliers || []).map((v) => String(v).toLowerCase()))
    const knownCategories = new Set((categories || []).map((c) => String(c?.name || '').toLowerCase()).filter(Boolean))

    const pruneBranch = (raw: string): string => {
      const kept = parseMultiValues(raw).filter((v) => activeBranchIds.has(parseInt(v, 10)))
      return kept.length ? kept.join(',') : 'all'
    }
    const pruneAgainst = (raw: string, known: Set<string>): string => {
      if (!known.size) return raw // metadata for this dimension hasn't loaded yet -- don't guess
      const kept = parseMultiValues(raw).filter((v) => known.has(v.toLowerCase()))
      return kept.length ? kept.join(',') : 'all'
    }

    const nextBranch = pruneBranch(branchFilter)
    if (nextBranch !== branchFilter) {
      sessionStorage.setItem('pos_branch', nextBranch)
      setBranchFilter(nextBranch)
    }
    const nextBrand = pruneAgainst(brandFilter, knownBrands)
    if (nextBrand !== brandFilter) {
      sessionStorage.setItem('pos_brand', nextBrand)
      setBrandFilter(nextBrand)
    }
    const nextSupplier = pruneAgainst(supplierFilter, knownSuppliers)
    if (nextSupplier !== supplierFilter) {
      sessionStorage.setItem('pos_supplier', nextSupplier)
      setSupplierFilter(nextSupplier)
    }
    const nextCategory = pruneAgainst(categoryFilter, knownCategories)
    if (nextCategory !== categoryFilter) {
      sessionStorage.setItem('pos_cat', nextCategory)
      setCategoryFilter(nextCategory)
    }
    // Deliberately only keyed on the *metadata* inputs (branches, brands,
    // suppliers, categories) -- not on the filter values themselves, or this
    // would fight the user's own filter clicks by re-running and "correcting"
    // a value they just picked.
  }, [branches, categories, productFilterMeta.brands, productFilterMeta.suppliers])

  const loadCatalogData = useCallback(async (label = 'POS catalog data', options: CatalogLoadOptions = {}) => {
    if (catalogLoadPromiseRef.current) {
      pendingCatalogLoadRef.current = {
        label,
        options: {
          forceMetadata: Boolean(options.forceMetadata || pendingCatalogLoadRef.current?.options?.forceMetadata),
        },
      }
      return catalogLoadPromiseRef.current
    }
    const requestId = beginTrackedRequest(catalogRequestRef)
    setCatalogRefreshing(true)
    const promise = (async () => {
      try {
        const effectiveStockState = stockFilter === 'all' ? '' : stockFilter
        const productQuery = {
          page: productPage,
          pageSize: productPageSize,
          query: debouncedProductSearch,
          searchMode,
          category: categoryFilter === 'all' ? '' : categoryFilter,
          brand: brandFilter === 'all' ? '' : brandFilter,
          supplier: supplierFilter === 'all' ? '' : supplierFilter,
          branchId: branchFilter === 'all' ? '' : branchFilter,
          stockState: effectiveStockState,
          groupState: groupFilter === 'all' ? '' : groupFilter,
          initial: initialFilter === 'all' ? '' : initialFilter,
          sort: 'name_asc',
          include: 'branch_stock,images,family',
          metadata: '0',
          // Which page is asking. The server gates each surface on that
          // page's OWN permission and only applies the Products-page
          // image-only field restriction to the products surface -- so a
          // Products-page display permission can no longer reach POS. See
          // routes/products.ts's parseProductReadSurface. Declaring a surface
          // cannot escalate: without the `pos` permission this is refused
          // outright rather than silently downgraded.
          surface: 'pos',
        } satisfies QueryParams
        const metadataScope = JSON.stringify([
          productQuery.branchId, productQuery.brand, productQuery.category,
          productQuery.supplier, productQuery.stockState, productQuery.groupState,
        ])
        const scopeChanged = catalogMetadataScopeRef.current !== metadataScope
        const shouldLoadMetadata = Boolean(options.forceMetadata || !catalogMetadataLoadedRef.current || scopeChanged)
        const [productPayload, metadataPayload] = await withLoaderTimeout(
          () => shouldLoadMetadata
            ? loadPosProductBootstrap(productQuery)
              .then((bootstrapPayload) => [
                bootstrapPayload || {},
                Array.isArray(bootstrapPayload?.branches) ? bootstrapPayload.branches : null,
              ] as [ProductPayload | ProductRecord[], BranchRecord[] | null])
            : Promise.all([
              searchPosCatalogProducts(productQuery),
              Promise.resolve(null),
            ]),
          label,
          POS_CATALOG_LOAD_TIMEOUT_MS,
        )
        if (!isTrackedRequestCurrent(catalogRequestRef, requestId)) return null
        const payloadRecord = isPlainRecord(productPayload) ? productPayload : {}
        const prods = Array.isArray(payloadRecord.items)
          ? payloadRecord.items as ProductRecord[]
          : (Array.isArray(productPayload) ? productPayload : [])
        applyCatalogProducts(prods)
        if (Array.isArray(payloadRecord.promotion_rules)) setPromotionRules(payloadRecord.promotion_rules as PromotionRule[])
        setProductTotal(Number(payloadRecord.total ?? prods.length) || 0)
        setCatalogLoadError('')
        catalogLoadedOnceRef.current = true
        if (Array.isArray(metadataPayload)) {
          applyBranchMetadata(metadataPayload as BranchRecord[])
          catalogMetadataLoadedRef.current = true
          catalogMetadataScopeRef.current = metadataScope
          const filters = isPlainRecord(payloadRecord.filters) ? payloadRecord.filters : {}
          applyProductFilterMeta(filters, payloadRecord.initials || [])
        } else if (isPlainRecord(payloadRecord.filters) || Array.isArray(payloadRecord.initials)) {
          applyProductFilterMeta(isPlainRecord(payloadRecord.filters) ? payloadRecord.filters : {}, payloadRecord.initials || [])
        }
        return { prods }
      } catch (error) {
        if (!isTrackedRequestCurrent(catalogRequestRef, requestId)) return null
        console.error('[POS] catalog load failed:', getErrorMessage(error))
        setCatalogLoadError(getErrorMessage(error, posCopy('Could not load products', 'Could not load products')))
        return null
      } finally {
        if (isTrackedRequestCurrent(catalogRequestRef, requestId)) {
          setCatalogRefreshing(false)
        }
      }
    })()
    const wrappedPromise = promise.finally(() => {
      if (catalogLoadPromiseRef.current === wrappedPromise) {
        catalogLoadPromiseRef.current = null
      }
      const pending = pendingCatalogLoadRef.current
      if (pending) {
        pendingCatalogLoadRef.current = null
        queueMicrotask(() => {
          const nextLoad = latestLoadCatalogRef.current || loadCatalogData
          nextLoad(pending.label, pending.options).catch(() => {})
        })
      }
    })
    catalogLoadPromiseRef.current = wrappedPromise
    return wrappedPromise
  }, [applyBranchMetadata, applyCatalogProducts, applyProductFilterMeta, branchFilter, brandFilter, categoryFilter, debouncedProductSearch, groupFilter, initialFilter, productPage, productPageSize, searchMode, stockFilter, supplierFilter])

  useEffect(() => {
    latestLoadCatalogRef.current = loadCatalogData
  }, [loadCatalogData])

  const loadCustomers = useCallback(async (label = 'POS customers') => {
    const requestId = beginTrackedRequest(customerRequestRef)
    try {
      const data = await withLoaderTimeout(() => loadPosCustomers(), label, POS_CONTACT_OPTIONS_TIMEOUT_MS)
      if (!isTrackedRequestCurrent(customerRequestRef, requestId)) return null
      const nextCustomers = Array.isArray(data) ? data : []
      setCustomers(nextCustomers)
      return nextCustomers
    } catch (error) {
      if (!isTrackedRequestCurrent(customerRequestRef, requestId)) return null
      console.error('[POS] customers load failed:', getErrorMessage(error))
      return null
    }
  }, [])

  const loadDeliveryContacts = useCallback(async (label = 'POS delivery contacts') => {
    const requestId = beginTrackedRequest(deliveryRequestRef)
    try {
      const data = await withLoaderTimeout(() => loadPosDeliveryContacts(), label, POS_CONTACT_OPTIONS_TIMEOUT_MS)
      if (!isTrackedRequestCurrent(deliveryRequestRef, requestId)) return null
      const nextContacts = Array.isArray(data) ? data : []
      setDeliveryContacts(nextContacts)
      return nextContacts
    } catch (error) {
      if (!isTrackedRequestCurrent(deliveryRequestRef, requestId)) return null
      console.error('[POS] delivery contacts load failed:', getErrorMessage(error))
      return null
    }
  }, [])

  const loadCategoryOptions = useCallback(async (label = 'POS categories') => {
    if (categoryOptionsLoadedRef.current) return null
    const requestId = beginTrackedRequest(categoryOptionsRequestRef)
    try {
      const data = await withLoaderTimeout(() => loadPosCategories(), label, POS_CATEGORY_OPTIONS_TIMEOUT_MS)
      if (!isTrackedRequestCurrent(categoryOptionsRequestRef, requestId)) return null
      applyCategoryOptions(Array.isArray(data) ? data : [])
      categoryOptionsLoadedRef.current = true
      return Array.isArray(data) ? data : []
    } catch (error) {
      if (!isTrackedRequestCurrent(categoryOptionsRequestRef, requestId)) return null
      console.error('[POS] categories load failed:', getErrorMessage(error))
      // Reported as "no Category filter in the filter menu": on failure,
      // categoryOptionsLoadedRef.current stays false (correct, so a retry
      // is still possible) but categoryOptionsReady was already flipped
      // true to get us into this function in the first place -- without
      // resetting it back to false here, the two effects that drive
      // loadCategoryOptions (both keyed on categoryOptionsReady *changing*
      // to true, not merely being true) would never fire again after one
      // failed attempt, since React bails out of state updates/effects
      // when the value doesn't actually change. That permanently hid the
      // Category section (FilterPanel.tsx only renders it when
      // categories.length > 0) after a single transient error, with
      // nothing in the UI explaining why and no way to recover short of a
      // full page reload. Resetting it here lets the next catalog refresh
      // or filter-panel reopen flip it false -> true again and retry.
      setCategoryOptionsReady(false)
      return null
    }
  }, [applyCategoryOptions])

  const loadMembershipInfo = useCallback(async (
    membershipNumber: string,
    label = 'POS membership lookup',
  ) => {
    const requestId = beginTrackedRequest(membershipRequestRef)
    setMembershipLoading(true)
    setMembershipError('')
    try {
      const data = await withLoaderTimeout(
        () => lookupPosPortalMembership(membershipNumber),
        label,
        POS_MEMBERSHIP_LOOKUP_TIMEOUT_MS,
      )
      if (!isTrackedRequestCurrent(membershipRequestRef, requestId)) return null
      setMembershipInfo(data || null)
      if (!data) setMembershipError(posCopy('Membership not found'))
      return data || null
    } catch (error) {
      if (!isTrackedRequestCurrent(membershipRequestRef, requestId)) return null
      const currentMembershipNumber = String(membershipInfoRef.current?.customer?.membership_number || '').trim().toLowerCase()
      if (currentMembershipNumber && currentMembershipNumber === String(membershipNumber || '').trim().toLowerCase()) {
        setMembershipError('')
        return membershipInfoRef.current
      }
      setMembershipInfo(null)
      setMembershipError(getErrorMessage(error, posCopy('Membership lookup failed')))
      return null
    } finally {
      if (isTrackedRequestCurrent(membershipRequestRef, requestId)) {
        setMembershipLoading(false)
      }
    }
  }, [posCopy])

// Initial data load. NOTE: this effect's dependency array is `[isActive,
// loadCatalogData]`, and `loadCatalogData` is a useCallback that's recreated
// on every filter/search/page change (see its own dependency list above) --
// so despite the "Initial" name/comment, this effect actually re-fires on
// *every* filter change too, which is the intended way this reloads the grid
// whenever a filter changes without needing to list every filter here again.
// The bug was `searchRef.current?.focus()` living in that same body: it ran
// on every one of those re-fires, not just the real initial activation --
// so picking any option in the Groups (or branch/brand/category/stock/
// supplier) filter popover yanked keyboard focus back to the search box on
// every click, which can scroll the input into view and reposition/disrupt
// the still-open filter popover (PortalMenu repositions on scroll) right as
// the user is trying to pick something. Root cause for the reported
// "Groups filter -- not showing, slow, just refreshing" symptom: split the
// one-time focus behavior out into its own effect keyed only on `isActive`,
// so it still runs once when the POS tab opens but no longer fires on every
// subsequent filter-driven reload.
  useEffect(() => {
    if (!isActive) {
      setContactOptionsReady(false)
      setFilterMetaReady(false)
      setCategoryOptionsReady(false)
      invalidateTrackedRequest(catalogRequestRef)
      catalogLoadPromiseRef.current = null
      pendingCatalogLoadRef.current = null
      invalidateTrackedRequest(categoryOptionsRequestRef)
      invalidateTrackedRequest(filterMetaRequestRef)
      invalidateTrackedRequest(customerRequestRef)
      invalidateTrackedRequest(deliveryRequestRef)
      invalidateTrackedRequest(membershipRequestRef)
      setMembershipLoading(false)
      return
    }

    void loadCatalogData('POS catalog')
  }, [isActive, loadCatalogData])

  // Focus the search box once when the POS tab becomes active -- not on
  // every subsequent filter-driven reload above (see that effect's comment).
  // Desktop only, same reasoning as addToCart's refocus below: this is for
  // the physical-keyboard/barcode-scanner workflow, and popping the mobile
  // on-screen keyboard the instant the tab opens (before anyone's tapped
  // the search box themselves) is unwanted there.
  useEffect(() => {
    if (!isActive || !isDesktopViewport) return
    searchRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally
    // keyed only on isActive/isDesktopViewport; refocusing on every
    // loadCatalogData identity change (i.e. every filter/search/page
    // change) is the bug this fixes.
  }, [isActive, isDesktopViewport])

  useEffect(() => {
    if (!isActive) {
      setCategoryOptionsReady(false)
      return undefined
    }
    if (!catalogLoadedOnceRef.current || catalogRefreshing || categoryOptionsLoadedRef.current) return undefined
    setCategoryOptionsReady(true)
    return undefined
  }, [catalogRefreshing, isActive])

  useEffect(() => {
    if (!isActive || !filterOpen || categoryOptionsLoadedRef.current) return
    setCategoryOptionsReady(true)
  }, [filterOpen, isActive])

  useEffect(() => {
    if (!isActive || !categoryOptionsReady || categoryOptionsLoadedRef.current) return
    void loadCategoryOptions('POS initial categories')
  }, [categoryOptionsReady, isActive, loadCategoryOptions])

  useEffect(() => {
    if (!isActive) {
      setContactOptionsReady(false)
      return undefined
    }
    if (!catalogLoadedOnceRef.current || catalogRefreshing) return undefined
    setContactOptionsReady(true)
    return undefined
  }, [catalogRefreshing, isActive])

  useEffect(() => {
    if (!isActive || !contactOptionsReady) return
    void Promise.allSettled([
      loadCustomers('POS initial customers'),
      loadDeliveryContacts('POS initial delivery contacts'),
    ])
  }, [contactOptionsReady, isActive, loadCustomers, loadDeliveryContacts])

  useEffect(() => {
    if (!isActive) {
      setFilterMetaReady(false)
      return undefined
    }
    if (!catalogLoadedOnceRef.current || catalogRefreshing || filterMetaLoadedRef.current) return undefined
    setFilterMetaReady(true)
    return undefined
  }, [catalogRefreshing, isActive])

  useEffect(() => {
    if (!isActive || !filterMetaReady || filterMetaLoadedRef.current) return
    filterMetaLoadedRef.current = true
    const requestId = beginTrackedRequest(filterMetaRequestRef)
    const scopedQuery = {
      branchId: branchFilter === 'all' ? '' : branchFilter,
      brand: brandFilter === 'all' ? '' : brandFilter,
      category: categoryFilter === 'all' ? '' : categoryFilter,
      supplier: supplierFilter === 'all' ? '' : supplierFilter,
      stockState: stockFilter === 'all' ? '' : stockFilter,
      groupState: groupFilter === 'all' ? '' : groupFilter,
    } satisfies QueryParams
    void withLoaderTimeout(() => loadPosProductFilters(scopedQuery), 'POS product filters', POS_FILTER_META_TIMEOUT_MS).then((filters) => {
      if (!isTrackedRequestCurrent(filterMetaRequestRef, requestId)) return
      applyProductFilterMeta(isPlainRecord(filters) ? filters : {}, [])
    }).catch(() => {})
  }, [applyProductFilterMeta, branchFilter, brandFilter, categoryFilter, filterMetaReady, groupFilter, isActive, stockFilter, supplierFilter])

// Sync-push reload when another device changes data
  useEffect(() => {
    if (!isActive || !syncChannel) return
    const { channel } = syncChannel
    if (channel === 'products' || channel === 'branches' || channel === 'categories') {
      filterMetaLoadedRef.current = false
      setFilterMetaReady(false)
      invalidateTrackedRequest(filterMetaRequestRef)
      if (channel === 'categories') {
        categoryOptionsLoadedRef.current = false
        setCategoryOptionsReady(Boolean(filterOpen))
        invalidateTrackedRequest(categoryOptionsRequestRef)
      }
      void loadCatalogData('POS sync catalog', { forceMetadata: channel === 'branches' })
    }
    if (channel === 'inventory' || channel === 'sales' || channel === 'returns') {
      // Stock moved on another device/till (adjustment, transfer, sale, or
      // return) -- refresh so the grid's stock badges/quantities here don't
      // go stale and risk overselling at checkout. Metadata (categories/
      // branches) is unaffected, so no forceMetadata here.
      void loadCatalogData('POS sync stock')
    }
    if (channel === 'customers') {
      void loadCustomers('POS sync customers')
    }
    if (channel === 'deliveryContacts') {
      void loadDeliveryContacts('POS sync delivery contacts')
    }
  }, [filterOpen, isActive, loadCatalogData, loadCustomers, loadDeliveryContacts, syncChannel])

  useEffect(() => () => {
    invalidateTrackedRequest(catalogRequestRef)
    catalogLoadPromiseRef.current = null
    pendingCatalogLoadRef.current = null
    invalidateTrackedRequest(categoryOptionsRequestRef)
    invalidateTrackedRequest(filterMetaRequestRef)
    invalidateTrackedRequest(customerRequestRef)
    invalidateTrackedRequest(deliveryRequestRef)
    invalidateTrackedRequest(membershipRequestRef)
  }, [])

// Customer autocomplete
  useEffect(() => {
    const q = (active?.customerSearch || '').toLowerCase().trim()
    if (!q) { setCustomerSuggestions([]); return }
    setCustomerSuggestions(
      customers
        .filter(c => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q))
        .slice(0, LAYOUT.AUTOCOMPLETE_MAX_RESULTS)
    )
  }, [active?.customerSearch, customers])

// Delivery autocomplete
  useEffect(() => {
    const q = (active?.deliverySearch || '').toLowerCase().trim()
    if (!q) { setDeliverySuggestions([]); return }
    setDeliverySuggestions(
      deliveryContacts
        .filter(d =>
          d.name.toLowerCase().includes(q) ||
          (d.phone || '').includes(q) ||
          (d.area  || '').toLowerCase().includes(q)
        )
        .slice(0, LAYOUT.AUTOCOMPLETE_MAX_RESULTS)
    )
  }, [active?.deliverySearch, deliveryContacts])

  useEffect(() => {
    if (!isActive) {
      invalidateTrackedRequest(membershipRequestRef)
      setMembershipInfo(null)
      setMembershipError('')
      setMembershipLoading(false)
      return
    }

    const membershipNumber = String(active?.customer?.membership_number || '').trim()

    if (!membershipNumber) {
      invalidateTrackedRequest(membershipRequestRef)
      setMembershipInfo(null)
      setMembershipError('')
      setMembershipLoading(false)
      return
    }

    void loadMembershipInfo(membershipNumber, 'POS membership lookup')
  }, [active?.customer?.membership_number, isActive, loadMembershipInfo, syncChannel?.ts])

// Customer actions
  const selectCustomer = async (c: CustomerRecord) => {
    const opts = await parseContactOptions(c.address)
    setCustomerSuggestions([])
    setShowCustomerDrop(false)
    if (opts.length > 1) {
      // Store base customer, then show option picker
      patchActive({
        customer: { id: c.id || null, name: c.name, phone: c.phone || '', address: '', email: c.email || '', membership_number: c.membership_number || '', _rawOptions: c.address || '', _baseCustomer: c },
        customerSearch: c.name,
        membershipDiscountUsd: '',
        membershipDiscountKhr: '',
        membershipRedeemUnits: '',
      })
      setCustomerOptionsList(opts)
      setShowOptionPicker(true)
    } else if (opts.length === 1) {
      // Single option: auto-apply it
      const o = opts[0]
      patchActive({
        customer: {
          id:      c.id || null,
          name:    o.name    || c.name,
          phone:   o.phone   || c.phone   || '',
          email:   o.email   || c.email   || '',
          membership_number: c.membership_number || '',
          address: o.address || '',
          _rawOptions: c.address || '',
          _optionLabel: o.label || '',
        },
        customerSearch: c.name,
        membershipDiscountUsd: '',
        membershipDiscountKhr: '',
        membershipRedeemUnits: '',
      })
      setShowOptionPicker(false)
    } else {
      // No options: use customer top-level data
      patchActive({
        customer: { id: c.id || null, name: c.name, phone: c.phone || '', email: c.email || '', membership_number: c.membership_number || '', address: '' },
        customerSearch: c.name,
        membershipDiscountUsd: '',
        membershipDiscountKhr: '',
        membershipRedeemUnits: '',
      })
      setShowOptionPicker(false)
    }
  }

  const applyCustomerOption = (opt: ContactOption) => {
    patchActive({
      customer: {
        ...active.customer,
        name:    opt.name    || active.customer.name,
        phone:   opt.phone   || active.customer.phone || '',
        email:   opt.email   || active.customer.email || '',
        address: opt.address || '',
        _optionLabel: opt.label || '',
      }
    })
    setShowOptionPicker(false)
    setCustomerOptionsList([])
  }
  const clearCustomer = () => patchActive({
    customer: { ...EMPTY_CUSTOMER },
    customerSearch: '',
    membershipDiscountUsd: '',
    membershipDiscountKhr: '',
    membershipRedeemUnits: '',
  })

  // A create can come back 409 as a duplicate: either a soft "possible
  // duplicate" (same name already uses this phone -- save again to confirm)
  // or a hard "phone conflict" (that phone already belongs to someone
  // else). The POS quick-add used to just surface the raw error and
  // dead-end (11.8: "add new delivery/customer failed"). Now it acts:
  // a possible-duplicate retries once confirmed, and a phone-conflict
  // selects the existing contact instead -- the "create vs select the
  // existing" choice the user asked for, made automatically at checkout.
  const readDuplicateError = (error: unknown): { code: 'possible_duplicate' | 'phone_conflict'; id: number | null; name: string } | null => {
    const e = error as { code?: unknown; duplicate?: { id?: unknown; name?: unknown } } | null
    const code = e?.code
    if (code !== 'possible_duplicate' && code !== 'phone_conflict') return null
    const dup = e?.duplicate || {}
    const id = Number(dup.id)
    return { code, id: Number.isFinite(id) && id > 0 ? id : null, name: String(dup.name || '') }
  }

  const handleAddCustomer = async (confirmDuplicateArg: unknown = false) => {
    // The QuickAddModal save button forwards its click event here, so only
    // an explicit boolean true (from the possible-duplicate retry below)
    // counts as a confirmation -- a MouseEvent must not.
    const confirmDuplicate = confirmDuplicateArg === true
    if (!newCustomerForm.name.trim()) return notify('Name required', 'error')
    if (savingCustomerRef.current) return
    savingCustomerRef.current = true
    setSavingCustomer(true)
    try {
      // P7-a: the typed fields become a real primary option row (the shape
      // the full customer form writes), not a bare address string.
      const customerPayload = {
        ...newCustomerForm,
        address: serializeContactOptions([createContactOption({
          label: 'Default',
          name: newCustomerForm.name.trim(),
          phone: newCustomerForm.phone.trim(),
          address: newCustomerForm.address.trim(),
        })]) || '',
        ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
      }
      const created = await withLoaderTimeout(
        () => createPosCustomer(customerPayload),
        'Create POS customer',
        POS_CUSTOMER_CREATE_TIMEOUT_MS,
      )
      const createdCustomer = {
        ...newCustomerForm,
        ...created,
        id: created?.id || null,
        name: created?.name || newCustomerForm.name,
        membership_number: created?.membership_number || newCustomerForm.membership_number || '',
      }
      notify(t('customer_added'))
      setCustomers(prev => {
        if (!createdCustomer.id) return prev
        const exists = prev.some(customer => String(customer.id) === String(createdCustomer.id))
        return exists ? prev.map(customer => String(customer.id) === String(createdCustomer.id) ? { ...customer, ...createdCustomer } : customer) : [...prev, createdCustomer]
      })
      await selectCustomer(createdCustomer)
      setShowAddCustomer(false)
      setNewCustomerForm({ name: '', membership_number: '', phone: '', address: '' })
      await loadCustomers('POS refresh customers after create')
    } catch (e) {
      const dup = readDuplicateError(e)
      if (dup?.code === 'possible_duplicate' && !confirmDuplicate) {
        // The person deliberately chose "add new"; the backend just wants a
        // confirm that this is a different contact. Retry once, confirmed.
        savingCustomerRef.current = false
        setSavingCustomer(false)
        return handleAddCustomer(true)
      }
      if (dup?.code === 'phone_conflict' && dup.id) {
        // That phone already belongs to someone -- select THEM instead of
        // failing. Refresh the list so the full record is available, then
        // pick it out; fall back to a minimal record if the refresh misses.
        try {
          const refreshed = await loadCustomers('POS select existing after phone conflict') as unknown
          const list = Array.isArray(refreshed) ? refreshed as CustomerRecord[] : customers
          const existing = list.find((customer) => String(customer.id) === String(dup.id))
            || { id: dup.id, name: dup.name, phone: newCustomerForm.phone, address: '', email: '', membership_number: '' } as CustomerRecord
          await selectCustomer(existing)
          setShowAddCustomer(false)
          setNewCustomerForm({ name: '', membership_number: '', phone: '', address: '' })
          notify((t('customer_phone_exists_selected') || 'That phone already belongs to {name} — selected them.').replace('{name}', dup.name))
          return
        } catch {
          // fall through to the generic error below
        }
      }
      notify(getErrorMessage(e), 'error')
    } finally {
      savingCustomerRef.current = false
      setSavingCustomer(false)
    }
  }

// Delivery actions
  const selectDelivery = (d: DeliveryContactRecord) => {
    patchActive({ selectedDelivery: d, deliverySearch: d.name })
    setDeliverySuggestions([])
    setShowDeliveryDrop(false)
  }
  const clearDelivery = () => patchActive({ selectedDelivery: null, deliverySearch: '', deliveryActualCostUsd: '' })

  const handleAddDelivery = async (confirmDuplicateArg: unknown = false) => {
    const confirmDuplicate = confirmDuplicateArg === true
    if (!newDeliveryForm.name.trim() && !newDeliveryForm.phone.trim()) {
      return notify('Driver name or phone is required', 'error')
    }
    if (savingDeliveryRef.current) return
    savingDeliveryRef.current = true
    setSavingDelivery(true)
    try {
      const resolvedDriverName = newDeliveryForm.name.trim() || `Driver ${newDeliveryForm.phone.trim()}`
      const payload = {
        ...newDeliveryForm,
        name: resolvedDriverName,
        // P7-a: same primary-option shape the full delivery form writes
        // (delivery options carry `area` instead of `address`).
        address: serializeContactOptions([createContactOption({
          label: 'Default',
          name: resolvedDriverName,
          phone: newDeliveryForm.phone.trim(),
          area: newDeliveryForm.area.trim(),
        })]) || '',
        ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
      }
      const res = await withLoaderTimeout(
        () => createPosDeliveryContact(payload),
        'Create POS delivery contact',
        POS_DELIVERY_CREATE_TIMEOUT_MS,
      )
      notify('Delivery contact added')
      const created = { ...payload, id: res.id }
      setDeliveryContacts(prev => [...prev, created])
      selectDelivery(created)
      setShowAddDelivery(false)
      setNewDeliveryForm({ name: '', phone: '', area: '' })
    } catch (e) {
      const dup = readDuplicateError(e)
      if (dup?.code === 'possible_duplicate' && !confirmDuplicate) {
        savingDeliveryRef.current = false
        setSavingDelivery(false)
        return handleAddDelivery(true)
      }
      if (dup?.code === 'phone_conflict' && dup.id) {
        // Select the existing driver that already owns this phone.
        const existing = deliveryContacts.find((contact) => String(contact.id) === String(dup.id))
          || { id: dup.id, name: dup.name, phone: newDeliveryForm.phone, area: newDeliveryForm.area } as DeliveryContactRecord
        selectDelivery(existing)
        setShowAddDelivery(false)
        setNewDeliveryForm({ name: '', phone: '', area: '' })
        notify((t('delivery_phone_exists_selected') || 'That phone already belongs to {name} — selected them.').replace('{name}', dup.name))
        return
      }
      notify(getErrorMessage(e), 'error')
    } finally {
      savingDeliveryRef.current = false
      setSavingDelivery(false)
    }
  }

// Product filter: comma-separated terms, AND/OR mode (same as Products page)
  // Built from `debouncedProductSearch` (180ms, the same value that drives
  // loadCatalogData's server fetch below), not a per-keystroke
  // `useDeferredValue` -- previously this re-narrowed the currently loaded
  // grid on every keystroke, so typing visibly shrank the product list one
  // character at a time before the server's actual match set landed
  // (reported as "search results render incrementally / one by one, should
  // only show once all results are in", same fix applied to Products.tsx's
  // equivalent). Tying both to the same debounced value means the grid now
  // updates once, atomically, per settled query.
  const searchTerms = useMemo(() => buildProductSearchTerms(debouncedProductSearch), [debouncedProductSearch])
  // Selected branch ids for the (possibly multi-select) branch filter.
  const branchFilterIds = useMemo(
    () => parseMultiValues(branchFilter).map((v) => parseInt(v, 10)).filter((n) => Number.isFinite(n)),
    [branchFilter],
  )
  // Single-branch context (adding to cart, "display stock for this branch") uses the
  // first selected branch even when several are selected for browsing/filtering.
  const primaryBranchFilterId = branchFilterIds.length ? branchFilterIds[0] : null

  // Which products currently carry active batch/expiry tracking, scoped to
  // the branch filter -- refetched whenever it changes.
  //
  // This is NOT best-effort, despite how it used to read. The old version
  // caught any failure and set an EMPTY set, which the rest of the POS
  // interprets as "no product is batch-tracked" -- so a failed fetch
  // silently removed the lot picker from every product and let
  // batch-tracked stock be sold with no lot chosen, bypassing FIFO/expiry
  // with nothing on screen to say so. "We don't know what's tracked" and
  // "nothing is tracked" are opposite conclusions and must not collapse
  // into the same state.
  //
  // On failure we therefore keep whatever we last knew, raise a flag, and
  // let openProductCard route every product through the detail sheet (the
  // conservative path, where a lot can still be chosen) instead of
  // one-tap add.
  useEffect(() => {
    let cancelled = false
    getTrackedBatchProductIds(primaryBranchFilterId ?? undefined).then((res) => {
      if (cancelled) return
      setTrackedBatchProductIds(new Set((res?.productIds || []).map((id) => Number(id))))
      setTrackedBatchLoadFailed(false)
    }).catch((error) => {
      if (cancelled) return
      console.error('[POS] batch tracking lookup failed:', getErrorMessage(error))
      setTrackedBatchLoadFailed(true)
    })
    return () => { cancelled = true }
  }, [primaryBranchFilterId, batchTrackingReloadKey])

  // Derived filter lists from products
  const posSuppliers = useMemo(
    () => buildProductSupplierOptions(productFilterMeta.suppliers),
    [productFilterMeta.suppliers],
  )
  const posBrands = useMemo(
    () => buildProductBrandOptions(productFilterMeta.brands, String(settings?.product_brand_options || '[]')),
    [productFilterMeta.brands, settings?.product_brand_options],
  )
  const posPaymentMethods = useMemo((): string[] => {
    const fallback = ['Cash', 'Card', 'ABA Bank', 'Wing', 'KHQR']
    try {
      const parsed = JSON.parse(asText(settings.pos_payment_methods || '[]')) as unknown
      if (!Array.isArray(parsed)) return fallback
      const retired = new Set(['pi pay', 'transfer'])
      const methods = parsed
        .map((method) => String(method || '').trim())
        .filter((method) => method && !retired.has(method.toLocaleLowerCase()))
      return methods.length ? methods : fallback
    } catch {
      return fallback
    }
  }, [settings.pos_payment_methods])

  const updatePaymentDetails = useCallback((updater: (details: PaymentDetail[]) => PaymentDetail[]) => {
    setOrders((previous) => previous.map((order) => {
      if (order.id !== resolvedActiveId) return order
      const details = updater(order.paymentDetails)
      return {
        ...order,
        paymentDetails: details,
        paymentMethod: paymentMethodSummary(details),
        customPayment: false,
        paidUsd: String(details.reduce((sum, detail) => sum + (Number(detail.usd) || 0), 0) || ''),
        paidKhr: String(details.reduce((sum, detail) => sum + (Number(detail.khr) || 0), 0) || ''),
      }
    }))
  }, [resolvedActiveId])

  const updatePaymentDetail = useCallback((id: string, patch: Partial<PaymentDetail>) => {
    updatePaymentDetails((details) => details.map((detail) => detail.id === id ? { ...detail, ...patch } : detail))
  }, [updatePaymentDetails])

  const addPaymentDetail = useCallback(() => {
    updatePaymentDetails((details) => [
      ...details,
      { id: `payment-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, method: posPaymentMethods[0] || 'Cash', usd: '', khr: '' },
    ])
  }, [posPaymentMethods, updatePaymentDetails])

  const setExactPayment = useCallback((currency: 'usd' | 'khr', amount: number) => {
    updatePaymentDetails((details) => [{
      id: details[0]?.id || `payment-${Date.now()}`,
      method: details[0]?.method || posPaymentMethods[0] || 'Cash',
      usd: currency === 'usd' ? amount.toFixed(2) : '',
      khr: currency === 'khr' ? Math.ceil(amount).toString() : '',
    }])
  }, [posPaymentMethods, updatePaymentDetails])
  const initialOptions = useMemo(
    () => aggregateInitialOptions(productFilterMeta.initials as Array<Record<string, unknown>>),
    [productFilterMeta.initials],
  )
  // Vertical AlphaIndexRail wiring (replaces the old horizontal A-Z bar --
  // see its removal below). Unlike Products.tsx/Inventory.tsx, POS's
  // product grid is server-paginated (50/page, see loadCatalogData's
  // `initial: initialFilter` param) rather than fully loaded and grouped
  // client-side, so tapping a letter here can't scroll to an
  // already-loaded section the way the other two pages do -- there's no
  // guarantee that letter's products are even on the currently-fetched
  // page. Instead it re-uses POS's own existing filter mechanism: tapping
  // (or drag-scrubbing to) a letter sets `initialFilter`, which
  // loadCatalogData already sends to the server exactly like the old
  // horizontal bar's buttons did. Tapping the currently-active letter
  // again clears back to 'all', matching the old bar's own toggle-off
  // behavior (see the removed buttons' onClick below).
  const visibleInitialLetters = useMemo(
    () => initialOptions.map((item) => String(item.key)),
    [initialOptions],
  )
  const jumpToInitial = useCallback((letter: string) => {
    setPersistedInitial(initialFilter === letter ? 'all' : letter)
  }, [initialFilter])

// Products that do not match every active filter are fully hidden
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      // Search -- routed through matchesSearchTermGroups (searchMatch.ts)
      // for typo/joiner/word-order/diacritic tolerance instead of a plain
      // substring check, matching the same fix in Products.tsx's
      // filterProductsForPage. Corrected comment (the previous version
      // here claimed this was the only/live matching path with "no server
      // round-trip" -- traced the actual data flow and that's wrong):
      // `products` IS server-search-filtered -- loadCatalogData sends
      // `query: debouncedProductSearch` to /api/products/bootstrap or
      // /api/products/search (searchPosCatalogProducts), same as Products.tsx,
      // and now benefits from the backend's products_fts/products_fts_code
      // trigram matching same as that page. This client-side pass is the
      // same "instant feedback between debounce ticks" re-filter pattern as
      // Products.tsx's filterProductsForPage: `searchTerms` reacts to
      // `deferredSearch` (near-immediate) while the server re-fetch waits on
      // `debouncedProductSearch` (180ms), so typing narrows the *last
      // fetched page* right away instead of waiting on the next round-trip.
      // It can only ever narrow what the server already returned, never add
      // back a product the server didn't send for this page/query -- so it
      // must stay at least as permissive as the server's own match set, not
      // stricter (this is why it's substring/fuzzy on the same
      // name+sku+barcode haystack, matching the server's PRODUCT_SEARCH_COLUMNS,
      // rather than a narrower check). Narrowed from the old wider
      // brand/category/supplier/description/unit set per an explicit
      // request -- see PRODUCT_SEARCH_COLUMNS's own comment in
      // cloudflare/src/lib/searchMatch.ts for the full reasoning.
      if (searchTerms.length > 0) {
        // tag_label (P4) joins the haystack: the whole point of the tag is
        // typing YOUR word for a product and finding it.
        const hay = [p.name, p.sku, p.barcode, p.tag_label]
        if (!matchesSearchTermGroups(hay, searchTerms, searchMode)) return false
      }

      // Category (one or more selected)
      if (!matchesMulti(categoryFilter, p.category)) return false

      // Brand (one or more selected, case-insensitive)
      if (!matchesMulti(brandFilter, p.brand)) return false

      // Supplier (one or more selected, case-insensitive)
      if (!matchesMulti(supplierFilter, p.supplier)) return false

      // Branch filter: narrow the displayed quantity to the selected
      // branch(es), but do NOT hide the product just because it has no
      // branch_stock ROW at all for that branch. A missing row (e.g. a
      // branch created after the catalog was already imported/seeded,
      // which never got backfilled to 0 for every existing product --
      // see branches.ts's POST '/' handler) is functionally identical to
      // an explicit qty=0 row, and zero-stock products are deliberately
      // kept visible elsewhere in this same filter (see the NOTE below).
      // Previously this returned false the moment NO branch_stock row
      // matched the selected branch(es), which could empty the ENTIRE
      // grid for a branch that had never been backfilled -- even though
      // the branch dropdown itself (populated from the separate branches
      // table) still looked populated and correct, which is exactly the
      // "select shows numbers correctly but no product found" report.
      let qty = Number(p.stock_quantity || 0)
      if (branchFilterIds.length) {
        const matches = (p.branch_stock || []).filter((b) => branchFilterIds.includes(Number(b.branch_id)))
        qty = matches.reduce((sum, b) => sum + Number(b.quantity || 0), 0)
      }

      // Explicit stock filter(s) -- OR'd together when more than one is selected.
      const stockStates = parseMultiValues(stockFilter)
      if (stockStates.length) {
        return stockStates.some((state) => {
          if (state === 'out')      return qty <= asNumber(p.out_of_stock_threshold)
          if (state === 'low')      return qty > asNumber(p.out_of_stock_threshold) && qty <= (asNumber(p.low_stock_threshold) || 10)
          if (state === 'in_stock') return qty > (asNumber(p.low_stock_threshold) || 10)
          return true
        })
      }

      // NOTE: this used to hide every zero-stock product during default
      // browsing ("sellable-first"), on the theory that a cashier scrolling
      // the grid shouldn't see things they can't sell. In practice that
      // silently empties the whole grid for any catalog where stock hasn't
      // been assigned yet (e.g. right after a CSV import that didn't carry
      // branch/quantity columns) -- the server-side counts (alphabet bar,
      // category/brand lists) aren't filtered by stock at all, so admins
      // saw non-zero counts everywhere but an empty cart-side grid, with no
      // way to tell why. Products and Inventory never hid zero-stock items
      // by default, so POS now matches them: zero-stock products stay
      // visible (cards already render an out-of-stock indicator), and the
      // explicit Stock filter above remains the way to narrow to
      // in-stock/low/out specifically.

      return true
    })
  }, [
    branchFilterIds,
    brandFilter,
    categoryFilter,
    hasProductDiscoveryQuery,
    products,
    searchMode,
    searchTerms,
    stockFilter,
    supplierFilter,
  ])

  const hasActivePosFilters = useMemo(() => (
    Boolean(search.trim())
    || categoryFilter !== 'all'
    || brandFilter !== 'all'
    || branchFilter !== 'all'
    || stockFilter !== 'all'
    || groupFilter !== 'all'
    || supplierFilter !== 'all'
    || initialFilter !== 'all'
  ), [search, categoryFilter, brandFilter, branchFilter, stockFilter, groupFilter, supplierFilter, initialFilter])

  const productsById = useMemo(() => buildProductsById(products) as unknown as Map<number, ProductRecord>, [products])
  const branchesById = useMemo(() => new Map((Array.isArray(branches) ? branches : []).map((branch) => [Number(branch?.id), branch])), [branches])

  const variantChildrenByParentId = useMemo(
    () => buildVariantChildrenByParentId(products) as unknown as Map<number, ProductRecord[]>,
    [products],
  )

  // Root cause of "Groups filter -> no matching product" even though matching
  // grouped items genuinely exist: groupState is already sent to the server
  // (loadCatalogData's productQuery.groupState) and /api/products/search
  // filters authoritatively against the *whole* active catalog (is_group,
  // parent_id, or a same-name row anywhere else in products -- see
  // buildSearchFilters in cloudflare/src/routes/products.ts). This client-side
  // pass used to re-check that same condition again using buildProductGroups
  // over `productsById`, which is only ever the current *page* of ~20 items
  // (applyCatalogProducts replaces `products` wholesale per page, it's not
  // cumulative). For explicit groups (is_group/parent_id flags) that's
  // harmless since those flags live on the row itself. But this catalog's
  // groups are mostly duplicate-name rows with neither flag set -- and any
  // additional filter (brand/category/branch/stock) can easily let one
  // sibling into the page's result set while excluding the other, or the two
  // siblings can simply land on different pages. Either way this recheck saw
  // a "group" of one, `hasMultipleItems` came back false, and a product the
  // server had already confirmed was grouped got filtered back out --
  // sometimes emptying the grid entirely. The server's answer is already
  // scoped correctly across the full catalog, so there is nothing left for
  // this pass to safely re-verify from a single page; card-building below
  // still needs buildVisibleProductCards to collapse same-name rows for
  // display, it just no longer re-filters by groupFilter afterward.
  const visibleProductCards = useMemo(() => (
    buildVisibleProductCards(filteredProducts, productsById) as unknown as ProductRecord[]
  ), [filteredProducts, productsById])

  useEffect(() => {
    setProductPage(1)
  }, [branchFilter, brandFilter, categoryFilter, groupFilter, initialFilter, search, searchMode, stockFilter, supplierFilter])

  const pagedProductCards = visibleProductCards

  const getVariantChoices = useCallback((product: ProductRecord) => {
    return getVariantChoicesForProduct(product, variantChildrenByParentId) as unknown as ProductRecord[]
  }, [variantChildrenByParentId])

  const hasVariantChoices = useCallback((product: ProductRecord) => getVariantChoices(product).length > 0, [getVariantChoices])


  const getBranchStockQty = useCallback((product: ProductRecord, branchId: string | number | null | undefined) => {
    const id = Number(branchId)
    if (!product || !Number.isFinite(id)) return 0
    const row = (product.branch_stock || []).find((entry) => Number(entry.branch_id) === id)
    return row ? Number(row.quantity || 0) : 0
  }, [])

  const pickBestBranchId = useCallback((product: ProductRecord) => {
    let bestBranchId: number | null = null
    let bestQuantity = 0
    const preferredBranchId = defaultBranchId ? Number(defaultBranchId) : null

    for (const entry of product?.branch_stock || []) {
      const branchId = Number(entry.branch_id)
      const qty = Number(entry.quantity || 0)
      if (!Number.isFinite(branchId) || qty <= 0) continue
      if (preferredBranchId != null && branchId === preferredBranchId) return branchId
      if (qty > bestQuantity) {
        bestBranchId = branchId
        bestQuantity = qty
      }
    }

    return bestBranchId || defaultBranchId || null
  }, [defaultBranchId])

  /**
   * Stock quantity relevant to the active branch filter or item branch
   * assignment.
   *
   * With no branch filter and no cart line yet, this used to fall back to
   * `product.stock_quantity` -- the sum across ALL branches. A sale line
   * only ever books against ONE branch (`pickBestBranchId` picks it on the
   * first add, and every quantity check after that is scoped to that same
   * branch via `getBranchStockQty`), so a product split e.g. 3+3 across two
   * branches displayed "6" on the card but could only ever actually accept
   * 3 into the cart -- the 4th unit always failed with "not enough stock"
   * even though the card's own number said otherwise. Falling back to the
   * same single best branch `pickBestBranchId` would assign makes the
   * number on the card match the real ceiling enforced when adding.
   */
  const getDisplayStock = useCallback((product: ProductRecord | undefined, cartItem: { branch_id?: string | number | null } | null = null) => {
    if (!product) return 0

    if (primaryBranchFilterId != null) {
      return getBranchStockQty(product, primaryBranchFilterId)
    }

    if (cartItem?.branch_id) {
      return getBranchStockQty(product, cartItem.branch_id)
    }

    const bestBranchId = pickBestBranchId(product)
    if (bestBranchId != null) {
      return getBranchStockQty(product, bestBranchId)
    }

    return Number(product.stock_quantity || 0)
  }, [primaryBranchFilterId, getBranchStockQty, pickBestBranchId])

  const openProductCard = useCallback((product: ProductRecord, { groupProduct = false, inStock = false }: { groupProduct?: boolean; inStock?: boolean } = {}) => {
    if (!product) return
    const hasSpecial = asNumber(product.special_price_usd) > 0 || asNumber(product.special_price_khr) > 0
    const hasPromotion = promotionBadgeForProduct(product, promotionRules).active
    // Batch-tracked products always need the detail sheet's lot picker --
    // a one-tap add can't know which lot to sell from -- same gate as
    // groupProduct/hasSpecial/hasPromotion below.
    //
    // When the tracking lookup itself failed we don't know which products
    // are tracked, so EVERY product takes the detail-sheet path. One extra
    // tap on an untracked product is a far better error than silently
    // one-tapping a tracked one past its lot picker.
    const isBatchTracked = trackedBatchLoadFailed || trackedBatchProductIds.has(Number(product.id))
    if (groupProduct || hasSpecial || hasPromotion || isBatchTracked) {
      setDetailProduct(product)
      return
    }
    if (inStock) {
      addToCart(product, 'selling')
      return
    }
    setDetailProduct(product)
  }, [addToCart, exchangeRate, promotionRules, trackedBatchProductIds, trackedBatchLoadFailed])

  /** Open shared image lightbox from POS product cards/detail sheet. */
  const openImageLightbox = useCallback((product: ProductRecord, startIndex = 0) => {
    const nextLightbox = buildProductLightboxState(
      getProductGalleryImages(product),
      startIndex,
      product?.name || t('products'),
    ) as ImageLightboxState | null
    if (nextLightbox) setImageLightbox(nextLightbox)
  }, [t])

  /** Primary image used by cards/sheets, with gallery-first fallback. */
  const getPrimaryProductImage = useCallback((product: ProductRecord) => {
    return getProductGalleryImages(product)[0] || product?.image_path || ''
  }, [])

// Cart mutations
  function addToCart(product: ProductRecord, priceMode = 'selling', batchSelection?: BatchSelection, branchIdOverride?: string | number | null, damagedSelection?: { damagedLotId: number; quantity: number; label: string }) {
    // An explicit branch from the detail sheet WINS. The sheet resolves its
    // own branch for the Branch step, the stock figure and the lot list, so
    // re-deriving a different one here (highest-stock, or the branch filter)
    // meant the line could be booked against a branch the cashier never saw
    // -- the "displayed stock doesn't match the option I chose" report, and
    // the cause of lots being attached to the wrong branch.
    const overrideBranchId = branchIdOverride == null || branchIdOverride === ''
      ? null
      : Number(branchIdOverride)
    const assignedBranchId = overrideBranchId != null && Number.isFinite(overrideBranchId)
      ? overrideBranchId
      : (primaryBranchFilterId != null ? primaryBranchFilterId : pickBestBranchId(product))
    const priceValues = resolveCartPriceValues(product, priceMode, exchangeRate, {
      usdToKhr: (value: unknown, rate: unknown) => CURRENCY.usdToKhr(Number(value || 0), Number(rate || 0)),
    }, promotionRules)
    // Batch-tracked products are capped by the picked lot's own remaining
    // stock, not the product's overall stock -- a different lot for the
    // same product/branch/price is a separate cart line (see
    // findMatchingCartLineIndex/posCore.ts), each with its own ceiling.
    const batchCeiling = damagedSelection
      ? Math.max(0, Math.floor(damagedSelection.quantity))
      : batchSelection ? Math.max(0, Math.floor(batchSelection.quantity)) : null
    // A damaged-source line merges only with the SAME damaged lot's line;
    // and a plain add never merges into a damaged line (the matcher knows
    // nothing about damaged lots, so both directions are guarded here).
    let existingIndex = damagedSelection
      ? active.cart.findIndex((item) => Number((item as CartLineRecord).damaged_lot_id) === damagedSelection.damagedLotId
          && Number(item.id) === Number(product?.id)
          && String(item.price_mode || 'selling') === priceValues.price_mode
          && Number(item.branch_id || 0) === Number(assignedBranchId || 0))
      : findMatchingCartLineIndex(active.cart, {
          productId: product?.id,
          priceMode: priceValues.price_mode,
          branchId: assignedBranchId,
          batchId: batchSelection?.batchId ?? null,
        })
    if (!damagedSelection && existingIndex >= 0 && (active.cart[existingIndex] as CartLineRecord).damaged_lot_id) existingIndex = -1
    const existing = existingIndex >= 0 ? active.cart[existingIndex] : null
    let newCart: CartLineRecord[]
    if (existing) {
      const stock = batchCeiling != null ? batchCeiling : getDisplayStock(product, existing)
      if (existing.quantity >= stock) { notify(t('not_enough_stock'), 'error'); return }
      const existingLineId = getCartLineId(existing)
      newCart = active.cart.map((item) => (
        getCartLineId(item) === existingLineId
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ))
    } else {
      const stock = batchCeiling != null ? batchCeiling : getDisplayStock(product, { branch_id: assignedBranchId })
      if (stock <= 0) { notify(t('not_enough_stock'), 'error'); return }
      newCart = [...active.cart, {
        ...product,
        cart_line_id: `${Number(product.id)}:${priceValues.price_mode}:${Number(assignedBranchId || 0)}:${batchSelection?.batchId || 0}:D${damagedSelection?.damagedLotId || 0}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
        quantity: 1,
        ...priceValues,
        branch_id: assignedBranchId || null,
        ...(batchSelection ? {
          batch_id: batchSelection.batchId,
          batch_label: batchSelection.batchLabel,
          batch_expiry_date: batchSelection.batchExpiryDate,
          batch_available_quantity: batchCeiling ?? 0,
        } : {}),
        ...(damagedSelection ? {
          damaged_lot_id: damagedSelection.damagedLotId,
          damaged_lot_label: damagedSelection.label,
          damaged_available_quantity: batchCeiling ?? 0,
        } : {}),
      } as CartLineRecord]
    }
    patchActive({ cart: newCart })
    sessionStorage.removeItem('pos_search')
    setSearch('')
    // Refocus the search box after adding an item only on desktop -- this
    // exists for the barcode-scanner workflow (scan -> item added ->
    // search cleared -> ready for the next scan without touching the
    // keyboard). On mobile there's no physical scanner/keyboard driving
    // this: refocusing a text input there pops the on-screen keyboard on
    // every single product tap, which is what the "keyboard shows up
    // every time I tap a product" report was. Gated on the same
    // `isDesktopViewport` media-query flag already used elsewhere in this
    // file for other desktop-only behavior.
    if (isDesktopViewport) searchRef.current?.focus()
  }

  const updateQty = (cartLineId: string | number, qty: number) => {
    if (qty <= 0) { patchActive({ cart: active.cart.filter((item) => getCartLineId(item) !== cartLineId) }); return }
    const cartItem = active.cart.find((item) => getCartLineId(item) === cartLineId)
    const product = productsById.get(Number(cartItem?.id))
    // A batch-tracked line is capped by the lot's own remaining stock
    // (captured on the line when it was added -- see addToCart), not the
    // product's overall stock across every lot.
    const stockCeiling = cartItem?.damaged_lot_id
      ? (cartItem.damaged_available_quantity ?? 0)
      : cartItem?.batch_id ? (cartItem.batch_available_quantity ?? 0) : getDisplayStock(product, cartItem)
    if (qty > stockCeiling) { notify(t('not_enough_stock'), 'error'); return }
    patchActive({ cart: active.cart.map((item) => getCartLineId(item) === cartLineId ? { ...item, quantity: qty } : item) })
  }

  // G1: "buy >= X save Y" rules depend on the line's QUANTITY, so every
  // cart change re-evaluates 'promotion'-mode lines through the shared
  // kernel (repricePromotionCartLines is pure and returns changed=false
  // when prices already agree, so this settles immediately).
  useEffect(() => {
    const { cart, changed } = repricePromotionCartLines(active.cart, promotionRules, exchangeRate)
    if (changed) patchActive({ cart: cart as CartLineRecord[] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.cart, promotionRules, exchangeRate])

  const updatePrice = (cartLineId: string | number, field: 'usd' | 'khr', rawValue: string) => {
    const num = normalizePriceValue(rawValue, 0)
    patchActive({
      cart: active.cart.map((item) => {
        if (getCartLineId(item) !== cartLineId) return item
        // Z2 (user, Aug 29): the price input is the line's SELLING/base price
        // and editing it SETS that base -- any manual discount stays a
        // SEPARATE reduction, re-applied against the new base, so the line
        // total is (base × qty) − discount and the input never shows the
        // discounted price. (Previously typing a price silently CREATED a
        // fixed discount == base − typed, which is exactly what conflated the
        // price field with the discount.)
        const newBaseUsd = field === 'usd' ? num : normalizePriceValue(CURRENCY.khrToUsd(num, exchangeRate), 0)
        const newBaseKhr = field === 'khr' ? num : normalizePriceValue(CURRENCY.usdToKhr(num, exchangeRate), 0)
        const result = applyManualDiscount(newBaseUsd, newBaseKhr, exchangeRate, item.manual_discount_type || null, item.manual_discount_value || 0)
        return {
          ...item,
          base_price_usd: newBaseUsd,
          base_price_khr: newBaseKhr,
          applied_price_usd: result.applied_price_usd,
          applied_price_khr: result.applied_price_khr,
          manual_discount_type: item.manual_discount_type || null,
          manual_discount_value: result.manual_discount_value,
          manual_discount_usd: result.manual_discount_usd,
          manual_discount_khr: result.manual_discount_khr,
        }
      }),
    })
  }

  // Per-item manual discount editor (Tier 2 #1): applies a % or fixed-USD
  // discount against the line's base (selling/special/promotion) price,
  // independent of any product-level promotion already in product_discount_*.
  // Recomputes applied_price_usd/khr so totals, checkout payload, and the
  // receipt all stay in sync with a single source of truth.
  //
  // Root cause of "manual per-item discount not working": CartItem's %/$
  // toggle buttons activate a mode by calling this with rawValue '0' (there's
  // nothing typed yet), but applyManualDiscount treats *any* value <= 0 as
  // "no discount" and reports manual_discount_type back as null -- this used
  // to trust that collapsed type verbatim, so the instant a cashier clicked
  // % or $ to start entering a discount, the line's manual_discount_type
  // snapped straight back to null. CartItem's amount input is
  // disabled={!item.manual_discount_type}, so the field re-disabled itself
  // on the same click that was supposed to enable it -- the toggle looked
  // like it did nothing. The type the cashier just picked (the `type`
  // parameter here) is kept as-is below instead of trusting the zero-value
  // result; applyManualDiscount's *amounts* (0 until a real value is typed)
  // are still used as-is, so a 0-value selection now correctly reads as
  // "percent/fixed mode selected, no discount amount yet" rather than "no
  // discount type at all". Passing type: null (the Clear button) still
  // clears it, since `type` itself is null in that call.
  const updateDiscount = (cartLineId: string | number, type: ManualDiscountType | null, rawValue: string) => {
    const value = normalizePriceValue(rawValue, 0)
    patchActive({
      cart: active.cart.map((item) => {
        if (getCartLineId(item) !== cartLineId) return item
        const baseUsd = item.base_price_usd ?? item.applied_price_usd
        const baseKhr = item.base_price_khr ?? item.applied_price_khr
        const result = applyManualDiscount(baseUsd, baseKhr, exchangeRate, type, value)
        return {
          ...item,
          applied_price_usd: result.applied_price_usd,
          applied_price_khr: result.applied_price_khr,
          manual_discount_type: type,
          manual_discount_value: result.manual_discount_value,
          manual_discount_usd: result.manual_discount_usd,
          manual_discount_khr: result.manual_discount_khr,
        }
      }),
    })
  }

  const updateItemBranch = (cartLineId: string | number, branchId: string) => {
    const nextBranchId = branchId ? parseInt(branchId, 10) : null
    const item = active.cart.find((entry) => getCartLineId(entry) === cartLineId)
    const product = productsById.get(Number(item?.id))
    if (!item || !product) return

    // Must check the TARGET branch's own stock directly via
    // getBranchStockQty, not through getDisplayStock -- getDisplayStock
    // gives first priority to the active branch filter (primaryBranchFilterId)
    // over any explicit cartItem.branch_id (see its docstring above), so
    // whenever a branch filter was active it kept reporting the filtered
    // branch's stock regardless of which branch this switch was actually
    // targeting. That let a line be moved to a zero-stock branch as long
    // as the originally-selected/filtered branch still had stock. Bypass
    // that fallback chain entirely for this check.
    const available = nextBranchId != null
      ? getBranchStockQty(product, nextBranchId)
      : Number(product.stock_quantity || 0)
    if (item.quantity > available) {
      const branchName = branchesById.get(Number(nextBranchId))?.name || t('selected_branch') || 'selected branch'
      notify(`${t('not_enough_stock') || 'Not enough stock'} (${branchName})`, 'error')
      return
    }

    patchActive({ cart: active.cart.map((entry) => getCartLineId(entry) === cartLineId ? { ...entry, branch_id: nextBranchId } : entry) })
  }

// Totals derived from the active order
  const cartTotals = useMemo(() => {
    let subtotalUsd = 0
    let subtotalKhr = 0
    const branchIds = new Set<number>()

    for (const item of active.cart) {
      subtotalUsd += item.applied_price_usd * item.quantity
      subtotalKhr += item.applied_price_khr * item.quantity

      const branchId = Number(item.branch_id)
      if (branchId) branchIds.add(branchId)
    }

    return {
      subtotalUsd,
      subtotalKhr,
      branchIds: Array.from(branchIds),
    }
  }, [active.cart])

  const subtotalUsd = cartTotals.subtotalUsd
  const subtotalKhr = cartTotals.subtotalKhr

  // Overall/store discount (Tier 2 #2): supports a straight fixed USD/KHR
  // amount (as before) or a percent-of-subtotal amount -- previously only
  // the fixed field existed, so there was no way to key in e.g. "10% off"
  // without doing the math by hand. Percent mode is derived off the cart
  // subtotal so it stays correct as items are added/removed.
  const discountPercentValue = Math.min(100, Math.max(0, parseFloat(active.discountPercent) || 0))
  const discUsd = active.discountType === 'percent'
    ? normalizePriceValue(subtotalUsd * (discountPercentValue / 100), 0)
    : parseFloat(active.discountUsd) || 0
  const discKhr = active.discountType === 'percent'
    ? normalizePriceValue(subtotalKhr * (discountPercentValue / 100), 0)
    : (parseFloat(active.discountKhr) || CURRENCY.usdToKhr(discUsd, exchangeRate))
  const membershipDiscUsd = parseFloat(active.membershipDiscountUsd) || 0
  const membershipDiscKhr = parseFloat(active.membershipDiscountKhr) || CURRENCY.usdToKhr(membershipDiscUsd, exchangeRate)
  const membershipRedeemUnits = Math.max(0, parseInt(active.membershipRedeemUnits || '0', 10) || 0)
  const maxMembershipUnits = Math.max(0, Math.floor((membershipInfo?.points?.balance || 0) / redeemPointsStep))

  const afterDiscUsd = Math.max(0, subtotalUsd - discUsd - membershipDiscUsd)
  const afterDiscKhr = Math.max(0, subtotalKhr - discKhr - membershipDiscKhr)

  const taxUsd       = afterDiscUsd * taxRate
  const taxKhr       = afterDiscKhr * taxRate

  const feeUsd       = parseFloat(active.deliveryFeeUsd) || 0
  const feeKhr       = CURRENCY.usdToKhr(feeUsd, exchangeRate)

  // Delivery fee is only added to the customer's bill when THEY are the payer
  const customerFeeUsd = active.isDelivery && active.deliveryFeePaidBy === DELIVERY_FEE_PAYER.CUSTOMER ? feeUsd : 0
  const customerFeeKhr = active.isDelivery && active.deliveryFeePaidBy === DELIVERY_FEE_PAYER.CUSTOMER ? feeKhr : 0

  const totalUsd     = afterDiscUsd + taxUsd + customerFeeUsd
  const totalKhr     = afterDiscKhr + taxKhr + customerFeeKhr

  const activePaymentDetails = active.paymentDetails.length
    ? active.paymentDetails
    : [{ id: 'legacy-payment', method: active.paymentMethod || 'Cash', usd: active.paidUsd, khr: active.paidKhr }]
  const paidUsdNum   = activePaymentDetails.reduce((sum, detail) => sum + (parseFloat(detail.usd) || 0), 0)
  const paidKhrNum   = activePaymentDetails.reduce((sum, detail) => sum + (parseFloat(detail.khr) || 0), 0)
  const totalPaid    = paidUsdNum + paidKhrNum / exchangeRate
  const changeUsd    = totalPaid - totalUsd
  const changeKhr    = changeUsd * exchangeRate

  const handleDiscountUsd = (v: string) => patchActive({ discountType: 'fixed', discountUsd: v, discountKhr: String(CURRENCY.usdToKhr(parseFloat(v) || 0, exchangeRate)) })
  const handleDiscountKhr = (v: string) => patchActive({ discountType: 'fixed', discountKhr: v, discountUsd: String(CURRENCY.khrToUsd(parseFloat(v) || 0, exchangeRate)) })
  const handleDiscountPercent = (v: string) => patchActive({ discountType: 'percent', discountPercent: v })
  const handleDiscountType = (type: 'fixed' | 'percent') => patchActive({ discountType: type })
  const handleMembershipUnits = (value: string) => {
    const rawUnits = Math.max(0, parseInt(value || '0', 10) || 0)
    const units = Math.min(rawUnits, maxMembershipUnits)
    patchActive({
      membershipRedeemUnits: units ? String(units) : '',
      membershipDiscountUsd: units ? String((units * redeemValueUsdStep).toFixed(2)) : '',
      membershipDiscountKhr: units ? String(Math.round(units * redeemValueKhrStep)) : '',
    })
  }

  useEffect(() => {
    if (membershipRedeemUnits > maxMembershipUnits) {
      handleMembershipUnits(String(maxMembershipUnits))
    }
  }, [membershipRedeemUnits, maxMembershipUnits]) // eslint-disable-line react-hooks/exhaustive-deps

// Checkout
  const openStatusPicker = useCallback(() => {
    if (loading || checkoutInFlightRef.current || active.cart.length === 0) return
    setShowStatusPicker(true)
  }, [active.cart.length, loading])

  const closeStatusPicker = useCallback(() => {
    if (loading || checkoutInFlightRef.current) return
    setShowStatusPicker(false)
  }, [loading])

  const closeAddCustomerModal = useCallback(() => {
    if (savingCustomerRef.current) return
    setShowAddCustomer(false)
    setNewCustomerForm({ name: '', membership_number: '', phone: '', address: '' })
  }, [])

  const closeAddDeliveryModal = useCallback(() => {
    if (savingDeliveryRef.current) return
    setShowAddDelivery(false)
    setNewDeliveryForm({ name: '', phone: '', area: '' })
  }, [])

  const handleCheckout = async (saleStatus = 'completed') => {
    if (active.cart.length === 0)        return notify(t('cart_empty'), 'error')
    // Guardrail: a genuinely broken line (non-positive/NaN quantity, negative/
    // NaN price) or a negative grand total must never be submitted. A $0 line
    // stays allowed on purpose (a giveaway or a fully-discounted promo).
    const cartBlocker = findCheckoutBlocker(active.cart, { totalUsd })
    if (cartBlocker) {
      const blockerMessage = cartBlocker.code === 'invalid_quantity'
        ? `${posCopy('Invalid quantity - review the cart')}${cartBlocker.itemName ? `: ${cartBlocker.itemName}` : ''}`
        : cartBlocker.code === 'invalid_price'
          ? `${posCopy('Invalid price - review the cart')}${cartBlocker.itemName ? `: ${cartBlocker.itemName}` : ''}`
          : posCopy('This sale total is invalid. Review the cart before completing.')
      return notify(blockerMessage, 'error')
    }
    // Y10: an awaiting-payment sale is exactly the "decide the payment
    // later on the Sales page" flow -- requiring the full amount (and with
    // it a payment method) up front defeated it. Paid statuses keep the
    // gate.
    if (saleStatus !== 'awaiting_payment' && totalPaid < totalUsd - 0.005) {
      return notify(t('insufficient_amount'), 'error')
    }
    if (loading || checkoutInFlightRef.current) return

    const invalidBranchItem = active.cart.find((item) => item.branch_id && !branchesById.has(Number(item.branch_id)))
    if (invalidBranchItem) {
      return notify(posCopy('One or more cart items use an inactive branch. Please re-select the branch before checkout.'), 'error')
    }

    if (branches.length > 1) {
      const missingBranchItem = active.cart.find((item) => !item.branch_id)
      if (missingBranchItem) {
        return notify(
          `${posCopy('Select a branch for')} ${missingBranchItem.name}`,
          'error',
        )
      }
    }

    checkoutInFlightRef.current = true
    setLoading(true)

    const saleBranchId = cartTotals.branchIds.length === 1 ? cartTotals.branchIds[0] : null

    // Y2: ONE client_request_id per order until a checkout SUCCEEDS. The
    // server dedupes sales on it (unique index + early return), so after a
    // timeout/network failure the cashier can safely press Complete again --
    // if the first attempt actually landed, the retry returns that sale
    // instead of creating a second one. A fresh id per click (the old
    // behavior, generated inside the transport) made every retry a
    // potential duplicate sale.
    const orderKey = String(resolvedActiveId || 'pos-order')
    let clientRequestId = checkoutRequestIdsRef.current.get(orderKey)
    if (!clientRequestId) {
      clientRequestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `sale_${crypto.randomUUID()}`
        : `sale_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
      checkoutRequestIdsRef.current.set(orderKey, clientRequestId)
    }

    // Y10: with no payment typed on an awaiting-payment sale, record NO
    // payment method -- "Cash" here would be a fabrication; the method is
    // chosen later when the sale is completed on the Sales page.
    const hasPaymentInput = paidUsdNum > 0 || paidKhrNum > 0

    const device = getClientDeviceInfo()
    const saleData = {
      client_request_id: clientRequestId,
      cashier_id:   user?.id || null,
      cashier_name: user?.name || '',
      customer_name:    active.customer.name    || null,
      customer_id:      active.customer.id      || null,
      customer_membership_number: active.customer.membership_number || null,
      customer_phone:   active.customer.phone   || null,
      customer_address: active.customer.address || null,
      branch_id: saleBranchId,
      items: active.cart.map(i => ({
        id:                i.id,
        name:              i.name,
        quantity:          i.quantity,
        price_usd:         i.applied_price_usd,
        price_khr:         i.applied_price_khr,
        applied_price_usd: i.applied_price_usd,
        applied_price_khr: i.applied_price_khr,
        price_mode:        i.price_mode || 'selling',
        product_discount_type: i.product_discount_type || null,
        product_discount_label: i.product_discount_label || null,
        product_discount_usd: i.product_discount_usd || 0,
        product_discount_khr: i.product_discount_khr || 0,
        base_price_usd:    i.base_price_usd ?? i.applied_price_usd,
        base_price_khr:    i.base_price_khr ?? i.applied_price_khr,
        manual_discount_type:  i.manual_discount_type  || null,
        manual_discount_value: i.manual_discount_value || 0,
        manual_discount_usd:   i.manual_discount_usd   || 0,
        manual_discount_khr:   i.manual_discount_khr   || 0,
        cost_price_usd:    i.cost_price_usd    || i.purchase_price_usd    || 0,
        cost_price_khr:    i.cost_price_khr    || i.purchase_price_khr    || 0,
        purchase_price_usd: i.purchase_price_usd || 0,
        purchase_price_khr: i.purchase_price_khr || 0,
        total:     i.applied_price_usd * i.quantity,
        branch_id: i.branch_id || null,
        batch_id:          i.batch_id || null,
        batch_label:       i.batch_label || null,
        batch_expiry_date: i.batch_expiry_date || null,
        damaged_lot_id:    i.damaged_lot_id || null,
      })),
      subtotal_usd: subtotalUsd, subtotal_khr: subtotalKhr,
      discount_usd: discUsd,    discount_khr: discKhr,
      membership_discount_usd: membershipDiscUsd,
      membership_discount_khr: membershipDiscKhr,
      membership_points_redeemed: membershipRedeemUnits * redeemPointsStep,
      loyalty_accrual: active.loyaltyAccrual !== false,
      tax_usd:      taxUsd,     tax_khr:      taxKhr,
      total_usd:    totalUsd,   total_khr:    totalKhr,
      payment_method:   saleStatus === 'awaiting_payment' && !hasPaymentInput ? '' : paymentMethodSummary(activePaymentDetails),
      payment_details: saleStatus === 'awaiting_payment' && !hasPaymentInput ? [] : activePaymentDetails.map((detail) => ({
        method: detail.method.trim() || 'Cash',
        amount_usd: parseFloat(detail.usd) || 0,
        amount_khr: parseFloat(detail.khr) || 0,
      })),
      payment_currency: (paidUsdNum > 0 && paidKhrNum > 0) ? 'MIXED' : paidKhrNum > 0 ? 'KHR' : 'USD',
      amount_paid_usd: paidUsdNum,
      amount_paid_khr: paidKhrNum,
      // Y12: when the cashier entered the actual change handed back (either
      // currency non-empty), record THOSE per-currency amounts additively;
      // otherwise fall back to the computed dual representation, unchanged.
      change_usd: (active.changeGivenUsd !== '' || active.changeGivenKhr !== '') ? Math.max(0, parseFloat(active.changeGivenUsd) || 0) : Math.max(0, changeUsd),
      change_khr: (active.changeGivenUsd !== '' || active.changeGivenKhr !== '') ? Math.max(0, Math.round(parseFloat(active.changeGivenKhr) || 0)) : Math.max(0, changeKhr),
      exchange_rate: exchangeRate,
      is_delivery:               active.isDelivery ? 1 : 0,
      delivery_contact_id:       active.selectedDelivery?.id      || null,
      delivery_contact_name:     active.selectedDelivery?.name    || null,
      delivery_contact_phone:    active.selectedDelivery?.phone   || null,
      delivery_contact_address:  active.selectedDelivery?.address || null,
      delivery_fee_usd:          feeUsd,
      delivery_fee_khr:          feeKhr,
      delivery_fee_paid_by:      active.isDelivery ? active.deliveryFeePaidBy : DELIVERY_FEE_PAYER.CUSTOMER,
      // P6: only sent when the cashier typed one -- absent stays NULL on
      // the sale so stats can tell "not recorded" from "cost 0".
      delivery_actual_cost_usd:  active.isDelivery && String(active.deliveryActualCostUsd || '').trim() !== '' ? (parseFloat(active.deliveryActualCostUsd) || 0) : undefined,
      sale_status: saleStatus,
      client_time: device.clientTime,
      device_tz: device.deviceTz || '',
      device_name: device.deviceName || null,
    }

    try {
      const result = await withLoaderTimeout(
        () => createPosSale(saleData),
        'Create POS sale',
        POS_CHECKOUT_TIMEOUT_MS,
      )
      // The server returns the sale itself ({ id, receiptNumber, ... }) with no
      // top-level success flag, so the old raw success-flag check treated every
      // committed online sale as a failure -- an error toast, no receipt, the
      // order left open, while the sale had in fact landed. isSaleRecorded reads
      // the real signal: an id (or an explicit success) and no error.
      if (isSaleRecorded(result)) {
        checkoutRequestIdsRef.current.delete(orderKey)
        const receiptNumber = result.receiptNumber || result.receipt_number || `RCP-${Date.now()}`
        setReceiptQueue(q => [...q, { ...saleData, id: result.id, receiptNumber, created_at: new Date().toISOString() }])
        if (resolvedActiveId) closeOrder(resolvedActiveId)
        void loadCatalogData('POS catalog after checkout')
        // Trigger local inventory refresh immediately
        window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'inventory' } }))
        window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales' } }))
      } else {
        notify(result.error || t('error'), 'error')
      }
    } catch (e) {
      // Y2: a timeout is NOT a confirmed failure -- the request keeps
      // running server-side and may commit. Say so, and say that retrying
      // is safe (the stable client_request_id makes the retry return the
      // recorded sale instead of duplicating it).
      if ((e as { code?: string } | null)?.code === 'loader_timeout') {
        notify(posCopy(
          'The server has not confirmed this sale yet. It may still be recorded - pressing Complete again is safe and will NOT create a duplicate.',
          'ម៉ាស៊ីនមេមិនទាន់បញ្ជាក់ការលក់នេះទេ។ វាប្រហែលជាត្រូវបានកត់ត្រា - ចុច Complete ម្តងទៀតដោយសុវត្ថិភាព វានឹងមិនបង្កើតច្បាប់ចម្លងទេ។',
        ), 'error')
      } else {
        notify(getErrorMessage(e, t('error') || 'Error'), 'error')
      }
    } finally {
      checkoutInFlightRef.current = false
      setLoading(false)
    }
  }

// Render
  const catalogControlsDisabled = catalogRefreshing

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Mobile tab bar */}
      <div className="md:hidden flex flex-shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <button onClick={() => setMobileView('products')} className={`flex-1 py-2.5 text-sm font-medium ${mobileView === 'products' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}>{t('products') || 'Products'}</button>
        <button onClick={() => setMobileView('cart')}     className={`flex-1 py-2.5 text-sm font-medium relative ${mobileView === 'cart' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}>
          {t('cart') || 'Cart'}
          {active.cart.length > 0 && <span className="absolute top-1.5 right-1/4 w-4 h-4 bg-blue-600 text-white text-[10px] rounded-full flex items-center justify-center font-bold">{active.cart.length}</span>}
        </button>
      </div>

      {/* Two-panel main layout */}
      <div ref={mainPanelsRef} className="flex flex-1 min-h-0 overflow-x-auto overflow-y-hidden">

        {/* Left: Products panel */}
        <div className={`relative flex flex-col flex-1 min-h-0 min-w-0 bg-gray-50 dark:bg-gray-900 md:min-w-[18rem] lg:min-w-[22rem] ${mobileView === 'cart' ? 'hidden md:flex' : 'flex'}`}>

          {/* Filter bar */}
          <div className="flex-shrink-0 p-2.5 space-y-1.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            {/* Search + AND/OR + Filter toggle -- one row at every
                breakpoint. AND/OR is now a single alternating button (click
                to flip AND<->OR) instead of a two-option switch, so it
                keeps a fixed compact width and never needs to wrap onto
                its own row below the search box. Placeholder stays short
                (the AND/OR button right next to it already shows the match
                mode) so the input doesn't need as much width to read clearly. */}
            <div className="flex items-center gap-1.5">
              <input
                ref={searchRef}
                className="input min-w-0 flex-1"
                placeholder={`${t('search') || 'Search'} ${t('products') || 'products'}...`}
                title={searchMode === 'AND'
                  ? (t('search_mode_and_hint') || 'Matching ALL terms - change in Filters to match ANY term instead')
                  : (t('search_mode_or_hint') || 'Matching ANY term - change in Filters to match ALL terms instead')}
                value={search}
                onChange={e => { const next = e.target.value; sessionStorage.setItem('pos_search', next); setSearch(next) }}
              />
              <ScanSearchButton onDetected={setSearch} t={t} />
              {/* AND/OR toggle no longer sits here as its own button (Aug
                  19 2026 UI request) -- reachable again from inside the
                  Filter menu (search_mode section, see FilterPanel.tsx). */}
              {/* Filter trigger + popover, self-contained (shared FilterMenu handles
                  positioning, outside-click, Escape, and per-section search). */}
              <Suspense fallback={null}>
                <FilterPanel
                  t={t}
                  disabled={catalogControlsDisabled}
                  onOpenChange={setFilterOpen}
                  categories={categories}
                  brands={posBrands}
                  branches={branches}
                  suppliers={posSuppliers}
                  categoryFilter={categoryFilter}   setCategoryFilter={setPersistedCat}   setCategoryFilterBatch={setPersistedCatBatch}
                  brandFilter={brandFilter}         setBrandFilter={setPersistedBrand}
                  branchFilter={branchFilter}       setBranchFilter={setPersistedBranch}
                  stockFilter={stockFilter}         setStockFilter={setPersistedStock}
                  groupFilter={groupFilter}         setGroupFilter={setPersistedGroup}
                  supplierFilter={supplierFilter}   setSupplierFilter={setPersistedSupplier}
                  searchMode={searchMode}           setSearchMode={setSearchMode}
                />
              </Suspense>
            </div>

            {searchTerms.length > 1 && (
              <div className="flex gap-1 flex-wrap">{searchTerms.map((term, i) => <span key={i} className="badge-blue text-xs">{term}</span>)}</div>
            )}

          </div>

          {/* Product grid. `page-scroll` (also used by every other admin
              page's own scroll container) is what the mobile top bar's
              auto-hide-on-scroll hook (App.tsx's useMobileHeaderAutoHide,
              via getScrollTarget) looks for -- POS previously had no
              element with this class at all, so on this page specifically
              the scroll-position read always fell back to the (never
              moving, since POS scrolls internally) window scrollTop and
              the top bar could never hide, unlike every other page. */}
          <div className="page-scroll flex-1 overflow-y-auto overflow-x-hidden p-3">
            {/* Batch/expiry tracking could not be looked up. Selling from
                the wrong lot is a real inventory error (FIFO/expiry), and
                the old behaviour -- silently treating the failure as "no
                product is batch-tracked" -- hid that completely. Every
                product now routes through the detail sheet while this is
                showing, so a lot can still be chosen; the banner explains
                the extra step rather than leaving it unexplained. */}
            {trackedBatchLoadFailed && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
                <span className="flex-1 min-w-[12rem]">
                  {posCopy(
                    'Batch and expiry tracking could not be loaded, so lot selection cannot be skipped. Check each item before selling.',
                    'Batch and expiry tracking could not be loaded, so lot selection cannot be skipped. Check each item before selling.',
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => { setTrackedBatchLoadFailed(false); setBatchTrackingReloadKey((key) => key + 1) }}
                  className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
                >
                  {posCopy('Try again', 'Try again')}
                </button>
              </div>
            )}
            {/* Horizontal A-Z filter bar removed (Part 218 UI request --
                same rollout as Products.tsx/Inventory.tsx's own removal
                notes above). Replaced by the vertical AlphaIndexRail
                rendered further down. Unlike those two pages, POS keeps
                its server-side filtering behavior underneath (see
                jumpToInitial's comment) -- so a small chip here is the
                only remaining on-screen indicator of which letter is
                active, replacing the old bar's own highlighted-button
                state. */}
            {initialFilter !== 'all' && (
              <div className="mb-3 flex items-center gap-2">
                <span className="badge-blue inline-flex items-center gap-1.5 text-xs">
                  {(posCopy('Letter', 'Letter'))}: {initialFilter}
                  <button
                    type="button"
                    className="ml-0.5 rounded-full px-1 font-bold hover:bg-blue-700/20"
                    onClick={() => setPersistedInitial('all')}
                    aria-label={posCopy('Clear letter filter', 'Clear letter filter')}
                  >
                    ×
                  </button>
                </span>
              </div>
            )}
            {/* The "Refreshing..." banner used to also render here, above
                the pagination controls, in addition to the identical
                message shown inside the empty-grid state further down --
                same on-screen duplication as Products.tsx. Removed; the
                grid's own empty/refreshing state (below) is enough. */}
            <div className="mb-3 flex justify-end">
              <PaginationControls
                page={productPage}
                pageSize={productPageSize}
                totalItems={productTotal}
                label={productCountLabel}
                t={t}
                compact
                rangeAsPageSize
                onPageChange={setProductPage}
                onPageSizeChange={(size) => {
                  setProductPageSize(size)
                  setProductPage(1)
                }}
              />
            </div>
            <div className="pos-product-grid">
              {pagedProductCards.map(p => {
                const variants = getVariantChoices(p)
                const groupProduct = hasVariantChoices(p)
                const groupMeta: ProductGroupMeta | null = p.__groupMeta || null
                const choiceLabel = groupMeta?.groupKind === 'variant'
                  ? posCopy('variants', 'variants')
                  : posCopy('options', 'options')
                const groupName = t('groups') || 'Groups'
                const stock   = getDisplayStock(p)
                const variantInStock = variants.some((variant) => getDisplayStock(variant) > asNumber(variant.out_of_stock_threshold))
                const inStock = groupProduct ? variantInStock : stock > asNumber(p.out_of_stock_threshold)
                const promoBadge = promotionBadgeForProduct(p, promotionRules)
                const expiryInfo = !groupProduct ? computeExpiryStatus(p.expiry_date, p.expiry_alert_days) : null
                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    className={`card relative cursor-pointer p-3 text-left transition-all ${inStock ? 'hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600' : 'opacity-60'}`}
                    onClick={() => openProductCard(p, { groupProduct, inStock })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openProductCard(p, { groupProduct, inStock })
                      }
                    }}
                  >
                    <button
                      type="button"
                      className="relative w-full aspect-square rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center mb-2 overflow-hidden"
                      onClick={(event) => { event.stopPropagation(); openImageLightbox(p, 0) }}
                      aria-label={posCopy('Preview product images', 'Preview product images')}
                    >
                      {getPrimaryProductImage(p) ? <ProductImage src={getPrimaryProductImage(p)} alt={p.__displayName || p.name} className="w-full h-full object-cover" /> : <ImageOff className="h-5 w-5 text-gray-400" />}
                      <ProductDiscountBadge product={p} exchangeRate={exchangeRate} fmtUSD={fmtUSD} label={posCopy('Discounts', 'Discounts')} promotionRules={promotionRules} />
                    </button>
                    <div className="flex items-start justify-between gap-2">
                      <p {...getKhmerTextProps(p.__displayName || p.name, 'text-xs font-medium text-gray-900 dark:text-white leading-tight mb-1 line-clamp-2')}>
                        {p.__displayName || p.name}
                        {/* P4: the operator's own memory-aid tag chip */}
                        {String(p.tag_label || '').trim() ? (
                          <span className="ml-1 inline-flex items-center rounded-full bg-sky-100 px-1.5 py-0.5 align-middle text-[9px] font-semibold text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">{String(p.tag_label).trim()}</span>
                        ) : null}
                      </p>
                      {groupProduct ? (
                        <span
                          className="inline-flex flex-shrink-0 items-center rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                          aria-label={`${variants.length} ${choiceLabel}`}
                        >
                          {groupName}: {variants.length}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm font-bold text-blue-600">
                      {groupProduct && groupMeta?.minSellingPriceUsd !== groupMeta?.maxSellingPriceUsd
                        ? `${fmtUSD(groupMeta?.minSellingPriceUsd || 0)} - ${fmtUSD(groupMeta?.maxSellingPriceUsd || 0)}`
                        : fmtUSD(p.selling_price_usd)}
                    </p>
                    {asNumber(p.selling_price_khr) > 0 && !groupProduct ? <p className="text-xs text-gray-400">{fmtKHR(asNumber(p.selling_price_khr))}</p> : null}
                    {asNumber(p.special_price_usd) > 0 || asNumber(p.special_price_khr) > 0 ? (
                      // The VIP AMOUNT is deliberately not printed on the grid
                      // (user, Aug 28): the chip says a VIP price exists; the
                      // number reveals on request in the detail sheet.
                      <p {...getKhmerTextProps(t('special_price') || 'Special', 'text-[11px] font-medium text-emerald-600 dark:text-emerald-400')}>{t('special_price') || 'VIP'}</p>
                    ) : null}
                    {promoBadge.active ? (
                      <p className="text-[11px] font-semibold" style={{ color: promoBadge.badge_color || '#e11d48' }}>
                        {promoBadge.kind === 'quantity_hint'
                          ? ((promoBadge.show_title && promoBadge.title) || `${posCopy('Buy', 'Buy')} ${promoBadge.min_quantity}+`)
                          : `${(promoBadge.show_title && promoBadge.title) || p.discount_label || posCopy('Discounts', 'Discounts')} ${fmtUSD(evaluatePromotionPricing(p, 1, promotionRules, exchangeRate).unit_price_usd)}`}
                      </p>
                    ) : null}
                    {/* Colored qty+unit instead of a separate "Out of Stock" label --
                        same convention as Products/Inventory/Branches: red when out,
                        amber/yellow when low, emerald when healthy. Group products have
                        no single qty to color against (variants can each differ), so
                        they keep the neutral gray style. */}
                    {/* Options count + total-in-stock used to be two
                        separate rows (each product card growing a line
                        taller for no reason); merged into one compact row
                        with a middle dot separator, same info, less
                        vertical space. */}
                    <p {...getKhmerTextProps(groupProduct ? choiceLabel : p.unit, `text-xs mt-0.5 font-medium ${groupProduct ? 'text-gray-400 font-normal' : !inStock ? 'text-red-500' : stock <= (asNumber(p.low_stock_threshold) || 10) ? 'text-yellow-500' : 'text-emerald-500'}`)}>
                      {groupProduct
                        ? `${variants.length} ${choiceLabel}${groupMeta?.stockTotal ? ` · ${groupMeta.stockTotal} ${posCopy('total in stock', 'total in stock')}` : ''}`
                        : `${stock} ${p.unit}`}
                    </p>
                    {expiryInfo && expiryInfo.status !== 'ok' ? (
                      <p className={`text-[11px] font-semibold ${expiryInfo.status === 'expired' ? 'text-red-600' : 'text-yellow-600'}`}>
                        {expiryInfo.status === 'expired' ? (t('expired') || 'Expired') : (t('expiring_soon') || 'Expiring soon')}
                      </p>
                    ) : null}
                  </div>
                )
              })}
              {visibleProductCards.length === 0 && (
                <div className="col-span-full text-center py-12 text-gray-400">
                  {catalogRefreshing ? (
                    t('refreshing') || 'Refreshing...'
                  ) : catalogLoadError ? (
                    <div className="flex flex-col items-center gap-2">
                      <p className="text-red-500 font-medium">{catalogLoadError}</p>
                      <button
                        type="button"
                        onClick={() => void loadCatalogData('POS catalog retry', { forceMetadata: true })}
                        className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                      >
                        {posCopy('Try again', 'Try again')}
                      </button>
                    </div>
                  ) : hasActivePosFilters ? (
                    <div className="flex flex-col items-center gap-2">
                      <p>{posCopy('No products match your filters', 'No products match your filters')}</p>
                      <button
                        type="button"
                        onClick={clearAllPosFilters}
                        className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                      >
                        {posCopy('Clear filters', 'Clear filters')}
                      </button>
                    </div>
                  ) : (
                    t('no_data')
                  )}
                </div>
              )}
            </div>
          </div>

          <AlphaIndexRail letters={visibleInitialLetters} onJump={jumpToInitial} label={t('jump_to_letter') || 'Jump to letter'} />
        </div>

        {/* Drag handle -- resizes the cart panel (desktop/tablet only; the
            mobile products/cart tab split above never shows this since
            only one panel is visible at a time there). Double-click resets
            to the default width. */}
        <div
          className={`hidden md:flex relative w-2 flex-shrink-0 cursor-col-resize items-center justify-center group ${cartResizing ? 'bg-blue-200 dark:bg-blue-900/40' : 'hover:bg-blue-100 dark:hover:bg-blue-900/30'}`}
          onMouseDown={(event) => { event.preventDefault(); startCartResize(event.clientX) }}
          onTouchStart={(event) => { if (event.touches[0]) startCartResize(event.touches[0].clientX) }}
          onDoubleClick={resetCartWidth}
          role="separator"
          aria-orientation="vertical"
          aria-label={t('resize_cart_panel') || 'Resize cart panel'}
          title={t('resize_cart_panel_tip') || 'Drag to resize, double-click to reset'}
        >
          <div className="h-14 w-1 rounded-full bg-gray-300 dark:bg-gray-600 group-hover:bg-blue-400 group-hover:h-20 transition-all" />
        </div>

        {/* Right: Cart panel */}
        <div
          className={`flex flex-col flex-shrink-0 w-full bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 h-full min-h-0 ${mobileView === 'products' ? 'hidden md:flex' : 'flex'}`}
          style={isDesktopViewport ? { width: `${cartWidthPx}px`, minWidth: `${cartWidthPx}px` } : undefined}
        >

          {/* Order tabs */}
          <div className="flex-shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 overflow-x-auto bg-gray-50 dark:bg-gray-900 scroll-x">
            {orders.map(order => (
              <div key={order.id} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap flex-shrink-0 transition-colors cursor-pointer
                ${resolvedActiveId === order.id ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:border-blue-400'}`}
                onClick={() => setActiveId(order.id)}
              >
                <span>{order.label}</span>
                {order.cart.length > 0 && (
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${resolvedActiveId === order.id ? 'bg-white/30 text-white' : 'bg-blue-600 text-white'}`}>{order.cart.length}</span>
                )}
                {orders.length > 1 && (
                  <button
                    type="button"
                    aria-label={t('close') || 'Close'}
                    className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-[11px] leading-none opacity-60 hover:opacity-100 hover:bg-black/10"
                    onClick={e => { e.stopPropagation(); closeOrder(order.id) }}
                  >
                    x
                  </button>
                )}
              </div>
            ))}
            {orders.length < LAYOUT.MAX_CONCURRENT_ORDERS && (
              <button onClick={addNewOrder} className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-lg bg-white dark:bg-gray-800 border border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-400 text-gray-400 hover:text-blue-600 text-sm font-bold transition-colors" title="New order">+</button>
            )}
          </div>

          {/* Cart panel view toggle -- lets the person collapse to just the
              product line-items or just the customer/delivery/discount/
              payment section instead of always seeing both stacked with
              the details half capped short. 'All' (default) keeps the
              exact previous layout unchanged. */}
          <div className="flex-shrink-0 flex items-center gap-1 px-2 py-1 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            {([
              ['products', t('products') || 'Products'],
              ['all',      t('all') || 'All'],
              ['details',  t('details') || 'Details'],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPersistedCartViewMode(mode)}
                className={`flex-1 min-h-7 rounded-lg text-xs font-medium transition-colors ${cartViewMode === mode ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Cart items -- its own independent scroll region, given first
              claim on the available space. Previously this shared one
              scroll container with the customer/delivery/discount/payment
              section below, so a cart with many edited lines pushed the
              payment section far down and scrolling either one moved the
              other -- easy to lose your place while editing. Now the cart
              list scrolls on its own and the summary section below never
              shifts because of it. */}
          <div className={`min-h-0 overflow-y-auto ${cartViewMode === 'details' ? 'hidden' : 'flex-1'}`}>
            <div>
              {active.cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400 gap-2">
                  {/* Was a big text-4xl "Cart" word -- inconsistent with the
                      single-symbol empty-state pattern used elsewhere
                      (Products.tsx/Inventory.tsx's "!" for errors), and
                      untranslated. A real icon fixes both at once. */}
                  <ShoppingCart className="h-10 w-10" aria-hidden="true" />
                  <p className="text-sm">{t('cart_empty')}</p>
                  <p className="text-xs">{t('tap_product_to_add')||'Tap a product to add it'}</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between px-3 pt-2 pb-1">
                    <span className="text-xs text-gray-400 font-medium">{active.cart.length} item{active.cart.length !== 1 ? 's' : ''}</span>
                    <button onClick={() => patchActive({ cart: [] })} className="text-xs text-red-500 hover:underline">{t('clear_cart')}</button>
                  </div>
                  {active.cart.map(item => (
                    <CartItem key={item.cart_line_id || `${item.id}-${item.price_mode || 'selling'}-${item.branch_id || 'none'}`} item={item} branches={branches} t={t}
                      onQtyChange={updateQty} onPriceChange={updatePrice} onDiscountChange={updateDiscount}
                      onBranchChange={updateItemBranch}
                      onRemove={id => patchActive({ cart: active.cart.filter(i => getCartLineId(i) !== id) })}
                      onShowDetails={() => { const p = productsById.get(Number(item.id)); if (p) setDetailProduct(p) }}
                      fmtUSD={fmtUSD} fmtKHR={fmtKHR} usdSymbol={usdSymbol} khrSymbol={khrSymbol}
                      showItemDiscount={showItemDiscountInCart}
                    />
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Summary + customer + delivery + discount + payment -- a
              second, separate scroll region capped to a fraction of the
              panel height so the cart items above always keep the
              majority of the space. Only scrolls internally on short
              screens/many open sub-sections; it never grows at the cart
              list's expense. In 'details' view mode it takes the full
              panel height instead (the cart items block above is hidden),
              since there's no items list left to share space with. */}
          <div className={`min-h-0 overflow-y-auto ${cartViewMode === 'details' ? 'flex-1' : 'flex-shrink-0 max-h-[46%]'} ${cartViewMode === 'products' ? 'hidden' : ''}`}>

            {/* Customer section (collapsible) */}
            <div className="border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between px-3 py-2">
                <button className="flex-1 text-left flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-400" onClick={() => setShowCustomer(v => !v)}>
                  <span>{t('pos_customer')||t('customer')||'Customer'}</span>
                  {active.customer.name
                    ? <span className="text-blue-600 truncate max-w-[120px]">{active.customer.name}</span>
                    : <span className="text-gray-400">({t('optional')||'optional'})</span>}
                  <span className="ml-auto text-[10px] text-gray-400">{showCustomer ? 'Hide' : 'Show'}</span>
                </button>
                <button onClick={() => setShowAddCustomer(true)} className="ml-2 text-xs text-blue-500 hover:text-blue-700 font-medium whitespace-nowrap">{t('add_new')||'+ New'}</button>
              </div>
              {showCustomer && (
                <div className="px-3 pb-3 space-y-2">
                  <div className="relative">
                    <label htmlFor="pos-customer-search" className="sr-only">{t('search_customer')}</label>
                    <input id="pos-customer-search" name="pos_customer_search" autoComplete="name" className="input text-xs py-1.5 pr-8" placeholder={t('search_customer')} value={active.customerSearch || ''}
                      onChange={e => { patchActive({ customerSearch: e.target.value, customer: { ...active.customer, name: e.target.value } }); setShowCustomerDrop(true) }}
                      onFocus={() => setShowCustomerDrop(true)} />
                    {active.customerSearch && <button className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500" onClick={clearCustomer}>{t('clear')||'Clear'}</button>}
                    {showCustomerDrop && customerSuggestions.length > 0 && (
                      <div className="absolute top-full left-0 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-20 max-h-32 overflow-auto mt-0.5">
                        {customerSuggestions.map(c => (
                          <button key={c.id} className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-xs" onClick={() => { void selectCustomer(c) }}>
                            <span className="font-medium text-gray-900 dark:text-white">{c.name}</span>
                            {c.phone && <span className="text-gray-400 ml-2">{c.phone}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {active.customer.name && (
                    <div className="space-y-1.5">
                      {/* Option label badge shown when an option is selected */}
                      {active.customer._optionLabel && (
                        <div className="flex items-center gap-1.5">
                          <span className="badge-blue text-xs">{active.customer._optionLabel}</span>
                          {customerOptionsList.length > 1 && (
                            <button className="text-xs text-blue-500 hover:underline" onClick={() => setShowOptionPicker(true)}>change</button>
                          )}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-1">
                        <label htmlFor="pos-customer-phone-inline" className="sr-only">{t('phone')}</label>
                        <input id="pos-customer-phone-inline" name="pos_customer_phone_inline" autoComplete="tel" className="input text-xs py-1" placeholder={t('phone')} value={active.customer.phone||''} onChange={e => patchActive({ customer: { ...active.customer, phone: e.target.value } })} />
                        <label htmlFor="pos-customer-address-inline" className="sr-only">{t('address')}</label>
                        <input id="pos-customer-address-inline" name="pos_customer_address_inline" autoComplete="street-address" className="input text-xs py-1" placeholder={t('address')} value={active.customer.address||''} onChange={e => patchActive({ customer: { ...active.customer, address: e.target.value } })} />
                      </div>
                      {/* Option picker appears inline when a customer has multiple options */}
                      {showOptionPicker && customerOptionsList.length > 0 && (
                        <div className="border border-blue-200 dark:border-blue-700 rounded-xl overflow-hidden shadow-sm">
                          <div className="bg-blue-50 dark:bg-blue-900/30 px-3 py-1.5 flex items-center justify-between">
                            <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">{t('choose_contact_option')||'Choose contact option'}</span>
                            <button className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setShowOptionPicker(false)}>{t('close')||'Close'}</button>
                          </div>
                          {customerOptionsList.map((opt, i) => (
                            <button key={i} onClick={() => applyCustomerOption(opt)}
                              className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 border-t border-gray-100 dark:border-gray-700 first:border-t-0 text-xs transition-colors">
                              <div className="font-semibold text-gray-800 dark:text-gray-200">{opt.label || (t('option_n')||'Option {n}').replace('{n}', String(i + 1))}</div>
                              <div className="text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-2 mt-0.5">
                                {opt.name    && <span>Name: {opt.name}</span>}
                                {opt.phone   && <span>Phone: {opt.phone}</span>}
                                {opt.address && <span>Address: {opt.address}</span>}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Discount + membership (directly under Customer -- Aug 28 order) */}
            <div className="border-t border-gray-200 dark:border-gray-700 px-3 pt-3 pb-2 space-y-3">

              {/* Order (user, Aug 28): Membership BEFORE store discount. */}
              <div>
                <div className="text-xs text-gray-500 font-medium">{posCopy('Membership discount', 'បញ្ចុះតម្លៃសមាជិក')}</div>
                <div className="mt-1 rounded-xl border border-emerald-200 bg-emerald-50/80 p-2.5">
                  {!active.customer?.membership_number ? (
                    // Y11: the explanation moves behind an InfoHint -- the
                    // line just cues the action, prose on tap only.
                    <div className="flex items-center gap-1 text-xs text-emerald-700">
                      {posCopy('Select a member to apply', 'ជ្រើសសមាជិកដើម្បីអនុវត្ត')}
                      <InfoHint
                        label={posCopy('About membership discount', 'អំពីបញ្ចុះតម្លៃសមាជិក')}
                        text={posCopy('Select a customer with a membership number to apply membership discount separately from store discount.', 'ជ្រើសអតិថិជនដែលមានលេខសមាជិក ដើម្បីអនុវត្តបញ្ចុះតម្លៃសមាជិកដោយឡែកពីបញ្ចុះតម្លៃហាង។')}
                      />
                    </div>
                  ) : membershipLoading ? (
                    <p className="text-xs text-emerald-700">{posCopy('Checking membership points...')}</p>
                  ) : membershipError ? (
                    <p className="text-xs text-red-600">{membershipError}</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-emerald-800">{active.customer.membership_number}</span>
                        <span className="text-emerald-700">
                          {posCopy('Balance')}: {(membershipInfo?.points?.balance || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} pts
                        </span>
                      </div>
                      <div className="grid grid-cols-[110px,1fr] gap-2">
                        <div>
                          <label htmlFor="pos-membership-redeem-units" className="mb-1 block text-[11px] font-medium text-emerald-700">{posCopy('Units')}</label>
                          <input id="pos-membership-redeem-units" name="pos_membership_redeem_units" className="input text-xs py-1" type="number" min="0" step="1" value={active.membershipRedeemUnits || ''} onChange={e => handleMembershipUnits(e.target.value)} />
                        </div>
                        <div className="rounded-lg bg-white/90 px-3 py-2 text-xs text-emerald-900">
                          <div>{posCopy('1 unit')} = {redeemPointsStep} pts = {fmtUSD(redeemValueUsdStep)}</div>
                          <div className="mt-1">{posCopy('Available units')}: {maxMembershipUnits}</div>
                          <div className="mt-1">{posCopy('Membership discount', 'បញ្ចុះតម្លៃសមាជិក')}: {fmtUSD(membershipDiscUsd)} / {fmtKHR(membershipDiscKhr)}</div>
                        </div>
                      </div>
                      <div className="flex gap-2 text-xs">
                        <button className="text-emerald-700 hover:underline" onClick={() => handleMembershipUnits('0')}>{posCopy('Clear')}</button>
                        <span className="text-emerald-300">|</span>
                        <button className="text-emerald-700 hover:underline" onClick={() => handleMembershipUnits(String(maxMembershipUnits))}>{posCopy('Use max')}</button>
                      </div>
                    </div>
                  )}
                </div>
                {/* Earn-points toggle: any sale attached to a customer accrues
                    points (balances are computed by summing sales server-side),
                    so this shows for every selected customer, not only members.
                    Default ON preserves the long-standing auto-accrual. */}
                {active.customer?.id ? (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-gray-500">{posCopy('Count loyalty points', 'គិតពិន្ទុសមាជិក')}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={active.loyaltyAccrual !== false}
                      aria-label={posCopy('Count loyalty points', 'គិតពិន្ទុសមាជិក')}
                      onClick={() => patchActive({ loyaltyAccrual: active.loyaltyAccrual === false })}
                      className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${active.loyaltyAccrual !== false ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                    >
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${active.loyaltyAccrual !== false ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                ) : null}
              </div>

              {/* Discount: label stacked above (user, Aug 28), and BELOW it
                  ONE row holding the %/$ toggle AND the amount input(s) --
                  the currency boxes used to wrap to their own row and were
                  oversized (user screenshot, Part 388). Both currencies sit
                  compact beside the toggle. */}
              <div>
                <label htmlFor="pos-discount-usd" className="block text-xs text-gray-500 font-medium">{t('discount')}</label>
                <div className="mt-1 flex items-center gap-1.5">
                  <div className="inline-flex flex-shrink-0 overflow-hidden rounded-lg border border-gray-200 text-sm font-medium dark:border-gray-600">
                    <button
                      type="button"
                      className={`min-w-[2.25rem] px-2.5 py-1 ${active.discountType === 'percent' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}`}
                      onClick={() => handleDiscountType('percent')}
                    >
                      %
                    </button>
                    <button
                      type="button"
                      className={`min-w-[2.25rem] border-l border-gray-200 px-2.5 py-1 dark:border-gray-600 ${active.discountType !== 'percent' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}`}
                      onClick={() => handleDiscountType('fixed')}
                    >
                      {usdSymbol}
                    </button>
                  </div>
                  {active.discountType === 'percent' ? (
                    <div className="relative w-20 flex-shrink-0">
                      <input id="pos-discount-usd" name="pos_discount_percent" className="input text-xs py-1 pr-6 w-full" type="number" min="0" max="100" step="any" placeholder="0" value={active.discountPercent} onChange={e => handleDiscountPercent(e.target.value)} autoComplete="off" />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
                    </div>
                  ) : (
                    <>
                      <div className="relative min-w-0 flex-1"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{usdSymbol}</span><input id="pos-discount-usd" name="pos_discount_usd" className="input text-xs py-1 pl-5 w-full" type="number" step="any" placeholder="0.00" value={active.discountUsd} onChange={e => handleDiscountUsd(e.target.value)} autoComplete="off" /></div>
                      <div className="relative min-w-0 flex-1"><label htmlFor="pos-discount-khr" className="sr-only">{`${t('discount')} ${khrSymbol}`}</label><input id="pos-discount-khr" name="pos_discount_khr" className="input text-xs py-1 pr-5 w-full" type="number" step="any" placeholder="0" value={active.discountKhr ? Number(active.discountKhr).toFixed(0) : ''} onChange={e => handleDiscountKhr(e.target.value)} autoComplete="off" /><span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{khrSymbol}</span></div>
                    </>
                  )}
                </div>
              </div>

            </div>

            {/* Delivery section (collapsible with toggle) */}
            <div className="border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between px-3 py-2">
                <button className="flex-1 text-left flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-400" onClick={() => setShowDelivery(v => !v)}>
                  <span>{t('pos_delivery')||t('delivery_fees')||'Delivery'}</span>
                  {active.isDelivery && active.selectedDelivery?.name && <span className="text-orange-500 truncate max-w-[80px]">{active.selectedDelivery.name}</span>}
                  {active.isDelivery && feeUsd > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active.deliveryFeePaidBy === DELIVERY_FEE_PAYER.CUSTOMER ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>{fmtUSD(feeUsd)}</span>}
                  <span className="ml-auto text-[10px] text-gray-400">{showDelivery ? 'Hide' : 'Show'}</span>
                </button>
                {/* Toggle switch */}
                <button onClick={() => { patchActive({ isDelivery: !active.isDelivery }); if (!active.isDelivery) setShowDelivery(true) }}
                  className={`relative ml-2 w-9 h-5 rounded-full transition-colors flex-shrink-0 ${active.isDelivery ? 'bg-orange-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${active.isDelivery ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>

              {showDelivery && active.isDelivery && (
                <div className="px-3 pb-3 space-y-2">
                  {/* Rider search + fee share ONE row (user, Aug 28): the fee
                      is a small figure, so it rides beside the search instead
                      of owning a row. The standalone "= KHR" echo is gone --
                      the paid-by note below already shows USD (KHR). */}
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-400">{t('rider_contact')||'Rider / Contact'}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{t('delivery_fee')||'Delivery fee'}</span>
                        <button onClick={() => setShowAddDelivery(true)} className="text-xs text-orange-500 hover:text-orange-700 font-medium">{t('add_new')||'+ New'}</button>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="relative min-w-0 flex-1">
                        <label htmlFor="pos-delivery-search" className="sr-only">{t('search')}</label>
                        <input id="pos-delivery-search" name="pos_delivery_search" autoComplete="name" className="input text-xs py-1.5 pr-8" placeholder={`${t('search')}...`} value={active.deliverySearch || ''}
                          onChange={e => { patchActive({ deliverySearch: e.target.value }); setShowDeliveryDrop(true) }}
                          onFocus={() => setShowDeliveryDrop(true)} />
                        {active.deliverySearch && <button className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500" onClick={clearDelivery}>{t('clear')||'Clear'}</button>}
                        {showDeliveryDrop && deliverySuggestions.length > 0 && (
                          <div className="absolute top-full left-0 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-20 max-h-32 overflow-auto mt-0.5">
                            {deliverySuggestions.map(d => (
                              <button key={d.id} className="w-full text-left px-3 py-2 hover:bg-orange-50 dark:hover:bg-orange-900/20 text-xs" onClick={() => selectDelivery(d)}>
                                <span className="font-medium text-gray-900 dark:text-white">{d.name}</span>
                                {d.phone && <span className="text-gray-400 ml-2">{d.phone}</span>}
                                {d.area  && <span className="text-orange-500 ml-2 text-[10px]">{d.area}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="relative w-24 flex-shrink-0">
                        <label htmlFor="pos-delivery-fee-usd" className="sr-only">{t('delivery_fee')||'Delivery fee'}</label>
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{usdSymbol}</span>
                        <input id="pos-delivery-fee-usd" name="pos_delivery_fee_usd" className="input text-xs py-1.5 pl-5 w-full" type="number" step="any" placeholder="0.00" value={active.deliveryFeeUsd} onChange={e => patchActive({ deliveryFeeUsd: e.target.value })} autoComplete="off" />
                      </div>
                    </div>
                    {deliveryContacts.length === 0 && (
                      <p className="text-xs text-gray-400 mt-1">{t('no_contacts_yet')||'No contacts yet.'} <button className="text-orange-500 underline" onClick={() => setShowAddDelivery(true)}>{t('add_one')||'Add one'}</button></p>
                    )}
                  </div>

                  {/* Who pays + the actual courier cost, one row. The cost
                      input (P6) is what WE pay the driver -- staff-only,
                      stored on the sale, never printed on the receipt. */}
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-400">{t('fee_paid_by')||'Fee paid by'}</span>
                      <div className="flex items-center gap-2">
                        <div className="flex overflow-hidden rounded-lg border border-gray-200 text-xs dark:border-gray-600">
                          <button onClick={() => patchActive({ deliveryFeePaidBy: DELIVERY_FEE_PAYER.CUSTOMER })} className={`px-3 py-1.5 font-medium transition-colors ${active.deliveryFeePaidBy === DELIVERY_FEE_PAYER.CUSTOMER ? 'bg-orange-500 text-white' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>{t('fee_by_customer')||'Customer'}</button>
                          <button onClick={() => patchActive({ deliveryFeePaidBy: DELIVERY_FEE_PAYER.STORE })}    className={`border-l border-gray-200 px-3 py-1.5 font-medium transition-colors dark:border-gray-600 ${active.deliveryFeePaidBy === DELIVERY_FEE_PAYER.STORE    ? 'bg-blue-600 text-white'   : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>{t('fee_by_store')||'Store'}</button>
                        </div>
                        <div className="relative w-20 flex-shrink-0">
                          <label htmlFor="pos-delivery-actual-cost" className="sr-only">{t('delivery_actual_cost')||'Actual delivery cost'}</label>
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{usdSymbol}</span>
                          <input id="pos-delivery-actual-cost" name="pos_delivery_actual_cost" className="input text-xs py-1.5 pl-5 w-full" type="number" step="any" min="0" placeholder={t('cost_short')||'Cost'} title={t('delivery_actual_cost_hint')||'What the driver is paid (staff-only, not on the receipt)'} value={active.deliveryActualCostUsd} onChange={e => patchActive({ deliveryActualCostUsd: e.target.value })} autoComplete="off" />
                        </div>
                      </div>
                    </div>
                    {feeUsd > 0 && (
                      <p className={`text-xs mt-1 px-2 py-1 rounded-lg ${active.deliveryFeePaidBy === DELIVERY_FEE_PAYER.CUSTOMER ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300' : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'}`}>
                        {active.deliveryFeePaidBy === DELIVERY_FEE_PAYER.CUSTOMER
                          ? `${fmtUSD(feeUsd)} (${fmtKHR(feeKhr)}) ${t('added_to_total')||'added to total'}`
                          : `${fmtUSD(feeUsd)} (${fmtKHR(feeKhr)}) ${t('absorbed_by_store')||'absorbed by store'}`}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Order summary + payment */}
            <div className="border-t border-gray-200 dark:border-gray-700 px-3 pt-3 pb-2 space-y-3">
              {/* Order summary */}
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-2.5 space-y-1 text-xs">
                <div className="flex justify-between text-gray-500"><span>{t('subtotal')}</span><span>{fmtUSD(subtotalUsd)}</span></div>
                {discUsd > 0 && <div className="flex justify-between text-red-500"><span>{t('discount')}</span><span>-{fmtUSD(discUsd)}</span></div>}
                {membershipDiscUsd > 0 && <div className="flex justify-between text-emerald-600"><span>{posCopy('Membership discount', 'បញ្ចុះតម្លៃសមាជិក')}</span><span>-{fmtUSD(membershipDiscUsd)}</span></div>}
                {taxRate > 0  && <div className="flex justify-between text-gray-500"><span>{t('tax')} ({settings.tax_rate}%)</span><span>{fmtUSD(taxUsd)}</span></div>}
                {active.isDelivery && feeUsd > 0 && (
                  <div className={`flex justify-between ${active.deliveryFeePaidBy === DELIVERY_FEE_PAYER.CUSTOMER ? 'text-orange-600' : 'text-blue-500'}`}>
                    <span>{t('pos_delivery')||'Delivery'}{active.deliveryFeePaidBy === DELIVERY_FEE_PAYER.STORE ? ' ('+( t('store_pays')||'store pays')+')' : ''}</span>
                    <span>{active.deliveryFeePaidBy === DELIVERY_FEE_PAYER.CUSTOMER ? `+${fmtUSD(feeUsd)}` : `${fmtUSD(feeUsd)} included`}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-gray-900 dark:text-white text-sm border-t border-gray-200 dark:border-gray-600 pt-1.5 mt-1">
                  <span>{t('total')}</span>
                  {/* One row (user, Aug 28): USD with the KHR beside it, not stacked. */}
                  <span className="text-right">
                    {fmtUSD(totalUsd)} <span className="text-xs font-normal text-gray-400">({fmtKHR(totalKhr)})</span>
                  </span>
                </div>
              </div>

              {/* Payment method */}
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-gray-500 font-medium">{t('payment_methods') || 'Payment methods'}</div>
                  <button type="button" className="text-xs text-blue-600 hover:underline" onClick={addPaymentDetail}>+ {t('add_payment_method') || 'Add payment method'}</button>
                </div>
                <datalist id="pos-payment-method-options">
                  {posPaymentMethods.map((method) => <option key={method} value={method} />)}
                </datalist>
                <div className="mt-1.5 space-y-1.5">
                  {/* Method column narrowed (a method name is short); the
                      amount inputs take the freed room (user, Aug 28). */}
                  {activePaymentDetails.map((detail, index) => (
                    // Inputs minimized further (user screenshot, Part 388):
                    // shorter boxes (py-1), narrower method column -- the
                    // whole row stays ONE line.
                    <div key={detail.id} className="grid grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-1">
                      <input
                        aria-label={`${t('payment_method') || 'Payment method'} ${index + 1}`}
                        className="input min-w-0 py-1 text-xs"
                        list="pos-payment-method-options"
                        value={detail.method}
                        onChange={(event) => updatePaymentDetail(detail.id, { method: event.target.value })}
                        placeholder={t('payment_method_placeholder') || 'Payment method'}
                        autoComplete="off"
                      />
                      <div className="relative"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{usdSymbol}</span><input aria-label={`${t('amount_paid') || 'Amount paid'} USD ${index + 1}`} className="input w-full py-1 pl-5 text-xs" type="number" step="any" placeholder="0.00" value={detail.usd} onChange={(event) => updatePaymentDetail(detail.id, { usd: event.target.value })} autoComplete="off" /></div>
                      <div className="relative"><input aria-label={`${t('amount_paid') || 'Amount paid'} KHR ${index + 1}`} className="input w-full py-1 pr-5 text-xs" type="number" step="any" placeholder="0" value={detail.khr} onChange={(event) => updatePaymentDetail(detail.id, { khr: event.target.value })} autoComplete="off" /><span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{khrSymbol}</span></div>
                      {/* Compact button, LEGIBLE icon — it was an h-8 box
                          drawing a text-xs '×' (huge button, tiny icon). */}
                      <button type="button" className="flex h-7 w-7 items-center justify-center self-center rounded text-lg leading-none text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-900/20" disabled={activePaymentDetails.length === 1} onClick={() => updatePaymentDetails((details) => details.filter((entry) => entry.id !== detail.id))} aria-label={`${t('remove') || 'Remove'} ${detail.method || index + 1}`}>×</button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 mt-1">
                  <button className="text-xs text-blue-500 hover:underline" onClick={() => setExactPayment('usd', totalUsd)}>Exact {usdSymbol}</button>
                  <span className="text-gray-300">|</span>
                  <button className="text-xs text-blue-500 hover:underline" onClick={() => setExactPayment('khr', totalKhr)}>Exact {khrSymbol}</button>
                </div>
                {(paidUsdNum > 0 || paidKhrNum > 0) && (
                  <div className={`mt-1.5 p-2 rounded-lg text-xs ${changeUsd >= 0 ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
                    {changeUsd >= 0 ? (
                      // Y12: record the ACTUAL change handed back, per currency
                      // -- prefilled/placeholdered from the computed change, but
                      // editable because change is often given in a different
                      // currency than the payment. Empty fields = use computed.
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-600 dark:text-gray-400">{t('change_given') || 'Change given'}:</span>
                          <button
                            type="button"
                            className="text-[11px] text-blue-500 hover:underline"
                            onClick={() => patchActive({ changeGivenUsd: changeUsd > 0 ? changeUsd.toFixed(2) : '', changeGivenKhr: '' })}
                            title={t('use_computed_change_hint') || 'Fill USD with the full computed change'}
                          >
                            {t('use_computed') || 'Use computed'}: {fmtUSD(changeUsd)}{changeKhr > 1 ? ` / ${fmtKHR(changeKhr)}` : ''}
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <div className="relative">
                            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400">{usdSymbol}</span>
                            <input
                              id="pos-change-given-usd"
                              name="pos_change_given_usd"
                              className="input py-1 pl-5 text-xs"
                              inputMode="decimal"
                              placeholder={changeUsd > 0 ? changeUsd.toFixed(2) : '0.00'}
                              value={active.changeGivenUsd}
                              onChange={e => patchActive({ changeGivenUsd: e.target.value })}
                              autoComplete="off"
                            />
                          </div>
                          <div className="relative">
                            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400">{khrSymbol}</span>
                            <input
                              id="pos-change-given-khr"
                              name="pos_change_given_khr"
                              className="input py-1 pl-5 text-xs"
                              inputMode="numeric"
                              placeholder="0"
                              value={active.changeGivenKhr}
                              onChange={e => patchActive({ changeGivenKhr: e.target.value })}
                              autoComplete="off"
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">{t('change')}:</span>
                        <div className="text-right font-bold text-red-600">{fmtUSD(Math.abs(changeUsd))} {t('short') || 'short'}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>{/* end scroll area content */}
          </div>{/* end summary/payment scroll region */}

          {/* Checkout button pinned at the bottom */}
          <div className="flex-shrink-0 px-3 py-2.5 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            {/* Z9: the stock consequence of each status lives behind an
                InfoHint, not inline prose -- the button just says Complete
                Sale (the status is chosen in the picker it opens). */}
            <div className="mb-1.5 flex items-center justify-center gap-1 text-[11px] text-gray-400">
              {t('status_stock_effect_cue') || 'Stock effect by status'}
              <InfoHint
                label={t('status_stock_effect_label') || 'What each sale status does to stock'}
                text={[
                  `${getPosStatusLabel('completed', t)}: ${t('pos_status_completed_desc') || 'Payment received - stock deducted now'}`,
                  `${getPosStatusLabel('awaiting_payment', t)}: ${t('pos_status_awaiting_payment_desc') || 'Order placed, payment pending - stock held (not deducted)'}`,
                  `${getPosStatusLabel('awaiting_delivery', t)}: ${t('pos_status_awaiting_delivery_desc') || 'Paid, not yet delivered - stock deducted'}`,
                ].join('\n\n')}
              />
            </div>
            <button className="btn-success w-full py-3 text-sm font-bold" onClick={openStatusPicker} disabled={loading || showStatusPicker || active.cart.length === 0}>
              {loading ? t('loading') : (t('complete_sale') || 'Complete Sale')}
            </button>
          </div>

        </div>{/* end cart panel */}
      </div>{/* end two-panel layout */}

          {/* Sale status picker shown when Done is tapped */}
      {showStatusPicker && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm fade-in">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-bold text-gray-900 dark:text-white">{t('record_sale_as')||'Record Sale As'}</h3>
              <button onClick={closeStatusPicker} disabled={loading} className="text-gray-400 hover:text-gray-600 text-sm leading-none w-8 h-8 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed">{t('close')||'Close'}</button>
            </div>
            <div className="p-4 space-y-2">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{t('pos_status_choose_desc')||'Choose how this sale is being processed. This will appear in Sales history.'}</p>
              {([
                ['completed',         getPosStatusLabel('completed',         t), t('pos_status_completed_desc')||'Payment received - stock deducted now'],
                ['awaiting_payment',  getPosStatusLabel('awaiting_payment',  t), t('pos_status_awaiting_payment_desc')||'Order placed, payment pending - stock held'],
                ['awaiting_delivery', getPosStatusLabel('awaiting_delivery', t), t('pos_status_awaiting_delivery_desc')||'Paid, not yet delivered - stock deducted'],
              ] as const).map(([status, label, desc]) => (
                <button key={status}
                  onClick={() => { closeStatusPicker(); void handleCheckout(status) }}
                  disabled={loading}
                  className="w-full p-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-left transition-colors disabled:opacity-50">
                  <div className="font-semibold text-sm text-gray-800 dark:text-gray-200">{label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showAddCustomer || showAddDelivery ? (
        <Suspense fallback={null}>
          <POSQuickAddModals
            closeAddCustomerModal={closeAddCustomerModal}
            closeAddDeliveryModal={closeAddDeliveryModal}
            handleAddCustomer={handleAddCustomer}
            handleAddDelivery={handleAddDelivery}
            newCustomerForm={newCustomerForm}
            newDeliveryForm={newDeliveryForm}
            posCopy={posCopy}
            savingCustomer={savingCustomer}
            savingDelivery={savingDelivery}
            setNewCustomerForm={setNewCustomerForm}
            setNewDeliveryForm={setNewDeliveryForm}
            showAddCustomer={showAddCustomer}
            showAddDelivery={showAddDelivery}
            t={t}
          />
        </Suspense>
      ) : null}

      {/* Product detail bottom-sheet */}
      {detailProduct ? (
        <Suspense fallback={null}>
          <ProductDetailSheet
            product={detailProduct}
            promotionRules={promotionRules}
            exchangeRate={exchangeRate}
            t={t}
            fmtUSD={fmtUSD}
            fmtKHR={fmtKHR}
            asNumber={asNumber}
            posCopy={posCopy}
            activeBranchId={primaryBranchFilterId}
            trackedBatchProductIds={trackedBatchProductIds}
            getDisplayStock={getDisplayStock}
            getPrimaryProductImage={getPrimaryProductImage}
            getVariantChoices={getVariantChoices}
            hasVariantChoices={hasVariantChoices}
            onAddToCart={addToCart}
            onClose={() => setDetailProduct(null)}
            onOpenImageLightbox={openImageLightbox}
          />
        </Suspense>
      ) : null}

      {/* Receipt overlay shown after each completed sale */}
      {/*   Displayed on top of the POS so other orders remain intact.   */}
      {(imageLightbox || receiptQueue.length > 0) ? (
        <Suspense fallback={null}>
          {imageLightbox && imageLightbox.images?.length ? (
            <ImageGalleryLightbox
              open={!!(imageLightbox && imageLightbox.images?.length)}
              title={imageLightbox?.title || t('products')}
              images={imageLightbox?.images || []}
              index={imageLightbox?.index || 0}
              onClose={() => setImageLightbox(null)}
              onIndexChange={(index) => setImageLightbox((current) => (current ? { ...current, index } : current))}
              labels={{
                prev: posCopy('Prev'),
                next: posCopy('Next'),
                imageCount: '{current}/{total}',
                dotsLabel: 'Image {current} of {total}',
              }}
            />
          ) : null}
          {receiptQueue.length > 0 ? (
            <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
              <div className="relative w-full max-w-md max-h-modal-90 flex flex-col bg-white dark:bg-gray-800 rounded-2xl overflow-hidden shadow-2xl">
                {receiptQueue.length > 1 && (
                  <div className="flex-shrink-0 bg-blue-600 text-white text-xs text-center py-1 px-3">{receiptQueue.length} receipts waiting - close this one to see the next</div>
                )}
                <Receipt
                  sale={receiptQueue[0]}
                  settings={settings}
                  onClose={() => setReceiptQueue(q => q.slice(1))}
                />
              </div>
            </div>
          ) : null}
        </Suspense>
      ) : null}

    </div>
  )
}
