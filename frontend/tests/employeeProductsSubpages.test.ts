// Owner, 5 Oct 2026 (evening): an Employee sees ONLY the main Products page (information + images). Every Products
// sub-page / tab is hidden for the Employee preset and refused by the Worker
// (cloudflare/scripts/test-employee-products-default-native.cjs, "reaches ONLY the main Products page").
//
//   TABS    getHubDestinations('products') offers just 'products' to the Employee preset; a Full Products role keeps all
//           the sections its other grants allow; products:history off narrows any role
//   MODAL   the product detail modal does not mount the sales / supplier history report without products:history
//
// Run: node tests/employeeProductsSubpages.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getHubDestinations } from '../src/components/shared/hubNavigation.ts'
import { effectivePermissions, type PermissionUser } from '../src/utils/permissions.ts'
import { ROLE_PRESETS } from '../src/components/users/rolePresetDefaults.ts'

const access = (user: PermissionUser) => {
  const { getPermissionTier, hasPermission, can } = effectivePermissions(user)
  return { getPermissionTier, hasPermission, can }
}
const sections = (user: PermissionUser) => getHubDestinations('products', access(user)).map((item) => item.id)
const EMPLOYEE: PermissionUser = { role_code: 'employee', permissions: ROLE_PRESETS.find((preset) => preset.key === 'employee')!.permissions }
const MANAGER: PermissionUser = { role_code: 'manager', permissions: { products: true, inventory: true, 'inventory:adjust': true } }
const MANAGER_NO_HISTORY: PermissionUser = { role_code: 'manager', permissions: { products: true, inventory: true, 'products:history': false } }
const ADMIN: PermissionUser = { role_code: 'admin', permissions: {} }

let failed = 0
function test(name: string, run: () => void) {
  try { run(); console.log('PASS ' + name) } catch (error) { failed += 1; console.error('FAIL ' + name, error) }
}
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r/g, '')

test('TABS: the Employee preset is offered the main Products page and nothing else', () => {
  assert.deepEqual(sections(EMPLOYEE), ['products'])
  // Even with an Inventory grant stacked on, the history action stays off for the preset.
  assert.deepEqual(sections({ ...EMPLOYEE, permissions: { ...(EMPLOYEE.permissions as object), inventory: true, 'inventory:adjust': true } }), ['products'])
})

test('TABS: a Full Products role keeps its sub-pages, products:history off narrows them, an administrator is never narrowed', () => {
  assert.deepEqual(sections(MANAGER), ['products', 'stock_changes', 'stock_in_sessions', 'duplicates'])
  assert.deepEqual(sections(MANAGER_NO_HISTORY), ['products', 'duplicates'], 'history off removes the two ledger sections, Duplicates has its own action')
  assert.deepEqual(sections(ADMIN), ['products', 'stock_changes', 'stock_in_sessions', 'duplicates'])
})

test('TABS: Duplicates needs its own merge action, so the Employee never gets it and a merger without history still does', () => {
  assert.ok(!sections(EMPLOYEE).includes('duplicates'))
  assert.ok(sections({ role_code: 'manager', permissions: { products: true, 'products:history': false } }).includes('duplicates') === true)
})

test('MODAL: the sales / supplier history report is mounted only with products:history', () => {
  const modal = read('../src/components/products/surfaces/ProductDetailModal.tsx')
  assert.match(modal, /const canReadProductHistory = can \? can\('products', 'history'\) : false/)
  assert.match(modal, /\{productId > 0 && canReadProductHistory \? \(/)
})

test('PACKS: the new action row has text in both languages', () => {
  for (const lang of ['en', 'km']) {
    const pack = JSON.parse(readFileSync(new URL('../src/lang/' + lang + '.json', import.meta.url), 'utf8')) as Record<string, string>
    assert.ok(pack.perm_act_products_history, lang)
    if (lang === 'km') assert.match(pack.perm_act_products_history, /[ក-៿]/)
  }
  const preset = ROLE_PRESETS.find((p) => p.key === 'employee')!.permissions as Record<string, unknown>
  assert.equal(preset['products:history'], false)
  const seed = read('../../cloudflare/src/lib/coreDataInvariants.ts')
  assert.match(seed, /'products:history': false,/)
})

process.exitCode = failed ? 1 : 0
