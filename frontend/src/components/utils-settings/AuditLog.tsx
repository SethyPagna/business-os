import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight, ClipboardList, Clock3, MonitorSmartphone, RefreshCw, Search, User2, X } from 'lucide-react'
import { isBrokenLocalizedString as isBrokenLocalizedStringHook, useApp as useAppHook } from '../../AppContext.jsx'
import { downloadCSV } from '../../utils/csv'
import ExportMenu from '../shared/ExportMenu'
import FilterMenu from '../shared/FilterMenu'
import PaginationControls, { clampPage } from '../shared/PaginationControls'
import { useIsPageActive } from '../shared/pageActivity'
import { buildTimeActionSections, getAvailableYears, getTimeGroupingMode, toggleIdSet } from '../../utils/groupedRecords.ts'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'

type SortDirection = 'asc' | 'desc'
type AuditGroupMode = 'time' | 'time+action'
type TranslateFn = (key: string) => string

interface AuditUserOption {
  id?: string | number | null
  name?: string | null
}

interface AuditLogRow {
  id?: string | number | null
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
}

interface AuditLogResponse {
  items?: AuditLogRow[]
  total?: number | string | null
  partial?: boolean
  source?: string | null
  filters?: {
    users?: AuditUserOption[]
  }
}

interface AuditLogParams {
  page: number
  pageSize: number
  search?: string
  action?: string
  userId?: string
  startDate?: string
  endDate?: string
}

interface AuditApi {
  getAuditLogs(params: AuditLogParams): Promise<AuditLogResponse | AuditLogRow[]>
  deleteAuditLogsRetention(olderThanDays: number): Promise<unknown>
}

