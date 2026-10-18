import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import { createHarness } from './mountedComponentHarness.ts'

const require = createRequire(import.meta.url)
const source = fs.readFileSync(new URL('../src/components/inventory/InventoryProductsSurface.tsx', import.meta.url), 'utf8')
const module = { exports: {} as Record<string, any> }
new Function('require', 'module', 'exports', transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)((id: string) => {
  if (id === 'react' || id === 'react/jsx-runtime') return require(id)
  for (const utility of ['productGrouping', 'costDisplay', 'acquisitionCostAccess']) {
    if (id.includes(utility)) return require(`../src/utils/${utility}.ts`)
  }
  return { default: () => null, __esModule: true }
}, module, module.exports)
const api = module.exports
const cases = [
  { name: 'null with zero mirror', fields: { cost_price_usd: null, purchase_price_usd: 0 }, cost: null },
  { name: 'null with known mirror', fields: { cost_price_usd: null, purchase_price_usd: 9 }, cost: null },
  { name: 'zero overrides mirror', fields: { cost_price_usd: 0, purchase_price_usd: 9 }, cost: 0 },
  { name: 'canonical overrides mirror', fields: { cost_price_usd: 15, purchase_price_usd: 9 }, cost: 15 },
  { name: 'absent canonical uses mirror', fields: { purchase_price_usd: 4 }, cost: 4 },
  ...['', ' ', 'bad', Infinity, -1, false].map(value => ({ name: `invalid ${String(value)}`, fields: { cost_price_usd: value, purchase_price_usd: 9 }, cost: null })),
]
for (const fixture of cases) {
  const row = { id: 7, name: 'Synthetic serum', stock_quantity: 3, ...fixture.fields }
  assert.equal(api.inventoryCost(row, 'usd'), fixture.cost, fixture.name)
  assert.equal(api.scopedProductValue(row, [row], 'all'), fixture.cost === null ? null : fixture.cost * 3, fixture.name)
  assert.equal(api.scopedProductValue(row, [{ ...row, stock_quantity: 0 }], 'all'), 0, `${fixture.name}: empty stock has zero value`)
  const group = api.groupInventoryProducts([row])[0]
  assert.equal(api.inventoryCost(group.rows[0], 'usd'), fixture.cost, `${fixture.name}: group normalization`)
}
assert.equal(api.inventoryCost({ cost_price_khr: 0, purchase_price_khr: 5000 }, 'khr'), 0)
assert.equal(api.inventoryCost({ cost_price_khr: 4100, purchase_price_khr: 5000 }, 'khr'), 4100)

