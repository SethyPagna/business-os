import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import Bell from 'lucide-react/dist/esm/icons/bell.js'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js'
import Info from 'lucide-react/dist/esm/icons/info.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import Settings2 from 'lucide-react/dist/esm/icons/settings-2.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { useApp as useAppHook, useSync as useSyncHook } from '../../app/AppContextCore.tsx'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import { getNotificationSummary as getNotificationSummaryRequest } from '../../api/notificationSummary.ts'
import { listImportJobs as listImportJobsRequest } from '../../api/importJobsTransport.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
import AppSelect from './AppSelect'

type Tone = 'danger' | 'warning' | 'success' | 'info'
type ToneFilter = Tone | 'all'
type VisibilityMode = 'always' | 'desktop' | 'mobile'
type LabelTuple = [key: string, fallbackEn: string, fallbackKm: string]
type CopyParams = Record<string, unknown>
type LocalizedCopy = {
  en: (params: CopyParams) => string
  km: (params: CopyParams) => string
}

type NotificationItem = {
  id: string
  label?: string
  meta?: string
  metaKey?: string
  metaParams?: CopyParams
  kind?: string
  tone?: Tone
  pageId?: string
  anchor?: string
  // Set on the client-composed "Imports" section only (see importJobsSection
  // below) -- when present, clicking the item opens that job's Import
  // Report modal directly instead of navigating to a page, since a
  // finished import doesn't live on any one page the way the rest of
  // this center's items do.
  importJobId?: string
}

type DecoratedNotificationItem = NotificationItem & {
  displayMeta: string
}

const ImportReportModal = lazyRetry(() => import('./ImportReportModal'), 'NotificationCenter-ImportReportModal')

// Mirrors BackgroundImportTracker.tsx's own DISMISSABLE_STATUSES/
// normalizeJobStatus -- a job only has a real report once it's reached a
// terminal state (this file intentionally doesn't import the tracker's
// copies, since they're not exported; kept as a small local duplicate
// instead of widening that module's public surface for one shared set).
const IMPORT_REPORT_STATUSES = new Set(['awaiting_review', 'completed', 'completed_with_errors', 'failed', 'cancelled'])
function normalizeImportJobStatus(job: Record<string, any> | null | undefined): string {
  return String(job?.status || '').trim().toLowerCase()
}

type NotificationSection = {
  id: string
  label?: string
  summary?: string
  summaryKey?: string
  summaryParams?: CopyParams
  items?: NotificationItem[]
  count?: number
  pageId?: string
  enabledKey?: string
}

type EffectiveNotificationSection = Omit<NotificationSection, 'items'> & {
  displayLabel: string
  displaySummary: string
  items: DecoratedNotificationItem[]
  hiddenItemCount: number
  filteredItemCount: number
  page: number
  totalPages: number
  enabled: boolean
}

type NotificationSummary = {
  unreadCount: number
  sections: NotificationSection[]
  preferences: Record<string, unknown>
  unavailable?: boolean
  cooldownUntil?: number
}

type AppContextValue = {
  navigateTo: (pageId: string, anchor?: string) => void
  notify: (message: string, tone?: 'error' | 'info' | 'success' | 'warning') => void
  saveSettings: (settings: Record<string, string>) => Promise<unknown>
  settings: Record<string, unknown>
  t: (key: string) => string
}

type SyncContextValue = {
  syncChannel?: {
    channel?: string
    ts?: unknown
  }
}

type NotificationCenterProps = {
  compact?: boolean
  openRequestId?: number
  visibility?: VisibilityMode
}

type NotificationSeverityIconProps = {
  tone?: Tone
  label: string
}

const useApp = useAppHook as () => AppContextValue
const useSync = useSyncHook as () => SyncContextValue

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '')
}

const DEFAULT_COLLAPSED: Record<string, boolean> = {
  inventory: false,
  sales: false,
  loyalty: true,
  portal: false,
  system: false,
  expiry: false,
  imports: false,
}

