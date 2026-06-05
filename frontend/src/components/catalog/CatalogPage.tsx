import { Suspense, lazy, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent, Dispatch, RefObject, SetStateAction } from 'react'
import BadgeDollarSign from 'lucide-react/dist/esm/icons/badge-dollar-sign.js'
import Bot from 'lucide-react/dist/esm/icons/bot.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.js'
import Eye from 'lucide-react/dist/esm/icons/eye.js'
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js'
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js'
import Facebook from 'lucide-react/dist/esm/icons/facebook.js'
import Globe from 'lucide-react/dist/esm/icons/globe.js'
import HelpCircle from 'lucide-react/dist/esm/icons/help-circle.js'
import Images from 'lucide-react/dist/esm/icons/images.js'
import Instagram from 'lucide-react/dist/esm/icons/instagram.js'
import Mail from 'lucide-react/dist/esm/icons/mail.js'
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js'
import Phone from 'lucide-react/dist/esm/icons/phone.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import Save from 'lucide-react/dist/esm/icons/save.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import Send from 'lucide-react/dist/esm/icons/send.js'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js'
import Store from 'lucide-react/dist/esm/icons/store.js'
import Ticket from 'lucide-react/dist/esm/icons/ticket.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import type { LucideIcon } from 'lucide-react'
import { useIsPageActive } from '../shared/pageActivity'
import { isBrokenLocalizedString, useApp, useSync } from '../../AppContext'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import { beginKeyedAction, beginSingleAction, finishKeyedAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { SectionShell } from './catalogUi'
import {
  createAboutBlock,
  createPromoItem,
  normalizeAboutBlocks,
  normalizeGoogleMapsEmbed,
  normalizePromoItems,
  serializeAboutBlocks,
  serializePromoItems,
} from './portalEditorUtils.ts'
import {
  getPortalGridClass,
  getPortalMobileGridClass,
  normalizeRecommendedProductIds,
  productMatchesPortalBranches,
} from './portalCatalogDisplay.ts'
import {
  FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS,
  isFirstPartyPortalLanguage,
  normalizeFirstPartyPortalLanguage,
} from './portalLanguageOptions.ts'
import {
  normalizePortalTranslations,
  stringifyPortalTranslations,
} from './portalTranslationData.ts'
import { resolvePublicAssetUrl } from '../../utils/publicAssetUrls.ts'
import { aggregateInitialOptions } from '../../utils/initials.ts'
import { CatalogPageProvider } from './CatalogPageContext'

const loadCatalogEditorSurface = () => import('./CatalogEditorSurface')
const loadCatalogSecondaryTabs = () => import('./CatalogSecondaryTabs')
const loadCatalogProductsSection = () => import('./CatalogProductsSection')
const loadCatalogPreviewSurface = () => import('./CatalogPreviewSurface')
type PortalTranslateControllerModule = typeof import('./portalTranslateController.ts')
type PortalLanguagePacksModule = typeof import('./portalLanguagePacks.ts')
type PortalContentI18nModule = typeof import('./portalContentI18n.ts')
let portalTranslateControllerModulePromise: Promise<PortalTranslateControllerModule> | null = null
let portalLanguagePacksModulePromise: Promise<PortalLanguagePacksModule> | null = null
let portalContentI18nModulePromise: Promise<PortalContentI18nModule> | null = null
function loadPortalTranslateControllerModule(): Promise<PortalTranslateControllerModule> {
  if (!portalTranslateControllerModulePromise) {
    portalTranslateControllerModulePromise = import('./portalTranslateController.ts')
  }
  return portalTranslateControllerModulePromise
}
function loadPortalLanguagePacksModule(): Promise<PortalLanguagePacksModule> {
  if (!portalLanguagePacksModulePromise) {
    portalLanguagePacksModulePromise = import('./portalLanguagePacks.ts')
  }
  return portalLanguagePacksModulePromise
}
function loadPortalContentI18nModule(): Promise<PortalContentI18nModule> {
  if (!portalContentI18nModulePromise) {
    portalContentI18nModulePromise = import('./portalContentI18n.ts')
  }
  return portalContentI18nModulePromise
}

const CatalogEditorSurface = lazy(loadCatalogEditorSurface)
const CatalogSecondaryTabs = lazy(loadCatalogSecondaryTabs)
const CatalogProductsSection = lazy(loadCatalogProductsSection)
const CatalogPreviewSurface = lazy(loadCatalogPreviewSurface)

const CATALOG_PORTAL_AI_STATUS_TIMEOUT_MS = 8000
const CATALOG_PORTAL_EDITOR_HELPERS_TIMEOUT_MS = 10000
const CATALOG_PORTAL_BOOTSTRAP_TIMEOUT_MS = 15000
const CATALOG_PORTAL_PRODUCT_SEARCH_TIMEOUT_MS = 12000
const CATALOG_PORTAL_FAVICON_TIMEOUT_MS = 8000
const CATALOG_PORTAL_AI_REQUEST_TIMEOUT_MS = 25000
const CATALOG_MEMBERSHIP_LOOKUP_TIMEOUT_MS = 12000
const CATALOG_PORTAL_MEDIA_UPLOAD_TIMEOUT_MS = 30000
const CATALOG_PORTAL_SUBMISSION_TIMEOUT_MS = 12000
const CATALOG_PORTAL_REVIEW_TIMEOUT_MS = 12000
const CATALOG_SUBMISSION_MAX_SCREENSHOTS = 8
const CATALOG_IMAGE_READ_CONCURRENCY = 2
const PORTAL_CACHE_KEY = 'business-os-catalog-portal-cache'
const PORTAL_CACHE_PRODUCT_LIMIT = 80

type LegacyCatalogRecord = Record<string, any>
type CopyFunction = (key: string, fallback?: string, fallbackKm?: string) => string
type CatalogProduct = LegacyCatalogRecord & {
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
type PortalConfig = LegacyCatalogRecord & {
  aiEnabled?: boolean
  aiProviderId?: string | number | null
  addressLink?: string
  businessAddress?: string
  businessCover?: string
  businessEmail?: string
  businessFavicon?: string
  businessLogo?: string
  businessName?: string
  businessPhone?: string
  exchangeRate?: string | number
  faqItems?: FaqItem[]
  gridColumnsDesktop?: string | number
  gridColumnsMobile?: string | number
  language?: string
  links?: Record<string, string>
  linkLabels?: Record<string, string>
  lowStockThreshold?: string | number
  outOfStockThreshold?: string | number
  priceDisplay?: string
  refreshSeconds?: string | number
  showAbout?: boolean
  showCatalog?: boolean
  showCover?: boolean
  showEmail?: boolean
  showFacebook?: boolean
  showFaq?: boolean
  showGoogleMap?: boolean
  showInstagram?: boolean
  showMembership?: boolean
  showPhone?: boolean
  showPrices?: boolean
  showPromotions?: boolean
  showTelegram?: boolean
  showWebsite?: boolean
  stockThresholdMode?: string
  submissionEnabled?: boolean
  submissionRewardPoints?: string | number
  title?: string
  translateWidgetEnabled?: boolean
}
type PortalDraft = LegacyCatalogRecord
type FaqItem = { id: string; question: string; answer: string }
type PortalMediaBlock = LegacyCatalogRecord & { id?: unknown; type?: string; mediaUrl?: string }
type GalleryViewState = { open: boolean; title: string; items: string[]; index: number }
type PortalImageViewState = { open: boolean; title: string; images: string[]; index: number }
type FilePickerState = { open: boolean; target?: unknown; mediaType: string; title: string }
type SubmissionDraft = { platform: string; note: string; screenshots: string[] }
type PortalTab = { key: string; label: string; icon: LucideIcon }
type EditorSection = [string, string, string]
type PortalInitialOption = ReturnType<typeof aggregateInitialOptions>[number]
type CatalogOption = { id: string | number; name: string }
type CatalogApi = LegacyCatalogRecord
type UploadStatus = 'idle' | 'uploading' | 'uploaded' | 'error' | 'cancelled'
type ProcessingStatus = 'idle' | 'uploading' | 'ready' | 'error' | 'cancelled' | string
type UploadState = {
  status: UploadStatus
  progress: number
  previewUrl: string
  error: string
  fileName: string
  publicPath: string
  processingStatus: ProcessingStatus
  mediaJobId: string
  cacheVersion: string
}
type UploadAction = {
  key?: unknown
  type?: unknown
  fileName?: unknown
  previewUrl?: unknown
  progress?: unknown
  publicPath?: unknown
  processingStatus?: unknown
  mediaJobId?: unknown
  cacheVersion?: unknown
  error?: unknown
}
type CatalogAppContext = {
  hasPermission: (permission: string) => boolean
  navigateTo: (page: string) => void
  saveSettings: (settings: Record<string, unknown>, options?: unknown) => Promise<unknown> | unknown
  notify: (message: string, type?: string) => void
  theme?: string
  toggleTheme: () => void
  user?: LegacyCatalogRecord | null
  t: (key: string) => string
  language?: string
}
type CatalogSyncContext = { syncChannel?: { channel?: string } | null }

declare global {
  interface Window {
    businessOsPortalTranslateInit?: () => void
    google?: {
      translate?: {
        TranslateElement?: {
          (options: unknown, elementId: string): unknown
          InlineLayout?: { SIMPLE?: unknown }
        }
      }
    }
  }
}

type ImageFieldProps = {
  label: string
  value: string
  onUpload: () => void
  onChooseExisting?: (() => void) | null
  onChange: (value: string) => void
  onClear: () => void
  onPreview: () => void
  fieldId: string
  uploadLabel?: string
  chooseLabel?: string
  clearLabel?: string
  previewLabel?: string
  placeholder?: string
  hint?: string
  uploadState?: UploadState
  onCancelUpload?: (() => void) | null
  cancelLabel?: string
  uploadingLabel?: string
  uploadedQueuedLabel?: string
  uploadedReadyLabel?: string
}

function getCatalogApi(): CatalogApi {
  return (window as Window & { api?: CatalogApi }).api || {}
}

function getCatalogErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : String((error as LegacyCatalogRecord)?.message || fallback)
}

function createInitialUploadState(): UploadState {
  return {
    status: 'idle',
    progress: 0,
    previewUrl: '',
    error: '',
    fileName: '',
    publicPath: '',
    processingStatus: 'idle',
    mediaJobId: '',
    cacheVersion: '',
  }
}

function isTemporaryPreviewUrl(value: unknown): boolean {
  const raw = String(value || '').trim().toLowerCase()
  return raw.startsWith('blob:') || raw.startsWith('data:')
}

function sanitizePersistedMediaPath(value: unknown, fallback = ''): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (isTemporaryPreviewUrl(raw)) return String(fallback || '').trim()
  return raw
}

function buildCacheBustedMediaPath(path: unknown, version: unknown): string {
  const rawPath = resolvePublicAssetUrl(path) || String(path || '').trim()
  const rawVersion = String(version || '').trim()
  if (!rawPath || !rawVersion) return rawPath
  if (isTemporaryPreviewUrl(rawPath)) return rawPath
  try {
    const parsed = new URL(rawPath, 'http://localhost')
    parsed.searchParams.set('v', rawVersion)
    if (/^https?:\/\//i.test(rawPath)) return parsed.toString()
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch (_) {
    const withoutVersion = String(rawPath)
      .replace(/([?&])v=[^&#]*(&?)/, (_match, prefix, suffix) => (suffix ? prefix : ''))
      .replace(/[?&]$/, '')
    return `${withoutVersion}${withoutVersion.includes('?') ? '&' : '?'}v=${encodeURIComponent(rawVersion)}`
  }
}

function reduceUploadState(state: Record<string, UploadState> = {}, action: UploadAction = {}): Record<string, UploadState> {
  const key = String(action.key || '').trim()
  if (!key) return state
  const current = state[key] || { ...createInitialUploadState() }
  if (action.type === 'start') {
    return {
      ...state,
      [key]: {
        ...current,
        status: 'uploading',
        progress: 0,
        fileName: String(action.fileName || current.fileName || ''),
        previewUrl: String(action.previewUrl || ''),
        error: '',
        processingStatus: 'uploading',
      },
    }
  }
  if (action.type === 'progress') {
    return {
      ...state,
      [key]: {
        ...current,
        status: 'uploading',
        progress: Math.max(0, Math.min(100, Number(action.progress || 0))),
      },
    }
  }
  if (action.type === 'success') {
    return {
      ...state,
      [key]: {
        ...current,
        status: 'uploaded',
        progress: 100,
        error: '',
        publicPath: String(action.publicPath || current.publicPath || ''),
        processingStatus: String(action.processingStatus || current.processingStatus || 'ready'),
        mediaJobId: String(action.mediaJobId || current.mediaJobId || ''),
        cacheVersion: String(action.cacheVersion || current.cacheVersion || ''),
      },
    }
  }
  if (action.type === 'error') {
    return {
      ...state,
      [key]: {
        ...current,
        status: 'error',
        error: String(action.error || 'Upload failed'),
        processingStatus: 'error',
      },
    }
  }
  if (action.type === 'cancel') {
    return {
      ...state,
      [key]: {
        ...current,
        status: 'cancelled',
        processingStatus: 'cancelled',
      },
    }
  }
  return state
}

function normalizePortalInitialOptions(value: unknown): PortalInitialOption[] {
  if (!Array.isArray(value)) return []
  return aggregateInitialOptions(value.map((item) => (
    typeof item === 'string'
      ? { key: item, value: item, count: 1 }
      : item
  )))
}

function normalizeCatalogOptions(value: unknown): CatalogOption[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    if (typeof item === 'string') return { id: item || index, name: item }
    return {
      id: (item as LegacyCatalogRecord)?.id ?? index,
      name: String((item as LegacyCatalogRecord)?.name ?? item ?? ''),
    }
  }).filter((item) => item.name)
}

function normalizeBrandOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => (typeof item === 'string' ? item : String((item as LegacyCatalogRecord)?.name ?? item ?? ''))).filter(Boolean)
}

function getAboutBlockLabel(type: unknown): string {
  if (type === 'image') return 'Image block'
  if (type === 'video') return 'Video block'
  return 'Text block'
}

function withAssetVersion(url: unknown, versionSeed: unknown): string {
  const raw = String(url || '').trim()
  if (!raw) return ''
  if (raw.startsWith('blob:') || raw.startsWith('data:')) return raw
  const seed = String(versionSeed || '').trim()
  if (!seed) return raw
  const separator = raw.includes('?') ? '&' : '?'
  return `${raw}${separator}v=${encodeURIComponent(seed)}`
}

function sanitizePortalMediaValue(value: unknown, fallback = ''): string {
  return sanitizePersistedMediaPath(value, fallback)
}

/**
 * CatalogPage
 * Internal mode: Portal editor + live preview with settings persistence.
 * Public mode: Read-only customer portal catalog/membership experience.
 */
/** Resolve a portal-localized string from the shared language packs. */
function tt(
  lang: unknown,
  key: string,
  fallback: string,
  fallbackKm = fallback,
  languagePacksModule?: PortalLanguagePacksModule | null,
): string {
  const localized = languagePacksModule?.getPortalLanguageText(lang, key) || ''
  if (localized && !isBrokenLocalizedString(localized)) return localized
  if (lang === 'km' && fallbackKm && !isBrokenLocalizedString(fallbackKm)) return fallbackKm
  return fallback
}

