import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent, Dispatch, RefObject, SetStateAction } from 'react'
import Bot from 'lucide-react/dist/esm/icons/bot.js'
import HelpCircle from 'lucide-react/dist/esm/icons/help-circle.js'
import Mail from 'lucide-react/dist/esm/icons/mail.js'
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js'
import Phone from 'lucide-react/dist/esm/icons/phone.js'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import Store from 'lucide-react/dist/esm/icons/store.js'
import Ticket from 'lucide-react/dist/esm/icons/ticket.js'
import type { LucideIcon } from 'lucide-react'
import { useApp } from '../../app/AppContextCore.tsx'
import { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent, withLoaderTimeout } from '../../utils/loaders.ts'
import { aggregateInitialOptions } from '../../utils/initials.ts'
import CatalogPreviewSurface from './CatalogPreviewSurface'
import { getPortalGridClass } from './portalCatalogDisplay.ts'
import { normalizeGoogleMapsEmbed } from './portalEditorUtils.ts'
import { resolveCatalogAssetUrl } from './catalogAssetUrls'

const loadCatalogProductsSection = () => import('./CatalogProductsSection')
const CatalogProductsSection = lazy(loadCatalogProductsSection)
const CatalogSecondaryTabs = lazy(() => import('./CatalogSecondaryTabs'))

const PUBLIC_PORTAL_BOOTSTRAP_TIMEOUT_MS = 15000
const PUBLIC_PORTAL_PRODUCT_SEARCH_TIMEOUT_MS = 12000
const PUBLIC_PORTAL_MEMBERSHIP_TIMEOUT_MS = 12000
const PUBLIC_PORTAL_SUBMISSION_TIMEOUT_MS = 12000
const PUBLIC_PORTAL_AI_TIMEOUT_MS = 25000
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
  showEmail?: boolean
  showFacebook?: boolean
  showFaq?: boolean
  showGoogleMap?: boolean
  showInstagram?: boolean
  showMembership?: boolean
  showOutOfStockProducts?: boolean
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
  businessName: 'Leang Cosmetic',
  exchangeRate: 4100,
  faqItems: [],
  gridColumnsDesktop: 4,
  gridColumnsMobile: 1,
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
  showEmail: true,
  showFacebook: true,
  showFaq: true,
  showGoogleMap: true,
  showInstagram: true,
  showMembership: true,
  showOutOfStockProducts: true,
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
  title: 'Leang Cosmetic',
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

function buildPortalBackground(config: PortalConfig): string {
  const start = normalizeHexColor(config.heroGradientStart, '#0f172a')
  const mid = normalizeHexColor(config.heroGradientMid, '#14532d')
  const end = normalizeHexColor(config.heroGradientEnd, '#ea580c')
  return [
    `radial-gradient(circle at 12% 18%, ${hexToRgba(end, 0.14)}, transparent 34%)`,
    `radial-gradient(circle at 86% 10%, ${hexToRgba(mid, 0.12)}, transparent 30%)`,
    `linear-gradient(180deg, ${hexToRgba(start, 0.08)}, rgba(248,250,252,0.96) 32%, rgba(248,250,252,1))`,
  ].join(', ')
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
    if (unique.length >= 5) break
  }
  if (!unique.length && product?.image_path) unique.push(String(product.image_path))
  return unique
}

