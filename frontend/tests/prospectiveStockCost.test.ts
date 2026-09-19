import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

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
console.log('PASS prospective receipt defaults, same-product queued payloads, explicit free zero, and session permission transitions')
