import { useEffect, useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import BadgeDollarSign from 'lucide-react/dist/esm/icons/badge-dollar-sign.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import HandCoins from 'lucide-react/dist/esm/icons/hand-coins.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import DateTimeRangePicker, { EMPTY_DATE_TIME_RANGE, type DateTimeRange } from '../shared/DateTimeRangePicker.tsx'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect.tsx'
import SalesDailyReport from './SalesDailyReport'
import ReturnsReportSection from './ReturnsReportSection'
import FeesReportSection from './FeesReportSection'

// Reports hub -- a top-level Sales-hub section (a chip beside Sales/Returns/
// Fees). One shared date range + branch scope drives any combination of the
// Sales / Returns / Fees reports, shown side by side (the user picks which
// types to include). Each type only renders for a user who can see it.

type ReportsHubAppContext = {
  t: (key: string) => string | undefined
  fmtUSD: (value: number | string) => string
  fmtKHR: (value: number | string) => string
  getPermissionTier: (key: string) => string
}
const useApp = useAppHook as unknown as () => ReportsHubAppContext

interface BranchOption { id: string; name: string }
type ReportType = 'sales' | 'returns' | 'fees'

function monthStartIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export default function ReportsHub() {
  const { t, fmtUSD, fmtKHR, getPermissionTier } = useApp()
  const trh = (key: string, fallback: string): string => { const v = t(key); return v && v !== key ? v : fallback }

  const canSales = getPermissionTier('sales') !== 'none'
  const canReturns = getPermissionTier('returns') !== 'none'
  const canFees = getPermissionTier('fees') !== 'none'

  const available = useMemo<Array<{ id: ReportType; label: string; icon: ComponentType<{ className?: string }> }>>(() => ([
    canSales ? { id: 'sales' as const, label: trh('sales', 'Sales'), icon: BadgeDollarSign } : null,
    canReturns ? { id: 'returns' as const, label: trh('returns', 'Returns'), icon: RotateCcw } : null,
    canFees ? { id: 'fees' as const, label: trh('fees', 'Fees'), icon: HandCoins } : null,
  ].filter(Boolean) as Array<{ id: ReportType; label: string; icon: ComponentType<{ className?: string }> }>), [canSales, canReturns, canFees, t]) // eslint-disable-line react-hooks/exhaustive-deps

  const [range, setRange] = useState<DateTimeRange>(() => ({ ...EMPTY_DATE_TIME_RANGE, startDate: monthStartIso(), endDate: todayIso() }))
  const [branchFilter, setBranchFilter] = useState('')
  const [branches, setBranches] = useState<BranchOption[]>([])
  // SINGLE-select with an explicit "All" chip (user, Aug 30: "instead of
  // selecting all just make an additional 'All' so it is not multi select
  // but single for the report's options").
  const [selectedType, setSelectedType] = useState<'all' | ReportType>('all')

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
  ], [branches]) // eslint-disable-line react-hooks/exhaustive-deps

  const branchId = branchFilter || undefined
  const visible = selectedType === 'all' ? available : available.filter((entry) => entry.id === selectedType)
  const typeChips: Array<{ id: 'all' | ReportType; label: string; icon?: ComponentType<{ className?: string }> }> = [
    { id: 'all', label: trh('all', 'All') },
    ...available,
  ]

  return (
    <div className="page-scroll flex flex-col space-y-3 p-3 sm:p-6">
      {/* ONE shared control row: range + type chips + branch — the branch
          select rides the same row and ellipsizes long names ("branch
          option can be merged into one row with option, and use '…' when
          too long"). */}
      {/* Two tidy rows: the date range on its own, then the type chips with
          the branch select riding the SAME row (user, Aug 31: "the all
          branches can be merged into sections so one row") — previously the
          branch select wrapped to a third line of its own. */}
      <div className="sticky top-0 z-20 -mx-1 space-y-1.5 bg-gray-50/95 px-1 py-1 backdrop-blur dark:bg-gray-900/95">
        <DateTimeRangePicker value={range} onChange={setRange} t={t} />
        <div className="flex flex-wrap items-center gap-1">
          {typeChips.map(({ id, label, icon: Icon }) => {
            const on = selectedType === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSelectedType(id)}
                aria-pressed={on}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition ${on
                  ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'}`}
              >
                {Icon ? <Icon className="h-3.5 w-3.5" /> : null} {label}
              </button>
            )
          })}
          {branches.length ? (
            <AppSelect
              value={branchFilter}
              options={branchOptions}
              onChange={setBranchFilter}
              ariaLabel={trh('branch', 'Branch')}
              buttonClassName="ml-auto max-w-[9rem] truncate py-1 text-xs"
            />
          ) : null}
        </div>
      </div>

      {visible.map(({ id, label, icon: Icon }) => {
        // The section's own controls (Sales' status/method selects, Returns/
        // Fees' breakdown chips) ride THIS title row (user, Aug 31: "the
        // sales, returns and fees, sections the card title ... can be moved
        // to title row") — each section component places its controls
        // ml-auto beside the title node and drops the totals to a line
        // below. ReportsHub no longer renders a standalone title row.
        const titleNode = <><Icon className="h-4 w-4 shrink-0" /> {label}</>
        // De-carded (user, Aug 30: inner wraps keep top/bottom hairlines,
        // drop the side border + padding so content gets the full width).
        return (
          <section key={id} className="space-y-2 border-y border-slate-200 py-2.5 dark:border-slate-800">
            {id === 'sales' ? (
              <SalesDailyReport t={t} fmtUSD={fmtUSD} range={range} onRangeChange={setRange} branchId={branchId} embedded active titleNode={titleNode} />
            ) : id === 'returns' ? (
              <ReturnsReportSection t={t} fmtUSD={fmtUSD} fmtKHR={fmtKHR} range={range} branchId={branchId} active titleNode={titleNode} />
            ) : (
              <FeesReportSection t={t} fmtUSD={fmtUSD} fmtKHR={fmtKHR} range={range} branchId={branchId} active titleNode={titleNode} />
            )}
          </section>
        )
      })}
    </div>
  )
}
