import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, AlertTriangle, Bell, CheckCircle2, ChevronDown, ExternalLink, Info, Search, Settings2, X } from 'lucide-react'
import { useApp, useSync } from '../../AppContext'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.mjs'

const DEFAULT_COLLAPSED = {
  inventory: false,
  sales: false,
  loyalty: true,
  portal: false,
  system: false,
  expiry: false,
}

const NOTIFICATION_SEEN_KEY = 'business_os_notifications_seen_at'
const NOTIFICATION_FILTER_OPTIONS = ['all', 'danger', 'warning', 'info', 'success']
const NOTIFICATION_PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

const TONE_CLASS = {
  danger: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  info: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
}

const TONE_ICON_RING_CLASS = {
  danger: 'ring-red-200 dark:ring-red-800/70',
  warning: 'ring-amber-200 dark:ring-amber-800/70',
  success: 'ring-emerald-200 dark:ring-emerald-800/70',
  info: 'ring-sky-200 dark:ring-sky-800/70',
}

const TONE_ICON_COMPONENT = {
  danger: AlertCircle,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: Info,
}

const SECTION_LABEL_KEYS = {
  inventory: ['notification_inventory', 'Inventory', 'ស្តុកទំនិញ'],
  sales: ['sales', 'Sales', 'ការលក់'],
  loyalty: ['loyalty_points', 'Loyalty', 'ពិន្ទុស្មោះត្រង់'],
  portal: ['customer_portal', 'Customer portal', 'ផតថលអតិថិជន'],
  system: ['system', 'System', 'ប្រព័ន្ធ'],
}

SECTION_LABEL_KEYS.expiry = ['notification_expiry_title', 'Product expiry', 'ផុតកំណត់ផលិតផល']

const TONE_LABEL_KEYS = {
  danger: ['status_danger', 'Danger', 'បន្ទាន់'],
  warning: ['status_warning', 'Warning', 'ប្រុងប្រយ័ត្ន'],
  success: ['status_success', 'Success', 'ជោគជ័យ'],
  info: ['status_info', 'Info', 'ព័ត៌មាន'],
}

const SECTION_SUMMARY_COPY = {
  notification_inventory_summary: {
    en: ({ outCount, lowCount }) => [outCount ? `${outCount} out of stock` : null, lowCount ? `${lowCount} low stock` : null].filter(Boolean).join(' • '),
    km: ({ outCount, lowCount }) => [outCount ? `${outCount} អស់ស្តុក` : null, lowCount ? `${lowCount} ស្តុកទាប` : null].filter(Boolean).join(' • '),
  },
  notification_sales_summary: {
    en: ({ awaitingPaymentCount, awaitingDeliveryCount }) => [awaitingPaymentCount ? `${awaitingPaymentCount} awaiting payment` : null, awaitingDeliveryCount ? `${awaitingDeliveryCount} awaiting delivery` : null].filter(Boolean).join(' • '),
    km: ({ awaitingPaymentCount, awaitingDeliveryCount }) => [awaitingPaymentCount ? `${awaitingPaymentCount} កំពុងរង់ចាំបង់ប្រាក់` : null, awaitingDeliveryCount ? `${awaitingDeliveryCount} កំពុងរង់ចាំដឹកជញ្ជូន` : null].filter(Boolean).join(' • '),
  },
  notification_loyalty_summary: {
    en: ({ count, threshold }) => `${count} customer${count === 1 ? '' : 's'} reached ${threshold}+ points`,
    km: ({ count, threshold }) => `${count} អតិថិជនឈានដល់ ${threshold}+ ពិន្ទុ`,
  },
  notification_portal_summary: {
    en: ({ count }) => `${count} pending customer submission${count === 1 ? '' : 's'}`,
    km: ({ count }) => `${count} សំណើអតិថិជនកំពុងរង់ចាំ`,
  },
  notification_system_drive_sync_summary: {
    en: () => 'Google Drive sync needs attention',
    km: () => 'Google Drive sync ត្រូវការការយកចិត្តទុកដាក់',
  },
}

