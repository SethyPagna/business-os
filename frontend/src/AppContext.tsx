import { useState, useEffect, useCallback, useRef, useMemo, startTransition } from 'react'
import type { ReactNode } from 'react'
import { BUSINESS_TIME_ZONE, STORAGE_KEYS, SYNC } from './constants'
import { cacheClearAll, ensureSyncUpdateCacheListener, FRONTEND_BUILD_INFO, isTransientGatewayError, pingServerHealth, primeServerHealthFromRuntime, startHealthCheck } from './api/http.ts'
import {
  normalizeRuntimeDescriptor,
  readStoredRuntimeDescriptor,
  resetClientRuntimeState,
  sanitizeSyncServerUrl,
  shouldResetForRuntimeChange,
  writeStoredRuntimeDescriptor,
} from './platform/runtime/clientRuntime.ts'
import { isWSConnected, resumeWS } from './api/websocket.ts'
import { requestPersistentAppStorage } from './api/syncRuntime.ts'
import { APP_NAVIGATION_EVENT, getAdminPageFromPath, getAdminPathForPage, resolveAdminLandingPage } from './app/pathRouting.ts'
import { getClientDeviceInfo } from './utils/deviceInfo.ts'
import { getDirtyWork, hasDirtyWork, type DirtyWorkEntry } from './utils/dirtyWork.ts'
import { flushPendingWorkDrafts } from './utils/workDrafts.ts'
import { parsePermissionMap, getPermissionTierFromMap, type PermissionTier } from './utils/permissions.ts'
import { actionAllowed, isActionOverriddenOff } from './utils/permissionActions.ts'
import { normalizePriceValue } from './utils/pricing.ts'
import { withLoaderTimeout } from './utils/loaders.ts'
import { refreshAppData } from './utils/appRefresh.ts'
import { normalizeSettingsWriteOptions } from './utils/settingsWriteOptions.ts'
import type { SettingsWriteOptions } from './types/settingsContracts.ts'
import {
  AppContext,
  SyncContext,
  isBrokenLocalizedString,
  useApp,
  useSync,
  useT,
  type AppContextCoreValue,
} from './app/AppContextCore.tsx'

/** Muted-gold accent; must equal the fallback in styles/tokens.css and main.css :root --ui-accent. */
export const DEFAULT_UI_ACCENT = '#9c7a3c'

