import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, useContext as _useContext, startTransition } from 'react'
import type { ReactNode } from 'react'
import { STORAGE_KEYS, SYNC } from './constants'
import { cacheClearAll, ensureSyncUpdateCacheListener, FRONTEND_BUILD_INFO, isTransientGatewayError, pingServerHealth, primeServerHealthFromRuntime, startHealthCheck } from './api/http.ts'
import {
  normalizeRuntimeDescriptor,
  readStoredRuntimeDescriptor,
  resetClientRuntimeState,
  sanitizeSyncServerUrl,
  shouldResetForRuntimeChange,
  writeStoredRuntimeDescriptor,
} from './platform/runtime/clientRuntime.ts'
import { isWSConnected, reconnectWS } from './api/websocket.ts'
import { APP_NAVIGATION_EVENT, getAdminPageFromPath, getAdminPathForPage } from './app/pathRouting.ts'
import { getClientDeviceInfo } from './utils/deviceInfo.ts'
import { parsePermissionMap } from './utils/permissions.ts'
import { normalizePriceValue } from './utils/pricing.ts'
import { withLoaderTimeout } from './utils/loaders.ts'
import { refreshAppData } from './utils/appRefresh.ts'
import { normalizeSettingsWriteOptions } from './utils/settingsWriteOptions.ts'
import type { SettingsWriteOptions } from './types/settingsContracts.ts'

/**
 * Global application context.
 *
 * Responsibilities:
 * - restore/persist the logged-in user session
 * - load settings and expose translation/theme helpers
 * - track sync/WebSocket status for the whole shell
 * - provide navigation, notifications, and shared formatters
 */

const APP_SETTINGS_LOAD_TIMEOUT_MS = 9000
const APP_BOOTSTRAP_TIMEOUT_MS = 9000
const APP_LOGIN_TIMEOUT_MS = 15000
const APP_LOGOUT_TIMEOUT_MS = 10000
const APP_GOOGLE_OAUTH_COMPLETE_TIMEOUT_MS = 20000
const APP_SETTINGS_SAVE_TIMEOUT_MS = 15000
const APP_SESSION_DURATION_TIMEOUT_MS = 12000
const INITIAL_SYNC_URL_PERSIST_DELAY_MS = 1500
const INITIAL_SYNC_URL_PERSIST_IDLE_TIMEOUT_MS = 8000

type TranslationPack = Record<string, string>
type AppRecord = Record<string, unknown>
type AppSettings = AppRecord & {
  currency_khr_symbol?: string
  currency_usd_symbol?: string
  display_currency?: string
  display_timezone?: string
  exchange_rate?: string | number
  language?: string
  login_session_duration?: string
  theme?: string
  ui_accent_color?: string
  ui_border_radius?: string
  ui_chip_font_size?: string | number
  ui_custom_accent_colors?: unknown
  ui_custom_page_bg_colors?: unknown
  ui_custom_sidebar_colors?: unknown
  ui_custom_sidebar_text_colors?: unknown
  ui_density?: string
  ui_font_family?: string
  ui_font_size?: string | number
  ui_font_weight?: string
  ui_page_bg?: string
  ui_section_font_size?: string | number
  ui_sidebar_color?: string
  ui_sidebar_font_size?: string | number
  ui_sidebar_text_color?: string
  ui_table_font_size?: string | number
  ui_title_font_size?: string | number
}
type AppUser = AppRecord & {
  id?: string | number
  name?: string
  organization_group_id?: string | number | null
  organization_group_name?: string
  organization_group_slug?: string
  organization_id?: string | number | null
  organization_name?: string
  organization_public_id?: string
  organization_slug?: string
  permissions?: unknown
}
type OrganizationPayload = AppRecord & {
  id?: string | number | null
  name?: string
  public_id?: string
  slug?: string
}
type BootstrapSystemPayload = AppRecord & {
  publicAssetBaseUrl?: string
  runtime?: AppRecord
  serverStartTime?: string
}
type BootstrapPayload = AppRecord & {
  authError?: string
  group?: OrganizationPayload
  organization?: OrganizationPayload
  settings?: AppSettings
  system?: BootstrapSystemPayload
  unauthorized?: boolean
  user?: AppUser | null
}
type NotificationKind = 'success' | 'error' | 'warning' | 'info'
type AppNotification = { id: number; message: string; type: NotificationKind | string }
type SyncChannelUpdate = {
  channel: string
  reason?: string | null
  source?: string | null
  ts: number
}
type WriteConflictDetail = AppRecord & {
  actualUpdatedAt?: string | null
  attempted?: AppSettings
  code?: string
  conflict?: boolean
  current?: AppSettings
  currentSettings?: AppSettings
  entity?: string
  entityLabel?: string
  error?: string
  expectedUpdatedAt?: string | null
  id?: number
  message?: string
  refreshChannels?: string[]
}
type AuthResult = AppRecord & {
  error?: string
  sessionExpiresAt?: string
  success?: boolean
  user?: AppUser
}
type AppRuntimeApi = {
  completeGoogleOauth?: (payload: AppRecord) => Promise<AuthResult>
  getAppBootstrap?: () => Promise<BootstrapPayload>
  getSettings?: (options?: { force?: boolean }) => Promise<AppSettings>
  login?: (payload: AppRecord) => Promise<AuthResult>
  logout?: () => Promise<unknown>
  saveSettings?: (settings: AppSettings, options: Required<SettingsWriteOptions>) => Promise<WriteConflictDetail | { success?: boolean }>
  ensureSessionRecoveryListeners?: () => unknown
  setPublicAssetBaseUrl?: (url: string) => unknown
  setSyncServerUrl?: (url: string | null) => unknown
  updateSessionDuration?: (payload: AppRecord) => Promise<AuthResult>
}
type AppContextValue = {
  AccessDenied: () => ReactNode
  authReady: boolean
  canAccessPage: (pageId: string) => boolean
  canWriteToServer: boolean
  deviceTimezone: string
  dismissWriteConflict: () => void
  displayCurrency: string
  displayTimezone: string
  exchangeRate: number
  fmtKHR: (value: unknown) => string
  fmtUSD: (value: unknown) => string
  formatDateTime: (value: unknown, options?: Intl.DateTimeFormatOptions) => string
  formatPrice: (usd: unknown, khr?: unknown) => string
  getPermissions: () => Record<string, boolean>
  hasPermission: (key: string) => boolean
  khrSymbol: string
  khrToUsd: (value: unknown) => number
  language: string
  loadSettings: (options?: { force?: boolean }) => Promise<AppSettings>
  login: (username: string, password: string, sessionDuration?: string, organization?: string) => Promise<AuthResult>
  logout: () => Promise<void>
  navigateTo: (pageId: string) => void
  notification: AppNotification | null
  notify: (message: unknown, type?: NotificationKind | string, duration?: number) => void
  page: string
  persistAuthenticatedUser: (nextUser: AppUser, sessionDuration?: string, sessionExpiresAt?: string) => Promise<void>
  reloadWriteConflict: () => Promise<void>
  saveSettings: (newSettings: AppSettings, options?: SettingsWriteOptions) => Promise<WriteConflictDetail | { success: boolean; error?: unknown }>
  setPage: (page: string) => void
  settings: AppSettings
  syncChannel: SyncChannelUpdate | null
  syncConnected: boolean
  syncServerUnreachable: boolean
  syncUrl: string
  t: (key: string) => string
  theme: string
  toggleLanguage: () => void
  toggleTheme: () => void
  updateSyncUrl: (url: unknown) => void
  usdSymbol: string
  usdToKhr: (value: unknown) => number
  user: AppUser | null
  writeConflict: WriteConflictDetail | null
}
type SyncContextValue = Pick<AppContextValue, 'syncChannel' | 'syncConnected' | 'syncServerUnreachable'>

function getAppApi(): AppRuntimeApi {
  if (typeof window === 'undefined') return {}
  return (window as typeof window & { api?: AppRuntimeApi }).api || {}
}

function eventDetail<T extends AppRecord = AppRecord>(event: Event | { detail?: unknown } | undefined): T {
  const detail = event && 'detail' in event ? event.detail : undefined
  return detail && typeof detail === 'object' ? detail as T : {} as T
}

function getErrorMessage(error: unknown, fallback = ''): string {
  return error instanceof Error ? error.message : fallback
}

function flattenTranslationTree(input: unknown, target: TranslationPack = {}): TranslationPack {
  if (!input || typeof input !== 'object') return target
  Object.entries(input).forEach(([key, value]) => {
    if (value == null) return
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      target[key] = String(value)
      return
    }
    if (Array.isArray(value)) return
    flattenTranslationTree(value, target)
  })
  return target
}

