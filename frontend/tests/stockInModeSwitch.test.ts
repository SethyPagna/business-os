import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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
const ledgerSource = read('../src/components/products/StockChangeSection.tsx')
const productsSource = read('../src/components/products/Products.tsx')
const inventorySource = read('../src/components/inventory/Inventory.tsx')
const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, unknown>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, unknown>

runTest('the Stock Changes header has one stock entry point: the fast flow, in the chosen mode', () => {
  // the Adjust menu routes every entry to the fast modal
  assert.match(productsSource, /\{ label: tr\('add_stock', 'Add Stock'\), onClick: \(\) => ledgerActions\?\.openFastStockIn\('add'\)/)
  assert.match(productsSource, /\{ label: tr\('remove_stock', 'Remove Stock'\), onClick: \(\) => ledgerActions\?\.openFastStockIn\('remove'\)/)
  assert.match(productsSource, /\{ label: tr\('adjust_quantity', 'Adjust Quantity'\), onClick: \(\) => ledgerActions\?\.openFastStockIn\('set'\)/)
  // ...and nothing on the header opens the one-by-one modal any more
  assert.doesNotMatch(productsSource, /openAdjust\(/)
  assert.doesNotMatch(ledgerSource, /openAdjust:/)
  assert.doesNotMatch(ledgerSource, /const openStockAdjustment = /)
  assert.match(ledgerSource, /openFastStockIn: \(mode\?: StockMode\) => void/)
  assert.match(ledgerSource, /initialMode=\{fastStockInMode\}/)
  // the only other stock-in entry point (Inventory's Manage menu) opens the
  // same modal and never carried the one-by-one entries; its per-row
  // adjust (like the Products list's) is a different surface and stays
  const manageMenu = inventorySource.slice(inventorySource.indexOf("{ label: tr('import', 'Import'), onClick: () => setShowImport(true)"), inventorySource.indexOf('] as PortalMenuItem[])}'))
  assert.ok(manageMenu.length > 0, 'Manage menu located')
  assert.doesNotMatch(manageMenu, /add_stock|remove_stock|adjust_quantity|openAdjust/)
  assert.match(inventorySource, /label: tr\('fast_stockin_title', 'Fast stock-in'\), onClick: \(\) => setShowFastStockIn\(true\)/)
})

runTest('the fast flow carries an add / remove / set switch; each line freezes its mode', () => {
  assert.match(modalSource, /export type StockMode = 'add' \| 'remove' \| 'set'/)
  assert.match(modalSource, /initialMode\?: StockMode/)
  assert.match(modalSource, /const \[mode, setMode\] = useState<StockMode>\(draft\?\.mode \|\| initialMode \|\| 'add'\)/)
  // the three-way control, with the explanation in an InfoHint, not prose
  assert.match(modalSource, /\(\['add', 'remove', 'set'\] as const\)\.map\(\(option\) =>/)
  assert.match(modalSource, /aria-pressed=\{mode === option\}/)
  assert.match(modalSource, /tr\('fast_stock_mode_hint'/)
  // frozen on the queued line and restored when the line is reopened
  assert.match(modalSource, /interface ReceivedLine \{[^]*?\n  mode: StockMode\n[^]*?\n\}/)
  assert.match(modalSource, /const next: ReceivedLine = \{[^]*?\n\s+mode,\n[^]*?\}/)
  assert.match(modalSource, /const editLine = \(line: ReceivedLine\) => \{[^]*?setMode\(line\.mode\)/)
  // the draft remembers the switch across reload, like every other header field
  assert.match(modalSource, /type FastStockInDraft = \{[^]*?\n  mode\?: StockMode\n/)
})

runTest('Enter still queues the current line', () => {
  assert.match(modalSource, /onKeyDown=\{\(event\) => \{ if \(event\.key === 'Enter'\) addLine\(\) \}\}/)
})

runTest('a set can target zero; an add or a remove of nothing still cannot', () => {
  // "Set to 0" is how an operator empties a branch -- the last one sold, a
  // miscount corrected down to nothing. The shared guard read `if (qty <= 0)`
  // for all three modes, so the one mode that needs zero was the one mode that
  // could not have it. The Worker refused it first, above its own set
  // conversion; that half is proven in
  // cloudflare/scripts/test-stock-set-zero-pure.cjs. One rule, both halves.
  assert.match(modalSource, /if \(qty <= 0 && mode !== 'set'\)/,
    'add and remove keep the positive-quantity guard; set does not')
  // A blank box must not queue "set to 0" by accident, and a set cannot go
  // negative -- the same non-negative rule the route enforces.
  assert.match(modalSource, /if \(mode === 'set' && \(!rawQuantity \|\| qty < 0\)\)/,
    'a set needs a value actually typed, and a non-negative one')
  assert.match(modalSource, /const rawQuantity = quantity\.trim\(\)/)
  // ...and the input itself says so: 0 is reachable in set mode only.
  assert.match(modalSource, /min=\{mode === 'set' \? 0 : 1\}/,
    "the Qty input's floor follows the mode")
  // nothing silently refused: the set-mode rejection names its own reason
  assert.match(modalSource, /tr\('fast_stockin_set_qty'/)
  assert.equal(typeof en.fast_stockin_set_qty, 'string')
  assert.equal(typeof km.fast_stockin_set_qty, 'string')
  assert.match(String(km.fast_stockin_set_qty), /[ក-៿]/)
})

runTest('the write honours the mode through the one adjust kernel; add keeps its receipt gate', () => {
  // remove: the chosen lot or the oldest lots; no receipt fields
  assert.match(modalSource, /line\.mode === 'remove'\s*\? await adjustStock\(\{\s*productId: Number\(line\.product\.id\), type: 'remove', quantity: line\.quantity,[^]*?batchId: typeof line\.batchChoice === 'number' \? line\.batchChoice : null,[^]*?sessionId: sessionIdRef\.current,/)
  // set: the branch total; receipt fields ride along because a set that
  // raises stock is an add server-side
  assert.match(modalSource, /line\.mode === 'set'\s*\? await adjustStock\(\{\s*productId: Number\(line\.product\.id\), type: 'set', quantity: line\.quantity,[^]*?supplierId: supplier\.supplierId, supplierName: supplier\.supplierName\.trim\(\) \|\| null,[^]*?sessionId: sessionIdRef\.current,/)
  // add is unchanged: still exactly one receiveBatchStock call site
  assert.equal((modalSource.match(/receiveBatchStock\(/g) || []).length, 1)
  // the gate guards adds as the line is queued -- and only adds; a remove
  // has no supplier or cost to gate, a set's direction is decided server-side
  assert.match(modalSource, /if \(mode === 'add'\) \{\s*const receiptGate = stockReceiptGateCode\(\{/)
  // a remove never asks for a cost
  assert.match(modalSource, /if \(mode !== 'remove' && paymentStatus === 'credit' && !creditDueDate\.trim\(\)\)/)
})

runTest('the queue tags each line New / Existing from what this session created', () => {
  assert.match(modalSource, /const \[createdProductIds, setCreatedProductIds\] = useState<string\[\]>\(draft\?\.createdProductIds \|\| \[\]\)/)
  assert.match(modalSource, /setCreatedProductIds\(\(prev\) => \[\.\.\.prev, String\(productId\)\]\)/)
  assert.match(modalSource, /createdProduct: createdProductIds\.includes\(String\(picked\.id\)\)/)
  assert.match(modalSource, /line\.createdProduct \? tr\('stock_session_new_product', 'New'\) : tr\('stock_session_existing_product', 'Existing'\)/)
})

runTest('every new string is in BOTH packs, in real Khmer', () => {
  for (const key of ['fast_stock_mode_hint', 'fast_stock_auto_lot', 'fast_stock_set_hint', 'confirm_complete_stock_session_mixed', 'stock_change_session_reason', 'stock_line_removed', 'stock_line_set', 'set_to', 'add', 'remove', 'set']) {
    assert.equal(typeof en[key], 'string', `en.${key}`)
    assert.equal(typeof km[key], 'string', `km.${key}`)
    assert.match(String(km[key]), /[ក-៿]/, `km.${key} is Khmer`)
  }
  assert.match(String(en.confirm_complete_stock_session_mixed), /\{lines\}[^]*\{branch\}/)
  assert.match(String(km.confirm_complete_stock_session_mixed), /\{lines\}[^]*\{branch\}/)
})

if (failed > 0) {
  process.exitCode = 1
}
