import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildStockLineRequest, lineEntryRefusal, resolveOpeningMode, sessionSteps, type StockSessionLine } from '../src/utils/stockSessionDraft.ts'

// The checkout is CRLF on disk and LF in the index; the pins are written
// against LF so they hold in both.
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// N27 (2026-09-06): "i don't see the add products the one by one in stock in
// sessions... i think you can merge the fast stock in and the one by one add.
// so remove the one by one add and do fast stock in... keep the enter and
// able to choose to switch option remove and set."
//
// There is exactly ONE way to change stock from the Stock Changes header:
// the fast stock-in flow. The Adjust menu's three entries (Add / Remove /
// Adjust quantity) all open FastStockInModal in the matching mode; the modal
// carries an add / remove / set switch whose choice is frozen onto each
// queued line and honoured by the write (type: 'remove' / 'set' through the
// same POST /api/inventory/adjust kernel the one-by-one modal used). Enter
// still queues the current line. The queue shows New / Existing on each line
// and the receipt gate still guards every add.
//
// StockAdjustModal itself stays: the Products list's per-row adjust and the
// failed-attempt resume path in the Stock Changes ledger still open it, and
// it belongs to another lane. Only the header entry points are rerouted.

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

const modalSource = read('../src/components/inventory/FastStockInModal.tsx')
const headerSource = read('../src/components/stock-session/StockSessionHeader.tsx')
const lineEntrySource = read('../src/components/stock-session/StockSessionLineEntry.tsx')
const itemsSource = read('../src/components/stock-session/StockSessionItems.tsx')
const draftSource = read('../src/utils/stockSessionDraft.ts')

// The entry row's one refusal rule, as the float calls it.
function refusalFor(over: Partial<Parameters<typeof lineEntryRefusal>[0]>) {
  return lineEntryRefusal({
    mode: 'add', hasProduct: true, branchId: '1', quantity: '2', unitCost: '3', supplierName: 'Bong Long',
    lotChoice: 'new', lot: null, canReceive: true, canEditCosts: true, branchQuantity: 10, ...over,
  })
}
function bodyFor(mode: 'add' | 'remove' | 'set', batchChoice: 'new' | number = 4) {
  const line = {
    key: 'l', requestId: 'r', product: { id: 7, name: 'Soap' }, productName: 'Soap', mode, quantity: 0, freeQuantity: 0,
    unitCost: '3', sellingPrice: '', freeGoods: false, expiryDate: '', batchChoice, batchLabel: '', reason: '',
    conditionTag: '', createdProduct: false, status: 'queued', detail: '',
  } as unknown as StockSessionLine
  return buildStockLineRequest(line, {
    branchId: '1', receivedDate: '2026-09-30', supplier: { supplierId: 5, supplierName: 'Bong Long' },
    paymentStatus: 'credit', creditDueDate: '2026-10-15', sessionId: 42, canEditPrice: false, reasonFor: () => 'Count',
  })
}
const ledgerSource = read('../src/components/products/StockChangeSection.tsx')
const productsSource = read('../src/components/products/Products.tsx')
const inventorySource = read('../src/components/inventory/Inventory.tsx')
const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, unknown>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, unknown>

