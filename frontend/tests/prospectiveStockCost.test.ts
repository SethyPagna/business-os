import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useProtectedCostEntry } from '../src/utils/useProtectedCostEntry.ts'
import { buildStockLineRequest, catalogCostOf, type StockSessionLine } from '../src/utils/stockSessionDraft.ts'

// Prospective receipt cost: a picked product's entry starts from its canonical
// mean cost when the operator may see costs, else blank; a known zero stays
// zero; a missing cost stays blank. Since 30 Sep 2026 every stock entry point
// opens the Stock Session, so StockAdjustModal / Inventory's adjust form (with
// its "lock pricing") and CreateProductsSessionModal are retired, and the
// session's own entry row is what is executed here.

const read = (path: string) => readFileSync(new URL(`../src/components/${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
function extract(path: string, name: string): string {
  const ast = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found = ''
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node.initializer!.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found, name)
  return found
}
function evaluate(expression: string, context: Record<string, unknown>): any {
  const js = ts.transpileModule(`const callback = ${expression}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(context), `${js}; return callback`)(...Object.values(context))
}

const fast = 'inventory/FastStockInModal.tsx'
const fastSource = read(fast)
const priceText = evaluate(extract(fast, 'priceText'), {})
const product = { id: 7, name: 'Same product', barcode: '123', cost_price_usd: 1.2345, selling_price_usd: 5 }
for (const canViewCosts of [false, true]) {
  for (const canonical of [1.2345, 0, undefined]) {
    const entryFor = evaluate(extract(fast, 'entryFor'), { catalogCostOf, canViewCosts, priceText })
    for (const mode of ['add', 'remove', 'set']) {
      const entry = entryFor({ ...product, cost_price_usd: canonical }, mode)
      const expected = canViewCosts && canonical != null ? String(canonical) : ''
      assert.equal(entry.unitCost, expected, `${mode}: authorized canonical mean; zero is known, missing stays blank, blind stays blank`)
      assert.equal(entry.picked.id, 7)
    }
  }
}
// The bulk panel's queued Items take the same rule, Add only.
assert.match(fastSource, /unitCost: mode === 'add' && canViewCosts && cost != null \? String\(cost\) : ''/)
assert.match(fastSource, /applyEntry\(entryFor\(candidate, mode\)\)/, 'a search pick fills the entry through the same function')

// The actual wire builder: a same-product receipt is a plain receive.
const line = {
  key: 'k', requestId: 'stockline_test', product, productName: product.name, mode: 'add', quantity: 2, freeQuantity: 0,
  unitCost: '2.3456', sellingPrice: '', freeGoods: false, expiryDate: '', batchChoice: 'new', batchLabel: '',
  reason: '', conditionTag: '', createdProduct: false, status: 'queued', detail: '',
} as unknown as StockSessionLine
const ctx = {
  branchId: '2', receivedDate: '2026-09-20', supplier: { supplierId: 3, supplierName: 'Supplier' },
  paymentStatus: 'paid' as const, creditDueDate: '', sessionId: 1, canEditPrice: false, reasonFor: () => 'Receipt',
}
const request = buildStockLineRequest(line, ctx)
const body = request.body as Record<string, unknown>
assert.equal(request.wire, 'receive')
assert.equal(body.productId, 7)
assert.equal(body.unitCostUsd, 2.3456)
assert.equal(body.batchId, null)
assert.equal(Object.hasOwn(body, 'unlockPricing'), false, 'no lock-pricing flag rides the wire')
assert.equal(Object.hasOwn(body, 'pricing'), false)
const knownZero = buildStockLineRequest({ ...line, unitCost: '0' }, ctx).body as Record<string, unknown>
assert.deepEqual([knownZero.unitCostUsd, knownZero.freeGoods], [0, false], 'a known zero still requires an explicit free declaration')
const allFree = buildStockLineRequest({ ...line, quantity: 0, freeQuantity: 2, unitCost: '' }, ctx).body as Record<string, unknown>
assert.deepEqual([allFree.unitCostUsd, allFree.freeGoods, allFree.freeQuantity], [0, true, 2], 'units received only as free declare it')

// Reuse the existing lifecycle suite's small DOM fixture, without executing
// that suite. This mounts the production hook with the installed React runtime.
const lifecycle = readFileSync(new URL('./productDraftLifecycle.test.ts', import.meta.url), 'utf8')
const fixtureEnd = lifecycle.search(/const \{\r?\n  clearWorkDraft/)
assert.ok(fixtureEnd > 0)
const fixture = lifecycle.slice(lifecycle.indexOf('class MemoryStorage'), fixtureEnd)
const fixtureJs = ts.transpileModule(`${fixture}\nreturn memoryDocument;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const doc = new Function(fixtureJs)()
const container = doc.createElement('div')
const mounted = createRoot(container as Element)
let entry: ReturnType<typeof useProtectedCostEntry>
const protectedDraft = { unitCost: '876.5432', freeGoods: true }
function Probe({ actor, view, edit, entity = 7 }: { actor: number; view: boolean; edit: boolean; entity?: number }) {
  entry = useProtectedCostEntry(actor, entity, view, edit)
  return React.createElement('span', null, JSON.stringify({ cost: entry.value('unitCost', protectedDraft.unitCost, ''), free: entry.value('freeGoods', protectedDraft.freeGoods, false) }))
}
const render = async (actor: number, view: boolean, edit: boolean, entity = 7) => {
  await act(async () => mounted.render(React.createElement(Probe, { actor, view, edit, entity })))
  return JSON.parse(container.textContent)
}
assert.deepEqual(await render(1, true, true), { cost: '876.5432', free: true })
assert.deepEqual(await render(1, false, true), { cost: '', free: false }, 'same mounted actor loses saved values immediately; no cleanup effect exists')
await act(async () => entry.write('unitCost', '2.3456'))
assert.deepEqual(JSON.parse(container.textContent), { cost: '2.3456', free: false }, 'blind editor sees only newly entered cost')
assert.deepEqual(await render(1, false, false), { cost: '', free: false }, 'capability downgrade clears display ownership, not draft')
assert.deepEqual(await render(1, false, true), { cost: '', free: false }, 'old blind capability generation cannot reappear')
assert.deepEqual(await render(1, true, false), { cost: '876.5432', free: true }, 'view-only can read protected draft again')
assert.deepEqual(await render(2, true, true), { cost: '', free: false }, 'a different actor cannot inherit the mounted draft')
assert.deepEqual(protectedDraft, { unitCost: '876.5432', freeGoods: true }, 'all transitions preserve protected source draft')
await act(async () => mounted.unmount())

// The session's entry row reads its cost through that hook, and the draft
// keeps the protected value when only rendering rights change.
assert.match(fastSource, /useProtectedCostEntry\(user\?\.id, picked\?\.id, canViewCosts, canEditCosts\)/)
assert.match(fastSource, /const unitCost = String\(costEntry\.value\('unitCost', protectedUnitCost, ''\)\)/)
assert.match(fastSource, /quantity, unitCost: protectedUnitCost,/, 'persisted draft keeps the protected value')
console.log('PASS prospective receipt defaults, same-product receipt payloads, explicit free zero, and protected cost entry')
