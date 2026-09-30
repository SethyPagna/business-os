import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { isAdminControlUser } from '../../utils/permissions.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js'
import Clock3 from 'lucide-react/dist/esm/icons/clock-3.js'
import MonitorSmartphone from 'lucide-react/dist/esm/icons/monitor-smartphone.js'
import SearchInput from '../shared/SearchInput'
import User2 from 'lucide-react/dist/esm/icons/user-round.js'
import { toggleMultiValue, isMultiActive } from '../../utils/multiSelect'
import { auditActionLabel, auditEntityLabel, type LabelFn } from '../../utils/auditVocabulary.ts'
import { AUDIT_ACTION_LABELS } from '../../utils/auditVocabulary.ts'
import { isBrokenLocalizedString as isBrokenLocalizedStringHook, useApp as useAppHook } from '../../AppContext.tsx'
import AppSelect from '../shared/AppSelect'
import ExportMenu from '../shared/ExportMenu'
import FilterMenu from '../shared/FilterMenu'
import { useIsPageActive } from '../shared/pageActivity'
import StatsRangeRow from '../shared/StatsRangeRow'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import {
  getAuditLogs as getAuditLogsRequest,
} from '../../api/auditLogTransport.ts'
import { buildAuditFieldDiff } from '../../utils/auditLogFieldDiff.ts'
import { entityFieldLabel } from '../../utils/entityRecords.ts'
import {
  AUDIT_SCOPES,
  AUDIT_SECTION_FALLBACKS,
  AUDIT_SECTION_IDS,
  AUDIT_TIME_PRESETS,
  auditFilterKey,
  buildAuditRequestParams,
  initialAuditViewState,
  mergeAuditRows,
  setAuditPreset,
  setAuditRange,
  setAuditScope,
  type AuditScope,
  type AuditTimePreset,
  type AuditViewState,
} from '../../utils/auditLogView.ts'
import AuditFieldDiffLine from './AuditFieldDiffLine.tsx'
import { fmtDayFirst, fmtTimezoneLabel } from '../../utils/formatters.ts'
import { BUSINESS_TIME_ZONE } from '../../constants.ts'
import { todayStr } from '../../utils/dateHelpers.ts'
// N13: the Audit Log answers the same "who did this, and why" as the stock
// ledgers, so it renders through the one shared history row model instead of
// its own '--' placeholder.
import { HISTORY_EMPTY, historyActor, historyExportField, historyField } from '../../utils/historyRowModel.ts'

type TranslateFn = (key: string) => string

interface AuditLogRow {
  id?: string | number | null
  user_id?: number | null
  action?: string | null
  table_name?: string | null
  entity?: string | null
  user_name?: string | null
  device_name?: string | null
  device_tz?: string | null
  client_time?: string | null
  created_at?: string | null
  old_value?: string | null
  new_value?: string | null
  details?: string | null
  section?: string | null
}

interface AuditUserCount {
  id: number | null
  name: string | null
  count: number
}

interface AuditSectionCount {
  section: string
  count: number
}

interface AuditLogResponse {
  items?: AuditLogRow[]
  nextCursor?: string | null
  hasMore?: boolean
  partial?: boolean
  source?: string | null
  counts?: {
    users?: AuditUserCount[]
    sections?: AuditSectionCount[]
  }
}

interface AppContextValue {
  // App language ('en' | 'km').
  language: string
  t: TranslateFn
  user?: {
    role_code?: unknown
    username?: unknown
  } | null
  hasPermission?: (permission: string) => boolean
}

interface DetailRowProps {
  label: ReactNode
  value: unknown
  mono?: boolean
}

type AuditFallback = string | { en?: string; km?: string }
const ExportOptionsDialog = lazyRetry(() => import('../shared/ExportOptionsDialog'), 'audit-export-options')

interface ExportItem {
  label: string
  onClick: () => void | Promise<void>
  color?: string
}

const useApp = useAppHook as () => AppContextValue
const isBrokenLocalizedString = isBrokenLocalizedStringHook as (value: unknown) => boolean

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

const DEFAULT_ACTION_CLASS = 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
const AUDIT_LOG_LOAD_TIMEOUT_MS = 20000

const ACTION_COLOR_CLASS: Record<string, string> = {
  create: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  update: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  delete: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  sale: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  login: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  logout: DEFAULT_ACTION_CLASS,
  stock_add: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  stock_remove: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  stock_adjust: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  stock_set: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  bulk_import: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  image_import: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  upload: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  data_reset: 'bg-red-200 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  factory_reset: 'bg-red-300 text-red-900 dark:bg-red-900/60 dark:text-red-200',
  transfer: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  reset_password: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  repair: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  return: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  backup_export: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  backup_restore: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300',
}