const CORE_ENGLISH_PACK: TranslationPack = {
  access_denied: 'Access Denied',
  access_denied_desc: 'You do not have permission to view this page. Contact your administrator.',
  action: 'Action',
  actions: 'Actions',
  active: 'Active',
  add: 'Add',
  all: 'All',
  all_brands: 'All Brands',
  all_branches: 'All Branches',
  all_statuses: 'All Statuses',
  all_users: 'All Users',
  analytics: 'Analytics',
  apply: 'Apply',
  audit_log: 'Audit Log',
  backup: 'Backup',
  branch: 'Branch',
  cancel: 'Cancel',
  categories: 'Categories',
  close: 'Close',
  completed: 'Completed',
  contacts: 'Contacts',
  custom: 'Custom',
  customer_portal: 'Customer Portal',
  dashboard: 'Dashboard',
  delete: 'Delete',
  edit: 'Edit',
  error: 'Error',
  export: 'Export',
  failed: 'failed',
  files: 'Files',
  filters: 'Filters',
  history: 'History',
  import: 'Import',
  inventory: 'Inventory',
  library: 'Library',
  loading: 'Loading',
  login: 'Login',
  logout: 'Logout',
  loyalty_points: 'Loyalty Points',
  movements: 'Movements',
  next: 'Next',
  no_recent_actions: 'No recent actions',
  offline_mode: 'Offline mode',
  offline_mode_active: 'Offline mode: sales are saved on this device and will sync when the server reconnects.',
  offline_mode_ready_sync: 'Server is back online. Offline actions can sync now.',
  page: 'Page',
  pending: 'pending',
  point_of_sale: 'Point of Sale',
  previous: 'Previous',
  products: 'Products',
  receipt_settings: 'Receipt Settings',
  redo: 'Redo',
  returns: 'Returns',
  sales: 'Sales',
  save: 'Save',
  search: 'Search',
  server_back_online: 'Server is back online. You can keep working.',
  server_reconnecting: 'Server reconnecting',
  server_tunnel_reconnecting: 'Server/tunnel reconnecting. Cached data stays visible and read-only checks will refresh automatically.',
  settings: 'Settings',
  status_active: 'Active',
  status_ready: 'Ready',
  sync_now: 'Sync now',
  sync_server_title: 'Sync Server',
  syncing: 'syncing',
  undo: 'Undo',
  units: 'Units',
  users: 'Users',
  view_details: 'View details',
  waiting_for_server: 'Waiting for server',
}
const CORE_LANGUAGE_CODES = new Set(['en'])

const LANG_LOADERS: Record<string, () => Promise<TranslationPack>> = {
  en: async () => {
    const { default: en } = await import('./lang/en.json')
    return flattenTranslationTree(en, {})
  },
  km: async () => {
    const { default: km } = await import('./lang/km.json')
    return flattenTranslationTree(km, {})
  },
}
const loadedLangs: Record<string, TranslationPack> = { en: CORE_ENGLISH_PACK }
const fullyLoadedLangs = new Set<string>()
const AppContext = createContext<AppContextValue | null>(null)
const SyncContext = createContext<SyncContextValue | null>(null)
const OAUTH_PENDING_TTL_MS = 30 * 60 * 1000
const DEVICE_LOCAL_SETTING_KEYS = new Set([
  'theme',
  'language',
  'login_session_duration',
  'ui_font_size',
  'ui_font_weight',
  'ui_accent_color',
  'ui_border_radius',
  'ui_font_family',
  'ui_sidebar_color',
  'ui_page_bg',
  'ui_density',
  'ui_sidebar_font_size',
  'ui_title_font_size',
  'ui_section_font_size',
  'ui_table_font_size',
  'ui_chip_font_size',
  'ui_sidebar_text_color',
  'ui_custom_accent_colors',
  'ui_custom_sidebar_colors',
  'ui_custom_page_bg_colors',
  'ui_custom_sidebar_text_colors',
])
const SESSION_ONLY_STORAGE_KEYS = [
  STORAGE_KEYS.USER,
  STORAGE_KEYS.USER_EXPIRY,
]
const RUNTIME_RECOVERY_SESSION_KEY = 'bos-runtime-version-recovery'

function safeStorageGet(storage: Storage | null | undefined, key: string): string {
  try {
    return storage?.getItem?.(key) || ''
  } catch (_) {
    return ''
  }
}

function safeStorageSet(storage: Storage | null | undefined, key: string, value: unknown): void {
  try {
    storage?.setItem?.(key, String(value))
  } catch (_) {}
}

function safeStorageRemove(storage: Storage | null | undefined, key: string): void {
  try {
    storage?.removeItem?.(key)
  } catch (_) {}
}

function getStoredUserPayload() {
  return safeStorageGet(sessionStorage, STORAGE_KEYS.USER) || safeStorageGet(localStorage, STORAGE_KEYS.USER)
}

function getStoredUserExpiry() {
  return safeStorageGet(sessionStorage, STORAGE_KEYS.USER_EXPIRY) || safeStorageGet(localStorage, STORAGE_KEYS.USER_EXPIRY)
}

function clearPersistedAuthState() {
  SESSION_ONLY_STORAGE_KEYS.forEach((key) => {
    safeStorageRemove(localStorage, key)
    safeStorageRemove(sessionStorage, key)
  })
  safeStorageRemove(localStorage, 'businessos_auth_token')
  safeStorageRemove(sessionStorage, 'businessos_auth_token')
  safeStorageRemove(localStorage, STORAGE_KEYS.SERVER_START_TIME)
  safeStorageRemove(localStorage, STORAGE_KEYS.OAUTH_LOGIN_PENDING)
  safeStorageRemove(localStorage, STORAGE_KEYS.OAUTH_LINK_PENDING)
  safeStorageRemove(localStorage, STORAGE_KEYS.OAUTH_CALLBACK_RESULT)
}

function persistAuthState({
  user,
  expiryTime,
  sessionDuration,
}: {
  user: AppUser | null
  expiryTime: number | null
  sessionDuration?: unknown
}): void {
  const mode = String(sessionDuration || 'session').trim().toLowerCase() || 'session'
  const primaryStorage = mode === 'session' ? sessionStorage : localStorage
  const secondaryStorage = mode === 'session' ? localStorage : sessionStorage

  SESSION_ONLY_STORAGE_KEYS.forEach((key) => safeStorageRemove(secondaryStorage, key))

  safeStorageSet(primaryStorage, STORAGE_KEYS.USER, JSON.stringify(user))
  safeStorageRemove(primaryStorage, 'businessos_auth_token')
  safeStorageRemove(secondaryStorage, 'businessos_auth_token')
  if (expiryTime) safeStorageSet(primaryStorage, STORAGE_KEYS.USER_EXPIRY, String(expiryTime))
  else safeStorageRemove(primaryStorage, STORAGE_KEYS.USER_EXPIRY)
}

function computeSessionExpiryMs(sessionDuration: unknown, sessionExpiresAt: unknown = ''): number | null {
  const normalizedExpiry = String(sessionExpiresAt || '').trim()
  const parsedExpiryMs = normalizedExpiry ? new Date(normalizedExpiry).getTime() : Number.NaN
  if (Number.isFinite(parsedExpiryMs) && parsedExpiryMs > Date.now()) {
    return parsedExpiryMs
  }

  const mode = String(sessionDuration || 'session').trim().toLowerCase()
  if (mode === '30d') return Date.now() + (30 * 24 * 60 * 60 * 1000)
  if (mode === '14d') return Date.now() + (14 * 24 * 60 * 60 * 1000)
  if (mode === '7d') return Date.now() + (7 * 24 * 60 * 60 * 1000)
  if (mode === '3d') return Date.now() + (3 * 24 * 60 * 60 * 1000)
  if (mode === '1d') return Date.now() + (24 * 60 * 60 * 1000)
  return null
}

function readDeviceSettings(): AppSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.DEVICE_SETTINGS) || '{}')
    return parsed && typeof parsed === 'object' ? parsed as AppSettings : {}
  } catch (_) {
    return {}
  }
}

function writeDeviceSettings(value: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEYS.DEVICE_SETTINGS, JSON.stringify(value || {}))
  } catch (_) {}
}

function writeStoredSessionDuration(value: unknown): string {
  const normalized = String(value || '').trim() || 'session'
  try {
    localStorage.setItem(STORAGE_KEYS.SESSION_DURATION, normalized)
  } catch (_) {}
  return normalized
}

function readPendingOauthLink(): AppRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.OAUTH_LINK_PENDING) || ''
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const startedAt = Number(parsed.startedAt || 0)
    if (!startedAt || (Date.now() - startedAt) > OAUTH_PENDING_TTL_MS) return null
    return parsed as AppRecord
  } catch (_) {
    return null
  }
}

function clearPendingOauthLink() {
  try {
    localStorage.removeItem(STORAGE_KEYS.OAUTH_LINK_PENDING)
  } catch (_) {}
}

function readOauthCallbackResult(): AppRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.OAUTH_CALLBACK_RESULT) || ''
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as AppRecord : null
  } catch (_) {
    return null
  }
}

function clearOauthCallbackResult() {
  try {
    localStorage.removeItem(STORAGE_KEYS.OAUTH_CALLBACK_RESULT)
  } catch (_) {}
}

function mergeSettingsWithDeviceOverrides(baseSettings: AppSettings = {}): AppSettings {
  return { ...baseSettings, ...readDeviceSettings() }
}

function normalizeDateInput(value: unknown): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date?.getTime?.()) ? null : date
}

export function isBrokenLocalizedString(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.includes('\ufffd')) return true
  if (/[\uE000-\uF8FF]/.test(trimmed)) return true
  const mojibakeMarkers = ['\u00C3', '\u00C2', '\u00E2\u20AC', '\u00E1\u0178', '\u00E1\u017E', '\u00E0\u00B8', '\u00E1\u00BA', '\u00D0', '\u00D1', '\u00D8', '\u00D9']
  if (mojibakeMarkers.some((marker) => trimmed.includes(marker))) return true
  const questionMarks = (trimmed.match(/\?/g) || []).length
  return questionMarks >= Math.max(3, Math.floor(trimmed.length * 0.18))
}

function buildRuntimeDescriptorFromBootstrap(payload: BootstrapPayload = {}) {
  const organizationPublicId = payload?.organization?.public_id || payload?.user?.organization_public_id || ''
  const runtime = payload?.system?.runtime || {}
  return normalizeRuntimeDescriptor({
    ...runtime,
    serverStartTime: String(runtime.serverStartTime || payload?.system?.serverStartTime || ''),
    organizationPublicId,
  })
}

const PAGE_PERMISSIONS: Record<string, string | null> = {
  dashboard:        null,        // Always accessible
  catalog:          'customer_portal',
  loyalty_points:   'customer_portal',
  pos:              'pos',
  products:         'products',
  inventory:        'inventory',
  branches:         'inventory',
  sales:            'sales',
  contacts:         'contacts',  // Requires explicit contacts permission
  users:            'users',
  audit_log:        'audit_log',
  backup:           'backup',
  settings:         'settings',
  receipt_settings: 'all',
  returns:          'sales',
  server:           'settings',
}