const NOTIFICATION_FILTER_OPTIONS: ToneFilter[] = ['all', 'danger', 'warning', 'info', 'success']
const NOTIFICATION_PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const NOTIFICATION_SUMMARY_TIMEOUT_MS = 8000
// How often loadSummary re-polls GET /api/notifications/summary while a tab
// sits open and visible with nothing else prompting a refresh. This is a
// backup poll, not the primary "something changed" signal -- most sections
// (inventory/sales/returns/customers/contacts/catalog/settings/backup) are
// already re-fetched near-instantly via the sync-channel broadcast effect
// below (see the `syncChannel?.channel` effect), and a tab regaining focus
// always re-fetches too (`onVisible`). This interval only covers the
// remaining case: nothing pushed and the tab never lost focus. Previously a
// bare `30000` (30s), which meant an idle-but-open tab hit the endpoint
// roughly twice a minute for no reason. `buildExpirySection` (notifications.ts)
// is the one section this interval can actually delay discovering -- it's
// computed purely from today's date vs. each product's expiry_date, with no
// DB write or broadcast to push on, so an expiry crossing a threshold is only
// ever caught by this poll. That's judged an acceptable trade at 2h given
// expiry itself is day-granularity, not minute-critical -- see progress.md
// for the record of that call if a shorter/separate expiry schedule turns
// out to be wanted after all.
const NOTIFICATION_SUMMARY_IDLE_REFRESH_MS = 2 * 60 * 60 * 1000

const TONE_CLASS: Record<Tone, string> = {
  danger: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  info: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
}

const TONE_ICON_RING_CLASS: Record<Tone, string> = {
  danger: 'ring-red-200 dark:ring-red-800/70',
  warning: 'ring-amber-200 dark:ring-amber-800/70',
  success: 'ring-emerald-200 dark:ring-emerald-800/70',
  info: 'ring-sky-200 dark:ring-sky-800/70',
}

const TONE_ICON_COMPONENT: Record<Tone, LucideIcon> = {
  danger: AlertCircle,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: Info,
}

const SECTION_LABEL_KEYS: Record<string, LabelTuple> = {
  inventory: ['notification_inventory', 'Inventory', 'ស្តុកទំនិញ'],
  sales: ['sales', 'Sales', 'ការលក់'],
  loyalty: ['loyalty_points', 'Loyalty', 'ពិន្ទុស្មោះត្រង់'],
  portal: ['customer_portal', 'Customer portal', 'ផតថលអតិថិជន'],
  system: ['system', 'System', 'ប្រព័ន្ធ'],
  imports: ['notification_imports', 'Imports', 'ការនាំចូល'],
}

SECTION_LABEL_KEYS.expiry = ['notification_expiry_title', 'Product expiry', 'ផុតកំណត់ផលិតផល']

const TONE_LABEL_KEYS: Record<Tone, LabelTuple> = {
  danger: ['status_danger', 'Danger', 'បន្ទាន់'],
  warning: ['status_warning', 'Warning', 'ប្រុងប្រយ័ត្ន'],
  success: ['status_success', 'Success', 'ជោគជ័យ'],
  info: ['status_info', 'Info', 'ព័ត៌មាន'],
}

const SECTION_SUMMARY_COPY: Record<string, LocalizedCopy> = {
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

const ITEM_META_COPY: Record<string, LocalizedCopy> = {
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

function preferenceValue(key: string | undefined, settings: Record<string, unknown> = {}, fallback = true): boolean {
  if (!key) return fallback
  const raw = settings?.[key]
  if (raw === undefined || raw === null || raw === '') return fallback
  if (typeof raw === 'boolean') return raw
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase())
}

// Device approve/reject/revoke requests have no persisted read-state on the
// server (see notifications.ts's comment -- the whole /summary endpoint is
// computed live, nothing is marked "read"). Track which device/security item
// ids this admin's browser has already surfaced, so re-opening the panel
// doesn't re-flag devices they've already been shown -- only a genuinely
// NEW pending device (or new-country sign-in) should trigger the silent
// indicator again.
const SEEN_SECURITY_IDS_KEY = 'notif_seen_security_ids_v1'
const SEEN_SECURITY_IDS_LIMIT = 500

function readSeenSecurityIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SEEN_SECURITY_IDS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.map(String) : [])
  } catch (_) {
    return new Set()
  }
}

function writeSeenSecurityIds(ids: Set<string>): void {
  try {
    const trimmed = [...ids].slice(-SEEN_SECURITY_IDS_LIMIT)
    window.localStorage.setItem(SEEN_SECURITY_IDS_KEY, JSON.stringify(trimmed))
  } catch (_) {
    // localStorage unavailable (private mode / disabled) -- indicator will
    // just re-show each session, which is a safe fallback, not a crash.
  }
}

