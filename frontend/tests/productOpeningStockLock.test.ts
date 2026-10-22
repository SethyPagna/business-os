// The product form's opening stock box on a NEW product (lane 6.0.945, release review P3-1).
//
// A starting quantity on a new product is a stock-in. The Worker refuses it with a 403 for anyone without Inventory >
// Adjust / receive at Full (routes/products.ts openingStockRefusal -> lib/createFold.ts foldStockInPermissionRefusal),
// and the role editor already says so (the "Opening stock" control requires inventory:adjust). The form used to let such
// a role type a number and then fail on Save. It now locks the box, read-only, with a translated tooltip and a visible
// line that say who can set it. The real form is mounted: a role is whatever `effectivePermissions` makes of it.
//
// Run: node tests/productOpeningStockLock.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createHarness, propsOf, type MountedSurface } from './mountedComponentHarness.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>

let failed = 0
// The harness reads one shared document, so a test that throws before unmounting would hand its form to the next one.
const live: MountedSurface[] = []
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) } finally {
    for (const surface of live.splice(0)) await surface.unmount().catch(() => undefined)
  }
}

const harness = await createHarness({ observe: ['api/methods.ts'] })
const doubles = { 'api/methods.ts': { searchProducts: async () => ({ items: [] }), getProductFilters: async () => ({ categories: [], brands: [] }) } }

const staff = (permissions: Record<string, unknown>, role_code = 'staff') => ({ id: 5, username: 'sok', role_code, permissions: JSON.stringify(permissions) })

async function mountForm(user: Record<string, unknown>, options: { product?: Record<string, unknown> | null; language?: Record<string, string> } = {}): Promise<MountedSurface> {
  const language = options.language ?? en
  localStorage.clear()
  const surface = await harness.mount({
    component: 'components/products/forms/ProductForm.tsx',
    props: {
      product: options.product ?? null, categories: [], units: [], branches: [], user, usdSymbol: '$', khrSymbol: '៛', exchangeRate: 4100, initialTab: 'stock',
      t: (key: string) => language[key] ?? '', onClose() {}, onSave: async () => {},
    },
    app: { user, t: (key: string) => language[key] ?? '', notify() {}, settings: {} },
    doubles,
  })
  live.push(surface)
  return surface
}

const stockBox = (form: MountedSurface) => form.find((node) => node.id === 'product-stock-quantity', 'the opening stock box')
const typeInto = async (form: MountedSurface, value: string) => { await act(async () => { (propsOf(stockBox(form)).onChange as (event: unknown) => void)({ target: { value } }) }) }
const lockLine = (form: MountedSurface) => form.findAll((node) => node.id === 'product-stock-quantity-lock')

const LOCKED_ROLES: Array<[string, Record<string, unknown>]> = [
  ['Products Full with no Inventory grant at all', { products: true }],
  ['Inventory at Review (Adjust / receive is Full only)', { products: true, inventory: 'review' }],
  ['Inventory Full with Adjust / receive switched off', { products: true, inventory: true, 'inventory:adjust': false }],
  ['Inventory explicitly off', { products: true, inventory: false }],
]
for (const [name, permissions] of LOCKED_ROLES) {
  await test(`${name}: the box is locked, says who can set it, and a typed number does not stick`, async () => {
    const form = await mountForm(staff(permissions))
    const box = stockBox(form)
    assert.equal(propsOf(box).readOnly, true, 'read-only')
    assert.equal(box.getAttribute('aria-readonly'), 'true')
    assert.equal(box.getAttribute('title'), en.product_opening_stock_needs_adjust, 'the tooltip names the permission')
    assert.equal(lockLine(form).length, 1, 'and a visible line says it too, because a tooltip does not exist on a phone')
    assert.equal(box.getAttribute('aria-describedby'), 'product-stock-quantity-lock')
    await typeInto(form, '25')
    assert.equal(propsOf(stockBox(form)).value, 0, 'a number typed into a locked box is ignored')
  })
}

const OPEN_ROLES: Array<[string, Record<string, unknown>, string]> = [
  ['Inventory Full', { products: true, inventory: true }, 'staff'],
  ['an administrator', { all: true }, 'admin'],
]
for (const [name, permissions, role] of OPEN_ROLES) {
  await test(`${name}: the box takes a number, with no lock text`, async () => {
    const form = await mountForm(staff(permissions, role))
    assert.notEqual(propsOf(stockBox(form)).readOnly, true)
    assert.equal(stockBox(form).getAttribute('title'), null)
    assert.equal(lockLine(form).length, 0)
    await typeInto(form, '25')
    assert.equal(propsOf(stockBox(form)).value, '25')
  })
}

await test('an existing product keeps its own read-only rule and shows the Adjust stock hint, not the opening stock lock', async () => {
  for (const permissions of [{ products: true }, { products: true, inventory: true }]) {
    const form = await mountForm(staff(permissions), { product: { id: 9, name: 'Existing', stock_quantity: 12 } })
    assert.equal(propsOf(stockBox(form)).readOnly, true)
    assert.equal(lockLine(form).length, 0, 'the lock line is for a new product only')
    assert.equal(stockBox(form).getAttribute('title'), null)
    await form.unmount()
  }
})

await test('in Khmer the tooltip and the line are the Khmer words', async () => {
  const form = await mountForm(staff({ products: true }), { language: km })
  assert.equal(stockBox(form).getAttribute('title'), km.product_opening_stock_needs_adjust)
  assert.ok(lockLine(form)[0].textContent.includes(km.product_opening_stock_needs_adjust))
  assert.ok(!/[A-Za-z]/.test(km.product_opening_stock_needs_adjust), 'no English left in the Khmer text')
  assert.notEqual(km.product_opening_stock_needs_adjust, en.product_opening_stock_needs_adjust)
})

await test('the form asks the same question the Worker and the role editor ask', async () => {
  const form = read('../src/components/products/forms/ProductForm.tsx')
  assert.match(form, /function canSetOpeningStock\(user\?: ProductUser \| null\): boolean \{\s*return effectivePermissions\(user\)\.can\('inventory', 'adjust'\)\s*\}/)
  assert.match(form, /const openingStockLocked = isCreateMode && !canSetOpeningStock\(user\)/)
  const worker = read('../../cloudflare/src/lib/createFold.ts')
  assert.match(worker, /function foldStockInPermissionRefusal\(user: SessionUser \| null\)[\s\S]{0,200}getActionTier\(user, 'inventory', 'adjust'\) === 'full'/, 'the Worker refuses unless Inventory > Adjust / receive is Full')
  const actions = read('../src/utils/permissionActions.ts')
  assert.match(actions, /const INVENTORY_ADJUST: ActionRequirement = \{ key: 'inventory:adjust'/)
  assert.match(actions, /key: 'opening_stock'[^\n]*requires: \[INVENTORY_ADJUST\]/, 'the role editor lists opening stock as needing inventory:adjust')
})

await harness.close()
if (failed) {
  console.error(`\n${failed} test(s) FAILED`)
  process.exitCode = 1
} else console.log('\nall tests passed')
