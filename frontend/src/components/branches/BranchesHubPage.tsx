import { getHubDestinations, getHubPageFromLocation, hubAnchor, useHubSection } from '../shared/hubNavigation.ts'
import { Suspense, lazy, useEffect, useState } from 'react'
import Building2 from 'lucide-react/dist/esm/icons/building-2.js'
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left.js'
import Radio from 'lucide-react/dist/esm/icons/radio.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { useIsPageActive } from '../shared/pageActivity'
import HubSectionNav, { type HubSectionDef } from '../shared/HubSectionNav.tsx'
import { todayDateTimeRange, type DateTimeRange } from '../shared/DateTimeRangePicker.tsx'

const BranchesSection = lazy(() => import('./Branches'))
const InventorySection = lazy(() => import('../inventory/Inventory.tsx'))

type BranchesHubAppContext = {
  hasPermission: (key: string) => boolean
  t: (key: string, fallback?: string) => string
  getPermissionTier: (key: string) => string
  can: (key: string, action: string) => boolean
  navigateTo: (pageId: string, anchor?: string) => void
}
const useApp = useAppHook as unknown as () => BranchesHubAppContext

type BranchesHubSection = 'overview' | 'transfers' | 'rfid'
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

function clearDashboardInventoryFocus(): void {
  try {
    window.sessionStorage.removeItem(DASHBOARD_INVENTORY_FOCUS_KEY)
  } catch {
    // Nothing to clear where site data is blocked (iOS "Block All Cookies");
    // the guarded read above already degraded to "no queued focus".
  }
}

function initialSection(canBranchList: boolean, canInventory: boolean): BranchesHubSection {
  if (typeof window !== 'undefined') {
    const focus = peekDashboardFocusSection()
    if (focus === 'rfid' && canInventory) return 'rfid'
  }
  return canBranchList ? 'overview' : 'rfid'
}

export default function BranchesHubPage() {
  const { t, getPermissionTier, navigateTo, hasPermission, can } = useApp()
  const trh = (key: string, fallback: string): string => { const value = t(key); return value && value !== key ? value : fallback }
  const canBranchList = can('branches', 'view')
  const canInventory = can('inventory', 'view')
  const isActive = useIsPageActive('branches')
  const legacyProductsEntry = typeof window !== 'undefined'
    && getHubPageFromLocation(window.location.pathname, window.location.hash) === 'branches'
    && window.location.hash === '#hub:branches:products'
  useEffect(() => {
    if (canInventory && isActive && legacyProductsEntry) navigateTo('inventory', hubAnchor('inventory', 'products'))
  }, [canInventory, isActive, legacyProductsEntry, navigateTo])
  const [section, setSection] = useHubSection<BranchesHubSection>('branches', () => initialSection(canBranchList, canInventory), getHubDestinations('branches', { getPermissionTier, hasPermission, can }).map((item) => item.id), navigateTo)
  const [sharedDateRange, setSharedDateRange] = useState<DateTimeRange>(() => todayDateTimeRange())

  useEffect(() => {
    if (!isActive || typeof window === 'undefined') return
    let raw: string | null = null
    try { raw = window.sessionStorage.getItem(DASHBOARD_INVENTORY_FOCUS_KEY) } catch { return }
    if (!raw) return
    let payload: { section?: unknown; stockFilter?: unknown } = {}
    try {
      payload = JSON.parse(raw) as { section?: unknown; stockFilter?: unknown }
    } catch {
      clearDashboardInventoryFocus()
      return
    }
    clearDashboardInventoryFocus()
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

  const tabs: HubSectionDef[] = [
    { id: 'overview', label: trh('overview', 'Overview'), icon: Building2, hidden: !canBranchList, description: trh('hub_desc_branches_overview', 'Stock summary and every branch') },
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
        ) : active === 'rfid' && canInventory ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <InventorySection hostSection="rfid" />
          </div>
        ) : null}
      </Suspense>
      </HubSectionNav>
    </div>
  )
}
