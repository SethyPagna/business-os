// Received dates on the branch transfer surfaces. Ported from
// codex/existing-stock-lot-corrections-20260912 and adapted to today's
// TransferModal (per checked row, only lots with stock) and to the Inventory
// transfer form (POST /api/inventory/transfer batchId). Since 26 Sep 2026 the
// lot is OPTIONAL on both (owner report: quantity could not be edited without
// a dated lot); tests/transferLotOptional.test.cjs pins the lot-less path.
// This file pins what still holds when a lot IS chosen.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const path = require('node:path')

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n')
const source = read('../src/components/branches/TransferModal.tsx')
const compile = (code) => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
const moduleExports = {}
new Function('exports', 'require', compile(source))(moduleExports, (name) => (name.includes('batchLabel') ? { batchDisplayLabel: (lot) => lot.received_at } : {}))
const { positiveTransferLots, selectedTransferLot } = moduleExports

const lot = (id, quantity, received_at = '2026-09-03', is_active = 1) => ({ id, quantity, received_at, is_active })
const product = { id: 7, name: 'Tea', branch_quantity: 12 }
const lots = [lot(71, 5), lot(72, 7, '2026-09-05')]

assert.deepEqual(positiveTransferLots([lot(1, 0), lot(2, -1), lot(3, 1, '2026-09-01', 0), lot(4, 1, null), lot(5, 2)]).map((row) => row.id), [5],
  'only active, dated lots with stock are offered')
assert.deepEqual(selectedTransferLot(product, lots, undefined, 2), { productId: 7, quantity: 2 }, 'no lot chosen: lot-less line, Worker allocates FIFO')
assert.equal(selectedTransferLot(product, lots, 71, 5).batchId, 71, 'an explicit earlier date is kept even though a later date holds more')
assert.throws(() => selectedTransferLot(product, lots, 71, 6), /quantity/, 'bounded by the lot')
assert.throws(() => selectedTransferLot({ ...product, branch_quantity: 3 }, lots, 71, 4), /quantity/, 'bounded by the branch')
assert.throws(() => selectedTransferLot(product, lots, 99, 1), /pick_batch/, 'an unknown lot is refused')

// The actual bulk handler, extracted from the component with a stub context.
function extract(start, end, context) {
  const from = source.indexOf(start)
  const body = source.slice(from, source.indexOf(end, from))
  return new Function(...Object.keys(context), compile(`${body}; return ${start.match(/const (\w+)/)[1]}`))(...Object.values(context))
}
let pending
let notice
const context = {
  savedRun: null, savingBulk: false, retryStorageError: '', fromBranch: '1', toBranch: '2',
  requireCanonicalTransferDirection: () => true, requireTransferReason: () => true,
  selectedEntries: [['7', '2']], multiProducts: [product], finiteStockAvailable: Number, invalidQuantityText: 'quantity',
  t: (key) => key, notify: (value) => { notice = value },
  rowLots: { 7: { branch: '1', batches: lots } }, selectedLots: {}, selectedTransferLot,
  buildPendingTransfer: (scope, items) => ({ scope, items }), setPendingTransfer: (value) => { pending = value },
}
const submit = () => extract('const handleBulkTransfer =', '  /**\n   * The one write path', context)()
submit()
assert.deepEqual(pending.items, [{ productId: 7, quantity: 2 }], 'no lot chosen: a lot-less item is armed')
pending = undefined
context.selectedLots[7] = 71
submit()
assert.equal(pending.items[0].batchId, 71)
assert.equal(pending.items[0].quantity, 2)
pending = undefined
context.rowLots[7].branch = '2'
submit()
assert.equal(pending, undefined, 'lots loaded under another source branch never arm a transfer')

// Source pins: the per-row selector and the wire.
assert.match(source, /max=\{chosenLot \? Math\.min\(finiteStockAvailable\(product\.branch_quantity\), Number\(chosenLot\.quantity\)\) : finiteStockAvailable\(product\.branch_quantity\)\}/)
assert.match(source, /\.map\(\(\{ productId, quantity, batchId \}\) => \(batchId \? \{ productId, quantity, batchId \} : \{ productId, quantity \}\)\)/)
assert.match(source, /value=\{chosenLot\?\.id \?\? ''\}/, 'the live row selector has no automatic default')
assert.match(source, /<AppSelect\s+id=\{`transfer-lot-\$\{id\}`\}/, 'lots use the shared accessible selector')
assert.doesNotMatch(source, /<select\b/, 'no native dropdown bypasses the shared selector')

// Inventory transfer form: only lots with stock, and the batchId rides the wire.
const modals = read('../src/components/inventory/InventoryStockModals.tsx')
const inventory = read('../src/components/inventory/Inventory.tsx')
assert.match(modals, /getProductBatches\(transferProductId, Number\(transferSourceId\), true\)/)
assert.match(inventory, /batchId: transferBatchId,/)
assert.match(inventory, /const transferBatchId = Number\(transferForm\.batch_id\) > 0 \? Number\(transferForm\.batch_id\) : null/)

console.log('PASS existing transfer lots: optional selected lot and bounds, source-branch identity, wire and shared selector')
