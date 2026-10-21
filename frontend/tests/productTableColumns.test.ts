// Lane 6.0.873 -- the Products desktop table is Excel-style by default, with
// role-aware columns (owner, 19 Oct 2026: useful information shown by default;
// Employees see product details but NEVER cost; they edit everything except
// prices and supplier; barcode search stays allowed).
//
// Behavioural where a render can prove it (the real list surface and the real
// cell components are bundled and rendered), source-shaped only where the
// subject is a request or a JSX branch that cannot be mounted without the
// whole app. Every case fails on the base: the module under test did not exist.
//
// Run: node tests/productTableColumns.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { headOf, loadSource, renderSurface } from './productsSurfaceFixture.ts'
import {
  PRODUCT_COLUMNS,
  buildStockCellModel,
  chooserHostKey,
  defaultProductColumns,
  parseStoredProductColumns,
  productChooserColumns,
  productColumnsFor,
  productColumnsStorageKey,
  productColumnsSurfaceKey,
  productTableMinWidthRem,
  productTableSpans,
  visibleProductColumns,
} from '../src/components/products/config/productTableColumns.ts'
import { useColumnPreferences } from '../src/components/shared/useColumnPreferences.ts'

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}
const src = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

const DEFAULT_ADMIN_KEYS = ['barcode', 'category', 'brand', 'unit', 'stock', 'selling', 'wholesale', 'supplier', 'cost', 'margin']
const OPTIONAL_KEYS = ['sku', 'discount', 'lots', 'lowStock', 'description', 'updated']
const admin = productColumnsFor({ canViewCosts: true })
const employee = productColumnsFor({ canViewCosts: false })
const keysOf = (columns: readonly { key: string }[]) => columns.map((column) => column.key)

await runTest('default columns match the design: ten shown for a cost-viewer, six optional and off', () => {
  assert.deepEqual(keysOf(admin).filter((key) => defaultProductColumns(admin).has(key)), DEFAULT_ADMIN_KEYS)
  assert.deepEqual(keysOf(admin).filter((key) => !defaultProductColumns(admin).has(key)), OPTIONAL_KEYS)
  assert.deepEqual(keysOf(admin), [...DEFAULT_ADMIN_KEYS, ...OPTIONAL_KEYS], 'fixed order: defaults first, optional after')
})

await runTest('a user without product_cost_view has no Cost or Margin column at all (not locked, absent)', () => {
  assert.deepEqual(keysOf(employee), keysOf(admin).filter((key) => key !== 'cost' && key !== 'margin'))
  assert.ok(!defaultProductColumns(employee).has('cost') && !defaultProductColumns(employee).has('margin'))
  assert.ok(keysOf(PRODUCT_COLUMNS).includes('cost'), 'positive control: the admin set does carry cost')
  const chooser = productChooserColumns(employee, (key) => key).map((column) => column.key)
  assert.ok(!chooser.includes('cost') && !chooser.includes('margin'), 'the chooser must not offer a column the role cannot have')
  assert.deepEqual(chooser.slice(0, 2), ['image', 'name'], 'Image and Name are listed first and are required')
  assert.ok(productChooserColumns(employee, (key) => key).slice(0, 2).every((column) => column.required === true))
})

await runTest('a saved choice containing cost, read under an Employee, returns without cost', () => {
  const saved = JSON.stringify(['barcode', 'cost', 'margin', 'selling', 'sku', 'gone'])
  const parsed = parseStoredProductColumns(saved, employee)
  assert.ok(parsed)
  assert.deepEqual([...parsed].sort(), ['barcode', 'selling', 'sku'])
  assert.deepEqual([...parseStoredProductColumns(saved, admin)!].sort(), ['barcode', 'cost', 'margin', 'selling', 'sku'], 'control: the same blob keeps cost for a cost-viewer')
  // Defence in depth: even a visibility set that names cost cannot render it.
  assert.ok(!keysOf(visibleProductColumns(employee, () => true)).includes('cost'))
  assert.ok(!keysOf(visibleProductColumns(employee, () => true)).includes('margin'))
})

