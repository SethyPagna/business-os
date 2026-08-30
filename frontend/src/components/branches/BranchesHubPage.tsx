import { Suspense, lazy, useEffect, useState } from 'react'
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3.js'
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
//
// Sections pass: the old "Stats & Branches" chip was the one hub that
// STACKED two sections in a single scroll -- Inventory's stats pane
// (capped 45%) over the branch list -- instead of showing one section at
// a time like the Sales/Settings/Review hubs. It is now split into two
// separate TOP section chips: "Stats" (Inventory's stats slice, full
// height) and "Branches" (the branch list, full height). Nothing stacks;
// the two never share a scroll. Inventory still stays MOUNTED across
// switches (hidden on the Branches chip) so filters/selection/data
// survive, exactly as a standalone page kept them.

const BranchesSection = lazy(() => import('./Branches'))
const InventorySection = lazy(() => import('../inventory/Inventory.tsx'))

type BranchesHubAppContext = {
  t: (key: string, fallback?: string) => string
  getPermissionTier: (key: string) => string
}
const useApp = useAppHook as unknown as () => BranchesHubAppContext

type BranchesHubSection = 'stats' | 'branches' | 'products' | 'movements' | 'rfid'

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
  // Default landing is the merged "Stats & Branches" section for everyone (it
  // renders whichever halves the viewer may see). Only a Dashboard stock-card
  // handoff or an old /inventory URL (both handled above) opens a slice.
  return 'stats'
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
    // "Stats & Branches" is ONE section again (user, Aug 29: "merge stats and
    // branch one section" + "make the inventory stat and branch part close ...
    // no space gap"). The E1b split into separate Stats / Branches chips is
    // undone: the inventory stat cards now flow directly on top of the branch
    // list in a single scroll (both rendered `embedded`, see below), with no
    // capped-pane gap. Products / Movements / RFID stay their own inventory
    // slices. Allowed to anyone with EITHER grant; the render shows only the
    // halves the viewer may see.
    { id: 'stats', label: `${trh('stats', 'Stats')} & ${trh('branches', 'Branches')}`, icon: BarChart3, allowed: canInventory || canBranchList, tone: 'text-sky-600' },
    { id: 'products', label: trh('products', 'Products'), icon: Package, allowed: canInventory, tone: 'text-teal-600' },
    { id: 'movements', label: trh('movements', 'Movements'), icon: ArrowLeftRight, allowed: canInventory, tone: 'text-violet-600' },
    { id: 'rfid', label: trh('rfid', 'RFID'), icon: Radio, allowed: canInventory, tone: 'text-emerald-600' },
  ]
  const visibleTabs = tabs.filter((tab) => tab.allowed)
  const active: BranchesHubSection = visibleTabs.some((tab) => tab.id === section) ? section : (visibleTabs[0]?.id || 'stats')

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
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 whitespace-nowrap ${active === tab.id ? `bg-white dark:bg-gray-900 shadow ${tab.tone}` : 'text-gray-500'}`}
                >
                  <Icon className="w-4 h-4" /> {tab.label}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
      <Suspense fallback={<p className="p-4 text-sm text-gray-500">{trh('loading', 'Loading')}...</p>}>
        {active === 'stats' ? (
          // Merged "Stats & Branches": both halves flow in ONE shared
          // page-scroll, each rendered `embedded` (no own scroll root), so
          // the inventory stat cards sit right on top of the branch list with
          // no capped-pane gap. Each half self-gates on its own grant.
          // Trade-off vs the old split: Inventory REMOUNTS when you switch
          // between this merged view and a Products/Movements/RFID slice
          // (different DOM position), so its in-memory filters/selection
          // reload -- acceptable for the requested single-section layout.
          <div className="page-scroll flex min-h-0 flex-1 flex-col">
            {canInventory ? (
              <InventorySection hostSection="stats" embedded onHostSectionChange={(next) => setSection(next)} />
            ) : null}
            {/* A subtle inset divider between the two halves (only when both
                show) so the merged section reads as stats-above-list without
                a gap -- delineation, not separation. */}
            {canInventory && canBranchList ? (
              <div className="mx-3 shrink-0 border-t border-gray-200 dark:border-gray-700 sm:mx-6" aria-hidden="true" />
            ) : null}
            {canBranchList ? <BranchesSection embedded /> : null}
          </div>
        ) : canInventory ? (
          // A single inventory slice (Products / Movements / RFID) keeps its
          // own full-height page-scroll, exactly like a standalone Inventory
          // page -- unchanged from before.
          <div className="flex min-h-0 flex-1 flex-col">
            <InventorySection
              hostSection={active === 'products' || active === 'movements' || active === 'rfid' ? active : 'products'}
              onHostSectionChange={(next) => setSection(next)}
            />
          </div>
        ) : null}
      </Suspense>
    </div>
  )
}
