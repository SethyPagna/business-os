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
const balanceTiles = (html: string) => {
  const block = /data-testid="stock-record-balance"[^>]*>(.*?)<\/div><\/div><\/div>/.exec(html)
  assert.ok(block, 'the balance block renders')
  return [...block[0].matchAll(/tabular-nums[^"]*">([^<]*)</g)].map((match) => match[1])
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
  assert.deepEqual(balanceTiles(html), ['…', '−3 pcs', '…'])
  assert.match(html, /aria-busy="true"/)
})

runTest('once read, it shows stock before -> the signed movement -> after', () => {
  const html = renderFloat(sale, { id: 77, value: { before_qty: 12, after_qty: 9 }, failed: false })
  assert.deepEqual(balanceTiles(html), ['12 pcs', '−3 pcs', '9 pcs'])
  const receipt = renderFloat({ ...sale, movement_type: 'add', quantity: 4 }, { id: 77, value: { before_qty: 9, after_qty: 13 }, failed: false })
  assert.deepEqual(balanceTiles(receipt), ['9 pcs', '+4 pcs', '13 pcs'])
})

runTest('an underivable or failed balance reads "—", never a guessed number, and a stale one is ignored', () => {
  assert.deepEqual(balanceTiles(renderFloat(sale, { id: 77, value: { before_qty: null, after_qty: null }, failed: false })), ['—', '−3 pcs', '—'])
  const failedHtml = renderFloat(sale, { id: 77, value: null, failed: true })
  assert.deepEqual(balanceTiles(failedHtml), ['—', '−3 pcs', '—'])
  assert.ok(failedHtml.includes('could not be read'))
  assert.deepEqual(balanceTiles(renderFloat(sale, { id: 76, value: { before_qty: 1, after_qty: 2 }, failed: false })), ['…', '−3 pcs', '…'])
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