function formatPortalPrice(usd: unknown, khr: unknown, config: { exchangeRate?: unknown; priceDisplay?: unknown }): string {
  const usdValue = Number(usd || 0)
  const exchangeRate = Number(config.exchangeRate || 4100)
  const khrValue = khr != null ? Number(khr || 0) : usdValue * exchangeRate
  const usdText = `$${usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const khrText = `${Math.round(khrValue).toLocaleString('en-US')} KHR`
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

export default function PublicCatalogPage() {
  const { theme, toggleTheme, t } = useApp() as { theme?: string; toggleTheme: () => void; t?: (key: string) => string }
  const embeddedPortalRef = useRef(readEmbeddedPortalBootstrap())
  const cachedPortalRef = useRef(embeddedPortalRef.current || readPortalCache())
  const cachedPortal = cachedPortalRef.current
  const requestRef = useRef(0)
  const productRequestRef = useRef(0)
  const aliveRef = useRef(true)
  const previewSectionRef = useRef<HTMLDivElement>(null)
  const publicPortalNavRef = useRef<HTMLElement>(null)
  const skipNextProductSearchRef = useRef(false)

  const [config, setConfig] = useState<PortalConfig>(() => ({ ...DEFAULT_PUBLIC_CONFIG, ...(cachedPortal?.config || {}) }))
  const [products, setProducts] = useState<CatalogProduct[]>(() => Array.isArray(cachedPortal?.products) ? cachedPortal.products : [])
  const [productTotal, setProductTotal] = useState(() => Number(cachedPortal?.catalog?.total || cachedPortal?.products?.length || 0))
  const [productPage, setProductPage] = useState(() => Number(cachedPortal?.catalog?.page || 1) || 1)
  const [productPageSize, setProductPageSize] = useState(() => Number(cachedPortal?.catalog?.pageSize || 20) || 20)
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
  const [translateTarget, setTranslateTarget] = useState('original')

  const copy: CopyFunction = (key, fallback = '', fallbackKm = fallback) => {
    const fullKey = `portalEditor.${key}`
    const translated = typeof t === 'function' ? t(fullKey) : ''
    if (translated && translated !== fullKey) return translated
    return translateTarget === 'km' ? (fallbackKm || fallback) : fallback
  }

  useEffect(() => {
    if (embeddedPortalRef.current) {
      skipNextProductSearchRef.current = true
      writePortalCache(embeddedPortalRef.current)
      setLoading(false)
      return undefined
    }
    const requestId = beginTrackedRequest(requestRef)
    setLoading(products.length === 0)
    withLoaderTimeout(() => getCatalogApi().getPortalBootstrap?.() || Promise.reject(new Error('Portal bootstrap API unavailable')), 'Portal bootstrap', PUBLIC_PORTAL_BOOTSTRAP_TIMEOUT_MS)
      .then((payload) => {
        if (!aliveRef.current || !isTrackedRequestCurrent(requestRef, requestId)) return
        const next = normalizeBootstrapPayload(payload)
        setConfig(next.config)
        setProducts(next.products)
        setProductTotal(Number(next.catalog.total || next.products.length || 0))
        setProductPage(Number(next.catalog.page || 1) || 1)
        setProductPageSize(Number(next.catalog.pageSize || 20) || 20)
        setProductInitials(normalizePortalInitialOptions(next.catalog.initials))
        setCategories(next.categories)
        setBrands(next.brands)
        setBranches(next.branches)
        setActiveTab((current) => resolvePortalActiveTab(next.config, copy, current))
        setPortalError('')
        skipNextProductSearchRef.current = true
        writePortalCache({ config: next.config, categories: next.categories, brands: next.brands, branches: next.branches, products: next.products, catalog: next.catalog })
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
  }, [])

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
      stockState: stockFilter.join(','),
      initial: productInitial,
    }
    withLoaderTimeout(() => getCatalogApi().searchPortalCatalogProducts?.(params) || Promise.reject(new Error('Portal product search API unavailable')), 'Portal product search', PUBLIC_PORTAL_PRODUCT_SEARCH_TIMEOUT_MS)
      .then((result) => {
        if (!aliveRef.current || !isTrackedRequestCurrent(productRequestRef, requestId)) return
        const data = (result || {}) as LooseRecord
        const nextItems = Array.isArray(data.items) ? data.items as CatalogProduct[] : []
        const nextInitials = normalizePortalInitialOptions(data.initials)
        setProducts(nextItems)
        setProductTotal(Number(data.total || 0))
        setProductPage(Number(data.page || productPage) || 1)
        setProductPageSize(Number(data.pageSize || productPageSize) || productPageSize)
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
          catalog: { page: Number(data.page || productPage) || 1, pageSize: Number(data.pageSize || productPageSize) || productPageSize, total: Number(data.total || 0), initials: nextInitials },
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
  }, [brandFilter, branchFilter, categoryFilter, config.showCatalog, deferredSearch, loading, productInitial, productPage, productPageSize, products.length, stockFilter])

  useEffect(() => () => {
    aliveRef.current = false
    invalidateTrackedRequest(requestRef)
    invalidateTrackedRequest(productRequestRef)
  }, [])

  const displayConfig = useMemo<PortalConfig>(() => ({ ...DEFAULT_PUBLIC_CONFIG, ...config }), [config])
  const darkMode = theme === 'dark'
  const portalBackground = buildPortalBackground(displayConfig)
  const previewTitle = String(displayConfig.businessName || displayConfig.title || '').trim()
  const previewBusinessName = String(displayConfig.businessName || '').trim()
  const showBrandLabel = previewBusinessName && previewBusinessName.toLowerCase() !== previewTitle.toLowerCase()
  const portalTabs = getPortalTabs(displayConfig, copy)
  const productGridClass = getPortalGridClass(displayConfig.gridColumnsDesktop)
  const mobileGridColumns = Math.min(3, Math.max(1, Math.round(toNumber(displayConfig.gridColumnsMobile, 1))))
  const compactTwoColumnMobile = mobileGridColumns >= 2
  const versionedBusinessLogo = withAssetVersion(displayConfig.businessLogo, displayConfig.businessLogo || displayConfig.businessName)
  const versionedBusinessCover = withAssetVersion(displayConfig.businessCover, displayConfig.businessCover || displayConfig.businessName)
  const selectedStockBranch = branchFilter[0] || 'all'
  const portalActiveFilterCount = categoryFilter.length + brandFilter.length + branchFilter.length + stockFilter.length + (productInitial === 'all' ? 0 : 1)
  const publicFaqItems = normalizeFaqItems(displayConfig.faqItems)
  const mapEmbedUrl = displayConfig.showGoogleMap && activeTab === 'about' ? normalizeGoogleMapsEmbed(displayConfig.googleMapsEmbed || '') : ''
  const socialLinks = [
    { key: 'website', enabled: displayConfig.showWebsite, label: String(displayConfig.linkLabels?.website || copy('website', 'Website')).trim() || copy('website', 'Website'), value: displayConfig.links?.website },
    { key: 'facebook', enabled: displayConfig.showFacebook, label: String(displayConfig.linkLabels?.facebook || copy('facebook', 'Facebook')).trim() || copy('facebook', 'Facebook'), value: displayConfig.links?.facebook },
    { key: 'instagram', enabled: displayConfig.showInstagram, label: String(displayConfig.linkLabels?.instagram || copy('instagram', 'Instagram')).trim() || copy('instagram', 'Instagram'), value: displayConfig.links?.instagram },
    { key: 'telegram', enabled: displayConfig.showTelegram, label: String(displayConfig.linkLabels?.telegram || copy('telegram', 'Telegram')).trim() || copy('telegram', 'Telegram'), value: displayConfig.links?.telegram },
  ].filter((item) => item.enabled && normalizeExternalUrl(item.value)).map((item) => ({ key: item.key, label: item.label, value: normalizeExternalUrl(item.value) }))
  const businessFacts = [
    { key: 'phone', enabled: displayConfig.showPhone, label: copy('phone', 'Phone'), value: displayConfig.businessPhone, href: displayConfig.businessPhone ? `tel:${displayConfig.businessPhone}` : '', icon: Phone },
    { key: 'email', enabled: displayConfig.showEmail, label: copy('email', 'Email'), value: displayConfig.businessEmail, href: displayConfig.businessEmail ? `mailto:${displayConfig.businessEmail}` : '', icon: Mail },
    { key: 'address', enabled: displayConfig.showAddress, label: copy('address', 'Address'), value: displayConfig.businessAddress, href: normalizeExternalUrl(displayConfig.addressLink), icon: MapPin },
  ].filter((item) => item.enabled && item.value)
  const addressFact = businessFacts.find((item) => item.key === 'address') || null
  const redeemSummaryText = `${Number(displayConfig.redeemPoints || 100).toLocaleString()} ${copy('points', 'points')} = ${formatPortalPrice(displayConfig.redeemValueUsd, displayConfig.redeemValueKhr, displayConfig)}`
  const assistantCategoryOptions = useMemo(() => Array.from(new Set(products.map((item) => String(item.category || '').trim()).filter(Boolean))).slice(0, 40), [products])

  const toggleFilterValue = (values: string[], setter: Dispatch<SetStateAction<string[]>>, value: string) => {
    setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value])
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
        openPortalImage={openPortalImage}
        formatPortalPrice={formatPortalPrice}
        replaceVars={(template: string, values: Record<string, string | number>) => replaceVars(template, values)}
      />
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

  return (
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
      catalogSection={catalogSection}
      secondaryTabSection={secondaryTabSection}
      publicScrollButtonsVisible={false}
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
      allPublicTranslateOptions={[
        { value: 'original', label: 'Original', kind: 'first_party' },
        { value: 'en', label: 'English', kind: 'first_party' },
        { value: 'km', label: 'Khmer', kind: 'first_party' },
      ]}
    />
  )
}
