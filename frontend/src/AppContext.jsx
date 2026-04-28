import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, useContext as _useContext } from 'react'
import en from './lang/en.json'
import { STORAGE_KEYS, SYNC } from './constants'
// web-api.js installs window.api synchronously via static imports.
// Importing it here (rather than dynamic import) ensures window.api
// is available before any React render cycle runs.
import './web-api.js'
import { cacheClearAll, startHealthCheck } from './api/http.js'
import { normalizeRuntimeDescriptor, readStoredRuntimeDescriptor, resetClientRuntimeState, sanitizeSyncServerUrl, shouldResetForRuntimeChange, writeStoredRuntimeDescriptor } from './api/clientRuntime.js'
import { isWSConnected } from './api/websocket.js'
import { getClientDeviceInfo } from './utils/deviceInfo.js'

/**
 * Global application context.
 *
 * Responsibilities:
 * - restore/persist the logged-in user session
 * - load settings and expose translation/theme helpers
 * - track sync/WebSocket status for the whole shell
 * - provide navigation, notifications, and shared formatters
 */

function flattenTranslationTree(input, target = {}) {
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

const baseEnglishPack = flattenTranslationTree(en, {})

const LANG_LOADERS = {
  en: async () => baseEnglishPack,
  km: async () => {
    const { default: km } = await import('./lang/km.json')
    return flattenTranslationTree(km, {})
  },
}
const loadedLangs = { en: baseEnglishPack }
const AppContext = createContext(null)
const SyncContext = createContext(null)
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
  STORAGE_KEYS.AUTH_TOKEN,
  STORAGE_KEYS.USER,
  STORAGE_KEYS.USER_EXPIRY,
]

function safeStorageGet(storage, key) {
  try {
    return storage?.getItem?.(key) || ''
  } catch (_) {
    return ''
  }
}

function safeStorageSet(storage, key, value) {
  try {
    storage?.setItem?.(key, value)
  } catch (_) {}
}

function safeStorageRemove(storage, key) {
  try {
    storage?.removeItem?.(key)
  } catch (_) {}
}

function getStoredAuthToken() {
  return safeStorageGet(sessionStorage, STORAGE_KEYS.AUTH_TOKEN) || safeStorageGet(localStorage, STORAGE_KEYS.AUTH_TOKEN)
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
  safeStorageRemove(localStorage, STORAGE_KEYS.SERVER_START_TIME)
  safeStorageRemove(localStorage, STORAGE_KEYS.OAUTH_LOGIN_PENDING)
  safeStorageRemove(localStorage, STORAGE_KEYS.OAUTH_LINK_PENDING)
}

function persistAuthState({ user, authToken, expiryTime, sessionDuration }) {
  const mode = String(sessionDuration || 'session').trim().toLowerCase() || 'session'
  const primaryStorage = mode === 'session' ? sessionStorage : localStorage
  const secondaryStorage = mode === 'session' ? localStorage : sessionStorage

  SESSION_ONLY_STORAGE_KEYS.forEach((key) => safeStorageRemove(secondaryStorage, key))

  safeStorageSet(primaryStorage, STORAGE_KEYS.USER, JSON.stringify(user))
  if (authToken) safeStorageSet(primaryStorage, STORAGE_KEYS.AUTH_TOKEN, authToken)
  else safeStorageRemove(primaryStorage, STORAGE_KEYS.AUTH_TOKEN)
  if (expiryTime) safeStorageSet(primaryStorage, STORAGE_KEYS.USER_EXPIRY, String(expiryTime))
  else safeStorageRemove(primaryStorage, STORAGE_KEYS.USER_EXPIRY)
}

function computeSessionExpiryMs(sessionDuration, sessionExpiresAt = '') {
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

function readDeviceSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.DEVICE_SETTINGS) || '{}') || {}
  } catch (_) {
    return {}
  }
}

function writeDeviceSettings(value) {
  try {
    localStorage.setItem(STORAGE_KEYS.DEVICE_SETTINGS, JSON.stringify(value || {}))
  } catch (_) {}
}

function writeStoredSessionDuration(value) {
  const normalized = String(value || '').trim() || 'session'
  try {
    localStorage.setItem(STORAGE_KEYS.SESSION_DURATION, normalized)
  } catch (_) {}
  return normalized
}

function readPendingOauthLink() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.OAUTH_LINK_PENDING) || ''
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const startedAt = Number(parsed.startedAt || 0)
    if (!startedAt || (Date.now() - startedAt) > OAUTH_PENDING_TTL_MS) return null
    return parsed
  } catch (_) {
    return null
  }
}

function clearPendingOauthLink() {
  try {
    localStorage.removeItem(STORAGE_KEYS.OAUTH_LINK_PENDING)
  } catch (_) {}
}