export { isBrokenLocalizedString, useApp, useSync, useT }

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
  sessionExpiresAt?: string
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
  dismissNotification: () => void
  dismissWriteConflict: () => void
  displayCurrency: string
  displayTimezone: string
  exchangeRate: number
  fmtKHR: (value: unknown) => string
  fmtUSD: (value: unknown) => string
  formatDateTime: (value: unknown, options?: Intl.DateTimeFormatOptions) => string
  formatPrice: (usd: unknown, khr?: unknown) => string
  getPermissions: () => Record<string, boolean>
  getPermissionTier: (key: string) => PermissionTier
  hasPermission: (key: string) => boolean
  /** Per-action gate -- see AppContext's own can() comment and utils/permissionActions.ts. */
  can: (permissionKey: string, actionKey: string) => boolean
  khrSymbol: string
  khrToUsd: (value: unknown) => number
  language: string
  loadSettings: (options?: { force?: boolean }) => Promise<AppSettings>
  login: (username: string, password: string, sessionDuration?: string, organization?: string) => Promise<AuthResult>
  logout: () => Promise<void>
  navigateTo: (pageId: string, anchor?: string) => void
  // N2 navigation guard: pending target + the dirty entries blocking it,
  // and the resolver App.tsx's modal calls with the user's choice.
  navGuard: { pageId: string; anchor?: string; entries: DirtyWorkEntry[] } | null
  resolveNavGuard: (action: 'save' | 'discard' | 'stay') => Promise<void>
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
  branches: 'Branch',
  cart: 'Cart',
  cart_empty: 'Cart is empty',
  cancel: 'Cancel',
  categories: 'Categories',
  close: 'Close',
  completed: 'Completed',
  contacts: 'Contacts',
  cogs: 'COGS',
  cogs_header: 'COGS',
  cost: 'Cost',
  cost_in_purchase: 'Cost In (Purchase)',
  current_stock: 'Current Stock',
  custom: 'Custom',
  customer_portal: 'Customer Portal',
  dashboard: 'Dashboard',
  delete: 'Delete',
  details: 'Details',
  done: 'Done',
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
  promotions: 'Promotions',
  movements: 'Movements',
  next: 'Next',
  no_recent_actions: 'No recent actions',
  net_sold: 'Net Sold',
  net_sold_header: 'Net Sold',
  offline_mode: 'Offline mode',
  offline_mode_active: 'Offline mode: sales are saved on this device and will sync when the server reconnects.',
  offline_mode_ready_sync: 'Server is back online. Offline actions can sync now.',
  page: 'Page',
  pending: 'pending',
  point_of_sale: 'POS',
  pos_delivery: 'Delivery',
  previous: 'Previous',
  product: 'Product',
  product_name: 'Product Name',
  products: 'Products',
  profit: 'Profit',
  profit_header: 'Profit',
  quantity: 'Quantity',
  receipt_settings: 'Receipt Settings',
  redo: 'Redo',
  returns: 'Returns',
  revenue: 'Revenue',
  revenue_header: 'Revenue',
  sales: 'Sales',
  save: 'Save',
  search: 'Search',
  select_all: 'Select all',
  selling_price_label: 'Selling Price',
  server_back_online: 'Server is back online. You can keep working.',
  server_reconnecting: 'Server reconnecting',
  server_tunnel_reconnecting: 'Server/tunnel reconnecting. Cached data stays visible and read-only checks will refresh automatically.',
  settings: 'Settings',
  stock: 'Stock',
  stock_status: 'Stock',
  stock_val: 'Stock Val',
  stock_value: 'Stock Value',
  status: 'Status',
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
const CORE_LANGUAGE_PACK_IDLE_TIMEOUT_MS = 20000

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
  dashboard:        'dashboard',
  notes:            null,        // Personal scratchpad -- just needs to be logged in, same as dashboard used to be
  catalog:          'customer_portal',
  promotions:       'promotions',
  pos:              'pos',
  products:         'products',
  // inventory page row removed (E1): the PAGE id retired into the Branches
  // hub; the 'inventory' permission key lives on and gates the hub's
  // stats/products/movements/rfid chips inside BranchesHubPage.
  branches:         'branches',  // Split from 'inventory' -- own key now, see navigationConfig.ts's note
  sales:            'sales',
  contacts:         'contacts',  // Requires explicit contacts permission
  review:           'review',  // Review/Approval queue page -- Full Access only, own explicit key (see navigationConfig.ts's own note)
  settings:         'settings',
  files:            null,        // Library view is unconditional for any authenticated user (this session) -- matches navigationConfig.ts's own null gate; upload/download/rename/delete still self-gate inside FilesPage.tsx/files.ts on real Full Access to `library`
  receipt_settings: 'settings',  // was 'all' (super-admin only); Settings.tsx already exposes the core receipt fields (tax_rate, footer) to any 'settings' user inline, so gating the fuller standalone page behind 'all' was an inconsistency, not a deliberate restriction -- aligned with its sibling settings sub-pages (files/server)
  // returns/fees page rows removed (E2): both PAGE ids retired into the
  // Sales hub. Their PERMISSION keys live on unchanged -- the split noted
  // here previously ("returns was 'sales' -- own key so they can be granted
  // independently") still holds; it's only the standalone pages that are
  // gone. canAccessPage's sales-door widening below is the other half.
  server:           'settings',
}

function getInitialAdminPage(publicMode: boolean): string {
  if (publicMode || typeof window === 'undefined') return 'dashboard'
  return getAdminPageFromPath(window.location.pathname) || 'dashboard'
}

