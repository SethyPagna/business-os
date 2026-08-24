import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent, Dispatch, RefObject, SetStateAction } from 'react'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { usePullToRefresh } from '../shared/usePullToRefresh.ts'
import PullToRefreshIndicator from '../shared/PullToRefreshIndicator.tsx'
import Bot from 'lucide-react/dist/esm/icons/bot.js'
import HelpCircle from 'lucide-react/dist/esm/icons/help-circle.js'
import Mail from 'lucide-react/dist/esm/icons/mail.js'
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js'
import Phone from 'lucide-react/dist/esm/icons/phone.js'
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js'
import Facebook from 'lucide-react/dist/esm/icons/facebook.js'
import Instagram from 'lucide-react/dist/esm/icons/instagram.js'
import Send from 'lucide-react/dist/esm/icons/send.js'
import Globe from 'lucide-react/dist/esm/icons/globe.js'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import Store from 'lucide-react/dist/esm/icons/store.js'
import Ticket from 'lucide-react/dist/esm/icons/ticket.js'
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Minus from 'lucide-react/dist/esm/icons/minus.js'
import PlusIcon from 'lucide-react/dist/esm/icons/plus.js'
import Copy from 'lucide-react/dist/esm/icons/copy.js'
import Download from 'lucide-react/dist/esm/icons/download.js'
import MessageSquare from 'lucide-react/dist/esm/icons/message-square.js'
import Headset from 'lucide-react/dist/esm/icons/headset.js'
import PhoneCall from 'lucide-react/dist/esm/icons/phone-call.js'
import type { LucideIcon } from 'lucide-react'
import { MessengerIcon } from '../shared/BrandIcons.tsx'
import { useApp } from '../../app/AppContextCore.tsx'
import { clampPage } from '../shared/PaginationControls'
import { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent, withLoaderTimeout } from '../../utils/loaders.ts'
import { aggregateInitialOptions } from '../../utils/initials.ts'
import { deriveMessengerLink, deriveTelegramLink, derivePhoneCallLink, deriveWhatsappLink, deriveInstagramLink, resolveMessengerLink } from '../../utils/socialLinks.ts'
import CatalogPreviewSurface from './CatalogPreviewSurface'
import type { ProductDetailViewState } from './ProductDetailFlyout'
import { CATALOG_DEFAULT_PAGE_SIZE } from './catalogPagination'
import { getPortalGridClass, getPortalMobileGridClass, buildPortalPricePresentation } from './portalCatalogDisplay.ts'
import { collapsePortalProductGroups, mergePortalCatalogProducts } from './portalProductGrouping.ts'
import { normalizeGoogleMapsEmbed } from './portalEditorUtils.ts'
import { resolveCatalogAssetUrl } from './catalogAssetUrls'
import { usePortalBucket, formatPortalBucketText, downloadPortalBucketFile } from './portalBucket.ts'
import { getPortalLanguageText } from './portalLanguagePacks.ts'
import { MAX_PRODUCT_GALLERY_IMAGES } from '../products/helpers/productGalleryHelpers.ts'
import {
  ALL_PUBLIC_TRANSLATE_OPTIONS,
  GOOGLE_TRANSLATE_FALLBACK_OPTIONS,
  isFirstPartyPortalLanguage,
  normalizeFirstPartyPortalLanguage,
} from './portalLanguageOptions.ts'
import {
  applyGoogleTranslateSelection,
  isPortalTranslateApplied,
  normalizeTranslateTarget,
  readStoredTranslateTarget,
  removePortalTranslateWidgetHost,
  requestPortalTranslateReload,
  setupPortalExternalTranslateWidget,
  sleep,
} from './portalTranslateController.ts'

const loadCatalogProductsSection = () => import('./CatalogProductsSection')
const CatalogProductsSection = lazyRetry(loadCatalogProductsSection, 'public-catalog-products-section')
const CatalogSecondaryTabs = lazyRetry(() => import('./CatalogSecondaryTabs'), 'public-catalog-secondary-tabs')
const PortalPromotionsBanner = lazyRetry(() => import('./PortalPromotionsBanner'), 'public-catalog-promotions-banner')

const PUBLIC_PORTAL_BOOTSTRAP_TIMEOUT_MS = 15000
const PUBLIC_PORTAL_PRODUCT_SEARCH_TIMEOUT_MS = 12000
const PUBLIC_PORTAL_MEMBERSHIP_TIMEOUT_MS = 12000
const PUBLIC_PORTAL_SUBMISSION_TIMEOUT_MS = 12000
const PUBLIC_PORTAL_AI_TIMEOUT_MS = 25000
const PUBLIC_PORTAL_FAVICON_TIMEOUT_MS = 4000
// Used whenever a public portal has not yet configured a custom logo or
// favicon, so it never falls back to the admin application's icon.
const DEFAULT_PUBLIC_PORTAL_ICON = '/leang-cosmetics-icon-512.png'
const PUBLIC_PORTAL_CACHE_KEY = 'business-os-catalog-portal-cache'
const PUBLIC_PORTAL_BOOTSTRAP_ELEMENT_ID = 'business-os-portal-bootstrap'
const PUBLIC_PORTAL_CACHE_MAX_AGE_MS = 1000 * 60 * 20
const PUBLIC_PORTAL_CACHE_PRODUCT_LIMIT = 80
const SUBMISSION_MAX_SCREENSHOTS = 8
const IMAGE_READ_CONCURRENCY = 2

type LooseRecord = Record<string, any>
type PortalBootstrapWindow = Window & { __businessOsPortalBootstrap?: LooseRecord | null }
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
  showProductDescription?: boolean
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
type SubmissionDraft = { platform: string; note: string; screenshots: string[] }
type PortalTab = { key: string; label: string; icon: LucideIcon }
type CatalogApi = {
  getPortalBootstrap?: () => Promise<unknown>
  searchPortalCatalogProducts?: (params?: Record<string, unknown>) => Promise<unknown>
  lookupPortalMembership?: (membershipNumber: string) => Promise<unknown>
  createPortalSubmission?: (payload?: Record<string, unknown>) => Promise<unknown>
  getPortalAiStatus?: () => Promise<unknown>
  askPortalAi?: (payload?: Record<string, unknown>) => Promise<unknown>
}

const DEFAULT_PUBLIC_CONFIG: PortalConfig = {
  aboutBlocks: [],
  aiEnabled: true,
  businessName: 'Leang Cosmetics',
  contactLinkLabels: { messenger: 'Messenger', telegram: 'Telegram', whatsapp: 'WhatsApp', phone: '', instagram: 'Instagram' },
  contactLinks: { messenger: '', telegram: '', whatsapp: '', phone: '', instagram: '' },
  exchangeRate: 4100,
  faqItems: [],
  gridColumnsDesktop: 4,
  gridColumnsMobile: 2,
  heroGradientEnd: '#ea580c',
  heroGradientMid: '#14532d',
  heroGradientStart: '#0f172a',
  highlightRankLimit: 3,
  linkLabels: { website: 'Website', facebook: 'Facebook', instagram: 'Instagram', telegram: 'Telegram' },
  links: { website: '', facebook: '', instagram: '', telegram: '' },
  logoFit: 'cover',
  logoPositionX: 50,
  logoPositionY: 50,
  logoZoom: 100,
  lowStockThreshold: 10,
  outOfStockThreshold: 0,
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
  showContactInstagram: false,
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
  showMembership: true,
  showOutOfStockProducts: true,
  showStockStatus: true,
  showPhone: true,
  showPrices: true,
  showProductBrand: true,
  showProductCategory: true,
  showProductDescription: true,
  showProductDiscount: true,
  showPromotions: true,
  showRecommendedBadge: true,
  showTelegram: true,
  showTopProductBadge: true,
  showTopSellerBadge: true,
  showWebsite: true,
  stockThresholdMode: 'product',
  submissionEnabled: true,
  submissionRewardPoints: 5,
  title: 'Leang Cosmetics',
  translateWidgetEnabled: true,
}

/**
 * Resolve a translate-target selection to its canonical form: 'original',
 * a first-party language code, or (via the shared translate controller) a
 * canonical Google-Translate language code for the 9 external-only
 * languages. Same shape as the admin editor's `normalizePortalTranslateChoice`,
 * just without that copy's now-redundant first-party lookup table.
 */