interface AppContextValue {
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

interface ExportItem {
  label: string
  onClick: () => void
  color?: string
}

const useApp = useAppHook as () => AppContextValue
const isBrokenLocalizedString = isBrokenLocalizedStringHook as (value: unknown) => boolean

function getAuditApi(): AuditApi {
  return (window as unknown as { api: AuditApi }).api
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

const DEFAULT_ACTION_CLASS = 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
const AUDIT_LOG_LOAD_TIMEOUT_MS = 20000
const AUDIT_LOG_RETENTION_DELETE_TIMEOUT_MS = 12000

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
  const value = String(raw)
  if (value.includes('T') || value.endsWith('Z')) return value
  return `${value.replace(' ', 'T')}Z`
}

function formatDateTime(raw: unknown): string {
  const iso = toIso(raw)
  if (!iso) return '--'
  const fallback = String(raw)
  try {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return fallback
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return fallback
  }
}

function formatLogTime(log: AuditLogRow): string {
  return formatDateTime(log.client_time || log.created_at)
}

function getLogEpoch(log: AuditLogRow | null | undefined): number {
  const iso = toIso(log?.client_time || log?.created_at)
  if (!iso) return 0
  const epoch = new Date(iso).getTime()
  return Number.isFinite(epoch) ? epoch : 0
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

function formatEntityName(log: AuditLogRow): string {
  const raw = String(log.table_name || log.entity || '').trim()
  if (!raw) return 'System'
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase())
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

function normalizeFiniteIdsFrom<T>(items: T[] = [], getValue: (value: T) => unknown = (value) => value): number[] {
  return items.reduce((normalized, item) => {
    const id = Number(getValue(item))
    if (Number.isFinite(id)) normalized.push(id)
    return normalized
  }, [] as number[])
}

function normalizeFiniteIds(ids: unknown[] = []): number[] {
  return normalizeFiniteIdsFrom(ids)
}

function countSelectedIds(ids: number[] = [], selectedIds: Set<number> = new Set()): number {
  let count = 0
  for (const id of ids) {
    if (selectedIds.has(id)) count += 1
  }
  return count
}

function countActiveFlags(flags: boolean[] = []): number {
  let count = 0
  for (const flag of flags) {
    if (flag) count += 1
  }
  return count
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

export default function AuditLog() {
  const { t, user, hasPermission } = useApp()
  const isActive = useIsPageActive('audit_log')
  const [logs, setLogs] = useState<AuditLogRow[]>([])
  const [search, setSearch] = useState('')
  const [yearFilter, setYearFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [userFilter, setUserFilter] = useState('all')
  const [auditUsers, setAuditUsers] = useState<AuditUserOption[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [totalLogs, setTotalLogs] = useState(0)
  const [groupMode, setGroupMode] = useState<AuditGroupMode>('time')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set())
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const [loading, setLoading] = useState(true)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [initialDesktopRevealReady, setInitialDesktopRevealReady] = useState(false)
  const [initialMobileRevealReady, setInitialMobileRevealReady] = useState(false)
  const [detailLog, setDetailLog] = useState<AuditLogRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [clearingOldLogs, setClearingOldLogs] = useState(false)
  const skeletonRows = useMemo(() => Array.from({ length: 8 }, (_, index) => index), [])
  const loadedOnceRef = useRef(false)
  const pageLoadRequestedRef = useRef(false)
  const loadRequestRef = useRef(0)
  const loadWatchdogRef = useRef<number | null>(null)
  const clearOldLogsInFlightRef = useRef(false)
  const selectAllRef = useRef<HTMLInputElement | null>(null)
  const aliveRef = useRef(true)
  const isAdmin = useMemo(() => {
    const roleCode = String(user?.role_code || '').toLowerCase()
    const username = String(user?.username || '').toLowerCase()
    return username === 'admin' || roleCode === 'admin' || hasPermission?.('all')
  }, [hasPermission, user])
  const timeMode = useMemo(() => getTimeGroupingMode(yearFilter, monthFilter), [monthFilter, yearFilter])

  const actionLabels = useMemo<Record<string, string>>(() => ({
    create: t('create') || 'Create',
    update: t('edit') || 'Update',
    delete: t('delete') || 'Delete',
    sale: t('sale') || 'Sale',
    login: t('login') || 'Login',
    logout: t('logout') || 'Logout',
    stock_add: t('stock_in') || 'Stock Add',
    stock_remove: t('stock_out') || 'Stock Remove',
    stock_adjust: t('adjust_stock') || 'Adjust',
    stock_set: t('adjust_stock') || 'Set stock',
    bulk_import: t('bulk_import') || 'Bulk Import',
    image_import: t('image_import') || 'Image Import',
    upload: t('upload_file') || 'Upload',
    data_reset: t('data_reset') || 'Data Reset',
    factory_reset: t('factory_reset') || 'Factory Reset',
    transfer: t('stock_transfer') || 'Transfer',
    reset_password: t('reset_password') || 'Reset Password',
    repair: t('repair') || 'Repair',
    return: t('returns') || 'Return',
    backup_export: `${t('backup') || 'Backup'} ${t('export') || 'Export'}`,
    backup_restore: `${t('backup') || 'Backup'} ${t('restore') || 'Restore'}`,
  }), [t])
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
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
    if (!action) return '--'
    const key = String(action).toLowerCase()
    return actionLabels[key] || key.replace(/_/g, ' ')
  }, [actionLabels])

  const actionColorClass = useCallback((action: unknown): string => {
    if (!action) return DEFAULT_ACTION_CLASS
    return ACTION_COLOR_CLASS[String(action).toLowerCase()] || DEFAULT_ACTION_CLASS
  }, [])

  const auditDateRange = useMemo<Pick<AuditLogParams, 'startDate' | 'endDate'>>(() => {
    if (yearFilter === 'all') return {}
    const year = Number(yearFilter)
    if (!Number.isFinite(year)) return {}
    const month = monthFilter !== 'all' ? Number(monthFilter) : null
    if (month && Number.isFinite(month)) {
      const start = new Date(Date.UTC(year, month - 1, 1))
      const end = new Date(Date.UTC(year, month, 0))
      return {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
      }
    }
    return {
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    }
  }, [monthFilter, yearFilter])

  const load = useCallback(async (silent = false): Promise<void> => {
    const requestId = beginTrackedRequest(loadRequestRef)
    let didLoadRows = false
    if (!silent && aliveRef.current) {
      setLoading(true)
      setError(null)
      if (loadWatchdogRef.current) window.clearTimeout(loadWatchdogRef.current)
      loadWatchdogRef.current = window.setTimeout(() => {
        if (!aliveRef.current || !isTrackedRequestCurrent(loadRequestRef, requestId) || loadedOnceRef.current) return
        setLoading(false)
        setError('Audit log is taking longer than expected. Tap Refresh to try again.')
      }, 20000)
    }
    try {
      const params: AuditLogParams = {
        page,
        pageSize,
        search: search.trim() || undefined,
        action: actionFilter !== 'all' ? actionFilter : undefined,
        userId: isAdmin && userFilter !== 'all' ? userFilter : undefined,
        ...auditDateRange,
      }
      const data = await withLoaderTimeout(
        () => getAuditApi().getAuditLogs(params),
        'Audit log',
        AUDIT_LOG_LOAD_TIMEOUT_MS,
      )
      if (!aliveRef.current || !isTrackedRequestCurrent(loadRequestRef, requestId)) return
      const rows = Array.isArray(data) ? data : (data?.items || [])
      const nextTotal = Number(Array.isArray(data) ? rows.length : data?.total || rows.length)
      const emptyLocalFallback = !Array.isArray(data)
        && data?.partial === true
        && data?.source === 'local'
        && rows.length === 0
        && nextTotal === 0
      if (emptyLocalFallback) {
        if (!loadedOnceRef.current) {
          setError('Audit log is still waiting for the server. No cached entries are available yet.')
        } else if (!silent) {
          setError('Audit log could not refresh right now. Showing the latest loaded data.')
        }
        return
      }
      const clampedPage = clampPage(page, nextTotal, pageSize)
      if (clampedPage !== page) {
        setPage(clampedPage)
        return
      }
      setLogs(rows)
      setTotalLogs(nextTotal)
      setAuditUsers(!Array.isArray(data) && Array.isArray(data?.filters?.users) ? data.filters.users : [])
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
  }, [actionFilter, auditDateRange, isAdmin, page, pageSize, search, userFilter])

  useEffect(() => {
    if (!isActive) {
      pageLoadRequestedRef.current = false
      invalidateTrackedRequest(loadRequestRef)
      if (loadWatchdogRef.current) {
        window.clearTimeout(loadWatchdogRef.current)
        loadWatchdogRef.current = null
      }
      setLoading(false)
      return
    }
    aliveRef.current = true
    const needsVisibleReload = !loadedOnceRef.current || !!error
    if (pageLoadRequestedRef.current) {
      load(needsVisibleReload ? false : true)
      return
    }
    if (needsVisibleReload) {
      pageLoadRequestedRef.current = true
      load(false)
      return
    }
    pageLoadRequestedRef.current = true
    load(false)
  }, [error, isActive, load, logs.length])

  useEffect(() => {
    setPage(1)
  }, [actionFilter, monthFilter, pageSize, search, userFilter, yearFilter])

  useEffect(() => () => {
    aliveRef.current = false
    if (loadWatchdogRef.current) {
      window.clearTimeout(loadWatchdogRef.current)
      loadWatchdogRef.current = null
    }
    invalidateTrackedRequest(loadRequestRef)
  }, [])

  const availableYears = useMemo(
    () => getAvailableYears(logs, (log) => log?.client_time || log?.created_at),
    [logs],
  )

  const actionOptions = useMemo(() => {
    const seen = new Map<string, string>()
    logs.forEach((log) => {
      const key = String(log?.action || '').toLowerCase()
      if (!key) return
      seen.set(key, actionLabel(key))
    })
    return [...seen.entries()].sort((left, right) => left[1].localeCompare(right[1]))
  }, [actionLabel, logs])

  const filtered = useMemo(() => logs, [logs])

  const orderedLogs = useMemo(() => {
    const next = [...filtered]
    next.sort((left, right) => {
      const delta = getLogEpoch(left) - getLogEpoch(right)
      if (delta !== 0) return delta
      return Number(left?.id || 0) - Number(right?.id || 0)
    })
    return sortDirection === 'asc' ? next : next.reverse()
  }, [filtered, sortDirection])

  const groupedSections = useMemo(() => buildTimeActionSections(orderedLogs, {
    getDate: (log) => log?.client_time || log?.created_at,
    getItemId: (log) => Number(log?.id),
    getActionKey: (log) => String(log?.action || '').toLowerCase() || 'other',
    getActionLabel: (log) => actionLabel(log?.action),
    year: yearFilter,
    month: monthFilter,
    timeMode,
    groupMode,
    sortDirection,
  }), [actionLabel, groupMode, monthFilter, orderedLogs, sortDirection, timeMode, yearFilter])
  const showActionGroups = groupMode === 'time+action'
  const isInitialDesktopLoad = loading && !hasLoadedOnce
  const showDesktopLoadingOverlay = !initialDesktopRevealReady

  const visibleLogs = useMemo(
    () => groupedSections.flatMap((section) => section.groups.flatMap((group) => group.items)),
    [groupedSections],
  )
  const visibleIds = useMemo(
    () => normalizeFiniteIdsFrom(visibleLogs, (log) => log.id),
    [visibleLogs],
  )
  const showMobileLoadingOverlay = hasLoadedOnce && visibleLogs.length > 0 && (!initialMobileRevealReady || loading)

  useEffect(() => {
    if (initialDesktopRevealReady || loading) return
    if (!visibleLogs.length || error) {
      setInitialDesktopRevealReady(true)
      return
    }
    let cancelled = false
    let nestedFrame: number | null = null
    const frame = window.requestAnimationFrame(() => {
      nestedFrame = window.requestAnimationFrame(() => {
        if (!cancelled) setInitialDesktopRevealReady(true)
      })
    })
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      if (nestedFrame !== null) window.cancelAnimationFrame(nestedFrame)
    }
  }, [error, initialDesktopRevealReady, loading, visibleLogs.length])

  useEffect(() => {
    if (loading) {
      setInitialMobileRevealReady(false)
      return
    }
    if (initialMobileRevealReady) return
    if (!visibleLogs.length || error) {
      setInitialMobileRevealReady(true)
      return
    }
    let cancelled = false
    let nestedFrame: number | null = null
    const frame = window.requestAnimationFrame(() => {
      nestedFrame = window.requestAnimationFrame(() => {
        if (!cancelled) setInitialMobileRevealReady(true)
      })
    })
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      if (nestedFrame !== null) window.cancelAnimationFrame(nestedFrame)
    }
  }, [error, initialMobileRevealReady, loading, visibleLogs.length])

  useEffect(() => {
    const validIds = new Set(visibleIds)
    setSelectedIds((current) => new Set([...current].filter((id) => validIds.has(id))))
  }, [visibleIds])

  useEffect(() => {
    const validIds = new Set(groupedSections.map((section) => section.id))
    setCollapsedSections((current) => {
      const next = new Set([...current].filter((id) => validIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [groupedSections])

  const selectedLogs = useMemo(
    () => visibleLogs.filter((log) => selectedIds.has(Number(log.id))),
    [selectedIds, visibleLogs],
  )

  useEffect(() => {
    if (!selectAllRef.current) return
    selectAllRef.current.indeterminate = selectedIds.size > 0 && selectedIds.size < visibleIds.length
  }, [selectedIds.size, visibleIds.length])

  const toggleSelected = useCallback((logId: unknown) => {
    const numericId = Number(logId)
    if (!Number.isFinite(numericId)) return
    setSelectedIds((current) => toggleIdSet(current, [numericId], !current.has(numericId)))
  }, [])

  const toggleSelectAll = useCallback((checked: boolean) => {
    if (!checked) {
      setSelectedIds(new Set())
      return
    }
    setSelectedIds(new Set(visibleIds))
  }, [visibleIds])

  const toggleSelectionScope = useCallback((ids: unknown[], checked: boolean) => {
    const normalized = normalizeFiniteIds(ids)
    setSelectedIds((current) => toggleIdSet(current, normalized, checked))
  }, [])

  const toggleSectionCollapsed = useCallback((sectionId: string) => {
    setCollapsedSections((current) => {
      const next = new Set(current)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }, [])

  const isSelectionScopeFullySelected = useCallback(
    (ids: unknown[] = []) => {
      const normalized = normalizeFiniteIds(ids)
      return normalized.length > 0 && countSelectedIds(normalized, selectedIds) === normalized.length
    },
    [selectedIds],
  )

  const isSelectionScopePartiallySelected = useCallback(
    (ids: unknown[] = []) => {
      const normalized = normalizeFiniteIds(ids)
      const selectedCount = countSelectedIds(normalized, selectedIds)
      return selectedCount > 0 && selectedCount < normalized.length
    },
    [selectedIds],
  )

  function sessionEntryLabel(log: AuditLogRow): string {
    return `#${Number(log?.id || 0)}`
  }

  const exportRows = useCallback((rows: AuditLogRow[], prefix = 'audit-log') => {
    downloadCSV(`${prefix}-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((log) => ({
      Entry: sessionEntryLabel(log),
      Time: formatLogTime(log),
      Entity: formatEntityName(log),
      User: log.user_name || '',
      Action: actionLabel(log.action),
      Device: log.device_name || '',
      Timezone: log.device_tz || '',
      Summary: readableSummary(log) || '',
    })))
  }, [actionLabel])
  const desktopColGroup = (
    <colgroup>
      <col className="w-10" />
      <col className="w-24" />
      <col className="w-28" />
      <col className="w-28" />
      <col className="w-24" />
      <col className="w-44" />
      <col className="w-[26%]" />
      <col className="w-36" />
    </colgroup>
  )

  const handleRefresh = useCallback(() => {
    load(false)
  }, [load])

  const exportItems = useMemo<ExportItem[]>(() => ([
    { label: copy('export_visible_logs', 'Export visible logs', 'នាំចេញកំណត់ហេតុដែលកំពុងបង្ហាញ'), onClick: () => exportRows(visibleLogs, 'audit-log-visible') },
    selectedLogs.length ? { label: copy('export_selected_logs', 'Export selected logs', 'នាំចេញកំណត់ហេតុដែលបានជ្រើស'), onClick: () => exportRows(selectedLogs, 'audit-log-selected'), color: 'blue' } : null,
    actionFilter !== 'all' ? { label: copy('export_filtered_action', `Export ${actionLabel(actionFilter)}`, `នាំចេញតាមសកម្មភាព ${actionLabel(actionFilter)}`), onClick: () => exportRows(visibleLogs, `audit-log-${actionFilter}`) } : null,
    yearFilter !== 'all' || monthFilter !== 'all' ? { label: copy('export_filtered_time_range', 'Export filtered time range', 'នាំចេញតាមចន្លោះពេលដែលបានតម្រង'), onClick: () => exportRows(visibleLogs, 'audit-log-filtered') } : null,
  ].filter((item): item is ExportItem => Boolean(item))), [actionFilter, actionLabel, copy, exportRows, monthFilter, selectedLogs, selectedLogs.length, visibleLogs, yearFilter])

  const filterSections = useMemo(() => ([
    {
      id: 'year',
      label: copy('year', 'Year'),
      options: [
        { id: 'all', label: copy('all_years', 'All years'), active: yearFilter === 'all', onClick: () => { setYearFilter('all'); setMonthFilter('all') } },
        ...availableYears.map((year) => ({
          id: `year-${year}`,
          label: year,
          active: yearFilter === year,
          onClick: () => {
            const next = yearFilter === year ? 'all' : year
            setYearFilter(next)
            if (next === 'all') setMonthFilter('all')
          },
        })),
      ],
    },
    {
      id: 'month',
      label: copy('month', 'Month'),
      options: [
        { id: 'all', label: copy('all_months', 'All months'), active: monthFilter === 'all', onClick: () => setMonthFilter('all') },
        ...Array.from({ length: 12 }, (_, index) => {
          const month = String(index + 1)
          return {
            id: `month-${month}`,
            label: new Date(2000, index, 1).toLocaleString(undefined, { month: 'long' }),
            active: monthFilter === month,
            onClick: () => setMonthFilter(monthFilter === month ? 'all' : month),
          }
        }),
      ],
    },
    {
      id: 'action',
      label: t('action') || 'Action',
      options: [
        { id: 'all', label: t('all_actions') || 'All actions', active: actionFilter === 'all', onClick: () => setActionFilter('all') },
        ...actionOptions.map(([id, label]) => ({
          id,
          label,
          active: actionFilter === id,
          onClick: () => setActionFilter(actionFilter === id ? 'all' : id),
        })),
      ],
    },
    isAdmin ? {
      id: 'user',
      label: t('user') || 'User',
      options: [
        { id: 'all', label: t('all_users') || 'All users', active: userFilter === 'all', onClick: () => setUserFilter('all') },
        ...auditUsers.map((auditUser) => {
          const id = String(auditUser?.id || '')
          return {
            id: `user-${id}`,
            label: auditUser?.name || `User ${id}`,
            active: userFilter === id,
            onClick: () => setUserFilter(userFilter === id ? 'all' : id),
          }
        }).filter((option) => option.id !== 'user-'),
      ],
    } : null,
    {
      id: 'sort',
      label: copy('sort', 'Sort'),
      options: [
        { id: 'desc', label: copy('newest_first', 'Newest first'), active: sortDirection === 'desc', onClick: () => setSortDirection('desc') },
        { id: 'asc', label: copy('oldest_first', 'Oldest first'), active: sortDirection === 'asc', onClick: () => setSortDirection('asc') },
      ],
    },
    {
      id: 'group',
      label: copy('group_by', 'Group by'),
      options: [
        { id: 'group-time', label: copy('group_time_created', 'Time created'), active: groupMode === 'time', onClick: () => setGroupMode('time') },
        { id: 'group-time-action', label: copy('group_time_action', 'Time + action'), active: groupMode === 'time+action', onClick: () => setGroupMode('time+action') },
      ],
    },
  ].filter(Boolean)), [actionFilter, actionOptions, auditUsers, availableYears, copy, groupMode, isAdmin, monthFilter, sortDirection, t, userFilter, yearFilter])

  const activeFilterCount = useMemo(
    () => countActiveFlags([yearFilter !== 'all', monthFilter !== 'all', actionFilter !== 'all', userFilter !== 'all', sortDirection !== 'desc', groupMode !== 'time']),
    [actionFilter, groupMode, monthFilter, sortDirection, userFilter, yearFilter],
  )

  const clearOldAuditLogs = useCallback(async () => {
    if (!isAdmin) return
    if (!window.confirm('Clear audit logs older than 30 days?')) return
    if (!beginSingleAction(clearOldLogsInFlightRef, { blocked: clearingOldLogs })) return
    try {
      setClearingOldLogs(true)
      setLoading(true)
      await withLoaderTimeout(
        () => getAuditApi().deleteAuditLogsRetention(30),
        'Clear old audit logs',
        AUDIT_LOG_RETENTION_DELETE_TIMEOUT_MS,
      )
      await load(true)
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to clear old audit logs.'))
    } finally {
      finishSingleAction(clearOldLogsInFlightRef)
      setClearingOldLogs(false)
      setLoading(false)
    }
  }, [clearingOldLogs, isAdmin, load])

  return (
    <div className="page-scroll flex flex-col p-3 sm:p-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2 min-w-0">
        <h1
          className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white sm:text-2xl"
          title={t('audit_log_desc') || 'Default columns: Record, Device, User, Action. Click a row to see full details and data changes.'}
        >
          <ClipboardList className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          {t('audit_log') || 'Audit Log'}
        </h1>
        <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto pb-0.5">
          <button onClick={handleRefresh} className="btn-secondary inline-flex min-w-[6.5rem] shrink-0 items-center justify-center gap-2 px-3 py-1.5 text-xs sm:text-sm">
            <RefreshCw className="h-4 w-4" />
            {copy('refresh', 'Refresh')}
          </button>
          {isAdmin ? (
            <button
              onClick={clearOldAuditLogs}
              disabled={clearingOldLogs}
              className="btn-secondary inline-flex min-w-[6.5rem] shrink-0 items-center justify-center gap-2 px-3 py-1.5 text-xs disabled:opacity-50 sm:text-sm"
            >
              <X className="h-4 w-4" />
              {copy('clear_30_days', 'Clear 30d')}
            </button>
          ) : null}
          <ExportMenu label={copy('export', 'Export')} items={exportItems} compact triggerClassName="min-w-[6.5rem]" />
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <label htmlFor="audit-log-search" className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            id="audit-log-search"
            name="audit_log_search"
            className="input min-w-0 w-full pl-9 text-sm"
            placeholder={t('search_audit_placeholder') || 'Search logs'}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoComplete="off"
          />
        </label>
        <FilterMenu
          label={t('filters') || 'Filters'}
          activeCount={activeFilterCount}
          sections={filterSections}
          onClear={() => {
            setYearFilter('all')
            setMonthFilter('all')
            setActionFilter('all')
            setUserFilter('all')
            setGroupMode('time')
            setSortDirection('desc')
          }}
          compact
        />
      </div>

      {selectedLogs.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-900/40 dark:bg-blue-900/20">
          <span className="font-semibold text-blue-700 dark:text-blue-300">{selectedLogs.length} selected</span>
          <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => exportRows(selectedLogs, 'audit-log-selected')}>Export selected</button>
          <button type="button" className="ml-auto text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" onClick={() => setSelectedIds(new Set())}>
            {t('clear') || 'Clear'}
          </button>
        </div>
      ) : null}

      <div className="mb-3 min-h-[2.75rem]">
        {loading && !hasLoadedOnce ? (
          <div className="flex h-14 animate-pulse items-center justify-between rounded-xl border border-slate-200 bg-white/80 px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900/70">
            <div className="h-3 w-40 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="flex items-center gap-2">
              <div className="h-8 w-24 rounded-lg bg-slate-200 dark:bg-slate-700" />
              <div className="h-8 w-28 rounded-lg bg-slate-200 dark:bg-slate-700" />
            </div>
          </div>
        ) : (
          <PaginationControls
            className="mb-0"
            compact
            compactPageInput
            page={page}
            pageSize={pageSize}
            totalItems={totalLogs}
            label={copy('entries', 'entries', 'កំណត់ត្រា')}
            t={t}
            pageSizeOptions={[20, 50, 100, 200]}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(1)
            }}
          />
        )}
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

      <div className="card hidden flex-col overflow-hidden sm:flex sm:h-[calc(100vh-18rem)] sm:min-h-[28rem] sm:max-h-[42rem]">
        <div className="relative min-h-0 flex-1 overflow-auto px-2 pt-2.5">
          <table className="w-full min-w-[860px] table-fixed text-sm table-bordered">
            {desktopColGroup}
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="w-10 px-3 py-3">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    className="h-4 w-4 rounded"
                    checked={visibleIds.length > 0 && selectedIds.size === visibleIds.length}
                    onChange={(event) => toggleSelectAll(event.target.checked)}
                    aria-label="Select all audit logs"
                  />
                </th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{copy('entry', 'Entry', 'លំដាប់')}</th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">Entity</th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('user') || 'User'}</th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('action') || 'Action'}</th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('device') || 'Device'}</th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('summary') || 'Summary'}</th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">{t('time') || 'Time'}</th>
              </tr>
            </thead>
            <tbody className={`divide-y divide-gray-100 dark:divide-gray-700/50 ${showDesktopLoadingOverlay ? 'invisible' : ''}`}>
              {!hasLoadedOnce ? (
                <tr><td colSpan={8} className="py-10 text-center text-gray-400">{t('loading') || 'Loading...'}</td></tr>
              ) : visibleLogs.length === 0 ? (
                <tr><td colSpan={8} className="py-10 text-center text-gray-400">{t('no_data') || 'No data'}</td></tr>
              ) : groupedSections.map((section) => {
                const isCollapsed = collapsedSections.has(section.id)
                return (
                <Fragment key={section.id}>
                  <tr className="bg-transparent">
                    <td colSpan={8} className="px-4 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/90 bg-slate-50/95 px-3 py-2 text-xs shadow-sm dark:border-slate-700/80 dark:bg-slate-800/70">
                        <label className="inline-flex min-w-0 items-center gap-2 font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded"
                            checked={isSelectionScopeFullySelected(section.ids)}
                            ref={(node) => {
                              if (node) node.indeterminate = isSelectionScopePartiallySelected(section.ids)
                            }}
                            onChange={(event) => toggleSelectionScope(section.ids, event.target.checked)}
                            aria-label={`Select ${section.label}`}
                          />
                          <span className="truncate">{section.label}</span>
                        </label>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500 shadow-sm dark:bg-slate-900/80 dark:text-slate-300">{section.ids.length}</span>
                          <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-white/80 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleSectionCollapsed(section.id)} aria-label={isCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}>
                            {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                  {!isCollapsed ? section.groups.map((group) => (
                    <Fragment key={group.id}>
                      {showActionGroups ? (
                        <tr className="bg-transparent">
                          <td colSpan={8} className="px-6 py-1.5">
                            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-white/90 px-3 py-1.5 text-xs dark:bg-slate-900/25">
                              <label className="inline-flex items-center gap-2 font-medium text-slate-600 dark:text-slate-300">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded"
                                  checked={isSelectionScopeFullySelected(group.ids)}
                                  ref={(node) => {
                                    if (node) node.indeterminate = isSelectionScopePartiallySelected(group.ids)
                                  }}
                                  onChange={(event) => toggleSelectionScope(group.ids, event.target.checked)}
                                  aria-label={`Select ${group.label}`}
                                />
                                <span>{group.label}</span>
                              </label>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-300">{group.items.length}</span>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                      {group.items.map((log) => (
                        <tr
                          key={log.id}
                          className="table-row cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/10"
                          onClick={() => setDetailLog(log)}
                        >
                          <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded"
                              checked={selectedIds.has(Number(log.id))}
                              onChange={() => toggleSelected(log.id)}
                              aria-label={`Select ${sessionEntryLabel(log)}`}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-xs font-semibold text-gray-500 dark:text-gray-300">{sessionEntryLabel(log)}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-xs font-medium text-gray-800 dark:text-gray-200">{formatEntityName(log)}</div>
                          </td>
                          <td className="px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">{log.user_name || '--'}</td>
                          <td className="px-3 py-2">
                            <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${actionColorClass(log.action)}`}>
                              {actionLabel(log.action)}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="max-w-[170px] truncate text-xs text-gray-700 dark:text-gray-300" title={log.device_name || ''}>
                              {log.device_name || '--'}
                            </div>
                            <div className="text-xs font-mono text-blue-500 dark:text-blue-400">{log.device_tz || '--'}</div>
                          </td>
                          <td className="max-w-[220px] px-3 py-2 text-xs text-gray-500 dark:text-gray-400 truncate">
                            {readableSummary(log) || <span className="italic text-gray-300">{t('click_for_details') || 'Click to view'}</span>}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-400">{formatLogTime(log)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  )) : null}
                </Fragment>
              )})}
            </tbody>
          </table>
          {showDesktopLoadingOverlay ? (
            <div className="pointer-events-none absolute inset-x-0 top-[3.125rem] bottom-0 z-20 overflow-hidden border-t border-slate-200/80 bg-white/80 backdrop-blur-[1px] dark:border-slate-700/80 dark:bg-slate-950/78">
              <div className="min-h-[26rem] animate-pulse bg-white/95 px-4 py-4 dark:bg-slate-950/80">
                <div className="rounded-xl border border-slate-200/90 bg-slate-50/85 p-3 dark:border-slate-700/80 dark:bg-slate-900/70">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded bg-slate-200 dark:bg-slate-700" />
                      <div className="h-4 w-32 rounded bg-slate-200 dark:bg-slate-700" />
                    </div>
                    <div className="h-7 w-20 rounded-lg bg-slate-200 dark:bg-slate-700" />
                  </div>
                </div>
                <div className="mt-4 space-y-4">
                  {Array.from({ length: 4 }, (_, index) => (
                    <div key={`audit-shell-${index}`} className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="flex items-center gap-3">
                            <div className="h-4 w-20 rounded bg-slate-200 dark:bg-slate-700" />
                            <div className="h-5 w-20 rounded-full bg-slate-100 dark:bg-slate-800" />
                            <div className="h-4 w-24 rounded bg-slate-100 dark:bg-slate-800" />
                          </div>
                          <div className="h-3 w-40 rounded bg-slate-100 dark:bg-slate-800" />
                          <div className="grid grid-cols-[1.2fr_0.9fr_1.3fr] gap-3">
                            <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800" />
                            <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800" />
                            <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800" />
                          </div>
                        </div>
                        <div className="h-4 w-28 rounded bg-slate-100 dark:bg-slate-800" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400 dark:border-gray-700">
          <span>{visibleLogs.length} / {totalLogs || visibleLogs.length} {copy('entries', 'entries', 'កំណត់ត្រា')}</span>
        </div>
      </div>

      <div className="relative min-h-[32rem] space-y-2 sm:hidden">
        {loading && !hasLoadedOnce ? (
          <div className="space-y-2">
            {skeletonRows.slice(0, 6).map((row) => (
              <div key={`audit-mobile-skeleton-${row}`} className="card animate-pulse p-3">
                <div className="space-y-2">
                  <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="h-3 w-1/2 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="h-3 w-2/3 rounded bg-slate-100 dark:bg-slate-800" />
                </div>
              </div>
            ))}
          </div>
        ) : !hasLoadedOnce ? (
          <div className="py-10 text-center text-gray-400">{t('loading') || 'Loading...'}</div>
        ) : visibleLogs.length === 0 ? (
          <div className="py-10 text-center text-gray-400">{t('no_data') || 'No data'}</div>
        ) : groupedSections.map((section) => {
          const isCollapsed = collapsedSections.has(section.id)
          return (
          <div key={section.id} className={`space-y-2 ${showMobileLoadingOverlay ? 'invisible' : ''}`}>
            <div className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
              <div className="flex items-center justify-between gap-3">
                <label className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded"
                    checked={isSelectionScopeFullySelected(section.ids)}
                    ref={(node) => {
                      if (node) node.indeterminate = isSelectionScopePartiallySelected(section.ids)
                    }}
                    onChange={(event) => toggleSelectionScope(section.ids, event.target.checked)}
                    aria-label={`Select ${section.label}`}
                  />
                  <span className="min-w-0 flex-1 truncate">{section.label}</span>
                  <span className="shrink-0 normal-case tracking-normal text-slate-400">{section.ids.length}</span>
                </label>
                <div className="flex items-center gap-1">
                  <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleSectionCollapsed(section.id)}>
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
            {!isCollapsed ? section.groups.map((group) => (
              <div key={group.id} className="space-y-2">
                {showActionGroups ? (
                  <div className="px-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <label className="inline-flex min-w-0 max-w-full items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded"
                        checked={isSelectionScopeFullySelected(group.ids)}
                        ref={(node) => {
                          if (node) node.indeterminate = isSelectionScopePartiallySelected(group.ids)
                        }}
                        onChange={(event) => toggleSelectionScope(group.ids, event.target.checked)}
                        aria-label={`Select ${group.label}`}
                      />
                      <span className="min-w-0 truncate">{group.label}</span>
                      <span className="shrink-0 text-slate-400">{group.items.length}</span>
                    </label>
                  </div>
                ) : null}
                {group.items.map((log) => (
                  <button
                    key={log.id}
                    type="button"
                    className="card w-full p-3 text-left active:bg-blue-50 dark:active:bg-blue-900/10"
                    onClick={() => setDetailLog(log)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-1 overflow-hidden text-[11px]">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded"
                            checked={selectedIds.has(Number(log.id))}
                            onChange={() => toggleSelected(log.id)}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`Select ${sessionEntryLabel(log)}`}
                          />
                          <span className="truncate font-semibold text-gray-700 dark:text-gray-200">{log.user_name || '--'}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${actionColorClass(log.action)}`}>
                            {actionLabel(log.action)}
                          </span>
                          <span className="truncate text-xs text-gray-500">{formatEntityName(log)}</span>
                          <span className="shrink-0 text-xs text-gray-400">{sessionEntryLabel(log)}</span>
                        </div>
                        {readableSummary(log) ? <div className="mt-1 text-xs text-gray-400 line-clamp-2">{readableSummary(log)}</div> : null}
                        <div className="mt-1 text-xs text-gray-400">{formatLogTime(log)}</div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-gray-300" />
                    </div>
                  </button>
                ))}
              </div>
            )) : null}
          </div>
        )})}
        {showMobileLoadingOverlay ? (
          <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-2xl bg-white/88 px-1 py-0.5 backdrop-blur-[1px] dark:bg-slate-950/80">
            <div className="space-y-2">
              {skeletonRows.slice(0, 4).map((row) => (
                <div key={`audit-mobile-overlay-${row}`} className="card animate-pulse p-3">
                  <div className="space-y-2">
                    <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-slate-700" />
                    <div className="h-3 w-1/2 rounded bg-slate-200 dark:bg-slate-700" />
                    <div className="h-3 w-2/3 rounded bg-slate-100 dark:bg-slate-800" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {detailLog ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setDetailLog(null)}>
          <div
            className="flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-lg sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${actionColorClass(detailLog.action)}`}>
                    {actionLabel(detailLog.action)}
                  </span>
                  <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">{formatEntityName(detailLog)}</span>
                </div>
                <div className="mt-1 text-xs font-semibold text-gray-400">{sessionEntryLabel(detailLog)}</div>
              </div>
              <button
                onClick={() => setDetailLog(null)}
                className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-3">
              <div className="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                <div className="flex items-start gap-2">
                  <Clock3 className="mt-0.5 h-4 w-4 text-blue-500" />
                  <div className="space-y-2">
                    <DetailRow label={t('client_time') || 'Client Time'} value={formatLogTime(detailLog)} />
                    <DetailRow label={t('server_time') || 'Server Time'} value={formatDateTime(detailLog.created_at)} />
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <MonitorSmartphone className="mt-0.5 h-4 w-4 text-blue-500" />
                  <div className="space-y-2">
                    <DetailRow label={t('device') || 'Device'} value={detailLog.device_name || '--'} />
                    <DetailRow label={t('timezone') || 'Timezone'} value={detailLog.device_tz || '--'} mono />
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <User2 className="mt-0.5 h-4 w-4 text-blue-500" />
                  <div className="space-y-2">
                    <DetailRow label={t('user') || 'User'} value={detailLog.user_name || '--'} />
                    <DetailRow label={t('action') || 'Action'} value={actionLabel(detailLog.action)} />
                    <DetailRow label={t('table') || 'Entity'} value={formatEntityName(detailLog)} />
                    <DetailRow label={copy('entry', 'Entry', 'លំដាប់')} value={sessionEntryLabel(detailLog)} />
                    <DetailRow label={t('summary') || 'Summary'} value={readableSummary(detailLog) || '--'} />
                  </div>
                </div>
              </div>

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
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