SECTION_SUMMARY_COPY.notification_expiry_summary = {
  en: ({ expiredCount, expiringCount, days }) => [expiredCount ? `${expiredCount} expired` : null, expiringCount ? `${expiringCount} expiring within ${days} days` : null].filter(Boolean).join(' • '),
  km: ({ expiredCount, expiringCount, days }) => [expiredCount ? `${expiredCount} ផុតកំណត់` : null, expiringCount ? `${expiringCount} នឹងផុតកំណត់ក្នុង ${days} ថ្ងៃ` : null].filter(Boolean).join(' • '),
}

const ITEM_META_COPY = {
  notification_inventory_out_of_stock: {
    en: () => 'Out of stock',
    km: () => 'អស់ស្តុក',
  },
  notification_inventory_low_stock: {
    en: ({ quantity }) => `Low stock (${quantity})`,
    km: ({ quantity }) => `ស្តុកទាប (${quantity})`,
  },
  notification_sales_awaiting_payment: {
    en: ({ totalUsd }) => `Awaiting payment • $${totalUsd}`,
    km: ({ totalUsd }) => `រង់ចាំបង់ប្រាក់ • $${totalUsd}`,
  },
  notification_sales_awaiting_delivery: {
    en: ({ totalUsd }) => `Awaiting delivery • $${totalUsd}`,
    km: ({ totalUsd }) => `រង់ចាំដឹកជញ្ជូន • $${totalUsd}`,
  },
  notification_loyalty_points_balance: {
    en: ({ balance }) => `${balance} points`,
    km: ({ balance }) => `${balance} ពិន្ទុ`,
  },
  notification_portal_pending_review: {
    en: () => 'Pending review',
    km: () => 'កំពុងរង់ចាំពិនិត្យ',
  },
  notification_portal_pending_review_platform: {
    en: ({ platform }) => `Pending review • ${platform}`,
    km: ({ platform }) => `កំពុងរង់ចាំពិនិត្យ • ${platform}`,
  },
  notification_system_drive_sync_reconnect: {
    en: () => 'Reconnect Google Drive to resume sync',
    km: () => 'ភ្ជាប់ Google Drive ឡើងវិញដើម្បីបន្ត sync',
  },
}

ITEM_META_COPY.notification_product_expired = {
  en: ({ days, expiryDate }) => `Expired ${days} day${Number(days) === 1 ? '' : 's'} ago • ${expiryDate}`,
  km: ({ days, expiryDate }) => `ផុតកំណត់ ${days} ថ្ងៃមុន • ${expiryDate}`,
}
ITEM_META_COPY.notification_product_expiring = {
  en: ({ days, expiryDate }) => `Expires in ${days} day${Number(days) === 1 ? '' : 's'} • ${expiryDate}`,
  km: ({ days, expiryDate }) => `នឹងផុតកំណត់ក្នុង ${days} ថ្ងៃ • ${expiryDate}`,
}

function preferenceValue(key, settings = {}, fallback = true) {
  const raw = settings?.[key]
  if (raw === undefined || raw === null || raw === '') return fallback
  if (typeof raw === 'boolean') return raw
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase())
}

function matchesVisibilityMode(mode) {
  if (typeof window === 'undefined' || !window.matchMedia) return true
  if (mode === 'desktop') return window.matchMedia('(min-width: 768px)').matches
  if (mode === 'mobile') return window.matchMedia('(max-width: 767px)').matches
  return true
}

function getRealertMs(settings = {}, fallbackMinutes = 10) {
  const minutes = Number(settings?.notifications_realert_minutes || fallbackMinutes)
  const safeMinutes = Number.isFinite(minutes) ? Math.max(5, Math.min(1440, minutes)) : fallbackMinutes
  return safeMinutes * 60 * 1000
}