function normalizePublicTranslateChoice(value: unknown, sourceLang = 'en'): string {
  const raw = String(value || 'original').trim()
  if (raw.toLowerCase() === 'original') return 'original'
  const firstParty = normalizeFirstPartyPortalLanguage(raw)
  if (firstParty) return firstParty
  return normalizeTranslateTarget(raw, sourceLang)
}

function isFirstPartyTranslateChoice(value: string): boolean {
  return value === 'original' || isFirstPartyPortalLanguage(value)
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

function normalizeHexColor(value: unknown, fallback: string): string {
  const raw = String(value || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : fallback
}

function hexToRgba(hex: unknown, alpha: unknown): string {
  const safeHex = normalizeHexColor(hex, '#0f172a').replace('#', '')
  const r = Number.parseInt(safeHex.slice(0, 2), 16)
  const g = Number.parseInt(safeHex.slice(2, 4), 16)
  const b = Number.parseInt(safeHex.slice(4, 6), 16)
  const safeAlpha = Number.isFinite(Number(alpha)) ? Number(alpha) : 1
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`
}

function normalizeExternalUrl(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const normalized = /^https?:\/\//i.test(raw)
    ? raw
    : (/^(www\.|[\w-]+(\.[\w-]+)+|maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(raw) ? `https://${raw}` : '')
  if (!normalized) return ''
  try {
    const url = new URL(normalized)
    return /^https?:$/i.test(url.protocol) ? url.toString().replace(/\/$/, '') : ''
  } catch (_) {
    return ''
  }
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

function readPortalCache(): LooseRecord | null {
  if (typeof window === 'undefined') return null
  const stores = [window.sessionStorage, window.localStorage].filter(Boolean)
  try {
    let raw = ''
    let sourceStore: Storage | null = null
    for (const store of stores) {
      raw = store.getItem(PUBLIC_PORTAL_CACHE_KEY) || ''
      if (raw) {
        sourceStore = store
        break
      }
    }
    if (!raw) return null
    if (raw.length > 1_500_000) {
      for (const store of stores) store.removeItem(PUBLIC_PORTAL_CACHE_KEY)
      return null
    }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const ageMs = Date.now() - Number(parsed.cachedAt || 0)
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > PUBLIC_PORTAL_CACHE_MAX_AGE_MS) {
      sourceStore?.removeItem(PUBLIC_PORTAL_CACHE_KEY)
      return null
    }
    if (Array.isArray(parsed.products) && parsed.products.length > PUBLIC_PORTAL_CACHE_PRODUCT_LIMIT) {
      parsed.products = parsed.products.slice(0, PUBLIC_PORTAL_CACHE_PRODUCT_LIMIT)
    }
    return parsed
  } catch (_) {
    return null
  }
}

function writePortalCache(payload: LooseRecord): void {
  if (typeof window === 'undefined') return
  try {
    const serialized = JSON.stringify({
      cachedAt: Date.now(),
      ...payload,
      products: Array.isArray(payload.products) ? payload.products.slice(0, PUBLIC_PORTAL_CACHE_PRODUCT_LIMIT) : [],
    })
    sessionStorage.setItem(PUBLIC_PORTAL_CACHE_KEY, serialized)
    localStorage.setItem(PUBLIC_PORTAL_CACHE_KEY, serialized)
  } catch (_) {}
}

function readEmbeddedPortalBootstrap(): LooseRecord | null {
  if (typeof document === 'undefined') return null
  const portalWindow = window as PortalBootstrapWindow
  if (portalWindow.__businessOsPortalBootstrap) return portalWindow.__businessOsPortalBootstrap
  const node = document.getElementById(PUBLIC_PORTAL_BOOTSTRAP_ELEMENT_ID)
  if (!node) return null
  const raw = String(node.textContent || '').trim()
  if (!raw || raw.length > 2_000_000) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    portalWindow.__businessOsPortalBootstrap = {
      cachedAt: Date.now(),
      ...(parsed as LooseRecord),
    }
    return portalWindow.__businessOsPortalBootstrap
  } catch (_) {
    return null
  }
}

function withAssetVersion(url: unknown, versionSeed: unknown): string {
  const raw = String(url || '').trim()
  if (!raw || raw.startsWith('blob:') || raw.startsWith('data:')) return raw
  const seed = String(versionSeed || '').trim()
  return seed ? `${raw}${raw.includes('?') ? '&' : '?'}v=${encodeURIComponent(seed)}` : raw
}

function buildPortalBackground(config: PortalConfig, darkMode = false): string {
  // Flat, editorial background (no large hero gradient) so the storefront reads
  // like an open retail page rather than a boxed dashboard preview.
  void config
  return darkMode ? '#0b0b0c' : '#ffffff'
}

function getPortalTabs(config: PortalConfig, copy: CopyFunction): PortalTab[] {
  const items = [
    config.showAbout ? { key: 'about', label: copy('about', 'About'), icon: Store } : null,
    config.showCatalog ? { key: 'products', label: copy('products', 'Products'), icon: ShoppingBag } : null,
    config.showMembership ? { key: 'membership', label: copy('membership', 'Membership'), icon: Ticket } : null,
    config.showFaq ? { key: 'faq', label: copy('faq', 'FAQ'), icon: HelpCircle } : null,
    config.aiEnabled ? { key: 'ai', label: config.aiTitle || copy('portalAssistant', 'AI assistant'), icon: Bot } : null,
  ]
  return items.filter(Boolean) as PortalTab[]
}

function resolvePortalActiveTab(config: PortalConfig, copy: CopyFunction, current = ''): string {
  const tabs = getPortalTabs(config, copy)
  return tabs.some((item) => item.key === current) ? current : (tabs[0]?.key || 'products')
}

function getBranchQty(product: CatalogProduct, branchId: unknown): number {
  if (!branchId || branchId === 'all') return Number(product.stock_quantity || 0)
  const match = (product.branch_stock || []).find((entry) => String(entry.branch_id) === String(branchId))
  return Number(match?.quantity || 0)
}

function getStockStatus(product: CatalogProduct, qty: unknown, config: Record<string, unknown> = {}): string {
  const quantity = Number(qty || 0)
  const useGlobal = config.stockThresholdMode === 'global'
  const outThreshold = Number(useGlobal ? config.outOfStockThreshold : product.out_of_stock_threshold || 0)
  const lowThreshold = Number(useGlobal ? config.lowStockThreshold : product.low_stock_threshold || 10)
  if (quantity <= outThreshold) return 'out_of_stock'
  if (quantity <= lowThreshold) return 'low_stock'
  return 'in_stock'
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
    if (unique.length >= MAX_PRODUCT_GALLERY_IMAGES) break
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

function formatDateTime(value: unknown): string {
  if (!value) return '-'
  const raw = String(value)
  const date = new Date(raw.includes('T') ? raw : `${raw}Z`)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function replaceVars(template: unknown, values: Record<string, unknown>): string {
  return String(template || '').replace(/\{(\w+)\}/g, (_match: string, key: string) => String(values?.[key] ?? ''))
}

function readImageFileAsDataUrl(file: Blob, errorMessage = 'Failed to read image'): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error(errorMessage))
    reader.readAsDataURL(file)
  })
}

async function readImageFilesAsDataUrls(files: Iterable<File> | ArrayLike<File> | null | undefined): Promise<string[]> {
  const selected = Array.from(files || [])
    .filter((file) => file && String(file.type || '').startsWith('image/'))
    .slice(0, SUBMISSION_MAX_SCREENSHOTS)
  if (!selected.length) return []
  const results: string[] = new Array(selected.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(IMAGE_READ_CONCURRENCY, selected.length) }, async () => {
    while (nextIndex < selected.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await readImageFileAsDataUrl(selected[index])
    }
  })
  await Promise.all(workers)
  return results.filter(Boolean)
}

async function pickMultipleImagesAsDataUrls(): Promise<string[]> {
  const files = await new Promise<File[]>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = () => resolve(Array.from(input.files || []))
    input.click()
  })
  return readImageFilesAsDataUrls(files)
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