/** Parse UI setting flags stored as boolean-like string values. */
function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (value == null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

/** Parse a finite numeric value or fall back. */
function toNumber(value: unknown, fallback: unknown = 0): number {
  const parsed = Number(value)
  const fallbackNumber = Number(fallback)
  return Number.isFinite(parsed) ? parsed : (Number.isFinite(fallbackNumber) ? fallbackNumber : 0)
}

/** Restrict price display mode to supported options only. */
function normalizePriceDisplay(value: unknown): string {
  const raw = String(value || '').trim()
  return ['USD', 'KHR', 'BOTH'].includes(raw) ? raw : 'USD'
}

/** Normalize hex colors for customer portal theme controls. */
function normalizeHexColor(value: unknown, fallback: string): string {
  const raw = String(value || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : fallback
}

/** Keep optional outbound portal links to full http/https URLs only. */
function normalizeExternalUrl(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const normalized = /^https?:\/\//i.test(raw)
    ? raw
    : (/^(www\.|[\w-]+(\.[\w-]+)+|maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(raw) ? `https://${raw}` : '')
  if (!normalized) return ''
  try {
    const url = new URL(normalized)
    if (!/^https?:$/i.test(url.protocol)) return ''
    return url.toString().replace(/\/$/, '')
  } catch (_) {
    return ''
  }
}

function createFaqId(prefix = 'faq'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeFaqItems(input: unknown): FaqItem[] {
  if (!Array.isArray(input)) return []
  const usedIds = new Set()
  return input
    .map((item, index) => {
      const baseId = String(item?.id || `faq-${index + 1}`).trim() || `faq-${index + 1}`
      let nextId = baseId
      if (usedIds.has(nextId)) {
        nextId = `${baseId}-${index + 1}`
      }
      while (usedIds.has(nextId)) {
        nextId = createFaqId(baseId)
      }
      usedIds.add(nextId)
      return {
        id: nextId,
        question: String(item?.question || '').trim(),
        answer: String(item?.answer || '').trim(),
      }
    })
    .filter((item) => item.question && item.answer)
}

const FAQ_STARTER_TEXT = [
  ['1', 'How do I choose products for my skin type?', 'Tell us your skin type, concerns, and what kind of routine you want. We can recommend suitable skincare, cosmetics, hair, or body products from our available stock.'],
  ['2', 'Are the products shown here available in store?', 'The portal reads from our current Business OS catalog. Stock can still change during busy periods, so please contact the store if you need a final confirmation before visiting.'],
  ['3', 'How do I check my membership points?', 'Open the Membership section, enter your membership number, and you can review purchase history, returns, and current points from your customer account.'],
  ['4', 'How does Share & Reward work?', 'Share our store on social media, upload your screenshot in the portal, and our staff will review it. Approved submissions can receive reward points in your membership account.'],
  ['5', 'How can I contact Leang Cosmetics for more accurate advice?', 'Use the social links on this page or call the store directly. Our team can help with product matching, stock checks, and more specific skincare or makeup questions.'],
  ['6', 'Do you have products for sensitive skin?', 'Yes. Ask our team or use the AI assistant with your skin type and concerns so we can narrow options that are gentler and easier to compare from current stock.'],
  ['7', 'Can I ask whether a product is original or from a specific brand line?', 'Yes. Contact the store directly if you want brand confirmation, latest packaging details, or a more exact stock check before buying.'],
  ['8', 'Do you sell skincare, makeup, hair care, and body care together?', 'Yes. Leang Cosmetics carries multiple beauty categories, so you can search the catalog or ask for recommendations across skincare, cosmetics, perfume, hair, and body products.'],
  ['9', 'Can the store help me build a full routine?', 'Yes. Share your budget, skin type, concerns, and whether you need morning, night, or event-based products. We can help match a more complete routine from available products.'],
  ['10', 'What should I do if an item is out of stock?', 'If an item is unavailable, message the store through Facebook, Instagram, Telegram, or phone so the team can suggest alternatives or confirm when stock changes.'],
  ['11', 'Can I ask for products within a specific budget?', 'Yes. Tell us your budget and what category you want, and we can narrow options from the current catalog.'],
  ['12', 'Do you have gift-friendly items or bundles?', 'Yes. Ask the store team or use the assistant to explore perfumes, makeup, skincare, and beauty gifts that fit the occasion.'],
  ['13', 'Can I ask for alternatives if my preferred brand is unavailable?', 'Yes. We can suggest similar products from other brands in stock based on category, concern, and price range.'],
  ['14', 'Can I check whether a product is suitable for oily, dry, or combination skin?', 'Yes. Use the assistant or contact the store with your skin type and concern so recommendations stay closer to your needs.'],
  ['15', 'Do you also carry hair, body, and fragrance products?', 'Yes. The store carries more than just skincare and makeup, so you can also browse hair, body, perfume, and related beauty items when available.'],
]

const AI_FAQ_STARTER_TEXT = [
  ['16', 'What details help the AI recommend better products?', 'Add your skin type, concerns, brand preferences, and what you want the product to do. The assistant uses that together with our current catalog to narrow better matches.'],
  ['17', 'Does the AI only recommend products available at Leang Cosmetics?', 'Yes. The assistant is designed to prioritize products from our current Business OS catalog, then explain why those items fit your question.'],
  ['18', 'Should I trust the AI as medical or skin-treatment advice?', 'No. AI answers are for reference only. For sensitive skin issues, allergies, pregnancy-safe guidance, or stronger treatment advice, please contact our team directly first.'],
  ['19', 'Why does the assistant sometimes suggest several options instead of one product?', 'The assistant compares your question against the live store catalog, so it may show a short list when several products fit your needs or when stock can change by branch.'],
  ['20', 'Can the assistant explain why a product was recommended?', 'Yes. Open a suggested product to see the reason, use case, and any extra online reference notes the provider returned for that answer.'],
]

const FAQ_TRANSLATION_LOOKUP = new Map(
  [...FAQ_STARTER_TEXT, ...AI_FAQ_STARTER_TEXT].flatMap(([index, question, answer]) => [
    [question.trim().toLowerCase(), `starterFaq.${index}.question`],
    [answer.trim().toLowerCase(), `starterFaq.${index}.answer`],
  ]),
)

function translatedPortalText(t: ((key: string) => string) | null | undefined, key: string, fallback: string): string {
  const fullKey = 'portalEditor.' + key
  const value = typeof t === 'function' ? t(fullKey) : ''
  return value && value !== fullKey ? value : fallback
}

function translateConfiguredFaqText(t: ((key: string) => string) | null | undefined, value: unknown): string {
  const text = String(value || '').trim()
  if (!text) return ''
  const key = FAQ_TRANSLATION_LOOKUP.get(text.toLowerCase())
  return key ? translatedPortalText(t, key, text) : text
}

function localizeConfiguredFaqItems(items: unknown, t: ((key: string) => string) | null | undefined): FaqItem[] {
  return normalizeFaqItems(items).map((item) => ({
    ...item,
    question: translateConfiguredFaqText(t, item.question),
    answer: translateConfiguredFaqText(t, item.answer),
  }))
}

function buildFaqStarterItems(t: ((key: string) => string) | null | undefined): FaqItem[] {
  const seed = Date.now()
  return FAQ_STARTER_TEXT.map(([index, question, answer]) => ({
    id: `faq-${seed}-${index}`,
    question: translatedPortalText(t, `starterFaq.${index}.question`, question),
    answer: translatedPortalText(t, `starterFaq.${index}.answer`, answer),
  }))
}

function buildAiFaqStarterItems(t: ((key: string) => string) | null | undefined): FaqItem[] {
  const seed = Date.now()
  return AI_FAQ_STARTER_TEXT.map(([index, question, answer]) => ({
    id: `faq-ai-${seed}-${index}`,
    question: translatedPortalText(t, `starterFaq.${index}.question`, question),
    answer: translatedPortalText(t, `starterFaq.${index}.answer`, answer),
  }))
}

/** Convert hex color to rgba for layered hero background gradients. */
function hexToRgba(hex: unknown, alpha: unknown): string {
  const safeHex = normalizeHexColor(hex, '#0f172a')
  const value = safeHex.replace('#', '')
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  const safeAlpha = Number.isFinite(Number(alpha)) ? Number(alpha) : 1
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`
}

/** Read cached portal payload to reduce visible loading delays on hard reload. */
function readPortalCache(): LegacyCatalogRecord | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(PORTAL_CACHE_KEY)
    if (!raw) return null
    if (raw.length > 1_500_000) {
      sessionStorage.removeItem(PORTAL_CACHE_KEY)
      return null
    }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const ageMs = Date.now() - Number(parsed.cachedAt || 0)
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > (1000 * 60 * 20)) return null
    if (Array.isArray(parsed.products) && parsed.products.length > PORTAL_CACHE_PRODUCT_LIMIT) {
      parsed.products = parsed.products.slice(0, PORTAL_CACHE_PRODUCT_LIMIT)
    }
    return parsed
  } catch (_) {
    return null
  }
}

/** Persist lightweight portal payload cache for fast first paint after refresh. */
function writePortalCache(payload: LegacyCatalogRecord): void {
  if (typeof window === 'undefined') return
  try {
    const lightweightPayload = {
      ...payload,
      products: Array.isArray(payload?.products) ? payload.products.slice(0, PORTAL_CACHE_PRODUCT_LIMIT) : [],
      reviewItems: Array.isArray(payload?.reviewItems) ? payload.reviewItems.slice(0, 30) : [],
    }
    sessionStorage.setItem(
      PORTAL_CACHE_KEY,
      JSON.stringify({
        cachedAt: Date.now(),
        ...lightweightPayload,
      })
    )
  } catch (_) {}
}

/** Normalize customer portal path input into safe route format. */
function normalizePortalPath(value: unknown): string {
  const cleaned = String(value || '')
    .trim()
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/[^a-zA-Z0-9/_-]/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')

  return cleaned ? `/${cleaned}` : '/customer-portal'
}

/** Prevent customer portal path overlap with protected backend namespaces. */
function isReservedPortalPath(value: string): boolean {
  return value === '/' || value === '/health' || value.startsWith('/api') || value.startsWith('/uploads')
}

function getPortalTabs(config: PortalConfig, copy?: CopyFunction | null): PortalTab[] {
  const items = [
    config?.showAbout ? { key: 'about', label: copy?.('about', 'About') || 'About', icon: Store } : null,
    config?.showCatalog ? { key: 'products', label: copy?.('products', 'Products') || 'Products', icon: ShoppingBag } : null,
    config?.showMembership ? { key: 'membership', label: copy?.('membership', 'Membership') || 'Membership', icon: Ticket } : null,
    config?.showFaq ? { key: 'faq', label: copy?.('faq', 'FAQ') || 'FAQ', icon: HelpCircle } : null,
    config?.aiEnabled ? { key: 'ai', label: config?.aiTitle || copy?.('portalAssistant', 'AI assistant') || 'AI assistant', icon: Bot } : null,
  ]
  return items.filter(Boolean) as PortalTab[]
}

function resolvePortalActiveTab(config: PortalConfig, copy?: CopyFunction | null, current = ''): string {
  const tabs = getPortalTabs(config, copy)
  const currentKey = String(current || '').trim()
  if (tabs.some((item) => item.key === currentKey)) return currentKey
  return tabs[0]?.key || 'about'
}

/** Convert runtime portal config into editable key/value draft payload. */
function buildDraft(config: PortalConfig): PortalDraft {
  return {
    business_name: config.businessName || '',
    business_phone: config.businessPhone || '',
    business_email: config.businessEmail || '',
    business_address: config.businessAddress || '',
    customer_portal_address_link: config.addressLink || '',
    customer_portal_business_tagline: config.businessTagline || '',
    customer_portal_google_maps_embed: config.googleMapsEmbed || '',
    customer_portal_show_google_map: !!config.showGoogleMap,
    customer_portal_logo_image: config.businessLogo || '',
    customer_portal_favicon_image: config.businessFavicon || '',
    customer_portal_logo_size: String(config.logoSize ?? 80),
    customer_portal_logo_fit: config.logoFit || 'cover',
    customer_portal_logo_zoom: String(config.logoZoom ?? 100),
    customer_portal_logo_position_x: String(config.logoPositionX ?? 50),
    customer_portal_logo_position_y: String(config.logoPositionY ?? 50),
    customer_portal_cover_image: config.businessCover || '',
    customer_portal_show_logo: !!config.showLogo,
    customer_portal_show_cover: !!config.showCover,
    customer_portal_show_phone: !!config.showPhone,
    customer_portal_show_email: !!config.showEmail,
    customer_portal_show_address: !!config.showAddress,
    customer_portal_public_url: config.publicUrl || '',
    customer_portal_website: config.links?.website || '',
    customer_portal_facebook: config.links?.facebook || '',
    customer_portal_instagram: config.links?.instagram || '',
    customer_portal_telegram: config.links?.telegram || '',
    customer_portal_website_label: config.linkLabels?.website || 'Website',
    customer_portal_facebook_label: config.linkLabels?.facebook || 'Facebook',
    customer_portal_instagram_label: config.linkLabels?.instagram || 'Instagram',
    customer_portal_telegram_label: config.linkLabels?.telegram || 'Telegram',
    customer_portal_show_website: !!config.showWebsite,
    customer_portal_show_facebook: !!config.showFacebook,
    customer_portal_show_instagram: !!config.showInstagram,
    customer_portal_show_telegram: !!config.showTelegram,
    customer_portal_title: config.businessName || config.title || '',
    customer_portal_title_size: String(config.titleSize ?? 40),
    customer_portal_intro: config.intro || '',
    customer_portal_ai_enabled: !!config.aiEnabled,
    customer_portal_ai_title: config.aiTitle || '',
    customer_portal_ai_intro: config.aiIntro || '',
    customer_portal_ai_disclaimer: config.aiDisclaimer || '',
    customer_portal_ai_provider_id: config.aiProviderId ? String(config.aiProviderId) : '',
    customer_portal_ai_prompt: config.aiPrompt || '',
    customer_portal_show_faq: !!config.showFaq,
    customer_portal_faq_title: config.faqTitle || '',
    customer_portal_faq_items: JSON.stringify(Array.isArray(config.faqItems) ? config.faqItems : []),
    customer_portal_show_about: !!config.showAbout,
    customer_portal_about_title: config.aboutTitle || '',
    customer_portal_about_content: config.aboutContent || '',
    customer_portal_about_blocks: serializeAboutBlocks(config.aboutBlocks || []),
    customer_portal_translations: stringifyPortalTranslations(config.translations || {}),
    customer_portal_hero_gradient_start: config.heroGradientStart || '#0f172a',
    customer_portal_hero_gradient_mid: config.heroGradientMid || '#14532d',
    customer_portal_hero_gradient_end: config.heroGradientEnd || '#ea580c',
    customer_portal_path: config.publicPath || '/customer-portal',
    customer_portal_language: config.languageSetting || 'auto',
    customer_portal_translate_widget_enabled: !!config.translateWidgetEnabled,
    customer_portal_show_catalog: !!config.showCatalog,
    customer_portal_show_membership: !!config.showMembership,
    customer_portal_show_prices: !!config.showPrices,
    customer_portal_show_out_of_stock_products: !!config.showOutOfStockProducts,
    customer_portal_show_product_brand: !!config.showProductBrand,
    customer_portal_show_product_category: !!config.showProductCategory,
    customer_portal_show_product_description: !!config.showProductDescription,
    customer_portal_show_product_discount: !!config.showProductDiscount,
    customer_portal_price_display: config.priceDisplay || 'USD',
    customer_portal_show_top_seller_badge: !!config.showTopSellerBadge,
    customer_portal_show_top_product_badge: !!config.showTopProductBadge,
    customer_portal_show_recommended_badge: !!config.showRecommendedBadge,
    customer_portal_show_promotion_badge: !!config.showPromotionBadge,
    customer_portal_show_new_arrival_badge: !!config.showNewArrivalBadge,
    customer_portal_highlight_rank_limit: String(config.highlightRankLimit ?? 3),
    customer_portal_show_promotions: !!config.showPromotions,
    customer_portal_promotions_title: config.promotionsTitle || '',
    customer_portal_promotions_intro: config.promotionsIntro || '',
    customer_portal_promo_items: serializePromoItems(config.promoItems || []),
    customer_portal_recommended_product_ids: JSON.stringify(normalizeRecommendedProductIds(config.recommendedProductIds || [])),
    customer_portal_refresh_seconds: String(config.refreshSeconds ?? 20),
    customer_portal_stock_threshold_mode: config.stockThresholdMode || 'product',
    customer_portal_low_stock_threshold: String(config.lowStockThreshold ?? 10),
    customer_portal_out_of_stock_threshold: String(config.outOfStockThreshold ?? 0),
    customer_portal_grid_columns_mobile: String(config.gridColumnsMobile ?? 1),
    customer_portal_grid_columns_desktop: String(config.gridColumnsDesktop ?? 4),
    customer_portal_points_basis: config.pointsBasis || 'usd',
    customer_portal_points_per_usd: String(config.pointsPerUsd ?? 1),
    customer_portal_points_per_khr: String(config.pointsPerKhr ?? 0),
    customer_portal_redeem_points: String(config.redeemPoints ?? 100),
    customer_portal_redeem_value_usd: String(config.redeemValueUsd ?? 1),
    customer_portal_redeem_value_khr: String(config.redeemValueKhr ?? 4100),
    customer_portal_show_point_value: !!config.showPointValue,
    customer_portal_membership_info_text: config.membershipInfoText || '',
    customer_portal_submission_enabled: !!config.submissionEnabled,
    customer_portal_submission_reward_points: String(config.submissionRewardPoints ?? 5),
    customer_portal_submission_instructions: config.submissionInstructions || '',
  }
}

/** Merge editor draft back into display config with clamping and defaults. */
function applyDraft(config: PortalConfig, draft: PortalDraft): PortalConfig {
  const languageSetting = draft.customer_portal_language || config.languageSetting || 'auto'
  const resolvedLanguage = languageSetting === 'auto'
    ? 'en'
    : languageSetting

  return {
    ...config,
    businessName: draft.business_name || config.businessName,
    businessPhone: draft.business_phone || '',
    businessEmail: draft.business_email || '',
    businessAddress: draft.business_address || '',
    addressLink: normalizeExternalUrl(draft.customer_portal_address_link || ''),
    businessTagline: draft.customer_portal_business_tagline || '',
    googleMapsEmbed: normalizeGoogleMapsEmbed(draft.customer_portal_google_maps_embed || config.googleMapsEmbed || ''),
    showGoogleMap: toBoolean(draft.customer_portal_show_google_map, config.showGoogleMap),
    businessLogo: draft.customer_portal_logo_image || '',
    businessFavicon: draft.customer_portal_favicon_image || '',
    logoSize: Math.min(144, Math.max(48, Math.round(toNumber(draft.customer_portal_logo_size, config.logoSize || 80)))),
    logoFit: draft.customer_portal_logo_fit === 'cover' ? 'cover' : 'contain',
    logoZoom: Math.min(180, Math.max(80, Math.round(toNumber(draft.customer_portal_logo_zoom, config.logoZoom || 100)))),
    logoPositionX: Math.min(100, Math.max(0, Math.round(toNumber(draft.customer_portal_logo_position_x, config.logoPositionX || 50)))),
    logoPositionY: Math.min(100, Math.max(0, Math.round(toNumber(draft.customer_portal_logo_position_y, config.logoPositionY || 50)))),
    businessCover: draft.customer_portal_cover_image || '',
    showLogo: toBoolean(draft.customer_portal_show_logo, config.showLogo),
    showCover: toBoolean(draft.customer_portal_show_cover, config.showCover),
    showPhone: toBoolean(draft.customer_portal_show_phone, config.showPhone),
    showEmail: toBoolean(draft.customer_portal_show_email, config.showEmail),
    showAddress: toBoolean(draft.customer_portal_show_address, config.showAddress),
    publicUrl: String(draft.customer_portal_public_url || '').trim(),
    links: {
      website: draft.customer_portal_website || '',
      facebook: draft.customer_portal_facebook || '',
      instagram: draft.customer_portal_instagram || '',
      telegram: draft.customer_portal_telegram || '',
    },
    linkLabels: {
      website: String(draft.customer_portal_website_label || config.linkLabels?.website || 'Website').trim() || 'Website',
      facebook: String(draft.customer_portal_facebook_label || config.linkLabels?.facebook || 'Facebook').trim() || 'Facebook',
      instagram: String(draft.customer_portal_instagram_label || config.linkLabels?.instagram || 'Instagram').trim() || 'Instagram',
      telegram: String(draft.customer_portal_telegram_label || config.linkLabels?.telegram || 'Telegram').trim() || 'Telegram',
    },
    showWebsite: toBoolean(draft.customer_portal_show_website, config.showWebsite),
    showFacebook: toBoolean(draft.customer_portal_show_facebook, config.showFacebook),
    showInstagram: toBoolean(draft.customer_portal_show_instagram, config.showInstagram),
    showTelegram: toBoolean(draft.customer_portal_show_telegram, config.showTelegram),
    title: draft.business_name || draft.customer_portal_title || config.businessName || config.title,
    titleSize: Math.min(64, Math.max(28, Math.round(toNumber(draft.customer_portal_title_size, config.titleSize || 40)))),
    intro: draft.customer_portal_intro || config.intro,
    aiEnabled: toBoolean(draft.customer_portal_ai_enabled, config.aiEnabled),
    aiTitle: String(draft.customer_portal_ai_title || config.aiTitle || 'Beauty Assistant').trim() || 'Beauty Assistant',
    aiIntro: String(draft.customer_portal_ai_intro || config.aiIntro || '').trim(),
    aiDisclaimer: String(draft.customer_portal_ai_disclaimer || config.aiDisclaimer || 'AI generated, for reference only.').trim() || 'AI generated, for reference only.',
    aiProviderId: (() => {
      const id = Number(draft.customer_portal_ai_provider_id || config.aiProviderId || 0) || 0
      return id > 0 ? id : null
    })(),
    aiPrompt: String(draft.customer_portal_ai_prompt || config.aiPrompt || '').trim(),
    showFaq: toBoolean(draft.customer_portal_show_faq, config.showFaq),
    faqTitle: String(draft.customer_portal_faq_title || config.faqTitle || 'Frequently asked questions').trim() || 'Frequently asked questions',
    faqItems: (() => {
      try {
        const parsed = JSON.parse(draft.customer_portal_faq_items || JSON.stringify(config.faqItems || []))
        return normalizeFaqItems(parsed)
      } catch (_) {
        return normalizeFaqItems(config.faqItems)
      }
    })(),
    showAbout: toBoolean(draft.customer_portal_show_about, config.showAbout),
    aboutTitle: String(draft.customer_portal_about_title || config.aboutTitle || 'About us').trim() || 'About us',
    aboutContent: String(draft.customer_portal_about_content || config.aboutContent || '').trim(),
    aboutBlocks: normalizeAboutBlocks(draft.customer_portal_about_blocks || config.aboutBlocks || []),
    translations: normalizePortalTranslations(draft.customer_portal_translations || config.translations || {}),
    heroGradientStart: normalizeHexColor(draft.customer_portal_hero_gradient_start, config.heroGradientStart || '#0f172a'),
    heroGradientMid: normalizeHexColor(draft.customer_portal_hero_gradient_mid, config.heroGradientMid || '#14532d'),
    heroGradientEnd: normalizeHexColor(draft.customer_portal_hero_gradient_end, config.heroGradientEnd || '#ea580c'),
    publicPath: normalizePortalPath(draft.customer_portal_path || config.publicPath || '/customer-portal'),
    language: resolvedLanguage,
    languageSetting,
    translateWidgetEnabled: toBoolean(draft.customer_portal_translate_widget_enabled, config.translateWidgetEnabled),
    showCatalog: toBoolean(draft.customer_portal_show_catalog, config.showCatalog),
    showMembership: toBoolean(draft.customer_portal_show_membership, config.showMembership),
    showPrices: toBoolean(draft.customer_portal_show_prices, config.showPrices),
    showOutOfStockProducts: toBoolean(draft.customer_portal_show_out_of_stock_products, config.showOutOfStockProducts ?? true),
    showProductBrand: toBoolean(draft.customer_portal_show_product_brand, config.showProductBrand ?? true),
    showProductCategory: toBoolean(draft.customer_portal_show_product_category, config.showProductCategory ?? true),
    showProductDescription: toBoolean(draft.customer_portal_show_product_description, config.showProductDescription ?? true),
    showProductDiscount: toBoolean(draft.customer_portal_show_product_discount, config.showProductDiscount ?? true),
    priceDisplay: normalizePriceDisplay(draft.customer_portal_price_display || config.priceDisplay),
    showTopSellerBadge: toBoolean(draft.customer_portal_show_top_seller_badge, config.showTopSellerBadge ?? true),
    showTopProductBadge: toBoolean(draft.customer_portal_show_top_product_badge, config.showTopProductBadge ?? true),
    showRecommendedBadge: toBoolean(draft.customer_portal_show_recommended_badge, config.showRecommendedBadge ?? true),
    showPromotionBadge: toBoolean(draft.customer_portal_show_promotion_badge, config.showPromotionBadge ?? true),
    showNewArrivalBadge: toBoolean(draft.customer_portal_show_new_arrival_badge, config.showNewArrivalBadge ?? false),
    highlightRankLimit: Math.max(1, Math.min(10, Math.round(toNumber(draft.customer_portal_highlight_rank_limit, config.highlightRankLimit || 3)))),
    showPromotions: toBoolean(draft.customer_portal_show_promotions, config.showPromotions ?? true),
    promotionsTitle: String(draft.customer_portal_promotions_title || config.promotionsTitle || 'Featured offers').trim() || 'Featured offers',
    promotionsIntro: String(draft.customer_portal_promotions_intro || config.promotionsIntro || '').trim(),
    promoItems: normalizePromoItems(draft.customer_portal_promo_items || config.promoItems || []),
    recommendedProductIds: normalizeRecommendedProductIds(draft.customer_portal_recommended_product_ids || config.recommendedProductIds || []),
    refreshSeconds: Math.min(120, Math.max(5, Math.round(toNumber(draft.customer_portal_refresh_seconds, config.refreshSeconds)))),
    stockThresholdMode: draft.customer_portal_stock_threshold_mode === 'global' ? 'global' : 'product',
    lowStockThreshold: Math.max(0, toNumber(draft.customer_portal_low_stock_threshold, config.lowStockThreshold)),
    outOfStockThreshold: Math.max(0, toNumber(draft.customer_portal_out_of_stock_threshold, config.outOfStockThreshold)),
    gridColumnsMobile: Math.min(3, Math.max(1, Math.round(toNumber(draft.customer_portal_grid_columns_mobile, config.gridColumnsMobile || 1)))),
    gridColumnsDesktop: Math.min(10, Math.max(2, Math.round(toNumber(draft.customer_portal_grid_columns_desktop, config.gridColumnsDesktop || 4)))),
    pointsBasis: draft.customer_portal_points_basis === 'khr' ? 'khr' : 'usd',
    pointsPerUsd: toNumber(draft.customer_portal_points_per_usd, config.pointsPerUsd),
    pointsPerKhr: toNumber(draft.customer_portal_points_per_khr, config.pointsPerKhr),
    redeemPoints: Math.max(1, Math.floor(toNumber(draft.customer_portal_redeem_points, config.redeemPoints))),
    redeemValueUsd: Math.max(0, Math.round(toNumber(draft.customer_portal_redeem_value_usd, config.redeemValueUsd))),
    redeemValueKhr: (() => {
      const raw = Math.max(0, Math.round(toNumber(draft.customer_portal_redeem_value_khr, config.redeemValueKhr)))
      return raw === 0 ? 0 : Math.max(1000, Math.ceil(raw / 1000) * 1000)
    })(),
    showPointValue: toBoolean(draft.customer_portal_show_point_value, config.showPointValue),
    membershipInfoText: draft.customer_portal_membership_info_text || config.membershipInfoText,
    submissionEnabled: toBoolean(draft.customer_portal_submission_enabled, config.submissionEnabled),
    submissionRewardPoints: Math.max(0, Math.floor(toNumber(draft.customer_portal_submission_reward_points, config.submissionRewardPoints))),
    submissionInstructions: draft.customer_portal_submission_instructions || config.submissionInstructions,
  }
}

/** Resolve the visible quantity using selected branch filter. */
function getBranchQty(product: CatalogProduct, branchId: unknown): number {
  if (!branchId || branchId === 'all') return Number(product.stock_quantity || 0)
  const match = (product.branch_stock || []).find((entry) => String(entry.branch_id) === String(branchId))
  return Number(match?.quantity || 0)
}

/** Compute stock badge state from product quantity and thresholds. */
function getStockStatus(product: CatalogProduct, qty: unknown, config: PortalConfig = {}) {
  const quantity = Number(qty || 0)
  const useGlobal = config.stockThresholdMode === 'global'
  const outThreshold = Number(useGlobal ? config.outOfStockThreshold : product.out_of_stock_threshold || 0)
  const lowThreshold = Number(useGlobal ? config.lowStockThreshold : product.low_stock_threshold || 10)
  if (quantity <= outThreshold) return 'out_of_stock'
  if (quantity <= lowThreshold) return 'low_stock'
  return 'in_stock'
}

/** Build unique product gallery list with a max of 5 images. */
function normalizeProductGallery(product: CatalogProduct | null | undefined): string[] {
  const source = Array.isArray(product?.image_gallery)
    ? product.image_gallery
    : (product?.image_path ? [product.image_path] : [])
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

function normalizePortalProductSearch(value: unknown): string {
  return String(value || '').normalize('NFC').toLocaleLowerCase('km').trim()
}

function buildRecommendedProductOption(product: CatalogProduct) {
  const id = Number(product?.id)
  return {
    id,
    name: String(product?.name || '').trim() || `#${id || ''}`,
    subtitle: [product?.brand, product?.category, product?.barcode].filter(Boolean).join(' - '),
    image: normalizeProductGallery(product)[0] || '',
  }
}

function productMatchesRecommendedSearch(product: CatalogProduct, searchTerm: unknown): boolean {
  const query = normalizePortalProductSearch(searchTerm)
  if (query.length < 2) return false
  const tokens = query.split(/[\s,]+/).filter(Boolean)
  const haystack = normalizePortalProductSearch([
    product?.name,
    product?.brand,
    product?.category,
    product?.barcode,
    product?.sku,
  ].filter(Boolean).join(' '))
  return tokens.every((token) => haystack.includes(token))
}

/** Format date/time strings robustly for public and editor views. */
function formatDateTime(value: unknown): string {
  if (!value) return '-'
  const raw = String(value)
  const date = new Date(raw.includes('T') ? raw : `${raw}Z`)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

/** Render product price text according to selected portal display mode. */
function formatPortalPrice(usd: unknown, khr: unknown, config: PortalConfig): string {
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

/** Reusable image URL/file field with preview, upload, and clear actions. */
function ImageField({
  label,
  value,
  onUpload,
  onChooseExisting,
  onChange,
  onClear,
  onPreview,
  fieldId,
  uploadLabel = 'Upload',
  chooseLabel = 'Files',
  clearLabel = 'Clear',
  previewLabel = 'Preview',
  placeholder = 'https://... or upload below',
  hint = '',
  uploadState = createInitialUploadState(),
  onCancelUpload = null,
  cancelLabel = 'Cancel upload',
  uploadingLabel = 'Uploading...',
  uploadedQueuedLabel = 'Uploaded. Background optimization is running now.',
  uploadedReadyLabel = 'Uploaded and ready.',
}: ImageFieldProps) {
  const rawValue = String(value || '')
  const displayValue = rawValue.startsWith('data:image/') || rawValue.startsWith('blob:')
    ? 'uploaded-image-preview'
    : rawValue
  const isUploading = uploadState?.status === 'uploading'
  return (
    <div className="space-y-2">
      <label htmlFor={fieldId} className="block text-sm font-medium text-slate-700">{label}</label>
      <input id={fieldId} name={fieldId} autoComplete="off" className="input" value={displayValue} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary text-sm" onClick={onUpload} disabled={isUploading}>
          <Upload className="mr-2 inline h-4 w-4" />
          {isUploading ? uploadingLabel : uploadLabel}
        </button>
        {isUploading && onCancelUpload ? <button type="button" className="btn-secondary text-sm" onClick={onCancelUpload}>{cancelLabel}</button> : null}
        {onChooseExisting ? <button type="button" className="btn-secondary text-sm" onClick={onChooseExisting} disabled={isUploading}>{chooseLabel}</button> : null}
        {value ? (
          <button type="button" className="btn-secondary text-sm" onClick={onPreview} disabled={isUploading}>
            <Eye className="mr-2 inline h-4 w-4" />
            {previewLabel}
          </button>
        ) : null}
        {value ? (
          <button type="button" className="btn-secondary text-sm" onClick={onClear} disabled={isUploading}>
            {clearLabel}
          </button>
        ) : null}
      </div>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      {isUploading ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
          <div className="flex items-center justify-between gap-3">
            <span>{uploadState?.fileName || uploadingLabel}</span>
            <span>{Number(uploadState?.progress || 0)}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100">
            <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.max(6, Number(uploadState?.progress || 0))}%` }} />
          </div>
        </div>
      ) : null}
      {uploadState?.processingStatus && uploadState.processingStatus !== 'idle' && uploadState?.status === 'uploaded' ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {uploadState.processingStatus === 'queued' ? uploadedQueuedLabel : uploadedReadyLabel}
        </div>
      ) : null}
      {uploadState?.error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {uploadState.error}
        </div>
      ) : null}
      {value ? (
        <button
          type="button"
          className="block w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900/90"
          onClick={onPreview}
        >
          <div
            className="portal-image-checker flex h-40 items-center justify-center rounded-2xl p-4"
          >
            <img src={value} alt={label} className="max-h-full max-w-full object-contain" loading="lazy" decoding="async" />
          </div>
        </button>
      ) : null}
    </div>
  )
}

function readImageFileAsDataUrl(file: Blob, errorMessage = 'Failed to read image'): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error(errorMessage))
    reader.readAsDataURL(file)
  })
}

async function readImageFilesAsDataUrls(
  files: Iterable<File> | ArrayLike<File> | null | undefined,
  { limit = CATALOG_SUBMISSION_MAX_SCREENSHOTS, errorMessage = 'Failed to read image' } = {},
): Promise<string[]> {
  const selected = Array.from(files || [])
    .filter((file) => file && String(file.type || '').startsWith('image/'))
    .slice(0, Math.max(0, Number(limit) || 0))
  if (!selected.length) return []

  const results: string[] = new Array(selected.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(CATALOG_IMAGE_READ_CONCURRENCY, selected.length) }, async () => {
    while (nextIndex < selected.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await readImageFileAsDataUrl(selected[index], errorMessage)
    }
  })
  await Promise.all(workers)
  return results.filter(Boolean)
}

/** Open picker for one image and return data URL for immediate preview/save. */
async function pickImageAsDataUrl(): Promise<string | null> {
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => resolve(input.files?.[0] || null)
    input.click()
  })
  if (!file) return null
  return readImageFileAsDataUrl(file)
}

/** Open picker for multiple images and return data URLs. */
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

/** Replace localized {token} placeholders with runtime values. */
function replaceVars(template: unknown, values: Record<string, unknown>): string {
  return String(template || '').replace(/\{(\w+)\}/g, (_match: string, key: string) => String(values?.[key] ?? ''))
}

const FIRST_PARTY_TRANSLATE_LANG_OPTIONS = [
  { value: 'original', label: 'Original', kind: 'first_party' },
  ...FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.nativeLabel && option.nativeLabel !== option.label
      ? `${option.label} - ${option.nativeLabel}`
      : option.label,
    kind: 'first_party',
    dir: option.dir,
  })),
]
const FIRST_PARTY_TRANSLATE_BY_LOWER = new Map(
  FIRST_PARTY_TRANSLATE_LANG_OPTIONS.map((option) => [option.value.toLowerCase(), option.value])
)

const GOOGLE_TRANSLATE_FALLBACK_OPTIONS = [
  { value: 'nl', label: 'Dutch' },
  { value: 'sv', label: 'Swedish' },
  { value: 'pl', label: 'Polish' },
  { value: 'cs', label: 'Czech' },
  { value: 'ro', label: 'Romanian' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'el', label: 'Greek' },
  { value: 'bn', label: 'Bengali' },
  { value: 'ta', label: 'Tamil' },
].map((option) => ({ ...option, kind: 'external' }))

const ALL_PUBLIC_TRANSLATE_OPTIONS = [
  ...FIRST_PARTY_TRANSLATE_LANG_OPTIONS,
  ...GOOGLE_TRANSLATE_FALLBACK_OPTIONS,
]

const PORTAL_TRANSLATE_WIDGET_HOST_ID = 'business-os-portal-translate-widget-host'
const PORTAL_TRANSLATE_STORAGE_KEY = 'business-os:portal-translate-target'

function canonicalPortalTranslateLanguage(value: unknown, fallback = 'en'): string {
  const raw = String(value || fallback).trim()
  if (!raw) return fallback
  const lower = raw.toLowerCase()
  if (lower === 'zh-cn') return 'zh-CN'
  if (lower === 'zh-tw') return 'zh-TW'
  return lower
}

function normalizeExternalTranslateTarget(value: unknown, sourceLang: unknown = 'en'): string {
  const from = canonicalPortalTranslateLanguage(sourceLang)
  const target = canonicalPortalTranslateLanguage(value, 'original')
  return !target || target === from ? 'original' : target
}

function isFirstPartyTranslateTarget(value: unknown): boolean {
  const raw = String(value || '').trim()
  if (!raw) return false
  if (FIRST_PARTY_TRANSLATE_BY_LOWER.has(raw.toLowerCase())) return true
  return isFirstPartyPortalLanguage(raw)
}

function normalizePortalTranslateChoice(value: unknown, sourceLang = 'en'): string {
  const raw = String(value || 'original').trim()
  const lower = raw.toLowerCase()
  const firstParty = FIRST_PARTY_TRANSLATE_BY_LOWER.get(lower) || normalizeFirstPartyPortalLanguage(raw)
  if (firstParty) return firstParty
  return normalizeExternalTranslateTarget(raw, sourceLang)
}

function readGoogleTranslateCookieTarget(sourceLang: unknown): string {
  if (typeof document === 'undefined') return ''
  const from = canonicalPortalTranslateLanguage(sourceLang)
  const cookie = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('googtrans='))
  if (!cookie) return ''
  const cookieValue = decodeURIComponent(cookie.slice('googtrans='.length))
  const parts = cookieValue.split('/').filter(Boolean)
  const target = canonicalPortalTranslateLanguage(parts[1] || '', '')
  return target && target !== from ? target : ''
}

function readStoredTranslateTargetLocal(sourceLang: unknown): string {
  const cookieTarget = readGoogleTranslateCookieTarget(sourceLang)
  if (cookieTarget) return cookieTarget
  if (typeof window !== 'undefined') {
    try {
      const rawStored = canonicalPortalTranslateLanguage(window.localStorage?.getItem(PORTAL_TRANSLATE_STORAGE_KEY), 'original')
      if (['original', 'en', 'km'].includes(rawStored)) return rawStored
      return normalizeExternalTranslateTarget(rawStored, sourceLang)
    } catch (_) {}
  }
  return 'original'
}

function removePortalTranslateWidgetHostLocal(): void {
  if (typeof document === 'undefined') return
  Array.from(document.querySelectorAll(`#${PORTAL_TRANSLATE_WIDGET_HOST_ID}`)).forEach((node) => node.remove())
}

function isDocumentVisible() {
  if (typeof document === 'undefined') return true
  return document.visibilityState !== 'hidden'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

const DEFAULT_CONFIG = {
  businessName: '',
  businessPhone: '',
  businessEmail: '',
  businessAddress: '',
  addressLink: '',
  businessTagline: '',
  googleMapsEmbed: '',
  businessLogo: '',
  businessFavicon: '',
  businessCover: '',
  publicUrl: '',
  title: '',
  intro: '',
  aboutTitle: '',
  aboutContent: '',
  aboutBlocks: [],
  faqTitle: '',
  faqItems: [],
  links: {
    website: '',
    facebook: '',
    instagram: '',
    telegram: '',
  },
  linkLabels: {
    website: 'Website',
    facebook: 'Facebook',
    instagram: 'Instagram',
    telegram: 'Telegram',
  },
  translations: {},
  promoItems: [],
  recommendedProductIds: [],
  aiTitle: '',
  aiIntro: '',
  aiDisclaimer: '',
  aiProviderId: '',
  aiPrompt: '',
  publicPath: '/public',
  languageSetting: 'auto',
  logoSize: 80,
  logoFit: 'cover',
  logoZoom: 100,
  logoPositionX: 50,
  logoPositionY: 50,
  titleSize: 40,
  heroGradientStart: '#0f172a',
  heroGradientMid: '#14532d',
  heroGradientEnd: '#ea580c',
  priceDisplay: 'USD',
  highlightRankLimit: 3,
  refreshSeconds: 20,
  stockThresholdMode: 'product',
  lowStockThreshold: 10,
  outOfStockThreshold: 0,
  gridColumnsMobile: 1,
  gridColumnsDesktop: 4,
  pointsBasis: 'usd',
  pointsPerUsd: 1,
  pointsPerKhr: 0,
  redeemPoints: 100,
  redeemValueUsd: 1,
  redeemValueKhr: 4100,
  submissionRewardPoints: 5,
  submissionInstructions: '',
  membershipInfoText: '',
  promotionsTitle: '',
  promotionsIntro: '',
  showLogo: true,
  showCover: true,
  showPhone: true,
  showEmail: true,
  showAddress: true,
  showWebsite: true,
  showFacebook: true,
  showInstagram: true,
  showTelegram: true,
  showGoogleMap: true,
  showCatalog: true,
  showMembership: true,
  showFaq: true,
  showAbout: true,
  showPrices: true,
  showOutOfStockProducts: true,
  showProductBrand: true,
  showProductCategory: true,
  showProductDescription: true,
  showProductDiscount: true,
  showTopSellerBadge: true,
  showTopProductBadge: true,
  showRecommendedBadge: true,
  showPromotionBadge: true,
  showNewArrivalBadge: true,
  showPromotions: true,
  showPointValue: true,
  translateWidgetEnabled: true,
  submissionEnabled: true,
  aiEnabled: true,
}

/** Main portal page component: editor mode (staff) and public mode (customers). */
export default function CatalogPage({ publicView = false }: { publicView?: boolean }) {
  const { hasPermission, navigateTo, saveSettings, notify, theme, toggleTheme, user, t, language: appLanguage } = useApp() as CatalogAppContext
  const { syncChannel } = useSync() as CatalogSyncContext
  const editorPageActive = useIsPageActive('catalog')
  const isPageActive = publicView || editorPageActive
  const cachedPortalRef = useRef(readPortalCache())
  const cachedPortal = cachedPortalRef.current
  const [config, setConfig] = useState<PortalConfig>(() => ({
    ...DEFAULT_CONFIG,
    ...(cachedPortal?.config || {}),
  }))
  const [editorDraft, setEditorDraft] = useState<PortalDraft>(() => buildDraft({
    ...DEFAULT_CONFIG,
    ...(cachedPortal?.config || {}),
  }))
  const [editorDirty, setEditorDirty] = useState(false)
  const [editorSaving, setEditorSaving] = useState(false)
  const [products, setProducts] = useState<CatalogProduct[]>(() => Array.isArray(cachedPortal?.products) ? cachedPortal.products : [])
  const [portalProductTotal, setPortalProductTotal] = useState(() => Number(cachedPortal?.catalog?.total || cachedPortal?.products?.length || 0))
  const [portalProductPage, setPortalProductPage] = useState(() => Number(cachedPortal?.catalog?.page || 1) || 1)
  const [portalProductPageSize, setPortalProductPageSize] = useState(() => Number(cachedPortal?.catalog?.pageSize || 20) || 20)
  const [portalProductInitial, setPortalProductInitial] = useState('all')
  const [portalProductInitials, setPortalProductInitials] = useState<PortalInitialOption[]>(() => normalizePortalInitialOptions(cachedPortal?.catalog?.initials))
  const [portalProductRefreshing, setPortalProductRefreshing] = useState(false)
  const [portalConfigReady, setPortalConfigReady] = useState(() => !!cachedPortal?.config || !publicView)
  const [publicProductsPanelPrimed, setPublicProductsPanelPrimed] = useState(false)
  const [publicSecondaryTabsPrimed, setPublicSecondaryTabsPrimed] = useState(false)
  const [publicChromeVisible, setPublicChromeVisible] = useState(true)
  const [publicScrollButtonsVisible, setPublicScrollButtonsVisible] = useState(false)
  const [publicPortalNavPinned, setPublicPortalNavPinned] = useState(false)
  const [publicPortalNavMetrics, setPublicPortalNavMetrics] = useState({ left: 0, width: 0, height: 0 })
  const [portalLanguagePacksModule, setPortalLanguagePacksModule] = useState<PortalLanguagePacksModule | null>(null)
  const [portalContentI18nModule, setPortalContentI18nModule] = useState<PortalContentI18nModule | null>(null)
  const [categories, setCategories] = useState<CatalogOption[]>(() => normalizeCatalogOptions(cachedPortal?.categories))
  const [brands, setBrands] = useState<string[]>(() => normalizeBrandOptions(cachedPortal?.brands))
  const [branches, setBranches] = useState<CatalogOption[]>(() => normalizeCatalogOptions(cachedPortal?.branches))
  const [activeTab, setActiveTab] = useState(() => resolvePortalActiveTab({
    ...DEFAULT_CONFIG,
    ...(cachedPortal?.config || {}),
  }, null, 'products'))
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string[]>([])
  const [brandFilter, setBrandFilter] = useState<string[]>([])
  const [branchFilter, setBranchFilter] = useState<string[]>([])
  const [stockFilter, setStockFilter] = useState<string[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [membershipNumber, setMembershipNumber] = useState('')
  const [membershipData, setMembershipData] = useState<LegacyCatalogRecord | null>(null)
  const [membershipError, setMembershipError] = useState('')
  const [membershipLoading, setMembershipLoading] = useState(false)
  const [portalError, setPortalError] = useState('')
  const [loading, setLoading] = useState(() => !(cachedPortal?.config || cachedPortal?.products?.length))
  const [submissionDraft, setSubmissionDraft] = useState<SubmissionDraft>({ platform: '', note: '', screenshots: [] })
  const [submissionSaving, setSubmissionSaving] = useState(false)
  const [reviewItems, setReviewItems] = useState<LegacyCatalogRecord[]>([])
  const [reviewSavingId, setReviewSavingId] = useState<string | number | null>(null)
  const [aiProviders, setAiProviders] = useState<LegacyCatalogRecord[]>([])
  const [translateReady, setTranslateReady] = useState(false)
  const [translateTarget, setTranslateTarget] = useState(() => readStoredTranslateTargetLocal('en'))
  const [translateApplyState, setTranslateApplyState] = useState('idle')
  const [translateApplyMessage, setTranslateApplyMessage] = useState('')
  const [productGalleryView, setProductGalleryView] = useState<GalleryViewState>({ open: false, title: '', items: [], index: 0 })
  const [portalImageView, setPortalImageView] = useState<PortalImageViewState>({ open: false, title: '', images: [], index: 0 })
  const [filePicker, setFilePicker] = useState<FilePickerState>({ open: false, target: null, mediaType: 'image', title: 'Choose file' })
  const [activeEditorSection, setActiveEditorSection] = useState('branding')
  const [dragAboutBlockId, setDragAboutBlockId] = useState<string | null>(null)
  const [dragPromoItemId, setDragPromoItemId] = useState<string | null>(null)
  const [mediaUploadStates, setMediaUploadStates] = useState<Record<string, ReturnType<typeof createInitialUploadState>>>({})
  const [assistantQuestion, setAssistantQuestion] = useState('')
  const [assistantProfile, setAssistantProfile] = useState({
    brand: '',
    skinType: '',
    concerns: '',
    shoppingFor: '',
    goal: '',
  })
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [assistantResponse, setAssistantResponse] = useState<LegacyCatalogRecord | null>(null)
  const [assistantError, setAssistantError] = useState('')
  const [assistantExpandedProductId, setAssistantExpandedProductId] = useState<string | number | null>(null)
  const [assistantUsage, setAssistantUsage] = useState<LegacyCatalogRecord | null>(null)
  const [assistantRequestPolicy, setAssistantRequestPolicy] = useState<LegacyCatalogRecord | null>(null)
  const [expandedFaqId, setExpandedFaqId] = useState<string | null>(null)
  const [recommendedProductSearchInput, setRecommendedProductSearchInput] = useState('')
  const [recommendedProductSearchTerm, setRecommendedProductSearchTerm] = useState('')
  const deferredSearch = useDeferredValue(search)
  const loadRequestRef = useRef(0)
  const syncReloadTimerRef = useRef<number | null>(null)
  const previewSectionRef = useRef<HTMLDivElement | null>(null)
  const membershipLookupRequestRef = useRef(0)
  const submissionSavingRef = useRef(false)
  const reviewSavingRef = useRef(false)
  const assistantRequestRef = useRef(0)
  const assistantStatusRequestRef = useRef(0)
  const assistantStatusKeyRef = useRef('')
  const assistantInFlightRef = useRef(false)
  const portalBootstrapRequestRef = useRef(0)
  const portalProductsRequestRef = useRef(0)
  const portalFaviconRequestRef = useRef(0)
  const skipNextBootstrappedProductSearchRef = useRef(false)
  const publicScrollAnchorRef = useRef(0)
  const publicPortalNavRef = useRef<HTMLElement | null>(null)
  const mediaUploadControllersRef = useRef(new Map<string, AbortController>())
  const mediaUploadInFlightTargetsRef = useRef(new Set<string>())
  const mediaUploadPreviewUrlsRef = useRef(new Map<string, string>())
  const mediaUploadOriginalValuesRef = useRef(new Map<string, string>())
  const aliveRef = useRef(true)

  const canEdit = !publicView && hasPermission('settings')
  const previewConfig = useMemo(
    () => (canEdit ? applyDraft(config, editorDraft) : config),
    [canEdit, config, editorDraft]
  )
  useEffect(() => {
    setActiveTab((current) => resolvePortalActiveTab(previewConfig, null, current))
  }, [previewConfig])
  useEffect(() => {
    if (!publicView || !portalConfigReady) return undefined
    const warmPublicProductsPanel = () => {
      void loadCatalogProductsSection()
      setPublicProductsPanelPrimed(true)
    }
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      const productsIdleId = window.requestIdleCallback(() => {
        warmPublicProductsPanel()
      }, { timeout: 400 })
      return () => {
        window.cancelIdleCallback?.(productsIdleId)
      }
    }
    const productsTimerId = window.setTimeout(() => {
      warmPublicProductsPanel()
    }, 120)
    return () => {
      window.clearTimeout(productsTimerId)
    }
  }, [portalConfigReady, publicView])
  const recommendedProductIds = useMemo(
    () => normalizeRecommendedProductIds(
      editorDraft.customer_portal_recommended_product_ids
      || previewConfig.recommendedProductIds
      || []
    ),
    [editorDraft.customer_portal_recommended_product_ids, previewConfig.recommendedProductIds]
  )
  const configuredPortalLanguage = normalizeFirstPartyPortalLanguage(previewConfig.language) || 'en'
  const normalizedTranslateTarget = normalizePortalTranslateChoice(translateTarget, configuredPortalLanguage)
  const externalTranslateTarget = publicView
    && previewConfig.translateWidgetEnabled
    && !isFirstPartyTranslateTarget(normalizedTranslateTarget)
    ? normalizedTranslateTarget
    : null
  const portalCopyLanguage = publicView && previewConfig.translateWidgetEnabled && !externalTranslateTarget
    ? (normalizedTranslateTarget === 'original' ? configuredPortalLanguage : normalizedTranslateTarget)
    : configuredPortalLanguage
  const language = publicView ? portalCopyLanguage : configuredPortalLanguage
  const portalTranslateContentKey = useMemo(() => {
    if (!publicView) return ''
    const firstProduct = products[0]?.id || products[0]?.name || ''
    const lastProduct = products[products.length - 1]?.id || products[products.length - 1]?.name || ''
    return [
      loading ? 'loading' : 'ready',
      language,
      activeTab,
      products.length,
      firstProduct,
      lastProduct,
      previewConfig.businessName,
      previewConfig.title,
      previewConfig.showCatalog,
      previewConfig.showMembership,
      previewConfig.showAbout,
      previewConfig.showFaq,
      previewConfig.aiEnabled,
    ].join('|')
  }, [
    activeTab,
    language,
    loading,
    previewConfig.aiEnabled,
    previewConfig.businessName,
    previewConfig.showAbout,
    previewConfig.showCatalog,
    previewConfig.showFaq,
    previewConfig.showMembership,
    previewConfig.title,
    products,
    publicView,
  ])
  const editorLanguage = normalizeFirstPartyPortalLanguage(appLanguage) || 'en'
  const activeCopyLanguage = publicView ? language : editorLanguage
  const shouldLoadFirstPartyPortalText = activeCopyLanguage !== 'en'
  const shouldLocalizePortalContent = publicView && language !== 'en'
  useEffect(() => {
    if (!shouldLoadFirstPartyPortalText) {
      setPortalLanguagePacksModule(null)
      return undefined
    }
    let cancelled = false
    void loadPortalLanguagePacksModule().then((module) => {
      if (!cancelled) setPortalLanguagePacksModule(module)
    }).catch(() => {
      if (!cancelled) setPortalLanguagePacksModule(null)
    })
    return () => {
      cancelled = true
    }
  }, [shouldLoadFirstPartyPortalText])
  useEffect(() => {
    if (!shouldLocalizePortalContent) {
      setPortalContentI18nModule(null)
      return undefined
    }
    let cancelled = false
    void loadPortalContentI18nModule().then((module) => {
      if (!cancelled) setPortalContentI18nModule(module)
    }).catch(() => {
      if (!cancelled) setPortalContentI18nModule(null)
    })
    return () => {
      cancelled = true
    }
  }, [shouldLocalizePortalContent])
  const copy: CopyFunction = (key, fallback, fallbackKm = fallback) => {
    const safeFallback = fallback || key
    const safeFallbackKm = fallbackKm || safeFallback
    const portalResource = portalLanguagePacksModule?.getPortalLanguageText(activeCopyLanguage, key) || ''
    if (portalResource) return portalResource
    if (publicView) return tt(activeCopyLanguage, key, safeFallback, safeFallbackKm, portalLanguagePacksModule)
    const global = typeof t === 'function' ? t(key) : ''
    if (global && global !== key && !isBrokenLocalizedString(global)) return global
    return tt(activeCopyLanguage, key, safeFallback, safeFallbackKm, portalLanguagePacksModule)
  }
  const displayConfig = useMemo<PortalConfig>(
    () => (
      shouldLocalizePortalContent && portalContentI18nModule
        ? portalContentI18nModule.localizePortalConfig(previewConfig, language)
        : previewConfig
    ) as PortalConfig,
    [language, portalContentI18nModule, previewConfig, shouldLocalizePortalContent]
  )
  const displayProducts = useMemo<CatalogProduct[]>(
    () => (
      shouldLocalizePortalContent && portalContentI18nModule
        ? portalContentI18nModule.localizePortalProducts(products, language, previewConfig.translations)
        : products
    ) as CatalogProduct[],
    [language, portalContentI18nModule, previewConfig.translations, products, shouldLocalizePortalContent]
  )
  const portalBackground = theme === 'dark'
    ? 'radial-gradient(circle at top, #1f2937 0%, #0f172a 38%, #020617 100%)'
    : 'radial-gradient(circle at top, #fef3c7 0%, #fff7ed 35%, #f8fafc 80%)'
  const darkMode = theme === 'dark'
  const resolveVisibleTab = (candidate: string, cfg: PortalConfig = previewConfig): string => {
    const visible = [
      cfg.showCatalog ? 'products' : null,
      cfg.showMembership ? 'membership' : null,
      cfg.showAbout ? 'about' : null,
      cfg.showFaq ? 'faq' : null,
      cfg.aiEnabled ? 'ai' : null,
    ].filter(Boolean) as string[]
    if (!visible.length) return 'products'
    return visible.includes(candidate) ? candidate : visible[0]
  }
  const generatedPublicUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${previewConfig.publicPath || '/customer-portal'}`
    : (previewConfig.publicPath || '/customer-portal')
  const publicPortalUrl = String(previewConfig.publicUrl || '').trim() || generatedPublicUrl
  const logoVersionSeed = [
    previewConfig.businessLogo,
    previewConfig.logoSize,
    previewConfig.logoZoom,
    previewConfig.logoPositionX,
    previewConfig.logoPositionY,
    previewConfig.logoFit,
  ].join('|')
  const faviconVersionSeed = [
    previewConfig.businessFavicon || previewConfig.businessLogo,
    previewConfig.businessFavicon ? 'portal-favicon' : 'logo-fallback',
    previewConfig.logoFit,
    previewConfig.logoZoom,
    previewConfig.logoPositionX,
    previewConfig.logoPositionY,
  ].join('|')
  const coverVersionSeed = [
    previewConfig.businessCover,
    previewConfig.heroGradientStart,
    previewConfig.heroGradientMid,
    previewConfig.heroGradientEnd,
  ].join('|')
  const versionedBusinessLogo = withAssetVersion(previewConfig.businessLogo, logoVersionSeed)
  const versionedBusinessFavicon = withAssetVersion(previewConfig.businessFavicon || previewConfig.businessLogo, faviconVersionSeed)
  const versionedBusinessCover = withAssetVersion(previewConfig.businessCover, coverVersionSeed)
  const aboutBlocks = useMemo(
    () => normalizeAboutBlocks(editorDraft.customer_portal_about_blocks || previewConfig.aboutBlocks || [], { keepEmpty: true }),
    [editorDraft.customer_portal_about_blocks, previewConfig.aboutBlocks]
  )
  const promoItems = useMemo(
    () => normalizePromoItems(editorDraft.customer_portal_promo_items || previewConfig.promoItems || [], { keepEmpty: true }),
    [editorDraft.customer_portal_promo_items, previewConfig.promoItems]
  )
  const getMediaUploadState = (key: string): UploadState => mediaUploadStates[key] || createInitialUploadState()
  const updateMediaUploadState = (key: string, action: UploadAction) => {
    setMediaUploadStates((current) => reduceUploadState(current, { ...(action || {}), key }))
  }
  const hasActiveMediaUpload = useMemo(
    () => Object.values(mediaUploadStates).some((state) => state?.status === 'uploading'),
    [mediaUploadStates],
  )
  const forgetMediaUploadState = (key: string) => {
    setMediaUploadStates((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, key)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }
  const faqItems = useMemo(() => {
    const raw = editorDraft.customer_portal_faq_items || JSON.stringify(previewConfig.faqItems || [])
    try {
      const parsed = JSON.parse(raw)
      return normalizeFaqItems(parsed)
    } catch (_) {
      return normalizeFaqItems(previewConfig.faqItems)
    }
  }, [editorDraft.customer_portal_faq_items, previewConfig.faqItems])
  const assistantCategoryOptions = useMemo(() => {
    const names = categories.map((entry) => String(entry?.name || '').trim()).filter(Boolean)
    return Array.from(new Set([
      ...names,
      'Skincare',
      'Cosmetics',
      'Perfume',
      'Body care',
      'Hair care',
      'Cleanser',
      'Sunscreen',
    ])).sort((left, right) => left.localeCompare(right))
  }, [categories])

  useEffect(() => {
    setActiveTab((current) => resolveVisibleTab(current, previewConfig))
  }, [previewConfig.showCatalog, previewConfig.showMembership, previewConfig.showAbout, previewConfig.showFaq, previewConfig.aiEnabled])

  useEffect(() => {
    if (!publicView || !previewConfig.aiEnabled) {
      invalidateTrackedRequest(assistantRequestRef)
      invalidateTrackedRequest(assistantStatusRequestRef)
      assistantStatusKeyRef.current = ''
      assistantInFlightRef.current = false
      setAssistantLoading(false)
      setAssistantUsage(null)
      setAssistantRequestPolicy(null)
      return
    }
    if (activeTab !== 'ai') return undefined

    const statusKey = String(previewConfig.aiProviderId || 'default')
    if (assistantStatusKeyRef.current === statusKey) return undefined
    assistantStatusKeyRef.current = statusKey
    const requestId = beginTrackedRequest(assistantStatusRequestRef)
    async function loadAssistantStatus() {
      try {
        const result = await withLoaderTimeout(
          () => getCatalogApi().getPortalAiStatus(),
          'Portal AI status',
          CATALOG_PORTAL_AI_STATUS_TIMEOUT_MS,
        )
        if (!aliveRef.current || !isTrackedRequestCurrent(assistantStatusRequestRef, requestId)) return
        setAssistantUsage(result?.usage || null)
        setAssistantRequestPolicy(result?.requestPolicy || null)
      } catch {
        if (!aliveRef.current || !isTrackedRequestCurrent(assistantStatusRequestRef, requestId)) return
        assistantStatusKeyRef.current = ''
      }
    }
    loadAssistantStatus()

    return () => {
      invalidateTrackedRequest(assistantStatusRequestRef)
    }
  }, [activeTab, publicView, previewConfig.aiEnabled, previewConfig.aiProviderId])

  /** Open modal gallery for selected product image list. */
  function openProductGallery(product: CatalogProduct, startIndex = 0) {
    const items = normalizeProductGallery(product)
    if (!items.length) return
    const safeStart = Math.max(0, Math.min(startIndex, items.length - 1))
    setProductGalleryView({
      open: true,
      title: product?.name || copy('products', 'Products'),
      items,
      index: safeStart,
    })
  }

  /** Apply selected language. Business OS handles English/Khmer instantly; Google is only the external fallback. */
  async function changeTranslateTarget(nextTarget: string) {
    const target = normalizePortalTranslateChoice(nextTarget, configuredPortalLanguage)
    setTranslateTarget(target)
    setTranslateApplyMessage('')
    if (!publicView || !previewConfig.translateWidgetEnabled) return
    if (typeof window === 'undefined') return

    if (isFirstPartyTranslateTarget(target)) {
      const {
        clearGoogleTranslateCookies,
        hasPortalTranslatedMarker,
        requestPortalTranslateReload,
        storePortalTranslatePreference,
      } = await loadPortalTranslateControllerModule()
      clearGoogleTranslateCookies()
      storePortalTranslatePreference(target)
      removePortalTranslateWidgetHostLocal()
      setTranslateReady(true)
      setTranslateApplyState('pending')
      setTranslateApplyMessage(copy('translationApplied', 'Translation applied'))
      if (hasPortalTranslatedMarker() && requestPortalTranslateReload('first-party-switch', 5000)) return
      window.requestAnimationFrame(() => {
        if (!aliveRef.current) return
        setTranslateApplyState(target === 'original' ? 'idle' : 'applied')
        setTranslateApplyMessage(target === 'original'
          ? copy('translationOriginalApplied', 'Original language restored')
          : copy('translationApplied', 'Translation applied'))
      })
      return
    }

    const {
      applyGoogleTranslateSelection,
      isPortalTranslateApplied,
      requestPortalTranslateReload,
      writePortalTranslateTarget,
    } = await loadPortalTranslateControllerModule()
    writePortalTranslateTarget(configuredPortalLanguage, target)
    setTranslateApplyState('pending')
    setTranslateApplyMessage(copy('externalTranslationPreparing', 'Preparing external translation...'))

    const sourceReadyAtStart = translateReady
    const maxAttempts = sourceReadyAtStart ? 26 : 36
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const attempted = applyGoogleTranslateSelection(configuredPortalLanguage, target)
      if (attempted && isPortalTranslateApplied(configuredPortalLanguage, target)) {
        setTranslateApplyState('applied')
        setTranslateApplyMessage(copy('externalTranslationApplied', 'External translation applied'))
        return
      }
      await sleep(sourceReadyAtStart ? 180 : 220)
    }

    if (requestPortalTranslateReload('external-translate-stuck', 5000)) {
      return
    }
    setTranslateApplyState('failed')
    setTranslateApplyMessage(copy('translationFailed', 'Translation could not apply. Try again.'))
  }

  function isPortalLoadCurrent(requestId: number) {
    return aliveRef.current && Number(loadRequestRef.current) === Number(requestId)
  }

  async function loadPortalEditorData(
    requestId: number,
    nextConfig: PortalConfig,
    nextMeta: LegacyCatalogRecord,
    nextProducts: CatalogProduct[],
  ) {
    const [providersResult, reviewResult] = await Promise.allSettled([
      withLoaderTimeout(
        () => getCatalogApi().getAiProviders(),
        'Portal AI providers',
        CATALOG_PORTAL_EDITOR_HELPERS_TIMEOUT_MS,
      ),
      withLoaderTimeout(
        () => getCatalogApi().getPortalSubmissionsForReview(),
        'Portal review items',
        CATALOG_PORTAL_EDITOR_HELPERS_TIMEOUT_MS,
      ),
    ])
    if (!isPortalLoadCurrent(requestId)) return

    if (providersResult.status === 'fulfilled') {
      setAiProviders(Array.isArray(providersResult.value?.items) ? providersResult.value.items : [])
    }

    if (reviewResult.status === 'fulfilled') {
      const normalizedReviewItems = Array.isArray(reviewResult.value)
        ? reviewResult.value.map((item) => (
            item?.status === 'pending' && !Number(item?.reward_points)
              ? { ...item, reward_points: nextConfig.submissionRewardPoints }
              : item
          ))
        : []
      setReviewItems(normalizedReviewItems)
      writePortalCache({
        config: nextConfig,
        ...nextMeta,
        products: nextProducts,
        reviewItems: normalizedReviewItems,
      })
    }
  }

  async function refreshPortalView({ showSpinner = true, reportError = true } = {}) {
    if (!isPageActive) return
    const requestId = beginTrackedRequest(portalBootstrapRequestRef)
    try {
      const hasCachedData = !!(
        products.length
        || categories.length
        || brands.length
        || branches.length
        || cachedPortal
      )
      if (showSpinner && !hasCachedData && aliveRef.current && isTrackedRequestCurrent(portalBootstrapRequestRef, requestId)) {
        setLoading(true)
      }
      if (aliveRef.current && isTrackedRequestCurrent(portalBootstrapRequestRef, requestId) && reportError) {
        setPortalError('')
      }
      await withLoaderTimeout(() => loadPortal(), 'Customer portal', CATALOG_PORTAL_BOOTSTRAP_TIMEOUT_MS)
    } catch (error) {
      if (!aliveRef.current || !isTrackedRequestCurrent(portalBootstrapRequestRef, requestId) || !reportError) return
      setPortalError(getCatalogErrorMessage(error, 'Failed to load customer portal'))
    } finally {
      if (aliveRef.current && isTrackedRequestCurrent(portalBootstrapRequestRef, requestId)) {
        setLoading(false)
      }
    }
  }

  /** Fetch all portal data needed by current mode (public/editor). */
  async function loadPortal() {
    if (!isPageActive) return
    const requestId = beginTrackedRequest(loadRequestRef)
    if (publicView) {
      const bootstrapResult = await withLoaderTimeout(
        () => getCatalogApi().getPortalBootstrap(),
        'Portal bootstrap',
        CATALOG_PORTAL_BOOTSTRAP_TIMEOUT_MS,
      )
      if (!isPortalLoadCurrent(requestId) || !isTrackedRequestCurrent(loadRequestRef, requestId)) return

      const portalConfig = bootstrapResult?.config || null
      const meta = bootstrapResult?.meta || null
      const catalogPage = bootstrapResult?.catalog || null
      const portalProducts = catalogPage?.items || bootstrapResult?.products || null
      if (!portalConfig && !meta && !portalProducts) throw new Error('Failed to load customer portal')

      const nextConfig = { ...DEFAULT_CONFIG, ...(portalConfig || {}) }
      const nextMeta = {
        categories: normalizeCatalogOptions(meta?.categories),
        brands: normalizeBrandOptions(meta?.brands),
        branches: normalizeCatalogOptions(meta?.branches),
      }
      const nextProducts = Array.isArray(portalProducts) ? portalProducts : []

      skipNextBootstrappedProductSearchRef.current = true
      setConfig(nextConfig)
      setPortalConfigReady(true)
      if (!editorDirty) setEditorDraft(buildDraft(nextConfig))
      setCategories(nextMeta.categories)
      setBrands(nextMeta.brands)
      setBranches(nextMeta.branches)
      setProducts(nextProducts)
      if (catalogPage && typeof catalogPage === 'object') {
        setPortalProductTotal(Number(catalogPage.total || nextProducts.length || 0))
        setPortalProductPage(Number(catalogPage.page || 1) || 1)
        setPortalProductPageSize(Number(catalogPage.pageSize || 20) || 20)
        setPortalProductInitials(normalizePortalInitialOptions(catalogPage.initials))
      }
      setActiveTab((current) => resolveVisibleTab(current, nextConfig))
      writePortalCache({
        config: nextConfig,
        ...nextMeta,
        products: nextProducts,
        catalog: catalogPage || null,
        reviewItems: [],
      })

      return
    }

    const bootstrapResult = await withLoaderTimeout(
      () => getCatalogApi().getPortalBootstrap(),
      'Portal bootstrap',
      CATALOG_PORTAL_BOOTSTRAP_TIMEOUT_MS,
    )
    if (!isPortalLoadCurrent(requestId) || !isTrackedRequestCurrent(loadRequestRef, requestId)) return

    const portalConfig = bootstrapResult?.config || null
    const meta = bootstrapResult?.meta || null
    const catalogPage = bootstrapResult?.catalog || null
    const portalProducts = catalogPage?.items || bootstrapResult?.products || null
    if (!portalConfig && !meta && !portalProducts) throw new Error('Failed to load customer portal')

    const nextConfig = { ...DEFAULT_CONFIG, ...(portalConfig || {}) }
    const nextMeta = {
      categories: normalizeCatalogOptions(meta?.categories),
      brands: normalizeBrandOptions(meta?.brands),
      branches: normalizeCatalogOptions(meta?.branches),
    }
    const nextProducts = Array.isArray(portalProducts) ? portalProducts : []

    setConfig(nextConfig)
    setPortalConfigReady(true)
    if (!editorDirty) setEditorDraft(buildDraft(nextConfig))
    setCategories(nextMeta.categories)
    setBrands(nextMeta.brands)
    setBranches(nextMeta.branches)
    setProducts(nextProducts)
    if (catalogPage && typeof catalogPage === 'object') {
      setPortalProductTotal(Number(catalogPage.total || nextProducts.length || 0))
      setPortalProductPage(Number(catalogPage.page || 1) || 1)
      setPortalProductPageSize(Number(catalogPage.pageSize || 20) || 20)
      setPortalProductInitials(normalizePortalInitialOptions(catalogPage.initials))
    }
    setActiveTab((current) => resolveVisibleTab(current, nextConfig))

    writePortalCache({
      config: nextConfig,
      ...nextMeta,
      products: nextProducts,
      catalog: catalogPage || null,
      reviewItems: canEdit ? reviewItems : [],
    })

    if (!canEdit) return
    void loadPortalEditorData(requestId, nextConfig, nextMeta, nextProducts)
  }

  useEffect(() => {
    aliveRef.current = true
    if (!isPageActive) {
      invalidateTrackedRequest(portalBootstrapRequestRef)
      invalidateTrackedRequest(portalProductsRequestRef)
      invalidateTrackedRequest(loadRequestRef)
      if (syncReloadTimerRef.current) {
        window.clearTimeout(syncReloadTimerRef.current)
        syncReloadTimerRef.current = null
      }
      setLoading(false)
      return () => {
        invalidateTrackedRequest(portalBootstrapRequestRef)
        invalidateTrackedRequest(portalProductsRequestRef)
        invalidateTrackedRequest(loadRequestRef)
      }
    }
    refreshPortalView()

    if (!publicView) {
      return () => {
        invalidateTrackedRequest(portalBootstrapRequestRef)
        invalidateTrackedRequest(portalProductsRequestRef)
        invalidateTrackedRequest(loadRequestRef)
      }
    }

    const timer = window.setInterval(() => {
      if (!isDocumentVisible()) return
      refreshPortalView({ showSpinner: false }).catch(() => {})
    }, Math.max(5, Number(previewConfig.refreshSeconds || 20)) * 1000)

    return () => {
      invalidateTrackedRequest(portalBootstrapRequestRef)
      invalidateTrackedRequest(portalProductsRequestRef)
      invalidateTrackedRequest(loadRequestRef)
      window.clearInterval(timer)
    }
  }, [isPageActive, publicView, previewConfig.refreshSeconds])

  useEffect(() => {
    setPortalProductPage(1)
  }, [brandFilter, branchFilter, categoryFilter, deferredSearch, portalProductInitial, stockFilter])

  useEffect(() => {
    if (!isPageActive || !previewConfig.showCatalog || (publicView && !portalConfigReady)) return undefined
    if (publicView && skipNextBootstrappedProductSearchRef.current) {
      skipNextBootstrappedProductSearchRef.current = false
      return undefined
    }
    const requestId = beginTrackedRequest(portalProductsRequestRef)
    setPortalProductRefreshing(products.length > 0)

    const params = {
      page: portalProductPage,
      pageSize: portalProductPageSize,
      query: deferredSearch,
      brand: brandFilter.join(','),
      category: categoryFilter.join(','),
      branchId: branchFilter.join(','),
      stockState: stockFilter.join(','),
      initial: portalProductInitial,
    }

    withLoaderTimeout(
      () => getCatalogApi().searchPortalCatalogProducts(params),
      'Portal product search',
      CATALOG_PORTAL_PRODUCT_SEARCH_TIMEOUT_MS,
    )
      .then((result) => {
        if (!aliveRef.current || !isTrackedRequestCurrent(portalProductsRequestRef, requestId)) return
        const nextItems = Array.isArray(result?.items) ? result.items as CatalogProduct[] : []
        setPortalError('')
        setProducts(nextItems)
        setPortalProductTotal(Number(result?.total || 0))
        setPortalProductPage(Number(result?.page || portalProductPage) || 1)
        setPortalProductPageSize(Number(result?.pageSize || portalProductPageSize) || portalProductPageSize)
        setPortalProductInitials(normalizePortalInitialOptions(result?.initials))
        const nextBrands = Array.isArray(result?.filters?.brands) ? normalizeBrandOptions(result.filters.brands) : brands
        const nextCategories = Array.isArray(result?.filters?.categories)
          ? result.filters.categories.map((name: string, index: number) => ({ id: `server-${index}-${name}`, name }))
          : categories
        if (Array.isArray(result?.filters?.brands)) setBrands(nextBrands)
        if (Array.isArray(result?.filters?.categories)) {
          setCategories(nextCategories)
        }
        writePortalCache({
          config: previewConfig,
          categories: nextCategories,
          brands: nextBrands,
          branches,
          products: nextItems,
          catalog: {
            page: Number(result?.page || portalProductPage) || 1,
            pageSize: Number(result?.pageSize || portalProductPageSize) || portalProductPageSize,
            total: Number(result?.total || 0),
            initials: normalizePortalInitialOptions(result?.initials).length ? normalizePortalInitialOptions(result?.initials) : portalProductInitials,
          },
          reviewItems: [],
        })
      })
      .catch((error) => {
        if (!aliveRef.current || !isTrackedRequestCurrent(portalProductsRequestRef, requestId)) return
        setPortalError(getCatalogErrorMessage(error, 'Portal product search failed'))
      })
      .finally(() => {
        if (!aliveRef.current || !isTrackedRequestCurrent(portalProductsRequestRef, requestId)) return
        setPortalProductRefreshing(false)
      })

    return () => {
      invalidateTrackedRequest(portalProductsRequestRef)
    }
  }, [
    brandFilter,
    branchFilter,
    categoryFilter,
    deferredSearch,
    isPageActive,
    portalProductInitial,
    portalProductPage,
    portalProductPageSize,
    previewConfig.showCatalog,
    portalConfigReady,
    stockFilter,
  ])

  useEffect(() => () => {
    aliveRef.current = false
    invalidateTrackedRequest(portalBootstrapRequestRef)
    invalidateTrackedRequest(portalProductsRequestRef)
    invalidateTrackedRequest(portalFaviconRequestRef)
    invalidateTrackedRequest(loadRequestRef)
    invalidateTrackedRequest(membershipLookupRequestRef)
    invalidateTrackedRequest(assistantRequestRef)
    invalidateTrackedRequest(assistantStatusRequestRef)
    mediaUploadControllersRef.current.forEach((controller) => controller?.abort?.())
    mediaUploadControllersRef.current.clear()
    mediaUploadPreviewUrlsRef.current.forEach((previewUrl) => {
      if (previewUrl && String(previewUrl).startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    })
    mediaUploadPreviewUrlsRef.current.clear()
    mediaUploadOriginalValuesRef.current.clear()
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    if (publicView) {
      document.body.setAttribute('data-public-portal', 'true')
      document.documentElement.setAttribute('data-public-portal', 'true')
    } else {
      document.body.removeAttribute('data-public-portal')
      document.documentElement.removeAttribute('data-public-portal')
    }
    return () => {
      document.body.removeAttribute('data-public-portal')
      document.documentElement.removeAttribute('data-public-portal')
    }
  }, [publicView])

  useEffect(() => {
    if (!publicView || typeof document === 'undefined') return undefined
    const previousTitle = document.title
    const titleText = String(previewConfig.businessName || previewConfig.title || 'Customer Portal').trim()
    document.title = titleText || 'Customer Portal'

    const ensureLink = (rel: string) => {
      let linkEl = document.querySelector(`link[rel="${rel}"]`)
      let created = false
      const previousHref = linkEl?.getAttribute('href') || ''
      if (!linkEl) {
        linkEl = document.createElement('link')
        linkEl.setAttribute('rel', rel)
        document.head.appendChild(linkEl)
        created = true
      }
      return { linkEl, created, previousHref, rel }
    }

    const iconLinks = [
      ensureLink('icon'),
      ensureLink('shortcut icon'),
      ensureLink('apple-touch-icon'),
    ]

    const iconSource = versionedBusinessFavicon || versionedBusinessLogo || ''
    const faviconOptions = previewConfig.businessFavicon
      ? { fit: 'cover' as const, zoom: 100, positionX: 50, positionY: 50 }
      : {
          fit: 'cover' as const,
          zoom: toNumber(previewConfig.logoZoom, 100),
          positionX: toNumber(previewConfig.logoPositionX, 50),
          positionY: toNumber(previewConfig.logoPositionY, 50),
        }
    let faviconIdleId: number | null = null
    let faviconTimerId: number | null = null
    if (iconSource) {
      const requestId = beginTrackedRequest(portalFaviconRequestRef)
      iconLinks.forEach(({ linkEl, rel }) => {
        if (!linkEl) return
        linkEl.setAttribute('href', iconSource)
        if (rel === 'icon' || rel === 'shortcut icon') {
          linkEl.setAttribute('type', 'image/png')
        }
      })

      const renderRoundedFavicon = () => {
        withLoaderTimeout(
          () => import('../../utils/favicon.ts').then(({ createCircularFaviconDataUrl }) => (
            createCircularFaviconDataUrl(iconSource, faviconOptions)
          )),
          'Portal favicon',
          CATALOG_PORTAL_FAVICON_TIMEOUT_MS,
        )
          .then((faviconHref) => {
            if (!aliveRef.current || !isTrackedRequestCurrent(portalFaviconRequestRef, requestId)) return
            const resolvedHref = faviconHref || iconSource
            iconLinks.forEach(({ linkEl, rel }) => {
              if (!linkEl) return
              linkEl.setAttribute('href', resolvedHref)
              if (rel === 'icon' || rel === 'shortcut icon') {
                linkEl.setAttribute('type', 'image/png')
              }
            })
          })
          .catch(() => {
            if (!aliveRef.current || !isTrackedRequestCurrent(portalFaviconRequestRef, requestId)) return
            iconLinks.forEach(({ linkEl, rel }) => {
              if (!linkEl) return
              linkEl.setAttribute('href', iconSource)
              if (rel === 'icon' || rel === 'shortcut icon') {
                linkEl.setAttribute('type', 'image/png')
              }
            })
          })
      }

      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        faviconIdleId = window.requestIdleCallback(renderRoundedFavicon, { timeout: 1800 })
      } else if (typeof window !== 'undefined') {
        faviconTimerId = window.setTimeout(renderRoundedFavicon, 900)
      } else {
        renderRoundedFavicon()
      }
    } else {
      invalidateTrackedRequest(portalFaviconRequestRef)
    }

    return () => {
      if (faviconIdleId != null) window.cancelIdleCallback?.(faviconIdleId)
      if (faviconTimerId != null) window.clearTimeout(faviconTimerId)
      invalidateTrackedRequest(portalFaviconRequestRef)
      document.title = previousTitle
      iconLinks.forEach(({ linkEl, created, previousHref }) => {
        if (!linkEl) return
        if (created) {
          linkEl.remove()
        } else if (previousHref) {
          linkEl.setAttribute('href', previousHref)
        } else {
          linkEl.removeAttribute('href')
        }
      })
    }
  }, [
    publicView,
    previewConfig.businessFavicon,
    previewConfig.businessLogo,
    previewConfig.businessName,
    previewConfig.logoFit,
    previewConfig.logoPositionX,
    previewConfig.logoPositionY,
    previewConfig.logoZoom,
    previewConfig.title,
    versionedBusinessLogo,
    versionedBusinessFavicon,
  ])

  useEffect(() => {
    if (!publicView || typeof window === 'undefined') return undefined
    let frameRequested = false
    const topOffset = window.innerWidth >= 640 ? 8 : 0

    const updateVisibility = () => {
      frameRequested = false
      const scrollTop = Math.max(window.scrollY || 0, document.documentElement?.scrollTop || 0, document.body?.scrollTop || 0)
      const delta = scrollTop - publicScrollAnchorRef.current
      setPublicScrollButtonsVisible(scrollTop > 220)
      if (scrollTop <= 24) {
        setPublicChromeVisible(true)
      } else if (Math.abs(delta) >= 12) {
        setPublicChromeVisible(delta < 0)
      }
      if (publicPortalNavRef.current) {
        const rect = publicPortalNavRef.current.getBoundingClientRect()
        const shouldPin = rect.top <= topOffset
        setPublicPortalNavPinned((current) => (current === shouldPin ? current : shouldPin))
        setPublicPortalNavMetrics((current) => {
          const next = {
            left: Math.max(0, rect.left),
            width: Math.max(0, rect.width),
            height: Math.max(0, rect.height),
          }
          return (
            current.left === next.left
            && current.width === next.width
            && current.height === next.height
          ) ? current : next
        })
      }
      publicScrollAnchorRef.current = scrollTop
    }

    const handleScroll = () => {
      if (frameRequested) return
      frameRequested = true
      window.requestAnimationFrame(updateVisibility)
    }

    updateVisibility()
    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleScroll)
    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
    }
  }, [publicView])

  useEffect(() => {
    setTranslateReady(!externalTranslateTarget)
    return undefined
  }, [externalTranslateTarget, publicView, previewConfig.translateWidgetEnabled])

  useEffect(() => {
    if (!publicView || !previewConfig.translateWidgetEnabled) return
    setTranslateTarget(readStoredTranslateTargetLocal(configuredPortalLanguage))
  }, [configuredPortalLanguage, previewConfig.translateWidgetEnabled, publicView])

  useEffect(() => {
    if (!publicView || !previewConfig.translateWidgetEnabled || externalTranslateTarget) return undefined
    removePortalTranslateWidgetHostLocal()
    setTranslateReady(true)
    setTranslateApplyState(normalizedTranslateTarget === 'original' ? 'idle' : 'applied')
    setTranslateApplyMessage(normalizedTranslateTarget === 'original'
      ? ''
      : copy('translationApplied', 'Translation applied'))
    return undefined
  }, [externalTranslateTarget, normalizedTranslateTarget, previewConfig.translateWidgetEnabled, publicView])

  useEffect(() => {
    if (!publicView || !previewConfig.translateWidgetEnabled || !externalTranslateTarget || typeof window === 'undefined' || typeof document === 'undefined') {
      removePortalTranslateWidgetHostLocal()
      return undefined
    }
    let cancelled = false
    let container: Element | HTMLDivElement | null = null
    const initWidget = () => {
      if (cancelled || !window.google?.translate?.TranslateElement) return
      try {
        setTranslateReady(false)
        const widgetContainer = container
        if (!widgetContainer) return
        widgetContainer.innerHTML = ''
        window.google.translate.TranslateElement(
          {
            pageLanguage: configuredPortalLanguage === 'km' ? 'km' : 'en',
            includedLanguages: GOOGLE_TRANSLATE_FALLBACK_OPTIONS
              .map((option) => option.value)
              .filter((value) => value !== 'original')
              .join(','),
            autoDisplay: false,
            layout: window.google.translate.TranslateElement.InlineLayout?.SIMPLE,
          },
          widgetContainer.id,
        )
        let widgetChecks = 0
        const waitForWidget = () => {
          if (cancelled) return
          const combo = widgetContainer.querySelector('.goog-te-combo')
          if (combo) {
            setTranslateReady(true)
            setTranslateApplyMessage('')
            return
          }
          widgetChecks += 1
          if (widgetChecks >= 80) {
            setTranslateReady(false)
            setTranslateApplyState('failed')
            setTranslateApplyMessage(copy('translationFailed', 'Translation could not apply. Try again.'))
            return
          }
          window.setTimeout(waitForWidget, 120)
        }
        waitForWidget()
      } catch (_) {}
    }

    async function setupExternalTranslateWidget() {
      const {
        ensurePortalTranslateScript,
        ensurePortalTranslateWidgetHost,
      } = await loadPortalTranslateControllerModule()
      if (cancelled) return
      container = ensurePortalTranslateWidgetHost()
      if (!container) return

      window.businessOsPortalTranslateInit = initWidget

      if (window.google?.translate?.TranslateElement) {
        initWidget()
        return
      }

      ensurePortalTranslateScript('businessOsPortalTranslateInit', () => {
        if (!cancelled) {
          setTranslateReady(false)
          setTranslateApplyState('failed')
          setTranslateApplyMessage(copy('translationFailed', 'Translation could not apply. Try again.'))
        }
      })
    }
    void setupExternalTranslateWidget()

    return () => {
      cancelled = true
    }
  }, [configuredPortalLanguage, externalTranslateTarget, previewConfig.translateWidgetEnabled, publicView])

  useEffect(() => {
    if (!isPageActive || !syncChannel) return undefined
    if (!['products', 'settings', 'customers', 'sales', 'returns', 'branches', 'categories'].includes(String(syncChannel.channel || ''))) {
      return undefined
    }

    if (syncReloadTimerRef.current) window.clearTimeout(syncReloadTimerRef.current)
    syncReloadTimerRef.current = window.setTimeout(() => {
      refreshPortalView({ showSpinner: false }).catch(() => {})
    }, 180)

    return () => {
      if (syncReloadTimerRef.current) {
        window.clearTimeout(syncReloadTimerRef.current)
        syncReloadTimerRef.current = null
      }
    }
  }, [isPageActive, syncChannel])

  useEffect(() => {
    if (!publicView || !previewConfig.translateWidgetEnabled || !externalTranslateTarget || !translateReady) return undefined
    let cancelled = false
    const settleTimer = window.setTimeout(async () => {
      const {
        applyGoogleTranslateSelection,
        isPortalTranslateApplied,
        requestPortalTranslateReload,
      } = await loadPortalTranslateControllerModule()
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
  }, [
    configuredPortalLanguage,
    externalTranslateTarget,
    loading,
    normalizedTranslateTarget,
    portalTranslateContentKey,
    previewConfig.translateWidgetEnabled,
    publicView,
    translateReady,
  ])

  const filteredProducts = useMemo(() => {
    const terms = deferredSearch.toLowerCase().split(/[\s,]+/).map((term) => term.trim()).filter(Boolean)

    return displayProducts.filter((product) => {
      const haystack = [
        product.name,
        product.category,
        product.brand,
        product.description,
      ].join(' ').toLowerCase()

      if (terms.length > 0 && !terms.every((term) => haystack.includes(term))) return false
      if (categoryFilter.length && !categoryFilter.includes(product.category || '')) return false
      if (brandFilter.length && !brandFilter.includes(product.brand || '')) return false

      if (!productMatchesPortalBranches(product, branchFilter)) return false

      const statusBranch = branchFilter.length === 1 ? branchFilter[0] : 'all'
      const qty = getBranchQty(product, statusBranch)
      const status = getStockStatus(product, qty, displayConfig)
      if (stockFilter.length && !stockFilter.includes(status)) return false
      if (!displayConfig.showOutOfStockProducts && status === 'out_of_stock') return false

      return true
    })
  }, [displayProducts, deferredSearch, categoryFilter, brandFilter, branchFilter, stockFilter, displayConfig])

  function toggleFilterValue(values: string[], setter: Dispatch<SetStateAction<string[]>>, value: string) {
    setter((current) => (
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    ))
  }

  function clearPortalFilters() {
    setCategoryFilter([])
    setBrandFilter([])
    setBranchFilter([])
    setStockFilter([])
    setPortalProductInitial('all')
  }

  function setDraft(key: string, value: unknown) {
    setEditorDirty(true)
    setEditorDraft((current) => ({ ...current, [key]: value }))
  }

  function toggleRecommendedProduct(productId: unknown) {
    const id = Number(productId)
    if (!Number.isFinite(id) || id <= 0) return
    const nextIds = recommendedProductIds.includes(id)
      ? recommendedProductIds.filter((entry) => entry !== id)
      : [...recommendedProductIds, id]
    setDraft('customer_portal_recommended_product_ids', JSON.stringify(nextIds))
  }

  function openPortalImage(title: string, images: string[], index = 0) {
    const safeImages = Array.isArray(images) ? images.filter(Boolean) : []
    if (!safeImages.length) return
    setPortalImageView({
      open: true,
      title: title || copy('openGallery', 'Open image gallery'),
      images: safeImages,
      index: Math.max(0, Math.min(index, safeImages.length - 1)),
    })
  }

  function setAboutBlocksDraft(nextBlocks: PortalMediaBlock[]) {
    setDraft('customer_portal_about_blocks', serializeAboutBlocks(nextBlocks))
  }

  function setPromoItemsDraft(nextItems: PortalMediaBlock[]) {
    setDraft('customer_portal_promo_items', serializePromoItems(nextItems))
  }

  function getPortalMediaValue(target: unknown): string {
    const targetKey = String(target || '').trim()
    if (!targetKey) return ''
    if (targetKey.startsWith('about:')) {
      const blockId = targetKey.slice('about:'.length)
      return aboutBlocks.find((block) => block.id === blockId)?.mediaUrl || ''
    }
    if (targetKey.startsWith('promo:')) {
      const promoId = targetKey.slice('promo:'.length)
      return promoItems.find((item) => item.id === promoId)?.mediaUrl || ''
    }
    return editorDraft[targetKey] || ''
  }

  function setPortalMediaValue(target: unknown, value: string) {
    const targetKey = String(target || '').trim()
    if (!targetKey) return
    if (targetKey.startsWith('about:')) {
      updateAboutBlock(targetKey.slice('about:'.length), 'mediaUrl', value)
      return
    }
    if (targetKey.startsWith('promo:')) {
      updatePromoItem(targetKey.slice('promo:'.length), 'mediaUrl', value)
      return
    }
    setDraft(targetKey, value)
  }

  function clearPortalUploadPreview(target: string) {
    const previewUrl = mediaUploadPreviewUrlsRef.current.get(target)
    if (previewUrl && String(previewUrl).startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    mediaUploadPreviewUrlsRef.current.delete(target)
  }

  function clearPortalMediaTarget(target: unknown) {
    const targetKey = String(target || '').trim()
    const controller = mediaUploadControllersRef.current.get(targetKey)
    controller?.abort?.()
    mediaUploadControllersRef.current.delete(targetKey)
    mediaUploadOriginalValuesRef.current.delete(targetKey)
    clearPortalUploadPreview(targetKey)
    setPortalMediaValue(targetKey, '')
    updateMediaUploadState(targetKey, { type: 'success', publicPath: '', processingStatus: 'idle' })
  }

  async function uploadPortalMedia(target: unknown, accept = 'image/*'): Promise<string> {
    const targetKey = String(target || '').trim()
    if (!targetKey) return ''
    if (!beginKeyedAction(mediaUploadInFlightTargetsRef, targetKey)) return ''
    try {
      const file = await new Promise<File | null>((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = accept
        input.onchange = () => resolve(input.files?.[0] || null)
        input.click()
      })
      if (!file) return ''

      const previousValue = getPortalMediaValue(targetKey)
      mediaUploadOriginalValuesRef.current.set(targetKey, previousValue)
      clearPortalUploadPreview(targetKey)

      const localPreview = URL.createObjectURL(file)
      mediaUploadPreviewUrlsRef.current.set(targetKey, localPreview)
      setPortalMediaValue(targetKey, localPreview)

      const controller = new AbortController()
      mediaUploadControllersRef.current.set(targetKey, controller)
      updateMediaUploadState(targetKey, {
        type: 'start',
        fileName: file.name,
        previewUrl: localPreview,
      })

      const uploaded = await withLoaderTimeout(
        () => getCatalogApi().uploadFileAsset({
          file,
          userId: user?.id,
          userName: user?.name,
          signal: controller.signal,
          onProgress: ({ percent }: { percent: number }) => updateMediaUploadState(targetKey, { type: 'progress', progress: percent }),
        }),
        'Upload portal media',
        CATALOG_PORTAL_MEDIA_UPLOAD_TIMEOUT_MS,
      )
      if (!uploaded?.public_path) throw new Error(uploaded?.error || 'Image upload failed')
      if (!aliveRef.current) return ''

      const nextPath = buildCacheBustedMediaPath(uploaded.public_path, uploaded.cache_version)
      setPortalMediaValue(targetKey, nextPath)
      updateMediaUploadState(targetKey, {
        type: 'success',
        publicPath: nextPath,
        processingStatus: uploaded.processing_status || 'ready',
        mediaJobId: uploaded.media_job_id || '',
        cacheVersion: uploaded.cache_version || '',
      })
      return nextPath
    } catch (error) {
      const errorMessage = getCatalogErrorMessage(error, 'Image upload failed')
      const cancelled = /cancelled|canceled|aborted/i.test(errorMessage)
      const previousValue = mediaUploadOriginalValuesRef.current.get(targetKey)
      if (aliveRef.current) {
        setPortalMediaValue(targetKey, previousValue || '')
        updateMediaUploadState(targetKey, cancelled ? { type: 'cancel' } : { type: 'error', error: errorMessage })
        if (!cancelled) notify(errorMessage, 'error')
      }
      return ''
    } finally {
      finishKeyedAction(mediaUploadInFlightTargetsRef, targetKey)
      mediaUploadControllersRef.current.delete(targetKey)
      mediaUploadOriginalValuesRef.current.delete(targetKey)
    }
  }

  function cancelPortalMediaUpload(target: unknown) {
    const targetKey = String(target || '').trim()
    const controller = mediaUploadControllersRef.current.get(targetKey)
    controller?.abort?.()
  }

  function updateAboutBlock(blockId: string, key: string, value: unknown) {
    setAboutBlocksDraft(aboutBlocks.map((block) => (
      block.id === blockId ? { ...block, [key]: value } : block
    )))
  }

  function updatePromoItem(itemId: string, key: string, value: unknown) {
    setPromoItemsDraft(promoItems.map((item) => (
      item.id === itemId ? { ...item, [key]: value } : item
    )))
  }

  function addAboutBlock(type: unknown) {
    setAboutBlocksDraft([...aboutBlocks, createAboutBlock(type)])
  }

  function addPromoItem() {
    setPromoItemsDraft([...promoItems, createPromoItem()])
  }

  function moveAboutBlockBefore(dragId: string, targetId: string) {
    if (!dragId || !targetId || dragId === targetId) return
    const nextBlocks = [...aboutBlocks]
    const dragIndex = nextBlocks.findIndex((block) => block.id === dragId)
    const targetIndex = nextBlocks.findIndex((block) => block.id === targetId)
    if (dragIndex < 0 || targetIndex < 0) return
    const [draggedBlock] = nextBlocks.splice(dragIndex, 1)
    const insertIndex = dragIndex < targetIndex ? targetIndex - 1 : targetIndex
    nextBlocks.splice(insertIndex, 0, draggedBlock)
    setAboutBlocksDraft(nextBlocks)
  }

  function removeAboutBlock(blockId: string) {
    const uploadKey = `about:${blockId}`
    const controller = mediaUploadControllersRef.current.get(uploadKey)
    controller?.abort?.()
    mediaUploadControllersRef.current.delete(uploadKey)
    mediaUploadOriginalValuesRef.current.delete(uploadKey)
    clearPortalUploadPreview(uploadKey)
    forgetMediaUploadState(uploadKey)
    setAboutBlocksDraft(aboutBlocks.filter((block) => block.id !== blockId))
  }

  function movePromoItemBefore(dragId: string, targetId: string) {
    if (!dragId || !targetId || dragId === targetId) return
    const nextItems = [...promoItems]
    const dragIndex = nextItems.findIndex((item) => item.id === dragId)
    const targetIndex = nextItems.findIndex((item) => item.id === targetId)
    if (dragIndex < 0 || targetIndex < 0) return
    const [draggedItem] = nextItems.splice(dragIndex, 1)
    const insertIndex = dragIndex < targetIndex ? targetIndex - 1 : targetIndex
    nextItems.splice(insertIndex, 0, draggedItem)
    setPromoItemsDraft(nextItems)
  }

  function removePromoItem(itemId: string) {
    const uploadKey = `promo:${itemId}`
    const controller = mediaUploadControllersRef.current.get(uploadKey)
    controller?.abort?.()
    mediaUploadControllersRef.current.delete(uploadKey)
    mediaUploadOriginalValuesRef.current.delete(uploadKey)
    clearPortalUploadPreview(uploadKey)
    forgetMediaUploadState(uploadKey)
    setPromoItemsDraft(promoItems.filter((item) => item.id !== itemId))
  }

  function setFaqDraft(nextItems: FaqItem[]) {
    setDraft('customer_portal_faq_items', JSON.stringify(nextItems))
  }

  function addFaqItem() {
    setFaqDraft([
      ...faqItems,
      {
        id: createFaqId(),
        question: '',
        answer: '',
      },
    ])
  }

  function mergeFaqStarterItems(starterItems: FaqItem[]) {
    if (!faqItems.length) {
      setFaqDraft(starterItems)
      return
    }
    const existingQuestions = new Set(faqItems.map((item) => String(item.question || '').trim().toLowerCase()).filter(Boolean))
    const merged = [
      ...faqItems,
      ...starterItems.filter((item) => !existingQuestions.has(String(item.question || '').trim().toLowerCase())),
    ].slice(0, 24)
    setFaqDraft(normalizeFaqItems(merged))
  }

  function addFaqStarterSet() {
    mergeFaqStarterItems(buildFaqStarterItems(t))
  }

  function addAiFaqStarterSet() {
    mergeFaqStarterItems(buildAiFaqStarterItems(t))
  }

  function updateFaqItem(itemId: string, key: keyof FaqItem, value: string) {
    setFaqDraft(faqItems.map((item) => (
      item.id === itemId ? { ...item, [key]: value } : item
    )))
  }

  function removeFaqItem(itemId: string) {
    setFaqDraft(faqItems.filter((item) => item.id !== itemId))
  }

  function clearAssistantState() {
    setAssistantQuestion('')
    setAssistantProfile({
      brand: '',
      skinType: '',
      concerns: '',
      shoppingFor: '',
      goal: '',
    })
    setAssistantResponse(null)
    setAssistantError('')
    setAssistantExpandedProductId(null)
    setAssistantRequestPolicy(null)
  }

  async function uploadDraftImage(key: string) {
    await uploadPortalMedia(key, 'image/*')
  }

  async function uploadAboutBlockMedia(blockId: string) {
    const block = aboutBlocks.find((entry) => entry.id === blockId)
    const accept = block?.type === 'video' ? 'video/*' : 'image/*'
    await uploadPortalMedia(`about:${blockId}`, accept)
  }

  async function uploadPromoItemMedia(itemId: string) {
    await uploadPortalMedia(`promo:${itemId}`, 'image/*')
  }

  function openFilePicker(target: unknown, mediaType = 'image', title = copy('openGallery', 'Choose file')) {
    setFilePicker({ open: true, target, mediaType, title })
  }

  function handleFilePickerSelect(publicPath: unknown) {
    const selectedPath = String(publicPath || '')
    const target = filePicker.target
    if (!target) return
    const targetKey = String(target)
    if (
      targetKey === 'customer_portal_logo_image'
      || targetKey === 'customer_portal_favicon_image'
      || targetKey === 'customer_portal_cover_image'
    ) {
      clearPortalUploadPreview(targetKey)
      setDraft(targetKey, selectedPath)
      updateMediaUploadState(targetKey, { type: 'success', publicPath: selectedPath, processingStatus: 'ready' })
      return
    }
    if (targetKey.startsWith('about:')) {
      clearPortalUploadPreview(targetKey)
      updateAboutBlock(targetKey.slice('about:'.length), 'mediaUrl', selectedPath)
      updateMediaUploadState(targetKey, { type: 'success', publicPath: selectedPath, processingStatus: 'ready' })
      return
    }
    if (targetKey.startsWith('promo:')) {
      clearPortalUploadPreview(targetKey)
      updatePromoItem(targetKey.slice('promo:'.length), 'mediaUrl', selectedPath)
      updateMediaUploadState(targetKey, { type: 'success', publicPath: selectedPath, processingStatus: 'ready' })
    }
  }

  async function savePortalDraft() {
    try {
      if (hasActiveMediaUpload) {
        notify(copy('portalUploadPending', 'Wait for media uploads to finish before saving the portal.'), 'error')
        return
      }
      const normalizedPath = normalizePortalPath(editorDraft.customer_portal_path || '/customer-portal')
      if (isReservedPortalPath(normalizedPath)) {
        notify(copy('invalidPublicPath', 'Choose a public path outside /api, /uploads, and /health.'), 'error')
        return
      }
      if (
        !editorDraft.customer_portal_show_catalog
        && !editorDraft.customer_portal_show_membership
        && !editorDraft.customer_portal_show_about
        && !editorDraft.customer_portal_show_faq
        && !editorDraft.customer_portal_ai_enabled
      ) {
        notify(copy('portalVisibilityRequired', 'Enable at least one customer section before saving the portal.'), 'error')
        return
      }

      const sanitizedRefreshSeconds = Math.min(120, Math.max(5, Math.floor(toNumber(editorDraft.customer_portal_refresh_seconds, 20))))
      const sanitizedLowStockThreshold = Math.max(0, toNumber(editorDraft.customer_portal_low_stock_threshold, 10))
      const sanitizedOutOfStockThreshold = Math.max(0, toNumber(editorDraft.customer_portal_out_of_stock_threshold, 0))
      const sanitizedGridMobile = Math.min(3, Math.max(1, Math.round(toNumber(editorDraft.customer_portal_grid_columns_mobile, 1))))
      const sanitizedGridDesktop = Math.min(8, Math.max(2, Math.round(toNumber(editorDraft.customer_portal_grid_columns_desktop, 4))))
      const sanitizedHighlightRankLimit = Math.max(1, Math.min(10, Math.round(toNumber(editorDraft.customer_portal_highlight_rank_limit, 3))))
      const sanitizedLogoSize = Math.min(144, Math.max(48, Math.round(toNumber(editorDraft.customer_portal_logo_size, 80))))
      const sanitizedLogoZoom = Math.min(180, Math.max(80, Math.round(toNumber(editorDraft.customer_portal_logo_zoom, 100))))
      const sanitizedLogoPositionX = Math.min(100, Math.max(0, Math.round(toNumber(editorDraft.customer_portal_logo_position_x, 50))))
      const sanitizedLogoPositionY = Math.min(100, Math.max(0, Math.round(toNumber(editorDraft.customer_portal_logo_position_y, 50))))
      const sanitizedPublicUrl = String(editorDraft.customer_portal_public_url || '').trim()
      const sanitizedGoogleMapEmbed = normalizeGoogleMapsEmbed(editorDraft.customer_portal_google_maps_embed || '')
      if (sanitizedPublicUrl && !/^https?:\/\/.+/i.test(sanitizedPublicUrl)) {
        notify(copy('publicUrlHint', 'Use a full https:// URL for the public customer portal if you set one.'), 'error')
        return
      }
      if (editorDraft.customer_portal_google_maps_embed && !sanitizedGoogleMapEmbed) {
        notify(copy('mapEmbedHint', 'Paste a Google Maps link or embed URL. The portal will render it as an interactive map card.'), 'error')
        return
      }
      let sanitizedTranslations = '{}'
      try {
        const rawTranslations = String(editorDraft.customer_portal_translations || '{}').trim() || '{}'
        const parsedTranslations = JSON.parse(rawTranslations)
        if (!parsedTranslations || typeof parsedTranslations !== 'object' || Array.isArray(parsedTranslations)) {
          throw new Error('Translation overrides must be a JSON object')
        }
        sanitizedTranslations = stringifyPortalTranslations(parsedTranslations)
      } catch (_) {
        notify(copy('translationJsonInvalid', 'Translation overrides must be valid JSON.'), 'error')
        return
      }

      const sanitizedLogoImage = sanitizePortalMediaValue(editorDraft.customer_portal_logo_image, previewConfig.logoImage || '')
      const sanitizedFaviconImage = sanitizePortalMediaValue(editorDraft.customer_portal_favicon_image, previewConfig.faviconImage || '')
      const sanitizedCoverImage = sanitizePortalMediaValue(editorDraft.customer_portal_cover_image, previewConfig.coverImage || '')
      const previewAboutBlockMap = new Map<string, PortalMediaBlock>((previewConfig.aboutBlocks || []).map((block: PortalMediaBlock) => [String(block?.id || ''), block]))
      const sanitizedAboutBlocks = aboutBlocks.map((block: PortalMediaBlock) => ({
        ...block,
        mediaUrl: sanitizePortalMediaValue(
          block?.mediaUrl,
          previewAboutBlockMap.get(String(block?.id || ''))?.mediaUrl || '',
        ),
      }))
      const previewPromoItemMap = new Map<string, PortalMediaBlock>((previewConfig.promoItems || []).map((item: PortalMediaBlock) => [String(item?.id || ''), item]))
      const sanitizedPromoItems = promoItems.map((item: PortalMediaBlock) => ({
        ...item,
        mediaUrl: sanitizePortalMediaValue(
          item?.mediaUrl,
          previewPromoItemMap.get(String(item?.id || ''))?.mediaUrl || '',
        ),
        linkUrl: normalizeExternalUrl(item?.linkUrl || ''),
      }))

      setEditorSaving(true)
      const result = await saveSettings({
        business_name: editorDraft.business_name || '',
        business_phone: editorDraft.business_phone || '',
        business_email: editorDraft.business_email || '',
        business_address: editorDraft.business_address || '',
        customer_portal_address_link: normalizeExternalUrl(editorDraft.customer_portal_address_link || ''),
        customer_portal_business_tagline: editorDraft.customer_portal_business_tagline || '',
        customer_portal_google_maps_embed: sanitizedGoogleMapEmbed,
        customer_portal_show_google_map: editorDraft.customer_portal_show_google_map ? 'true' : 'false',
        customer_portal_logo_image: sanitizedLogoImage,
        customer_portal_favicon_image: sanitizedFaviconImage,
        customer_portal_logo_size: String(sanitizedLogoSize),
        customer_portal_logo_fit: editorDraft.customer_portal_logo_fit === 'cover' ? 'cover' : 'contain',
        customer_portal_logo_zoom: String(sanitizedLogoZoom),
        customer_portal_logo_position_x: String(sanitizedLogoPositionX),
        customer_portal_logo_position_y: String(sanitizedLogoPositionY),
        customer_portal_cover_image: sanitizedCoverImage,
        customer_portal_show_logo: editorDraft.customer_portal_show_logo ? 'true' : 'false',
        customer_portal_show_cover: editorDraft.customer_portal_show_cover ? 'true' : 'false',
        customer_portal_show_phone: editorDraft.customer_portal_show_phone ? 'true' : 'false',
        customer_portal_show_email: editorDraft.customer_portal_show_email ? 'true' : 'false',
        customer_portal_show_address: editorDraft.customer_portal_show_address ? 'true' : 'false',
        customer_portal_public_url: sanitizedPublicUrl,
        customer_portal_website: editorDraft.customer_portal_website || '',
        customer_portal_facebook: editorDraft.customer_portal_facebook || '',
        customer_portal_instagram: editorDraft.customer_portal_instagram || '',
        customer_portal_telegram: editorDraft.customer_portal_telegram || '',
        customer_portal_website_label: String(editorDraft.customer_portal_website_label || 'Website').trim() || 'Website',
        customer_portal_facebook_label: String(editorDraft.customer_portal_facebook_label || 'Facebook').trim() || 'Facebook',
        customer_portal_instagram_label: String(editorDraft.customer_portal_instagram_label || 'Instagram').trim() || 'Instagram',
        customer_portal_telegram_label: String(editorDraft.customer_portal_telegram_label || 'Telegram').trim() || 'Telegram',
        customer_portal_show_website: editorDraft.customer_portal_show_website ? 'true' : 'false',
        customer_portal_show_facebook: editorDraft.customer_portal_show_facebook ? 'true' : 'false',
        customer_portal_show_instagram: editorDraft.customer_portal_show_instagram ? 'true' : 'false',
        customer_portal_show_telegram: editorDraft.customer_portal_show_telegram ? 'true' : 'false',
        customer_portal_title: String(editorDraft.business_name || editorDraft.customer_portal_title || '').trim(),
        customer_portal_title_size: String(Math.min(64, Math.max(28, Math.round(toNumber(editorDraft.customer_portal_title_size, 40))))),
        customer_portal_intro: editorDraft.customer_portal_intro || '',
        customer_portal_ai_enabled: editorDraft.customer_portal_ai_enabled ? 'true' : 'false',
        customer_portal_ai_title: String(editorDraft.customer_portal_ai_title || '').trim(),
        customer_portal_ai_intro: String(editorDraft.customer_portal_ai_intro || '').trim(),
        customer_portal_ai_disclaimer: String(editorDraft.customer_portal_ai_disclaimer || '').trim(),
        customer_portal_ai_provider_id: String(editorDraft.customer_portal_ai_provider_id || '').trim(),
        customer_portal_ai_prompt: String(editorDraft.customer_portal_ai_prompt || '').trim(),
        customer_portal_show_faq: editorDraft.customer_portal_show_faq ? 'true' : 'false',
        customer_portal_faq_title: String(editorDraft.customer_portal_faq_title || '').trim(),
        customer_portal_faq_items: JSON.stringify(faqItems),
        customer_portal_show_about: editorDraft.customer_portal_show_about ? 'true' : 'false',
        customer_portal_about_title: String(editorDraft.customer_portal_about_title || '').trim(),
        customer_portal_about_content: String(editorDraft.customer_portal_about_content || '').trim(),
        customer_portal_about_blocks: serializeAboutBlocks(sanitizedAboutBlocks),
        customer_portal_translations: sanitizedTranslations,
        customer_portal_hero_gradient_start: normalizeHexColor(editorDraft.customer_portal_hero_gradient_start, '#0f172a'),
        customer_portal_hero_gradient_mid: normalizeHexColor(editorDraft.customer_portal_hero_gradient_mid, '#14532d'),
        customer_portal_hero_gradient_end: normalizeHexColor(editorDraft.customer_portal_hero_gradient_end, '#ea580c'),
        customer_portal_path: normalizedPath,
        customer_portal_language: editorDraft.customer_portal_language || 'auto',
        customer_portal_translate_widget_enabled: editorDraft.customer_portal_translate_widget_enabled ? 'true' : 'false',
    customer_portal_show_catalog: editorDraft.customer_portal_show_catalog ? 'true' : 'false',
    customer_portal_show_membership: editorDraft.customer_portal_show_membership ? 'true' : 'false',
    customer_portal_show_prices: editorDraft.customer_portal_show_prices ? 'true' : 'false',
    customer_portal_show_out_of_stock_products: editorDraft.customer_portal_show_out_of_stock_products ? 'true' : 'false',
    customer_portal_show_product_brand: editorDraft.customer_portal_show_product_brand ? 'true' : 'false',
    customer_portal_show_product_category: editorDraft.customer_portal_show_product_category ? 'true' : 'false',
    customer_portal_show_product_description: editorDraft.customer_portal_show_product_description ? 'true' : 'false',
    customer_portal_show_product_discount: editorDraft.customer_portal_show_product_discount ? 'true' : 'false',
    customer_portal_price_display: editorDraft.customer_portal_price_display || 'USD',
        customer_portal_show_top_seller_badge: editorDraft.customer_portal_show_top_seller_badge ? 'true' : 'false',
        customer_portal_show_top_product_badge: editorDraft.customer_portal_show_top_product_badge ? 'true' : 'false',
        customer_portal_show_recommended_badge: editorDraft.customer_portal_show_recommended_badge ? 'true' : 'false',
        customer_portal_show_promotion_badge: editorDraft.customer_portal_show_promotion_badge ? 'true' : 'false',
        customer_portal_show_new_arrival_badge: editorDraft.customer_portal_show_new_arrival_badge ? 'true' : 'false',
        customer_portal_highlight_rank_limit: String(sanitizedHighlightRankLimit),
        customer_portal_show_promotions: editorDraft.customer_portal_show_promotions ? 'true' : 'false',
        customer_portal_promotions_title: String(editorDraft.customer_portal_promotions_title || '').trim(),
        customer_portal_promotions_intro: String(editorDraft.customer_portal_promotions_intro || '').trim(),
        customer_portal_promo_items: serializePromoItems(sanitizedPromoItems),
        customer_portal_recommended_product_ids: JSON.stringify(recommendedProductIds),
        customer_portal_refresh_seconds: String(sanitizedRefreshSeconds),
        customer_portal_stock_threshold_mode: editorDraft.customer_portal_stock_threshold_mode === 'global' ? 'global' : 'product',
        customer_portal_low_stock_threshold: String(sanitizedLowStockThreshold),
        customer_portal_out_of_stock_threshold: String(sanitizedOutOfStockThreshold),
        customer_portal_grid_columns_mobile: String(Math.min(3, Math.max(1, sanitizedGridMobile))),
        customer_portal_grid_columns_desktop: String(Math.min(8, Math.max(2, sanitizedGridDesktop))),
        customer_portal_submission_enabled: editorDraft.customer_portal_submission_enabled ? 'true' : 'false',
        customer_portal_submission_reward_points: String(Math.max(0, Math.floor(toNumber(editorDraft.customer_portal_submission_reward_points, previewConfig.submissionRewardPoints || 5)))),
        customer_portal_submission_instructions: editorDraft.customer_portal_submission_instructions || '',
      }) as LegacyCatalogRecord
      if (result?.conflict) {
        notify(copy('portalSettingsConflict', 'Portal settings changed on another device. Review the latest values in Settings, then retry your save.'), 'error')
        return
      }
      setDraft('customer_portal_logo_image', sanitizedLogoImage)
      setDraft('customer_portal_favicon_image', sanitizedFaviconImage)
      setDraft('customer_portal_cover_image', sanitizedCoverImage)
      setAboutBlocksDraft(sanitizedAboutBlocks)
      setPromoItemsDraft(sanitizedPromoItems)
      const sanitizedDraft = {
        ...editorDraft,
        customer_portal_logo_image: sanitizedLogoImage,
        customer_portal_favicon_image: sanitizedFaviconImage,
        customer_portal_cover_image: sanitizedCoverImage,
        customer_portal_about_blocks: serializeAboutBlocks(sanitizedAboutBlocks),
        customer_portal_promo_items: serializePromoItems(sanitizedPromoItems),
      }
      setConfig((current) => applyDraft(current, sanitizedDraft))
      setEditorDirty(false)
      await loadPortal()
    } catch (error) {
      notify(getCatalogErrorMessage(error, 'Failed to save portal'), 'error')
    } finally {
      setEditorSaving(false)
    }
  }

  async function askAssistant() {
    if (!previewConfig.aiEnabled) {
      notify(copy('assistantEnabled', 'Enable AI assistant'), 'error')
      return
    }
    if (!aiProviders.length && canEdit) {
      notify(copy('assistantNoProvider', 'Choose and test an AI provider in Library before enabling the portal assistant.'), 'error')
      return
    }
    if (!assistantQuestion.trim() && !Object.values(assistantProfile).some(Boolean)) {
      notify('Add a question or at least one shopping preference first.', 'error')
      return
    }
    if (assistantInFlightRef.current) return

    const requestId = beginTrackedRequest(assistantRequestRef)
    assistantInFlightRef.current = true
    setAssistantLoading(true)
    setAssistantError('')
    setAssistantExpandedProductId(null)
    try {
      const result = await withLoaderTimeout(
        () => getCatalogApi().askPortalAi({
          question: assistantQuestion.trim(),
          profile: assistantProfile,
        }),
        'Portal AI request',
        CATALOG_PORTAL_AI_REQUEST_TIMEOUT_MS,
      )
      if (!isTrackedRequestCurrent(assistantRequestRef, requestId)) return
      setAssistantResponse(result || null)
      setAssistantUsage(result?.usage || null)
      setAssistantRequestPolicy(result?.requestPolicy || null)
    } catch (error) {
      if (!isTrackedRequestCurrent(assistantRequestRef, requestId)) return
      const message = getCatalogErrorMessage(error, 'Portal AI request failed')
      setAssistantError(message)
      notify(message, 'error')
    } finally {
      if (isTrackedRequestCurrent(assistantRequestRef, requestId)) {
        assistantInFlightRef.current = false
        setAssistantLoading(false)
      }
    }
  }

  async function refreshMembershipData(
    membershipNumberValue: unknown,
    {
      clearOnMissing = true,
      label = 'Catalog membership lookup',
      showLoading = true,
    } = {},
  ) {
    const value = String(membershipNumberValue || '').trim()
    if (!value) return null

    const requestId = beginTrackedRequest(membershipLookupRequestRef)
    if (showLoading) setMembershipLoading(true)
    setMembershipError('')

    try {
      const result = await withLoaderTimeout(
        () => getCatalogApi().lookupPortalMembership(value),
        label,
        CATALOG_MEMBERSHIP_LOOKUP_TIMEOUT_MS,
      )
      if (!isTrackedRequestCurrent(membershipLookupRequestRef, requestId)) return null
      if (!result) {
        if (clearOnMissing) {
          setMembershipData(null)
          setMembershipError(copy('membershipNotFound', 'Membership number not found.'))
        }
        return null
      }
      setMembershipData(result)
      return result
    } catch (error) {
      if (!isTrackedRequestCurrent(membershipLookupRequestRef, requestId)) return null
      setMembershipError(getCatalogErrorMessage(error, 'Lookup failed'))
      return null
    } finally {
      if (showLoading && isTrackedRequestCurrent(membershipLookupRequestRef, requestId)) {
        setMembershipLoading(false)
      }
    }
  }

  async function handleMembershipLookup() {
    const value = membershipNumber.trim()
    if (!value) {
      invalidateTrackedRequest(membershipLookupRequestRef)
      setMembershipLoading(false)
      setMembershipError(copy('membershipRequired', 'Please enter a membership number.'))
      setMembershipData(null)
      return
    }

    await refreshMembershipData(value, { label: 'Catalog membership lookup' })
  }

  async function addSubmissionImages(images: unknown) {
    const next = Array.isArray(images) ? images.filter(Boolean).map(String) : []
    if (!next.length) return
    if (!aliveRef.current) return
    setSubmissionDraft((current) => ({
      ...current,
      screenshots: [...current.screenshots, ...next].slice(0, CATALOG_SUBMISSION_MAX_SCREENSHOTS),
    }))
  }

  async function handleSubmissionPaste(event: ClipboardEvent<HTMLElement>) {
    const files = Array.from(event.clipboardData?.items || [])
      .map((item) => (item.kind === 'file' ? item.getAsFile() : null))
      .filter((file): file is File => Boolean(file))

    if (!files.length) return
    event.preventDefault()
    const remainingSlots = CATALOG_SUBMISSION_MAX_SCREENSHOTS - submissionDraft.screenshots.length
    if (remainingSlots <= 0) return
    const images = await readImageFilesAsDataUrls(files, {
      limit: remainingSlots,
      errorMessage: 'Failed to read pasted image',
    })
    await addSubmissionImages(images)
  }

  async function handleSubmitShareProof() {
    if (!previewConfig.submissionEnabled) {
      notify(copy('submissionDisabled', 'Share submissions are currently disabled.'), 'error')
      return
    }
    const membershipNumberValue = membershipData?.customer?.membership_number || membershipNumber.trim()
    if (!membershipNumberValue) {
      setMembershipError(copy('membershipRequired', 'Please enter a membership number.'))
      return
    }
    if (!submissionDraft.screenshots.length) {
      notify(copy('shareRequirement', 'Add at least one screenshot before submitting.'), 'error')
      return
    }

    if (!beginSingleAction(submissionSavingRef, { blocked: submissionSaving })) return

    try {
      setSubmissionSaving(true)
      await withLoaderTimeout(
        () => getCatalogApi().createPortalSubmission({
          membershipNumber: membershipNumberValue,
          platform: submissionDraft.platform,
          note: submissionDraft.note,
          screenshots: submissionDraft.screenshots,
        }),
        'Create portal submission',
        CATALOG_PORTAL_SUBMISSION_TIMEOUT_MS,
      )
      notify(copy('shareSubmitted', 'Submission sent for review.'), 'success')
      setSubmissionDraft({ platform: '', note: '', screenshots: [] })
      await refreshMembershipData(membershipNumberValue, {
        clearOnMissing: false,
        label: 'Catalog membership refresh after submission',
        showLoading: false,
      })
      if (canEdit) {
        await refreshPortalView({ showSpinner: false, reportError: false })
      }
    } catch (error) {
      notify(getCatalogErrorMessage(error, 'Submission failed'), 'error')
    } finally {
      finishSingleAction(submissionSavingRef)
      setSubmissionSaving(false)
    }
  }

  async function handleReviewSubmission(item: LegacyCatalogRecord, status: string) {
    if (!beginSingleAction(reviewSavingRef, { blocked: reviewSavingId != null, value: item.id })) return

    try {
      setReviewSavingId(item.id)
      await withLoaderTimeout(
        () => getCatalogApi().reviewPortalSubmission(item.id, {
          status,
          reward_points: item.reward_points || 0,
          review_note: item.review_note || '',
          userId: user?.id,
          userName: user?.name,
        }),
        'Review portal submission',
        CATALOG_PORTAL_REVIEW_TIMEOUT_MS,
      )
      notify(copy('reviewSaved', 'Review saved.'), 'success')
      await loadPortal()
      if (membershipData?.customer?.membership_number) {
        await refreshMembershipData(membershipData.customer.membership_number, {
          clearOnMissing: false,
          label: 'Catalog membership refresh after review',
          showLoading: false,
        })
      }
    } catch (error) {
      notify(getCatalogErrorMessage(error, 'Failed to save review'), 'error')
    } finally {
      finishSingleAction(reviewSavingRef)
      setReviewSavingId(null)
    }
  }

  const shouldLoadMapEmbed = displayConfig.showGoogleMap && (!publicView || activeTab === 'about')
  const mapEmbedUrl = shouldLoadMapEmbed
    ? normalizeGoogleMapsEmbed(displayConfig.googleMapsEmbed || '')
    : ''
  const socialLinks = [
    {
      key: 'website',
      enabled: displayConfig.showWebsite,
      label: String(displayConfig.linkLabels?.website || copy('website', 'Website')).trim() || copy('website', 'Website'),
      value: displayConfig.links?.website,
      icon: Globe,
    },
    {
      key: 'facebook',
      enabled: displayConfig.showFacebook,
      label: String(displayConfig.linkLabels?.facebook || copy('facebook', 'Facebook')).trim() || copy('facebook', 'Facebook'),
      value: displayConfig.links?.facebook,
      icon: Facebook,
    },
    {
      key: 'instagram',
      enabled: displayConfig.showInstagram,
      label: String(displayConfig.linkLabels?.instagram || copy('instagram', 'Instagram')).trim() || copy('instagram', 'Instagram'),
      value: displayConfig.links?.instagram,
      icon: Instagram,
    },
    {
      key: 'telegram',
      enabled: displayConfig.showTelegram,
      label: String(displayConfig.linkLabels?.telegram || copy('telegram', 'Telegram')).trim() || copy('telegram', 'Telegram'),
      value: displayConfig.links?.telegram,
      icon: Send,
    },
  ].filter((item) => item.enabled && item.value)

  const businessFacts = [
    { key: 'phone', enabled: displayConfig.showPhone, label: copy('phone', 'Phone'), value: displayConfig.businessPhone, href: displayConfig.businessPhone ? `tel:${displayConfig.businessPhone}` : '', icon: Phone },
    { key: 'email', enabled: displayConfig.showEmail, label: copy('email', 'Email'), value: displayConfig.businessEmail, href: displayConfig.businessEmail ? `mailto:${displayConfig.businessEmail}` : '', icon: Mail },
    { key: 'address', enabled: displayConfig.showAddress, label: copy('address', 'Address'), value: displayConfig.businessAddress, href: normalizeExternalUrl(displayConfig.addressLink), icon: MapPin },
  ].filter((item) => item.enabled && item.value)
  const addressFact = businessFacts.find((item) => item.key === 'address')
  const draftMapEmbedUrl = normalizeGoogleMapsEmbed(editorDraft.customer_portal_google_maps_embed || '')
  const redeemSummaryText = replaceVars(
    copy('redeemSummary', 'Minimum {points} points per unit. Available now: {units} unit(s).'),
    {
      points: membershipData?.points?.minimumRedeemPoints ?? displayConfig.redeemPoints,
      units: membershipData?.points?.redeemableUnits ?? 0,
    }
  )
  const mobileGridColumns = Math.min(3, Math.max(1, Math.round(toNumber(displayConfig.gridColumnsMobile, 1))))
  const desktopGridColumns = Math.min(10, Math.max(2, Math.round(toNumber(displayConfig.gridColumnsDesktop, 4))))
  const compactTwoColumnMobile = mobileGridColumns === 2
  const productGridClass = `${getPortalMobileGridClass(mobileGridColumns)} ${getPortalGridClass(desktopGridColumns)}`
  const compactCatalogCards = desktopGridColumns >= 5 || (desktopGridColumns >= 4 && mobileGridColumns >= 2)
  const portalActiveFilterCount = categoryFilter.length + brandFilter.length + branchFilter.length + stockFilter.length + (portalProductInitial === 'all' ? 0 : 1)
  const selectedStockBranch = branchFilter.length === 1 ? branchFilter[0] : 'all'
  const recommendedProductById = useMemo(() => {
    const map = new Map<number, CatalogProduct>()
    for (const product of products || []) {
      const id = Number(product?.id)
      if (Number.isFinite(id) && id > 0) map.set(id, product)
    }
    return map
  }, [products])
  const selectedRecommendedProductOptions = useMemo(() => (
    recommendedProductIds
      .map((id) => recommendedProductById.get(Number(id)))
      .filter((product): product is CatalogProduct => Boolean(product))
      .map(buildRecommendedProductOption)
  ), [recommendedProductById, recommendedProductIds])
  const recommendedProductOptions = useMemo(() => {
    const term = recommendedProductSearchTerm.trim()
    if (term.length < 2) return []
    return (products || [])
      .filter((product) => productMatchesRecommendedSearch(product, term))
      .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'km'))
      .slice(0, 30)
      .map(buildRecommendedProductOption)
      .filter((product) => product.id > 0)
  }, [products, recommendedProductSearchTerm])

  const catalogTabProps = {
    copy,
    filteredProducts,
    serverPaged: true,
    productTotal: portalProductTotal,
    productPage: portalProductPage,
    productPageSize: portalProductPageSize,
    setProductPage: setPortalProductPage,
    setProductPageSize: setPortalProductPageSize,
    initialOptions: portalProductInitials,
    initialFilter: portalProductInitial,
    setInitialFilter: setPortalProductInitial,
    refreshingProducts: portalProductRefreshing,
    loadingProducts: loading && publicView && !products.length,
    categories,
    brands,
    branches,
    search,
    setSearch,
    filtersOpen,
    setFiltersOpen,
    portalActiveFilterCount,
    clearPortalFilters,
    categoryFilter,
    setCategoryFilter,
    brandFilter,
    setBrandFilter,
    branchFilter,
    setBranchFilter,
    stockFilter,
    setStockFilter,
    toggleFilterValue,
    previewConfig: displayConfig,
    portalError,
    productGridClass,
    compactTwoColumnMobile,
    compactCatalogCards,
    promotionItems: displayConfig.promoItems || [],
    promotionsTitle: displayConfig.promotionsTitle,
    promotionsIntro: displayConfig.promotionsIntro,
    selectedStockBranch,
    getBranchQty,
    getStockStatus,
    normalizeProductGallery,
    openProductGallery,
    openPortalImage,
    formatPortalPrice,
    replaceVars,
  }

  function renderCatalogSection() {
    if (!displayConfig.showCatalog) return null
    const visible = activeTab === 'products'
    if (!visible && !(publicView && publicProductsPanelPrimed)) return null

    return (
      <div
        aria-hidden={visible ? undefined : 'true'}
        className={visible ? '' : 'pointer-events-none absolute left-0 top-0 h-0 w-full overflow-hidden opacity-0'}
      >
        <Suspense fallback={(
          <SectionShell title={copy('loadingPortal', 'Loading customer portal...')}>
            <div className="text-sm text-slate-500">Loading...</div>
          </SectionShell>
        )}>
          <CatalogProductsSection {...catalogTabProps} />
        </Suspense>
      </div>
    )
  }

  const publicFaqItems = Array.isArray(displayConfig.faqItems)
    ? localizeConfiguredFaqItems(displayConfig.faqItems, t).filter((item) => item?.question && item?.answer)
    : []
  const aiUsageSummary = assistantUsage || null
  const questionCharLimit = Math.max(280, Math.min(1500, Number(assistantRequestPolicy?.questionMaxChars || 700) || 700))
  const handleUploadSubmissionImages = async () => {
    try {
      const images = await pickMultipleImagesAsDataUrls()
      await addSubmissionImages(images)
    } catch (error) {
      notify(getCatalogErrorMessage(error, 'Image upload failed'), 'error')
    }
  }
  const secondaryTabProps = {
    tab: activeTab,
    copy,
    previewConfig: displayConfig,
    formatDateTime,
    formatPortalPrice,
    membershipNumber,
    setMembershipNumber,
    handleMembershipLookup,
    membershipLoading,
    membershipError,
    membershipData,
    redeemSummaryText,
    submissionDraft,
    setSubmissionDraft,
    submissionSaving,
    handleSubmissionPaste,
    handleSubmitShareProof,
    handleUploadSubmissionImages,
    openPortalImage,
    mapEmbedUrl,
    addressFact,
    businessFacts,
    socialLinks,
    versionedBusinessLogo,
    versionedBusinessCover,
    publicFaqItems,
    expandedFaqId,
    setExpandedFaqId,
    brands,
    assistantProfile,
    setAssistantProfile,
    assistantCategoryOptions,
    assistantQuestion,
    setAssistantQuestion,
    questionCharLimit,
    askAssistant,
    assistantLoading,
    clearAssistantState,
    aiUsageSummary,
    assistantRequestPolicy,
    replaceVars,
    assistantError,
    assistantResponse,
    assistantExpandedProductId,
    setAssistantExpandedProductId,
  }

  const handlePortalTabChange = (key: string) => {
    if (key !== 'products') {
      void loadCatalogSecondaryTabs()
      setPublicSecondaryTabsPrimed(true)
    } else {
      void loadCatalogProductsSection()
      setPublicProductsPanelPrimed(true)
    }
    setActiveTab(key)
  }

  function renderSecondaryTabPanel(tab: string, visible: boolean) {
    return (
      <div
        key={tab}
        aria-hidden={visible ? undefined : 'true'}
        className={visible ? '' : 'pointer-events-none absolute left-0 top-0 h-0 w-full overflow-hidden opacity-0'}
      >
        <CatalogSecondaryTabs {...secondaryTabProps} tab={tab} />
      </div>
    )
  }

  function renderSecondaryTabSection() {
    const activeSecondaryTab = (
      (activeTab === 'membership' && displayConfig.showMembership)
      || (activeTab === 'about' && displayConfig.showAbout)
      || (activeTab === 'faq' && displayConfig.showFaq)
      || (activeTab === 'ai' && displayConfig.aiEnabled)
    ) ? activeTab : null
    if (!activeSecondaryTab && !(publicView && publicSecondaryTabsPrimed)) return null

    return (
      <Suspense fallback={(
        <SectionShell title={copy('loadingPortal', 'Loading customer portal...')}>
          <div className="text-sm text-slate-500">Loading...</div>
        </SectionShell>
      )}>
        {activeSecondaryTab ? renderSecondaryTabPanel(activeSecondaryTab, true) : null}
      </Suspense>
    )
  }

  const editorSections: EditorSection[] = [
    ['portal-section-branding', 'branding', copy('businessInfo', 'Business details')],
    ['portal-section-media', 'media', copy('mediaSection', 'Media')],
    ['portal-section-display', 'display', copy('display', 'Display settings')],
    ['portal-section-theme', 'about', copy('about', 'About')],
    ['portal-section-faq', 'faq', copy('faqSection', 'FAQ editor')],
    ['portal-section-assistant', 'assistant', copy('portalAssistant', 'AI assistant')],
    ['portal-section-publish', 'publish', copy('portalPublishing', 'Publishing')],
    ['portal-section-submissions', 'submissions', copy('portalSubmissionSettings', 'Submission settings')],
  ]
  const editorContextValue = {
    aboutBlocks,
    activeEditorSection,
    addAboutBlock,
    addAiFaqStarterSet,
    addFaqItem,
    addFaqStarterSet,
    addPromoItem,
    aiProviders,
    cancelPortalMediaUpload,
    clearPortalMediaTarget,
    copy,
    draftMapEmbedUrl,
    dragAboutBlockId,
    dragPromoItemId,
    editorDirty,
    editorDraft,
    editorSaving,
    editorSections,
    faqItems,
    formatDateTime,
    generatedPublicUrl,
    getAboutBlockLabel,
    getMediaUploadState,
    handleReviewSubmission,
    moveAboutBlockBefore,
    movePromoItemBefore,
    navigateTo,
    normalizeHexColor,
    openFilePicker,
    openPortalImage,
    previewConfig,
    previewSectionRef,
    products,
    promoItems,
    publicPortalUrl,
    recommendedProductIds,
    recommendedProductOptions,
    recommendedProductSearchInput,
    recommendedProductSearchTerm,
    removeAboutBlock,
    removeFaqItem,
    removePromoItem,
    reviewItems,
    reviewSavingId,
    savePortalDraft,
    selectedRecommendedProductOptions,
    setActiveEditorSection,
    setDraft,
    setDragAboutBlockId,
    setDragPromoItemId,
    setRecommendedProductSearchInput,
    setRecommendedProductSearchTerm,
    setReviewItems,
    toNumber,
    toggleRecommendedProduct,
    updateAboutBlock,
    updateFaqItem,
    updatePromoItem,
    uploadAboutBlockMedia,
    uploadDraftImage,
    uploadPromoItemMedia,
  }

  const editorPanel = canEdit ? (
    <CatalogPageProvider value={editorContextValue}>
      <Suspense fallback={(
        <SectionShell title={copy('studioTitle', 'Portal Editor')}>
          <div className="text-sm text-slate-500">{copy('loadingPortal', 'Loading customer portal...')}</div>
        </SectionShell>
      )}>
        <CatalogEditorSurface />
      </Suspense>
    </CatalogPageProvider>
  ) : null

  if (loading && !publicView) {
    return (
    <div
      data-portal-root="true"
      className={`${publicView && darkMode ? 'dark ' : ''}${publicView ? 'min-h-screen w-full overflow-visible' : 'page-scroll flex-1 overflow-y-auto'}`}
      style={{
        ...(publicView ? { touchAction: 'pan-y pinch-zoom', overflowY: 'auto', WebkitOverflowScrolling: 'touch' } : {}),
        background: portalBackground,
      }}
    >
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="rounded-[32px] border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300">
            {copy('loadingPortal', 'Loading customer portal...')}
          </div>
        </div>
      </div>
    )
  }

  const previewTitle = String(displayConfig.businessName || displayConfig.title || '').trim()
  const previewBusinessName = String(displayConfig.businessName || '').trim()
  const showBrandLabel = previewBusinessName && previewBusinessName.toLowerCase() !== previewTitle.toLowerCase()
  const portalTabs = getPortalTabs(displayConfig, copy)
  const scrollPublicPortal = (direction: 'top' | 'bottom') => {
    if (typeof window === 'undefined') return
    const top = direction === 'bottom'
      ? Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0)
      : 0
    window.scrollTo({ top, behavior: 'smooth' })
  }

  const previewSurface = (
    <Suspense
      fallback={(
        <div
          data-portal-root="true"
          className={`${publicView && darkMode ? 'dark ' : ''}${publicView ? 'min-h-screen w-full overflow-visible' : 'page-scroll flex-1 overflow-y-auto'}`}
          style={{
            ...(publicView ? { touchAction: 'pan-y pinch-zoom', overflowY: 'auto', WebkitOverflowScrolling: 'touch' } : {}),
            background: portalBackground,
          }}
        >
          <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
            <div className="rounded-[32px] border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300">
              {copy('loadingPortal', 'Loading customer portal...')}
            </div>
          </div>
        </div>
      )}
    >
      <CatalogPreviewSurface
        publicView={publicView}
        darkMode={darkMode}
        portalBackground={portalBackground}
        copy={copy}
        canEdit={canEdit}
        previewSectionRef={previewSectionRef as RefObject<HTMLDivElement>}
        onBackToEditor={() => document.getElementById('portal-editor-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        displayConfig={displayConfig}
        versionedBusinessLogo={versionedBusinessLogo}
        showBrandLabel={showBrandLabel}
        previewTitle={previewTitle}
        portalTabs={portalTabs}
        activeTab={activeTab}
        setActiveTab={handlePortalTabChange}
        publicPortalNavRef={publicPortalNavRef as RefObject<HTMLElement>}
        publicPortalNavPinned={publicPortalNavPinned}
        publicPortalNavMetrics={publicPortalNavMetrics}
        catalogSection={renderCatalogSection()}
        secondaryTabSection={renderSecondaryTabSection()}
        publicScrollButtonsVisible={publicScrollButtonsVisible}
        scrollPublicPortal={scrollPublicPortal}
        productGalleryView={productGalleryView}
        setProductGalleryView={setProductGalleryView}
        filePicker={filePicker}
        setFilePicker={setFilePicker}
        handleFilePickerSelect={handleFilePickerSelect}
        portalImageView={portalImageView}
        setPortalImageView={setPortalImageView}
        toggleTheme={toggleTheme}
        translateTarget={translateTarget}
        translateApplyState={translateApplyState}
        translateApplyMessage={translateApplyMessage}
        externalTranslateTarget={externalTranslateTarget}
        translateReady={translateReady}
        changeTranslateTarget={changeTranslateTarget}
        allPublicTranslateOptions={ALL_PUBLIC_TRANSLATE_OPTIONS}
      />
    </Suspense>
  )

  if (!publicView) {
    return (
      <div
        data-portal-root="true"
        className="page-scroll flex-1 overflow-y-auto"
        style={{ background: portalBackground }}
      >
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          {canEdit ? editorPanel : null}
          {previewSurface}
        </div>
      </div>
    )
  }

  return (
    <>
      {canEdit ? editorPanel : null}
      {previewSurface}
    </>
  )
}
