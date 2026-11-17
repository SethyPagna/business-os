import assert from 'node:assert/strict'
import { createHarness, type MountedSurface } from './mountedComponentHarness.ts'
import { loadSource } from './productsSurfaceFixture.ts'
import type { InventoryCheckProduct } from '../src/types/inventoryChecks.ts'

// Inventory redesign, slice C1 review L3 (17 Nov 2026): no live leak, but the walls behind the Worker were thin. The page's projection stripped prices but not cost keys, and the detail passed the SKU
// whatever the barcode grant said. Both are walls for the day a row arrives carrying more than its viewer may see (a Products-store row, a future server change): this file hands them exactly that row.
//   1. projectProduct (the page's per-row projection): a viewer without a grant never holds that grant's keys; each group is cut on its own switch
//   2. the detail, mounted DIRECTLY with a non-holder and a row that carries everything: no SKU, barcode, cost, price or stock anywhere in the text or in an attribute
//   3. the same row with every grant shows them all (positive control: the cuts above are the grants, not a broken fixture)

const projectProduct = (await import('../src/components/inventory/inventoryCheckProject.ts')).projectProduct as (row: InventoryCheckProduct, fields: Record<string, boolean>) => Record<string, unknown>
const detailRecord = (await loadSource('components/inventory/InventoryCheckDetail.tsx')).detailRecord as (row: InventoryCheckProduct, fields: Record<string, boolean>) => Record<string, unknown>

