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
  // what a sighted reader sees in each <dd>: the screen-reader-only words
  // dropped, the arrow kept
  const visible = (dd: string) => dd.replace(/<span class="sr-only">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '')
  const lines = [...block.matchAll(/data-scope="(branch|total)"[^>]*><dt[^>]*>([^<]*)<\/dt><dd[^>]*>(.*?)<\/dd>/g)].map((match) => [match[1], match[2], visible(match[3])])
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

runTest('one active branch and no branch pair: the float says Total, not the branch name', () => {
  const html = renderFloat({ ...sale, branch_name: 'Store' }, { id: 77, value: { before_qty: 18, after_qty: 15, branch_before_qty: null, branch_after_qty: null, active_branch_count: 1 }, failed: false })
  assert.deepEqual(balanceBlock(html).lines, [['total', 'Total', '18 pcs → 15 pcs']])
})

runTest('the balance list is valid <dl> markup, read by its own words (no aria-label override)', () => {
  const html = renderFloat(sale, { id: 77, value: twoBranches, failed: false })
  const block = html.slice(html.indexOf('data-testid="stock-record-balance"'))
  const dl = /<dl>(.*?)<\/dl>/.exec(block)
  assert.ok(dl, 'the balance lines are a <dl>')
  // every direct child is a <div> holding exactly one <dt> then one <dd>
  const groups = [...dl[1].matchAll(/<div [^>]*>(<dt[^>]*>.*?<\/dt>)(<dd[^>]*>.*?<\/dd>)<\/div>/g)]
  assert.equal(groups.map((group) => group[0]).join(''), dl[1], 'nothing but dt/dd groups inside the <dl>')
  assert.equal(groups.length, 2)
  assert.doesNotMatch(block, /<dd[^>]*aria-label/, 'no <dd> hides its text behind an aria-label')
  assert.match(block, /<div aria-hidden="true"[^>]*>Before → After<\/div><dl>/, 'the column caption sits outside the list, hidden from assistive tech')
  // what a screen reader reads for the branch line
  const spoken = groups[0][2].replace(/<span aria-hidden="true">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '')
  assert.equal(spoken, 'Before 10 pcs, After 7 pcs')
})

