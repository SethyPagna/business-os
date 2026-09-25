// U-records: a Movements-tab row opened the PRODUCT's detail card, which says
// what the product is now and nothing about what that movement did. It now
// opens the movement's own record float -- stock before -> the movement ->
// stock after -- reusing the stock-in line float's balance block
// (shared/StockLineChange.tsx), with the product card one tap away.
//
// Pinned here:
//   1. the row's click goes to the movement float, never straight to the
//      product card (fails on the old surface);
//   2. the float, RENDERED, shows the real record on first paint, the
//      balance as pending while it is read, then before / signed movement /
//      after; an out movement reads as a minus;
//   3. the balance comes from the Worker's one-statement endpoint, which uses
//      the same set-based helper as the stock-in lines;
//   4. the float is beside, not inside, another modal; both packs carry
//      the new string.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import * as movementGroups from '../src/components/inventory/movementGroups.ts'
import * as historyRowModel from '../src/utils/historyRowModel.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.join(here, '..', 'src')
const read = (rel: string) => fs.readFileSync(path.join(srcRoot, rel), 'utf8')
const require = createRequire(import.meta.url)

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

function transpile(rel: string, mockedRequire: (id: string) => unknown): Record<string, any> {
  const code = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} as Record<string, any> }
  new Function('require', 'module', 'exports', code)(mockedRequire, module, module.exports)
  return module.exports
}

const stockLineChange = transpile('components/shared/StockLineChange.tsx', (id) => {
  if (id === 'react/jsx-runtime') return require(id)
  throw new Error(`Unexpected dependency: ${id}`)
})

function renderFloat(movement: Record<string, unknown>, balanceState: unknown): string {
  let loads = 0
  const exports = transpile('components/inventory/MovementDetailFloat.tsx', (id) => {
    if (id === 'react') return { ...React, useState: () => [balanceState, () => {}], useEffect: () => {} }
    if (id === 'react/jsx-runtime') return require(id)
    if (id.includes('StockLineChange')) return stockLineChange
    if (id.includes('movementGroups')) return movementGroups
    if (id.includes('historyRowModel')) return historyRowModel
    if (id.includes('Modal')) return { default: ({ title, children }: { title: string; children: React.ReactNode }) => React.createElement('section', { 'data-title': title }, children) }
    throw new Error(`Unexpected dependency: ${id}`)
  })
  const html = renderToStaticMarkup(React.createElement(exports.default, {
    movement,
    t: () => undefined,
    fmtTime: (value: unknown) => `at ${String(value)}`,
    loadBalance: () => { loads += 1; return Promise.resolve(null) },
    onOpenProduct: () => {},
    onClose: () => {},
  }))
  assert.equal(loads, 0, 'rendering itself never fetches; the effect does')
  return html
}

const sale = { id: 77, product_id: 5, product_name: 'Cream', movement_type: 'sale', quantity: 3, unit: 'pcs', created_at: '2026-09-20 10:00:00', branch_name: 'Shop', user_name: 'dara', reason: 'Walk-in', reference_kind: 'sale', reference_label: '20260920-100000' }
// What the balance block says: the signed movement, then each before -> after
// line as [scope, label, "before → after"] in render order.
const balanceBlock = (html: string) => {
  const start = html.indexOf('data-testid="stock-record-balance"')
  assert.ok(start >= 0, 'the balance block renders')
  const block = html.slice(start)
  const moved = /tabular-nums">([^<]*)</.exec(block)
  assert.ok(moved, 'the movement renders')
  const lines = [...block.matchAll(/data-scope="(branch|total)"[^>]*><dt[^>]*>([^<]*)<\/dt><dd[^>]*>([^<]*)<\/dd>/g)].map((match) => [match[1], match[2], match[3]])
  return { moved: moved[1], lines }
}

runTest('a Movements row opens the movement\'s own float, not the product card', () => {
  const surface = read('components/inventory/InventoryMovementsSurface.tsx')
  assert.match(surface, /onClick=\{\(\) => openMovementDetail\(movement\)\}/)
  assert.doesNotMatch(surface, /openMovementProductDetail/, 'the surface no longer reaches the product card directly')
  const inventory = read('components/inventory/Inventory.tsx')
  assert.match(inventory, /openMovementDetail=\{setMovementDetail\}/)
  assert.match(inventory, /<MovementDetailFloat\b[\s\S]*?onOpenProduct=\{\(\) => \{ const movement = movementDetail; setMovementDetail\(null\); void openMovementProductDetail\(movement\) \}\}/, 'the product card stays one tap away, replacing the float')
})

runTest('first paint is the real record, with the balance marked as being read', () => {
  const html = renderFloat(sale, null)
  assert.match(html, /data-title="Cream"/)
  for (const fact of ['at 2026-09-20 10:00:00', 'Shop', 'dara', 'Walk-in', 'Sale 20260920-100000']) assert.ok(html.includes(fact), `shows ${fact}`)
  assert.deepEqual(balanceBlock(html), { moved: '−3 pcs', lines: [['branch', 'Shop', '… → …'], ['total', 'Total', '… → …']] })
  assert.match(html, /aria-busy="true"/)
})

// Owner, 26 Sep -- the owner's own example. Branch and total DIFFER on every
// number, so the total shown as the branch (or the reverse) fails here.
const twoBranches = { before_qty: 18, after_qty: 15, branch_before_qty: 10, branch_after_qty: 7, active_branch_count: 2 }