await runTest('the choice is stored per user: one sign-in never reads another\'s columns', () => {
  assert.equal(productColumnsSurfaceKey(7), 'products.v1.u7')
  assert.notEqual(productColumnsSurfaceKey(7), productColumnsSurfaceKey(8))
  assert.equal(productColumnsStorageKey(7), 'bos_table_columns_products.v1.u7')
  const store = new Map<string, string>([[productColumnsStorageKey(7), JSON.stringify(['sku'])]])
  Object.assign(globalThis, { localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } } })
  const Probe = ({ id }: { id: number }) => {
    const prefs = useColumnPreferences(productColumnsSurfaceKey(id), admin)
    return React.createElement('i', null, [...prefs.visible].sort().join(','))
  }
  assert.equal(renderToStaticMarkup(React.createElement(Probe, { id: 7 })), '<i>sku</i>', 'user 7 reads their own saved choice')
  assert.equal(
    renderToStaticMarkup(React.createElement(Probe, { id: 8 })),
    `<i>${[...defaultProductColumns(admin)].sort().join(',')}</i>`,
    'user 8 has saved nothing and gets the role default, not user 7\'s choice',
  )
})

await runTest('spans are derived from the visible columns, never hard-coded', () => {
  assert.deepEqual(productTableSpans([]), { group: 1, band: 2, row: 3 })
  const ten = visibleProductColumns(admin, (key) => defaultProductColumns(admin).has(key))
  assert.deepEqual(productTableSpans(ten), { group: 11, band: 12, row: 13 })
  assert.ok(productTableMinWidthRem(ten) > productTableMinWidthRem(ten.slice(0, 3)), 'more columns -> a wider scrolling table')
  const surfaceSource = src('components/products/surfaces/ProductsListSurface.tsx')
  assert.doesNotMatch(surfaceSource, /colSpan=\{\d+\}/, 'no numeric colSpan may remain in the list surface')
})

const thCount = (html: string) => (headOf(html).match(/<th[\s>]/g) || []).length

await runTest('an Employee fixture renders no Cost or Margin <th>; an admin fixture does', () => {
  const employeeHead = headOf(renderSurface(visibleProductColumns(employee, (key) => defaultProductColumns(employee).has(key))))
  assert.doesNotMatch(employeeHead, /data-column="cost"|data-column="margin"/)
  assert.ok(!employeeHead.includes('>cost<') && !employeeHead.includes('>margin<'))
  const adminHead = headOf(renderSurface(visibleProductColumns(admin, (key) => defaultProductColumns(admin).has(key))))
  assert.match(adminHead, /data-column="cost"/)
  assert.match(adminHead, /data-column="margin"/)
})

await runTest('every full-width row spans exactly the rendered <th> count at 0, 1 and 3 optional columns', () => {
  const base = visibleProductColumns(admin, (key) => defaultProductColumns(admin).has(key))
  for (const extra of [[], ['sku'], ['sku', 'lots', 'updated']]) {
    const shown = visibleProductColumns(admin, (key) => defaultProductColumns(admin).has(key) || extra.includes(key))
    assert.equal(shown.length, base.length + extra.length)
    const html = renderSurface(shown)
    const total = thCount(html)
    assert.equal(total, 3 + shown.length, `${extra.length} optional: select + image + name + ${shown.length} data headers`)
    const spans = [...html.matchAll(/colSpan="(\d+)"/g)].map((match) => Number(match[1]))
    // The band spans from the image column (total - 1) and the group title from the name column (total - 2).
    assert.deepEqual(spans.sort((a, b) => a - b), [total - 2, total - 1], `${extra.length} optional: band and group spans must match the header`)
  }
  assert.match(renderSurface([], { visibleProducts: [] }), /colSpan="3"/, 'with no data column the empty row spans select + image + name')
  assert.match(renderSurface(base, { visibleProducts: [], productSections: [] }), new RegExp(`colSpan="${3 + base.length}"`))
})

await runTest('the chooser lives in the last header cell, headers are single-line with a title, pinned cells are opaque', () => {
  const shown = visibleProductColumns(admin, (key) => defaultProductColumns(admin).has(key))
  const html = renderSurface(shown)
  const head = headOf(html)
  assert.equal((head.match(/data-chooser/g) || []).length, 1, 'exactly one chooser button')
  assert.ok(head.indexOf('data-chooser') > head.indexOf('data-column="margin"'), 'the chooser sits in the last header (Margin)')
  assert.match(head, /<th title="barcode" data-column="barcode"/, 'a header carries its full label as a title')
  assert.match(head, /<th title="[^"]*" data-column="[a-zA-Z]+" class="truncate whitespace-nowrap/, 'headers truncate on one line')
  assert.equal(chooserHostKey(shown), 'margin')
  assert.equal(chooserHostKey([]), 'name')
  // Group row cells that are pinned must carry an opaque background class.
  const pinned = [...html.matchAll(/<td class="[^"]*\bsticky\b[^"]*"/g)].map((match) => match[0])
  assert.ok(pinned.length >= 2, 'the group row pins its select and image cells')
  for (const cell of pinned) assert.match(cell, /\bbg-(white|slate-100)\b/, `pinned cell must be opaque: ${cell}`)
  assert.match(html, /<table class="[^"]*table-fixed[^"]*" style="min-width:[\d.]+rem"/, 'the table scrolls inside its own container via its declared minimum width')
})