function getInitialAdminPage(publicMode: boolean): string {
  if (publicMode || typeof window === 'undefined') return 'dashboard'
  return getAdminPageFromPath(window.location.pathname) || 'dashboard'
}

function LoadingScreen() {
  // Used during the very first bootstrap before settings/user state are ready.
  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#1e3a8a', fontFamily:'sans-serif' }}>
      <div style={{ textAlign:'center', color:'white' }}>
        <div style={{ fontSize:56, marginBottom:16 }}>🏪</div>
        <h2 style={{ margin:'0 0 8px', fontWeight:700, fontSize:22 }}>Business OS</h2>
        <p style={{ color:'#93c5fd', margin:0 }}>Loading...</p>
      </div>
    </div>
  )
}

function AccessDenied({ t }: { t: (key: string) => string }) {
  // Shared guard view for pages that exist in the shell but are not permitted
  // for the current role.
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
      <div className="text-6xl mb-4">🚫</div>
      <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">{t('access_denied')}</h2>
      <p className="text-gray-500 dark:text-gray-400 max-w-sm">{t('access_denied_desc')}</p>
    </div>
  )
}

export function AppProvider({ children, publicMode = false }: { children: ReactNode; publicMode?: boolean }) {
  // The provider owns the app session lifecycle and hands lightweight helpers
  // to page components so business workflows do not duplicate global state.
  const [user,                setUser]                = useState<AppUser | null>(() => {
    if (publicMode) return null
    // Recover the signed-in user from sessionStorage/localStorage depending on
    // the last chosen login duration.
    try {
      const stored = getStoredUserPayload()
      const expiry = getStoredUserExpiry()
      if (stored && expiry) {
        if (Date.now() > parseInt(expiry, 10)) {
          clearPersistedAuthState()
          return null
        }
        return JSON.parse(stored) as AppUser
      }
      if (stored) return JSON.parse(stored) as AppUser
    } catch (_) {}
    return null
  })
  const [settings,            setSettings]            = useState<AppSettings>({})
  const [language,            setLanguage]            = useState('en')
  const [theme,               setTheme]               = useState('light')
  const [page,                setPage]                = useState(() => getInitialAdminPage(publicMode))
  const [notification,        setNotification]        = useState<AppNotification | null>(null)
  const [writeConflict,       setWriteConflict]       = useState<WriteConflictDetail | null>(null)
  const [langRevision,        setLangRevision]        = useState(0)
  const settingsRef = useRef<AppSettings>({})
  const authRecoveryRef = useRef(false)
  const authEstablishedAtRef = useRef(0)
  const writeBlockedNoticeAtRef = useRef(0)
  const lastNotificationRef = useRef<{ message: string; type: string; at: number }>({ message: '', type: '', at: 0 })
  const syncErrorLogAtRef = useRef<Record<string, number>>({})
  const [authReady, setAuthReady] = useState(() => {
    if (publicMode) return true
    const hasStoredSession = !!getStoredUserPayload()
    const canProbeServerSession = typeof window !== 'undefined' && typeof getAppApi().getAppBootstrap === 'function'
    if (hasStoredSession && canProbeServerSession) return false
    if (hasStoredSession) return true
    if (canProbeServerSession) return false
    return true
  })
  // Initialize from actual WS state to avoid showing a disconnected badge
  // when the websocket connected before AppContext mounted.
  const [syncConnected,       setSyncConnected]       = useState(() => isWSConnected())
  const [syncChannel,         setSyncChannel]         = useState<SyncChannelUpdate | null>(null)
  const [syncServerUnreachable, setSyncServerUnreachable] = useState(false)

  useEffect(() => {
    settingsRef.current = settings || {}
  }, [settings])

  // Sync URL: when served by the backend, the page origin is the API/WS server.
  // Always use it (never a stale localhost stored from a previous session) so that
  // Cloudflare Tunnel URLs, LAN IPs and localhost:4000 all connect without manual config.
  const [syncUrl, _setSyncUrl] = useState(() => {
    try {
      const isViteDev = window.location.hostname === 'localhost' &&
        (window.location.port === '5173' || window.location.port === '5174')
      if (!isViteDev) {
        // Served by the Node backend: current origin is the API server.
        // Persisting it can wait until after first paint.
        return window.location.origin
      }
      // Vite dev: use stored value (normally points to localhost:4000 backend)
      return localStorage.getItem(STORAGE_KEYS.SYNC_SERVER) || ''
    } catch { return '' }
  })

  useEffect(() => {
    if (publicMode || typeof window === 'undefined' || !syncUrl) return undefined
    const isViteDev = window.location.hostname === 'localhost' &&
      (window.location.port === '5173' || window.location.port === '5174')
    if (isViteDev || sanitizeSyncServerUrl(syncUrl) !== sanitizeSyncServerUrl(window.location.origin)) return undefined

    let idleId: number | null = null
    const persistAutoSyncUrl = () => {
      safeStorageSet(localStorage, STORAGE_KEYS.SYNC_SERVER, syncUrl)
    }
    const timerId = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(persistAutoSyncUrl, { timeout: INITIAL_SYNC_URL_PERSIST_IDLE_TIMEOUT_MS })
      } else {
        persistAutoSyncUrl()
      }
    }, INITIAL_SYNC_URL_PERSIST_DELAY_MS)

    return () => {
      window.clearTimeout(timerId)
      if (idleId != null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId)
      }
    }
  }, [publicMode, syncUrl])

  // Define translation lookup before any hook dependency arrays or callbacks
  // reference it, avoiding render-time TDZ crashes in production bundles.
  const t = useCallback((key: string): string => {
    const localized = loadedLangs[language]?.[key]
    if (localized !== undefined && localized !== null && !isBrokenLocalizedString(localized)) return localized
    const english = loadedLangs.en?.[key]
    if (english !== undefined && english !== null && !isBrokenLocalizedString(english)) return english
    return key
  }, [language, langRevision])

  const readAppBootstrap = useCallback((label = 'App bootstrap'): Promise<BootstrapPayload | null> => {
    const api = getAppApi()
    if (typeof api.getAppBootstrap !== 'function') return Promise.resolve(null)
    return withLoaderTimeout(
      () => api.getAppBootstrap?.(),
      label,
      APP_BOOTSTRAP_TIMEOUT_MS,
    ).then((payload) => payload || null).catch(() => null)
  }, [])

  // Settings (defined before any useEffect that uses it).
  const loadSettings = useCallback(async (options: { force?: boolean } = {}): Promise<AppSettings> => {
    try {
      const hasAuthSession = !!getStoredUserPayload()
      if (!hasAuthSession) {
        const fallbackSettings = mergeSettingsWithDeviceOverrides({})
        setSettings(fallbackSettings)
        if (fallbackSettings.login_session_duration) {
          writeStoredSessionDuration(fallbackSettings.login_session_duration)
        }
        if (fallbackSettings.language) setLanguage(fallbackSettings.language)
        if (fallbackSettings.theme) setTheme(fallbackSettings.theme)
        return fallbackSettings
      }
      const api = getAppApi()
      const serverSettings = await withLoaderTimeout(
        () => api.getSettings?.({ force: options?.force === true }),
        'App settings',
        APP_SETTINGS_LOAD_TIMEOUT_MS,
      )
      const mergedSettings = mergeSettingsWithDeviceOverrides(serverSettings || {})
      setSettings(mergedSettings)
      if (mergedSettings.login_session_duration) {
        writeStoredSessionDuration(mergedSettings.login_session_duration)
      }
      if (mergedSettings.language) setLanguage(mergedSettings.language)
      if (mergedSettings.theme)    setTheme(mergedSettings.theme)
      return mergedSettings
    } catch (e: unknown) {
      console.warn('[AppContext] loadSettings failed:', getErrorMessage(e, 'unknown error'))
      const currentSettings = settingsRef.current && typeof settingsRef.current === 'object' ? settingsRef.current : {}
      const hasCurrentSettings = Object.keys(currentSettings).length > 0
      const fallbackSettings = hasCurrentSettings ? currentSettings : mergeSettingsWithDeviceOverrides({})
      if (!hasCurrentSettings) setSettings(fallbackSettings)
      if (fallbackSettings.login_session_duration) {
        writeStoredSessionDuration(fallbackSettings.login_session_duration)
      }
      if (fallbackSettings.language) setLanguage(fallbackSettings.language)
      if (fallbackSettings.theme) setTheme(fallbackSettings.theme)
      return fallbackSettings
    }
  }, [])

  const clearLocalBusinessState = useCallback(async (options: {
    clearAuth?: boolean
    preserveOrganization?: boolean
    preserveRuntimeMeta?: boolean
    preserveSessionDuration?: boolean
    preserveSyncServer?: boolean
  } = {}) => {
    await resetClientRuntimeState({
  // Authentication helpers.
      preserveDeviceSettings: true,
      preserveSyncServer: options.preserveSyncServer !== false,
      preserveSessionDuration: options.preserveSessionDuration !== false,
      preserveRuntimeMeta: options.preserveRuntimeMeta === true,
      preserveOrganization: options.preserveOrganization === true,
  // Authentication helpers.
    }).catch(() => {})
    cacheClearAll()
  }, [])

  const handleUnauthorizedSession = useCallback(async (message = 'Please sign in again to continue.'): Promise<void> => {
    await clearLocalBusinessState({
      clearAuth: true,
      preserveSyncServer: true,
      preserveSessionDuration: true,
      preserveRuntimeMeta: true,
    })
    setUser(null)
    setPage('dashboard')
    setAuthReady(true)
    clearPersistedAuthState()
    setSyncConnected(false)
    setSyncServerUnreachable(false)
    setNotification({ message, type: 'error', id: Date.now() })
  }, [clearLocalBusinessState])

  const applyBootstrapPayload = useCallback(async (
    payload: BootstrapPayload | null,
    options: { fallbackUser?: AppUser | null } = {},
  ): Promise<{
    group: OrganizationPayload | null
    organization: OrganizationPayload | null
    settings: AppSettings
    system: BootstrapSystemPayload | null
    user: AppUser | null
  }> => {
    const safePayload = payload || {}
    const fallbackUser = options.fallbackUser || null
    const nextUser = safePayload?.user || fallbackUser || null
    const runtimeDescriptor = buildRuntimeDescriptorFromBootstrap(safePayload)
    const storedRuntimeDescriptor = readStoredRuntimeDescriptor()
    if (shouldResetForRuntimeChange(storedRuntimeDescriptor, runtimeDescriptor)) {
      await clearLocalBusinessState({
        clearAuth: false,
        preserveSyncServer: true,
        preserveSessionDuration: true,
      })
    }
    writeStoredRuntimeDescriptor(runtimeDescriptor)

    const mergedSettings = mergeSettingsWithDeviceOverrides(safePayload?.settings || {})

    setSettings(mergedSettings)
    if (mergedSettings.login_session_duration) {
      writeStoredSessionDuration(mergedSettings.login_session_duration)
    }
    if (mergedSettings.language) setLanguage(mergedSettings.language)
    if (mergedSettings.theme) setTheme(mergedSettings.theme)

    if (nextUser) {
      setUser(nextUser)
    }

    const organization = safePayload?.organization
    const group = safePayload?.group
    if (organization?.slug || organization?.public_id || organization?.name) {
      safeStorageSet(localStorage, STORAGE_KEYS.ORGANIZATION, JSON.stringify({
        id: organization.id || null,
        name: organization.name || '',
        slug: organization.slug || '',
        public_id: organization.public_id || '',
        group_id: group?.id || null,
        group_name: group?.name || '',
        group_slug: group?.slug || '',
      }))
    }

    if (safePayload?.system?.serverStartTime) {
      safeStorageSet(localStorage, STORAGE_KEYS.SERVER_START_TIME, String(safePayload.system.serverStartTime))
    }
    if (safePayload?.system?.publicAssetBaseUrl) {
      const publicAssetBaseUrl = String(safePayload.system.publicAssetBaseUrl || '').replace(/\/$/, '')
      safeStorageSet(localStorage, STORAGE_KEYS.PUBLIC_ASSET_BASE_URL, publicAssetBaseUrl)
      getAppApi().setPublicAssetBaseUrl?.(publicAssetBaseUrl)
    }

    return {
      user: nextUser,
      settings: mergedSettings,
      system: safePayload?.system || null,
      organization: organization || null,
      group: group || null,
    }
  }, [clearLocalBusinessState])

  // Sync event listeners (loadSettings is defined above).
  const debounceRef = useRef<Record<string, number>>({})
  useEffect(() => {
    if (publicMode) return undefined
    const hasRecoverableSession = !!(user?.id || getStoredUserPayload())
    if (!hasRecoverableSession) {
      setSyncConnected(false)
      setSyncServerUnreachable(false)
      return undefined
    }
    ensureSyncUpdateCacheListener()

    const onUpdate = (e: Event) => {
      const detail = eventDetail<{ channel?: string; reason?: string | null; source?: string | null }>(e)
      const channel = String(detail.channel || '')
      if (!channel) return
      if (debounceRef.current[channel]) clearTimeout(debounceRef.current[channel])
      debounceRef.current[channel] = window.setTimeout(async () => {
        delete debounceRef.current[channel]
        // Settings changes from other devices apply immediately; no reload needed.
        if (channel === 'settings') loadSettings().catch(() => {})
        if (channel === 'runtime') {
          await clearLocalBusinessState({
            clearAuth: false,
            preserveSyncServer: true,
            preserveSessionDuration: true,
          })
          const bootstrap = await readAppBootstrap('Runtime bootstrap')
          if (bootstrap?.user) {
            await applyBootstrapPayload(bootstrap, { fallbackUser: user || null })
          } else if (bootstrap?.unauthorized) {
            await handleUnauthorizedSession(bootstrap.authError || 'Please sign in again to continue.')
          } else if (!getStoredUserPayload()) {
            await loadSettings().catch(() => {})
          }
        }
        setSyncChannel({
          channel,
          ts: Date.now(),
          reason: detail.reason || null,
          source: detail.source || null,
        })
      }, SYNC.EVENT_DEBOUNCE_MS)
    }
    const onStatus = (e: Event) => {
      const detail = eventDetail<{ connected?: boolean }>(e)
      setSyncConnected(detail.connected === true)
      if (detail.connected === true) setSyncServerUnreachable(false)
    }
    // Poll every 500 ms to catch WS connection that established before this listener was registered.
    // Once connected, we keep polling (WS can drop/reconnect) but at a slower rate.
    let pollRate = 500
    let pollTimer: number | null = null
    const poll = () => {
      const connected = isWSConnected()
      setSyncConnected(prev => {
        if (prev !== connected) {
          if (connected) setSyncServerUnreachable(false)
          return connected
        }
        return prev
      })
      // Slow down once connected; fast polling is only needed during initial connect.
      if (connected && pollRate < 3000) {
        pollRate = 3000
        clearTimeout(quickCheck)
        if (pollTimer != null) clearInterval(pollTimer)
        pollTimer = window.setInterval(poll, pollRate)
      }
    }
    // Also check immediately after 100ms (catches fast connections)
    const quickCheck = window.setTimeout(poll, 100)
    pollTimer = window.setInterval(poll, pollRate)
    const onError = (e: Event) => {
      const detail = eventDetail<{
        channel?: string
        error?: string
        message?: string
        status?: number | string
        transient?: boolean
      }>(e)
      const status = Number(detail.status || 0)
      const transient = detail.transient === true || isTransientGatewayError(status)
      const key = `${detail.channel || 'unknown'}:${detail.error || detail.message || ''}:${status || ''}`
      const now = Date.now()
      const minIntervalMs = transient ? 30000 : 8000
      if ((now - Number(syncErrorLogAtRef.current[key] || 0)) < minIntervalMs) return
      syncErrorLogAtRef.current[key] = now
      if (transient) {
        console.warn('[sync:transient]', detail)
        return
      }
      console.error('[sync:error]', detail)
      // The SyncErrorBanner in App.tsx picks this up via its own listener.
    }
    const onWriteBlocked = (e: Event) => {
      const detail = eventDetail<{ reason?: string }>(e)
      setSyncServerUnreachable(true)
      if (detail.reason !== 'server_not_configured') {
        setSyncConnected(false)
      }
      const now = Date.now()
      if ((now - writeBlockedNoticeAtRef.current) < 4000) return
      writeBlockedNoticeAtRef.current = now
    }
    const onRuntimeMismatch = (e: Event) => {
      const detail = eventDetail<{ backend?: { frontend?: { hash?: string } }; message?: string }>(e)
      const message = detail.message
        || 'Business OS server update is required. Restart the server, then refresh this page.'
      setSyncServerUnreachable(true)
      try {
        const runtimeHash = String(detail.backend?.frontend?.hash || '').trim()
        const recoveryKey = `${FRONTEND_BUILD_INFO.hash || 'dev'}:${runtimeHash || 'unknown'}`
        const previous = window.sessionStorage.getItem(RUNTIME_RECOVERY_SESSION_KEY)
        if (previous !== recoveryKey) {
          window.sessionStorage.setItem(RUNTIME_RECOVERY_SESSION_KEY, recoveryKey)
          const url = new URL(window.location.href)
          url.searchParams.set('__bos_reload', String(Date.now()))
          if (runtimeHash) url.searchParams.set('__bos_server_build', runtimeHash)
          window.location.replace(url.toString())
          return
        }
      } catch (_) {}
      setNotification({ message, type: 'error', id: Date.now() })
    }
    const onConflict = (e: Event) => {
      const detail = eventDetail<WriteConflictDetail>(e)
      const entity = String(detail.entity || '').trim().toLowerCase()
      let message = detail.message || 'This item changed on another device. Refresh and try again.'
      let entityLabel = 'Item'
      if (entity === 'settings') {
        message = t('settings_write_conflict') || 'Settings changed on another device. Review the latest values before saving again.'
        entityLabel = 'Settings'
        const noticeId = Date.now()
        setNotification({ message, type: 'warning', id: noticeId })
        window.setTimeout(() => {
          setNotification((current) => (current?.id === noticeId ? null : current))
        }, 8000)
        return
      } else if (entity === 'sale') {
        message = 'This sale changed on another device. Latest data is loading now.'
        entityLabel = 'Sale'
      } else if (entity === 'return') {
        message = 'This return changed on another device. Latest data is loading now.'
        entityLabel = 'Return'
      } else if (entity === 'product') {
        message = 'This product changed on another device. Latest data is loading now.'
        entityLabel = 'Product'
      } else if (entity === 'customer') {
        message = 'This customer changed on another device. Latest data is loading now.'
        entityLabel = 'Customer'
      } else if (entity === 'supplier') {
        message = 'This supplier changed on another device. Latest data is loading now.'
        entityLabel = 'Supplier'
      } else if (entity === 'delivery_contact') {
        message = 'This delivery contact changed on another device. Latest data is loading now.'
        entityLabel = 'Delivery contact'
      } else if (entity === 'branch') {
        message = 'This branch changed on another device. Latest data is loading now.'
        entityLabel = 'Branch'
      } else if (entity === 'user') {
        message = 'This user changed on another device. Latest data is loading now.'
        entityLabel = 'User'
      } else if (entity === 'role') {
        message = 'This role changed on another device. Latest data is loading now.'
        entityLabel = 'Role'
      } else if (entity === 'category') {
        message = 'This category changed on another device. Latest data is loading now.'
        entityLabel = 'Category'
      } else if (entity === 'custom table row') {
        message = 'This custom table row changed on another device. Latest data is loading now.'
        entityLabel = 'Custom table row'
      } else if (entity === 'ai_provider_config') {
        message = 'This AI provider changed on another device. Latest data is loading now.'
        entityLabel = 'AI provider'
      } else if (entity === 'unit') {
        message = 'This unit changed on another device. Latest data is loading now.'
        entityLabel = 'Unit'
      } else if (entity === 'file asset') {
        message = 'This file changed on another device. Latest data is loading now.'
        entityLabel = 'File'
      }
      const noticeId = Date.now()
      setNotification({ message, type: 'error', id: noticeId })
      window.setTimeout(() => {
        setNotification((current) => (current?.id === noticeId ? null : current))
      }, 8000)
      setWriteConflict({
        ...detail,
        entity,
        entityLabel,
        id: noticeId,
      })
    }
    const onUnauthorized = (e: Event) => {
      const detail = eventDetail<{ error?: string }>(e)
      const message = detail.error || 'Please sign in again to continue.'
      const recentAuthEstablished = Date.now() - authEstablishedAtRef.current < 8000
      const hasRecoverableSession = !!(user?.id || getStoredUserPayload())
      if (!hasRecoverableSession) {
        return
      }
      if (hasRecoverableSession && !authRecoveryRef.current && recentAuthEstablished) {
        authRecoveryRef.current = true
        window.setTimeout(async () => {
          try {
            const bootstrap = await readAppBootstrap('Auth recovery bootstrap')
            if (bootstrap?.user) {
              await applyBootstrapPayload(bootstrap, { fallbackUser: user || null })
              authRecoveryRef.current = false
              return
            }
            if (bootstrap?.unauthorized) {
              authRecoveryRef.current = false
              await handleUnauthorizedSession(bootstrap.authError || message)
              return
            }
          } catch (_) {}
          authRecoveryRef.current = false
          if (Date.now() - authEstablishedAtRef.current < 20000) {
            return
          }
          await handleUnauthorizedSession(message)
        }, 180)
        return
      }
      handleUnauthorizedSession(message).catch(() => {})
    }
    window.addEventListener('sync:update', onUpdate)
    window.addEventListener('sync:status', onStatus)
    window.addEventListener('sync:error',  onError)
    window.addEventListener('sync:write-blocked', onWriteBlocked)
    window.addEventListener('runtime:api-mismatch', onRuntimeMismatch)
    window.addEventListener('runtime:version-mismatch', onRuntimeMismatch)
    window.addEventListener('sync:conflict', onConflict)
    window.addEventListener('auth:unauthorized', onUnauthorized)
    return () => {
      clearTimeout(quickCheck)
      if (pollTimer != null) clearInterval(pollTimer)
      window.removeEventListener('sync:update', onUpdate)
      window.removeEventListener('sync:status', onStatus)
      window.removeEventListener('sync:error',  onError)
      window.removeEventListener('sync:write-blocked', onWriteBlocked)
      window.removeEventListener('runtime:api-mismatch', onRuntimeMismatch)
      window.removeEventListener('runtime:version-mismatch', onRuntimeMismatch)
      window.removeEventListener('sync:conflict', onConflict)
      window.removeEventListener('auth:unauthorized', onUnauthorized)
      Object.values(debounceRef.current).forEach((timer) => window.clearTimeout(timer))
    }
  }, [applyBootstrapPayload, handleUnauthorizedSession, loadSettings, publicMode, readAppBootstrap, t, user])

  // OTP login event listener.
  useEffect(() => {
    const handleOtpLogin = async (e: Event) => {
      const otpUser = eventDetail<AppUser & { sessionDuration?: string; sessionExpiresAt?: string; password?: unknown; otp_secret?: unknown }>(e)
      if (!otpUser) return
      const retiredTokenKey = `auth${'Token'}`
      const { password: _pw, otp_secret: _sec, [retiredTokenKey]: _retiredAuthValue, sessionDuration = 'session', ...safeUser } = otpUser

      const expiryTime = computeSessionExpiryMs(sessionDuration, otpUser.sessionExpiresAt || '')

      try {
        persistAuthState({ user: safeUser, expiryTime, sessionDuration })
        if (safeUser?.organization_slug || safeUser?.organization_public_id || safeUser?.organization_name) {
          safeStorageSet(localStorage, STORAGE_KEYS.ORGANIZATION, JSON.stringify({
            id: safeUser.organization_id || null,
            name: safeUser.organization_name || '',
            slug: safeUser.organization_slug || '',
            public_id: safeUser.organization_public_id || '',
            group_id: safeUser.organization_group_id || null,
            group_name: safeUser.organization_group_name || '',
            group_slug: safeUser.organization_group_slug || '',
          }))
        }
      } catch (_) {}

      setAuthReady(false)
      authEstablishedAtRef.current = Date.now()
      const bootstrap = await readAppBootstrap('OTP login bootstrap')
      if (bootstrap?.unauthorized) {
        await handleUnauthorizedSession(bootstrap.authError || 'Please sign in again to continue.')
      } else if (bootstrap) {
        await applyBootstrapPayload(bootstrap, { fallbackUser: safeUser })
      } else {
        setUser(safeUser)
        await loadSettings()
      }
      setAuthReady(true)
      setPage('dashboard')
    }
    window.addEventListener('otp:login', handleOtpLogin)
    return () => window.removeEventListener('otp:login', handleOtpLogin)
  }, [applyBootstrapPayload, handleUnauthorizedSession, loadSettings, readAppBootstrap])

  useEffect(() => {
    const handleUserUpdated = (e: Event) => {
      const nextUser = eventDetail<AppUser>(e)
      if (!nextUser) return
      setUser((prev: AppUser | null) => {
        if (!prev || Number(prev.id) !== Number(nextUser.id)) return prev
        const merged = { ...prev, ...nextUser }
        const expiry = getStoredUserExpiry()
        const expiryTime = expiry ? Number(expiry) : null
        const currentMode = safeStorageGet(localStorage, STORAGE_KEYS.SESSION_DURATION) || '30d'
        persistAuthState({
          user: merged,
          expiryTime: Number.isFinite(expiryTime) ? expiryTime : null,
          sessionDuration: currentMode,
        })
        return merged
      })
    }

    window.addEventListener('user:updated', handleUserUpdated)
    return () => window.removeEventListener('user:updated', handleUserUpdated)
  }, [])

  // Startup: load settings, fetch config, and health-check the server.
  const startupDone = useRef(false)
  useEffect(() => {
    if (startupDone.current) return
    startupDone.current = true

    if (publicMode) {
      setAuthReady(true)
      setSyncConnected(false)
      setSyncServerUnreachable(false)
      return
    }

    // Non-blocking async sync URL discovery activates the sync server
    // connection without blocking the initial render.
    const discoverSyncUrl = async () => {
      try {
        const storedUser = getStoredUserPayload()
        const hasStoredSession = !!storedUser
        const canProbeServerSession = typeof getAppApi().getAppBootstrap === 'function'

        if (!hasStoredSession && !canProbeServerSession) {
          setAuthReady(true)
          loadSettings()
        }

        const isViteDev = window.location.hostname === 'localhost' &&
          (window.location.port === '5173' || window.location.port === '5174')

        // When served by the backend, the current origin IS the API/WS server.
        // Never trust a stale stored URL (e.g. localhost set from a different device).
        const effectiveUrl = isViteDev
          ? sanitizeSyncServerUrl(localStorage.getItem(STORAGE_KEYS.SYNC_SERVER) || syncUrl)
          : sanitizeSyncServerUrl(window.location.origin)

        if (effectiveUrl) {
          getAppApi().setSyncServerUrl?.(effectiveUrl)

          const runStartupHealthProbe = () => {
            pingServerHealth()
              .then((result) => {
                setSyncServerUnreachable(result.cloudflareAccessRequired ? false : !result.online)
              })
              .catch(() => setSyncServerUnreachable(true))
          }

          if (canProbeServerSession) {
            if (!hasStoredSession) {
              setAuthReady(true)
              loadSettings().catch(() => {})
            }
            let settled = false
            const authReadyWatchdog = window.setTimeout(() => {
              if (settled) return
              console.warn(`[AppContext] App bootstrap is taking too long; showing ${hasStoredSession ? 'the shell with stored session data' : 'the sign-in shell'}.`)
              setAuthReady(true)
              loadSettings().catch(() => {})
            }, 10_000)
            readAppBootstrap('App bootstrap')
              .then(async (bootstrap) => {
                if (!bootstrap) {
                  runStartupHealthProbe()
                  return
                }
                if (bootstrap?.offline) {
                  setSyncServerUnreachable(true)
                  return
                }
                if (bootstrap?.unauthorized) {
                  await handleUnauthorizedSession(bootstrap.authError || 'Please sign in again to continue.')
                  setSyncServerUnreachable(false)
                  return
                }
                await applyBootstrapPayload(bootstrap)
                const runtime = bootstrap?.system?.runtime
                if (runtime && typeof runtime === 'object') {
                  primeServerHealthFromRuntime(runtime as AppRecord)
                  setSyncServerUnreachable(false)
                } else {
                  runStartupHealthProbe()
                }
              })
              .catch(() => {
                runStartupHealthProbe()
              })
              .finally(() => {
                settled = true
                window.clearTimeout(authReadyWatchdog)
                setAuthReady(true)
              })
          } else {
            runStartupHealthProbe()
          }
        } else {
          setAuthReady(true)
        }
        if (!hasStoredSession && !canProbeServerSession) {
          setAuthReady(true)
        }
        return
      } catch (e: unknown) {
        console.debug('[AppContext] discoverSyncUrl error:', getErrorMessage(e, 'unknown error'))
        setAuthReady(true)
      }

    }
    
    // Start discovery in background (no await, doesn't block UI render)
    discoverSyncUrl()
  }, [applyBootstrapPayload, handleUnauthorizedSession, publicMode, readAppBootstrap, syncUrl, loadSettings])

  // Theme and CSS variables.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
    document.documentElement.setAttribute('lang', String(language || 'en').trim() || 'en')
  }, [language, theme])

  useEffect(() => {
    let cancelled = false
    let timerId: number | null = null
    let idleId: number | null = null
    let loadListener: (() => void) | null = null
    const nextLang = String(language || 'en').trim() || 'en'
    if (fullyLoadedLangs.has(nextLang)) return undefined

    const loader = LANG_LOADERS[nextLang]
    if (!loader) return undefined

    const loadLanguagePack = () => {
      loader()
      .then((messages: TranslationPack) => {
        if (cancelled || !messages) return
        loadedLangs[nextLang] = messages
        fullyLoadedLangs.add(nextLang)
        setLangRevision((value) => value + 1)
      })
      .catch(() => {})
    }

    const scheduleDeferredLanguagePack = () => {
      const runWhenIdle = () => {
        if (cancelled) return
        if (typeof window.requestIdleCallback === 'function') {
          idleId = window.requestIdleCallback(loadLanguagePack, { timeout: 7000 })
          return
        }
        timerId = window.setTimeout(loadLanguagePack, 1200)
      }

      if (document.readyState === 'complete') {
        timerId = window.setTimeout(runWhenIdle, 900)
        return
      }

      loadListener = () => {
        timerId = window.setTimeout(runWhenIdle, 900)
      }
      window.addEventListener('load', loadListener, { once: true })
    }

    if (CORE_LANGUAGE_CODES.has(nextLang)) scheduleDeferredLanguagePack()
    else loadLanguagePack()

    return () => {
      cancelled = true
      if (timerId != null) window.clearTimeout(timerId)
      if (idleId != null && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleId)
      if (loadListener) window.removeEventListener('load', loadListener)
    }
  }, [language])

  useEffect(() => {
    const root = document.documentElement
    const radii: Record<string, string> = { sharp: '2px', rounded: '8px', pill: '16px' }
    const fonts: Record<string, string>  = {
      system:     "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Khmer', sans-serif",
      inter:      "'Inter', -apple-system, 'Noto Sans Khmer', sans-serif",
      roboto:     "'Roboto', 'Noto Sans Khmer', sans-serif",
      poppins:    "'Poppins', 'Noto Sans Khmer', sans-serif",
      open_sans:  "'Open Sans', 'Noto Sans Khmer', sans-serif",
      outfit:     "'Outfit', 'Noto Sans Khmer', sans-serif",
      mono:       "'Courier New', Courier, monospace",
      serif:      "Georgia, 'Times New Roman', serif",
      khmer:      "'Noto Sans Khmer', 'Khmer OS Siemreap', 'Battambang', sans-serif",
      hanuman:    "'Hanuman', 'Noto Sans Khmer', serif",
      battambang: "'Battambang', 'Noto Sans Khmer', sans-serif",
    }
    const fs  = settings.ui_font_size    || '14'
    const fw  = settings.ui_font_weight  || 'normal'
    const ac  = settings.ui_accent_color || '#2563eb'
    const br  = settings.ui_border_radius || 'rounded'
    const ff  = settings.ui_font_family  || 'system'
    const sbc = settings.ui_sidebar_color || ''
    const pgb = settings.ui_page_bg       || ''
    const baseSize = Math.max(12, Math.min(20, parseFloat(String(fs || '14')) || 14))
    const sidebarSize = Math.max(12, Math.min(22, parseFloat(String(settings.ui_sidebar_font_size || `${Math.round(baseSize * 0.98)}`)) || Math.round(baseSize * 0.98)))
    const titleSize = Math.max(20, Math.min(40, parseFloat(String(settings.ui_title_font_size || `${Math.round(baseSize * 1.75)}`)) || Math.round(baseSize * 1.75)))
    const sectionSize = Math.max(13, Math.min(26, parseFloat(String(settings.ui_section_font_size || `${Math.round(baseSize * 1.14)}`)) || Math.round(baseSize * 1.14)))
    const tableSize = Math.max(11, Math.min(20, parseFloat(String(settings.ui_table_font_size || `${baseSize}`)) || baseSize))
    const chipSize = Math.max(10, Math.min(18, parseFloat(String(settings.ui_chip_font_size || `${Math.max(11, Math.round(baseSize * 0.92))}`)) || Math.max(11, Math.round(baseSize * 0.92))))
    root.style.setProperty('--ui-font-size', `${baseSize}px`)
    root.style.setProperty('--ui-text-size', `${baseSize}px`)
    root.style.setProperty('--ui-sidebar-size', `${sidebarSize}px`)
    root.style.setProperty('--ui-page-title-size', `${titleSize}px`)
    root.style.setProperty('--ui-section-size', `${sectionSize}px`)
    root.style.setProperty('--ui-table-size', `${tableSize}px`)
    root.style.setProperty('--ui-chip-size', `${chipSize}px`)
    root.style.setProperty('--ui-font-weight',  fw)
    root.style.setProperty('--ui-accent',       ac)
    root.style.setProperty('--ui-accent-hover', ac + 'dd')
    root.style.setProperty('--ui-radius',       radii[br] || '8px')
    const resolvedFontFamily = (language || 'en') === 'km' && ff === 'system'
      ? fonts.khmer
      : (fonts[ff] || fonts.system)
    root.style.setProperty('--ui-font-family',  resolvedFontFamily)
    root.style.fontSize = '16px'
    document.body.style.fontFamily = resolvedFontFamily
    document.body.style.fontSize   = `${baseSize}px`
    document.body.setAttribute('data-ui-font-family', ff)
    document.body.setAttribute('data-ui-language', language || 'en')
    document.body.setAttribute('data-density', settings.ui_density || 'comfortable')
    document.body.classList.toggle('lang-km', (language || 'en') === 'km')
    document.body.classList.toggle('lang-en', (language || 'en') !== 'km')

    // Sidebar and page background color overrides.
    // Dark-mode CSS sets background-color !important on aside/body.
    // Inline styles can't beat !important, so we inject a <style> tag
    // that wins in both light and dark mode without touching the theme rules.
    const hexAlpha = (hex: string, a: number): string => {
      const n = parseInt(hex.replace('#',''), 16)
      if (isNaN(n)) return hex
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
      return `rgba(${r},${g},${b},${a})`
    }
    let styleEl = document.getElementById('bos-color-overrides')
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = 'bos-color-overrides'
      document.head.appendChild(styleEl)
    }
    let css = ''
    if (sbc) {
      const border = hexAlpha(sbc, 0.18)
      // Sidebar color override.
      // We build both plain and .dark-prefixed selectors so our injected
      // <style> (which is appended to <head> AFTER the compiled stylesheet)
      // beats every !important rule in main.css via source-order, regardless
      // of whether the user has dark-mode enabled.
      const sidebarSels = [
        'aside',
        'header.fixed',
        'header.md\\:hidden',
        'nav.fixed',
        'nav[class*="fixed bottom"]',
        'nav[class*="bottom-0"]',
      ]
      const allSidebarSels = [
        ...sidebarSels,
        ...sidebarSels.map(s => `.dark ${s}`),
      ].join(', ')
      css += `${allSidebarSels} { background-color: ${sbc} !important; border-color: ${border} !important; }\n`
      css += `aside > div, .dark aside > div { border-color: ${border} !important; }\n`
    }
    if (pgb) {
      // Page background color override.
      // Cover every container that could show a white/dark fallback:
      //   body            - root background
      //   #app-root       - full-screen flex wrapper (has Tailwind bg-gray-50)
      //   #app-root > main - the <main> flex child holding all page divs
      //   .page-scroll    - each page's own scrollable root div
      // Repeating with .dark prefix overrides ".dark .bg-gray-50 { !important }"
      // in main.css, which uses a class selector (specificity 0-1-0) - same as
      // ours, so source order wins and ours is later.
      const bgSels = ['body', '#app-root', '#app-root > main', '.page-scroll']
      const allBgSels = [
        ...bgSels,
        ...bgSels.map(s => `.dark ${s}`),
      ].join(', ')
      css += `${allBgSels} { background-color: ${pgb} !important; }\n`
    }
    styleEl.textContent = css
  }, [language, settings])

  // Sync URL management.
  const updateSyncUrl = useCallback((url: unknown) => {
    const clean = sanitizeSyncServerUrl(url)
    try { clean ? localStorage.setItem(STORAGE_KEYS.SYNC_SERVER, clean) : localStorage.removeItem(STORAGE_KEYS.SYNC_SERVER) } catch (_) {}
    _setSyncUrl(clean)
    getAppApi().setSyncServerUrl?.(clean || null)
    if (clean) startHealthCheck()
  }, [])

  // Authentication helpers.
  const persistAuthenticatedUser = useCallback(async (nextUser: AppUser, sessionDuration = 'session', sessionExpiresAt = ''): Promise<void> => {
    const expiryTime = computeSessionExpiryMs(sessionDuration, sessionExpiresAt)

    try {
      persistAuthState({ user: nextUser, expiryTime, sessionDuration })
      if (nextUser?.organization_slug || nextUser?.organization_public_id || nextUser?.organization_name) {
        safeStorageSet(localStorage, STORAGE_KEYS.ORGANIZATION, JSON.stringify({
          id: nextUser.organization_id || null,
          name: nextUser.organization_name || '',
          slug: nextUser.organization_slug || '',
          public_id: nextUser.organization_public_id || '',
          group_id: nextUser.organization_group_id || null,
          group_name: nextUser.organization_group_name || '',
          group_slug: nextUser.organization_group_slug || '',
        }))
      }
      const knownServerStartTime = safeStorageGet(localStorage, STORAGE_KEYS.SERVER_START_TIME)
      if (knownServerStartTime) {
        safeStorageSet(localStorage, STORAGE_KEYS.SERVER_START_TIME, knownServerStartTime)
      }
    } catch (_) {}

    setAuthReady(false)
    cacheClearAll()
    getAppApi().ensureSessionRecoveryListeners?.()
    reconnectWS()
    startHealthCheck()
    authEstablishedAtRef.current = Date.now()
    setUser(nextUser)
    const bootstrap = await readAppBootstrap('Login bootstrap')
    if (bootstrap?.unauthorized) {
      await handleUnauthorizedSession(bootstrap.authError || 'Please sign in again to continue.')
    } else if (bootstrap) {
      await applyBootstrapPayload(bootstrap, { fallbackUser: nextUser })
    } else {
      await loadSettings()
    }
    setAuthReady(true)
    setPage('dashboard')
  }, [applyBootstrapPayload, handleUnauthorizedSession, loadSettings, readAppBootstrap])

  const login = useCallback(async (username: string, password: string, sessionDuration = 'session', organization = ''): Promise<AuthResult> => {
    try {
      const device = getClientDeviceInfo()
      const api = getAppApi()
      const result = await withLoaderTimeout(
        () => api.login?.({
          username, password, organization,
          sessionDuration,
          clientTime: new Date().toISOString(),
          deviceTz: device.deviceTz,
          deviceName: device.deviceName,
        }),
        'Login',
        APP_LOGIN_TIMEOUT_MS,
      )
      if (!result) return { success: false, error: 'Login API is not available' }
      if (result.success && result.user) {
        await persistAuthenticatedUser(result.user, sessionDuration, result.sessionExpiresAt || '')
      }
      return result
    } catch (e: unknown) {
      const message = getErrorMessage(e)
      const isNet = ['fetch', 'ECONNREFUSED', 'NetworkError', 'Failed to fetch']
        .some(s => message.includes(s))
      return {
        success: false,
        error: isNet
          ? 'Cannot reach sync server. Check the URL in Settings -> Server, or clear it to use local mode.'
          : (message || 'Login failed'),
      }
    }
  }, [persistAuthenticatedUser])

  const logout = useCallback(async () => {
    try {
      const api = getAppApi()
      await withLoaderTimeout(() => api.logout?.(), 'Logout', APP_LOGOUT_TIMEOUT_MS)
    } catch (_) {}
    await clearLocalBusinessState({
      clearAuth: true,
      preserveSyncServer: true,
      preserveSessionDuration: true,
      preserveRuntimeMeta: true,
    })
    setUser(null)
    setAuthReady(true)
    setPage('dashboard')
    clearPersistedAuthState()
  }, [clearLocalBusinessState])

  // Notifications.
  const notify = useCallback((message: unknown, type: NotificationKind | string = 'success', duration = 3500) => {
    const normalizedMessage = String(message || '').trim()
    const now = Date.now()
    const last = lastNotificationRef.current
    if (
      normalizedMessage
      && last.message === normalizedMessage
      && last.type === type
      && (now - last.at) < 2500
    ) {
      return
    }
    lastNotificationRef.current = { message: normalizedMessage, type, at: now }
    setNotification({ message: normalizedMessage, type, id: now })
    setTimeout(() => {
      setNotification((current) => (current?.id === now ? null : current))
    }, duration)
  }, [])

  const dismissWriteConflict = useCallback(() => {
    setWriteConflict(null)
    setNotification(null)
  }, [])

  const reloadWriteConflict = useCallback(async () => {
    const detail = writeConflict
    if (!detail) return

    const refreshChannels = Array.isArray(detail.refreshChannels) ? detail.refreshChannels : []
    if (detail.entity === 'settings') {
      await loadSettings({ force: true }).catch(() => {})
    }
    refreshChannels.forEach((channel) => {
      window.dispatchEvent(new CustomEvent('sync:update', {
        detail: { channel, reason: 'write-conflict-reload-latest', ts: Date.now() },
      }))
    })
    setWriteConflict(null)
    setNotification(null)
  }, [loadSettings, writeConflict])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const url = new URL(window.location.href)
    const mode = String(url.searchParams.get('auth_mode') || '').trim().toLowerCase()
    if (mode !== 'link') return undefined

    const hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''))
    const accessToken = hash.get('access_token') || ''
    const provider = String(url.searchParams.get('auth_provider') || '').trim().toLowerCase()
    const errorDescription = hash.get('error_description') || url.searchParams.get('error_description') || ''
    const callbackResult = readOauthCallbackResult()
    const matchingStoredCallback = callbackResult
      && String(callbackResult.mode || '').trim().toLowerCase() === 'link'
      && (!provider || String(callbackResult.provider || '').trim().toLowerCase() === provider)
    if (!accessToken && !errorDescription && !matchingStoredCallback) return undefined

    let cancelled = false
    const clearCallbackUrl = () => {
      const cleanUrl = `${url.origin}${url.pathname}`
      window.history.replaceState({}, document.title, cleanUrl)
    }
    const clearPendingLink = () => {
      clearPendingOauthLink()
    }

    const run = async () => {
      if (matchingStoredCallback) {
        clearCallbackUrl()
        clearPendingLink()
        clearOauthCallbackResult()
        if (cancelled) return
        if (callbackResult.status === 'success' && callbackResult.user) {
          window.dispatchEvent(new CustomEvent('user:updated', { detail: callbackResult.user }))
          notify(t('identity_linked_success') || 'Sign-in method connected.', 'success')
          return
        }
        notify(callbackResult.error || (t('identity_link_failed') || 'Failed to connect sign-in method.'), 'error')
        return
      }

      if (errorDescription) {
        clearCallbackUrl()
        clearPendingLink()
        clearOauthCallbackResult()
        if (!cancelled) notify(errorDescription, 'error')
        return
      }

      let pendingLink = null
      pendingLink = readPendingOauthLink()

      let actorId = Number(user?.id || 0)
      if (!actorId && pendingLink?.userId) actorId = Number(pendingLink.userId || 0)
      if (!actorId) {
        try {
          const storedUser = JSON.parse(localStorage.getItem(STORAGE_KEYS.USER) || 'null')
          if (storedUser?.id) actorId = Number(storedUser.id || 0)
        } catch (_) {}
      }

      if (!actorId) {
        return
      }

      try {
        const device = getClientDeviceInfo()
        let rememberedOrg = ''
        try {
          const storedOrg = JSON.parse(localStorage.getItem(STORAGE_KEYS.ORGANIZATION) || 'null')
          rememberedOrg = storedOrg?.public_id || storedOrg?.slug || ''
        } catch (_) {}
        const api = getAppApi()
        const result = await withLoaderTimeout(
          () => api.completeGoogleOauth?.({
            accessToken,
            provider,
            mode: 'link',
            currentUserId: actorId,
            organization: rememberedOrg,
            clientTime: new Date().toISOString(),
            deviceTz: device.deviceTz,
            deviceName: device.deviceName,
          }),
          'Complete Google OAuth',
          APP_GOOGLE_OAUTH_COMPLETE_TIMEOUT_MS,
        )
        clearCallbackUrl()
        clearPendingLink()
        clearOauthCallbackResult()
        if (cancelled) return
        if (result?.success && result?.user) {
          window.dispatchEvent(new CustomEvent('user:updated', { detail: result.user }))
          notify(t('identity_linked_success') || 'Sign-in method connected.', 'success')
          return
        }
        notify(result?.error || (t('identity_link_failed') || 'Failed to connect sign-in method.'), 'error')
      } catch (error: unknown) {
        clearCallbackUrl()
        clearPendingLink()
        clearOauthCallbackResult()
        if (!cancelled) {
          notify(getErrorMessage(error, t('identity_link_failed') || 'Failed to connect sign-in method.'), 'error')
        }
      }
    }

    run()
    return () => { cancelled = true }
  }, [notify, t, user])

  const applyDeviceSettings = useCallback((updates: AppSettings = {}) => {
    const nextUpdates = updates && typeof updates === 'object' ? updates : {}
    if (!Object.keys(nextUpdates).length) return

    const nextDeviceSettings = { ...readDeviceSettings(), ...nextUpdates }
    writeDeviceSettings(nextDeviceSettings)
    setSettings((previous) => ({ ...previous, ...nextUpdates }))

    if (Object.prototype.hasOwnProperty.call(nextUpdates, 'login_session_duration')) {
      writeStoredSessionDuration(nextUpdates.login_session_duration)
    }
    if (Object.prototype.hasOwnProperty.call(nextUpdates, 'language')) {
      setLanguage(String(nextUpdates.language || 'en').trim() || 'en')
    }
    if (Object.prototype.hasOwnProperty.call(nextUpdates, 'theme')) {
      setTheme(String(nextUpdates.theme || 'light').trim() || 'light')
    }
  }, [])

  // Settings save.
  const saveSettings = useCallback(async (newSettings: AppSettings, options: SettingsWriteOptions = {}) => {
    const normalizedOptions = normalizeSettingsWriteOptions(options)
    try {
      const nextSettings = newSettings || {}
      const serverUpdates: AppSettings = {}
      const deviceUpdates: AppSettings = {}
      Object.entries(nextSettings).forEach(([key, value]) => {
        if (DEVICE_LOCAL_SETTING_KEYS.has(key)) deviceUpdates[key] = value
        else serverUpdates[key] = value
      })

      if (Object.keys(serverUpdates).length) {
        const api = getAppApi()
        const serverResult = await withLoaderTimeout(
          () => api.saveSettings?.(serverUpdates, normalizedOptions),
          'Save settings',
          APP_SETTINGS_SAVE_TIMEOUT_MS,
        )
        if (serverResult && 'conflict' in serverResult && serverResult.conflict) return serverResult
      }
      if (Object.keys(deviceUpdates).length) {
        applyDeviceSettings(deviceUpdates)
        if (normalizedOptions.refreshChannels.length) {
          refreshAppData(normalizedOptions.refreshChannels, {
            reason: normalizedOptions.reason || 'settings-saved',
            source: normalizedOptions.source || 'settings:save',
          })
        }
      }
      const mergedUpdates = { ...serverUpdates, ...deviceUpdates }
      if (Object.prototype.hasOwnProperty.call(mergedUpdates, 'login_session_duration')) {
        const normalizedSessionDuration = writeStoredSessionDuration(mergedUpdates.login_session_duration)
        const api = getAppApi()
        if (user?.id && typeof api.updateSessionDuration === 'function') {
          const device = getClientDeviceInfo()
          const refreshed = await withLoaderTimeout(
            () => api.updateSessionDuration?.({
              sessionDuration: normalizedSessionDuration,
              clientTime: new Date().toISOString(),
              deviceTz: device.deviceTz,
              deviceName: device.deviceName,
            }),
            'Refresh session duration',
            APP_SESSION_DURATION_TIMEOUT_MS,
          )
          if (refreshed?.success === false) {
            throw new Error(refreshed.error || 'Failed to refresh login session duration')
          }
          const nextExpiryTime = computeSessionExpiryMs(
            normalizedSessionDuration,
            refreshed?.sessionExpiresAt || '',
          )
          persistAuthState({
            user,
            expiryTime: nextExpiryTime,
            sessionDuration: normalizedSessionDuration,
          })
        }
      }
      if (Object.keys(serverUpdates).length) {
        setSettings((prev) => ({ ...prev, ...serverUpdates }))
      }
      if (!normalizedOptions.silentToast) notify(t('settings_saved'))
      return { success: true }
    } catch (error: unknown) {
      const detail = error && typeof error === 'object' ? error as WriteConflictDetail : {}
      if (detail.conflict || detail.code === 'write_conflict' || detail.code === 'settings_conflict') {
        return {
          success: false,
          conflict: true,
          code: detail.code || 'settings_conflict',
          currentSettings: detail.currentSettings || detail.current || {},
          actualUpdatedAt: detail.actualUpdatedAt || null,
          expectedUpdatedAt: detail.expectedUpdatedAt || null,
          attempted: detail.attempted || newSettings || {},
        }
      }
      if (!normalizedOptions.silentToast) {
        notify(getErrorMessage(error, 'Failed to save settings'), 'error')
      }
      return { success: false, error }
    }
  }, [applyDeviceSettings, notify, t, user]) // eslint-disable-line

  const toggleTheme = useCallback(() => {
    applyDeviceSettings({ theme: theme === 'dark' ? 'light' : 'dark' })
  }, [applyDeviceSettings, theme])

  const toggleLanguage = useCallback(() => {
    applyDeviceSettings({ language: language === 'km' ? 'en' : 'km' })
  }, [applyDeviceSettings, language])

  // Permissions.
  const getPermissions = useCallback((): Record<string, boolean> => {
    if (!user) return {}
    try {
      const parsed = parsePermissionMap(user.permissions)
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, value === true]),
      )
    } catch {
      return {}
    }
  }, [user])

  const hasPermission = useCallback((key: string) => {
    if (!user) return false
    const p = getPermissions()
    return !!(p.all || p[key])
  }, [user, getPermissions])

  const canAccessPage = useCallback((pageId: string) => {
    if (!user) return false
    const required = PAGE_PERMISSIONS[pageId]
    if (required == null) return true
    return hasPermission(required)
  }, [user, hasPermission])

  const navigateTo = useCallback((pageId: string) => {
    if (!canAccessPage(pageId)) return
    if (typeof window !== 'undefined') {
      const nextPath = getAdminPathForPage(pageId)
      const currentUrl = new URL(window.location.href)
      if (nextPath && currentUrl.pathname !== nextPath) {
        window.history.pushState(window.history.state, '', `${nextPath}${currentUrl.search}${currentUrl.hash}`)
      }
      window.dispatchEvent(new CustomEvent(APP_NAVIGATION_EVENT, {
        detail: {
          page: pageId,
          path: nextPath,
        },
      }))
    }
    startTransition(() => {
      setPage(pageId)
    })
  }, [canAccessPage])

  // Currency helpers.
  const exchangeRate    = parseFloat(String(settings.exchange_rate || '4100'))
  const usdSymbol       = String(settings.currency_usd_symbol || '$')
  const khrSymbol       = String(settings.currency_khr_symbol || 'KHR')
  const displayCurrency = String(settings.display_currency || 'USD').trim().toLowerCase()
  const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const displayTimezone = String(settings.display_timezone || deviceTimezone)

  const fmtUSD = useCallback((n: unknown): string => {
    return `${usdSymbol}${normalizePriceValue(n || 0).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 })}`
  }, [usdSymbol])
  const fmtKHR = useCallback((n: unknown): string => {
    return `${normalizePriceValue(n || 0).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 })}${khrSymbol}`
  }, [khrSymbol])
  const formatPrice = useCallback((usd: unknown, khr?: unknown): string => {
    const u = normalizePriceValue(usd || 0)
    const k = khr != null ? normalizePriceValue(khr) : u * exchangeRate
    if (displayCurrency === 'khr') return fmtKHR(k)
    if (displayCurrency === 'both') return `${fmtUSD(u)} / ${fmtKHR(k)}`
    return fmtUSD(u)
  }, [displayCurrency, fmtUSD, fmtKHR, exchangeRate])
  const usdToKhr = useCallback((usd: unknown): number => normalizePriceValue(usd || 0) * exchangeRate, [exchangeRate])
  const khrToUsd = useCallback((khr: unknown): number => normalizePriceValue(khr || 0) / exchangeRate, [exchangeRate])
  const formatDateTime = useCallback((value: unknown, options: Intl.DateTimeFormatOptions = {}): string => {
    const date = normalizeDateInput(value)
    if (!date) return '--'
    return date.toLocaleString(undefined, {
      hour12: false,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: displayTimezone,
      ...options,
    })
  }, [displayTimezone])

  const canWriteToServer = !!syncUrl && !syncServerUnreachable

  const appValue: AppContextValue = {
    user, login, logout, persistAuthenticatedUser,
    authReady,
    page, setPage, navigateTo,
    settings, loadSettings, saveSettings,
    language, theme, t,
    toggleTheme, toggleLanguage,
    notify, notification,
    writeConflict, dismissWriteConflict, reloadWriteConflict,
    hasPermission, canAccessPage, getPermissions,
    formatPrice, fmtUSD, fmtKHR,
    usdSymbol, khrSymbol, displayCurrency, exchangeRate,
    usdToKhr, khrToUsd,
    displayTimezone, deviceTimezone, formatDateTime,
    syncUrl, updateSyncUrl,
    // Expose sync status so components that use useApp() (legacy) can read it.
    syncConnected,
    syncChannel,
    syncServerUnreachable,
    canWriteToServer,
    AccessDenied: () => <AccessDenied t={t} />,
  }

  const syncValue: SyncContextValue = {
    syncConnected,
    syncChannel,
    syncServerUnreachable,
  }

  return (
    <AppContext.Provider value={appValue}>
      <SyncContext.Provider value={syncValue}>
        {children}
      </SyncContext.Provider>
    </AppContext.Provider>
  )
}

