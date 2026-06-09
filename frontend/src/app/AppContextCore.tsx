import { createContext, useContext, useMemo, type ReactNode } from 'react'

type PlainRecord = Record<string, unknown>
type NotificationKind = 'success' | 'error' | 'warning' | 'info'

type AppNotification = { id: number; message: string; type: NotificationKind | string }
type SyncChannelUpdate = {
  channel: string
  reason?: string | null
  source?: string | null
  ts: number
}

export type AppContextCoreValue = {
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
  loadSettings: (options?: { force?: boolean }) => Promise<PlainRecord>
  login: (...args: unknown[]) => Promise<PlainRecord>
  logout: () => Promise<void>
  navigateTo: (pageId: string) => void
  notification: AppNotification | null
  notify: (message: unknown, type?: NotificationKind | string, duration?: number) => void
  page: string
  persistAuthenticatedUser: (...args: unknown[]) => Promise<void>
  reloadWriteConflict: () => Promise<void>
  saveSettings: (...args: unknown[]) => Promise<PlainRecord>
  setPage: (page: string) => void
  settings: PlainRecord
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
  user: PlainRecord | null
  writeConflict: PlainRecord | null
}

export type SyncContextCoreValue = Pick<AppContextCoreValue, 'syncChannel' | 'syncConnected' | 'syncServerUnreachable'>

function normalizePriceValue(value: unknown): number {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return 0
  return Math.round((numberValue + Number.EPSILON) * 100) / 100
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

export const FALLBACK_SYNC_CONTEXT: SyncContextCoreValue = {
  syncConnected: false,
  syncChannel: null,
  syncServerUnreachable: false,
}

export const FALLBACK_APP_CONTEXT: AppContextCoreValue = {
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

export const AppContext = createContext<AppContextCoreValue | null>(null)
export const SyncContext = createContext<SyncContextCoreValue | null>(null)

export const useApp = (): unknown => useContext(AppContext) || FALLBACK_APP_CONTEXT
export const useSync = (): unknown => useContext(SyncContext) || FALLBACK_SYNC_CONTEXT

export const useT = (keys: string[] = []): Record<string, string> => {
  const ctx = useContext(AppContext)
  const tfn = ctx?.t || ((key: string) => key)
  return useMemo(() => {
    const map: Record<string, string> = {}
    for (const key of keys) map[key] = tfn(key)
    return map
  }, [tfn, keys.join('|')])
}
