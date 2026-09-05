// Reports hub -- the Sales hub's "Reports" section, redesigned (Part 581 ask:
// per-sale profit list, multiple views, excel style + receipt style for
// mobile, multiple calculation options).
//
// One control row drives every view, and since Part 586 it holds exactly
// four things: the search box · the View picker · the Start→End date/time
// range · one Filters menu. Everything that used to compete with the search
// box for that row -- a separate Filters fold, the Excel/Receipt style
// toggle, an Options button and an OverflowMenu -- is inside that one menu
// now (user: "make sure the search is shown, the various options into
// filtermenu"). Below the row exactly ONE view
// renders (Overview, By period, Sales list, Products, Customers, Cashiers,
// Payment methods, Hours, Days of week, Branches, Couriers, Returns,
// Expenses); each view is a ReportFrame with its own title-row actions,
// summary line, table/receipt body and drill-down folds. Every figure is a
// kernel figure (cloudflare/src/lib/salesAnalytics.ts): the views only
// arrange and present. Cost / profit never reach a non-admin (server-gated).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import Filter from 'lucide-react/dist/esm/icons/filter.js'
import SearchIcon from 'lucide-react/dist/esm/icons/search.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { makeReportMoneyFormatter } from '../../utils/reportMoney.ts'
import { useIsCompactViewport } from '../../utils/useViewport.ts'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect.tsx'
import DateTimeRangePicker, { todayDateTimeRange, type DateTimeRange } from '../shared/DateTimeRangePicker.tsx'
import { statsPresetRange } from '../shared/statsStripPresets.ts'
import { Button, ControlRow, EmptyState, IconButton } from '../shared/kit'
import { ALL_STATUSES, getStatusLabel } from './StatusBadge.tsx'
// Declares the `--ui-*` tokens the kit primitives read (they were ported onto
// this line without styles/tokens.css, so every one of them was undefined)
// plus this surface's density numbers and its Khmer line-box floor. See the
// long header in that file.
import './reports/reports-surface.css'
import { rangeSubtitle } from './reports/reportTypes.ts'
import ExpensesReport from './reports/ExpensesReport.tsx'
import GroupedReport from './reports/GroupedReport.tsx'
import OverviewReport from './reports/OverviewReport.tsx'
import PeriodReport from './reports/PeriodReport.tsx'
import ReportOptionsFold from './reports/ReportOptionsFold.tsx'
import ReturnsReport from './reports/ReturnsReport.tsx'
import SalesListReport from './reports/SalesListReport.tsx'
import CurrentShiftSummary from '../shifts/CurrentShiftSummary.tsx'
import ShiftHistoryPanel from '../shifts/ShiftHistoryPanel.tsx'
import {
  DEFAULT_REPORT_OPTIONS,
  REPORT_STORAGE_KEYS,
  defaultReportStyle,
  getReportView,
  isReportViewId,
  normalizeReportOptions,
  normalizeReportStyle,
  readStoredJson,
  resolveReportView,
  visibleReportViews,
  writeStoredJson,
  type ReportFilters,
  type ReportOptions,
  type ReportPermissions,
  type ReportStyle,
  type ReportViewId,
} from './reports/reportModel.ts'
import type { DrillPatch, ReportViewProps } from './reports/reportTypes.ts'

type ReportsHubAppUser = { username?: unknown; role_code?: unknown; permissions?: unknown } | null
type ReportsHubAppContext = {
  t: (key: string) => string | undefined
  fmtUSD: (value: number | string) => string
  fmtKHR: (value: number | string) => string
  khrToUsd: (value: unknown) => number
  usdToKhr: (value: unknown) => number
  displayCurrency: string
  getPermissionTier: (key: string) => string
  user: ReportsHubAppUser
  settings?: { pos_payment_methods?: unknown }
}
const useApp = useAppHook as unknown as () => ReportsHubAppContext

