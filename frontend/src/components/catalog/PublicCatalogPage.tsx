import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { resolveProductNames } from './productDetailSections.ts'
import { portalRowFromProduct } from './portalProductNames.ts'
import { useDebouncedValue } from '../../utils/useDebouncedValue.ts'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { usePullToRefresh } from '../shared/usePullToRefresh.ts'
import PullToRefreshIndicator from '../shared/PullToRefreshIndicator.tsx'
import Bot from 'lucide-react/dist/esm/icons/bot.js'
import HelpCircle from 'lucide-react/dist/esm/icons/help-circle.js'
import Mail from 'lucide-react/dist/esm/icons/mail.js'
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js'
import Phone from 'lucide-react/dist/esm/icons/phone.js'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import Store from 'lucide-react/dist/esm/icons/store.js'
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js'
import RotateCw from 'lucide-react/dist/esm/icons/rotate-cw.js'
import type { LucideIcon } from 'lucide-react'
import { useApp } from '../../app/AppContextCore.tsx'
import { clampPage } from '../shared/PaginationControls'
import { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent, withLoaderTimeout } from '../../utils/loaders.ts'
import { clearRetiredPortalCache, readPaintEmbed, startStorefrontLoad } from './publicFirstPaint.ts'
import PublicStorefrontSkeleton from './PublicStorefrontSkeleton.tsx'
import { dismissPortalAnnouncement, readDismissedPortalAnnouncement, resolvePortalAnnouncement } from './portalAnnouncement.ts'
import { todayStr } from '../../utils/dateHelpers.ts'
import { startVisibleInterval } from '../../utils/visibilityPolling.ts'
import { aggregateInitialOptions } from '../../utils/initials.ts'
import { buildPortalContactEntries, buildPortalSocialFromConfig, normalizePortalExternalUrl as normalizeExternalUrl, portalContactFooterLinks } from './portalSocialLinks.ts'
import { contactHref } from '../../utils/socialLinks.ts'
import PortalContactMenu, { type PortalContactAnchor } from './PortalContactMenu.tsx'
import PortalSheet from './PortalSheet.tsx'
import CatalogPreviewSurface from './CatalogPreviewSurface'
import type { ProductDetailViewState } from './ProductDetailFlyout'
import { bootstrapPageSizeMatchesViewer, CATALOG_DEFAULT_PAGE_SIZE, normalizeCatalogPageSize, readStoredCatalogPageSize, writeStoredCatalogPageSize } from './catalogPagination'
import { getPortalProductGridClass, buildPortalPricePresentation, resolvePortalStockStatus, shouldShowStockStatus } from './portalCatalogDisplay.ts'
import type { PromotionRule } from '../../utils/promotionRules.ts'
import { mergePortalCatalogProducts } from './portalProductGrouping.ts'
import { DEFAULT_PORTAL_BROWSE_SORT, isDefaultPortalBrowse, isPortalPriceSort, portalBrowseParams, usePortalBrowse } from './portalBrowse.ts'
import { normalizeGoogleMapsEmbed } from './portalEditorUtils.ts'
import { portalScrollBehavior } from './portalMotion.ts'
import { resolveCatalogAssetUrl } from './catalogAssetUrls'
import { usePortalBucket, usePortalWishlist, formatPortalBucketText, downloadPortalBucketFile } from './portalBucket.ts'
import { usePortalAccount } from './portalAccount.ts'
import PortalListPage from './PortalListPage.tsx'
import type { PortalListSegment } from './PortalListPage.tsx'
import { usePortalListImages } from './portalListImages.ts'
import PortalFooter from './legal/LegalPages.tsx'
import { localizeDefaultConfigCopy, resolveStorefrontCopy } from './portalLanguagePacks.ts'
import { ADMIN_MAX_PRODUCT_GALLERY_IMAGES } from '../products/helpers/productGalleryHelpers.ts'
import InstallPromptBand from '../shared/InstallPromptBand.tsx'
import InstallAppButton from '../install/InstallAppButton.tsx'
import { installStandaloneExternalLinkGuard } from '../../utils/standaloneNavigation.ts'
import { isGoogleLanguageChoice, normalizePortalChoice, portalCopyLanguage, readPublicStorefrontChoice, storePortalLanguage } from './portalLanguageOptions.ts'
import { isAdminHostname, isStorefrontSignInPath } from '../../app/pathRouting.ts'
import { aiProviderState } from './legal/aiProviderDisclosure.ts'
import { PORTAL_DARK_SURFACE, PORTAL_LIGHT_SURFACE } from './portalContrast.ts'
import type { AiProviderState } from './legal/aiProviderDisclosure.ts'

const loadCatalogProductsSection = () => import('./CatalogProductsSection')
const CatalogProductsSection = lazyRetry(loadCatalogProductsSection, 'public-catalog-products-section')
const loadCatalogSecondaryTabs = () => import('./CatalogSecondaryTabs')
const CatalogSecondaryTabs = lazyRetry(loadCatalogSecondaryTabs, 'public-catalog-secondary-tabs')
const ConsentRenewalPrompt = lazyRetry(() => import('./legal/ConsentRenewalPrompt'), 'public-catalog-consent-renewal')
const CatalogAccountSection = lazyRetry(() => import('./CatalogAccountSection'), 'public-catalog-account-section')
const PortalPromotionsBanner = lazyRetry(() => import('./PortalPromotionsBanner'), 'public-catalog-promotions-banner')

const PUBLIC_PORTAL_PRODUCT_SEARCH_TIMEOUT_MS = 12000
const PUBLIC_PORTAL_AI_TIMEOUT_MS = 25000
// Fixed storefront browser branding for the live storefront, served as
// STATIC same-origin files (installable, unlike the old runtime blob: manifest
// -- see the brand effect below). Not per-merchant customizable (11.14-16).
const STOREFRONT_NAME = 'Leang Cosmetics'
const STOREFRONT_HOME_SCREEN_NAME = 'Leang Cosmetics'
const STOREFRONT_ICON = '/leang-cosmetics-icon-512-v2.png'
const STOREFRONT_APPLE_TOUCH_ICON = '/leang-cosmetics-apple-touch-icon-v2.png'
const STOREFRONT_MANIFEST = '/portal-manifest.json'

type LooseRecord = Record<string, any>
type CopyFunction = (key: string, fallback?: string, fallbackKm?: string) => string
type PortalInitialOption = ReturnType<typeof aggregateInitialOptions>[number]
type CatalogOption = { id: string | number; name: string }
type CatalogProduct = LooseRecord & {
  id: string | number
  name?: string
  brand?: string
  category?: string
  barcode?: string
  sku?: string
  image_path?: string
  image_gallery?: unknown[]
  // Server-computed availability (routes/portal.ts attachPortalStockStatus).
  // Raw quantities/thresholds are redacted server-side.
  stock_status?: string
  branch_availability?: Array<{ branch_id?: string | number | null; status?: string }>
  branch_stock?: Array<{ branch_id?: string | number | null; quantity?: string | number | null }>
  stock_quantity?: string | number | null
}
type PortalConfig = LooseRecord & {
  aboutBlocks?: LooseRecord[]
  aboutContent?: string
  aboutTitle?: string
  addressLink?: string
  aiDisclaimer?: string
  aiEnabled?: boolean
  aiIntro?: string
  aiProviderId?: string | number | null
  aiTitle?: string
  businessAddress?: string
  businessLegalName?: string
  businessRegistrationNumber?: string
  businessCover?: string
  businessEmail?: string
  businessFavicon?: string
  businessLogo?: string
  businessName?: string
  businessPhone?: string
  businessTagline?: string
  contactLinkLabels?: Record<string, string>
  contactLinks?: Record<string, string>
  exchangeRate?: string | number
  faqItems?: Array<{ id: string | number; question: string; answer: string }>
  faqTitle?: string
  googleMapsEmbed?: string
  gridColumnsAuto?: boolean
  announcementEnabled?: boolean
  announcementTextEn?: string
  announcementTextKm?: string
  announcementLink?: string
  announcementStart?: string
  announcementEnd?: string
  announcementVersion?: string
  gridColumnsDesktop?: unknown
  gridColumnsMobile?: unknown
  heroGradientEnd?: string
  heroGradientMid?: string
  heroGradientStart?: string
  highlightRankLimit?: unknown
  language?: string
  intro?: string
  linkLabels?: Record<string, string>
  links?: Record<string, string>
  logoFit?: string
  logoPositionX?: number
  logoPositionY?: number
  logoZoom?: number
  lowStockThreshold?: string | number
  outOfStockThreshold?: string | number
  priceDisplay?: string
  promoItems?: LooseRecord[]
  promotionsIntro?: string
  promotionsTitle?: string
  recommendedProductIds?: unknown[]
  redeemPoints?: string | number
  redeemValueKhr?: string | number
  redeemValueUsd?: string | number
  refreshSeconds?: string | number
  showAbout?: boolean
  showAddress?: boolean
  showCatalog?: boolean
  showContactInstagram?: boolean
  showContactMessenger?: boolean
  showContactTelegram?: boolean
  showContactPhone?: boolean
  showContactWhatsapp?: boolean
  showEmail?: boolean
  showFacebook?: boolean
  showFaq?: boolean
  showGoogleMap?: boolean
  showInstagram?: boolean
  showLogo?: boolean
  showCover?: boolean
  showMembership?: boolean
  showOutOfStockProducts?: boolean
  showStockStatus?: boolean
  showPhone?: boolean
  showPrices?: boolean
  showProductBrand?: boolean
  showProductCategory?: boolean
  showProductDiscount?: boolean
  showPromotions?: boolean
  showRecommendedBadge?: boolean
  showTopProductBadge?: boolean
  showTopSellerBadge?: boolean
  showTelegram?: boolean
  showWebsite?: boolean
  stockThresholdMode?: string
  submissionEnabled?: boolean
  submissionRewardPoints?: string | number
  title?: string
  translateWidgetEnabled?: boolean
}
type GalleryViewState = { open: boolean; title: string; items: string[]; index: number }
type PortalImageViewState = { open: boolean; title: string; images: string[]; index: number }
type FilePickerState = { open: boolean; target?: unknown; mediaType: string; title: string }
type PortalTab = { key: string; label: string; icon: LucideIcon }
type CatalogApi = {
  getPortalBootstrap?: () => Promise<unknown>
  getPortalConfig?: () => Promise<unknown>
  searchPortalCatalogProducts?: (params?: Record<string, unknown>) => Promise<unknown>
  getPortalAiStatus?: () => Promise<unknown>
  askPortalAi?: (payload?: Record<string, unknown>) => Promise<unknown>
}

