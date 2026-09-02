import { Suspense, lazy, useState } from 'react'
import BadgeDollarSign from 'lucide-react/dist/esm/icons/badge-dollar-sign.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import HandCoins from 'lucide-react/dist/esm/icons/hand-coins.js'
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3.js'
import { useApp as useAppHook } from '../../AppContext.tsx'

// E2 (Part 407): Sales absorbs Returns and Fees as sections of one Sales
// page -- the same hub pattern E3/E4 established (ReviewLogsPage /
// SettingsHubPage). Pure rewiring per the Phase-E contract: all three
// section components move intact with their own permission keys
// ('sales' / 'returns' / 'fees'); only the standalone returns/fees PAGE
// ids retire, and their old URLs land here with the right section open.

const SalesSection = lazy(() => import('./Sales'))
const ReturnsSection = lazy(() => import('../returns/Returns'))
const FeesSection = lazy(() => import('../fees/FeesPage.tsx'))
// The Reports hub (Aug 29): a top-level section running any combination of
// the Sales / Returns / Fees reports over one shared range. Shown to anyone
// who can see at least one of those areas.
const ReportsSection = lazy(() => import('./ReportsHub'))

type SalesHubAppContext = {
  t: (key: string, fallback?: string) => string
  getPermissionTier: (key: string) => string
}
const useApp = useAppHook as unknown as () => SalesHubAppContext

type SalesHubSection = 'sales' | 'returns' | 'fees' | 'reports'

function initialSection(canSales: boolean, canReturns: boolean, canFees: boolean): SalesHubSection {
  // Deep link: the old standalone URLs keep meaning what they said.
  if (typeof window !== 'undefined') {
    const segment = String(window.location.pathname || '').toLowerCase()
    if (segment.includes('return') && canReturns) return 'returns'
    if (segment.includes('fee') && canFees) return 'fees'
  }
  if (canSales) return 'sales'
  if (canReturns) return 'returns'
  return 'fees'
}

export default function SalesHubPage() {
  const { t, getPermissionTier } = useApp()
  // t() returns the KEY on a miss (stale/failed pack) -- guard so chips fall back to readable English, never snake_case keys.
  const trh = (key: string, fallback: string): string => { const v = t(key); return v && v !== key ? v : fallback }
  const canSales = getPermissionTier('sales') !== 'none'
  const canReturns = getPermissionTier('returns') !== 'none'
  const canFees = getPermissionTier('fees') !== 'none'
  // Reports draws on all three areas, so anyone who can see any one of them
  // gets the tab (the hub then only offers the report types they can view).
  const canReports = canSales || canReturns || canFees
  const [section, setSection] = useState<SalesHubSection>(() => initialSection(canSales, canReturns, canFees))

  const tabs: Array<{ id: SalesHubSection; label: string; icon: typeof BadgeDollarSign; allowed: boolean; tone: string }> = [
    { id: 'sales', label: trh('sales', 'Sales'), icon: BadgeDollarSign, allowed: canSales, tone: 'text-blue-600' },
    { id: 'returns', label: trh('returns', 'Returns'), icon: RotateCcw, allowed: canReturns, tone: 'text-amber-600' },
    { id: 'fees', label: trh('fees', 'Expenses'), icon: HandCoins, allowed: canFees, tone: 'text-emerald-600' },
    { id: 'reports', label: trh('reports', 'Reports'), icon: BarChart3, allowed: canReports, tone: 'text-indigo-600' },
  ]
  const visibleTabs = tabs.filter((tab) => tab.allowed)

  return (
    // One scroll root for the hub. The hosted sections render into this page
    // instead of owning fixed-height nested scrollers, so their lists grow to
    // fit their content and the whole Sales page scrolls naturally.
    <div className="page-scroll flex min-h-0 min-w-0 flex-col">
      {visibleTabs.length > 1 ? (
        // iPhone standalone mode receives the same complete section row as
        // Android. Labels may use a second line inside their equal cell; none
        // are ellipsized or pushed beyond the viewport.
        <div className="shrink-0 px-2 pt-3 sm:px-3 sm:pt-5">
          <div className="grid w-full rounded-xl bg-gray-100 p-0.5 dark:bg-gray-800" style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }}>
            {visibleTabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSection(tab.id)}
                  className={`inline-flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[10px] font-medium sm:min-h-0 sm:flex-row sm:gap-1 sm:px-1.5 sm:py-1.5 sm:text-sm ${section === tab.id ? `bg-white dark:bg-gray-900 shadow ${tab.tone}` : 'text-gray-500'}`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" /> <span className="min-w-0 break-words text-center leading-tight">{tab.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
      <Suspense fallback={<p className="p-4 text-sm text-gray-500">{trh('loading', 'Loading')}...</p>}>
        {section === 'returns' && canReturns ? <ReturnsSection embedded />
          : section === 'fees' && canFees ? <FeesSection embedded />
          : section === 'reports' && canReports ? <ReportsSection embedded />
          : canSales ? <SalesSection embedded />
          : canReturns ? <ReturnsSection embedded />
          : <FeesSection embedded />}
      </Suspense>
    </div>
  )
}
