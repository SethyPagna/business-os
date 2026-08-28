import { Suspense, lazy, useEffect, useState } from 'react'
import Building2 from 'lucide-react/dist/esm/icons/building-2.js'
import Package from 'lucide-react/dist/esm/icons/package.js'
import ArrowLeftRight from 'lucide-react/dist/esm/icons/arrow-left-right.js'
import Radio from 'lucide-react/dist/esm/icons/radio.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { useIsPageActive } from '../shared/pageActivity'

// E1 (Part 413): Inventory merges into Branches. The hub hosts BOTH
// page components intact -- Branches.tsx under the "Stats & Branches" chip
// and Inventory.tsx under every chip, re-sliced through its OWN internal
// section system (inventorySection: stats/products/movements/rfid predates
// this merge) via the hostSection prop. The board named three sections
// ("Stats & Branches" / "Movements" / "RFID"); Products is kept as a
// fourth chip because Inventory's product-stock slice has no other home
// and "nothing lost" outranks the section count -- FLAGGED in the log
// rather than silently dropped. The standalone 'inventory' PAGE id
// retires; the 'inventory' permission key lives on and gates the three
// inventory-backed chips, while the branch list self-gates on 'branches'.

const BranchesSection = lazy(() => import('./Branches'))
const InventorySection = lazy(() => import('../inventory/Inventory.tsx'))

type BranchesHubAppContext = {
  t: (key: string, fallback?: string) => string
  getPermissionTier: (key: string) => string
}
const useApp = useAppHook as unknown as () => BranchesHubAppContext

type BranchesHubSection = 'branches' | 'products' | 'movements' | 'rfid'

// Dashboard's stock cards hand off a focus payload before navigating (see
// Dashboard.tsx's DASHBOARD_INVENTORY_FOCUS_KEY write). Inventory.tsx still
// CONSUMES it (section/tab/stockFilter, then removes the key); the hub only
// PEEKS so the right chip is open when that consumption happens.
const DASHBOARD_INVENTORY_FOCUS_KEY = 'bos:dashboard:inventory-focus'

function peekDashboardFocusSection(): BranchesHubSection | '' {
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
  if (typeof window !== 'undefined' && canInventory) {
    const focus = peekDashboardFocusSection()
    if (focus) return focus
    const segment = String(window.location.pathname || '').toLowerCase()
    // Old /inventory URLs open Inventory's old default slice (products).
    if (segment.includes('inventory')) return 'products'
  }
  if (canBranchList || canInventory) return 'branches'
  return 'branches'
}

export default function BranchesHubPage() {
  const { t, getPermissionTier } = useApp()
  // t() returns the KEY on a miss (stale/failed pack) -- guard so chips fall back to readable English, never snake_case keys.
  const trh = (key: string, fallback: string): string => { const v = t(key); return v && v !== key ? v : fallback }
  const canBranchList = getPermissionTier('branches') !== 'none'
  const canInventory = getPermissionTier('inventory') !== 'none'
  const [section, setSection] = useState<BranchesHubSection>(() => initialSection(canBranchList, canInventory))
  // The mounted-pages cache keeps this hub alive in the background, so a
  // Dashboard stock-card handoff can arrive WITHOUT a remount -- re-peek the
  // focus payload every time the page becomes active again, not just in the
  // initialSection above. Inventory's own effect still consumes the payload.
  const isActive = useIsPageActive('branches')
  useEffect(() => {
    if (!isActive || !canInventory || typeof window === 'undefined') return
    const focus = peekDashboardFocusSection()
    if (focus) setSection(focus)
  }, [isActive, canInventory])

  const tabs: Array<{ id: BranchesHubSection; label: string; icon: typeof Building2; allowed: boolean; tone: string }> = [
    // The combined home chip: Inventory's stat cards (inventory grant) over
    // the branch list (branches grant) -- visible when EITHER is held, with
    // each half self-gating below.
    { id: 'branches', label: trh('stats_and_branches', 'Stats & Branches'), icon: Building2, allowed: canBranchList || canInventory, tone: 'text-blue-600' },
    { id: 'products', label: trh('products', 'Products'), icon: Package, allowed: canInventory, tone: 'text-teal-600' },
    { id: 'movements', label: trh('movements', 'Movements'), icon: ArrowLeftRight, allowed: canInventory, tone: 'text-violet-600' },
    { id: 'rfid', label: trh('rfid', 'RFID'), icon: Radio, allowed: canInventory, tone: 'text-emerald-600' },
  ]
  const visibleTabs = tabs.filter((tab) => tab.allowed)
  const active: BranchesHubSection = visibleTabs.some((tab) => tab.id === section) ? section : (visibleTabs[0]?.id || 'branches')

  return (
    // Height-filling flex column so the hosted sections' `page-scroll`
    // roots get a bounded height and actually scroll. The old plain block
    // root clipped everything below the fold -- which is also how the
    // branch list "disappeared" (Y3): it rendered BELOW Inventory's stats
    // in an unscrollable page (Y4).
    <div className="flex min-h-0 flex-1 flex-col space-y-3">
      {visibleTabs.length > 1 ? (
        <div className="shrink-0 px-4 pt-4">
          <div className="inline-flex max-w-full overflow-x-auto rounded-xl bg-gray-100 dark:bg-gray-800 p-0.5">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSection(tab.id)}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 ${active === tab.id ? `bg-white dark:bg-gray-900 shadow ${tab.tone}` : 'text-gray-500'}`}
                >
                  <Icon className="w-4 h-4" /> {tab.label}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
      <Suspense fallback={<p className="p-4 text-sm text-gray-500">{trh('loading', 'Loading')}...</p>}>
        {/* Inventory stays MOUNTED across chip switches (hostSection just
            re-slices it) so filters, selections and loaded data survive
            moving between chips -- the exact state a standalone page kept. */}
        {/* On the home chip BOTH sections show: Inventory's stats pane keeps
            its natural height up to 45% of the hub so the branch list below
            always gets real space (each pane scrolls itself -- the two
            `page-scroll` roots stay the scroll containers their internal
            jump/scroll helpers expect). On every other chip Inventory owns
            the full height. */}
        {canInventory ? (
          <div className={active === 'branches' && canBranchList
            ? 'flex min-h-0 max-h-[45%] flex-none flex-col'
            : 'flex min-h-0 flex-1 flex-col'}
          >
            <InventorySection
              hostSection={active === 'branches' ? 'stats' : active}
              onHostSectionChange={(next) => setSection(next === 'stats' ? 'branches' : next)}
            />
          </div>
        ) : null}
        {active === 'branches' && canBranchList ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <BranchesSection />
          </div>
        ) : null}
      </Suspense>
    </div>
  )
}
