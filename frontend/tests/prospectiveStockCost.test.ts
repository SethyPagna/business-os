import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useProtectedCostEntry } from '../src/utils/useProtectedCostEntry.ts'

const read = (path: string) => readFileSync(new URL(`../src/components/${path}`, import.meta.url), 'utf8')
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
const product = { id: 7, name: 'Same product', barcode: '123', cost_price_usd: 1.2345, purchase_price_usd: 99 }
for (const canViewCosts of [false, true]) {
  for (const canonical of [1.2345, 0, undefined]) {
    const candidate = { ...product, cost_price_usd: canonical, purchase_price_usd: undefined }
    const expected = canViewCosts ? canonical ?? '' : ''
    for (const path of ['products/forms/StockAdjustModal.tsx', 'inventory/Inventory.tsx']) {
      let form: any
      const callback = evaluate(extract(path, path.includes('/forms/') ? 'selectProduct' : 'openAdjust'), {
        useCallback: (fn: unknown) => fn, costViewRef: { current: canViewCosts }, canViewCosts,
        restoredDraftRef: { current: null }, resumeRef: { current: null }, receiptSessionIdRef: { current: null },
        defaultBranch: { id: 2 }, openingType: 'add', DEFAULT_ADD_QUANTITY: 1,
        setSelectedProduct: () => {}, setAdjustModal: () => {}, setPendingAdjust: () => {},
        ensureInventoryReasonsLoaded: () => {}, todayIsoDate: () => '2026-09-20',
        setAdjustForm: (next: any) => { form = typeof next === 'function' ? next(form) : next },
      })
      callback(candidate)
      assert.equal(form.unit_cost_usd, expected, `${path}: authorized canonical mean; zero is known, missing stays blank`)
      assert.equal(form.pricingLocked, true, 'editable receipt cost does not require identity unlock')
      assert.equal(form.product_id, 7)
      assert.equal(form.free_goods, false, 'a known zero still requires explicit free declaration')
    }
  }
}

const fast = 'inventory/FastStockInModal.tsx'
for (const canViewCosts of [false, true]) {
  let cost: unknown
  const setters = Object.fromEntries(['setPicked', 'setQuantity', 'setExpiryDate', 'setQuery', 'setCandidates', 'setSelectedGroup', 'setFreeGoods', 'setCreatePriceVariant', 'setEditingKey', 'setBatchChoice', 'setConditionTag', 'setScannedBarcode'].map((name) => [name, () => {}]))
  const pick = evaluate(extract(fast, 'pick'), {
    ...setters, canViewCosts, duplicateRows: [], editingKey: '', findSessionProductDuplicate: () => null,
    setUnitCost: (value: unknown) => { cost = value }, notify: () => {}, tr: (_key: string, fallback: string) => fallback,
  })
  pick(product)
  assert.equal(cost, canViewCosts ? '1.2345' : '', 'Fast stock-in uses same canonical mean or blind blank')
}

// Execute the actual queued-line callback, then its actual wire builder.
let queued: any[] = []
const addLine = evaluate(extract(fast, 'addLine'), {
  saving: false, quantity: '2', picked: product, duplicateRows: [], editingKey: '',
  findSessionProductDuplicate: () => null, branchId: '2', mode: 'add', canEditCosts: true,
  paymentStatus: 'paid', creditDueDate: '', supplier: { supplierId: 3, supplierName: 'Supplier' },
  stockReceiptGateCode: () => null, unitCost: '2.3456', freeGoods: false,
  // A restored historical flag must NOT turn an ordinary price edit into a new product.
  createPriceVariant: true, canViewCosts: true, batchChoice: 'new', batchOptions: [], branchOptions: [],
  expiryDate: '', reason: '', conditionTag: '', createdProductIds: [],
  setReceived: (updater: (rows: any[]) => any[]) => { queued = updater(queued) },
  setEditingKey: () => {}, resetLine: () => {}, tr: (_key: string, fallback: string) => fallback,
  notify: (message: string) => { throw new Error(message) },
})
addLine()
assert.equal(queued.length, 1)
assert.equal(queued[0].createPriceVariant, false)
const build = evaluate(extract(fast, 'buildLineRequest'), {
  canEditCosts: true, branchId: '2', receivedDate: '2026-09-20',
  supplier: { supplierId: 3, supplierName: 'Supplier' }, paymentStatus: 'paid', creditDueDate: '',
  sessionIdRef: { current: 'session' }, stockLineReason: () => 'Receipt', tr: (_key: string, fallback: string) => fallback,
})
for (const legacyFlag of [false, true]) {
  const request = build({ ...queued[0], createPriceVariant: legacyFlag })
  assert.equal(request.wire, 'receive')
  assert.equal(request.body.productId, 7)
  assert.equal(request.body.unitCostUsd, 2.3456)
  assert.equal(request.body.batchId, null)
  assert.equal(Object.hasOwn(request.body, 'unlockPricing'), false)
  assert.equal(Object.hasOwn(request.body, 'pricing'), false)
}
const free = build({ ...queued[0], unitCost: '0', freeGoods: true })
assert.equal(free.body.unitCostUsd, 0)
assert.equal(free.body.freeGoods, true)