const DEFAULT_PUBLIC_CONFIG: PortalConfig = {
  aboutBlocks: [],
  aiEnabled: false,
  businessName: '',
  contactLinkLabels: { messenger: 'Messenger', telegram: 'Telegram', whatsapp: 'WhatsApp', phone: '', instagram: 'Instagram' },
  contactLinks: { messenger: '', telegram: '', whatsapp: '', phone: '', instagram: '' },
  exchangeRate: 4100,
  faqItems: [],
  gridColumnsAuto: true,
  announcementEnabled: false,
  announcementTextEn: '',
  announcementTextKm: '',
  announcementLink: '',
  announcementStart: '',
  announcementEnd: '',
  announcementVersion: '',
  gridColumnsDesktop: 4,
  gridColumnsMobile: 2,
  heroGradientEnd: '#e7dccb',
  heroGradientMid: '#efe7da',
  heroGradientStart: '#f6f1e8',
  highlightRankLimit: 3,
  linkLabels: { website: 'Website', facebook: 'Facebook', instagram: 'Instagram', telegram: 'Telegram' },
  links: { website: '', facebook: '', instagram: '', telegram: '' },
  logoFit: 'cover',
  logoPositionX: 50,
  logoPositionY: 50,
  logoZoom: 100,
  lowStockThreshold: '',
  outOfStockThreshold: '',
  priceDisplay: 'USD',
  promoItems: [],
  recommendedProductIds: [],
  redeemPoints: 100,
  redeemValueKhr: 4100,
  redeemValueUsd: 1,
  refreshSeconds: 20,
  showAbout: true,
  showAddress: true,
  showCatalog: true,
  showContactInstagram: true,
  showContactMessenger: true,
  showContactTelegram: true,
  showContactPhone: false,
  showContactWhatsapp: false,
  showEmail: true,
  showFacebook: true,
  showFaq: true,
  showGoogleMap: true,
  showInstagram: true,
  showLogo: true,
  showCover: true,
  showMembership: false,
  showOutOfStockProducts: false,
  showStockStatus: false,
  showPhone: true,
  showPrices: false,
  showProductBrand: true,
  showProductCategory: true,
  showProductDiscount: true,
  showPromotions: true,
  showRecommendedBadge: true,
  showTelegram: true,
  showTopProductBadge: true,
  showTopSellerBadge: true,
  showWebsite: true,
  stockThresholdMode: 'product',
  submissionEnabled: false,
  submissionRewardPoints: 5,
  title: '',
  translateWidgetEnabled: true,
}

function getCatalogApi(): CatalogApi {
  return (window as Window & { api?: CatalogApi }).api || {}
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : String((error as LooseRecord)?.message || fallback)
}

function toNumber(value: unknown, fallback: unknown = 0): number {
  const parsed = Number(value)
  const fallbackNumber = Number(fallback)
  return Number.isFinite(parsed) ? parsed : (Number.isFinite(fallbackNumber) ? fallbackNumber : 0)
}

function normalizePriceDisplay(value: unknown): string {
  const raw = String(value || '').trim()
  return ['USD', 'KHR', 'BOTH'].includes(raw) ? raw : 'USD'
}

function normalizeCatalogOptions(value: unknown): CatalogOption[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    if (typeof item === 'string') return { id: item || index, name: item }
    return { id: (item as LooseRecord)?.id ?? index, name: String((item as LooseRecord)?.name ?? item ?? '') }
  }).filter((item) => item.name)
}

function normalizeBrandOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => (typeof item === 'string' ? item : String((item as LooseRecord)?.name ?? item ?? ''))).filter(Boolean)
}

function normalizePortalInitialOptions(value: unknown): PortalInitialOption[] {
  if (!Array.isArray(value)) return []
  return aggregateInitialOptions(value.map((item) => (typeof item === 'string' ? { key: item, value: item, count: 1 } : item)))
}

function normalizeFaqItems(input: unknown): Array<{ id: string | number; question: string; answer: string }> {
  if (!Array.isArray(input)) return []
  return input
    .map((item, index) => ({
      id: String((item as LooseRecord)?.id || `faq-${index + 1}`),
      question: String((item as LooseRecord)?.question || '').trim(),
      answer: String((item as LooseRecord)?.answer || '').trim(),
    }))
    .filter((item) => item.question && item.answer)
}

function buildPortalBackground(config: PortalConfig, darkMode = false): string {
  // Flat ivory page (no hero gradient). The white cards, sheets and menus read against it.
  void config
  return darkMode ? PORTAL_DARK_SURFACE : PORTAL_LIGHT_SURFACE
}

function getPortalTabs(config: PortalConfig, copy: CopyFunction): PortalTab[] {
  const items = [
    config.showAbout ? { key: 'about', label: copy('about', 'About'), icon: Store } : null,
    config.showCatalog ? { key: 'products', label: copy('products', 'Products'), icon: ShoppingBag } : null,
    // Account (sign-in / sign-up / profile) is no longer a nav tab — it moved
    // to a top-bar icon that opens a slide-in drawer, alongside Wishlist (user
    // correction to §2). Nav tabs are now About · Products · FAQ · AI.
    config.showFaq ? { key: 'faq', label: copy('faq', 'FAQ'), icon: HelpCircle } : null,
    config.aiEnabled ? { key: 'ai', label: config.aiTitle || copy('portalAssistant', 'AI assistant'), icon: Bot } : null,
  ]
  return items.filter(Boolean) as PortalTab[]
}

function resolvePortalActiveTab(config: PortalConfig, copy: CopyFunction, current = ''): string {
  const tabs = getPortalTabs(config, copy)
  return tabs.some((item) => item.key === current) ? current : (tabs[0]?.key || 'products')
}