await runTest('stock cell: branch filter shows that branch only; sole branch is a chip; several branches list with Inactive marked', () => {
  const two = { branch_stock: [
    { branch_id: 1, branch_name: 'Warehouse', quantity: 5, branch_active: 1 },
    { branch_id: 2, branch_name: 'Shop', quantity: 7, branch_active: 1 },
  ] }
  assert.deepEqual(buildStockCellModel(two, { branchFilter: '2', selectedBranchName: 'Shop', soleBranchName: '' }), { chip: 'Shop', lines: [] })
  const several = buildStockCellModel(two, { branchFilter: 'all', selectedBranchName: '', soleBranchName: '' })
  assert.equal(several.chip, '')
  assert.deepEqual(several.lines.map((line) => [line.name, line.quantity, line.inactive]), [['Warehouse', 5, false], ['Shop', 7, false]])
  const sole = { branch_stock: [
    { branch_id: 1, branch_name: 'LC Store', quantity: 12, branch_active: 1 },
    { branch_id: 2, branch_name: 'Old Shop', quantity: 0, branch_active: 0 },
  ] }
  assert.deepEqual(buildStockCellModel(sole, { branchFilter: 'all', selectedBranchName: '', soleBranchName: 'LC Store' }), { chip: 'LC Store', lines: [] }, 'one active branch + empty retired line = a chip, the retired line is dropped')
  const retiredWithStock = { branch_stock: [
    { branch_id: 1, branch_name: 'LC Store', quantity: 12, branch_active: 1 },
    { branch_id: 2, branch_name: 'Old Shop', quantity: 3, branch_active: 0 },
  ] }
  const kept = buildStockCellModel(retiredWithStock, { branchFilter: 'all', selectedBranchName: '', soleBranchName: 'LC Store' })
  assert.deepEqual(kept.lines.map((line) => [line.name, line.inactive]), [['LC Store', false], ['Old Shop', true]], 'a retired branch holding stock stays, marked inactive')
  assert.deepEqual(buildStockCellModel({}, { branchFilter: 'all', selectedBranchName: '', soleBranchName: 'LC Store' }), { chip: 'LC Store', lines: [] }, 'no branch rows at all still names the sole branch')
})

const partsModule = await loadSource('components/products/surfaces/ProductRowParts.tsx')
const PriceCell = partsModule.ProductPriceCell as React.ComponentType<Record<string, unknown>>
const SupplierCell = partsModule.ProductSupplierCell as React.ComponentType<Record<string, unknown>>
const StockCell = partsModule.ProductStockCell as React.ComponentType<Record<string, unknown>>

await runTest('locked cells are muted with a lock and a translated tooltip; editable ones are not', () => {
  const props = { usd: 5, khr: 20500, tone: 'selling', fmtUSD: (v: number) => `$${v}`, fmtKHR: (v: number) => `${v}៛` }
  const locked = renderToStaticMarkup(React.createElement(PriceCell, { ...props, lockTip: 'No price permission' }))
  assert.match(locked, /aria-label="No price permission"/)
  assert.match(locked, /title="No price permission"/)
  assert.match(locked, /text-gray-500/, 'muted ink')
  assert.doesNotMatch(locked, /text-green-700/)
  assert.match(locked, /20500៛/, 'riel is the second line')
  const open = renderToStaticMarkup(React.createElement(PriceCell, props))
  assert.doesNotMatch(open, /aria-label=/)
  assert.match(open, /text-green-700/)
  assert.match(renderToStaticMarkup(React.createElement(PriceCell, { ...props, tone: 'wholesale', usd: 0, khr: 0 })), /—/, 'no wholesale price reads as a dash')
  const supplier = renderToStaticMarkup(React.createElement(SupplierCell, { supplier: 'Acme', lockTip: 'Open the product', tr: (_k: string, f: string) => f }))
  assert.match(supplier, /Acme/)
  assert.match(supplier, /aria-label="Open the product"/)
})