const sessionSource = read('products/CreateProductsSessionModal.tsx')
const sessionAst = ts.createSourceFile('session.tsx', sessionSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let permissionEffect = ''
function findEffect(node: ts.Node): void {
  if (ts.isCallExpression(node) && node.expression.getText(sessionAst) === 'useEffect' && node.arguments[0]?.getText(sessionAst).includes('const previous = previousCostAccess.current')) permissionEffect = node.arguments[0].getText(sessionAst)
  ts.forEachChild(node, findEffect)
}
findEffect(sessionAst)
assert.ok(permissionEffect)
function transition(previous: { canViewCosts: boolean; canEditCosts: boolean }, next: { canViewCosts: boolean; canEditCosts: boolean }, initial: string, blind: string, edited = false, blindEdited = false) {
  let readable = initial
  let blindValue = blind
  evaluate(permissionEffect, {
    ...next, previousCostAccess: { current: previous }, lineCostEditedRef: { current: edited }, blindLineCostEditedRef: { current: blindEdited },
    blindLineUnitCost: blind, selectedProduct: product, currentCost: (p: typeof product) => String(p.cost_price_usd),
    setLineUnitCost: (value: string | ((current: string) => string)) => { readable = typeof value === 'function' ? value(readable) : value },
    setBlindLineUnitCost: (value: string) => { blindValue = value },
  })()
  return { readable, blind: blindValue }
}
const both = { canViewCosts: true, canEditCosts: true }
const editOnly = { canViewCosts: false, canEditCosts: true }
assert.equal(transition(editOnly, both, '', '').readable, '1.2345', 'new view grant seeds canonical mean')
assert.equal(transition({ canViewCosts: false, canEditCosts: false }, both, '', '').readable, '1.2345', 'new full grant seeds canonical mean')
assert.equal(transition(editOnly, both, '', '8.75', false, true).readable, '8.75', 'blind user-entered draft survives grant')
assert.equal(transition(editOnly, both, '6.75', '', true).readable, '6.75', 'protected readable draft survives revoke/regrant')
assert.equal(transition({ canViewCosts: true, canEditCosts: false }, both, '', '', true).readable, '', 'deliberately cleared input is not silently refilled')
assert.deepEqual(transition(both, editOnly, '6.75', '9.25', true, true), { readable: '6.75', blind: '' }, 'view revocation hides known cost immediately without destroying protected draft')
assert.match(sessionSource, /value=\{canViewCosts \? lineUnitCost : blindLineUnitCost\}/)
assert.match(read('inventory/InventoryStockModals.tsx'), /<fieldset disabled=\{!canEditCosts\}/, 'view-only receipt controls are read-only')

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
const manualSource = read('inventory/InventoryStockModals.tsx')
assert.match(manualSource, /useProtectedCostEntry\(user\?\.id, adjustForm\.product_id, canViewCosts, canEditCosts\)/)
assert.match(manualSource, /value=\{displayedFreeGoods \? 0 : displayedUnitCost\}/)
assert.match(manualSource, /value=\{displayedCostUsd\}/)
assert.match(manualSource, /value=\{displayedCostKhr\}/)
assert.match(manualSource, /free_goods: displayedFreeGoods/, 'new blind input cannot inherit a hidden free-goods declaration')
const fastSource = read(fast)
assert.match(fastSource, /useProtectedCostEntry\(user\?\.id, picked\?\.id, canViewCosts, canEditCosts\)/)
assert.match(fastSource, /const unitCost = String\(costEntry\.value\('unitCost', protectedUnitCost, ''\)\)/)
assert.match(fastSource, /unitCost: protectedUnitCost, freeGoods: protectedFreeGoods/, 'persisted draft keeps protected values when only rendering rights change')
assert.match(fastSource, /setFreeGoods\(canViewCosts && line\.freeGoods\)/, 'reopening a saved blind line cannot infer free cost')

for (const change of ['none', 'revoke', 'actor', 'entity', 'typed', 'cleanup']) {
  let resolve: (result: unknown) => void = () => {}
  const response = new Promise((done) => { resolve = done })
  let readable = ''
  let selected: any = { id: 7 }
  const scope = { current: { key: 'actor1:product7:viewedit' } }
  const access = { current: both }
  const edited = { current: false }
  const cleanup = evaluate(permissionEffect, {
    ...both, previousCostAccess: { current: editOnly }, lineCostEditedRef: edited, blindLineCostEditedRef: { current: false },
    blindLineUnitCost: '', selectedProduct: selected, currentCost: (p: any) => p?.cost_price_usd == null ? '' : String(p.cost_price_usd),
    costRefreshScope: scope, costAccessRef: access,
    getProductsByIds: (ids: unknown[], params: unknown) => { assert.deepEqual(ids, [7]); assert.deepEqual(params, { surface: 'inventory' }); return response },
    setSelectedProduct: (updater: (p: any) => any) => { selected = updater(selected) },
    setLineUnitCost: (value: string | ((current: string) => string)) => { readable = typeof value === 'function' ? value(readable) : value },
    notify: () => {}, tr: (_key: string, fallback: string) => fallback,
  })()
  if (change === 'revoke') access.current = editOnly
  if (change === 'actor' || change === 'entity') scope.current = { key: change }
  if (change === 'typed') { edited.current = true; readable = '9.75' }
  if (change === 'cleanup') cleanup()
  resolve({ items: [{ id: 8, cost_price_usd: 999 }, { id: 7, cost_price_usd: 1.2345 }] })
  await response
  await Promise.resolve()
  assert.equal(readable, change === 'none' ? '1.2345' : change === 'typed' ? '9.75' : '', `redacted selection refresh respects ${change} race fence`)
}
console.log('PASS prospective receipt defaults, same-product queued payloads, explicit free zero, and session permission transitions')
