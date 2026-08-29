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
  const { t, fmtUSD, getPermissionTier } = useApp()
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
  const [selected, setSelected] = useState<Set<ReportType>>(() => new Set(available.map((entry) => entry.id)))

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

  const toggleType = (id: ReportType) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const branchId = branchFilter || undefined
  const visible = available.filter((entry) => selected.has(entry.id))

  return (
    <div className="page-scroll flex flex-col space-y-3 p-3 sm:p-6">
      {/* Shared controls: one range + branch scope for every picked report. */}
      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 bg-gray-50/95 px-1 py-1 backdrop-blur dark:bg-gray-900/95">
        <DateTimeRangePicker value={range} onChange={setRange} t={t} />
        {branches.length ? (
          <AppSelect
            value={branchFilter}
            options={branchOptions}
            onChange={setBranchFilter}
            ariaLabel={trh('branch', 'Branch')}
            buttonClassName="py-1.5 text-xs"
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5">
          {available.map(({ id, label, icon: Icon }) => {
            const on = selected.has(id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleType(id)}
                aria-pressed={on}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${on
                  ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'}`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            )
          })}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400">{trh('reports_pick_type', 'Pick at least one report type above.')}</div>
      ) : null}

      {visible.map(({ id, label, icon: Icon }) => (
        <section key={id} className="space-y-2 rounded-xl border border-slate-200 bg-white/40 p-3 dark:border-slate-800 dark:bg-slate-900/20">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
            <Icon className="h-4 w-4" /> {label}
          </div>
          {id === 'sales' ? (
            <SalesDailyReport t={t} fmtUSD={fmtUSD} range={range} onRangeChange={setRange} branchId={branchId} embedded active />
          ) : id === 'returns' ? (
            <ReturnsReportSection t={t} fmtUSD={fmtUSD} range={range} branchId={branchId} active />
          ) : (
            <FeesReportSection t={t} fmtUSD={fmtUSD} range={range} branchId={branchId} active />
          )}
        </section>
      ))}
    </div>
  )
}
