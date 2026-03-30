import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import en from './lang/en.json'
import km from './lang/km.json'

const langs = { en, km }
const AppContext = createContext(null)
const isElectron = typeof window !== 'undefined' && typeof window.api !== 'undefined'

// ── Permission map: which page/action requires which key ──────────────────────
export const PAGE_PERMISSIONS = {
  dashboard:        null,
  pos:              'pos',
  products:         'products',
  inventory:        'inventory',
  branches:         'inventory',
  sales:            'sales',
  users:            'users',
  audit_log:        'audit_log',
  backup:           'backup',
  settings:         'settings',
  receipt_settings: 'settings',
}

function NotElectronScreen() {
  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#1e3a8a',fontFamily:'sans-serif'}}>
      <div style={{background:'white',borderRadius:16,padding:40,maxWidth:480,textAlign:'center',boxShadow:'0 25px 50px rgba(0,0,0,.4)'}}>
        <div style={{fontSize:48,marginBottom:16}}>⚠️</div>
        <h2 style={{color:'#1e40af',margin:'0 0 12px'}}>Must run inside Electron</h2>
        <p style={{color:'#6b7280',margin:'0 0 20px'}}>Run in terminal:</p>
        <div style={{background:'#f3f4f6',borderRadius:8,padding:16,textAlign:'left',fontFamily:'monospace',fontSize:13,lineHeight:1.8}}>
          <div>npm install</div><div>npm run rebuild</div><div>npm start</div>
        </div>
      </div>
    </div>
  )
}

function AccessDenied({ t }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
      <div className="text-6xl mb-4">🔒</div>
      <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">{t('access_denied')}</h2>
      <p className="text-gray-500 dark:text-gray-400 max-w-sm">{t('access_denied_desc')}</p>
    </div>
  )
}

export function AppProvider({ children }) {
  const [user, setUser] = useState(null)
  const [settings, setSettings] = useState({})
  const [language, setLanguage] = useState('en')
  const [theme, setTheme] = useState('light')
  const [page, setPage] = useState('dashboard')
  const [notification, setNotification] = useState(null)

  const t = useCallback((key) => langs[language]?.[key] || key, [language])

  useEffect(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
  }, [theme])

  // Apply design settings as CSS variables
  useEffect(() => {
    const root = document.documentElement
    const fontSize = settings.ui_font_size || '14'
    const fontWeight = settings.ui_font_weight || 'normal'
    const accentColor = settings.ui_accent_color || '#2563eb'
    const borderRadius = settings.ui_border_radius || 'rounded'
    const fontFamily = settings.ui_font_family || 'system'

    root.style.setProperty('--ui-font-size', `${fontSize}px`)
    root.style.setProperty('--ui-font-weight', fontWeight)
    root.style.setProperty('--ui-accent', accentColor)
    root.style.setProperty('--ui-accent-hover', accentColor + 'dd')

    // Border radius scale
    const radii = { sharp: '2px', rounded: '8px', pill: '16px' }
    root.style.setProperty('--ui-radius', radii[borderRadius] || '8px')

    // Font family
    const fonts = {
      system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      mono: "'Courier New', Courier, monospace",
      serif: "Georgia, 'Times New Roman', serif",
      khmer: "'Noto Sans Khmer', 'Khmer OS', sans-serif",
    }
    root.style.setProperty('--ui-font-family', fonts[fontFamily] || fonts.system)
    document.body.style.fontFamily = fonts[fontFamily] || fonts.system
    document.body.style.fontSize = `${fontSize}px`
    // Density
    const density = settings.ui_density || 'comfortable'
    document.body.setAttribute('data-density', density)
  }, [settings])

  const loadSettings = useCallback(async () => {
    const s = await window.api.getSettings()
    setSettings(s)
    if (s.language) setLanguage(s.language)
    if (s.theme) setTheme(s.theme)
    return s
  }, [])

  const notify = useCallback((message, type = 'success', duration = 3500) => {
    setNotification({ message, type, id: Date.now() })
    setTimeout(() => setNotification(null), duration)
  }, [])

  const login = useCallback(async (username, password) => {
    const result = await window.api.login({ username, password })
    if (result.success) { setUser(result.user); await loadSettings(); setPage('dashboard') }
    return result
  }, [loadSettings])

  const logout = useCallback(() => { setUser(null); setPage('dashboard') }, [])

  const saveSettings = useCallback(async (newSettings) => {
    await window.api.saveSettings(newSettings)
    setSettings(prev => ({ ...prev, ...newSettings }))
    if (newSettings.language) setLanguage(newSettings.language)
    if (newSettings.theme) setTheme(newSettings.theme)
    notify(t('settings_saved'))
  }, [notify, t])

  // ── Permission helpers ────────────────────────────────────────────────────
  const getPermissions = useCallback(() => {
    if (!user) return {}
    try {
      return typeof user.permissions === 'string'
        ? JSON.parse(user.permissions || '{}')
        : (user.permissions || {})
    } catch { return {} }
  }, [user])

  // Returns true if user can access a given permission key
  const hasPermission = useCallback((key) => {
    if (!user) return false
    const perms = getPermissions()
    return !!(perms.all || perms[key])
  }, [user, getPermissions])

  // Returns true if user can navigate to a page
  const canAccessPage = useCallback((pageId) => {
    if (!user) return false
    const required = PAGE_PERMISSIONS[pageId]
    if (required === null || required === undefined) return true // no restriction
    return hasPermission(required)
  }, [user, hasPermission])

  // Safe setPage — silently blocks if no permission
  const navigateTo = useCallback((pageId) => {
    if (canAccessPage(pageId)) setPage(pageId)
  }, [canAccessPage])

  // ── Currency helpers ──────────────────────────────────────────────────────
  const exchangeRate = parseFloat(settings.exchange_rate || '4100')
  const usdSymbol = settings.currency_usd_symbol || '$'
  const khrSymbol = settings.currency_khr_symbol || '៛'
  const displayCurrency = settings.display_currency || 'USD'

  const fmtUSD = useCallback((amount) => {
    const n = Number(amount || 0)
    return `${usdSymbol}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }, [usdSymbol])

  const fmtKHR = useCallback((amount) => {
    const n = Number(amount || 0)
    return `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}${khrSymbol}`
  }, [khrSymbol])

  const formatPrice = useCallback((amountUsd, amountKhr) => {
    const usd = amountUsd || 0
    const khr = amountKhr != null ? amountKhr : usd * exchangeRate
    if (displayCurrency === 'BOTH') return `${fmtUSD(usd)} / ${fmtKHR(khr)}`
    if (displayCurrency === 'KHR') return fmtKHR(khr)
    return fmtUSD(usd)
  }, [displayCurrency, fmtUSD, fmtKHR, exchangeRate])

  const usdToKhr = useCallback((usd) => (usd || 0) * exchangeRate, [exchangeRate])
  const khrToUsd = useCallback((khr) => (khr || 0) / exchangeRate, [exchangeRate])

  if (!isElectron) return <NotElectronScreen />

  return (
    <AppContext.Provider value={{
      user, settings, language, theme, page, setPage, navigateTo, t, notify,
      login, logout, saveSettings, loadSettings,
      hasPermission, canAccessPage, getPermissions,
      formatPrice, fmtUSD, fmtKHR, usdSymbol, khrSymbol,
      displayCurrency, exchangeRate, usdToKhr, khrToUsd,
      notification,
      AccessDenied: () => <AccessDenied t={t} />
    }}>
      {children}
    </AppContext.Provider>
  )
}

export const useApp = () => useContext(AppContext)