runTest('once read, the branch line comes first and the total across branches under it', () => {
  const html = renderFloat(sale, { id: 77, value: twoBranches, failed: false })
  assert.deepEqual(balanceBlock(html), { moved: '−3 pcs', lines: [['branch', 'Shop', '10 pcs → 7 pcs'], ['total', 'Total', '18 pcs → 15 pcs']] })
  const receipt = renderFloat({ ...sale, movement_type: 'add', quantity: 4, branch_name: 'Warehouse' }, { id: 77, value: { before_qty: 11, after_qty: 15, branch_before_qty: 4, branch_after_qty: 8, active_branch_count: 2 }, failed: false })
  assert.deepEqual(balanceBlock(receipt), { moved: '+4 pcs', lines: [['branch', 'Warehouse', '4 pcs → 8 pcs'], ['total', 'Total', '11 pcs → 15 pcs']] })
})

runTest('one active branch: a single line, the redundant Total dropped -- derived from the count, not a flag', () => {
  const merged = renderFloat(sale, { id: 77, value: { before_qty: 10, after_qty: 7, branch_before_qty: 10, branch_after_qty: 7, active_branch_count: 1 }, failed: false })
  assert.deepEqual(balanceBlock(merged).lines, [['branch', 'Shop', '10 pcs → 7 pcs']])
  // the same numbers with two active branches keep both lines
  assert.equal(balanceBlock(renderFloat(sale, { id: 77, value: { before_qty: 10, after_qty: 7, branch_before_qty: 10, branch_after_qty: 7, active_branch_count: 2 }, failed: false })).lines.length, 2)
  // one active branch, but a record from a branch since closed still differs from the total: both stay
  assert.deepEqual(balanceBlock(renderFloat(sale, { id: 77, value: { ...twoBranches, active_branch_count: 1 }, failed: false })).lines.map((line) => line[0]), ['branch', 'total'])
  // an unknown count keeps both
  assert.equal(balanceBlock(renderFloat(sale, { id: 77, value: { ...twoBranches, active_branch_count: null }, failed: false })).lines.length, 2)
})

runTest('an underivable or failed balance reads "—", never a guessed number, and a stale one is ignored', () => {
  const noBranch = renderFloat(sale, { id: 77, value: { before_qty: 18, after_qty: 15, branch_before_qty: null, branch_after_qty: null, active_branch_count: 2 }, failed: false })
  assert.deepEqual(balanceBlock(noBranch).lines, [['branch', 'Shop', '— → —'], ['total', 'Total', '18 pcs → 15 pcs']])
  const failedHtml = renderFloat(sale, { id: 77, value: null, failed: true })
  assert.deepEqual(balanceBlock(failedHtml).lines, [['branch', 'Shop', '— → —'], ['total', 'Total', '— → —']])
  assert.ok(failedHtml.includes('could not be read'))
  assert.deepEqual(balanceBlock(renderFloat(sale, { id: 76, value: twoBranches, failed: false })).lines, [['branch', 'Shop', '… → …'], ['total', 'Total', '… → …']])
})

runTest('stockBalanceLines: branch first, total second, and the one-branch collapse', () => {
  const { stockBalanceLines } = stockLineChange
  const labels = { branch: 'Branch', total: 'Total' }
  assert.deepEqual(stockBalanceLines({ before_qty: 18, after_qty: 15, branch_before_qty: 10, branch_after_qty: 7 }, 'Shop', 2, labels),
    [{ scope: 'branch', label: 'Shop', before: 10, after: 7 }, { scope: 'total', label: 'Total', before: 18, after: 15 }])
  // explicit total_* wins over the compatibility before/after names
  assert.deepEqual(stockBalanceLines({ total_before_qty: 18, total_after_qty: 15, before_qty: 0, after_qty: 0, branch_before_qty: 10, branch_after_qty: 7 }, 'Shop', 2, labels)[1], { scope: 'total', label: 'Total', before: 18, after: 15 })
  // one branch, no branch pair: one line, the total under the branch's name
  assert.deepEqual(stockBalanceLines({ before_qty: 5, after_qty: 6, branch_before_qty: null, branch_after_qty: null }, 'Shop', 1, labels), [{ scope: 'total', label: 'Shop', before: 5, after: 6 }])
  // no branch name falls back to the generic label
  assert.equal(stockBalanceLines({ before_qty: 1, after_qty: 2, branch_before_qty: 1, branch_after_qty: 2 }, '', 2, labels)[0].label, 'Branch')
})

runTest('the balance is the Worker\'s one-statement read, the same helper as the stock-in lines', () => {
  const transport = read('api/inventoryTransport.ts')
  assert.match(transport, /apiFetch\('GET', `\/api\/inventory\/movements\/\$\{movementId\}\/balance`\)/)
  const route = fs.readFileSync(path.join(here, '..', '..', 'cloudflare', 'src', 'routes', 'inventory.ts'), 'utf8')
  const handler = route.slice(route.indexOf("app.get('/movements/:id/balance'"))
  assert.ok(handler.length > 0 && /loadMovementStockBalances\(getDb\(c\.env\), \[id\]\)/.test(handler.slice(0, 600)))
  assert.match(read('components/inventory/Inventory.tsx'), /getInventoryApi\(\)\.getInventoryMovementBalance\(id\)/)
})

runTest('the float is its own modal, beside the others, and both packs carry its string', () => {
  const inventory = read('components/inventory/Inventory.tsx')
  const file = ts.createSourceFile('Inventory.tsx', inventory, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let nested = false
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText() === 'MovementDetailFloat') {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (ts.isJsxElement(parent) && /(Modal|Float|Dialog|Sheet)$/.test(parent.openingElement.tagName.getText())) nested = true
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.equal(nested, false)
  const en = JSON.parse(read('lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('lang/km.json')) as Record<string, string>
  assert.ok(en.stock_balance_unavailable && km.stock_balance_unavailable && km.stock_balance_unavailable !== en.stock_balance_unavailable)
})

if (failed) { console.error(`\n${failed} movement record float test(s) failed`); process.exit(1) }
console.log('PASS movementRecordFloat')
