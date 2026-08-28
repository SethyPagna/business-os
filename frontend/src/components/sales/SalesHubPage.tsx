import { Suspense, lazy, useState } from 'react'
import BadgeDollarSign from 'lucide-react/dist/esm/icons/badge-dollar-sign.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import HandCoins from 'lucide-react/dist/esm/icons/hand-coins.js'
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

type SalesHubAppContext = {
  t: (key: string, fallback?: string) => string
  getPermissionTier: (key: string) => string
}
const useApp = useAppHook as unknown as () => SalesHubAppContext

type SalesHubSection = 'sales' | 'returns' | 'fees'

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
  const canSales = getPermissionTier('sales') !== 'none'
  const canReturns = getPermissionTier('returns') !== 'none'
  const canFees = getPermissionTier('fees') !== 'none'
  const [section, setSection] = useState<SalesHubSection>(() => initialSection(canSales, canReturns, canFees))

  const tabs: Array<{ id: SalesHubSection; label: string; icon: typeof BadgeDollarSign; allowed: boolean; tone: string }> = [
    { id: 'sales', label: t('sales') || 'Sales', icon: BadgeDollarSign, allowed: canSales, tone: 'text-blue-600' },
    { id: 'returns', label: t('returns') || 'Returns', icon: RotateCcw, allowed: canReturns, tone: 'text-amber-600' },
    { id: 'fees', label: t('fees') || 'Fees', icon: HandCoins, allowed: canFees, tone: 'text-emerald-600' },
  ]
  const visibleTabs = tabs.filter((tab) => tab.allowed)

  return (
    <div className="space-y-3">
      {visibleTabs.length > 1 ? (
        <div className="px-4 pt-4">
          <div className="inline-flex rounded-xl bg-gray-100 dark:bg-gray-800 p-0.5">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSection(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 ${section === tab.id ? `bg-white dark:bg-gray-900 shadow ${tab.tone}` : 'text-gray-500'}`}
                >
                  <Icon className="w-4 h-4" /> {tab.label}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
      <Suspense fallback={<p className="p-4 text-sm text-gray-500">{t('loading') || 'Loading'}...</p>}>
        {section === 'returns' && canReturns ? <ReturnsSection />
          : section === 'fees' && canFees ? <FeesSection />
          : canSales ? <SalesSection />
          : canReturns ? <ReturnsSection />
          : <FeesSection />}
      </Suspense>
    </div>
  )
}