function LoadingScreen() {
  // Used during the very first bootstrap before settings/user state are ready.
  return (
    <div style={{ minHeight:'var(--app-vh-100, 100vh)', display:'flex', alignItems:'center', justifyContent:'center', background:'#1e3a8a', fontFamily:'sans-serif' }}>
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
    // A user can still be authenticated by the httpOnly server cookie even
    // when local/session storage is empty. Keep the secure shell up until the
    // bootstrap probe confirms whether that cookie belongs to a valid session;
    // otherwise the login route briefly mounts and downloads auth UI on normal
    // admin startup.
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
      // A transient mirrored/offline read can legitimately resolve to an
      // empty object before its local cache is hydrated. Do not replace an
      // already-rendered settings form with that empty payload: it makes the
      // Settings page appear to reset until the user manually refreshes.
      const currentSettings = settingsRef.current && typeof settingsRef.current === 'object' ? settingsRef.current : {}
      const sourceSettings = serverSettings && Object.keys(serverSettings).length
        ? serverSettings
        : (Object.keys(currentSettings).length ? currentSettings : {})
      const mergedSettings = mergeSettingsWithDeviceOverrides(sourceSettings)
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
    preserveOfflineWork?: boolean
    preserveUiDrafts?: boolean
  } = {}) => {
    await resetClientRuntimeState({
  // Authentication helpers.
      preserveDeviceSettings: true,
      preserveSyncServer: options.preserveSyncServer !== false,
      preserveSessionDuration: options.preserveSessionDuration !== false,
      preserveRuntimeMeta: options.preserveRuntimeMeta === true,
      preserveOrganization: options.preserveOrganization === true,
      preserveOfflineWork: options.preserveOfflineWork === true,
      preserveServiceWorker: options.preserveOfflineWork === true,
      preserveUiDrafts: options.preserveUiDrafts === true,
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
      preserveOfflineWork: true,
      preserveUiDrafts: true,
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

    // Same guard loadSettings has: the offline / invalid-session / recovery
    // bootstrap fallbacks legitimately carry `settings: {}` — replacing live
    // server settings with that empty blob mid-session silently reverts every
    // settings-driven surface to defaults (POS exchange rates, payment
    // methods, receipt settings) and blanks the Settings form. Keep what we
    // already have unless the payload actually brought settings.
    const payloadSettings = safePayload?.settings && typeof safePayload.settings === 'object'
      ? safePayload.settings as AppSettings
      : {}
    const currentSettings = settingsRef.current && typeof settingsRef.current === 'object'
      ? settingsRef.current
      : {}
    const mergedSettings = mergeSettingsWithDeviceOverrides(
      Object.keys(payloadSettings).length ? payloadSettings : currentSettings,
    )

    setSettings(mergedSettings)
    if (mergedSettings.login_session_duration) {
      writeStoredSessionDuration(mergedSettings.login_session_duration)
    }
    if (mergedSettings.language) setLanguage(mergedSettings.language)
    if (mergedSettings.theme) setTheme(mergedSettings.theme)

    if (nextUser) {
      // A cold iOS relaunch can retain the HttpOnly session cookie while the
      // previous browsing context's sessionStorage is gone. Recreate the
      // client-side session marker before starting WS/maintenance; both are
      // intentionally gated on that marker on the protected admin host.
      const sessionDuration = String(
        mergedSettings.login_session_duration
        || safeStorageGet(localStorage, STORAGE_KEYS.SESSION_DURATION)
        || 'session',
      )
      const storedExpiry = Number(getStoredUserExpiry())
      const expiryTime = Number.isFinite(storedExpiry) && storedExpiry > Date.now()
        ? storedExpiry
        : computeSessionExpiryMs(sessionDuration, safePayload.sessionExpiresAt || '')
      persistAuthState({ user: nextUser, expiryTime, sessionDuration })
      setUser(nextUser)
      getAppApi().ensureSessionRecoveryListeners?.()
      resumeWS()
      startHealthCheck()
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
      const detail = eventDetail<{ channel?: string; reason?: string | null; source?: string | null; payload?: { action?: string; id?: string | number } | null }>(e)
      const channel = String(detail.channel || '')
      if (!channel) return
      if (debounceRef.current[channel]) clearTimeout(debounceRef.current[channel])
      debounceRef.current[channel] = window.setTimeout(async () => {
        delete debounceRef.current[channel]
        // Settings changes from other devices apply immediately; no reload needed.
        if (channel === 'settings') loadSettings().catch(() => {})
        // Live permission propagation. Was: a 'users'/'roles' broadcast
        // (fired by every PATCH /api/users/:id and PATCH /api/roles/:id --
        // see cloudflare/src/routes/users.ts) only ever invalidated that
        // page's own list cache here. It never touched the CURRENT
        // session's own `user.permissions`/`user.role_permissions` --
        // those only get re-read from the server on the 'runtime' branch
        // below, or a fresh login. So an already-logged-in employee whose
        // permissions (or whose role's permissions) an admin edited on
        // another device kept running on their stale, cached permission
        // set until they logged out and back in -- exactly "permission
        // changes don't take effect for employees" and the follow-on
        // "POS stops showing products", since hasPermission()/
        // canAccessPage() read straight off that stale `user` object.
        // Fixed by re-fetching the session (same bootstrap path 'runtime'
        // already uses) whenever the broadcast's own id says it actually
        // affects THIS session -- the edited user's id for 'users', or
        // this user's own role_id for 'roles' -- rather than for every
        // unrelated user/role edit anyone makes.
        const payloadId = detail.payload?.id
        const currentUserId = user?.id != null ? String(user.id) : null
        const currentRoleId = (user as { role_id?: string | number | null } | null)?.role_id
        const affectsThisSession =
          (channel === 'users' && payloadId != null && currentUserId != null && String(payloadId) === currentUserId) ||
          (channel === 'roles' && payloadId != null && currentRoleId != null && String(payloadId) === String(currentRoleId))
        if (channel === 'runtime' || affectsThisSession) {
          await clearLocalBusinessState({
            clearAuth: false,
            preserveSyncServer: true,
            preserveSessionDuration: true,
            preserveOfflineWork: true,
            preserveUiDrafts: true,
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
      // iOS may ignore beforeunload prompts. Keep the current build running
      // when an editor is dirty and persist any debounced draft immediately;
      // the next clean recovery event can safely reload the new runtime.
      if (hasDirtyWork()) {
        flushPendingWorkDrafts()
        setNotification({
          message: 'An app update is ready. Save or discard unfinished work before reloading.',
          type: 'warning',
          id: Date.now(),
        })
        return
      }
      try {
        const runtimeHash = String(detail.backend?.frontend?.hash || '').trim()
        const recoveryKey = `${FRONTEND_BUILD_INFO.hash || 'dev'}:${runtimeHash || 'unknown'}`
        const previous = window.sessionStorage.getItem(RUNTIME_RECOVERY_SESSION_KEY)
        if (previous !== recoveryKey) {
          window.sessionStorage.setItem(RUNTIME_RECOVERY_SESSION_KEY, recoveryKey)
          const url = new URL(window.location.href)
          url.searchParams.set('__bos_reload', String(Date.now()))
          if (runtimeHash) url.searchParams.set('__bos_server_build', runtimeHash)
          flushPendingWorkDrafts()
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
      } else if (entity === 'fee') {
        message = 'This fee changed on another device. Latest data is loading now.'
        entityLabel = 'Fee'
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
      const hasRecoverableSession = !!(user?.id || getStoredUserPayload())
      if (!hasRecoverableSession) {
        return
      }
      // A single page load/navigation can fire several API calls in the same
      // tick (bootstrap, notifications summary, import-jobs, org search,
      // etc). If one of them 401s because of a transient blip -- an edge
      // hiccup, a session cookie that hadn't finished writing yet, a brief
      // backend restart -- the rest of that same burst land here too,
      // within milliseconds of each other. This used to only run a
      // recovery check (a fresh bootstrap call confirming whether the
      // session is actually dead) for the FIRST 401, and only within 8s of
      // login -- every other 401 in the burst, and any 401 arriving later
      // in a normal session, skipped straight to an immediate logout even
      // though the very next moment's recovery check might have found the
      // session was fine all along. That's what caused "logged out on some
      // pages but not others" -- whichever request's 401 lost the race got
      // to force the logout before the others (or the shared recovery
      // check) had a chance to say otherwise.
      //
      // Now every 401 always triggers (or, if one is already pending,
      // shares) a single in-flight recovery check, regardless of how long
      // ago the session was established, and only that check's own result
      // decides whether to log out -- once, for the whole burst.
      if (authRecoveryRef.current) {
        return
      }
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
        await handleUnauthorizedSession(message)
      }, 180)
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
      // settingsRef, not the settings state var, so this reads whatever
      // loadSettings()/applyBootstrapPayload() just wrote above rather than
      // a stale pre-login snapshot -- see settingsRef's own assignment
      // effect for why callbacks read it instead of closing over `settings`.
      setPage(resolveAdminLandingPage(settingsRef.current.default_landing_page))
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
              loadSettings().catch(() => {})
            } else {
              setAuthReady(true)
            }
            let settled = false
            const authReadyWatchdog = window.setTimeout(() => {
              if (settled) return
              console.warn(`[AppContext] App bootstrap is taking too long; showing ${hasStoredSession ? 'the shell with stored session data' : 'the sign-in shell'}.`)
              setAuthReady(true)
              loadSettings().catch(() => {})
            }, 10_000)
            Promise.resolve()
              .then(() => readAppBootstrap('App bootstrap'))
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
    if (publicMode) return undefined
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

    // NOTE: this used to wait on a fixed ~9s pre-idle defer timer after
    // `load` before even queuing an idle callback (itself allowed up to
    // another 20s to fire) before fetching the full dictionary. That fixed
    // defer constant was deliberately removed -- CORE_ENGLISH_PACK
    // only covers a curated subset of keys, so any key outside it (e.g.
    // and_filter/or_filter/pos) fell through t()'s raw-key fallback for
    // that whole 9-29s window -- visible as literal key names in the UI
    // ("and_filter", "pos") until the full pack finally loaded and swapped
    // them for the real labels. English is the default fallback language,
    // not an optional extra, so fetch it right away (still off the main
    // paint via requestIdleCallback where available, just without the
    // extra fixed wait stacked in front of it).
    const scheduleDeferredLanguagePack = () => {
      const runWhenIdle = () => {
        if (cancelled) return
        if (typeof window.requestIdleCallback === 'function') {
          idleId = window.requestIdleCallback(loadLanguagePack, { timeout: CORE_LANGUAGE_PACK_IDLE_TIMEOUT_MS })
          return
        }
        loadLanguagePack()
      }

      if (document.readyState === 'complete') {
        runWhenIdle()
        return
      }

      loadListener = () => {
        runWhenIdle()
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
  }, [language, publicMode])

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
    // Default accent = the design-language muted gold (tokens.css --ui-accent);
    // the old '#2563eb' default made the whole kit render blue whenever no
    // accent had been saved (P2-4 checkpoint finding, Sep 3 2026).
    const ac  = settings.ui_accent_color || DEFAULT_UI_ACCENT
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
    // resumeWS() (not reconnectWS()) so a fresh login always clears any WS
    // backoff/suppression window left over from a prior session ending
    // (e.g. a password change that revoked the old session and closed the
    // socket with an auth error). Without this, logging back in during that
    // suppression window silently skipped reconnecting and the connection
    // indicator stayed yellow until something else (window focus, etc.)
    // happened to call resumeWS() later.
    resumeWS()
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
    // See the OTP login handler's matching comment above -- settingsRef,
    // not the settings state var, to pick up what was just loaded.
    setPage(resolveAdminLandingPage(settingsRef.current.default_landing_page))
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
        // Best-effort, once per authenticated session: ask the browser not to
        // evict this origin's storage under pressure. Matters most on iOS,
        // where a non-persistent origin can lose its offline sales queue and
        // cached app shell with no warning -- see syncRuntime.ts's own
        // comment on why this is safe to call even where it is unsupported
        // (older Safari) or silently denied. Logged (not surfaced to the
        // user) so a "why did this device lose its offline queue" support
        // question can be answered from devtools/Sentry breadcrumbs instead
        // of guessed at.
        void requestPersistentAppStorage().then((persistent) => {
          console.info(`[storage] persistent storage ${persistent ? 'granted' : 'not granted'} for this origin`)
        })
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
      preserveOfflineWork: true,
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

  const dismissNotification = useCallback(() => {
    setNotification(null)
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
  // Mirrors cloudflare/src/lib/permissions.ts's getMergedPermissions(): a
  // user's effective permissions are their role's grants merged with any
  // user-level overrides, with the user-level value winning on key
  // conflicts. Reading only `user.permissions` here (as this used to do)
  // meant anyone whose access came from their role -- e.g. a POS
  // permission granted on the "Employee" role rather than set directly on
  // the individual user record -- would pass every backend check but the
  // sidebar/page-guard would never show those pages, because the frontend
  // never looked at `user.role_permissions` at all. That's what caused
  // "I only see Dashboard and Notes after logging in": those two are the
  // only nav items with permission: null (see navigationConfig.ts), so
  // they're the only ones that don't depend on this merge.
  const getMergedPermissionsRaw = useCallback((): Record<string, unknown> => {
    if (!user) return {}
    try {
      const rolePermissions = parsePermissionMap((user as { role_permissions?: unknown }).role_permissions)
      const userPermissions = parsePermissionMap(user.permissions)
      return { ...rolePermissions, ...userPermissions }
    } catch {
      return {}
    }
  }, [user])

  const getPermissions = useCallback((): Record<string, boolean> => {
    const merged = getMergedPermissionsRaw()
    return Object.fromEntries(
      Object.entries(merged).map(([key, value]) => [key, value === true]),
    )
  }, [getMergedPermissionsRaw])

  const hasPermission = useCallback((key: string) => {
    if (!user) return false
    const p = getPermissions()
    return !!(p.all || p[key])
  }, [user, getPermissions])

  // Tier-aware read for REVIEW_TIER_KEYS sections (see utils/permissions.ts)
  // -- 'full' behaves exactly like hasPermission()===true, 'none' exactly
  // like hasPermission()===false, and 'review' is the new middle case: the
  // person can still open/use the section, but specific actions (which
  // vary per section -- see each write route's own comment) get queued
  // for approval instead of applying immediately. Components that need to
  // know which write actions to queue-vs-apply, or that render the
  // Review Required badge/explanation, should read this instead of
  // hasPermission() -- hasPermission() alone can't distinguish 'review'
  // from 'none' by design (see permissions.ts's own comment on why that's
  // deliberate on the backend too).
  const getPermissionTier = useCallback((key: string): PermissionTier => {
    const merged = getMergedPermissionsRaw()
    return getPermissionTierFromMap(merged, key, merged.all === true)
  }, [getMergedPermissionsRaw])

  // Per-ACTION gate: "may this role press this specific button?"
  //
  // getPermissionTier() answers at page granularity; this answers at button
  // granularity, reading utils/permissionActions.ts -- the same table the
  // admin permission editor renders, so a control's visibility and the
  // description an admin was shown when granting the tier can never
  // disagree. Returns true for 'queue' and 'limited' as well as 'allow':
  // in both of those the person CAN still use the control, the outcome
  // just differs (queued for approval / narrowed to the fields they may
  // edit). Call outcomeAt() directly when a caller needs to tell those
  // apart -- e.g. to label a button "Submit for approval" instead of "Save".
  // The fifth argument applies any per-action override an admin set in the
  // permissions editor (`{ "products:delete": false }`). It can only ever
  // REMOVE an action the tier granted, never add one it withheld -- see
  // utils/permissionActions.ts for why one-way is what makes it safe to
  // enforce on the server. The same rule runs in
  // cloudflare/src/lib/permissions.ts's getActionTier, so a control hidden
  // here is genuinely refused by the API rather than merely hidden.
  const can = useCallback((permissionKey: string, actionKey: string): boolean => {
    if (!user) return false
    return actionAllowed(
      permissionKey,
      actionKey,
      getPermissionTier(permissionKey),
      hasPermission,
      (section, action) => isActionOverriddenOff(getPermissions(), section, action),
    )
  }, [user, getPermissionTier, hasPermission, getPermissions])

  const canAccessPage = useCallback((pageId: string) => {
    if (!user) return false
    // `files` (Library) resolves to `null` in PAGE_PERMISSIONS below, same
    // as `notes` -- view is unconditional for any authenticated user (this
    // session's ask). See cloudflare/src/routes/files.ts's own
    // top-of-file comment for the backend-side half of this rule; the
    // page's own upload/download/rename/delete controls still self-gate
    // on real Full Access to `library` (FilesPage.tsx's `canManageLibrary`).
    const required = PAGE_PERMISSIONS[pageId]
    if (required == null) return true
    // Tier-aware, not hasPermission(): a Review Required user for a
    // REVIEW_TIER_KEYS section (e.g. Fees) must still be able to open the
    // page -- only specific actions inside it get queued, not the whole
    // page. hasPermission() is strict-boolean by design and would 403 a
    // 'review'-tier user out of the page entirely, same class of bug the
    // backend's own permissions.ts comment warns callers about.
    if (getPermissionTier(required) !== 'none') return true
    // Part 557 slice 8: the storefront editor (catalog page) is split into
    // per-area write grants. Any of posts/FAQ/About opens the page -- the
    // config grant is already covered by the `customer_portal` check above --
    // and CatalogPage then self-gates each section to what the role can save.
    if (pageId === 'catalog' && (hasPermission('portal_posts') || hasPermission('portal_faq') || hasPermission('portal_about'))) return true
    // 'products_image_only' (Part 241): a restricted role with no real
    // `products` tier of its own still needs into the Products page --
    // it just gets the lightweight image-only view once there (see
    // Products.tsx's wrapper). Mirrors the backend's isImageOnlyUser()
    // shape (cloudflare/src/routes/products.ts): only relevant when the
    // real tier is 'none', since anyone with actual products access
    // already passed the check above.
    if (pageId === 'products' && hasPermission('products_image_only')) return true
    // G2: Loyalty Points lives INSIDE the Promotions page now. A user
    // whose only grant is customer_portal (the old Loyalty page's gate)
    // must still reach the page for its Loyalty section -- the promo
    // sections inside self-gate on the real 'promotions' tier, so this
    // widens the door, not the controls.
    if (pageId === 'promotions' && getPermissionTier('customer_portal') !== 'none') return true
    // E3/E4 (Part 403): audit_log, users and backup retired as standalone
    // pages -- their components are sections of Review & Logs / Settings
    // now. A grant on any absorbed section opens its host page; each
    // section still self-gates on its own key inside, so this widens the
    // door, never the controls.
    if (pageId === 'review' && getPermissionTier('audit_log') !== 'none') return true
    // Users is admin-only now (Part 557 slice 3) -- it carries no per-role
    // `users` grant, so only the backup section can open Settings for a
    // non-admin here; admins reach it via the tier-aware check above.
    if (pageId === 'settings' && getPermissionTier('backup') !== 'none') return true
    // E2: returns and fees retired as standalone pages into the Sales hub,
    // same contract as above -- a returns- or fees-only grant still opens
    // the Sales page, whose sections self-gate on their own keys inside.
    if (pageId === 'sales' && (getPermissionTier('returns') !== 'none' || getPermissionTier('fees') !== 'none')) return true
    // E1: inventory retired as a standalone page into the Branches hub --
    // an inventory-only grant still opens the Branches page, whose chips
    // self-gate ('branches' for the branch list, 'inventory' for the rest).
    if (pageId === 'branches' && getPermissionTier('inventory') !== 'none') return true
    // 'settings'/'receipt_settings' page (this session, alongside
    // routes/settings.ts's new per-field business_identity/sales_policy
    // gating): a user granted only one of the narrower settings
    // sub-permissions (business_identity, sales_policy, drive_credentials)
    // -- with no plain `settings` grant at all -- still needs into the
    // Settings page to actually use that grant. Without this, the backend
    // fix that lets a business_identity-only user save their own fields
    // would be unreachable: they'd be turned away at the page gate before
    // ever getting to try. Settings.tsx's own section-visibility (the
    // `isAdmin`/`showSettingsSection` checks that hide non-owned fields)
    // still applies once inside -- this only controls whether the page
    // itself opens, same as the tier-aware check just above.
    if ((pageId === 'settings' || pageId === 'receipt_settings') &&
      (hasPermission('business_identity') || hasPermission('sales_policy') || hasPermission('drive_credentials'))) {
      return true
    }
    return false
  }, [user, getPermissionTier, hasPermission])

  const navigateNow = useCallback((pageId: string, anchor?: string) => {
    if (!canAccessPage(pageId)) return
    if (typeof window !== 'undefined') {
      const nextPath = getAdminPathForPage(pageId)
      const currentUrl = new URL(window.location.href)
      // An explicit anchor (e.g. a notification pointing at a specific tab
      // on the target page) overrides whatever hash happens to be in the
      // URL already; otherwise leave the current hash alone.
      const nextHash = anchor ? `#${anchor}` : currentUrl.hash
      if (nextPath && (currentUrl.pathname !== nextPath || nextHash !== currentUrl.hash)) {
        window.history.pushState(window.history.state, '', `${nextPath}${currentUrl.search}${nextHash}`)
      }
      window.dispatchEvent(new CustomEvent(APP_NAVIGATION_EVENT, {
        detail: {
          page: pageId,
          path: nextPath,
          anchor: anchor || null,
        },
      }))
    }
    startTransition(() => {
      setPage(pageId)
    })
  }, [canAccessPage])

  // N2: the navigation guard. Page switches consult the dirty-work
  // registry (utils/dirtyWork.ts) first -- unsaved work opens the
  // three-option modal (App.tsx renders it off this state) instead of
  // being silently stranded. Same-page navigation (tab/anchor moves inside
  // the page) passes through: the work stays mounted either way.
  const [navGuard, setNavGuard] = useState<null | { pageId: string; anchor?: string; entries: DirtyWorkEntry[] }>(null)
  const pageRef = useRef(page)
  pageRef.current = page
  const navigateTo = useCallback((pageId: string, anchor?: string) => {
    if (!canAccessPage(pageId)) return
    if (pageId !== pageRef.current) {
      const dirty = getDirtyWork()
      if (dirty.length > 0) {
        setNavGuard({ pageId, anchor, entries: dirty })
        return
      }
    }
    navigateNow(pageId, anchor)
  }, [canAccessPage, navigateNow])

  const resolveNavGuard = useCallback(async (action: 'save' | 'discard' | 'stay') => {
    const guard = navGuard
    setNavGuard(null)
    if (!guard || action === 'stay') return
    if (action === 'save') {
      for (const entry of guard.entries) {
        if (!entry.isDirty()) continue
        if (!entry.save) continue
        try {
          const saved = await entry.save()
          if (!saved) return // save refused (validation etc.) -- stay put
        } catch {
          return
        }
      }
      // Anything dirty WITHOUT a save hook must not be silently lost by a
      // "save" choice -- staying is the safe reading (the modal only offers
      // Save & Leave when every dirty entry can save; this is the backstop).
      if (getDirtyWork().length > 0) return
    } else {
      for (const entry of guard.entries) {
        try { entry.discard?.() } catch { /* leaving anyway */ }
      }
    }
    navigateNow(guard.pageId, guard.anchor)
  }, [navGuard, navigateNow])

  // Browser close/reload guard -- the native confirm is all a page gets.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (event: BeforeUnloadEvent) => {
      if (hasDirtyWork()) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // Browser BACK/FORWARD (popstate) goes through the SAME guard (Part 388
  // -- the recorded N2 limit). This also fixes a latent gap: popstate only
  // bumped a render counter before, so Back changed the URL without ever
  // changing the page. Clean state follows the history entry; dirty state
  // re-asserts the current page's URL (undoing the back) and opens the
  // guard for the intended target instead.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onPopState = () => {
      const target = getAdminPageFromPath(window.location.pathname) || 'dashboard'
      if (target === pageRef.current || !canAccessPage(target)) return
      const dirty = getDirtyWork()
      if (dirty.length > 0) {
        const currentPath = getAdminPathForPage(pageRef.current)
        if (currentPath) {
          window.history.pushState(window.history.state, '', `${currentPath}${window.location.search}${window.location.hash}`)
        }
        setNavGuard({ pageId: target, entries: dirty })
        return
      }
      startTransition(() => setPage(target))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [canAccessPage])

  // Currency helpers.
  const exchangeRate    = parseFloat(String(settings.exchange_rate || '4100'))
  const usdSymbol       = String(settings.currency_usd_symbol || '$')
  const khrSymbol       = String(settings.currency_khr_symbol || '៛')
  const displayCurrency = String(settings.display_currency || 'USD').trim().toLowerCase()
  const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  // Business records are interpreted and presented in the business's source
  // timezone, independent of the cashier's device locale or old per-device
  // display preferences.
  const displayTimezone = BUSINESS_TIME_ZONE

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
    return date.toLocaleString('en-US', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
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
    navGuard, resolveNavGuard,
    settings, loadSettings, saveSettings,
    language, theme, t,
    toggleTheme, toggleLanguage,
    notify, notification,
    writeConflict, dismissWriteConflict, reloadWriteConflict, dismissNotification,
    hasPermission, canAccessPage, getPermissions, getPermissionTier, can,
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
    <AppContext.Provider value={appValue as AppContextCoreValue}>
      <SyncContext.Provider value={syncValue}>
        {children}
      </SyncContext.Provider>
    </AppContext.Provider>
  )
}