interface BranchOption { id: string; name: string }
// Retired methods still exist on old sales; they stay OUT of the filter list
// (same rule the old daily report applied).
const RETIRED_PAYMENT_METHODS = new Set(['pi pay', 'transfer'])
const PAYMENT_METHOD_FALLBACK = ['Cash', 'Card', 'ABA Bank', 'Wing', 'KHQR']
const SEARCH_DEBOUNCE_MS = 250

type MobileRangePreset = 'all' | 'today' | 'yesterday' | '7d' | '30d' | 'month'

export function mobilePresetRange(preset: MobileRangePreset, now?: Date): DateTimeRange {
  return statsPresetRange(preset, now)
}

export function activeMobilePreset(range: DateTimeRange, now?: Date): MobileRangePreset | null {
  for (const preset of ['all', 'today', 'yesterday', '7d', '30d', 'month'] as const) {
    const candidate = mobilePresetRange(preset, now)
    if (range.startDate === candidate.startDate && range.endDate === candidate.endDate) return preset
  }
  return null
}

/** The POS payment-method list from settings (JSON), retired methods dropped; the fallback when unset/malformed. */
export function parsePaymentMethods(raw: unknown): string[] {
  try {
    const parsed = typeof raw === 'string' ? (JSON.parse(raw || '[]') as unknown) : raw
    if (!Array.isArray(parsed)) return PAYMENT_METHOD_FALLBACK
    const seen = new Set<string>()
    const methods = parsed
      .map((m) => (typeof m === 'string' ? m : m && typeof m === 'object' ? String((m as { name?: unknown; label?: unknown; value?: unknown }).name ?? (m as { label?: unknown }).label ?? (m as { value?: unknown }).value ?? '') : ''))
      .map((m) => m.trim())
      .filter((m) => m && !RETIRED_PAYMENT_METHODS.has(m.toLowerCase()) && !seen.has(m.toLowerCase()) && !!seen.add(m.toLowerCase()))
    return methods.length ? methods : PAYMENT_METHOD_FALLBACK
  } catch {
    return PAYMENT_METHOD_FALLBACK
  }
}