// Bell-badge realert suppression (Settings.tsx's "Unresolved alert repeat
// interval" / `notifications_realert_minutes`). Same "no persisted
// read-state on the server" situation as the security ids above, so this is
// tracked the same way -- client-side, per item id -- but as a last-seen
// timestamp rather than a plain set, since an item needs to re-count once
// its window elapses rather than staying suppressed forever. Deliberately
// separate from SEEN_SECURITY_IDS_KEY: that one is a one-way "already
// shown" flag for a quiet dot, this one is a repeating timer for the
// numeric badge.
const SEEN_ALERT_TIMES_KEY = 'notif_seen_alert_times_v1'
const SEEN_ALERT_TIMES_LIMIT = 1000

function readSeenAlertTimes(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(SEEN_ALERT_TIMES_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object') return {}
    const result: Record<string, number> = {}
    for (const [id, seenAt] of Object.entries(parsed as Record<string, unknown>)) {
      const numeric = Number(seenAt)
      if (Number.isFinite(numeric)) result[id] = numeric
    }
    return result
  } catch (_) {
    return {}
  }
}

function writeSeenAlertTimes(times: Record<string, number>): void {
  try {
    const entries = Object.entries(times)
    // Trim by recency (most-recently-seen first), not insertion order --
    // insertion order says nothing about which entries are still useful.
    const trimmed = entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, SEEN_ALERT_TIMES_LIMIT)
    window.localStorage.setItem(SEEN_ALERT_TIMES_KEY, JSON.stringify(Object.fromEntries(trimmed)))
  } catch (_) {
    // localStorage unavailable (private mode / disabled) -- badge will just
    // clear-then-instantly-reshow each session, a safe fallback matching
    // pre-existing behavior, not a crash.
  }
}

function matchesVisibilityMode(mode: VisibilityMode): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true
  if (mode === 'desktop') return window.matchMedia('(min-width: 768px)').matches
  if (mode === 'mobile') return window.matchMedia('(max-width: 767px)').matches
  return true
}

