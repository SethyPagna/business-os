import { Suspense, lazy, useEffect, useState } from 'react'
import Building2 from 'lucide-react/dist/esm/icons/building-2.js'
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left.js'
import Radio from 'lucide-react/dist/esm/icons/radio.js'
import Package from 'lucide-react/dist/esm/icons/package.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { useIsPageActive } from '../shared/pageActivity'
import type { DateTimeRange } from '../shared/DateTimeRangePicker.tsx'

// Branches is one hub with one navigation layer. Overview owns branch cards;
// Products owns the ranged product/COGS/revenue/profit summary; Transfer owns
// transfer history (the complete movement ledger lives in Products -> Stock Changes).
const BranchesSection = lazy(() => import('./Branches'))
const InventorySection = lazy(() => import('../inventory/Inventory.tsx'))

type BranchesHubAppContext = {
  t: (key: string, fallback?: string) => string
  getPermissionTier: (key: string) => string
  navigateTo: (pageId: string) => void
}
const useApp = useAppHook as unknown as () => BranchesHubAppContext

type BranchesHubSection = 'overview' | 'products' | 'transfers' | 'rfid'
type DashboardFocusSection = 'products' | 'movements' | 'rfid' | ''

const DASHBOARD_INVENTORY_FOCUS_KEY = 'bos:dashboard:inventory-focus'

function peekDashboardFocusSection(): DashboardFocusSection {
  try {
    const raw = window.sessionStorage.getItem(DASHBOARD_INVENTORY_FOCUS_KEY)
    if (!raw) return ''
    const payload = JSON.parse(raw) as { section?: unknown }
    const section = String(payload?.section || '')
    return section === 'products' || section === 'movements' || section === 'rfid' ? section : ''
  } catch {
    return ''
  }
}

function initialSection(canBranchList: boolean, canInventory: boolean): BranchesHubSection {
  if (typeof window !== 'undefined') {
    const focus = peekDashboardFocusSection()
    if (focus === 'rfid' && canInventory) return 'rfid'
    // Historical Dashboard movement drills now land on the one authoritative
    // ledger in Products instead of reopening the retired Inventory ledger.
    if (focus === 'movements' && canInventory) return 'products'
  }
  return canBranchList ? 'overview' : 'products'
}

export default function BranchesHubPage() {
  const { t, getPermissionTier, navigateTo } = useApp()
  const trh = (key: string, fallback: string): string => { const value = t(key); return value && value !== key ? value : fallback }
  const canBranchList = getPermissionTier('branches') !== 'none'
  const canInventory = getPermissionTier('inventory') !== 'none'
  const [section, setSection] = useState<BranchesHubSection>(() => initialSection(canBranchList, canInventory))
  // The hub owns one range. Product stats and Transfer History receive the
  // exact same controlled value after a section switch.
  const [sharedDateRange, setSharedDateRange] = useState<DateTimeRange>(() => ({
    startDate: '',
    endDate: '',
    startTime: '',
    endTime: '',
  }))
  const isActive = useIsPageActive('branches')

  useEffect(() => {
    if (!isActive || typeof window === 'undefined') return
    const raw = window.sessionStorage.getItem(DASHBOARD_INVENTORY_FOCUS_KEY)
    if (!raw) return
    let payload: { section?: unknown; stockFilter?: unknown } = {}
    try {
      payload = JSON.parse(raw) as { section?: unknown; stockFilter?: unknown }
    } catch {
      window.sessionStorage.removeItem(DASHBOARD_INVENTORY_FOCUS_KEY)
      return
    }
    window.sessionStorage.removeItem(DASHBOARD_INVENTORY_FOCUS_KEY)
    const focus = String(payload?.section || '')
    if (focus === 'products') {
      try {
        window.sessionStorage.setItem('bos:dashboard:products-focus', JSON.stringify({ stockFilter: payload?.stockFilter }))
      } catch { /* storage unavailable: navigate without the optional filter */ }
      navigateTo('products')
      return
    }
    if (focus === 'movements') navigateTo('products')
    else if (focus === 'rfid' && canInventory) setSection('rfid')
    else setSection('overview')
  }, [canBranchList, canInventory, isActive, navigateTo])

  const tabs: Array<{ id: BranchesHubSection; label: string; icon: typeof Building2; allowed: boolean; tone: string }> = [
    { id: 'overview', label: trh('overview', 'Overview'), icon: Building2, allowed: canBranchList, tone: 'text-sky-600' },
    { id: 'products', label: trh('products', 'Products'), icon: Package, allowed: canInventory, tone: 'text-emerald-600' },
    { id: 'transfers', label: trh('transfer', 'Transfer'), icon: ArrowRightLeft, allowed: canBranchList, tone: 'text-violet-600' },
    { id: 'rfid', label: 'RFID', icon: Radio, allowed: canInventory, tone: 'text-emerald-600' },
  ]
  const visibleTabs = tabs.filter((tab) => tab.allowed)
  const active = visibleTabs.some((tab) => tab.id === section) ? section : (visibleTabs[0]?.id || 'overview')

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-2">
      {visibleTabs.length > 1 ? (
        <div className="min-w-0 shrink-0 px-3 pt-3 sm:px-4 sm:pt-4">
          <div className="inline-flex max-w-full overflow-x-auto overscroll-x-contain rounded-xl bg-gray-100 p-0.5 [touch-action:pan-x] dark:bg-gray-800">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSection(tab.id)}
                  aria-pressed={active === tab.id}
                  className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-semibold sm:text-sm ${active === tab.id ? `bg-white shadow dark:bg-gray-900 ${tab.tone}` : 'text-gray-500'}`}
                >
                  <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> {tab.label}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      <Suspense fallback={<p className="p-4 text-sm text-gray-500">{trh('loading', 'Loading')}...</p>}>
        {active === 'overview' ? (
          <div className="page-scroll flex min-h-0 flex-1 flex-col">
            {canBranchList ? (
              <BranchesSection
                embedded
                view="branches"
                showSectionNavigation={false}
                dateRange={sharedDateRange}
                onDateRangeChange={setSharedDateRange}
                showDateRange
              />
            ) : null}
          </div>
        ) : active === 'products' && canInventory ? (
          <div className="page-scroll flex min-h-0 flex-1 flex-col">
            <InventorySection
              hostSection="stats"
              embedded
              dateRange={sharedDateRange}
              onDateRangeChange={setSharedDateRange}
            />
          </div>
        ) : active === 'transfers' && canBranchList ? (
          <div className="page-scroll flex min-h-0 flex-1 flex-col">
            <BranchesSection
              embedded
              view="transfers"
              showSectionNavigation={false}
              dateRange={sharedDateRange}
              onDateRangeChange={setSharedDateRange}
              showDateRange
            />
          </div>
        ) : canInventory ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <InventorySection hostSection="rfid" />
          </div>
        ) : null}
      </Suspense>
    </div>
  )
}