// The public catalog's bootstrap/search endpoints return one row per branch
// for products that are otherwise identical, and grouped products (same
// name, different branch/price/barcode) get collapsed to a single card
// showing the highest-priced variant. See portalProductGrouping.ts for the
// full reasoning -- pulled into its own module so it can be unit-tested
// directly with plain node, same split as portalBucket.ts.

export default function PublicCatalogPage() {
  const { theme, toggleTheme, t } = useApp() as { theme?: string; toggleTheme: () => void; t?: (key: string) => string }
  const embeddedPortalRef = useRef(readEmbeddedPortalBootstrap())
  const cachedPortalRef = useRef(embeddedPortalRef.current || readPortalCache())
  const cachedPortal = cachedPortalRef.current
  const requestRef = useRef(0)
  const faviconRequestRef = useRef(0)
  const manifestRequestRef = useRef(0)
  const productRequestRef = useRef(0)
  const aliveRef = useRef(true)
  const previewSectionRef = useRef<HTMLDivElement>(null)
  const publicPortalNavRef = useRef<HTMLElement>(null)
  const skipNextProductSearchRef = useRef(false)

  const [config, setConfig] = useState<PortalConfig>(() => ({ ...DEFAULT_PUBLIC_CONFIG, ...(cachedPortal?.config || {}) }))
  const [products, setProducts] = useState<CatalogProduct[]>(() => mergePortalCatalogProducts(cachedPortal?.products))
  const [productTotal, setProductTotal] = useState(() => Number(cachedPortal?.catalog?.total || cachedPortal?.products?.length || 0))
  const [productPage, setProductPage] = useState(() => Number(cachedPortal?.catalog?.page || 1) || 1)
  const [productPageSize, setProductPageSize] = useState(() => Number(cachedPortal?.catalog?.pageSize || CATALOG_DEFAULT_PAGE_SIZE) || CATALOG_DEFAULT_PAGE_SIZE)
  const [productInitial, setProductInitial] = useState('all')
  const [productInitials, setProductInitials] = useState<PortalInitialOption[]>(() => normalizePortalInitialOptions(cachedPortal?.catalog?.initials))
  const [categories, setCategories] = useState<CatalogOption[]>(() => normalizeCatalogOptions(cachedPortal?.categories))
  const [brands, setBrands] = useState<string[]>(() => normalizeBrandOptions(cachedPortal?.brands))
  const [branches, setBranches] = useState<CatalogOption[]>(() => normalizeCatalogOptions(cachedPortal?.branches))
  const [activeTab, setActiveTab] = useState(() => resolvePortalActiveTab({ ...DEFAULT_PUBLIC_CONFIG, ...(cachedPortal?.config || {}) }, (key, fallback = '') => fallback, 'products'))
  const [search, setSearch] = useState('')
  const deferredSearch = useMemo(() => search.trim(), [search])
  const [categoryFilter, setCategoryFilter] = useState<string[]>([])
  const [brandFilter, setBrandFilter] = useState<string[]>([])
  const [branchFilter, setBranchFilter] = useState<string[]>([])
  const [stockFilter, setStockFilter] = useState<string[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [loading, setLoading] = useState(() => !(cachedPortal?.config || cachedPortal?.products?.length))
  const [refreshingProducts, setRefreshingProducts] = useState(false)
  const [portalError, setPortalError] = useState('')
  const [productGalleryView, setProductGalleryView] = useState<GalleryViewState>({ open: false, title: '', items: [], index: 0 })
  const [productDetailView, setProductDetailView] = useState<ProductDetailViewState>({ open: false, product: null, gallery: [], status: 'in_stock', pricePresentation: null, showPrices: true })
  const [portalImageView, setPortalImageView] = useState<PortalImageViewState>({ open: false, title: '', images: [], index: 0 })
  const [filePicker, setFilePicker] = useState<FilePickerState>({ open: false, mediaType: 'image', title: '' })
  const [expandedFaqId, setExpandedFaqId] = useState<string | number | null>(null)
  const [membershipNumber, setMembershipNumber] = useState('')
  const [membershipData, setMembershipData] = useState<LooseRecord | null>(null)
  const [membershipError, setMembershipError] = useState('')
  const [membershipLoading, setMembershipLoading] = useState(false)
  const [submissionDraft, setSubmissionDraft] = useState<SubmissionDraft>({ platform: 'Facebook', note: '', screenshots: [] })
  const [submissionSaving, setSubmissionSaving] = useState(false)
  const [assistantProfile, setAssistantProfile] = useState({ brand: '', skinType: '', shoppingFor: '', goal: '', concerns: '' })
  const [assistantQuestion, setAssistantQuestion] = useState('')
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [assistantError, setAssistantError] = useState('')
  const [assistantResponse, setAssistantResponse] = useState<LooseRecord | null>(null)
  const [assistantExpandedProductId, setAssistantExpandedProductId] = useState<string | number | null>(null)
  const [aiUsageSummary, setAiUsageSummary] = useState<LooseRecord | null>(null)
  const [assistantRequestPolicy, setAssistantRequestPolicy] = useState<LooseRecord | null>(null)
  const [translateTarget, setTranslateTarget] = useState(() => readStoredTranslateTarget('en'))
  const [translateApplyState, setTranslateApplyState] = useState<'idle' | 'applied' | 'failed'>('idle')
  const [translateApplyMessage, setTranslateApplyMessage] = useState('')
  const [translateReady, setTranslateReady] = useState(true)
  const bucket = usePortalBucket()
  const [bucketOpen, setBucketOpen] = useState(false)
  // Two independent toggles, not one shared boolean: the drawer's inline
  // "contact us" shortcut and the standalone contact FAB used to both read
  // and write the same `contactOpen` state. That meant tapping the
  // in-drawer shortcut also flipped on the standalone popover -- driven by
  // the same boolean, it rendered right along with (in front of, at a
  // higher z-index) the bucket drawer, so both appeared to be "open" at
  // once. Keeping the drawer's shortcut on its own state removes that
  // cross-talk entirely.
  const [contactOpen, setContactOpen] = useState(false)
  const [bucketContactOpen, setBucketContactOpen] = useState(false)
  const [bucketCopyState, setBucketCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [scrollButtonsVisible, setScrollButtonsVisible] = useState(false)
  // Bumped by the pull-to-refresh gesture to force the bootstrap effect a
  // few lines down to re-run and hit the network for real, even though
  // its dependency array is otherwise empty (it's meant to run once on
  // mount) -- see that effect's own `reloadToken === 0` guard.
  const [reloadToken, setReloadToken] = useState(0)
  const publicPageRootRef = useRef<HTMLDivElement | null>(null)

  // Drives the scroll-to-top/bottom buttons in CatalogPreviewSurface. This
  // used to be hardcoded to `false` here, which silently disabled the
  // feature on the real public portal (it only ever worked in the admin's
  // editable preview, CatalogPage.tsx, which tracks its own scroll
  // position). Same 220px threshold as that preview.
  //
  // NOTE on the `!bucketOpen && !contactOpen` guard at the call site below:
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

  const copy: CopyFunction = (key, fallback = '', fallbackKm = fallback) => {
    // Real fix: this used to only ever check the admin app's own EN/KM
    // translator (`t`) and a hardcoded Khmer fallback, so picking any of
    // the other 17 languages in the dropdown changed nothing on screen.
    // `getPortalLanguageText` is the same first-party language-pack lookup
    // the admin editor's live preview already used correctly.
    const localized = getPortalLanguageText(translateTarget, key)
    if (localized) return localized
    const fullKey = `portalEditor.${key}`
    const translated = typeof t === 'function' ? t(fullKey) : ''
    if (translated && translated !== fullKey) return translated
    return translateTarget === 'km' ? (fallbackKm || fallback) : fallback
  }

  // Merchant's own catalog-entry language (what product names/descriptions
  // are actually typed in) — the "from" side of any translation, first-
  // party or external. Defaults to English same as the admin editor.
  const configuredPortalLanguage = normalizeFirstPartyPortalLanguage(config.language) || 'en'
  const normalizedTranslateTarget = normalizePublicTranslateChoice(translateTarget, configuredPortalLanguage)
  const translateWidgetEnabled = config.translateWidgetEnabled !== false
  // Any of the 9 Google-Translate-only languages route through the legacy
  // external widget below instead of the first-party lookup `copy()` uses.
  const externalTranslateTarget = translateWidgetEnabled && !isFirstPartyTranslateChoice(normalizedTranslateTarget)
    ? normalizedTranslateTarget
    : null

  // Widget isn't "ready" while an external translation is pending setup.
  useEffect(() => {
    setTranslateReady(!externalTranslateTarget)
  }, [externalTranslateTarget])

  // Pick up whatever language the visitor last chose (cookie or
  // localStorage) once we know the catalog's own source language.
  useEffect(() => {
    if (!translateWidgetEnabled) return
    setTranslateTarget(readStoredTranslateTarget(configuredPortalLanguage))
  }, [configuredPortalLanguage, translateWidgetEnabled])

  // First-party path (original, or one of the 18 built-in languages):
  // no external widget needed, so tear one down if a prior external
  // selection left one mounted, and reflect the applied state instantly.
  useEffect(() => {
    if (!translateWidgetEnabled || externalTranslateTarget) return
    removePortalTranslateWidgetHost()
    setTranslateReady(true)
    setTranslateApplyState(normalizedTranslateTarget === 'original' ? 'idle' : 'applied')
    setTranslateApplyMessage(normalizedTranslateTarget === 'original'
      ? ''
      : copy('translationApplied', 'Translation applied'))
  }, [externalTranslateTarget, normalizedTranslateTarget, translateWidgetEnabled])

  // External path: load/attach the Google Translate widget for one of the
  // 9 languages with no first-party pack.
  useEffect(() => {
    if (!translateWidgetEnabled || !externalTranslateTarget || typeof window === 'undefined' || typeof document === 'undefined') {
      removePortalTranslateWidgetHost()
      return undefined
    }
    let cancelled = false
    const cleanupWidget = setupPortalExternalTranslateWidget({
      sourceLanguage: configuredPortalLanguage,
      includedLanguages: GOOGLE_TRANSLATE_FALLBACK_OPTIONS.map((option) => option.value),
      onPending: () => setTranslateReady(false),
      onReady: () => {
        setTranslateReady(true)
        setTranslateApplyMessage('')
      },
      onFailure: () => {
        if (cancelled) return
        setTranslateReady(false)
        setTranslateApplyState('failed')
        setTranslateApplyMessage(copy('translationFailed', 'Translation could not apply. Try again.'))
      },
    })
    return () => {
      cancelled = true
      cleanupWidget?.()
    }
  }, [configuredPortalLanguage, externalTranslateTarget, translateWidgetEnabled])

  // Once the widget's ready, repeatedly nudge Google's own select element to
  // the chosen language and confirm it actually took (its DOM/cookie state can
  // lag the widget being "ready"); fall back to a one-time page reload if
  // it's still stuck after ~3.5s, same recovery CatalogPage.tsx's preview uses.
  useEffect(() => {
    if (!translateWidgetEnabled || !externalTranslateTarget || !translateReady) return undefined
    let cancelled = false
    const settleTimer = window.setTimeout(async () => {
      const maxTries = 20
      for (let tries = 0; tries < maxTries; tries += 1) {
        if (cancelled) return
        applyGoogleTranslateSelection(configuredPortalLanguage, normalizedTranslateTarget)
        if (isPortalTranslateApplied(configuredPortalLanguage, normalizedTranslateTarget)) {
          setTranslateApplyState('applied')
          setTranslateApplyMessage(copy('externalTranslationApplied', 'External translation applied'))
          return
        }
        await sleep(180)
      }
      if (cancelled) return
      if (requestPortalTranslateReload('external-translate-stuck', 5000)) return
      setTranslateApplyState('failed')
      setTranslateApplyMessage(copy('translationFailed', 'Translation could not apply. Try again.'))
    }, loading ? 650 : 260)
    return () => {
      cancelled = true
      window.clearTimeout(settleTimer)
    }
  }, [configuredPortalLanguage, externalTranslateTarget, loading, normalizedTranslateTarget, translateWidgetEnabled, translateReady])

  useEffect(() => {
    if (embeddedPortalRef.current && reloadToken === 0) {
      skipNextProductSearchRef.current = true
      writePortalCache({ ...embeddedPortalRef.current, products: mergePortalCatalogProducts(embeddedPortalRef.current.products) })
      setLoading(false)
      return undefined
    }
    const requestId = beginTrackedRequest(requestRef)
    setLoading(products.length === 0)
    withLoaderTimeout(() => getCatalogApi().getPortalBootstrap?.() || Promise.reject(new Error('Portal bootstrap API unavailable')), 'Portal bootstrap', PUBLIC_PORTAL_BOOTSTRAP_TIMEOUT_MS)
      .then((payload) => {
        if (!aliveRef.current || !isTrackedRequestCurrent(requestRef, requestId)) return
        const next = normalizeBootstrapPayload(payload)
        const mergedProducts = mergePortalCatalogProducts(next.products)
        setConfig(next.config)
        setProducts(mergedProducts)
        setProductTotal(Number(next.catalog.total || next.products.length || 0))
        setProductPage(Number(next.catalog.page || 1) || 1)
        setProductPageSize(Number(next.catalog.pageSize || CATALOG_DEFAULT_PAGE_SIZE) || CATALOG_DEFAULT_PAGE_SIZE)
        setProductInitials(normalizePortalInitialOptions(next.catalog.initials))
        setCategories(next.categories)
        setBrands(next.brands)
        setBranches(next.branches)
        setActiveTab((current) => resolvePortalActiveTab(next.config, copy, current))
        setPortalError('')
        skipNextProductSearchRef.current = true
        writePortalCache({ config: next.config, categories: next.categories, brands: next.brands, branches: next.branches, products: mergedProducts, catalog: next.catalog })
      })
      .catch((error) => {
        if (!aliveRef.current || !isTrackedRequestCurrent(requestRef, requestId)) return
        setPortalError(getErrorMessage(error, 'Portal bootstrap failed'))
      })
      .finally(() => {
        if (!aliveRef.current || !isTrackedRequestCurrent(requestRef, requestId)) return
        setLoading(false)
      })
    return () => {
      invalidateTrackedRequest(requestRef)
    }
  }, [reloadToken])

  useEffect(() => {
    setProductPage(1)
  }, [brandFilter, branchFilter, categoryFilter, deferredSearch, productInitial, stockFilter])

  useEffect(() => {
    if (!config.showCatalog) return undefined
    if (loading && products.length === 0) return undefined
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
      initial: productInitial,
    }
    withLoaderTimeout(() => getCatalogApi().searchPortalCatalogProducts?.(params) || Promise.reject(new Error('Portal product search API unavailable')), 'Portal product search', PUBLIC_PORTAL_PRODUCT_SEARCH_TIMEOUT_MS)
      .then((result) => {
        if (!aliveRef.current || !isTrackedRequestCurrent(productRequestRef, requestId)) return
        const data = (result || {}) as LooseRecord
        const nextItems = mergePortalCatalogProducts(data.items)
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
        setProductTotal(nextTotal)
        setProductPage(responsePage)
        setProductPageSize(responsePageSize)
        setProductInitials(nextInitials)
        if (Array.isArray(data.filters?.brands)) setBrands(normalizeBrandOptions(data.filters.brands))
        if (Array.isArray(data.filters?.categories)) {
          setCategories(data.filters.categories.map((name: string, index: number) => ({ id: `server-${index}-${name}`, name })))
        }
        setPortalError('')
        writePortalCache({
          config,
          categories,
          brands,
          branches,
          products: nextItems,
          catalog: { page: responsePage, pageSize: responsePageSize, total: nextTotal, initials: nextInitials },
        })
      })
      .catch((error) => {
        if (!aliveRef.current || !isTrackedRequestCurrent(productRequestRef, requestId)) return
        setPortalError(getErrorMessage(error, 'Portal product search failed'))
      })
      .finally(() => {
        if (!aliveRef.current || !isTrackedRequestCurrent(productRequestRef, requestId)) return
        setRefreshingProducts(false)
      })
    return () => {
      invalidateTrackedRequest(productRequestRef)
    }
  }, [brandFilter, branchFilter, categoryFilter, config.showCatalog, config.showStockStatus, deferredSearch, loading, productInitial, productPage, productPageSize, products.length, stockFilter])

  useEffect(() => () => {
    aliveRef.current = false
    invalidateTrackedRequest(requestRef)
    invalidateTrackedRequest(productRequestRef)
  }, [])

  const displayConfig = useMemo<PortalConfig>(() => ({ ...DEFAULT_PUBLIC_CONFIG, ...config }), [config])
  const darkMode = theme === 'dark'
  const portalBackground = buildPortalBackground(displayConfig, darkMode)
  const previewTitle = String(displayConfig.businessName || displayConfig.title || '').trim()
  const previewBusinessName = String(displayConfig.businessName || '').trim()
  const showBrandLabel = previewBusinessName && previewBusinessName.toLowerCase() !== previewTitle.toLowerCase()
  const portalTabs = getPortalTabs(displayConfig, copy)
  const mobileGridColumns = Math.min(3, Math.max(1, Math.round(toNumber(displayConfig.gridColumnsMobile, 1))))
  const compactTwoColumnMobile = mobileGridColumns >= 2
  // NOTE: getPortalGridClass only returns lg:/xl: classes (desktop). Without the
  // mobile class combined in, the grid falls back to a bare `grid` with no
  // column count below the `lg` breakpoint, which collapses to a single
  // column on phones and tablets. Combine both, same as the admin preview.
  const productGridClass = `${getPortalMobileGridClass(mobileGridColumns)} ${getPortalGridClass(displayConfig.gridColumnsDesktop)}`
  const versionedBusinessLogo = withAssetVersion(displayConfig.businessLogo, displayConfig.businessLogo || displayConfig.businessName)
  const versionedBusinessCover = withAssetVersion(displayConfig.businessCover, displayConfig.businessCover || displayConfig.businessName)
  const selectedStockBranch = branchFilter[0] || 'all'
  const portalActiveFilterCount = categoryFilter.length + brandFilter.length + branchFilter.length + (displayConfig.showStockStatus === false ? 0 : stockFilter.length) + (productInitial === 'all' ? 0 : 1)
  const publicFaqItems = normalizeFaqItems(displayConfig.faqItems)
  const mapEmbedUrl = displayConfig.showGoogleMap && activeTab === 'about' ? normalizeGoogleMapsEmbed(displayConfig.googleMapsEmbed || '') : ''
  const socialLinks = [
    { key: 'website', enabled: displayConfig.showWebsite, label: String(displayConfig.linkLabels?.website || copy('website', 'Website')).trim() || copy('website', 'Website'), value: displayConfig.links?.website },
    { key: 'facebook', enabled: displayConfig.showFacebook, label: String(displayConfig.linkLabels?.facebook || copy('facebook', 'Facebook')).trim() || copy('facebook', 'Facebook'), value: displayConfig.links?.facebook },
    { key: 'instagram', enabled: displayConfig.showInstagram, label: String(displayConfig.linkLabels?.instagram || copy('instagram', 'Instagram')).trim() || copy('instagram', 'Instagram'), value: displayConfig.links?.instagram },
    { key: 'telegram', enabled: displayConfig.showTelegram, label: String(displayConfig.linkLabels?.telegram || copy('telegram', 'Telegram')).trim() || copy('telegram', 'Telegram'), value: displayConfig.links?.telegram },
  ].filter((item) => item.enabled && (item.key === 'telegram' ? deriveTelegramLink(item.value || '') : normalizeExternalUrl(item.value))).map((item) => ({ key: item.key, label: item.label, value: item.key === 'telegram' ? deriveTelegramLink(item.value || '') : normalizeExternalUrl(item.value) }))
  // "Contact us" is a distinct, direct-message channel list, separate from
  // the official/social page links above -- a Facebook page link opens a
  // feed, not a chat, so staff configure these explicitly (with sensible
  // fallbacks below for stores that only ever set up the social links).
  const fallbackMessengerLink = displayConfig.showFacebook ? deriveMessengerLink(normalizeExternalUrl(displayConfig.links?.facebook)) : ''
  // Real bug, found+fixed part 234: this used to run the raw configured
  // value through `normalizeExternalUrl`, which only accepts values that
  // already look like a URL/domain (www., a dotted domain, a whitelisted
  // host) -- a bare handle like "mystore" or "@mystore" (exactly what
  // deriveTelegramLink's own doc comment says it's meant to accept, and
  // the most natural thing a merchant would type) silently normalized to
  // '', so the Telegram contact button just never appeared even though
  // the field was filled in correctly. `deriveTelegramLink` is the
  // purpose-built canonicalizer for this exact value shape (bare handle,
  // @handle, or full t.me/telegram.me URL) -- it already existed and was
  // already tested, just never actually called from either contact-link
  // site until now.
  const fallbackTelegramContactLink = displayConfig.showTelegram ? deriveTelegramLink(displayConfig.links?.telegram || '') : ''
  // Same fallback pattern as Messenger/Telegram above: if staff never set up
  // a dedicated "Contact us" Instagram value, fall back to deriving the DM
  // link from the profile link already configured in the social-links row.
  const fallbackInstagramContactLink = displayConfig.showInstagram ? deriveInstagramLink(displayConfig.links?.instagram || '') : ''
  const contactChannels = [
    { key: 'messenger', enabled: displayConfig.showContactMessenger, label: String(displayConfig.contactLinkLabels?.messenger || copy('messenger', 'Messenger')).trim() || copy('messenger', 'Messenger'), value: resolveMessengerLink(displayConfig.contactLinks?.messenger || '') || fallbackMessengerLink },
    { key: 'telegram', enabled: displayConfig.showContactTelegram, label: String(displayConfig.contactLinkLabels?.telegram || copy('telegram', 'Telegram')).trim() || copy('telegram', 'Telegram'), value: deriveTelegramLink(displayConfig.contactLinks?.telegram || '') || fallbackTelegramContactLink },
    { key: 'whatsapp', enabled: displayConfig.showContactWhatsapp, label: String(displayConfig.contactLinkLabels?.whatsapp || copy('whatsapp', 'WhatsApp')).trim() || copy('whatsapp', 'WhatsApp'), value: deriveWhatsappLink(displayConfig.contactLinks?.whatsapp || '') },
    { key: 'phone', enabled: displayConfig.showContactPhone, label: String(displayConfig.contactLinkLabels?.phone || copy('call', 'Call')).trim() || copy('call', 'Call'), value: derivePhoneCallLink(displayConfig.contactLinks?.phone || '') },
    { key: 'instagram', enabled: displayConfig.showContactInstagram, label: String(displayConfig.contactLinkLabels?.instagram || copy('instagram', 'Instagram')).trim() || copy('instagram', 'Instagram'), value: deriveInstagramLink(displayConfig.contactLinks?.instagram || '') || fallbackInstagramContactLink },
  ].filter((item) => item.enabled && item.value).map((item) => ({ key: item.key, label: item.label, value: item.value }))
  const businessFacts = [
    { key: 'phone', enabled: displayConfig.showPhone, label: copy('phone', 'Phone'), value: displayConfig.businessPhone, href: displayConfig.businessPhone ? `tel:${displayConfig.businessPhone}` : '', icon: Phone },
    { key: 'email', enabled: displayConfig.showEmail, label: copy('email', 'Email'), value: displayConfig.businessEmail, href: displayConfig.businessEmail ? `mailto:${displayConfig.businessEmail}` : '', icon: Mail },
    { key: 'address', enabled: displayConfig.showAddress, label: copy('address', 'Address'), value: displayConfig.businessAddress, href: normalizeExternalUrl(displayConfig.addressLink), icon: MapPin },
  ].filter((item) => item.enabled && item.value)
  const addressFact = businessFacts.find((item) => item.key === 'address') || null
  const socialIconByKey: Record<string, LucideIcon> = {
    facebook: Facebook,
    instagram: Instagram,
    telegram: Send,
    website: Globe,
  }
  const contactIconByKey: Record<string, LucideIcon> = {
    messenger: MessengerIcon,
    telegram: Send,
    whatsapp: PhoneCall,
    phone: PhoneCall,
    instagram: Instagram,
  }
  const socialAccentByKey: Record<string, string> = {
    facebook: 'hover:text-amber-600 hover:border-amber-600/40 dark:hover:text-amber-400 dark:hover:border-amber-400/40',
    messenger: 'hover:text-amber-600 hover:border-amber-600/40 dark:hover:text-amber-400 dark:hover:border-amber-400/40',
    instagram: 'hover:text-amber-600 hover:border-amber-600/40 dark:hover:text-amber-400 dark:hover:border-amber-400/40',
    telegram: 'hover:text-amber-600 hover:border-amber-600/40 dark:hover:text-amber-400 dark:hover:border-amber-400/40',
    website: 'hover:text-slate-900 dark:hover:text-white',
  }
  const headerLinks = [
    ...socialLinks.map((item) => ({
      ...item,
      icon: socialIconByKey[item.key] || ExternalLink,
      accentClassName: socialAccentByKey[item.key] || '',
    })),
    addressFact?.href ? { key: 'map', label: copy('map', 'Map'), value: addressFact.href, icon: MapPin, accentClassName: '' } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; value: string; icon: LucideIcon; accentClassName: string }>
  const redeemSummaryText = `${Number(displayConfig.redeemPoints || 100).toLocaleString()} ${copy('points', 'points')} = ${formatPortalPrice(displayConfig.redeemValueUsd, displayConfig.redeemValueKhr, displayConfig)}`
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
    setProductInitial('all')
  }
  const openProductGallery = (product: CatalogProduct, startIndex = 0) => {
    const items = normalizeProductGallery(product).map((item) => resolveCatalogAssetUrl(item) || item)
    if (!items.length) return
    setProductGalleryView({ open: true, title: String(product.name || ''), items, index: Math.max(0, Math.min(startIndex, items.length - 1)) })
  }
  const openPortalImage = (title: string, images: string[], index = 0) => {
    const cleanImages = images.map((item) => resolveCatalogAssetUrl(item) || item).filter(Boolean)
    if (!cleanImages.length) return
    setPortalImageView({ open: true, title, images: cleanImages, index: Math.max(0, Math.min(index, cleanImages.length - 1)) })
  }
  const handleMembershipLookup = () => {
    const value = membershipNumber.trim()
    if (!value) {
      setMembershipError(copy('membershipRequired', 'Enter a membership number first.'))
      return
    }
    setMembershipLoading(true)
    setMembershipError('')
    withLoaderTimeout(() => getCatalogApi().lookupPortalMembership?.(value) || Promise.reject(new Error('Membership lookup API unavailable')), 'Membership lookup', PUBLIC_PORTAL_MEMBERSHIP_TIMEOUT_MS)
      .then((result) => {
        setMembershipData((result || null) as LooseRecord | null)
        if (!result) setMembershipError(copy('membershipNotFound', 'No membership was found for that number.'))
      })
      .catch((error) => setMembershipError(getErrorMessage(error, 'Membership lookup failed')))
      .finally(() => setMembershipLoading(false))
  }
  const handleSubmissionPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith('image/'))
    if (!files.length) return
    event.preventDefault()
    readImageFilesAsDataUrls(files).then((screenshots) => {
      setSubmissionDraft((current) => ({ ...current, screenshots: [...current.screenshots, ...screenshots].slice(0, SUBMISSION_MAX_SCREENSHOTS) }))
    })
  }
  const handleUploadSubmissionImages = () => {
    pickMultipleImagesAsDataUrls().then((screenshots) => {
      setSubmissionDraft((current) => ({ ...current, screenshots: [...current.screenshots, ...screenshots].slice(0, SUBMISSION_MAX_SCREENSHOTS) }))
    })
  }
  const handleSubmitShareProof = () => {
    if (!membershipData?.customer?.membership_number && !membershipNumber.trim()) {
      setMembershipError(copy('membershipRequired', 'Enter a membership number first.'))
      return
    }
    setSubmissionSaving(true)
    const payload = { membershipNumber: membershipData?.customer?.membership_number || membershipNumber.trim(), ...submissionDraft }
    withLoaderTimeout(() => getCatalogApi().createPortalSubmission?.(payload) || Promise.reject(new Error('Submission API unavailable')), 'Share submission', PUBLIC_PORTAL_SUBMISSION_TIMEOUT_MS)
      .then(() => {
        setSubmissionDraft({ platform: 'Facebook', note: '', screenshots: [] })
        return handleMembershipLookup()
      })
      .catch((error) => setMembershipError(getErrorMessage(error, 'Submission failed')))
      .finally(() => setSubmissionSaving(false))
  }
  const clearAssistantState = () => {
    setAssistantError('')
    setAssistantResponse(null)
    setAssistantExpandedProductId(null)
  }
  const askAssistant = () => {
    const question = assistantQuestion.trim()
    if (!question) {
      setAssistantError(copy('assistantQuestionRequired', 'Ask a question first.'))
      return
    }
    setAssistantLoading(true)
    setAssistantError('')
    withLoaderTimeout(() => getCatalogApi().askPortalAi?.({ question, profile: assistantProfile }) || Promise.reject(new Error('AI assistant API unavailable')), 'AI assistant', PUBLIC_PORTAL_AI_TIMEOUT_MS)
      .then((result) => setAssistantResponse((result || null) as LooseRecord | null))
      .catch((error) => setAssistantError(getErrorMessage(error, 'AI assistant failed')))
      .finally(() => setAssistantLoading(false))
  }

  useEffect(() => {
    if (!displayConfig.aiEnabled) return
    if (activeTab !== 'ai') return
    getCatalogApi().getPortalAiStatus?.()
      ?.then((result) => {
        const data = (result || {}) as LooseRecord
        setAiUsageSummary((data.usage || data.usageSummary || null) as LooseRecord | null)
        setAssistantRequestPolicy((data.policy || data.requestPolicy || null) as LooseRecord | null)
      })
      .catch(() => {})
  }, [activeTab, displayConfig.aiEnabled])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const title = String(displayConfig.businessName || displayConfig.title || 'Leang Cosmetics').trim()
    if (title) document.title = title
    const favicon = resolveCatalogAssetUrl(displayConfig.businessFavicon || displayConfig.businessLogo || '') || DEFAULT_PUBLIC_PORTAL_ICON

    // index.html ships THREE <link rel="icon"> tags (a plain .ico plus
    // 192/512 PNGs for home-screen icons) -- this used to only grab the
    // first one via querySelector, so browsers kept showing a stale icon
    // from whichever of the other two they picked for the tab/shortcut.
    // Mirrors App.tsx's admin-side favicon effect: update every matching
    // link, and run the source through the same circular-mask helper so
    // square uploads don't show square corners here either.
    const iconEls = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'))
    if (!iconEls.length) return undefined
    iconEls.forEach((iconEl) => iconEl.setAttribute('href', favicon))

    const requestId = (Number(faviconRequestRef.current) || 0) + 1
    faviconRequestRef.current = requestId
    let cancelled = false
    withLoaderTimeout(
      async () => {
        const { createCircularFaviconDataUrl } = await import('../../utils/favicon.ts')
        return createCircularFaviconDataUrl(favicon)
      },
      'Public catalog favicon',
      PUBLIC_PORTAL_FAVICON_TIMEOUT_MS,
    )
      .then((faviconHref) => {
        if (cancelled || faviconRequestRef.current !== requestId) return
        iconEls.forEach((iconEl) => {
          iconEl.setAttribute('href', faviconHref || favicon)
          iconEl.setAttribute('type', 'image/png')
        })
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [displayConfig.businessFavicon, displayConfig.businessLogo, displayConfig.businessName, displayConfig.title])

  // The customer portal shares index.html with the admin app.  Update the
  // manifest as well as the favicon above so “Add to Home Screen” never
  // retains Business OS branding.  This runs for the unconfigured portal
  // too, using the supplied Leang Cosmetics fallback asset.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    if (!manifestLink) return undefined
    const previousHref = manifestLink.getAttribute('href') || ''
    const iconSource = resolveCatalogAssetUrl(displayConfig.businessFavicon || displayConfig.businessLogo || '') || DEFAULT_PUBLIC_PORTAL_ICON
    const requestId = (Number(manifestRequestRef.current) || 0) + 1
    manifestRequestRef.current = requestId
    let manifestUrl: string | null = null
    let cancelled = false

    withLoaderTimeout(
      async () => {
        const [{ createSquareIconDataUrl }, { buildPortalManifest }] = await Promise.all([
          import('../../utils/favicon.ts'),
          import('../../utils/portalManifest.ts'),
        ])
        const [icon192, icon512] = await Promise.all([
          createSquareIconDataUrl(iconSource, { size: 192, fit: 'contain', zoom: 110 }),
          createSquareIconDataUrl(iconSource, { size: 512, fit: 'contain', zoom: 110 }),
        ])
        return buildPortalManifest({
          businessName: displayConfig.businessName || displayConfig.title || 'Leang Cosmetics',
          publicPath: window.location.pathname || '/',
          icon192: icon192 || iconSource,
          icon512: icon512 || iconSource,
        })
      },
      'Public portal manifest',
      PUBLIC_PORTAL_FAVICON_TIMEOUT_MS,
    ).then((manifest) => {
      if (cancelled || manifestRequestRef.current !== requestId) return
      manifestUrl = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }))
      manifestLink.setAttribute('href', manifestUrl)
    }).catch(() => {})

    return () => {
      cancelled = true
      if (manifestUrl) URL.revokeObjectURL(manifestUrl)
      if (previousHref) manifestLink.setAttribute('href', previousHref)
      else manifestLink.removeAttribute('href')
    }
  }, [displayConfig.businessFavicon, displayConfig.businessLogo, displayConfig.businessName, displayConfig.title])

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
    const qty = getBranchQty(product, selectedStockBranch)
    const status = getStockStatus(product, qty, displayConfig)
    const gallery = normalizeProductGallery(product)
    const pricePresentation = displayConfig.showPrices
      ? buildPortalPricePresentation(product, displayConfig, formatPortalPrice)
      : null
    setProductDetailView({ open: true, product, gallery, status, pricePresentation, showPrices: !!displayConfig.showPrices })
  }
  const closeProductDetailView = () => setProductDetailView((prev) => ({ ...prev, open: false }))

  const catalogSection = displayConfig.showCatalog ? (
    <Suspense fallback={<div className="portal-empty-card">{copy('catalogLoading', 'Loading products...')}</div>}>
      <CatalogProductsSection
        copy={copy}
        filteredProducts={products}
        serverPaged
        productTotal={productTotal}
        productPage={productPage}
        productPageSize={productPageSize}
        setProductPage={setProductPage}
        setProductPageSize={setProductPageSize}
        initialOptions={productInitials}
        initialFilter={productInitial}
        setInitialFilter={setProductInitial}
        refreshingProducts={refreshingProducts}
        loadingProducts={loading}
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
        setStockFilter={setStockFilter}
        toggleFilterValue={toggleFilterValue}
        toggleFilterValues={toggleFilterValues}
        previewConfig={displayConfig}
        portalError={portalError}
        productGridClass={productGridClass}
        compactTwoColumnMobile={compactTwoColumnMobile}
        compactCatalogCards
        promotionItems={(displayConfig.promoItems || []).filter((item) => item && item.id != null) as Array<{ id: string | number } & Record<string, unknown>>}
        promotionsTitle={displayConfig.promotionsTitle}
        promotionsIntro={displayConfig.promotionsIntro}
        selectedStockBranch={selectedStockBranch}
        getBranchQty={getBranchQty}
        getStockStatus={getStockStatus}
        normalizeProductGallery={normalizeProductGallery}
        openProductGallery={openProductGallery}
        openProductDetail={openProductDetail}
        openPortalImage={openPortalImage}
        formatPortalPrice={formatPortalPrice}
        replaceVars={(template: string, values: Record<string, string | number>) => replaceVars(template, values)}
        onAddToBucket={(product, priceText) => bucket.add(
          { id: product.id, name: String(product.name || ''), category: String(product.category || ''), brand: String(product.brand || '') },
          priceText,
        )}
        isInBucket={bucket.hasItem}
        getBucketQty={bucket.getQty}
      />
    </Suspense>
  ) : null

  const promotionsSection = activeTab === 'products' ? (
    <Suspense fallback={null}>
      <PortalPromotionsBanner copy={copy} onOpenImage={openPortalImage} />
    </Suspense>
  ) : null

  const secondaryTabSection = activeTab !== 'products' ? (
    <Suspense fallback={<div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">{copy('loadingPortal', 'Loading customer portal...')}</div>}>
      <CatalogSecondaryTabs
        tab={activeTab}
        copy={copy}
        formatDateTime={formatDateTime}
        formatPortalPrice={formatPortalPrice}
        membershipNumber={membershipNumber}
        setMembershipNumber={setMembershipNumber}
        handleMembershipLookup={handleMembershipLookup}
        membershipLoading={membershipLoading}
        membershipError={membershipError}
        membershipData={membershipData}
        previewConfig={displayConfig}
        redeemSummaryText={redeemSummaryText}
        submissionDraft={submissionDraft}
        setSubmissionDraft={setSubmissionDraft}
        submissionSaving={submissionSaving}
        handleSubmissionPaste={handleSubmissionPaste}
        handleSubmitShareProof={handleSubmitShareProof}
        handleUploadSubmissionImages={handleUploadSubmissionImages}
        openPortalImage={openPortalImage}
        mapEmbedUrl={mapEmbedUrl}
        addressFact={addressFact}
        businessFacts={businessFacts}
        socialLinks={socialLinks}
        versionedBusinessLogo={versionedBusinessLogo}
        versionedBusinessCover={versionedBusinessCover}
        publicFaqItems={publicFaqItems}
        expandedFaqId={expandedFaqId}
        setExpandedFaqId={setExpandedFaqId}
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
        aiUsageSummary={aiUsageSummary}
        assistantRequestPolicy={assistantRequestPolicy}
        replaceVars={(template: string, values: Record<string, string | number>) => replaceVars(template, values)}
        assistantError={assistantError}
        assistantResponse={assistantResponse}
        assistantExpandedProductId={assistantExpandedProductId}
        setAssistantExpandedProductId={setAssistantExpandedProductId}
      />
    </Suspense>
  ) : null

  const scrollPublicPortal = (direction: 'top' | 'bottom') => {
    const top = direction === 'bottom' ? Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) : 0
    window.scrollTo({ top, behavior: 'smooth' })
  }

  const bucketBusinessName = String(displayConfig.businessName || displayConfig.title || 'Leang Cosmetics').trim()

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

  const closeBucketDrawer = () => {
    setBucketOpen(false)
    setBucketContactOpen(false)
  }

  const bucketDrawer = bucketOpen ? (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/50 backdrop-blur-sm sm:items-center" onClick={closeBucketDrawer}>
      <div
        className="max-h-modal-85 w-full max-w-md overflow-hidden rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl dark:bg-neutral-900 sm:rounded-3xl sm:pb-0"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-neutral-800">
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-neutral-100">{copy('bucketTitle', 'My List')}</div>
            <div className="text-xs text-slate-400 dark:text-neutral-500">{copy('bucketHint', 'No payment here -- just a shortlist to show our team.')}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {contactChannels.length > 0 ? (
              <button
                type="button"
                className={`rounded-full p-1.5 transition ${bucketContactOpen ? 'bg-slate-100 text-slate-700 dark:bg-neutral-800 dark:text-neutral-100' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'}`}
                onClick={() => setBucketContactOpen((current) => !current)}
                aria-label={copy('contactUs', 'Contact us')}
                title={copy('contactUs', 'Contact us')}
                aria-expanded={bucketContactOpen}
              >
                <Headset className="h-5 w-5" />
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              onClick={closeBucketDrawer}
              aria-label={copy('close', 'Close')}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/*
          "Contact us" also has its own standalone floating icon (see
          contactFab below, stacked above the bucket FAB) for a one-tap
          path that doesn't require opening the list first. This header
          shortcut is kept too, purely as a convenience for shoppers who
          are already in the drawer. It used to toggle the very same state
          as that standalone icon's popover, so opening it here silently
          popped open the outside popover too (both being "open" at once,
          stacked on top of the drawer). It now owns its own state
          (bucketContactOpen) so the two are fully independent.
        */}
        {bucketContactOpen && contactChannels.length > 0 ? (
          <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-3 dark:border-neutral-800 dark:bg-neutral-800/30">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-neutral-500">
              {copy('contactUs', 'Contact us')}
            </div>
            <div className="space-y-1">
              {contactChannels.map((item) => {
                const Icon = contactIconByKey[item.key] || MessageSquare
                return (
                  <a
                    key={item.key}
                    href={item.value}
                    target={item.value.startsWith('tel:') ? undefined : '_blank'}
                    rel={item.value.startsWith('tel:') ? undefined : 'noreferrer'}
                    className="group flex items-center gap-3 rounded-xl px-2 py-2 text-sm font-medium text-slate-700 transition hover:bg-white dark:text-neutral-200 dark:hover:bg-neutral-800/80"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-600 shadow-sm transition group-hover:text-amber-600 dark:bg-neutral-800 dark:text-neutral-300 dark:group-hover:text-amber-300">
                      <Icon className="h-4 w-4 shrink-0" />
                    </span>
                    {item.label}
                  </a>
                )
              })}
            </div>
          </div>
        ) : null}

        <div className="max-h-[50vh] overflow-y-auto px-5 py-3">
          {bucket.items.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400 dark:text-neutral-500">
              {copy('bucketEmpty', 'Your list is empty. Tap "Add" on products you like.')}
            </div>
          ) : (
            <ul className="space-y-3">
              {bucket.items.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 border-b border-slate-50 pb-3 last:border-0 dark:border-neutral-800/60">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900 dark:text-neutral-100">{item.name}</div>
                    {item.priceText ? <div className="text-xs text-slate-400 dark:text-neutral-500">{item.priceText}</div> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-300"
                      onClick={() => bucket.setQty(item.id, item.qty - 1)}
                      aria-label={copy('decreaseQty', 'Decrease quantity')}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-6 text-center text-sm font-semibold text-slate-800 dark:text-neutral-100">{item.qty}</span>
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-300"
                      onClick={() => bucket.setQty(item.id, item.qty + 1)}
                      aria-label={copy('increaseQty', 'Increase quantity')}
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="ml-1 flex h-7 w-7 items-center justify-center rounded-full text-rose-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                      onClick={() => bucket.remove(item.id)}
                      aria-label={copy('removeFromBucket', 'Remove')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {bucket.items.length > 0 ? (
          <div className="space-y-2 border-t border-slate-100 px-5 py-4 dark:border-neutral-800">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
                onClick={handleBucketCopy}
              >
                <Copy className="h-4 w-4" />
                {bucketCopyState === 'copied' ? copy('bucketCopied', 'Copied!') : copy('copyList', 'Copy list')}
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                onClick={handleBucketDownload}
              >
                <Download className="h-4 w-4" />
                {copy('downloadList', 'Download')}
              </button>
            </div>
            {bucketCopyState === 'failed' ? (
              <div className="text-center text-xs text-rose-500">{copy('bucketCopyFailed', 'Could not copy automatically -- try Download instead.')}</div>
            ) : null}
            <button
              type="button"
              className="w-full text-center text-xs font-medium text-slate-400 hover:text-rose-500 dark:text-neutral-500"
              onClick={bucket.clear}
            >
              {copy('clearBucket', 'Clear all')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
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
  const pullToRefreshEnabled = !productGalleryView.open && !portalImageView.open && !bucketOpen && !contactOpen && !filePicker.open
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

  // Bucket ("My List") and Contact us are two separate floating icons,
  // stacked bottom-right with the bucket on top -- the bucket stays visible
  // at all times so it's discoverable even before a shopper adds anything,
  // and Contact us gets its own one-tap icon (rather than being buried a
  // click deep inside the bucket drawer) whenever the store has a channel
  // configured.
  const bucketFab = (
    <button
      type="button"
      className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-[calc(1.25rem+env(safe-area-inset-right))] z-50 flex items-center gap-2 rounded-full bg-slate-900 px-4 py-3 text-white shadow-xl transition hover:bg-slate-700 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
      onClick={() => setBucketOpen(true)}
      aria-label={copy('bucketTitle', 'My List')}
    >
      <ClipboardList className="h-5 w-5" />
      {bucket.count > 0 ? (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
          {bucket.count}
        </span>
      ) : null}
    </button>
  )

  const contactFab = contactChannels.length > 0 ? (
    <button
      type="button"
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-[calc(1.25rem+env(safe-area-inset-right))] z-50 flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-700 shadow-xl ring-1 ring-slate-200 transition hover:bg-slate-50 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-neutral-700 dark:hover:bg-neutral-800"
      onClick={() => setContactOpen((current) => !current)}
      aria-label={copy('contactUs', 'Contact us')}
      title={copy('contactUs', 'Contact us')}
      aria-expanded={contactOpen}
    >
      <Headset className="h-5 w-5" />
    </button>
  ) : null

  const contactPopover = contactOpen && contactChannels.length > 0 ? (
    <div className="fixed inset-0 z-[65]" onClick={() => setContactOpen(false)}>
      <div
        className="absolute bottom-[calc(8rem+env(safe-area-inset-bottom))] right-[calc(1.25rem+env(safe-area-inset-right))] w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-100 bg-white p-3 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-neutral-500">
            {copy('contactUs', 'Contact us')}
          </div>
          <button
            type="button"
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            onClick={() => setContactOpen(false)}
            aria-label={copy('close', 'Close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-1">
          {contactChannels.map((item) => {
            const Icon = contactIconByKey[item.key] || MessageSquare
            return (
              <a
                key={item.key}
                href={item.value}
                target={item.value.startsWith('tel:') ? undefined : '_blank'}
                rel={item.value.startsWith('tel:') ? undefined : 'noreferrer'}
                className="group flex items-center gap-3 rounded-xl px-2 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-neutral-800/80"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 shadow-sm transition group-hover:text-amber-600 dark:bg-neutral-800 dark:text-neutral-300 dark:group-hover:text-amber-300">
                  <Icon className="h-4 w-4 shrink-0" />
                </span>
                {item.label}
              </a>
            )
          })}
        </div>
      </div>
    </div>
  ) : null

  return (
    <div ref={publicPageRootRef} className="relative">
    {bucketFab}
    {contactFab}
    {contactPopover}
    {bucketDrawer}
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
      versionedBusinessLogo={versionedBusinessLogo}
      showBrandLabel={showBrandLabel}
      previewTitle={previewTitle}
      portalTabs={portalTabs}
      activeTab={activeTab}
      setActiveTab={(key) => setActiveTab(resolvePortalActiveTab(displayConfig, copy, key))}
      publicPortalNavRef={publicPortalNavRef as RefObject<HTMLElement>}
      publicPortalNavPinned={false}
      publicPortalNavMetrics={{ left: 0, width: 0, height: 0 }}
      headerLinks={headerLinks}
      catalogSection={activeTab === 'products' ? catalogSection : null}
      secondaryTabSection={secondaryTabSection}
      promotionsSection={promotionsSection}
      productDetailView={productDetailView}
      closeProductDetailView={closeProductDetailView}
      productDetailShopName={displayConfig.businessName || displayConfig.title || ''}
      productDetailCautionDefault={displayConfig.productCautionDefault || ''}
      productDetailNeedMoreDetailsDefault={displayConfig.productNeedMoreDetailsDefault || ''}
      publicScrollButtonsVisible={scrollButtonsVisible && !bucketOpen && !contactOpen}
      scrollPublicPortal={scrollPublicPortal}
      productGalleryView={productGalleryView}
      setProductGalleryView={setProductGalleryView}
      filePicker={filePicker}
      setFilePicker={setFilePicker}
      handleFilePickerSelect={() => {}}
      portalImageView={portalImageView}
      setPortalImageView={setPortalImageView}
      toggleTheme={toggleTheme}
      translateTarget={translateTarget}
      translateApplyState="idle"
      translateApplyMessage=""
      externalTranslateTarget={null}
      translateReady
      changeTranslateTarget={setTranslateTarget}
      allPublicTranslateOptions={ALL_PUBLIC_TRANSLATE_OPTIONS}
    />
    </div>
  )
}
