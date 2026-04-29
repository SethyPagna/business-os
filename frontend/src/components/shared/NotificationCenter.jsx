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
  const { navigateTo, notify, saveSettings, settings } = useApp()
  const { syncChannel } = useSync()
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
      })
      scheduleRefresh(30000)
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
  }, [loadSummary, syncChannel, visibilityActive])

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const effectiveSections = useMemo(() => (
    (summary.sections || []).map((section) => ({
      ...section,
      enabled: preferenceValue(section.enabledKey, settings, true),
    }))
  ), [settings, summary.sections])

  const toggleSectionPreference = useCallback(async (section) => {
    if (!section?.enabledKey || savingKey) return
    const nextValue = !preferenceValue(section.enabledKey, settings, true)
    setSavingKey(section.enabledKey)
    try {
      await saveSettings({ [section.enabledKey]: nextValue ? 'true' : 'false' })
      void loadSummary(true)
    } catch (error) {
      notify(error?.message || 'Failed to update notification setting', 'error')
    } finally {
      if (aliveRef.current) setSavingKey('')
    }
  }, [loadSummary, notify, saveSettings, savingKey, settings])

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
        className={`relative inline-flex items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-600 transition hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:text-blue-300 ${compact ? 'h-10 w-10' : 'h-10 w-10'}`}
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell className="h-4.5 w-4.5" />
        {badgeCount > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-12 z-[120] w-[min(92vw,24rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Notifications</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {badgeCount ? `${badgeCount} active alert${badgeCount === 1 ? '' : 's'}` : 'Everything looks calm right now'}
              </div>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-blue-500 dark:hover:text-blue-300"
              onClick={() => navigateTo('settings')}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Settings
            </button>
          </div>

          <div className="max-h-[70vh] overflow-y-auto px-3 py-3">
            {loading && !effectiveSections.length ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
                Loading notifications...
              </div>
            ) : null}

            {!loading && !effectiveSections.length ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
                No active notifications.
              </div>
            ) : null}

            <div className="space-y-3">
              {effectiveSections.map((section) => {
                const isCollapsed = collapsed[section.id] ?? DEFAULT_COLLAPSED[section.id] ?? false
                return (
                  <section key={section.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800/40">
                    <div className="flex items-start gap-3 px-3 py-3">
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
                            <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{section.label}</div>
                            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isCollapsed ? '' : 'rotate-180'}`} />
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{section.summary}</div>
                        </div>
                      </button>
                      <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={section.enabled}
                          disabled={savingKey === section.enabledKey}
                          onChange={() => toggleSectionPreference(section)}
                        />
                        On
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
                                {item.tone || 'info'}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{item.label}</span>
                                <span className="block text-xs text-slate-500 dark:text-slate-400">{item.meta}</span>
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