function normalizeProductGallery(product: CatalogProduct | null | undefined): string[] {
  const source = Array.isArray(product?.image_gallery) ? product.image_gallery : (product?.image_path ? [product.image_path] : [])
  const unique: string[] = []
  const seen = new Set<string>()
  for (const item of source) {
    const value = String(item || '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    unique.push(value)
    if (unique.length >= ADMIN_MAX_PRODUCT_GALLERY_IMAGES) break
  }
  if (!unique.length && product?.image_path) unique.push(String(product.image_path))
  return unique
}

function formatPortalPrice(usd: unknown, khr: unknown, config: { exchangeRate?: unknown; priceDisplay?: unknown }): string {
  const usdValue = Number(usd || 0)
  const exchangeRate = Number(config.exchangeRate || 4100)
  const khrValue = khr != null ? Number(khr || 0) : usdValue * exchangeRate
  const usdText = `$${usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const khrText = `${Math.round(khrValue).toLocaleString('en-US')}៛`
  const display = normalizePriceDisplay(config.priceDisplay)
  if (display === 'KHR') return khrText
  if (display === 'BOTH') return `${usdText} / ${khrText}`
  return usdText
}

function replaceVars(template: unknown, values: Record<string, unknown>): string {
  return String(template || '').replace(/\{(\w+)\}/g, (_match: string, key: string) => String(values?.[key] ?? ''))
}

function normalizeBootstrapPayload(payload: unknown) {
  const data = (payload || {}) as LooseRecord
  const meta = (data.meta || {}) as LooseRecord
  return {
    config: { ...DEFAULT_PUBLIC_CONFIG, ...(data.config || {}) } as PortalConfig,
    products: Array.isArray(data.products) ? data.products as CatalogProduct[] : [],
    catalog: (data.catalog || {}) as LooseRecord,
    categories: normalizeCatalogOptions(meta.categories || data.categories),
    brands: normalizeBrandOptions(meta.brands || data.brands),
    branches: normalizeCatalogOptions(meta.branches || data.branches),
  }
}

function normalizeConfigPayload(payload: unknown): PortalConfig {
  const fetched = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
  return { ...DEFAULT_PUBLIC_CONFIG, ...fetched }
}

function SignalOnMount({ onMount }: { onMount: () => void }) {
  useEffect(onMount, [onMount])
  return null
}

// How long the About card waits for its cover before it shows anyway (a slow connection keeps the 16:9 frame instead).
const COVER_WAIT_MS = 1200

type CoverState = 'waiting' | 'ready' | 'failed'

/**
 * Where the About cover stands: 'ready' once it has arrived or COVER_WAIT_MS has run out, 'failed' when the file could not be loaded,
 * and 'ready' at once when there is nothing to wait for ('').
 * The cover is shown whole at its own proportions, which only the file knows, so a card painted before the file is in is pushed
 * down by the difference when the picture decodes. Holding the card (the page shows the skeleton meanwhile, and the footer waits
 * for the card) puts the whole card on screen at its final size, and a failed file shows the brand banner from the start instead
 * of a frame that collapses. The request starts as soon as the config is in hand, which is earlier than the lazy About chunk used
 * to start it, and the card's own image element then finds the file in the browser's cache.
 */
function useCoverState(src: string): CoverState {
  const [settled, setSettled] = useState<{ src: string; state: CoverState }>({ src: '', state: 'waiting' })
  useEffect(() => {
    if (!src) return undefined
    let live = true
    let timer = 0
    // The first outcome stands: a file that failed must not be turned back into 'ready' by the wait running out a moment later.
    const finish = (state: CoverState) => {
      if (!live) return
      live = false
      window.clearTimeout(timer)
      setSettled({ src, state })
    }
    timer = window.setTimeout(() => finish('ready'), COVER_WAIT_MS)
    const image = new Image()
    image.fetchPriority = 'high'
    image.onload = () => finish('ready')
    image.onerror = () => finish('failed')
    image.src = src
    if (image.complete && image.naturalWidth > 0) finish('ready')
    return () => {
      live = false
      window.clearTimeout(timer)
      image.onload = null
      image.onerror = null
    }
  }, [src])
  if (!src) return 'ready'
  return settled.src === src ? settled.state : 'waiting'
}

// The public catalog's bootstrap/search endpoints return one row per branch
// for products that are otherwise identical, and grouped products (same
// name, different branch/price/barcode) get collapsed to a single card
// showing the highest-priced variant. See portalProductGrouping.ts for the
// full reasoning -- pulled into its own module so it can be unit-tested
// directly with plain node, same split as portalBucket.ts.

export default function PublicCatalogPage() {
  const { theme, toggleTheme, t } = useApp() as { theme?: string; toggleTheme: () => void; t?: (key: string) => string }
  const paintConfigRef = useRef(readPaintEmbed())
  const productRequestRef = useRef(0)
  const aliveRef = useRef(true)
  const previewSectionRef = useRef<HTMLDivElement>(null)
  const publicPortalNavRef = useRef<HTMLElement>(null)
  const skipNextProductSearchRef = useRef(false)

  // The shopper's own 20/50/100 choice, read once per mount. It OUTRANKS the
  // server's page size: the bootstrap payload is always cut at the Worker's
  // fixed 50 (routes/portal.ts), so without this ref every response would put
  // a shopper who picked 20 straight back onto 50.
  const viewerPageSizeRef = useRef(readStoredCatalogPageSize())
  const [config, setConfig] = useState<PortalConfig>(() => ({ ...DEFAULT_PUBLIC_CONFIG, ...paintConfigRef.current }) as PortalConfig)
  const [realConfigInHand, setRealConfigInHand] = useState(() => paintConfigRef.current !== null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [productsFailed, setProductsFailed] = useState(false)
  const [tabContentMounted, setTabContentMounted] = useState(false)
  const markTabContentMounted = useCallback(() => setTabContentMounted(true), [])
  const [products, setProducts] = useState<CatalogProduct[]>([])
  // The grid holds its skeletons until a page cut at the viewer's own size
  // lands. The bootstrap is always the store's first 50 families ordered by
  // brand (routes/portal.ts buildPortalCatalog), so for a shopper on 20 it is
  // neither their page 1 nor a prefix of it (the a1d55f12 over-fill glitch).
  const [awaitingViewerSizedProducts, setAwaitingViewerSizedProducts] = useState(true)
  const [portalPromotionRules, setPortalPromotionRules] = useState<PromotionRule[]>([])
  const [productTotal, setProductTotal] = useState(0)
  const [productPage, setProductPage] = useState(1)
  const [productPageSize, setProductPageSize] = useState(() => viewerPageSizeRef.current || CATALOG_DEFAULT_PAGE_SIZE)
  const [productInitial, setProductInitial] = useState('all')
  const [productInitials, setProductInitials] = useState<PortalInitialOption[]>([])
  const [categories, setCategories] = useState<CatalogOption[]>([])
  const [brands, setBrands] = useState<string[]>([])
  const [branches, setBranches] = useState<CatalogOption[]>([])
  // Default landing tab is About (user request): leangbeauty.com opens on the
  // store's About page. resolvePortalActiveTab falls back to the first visible
  // tab if About is turned off in config.
  const [activeTab, setActiveTab] = useState(() => resolvePortalActiveTab({ ...DEFAULT_PUBLIC_CONFIG, ...paintConfigRef.current } as PortalConfig, (_key, fallback = '') => fallback, 'about'))
  const [search, setSearch] = useState('')
  // G37: the storefront search asked the server on every keystroke; 250 ms
  // of quiet first (the input itself still updates immediately).
  const debouncedSearch = useDebouncedValue(search, 250)
  const deferredSearch = useMemo(() => debouncedSearch.trim(), [debouncedSearch])
  const [categoryFilter, setCategoryFilter] = useState<string[]>([])
  const [brandFilter, setBrandFilter] = useState<string[]>([])
  const [branchFilter, setBranchFilter] = useState<string[]>([])
  const [stockFilter, setStockFilter] = useState<string[]>([])
  // G1b: the storefront's promo facet -- '' (off), 'promoted' (the "only
  // deals" toggle) or 'rule:<id>' (a campaign chip on the promo strip).
  const [promoFacet, setPromoFacet] = useState('')
  // PUBLIC-FILTER-MENU: View (brand by default) + Sort, from the URL and back
  // into it. The ref is for the bootstrap handler below, which closes over its
  // first render and would otherwise judge the payload against stale state.
  const { view: browseView, sort: browseSort, setView: setBrowseView, setSort: setBrowseSort } = usePortalBrowse(true)
  const browseRef = useRef({ view: browseView, sort: browseSort })
  browseRef.current = { view: browseView, sort: browseSort }
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshingProducts, setRefreshingProducts] = useState(false)
  const [productGalleryView, setProductGalleryView] = useState<GalleryViewState>({ open: false, title: '', items: [], index: 0 })
  const [productDetailView, setProductDetailView] = useState<ProductDetailViewState>({ open: false, product: null, gallery: [], status: 'in_stock', pricePresentation: null, showPrices: true })
  const [portalImageView, setPortalImageView] = useState<PortalImageViewState>({ open: false, title: '', images: [], index: 0 })
  const [filePicker, setFilePicker] = useState<FilePickerState>({ open: false, mediaType: 'image', title: '' })
  const [expandedFaqId, setExpandedFaqId] = useState<string | number | null>(null)
  const [assistantProfile, setAssistantProfile] = useState({ brand: '', skinType: '', shoppingFor: '', goal: '', concerns: '' })
  const [assistantQuestion, setAssistantQuestion] = useState('')
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [assistantError, setAssistantError] = useState('')
  const [assistantResponse, setAssistantResponse] = useState<LooseRecord | null>(null)
  const [assistantDisclosure, setAssistantDisclosure] = useState<AiProviderState | null>(null)
  const [assistantDataUseConsent, setAssistantDataUseConsent] = useState(false)
  // What the visitor picked (six values). pageLanguage is what the storefront's own copy and the Worker see: km or en.
  const [pageChoice, setPageChoice] = useState(readPublicStorefrontChoice)
  const pageLanguage = portalCopyLanguage(pageChoice)
  // The last hand-written language the menu was on: where a failed Google translation puts the visitor back.
  const lastPlainChoiceRef = useRef<'en' | 'km'>(portalCopyLanguage(pageChoice))
  const [translateNotice, setTranslateNotice] = useState('')
  const translateNoticeTimerRef = useRef<number | null>(null)
  const copy: CopyFunction = (key, fallback = '', fallbackKm = fallback) =>
    resolveStorefrontCopy(pageLanguage, t, key, fallback, fallbackKm)
  const bucket = usePortalBucket()
  const wishlist = usePortalWishlist()
  // Storefront account state + cart/wishlist server sync (§2). Guests keep
  // their list in this browser; signing in mirrors it to the account.
  const portalAccount = usePortalAccount(bucket, wishlist, copy)
  // Account (profile / sign-in) and Wishlist each open as a slide-in drawer
  // from their own top-bar icon (user request), same overlay pattern as the
  // cart bucket drawer below.
  // G38 P0 (owner 27 Sep): on the shop host /login is the customer sign-in,
  // never the staff app, so arriving there opens this drawer.
  const [accountOpen, setAccountOpen] = useState(() => typeof window !== 'undefined' && isStorefrontSignInPath(window.location?.pathname))
  // Saved and List are one full page inside the storefront (spec section 4), not drawers. Opening it pushes one history entry, so the browser's
  // Back returns the visitor to where they were (the tab, and how far down the page they had scrolled). Tabs themselves are plain state.
  const [listView, setListView] = useState<PortalListSegment | null>(null)
  const listEntryPushedRef = useRef(false)
  const listOpenerRef = useRef<HTMLElement | null>(null)
  const listReturnScrollRef = useRef(0)
  const listImages = usePortalListImages()
  useEffect(() => {
    const onPopState = () => {
      if (!listEntryPushedRef.current) return
      listEntryPushedRef.current = false
      setListView(null)
      const opener = listOpenerRef.current
      const top = listReturnScrollRef.current
      window.requestAnimationFrame(() => {
        window.scrollTo(0, top)
        if (opener?.isConnected) opener.focus({ preventScroll: true })
      })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  // The Contact menu opened from a button that belongs to another part of the page (the FAQ and About "Contact" buttons call openContactSheet with
  // no trigger of their own): it opens beside whatever was pressed last, and focus goes back there when it closes.
  const [contactAnchor, setContactAnchor] = useState<PortalContactAnchor | null>(null)
  const lastPressRef = useRef<HTMLElement | null>(null)
  const [bucketCopyState, setBucketCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [scrollButtonsVisible, setScrollButtonsVisible] = useState(false)
  // Bumped by the pull-to-refresh gesture and by Retry to run the load effect
  // below again.
  const [reloadToken, setReloadToken] = useState(0)
  const publicPageRootRef = useRef<HTMLDivElement | null>(null)

  // The `data-public-portal` document marker, which NOTHING was setting on
  // the live storefront.
  //
  // There are two storefront entries. index.tsx picks PublicCatalogRoot ->
  // this component whenever isPublicCatalogPath() is true, which is every
  // path on the customer host -- that is the shipped shop. App.tsx's
  // PublicCatalogView -> `<CatalogPage publicView />` is the other one, and
  // CatalogPage carries its own effect for this attribute. This file never
  // renders CatalogPage (it mounts CatalogPreviewSurface directly), so on the
  // entry customers actually load, html/body never got the marker at all.
  //
  // Everything keyed off it was therefore inert on the real shop: the
  // `overflow-y: auto` + `height: auto` unlock in main.css, and in
  // public-portal.css the Google-Translate banner suppression plus the
  // `body { top: 0 !important; position: static !important }` that undoes the
  // banner's downward shove of the whole document. (The media-protection and coarse-
  // pointer tap-target rules survived only because they carry a second
  // `[data-public-media-protection='true']` selector, which this page's root
  // div does set.)
  //
  // Previous values are captured and restored rather than blindly removed, so
  // a StrictMode double-mount -- or any future route that renders this page
  // under a shell that already set the marker -- cannot leave the document
  // stripped of it.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const html = document.documentElement
    const body = document.body
    const previousHtmlMarker = html.getAttribute('data-public-portal')
    const previousBodyMarker = body.getAttribute('data-public-portal')
    html.setAttribute('data-public-portal', 'true')
    body.setAttribute('data-public-portal', 'true')
    return () => {
      if (previousHtmlMarker === null) html.removeAttribute('data-public-portal')
      else html.setAttribute('data-public-portal', previousHtmlMarker)
      if (previousBodyMarker === null) body.removeAttribute('data-public-portal')
      else body.setAttribute('data-public-portal', previousBodyMarker)
    }
  }, [])

  // Drives the scroll-to-top/bottom buttons in CatalogPreviewSurface. This
  // used to be hardcoded to `false` here, which silently disabled the
  // feature on the real public portal (it only ever worked in the admin's
  // editable preview, CatalogPage.tsx, which tracks its own scroll
  // position). Same 220px threshold as that preview.
  //
  // NOTE on the `!bucketOpen && !contactAnchor` guard at the call site below:
  // these buttons render at z-[70] (bottom-left), which is intentionally
  // *above* the bucket drawer (z-[60]) and contact popover (z-[65]) so they
  // don't get trapped underneath either overlay. But that same ordering
  // means that without this guard, scrolling past 220px and then opening
  // either modal would leave the scroll buttons floating on top of the
  // modal's dimmed backdrop, fully clickable -- visually intruding on the
  // modal and letting a tap scroll the page behind it while the modal is
  // supposed to have focus. Tying visibility to the overlay state keeps
  // them hidden/inert for as long as either modal is open, same as any
  // other page-content control would be.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const updateVisibility = () => {
      const scrollTop = Math.max(window.scrollY || 0, document.documentElement?.scrollTop || 0, document.body?.scrollTop || 0)
      setScrollButtonsVisible(scrollTop > 220)
    }
    updateVisibility()
    window.addEventListener('scroll', updateVisibility, { passive: true })
    window.addEventListener('resize', updateVisibility)
    return () => {
      window.removeEventListener('scroll', updateVisibility)
      window.removeEventListener('resize', updateVisibility)
    }
  }, [])

  // WCAG 3.1.1: the language selector changed every string on screen but
  // never what the DOCUMENT claimed to be written in, so a screen reader
  // kept reading a Khmer storefront with English pronunciation (and a
  // translation tool kept offering to translate it into the language it was
  // already showing).
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const previous = document.documentElement.lang
    document.documentElement.lang = pageLanguage
    return () => { document.documentElement.lang = previous }
  }, [pageLanguage])

  // B9: the storefront never mounts App.tsx (see PublicCatalogRoot.tsx), so it arms the
  // standalone external-link guard itself; a no-op in an ordinary browser tab. The install
  // capture is armed earlier, in index.tsx.
  useEffect(() => installStandaloneExternalLinkGuard(), [])

  // Google Translate loads only after the visitor picks one of its four languages; the controller is its own lazy chunk.
  useEffect(() => {
    if (!isGoogleLanguageChoice(pageChoice)) lastPlainChoiceRef.current = portalCopyLanguage(pageChoice)
  }, [pageChoice])
  useEffect(() => {
    if (!isGoogleLanguageChoice(pageChoice)) return undefined
    let cancelled = false
    // When Google does not translate: the menu goes back to the language the visitor had, the cookie is cleared and one line says so.
    const fallBack = (previous: 'en' | 'km') => {
      if (cancelled) return
      storePortalLanguage(previous)
      setPageChoice(previous)
    }
    const tellVisitor = (previous: 'en' | 'km') => {
      if (cancelled) return
      setTranslateNotice(resolveStorefrontCopy(previous, t, 'translateUnavailable', 'Translation is not available right now.', 'ឥឡូវនេះមិនអាចបកប្រែបានទេ។'))
      if (translateNoticeTimerRef.current) window.clearTimeout(translateNoticeTimerRef.current)
      translateNoticeTimerRef.current = window.setTimeout(() => setTranslateNotice(''), 6000)
    }
    import('./portalTranslateController.ts')
      .then((controller) => controller.applyPortalGoogleTranslateOrFallBack(pageChoice, { previous: lastPlainChoiceRef.current, restoreChoice: fallBack, showNotice: tellVisitor, isCurrent: () => !cancelled }))
      .catch(() => { fallBack(lastPlainChoiceRef.current); tellVisitor(lastPlainChoiceRef.current) })
    return () => { cancelled = true }
  }, [pageChoice])
  useEffect(() => () => { if (translateNoticeTimerRef.current) window.clearTimeout(translateNoticeTimerRef.current) }, [])

  const changePageLanguage = (next: string) => {
    const choice = normalizePortalChoice(next)
    if (!choice) return
    storePortalLanguage(choice)
    if (isGoogleLanguageChoice(pageChoice) && !isGoogleLanguageChoice(choice)) {
      // Google moved the page's text nodes: take its translation off (a reload when it already rewrote the page).
      import('./portalTranslateController.ts')
        .then((controller) => { if (controller.removePortalGoogleTranslate() === 'clean') setPageChoice(choice) })
        .catch(() => setPageChoice(choice))
      return
    }
    setPageChoice(choice)
  }

  useEffect(() => {
    clearRetiredPortalCache()
    // Warm the About chunk while the config is on its way; the real mount retries and reports a failure.
    if (!paintConfigRef.current) loadCatalogSecondaryTabs().catch(() => undefined)
  }, [])

  useEffect(() => {
    const api = getCatalogApi()
    setLoading(products.length === 0)
    return startStorefrontLoad({
      fetchBootstrap: () => api.getPortalBootstrap?.() || Promise.reject(new Error('Portal bootstrap API unavailable')),
      fetchConfig: realConfigInHand ? null : () => api.getPortalConfig?.() || Promise.reject(new Error('Portal config API unavailable')),
      onConfig: (payload) => {
        const nextConfig = normalizeConfigPayload(payload)
        setConfig(nextConfig)
        setRealConfigInHand(true)
        setActiveTab((tab) => resolvePortalActiveTab(nextConfig, copy, tab))
      },
      onBootstrap: (payload) => {
        const next = normalizeBootstrapPayload(payload)
        // The server's order is final (brand-first, or the shopper's View and
        // Sort): re-sorting A-Z here scrambled the brand groups on every page.
        const mergedProducts = mergePortalCatalogProducts(next.products, true)
        // This payload is only the grid's page when it was cut at the size
        // the shopper actually browses at AND in the default View/Sort -- a
        // shared link that opens on Category or Lowest price must not paint
        // the brand-ordered page first.
        const bootstrapMatchesViewer = bootstrapPageSizeMatchesViewer(next.catalog.pageSize, viewerPageSizeRef.current)
          && isDefaultPortalBrowse(browseRef.current.view, browseRef.current.sort)
        setConfig(next.config)
        setRealConfigInHand(true)
        setLoadFailed(false)
        setProductsFailed(false)
        if (bootstrapMatchesViewer) setProducts(mergedProducts)
        // Only ever LOWERS the wait: this response and the corrective search
        // race each other, and a slow bootstrap must not drop skeletons back
        // over a grid the search has already filled at the viewer's size.
        setAwaitingViewerSizedProducts((waiting) => waiting && !bootstrapMatchesViewer)
        setProductTotal(Number(next.catalog.total || next.products.length || 0))
        if (Array.isArray((next.catalog as Record<string, unknown>).promotion_rules)) {
          setPortalPromotionRules((next.catalog as Record<string, unknown>).promotion_rules as PromotionRule[])
        }
        setProductPage(Number(next.catalog.page || 1) || 1)
        if (!viewerPageSizeRef.current) setProductPageSize(Number(next.catalog.pageSize || CATALOG_DEFAULT_PAGE_SIZE) || CATALOG_DEFAULT_PAGE_SIZE)
        setProductInitials(normalizePortalInitialOptions(next.catalog.initials))
        setCategories(next.categories)
        setBrands(next.brands)
        setBranches(next.branches)
        setActiveTab((tab) => resolvePortalActiveTab(next.config, copy, tab))
        skipNextProductSearchRef.current = bootstrapMatchesViewer
        setLoading(false)
      },
      onBootstrapFailed: () => {
        // The follow-up product search decides the grid; a grid already on
        // screen (pull-to-refresh) keeps showing with the failure above it.
        if (products.length > 0) setProductsFailed(true)
        setLoading(false)
      },
      onFailed: () => {
        setLoadFailed(true)
        setLoading(false)
      },
    })
  }, [reloadToken])

  const retryLoad = () => {
    setLoadFailed(false)
    setProductsFailed(false)
    setAwaitingViewerSizedProducts(true)
    setReloadToken((token) => token + 1)
  }

  useEffect(() => {
    setProductPage(1)
  }, [brandFilter, branchFilter, browseSort, browseView, categoryFilter, deferredSearch, productInitial, promoFacet, stockFilter])

  // The shopper's 20/50/100 choice from the pager. Kept in the ref as well as
  // in state so every later bootstrap keeps deferring to it, persisted for the
  // next visit, and back to page 1 because re-cutting the list is the one
  // thing that can leave the current page number out of range.
  const changeProductPageSize = (nextSize: number) => {
    const size = normalizeCatalogPageSize(nextSize)
    viewerPageSizeRef.current = size
    writeStoredCatalogPageSize(size)
    setProductPageSize(size)
    setProductPage(1)
  }

  // A new View or Sort re-cuts the list, so page 1 goes in the SAME update as
  // the change: the search effect then runs once, for the right page, instead of
  // once for the old page and again after the reset effect above.
  const changeBrowseView: typeof setBrowseView = (view) => {
    setProductPage(1)
    setBrowseView(view)
  }
  const changeBrowseSort: typeof setBrowseSort = (sort) => {
    setProductPage(1)
    setBrowseSort(sort)
  }

  // A boolean, not loading + products.length: the response itself changes the
  // grid's length, and that re-ran this effect into a second identical request.
  const productSearchReady = !(loading && products.length === 0)
  useEffect(() => {
    if (!config.showCatalog || loadFailed) return undefined
    if (!productSearchReady) return undefined
    if (skipNextProductSearchRef.current) {
      skipNextProductSearchRef.current = false
      return undefined
    }
    const requestId = beginTrackedRequest(productRequestRef)
    setRefreshingProducts(products.length > 0)
    const params = {
      page: productPage,
      pageSize: productPageSize,
      query: deferredSearch,
      brand: brandFilter.join(','),
      category: categoryFilter.join(','),
      branchId: branchFilter.join(','),
      // Ignored server-side too when the setting is off (see
      // buildPortalProductFilters), but dropping it here as well keeps a
      // stale selection from ever being sent in the first place.
      stockState: config.showStockStatus === false ? '' : stockFilter.join(','),
      promo: promoFacet,
      initial: productInitial,
      // Empty for the default pair, so an untouched storefront asks for the
      // same URL (and hits the same cache entry) it always did.
      ...portalBrowseParams(browseView, browseSort),
    }
    withLoaderTimeout(() => getCatalogApi().searchPortalCatalogProducts?.(params) || Promise.reject(new Error('Portal product search API unavailable')), 'Portal product search', PUBLIC_PORTAL_PRODUCT_SEARCH_TIMEOUT_MS)
      .then((result) => {
        if (!aliveRef.current || !isTrackedRequestCurrent(productRequestRef, requestId)) return
        const data = (result || {}) as LooseRecord
        // Keep the server's order (see portalProductGrouping.ts): relevance
        // while a term is typed, otherwise the View/Sort it was asked for.
        const nextItems = mergePortalCatalogProducts(data.items, true)
        const nextInitials = normalizePortalInitialOptions(data.initials)
        const nextTotal = Number(data.total || 0)
        const responsePage = Number(data.page || productPage) || 1
        const responsePageSize = Number(data.pageSize || productPageSize) || productPageSize
        // The public catalog is server-paginated: if a product was deleted (or
        // filters otherwise shrank the result set) while a customer was sitting
        // on a later page, the server echoes back that same now-out-of-range
        // page with an empty items array instead of self-correcting. Clamp and
        // re-fetch here — same pattern as AuditLog.tsx's admin-side list — so a
        // browsing customer is never silently stranded on a permanently empty
        // page of the storefront.
        const clampedPage = clampPage(responsePage, nextTotal, responsePageSize)
        if (clampedPage !== responsePage) {
          setProductPage(clampedPage)
          return
        }
        setProducts(nextItems)
        setAwaitingViewerSizedProducts(false)
        setProductTotal(nextTotal)
        if (Array.isArray((data as Record<string, unknown>).promotion_rules)) {
          setPortalPromotionRules((data as Record<string, unknown>).promotion_rules as PromotionRule[])
        }
        setProductPage(responsePage)
        setProductPageSize(responsePageSize)
        setProductInitials(nextInitials)
        if (Array.isArray(data.filters?.brands)) setBrands(normalizeBrandOptions(data.filters.brands))
        if (Array.isArray(data.filters?.categories)) {
          setCategories(data.filters.categories.map((name: string, index: number) => ({ id: `server-${index}-${name}`, name })))
        }
        setProductsFailed(false)
      })
      .catch(() => {
        if (!aliveRef.current || !isTrackedRequestCurrent(productRequestRef, requestId)) return
        setAwaitingViewerSizedProducts(false)
        setProductsFailed(true)
      })
      .finally(() => {
        if (!aliveRef.current || !isTrackedRequestCurrent(productRequestRef, requestId)) return
        setRefreshingProducts(false)
      })
    return () => {
      invalidateTrackedRequest(productRequestRef)
    }
  }, [brandFilter, branchFilter, browseSort, browseView, categoryFilter, config.showCatalog, config.showStockStatus, deferredSearch, loadFailed, productInitial, productPage, productPageSize, productSearchReady, promoFacet, stockFilter])

  // Re-arm on mount, not just tear down: React 18 StrictMode (dev) runs
  // mount -> cleanup (simulated unmount) -> mount again on the SAME refs.
  // A cleanup-only effect left aliveRef stuck at false after the simulated
  // unmount, so in dev every fetch's `.then` bailed silently forever --
  // the grid never applied search/filter/pagination responses and
  // "Refreshing..." never cleared. Production (no double-invoke) hid it.
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      invalidateTrackedRequest(productRequestRef)
    }
  }, [])

  const displayConfig = useMemo<PortalConfig>(
    () => localizeDefaultConfigCopy({ ...DEFAULT_PUBLIC_CONFIG, ...config }, pageLanguage),
    [config, pageLanguage],
  )
  // The announcement bar (owner, 2 Nov): the Worker publishes the message with the config; whether it is on today and whether this
  // browser already closed this version is decided here, so the cached payload never depends on the clock.
  const [dismissedAnnouncement, setDismissedAnnouncement] = useState(readDismissedPortalAnnouncement)
  const [announcementDay, setAnnouncementDay] = useState(todayStr)
  useEffect(() => startVisibleInterval(() => setAnnouncementDay(todayStr()), 5 * 60 * 1000), [])
  const announcement = useMemo(() => {
    const found = resolvePortalAnnouncement(displayConfig, pageLanguage, announcementDay)
    return found && found.version !== dismissedAnnouncement ? found : null
  }, [displayConfig, pageLanguage, announcementDay, dismissedAnnouncement])
  const dismissAnnouncement = useCallback(() => {
    if (!announcement) return
    dismissPortalAnnouncement(announcement.version)
    setDismissedAnnouncement(announcement.version)
  }, [announcement])
  // A price sort from a stale link or bookmark on a store that now hides its
  // prices: drop back to the default rather than order by a hidden number.
  useEffect(() => {
    if (realConfigInHand && !displayConfig.showPrices && isPortalPriceSort(browseSort)) setBrowseSort(DEFAULT_PORTAL_BROWSE_SORT)
  }, [realConfigInHand, displayConfig.showPrices, browseSort, setBrowseSort])
  const darkMode = theme === 'dark'
  const portalBackground = buildPortalBackground(displayConfig, darkMode)
  const previewTitle = String(displayConfig.businessName || displayConfig.title || '').trim()
  const previewBusinessName = String(displayConfig.businessName || '').trim()
  const showBrandLabel = previewBusinessName && previewBusinessName.toLowerCase() !== previewTitle.toLowerCase()
  const portalTabs = getPortalTabs(displayConfig, copy)
  const mobileGridColumns = Math.min(3, Math.max(1, Math.round(toNumber(displayConfig.gridColumnsMobile, 1))))
  const compactTwoColumnMobile = mobileGridColumns >= 2
  // One class string for every width (automatic by default), the same builder as the Website Editor preview.
  const productGridClass = getPortalProductGridClass(displayConfig)
  const businessLogoUrl = String(displayConfig.businessLogo || '').trim()
  const businessCoverUrl = String(displayConfig.businessCover || '').trim()
  const coverState = useCoverState(activeTab === 'about' && realConfigInHand && displayConfig.showCover && businessCoverUrl ? businessCoverUrl : '')
  const selectedStockBranch = branchFilter[0] || 'all'
  const portalActiveFilterCount = categoryFilter.length + brandFilter.length + branchFilter.length + (displayConfig.showStockStatus === false ? 0 : stockFilter.length) + (productInitial === 'all' ? 0 : 1) + (promoFacet ? 1 : 0)
  const publicFaqItems = normalizeFaqItems(displayConfig.faqItems)
  const mapEmbedUrl = displayConfig.showGoogleMap && activeTab === 'about' ? normalizeGoogleMapsEmbed(displayConfig.googleMapsEmbed || '') : ''
  const businessFacts = [
    { key: 'phone', enabled: displayConfig.showPhone, label: copy('phone', 'Phone'), value: displayConfig.businessPhone, href: contactHref('tel', displayConfig.businessPhone), icon: Phone },
    { key: 'email', enabled: displayConfig.showEmail, label: copy('email', 'Email'), value: displayConfig.businessEmail, href: contactHref('mailto', displayConfig.businessEmail), icon: Mail },
    { key: 'address', enabled: displayConfig.showAddress, label: copy('address', 'Address'), value: displayConfig.businessAddress, href: normalizeExternalUrl(displayConfig.addressLink), icon: MapPin },
  ].filter((item) => item.enabled && item.value)
  const addressFact = businessFacts.find((item) => item.key === 'address') || null
  // One builder for the header's Contact menu, About and the footer: the visible text is the owner's label, else the real account name (never the
  // platform word when a name is known, never a leading "@"). Chat channels and page links are one list, with the same names everywhere.
  const socialBuilt = buildPortalSocialFromConfig(displayConfig, pageLanguage)
  const contactEntries = buildPortalContactEntries({
    social: socialBuilt.social,
    contact: socialBuilt.contact,
    phone: businessFacts.find((item) => item.key === 'phone')?.value,
    email: businessFacts.find((item) => item.key === 'email')?.value,
    mapHref: addressFact?.href,
    address: addressFact?.value,
    shopName: displayConfig.businessName || displayConfig.title,
    language: pageLanguage,
  })
  const socialLinks = portalContactFooterLinks(contactEntries)
  const assistantCategoryOptions = useMemo(() => Array.from(new Set(products.map((item) => String(item.category || '').trim()).filter(Boolean))).slice(0, 40), [products])

  const toggleFilterValue = (values: string[], setter: Dispatch<SetStateAction<string[]>>, value: string) => {
    setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value])
  }
  // Batch sibling of toggleFilterValue -- see CatalogPage.tsx's copy for
  // the full rationale (group-select for hierarchical category rows).
  const toggleFilterValues = (values: string[], setter: Dispatch<SetStateAction<string[]>>, batch: string[], checked: boolean) => {
    const wanted = new Set(batch)
    const kept = values.filter((item) => !wanted.has(item))
    setter(checked ? [...kept, ...batch] : kept)
  }
  const clearPortalFilters = () => {
    setSearch('')
    setCategoryFilter([])
    setBrandFilter([])
    setBranchFilter([])
    setStockFilter([])
    setPromoFacet('')
    setProductInitial('all')
  }
  const openProductGallery = (product: CatalogProduct, startIndex = 0) => {
    const items = normalizeProductGallery(product).map((item) => resolveCatalogAssetUrl(item) || item)
    if (!items.length) return
    setProductGalleryView({ open: true, title: resolveProductNames(product).heading, items, index: Math.max(0, Math.min(startIndex, items.length - 1)) })
  }
  const openPortalImage = (title: string, images: string[], index = 0) => {
    const cleanImages = images.map((item) => resolveCatalogAssetUrl(item) || item).filter(Boolean)
    if (!cleanImages.length) return
    setPortalImageView({ open: true, title, images: cleanImages, index: Math.max(0, Math.min(index, cleanImages.length - 1)) })
  }
  const clearAssistantState = () => {
    setAssistantError('')
    setAssistantResponse(null)
  }
  const askAssistant = () => {
    const question = assistantQuestion.trim()
    if (!question) {
      setAssistantError(copy('assistantQuestionRequired', 'Ask a question first.'))
      return
    }
    if (!assistantDataUseConsent) {
      setAssistantError(copy('assistantConsentRequired', 'Confirm the AI data-use notice before sending your question.', 'សូមបញ្ជាក់ការជូនដំណឹងអំពីការប្រើប្រាស់ទិន្នន័យ AI មុនពេលផ្ញើសំណួរ។'))
      return
    }
    setAssistantLoading(true)
    setAssistantError('')
    withLoaderTimeout(() => getCatalogApi().askPortalAi?.({ question, profile: assistantProfile, dataUseConsent: true }) || Promise.reject(new Error('AI assistant API unavailable')), 'AI assistant', PUBLIC_PORTAL_AI_TIMEOUT_MS)
      .then((result) => setAssistantResponse((result || null) as LooseRecord | null))
      .catch((error) => setAssistantError((error as { code?: unknown } | null)?.code === 'portal_ai_budget_exhausted'
        ? copy('assistantDailyLimit', 'The assistant has reached today\'s limit. Please try again tomorrow.', 'ជំនួយការបានដល់ចំនួនកំណត់សម្រាប់ថ្ងៃនេះហើយ។ សូមព្យាយាមម្តងទៀតនៅថ្ងៃស្អែក។')
        : getErrorMessage(error, 'AI assistant failed')))
      .finally(() => setAssistantLoading(false))
  }

  useEffect(() => {
    if (!displayConfig.aiEnabled) return
    if (activeTab !== 'ai') return
    getCatalogApi().getPortalAiStatus?.()
      ?.then((result) => {
        setAssistantDisclosure(aiProviderState(result))
      })
      .catch(() => {})
  }, [activeTab, displayConfig.aiEnabled])

  // Storefront tab title + FIXED storefront browser branding.
  //
  // This used to build the manifest AND the favicon at runtime from the
  // merchant's uploaded logo. Two problems, both fixed here:
  //   1. PWA "Install app" was gone on the public storefront (16.1): the
  //      manifest <link> was swapped to a runtime blob: URL, which Chrome
  //      refuses to treat as installable. The §16 fix that
  //      removed the blob swap only touched CatalogPage.tsx (the ADMIN
  //      preview) -- this is the actual public component index.tsx mounts.
  //   2. The favicon/PWA icon was per-merchant customizable, which 11.14-16
  //      removed (the portal editor changes the in-page LOGO only now).
  //
  // The fix keeps the established staff/storefront brand split (staff =
  // /manifest.json and the BO icons, which index.html's bootstrap picks on
  // admin hosts; storefront = the Leang files) but serves the storefront's
  // icon + manifest as STATIC same-origin files, which ARE installable,
  // instead of a runtime blob. No canvas, no idle scheduling, no
  // business-config input -- just a fixed brand swap. See
  // public/portal-manifest.json and brandIcons.test.ts.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const previousTitle = document.title
    const title = String(displayConfig.businessName || displayConfig.title || STOREFRONT_NAME).trim()
    document.title = title || STOREFRONT_NAME
    const restoreTitle = () => { document.title = previousTitle }
    // The storefront also renders at unknown paths on admin.*, and the staff
    // origin must never advertise the shop app.
    if (isAdminHostname()) return restoreTitle

    const iconEls = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'))
    const previousIconHrefs = iconEls.map((el) => el.getAttribute('href') || '')
    iconEls.forEach((el) => {
      el.setAttribute('href', STOREFRONT_ICON)
      el.setAttribute('type', 'image/png')
    })

    const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    const previousManifestHref = manifestLink?.getAttribute('href') || ''
    if (manifestLink) manifestLink.setAttribute('href', STOREFRONT_MANIFEST)

    const appleTouchIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
    const previousAppleTouchIconHref = appleTouchIcon?.getAttribute('href') || ''
    if (appleTouchIcon) appleTouchIcon.setAttribute('href', STOREFRONT_APPLE_TOUCH_ICON)

    const appleTitle = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')
    const previousAppleTitle = appleTitle?.getAttribute('content') || ''
    if (appleTitle) appleTitle.setAttribute('content', STOREFRONT_HOME_SCREEN_NAME)

    return () => {
      restoreTitle()
      iconEls.forEach((el, i) => {
        if (previousIconHrefs[i]) el.setAttribute('href', previousIconHrefs[i])
      })
      if (manifestLink && previousManifestHref) manifestLink.setAttribute('href', previousManifestHref)
      if (appleTouchIcon && previousAppleTouchIconHref) appleTouchIcon.setAttribute('href', previousAppleTouchIconHref)
      if (appleTitle && previousAppleTitle) appleTitle.setAttribute('content', previousAppleTitle)
    }
  }, [displayConfig.businessName, displayConfig.title])

  // Real gap found and fixed this session: CatalogProductsSection.tsx's card
  // onClick already calls `openProductDetail?.(product)`, and
  // CatalogPreviewSurface.tsx already renders <ProductDetailFlyout> keyed
  // off a `productDetailView` prop -- but neither `openProductDetail` nor
  // `productDetailView`/`closeProductDetailView` were ever actually passed
  // through on the public portal, so clicking a product card did nothing
  // and the whole Features/Benefits/Ingredients/Caution detail flyout
  // (what this session's Customer-Portal description-wiring work depends
  // on being visible at all) was unreachable dead code. Wired here using
  // the same per-card computation (stock qty/status, gallery, price
  // presentation) CatalogProductsSection.tsx already does for the card
  // itself, so the flyout shows numbers consistent with the card that was
  // clicked.
  const openProductDetail = (product: CatalogProduct) => {
    const status = resolvePortalStockStatus(product, selectedStockBranch)
    const gallery = normalizeProductGallery(product)
    const pricePresentation = displayConfig.showPrices
      ? buildPortalPricePresentation(product, displayConfig, formatPortalPrice, portalPromotionRules)
      : null
    setProductDetailView({ open: true, product, gallery, status, pricePresentation, showPrices: !!displayConfig.showPrices, showStockStatus: shouldShowStockStatus(displayConfig) })
  }
  // The product cards and the detail sheet add and save through these same two
  // functions, so a product behaves the same wherever it is tapped.
  // The list and the saved items keep no picture, so the page remembers the one a product had when it was added on this device.
  const addToBucket = (product: CatalogProduct, priceText?: string) => {
    listImages.remember(product.id, String(product.image_path || ''))
    bucket.add(portalRowFromProduct(product), priceText)
  }
  const toggleWishlist = (product: CatalogProduct, priceText?: string) => {
    listImages.remember(product.id, String(product.image_path || ''))
    wishlist.toggle(portalRowFromProduct(product), priceText)
  }
  const closeProductDetailView = () => setProductDetailView((prev) => ({ ...prev, open: false }))
  // The announcement strip and the promotion cards link to a product by id.
  // It is usually not on the loaded page, and there is no public by-id
  // route on purpose (it would be a second copy of the visibility, stock
  // and redaction rules), so it goes through the same search endpoint with
  // productId. A product that no longer answers (deleted, hidden, out of
  // stock with out-of-stock hidden) falls back to searching its name, so
  // the tap always does something visible.
  const openProductById = (productId: number, productName: string) => {
    const loaded = products.find((product) => Number(product.id) === productId)
    if (loaded) {
      openProductDetail(loaded)
      return
    }
    withLoaderTimeout(() => getCatalogApi().searchPortalCatalogProducts?.({ productId, pageSize: 1 }) || Promise.reject(new Error('Portal product search API unavailable')), 'Portal product lookup', PUBLIC_PORTAL_PRODUCT_SEARCH_TIMEOUT_MS)
      .then((result) => {
        if (!aliveRef.current) return
        const [product] = mergePortalCatalogProducts(((result || {}) as LooseRecord).items)
        if (product) openProductDetail(product)
        else setSearch(productName)
      })
      .catch(() => {
        if (aliveRef.current) setSearch(productName)
      })
  }

  // The FAQ and About Contact buttons open the same menu as the header's, beside the button that was pressed.
  const openContactSheet = () => {
    const opener = lastPressRef.current
    const rect = opener?.isConnected ? opener.getBoundingClientRect() : null
    setContactAnchor(rect
      ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height, opener }
      : { top: Math.max(0, window.innerHeight - 96), left: Math.round(window.innerWidth / 2), width: 1, height: 1, opener: null })
  }
  const closeContactSheet = useCallback(() => setContactAnchor(null), [])

  const storefrontSkeleton = <PublicStorefrontSkeleton label={copy('loadingPortal', 'Loading website...')} />
  const loadFailedText = copy('portalLoadFailed', "We couldn't open the shop. Check your connection and try again.", 'យើងមិនអាចបើកហាងបានទេ។ សូមពិនិត្យការតភ្ជាប់អ៊ីនធឺណិត ហើយព្យាយាមម្ដងទៀត។')
  const loadFailedPanel = (
    <div role="alert" data-portal-load-failed="true" className="mx-auto my-8 flex max-w-md flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm leading-6 text-slate-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
      <p>{loadFailedText}</p>
      <button type="button" className="btn-primary inline-flex items-center gap-2 text-sm" onClick={retryLoad}>
        <RotateCw className="h-4 w-4" />
        {copy('retry', 'Retry', 'ព្យាយាមម្ដងទៀត')}
      </button>
    </div>
  )

  // The offers banner lives inside the products section (one place, with its own
  // loading and retry), not as a second render above it.
  const promotionsSection = activeTab === 'products' ? (
    <Suspense fallback={null}>
      <PortalPromotionsBanner copy={copy} onOpenImage={openPortalImage} onOpenProduct={openProductById} />
    </Suspense>
  ) : null

  const catalogSection = displayConfig.showCatalog ? (productsFailed && products.length === 0 ? loadFailedPanel : (
    <Suspense fallback={<div className="portal-empty-card">{copy('catalogLoading', 'Loading products...')}</div>}>
      <CatalogProductsSection
        copy={copy}
        promotionRules={portalPromotionRules}
        filteredProducts={products}
        serverPaged
        productTotal={productTotal}
        productPage={productPage}
        productPageSize={productPageSize}
        setProductPage={setProductPage}
        setProductPageSize={changeProductPageSize}
        initialOptions={productInitials}
        initialFilter={productInitial}
        setInitialFilter={setProductInitial}
        refreshingProducts={refreshingProducts}
        loadingProducts={loading || awaitingViewerSizedProducts}
        categories={categories}
        brands={brands}
        branches={branches}
        publicView
        search={search}
        setSearch={setSearch}
        filtersOpen={filtersOpen}
        setFiltersOpen={setFiltersOpen}
        portalActiveFilterCount={portalActiveFilterCount}
        clearPortalFilters={clearPortalFilters}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
        brandFilter={brandFilter}
        setBrandFilter={setBrandFilter}
        branchFilter={branchFilter}
        setBranchFilter={setBranchFilter}
        stockFilter={stockFilter}
        promoFacet={promoFacet}
        setPromoFacet={setPromoFacet}
        browseView={browseView}
        setBrowseView={changeBrowseView}
        browseSort={browseSort}
        setBrowseSort={changeBrowseSort}
        setStockFilter={setStockFilter}
        toggleFilterValue={toggleFilterValue}
        toggleFilterValues={toggleFilterValues}
        previewConfig={displayConfig}
        portalError={productsFailed ? loadFailedText : ''}
        onRetry={retryLoad}
        promotionsBanner={promotionsSection}
        productGridClass={productGridClass}
        compactTwoColumnMobile={compactTwoColumnMobile}
        compactCatalogCards
        promotionItems={(displayConfig.promoItems || []).filter((item) => item && item.id != null) as Array<{ id: string | number } & Record<string, unknown>>}
        promotionsTitle={displayConfig.promotionsTitle}
        promotionsIntro={displayConfig.promotionsIntro}
        selectedStockBranch={selectedStockBranch}
        normalizeProductGallery={normalizeProductGallery}
        openProductGallery={openProductGallery}
        openProductDetail={openProductDetail}
        openProductById={openProductById}
        openPortalImage={openPortalImage}
        formatPortalPrice={formatPortalPrice}
        replaceVars={(template: string, values: Record<string, string | number>) => replaceVars(template, values)}
        onAddToBucket={addToBucket}
        isInBucket={bucket.hasItem}
        getBucketQty={bucket.getQty}
        isInWishlist={wishlist.has}
        onToggleWishlist={toggleWishlist}
      />
    </Suspense>
  )) : null

  const secondaryTabSection = activeTab !== 'products' ? (realConfigInHand && coverState !== 'waiting' ? (
    <Suspense fallback={storefrontSkeleton}>
      <CatalogSecondaryTabs
        tab={activeTab}
        imageFetchPriority="high"
        copy={copy}
        previewConfig={displayConfig}
        openPortalImage={openPortalImage}
        mapEmbedUrl={mapEmbedUrl}
        addressFact={addressFact}
        businessFacts={businessFacts}
        versionedBusinessLogo={businessLogoUrl}
        versionedBusinessCover={coverState === 'failed' ? '' : businessCoverUrl}
        publicFaqItems={publicFaqItems}
        expandedFaqId={expandedFaqId}
        setExpandedFaqId={setExpandedFaqId}
        onOpenContact={contactEntries.length > 0 ? openContactSheet : undefined}
        faqLoading={!realConfigInHand}
        openProductById={openProductById}
        catalogProducts={products}
        onAddRecommendation={(item: { id: number; name: string; shopLine?: string; category: string; brand: string }) => bucket.add(item)}
        brands={brands}
        assistantProfile={assistantProfile}
        setAssistantProfile={setAssistantProfile}
        assistantCategoryOptions={assistantCategoryOptions}
        assistantQuestion={assistantQuestion}
        setAssistantQuestion={setAssistantQuestion}
        questionCharLimit={500}
        askAssistant={askAssistant}
        assistantLoading={assistantLoading}
        clearAssistantState={clearAssistantState}
        assistantError={assistantError}
        assistantResponse={assistantResponse}
        assistantDisclosure={assistantDisclosure}
        assistantDataUseConsent={assistantDataUseConsent}
        setAssistantDataUseConsent={setAssistantDataUseConsent}
        accountSignedIn={!!portalAccount.account}
      />
      <SignalOnMount onMount={markTabContentMounted} />
    </Suspense>
  ) : storefrontSkeleton) : null
  // A footer painted under the skeleton is pushed off screen by the taller content (layout shift);
  // appended after the content it moves nothing, and the cover's fetch does not wait for it.
  const footerReady = realConfigInHand && (activeTab === 'products' || tabContentMounted)

  const scrollPublicPortal = (direction: 'top' | 'bottom') => {
    const top = direction === 'bottom' ? Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) : 0
    window.scrollTo({ top, behavior: portalScrollBehavior() })
  }

  const bucketBusinessName = String(displayConfig.businessName || displayConfig.title || STOREFRONT_NAME).trim()

  const handleBucketCopy = () => {
    const text = formatPortalBucketText(bucket.items, bucketBusinessName)
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => setBucketCopyState('copied'))
        .catch(() => setBucketCopyState('failed'))
    } else {
      setBucketCopyState('failed')
    }
    window.setTimeout(() => setBucketCopyState('idle'), 2500)
  }

  const handleBucketDownload = () => {
    const text = formatPortalBucketText(bucket.items, bucketBusinessName)
    downloadPortalBucketFile(text, bucketBusinessName)
  }

  const openListView = (segment: PortalListSegment) => {
    if (!listEntryPushedRef.current) {
      listOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      listReturnScrollRef.current = Math.max(window.scrollY || 0, 0)
      window.history.pushState({ ...(window.history.state || {}), portalListView: true }, '', window.location.href)
      listEntryPushedRef.current = true
      window.scrollTo(0, 0)
    }
    setListView(segment)
  }
  // Closing is the browser's own Back (the popstate listener above does the rest). If the history entry is somehow gone, close anyway.
  const closeListView = (restoreScroll = true) => {
    if (!listEntryPushedRef.current) {
      setListView(null)
      return
    }
    if (!restoreScroll) listReturnScrollRef.current = 0
    window.history.back()
    window.setTimeout(() => {
      if (!listEntryPushedRef.current) return
      listEntryPushedRef.current = false
      setListView(null)
    }, 400)
  }

  const listPage = listView ? (
    <PortalListPage
      copy={copy}
      segment={listView}
      onSegment={setListView}
      onBack={() => closeListView()}
      listItems={bucket.items}
      savedItems={wishlist.items}
      imageFor={listImages.imageFor}
      inList={bucket.hasItem}
      onSetQty={bucket.setQty}
      onRemoveFromList={bucket.remove}
      onClearList={bucket.clear}
      onAddSaved={(id) => {
        const item = wishlist.items.find((entry) => String(entry.id) === String(id))
        if (item && !bucket.hasItem(item.id)) bucket.add({ id: item.id, name: item.name, shopLine: item.shopLine, category: item.category, brand: item.brand }, item.priceText)
      }}
      onRemoveSaved={wishlist.remove}
      onClearSaved={wishlist.clear}
      contactEntries={contactEntries}
      onCopy={handleBucketCopy}
      onDownload={handleBucketDownload}
      copyState={bucketCopyState}
    />
  ) : null

  // On the admin host the manifest is the staff app's, so the shop offers no install there.
  const offersShopInstall = !isAdminHostname()
  const accountDrawerIconButtonClass = 'inline-flex h-11 w-11 items-center justify-center rounded-full text-stone-600 transition sm:h-10 sm:w-10 hover:bg-stone-100 hover:text-[#23201b] dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'

  // The top-bar profile icon opens the account sheet: no header strip, a close button in the corner, the Sign in / Sign up switch first.
  const accountDrawer = accountOpen ? (
    <PortalSheet
      label={copy('account', 'Account')}
      copy={copy}
      onClose={() => setAccountOpen(false)}
      corner={offersShopInstall ? <InstallAppButton translate={(key, fallback, fallbackKm) => copy(key, fallback, fallbackKm)} className={accountDrawerIconButtonClass} /> : null}
    >
      <Suspense fallback={<p className="min-h-11 pr-28 text-sm text-stone-600 dark:text-neutral-300">{copy('loadingPortal', 'Loading website...')}</p>}>
        <CatalogAccountSection
          copy={copy}
          account={portalAccount.account}
          ready={portalAccount.ready}
          busy={portalAccount.busy}
          error={portalAccount.error}
          errorCode={portalAccount.errorCode}
          signIn={portalAccount.signIn}
          signUp={portalAccount.signUp}
          signOut={portalAccount.signOut}
          clearError={portalAccount.clearError}
          consentLocale={String(displayConfig.language || 'en')}
          cartCount={bucket.count}
          wishlistCount={wishlist.count}
          signupEnabled={displayConfig.signupEnabled === true}
          contactEntries={contactEntries}
        />
      </Suspense>
    </PortalSheet>
  ) : null

  // Swipe-down-to-refresh: attached to a plain wrapping div around this
  // whole page (see the `ref={publicPageRootRef}` on the return below) --
  // touch events bubble, so this only needs to be an ancestor of wherever
  // a shopper's finger actually touches down, not the scrollable element
  // itself. The public catalog scrolls the real document (CatalogPage.tsx
  // gives it `overflow-visible` when `publicView` is set, unlike the admin
  // preview's own `.page-scroll` div), so the scroll-position check reads
  // straight off `document.documentElement`/`document.body` rather than
  // needing getScrollTarget()'s `.page-scroll` lookup. Bumping
  // `reloadToken` forces the bootstrap effect above to hit the network
  // again for real data instead of a no-op. Disabled while the image
  // gallery/lightbox or either drawer/popover is open, so a pull-down
  // gesture inside one of those (which have their own pinch/pan/scroll
  // handling) is never mistaken for a page-level refresh pull.
  const pullToRefreshEnabled = !productGalleryView.open && !portalImageView.open && !listView && !contactAnchor && !filePicker.open && !accountOpen
  const { pullDistance: publicPullDistance, refreshing: publicPullRefreshing } = usePullToRefresh(
    publicPageRootRef,
    () => {
      const doc = typeof document !== 'undefined' ? document : null
      const scrollingElement = doc?.scrollingElement || doc?.documentElement
      return Math.max(0, Number(scrollingElement?.scrollTop || doc?.body?.scrollTop || 0))
    },
    () => setReloadToken((token) => token + 1),
    pullToRefreshEnabled,
  )

  // The one notice the shop shows unprompted (every other banner needs a merchant-configured reason). It is pinned to the bottom: the
  // header is one row that holds Contact, List, Account and Language, and a notice over the top hid all of them on an iPhone until it was
  // closed. The band publishes how much of the bottom it covers (--install-band-clearance); the page root pads by that much so the footer
  // links scroll clear of it, and the List button rides above it on a phone. From sm it takes the left corner, opposite the List button.
  const installBand = offersShopInstall ? (
    <div
      data-portal-install-notice=""
      className="pointer-events-none fixed inset-x-2 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center sm:inset-x-auto sm:left-4 sm:w-[22rem] sm:justify-start"
    >
      <InstallPromptBand translate={(key, fallback, fallbackKm) => copy(key, fallback, fallbackKm)} />
    </div>
  ) : null

  // The floating List button: only on the Products tab, and only once the list has something in it.
  const bucketFab = activeTab === 'products' && bucket.count > 0 && !listView ? (
    <button
      type="button"
      className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] max-[639px]:bottom-[max(calc(1.25rem+env(safe-area-inset-bottom)),calc(var(--install-band-clearance,0px)+0.5rem))] right-[calc(1.25rem+env(safe-area-inset-right))] z-50 flex items-center gap-2 rounded-full bg-[#23201b] px-4 py-3 text-[#f4f1ea] shadow-xl transition hover:bg-stone-700 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-neutral-300"
      onClick={() => openListView('list')}
      aria-label={copy('bucketTitle', 'My List')}
      title={copy('bucketTitle', 'My List')}
    >
      <ClipboardList className="h-5 w-5" />
      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-700 px-1 text-[11px] font-bold text-white">
        {bucket.count}
      </span>
    </button>
  ) : null

  return (
    <div
      ref={publicPageRootRef}
      className="relative pb-[var(--install-band-clearance,0px)]"
      data-public-media-protection="true"
      onContextMenuCapture={(event) => {
        if (event.target instanceof Element && event.target.closest('img, video, [data-protected-media="true"]')) event.preventDefault()
      }}
      onDragStartCapture={(event) => {
        if (event.target instanceof Element && event.target.closest('img, video, [data-protected-media="true"]')) event.preventDefault()
      }}
      onClickCapture={(event) => {
        lastPressRef.current = event.target instanceof Element ? event.target.closest<HTMLElement>('button, a, [role="button"]') : null
      }}
      onAuxClickCapture={(event) => {
        if (event.button === 1 && event.target instanceof Element && event.target.closest('img, video, [data-protected-media="true"]')) event.preventDefault()
      }}
    >
    {installBand}
    {bucketFab}
    {contactAnchor ? <PortalContactMenu entries={contactEntries} copy={copy} anchor={contactAnchor} onClose={closeContactSheet} /> : null}
    {accountDrawer}
    {portalAccount.consentRenewal ? (
      <Suspense fallback={null}>
        <ConsentRenewalPrompt
          copy={copy}
          busy={portalAccount.busy}
          error={portalAccount.error}
          consentLocale={String(displayConfig.language || 'en')}
          onAgree={portalAccount.renewConsent}
          onSignOut={portalAccount.signOut}
          onClose={portalAccount.dismissConsentRenewal}
        />
      </Suspense>
    ) : null}
    <PullToRefreshIndicator pullDistance={publicPullDistance} refreshing={publicPullRefreshing} />
    <CatalogPreviewSurface
      publicView
      darkMode={darkMode}
      portalBackground={portalBackground}
      copy={copy}
      canEdit={false}
      previewSectionRef={previewSectionRef as RefObject<HTMLDivElement>}
      onBackToEditor={() => {}}
      displayConfig={displayConfig}
      configPending={!realConfigInHand}
      versionedBusinessLogo={businessLogoUrl}
      showBrandLabel={showBrandLabel}
      previewTitle={previewTitle}
      portalTabs={portalTabs}
      activeTab={activeTab}
      setActiveTab={(key) => {
        if (listView) closeListView(false)
        setActiveTab(resolvePortalActiveTab(displayConfig, copy, key))
      }}
      onOpenAccount={() => setAccountOpen(true)}
      onOpenWishlist={() => openListView('saved')}
      wishlistCount={wishlist.count}
      onOpenList={() => openListView('list')}
      listCount={bucket.count}
      listPage={listPage}
      accountSignedIn={!!portalAccount.account}
      contactEntries={contactEntries}
      publicPortalNavRef={publicPortalNavRef as RefObject<HTMLElement>}
      publicPortalNavPinned={false}
      publicPortalNavMetrics={{ left: 0, width: 0, height: 0 }}
      catalogSection={!loadFailed && activeTab === 'products' ? catalogSection : null}
      secondaryTabSection={loadFailed ? loadFailedPanel : secondaryTabSection}
      footer={footerReady ? <PortalFooter copy={copy} businessName={displayConfig.businessName} legalName={displayConfig.businessLegalName} registrationNumber={displayConfig.businessRegistrationNumber} address={displayConfig.businessAddress} phone={displayConfig.businessPhone} email={displayConfig.businessEmail} socialLinks={socialLinks} /> : null}
      productDetailView={productDetailView}
      closeProductDetailView={closeProductDetailView}
      onAddToBucket={addToBucket}
      getBucketQty={bucket.getQty}
      isInWishlist={wishlist.has}
      onToggleWishlist={toggleWishlist}
      productDetailShopName={displayConfig.businessName || displayConfig.title || ''}
      productDetailCautionDefault={displayConfig.productCautionDefault || ''}
      productDetailNeedMoreDetailsDefault={displayConfig.productNeedMoreDetailsDefault || ''}
      announcement={announcement}
      onDismissAnnouncement={dismissAnnouncement}
      publicScrollButtonsVisible={scrollButtonsVisible && !contactAnchor}
      scrollPublicPortal={scrollPublicPortal}
      productGalleryView={productGalleryView}
      setProductGalleryView={setProductGalleryView}
      filePicker={filePicker}
      setFilePicker={setFilePicker}
      handleFilePickerSelect={() => {}}
      portalImageView={portalImageView}
      setPortalImageView={setPortalImageView}
      toggleTheme={toggleTheme}
      pageLanguage={pageLanguage}
      pageLanguageChoice={pageChoice}
      languageNotice={translateNotice}
      changePageLanguage={changePageLanguage}
    />
    </div>
  )
}
