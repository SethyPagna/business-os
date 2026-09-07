import { getHubDestinations, useHubSection } from '../shared/hubNavigation.ts'
import { Suspense, lazy, useEffect, useState } from 'react'
import Building2 from 'lucide-react/dist/esm/icons/building-2.js'
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left.js'
import Radio from 'lucide-react/dist/esm/icons/radio.js'
import Package from 'lucide-react/dist/esm/icons/package.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { useIsPageActive } from '../shared/pageActivity'
import HubSectionNav, { type HubSectionDef } from '../shared/HubSectionNav.tsx'
import type { DateTimeRange } from '../shared/DateTimeRangePicker.tsx'

// Branches is one hub with one navigation layer. Overview owns branch cards;
// Products owns the branch-scoped stock list; Transfer owns
// transfer history (the complete movement ledger lives in Products -> Stock Changes).
const BranchesSection = lazy(() => import('./Branches'))
const InventorySection = lazy(() => import('../inventory/Inventory.tsx'))

type BranchesHubAppContext = {
  hasPermission: (key: string) => boolean
  t: (key: string, fallback?: string) => string
  getPermissionTier: (key: string) => string
  navigateTo: (pageId: string, anchor?: string) => void
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
  const { t, getPermissionTier, navigateTo, hasPermission } = useApp()
  const trh = (key: string, fallback: string): string => { const value = t(key); return value && value !== key ? value : fallback }
  const canBranchList = getPermissionTier('branches') !== 'none'
  const canInventory = getPermissionTier('inventory') !== 'none'
  const [section, setSection] = useHubSection<BranchesHubSection>('branches', () => initialSection(canBranchList, canInventory), getHubDestinations('branches', { getPermissionTier, hasPermission }).map((item) => item.id), navigateTo)
  // The hub owns ONE range and all three data sections read it: Overview,
  // Products and Transfer History. Products was originally left out on the
  // theory that a stock list carries no dated statistics -- but its Net sold,
  // Revenue, COGS and Profit columns are dated, and the Worker route already
  // scoped them by startDate/endDate. Not wiring the range through did not
  // remove those figures, it made them answer all-time while the section
  // beside them answered the picked window (N10). Stock quantities and the
  // stock-value cards stay unscoped on purpose: stock is a right-now fact.
  const [sharedDateRange, setSharedDateRange] = useState<DateTimeRange>(() => ({
    startDate: '',
    endDate: '',
    startTime: '',
    endTime: '',
  }))
  const isActive = useIsPageActive('branches')

  useEffect(() => {
    if (!isActive || typeof window === 'undefined') return
    let raw: string | null = null
    try { raw = window.sessionStorage.getItem(DASHBOARD_INVENTORY_FOCUS_KEY) } catch { return }
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
    else if (focus === 'rfid' && canInventory) { setSection('rfid') }
    else setSection('overview')
  }, [canBranchList, canInventory, isActive, navigateTo])

  // HubSectionDef's shape (hidden + description) comes from the RC lane; the
  // section IDS stay this line's own. The RC line still calls the second
  // section 'inventory'; here it was renamed to 'products' when the Inventory
  // ledger was retired in favour of the one in Products, and initialSection(),
  // the Dashboard hand-off and the render body below all key off 'products'.
  // Taking the RC ids wholesale would have silently broken the deep link.
  const tabs: HubSectionDef[] = [
    { id: 'overview', label: trh('overview', 'Overview'), icon: Building2, hidden: !canBranchList, description: trh('hub_desc_branches_overview', 'Stock summary and every branch') },
    { id: 'products', label: trh('products', 'Products'), icon: Package, hidden: !canInventory, description: trh('hub_desc_branches_inventory', 'Per-branch product stock') },
    { id: 'transfers', label: trh('transfer', 'Transfer'), icon: ArrowRightLeft, hidden: !canBranchList, description: trh('hub_desc_branches_transfers', 'Move stock between branches') },
    { id: 'rfid', label: 'RFID', icon: Radio, hidden: !canInventory, description: trh('hub_desc_branches_rfid', 'RFID tag scans') },
  ]
  const visibleTabs = tabs.filter((tab) => !tab.hidden)
  const active = visibleTabs.some((tab) => tab.id === section) ? section : (visibleTabs[0]?.id || 'overview')

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-2">
      <HubSectionNav
        sections={tabs}
        active={active}
        onChange={(id) => setSection(id as BranchesHubSection)}
        storageKey="bos:hub:branches:active"
        pageId="branches"
      >
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
              hostSection="products"
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
      </HubSectionNav>
    </div>
  )
}
