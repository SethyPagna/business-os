import assert from 'node:assert/strict'
import { createHarness, type MountedSurface } from './mountedComponentHarness.ts'
import { wiredResult, type WiredList } from '../src/components/inventory/inventoryWired.ts'
import { loadSource } from './productsSurfaceFixture.ts'
import type { InventoryCheckProduct } from '../src/types/inventoryChecks.ts'

// Inventory redesign, slice C1 review L1 (17 Nov 2026): the Inventory row adapter and the detail dropped low_stock_threshold / out_of_stock_threshold, so in the default per-product mode an Inventory row
// and its detail judged a product on the Settings default (10) while Products judged it on its own numbers: "In stock" here, "Low stock" there. The /list answer already carries both numbers for a viewer with
// the stock grant. Pinned here, against Products' own modal for the SAME product in BOTH threshold modes:
//   1. the wired adapter carries the two numbers (and only when the row has them)
//   2. the row's stock figure (StockQty) is judged on them
//   3. the detail's badge equals Products' badge for the same product: per-product mode, global mode, alerts off
//   4. a viewer without the stock grant gets neither the figure nor the thresholds in the detail record

const detailRecord = (await loadSource('components/inventory/InventoryCheckDetail.tsx')).detailRecord as (row: InventoryCheckProduct, fields: Record<string, boolean>) => Record<string, unknown>
const ALL = { price: true, barcode: true, category: true, brand: true, stock: true, received: true, sales: false, customers: false, cost: true }
const money = (value: unknown) => `$${Number(value).toFixed(2)}`
const harness = await createHarness({})
const live: MountedSurface[] = []
const text = (surface: MountedSurface) => surface.text().replace(/\s+/g, ' ')

const modeSettings = {
  product: { low_stock_alert_enabled: 'true', low_stock_threshold_mode: 'product', low_stock_threshold_default: '10' },
  global: { low_stock_alert_enabled: 'true', low_stock_threshold_mode: 'global', low_stock_threshold_default: '3' },
  off: { low_stock_alert_enabled: 'false', low_stock_threshold_mode: 'product', low_stock_threshold_default: '10' },
}
type Mode = keyof typeof modeSettings
const app = (mode: Mode) => ({ user: { id: 1, role_code: 'admin', permissions: {} }, getPermissionTier: () => 'none', can: () => false, t: (key: string) => key, settings: modeSettings[mode] })
const unmountAll = async () => { for (const surface of live.splice(0)) await surface.unmount() }
const track = async (surface: Promise<MountedSurface>) => { const mounted = await surface; live.push(mounted); return mounted }

// The three states the detail badge can say, as the words the modal prints.
const badgeOf = (surface: MountedSurface) => ['Out of stock', 'Low stock', 'In stock'].find(word => text(surface).includes(word)) ?? 'none'
const inventoryBadge = async (row: Record<string, unknown>, mode: Mode) => {
  await unmountAll()
  return badgeOf(await track(harness.mount({ component: 'components/inventory/InventoryCheckDetail.tsx',
    props: { product: { id: 41, name: 'Synthetic serum', unit: 'pcs', ...row } as unknown as InventoryCheckProduct, unavailable: false, fields: ALL, fmtUSD: money, fmtKHR: String, t: (key: string) => key, onClose: () => {} },
    app: app(mode), doubles: {} })))
}
const productsBadge = async (row: Record<string, unknown>, mode: Mode) => {
  await unmountAll()
  const { quantity, ...rest } = row
  return badgeOf(await track(harness.mount({ component: 'components/products/surfaces/ProductDetailModal.tsx',
    props: { p: { id: 41, name: 'Synthetic serum', unit: 'pcs', ...rest, stock_quantity: quantity }, fmtUSD: money, fmtKHR: String, onClose: () => {}, report: false },
    app: app(mode), doubles: {} })))
}
const rowState = async (row: Record<string, unknown>, mode: Mode) => {
  await unmountAll()
  const surface = await track(harness.mount({ component: 'components/inventory/InventoryCheckListRows.tsx',
    props: { products: [{ id: 41, name: 'Synthetic serum', unit: 'pcs', check_status: 'not_checked', ...row }], drafts: {}, selecting: false, canViewStock: true, canViewCounts: true, t: (key: string) => key, onOpenProduct: () => {} },
    app: app(mode), doubles: {} }))
  return surface.find(node => node.getAttribute('data-stock-state') !== null, 'stock figure').getAttribute('data-stock-state')
}