function toIso(raw: unknown): string | null {
  if (!raw) return null
  const rawValue = String(raw).trim()
  if (!rawValue) return null
  let value = rawValue.replace(' ', 'T')
  value = value.replace(/(\.\d{3})\d+/, '$1')
  if (/[+-]\d{4}$/.test(value)) return value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  if (/[+-]\d{2}$/.test(value)) return `${value}:00`
  if (value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value)) return value
  return `${value}Z`
}

function formatDateTime(raw: unknown): string {
  const iso = toIso(raw)
  if (!iso) return HISTORY_EMPTY
  const fallback = String(raw)
  try {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return fallback
    return fmtDayFirst(date, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: BUSINESS_TIME_ZONE,
    })
  } catch {
    return fallback
  }
}

function formatLogTime(log: AuditLogRow): string {
  return formatDateTime(log.client_time || log.created_at)
}

function auditDeviceLabel(log: AuditLogRow | null | undefined): string {
  const captured = String(log?.device_name || '').trim()
  if (captured) return captured
  const action = String(log?.action || '').toLowerCase()
  if (action.includes('login')) return 'Web login'
  return 'Web session'
}

// The zone label printed beside each audit time names the zone that time is
// SHOWN in. formatDateTime/formatCompactDateTime convert every stamp to the
// business zone, so the label is the business zone for every row -- never the
// device zone the entry was captured on (device_tz), "UTC" or "Server time",
// which described the raw input and contradicted the converted clock beside it.
function auditTimezoneLabel(_log?: AuditLogRow | null): string {
  return fmtTimezoneLabel(BUSINESS_TIME_ZONE)
}