// Owner, 30 Sep 2026: "Adjust Stock click should directly open the page ...
// default add stock can switch to other mode". The header Adjust is ONE
// button that opens the session in Add; the mode switch lives in the float.
runTest('the Stock Changes header Adjust is one button that opens the session in Add', () => {
  const slot = productsSource.slice(productsSource.indexOf('primaryActionSlot={'), productsSource.indexOf('t={t}', productsSource.indexOf('primaryActionSlot={')))
  assert.ok(slot.length > 0, 'primary action slot located')
  assert.match(slot, /onClick=\{\(\) => ledgerActions\?\.openFastStockIn\('add'\)\}/)
  assert.match(slot, /tr\('adjust', 'Adjust'\)/)
  // no menu, so no second choice of mode before the float
  assert.doesNotMatch(slot, /LazyPortalMenu|aria-haspopup/)
  assert.doesNotMatch(slot, /openFastStockIn\('remove'\)|openFastStockIn\('set'\)/)
  assert.doesNotMatch(productsSource, /tr\('remove_stock', 'Remove Stock'\)|tr\('adjust_quantity', 'Adjust Quantity'\)/)
  // ...and nothing on the header opens the one-by-one modal any more
  assert.doesNotMatch(productsSource, /openAdjust\(/)
  assert.doesNotMatch(ledgerSource, /openAdjust:/)
  assert.doesNotMatch(ledgerSource, /const openStockAdjustment = /)
  assert.match(ledgerSource, /openFastStockIn: \(mode\?: StockMode\) => void/)
  assert.match(ledgerSource, /initialMode=\{fastStockInMode\}/)
  // Inventory's Manage menu names the same entry "Adjust", not "Fast stock-in"
  const manageMenu = inventorySource.slice(inventorySource.indexOf("{ label: tr('import', 'Import'), onClick: () => setShowImport(true)"), inventorySource.indexOf('] as PortalMenuItem[])}'))
  assert.ok(manageMenu.length > 0, 'Manage menu located')
  assert.doesNotMatch(manageMenu, /add_stock|remove_stock|adjust_quantity|openAdjust|fast_stockin_title/)
  assert.match(manageMenu, /\{ label: tr\('adjust', 'Adjust'\), onClick: \(\) => openFastStockIn\(null\)/)
})

// UI-STOCK-2 rewrote the float as the Stock Session; UI-STOCK-3 repointed the
// pins below (retired pins are listed in the UI-STOCK-3 lane report).
runTest('the Stock Session carries an add / remove / set switch; each line freezes its mode', () => {
  assert.match(draftSource, /export type StockMode = 'add' \| 'remove' \| 'set'/)
  assert.match(modalSource, /export type \{ StockMode \}/, 'the float still exports StockMode for its hosts')
  assert.match(modalSource, /initialMode\?: StockMode/)
  assert.match(modalSource, /const \[mode, setModeState\] = useState<StockMode>\(init\.draft\.mode\)/)
  // A host's mode opens an empty session; a draft with items keeps its own.
  assert.equal(resolveOpeningMode(null, 'remove'), 'remove')
  assert.equal(resolveOpeningMode(null, undefined), 'add')
  // the three-way control is a radio group, the mode IS the title
  assert.match(headerSource, /\(\['add', 'remove', 'set'\] as const\)\.map\(\(option\) =>/)
  assert.match(headerSource, /role="radio"\s+aria-checked=\{active\}/)
  // frozen on the queued line and restored when the line is reopened
  assert.match(draftSource, /export type StockSessionLine = \{[^]*?\n  mode: StockMode\n/)
  assert.match(modalSource, /productName: String\(picked\.name \|\| `#\$\{picked\.id\}`\),\s+mode,/)
  assert.match(modalSource, /function editLine\(line: StockSessionLine\) \{[^]*?if \(line\.mode !== mode\) setModeState\(line\.mode\)/,
    'reopening a queued line must restore its frozen mode')
  // the draft remembers the switch across reload
  assert.match(draftSource, /export type StockSessionDraft = \{[^]*?\n  mode: StockMode\n/)
})

runTest('Enter still queues the current line', () => {
  assert.ok((lineEntrySource.match(/onEnter=\{onAdd\}/g) || []).length >= 3, 'Qty, Cost, Price and Reason queue the line on Enter')
})

runTest('a set can target zero; an add or a remove of nothing still cannot', () => {
  // "Set to 0" is how an operator empties a received date. The Worker half is
  // proven in cloudflare/scripts/test-stock-set-zero-pure.cjs. One rule, both halves.
  assert.equal(refusalFor({ mode: 'set', quantity: '0', lot: null }), null, 'a set to zero is allowed')
  assert.equal(refusalFor({ mode: 'set', quantity: '' })?.key, 'fast_stockin_set_qty', 'a blank box never queues "set to 0" by accident')
  assert.equal(refusalFor({ mode: 'set', quantity: '-1' })?.key, 'fast_stockin_set_qty', 'a set cannot go negative')
  assert.equal(refusalFor({ mode: 'remove', quantity: '0' })?.key, 'fast_stockin_qty', 'a remove of nothing is refused')
  assert.equal(refusalFor({ mode: 'add', quantity: '-1' })?.key, 'fast_stockin_qty', 'an add below zero is refused')
  // An Add item of Qty 0 is all free units (owner, 30 Sep); Next refuses an item with none at all.
  assert.match(draftSource, /export function sessionLinesRefusal[^]*?line\.mode === 'add' && !line\.createPayload && line\.quantity \+ line\.freeQuantity <= 0/)
  assert.match(lineEntrySource, /label=\{mode === 'set' \? tr\('set_to', 'Set to'\) : tr\('stock_line_qty', 'Qty'\)\}/, 'the box says what a Set means')
  assert.equal(typeof en.fast_stockin_set_qty, 'string')
  assert.equal(typeof km.fast_stockin_set_qty, 'string')
  assert.match(String(km.fast_stockin_set_qty), /[ក-៿]/)
})

runTest('the write honours the mode through the one adjust kernel; add keeps its receipt gate', () => {
  // remove: the chosen lot; no receipt fields
  const remove = bodyFor('remove')
  assert.equal(remove.wire, 'adjust')
  const removeBody = remove.body as Record<string, unknown>
  assert.equal(removeBody.type, 'remove')
  assert.equal(removeBody.batchId, 4)
  assert.equal(removeBody.sessionId, 42)
  // set: SCOPED (owner, 24 Sep) to a named existing lot; a count correction,
  // so no receipt facts ride along (the lot keeps its own cost).
  const setBody = bodyFor('set').body as Record<string, unknown>
  assert.equal(setBody.type, 'set')
  assert.equal(setBody.setScope, 'lot')
  assert.equal(setBody.batchId, 4)
  for (const key of ['supplierId', 'unitCostUsd', 'paymentStatus', 'receivedDate', 'creditDueDate']) {
    assert.equal(key in setBody || key in removeBody, false, `a scoped Set or a Remove carries no ${key}`)
  }
  // add: exactly one call site to the receipt transport (the sequential fallback)
  assert.equal((modalSource.match(/await receiveBatchStock\(/g) || []).length, 1)
  // the receipt gate guards adds only; a remove or set has no supplier or cost to gate
  assert.equal(refusalFor({ mode: 'add', supplierName: '' })?.gate, 'supplier_required')
  assert.equal(refusalFor({ mode: 'remove', supplierName: '', unitCost: '' }), null)
  assert.equal(refusalFor({ mode: 'set', supplierName: '', unitCost: '', quantity: '3' }), null)
  assert.equal(refusalFor({ mode: 'add', canEditCosts: false })?.key, 'product_cost_edit_required', 'hidden receipt inputs refuse an add, never a correction')
  // only a session with an Add is a receipt: only then is there a Payment step (credit + due date)
  assert.deepEqual(sessionSteps('add', []), ['items', 'payment', 'review'])
  assert.deepEqual(sessionSteps('remove', [{ mode: 'remove' }]), ['items', 'review'])
  assert.deepEqual(sessionSteps('set', [{ mode: 'set' }]), ['items', 'review'])
})

runTest('the queue tags each item New from what this session created', () => {
  assert.match(modalSource, /const \[createdProductIds, setCreatedProductIds\] = useState<string\[\]>\(init\.draft\.createdProductIds\)/)
  assert.match(modalSource, /setCreatedProductIds\(\(prev\) => \[\.\.\.prev, String\(id\)\]\)/)
  assert.match(modalSource, /createdProduct: Boolean\(heldPayload\) \|\| createdProductIds\.includes\(String\(picked\.id\)\)/)
  assert.match(itemsSource, /line\.createdProduct \? <span[^>]*>\{tr\('stock_session_new_product', 'New'\)\}<\/span> : null/)
})

runTest('every new string is in BOTH packs, in real Khmer', () => {
  // (fast_stock_mode_hint, fast_stock_auto_lot, fast_stock_set_hint and
  // confirm_complete_stock_session_mixed lost their last reader with the old
  // float: HANDOFF to UI-STOCK-1 to retire them.)
  for (const key of ['stock_change_session_reason', 'stock_line_removed', 'stock_line_set', 'set_to', 'add', 'remove', 'set']) {
    assert.equal(typeof en[key], 'string', `en.${key}`)
    assert.equal(typeof km[key], 'string', `km.${key}`)
    assert.match(String(km[key]), /[ក-៿]/, `km.${key} is Khmer`)
  }
})

// A prefetched catalog cost of 0 is real data, and the read surfaces must show
// it as $0.00 -- but on the WRITE form it silently makes the default Add path a
// guaranteed refusal: stockReceiptGateCode answers 'free_goods_required' for
// every unticked zero, and the one control that clears it is a 10px checkbox
// under the cost box. Nothing on screen pointed at it until the operator had
// already pressed Add and been refused.
//
// The button now says why it cannot proceed, before the click, from the SAME
// kernel that refuses it -- not a second hand-written condition that can drift.
runTest('the Add button states the receipt gate reason before the click, from the same kernel', () => {
  // One reading marks the control and refuses the Add: lineEntryRefusal runs the
  // same stockReceiptGateCode the Worker mirrors, and its message sits on the
  // Add control before the click, not in a toast after it.
  assert.match(draftSource, /const gate = stockReceiptGateCode\(qty === 0/)
  assert.match(modalSource, /let refusal: LineEntryRefusal \| null = lineEntryRefusal\(\{/)
  assert.match(modalSource, /refusal\.gate\s*\? tr\(STOCK_RECEIPT_GATE_KEYS\[refusal\.gate\], STOCK_RECEIPT_GATE_FALLBACKS\[refusal\.gate\]\)/)
  assert.match(modalSource, /refusal=\{refusal \? refusalMessage : null\}/)
  assert.match(lineEntrySource, /aria-disabled=\{refusal \? true : undefined\}\s+title=\{refusal \|\| undefined\}/)
})

runTest('a zero cost awaiting its declaration rings the control that clears it', () => {
  // Free units are a row under the item now (owner, 30 Sep): a zero cost on
  // paid units rings the Cost box; an all-free item (Qty 0) is declared free.
  const zeroCost = refusalFor({ mode: 'add', quantity: '2', unitCost: '0' })
  assert.equal(zeroCost?.gate, 'free_goods_required')
  assert.equal(zeroCost?.field, 'cost')
  assert.equal(refusalFor({ mode: 'add', quantity: '0', unitCost: '0' }), null, 'a Qty 0 item is declared free by its free row')
  assert.match(modalSource, /const invalidField = refusal && \(addAttempted \|\| \(picked && refusal\.gate\)\) \? refusal\.field : null/, 'the gate rings its control before any click')
  assert.match(lineEntrySource, /invalid=\{ring\('cost'\)\}/)
})

if (failed > 0) {
  process.exitCode = 1
}