function NotificationSeverityIcon({ tone = 'info', label }) {
  const safeTone = TONE_ICON_COMPONENT[tone] ? tone : 'info'
  const ToneIcon = TONE_ICON_COMPONENT[safeTone]
  return (
    <span
      data-notification-severity-icon={safeTone}
      className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${TONE_CLASS[safeTone]} ${TONE_ICON_RING_CLASS[safeTone]}`}
      title={label}
      aria-label={label}
    >
      <ToneIcon className="h-3.5 w-3.5 stroke-[2.4]" aria-hidden="true" />
    </span>
  )
}

export default function NotificationCenter({ compact = false, visibility = 'always' }) {
  const { navigateTo, notify, saveSettings, settings, t } = useApp()
  const { syncChannel } = useSync()
  const isKhmer = /[\u1780-\u17FF]/.test(t?.('cancel') || '')
  const tr = useCallback((key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = t?.(key)
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }, [isKhmer, t])
  const formatCopy = useCallback((key, params, fallbackEn, fallbackKm = fallbackEn) => {
    const template = tr(key, fallbackEn, fallbackKm)
    return Object.entries(params || {}).reduce(
      (message, [paramKey, value]) => message.replaceAll(`{${paramKey}}`, String(value)),
      template,
    )
  }, [tr])
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState({ unreadCount: 0, sections: [], preferences: {} })
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState(DEFAULT_COLLAPSED)
  const [savingKey, setSavingKey] = useState('')
  const [toneFilter, setToneFilter] = useState('all')
  const [notificationSearch, setNotificationSearch] = useState('')
  const [itemLimit, setItemLimit] = useState(20)
  const [sectionPages, setSectionPages] = useState({})
  const [seenAt, setSeenAt] = useState(() => {
    try { return Number(window.localStorage.getItem(NOTIFICATION_SEEN_KEY) || 0) || 0 } catch (_) { return 0 }
  })
  const [visibilityActive, setVisibilityActive] = useState(() => matchesVisibilityMode(visibility))
  const containerRef = useRef(null)
  const panelRef = useRef(null)
  const requestRef = useRef(0)
  const aliveRef = useRef(true)
  const refreshTimerRef = useRef(null)
  const failureCountRef = useRef(0)

  useEffect(() => {
    const syncVisibility = () => setVisibilityActive(matchesVisibilityMode(visibility))
    syncVisibility()
    window.addEventListener('resize', syncVisibility)
    return () => window.removeEventListener('resize', syncVisibility)
  }, [visibility])

  const scheduleRefresh = useCallback((delayMs) => {
    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null
      if (aliveRef.current) {
        void loadSummary(true)
      }
    }, delayMs)
  }, [])

  const loadSummary = useCallback(async (silent = false) => {
    const requestId = beginTrackedRequest(requestRef)
    if (!silent && aliveRef.current) setLoading(true)
    try {
      const result = await withLoaderTimeout(() => window.api.getNotificationSummary(), 'Notifications', 8000)
      if (!aliveRef.current || !isTrackedRequestCurrent(requestRef, requestId)) return
      failureCountRef.current = 0
      const nextSections = Array.isArray(result?.sections) ? result.sections : []
      setSummary((current) => {
        if (result?.unavailable && !nextSections.length && (current?.sections || []).length) {
          return {
            ...current,
            unreadCount: Number(current?.unreadCount || 0),
            preferences: result?.preferences || current?.preferences || {},
            unavailable: true,
            cooldownUntil: result?.cooldownUntil,
          }
        }
        return {
          unreadCount: Number(result?.unreadCount || 0),
          sections: nextSections,
          preferences: result?.preferences || {},
          unavailable: !!result?.unavailable,
          cooldownUntil: result?.cooldownUntil,
        }
      })
      const unavailableDelay = Math.max(
        5 * 60 * 1000,
        Number(result?.cooldownUntil || 0) - Date.now(),
      )
      scheduleRefresh(result?.unavailable ? unavailableDelay : 30000)
    } catch (error) {
      if (!aliveRef.current || !isTrackedRequestCurrent(requestRef, requestId)) return
      failureCountRef.current += 1
      scheduleRefresh(Math.min(90000, 15000 * failureCountRef.current))
      if (!silent) {
        console.error('[NotificationCenter] load failed:', error?.message || error)
      }
    } finally {
      if (!silent && aliveRef.current && isTrackedRequestCurrent(requestRef, requestId)) {
        setLoading(false)
      }
    }
  }, [scheduleRefresh])

  useEffect(() => {
    if (!visibilityActive) {
      invalidateTrackedRequest(requestRef)
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
      return undefined
    }
    aliveRef.current = true
    void loadSummary()
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadSummary(true)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      aliveRef.current = false
      document.removeEventListener('visibilitychange', onVisible)
      invalidateTrackedRequest(requestRef)
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
    }
  }, [loadSummary, visibilityActive])

  useEffect(() => {
    if (!visibilityActive) return
    if (!syncChannel?.channel) return
    if (['inventory', 'sales', 'returns', 'customers', 'contacts', 'catalog', 'settings', 'backup'].includes(syncChannel.channel)) {
      void loadSummary(true)
    }
  }, [loadSummary, syncChannel?.channel, syncChannel?.ts, visibilityActive])

  useEffect(() => {
    const handleClickOutside = (event) => {
      const target = event.target
      if (!containerRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [])

  const renderStructuredCopy = useCallback((key, params, fallback) => {
    const entry = SECTION_SUMMARY_COPY[key] || ITEM_META_COPY[key]
    if (!entry) return fallback || ''
    const renderer = isKhmer ? entry.km : entry.en
    return typeof renderer === 'function' ? renderer(params || {}) : (fallback || '')
  }, [isKhmer])

  const normalizedNotificationSearch = notificationSearch.trim().toLowerCase()

  const effectiveSections = useMemo(() => (
    (summary.sections || []).map((section) => {
      const displayLabel = SECTION_LABEL_KEYS[section.id]
        ? tr(...SECTION_LABEL_KEYS[section.id])
        : section.label
      const displaySummary = section.summaryKey
        ? renderStructuredCopy(section.summaryKey, section.summaryParams, section.summary)
        : section.summary
      const decoratedItems = Array.isArray(section.items)
        ? section.items.map((item) => ({
          ...item,
          displayMeta: item.metaKey
            ? renderStructuredCopy(item.metaKey, item.metaParams, item.meta)
            : item.meta,
        }))
        : []
      const filteredItems = decoratedItems.filter((item) => {
        if (toneFilter !== 'all' && item.tone !== toneFilter) return false
        if (!normalizedNotificationSearch) return true
        const haystack = [
          displayLabel,
          displaySummary,
          section.id,
          section.label,
          section.summary,
          item.label,
          item.displayMeta,
          item.meta,
          item.kind,
          item.tone,
          item.pageId,
          ...Object.values(item.metaParams || {}),
        ].filter((value) => value !== undefined && value !== null).join(' ').toLowerCase()
        return haystack.includes(normalizedNotificationSearch)
      })
      const totalPages = Math.max(1, Math.ceil(filteredItems.length / itemLimit))
      const page = Math.max(1, Math.min(totalPages, Number(sectionPages[section.id] || 1)))
      const startIndex = (page - 1) * itemLimit
      return {
      ...section,
      displayLabel,
      displaySummary,
      items: filteredItems.slice(startIndex, startIndex + itemLimit),
      hiddenItemCount: Math.max(0, filteredItems.length - (startIndex + itemLimit)),
      filteredItemCount: filteredItems.length,
      page,
      totalPages,
      enabled: preferenceValue(section.enabledKey, settings, true),
      }
    }).filter((section) => section.filteredItemCount > 0 || (toneFilter === 'all' && !normalizedNotificationSearch))
  ), [itemLimit, normalizedNotificationSearch, renderStructuredCopy, sectionPages, settings, summary.sections, toneFilter, tr])

  useEffect(() => {
    setSectionPages({})
  }, [itemLimit, normalizedNotificationSearch, toneFilter])

  const toggleSectionPreference = useCallback(async (section) => {
    if (!section?.enabledKey || savingKey) return
    const nextValue = !preferenceValue(section.enabledKey, settings, true)
    setSavingKey(section.enabledKey)
    try {
      await saveSettings({ [section.enabledKey]: nextValue ? 'true' : 'false' })
      void loadSummary(true)
    } catch (error) {
      notify(error?.message || tr('notification_setting_update_failed', 'Failed to update notification setting', 'បរាជ័យក្នុងការកែប្រែការជូនដំណឹង'), 'error')
    } finally {
      if (aliveRef.current) setSavingKey('')
    }
  }, [loadSummary, notify, saveSettings, savingKey, settings, tr])

  const realertMs = getRealertMs(settings, summary.preferences?.realertMinutes || 10)
  const badgeSuppressed = seenAt > 0 && Date.now() - seenAt < realertMs
  const activeAlertCount = Number(summary.unreadCount || 0)
  const badgeCount = badgeSuppressed ? 0 : activeAlertCount

  if (!visibilityActive) return null

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current)
          if (!open) {
            const now = Date.now()
            setSeenAt(now)
            try { window.localStorage.setItem(NOTIFICATION_SEEN_KEY, String(now)) } catch (_) {}
            void loadSummary(true)
          }
        }}
        className={`relative inline-flex items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-600 transition hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:text-blue-300 ${compact ? 'h-8 w-8 sm:h-9 sm:w-9' : 'h-10 w-10'}`}
        aria-label={tr('notifications', 'Notifications', 'ការជូនដំណឹង')}
        title={tr('notifications', 'Notifications', 'ការជូនដំណឹង')}
      >
        <Bell className={compact ? 'h-4 w-4' : 'h-[18px] w-[18px]'} />
        {badgeCount > 0 ? (
          <span className={`absolute inline-flex min-h-[16px] min-w-[16px] max-w-[2.25rem] items-center justify-center overflow-hidden rounded-full bg-red-600 px-1 text-[9px] font-semibold leading-none text-white ${compact ? 'right-0 top-0 translate-x-1/4 -translate-y-1/4' : 'right-0 top-0 translate-x-1/3 -translate-y-1/3'}`}>
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        ) : null}
      </button>

      {open && typeof document !== 'undefined' ? createPortal((
        <div ref={panelRef} className="fixed left-2 right-2 top-16 z-[1000] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:left-auto sm:right-4 sm:w-[min(92vw,24rem)] sm:max-w-[calc(100vw-1rem)]">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-3 dark:border-slate-700 sm:px-4">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">{tr('notifications', 'Notifications', 'ការជូនដំណឹង')}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {activeAlertCount
                  ? formatCopy(
                    'notification_active_count',
                    { count: activeAlertCount },
                    `${activeAlertCount} active alert${activeAlertCount === 1 ? '' : 's'}`,
                    `${activeAlertCount} ការជូនដំណឹងកំពុងដំណើរការ`,
                  )
                  : tr('notification_all_clear', 'Everything looks calm right now', 'មិនមានការជូនដំណឹងសំខាន់នៅពេលនេះទេ')}
              </div>
            </div>
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500 transition hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-blue-500 dark:hover:text-blue-300 sm:px-2.5 sm:text-xs"
              onClick={() => navigateTo('settings')}
            >
              <Settings2 className="h-3.5 w-3.5" />
              {tr('settings', 'Settings', 'ការកំណត់')}
            </button>
          </div>

          <div className="max-h-[70vh] overflow-y-auto px-2 py-2 sm:px-3 sm:py-3">
            <div className="mb-3 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/60 sm:grid-cols-[1fr_auto]">
              <label className="relative sm:col-span-2">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  type="search"
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-8 text-xs text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-blue-500 dark:focus:ring-blue-950/40"
                  value={notificationSearch}
                  onChange={(event) => setNotificationSearch(event.target.value)}
                  placeholder={tr('search_notifications', 'Search notifications', 'Search notifications')}
                  aria-label={tr('search_notifications', 'Search notifications', 'Search notifications')}
                />
                {notificationSearch ? (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    onClick={() => setNotificationSearch('')}
                    aria-label={tr('clear_search', 'Clear search', 'Clear search')}
                    title={tr('clear_search', 'Clear search', 'Clear search')}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {NOTIFICATION_FILTER_OPTIONS.map((tone) => {
                  const label = tone === 'all' ? tr('all', 'All', 'ទាំងអស់') : (TONE_LABEL_KEYS[tone] ? tr(...TONE_LABEL_KEYS[tone]) : tone)
                  const ToneIcon = TONE_ICON_COMPONENT[tone] || Info
                  return (
                    <button
                      key={tone}
                      type="button"
                      className={`inline-flex min-h-7 items-center justify-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${toneFilter === tone ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-700'}`}
                      onClick={() => setToneFilter(tone)}
                      title={label}
                      aria-label={label}
                    >
                      {tone === 'all' ? label : <ToneIcon className="h-3.5 w-3.5" aria-hidden="true" />}
                    </button>
                  )
                })}
              </div>
              <label className="flex items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-300">
                {tr('per_page', 'Per page', 'ក្នុងមួយទំព័រ')}
                <select className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900" value={itemLimit} onChange={(event) => setItemLimit(Number(event.target.value) || 20)}>
                  {NOTIFICATION_PAGE_SIZE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
            </div>

            {loading && !effectiveSections.length ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
                {tr('loading_notifications', 'Loading notifications...', 'កំពុងផ្ទុកការជូនដំណឹង...')}
              </div>
            ) : null}

            {!loading && !effectiveSections.length ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
                {tr('no_active_notifications', 'No active notifications.', 'មិនមានការជូនដំណឹងកំពុងដំណើរការ។')}
              </div>
            ) : null}

            <div className="space-y-2.5">
              {effectiveSections.map((section) => {
                const isCollapsed = collapsed[section.id] ?? DEFAULT_COLLAPSED[section.id] ?? false
                return (
                  <section key={section.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800/40">
                    <div className="flex items-start gap-2 px-2.5 py-2.5 sm:px-3">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-start gap-3 text-left"
                        onClick={() => setCollapsed((current) => ({ ...current, [section.id]: !isCollapsed }))}
                      >
                        <span className="mt-0.5 inline-flex rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-900 dark:text-slate-300">
                          {section.count}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{section.displayLabel || section.label}</div>
                            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isCollapsed ? '' : 'rotate-180'}`} />
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{section.displaySummary}</div>
                        </div>
                      </button>
                      <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={section.enabled}
                          disabled={savingKey === section.enabledKey}
                          onChange={() => toggleSectionPreference(section)}
                        />
                        {tr('on', 'On', 'បើក')}
                      </label>
                    </div>

                    {!isCollapsed && section.items?.length ? (
                      <div className="border-t border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900/60">
                        <div className="space-y-2">
                          {section.items.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                navigateTo(item.pageId || section.pageId || 'dashboard')
                                setOpen(false)
                              }}
                              className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              {(() => {
                                const label = TONE_LABEL_KEYS[item.tone] ? tr(...TONE_LABEL_KEYS[item.tone]) : (item.tone || 'info')
                                return (
                                  <NotificationSeverityIcon tone={item.tone} label={label} />
                                )
                              })()}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{item.label}</span>
                                <span className="block text-xs text-slate-500 dark:text-slate-400">{item.displayMeta}</span>
                              </span>
                              <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-300" />
                            </button>
                          ))}
                        </div>
                        {section.totalPages > 1 ? (
                          <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-2 py-1.5 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-300">
                            <button
                              type="button"
                              className="rounded-lg px-2 py-1 font-semibold hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
                              disabled={section.page <= 1}
                              onClick={() => setSectionPages((current) => ({ ...current, [section.id]: Math.max(1, section.page - 1) }))}
                            >
                              {tr('previous', 'Previous', 'មុន')}
                            </button>
                            <span>{section.page} / {section.totalPages}</span>
                            <button
                              type="button"
                              className="rounded-lg px-2 py-1 font-semibold hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
                              disabled={section.page >= section.totalPages}
                              onClick={() => setSectionPages((current) => ({ ...current, [section.id]: Math.min(section.totalPages, section.page + 1) }))}
                            >
                              {tr('next', 'Next', 'បន្ទាប់')}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                )
              })}
            </div>
          </div>
        </div>
      ), document.body) : null}
    </div>
  )
}