const cases: Array<[string, () => Promise<void>]> = [
  ['the wired adapter carries a row\'s own thresholds, and invents none for a row that has none', async () => {
    const list: WiredList = { items: [
      { id: 1, name: 'Has both', stock_quantity: 12, low_stock_threshold: 15, out_of_stock_threshold: 2 },
      { id: 2, name: 'Has none (cut by the Worker)', stock_quantity: 12 },
      { id: 3, name: 'Zero out threshold', stock_quantity: 12, low_stock_threshold: 0, out_of_stock_threshold: 0 },
    ], total: 3, page: 1, pageSize: 20, wired: true }
    const items = wiredResult({ list, overlay: new Map(), lots: new Map(), branches: [], branchId: 0, extras: {} }).items as Array<Record<string, unknown>>
    assert.deepEqual([items[0].low_stock_threshold, items[0].out_of_stock_threshold], [15, 2])
    assert.ok(!('low_stock_threshold' in items[1]) && !('out_of_stock_threshold' in items[1]), 'no key at all, so the Settings rule decides (never a made-up 0)')
    assert.deepEqual([items[2].low_stock_threshold, items[2].out_of_stock_threshold], [0, 0], 'a stored 0 is kept')
  }],
  ['the row\'s stock figure is judged on the product\'s own thresholds', async () => {
    assert.equal(await rowState({ quantity: 12, low_stock_threshold: 15 }, 'product'), 'low', 'own low threshold 15: 12 is low')
    assert.equal(await rowState({ quantity: 12, low_stock_threshold: 5 }, 'product'), 'healthy', 'own low threshold 5: 12 is healthy')
    assert.equal(await rowState({ quantity: 12 }, 'product'), 'healthy', 'no number on the row: the Settings default 10 decides')
    assert.equal(await rowState({ quantity: 8, out_of_stock_threshold: 8 }, 'product'), 'out', 'at the out threshold it is out')
  }],
  ['the detail badge equals Products\' badge for the same product, in per-product mode, global mode and alerts off', async () => {
    const rows: Array<[string, Record<string, unknown>]> = [
      ['own low above stock', { quantity: 12, low_stock_threshold: 15, out_of_stock_threshold: 0 }],
      ['own low below stock', { quantity: 12, low_stock_threshold: 5, out_of_stock_threshold: 0 }],
      ['own out at stock', { quantity: 8, low_stock_threshold: 15, out_of_stock_threshold: 8 }],
      ['own out below stock, low above', { quantity: 8, low_stock_threshold: 9, out_of_stock_threshold: 2 }],
      ['no numbers', { quantity: 12 }],
    ]
    const seen = new Set<string>()
    for (const mode of ['product', 'global', 'off'] as const) {
      for (const [name, row] of rows) {
        const inventory = await inventoryBadge(row, mode), products = await productsBadge(row, mode)
        assert.equal(inventory, products, `${mode} / ${name}: Inventory says "${inventory}", Products says "${products}"`)
        seen.add(`${mode}:${inventory}`)
      }
    }
    // Positive controls: the fixtures really reach every state, and the modes really differ (a sweep that answered "In stock" everywhere would prove nothing).
    for (const wanted of ['product:Low stock', 'product:In stock', 'product:Out of stock', 'global:In stock', 'off:In stock']) assert.ok(seen.has(wanted), `${wanted} is exercised: ${[...seen].join(', ')}`)
    assert.equal(await inventoryBadge({ quantity: 12, low_stock_threshold: 15 }, 'product'), 'Low stock')
    assert.equal(await inventoryBadge({ quantity: 12, low_stock_threshold: 15 }, 'global'), 'In stock', 'global mode: the Settings number (3) overrides the product\'s own')
  }],
  ['a viewer without the stock grant carries no figure and no thresholds into the detail record', async () => {
    const row = { id: 41, name: 'Synthetic serum', quantity: 12, low_stock_threshold: 15, out_of_stock_threshold: 2 } as unknown as InventoryCheckProduct
    const blind = detailRecord(row, { ...ALL, stock: false })
    assert.ok(!('stock_quantity' in blind) || blind.stock_quantity === undefined)
    assert.ok(!('low_stock_threshold' in blind) && !('out_of_stock_threshold' in blind), 'the thresholds stay behind the stock grant')
    const sighted = detailRecord(row, ALL)
    assert.deepEqual([sighted.low_stock_threshold, sighted.out_of_stock_threshold, sighted.stock_quantity], [15, 2, 12])
  }],
]

const failures: string[] = []
try {
  for (const [name, run] of cases) {
    try { await run() } catch (cause) { failures.push(`${name}\n    ${(cause instanceof Error ? cause.message : String(cause)).split('\n').slice(0, 6).join(' | ')}`) } finally { await unmountAll() }
  }
} finally { await harness.close() }
if (failures.length) throw new Error(`${failures.length} of ${cases.length} threshold cases failed:\n  - ${failures.join('\n  - ')}`)
console.log(`inventoryCheckStockThresholds passed: ${cases.length} cases (adapter, row, detail vs Products in three modes, stock grant)`)
