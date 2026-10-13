// Owner ruling, 12 Oct 2026: show the one branch everywhere its picker is hidden.
// Two more places hid the branch because there is only one: the Branches
// overview dropped its "Branches: 1" count tile, and the Dashboard dropped its
// per-branch comparison card. Each now shows the same read-only label with the
// real branch name instead; two active branches keep the count tile and the
// comparison card and show no label.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, type MountedSurface, type MemoryNode } from './mountedComponentHarness.ts'

const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8'))])) as Record<string, Record<string, string>>
const labelsOf = (surface: MountedSurface): MemoryNode[] => surface.findAll((node) => node.getAttribute('data-sole-branch') !== null)

type BranchFixture = { id: number; name: string; canonical_key: string; role: string; is_active: number; is_default: number; successor_branch_id: null }
const store: BranchFixture = { id: 1, name: 'LC Store', canonical_key: 'shop', role: 'shop', is_active: 1, is_default: 1, successor_branch_id: null }
const warehouse: BranchFixture = { id: 2, name: 'Warehouse', canonical_key: 'warehouse', role: 'warehouse', is_active: 1, is_default: 0, successor_branch_id: null }

const harness = await createHarness()
try {
  for (const lang of ['en', 'km']) {
    const words = packs[lang]
    const t = (key: string) => words[key] || ''
    const app = {
      t, user: { id: 1, role_code: 'admin', role_permissions: { all: true } }, notify() {}, can: () => true, hasPermission: () => true, getPermissionTier: () => 'all', page: 'branches',
      fmtUSD: (value: number) => `$${value}`, fmtKHR: (value: number) => `${value}`, khrToUsd: (value: number) => value / 4000, usdToKhr: (value: number) => value * 4000, displayCurrency: 'USD',
    }

    // Branches overview: Stats opens the overview tiles.
    const overview = async (branches: BranchFixture[]) => {
      const surface = await harness.mount({
        component: 'components/branches/Branches.tsx', props: {}, app,
        doubles: {
          'api/branchTransport.ts': {
            getBranches: async () => branches, getTransfers: async () => ({ transfers: [], total: 0 }),
            getBranchSummary: async () => ({ branch_count: branches.length, total_products: 4, stock_value_usd: 10 }),
          },
        },
      })
      await surface.click(surface.button(words.stats))
      await surface.settle({ waitingFor: 'the overview tiles', until: () => surface.text().includes(words.products || 'Products') })
      return surface
    }
    const one = await overview([store])
    const found = labelsOf(one)
    assert.equal(found.length, 1, `Branches overview (${lang}): one read-only branch label stands in for the count tile`)
    assert.equal(found[0].getAttribute('aria-label'), `${words.branch}: LC Store`, `Branches overview (${lang}): named "Branch: name" in the person's language`)
    assert.ok(!one.text().includes(`${words.branches}1`), 'Branches overview: no "Branches 1" count tile')
    await one.unmount()
    const two = await overview([store, warehouse])
    assert.equal(labelsOf(two).length, 0, `CONTROL (${lang}): two branches keep the count tile and show no label`)
    assert.ok(two.text().includes(words.branches), 'CONTROL: the count tile is there')
    await two.unmount()

    // Dashboard: the per-branch comparison card is replaced, above the totals it describes.
    const dashboard = async (branches: BranchFixture[]) => {
      const analytics = {
        totals: { revenue_usd: 5, tx_count: 1 }, periodData: [], byPayment: [], topProducts: [], topProductsQty: [], topCustomers: [], hourlyDist: [],
        byBranch: branches.map((branch) => ({ branch_id: branch.id, branch_name: branch.name, revenue_usd: 5, tx_count: 1 })),
      }
      const summary = { product_count: 1, today_count: 1, stock_value_usd: 1, expiring_count: 0, recent_sales: [], low_stock: [], out_of_stock: [], expiring_products: [] }
      return harness.mount({
        component: 'components/dashboard/Dashboard.tsx', props: {}, app: { ...app, page: 'dashboard' },
        doubles: {
          'api/branchTransport.ts': { getBranches: async () => branches },
          'api/dashboardTransport.ts': {
            getDashboard: async () => summary, getDashboardStartup: async () => ({ summary, analytics }), getAnalytics: async () => analytics,
            getDashboardStockAlerts: async () => ({ items: [], total: 0 }), getDashboardInsightList: async () => ({ items: [], total: 0 }),
          },
          'api/importJobsTransport.ts': { listImportJobs: async () => ({ jobs: [] }) },
        },
      })
    }
    const dashOne = await dashboard([store])
    await dashOne.settle({ waitingFor: 'the branch label', until: () => labelsOf(dashOne).length > 0 })
    const dashFound = labelsOf(dashOne)
    assert.equal(dashFound.length, 1, `Dashboard (${lang}): one read-only branch label`)
    assert.equal(dashFound[0].getAttribute('aria-label'), `${words.branch}: LC Store`, `Dashboard (${lang}): named "Branch: name" in the person's language`)
    await dashOne.unmount()
    const dashTwo = await dashboard([store, warehouse])
    await dashTwo.settle()
    assert.equal(labelsOf(dashTwo).length, 0, `CONTROL (${lang}): two branches keep the comparison card and show no label`)
    await dashTwo.unmount()
  }
  console.log('PASS Branches overview and Dashboard show the one branch by name, in English and Khmer; two branches show none')
} finally {
  await harness.close()
}
