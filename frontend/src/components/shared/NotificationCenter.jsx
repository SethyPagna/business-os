import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, ChevronDown, ExternalLink, Settings2 } from 'lucide-react'
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
}

const TONE_CLASS = {
  danger: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  info: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
}

const SECTION_LABEL_KEYS = {
  inventory: ['notification_inventory', 'Inventory', 'ស្តុកទំនិញ'],
  sales: ['sales', 'Sales', 'ការលក់'],
  loyalty: ['loyalty_points', 'Loyalty', 'ពិន្ទុស្មោះត្រង់'],
  portal: ['customer_portal', 'Customer portal', 'ផតថលអតិថិជន'],
  system: ['system', 'System', 'ប្រព័ន្ធ'],
}

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
  const [visibilityActive, setVisibilityActive] = useState(() => matchesVisibilityMode(visibility))
  const containerRef = useRef(null)
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
      setSummary({
        unreadCount: Number(result?.unreadCount || 0),
        sections: Array.isArray(result?.sections) ? result.sections : [],
        preferences: result?.preferences || {},
        unavailable: !!result?.unavailable,
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
      if (!containerRef.current?.contains(event.target)) {
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

  const effectiveSections = useMemo(() => (
    (summary.sections || []).map((section) => ({
      ...section,
      displayLabel: SECTION_LABEL_KEYS[section.id]
        ? tr(...SECTION_LABEL_KEYS[section.id])
        : section.label,
      displaySummary: section.summaryKey
        ? renderStructuredCopy(section.summaryKey, section.summaryParams, section.summary)
        : section.summary,
      items: Array.isArray(section.items)
        ? section.items.map((item) => ({
          ...item,
          displayMeta: item.metaKey
            ? renderStructuredCopy(item.metaKey, item.metaParams, item.meta)
            : item.meta,
        }))
        : [],
      enabled: preferenceValue(section.enabledKey, settings, true),
    }))
  ), [renderStructuredCopy, settings, summary.sections, tr])

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

  const badgeCount = Number(summary.unreadCount || 0)

  if (!visibilityActive) return null

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current)
          if (!open) void loadSummary(true)
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

      {open ? (
        <div className="fixed left-2 right-2 top-16 z-[120] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:absolute sm:left-auto sm:right-0 sm:top-12 sm:w-[min(92vw,24rem)] sm:max-w-[calc(100vw-1rem)]">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-3 dark:border-slate-700 sm:px-4">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">{tr('notifications', 'Notifications', 'ការជូនដំណឹង')}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {badgeCount
                  ? formatCopy(
                    'notification_active_count',
                    { count: badgeCount },
                    `${badgeCount} active alert${badgeCount === 1 ? '' : 's'}`,
                    `${badgeCount} ការជូនដំណឹងកំពុងដំណើរការ`,
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
                              <span className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE_CLASS[item.tone] || TONE_CLASS.info}`}>
                                {TONE_LABEL_KEYS[item.tone] ? tr(...TONE_LABEL_KEYS[item.tone]) : (item.tone || 'info')}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{item.label}</span>
                                <span className="block text-xs text-slate-500 dark:text-slate-400">{item.displayMeta}</span>
                              </span>
                              <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-300" />
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </section>
                )
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
