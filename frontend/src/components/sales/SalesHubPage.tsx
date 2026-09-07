import { getHubDestinations, useHubSection } from '../shared/hubNavigation.ts'
import { Suspense, lazy } from 'react'
import BadgeDollarSign from 'lucide-react/dist/esm/icons/badge-dollar-sign.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import HandCoins from 'lucide-react/dist/esm/icons/hand-coins.js'
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import HubSectionNav, { type HubSectionDef, readStoredHubSection } from '../shared/HubSectionNav.tsx'

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
  navigateTo: (pageId: string, anchor?: string) => void
  hasPermission: (key: string) => boolean
  t: (key: string, fallback?: string) => string
  getPermissionTier: (key: string) => string
}
const useApp = useAppHook as unknown as () => SalesHubAppContext

type SalesHubSection = 'sales' | 'returns' | 'fees' | 'reports'

const SALES_HUB_STORAGE_KEY = 'bos:hub:sales:active'

function initialSection(canSales: boolean, canReturns: boolean, canFees: boolean): SalesHubSection {
  // Old standalone URLs retain their section; the shared hook also resolves hub anchors.
  if (typeof window !== 'undefined') {
    const segment = String(window.location.pathname || '').toLowerCase()
    if (segment.includes('return') && canReturns) return 'returns'
    if (segment.includes('fee') && canFees) return 'fees'
  }
  const validIds = (['sales', 'returns', 'fees', 'reports'] as SalesHubSection[]).filter((id) =>
    (id === 'sales' && canSales) || (id === 'returns' && canReturns) || (id === 'fees' && canFees) || (id === 'reports' && (canSales || canReturns || canFees)))
  const stored = readStoredHubSection(SALES_HUB_STORAGE_KEY, validIds) as SalesHubSection | null
  if (stored) return stored
  if (canSales) return 'sales'
  if (canReturns) return 'returns'
  return 'fees'
}

export default function SalesHubPage() {
  const { t, getPermissionTier, hasPermission, navigateTo } = useApp()
  // t() returns the KEY on a miss (stale/failed pack) -- guard so chips fall back to readable English, never snake_case keys.
  const trh = (key: string, fallback: string): string => { const v = t(key); return v && v !== key ? v : fallback }
  const canSales = getPermissionTier('sales') !== 'none'
  const canReturns = getPermissionTier('returns') !== 'none'
  const canFees = getPermissionTier('fees') !== 'none'
  // Reports draws on all three areas, so anyone who can see any one of them
  // gets the tab (the hub then only offers the report types they can view).
  const canReports = canSales || canReturns || canFees
  const [section, setSection] = useHubSection<SalesHubSection>('sales', () => initialSection(canSales, canReturns, canFees), getHubDestinations('sales', { getPermissionTier, hasPermission }).map((item) => item.id), navigateTo)

  const tabs: HubSectionDef[] = [
    { id: 'sales', label: trh('sales', 'Sales'), icon: BadgeDollarSign, hidden: !canSales, description: trh('hub_desc_sales_sales', 'Ring up and record sales') },
    { id: 'returns', label: trh('returns', 'Returns'), icon: RotateCcw, hidden: !canReturns, description: trh('hub_desc_sales_returns', 'Process customer returns') },
    { id: 'fees', label: trh('fees', 'Expenses'), icon: HandCoins, hidden: !canFees, description: trh('hub_desc_sales_fees', 'Track business expenses') },
    { id: 'reports', label: trh('reports', 'Reports'), icon: BarChart3, hidden: !canReports, description: trh('hub_desc_sales_reports', 'Sales, returns and expense reports') },
  ]

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <HubSectionNav
        sections={tabs}
        active={section}
        onChange={(id) => setSection(id as SalesHubSection)}
        storageKey={SALES_HUB_STORAGE_KEY}
        pageId="sales"
      >
      {/* One scroll root for the hosted section. It renders straight into
          this page instead of owning a fixed-height nested scroller, so its
          list grows to fit its content and the whole thing scrolls naturally
          -- same contract as before, just page-scroll now lives here instead
          of on the hub's own outer element). */}
      <div className="page-scroll flex min-h-0 min-w-0 flex-1 flex-col">
        <Suspense fallback={<p className="p-4 text-sm text-gray-500">{trh('loading', 'Loading')}...</p>}>
          {section === 'returns' && canReturns ? <ReturnsSection embedded />
            : section === 'fees' && canFees ? <FeesSection embedded />
            : section === 'reports' && canReports ? <ReportsSection embedded />
            : canSales ? <SalesSection embedded />
            : canReturns ? <ReturnsSection embedded />
            : <FeesSection embedded />}
        </Suspense>
      </div>
      </HubSectionNav>
    </div>
  )
}
