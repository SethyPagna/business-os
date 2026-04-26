import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, useContext as _useContext } from 'react'
import en from './lang/en.json'
import km from './lang/km.json'
import { STORAGE_KEYS, SYNC } from './constants'
// web-api.js installs window.api synchronously via static imports.
// Importing it here (rather than dynamic import) ensures window.api
// is available before any React render cycle runs.
import './web-api.js'
import { cacheClearAll, startHealthCheck } from './api/http.js'
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

const langs = { en, km }
const AppContext = createContext(null)
const SyncContext = createContext(null)

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
  receipt_settings: 'settings',
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
    // Recover user from localStorage on initial load (no re-login after reload)
    // BUT check expiration and detect server restarts
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.USER)
      const expiry = localStorage.getItem(STORAGE_KEYS.USER_EXPIRY)
      const serverStartTime = localStorage.getItem(STORAGE_KEYS.SERVER_START_TIME)
      
      if (stored && expiry) {
        // Check if session expired
        if (Date.now() > parseInt(expiry, 10)) {
          // Session expired ??clear it
          localStorage.removeItem(STORAGE_KEYS.USER)
          localStorage.removeItem(STORAGE_KEYS.USER_EXPIRY)
          return null
        }
        
        // Check if server was restarted (detect stale cache scenario)
        // If serverStartTime changed, server restarted, so clear user to force re-login
        // This prevents stale user data from old server session being used with new server instance
        if (serverStartTime && localStorage.getItem(STORAGE_KEYS.SERVER_START_TIME) !== serverStartTime) {
          localStorage.removeItem(STORAGE_KEYS.USER)
          localStorage.removeItem(STORAGE_KEYS.USER_EXPIRY)
          return null
        }
        
        return JSON.parse(stored)
      }
    } catch (_) {}
    return null
  })
  const [settings,            setSettings]            = useState({})
  const [language,            setLanguage]            = useState('en')
  const [theme,               setTheme]               = useState('light')
  const [page,                setPage]                = useState('dashboard')
  const [notification,        setNotification]        = useState(null)
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
  const t = useCallback((key) => langs[language]?.[key] ?? langs.en?.[key] ?? key, [language])

  // ?? Settings (defined before any useEffect that uses it) ?????????????????
  const loadSettings = useCallback(async () => {
    try {
      const s = await window.api.getSettings()
      setSettings(s)
      if (s.language) setLanguage(s.language)
      if (s.theme)    setTheme(s.theme)
      return s
    } catch (e) {
      console.warn('[AppContext] loadSettings failed:', e.message)
      return {}
    }
  }, [])

  // ?? Sync event listeners (loadSettings is now defined above) ?????????????
  const debounceRef = useRef({})
  useEffect(() => {
    const onUpdate = (e) => {
      const { channel } = e.detail
      if (debounceRef.current[channel]) clearTimeout(debounceRef.current[channel])
      debounceRef.current[channel] = setTimeout(() => {
        delete debounceRef.current[channel]
        // Settings changes from other devices apply immediately ??no reload needed
        if (channel === 'settings') loadSettings().catch(() => {})
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
    window.addEventListener('sync:update', onUpdate)
    window.addEventListener('sync:status', onStatus)
    window.addEventListener('sync:error',  onError)
    return () => {
      clearInterval(pollTimer)
      window.removeEventListener('sync:update', onUpdate)
      window.removeEventListener('sync:status', onStatus)
      window.removeEventListener('sync:error',  onError)
      Object.values(debounceRef.current).forEach(clearTimeout)
    }
  }, [loadSettings])

  // ?? OTP login event listener ?????????????????????????????????????????????
  useEffect(() => {
    const handleOtpLogin = async (e) => {
      const otpUser = e.detail
      if (!otpUser) return
      const { password: _pw, otp_secret: _sec, ...safeUser } = otpUser

      let expiryTime = null
      try {
        const sessionDuration = localStorage.getItem(STORAGE_KEYS.SESSION_DURATION) || 'session'
        if (sessionDuration === '7d') expiryTime = Date.now() + (7 * 24 * 60 * 60 * 1000)
        if (sessionDuration === '30d') expiryTime = Date.now() + (30 * 24 * 60 * 60 * 1000)
      } catch (_) {}

      try {
        localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(safeUser))
        if (expiryTime) localStorage.setItem(STORAGE_KEYS.USER_EXPIRY, expiryTime.toString())
        else localStorage.removeItem(STORAGE_KEYS.USER_EXPIRY)
        localStorage.setItem(STORAGE_KEYS.SERVER_START_TIME, Date.now().toString())
      } catch (_) {}

      setUser(safeUser)
      await loadSettings()
      setPage('dashboard')
    }
    window.addEventListener('otp:login', handleOtpLogin)
    return () => window.removeEventListener('otp:login', handleOtpLogin)
  }, [loadSettings])

  useEffect(() => {
    const handleUserUpdated = (e) => {
      const nextUser = e.detail
      if (!nextUser) return
      setUser((prev) => {
        if (!prev || Number(prev.id) !== Number(nextUser.id)) return prev
        const merged = { ...prev, ...nextUser }
        try {
          localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(merged))
        } catch (_) {}
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
    
    // Load app settings from server/cache (parallel, doesn't block UI)
    loadSettings()
    
    // Non-blocking async sync URL discovery ??activates the sync server
    // connection without blocking the initial render.
    const discoverSyncUrl = async () => {
      try {
        const isViteDev = window.location.hostname === 'localhost' &&
          (window.location.port === '5173' || window.location.port === '5174')

        // When served by the backend, the current origin IS the API/WS server.
        // Never trust a stale stored URL (e.g. localhost set from a different device).
        const effectiveUrl = isViteDev
          ? (localStorage.getItem(STORAGE_KEYS.SYNC_SERVER) || syncUrl)
          : window.location.origin

        if (effectiveUrl) {
          window.api?.setSyncServerUrl?.(effectiveUrl)

          // Fetch server config for restart-detection
          fetch(`${effectiveUrl}/api/system/config`, { signal: AbortSignal.timeout?.(3000) })
            .then(r => r.ok ? r.json() : null)
            .then(config => {
              if (config?.serverStartTime) {
                try { localStorage.setItem(STORAGE_KEYS.SERVER_START_TIME, config.serverStartTime.toString()) } catch (_) {}
              }
            })
            .catch(() => {})

          fetch(`${effectiveUrl}/health`, { signal: AbortSignal.timeout?.(6000) })
            .then(r => setSyncServerUnreachable(!r.ok))
            .catch(() => setSyncServerUnreachable(true))
        }
        return
      } catch (e) {
        console.debug('[AppContext] discoverSyncUrl error:', e.message)
      }

    }
    
    // Start discovery in background (no await, doesn't block UI render)
    discoverSyncUrl()
  }, [syncUrl, loadSettings])

  // ?? Theme and CSS variables ???????????????????????????????????????????????
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

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
    document.body.setAttribute('data-ui-language', settings.language || 'en')
    document.body.setAttribute('data-density', settings.ui_density || 'comfortable')

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
  }, [settings])

  // ?? Sync URL management ???????????????????????????????????????????????????
  const updateSyncUrl = useCallback((url) => {
    const clean = (url || '').trim().replace(/\/$/, '')
    try { clean ? localStorage.setItem(STORAGE_KEYS.SYNC_SERVER, clean) : localStorage.removeItem(STORAGE_KEYS.SYNC_SERVER) } catch (_) {}
    _setSyncUrl(clean)
    window.api?.setSyncServerUrl?.(clean || null)
    if (clean) startHealthCheck()
  }, [])

  const updateSyncToken = useCallback((token) => {
    const clean = (token || '').trim()
    try { clean ? localStorage.setItem(STORAGE_KEYS.SYNC_TOKEN, clean) : localStorage.removeItem(STORAGE_KEYS.SYNC_TOKEN) } catch (_) {}
    window.api?.setSyncToken?.(clean || null)
  }, [])

  // ?? Auth ??????????????????????????????????????????????????????????????????
  const persistAuthenticatedUser = useCallback(async (nextUser, sessionDuration = 'session') => {
    let expiryTime = null
    if (sessionDuration === '7d') {
      expiryTime = Date.now() + (7 * 24 * 60 * 60 * 1000)
    } else if (sessionDuration === '30d') {
      expiryTime = Date.now() + (30 * 24 * 60 * 60 * 1000)
    }

    try {
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(nextUser))
      if (expiryTime) {
        localStorage.setItem(STORAGE_KEYS.USER_EXPIRY, expiryTime.toString())
      } else {
        localStorage.removeItem(STORAGE_KEYS.USER_EXPIRY)
      }
      localStorage.setItem(STORAGE_KEYS.SERVER_START_TIME, Date.now().toString())
    } catch (_) {}

    cacheClearAll()
    startHealthCheck()
    setUser(nextUser)
    await loadSettings()
    setPage('dashboard')
  }, [loadSettings])

  const login = useCallback(async (username, password, sessionDuration = 'session') => {
    try {
      const device = getClientDeviceInfo()
      const result = await window.api.login({
        username, password,
        clientTime: new Date().toISOString(),
        deviceTz: device.deviceTz,
        deviceName: device.deviceName,
      })
      if (result.success) {
        await persistAuthenticatedUser(result.user, sessionDuration)
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

  const logout = useCallback(() => {
    setUser(null)
    setPage('dashboard')
    try {
      localStorage.removeItem(STORAGE_KEYS.USER)
      localStorage.removeItem(STORAGE_KEYS.USER_EXPIRY)
      localStorage.removeItem(STORAGE_KEYS.SERVER_START_TIME)
    } catch (_) {}
  }, [])

  // ?? Notifications ?????????????????????????????????????????????????????????
  const notify = useCallback((message, type = 'success', duration = 3500) => {
    setNotification({ message, type, id: Date.now() })
    setTimeout(() => setNotification(null), duration)
  }, [])

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

    const run = async () => {
      if (errorDescription) {
        clearCallbackUrl()
        if (!cancelled) notify(errorDescription, 'error')
        return
      }
      if (!user?.id) {
        clearCallbackUrl()
        if (!cancelled) notify(t('identity_link_failed') || 'Failed to connect sign-in method.', 'error')
        return
      }

      try {
        const device = getClientDeviceInfo()
        const result = await window.api.completeSupabaseOauth({
          accessToken,
          provider,
          mode: 'link',
          currentUserId: user.id,
          clientTime: new Date().toISOString(),
          deviceTz: device.deviceTz,
          deviceName: device.deviceName,
        })
        clearCallbackUrl()
        if (cancelled) return
        if (result?.success && result?.user) {
          window.dispatchEvent(new CustomEvent('user:updated', { detail: result.user }))
          notify(t('identity_linked_success') || 'Sign-in method connected.', 'success')
          return
        }
        notify(result?.error || (t('identity_link_failed') || 'Failed to connect sign-in method.'), 'error')
      } catch (error) {
        clearCallbackUrl()
        if (!cancelled) {
          notify(error?.message || (t('identity_link_failed') || 'Failed to connect sign-in method.'), 'error')
        }
      }
    }

    run()
    return () => { cancelled = true }
  }, [notify, t, user])

  // ?? Settings save ?????????????????????????????????????????????????????????
  const saveSettings = useCallback(async (newSettings) => {
    await window.api.saveSettings(newSettings)
    setSettings(prev => ({ ...prev, ...newSettings }))
    if (newSettings.language) setLanguage(newSettings.language)
    if (newSettings.theme)    setTheme(newSettings.theme)
    notify(t('settings_saved'))
  }, [notify]) // eslint-disable-line

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

  const appValue = {
    user, login, logout, persistAuthenticatedUser,
    page, setPage, navigateTo,
    settings, loadSettings, saveSettings,
    language, theme, t,
    notify, notification,
    hasPermission, canAccessPage, getPermissions,
    formatPrice, fmtUSD, fmtKHR,
    usdSymbol, khrSymbol, displayCurrency, exchangeRate,
    usdToKhr, khrToUsd,
    syncUrl, updateSyncUrl, updateSyncToken,
    // Expose sync status so components that use useApp() (legacy) can read it.
    syncConnected,
    syncChannel,
    syncServerUnreachable,
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

export const useApp = () => useContext(AppContext)
export const useSync = () => useContext(SyncContext)

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