export default function ReportsHub({ embedded = false }: { embedded?: boolean }) {
  const { t, fmtUSD, fmtKHR, khrToUsd, usdToKhr, displayCurrency, getPermissionTier, user, settings } = useApp()
  const trh = useCallback((key: string, fallback: string): string => { const v = t(key); return v && v !== key ? v : fallback }, [t])
  const tStr = useCallback((key: string): string => { const v = t(key); return v == null ? key : v }, [t])
  const compact = useIsCompactViewport()

  // Decorative only -- which hint text the export choice shows and whether
  // the Options fold offers the profit group. The real admin gate is
  // server-side (routes/reports.ts strips cost/profit for non-admins); a
  // stale read here can at most show the wrong HINT, never leak cost data.
  const isAdminHint = useMemo(() => {
    const roleCode = String(user?.role_code || '').toLowerCase()
    const username = String(user?.username || '').toLowerCase()
    let permissions: Record<string, unknown> = {}
    try {
      permissions = typeof user?.permissions === 'string'
        ? JSON.parse(user.permissions || '{}') as Record<string, unknown>
        : (user?.permissions && typeof user.permissions === 'object' ? user.permissions as Record<string, unknown> : {})
    } catch {
      permissions = {}
    }
    return username === 'admin' || roleCode === 'admin' || !!permissions.all
  }, [user])

  const canSales = getPermissionTier('sales') !== 'none'
  const canReturns = getPermissionTier('returns') !== 'none'
  const canFees = getPermissionTier('fees') !== 'none'
  const perms = useMemo<ReportPermissions>(() => ({ sales: canSales, returns: canReturns, fees: canFees }), [canSales, canReturns, canFees])
  const views = useMemo(() => visibleReportViews(perms), [perms])

  // ---- persisted choices (view, style, calculation options) ----
  const storage = typeof window !== 'undefined' ? window.localStorage : null
  const [viewId, setViewId] = useState<ReportViewId | null>(() => resolveReportView(readStoredJson(storage, REPORT_STORAGE_KEYS.view, (raw) => raw), perms))
  const [styleChoice, setStyleChoice] = useState<ReportStyle | null>(() => readStoredJson(storage, REPORT_STORAGE_KEYS.style, normalizeReportStyle))
  const [options, setOptions] = useState<ReportOptions>(() => readStoredJson(storage, REPORT_STORAGE_KEYS.options, normalizeReportOptions))
  const style: ReportStyle = styleChoice ?? defaultReportStyle(compact)
  useEffect(() => { setViewId((cur) => resolveReportView(cur, perms)) }, [perms])
  useEffect(() => { if (viewId) writeStoredJson(storage, REPORT_STORAGE_KEYS.view, viewId) }, [viewId, storage])
  useEffect(() => { if (styleChoice) writeStoredJson(storage, REPORT_STORAGE_KEYS.style, styleChoice) }, [styleChoice, storage])
  useEffect(() => { writeStoredJson(storage, REPORT_STORAGE_KEYS.options, options) }, [options, storage])
  const view = viewId ? getReportView(viewId) : null
  const supportsTime = !!view?.supportsTime
  const supportsSaleFilters = !!view?.supportsSaleFilters
  const supportsSearch = !!view?.supportsSearch
  const onOptionsChange = useCallback((patch: Partial<ReportOptions>) => setOptions((cur) => ({ ...cur, ...patch })), [])

  // ---- filters ----
  // An empty range left the Expenses report without an actionable initial
  // request. Today gives every report a concrete, business-time scope.
  const [range, setRange] = useState<DateTimeRange>(() => todayDateTimeRange())
  const [branchFilter, setBranchFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [branches, setBranches] = useState<BranchOption[]>([])
  useEffect(() => {
    const handle = window.setTimeout(() => setSearch(searchText.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [searchText])

  // Views without a clock are date-only ledgers. If a user narrows a sales
  // view to a time window and then switches, restore full-day bounds so no
  // hidden time filter survives while the 24-hour control is absent.
  useEffect(() => {
    if (supportsTime) return
    setRange((current) => current.startTime === '00:00' && current.endTime === '23:59'
      ? current
      : { ...current, startTime: '00:00', endTime: '23:59' })
  }, [supportsTime])

  useEffect(() => {
    let cancelled = false
    import('../../api/branchTransport.ts')
      .then((mod) => mod.getBranches())
      .then((res) => {
        if (cancelled) return
        const raw = Array.isArray(res) ? res : (res as { branches?: unknown[] } | null)?.branches
        const list = (Array.isArray(raw) ? raw : []).reduce<BranchOption[]>((acc, entry) => {
          const rec = entry as { id?: unknown; name?: unknown; branch_name?: unknown }
          const id = rec.id == null ? '' : String(rec.id)
          if (id) acc.push({ id, name: String(rec.name || rec.branch_name || id) })
          return acc
        }, [])
        setBranches(list)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const branchOptions = useMemo<AppSelectOption[]>(() => [
    { value: '', label: trh('all_branches', 'All Branches') },
    ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
  ], [branches, trh])
  const statusOptions = useMemo<AppSelectOption[]>(() => [
    { value: '', label: trh('all_statuses', 'All statuses') },
    ...ALL_STATUSES.map((status) => ({ value: status, label: getStatusLabel(status, tStr) })),
  ], [tStr, trh])
  const paymentOptions = useMemo<AppSelectOption[]>(() => {
    const methods = parsePaymentMethods(settings?.pos_payment_methods)
    // A filter picked through a drill-down (e.g. a legacy method) must stay selectable.
    if (paymentFilter && !methods.some((m) => m.toLowerCase() === paymentFilter.toLowerCase())) methods.push(paymentFilter)
    return [{ value: '', label: trh('all_payment_methods', 'All methods') }, ...methods.map((m) => ({ value: m, label: m }))]
  }, [settings?.pos_payment_methods, paymentFilter, trh])

  const filters = useMemo<ReportFilters>(() => ({
    startDate: range.startDate || '',
    endDate: range.endDate || '',
    startTime: range.startTime || '',
    endTime: range.endTime || '',
    branchId: branchFilter,
    status: statusFilter,
    paymentMethod: paymentFilter,
  }), [range, branchFilter, statusFilter, paymentFilter])
  const activeFilterCount = (branchFilter ? 1 : 0) + (supportsSaleFilters ? (statusFilter ? 1 : 0) + (paymentFilter ? 1 : 0) : 0)
  const clearFilters = () => { setBranchFilter(''); setStatusFilter(''); setPaymentFilter('') }

  // Display-only money formatter: the raw usd+khr amounts stay the single
  // source of truth; the Currency option only changes how they're shown.
  const fmtMoney = useMemo(
    () => makeReportMoneyFormatter({ displayCurrency: options.currency === 'setting' ? displayCurrency : options.currency, fmtUSD, fmtKHR, khrToUsd, usdToKhr }),
    [options.currency, displayCurrency, fmtUSD, fmtKHR, khrToUsd, usdToKhr],
  )
  const khrToUsdNum = useCallback((khr: number) => Number(khrToUsd(khr)) || 0, [khrToUsd])

  // ---- drill-downs from a view into the per-receipt list ----
  const onDrill = useCallback((patch: DrillPatch) => {
    if (patch.startDate || patch.endDate) setRange((cur) => ({ ...cur, startDate: patch.startDate ?? cur.startDate, endDate: patch.endDate ?? cur.endDate }))
    if (patch.search != null) { setSearchText(patch.search); setSearch(patch.search.trim()) }
    if (patch.paymentMethod != null) setPaymentFilter(patch.paymentMethod)
    if (patch.branchId != null) setBranchFilter(patch.branchId)
    if (patch.view) setViewId((cur) => resolveReportView(patch.view, perms) ?? cur)
  }, [perms])

  // ---- the one filter menu ----
  // Part 586 folded the former four control-row citizens (a Filters fold, a
  // style IconButton, an Options button and an OverflowMenu) into ONE menu,
  // so the row is just: search · view · range · Filters. That is what freed
  // the width the search box had been losing.
  const [optionsOpen, setOptionsOpen] = useState(false)
  // Compact tier only: after Show, the filter card folds to one line (view ·
  // range · Filters) with a handle, so the results start at the top of the
  // screen -- the old-POS reference (owner, Sep 5 2026, screenshots #3/#4:
  // the panel collapses behind a handle once SHOW is pressed). It opens
  // again from the handle, and stays open until the next Show.
  const [controlsFolded, setControlsFolded] = useState(false)
  const optionsAnchor = useRef<HTMLElement | null>(null)
  const branchId = branchFilter || undefined

  const searchInput = supportsSearch ? (
    <div className="relative min-w-0">
      <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ui-ink-3)]" aria-hidden="true" />
      <input
        type="search"
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        placeholder={trh('search', 'Search')}
        aria-label={trh('search', 'Search')}
        className="h-7 w-full rounded-[var(--ui-radius-sm)] border border-[var(--ui-line)] bg-[var(--ui-surface)] pl-7 pr-2 text-[length:var(--ui-size-body)] text-[var(--ui-ink)] placeholder:text-[var(--ui-ink-3)] focus:outline-none focus:ring-2 focus:ring-[var(--ui-focus)]"
      />
    </div>
  ) : null

  const viewPicker = (
    <AppSelect
      value={viewId || ''}
      options={views.map((v) => ({ value: v.id, label: trh(v.labelKey, v.fallback) }))}
      onChange={(value) => { if (isReportViewId(value)) setViewId(value) }}
      ariaLabel={trh('view', 'View')}
      buttonClassName={compact ? 'h-7 min-w-0 max-w-[10rem] py-0 px-2 text-[11px]' : 'min-h-10 min-w-[10rem] py-1 px-2 text-sm'}
      showChevron
    />
  )
  // The picker rides the SEARCH slot at every tier, not just when compact.
  // ControlRow always renders the search slot, so putting it here makes
  // "the picker is never dropped" structural instead of a per-tier rule --
  // and on the four views that have no text search it stops ControlRow's
  // `flex-1` search cell from collapsing to a dead gap that shoved the rest
  // of the row against the right edge.
  const searchSlot = (
    <div className="flex min-w-0 items-center gap-1.5">
      {searchInput ? <div className="min-w-[9rem] flex-1 sm:max-w-[22rem]">{searchInput}</div> : null}
      {viewPicker}
    </div>
  )

  const filterSelects = (
    <>
      {branches.length ? <AppSelect value={branchFilter} options={branchOptions} onChange={setBranchFilter} ariaLabel={trh('branch', 'Branch')} buttonClassName="h-7 w-full py-0 px-2 text-[11px]" showChevron /> : null}
      {supportsSaleFilters ? <AppSelect value={statusFilter} options={statusOptions} onChange={setStatusFilter} ariaLabel={trh('status', 'Status')} buttonClassName="h-7 w-full py-0 px-2 text-[11px]" showChevron /> : null}
      {supportsSaleFilters ? <AppSelect value={paymentFilter} options={paymentOptions} onChange={setPaymentFilter} ariaLabel={trh('payment_method', 'Payment method')} buttonClassName="h-7 w-full py-0 px-2 text-[11px]" showChevron /> : null}
    </>
  )
  const hasFilterControls = branches.length > 0 || supportsSaleFilters
  const optionsAreDefault = JSON.stringify({ ...options, granularity: 'day' }) === JSON.stringify({ ...DEFAULT_REPORT_OPTIONS, granularity: 'day' })
  // The badge counts everything the menu now owns, so a person can see at a
  // glance that a non-default basis/currency is in force without opening it.
  const menuCount = activeFilterCount + (optionsAreDefault ? 0 : 1)
  const filtersLabel = `${trh('filters', 'Filters')}${menuCount ? ` · ${menuCount}` : ''}`
  const filtersButton = (
    <span ref={(el) => { optionsAnchor.current = el }}>
      {compact ? (
        <IconButton
          label={filtersLabel}
          icon={<Filter className="h-3.5 w-3.5" />}
          variant={menuCount ? 'primary' : 'secondary'}
          onClick={() => setOptionsOpen((o) => !o)}
        />
      ) : (
        <Button size="sm" variant={menuCount ? 'primary' : 'secondary'} icon={<Filter className="h-3.5 w-3.5" />} onClick={() => setOptionsOpen((o) => !o)}>
          {filtersLabel}
        </Button>
      )}
    </span>
  )

  const viewProps: ReportViewProps | null = view ? {
    view,
    filters,
    search: supportsSearch ? search : '',
    options,
    style,
    fmtMoney,
    khrToUsd: khrToUsdNum,
    tr: trh,
    t: tStr,
    perms,
    compact,
    onDrill,
    onOptionsChange,
  } : null

  // One tail for every tier: the menu is the ONLY thing that can move, and it
  // never disappears. The view picker is not here -- it lives in the search
  // slot, which ControlRow renders at all three tiers.
  const collapsedTail = <>{filtersButton}</>

  const mobilePresets: Array<{ id: MobileRangePreset; label: string }> = [
    { id: 'all', label: trh('all_time', 'All time') },
    { id: 'today', label: trh('today', 'Today') },
    { id: 'yesterday', label: trh('yesterday', 'Yesterday') },
    { id: '7d', label: trh('last_7_days', 'Last 7 Days') },
    { id: '30d', label: trh('last_30_days', 'Last 30 Days') },
    { id: 'month', label: trh('this_month', 'This month') },
  ]
  const selectedMobilePreset = activeMobilePreset(range)
  const rangePicker = (
    <DateTimeRangePicker
      value={range}
      onChange={setRange}
      t={t}
      showTime={supportsTime}
      continuous
      showCalendarIcon={false}
      triggerClassName={compact ? 'reports-mobile-range flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-2' : undefined}
    />
  )

  const presetControls = (
    <div className="reports-mobile-presets" aria-label={trh('quick_range', 'Quick range')}>
      {mobilePresets.map((preset) => (
        <button key={preset.id} type="button" className="reports-mobile-preset"
          aria-pressed={selectedMobilePreset === preset.id}
          onClick={() => setRange(mobilePresetRange(preset.id))}>
          {preset.label}
        </button>
      ))}
    </div>
  )

  const body = !viewProps || !view ? (
    <EmptyState icon={<BarChart3 className="h-5 w-5" />} title={trh('reports', 'Reports')} text={trh('rpt_no_access', 'No report is available for your permissions.')} />
  ) : view.id === 'overview' ? <OverviewReport {...viewProps} />
    : view.id === 'periods' ? <PeriodReport {...viewProps} />
      : view.id === 'sales' ? <SalesListReport {...viewProps} />
        : view.id === 'returns' ? <ReturnsReport {...viewProps} />
          : view.id === 'expenses' ? <ExpensesReport {...viewProps} />
            : <GroupedReport key={view.id} {...viewProps} />

  // One line standing in for the folded card: what is showing, for which
  // range, and the Filters button (which also keeps the options fold's
  // anchor mounted). The whole line is the handle.
  const foldedControls = (
    <section className="reports-mobile-controls" aria-label={trh('filters', 'Report filters')}>
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={false}
          aria-label={trh('show_filters', 'Show filters')}
          onClick={() => setControlsFolded(false)}
        >
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--ui-ink-3)]" />
          <span className="min-w-0 truncate text-[length:var(--ui-size-body)] font-medium">{view ? trh(view.labelKey, view.fallback) : trh('reports', 'Reports')}</span>
          <span className="min-w-0 truncate text-[length:var(--ui-size-meta)] text-[var(--ui-ink-2)]">{rangeSubtitle(filters, trh)}</span>
        </button>
        {filtersButton}
      </div>
    </section>
  )

  return (
    <div className={embedded ? 'space-y-2' : 'space-y-2 p-2 sm:p-3'} data-reports-hub>
      {compact ? (controlsFolded ? foldedControls : (
        <section className="reports-mobile-controls" aria-label={trh('filters', 'Report filters')}>
          {searchInput}
          <div className="reports-mobile-primary">{viewPicker}{rangePicker}</div>
          {presetControls}
          <div className="reports-mobile-actions">
            {filtersButton}
            <Button className="reports-mobile-show" onClick={() => { setSearch(searchText.trim()); setOptionsOpen(false); setControlsFolded(true) }}>
              {trh('show', 'Show')}
            </Button>
          </div>
        </section>
      )) : (
        <div className="reports-desktop-controls">
          <ControlRow className="reports-desktop-primary" sticky search={searchSlot} range={rangePicker} filters={null} actions={collapsedTail} overflow={collapsedTail} />
          {presetControls}
        </div>
      )}

      {body}

      {/* Shift blocks sit BELOW the report (reference: filters first, results
          second, nothing above the filters). Same two components as before. */}
      <CurrentShiftSummary showHistory={false} />
      <section className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900" aria-label={trh('shift_history', 'Shift history')}>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{trh('shift_history', 'Shift history')}</h2>
          <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">{trh('shift_history_all', 'Authorized shop history')}</p>
        </div>
        <ShiftHistoryPanel compact limit={50} />
      </section>

      <ReportOptionsFold
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        anchorRef={optionsAnchor}
        options={options}
        onChange={onOptionsChange}
        onReset={() => { clearFilters(); setOptions({ ...DEFAULT_REPORT_OPTIONS, granularity: options.granularity }) }}
        tr={trh}
        showProfit={isAdminHint}
        showExpenses={canFees}
        filterControls={hasFilterControls ? filterSelects : null}
        style={style}
        onStyleChange={setStyleChoice}
        resetDisabled={!menuCount}
      />

    </div>
  )
}
