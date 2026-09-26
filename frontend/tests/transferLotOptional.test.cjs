// Owner report 26 Sep 2026: "transfer stock isn't working, tried to edit the
// number selected but couldn't". Since bfa464f0 every ticked row of the branch
// TransferModal locked its quantity input (`disabled={!chosenLot}`, max 0)
// until a received date was picked, and only active, dated, positive lots are
// offered -- so a product whose branch stock is not backed by such a lot at
// the source ("No received dates with stock") could never be transferred.
// The Inventory transfer form refused the same products at submit.
//
// Contract now (the single-transfer behaviour): the received date is optional.
// No lot = a lot-less line bounded by the source branch quantity, allocated
// FIFO by the Worker (cloudflare/scripts/test-transfer-bulk-lotless-fifo-pure.cjs
// pins that side). A chosen lot bounds the line by min(branch, lot).
//
// Run: node tests/transferLotOptional.test.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const path = require('node:path')

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n')
const source = read('../src/components/branches/TransferModal.tsx')
const compile = (code) => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
const moduleExports = {}
new Function('exports', 'require', compile(source))(moduleExports, (name) => (name.includes('batchLabel') ? { batchDisplayLabel: (lot) => lot.received_at } : {}))
const { selectedTransferLot } = moduleExports

const lot = (id, quantity, received_at = '2026-09-03') => ({ id, quantity, received_at, is_active: 1 })
// Branch holds 12; the only dated lot holds 5 (ledgers diverge by 7).
const product = { id: 7, name: 'Tea', unit: 'pcs', branch_quantity: 12 }
const lots = [lot(71, 5)]

// 1. The pure line builder.
assert.deepEqual(selectedTransferLot(product, [], undefined, 12), { productId: 7, quantity: 12 },
  'no dated lot at all: the whole branch quantity goes out lot-less (Worker FIFO)')
assert.deepEqual(selectedTransferLot(product, lots, undefined, 9), { productId: 7, quantity: 9 },
  'no lot chosen: bounded by the branch, not by the dated lots')
assert.equal('batchId' in selectedTransferLot(product, lots, 0, 1), false, 'a cleared selector (0) is Automatic, never batchId 0')
assert.throws(() => selectedTransferLot(product, [], undefined, 12.01), /transfer_invalid_quantity/, 'over the branch quantity is refused')
assert.throws(() => selectedTransferLot(product, [], undefined, 0), /transfer_invalid_quantity/)
assert.throws(() => selectedTransferLot(product, [], undefined, Number.NaN), /transfer_invalid_quantity/)
assert.deepEqual(selectedTransferLot(product, lots, 71, 5), { productId: 7, quantity: 5, batchId: 71 })
assert.throws(() => selectedTransferLot(product, lots, 71, 6), /transfer_invalid_quantity/, 'a chosen lot still bounds the line')
assert.throws(() => selectedTransferLot({ ...product, branch_quantity: 3 }, lots, 71, 4), /transfer_invalid_quantity/, 'and so does the branch')
assert.throws(() => selectedTransferLot(product, lots, 99, 1), /transfer_pick_batch_first/, 'an unknown chosen lot is refused, never swapped')

// 2. The real bulk handler, extracted from the component with a stub context.
function extract(start, end, context) {
  const from = source.indexOf(start)
  assert.ok(from > 0, `missing ${start}`)
  const body = source.slice(from, source.indexOf(end, from))
  return new Function(...Object.keys(context), compile(`${body}; return ${start.match(/const (\w+)/)[1]}`))(...Object.values(context))
}
let pending
let notice
const finiteStockAvailable = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0)
const context = {
  savedRun: null, savingBulk: false, retryStorageError: '', fromBranch: '1', toBranch: '2',
  requireCanonicalTransferDirection: () => true, requireTransferReason: () => true,
  selectedEntries: [['7', '12']], multiProducts: [product], finiteStockAvailable, invalidQuantityText: 'quantity',
  t: (key) => key, notify: (value) => { notice = value },
  // The lot list loaded for this source is EMPTY: no dated lot with stock.
  rowLots: { 7: { branch: '1', batches: [] } }, selectedLots: {}, selectedTransferLot,
  buildPendingTransfer: (scope, items) => ({ scope, items }), setPendingTransfer: (value) => { pending = value },
}
const submit = () => { pending = undefined; notice = undefined; extract('const handleBulkTransfer =', '  /**\n   * The one write path', context)() }

submit()
assert.deepEqual(pending, { scope: 'selected', items: [{ productId: 7, quantity: 12 }] },
  `a ticked product with no dated lot arms a lot-less transfer (notice: ${notice})`)