await runTest('stock cell renders the sole-branch chip, and an inactive branch greyed with its (Inactive) tag', () => {
  const chip = renderToStaticMarkup(React.createElement(StockCell, { qty: 12, qtyClassName: 'text-green-600', unitChip: null, totalLabel: 'Total', inactiveLabel: 'Inactive', model: { chip: 'LC Store', lines: [] } }))
  assert.match(chip, /data-stock-branch-chip/)
  assert.match(chip, /LC Store/)
  const list = renderToStaticMarkup(React.createElement(StockCell, { qty: 15, qtyClassName: '', unitChip: null, totalLabel: 'Total', inactiveLabel: 'Inactive', model: { chip: '', lines: [{ key: '1', name: 'LC Store', quantity: 12, inactive: false }, { key: '2', name: 'Old Shop', quantity: 3, inactive: true }] } }))
  assert.match(list, /data-stock-branch-line="active"/)
  assert.match(list, /data-stock-branch-line="inactive"[^>]*>[\s\S]*Old Shop \(Inactive\)/)
  assert.match(list, /title="Total"/)
})

const products = src('components/products/Products.tsx')

await runTest('hiding a column changes no request: the list load never reads the column state', () => {
  const includes = [...products.matchAll(/include: 'branch_stock,images,batches[a-z_,]*'/g)].map((match) => match.index ?? 0)
  assert.ok(includes.length >= 2, 'positive control: the product requests are findable')
  for (const at of includes) {
    const around = products.slice(Math.max(0, at - 3500), at + 600)
    assert.doesNotMatch(around, /productColumns|columnPrefs|visibleProductColumns|productColumnDefs/, 'a request builder must not depend on which columns are shown')
  }
  const loadAt = products.indexOf('const load = useCallback')
  assert.ok(loadAt > 0, 'positive control: load exists')
  assert.doesNotMatch(products.slice(loadAt, loadAt + 9000), /productColumns|columnPrefs/, 'load() must not read the column state')
  assert.match(products, /const columnPrefs = useColumnPreferences\(productColumnsSurfaceKey\(user\?\.id\), productColumnDefs\)/, 'positive control: the prefs are wired per user')
  assert.match(products, /<ProductsFullEditor key=\{String\(user\?\.id \?\? 'anon'\)\} \/>/, 'the editor remounts per user so the stored choice is read for the right person')
})

await runTest('mobile card: without cost access the price strip has a single divider before the quantity', () => {
  const at = products.indexOf('<div className="price-strip mt-1">')
  const end = products.indexOf('\n            </div>', at)
  assert.ok(at > 0 && end > at)
  let strip = products.slice(at, end)
  const costBlock = strip.indexOf('{canViewCosts ? (')
  assert.ok(costBlock > 0, 'positive control: the cost block is a conditional')
  const costEnd = strip.indexOf('</>\n              ) : null}', costBlock)
  assert.ok(costEnd > costBlock, 'the cost divider and the cost button live in ONE fragment under the permission')
  assert.match(strip.slice(costBlock, costEnd), /price-strip-divider[\s\S]*openCostFloat\(p\)/, 'the divider before the cost sits with the cost')
  strip = strip.slice(0, costBlock) + strip.slice(costEnd + '</>\n              ) : null}'.length)
  const wholesale = strip.indexOf('{wholesaleUsd > 0 ? (')
  assert.ok(wholesale > 0)
  const wholesaleEnd = strip.indexOf(') : null}', wholesale)
  strip = strip.slice(0, wholesale) + strip.slice(wholesaleEnd + ') : null}'.length)
  assert.equal((strip.match(/price-strip-divider/g) || []).length, 1, 'selling | qty, nothing else')
})

await runTest('locked table cells declare aria-readonly and the new tooltip key is in both language packs', () => {
  assert.match(products, /aria-readonly=\{locked \? true : undefined\}/)
  assert.match(products, /tr\('product_supplier_read_only'/)
  assert.match(products, /tr\('product_price_read_only'/)
  for (const pack of ['en', 'km']) {
    const json = JSON.parse(src(`lang/${pack}.json`)) as Record<string, string>
    assert.ok(json.product_supplier_read_only && json.product_supplier_read_only.length > 10, `${pack}.json carries product_supplier_read_only`)
    for (const column of PRODUCT_COLUMNS) assert.ok(json[column.label], `${pack}.json carries the header key ${column.label}`)
  }
  const en = JSON.parse(src('lang/en.json')) as Record<string, string>
  const km = JSON.parse(src('lang/km.json')) as Record<string, string>
  assert.notEqual(km.product_supplier_read_only, en.product_supplier_read_only, 'no English placeholder in km.json')
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll productTableColumns tests passed')