const NONE = { price: false, barcode: false, category: false, brand: false, stock: false, received: false, sales: false, customers: false, cost: false }
const ALL = { ...NONE, price: true, barcode: true, category: true, brand: true, stock: true, received: true, cost: true }
const loaded = {
  id: 41, name: 'Synthetic serum', unit: 'pcs', sku: 'SKU-7731', barcode: '885000041', brand: 'Brand Z', category: 'Skin', quantity: 12, damaged_quantity: 2, low_stock_threshold: 15, out_of_stock_threshold: 2,
  selling_price_usd: 12.5, selling_price_khr: 51250, wholesale_price_usd: 10, discount_enabled: 1, discount_type: 'percent', discount_percent: 20,
  cost_price_usd: 3.21, cost_price_khr: 13161, purchase_price_usd: 3.21, cost_needs_review: true, cost_review_key: 'k-77',
} as unknown as InventoryCheckProduct
const keysOf = (record: Record<string, unknown>) => Object.keys(record).filter(key => record[key] !== undefined).sort()
const COST = ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'cost_needs_review', 'cost_review_key']
const PRICE = ['selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'discount_enabled', 'discount_type', 'discount_percent']
const STOCK = ['quantity', 'damaged_quantity', 'low_stock_threshold', 'out_of_stock_threshold']

const harness = await createHarness({})
const live: MountedSurface[] = []
const asEmployee = { id: 2, role_code: 'employee', permissions: {} }
const asAdmin = { id: 1, role_code: 'admin', permissions: {} }
const mount = async (fields: Record<string, boolean>, user: Record<string, unknown>) => {
  for (const old of live.splice(0)) await old.unmount()
  const surface = await harness.mount({ component: 'components/inventory/InventoryCheckDetail.tsx',
    props: { product: loaded, unavailable: false, fields, fmtUSD: (v: unknown) => `$${Number(v).toFixed(2)}`, fmtKHR: (v: unknown) => `${v}៛`, priceText: (v: unknown) => `$${Number(v).toFixed(2)}`, t: (key: string) => key, onClose: () => {} },
    app: { user, getPermissionTier: () => 'none', can: () => true, t: (key: string) => key, settings: {} }, doubles: {} })
  live.push(surface)
  return surface
}
const everything = (surface: MountedSurface) => [surface.text(), ...surface.findAll(() => true).flatMap(node => ['title', 'aria-label', 'data-copy', 'alt', 'href', 'value', 'placeholder'].map(name => node.getAttribute(name) ?? ''))].join('\n')

const cases: Array<[string, () => Promise<void>]> = [
  ['projectProduct cuts each group on its own switch, and cost keys go without the cost gate even when the price grant is held', async () => {
    const present = (row: Record<string, unknown>, keys: string[]) => keys.filter(key => Object.hasOwn(row, key))
    const none = projectProduct(loaded, NONE)
    for (const key of [...COST, ...PRICE, ...STOCK, 'sku', 'barcode', 'brand', 'category']) assert.ok(!Object.hasOwn(none, key), `${key} is cut without any grant`)
    assert.deepEqual([none.id, none.name, none.unit], [41, 'Synthetic serum', 'pcs'], 'identity stays')
    assert.deepEqual(present(projectProduct(loaded, { ...NONE, price: true }), [...COST, ...STOCK]), [], 'the price grant opens prices only: no cost, no stock')
    assert.deepEqual(present(projectProduct(loaded, { ...NONE, price: true }), PRICE), PRICE)
    assert.deepEqual(present(projectProduct(loaded, { ...ALL, cost: false }), COST), [], 'every grant but cost: the cost keys are gone (the gate is canViewAcquisitionCosts, folded into fields.cost)')
    assert.deepEqual(present(projectProduct(loaded, { ...ALL, cost: false }), [...PRICE, ...STOCK, 'sku', 'barcode']), [...PRICE, ...STOCK, 'sku', 'barcode'].filter(key => Object.hasOwn(loaded, key)), 'and nothing else is touched')
    assert.deepEqual(present(projectProduct(loaded, { ...NONE, cost: true }), COST), COST, 'the cost grant alone keeps the cost keys')
    assert.deepEqual(present(projectProduct(loaded, { ...NONE, barcode: true }), ['sku', 'barcode']), ['sku', 'barcode'])
    assert.deepEqual(Object.keys(loaded).length > 20 && present(projectProduct(loaded, ALL), Object.keys(loaded)), Object.keys(loaded), 'with every grant the row is unchanged')
    assert.ok(Object.hasOwn(loaded, 'cost_price_usd'), 'and the input row was not mutated')
  }],
  ['detailRecord carries a group only with its grant: no SKU or barcode without the barcode grant, no cost without cost, no price without price', async () => {
    const blind = detailRecord(loaded, NONE)
    assert.deepEqual(keysOf(blind), ['id', 'name', 'unit'], `a viewer with nothing crosses only identity: ${keysOf(blind)}`)
    assert.equal(blind.sku, undefined)
    assert.deepEqual(keysOf(detailRecord(loaded, { ...NONE, price: true })).filter(key => COST.includes(key)), [], 'price without cost: no cost keys')
    assert.deepEqual(keysOf(detailRecord(loaded, { ...NONE, cost: true })).filter(key => PRICE.includes(key)), [], 'cost without price: no price keys')
    const sighted = detailRecord(loaded, ALL)
    assert.deepEqual([sighted.sku, sighted.barcode, sighted.brand, sighted.category, sighted.cost_price_usd, sighted.selling_price_usd, sighted.stock_quantity], ['SKU-7731', '885000041', 'Brand Z', 'Skin', 3.21, 12.5, 12])
  }],
  ['mounted directly with a non-holder and a row that carries everything: nothing leaks into the text or an attribute', async () => {
    const blind = await mount(NONE, asEmployee)
    const all = everything(blind)
    for (const secret of ['SKU-7731', '885000041', 'Brand Z', 'Skin', '3.21', '13161', 'k-77', '12.50', '10.00', 'SKU', 'Cost', 'Margin', 'Selling price', 'Stock']) assert.ok(!all.includes(secret), `"${secret}" must not appear for a viewer with no grant:\n${all.slice(0, 300)}`)
    assert.ok(all.includes('Synthetic serum'), 'the name titles it')
    // Barcode grant off but everything else on, with an administrator (who passes canViewAcquisitionCosts): the SKU row and the barcode row are still not drawn.
    const noBarcode = await mount({ ...ALL, barcode: false }, asAdmin)
    const text = everything(noBarcode)
    assert.ok(!text.includes('SKU-7731') && !text.includes('885000041'), 'no barcode grant: no SKU and no barcode')
    assert.ok(text.includes('3.21') && text.includes('12.50'), 'while the cost and prices the grants allow still show')
  }],
  ['positive control: the same row with every grant shows the SKU, barcode, cost, prices and stock', async () => {
    const sighted = await mount(ALL, asAdmin)
    const all = everything(sighted)
    for (const shown of ['SKU-7731', '885000041', 'Brand Z', '3.21', '12.50', '10.00']) assert.ok(all.includes(shown), `${shown} shows with the grants`)
  }],
]

const failures: string[] = []
try {
  for (const [name, run] of cases) {
    try { await run() } catch (cause) { failures.push(`${name}\n    ${(cause instanceof Error ? cause.message : String(cause)).split('\n').slice(0, 6).join(' | ')}`) } finally { for (const surface of live.splice(0)) await surface.unmount() }
  }
} finally { await harness.close() }
if (failures.length) throw new Error(`${failures.length} of ${cases.length} backstop cases failed:\n  - ${failures.join('\n  - ')}`)
console.log(`inventoryCheckBackstops passed: ${cases.length} cases (page projection, detail record, mounted non-holder, positive control)`)