context.rowLots = {}
submit()
assert.deepEqual(pending?.items, [{ productId: 7, quantity: 12 }], 'lots not loaded yet (or failed to load) do not block Automatic')

context.rowLots = { 7: { branch: '1', batches: [], error: 'Failed to load data' } }
submit()
assert.deepEqual(pending?.items, [{ productId: 7, quantity: 12 }], 'a lot lookup failure does not block Automatic')

context.selectedEntries = [['7', '13']]
submit()
assert.equal(pending, undefined, 'over the branch quantity arms nothing')
assert.match(notice, /Tea: transfer_only_available/)

context.selectedEntries = [['7', '5']]
context.rowLots = { 7: { branch: '1', batches: lots } }
context.selectedLots = { 7: 71 }
submit()
assert.deepEqual(pending?.items, [{ productId: 7, quantity: 5, batchId: 71 }], 'a chosen lot rides the line')

context.selectedEntries = [['7', '6']]
submit()
assert.equal(pending, undefined, 'over a chosen lot arms nothing')
assert.match(notice, /Tea: transfer_only_available/)

context.selectedEntries = [['7', '2']]
context.rowLots = { 7: { branch: '2', batches: lots } }
submit()
assert.equal(pending, undefined, 'a chosen lot loaded under another source branch never arms a transfer')
assert.match(notice, /transfer_pick_batch_first/)

// 3. The wire: a lot-less item is sent without batchId (never null/0).
const wire = source.match(/\.map\(\(\{ productId, quantity, batchId \}\) => \(batchId \? \{ productId, quantity, batchId \} : \{ productId, quantity \}\)\)/)
assert.ok(wire, 'bulk request items omit batchId when no lot is chosen')

// 4. The row itself: quantity is editable as soon as the row is ticked.
const rowStart = source.indexOf('aria-label={`${t(\'quantity\') || \'Quantity\'} ${product.name}`}')
const inputStart = source.lastIndexOf('<input', rowStart)
const quantityInput = source.slice(inputStart, rowStart)
assert.ok(inputStart > 0 && quantityInput.includes('type="number"'), 'found the per-row quantity input')
assert.doesNotMatch(quantityInput, /disabled=/, 'the per-row quantity input is never locked behind a received date')
assert.match(quantityInput, /max=\{chosenLot \? Math\.min\(finiteStockAvailable\(product\.branch_quantity\), Number\(chosenLot\.quantity\)\) : finiteStockAvailable\(product\.branch_quantity\)\}/,
  'max is the branch quantity without a lot, min(branch, lot) with one')
assert.match(source, /t\('transfer_auto_fifo'\) \|\| 'Automatic \(FIFO\)'/, 'the row selector blank option is Automatic (FIFO)')
assert.match(source, /next\[id\] = String\(product\.branch_quantity \?\? ''\)/, 'ticking prefills the available branch quantity')

// 5. Inventory transfer form: same rule.
const inventory = read('../src/components/inventory/Inventory.tsx')
const modals = read('../src/components/inventory/InventoryStockModals.tsx')
const handlerStart = inventory.indexOf('const handleTransferStock = async')
const handler = inventory.slice(handlerStart, inventory.indexOf('runInventoryTransferIntent(\'submit\'', handlerStart))
assert.doesNotMatch(handler, /transfer_pick_batch_first/, 'Inventory transfer no longer refuses a lot-less move')
assert.match(handler, /const transferBatchId = Number\(transferForm\.batch_id\) > 0 \? Number\(transferForm\.batch_id\) : null/)
assert.match(handler, /quantity > sourceAvailable/, 'Inventory transfer is bounded by the source branch total')
assert.match(modals, /tr\('transfer_auto_fifo', 'Automatic \(FIFO\)'\)/, 'Inventory offers Automatic (FIFO)')
assert.match(modals, /tr\('transfer_pick_batch_optional', 'Received date \(optional\)'\)/)

// 6. Both language packs carry the copy used above.
for (const pack of ['en', 'km']) {
  const lang = JSON.parse(read(`../src/lang/${pack}.json`))
  for (const key of ['transfer_auto_fifo', 'transfer_pick_batch_optional', 'transfer_only_available', 'transfer_pick_batch_first']) {
    assert.ok(typeof lang[key] === 'string' && lang[key].trim(), `${pack}.json has ${key}`)
  }
}

console.log('PASS transfer received date is optional: lot-less rows arm, branch and lot bounds hold, Inventory parity, both packs')