function NotificationSeverityIcon({ tone = 'info', label }: NotificationSeverityIconProps) {
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

export default function NotificationCenter({ compact = false, openRequestId = 0, visibility = 'always' }: NotificationCenterProps) {
  const { navigateTo, notify, saveSettings, settings, t } = useApp()
  const { syncChannel } = useSync()
  const isKhmer = /[\u1780-\u17FF]/.test(t?.('cancel') || '')
  const tr = useCallback((key: string, fallbackEn: string, fallbackKm = fallbackEn): string => {
    const value = t?.(key)
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }, [isKhmer, t])
  const formatCopy = useCallback((key: string, params: CopyParams, fallbackEn: string, fallbackKm = fallbackEn): string => {
    const template = tr(key, fallbackEn, fallbackKm)
    return Object.entries(params || {}).reduce(
      (message, [paramKey, value]) => message.replaceAll(`{${paramKey}}`, String(value)),
      template,
    )
  }, [tr])
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState<NotificationSummary>({ unreadCount: 0, sections: [], preferences: {} })
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(DEFAULT_COLLAPSED)
  const [savingKey, setSavingKey] = useState('')
  const [toneFilter, setToneFilter] = useState<ToneFilter>('all')
  const [notificationSearch, setNotificationSearch] = useState('')
  const [itemLimit, setItemLimit] = useState(20)
  const [sectionPages, setSectionPages] = useState<Record<string, number>>({})
  const [visibilityActive, setVisibilityActive] = useState(() => matchesVisibilityMode(visibility))
  const [seenSecurityIds, setSeenSecurityIds] = useState<Set<string>>(() => (
    typeof window === 'undefined' ? new Set() : readSeenSecurityIds()
  ))
  const [seenAlertTimes, setSeenAlertTimes] = useState<Record<string, number>>(() => (
    typeof window === 'undefined' ? {} : readSeenAlertTimes()
  ))
  // Recently finished import jobs, fetched independently of the server
  // notification summary and folded into `effectiveSections` below --
  // this is what makes a completed import's report reachable "whenever"
  // from the bell, even after BackgroundImportTracker's own floating
  // widget has been fully dismissed (dismissing there only hides the
  // widget locally; the job itself, and its report, still exist
  // server-side via listImportJobs). Kept as a small standalone section
  // rather than a backend notificationSummary change, since the two are
  // genuinely different data sources.
  const [importJobsSection, setImportJobsSection] = useState<NotificationSection | null>(null)
  const [reportJobId, setReportJobId] = useState<string | null>(null)
  // Bumped to force `badgeVisibleCount` to recompute once a suppressed
  // alert's realert window elapses -- see the scheduling effect below.
  // Carries no data of its own.
  const [realertTick, setRealertTick] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const requestRef = useRef(0)
  const visibleLoadRequestRef = useRef(0)
  const aliveRef = useRef(true)
  const refreshTimerRef = useRef<number | null>(null)
  const failureCountRef = useRef(0)

  useEffect(() => {
    const syncVisibility = () => setVisibilityActive(matchesVisibilityMode(visibility))
    syncVisibility()
    window.addEventListener('resize', syncVisibility)
    return () => window.removeEventListener('resize', syncVisibility)
  }, [visibility])

  const scheduleRefresh = useCallback((delayMs: number) => {
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
    const visibleRequestId = !silent && aliveRef.current ? beginTrackedRequest(visibleLoadRequestRef) : 0
    if (visibleRequestId) setLoading(true)
    try {
      const result = await withLoaderTimeout(
        () => getNotificationSummaryRequest() as Promise<Partial<NotificationSummary>>,
        'Notifications',
        NOTIFICATION_SUMMARY_TIMEOUT_MS,
      )
      if (!aliveRef.current || !isTrackedRequestCurrent(requestRef, requestId)) return
      failureCountRef.current = 0
      const nextSections: NotificationSection[] = Array.isArray(result?.sections) ? result.sections : []
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
      scheduleRefresh(result?.unavailable ? unavailableDelay : NOTIFICATION_SUMMARY_IDLE_REFRESH_MS)
    } catch (error) {
      if (!aliveRef.current || !isTrackedRequestCurrent(requestRef, requestId)) return
      failureCountRef.current += 1
      scheduleRefresh(Math.min(90000, 15000 * failureCountRef.current))
      if (!silent) {
        console.error('[NotificationCenter] load failed:', getErrorMessage(error) || error)
      }
    } finally {
      if (visibleRequestId && aliveRef.current && isTrackedRequestCurrent(visibleLoadRequestRef, visibleRequestId)) {
        setLoading(false)
      }
    }
  }, [scheduleRefresh])

  useEffect(() => {
    if (!visibilityActive) {
      invalidateTrackedRequest(requestRef)
      invalidateTrackedRequest(visibleLoadRequestRef)
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
      invalidateTrackedRequest(visibleLoadRequestRef)
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
    }
  }, [loadSummary, visibilityActive])

  // Independent poll for the client-composed "Imports" section (see the
  // importJobsSection state comment above) -- deliberately its own effect,
  // not folded into loadSummary, since it hits a different endpoint
  // (listImportJobs) and failing to fetch it should never block or retry-
  // storm the real notification summary above it.
  useEffect(() => {
    if (!visibilityActive) return undefined
    let cancelled = false
    const loadImportJobs = async () => {
      try {
        const result: any = await listImportJobsRequest({ limit: 8 })
        const jobs: any[] = Array.isArray(result) ? result : (Array.isArray(result?.jobs) ? result.jobs : [])
        if (cancelled) return
        const reportable = jobs.filter((job) => IMPORT_REPORT_STATUSES.has(normalizeImportJobStatus(job)))
        if (reportable.length === 0) {
          setImportJobsSection(null)
          return
        }
        const items: NotificationItem[] = reportable.slice(0, 8).map((job) => {
          const type = String(job?.type || 'import').replaceAll('_', ' ')
          const status = normalizeImportJobStatus(job)
          const failed = Number(job?.failed_rows || job?.summary?.failed || 0)
          const tone: Tone = status === 'failed' ? 'danger' : (status === 'completed_with_errors' || failed > 0) ? 'warning' : 'success'
          return {
            id: `import-job-${job?.id}`,
            label: `${type.charAt(0).toUpperCase()}${type.slice(1)} import`,
            meta: status.replaceAll('_', ' '),
            tone,
            kind: 'import_job',
            importJobId: String(job?.id || ''),
          }
        })
        setImportJobsSection({
          id: 'imports',
          label: tr('recent_imports', 'Recent imports', 'ការនាំចូលថ្មីៗ'),
          items,
        })
      } catch {
        // Best-effort only -- an import-jobs fetch failure shouldn't show
        // an error toast or disrupt the rest of the notification center.
      }
    }
    void loadImportJobs()
    const interval = window.setInterval(loadImportJobs, NOTIFICATION_SUMMARY_IDLE_REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [tr, visibilityActive])

  useEffect(() => {
    if (!visibilityActive) return
    if (!syncChannel?.channel) return
    // 'contacts' and 'backup' here used to be copy-pasted from
    // PAGE_PERMISSIONS' page-id keys (AppContext.tsx), not real sync
    // channel names -- nothing ever broadcasts a sync:update on either,
    // so those two entries could never fire. The real channels for
    // contacts-related notifications are the three per-tab ones
    // (customers/suppliers/deliveryContacts); there's no backup-related
    // broadcast channel to listen for. Also added 'notifications', the
    // channel the backend actually broadcasts on for device-approval
    // decisions (routes/devices.ts) -- previously missing even though
    // it's the one channel semantically built for this exact component,
    // so a device approve/deny elsewhere never refreshed the bell live.
    if (['inventory', 'sales', 'returns', 'customers', 'suppliers', 'deliveryContacts', 'notifications', 'catalog', 'settings'].includes(syncChannel.channel)) {
      void loadSummary(true)
    }
  }, [loadSummary, syncChannel?.channel, syncChannel?.ts, visibilityActive])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target
      if (target instanceof Node && !containerRef.current?.contains(target) && !panelRef.current?.contains(target)) {
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

  const renderStructuredCopy = useCallback((key: string, params: CopyParams = {}, fallback = ''): string => {
    const entry = SECTION_SUMMARY_COPY[key] || ITEM_META_COPY[key]
    if (!entry) return fallback || ''
    const renderer = isKhmer ? entry.km : entry.en
    return typeof renderer === 'function' ? renderer(params || {}) : (fallback || '')
  }, [isKhmer])

  const normalizedNotificationSearch = notificationSearch.trim().toLowerCase()

  const effectiveSections = useMemo<EffectiveNotificationSection[]>(() => (
    ([...(summary.sections || []), ...(importJobsSection ? [importJobsSection] : [])]).map((section) => {
      const displayLabel = SECTION_LABEL_KEYS[section.id]
        ? tr(...SECTION_LABEL_KEYS[section.id])
        : (section.label || '')
      const displaySummary = section.summaryKey
        ? renderStructuredCopy(section.summaryKey, section.summaryParams, section.summary || '')
        : (section.summary || '')
      const decoratedItems: DecoratedNotificationItem[] = Array.isArray(section.items)
        ? section.items.map((item) => ({
          ...item,
          displayMeta: item.metaKey
            ? renderStructuredCopy(item.metaKey, item.metaParams, item.meta || '')
            : (item.meta || ''),
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
      .sort((a, b) => (a.id === 'security' ? -1 : b.id === 'security' ? 1 : 0))
  ), [importJobsSection, itemLimit, normalizedNotificationSearch, renderStructuredCopy, sectionPages, settings, summary.sections, toneFilter, tr])

  // Silent indicator: a pending device approve/reject/revoke request (or a
  // new-country sign-in on an already-approved device) that this admin's
  // browser hasn't shown before. Deliberately NOT folded into the numeric
  // `badgeCount` below -- this is a quiet dot, not another number, so it
  // doesn't compete with (or double-count against) the regular alert badge.
  const securitySection = summary.sections?.find((section) => section.id === 'security')
  const unseenSecurityIds = useMemo(() => (
    (securitySection?.items || [])
      .map((item) => item.id)
      .filter((id) => !seenSecurityIds.has(id))
  ), [securitySection, seenSecurityIds])
  const hasUnseenSecurity = unseenSecurityIds.length > 0

  // Mark today's pending device/security items as "seen" once the panel is
  // actually opened (the security section renders expanded by default --
  // see DEFAULT_COLLAPSED, which has no 'security' entry). This is the
  // "click it and it expands" behavior: opening the bell is what clears the
  // silent dot, not a background poll the admin never looked at.
  useEffect(() => {
    if (!open || !hasUnseenSecurity) return
    const nextSeen = new Set(seenSecurityIds)
    for (const id of unseenSecurityIds) nextSeen.add(id)
    setSeenSecurityIds(nextSeen)
    writeSeenSecurityIds(nextSeen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasUnseenSecurity])

  useEffect(() => {
    setSectionPages({})
  }, [itemLimit, normalizedNotificationSearch, toneFilter])

  const toggleSectionPreference = useCallback(async (section: EffectiveNotificationSection) => {
    if (!section?.enabledKey || savingKey) return
    const nextValue = !preferenceValue(section.enabledKey, settings, true)
    setSavingKey(section.enabledKey)
    try {
      await saveSettings({ [section.enabledKey]: nextValue ? 'true' : 'false' })
      void loadSummary(true)
    } catch (error) {
      notify(getErrorMessage(error) || tr('notification_setting_update_failed', 'Failed to update notification setting', 'បរាជ័យក្នុងការកែប្រែការជូនដំណឹង'), 'error')
    } finally {
      if (aliveRef.current) setSavingKey('')
    }
  }, [loadSummary, notify, saveSettings, savingKey, settings, tr])

  const activeAlertCount = Number(summary.unreadCount || 0)

  // All current alert items across every non-security section (security has
  // its own quiet-dot tracking above, not the numeric badge). This is the
  // realert-suppression source list -- flattened once here so both the
  // "mark seen on open" effect and the badge count below read the same set.
  const allAlertItems = useMemo(() => (
    (summary.sections || [])
      .filter((section) => section.id !== 'security')
      .flatMap((section) => section.items || [])
  ), [summary.sections])

  const realertMinutes = Math.max(1, Number(summary.preferences?.realertMinutes) || 10)

  // "Opening notifications clears the badge" (Settings.tsx copy): stamp
  // every currently-listed alert with "seen now" once the panel opens.
  // Re-firing while the panel stays open across a poll just refreshes the
  // stamps, which is correct -- an alert the admin is actively looking at
  // shouldn't re-count until the window elapses AFTER they stopped looking.
  useEffect(() => {
    if (!open || !allAlertItems.length) return
    const now = Date.now()
    setSeenAlertTimes((current) => {
      const next = { ...current }
      for (const item of allAlertItems) next[item.id] = now
      writeSeenAlertTimes(next)
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, allAlertItems])

  // "Unresolved alerts can appear again after this interval": an item
  // counts toward the badge if it's never been seen, or was last seen more
  // than `realertMinutes` ago.
  const badgeVisibleCount = useMemo(() => {
    void realertTick // recompute when the scheduled timer below fires
    const now = Date.now()
    const realertMs = realertMinutes * 60000
    return allAlertItems.filter((item) => {
      const seenAt = seenAlertTimes[item.id]
      return !seenAt || (now - seenAt) >= realertMs
    }).length
  }, [allAlertItems, realertMinutes, seenAlertTimes, realertTick])

  // Schedule exactly one timer for the soonest currently-suppressed alert's
  // realert moment, so the badge updates on its own without a poll -- not a
  // recurring interval (this project deliberately moved away from those for
  // idle tabs, see NOTIFICATION_SUMMARY_IDLE_REFRESH_MS above).
  useEffect(() => {
    if (open) return undefined
    const now = Date.now()
    const realertMs = realertMinutes * 60000
    const pendingDelays = allAlertItems
      .map((item) => seenAlertTimes[item.id])
      .filter((seenAt): seenAt is number => typeof seenAt === 'number')
      .map((seenAt) => seenAt + realertMs - now)
      .filter((delay) => delay > 0)
    if (!pendingDelays.length) return undefined
    const timer = window.setTimeout(() => setRealertTick((tick) => tick + 1), Math.min(...pendingDelays) + 250)
    return () => window.clearTimeout(timer)
  }, [open, allAlertItems, realertMinutes, seenAlertTimes])

  const badgeCount = open ? 0 : badgeVisibleCount

  useEffect(() => {
    if (!openRequestId || !visibilityActive) return
    setOpen(true)
    void loadSummary(true)
  }, [loadSummary, openRequestId, visibilityActive])

  if (!visibilityActive) return null

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current)
          if (!open) {
            void loadSummary(true)
          }
        }}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 hover:text-blue-700 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-blue-300"
        aria-label={tr('notifications', 'Notifications', 'ការជូនដំណឹង')}
        title={tr('notifications', 'Notifications', 'ការជូនដំណឹង')}
      >
        <Bell className="h-5 w-5" />
        {/* Badge tucked INSIDE the button's own h-10 w-10 circle (right-0.5
            top-0.5, no outward translate) rather than overhanging past its
            edge -- the previous translate-x-1/3/-translate-y-1/3 pushed the
            pill outside the button's bounding box, which is exactly why
            this button visually read as bigger than the plain (badge-less)
            theme/language ToggleButtons beside it even though all three
            share the same h-10 w-10/rounded-full sizing (confirmed against
            QuickPreferenceToggles.tsx). Sitting inside the circle keeps the
            three icons reading as one consistent size. */}
        {badgeCount > 0 ? (
          <span className="absolute right-0.5 top-0.5 inline-flex min-h-[15px] min-w-[15px] max-w-[1.75rem] items-center justify-center overflow-hidden rounded-full bg-red-600 px-1 text-[9px] font-semibold leading-none text-white ring-2 ring-white dark:ring-slate-900">
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        ) : !open && hasUnseenSecurity ? (
          <span
            className="absolute left-1 top-1 flex h-2.5 w-2.5"
            title={tr('new_device_request', 'New device request awaiting approval', 'សំណើឧបករណ៍ថ្មីរង់ចាំការអនុម័ត')}
            aria-label={tr('new_device_request', 'New device request awaiting approval', 'សំណើឧបករណ៍ថ្មីរង់ចាំការអនុម័ត')}
          >
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
          </span>
        ) : null}
      </button>

      {/*
        z-[1010] below: intentionally above BackgroundImportTracker's z-[1000] --
        both are fixed-position and anchor to the same top-right corner
        (mobile: identical top-[4.75rem] offset; desktop: right-4 with
        overlapping vertical ranges), so without this the tracker chip
        could render on top of this open, user-invoked panel and block
        its buttons. This panel is only mounted while open, so it should
        always win over the persistent background chip beneath it.
      */}
      {open && typeof document !== 'undefined' ? createPortal((
        <div ref={panelRef} className="fixed left-2 right-2 top-[4.75rem] z-[1010] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:left-auto sm:right-4 sm:top-16 sm:w-[min(92vw,24rem)] sm:max-w-[calc(100vw-1rem)]">
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
                  return (
                    <button
                      key={tone}
                      type="button"
                      className={`inline-flex min-h-7 items-center justify-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${toneFilter === tone ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-700'}`}
                      onClick={() => setToneFilter(tone)}
                      title={label}
                      aria-label={label}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
              <label className="flex items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-300">
                {tr('per_page', 'Per page', 'ក្នុងមួយទំព័រ')}
                <AppSelect
                  value={itemLimit}
                  onChange={(nextValue) => setItemLimit(Number(nextValue) || 20)}
                  ariaLabel={tr('per_page', 'Per page', 'ក្នុងមួយទំព័រ')}
                  className="h-8 w-16"
                  buttonClassName="h-8 w-16 rounded-lg px-2 py-1 text-xs shadow-none"
                  menuClassName="min-w-[4rem]"
                  optionClassName="text-xs"
                  options={NOTIFICATION_PAGE_SIZE_OPTIONS.map((value) => ({ value, label: value }))}
                />
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
                      {section.enabledKey ? (
                        <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={section.enabled}
                            disabled={savingKey === section.enabledKey}
                            onChange={() => toggleSectionPreference(section)}
                          />
                          {tr('on', 'On', 'បើក')}
                        </label>
                      ) : null}
                    </div>

                    {!isCollapsed && section.items?.length ? (
                      <div className="border-t border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900/60">
                        <div className="space-y-2">
                          {section.items.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                if (item.kind === 'import_job' && item.importJobId) {
                                  setReportJobId(item.importJobId)
                                  setOpen(false)
                                  return
                                }
                                navigateTo(item.pageId || section.pageId || 'dashboard', item.anchor)
                                setOpen(false)
                              }}
                              className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              {(() => {
                                const itemTone = item.tone || 'info'
                                const label = TONE_LABEL_KEYS[itemTone] ? tr(...TONE_LABEL_KEYS[itemTone]) : itemTone
                                return (
                                  <NotificationSeverityIcon tone={itemTone} label={label} />
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
      {reportJobId ? (
        <Suspense fallback={null}>
          <ImportReportModal jobId={reportJobId} onClose={() => setReportJobId(null)} />
        </Suspense>
      ) : null}
    </div>
  )
}