const harness = await createHarness({ observe: ['components/shared/CostCalculationFloat.tsx'] })
const authorized = { id: 1, role_code: 'admin', role_permissions: { all: true } }
const denied = { id: 2, role_code: 'cashier', role_permissions: { inventory: 'full', products: 'full' } }
const app = (user: typeof authorized | typeof denied) => ({ user, getPermissionTier: () => 'none', t: (key: string) => key, notify() {} })
const base = { onClose() {}, fmtUSD: (value: number) => `USD[${value}]`, fmtKHR: (value: number) => `KHR[${value}]`, t: () => undefined }
try {
  for (const fixture of cases) {
    const surface = await harness.mount({ component: 'components/inventory/ProductDetailModal.tsx', props: {
      ...base, product: { id: 7, name: 'Synthetic serum', stock_quantity: 3, selling_price_usd: 12, branch_stock: [], ...fixture.fields },
    }, app: app(authorized), doubles: {} })
    const costButton = surface.find(node => node.getAttribute('title') === 'Calculated cost price', 'cost display')
    assert.equal(costButton.textContent.includes('USD['), fixture.cost !== null, `${fixture.name}: mounted cost`)
    if (fixture.cost !== null) assert.ok(costButton.textContent.includes(`USD[${fixture.cost}]`), fixture.name)
    const text = surface.text()
    if (fixture.cost === null) assert.ok(!text.includes('USD[0]') && !text.includes('USD[36]'), `${fixture.name}: no fabricated cost, value or margin`)
    if (fixture.cost === 15) assert.ok(text.includes('USD[-3]') && text.includes('-25.0%'), 'loss margin uses selling price denominator and stays negative')
    if (fixture.cost === 0) assert.ok(text.includes('100.0%'), 'genuine zero cost has a full margin')
    assert.equal((text.match(/Margin/g) || []).length, 1, 'margin appears once')
    assert.ok(!text.includes('Active Price'), 'selling price is not repeated as active price')
    await surface.unmount()
  }
  for (const user of [authorized, denied]) {
    const surface = await harness.mount({ component: 'components/inventory/ProductDetailModal.tsx', props: {
      ...base, product: { id: 8, name: 'Synthetic zero stock', sku: 'SKU-ONCE', stock_quantity: 0, selling_price_usd: 12,
        cost_price_usd: null, purchase_price_usd: 8, cost_price_khr: 4100, purchase_price_khr: 9000, cost_needs_review: true, branch_stock: [] },
    }, app: app(user), doubles: {} })
    const text = surface.text()
    assert.equal(text.includes('KHR[4100]'), user === authorized, 'canonical KHR respects cost permission')
    assert.equal(text.includes('Cost needs review'), user === authorized, 'review tag respects cost permission')
    assert.equal(text.includes('USD[0]'), user === authorized, 'empty stock value is zero only in authorized view')
    assert.ok(!text.includes('KHR[9000]') && !text.includes('USD[8]'), 'mirrors do not replace canonical values')
    assert.equal((text.match(/SKU-ONCE/g) || []).length, 1, 'SKU appears once')
    await surface.unmount()
  }
  const rows = [
    { id: 41, name: 'Grouped serum', barcode: '123456789', stock_quantity: 3, cost_price_usd: null, purchase_price_usd: 0, cost_price_khr: 0, purchase_price_khr: 5000 },
    { id: 42, name: 'Grouped serum', barcode: '123456789', stock_quantity: 2, cost_price_usd: null, purchase_price_usd: 9, cost_price_khr: 0, purchase_price_khr: 9000, cost_needs_review: true },
  ]
  const grouped = api.groupInventoryProducts(rows)[0].rows
  assert.equal(grouped.length, 1, 'canonical normalization keeps equivalent branch rows together')
  assert.equal(api.inventoryCost(grouped[0], 'usd'), null, 'grouped unknown costs never become zero or a purchase mirror')
  assert.equal(grouped[0].cost_needs_review, true, 'review on any member stays visible')
  for (const user of [authorized, denied]) {
    const opened: number[] = []
    const surface = await harness.mount({ component: 'components/inventory/InventoryProductsSurface.tsx', props: {
      ...base, items: rows, total: 2, page: 1, pageSize: 20, totalPages: 1, branchFilter: 'all', loading: false, error: null,
      serverStats: null, statsLoading: false, active: false, onPageChange() {}, onPageSizeChange() {}, onOpenDetail() {}, onOpenInCatalogue() {},
    }, app: app(user), doubles: { 'components/shared/CostCalculationFloat.tsx': { default: (props: any) => { opened.push(Number(props.productId)); return null } } } })
    assert.equal(surface.text().includes('Cost needs review'), user === authorized, 'grouped review tag is actor-scoped')
    assert.ok(!surface.text().includes('USD[0]') && !surface.text().includes('USD[9]'), 'mounted list keeps unknown canonical cost unavailable')
    const buttons = surface.findAll(node => node.getAttribute('title') === 'Calculated cost price')
    assert.equal(buttons.length, user === authorized ? 2 : 0, 'desktop and mobile cost actions respect permission')
    if (user === authorized) {
      await surface.click(buttons[0])
      assert.deepEqual(opened, [Number(grouped[0].id)], 'merged cost float uses the displayed representative product')
    }
    await surface.unmount()
  }
} finally { await harness.close() }
console.log('PASS Inventory canonical cost precedence, null/zero/invalid values, grouped normalization, signed margin, KHR and permission-scoped detail')