function mergeSettingsWithDeviceOverrides(baseSettings = {}) {
  return { ...baseSettings, ...readDeviceSettings() }
}

function normalizeDateInput(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date?.getTime?.()) ? null : date
}

export function isBrokenLocalizedString(value) {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.includes('\ufffd')) return true
  if (/[\uE000-\uF8FF]/.test(trimmed)) return true
  const questionMarks = (trimmed.match(/\?/g) || []).length
  return questionMarks >= Math.max(3, Math.floor(trimmed.length * 0.18))
}

function buildRuntimeDescriptorFromBootstrap(payload = {}) {
  const organizationPublicId = payload?.organization?.public_id || payload?.user?.organization_public_id || ''
  return normalizeRuntimeDescriptor({
    ...(payload?.system?.runtime || {}),
    serverStartTime: payload?.system?.runtime?.serverStartTime || payload?.system?.serverStartTime || '',
    organizationPublicId,
  })
}

export const PAGE_PERMISSIONS = {
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

function AccessDenied({ t }) {
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

export function AppProvider({ children }) {
  // The provider owns the app session lifecycle and hands lightweight helpers
  // to page components so business workflows do not duplicate global state.
  const [user,                setUser]                = useState(() => {
    // Recover the signed-in user from sessionStorage/localStorage depending on
    // the last chosen login duration.
    try {
      const stored = getStoredUserPayload()
      const expiry = getStoredUserExpiry()
      const authToken = getStoredAuthToken()
      if (stored && !authToken) {
        clearPersistedAuthState()
        return null
      }

      if (stored && expiry) {
        if (Date.now() > parseInt(expiry, 10)) {
          clearPersistedAuthState()
          return null
        }
        return JSON.parse(stored)
      }
      if (stored && authToken) return JSON.parse(stored)
    } catch (_) {}
    return null
  })
  const [settings,            setSettings]            = useState({})
  const [language,            setLanguage]            = useState('en')
  const [theme,               setTheme]               = useState('light')
  const [page,                setPage]                = useState('dashboard')
  const [notification,        setNotification]        = useState(null)
  const [writeConflict,       setWriteConflict]       = useState(null)
  const [langRevision,        setLangRevision]        = useState(0)
  const authRecoveryRef = useRef(false)
  const authEstablishedAtRef = useRef(0)
  const writeBlockedNoticeAtRef = useRef(0)
  const [authReady, setAuthReady] = useState(() => !getStoredAuthToken())
  // Initialize from actual WS state ??avoids yellow dot when WS connected before AppContext mounted
  const [syncConnected,       setSyncConnected]       = useState(() => isWSConnected())
  const [syncChannel,         setSyncChannel]         = useState(null)
  const [syncServerUnreachable, setSyncServerUnreachable] = useState(false)

  // Sync URL ??when served by the backend the page origin IS the API/WS server.
  // Always use it (never a stale localhost stored from a previous session) so that
  // Tailscale URLs, LAN IPs and localhost:4000 all connect without manual config.
  const [syncUrl, _setSyncUrl] = useState(() => {
    try {
      const isViteDev = window.location.hostname === 'localhost' &&
        (window.location.port === '5173' || window.location.port === '5174')
      if (!isViteDev) {
        // Served by the Node backend ??current origin == API server. Always update.
        const auto = window.location.origin
        try { localStorage.setItem(STORAGE_KEYS.SYNC_SERVER, auto) } catch (_) {}
        return auto
      }
      // Vite dev: use stored value (normally points to localhost:4000 backend)
      return localStorage.getItem(STORAGE_KEYS.SYNC_SERVER) || ''
    } catch { return '' }
  })

  // Define translation lookup before any hook dependency arrays or callbacks
  // reference it, avoiding render-time TDZ crashes in production bundles.
  const t = useCallback((key) => {
    const localized = loadedLangs[language]?.[key]
    if (localized !== undefined && localized !== null && !isBrokenLocalizedString(localized)) return localized
    const english = loadedLangs.en?.[key]
    if (english !== undefined && english !== null && !isBrokenLocalizedString(english)) return english
    return key
  }, [language, langRevision])

  // ?? Settings (defined before any useEffect that uses it) ?????????????????
  const loadSettings = useCallback(async () => {
    try {
      const hasAuthSession = !!(window.api?.getAuthSessionToken?.() || getStoredAuthToken())
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
      const serverSettings = await window.api.getSettings()
      const mergedSettings = mergeSettingsWithDeviceOverrides(serverSettings || {})
      setSettings(mergedSettings)
      if (mergedSettings.login_session_duration) {
        writeStoredSessionDuration(mergedSettings.login_session_duration)
      }
      if (mergedSettings.language) setLanguage(mergedSettings.language)
      if (mergedSettings.theme)    setTheme(mergedSettings.theme)
      return mergedSettings
    } catch (e) {
      console.warn('[AppContext] loadSettings failed:', e.message)
      const fallbackSettings = mergeSettingsWithDeviceOverrides({})
      setSettings(fallbackSettings)
      if (fallbackSettings.login_session_duration) {
        writeStoredSessionDuration(fallbackSettings.login_session_duration)
      }
      if (fallbackSettings.language) setLanguage(fallbackSettings.language)
      if (fallbackSettings.theme) setTheme(fallbackSettings.theme)
      return fallbackSettings
    }
  }, [])

  const clearLocalBusinessState = useCallback(async (options = {}) => {
    await resetClientRuntimeState({
      clearAuth: options.clearAuth === true,
      preserveDeviceSettings: true,
      preserveSyncServer: options.preserveSyncServer !== false,
      preserveSessionDuration: options.preserveSessionDuration !== false,
      preserveRuntimeMeta: options.preserveRuntimeMeta === true,
      preserveOrganization: options.preserveOrganization === true,
      preserveAuth: options.preserveAuth === true,
    }).catch(() => {})
    cacheClearAll()
  }, [])

  const applyBootstrapPayload = useCallback(async (payload, options = {}) => {
    const fallbackUser = options.fallbackUser || null
    const nextUser = payload?.user || fallbackUser || null
    const runtimeDescriptor = buildRuntimeDescriptorFromBootstrap(payload)
    const storedRuntimeDescriptor = readStoredRuntimeDescriptor()
    if (shouldResetForRuntimeChange(storedRuntimeDescriptor, runtimeDescriptor)) {
      await clearLocalBusinessState({
        clearAuth: false,
        preserveSyncServer: true,
        preserveSessionDuration: true,
      })
    }
    writeStoredRuntimeDescriptor(runtimeDescriptor)

    const mergedSettings = mergeSettingsWithDeviceOverrides(payload?.settings || {})

    setSettings(mergedSettings)
    if (mergedSettings.login_session_duration) {
      writeStoredSessionDuration(mergedSettings.login_session_duration)
    }
    if (mergedSettings.language) setLanguage(mergedSettings.language)
    if (mergedSettings.theme) setTheme(mergedSettings.theme)

    if (nextUser) {
      setUser(nextUser)
    }

    const organization = payload?.organization
    const group = payload?.group
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

    if (payload?.system?.serverStartTime) {
      safeStorageSet(localStorage, STORAGE_KEYS.SERVER_START_TIME, String(payload.system.serverStartTime))
    }

    return {
      user: nextUser,
      settings: mergedSettings,
      system: payload?.system || null,
      organization: organization || null,
      group: group || null,
    }
  }, [clearLocalBusinessState])

  // ?? Sync event listeners (loadSettings is now defined above) ?????????????
  const debounceRef = useRef({})
  useEffect(() => {
    const onUpdate = (e) => {
      const { channel } = e.detail
      if (debounceRef.current[channel]) clearTimeout(debounceRef.current[channel])
      debounceRef.current[channel] = setTimeout(async () => {
        delete debounceRef.current[channel]
        // Settings changes from other devices apply immediately ??no reload needed
        if (channel === 'settings') loadSettings().catch(() => {})
        if (channel === 'runtime') {
          await clearLocalBusinessState({
            clearAuth: false,
            preserveSyncServer: true,
            preserveSessionDuration: true,
          })
          const bootstrap = await window.api?.getAppBootstrap?.().catch?.(() => null)
          if (bootstrap?.user) {
            await applyBootstrapPayload(bootstrap, { fallbackUser: user || null })
          } else if (!window.api?.getAuthSessionToken?.()) {
            await loadSettings().catch(() => {})
          }
        }
        setSyncChannel({ channel, ts: Date.now() })
      }, SYNC.EVENT_DEBOUNCE_MS)
    }
    const onStatus = (e) => {
      setSyncConnected(e.detail.connected)
      if (e.detail.connected) setSyncServerUnreachable(false)
    }
    // Poll every 500 ms to catch WS connection that established before this listener was registered.
    // Once connected, we keep polling (WS can drop/reconnect) but at a slower rate.
    let pollRate = 500
    let pollTimer = null
    const poll = () => {
      const connected = isWSConnected()
      setSyncConnected(prev => {
        if (prev !== connected) {
          if (connected) setSyncServerUnreachable(false)
          return connected
        }
        return prev
      })
      // Slow down once connected ??only need fast polling during initial connect
      if (connected && pollRate < 3000) {
        pollRate = 3000
        clearTimeout(quickCheck)
        clearInterval(pollTimer)
        pollTimer = setInterval(poll, pollRate)
      }
    }
    // Also check immediately after 100ms (catches fast connections)
    const quickCheck = setTimeout(poll, 100)
    pollTimer = setInterval(poll, pollRate)
    const onError = (e) => {
      console.error('[sync:error]', e.detail)
      // The SyncErrorBanner in App.jsx picks this up via its own listener
    }
    const onWriteBlocked = (e) => {
      const message = e?.detail?.error || 'Server is offline. Changes are invalid until the server reconnects.'
      setSyncServerUnreachable(true)
      if (e?.detail?.reason !== 'server_not_configured') {
        setSyncConnected(false)
      }
      const now = Date.now()
      if ((now - writeBlockedNoticeAtRef.current) < 4000) return
      writeBlockedNoticeAtRef.current = now
      setNotification({ message, type: 'error', id: now })
    }
    const onConflict = (e) => {
      const detail = e?.detail || {}
      const entity = String(detail.entity || '').trim().toLowerCase()
      let message = detail.message || 'This item changed on another device. Refresh and try again.'
      let entityLabel = 'Item'
      if (entity === 'settings') {
        message = 'Settings changed on another device. Latest values have been reloaded.'
        entityLabel = 'Settings'
        loadSettings().catch(() => {})
      } else if (entity === 'sale') {
        message = 'This sale changed on another device. Latest data is loading now.'
        entityLabel = 'Sale'
      } else if (entity === 'return') {
        message = 'This return changed on another device. Latest data is loading now.'
        entityLabel = 'Return'
      }
      setNotification({ message, type: 'error', id: Date.now() })
      setWriteConflict({
        ...detail,
        entity,
        entityLabel,
        id: Date.now(),
      })
    }
    const finalizeUnauthorized = async (message) => {
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
      window.api?.setAuthSessionToken?.('')
      setSyncConnected(false)
      setSyncServerUnreachable(false)
      setNotification({ message, type: 'error', id: Date.now() })
    }
    const onUnauthorized = (e) => {
      const eventToken = String(e?.detail?.token || '').trim()
      const currentToken = window.api?.getAuthSessionToken?.() || getStoredAuthToken()
      if (eventToken && currentToken && eventToken !== currentToken) {
        return
      }
      const message = e?.detail?.error || 'Please sign in again to continue.'
      const recentAuthEstablished = Date.now() - authEstablishedAtRef.current < 8000
      const hasRecoverableSession = !!currentToken && !!(user?.id || getStoredUserPayload())
      if (hasRecoverableSession && !authRecoveryRef.current && recentAuthEstablished) {
        authRecoveryRef.current = true
        window.setTimeout(async () => {
          try {
            const bootstrap = await window.api?.getAppBootstrap?.()
            if (bootstrap?.user) {
              await applyBootstrapPayload(bootstrap, { fallbackUser: user || null })
              authRecoveryRef.current = false
              return
            }
          } catch (_) {}
          authRecoveryRef.current = false
          await finalizeUnauthorized(message)
        }, 180)
        return
      }
      finalizeUnauthorized(message).catch(() => {})
    }
    window.addEventListener('sync:update', onUpdate)
    window.addEventListener('sync:status', onStatus)
    window.addEventListener('sync:error',  onError)
    window.addEventListener('sync:write-blocked', onWriteBlocked)
    window.addEventListener('sync:conflict', onConflict)
    window.addEventListener('auth:unauthorized', onUnauthorized)
    return () => {
      clearTimeout(quickCheck)
      clearInterval(pollTimer)
      window.removeEventListener('sync:update', onUpdate)
      window.removeEventListener('sync:status', onStatus)
      window.removeEventListener('sync:error',  onError)
      window.removeEventListener('sync:write-blocked', onWriteBlocked)
      window.removeEventListener('sync:conflict', onConflict)
      window.removeEventListener('auth:unauthorized', onUnauthorized)
      Object.values(debounceRef.current).forEach(clearTimeout)
    }
  }, [applyBootstrapPayload, clearLocalBusinessState, loadSettings, user])

  // ?? OTP login event listener ?????????????????????????????????????????????
  useEffect(() => {
    const handleOtpLogin = async (e) => {
      const otpUser = e.detail
      if (!otpUser) return
      const { password: _pw, otp_secret: _sec, authToken = '', sessionDuration = 'session', ...safeUser } = otpUser

      const expiryTime = computeSessionExpiryMs(sessionDuration, otpUser.sessionExpiresAt || '')

      try {
        persistAuthState({ user: safeUser, authToken, expiryTime, sessionDuration })
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
      window.api?.setAuthSessionToken?.(authToken || '')
      const bootstrap = await window.api?.getAppBootstrap?.().catch?.(() => null)
      if (bootstrap) {
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
  }, [applyBootstrapPayload, loadSettings])

  useEffect(() => {
    const handleUserUpdated = (e) => {
      const nextUser = e.detail
      if (!nextUser) return
      setUser((prev) => {
        if (!prev || Number(prev.id) !== Number(nextUser.id)) return prev
        const merged = { ...prev, ...nextUser }
        const authToken = window.api?.getAuthSessionToken?.() || getStoredAuthToken()
        const expiry = getStoredUserExpiry()
        const expiryTime = expiry ? Number(expiry) : null
        const currentMode = authToken && safeStorageGet(sessionStorage, STORAGE_KEYS.AUTH_TOKEN)
          ? 'session'
          : (safeStorageGet(localStorage, STORAGE_KEYS.SESSION_DURATION) || '30d')
        persistAuthState({
          user: merged,
          authToken,
          expiryTime: Number.isFinite(expiryTime) ? expiryTime : null,
          sessionDuration: currentMode,
        })
        return merged
      })
    }

    window.addEventListener('user:updated', handleUserUpdated)
    return () => window.removeEventListener('user:updated', handleUserUpdated)
  }, [])

  // ?? Startup: load settings, fetch config, and health-check the server ????
  const startupDone = useRef(false)
  useEffect(() => {
    if (startupDone.current) return
    startupDone.current = true

    // Non-blocking async sync URL discovery ??activates the sync server
    // connection without blocking the initial render.
    const discoverSyncUrl = async () => {
      try {
        const authToken = getStoredAuthToken()
        const storedUser = getStoredUserPayload()
        const hasStoredSession = !!(authToken && storedUser)

        if (!hasStoredSession) {
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
          window.api?.setSyncServerUrl?.(effectiveUrl)

          if (hasStoredSession && typeof window.api?.getAppBootstrap === 'function') {
            setAuthReady(false)
            window.api.getAppBootstrap()
              .then(async (bootstrap) => {
                if (bootstrap) await applyBootstrapPayload(bootstrap)
              })
              .catch(() => {})
              .finally(() => setAuthReady(true))
          }

          fetch(`${effectiveUrl}/health`, { signal: AbortSignal.timeout?.(6000) })
            .then(r => setSyncServerUnreachable(!r.ok))
            .catch(() => setSyncServerUnreachable(true))
        } else {
          setAuthReady(true)
        }
        if (!hasStoredSession) {
          setAuthReady(true)
        }
        return
      } catch (e) {
        console.debug('[AppContext] discoverSyncUrl error:', e.message)
        setAuthReady(true)
      }

    }
    
    // Start discovery in background (no await, doesn't block UI render)
    discoverSyncUrl()
  }, [applyBootstrapPayload, syncUrl, loadSettings])

  // ?? Theme and CSS variables ???????????????????????????????????????????????
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
    document.documentElement.setAttribute('lang', String(language || 'en').trim() || 'en')
  }, [language, theme])

  useEffect(() => {
    let cancelled = false
    const nextLang = String(language || 'en').trim() || 'en'
    if (loadedLangs[nextLang]) return undefined

    const loader = LANG_LOADERS[nextLang]
    if (!loader) return undefined

    loader()
      .then((messages) => {
        if (cancelled || !messages) return
        loadedLangs[nextLang] = messages
        setLangRevision((value) => value + 1)
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [language])

  useEffect(() => {
    const root = document.documentElement
    const radii  = { sharp: '2px', rounded: '8px', pill: '16px' }
    const fonts  = {
      system:     "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      inter:      "'Inter', -apple-system, sans-serif",
      roboto:     "'Roboto', sans-serif",
      poppins:    "'Poppins', sans-serif",
      open_sans:  "'Open Sans', sans-serif",
      outfit:     "'Outfit', sans-serif",
      mono:       "'Courier New', Courier, monospace",
      serif:      "Georgia, 'Times New Roman', serif",
      khmer:      "'Noto Sans Khmer', 'Khmer OS', sans-serif",
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
    const baseSize = Math.max(12, Math.min(20, parseFloat(fs || '14') || 14))
    const sidebarSize = Math.max(12, Math.min(22, parseFloat(settings.ui_sidebar_font_size || `${Math.round(baseSize * 0.98)}`) || Math.round(baseSize * 0.98)))
    const titleSize = Math.max(20, Math.min(40, parseFloat(settings.ui_title_font_size || `${Math.round(baseSize * 1.75)}`) || Math.round(baseSize * 1.75)))
    const sectionSize = Math.max(13, Math.min(26, parseFloat(settings.ui_section_font_size || `${Math.round(baseSize * 1.14)}`) || Math.round(baseSize * 1.14)))
    const tableSize = Math.max(11, Math.min(20, parseFloat(settings.ui_table_font_size || `${baseSize}`) || baseSize))
    const chipSize = Math.max(10, Math.min(18, parseFloat(settings.ui_chip_font_size || `${Math.max(11, Math.round(baseSize * 0.92))}`) || Math.max(11, Math.round(baseSize * 0.92))))
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
    root.style.setProperty('--ui-font-family',  fonts[ff] || fonts.system)
    root.style.fontSize = '16px'
    document.body.style.fontFamily = fonts[ff] || fonts.system
    document.body.style.fontSize   = `${baseSize}px`
    document.body.setAttribute('data-ui-font-family', ff)
    document.body.setAttribute('data-ui-language', language || 'en')
    document.body.setAttribute('data-density', settings.ui_density || 'comfortable')
    document.body.classList.toggle('lang-km', (language || 'en') === 'km')
    document.body.classList.toggle('lang-en', (language || 'en') !== 'km')

    // ?? Sidebar + page-bg colour overrides ???????????????????????????????
    // Dark-mode CSS sets background-color !important on aside/body.
    // Inline styles can't beat !important, so we inject a <style> tag
    // that wins in both light and dark mode without touching the theme rules.
    const hexAlpha = (hex, a) => {
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
      // ?? Sidebar colour ?????????????????????????????????????????????????
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
      // ?? Page background colour ??????????????????????????????????????????
      // Cover every container that could show a white/dark fallback:
      //   body            ??root background
      //   #app-root       ??full-screen flex wrapper (has Tailwind bg-gray-50)
      //   #app-root > main ??the <main> flex child holding all page divs
      //   .page-scroll    ??each page's own scrollable root div
      // Repeating with .dark prefix overrides ".dark .bg-gray-50 { !important }"
      // in main.css, which uses a class selector (specificity 0-1-0) ??same as
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

  // ?? Sync URL management ???????????????????????????????????????????????????
  const updateSyncUrl = useCallback((url) => {
    const clean = sanitizeSyncServerUrl(url)
    try { clean ? localStorage.setItem(STORAGE_KEYS.SYNC_SERVER, clean) : localStorage.removeItem(STORAGE_KEYS.SYNC_SERVER) } catch (_) {}
    _setSyncUrl(clean)
    window.api?.setSyncServerUrl?.(clean || null)
    if (clean) startHealthCheck()
  }, [])

  // ?? Auth ??????????????????????????????????????????????????????????????????
  const persistAuthenticatedUser = useCallback(async (nextUser, sessionDuration = 'session', authToken = '', sessionExpiresAt = '') => {
    const expiryTime = computeSessionExpiryMs(sessionDuration, sessionExpiresAt)

    try {
      persistAuthState({ user: nextUser, authToken, expiryTime, sessionDuration })
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
    window.api?.setAuthSessionToken?.(authToken || '')
    cacheClearAll()
    startHealthCheck()
    authEstablishedAtRef.current = Date.now()
    setUser(nextUser)
    const bootstrap = await window.api?.getAppBootstrap?.().catch?.(() => null)
    if (bootstrap) {
      await applyBootstrapPayload(bootstrap, { fallbackUser: nextUser })
    } else {
      await loadSettings()
    }
    setAuthReady(true)
    setPage('dashboard')
  }, [applyBootstrapPayload, loadSettings])

  const login = useCallback(async (username, password, sessionDuration = 'session', organization = '') => {
    try {
      const device = getClientDeviceInfo()
      const result = await window.api.login({
        username, password, organization,
        sessionDuration,
        clientTime: new Date().toISOString(),
        deviceTz: device.deviceTz,
        deviceName: device.deviceName,
      })
      if (result.success) {
        await persistAuthenticatedUser(result.user, sessionDuration, result.authToken || '', result.sessionExpiresAt || '')
      }
      return result
    } catch (e) {
      const isNet = ['fetch', 'ECONNREFUSED', 'NetworkError', 'Failed to fetch']
        .some(s => e?.message?.includes(s))
      return {
        success: false,
        error: isNet
          ? 'Cannot reach sync server. Check the URL in Settings ??Server, or clear it to use local mode.'
          : (e?.message || 'Login failed'),
      }
    }
  }, [persistAuthenticatedUser])

  const logout = useCallback(async () => {
    try {
      await window.api.logout?.()
    } catch (_) {}
    await clearLocalBusinessState({
      clearAuth: true,
      preserveSyncServer: true,
      preserveSessionDuration: true,
      preserveRuntimeMeta: true,
    })
    window.api?.setAuthSessionToken?.('')
    setUser(null)
    setAuthReady(true)
    setPage('dashboard')
    clearPersistedAuthState()
  }, [clearLocalBusinessState])

  // ?? Notifications ?????????????????????????????????????????????????????????
  const notify = useCallback((message, type = 'success', duration = 3500) => {
    setNotification({ message, type, id: Date.now() })
    setTimeout(() => setNotification(null), duration)
  }, [])

  const dismissWriteConflict = useCallback(() => {
    setWriteConflict(null)
  }, [])

  const reloadWriteConflict = useCallback(async () => {
    const detail = writeConflict
    if (!detail) return

    const refreshChannels = Array.isArray(detail.refreshChannels) ? detail.refreshChannels : []
    if (detail.entity === 'settings') {
      await loadSettings().catch(() => {})
    }
    refreshChannels.forEach((channel) => {
      window.dispatchEvent(new CustomEvent('sync:update', {
        detail: { channel, ts: Date.now() },
      }))
    })
    setWriteConflict(null)
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
    if (!accessToken && !errorDescription) return undefined

    let cancelled = false
    const clearCallbackUrl = () => {
      const cleanUrl = `${url.origin}${url.pathname}`
      window.history.replaceState({}, document.title, cleanUrl)
    }
    const clearPendingLink = () => {
      clearPendingOauthLink()
    }

    const run = async () => {
      if (errorDescription) {
        clearCallbackUrl()
        clearPendingLink()
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
        const result = await window.api.completeSupabaseOauth({
          accessToken,
          provider,
          mode: 'link',
          currentUserId: actorId,
          organization: rememberedOrg,
          clientTime: new Date().toISOString(),
          deviceTz: device.deviceTz,
          deviceName: device.deviceName,
        })
        clearCallbackUrl()
        clearPendingLink()
        if (cancelled) return
        if (result?.success && result?.user) {
          window.dispatchEvent(new CustomEvent('user:updated', { detail: result.user }))
          notify(t('identity_linked_success') || 'Sign-in method connected.', 'success')
          return
        }
        notify(result?.error || (t('identity_link_failed') || 'Failed to connect sign-in method.'), 'error')
      } catch (error) {
        clearCallbackUrl()
        clearPendingLink()
        if (!cancelled) {
          notify(error?.message || (t('identity_link_failed') || 'Failed to connect sign-in method.'), 'error')
        }
      }
    }

    run()
    return () => { cancelled = true }
  }, [notify, t, user])

  const applyDeviceSettings = useCallback((updates = {}) => {
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

  // ?? Settings save ?????????????????????????????????????????????????????????
  const saveSettings = useCallback(async (newSettings) => {
    try {
      const nextSettings = newSettings || {}
      const serverUpdates = {}
      const deviceUpdates = {}
      Object.entries(nextSettings).forEach(([key, value]) => {
        if (DEVICE_LOCAL_SETTING_KEYS.has(key)) deviceUpdates[key] = value
        else serverUpdates[key] = value
      })

      if (Object.keys(serverUpdates).length) {
        await window.api.saveSettings(serverUpdates)
      }
      if (Object.keys(deviceUpdates).length) {
        applyDeviceSettings(deviceUpdates)
      }
      const mergedUpdates = { ...serverUpdates, ...deviceUpdates }
      if (Object.prototype.hasOwnProperty.call(mergedUpdates, 'login_session_duration')) {
        const normalizedSessionDuration = writeStoredSessionDuration(mergedUpdates.login_session_duration)
        const authToken = window.api?.getAuthSessionToken?.() || getStoredAuthToken()
        if (user?.id && authToken && typeof window.api?.updateSessionDuration === 'function') {
          const device = getClientDeviceInfo()
          const refreshed = await window.api.updateSessionDuration({
            sessionDuration: normalizedSessionDuration,
            clientTime: new Date().toISOString(),
            deviceTz: device.deviceTz,
            deviceName: device.deviceName,
          })
          if (refreshed?.success === false) {
            throw new Error(refreshed.error || 'Failed to refresh login session duration')
          }
          const nextAuthToken = String(refreshed?.authToken || '').trim() || authToken
          const nextExpiryTime = computeSessionExpiryMs(
            normalizedSessionDuration,
            refreshed?.sessionExpiresAt || '',
          )
          persistAuthState({
            user,
            authToken: nextAuthToken,
            expiryTime: nextExpiryTime,
            sessionDuration: normalizedSessionDuration,
          })
          window.api?.setAuthSessionToken?.(nextAuthToken)
        }
      }
      if (Object.keys(serverUpdates).length) {
        setSettings((prev) => ({ ...prev, ...serverUpdates }))
      }
      notify(t('settings_saved'))
      return { success: true }
    } catch (error) {
      if (error?.conflict || error?.code === 'write_conflict') {
        await loadSettings().catch(() => {})
        return { success: false, conflict: true }
      }
      notify(error?.message || 'Failed to save settings', 'error')
      return { success: false, error }
    }
  }, [applyDeviceSettings, loadSettings, notify, user]) // eslint-disable-line

  const toggleTheme = useCallback(() => {
    applyDeviceSettings({ theme: theme === 'dark' ? 'light' : 'dark' })
  }, [applyDeviceSettings, theme])

  const toggleLanguage = useCallback(() => {
    applyDeviceSettings({ language: language === 'km' ? 'en' : 'km' })
  }, [applyDeviceSettings, language])

  // ?? Permissions ???????????????????????????????????????????????????????????
  const getPermissions = useCallback(() => {
    if (!user) return {}
    try {
      return typeof user.permissions === 'string'
        ? JSON.parse(user.permissions || '{}')
        : (user.permissions || {})
    } catch { return {} }
  }, [user])

  const hasPermission = useCallback((key) => {
    if (!user) return false
    const p = getPermissions()
    return !!(p.all || p[key])
  }, [user, getPermissions])

  const canAccessPage = useCallback((pageId) => {
    if (!user) return false
    const required = PAGE_PERMISSIONS[pageId]
    if (required == null) return true
    return hasPermission(required)
  }, [user, hasPermission])

  const navigateTo = useCallback((pageId) => {
    if (canAccessPage(pageId)) setPage(pageId)
  }, [canAccessPage])

  // ?? Currency ??????????????????????????????????????????????????????????????
  const exchangeRate    = parseFloat(settings.exchange_rate        || '4100')
  const usdSymbol       = settings.currency_usd_symbol             || '$'
  const khrSymbol       = settings.currency_khr_symbol             || '៛'
  const displayCurrency = settings.display_currency                || 'USD'
  const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const displayTimezone = settings.display_timezone || deviceTimezone

  const fmtUSD = useCallback((n) => {
    return `${usdSymbol}${Number(n||0).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 })}`
  }, [usdSymbol])
  const fmtKHR = useCallback((n) => {
    return `${Number(n||0).toLocaleString('en-US', { maximumFractionDigits:0 })}${khrSymbol}`
  }, [khrSymbol])
  const formatPrice = useCallback((usd, khr) => {
    const u = usd || 0
    const k = khr != null ? khr : u * exchangeRate
    if (displayCurrency === 'BOTH') return `${fmtUSD(u)} / ${fmtKHR(k)}`
    if (displayCurrency === 'KHR')  return fmtKHR(k)
    return fmtUSD(u)
  }, [displayCurrency, fmtUSD, fmtKHR, exchangeRate])
  const usdToKhr = useCallback((usd) => (usd||0) * exchangeRate, [exchangeRate])
  const khrToUsd = useCallback((khr) => (khr||0) / exchangeRate, [exchangeRate])
  const formatDateTime = useCallback((value, options = {}) => {
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

  const appValue = {
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
    canWriteToServer: !!syncUrl && syncConnected && !syncServerUnreachable,
    AccessDenied: () => <AccessDenied t={t} />,
  }

  const syncValue = {
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

const FALLBACK_SYNC_CONTEXT = {
  syncConnected: false,
  syncChannel: null,
  syncServerUnreachable: false,
}

const FALLBACK_APP_CONTEXT = {
  user: null,
  login: async () => ({ success: false, error: 'App context not ready' }),
  logout: () => {},
  persistAuthenticatedUser: () => {},
  authReady: true,
  page: 'dashboard',
  setPage: () => {},
  navigateTo: () => {},
  settings: {},
  loadSettings: async () => ({}),
  saveSettings: async () => ({ success: false, error: 'Settings are not ready yet' }),
  language: 'en',
  theme: 'light',
  t: (key) => key,
  toggleTheme: () => {},
  toggleLanguage: () => {},
  notify: () => {},
  notification: null,
  writeConflict: null,
  dismissWriteConflict: () => {},
  reloadWriteConflict: async () => {},
  hasPermission: () => false,
  canAccessPage: () => true,
  getPermissions: () => [],
  formatPrice: (value) => String(value ?? ''),
  fmtUSD: (value) => `$${Number(value || 0).toFixed(2)}`,
  fmtKHR: (value) => `${Number(value || 0).toLocaleString()} KHR`,
  usdSymbol: '$',
  khrSymbol: 'KHR',
  displayCurrency: 'usd',
  exchangeRate: 4000,
  usdToKhr: (value) => Number(value || 0) * 4000,
  khrToUsd: (value) => Number(value || 0) / 4000,
  displayTimezone: 'UTC',
  deviceTimezone: 'UTC',
  formatDateTime: (value) => String(value || ''),
  syncUrl: '',
  updateSyncUrl: () => {},
  syncConnected: false,
  syncChannel: null,
  syncServerUnreachable: false,
  canWriteToServer: false,
  AccessDenied: () => null,
}

export const useApp = () => useContext(AppContext) || FALLBACK_APP_CONTEXT
export const useSync = () => useContext(SyncContext) || FALLBACK_SYNC_CONTEXT

// Helper hook: gather translations for a list of keys once per render
export const useT = (keys = []) => {
  const ctx = _useContext(AppContext)
  const tfn = ctx?.t || ((k) => k)
  return useMemo(() => {
    const map = {}
    for (const k of keys) map[k] = tfn(k)
    return map
  }, [tfn, keys.join('|')])
}