runTest('stockBalanceLines: branch first, total second, and the one-branch collapse', () => {
  const { stockBalanceLines } = stockLineChange
  const labels = { branch: 'Branch', total: 'Total' }
  assert.deepEqual(stockBalanceLines({ before_qty: 18, after_qty: 15, branch_before_qty: 10, branch_after_qty: 7 }, 'Shop', 2, labels),
    [{ scope: 'branch', label: 'Shop', before: 10, after: 7 }, { scope: 'total', label: 'Total', before: 18, after: 15 }])
  // explicit total_* wins over the compatibility before/after names
  assert.deepEqual(stockBalanceLines({ total_before_qty: 18, total_after_qty: 15, before_qty: 0, after_qty: 0, branch_before_qty: 10, branch_after_qty: 7 }, 'Shop', 2, labels)[1], { scope: 'total', label: 'Total', before: 18, after: 15 })
  // one branch, no branch pair: one line, and it is the TOTAL, labelled
  // Total -- never the branch's name. Refuter, 26 Sep: an inactive branch
  // (Shop, once retired) can still hold stock, so the total is not the
  // remaining branch's number; the branch-named line needs a known branch
  // pair equal to the total.
  assert.deepEqual(stockBalanceLines({ before_qty: 5, after_qty: 6, branch_before_qty: null, branch_after_qty: null }, 'Store', 1, labels), [{ scope: 'total', label: 'Total', before: 5, after: 6 }])
  // one branch, a known branch pair equal to the total: the branch-named line
  assert.deepEqual(stockBalanceLines({ before_qty: 5, after_qty: 6, branch_before_qty: 5, branch_after_qty: 6 }, 'Store', 1, labels), [{ scope: 'branch', label: 'Store', before: 5, after: 6 }])
  // one branch, a known branch pair that differs (stock left in a closed branch): both lines
  assert.deepEqual(stockBalanceLines({ before_qty: 9, after_qty: 10, branch_before_qty: 5, branch_after_qty: 6 }, 'Store', 1, labels).map((line: { scope: string; label: string }) => [line.scope, line.label]), [['branch', 'Store'], ['total', 'Total']])
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

// The shared block, rendered on its own with a fixed balance state -- how the
// Stock Changes ledger float mounts it.
function renderBalance(props: Record<string, unknown>, balanceState: unknown): string {
  const exports = transpile('components/inventory/MovementDetailFloat.tsx', (id) => {
    if (id === 'react') return { ...React, useState: () => [balanceState, () => {}], useEffect: () => {} }
    if (id === 'react/jsx-runtime') return require(id)
    if (id.includes('StockLineChange')) return stockLineChange
    if (id.includes('movementGroups')) return movementGroups
    if (id.includes('historyRowModel')) return historyRowModel
    if (id.includes('Modal')) return { default: ({ children }: { children: React.ReactNode }) => React.createElement('section', null, children) }
    throw new Error(`Unexpected dependency: ${id}`)
  })
  return renderToStaticMarkup(React.createElement(exports.MovementBalance, { tr: (_key: string, fallback: string) => fallback, loadBalance: () => Promise.resolve(null), ...props }))
}
// a ledger row as the Stock Changes list carries it (quantity is a magnitude;
// before_qty/after_qty are the row's own TOTAL pair, from the same walk)
const ledgerRow = { id: 77, product_id: 5, product_name: 'Cream', movement_type: 'sale', quantity: 3, signed_quantity: -3, unit: 'pcs', branch_name: 'Shop', before_qty: 18, after_qty: 15, created_at: '2026-09-20 10:00:00' }
const linesOnly = (html: string) => {
  const block = html.slice(html.indexOf('data-testid="stock-record-balance"'))
  const visible = (dd: string) => dd.replace(/<span class="sr-only">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '')
  return [...block.matchAll(/data-scope="(branch|total)"[^>]*><dt[^>]*>([^<]*)<\/dt><dd[^>]*>(.*?)<\/dd>/g)].map((match) => [match[1], match[2], visible(match[3])])
}

runTest('the Stock Changes ledger float shows the same balance block, from the same walk, behind the LEDGER\'s gate', () => {
  const ledger = read('components/products/StockChangeSection.tsx')
  const detailModal = ledger.slice(ledger.indexOf('<Modal title={`${detail.product_name}`}'))
  assert.ok(detailModal.length > 0, 'the ledger row float exists')
  assert.match(ledger, /import \{ MovementBalance \} from '\.\.\/inventory\/MovementDetailFloat\.tsx'/)
  // Refuter, 26 Sep: the Stock Changes tab needs only Products view, and the
  // Movements balance route is Inventory-only -- a Products-only user read
  // "—". The ledger float reads its own products-gated twin.
  assert.match(ledger, /const loadDetailBalance = useCallback\(\(id: string \| number\) => getStockLedgerMovementBalance\(id\), \[\]\)/)
  assert.doesNotMatch(ledger, /getInventoryMovementBalance/, 'the ledger never reads the Inventory-only balance route')
  assert.match(read('api/productReadTransport.ts'), /apiFetch\('GET', `\/api\/products\/stock-ledger\/\$\{Math\.trunc\(Number\(id\)\)\}\/balance`\)/)
  assert.match(detailModal, /<MovementBalance movement=\{detail\} tr=\{\(key, fallback\) => tr\(t, key, fallback\)\} loadBalance=\{loadDetailBalance\} fallback=\{detail\} \/>/)
  // the old unlabelled total-only tiles are gone
  assert.doesNotMatch(detailModal, /\{detail\.before_qty\}|\{detail\.after_qty\}/)
  const float = read('components/inventory/MovementDetailFloat.tsx')
  assert.match(float, /<MovementBalance movement=\{movement\} tr=\{tr\} loadBalance=\{loadBalance\} \/>/, 'the Movements float renders the same block')
  // rendered: one movement, one balance -> the same lines in both
  const inLedger = renderBalance({ movement: ledgerRow, fallback: ledgerRow }, { id: 77, value: twoBranches, failed: false })
  const inMovements = renderFloat(sale, { id: 77, value: twoBranches, failed: false })
  assert.deepEqual(linesOnly(inLedger), balanceBlock(inMovements).lines)
  assert.deepEqual(linesOnly(inLedger), [['branch', 'Shop', '10 pcs → 7 pcs'], ['total', 'Total', '18 pcs → 15 pcs']])
})

runTest('a failed or empty ledger balance read falls back to the row\'s own total, never "—" for a number the row holds', () => {
  const failedRead = renderBalance({ movement: ledgerRow, fallback: ledgerRow }, { id: 77, value: null, failed: true })
  assert.deepEqual(linesOnly(failedRead), [['branch', 'Shop', '— → —'], ['total', 'Total', '18 pcs → 15 pcs']])
  assert.doesNotMatch(failedRead, /could not be read/, 'the total is shown, so no failure notice')
  // the offline transport answers nulls instead of throwing: same fallback
  const nullRead = renderBalance({ movement: ledgerRow, fallback: ledgerRow }, { id: 77, value: { before_qty: null, after_qty: null, branch_before_qty: null, branch_after_qty: null, active_branch_count: null }, failed: false })
  assert.deepEqual(linesOnly(nullRead).at(-1), ['total', 'Total', '18 pcs → 15 pcs'])
  // while still reading, the block says so; the read's own numbers win once in
  assert.deepEqual(linesOnly(renderBalance({ movement: ledgerRow, fallback: ledgerRow }, null)).at(-1), ['total', 'Total', '… → …'])
  const disagreeing = renderBalance({ movement: ledgerRow, fallback: { before_qty: 1, after_qty: 2 } }, { id: 77, value: twoBranches, failed: false })
  assert.deepEqual(linesOnly(disagreeing).at(-1), ['total', 'Total', '18 pcs → 15 pcs'])
  // no fallback (the Movements float): a failed read is still "—" and says why
  const noFallback = renderBalance({ movement: ledgerRow }, { id: 77, value: null, failed: true })
  assert.deepEqual(linesOnly(noFallback).at(-1), ['total', 'Total', '— → —'])
  assert.match(noFallback, /could not be read/)
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
