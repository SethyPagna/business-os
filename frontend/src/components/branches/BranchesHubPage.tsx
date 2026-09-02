import { Suspense, lazy, useEffect, useState } from 'react'
import Building2 from 'lucide-react/dist/esm/icons/building-2.js'
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left.js'
import Radio from 'lucide-react/dist/esm/icons/radio.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { useIsPageActive } from '../shared/pageActivity'
import HubSectionNav, { type HubSectionDef } from '../shared/HubSectionNav.tsx'
import type { DateTimeRange } from '../shared/DateTimeRangePicker.tsx'

// Branches is one hub with one navigation layer. Overview keeps summary stats
// and branch cards together; Inventory is the branch-product stock workspace
// that moved here from the old Inventory page; Transfer owns transfer history
// only (the complete movement ledger now lives in Products -> Stock Changes).
const BranchesSection = lazy(() => import('./Branches'))
const InventorySection = lazy(() => import('../inventory/Inventory.tsx'))

type BranchesHubAppContext = {
  t: (key: string, fallback?: string) => string
  getPermissionTier: (key: string) => string
  navigateTo: (pageId: string) => void
}
const useApp = useAppHook as unknown as () => BranchesHubAppContext

type BranchesHubSection = 'overview' | 'inventory' | 'transfers' | 'rfid'
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
    if (focus === 'movements' && canInventory) return 'inventory'
  }
  return 'overview'
}

export default function BranchesHubPage() {
  const { t, getPermissionTier, navigateTo } = useApp()
  const trh = (key: string, fallback: string): string => { const value = t(key); return value && value !== key ? value : fallback }
  const canBranchList = getPermissionTier('branches') !== 'none'
  const canInventory = getPermissionTier('inventory') !== 'none'
  const [section, setSection] = useState<BranchesHubSection>(() => initialSection(canBranchList, canInventory))
  // A deep link (Dashboard's inventory-focus hand-off) resolved at
  // construction time above lands straight on layer 3 for that section on
  // mobile; a plain visit (no hand-off, section defaults to 'overview')
  // lands on layer 2. See HubSectionNav's `initialEntered` doc comment.
  const [initialEntered] = useState(() => section !== 'overview')
  // Bumped alongside setSection('rfid') below when the SAME hand-off
  // arrives while this hub is already mounted in the background (isActive
  // flips true) -- HubSectionNav can't see that setSection call itself, so
  // this tells it to force layer 3 open for whatever `active` becomes.
  const [enterSignal, setEnterSignal] = useState(0)
  // The hub owns one range. Inventory stats use it in Overview; Transfer
  // History receives the exact same controlled value after a section switch.
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
    else if (focus === 'rfid' && canInventory) { setSection('rfid'); setEnterSignal((value) => value + 1) }
    else setSection('overview')
  }, [canBranchList, canInventory, isActive, navigateTo])

  const tabs: HubSectionDef[] = [
    { id: 'overview', label: trh('overview', 'Overview'), icon: Building2, hidden: !(canInventory || canBranchList), tone: 'text-sky-600', description: trh('hub_desc_branches_overview', 'Stock summary and every branch') },
    { id: 'inventory', label: trh('inventory', 'Inventory'), icon: Building2, hidden: !canInventory, tone: 'text-emerald-600', description: trh('hub_desc_branches_inventory', 'Per-branch product stock') },
    { id: 'transfers', label: trh('transfer', 'Transfer'), icon: ArrowRightLeft, hidden: !canBranchList, tone: 'text-violet-600', description: trh('hub_desc_branches_transfers', 'Move stock between branches') },
    { id: 'rfid', label: 'RFID', icon: Radio, hidden: !canInventory, tone: 'text-emerald-600', description: trh('hub_desc_branches_rfid', 'RFID tag scans') },
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
        title={trh('branches', 'Branches')}
        initialEntered={initialEntered}
        enterSignal={enterSignal}
      >
      <Suspense fallback={<p className="p-4 text-sm text-gray-500">{trh('loading', 'Loading')}...</p>}>
        {active === 'overview' ? (
          <div className="page-scroll flex min-h-0 flex-1 flex-col">
            {canInventory ? (
              <InventorySection
                hostSection="stats"
                embedded
                dateRange={sharedDateRange}
                onDateRangeChange={setSharedDateRange}
              />
            ) : null}
            {canInventory && canBranchList ? <div className="mx-3 shrink-0 border-t border-gray-200 dark:border-gray-700 sm:mx-6" aria-hidden="true" /> : null}
            {canBranchList ? (
              <BranchesSection
                embedded
                view="branches"
                showSectionNavigation={false}
                dateRange={sharedDateRange}
                onDateRangeChange={setSharedDateRange}
                showDateRange={!canInventory}
              />
            ) : null}
          </div>
        ) : active === 'inventory' && canInventory ? (
          <div className="page-scroll flex min-h-0 flex-1 flex-col">
            {canBranchList ? (
              <BranchesSection
                embedded
                view="branches"
                showSectionNavigation={false}
                dateRange={sharedDateRange}
                onDateRangeChange={setSharedDateRange}
                showDateRange={false}
              />
            ) : (
              <InventorySection hostSection="stats" embedded />
            )}
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