const FALLBACK_SYNC_CONTEXT: SyncContextValue = {
  syncConnected: false,
  syncChannel: null,
  syncServerUnreachable: false,
}

const FALLBACK_APP_CONTEXT: AppContextValue = {
  user: null,
  login: async () => ({ success: false, error: 'App context not ready' }),
  logout: async () => {},
  persistAuthenticatedUser: async () => {},
  authReady: true,
  page: 'dashboard',
  setPage: () => {},
  navigateTo: () => {},
  settings: {},
  loadSettings: async () => ({}),
  saveSettings: async () => ({ success: false, error: 'Settings are not ready yet' }),
  language: 'en',
  theme: 'light',
  t: (key: string) => key,
  toggleTheme: () => {},
  toggleLanguage: () => {},
  notify: () => {},
  notification: null,
  writeConflict: null,
  dismissWriteConflict: () => {},
  reloadWriteConflict: async () => {},
  hasPermission: () => false,
  canAccessPage: () => true,
  getPermissions: () => ({}),
  formatPrice: (value: unknown) => String(value ?? ''),
  fmtUSD: (value: unknown) => `$${normalizePriceValue(value || 0).toFixed(2)}`,
  fmtKHR: (value: unknown) => `${normalizePriceValue(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KHR`,
  usdSymbol: '$',
  khrSymbol: 'KHR',
  displayCurrency: 'usd',
  exchangeRate: 4000,
  usdToKhr: (value: unknown) => Number(value || 0) * 4000,
  khrToUsd: (value: unknown) => Number(value || 0) / 4000,
  displayTimezone: 'UTC',
  deviceTimezone: 'UTC',
  formatDateTime: (value: unknown) => String(value || ''),
  syncUrl: '',
  updateSyncUrl: () => {},
  syncConnected: false,
  syncChannel: null,
  syncServerUnreachable: false,
  canWriteToServer: false,
  AccessDenied: () => null,
}

export const useApp = (): unknown => useContext(AppContext) || FALLBACK_APP_CONTEXT
export const useSync = (): unknown => useContext(SyncContext) || FALLBACK_SYNC_CONTEXT

// Helper hook: gather translations for a list of keys once per render
export const useT = (keys: string[] = []): Record<string, string> => {
  const ctx = _useContext(AppContext)
  const tfn = ctx?.t || ((k: string) => k)
  return useMemo(() => {
    const map: Record<string, string> = {}
    for (const k of keys) map[k] = tfn(k)
    return map
  }, [tfn, keys.join('|')])
}