function formatJsonPretty(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function parseLogJson(raw: string | null | undefined): unknown {
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function flattenSummaryValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (Array.isArray(value)) {
    return value
      .map((entry) => flattenSummaryValue(entry))
      .filter(Boolean)
      .join(', ')
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .filter(([, entryValue]) => entryValue !== null && entryValue !== undefined && entryValue !== '')
      .slice(0, 4)
      .map(([key, entryValue]) => `${key}: ${flattenSummaryValue(entryValue)}`)
      .filter(Boolean)
    return entries.join(', ')
  }
  return String(value)
}

function formatEntityName(log: AuditLogRow, label: LabelFn): string {
  const raw = String(log.table_name || log.entity || '').trim()
  if (!raw) return label('system', 'System')
  return auditEntityLabel(raw, label)
}

// N13: the reason the operator gave, pulled out of the recorded payload the
// row already stores. audit_logs has no `reason` column of its own, so this
// reads the same JSON that feeds readableSummary(); rows whose action takes
// no reason simply have none.
function auditReason(log: AuditLogRow): string | null {
  for (const raw of [log.new_value, log.details]) {
    const parsed = parseLogJson(raw)
    if (isRecord(parsed)) {
      const value = parsed.reason
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return null
}

function readableSummary(log: AuditLogRow): string | null {
  const parsed = parseLogJson(log.new_value)
  if (isRecord(parsed)) {
    const keys = ['name', 'receiptNumber', 'returnNumber', 'username', 'reason', 'status', 'branch', 'destinationDir', 'sourceDir', 'notes', 'platform', 'membershipNumber']
    const parts = keys
      .filter((key) => parsed[key] !== undefined && parsed[key] !== null && parsed[key] !== '')
      .map((key) => flattenSummaryValue(parsed[key]))
      .filter(Boolean)
    if (parts.length) return parts.join(' | ')
    const flattened = flattenSummaryValue(parsed)
    if (flattened) return flattened.slice(0, 180)
  }
  if (log.details) return String(log.details).slice(0, 120)
  if (log.new_value) {
    const flattened = flattenSummaryValue(parseLogJson(log.new_value) || log.new_value)
    if (flattened) return flattened.slice(0, 180)
  }
  return null
}

function DetailRow({ label, value, mono = false }: DetailRowProps) {
  if (!value && value !== 0) return null
  return (
    <div className="flex gap-3">
      <div className="w-28 flex-shrink-0 pt-0.5 text-xs text-gray-400">{label}</div>
      <div className={`flex-1 break-all text-xs text-gray-800 dark:text-gray-200 ${mono ? 'font-mono' : ''}`}>
        {String(value)}
      </div>
    </div>
  )
}

function logDayKey(log: AuditLogRow): string {
  const iso = toIso(log.client_time || log.created_at)
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

function formatDayHeader(dayKey: string): string {
  const [year, month, day] = dayKey.split('-')
  return year && month && day ? `${day}/${month}/${year}` : dayKey
}

function formatRowClock(log: AuditLogRow): string {
  const iso = toIso(log.client_time || log.created_at)
  if (!iso) return HISTORY_EMPTY
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return HISTORY_EMPTY
  return fmtDayFirst(date, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: BUSINESS_TIME_ZONE })
}

const AUDIT_TIME_LABELS: Record<AuditTimePreset, [string, string]> = {
  today: ['today', 'Today'],
  '7d': ['last_7_days', 'Last 7 days'],
  '30d': ['last_30_days', 'Last 30 days'],
  custom: ['custom_range', 'Custom range'],
}

const AUDIT_SCOPE_LABELS: Record<AuditScope, [string, string]> = {
  all: ['audit_scope_all', 'All'],
  section: ['audit_scope_section', 'Section'],
  user: ['audit_scope_user', 'User'],
}

export default function AuditLog() {
  const { t, user, language, hasPermission } = useApp()
  // E3: renders inside Review & Logs now -- lifecycle keys on that page.
  const isActive = useIsPageActive('review')
  const isAdmin = isAdminControlUser(user)
  // The Worker decides what a caller may read (audit_log tier: view = own rows
  // only); this only decides whether to OFFER the User scope.
  const canSeeAllUsers = isAdmin || hasPermission?.('audit_log') === true
  const [view, setView] = useState<AuditViewState>(() => initialAuditViewState())
  const [searchInput, setSearchInput] = useState('')
  const [logs, setLogs] = useState<AuditLogRow[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [userCounts, setUserCounts] = useState<AuditUserCount[]>([])
  const [sectionCounts, setSectionCounts] = useState<AuditSectionCount[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showRawAuditJson, setShowRawAuditJson] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const skeletonRows = useMemo(() => Array.from({ length: 8 }, (_, index) => index), [])
  const loadedOnceRef = useRef(false)
  const loadedKeyRef = useRef('')
  const loadRequestRef = useRef(0)
  const loadWatchdogRef = useRef<number | null>(null)
  const aliveRef = useRef(true)
  const today = todayStr()

  // (packKey, englishFallback) => translated -- the shape the shared audit
  // vocabulary takes, and the same one the Records floats pass it.
  const vocab = useCallback<LabelFn>((key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }, [t])
  const isKhmer = /[ក-៿]/.test(t('cancel') || '')
  const auditFallbacks = useMemo<Record<string, AuditFallback>>(() => ({
    all_time: { en: 'All time', km: 'គ្រប់ពេល' },
    time: 'ពេលវេលា',
    sort: 'តម្រៀប',
    newest_first: 'ថ្មីបំផុតមុន',
    oldest_first: 'ចាស់បំផុតមុន',
    refresh: 'ស្រស់ថ្មី',
    export: 'នាំចេញ',
    entries: 'កំណត់ត្រា',
  }), [])
  const copy = useCallback((key: string, fallbackEn: string, fallbackKm = fallbackEn): string => {
    const override = auditFallbacks[key]
    if (override && typeof override === 'object') {
      if (isKhmer && override.km && !isBrokenLocalizedString(override.km)) return override.km
      if (override.en && !isBrokenLocalizedString(override.en)) return override.en
      return key
    }
    if (isKhmer && typeof override === 'string' && !isBrokenLocalizedString(override)) return override
    const value = t(key)
    if (value && value !== key && !isBrokenLocalizedString(value)) return value
    if (isKhmer && fallbackKm && !isBrokenLocalizedString(fallbackKm)) return fallbackKm
    return isBrokenLocalizedString(fallbackEn) ? key : fallbackEn
  }, [auditFallbacks, isKhmer, t])

  const actionLabel = useCallback((action: unknown): string => {
    if (!action) return HISTORY_EMPTY
    const key = String(action).toLowerCase()
    // The two composites are built from two pack words each, so they stay
    // here rather than in the shared single-word map.
    if (key === 'backup_export') return `${vocab('backup', 'Backup')} ${vocab('export', 'Export')}`
    if (key === 'backup_restore') return `${vocab('backup', 'Backup')} ${vocab('restore', 'Restore')}`
    return auditActionLabel(key, vocab)
  }, [vocab])

  const actionColorClass = useCallback((action: unknown): string => {
    if (!action) return DEFAULT_ACTION_CLASS
    return ACTION_COLOR_CLASS[String(action).toLowerCase()] || DEFAULT_ACTION_CLASS
  }, [])

  const sectionLabel = useCallback((section: unknown): string => {
    const id = String(section || 'other')
    return vocab(`audit_section_${id}`, AUDIT_SECTION_FALLBACKS[id] || AUDIT_SECTION_FALLBACKS.other)
  }, [vocab])

  // A typed search waits for a pause before it becomes a request: every
  // request reads the audit table, and the read budget is finite.
  useEffect(() => {
    const trimmed = searchInput.trim()
    if (trimmed === view.search.trim()) return undefined
    const timer = window.setTimeout(() => setView((current) => ({ ...current, search: trimmed })), 350)
    return () => window.clearTimeout(timer)
  }, [searchInput, view.search])

  const filterKey = useMemo(() => auditFilterKey(view, today), [today, view])
  const params = useMemo(() => buildAuditRequestParams(view, { today }), [today, view])

  const load = useCallback(async (silent = false): Promise<void> => {
    const requestId = beginTrackedRequest(loadRequestRef)
    let didLoadRows = false
    if (!silent && aliveRef.current) {
      setLoadingMore(false)
      setLoading(true)
      setError(null)
      if (loadWatchdogRef.current) window.clearTimeout(loadWatchdogRef.current)
      loadWatchdogRef.current = window.setTimeout(() => {
        if (!aliveRef.current || !isTrackedRequestCurrent(loadRequestRef, requestId) || loadedOnceRef.current) return
        setError('Audit log is taking longer than expected. Tap Refresh to try again.')
      }, 20000)
    }
    try {
      const data = await withLoaderTimeout(
        () => getAuditLogsRequest(params) as Promise<AuditLogResponse | AuditLogRow[]>,
        'Audit log',
        AUDIT_LOG_LOAD_TIMEOUT_MS,
      )
      if (!aliveRef.current || !isTrackedRequestCurrent(loadRequestRef, requestId)) return
      const rows = Array.isArray(data) ? data : (data?.items || [])
      const emptyLocalFallback = !Array.isArray(data)
        && data?.partial === true
        && data?.source === 'local'
        && rows.length === 0
      if (emptyLocalFallback) {
        if (!loadedOnceRef.current) {
          setError('Audit log is still waiting for the server. No cached entries are available yet.')
        } else if (!silent) {
          setError('Audit log could not refresh right now. Showing the latest loaded data.')
        }
        return
      }
      const page = Array.isArray(data) ? null : data
      setLogs(rows)
      setNextCursor(page?.nextCursor || null)
      setHasMore(Boolean(page?.hasMore && page?.nextCursor))
      // Counts ride on the first page only; a local-mirror answer carries
      // none, so keep the last good ones instead of blanking the chips.
      if (page?.counts?.users) setUserCounts(page.counts.users)
      if (page?.counts?.sections) setSectionCounts(page.counts.sections)
      loadedKeyRef.current = filterKey
      didLoadRows = true
    } catch (err) {
      if (!aliveRef.current || !isTrackedRequestCurrent(loadRequestRef, requestId)) return
      console.error('Failed to load audit logs:', err)
      if (!silent && !loadedOnceRef.current) {
        setError(getErrorMessage(err, 'Failed to load audit logs.'))
      } else if (!silent) {
        setError('Audit log could not refresh right now. Showing the latest loaded data.')
      }
    } finally {
      if (!aliveRef.current || !isTrackedRequestCurrent(loadRequestRef, requestId)) return
      if (loadWatchdogRef.current) {
        window.clearTimeout(loadWatchdogRef.current)
        loadWatchdogRef.current = null
      }
      if (didLoadRows) {
        loadedOnceRef.current = true
        setHasLoadedOnce(true)
      }
      if (!silent) setLoading(false)
    }
  }, [filterKey, params])

  const loadMore = useCallback(async (): Promise<void> => {
    if (!nextCursor || loadingMore || loading) return
    const requestId = beginTrackedRequest(loadRequestRef)
    const moreParams = buildAuditRequestParams(view, { today, cursor: nextCursor })
    setLoadingMore(true)
    try {
      const data = await withLoaderTimeout(
        () => getAuditLogsRequest(moreParams) as Promise<AuditLogResponse | AuditLogRow[]>,
        'Audit log',
        AUDIT_LOG_LOAD_TIMEOUT_MS,
      )
      if (!aliveRef.current || !isTrackedRequestCurrent(loadRequestRef, requestId)) return
      const page = Array.isArray(data) ? null : data
      const rows = Array.isArray(data) ? data : (data?.items || [])
      setLogs((current) => mergeAuditRows(current, rows))
      setNextCursor(page?.nextCursor || null)
      setHasMore(Boolean(page?.hasMore && page?.nextCursor))
    } catch (err) {
      if (!aliveRef.current || !isTrackedRequestCurrent(loadRequestRef, requestId)) return
      console.error('Failed to load more audit logs:', err)
      setError(getErrorMessage(err, 'Failed to load audit logs.'))
    } finally {
      if (aliveRef.current && isTrackedRequestCurrent(loadRequestRef, requestId)) setLoadingMore(false)
    }
  }, [loading, loadingMore, nextCursor, today, view])

  useEffect(() => {
    if (!isActive) {
      invalidateTrackedRequest(loadRequestRef)
      if (loadWatchdogRef.current) {
        window.clearTimeout(loadWatchdogRef.current)
        loadWatchdogRef.current = null
      }
      setLoading(false)
      setLoadingMore(false)
      return
    }
    aliveRef.current = true
    // A changed filter is a visible reload of a new result set; coming back to
    // the same filters refreshes quietly behind the rows already shown.
    const sameResultSet = loadedOnceRef.current && loadedKeyRef.current === filterKey
    if (!sameResultSet) setExpandedId(null)
    void load(sameResultSet)
  }, [filterKey, isActive, load])

  useEffect(() => () => {
    aliveRef.current = false
    if (loadWatchdogRef.current) {
      window.clearTimeout(loadWatchdogRef.current)
      loadWatchdogRef.current = null
    }
    invalidateTrackedRequest(loadRequestRef)
  }, [])

  const actionOptions = useMemo(() => {
    const seen = new Map<string, string>()
    // The static list of actions the app writes; whatever a loaded page adds
    // stays selectable too (an action nobody listed yet).
    Object.keys(AUDIT_ACTION_LABELS).forEach((key) => seen.set(key, actionLabel(key)))
    logs.forEach((log) => {
      const key = String(log?.action || '').toLowerCase()
      if (!key || seen.has(key)) return
      seen.set(key, actionLabel(key))
    })
    return [...seen.entries()].sort((left, right) => left[1].localeCompare(right[1]))
  }, [actionLabel, logs])

  const sectionChips = useMemo(() => {
    const counts = new Map(sectionCounts.map((entry) => [entry.section, entry.count]))
    const picked = new Set(view.section === 'all' ? [] : view.section.split(','))
    return AUDIT_SECTION_IDS
      .filter((id) => counts.has(id) || picked.has(id))
      .map((id) => ({ id: String(id), label: sectionLabel(id), count: counts.get(id) ?? 0 }))
  }, [sectionCounts, sectionLabel, view.section])

  const userChips = useMemo(() => userCounts.map((entry) => ({
    id: entry.id == null ? '' : String(entry.id),
    label: entry.id == null ? (t('system') || 'System') : (entry.name || `#${entry.id}`),
    count: entry.count,
  })), [t, userCounts])

  const dayGroups = useMemo(() => {
    const groups: Array<{ key: string; rows: AuditLogRow[] }> = []
    for (const log of logs) {
      const key = logDayKey(log)
      const last = groups[groups.length - 1]
      if (last && last.key === key) last.rows.push(log)
      else groups.push({ key, rows: [log] })
    }
    return groups
  }, [logs])

  // H1+X5 (Part 401): the export menu opens the shared options dialog
  // (column chooser + CSV/Excel/PDF) with the rows pre-built to this
  // page's readable shape.
  const [exportDialog, setExportDialog] = useState<{ rows: Array<Record<string, unknown>>; baseName: string } | null>(null)
  const AUDIT_EXPORT_COLUMNS = useMemo(() => (
    ['entry', 'time', 'entity', 'user', 'action', 'device', 'timezone', 'summary'] as const
  ).map((key) => ({ key, label: key.charAt(0).toUpperCase() + key.slice(1) })), [])
  const exportRows = useCallback(async (rows: AuditLogRow[], prefix = 'audit-log') => {
    setExportDialog({
      baseName: prefix,
      rows: rows.map((log) => ({
        entry: `#${Number(log?.id || 0)}`,
        time: formatLogTime(log),
        entity: formatEntityName(log, vocab),
        user: historyExportField(log.user_name),
        action: actionLabel(log.action),
        device: auditDeviceLabel(log),
        timezone: auditTimezoneLabel(log),
        summary: readableSummary(log) || '',
      })),
    })
  }, [actionLabel, vocab])

  const handleRefresh = useCallback(() => {
    void load(false)
  }, [load])

  const exportItems = useMemo<ExportItem[]>(() => {
    const items: Array<ExportItem | null> = [
      { label: copy('export_visible_logs', 'Export visible logs', 'នាំចេញកំណត់ហេតុដែលកំពុងបង្ហាញ'), onClick: () => exportRows(logs, 'audit-log-visible') },
      view.action !== 'all' ? { label: copy('export_filtered_action', `Export ${actionLabel(view.action)}`, `នាំចេញតាមសកម្មភាព ${actionLabel(view.action)}`), onClick: () => exportRows(logs, `audit-log-${view.action}`) } : null,
    ]
    return items.filter((item): item is ExportItem => Boolean(item))
  }, [actionLabel, copy, exportRows, logs, view.action])

  const filterSections = useMemo(() => ([
    {
      id: 'action',
      label: t('action') || 'Action',
      searchable: true,
      options: [
        { id: 'all', label: t('all_actions') || 'All actions', active: view.action === 'all', onClick: () => setView((current) => ({ ...current, action: 'all' })) },
        ...actionOptions.map(([id, label]) => ({
          id,
          label,
          active: isMultiActive(view.action, id),
          onClick: () => setView((current) => ({ ...current, action: toggleMultiValue(current.action, id) })),
        })),
      ],
    },
    {
      id: 'sort',
      label: copy('sort', 'Sort'),
      options: [
        { id: 'desc', label: copy('newest_first', 'Newest first'), active: view.order === 'desc', onClick: () => setView((current) => ({ ...current, order: 'desc' })) },
        { id: 'asc', label: copy('oldest_first', 'Oldest first'), active: view.order === 'asc', onClick: () => setView((current) => ({ ...current, order: 'asc' })) },
      ],
    },
  ]), [actionOptions, copy, t, view.action, view.order])

  const activeFilterCount = (view.action !== 'all' ? 1 : 0) + (view.order !== 'desc' ? 1 : 0)

  const timeOptions = useMemo(() => AUDIT_TIME_PRESETS.map((preset) => ({
    value: preset,
    label: vocab(AUDIT_TIME_LABELS[preset][0], AUDIT_TIME_LABELS[preset][1]),
  })), [vocab])

  const toggleChip = (field: 'section' | 'userId', id: string) => {
    if (!id) return
    setView((current) => ({ ...current, [field]: toggleMultiValue(current[field], id) }))
  }

  const detailPanel = (detailLog: AuditLogRow) => {
    // A column is named with the same pack words a record's own
    // history uses (entityRecords.ts), not Title-Cased English --
    // the Khmer pack read "Telegram Topic Shift" for a /settopic row.
    const fieldLabelFor = (key: string) => entityFieldLabel(key, vocab)
    const fieldDiffRows = buildAuditFieldDiff(detailLog.old_value, detailLog.new_value, fieldLabelFor)
    // The recorded context: the payload the route wrote alongside the pair (a
    // rename's linked-sale counts, a profile save's mode, the operator's
    // reason). Same builder as the pair -- a details payload has no old side,
    // so its rows come back as context rows.
    const contextRows = buildAuditFieldDiff(null, detailLog.details, fieldLabelFor)
    const hasRawData = Boolean(detailLog.old_value || detailLog.new_value)
    return (
      <div className="space-y-3 border-t border-gray-100 bg-gray-50/70 px-3 py-3 dark:border-gray-700/60 dark:bg-gray-900/30">
        <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900/40">
          <div className="flex items-start gap-2">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
            <div className="min-w-0 space-y-2">
              <DetailRow label={t('client_time') || 'Client Time'} value={formatLogTime(detailLog)} />
              <DetailRow label={t('server_time') || 'Server Time'} value={formatDateTime(detailLog.created_at)} />
            </div>
          </div>
          <div className="flex items-start gap-2">
            <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
            <div className="min-w-0 space-y-2">
              <DetailRow label={t('device') || 'Device'} value={auditDeviceLabel(detailLog)} />
              <DetailRow label={t('timezone') || 'Timezone'} value={auditTimezoneLabel(detailLog)} mono />
            </div>
          </div>
          <div className="flex items-start gap-2">
            <User2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
            <div className="min-w-0 space-y-2">
              <DetailRow label={t('user') || 'User'} value={historyActor(detailLog.user_name)} />
              <DetailRow label={t('action') || 'Action'} value={actionLabel(detailLog.action)} />
              <DetailRow label={t('table') || 'Entity'} value={formatEntityName(detailLog, vocab)} />
              <DetailRow label={copy('audit_scope_section', 'Section')} value={detailLog.section ? sectionLabel(detailLog.section) : null} />
              <DetailRow label={copy('entry', 'Entry', 'លំដាប់')} value={`#${Number(detailLog.id || 0)}`} />
              <DetailRow label={t('reason') || 'Reason'} value={historyField(auditReason(detailLog))} />
              <DetailRow label={t('summary') || 'Summary'} value={historyField(readableSummary(detailLog))} />
            </div>
          </div>
        </div>

        {hasRawData && !fieldDiffRows.length ? (
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs leading-relaxed text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400">
            {copy('no_field_changed', 'No field changed', 'គ្មានវាលណាមួយផ្លាស់ប្តូរទេ')}
          </div>
        ) : null}
        {fieldDiffRows.length ? (
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                {copy('changed_fields', 'Changed fields', 'វាលដែលបានផ្លាស់ប្តូរ')}
              </div>
              <button
                type="button"
                onClick={() => setShowRawAuditJson((current) => !current)}
                className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
              >
                {showRawAuditJson
                  ? copy('hide_raw_data', 'Hide raw data', 'លាក់ទិន្នន័យដើម')
                  : copy('view_raw_data', 'View raw data', 'មើលទិន្នន័យដើម')}
              </button>
            </div>
            <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900/40">
              {fieldDiffRows.map((row) => <AuditFieldDiffLine key={row.key} row={row} />)}
            </div>
          </div>
        ) : null}

        {contextRows.length ? (
          <div>
            <div className="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
              {copy('recorded_context', 'Recorded context', 'ព័ត៌មានកត់ត្រាបន្ថែម')}
            </div>
            <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900/40">
              {contextRows.map((row) => <AuditFieldDiffLine key={`context:${row.key}`} row={row} />)}
            </div>
          </div>
        ) : null}

        {(showRawAuditJson || !fieldDiffRows.length) && hasRawData ? (
          <>
            {detailLog.old_value ? (
              <div>
                <div className="mb-1 text-xs font-semibold text-red-500">{t('before_data') || 'Before (old data)'}</div>
                <pre className="max-h-48 overflow-auto rounded-lg bg-red-50 p-3 text-xs font-mono text-red-700 whitespace-pre-wrap break-all dark:bg-red-900/20 dark:text-red-300">
                  {formatJsonPretty(detailLog.old_value)}
                </pre>
              </div>
            ) : null}
            {detailLog.new_value ? (
              <div>
                <div className="mb-1 text-xs font-semibold text-green-600">{t('after_data') || 'After (new data)'}</div>
                <pre className="max-h-48 overflow-auto rounded-lg bg-green-50 p-3 text-xs font-mono text-green-700 whitespace-pre-wrap break-all dark:bg-green-900/20 dark:text-green-300">
                  {formatJsonPretty(detailLog.new_value)}
                </pre>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    )
  }

  const chipStrip = view.scope === 'section' ? sectionChips : view.scope === 'user' ? userChips : []
  const chipField: 'section' | 'userId' = view.scope === 'section' ? 'section' : 'userId'

  return (
    <div className="page-scroll flex flex-col p-3 sm:p-6">
      {exportDialog ? (
        <Suspense fallback={null}>
          <ExportOptionsDialog
            title={t('export_options_title') || 'Export options'}
            fileBaseName={exportDialog.baseName}
            columns={AUDIT_EXPORT_COLUMNS}
            rows={exportDialog.rows}
            rememberKey="audit-log"
            t={t}
            onClose={() => setExportDialog(null)}
          />
        </Suspense>
      ) : null}

      {/* The controls pin to the top of the page's scroll container while the
          rows scroll. Row 1: scope + time. Row 2: search + export + filters.
          Then the custom range (only when chosen) and the scope's chips. */}
      <div className="sticky top-2 z-30 -mx-1 space-y-2 bg-gray-50 pb-2 dark:bg-gray-900 sm:mx-0">
        <div
          className="flex items-center gap-2 pt-1"
          title={t('audit_log_desc') || 'Default columns: Record, Device, User, Action. Click a row to see full details and data changes.'}
        >
          <div role="group" aria-label={t('audit_log') || 'Audit Log'} className="grid min-w-0 flex-1 grid-flow-col auto-cols-fr gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800/90">
            {AUDIT_SCOPES.filter((scope) => scope !== 'user' || canSeeAllUsers).map((scope) => (
              <button
                key={scope}
                type="button"
                aria-pressed={view.scope === scope}
                onClick={() => setView((current) => setAuditScope(current, scope, canSeeAllUsers))}
                className={`min-h-9 min-w-0 rounded-md px-2 text-xs font-semibold transition-colors ${view.scope === scope ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-100 dark:bg-slate-700 dark:text-white dark:ring-slate-600' : 'text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-white'}`}
              >
                <span className="detail-scroll-text text-center">{vocab(AUDIT_SCOPE_LABELS[scope][0], AUDIT_SCOPE_LABELS[scope][1])}</span>
              </button>
            ))}
          </div>
          <AppSelect
            id="audit-log-time"
            name="audit_log_time"
            className="w-[7.5rem] shrink-0"
            buttonClassName="w-full"
            value={view.preset}
            options={timeOptions}
            onChange={(value) => setView((current) => setAuditPreset(current, value as AuditTimePreset, today))}
            ariaLabel={t('time') || 'Time'}
          />
        </div>

        <div className="flex items-center gap-2">
          <SearchInput
            id="audit-log-search"
            name="audit_log_search"
            value={searchInput}
            onChange={setSearchInput}
            placeholder={t('search_audit_placeholder') || 'Search logs'}
            inputClassName="text-sm"
          />
          <ExportMenu label={copy('export', 'Export')} items={exportItems} compact mobileIconOnly />
          {/* Filter stays last in the row -- same rule as every other list
              page's search+action row. */}
          <FilterMenu
            label={t('filters') || 'Filters'}
            activeCount={activeFilterCount}
            sections={filterSections}
            onClear={() => setView((current) => ({ ...current, action: 'all', order: 'desc' }))}
            compact
            mobileIconOnly
          />
        </div>

        {view.preset === 'custom' ? (
          <StatsRangeRow
            range={{ startDate: view.rangeStart, endDate: view.rangeEnd, startTime: '', endTime: '' }}
            onRangeChange={(next) => setView((current) => setAuditRange(current, next.startDate || '', next.endDate || ''))}
            t={t}
            showTime={false}
            showPresets={false}
            className="w-full min-w-0"
          />
        ) : null}

        {view.scope !== 'all' ? (
          <div className="flex min-w-0 flex-nowrap gap-1 overflow-x-auto overscroll-x-contain pb-1" data-audit-scope-chips>
            {chipStrip.length === 0 ? (
              <span className="px-1 py-1.5 text-xs text-gray-400">{loading ? (t('loading') || 'Loading...') : (t('no_data') || 'No data')}</span>
            ) : chipStrip.map((chip) => {
              const picked = isMultiActive(view[chipField], chip.id)
              return (
                <button
                  key={`${view.scope}-${chip.id || 'none'}`}
                  type="button"
                  aria-pressed={picked}
                  disabled={!chip.id}
                  onClick={() => toggleChip(chipField, chip.id)}
                  className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium disabled:opacity-60 ${picked ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-300'}`}
                >
                  <span className="max-w-[9rem] detail-scroll-text">{chip.label}</span>
                  <span className={`rounded-full px-1.5 text-[10px] font-semibold ${picked ? 'bg-white/20' : 'bg-white text-slate-500 dark:bg-slate-900/80 dark:text-slate-300'}`}>{chip.count}</span>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <ClipboardList className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
          <div className="flex-1">
            <p className="mb-1 text-sm font-semibold text-red-700 dark:text-red-300">
              {(t('error') || 'Error')}: {t('audit_log') || 'Audit Log'}
            </p>
            <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>
            <button onClick={handleRefresh} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">
              {t('retry') || 'Try again'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        {loading && !hasLoadedOnce ? (
          <div className="space-y-2 p-3">
            {skeletonRows.map((row) => (
              <div key={`audit-skeleton-${row}`} className="h-7 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : !hasLoadedOnce ? (
          <div className="py-10 text-center text-gray-400">{t('loading') || 'Loading...'}</div>
        ) : logs.length === 0 ? (
          <div className="py-10 text-center text-gray-400">{t('no_data') || 'No data'}</div>
        ) : (
          <div className={loading ? 'opacity-60 transition-opacity' : ''}>
            {dayGroups.map((group) => (
              <div key={`${group.key}-${group.rows[0]?.id}`}>
                <div className="flex items-center justify-between gap-2 bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
                  <span>{formatDayHeader(group.key)}</span>
                  <span className="text-slate-400">{group.rows.length}</span>
                </div>
                <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
                  {group.rows.map((log) => {
                    const rowId = String(log.id)
                    const open = expandedId === rowId
                    const summary = readableSummary(log)
                    return (
                      <li key={rowId}>
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => {
                            setExpandedId(open ? null : rowId)
                            setShowRawAuditJson(false)
                          }}
                          className="flex w-full min-w-0 items-center gap-1.5 px-2 py-1.5 text-left text-xs hover:bg-blue-50 dark:hover:bg-blue-900/10"
                          title={formatLogTime(log)}
                        >
                          <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-gray-300 transition-transform ${open ? 'rotate-90' : ''}`} />
                          <span className="shrink-0 font-mono tabular-nums text-gray-400">{formatRowClock(log)}</span>
                          <span className="max-w-[5.5rem] shrink-0 detail-scroll-text font-medium text-gray-700 dark:text-gray-200">{historyActor(log.user_name)}</span>
                          <span className={`shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${actionColorClass(log.action)}`}>
                            {actionLabel(log.action)}
                          </span>
                          <span className="min-w-0 flex-1 detail-scroll-text text-gray-500 dark:text-gray-400">
                            {formatEntityName(log, vocab)}{summary ? ` · ${summary}` : ''}
                          </span>
                        </button>
                        {open ? detailPanel(log) : null}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
        {hasLoadedOnce && logs.length > 0 ? (
          <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 text-xs text-gray-400 dark:border-gray-700">
            <span>{logs.length}{hasMore ? '+' : ''} {copy('entries', 'entries', 'កំណត់ត្រា')}</span>
            {hasMore ? (
              <button type="button" className="btn-secondary px-3 py-1 text-xs" disabled={loadingMore || loading} onClick={() => { void loadMore() }}>
                {loadingMore ? (t('loading') || 'Loading...') : vocab('audit_load_more', 'Load more')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
