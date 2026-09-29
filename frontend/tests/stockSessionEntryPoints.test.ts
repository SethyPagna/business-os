import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// UI-STOCK-3 (owner, 30 Sep 2026): every way into a stock change opens the
// ONE Stock Session float, and the saved stock reasons are managed from the
// Manage menus ("manage menu in products pages should also add a reasons
// function"). Each check below also runs against the pre-lane shape
// (base 57cf2db5a) and must refuse it.

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// Products header: Add is one button (icon + "Add"), never a menu.
function headerAddIsOneButton(header: string): boolean {
  return /onClick=\{onAdd\}/.test(header)
    && /const addLabel = tr\('add', 'Add'\)/.test(header)
    && !/addMenuItems|onAddStock/.test(header)
}

// Manage > Reasons: same Tags icon on both pages, gated on the grant the
// Worker checks for PUT /api/inventory/reasons (inventory edit_reasons).
function productsManageHasReasons(header: string, products: string): boolean {
  return /\.\.\.\(onManageReasons \? \[\{ label: reasonsLabel, onClick: onManageReasons, icon: <Tags className=\{iconClass\} \/> \}\] : \[\]\)/.test(header)
    && /const reasonsLabel = tr\('reasons', 'Reasons'\)/.test(header)
    && /onManageReasons=\{canEditStockReasons \? \(\) => setReasonsManagerOpen\(true\) : undefined\}/.test(products)
    && /const canEditStockReasons = can\('inventory', 'edit_reasons'\)/.test(products)
}

const OLD_HEADER = `
  const addMenuItems: PortalMenuItem[] = [
    ...(onAddStock ? [{ label: addStockLabel, onClick: onAddStock, color: 'blue' as const, icon: <Boxes className={iconClass} /> }] : []),
    ...(onAdd ? [{ label: addNewProductLabel, onClick: onAdd, color: 'green' as const, icon: <PackagePlus className={iconClass} /> }] : []),
  ]
  const productLabel = tr('add_products', 'Add products')
          onClick={(addMenuItems[0] as { onClick?: () => void }).onClick}
`
const OLD_PRODUCTS = `
            onManageCats={canManageLookups ? ()=>setModal('cats') : undefined}
`

const header = read('../src/components/products/surfaces/HeaderActions.tsx')

runTest('the checks refuse the pre-lane sources', () => {
  assert.equal(headerAddIsOneButton(OLD_HEADER), false)
  assert.equal(productsManageHasReasons(OLD_HEADER, OLD_PRODUCTS), false)
})

runTest('Products header Add is one button reading Add', () => {
  assert.ok(headerAddIsOneButton(header))
})

if (failed > 0) process.exitCode = 1
