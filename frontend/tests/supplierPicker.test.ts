// D5a: the manual supplier picker -- cross-surface consistency pins.
// The user's standing rule (the one that forced D4b): a capability must
// exist on EVERY sibling stock-add surface, never on one with the others
// carved out. These pins make that rule a law for the supplier picker the
// same way the D4b batch picker got it, plus the honesty rules that make
// first-attribution-sticks visible instead of silently ignored.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bulkStockReceiptWire as bulkReceiptWire } from '../src/utils/stockReceiptFields.ts'

let passed = 0
function ok(label: string) {
  passed += 1
  console.log(`PASS ${label}`)
}

function read(rel: string): string {
  return readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')
}

const picker = read('components/shared/SupplierPickerField.tsx')
const receiveModal = read('components/inventory/ReceiveBatchModal.tsx')
const inventoryModals = read('components/inventory/InventoryStockModals.tsx')
const branchAdjuster = read('components/products/forms/BranchStockAdjuster.tsx')
const bulkModal = read('components/products/forms/BulkAddStockModal.tsx')
const inventoryPage = read('components/inventory/Inventory.tsx')
const transport = read('api/batchesTransport.ts')

// --- The cross-surface law: every manual add surface renders the ONE
// shared picker. A surface dropping this import is exactly the "one place
// not the other" inconsistency the user rejected on D4.
for (const [name, src] of [
  ['ReceiveBatchModal', receiveModal],
  ['InventoryStockModals', inventoryModals],
  ['BranchStockAdjuster', branchAdjuster],
  ['BulkAddStockModal', bulkModal],
] as const) {
  assert.match(src, /import SupplierPickerField from ['"].*shared\/SupplierPickerField/, `${name} imports the shared picker`)
  assert.match(src, /<SupplierPickerField/, `${name} renders the shared picker`)
}
ok('all four manual add surfaces render the ONE shared SupplierPickerField (cross-surface rule)')

// --- The picker itself: typing always breaks the contact link (an id may
// only ever come from an explicit pick), and picks land on mousedown so
// the input's blur can't swallow them.
assert.match(picker, /onChange\(\{ supplierId: null, supplierName: event\.target\.value \}\)/, 'typing clears supplierId')
assert.match(picker, /onMouseDown=\{\(event\) => \{ event\.preventDefault\(\); pick\(row\) \}\}/, 'suggestion picks beat blur via mousedown')
assert.match(picker, /fields: ['"]names['"]/, 'suggestions come from the permission-free name-only suppliers read')
ok('picker: free text stays name-only, picks are mousedown-safe, list is the names-only read')

// --- Locked variant: when the lot is already attributed the field is
// read-only -- no input element in that branch, so no choice can be
// collected that the server would ignore.
{
  const lockedBlock = picker.slice(picker.indexOf('if (lockedName)'), picker.indexOf('const query'))
  assert.ok(lockedBlock.includes('supplier_first_attribution'), 'locked variant explains first-attribution-sticks')
  assert.ok(!lockedBlock.includes('<input'), 'locked variant renders NO input')
  ok('picker: attributed lots render read-only, never a dead input')
}

// --- Wire honesty per surface: what rides to the server is exactly what
// the person saw on screen.
assert.match(receiveModal, /supplierName: lotAttributedName \? null : \(supplierName\.trim\(\) \|\| null\)/, 'ReceiveBatchModal omits supplier when the lot is attributed')
assert.match(receiveModal, /supplierId: lotAttributedName \? null : supplierId/, 'ReceiveBatchModal omits the id too')
ok('ReceiveBatchModal: locked lot sends nothing (visibility-mirror rule)')

assert.match(inventoryModals, /supplier_id: '', supplier_name: ''/, 'InventoryStockModals clears supplier when an attributed lot is picked')
// S4-16 widened "adds only" to "stock-ins only": a 'set' above the current
// figure is converted to an add of the difference by routes/inventory.ts and
// creates a real lot, so it attributes that lot exactly as an add does. A
// remove -- and a set that lowers the figure -- still carries no supplier.
assert.match(inventoryPage, /supplierId: isStockIn && adjustForm\.supplier_id !== ''/, 'Inventory.tsx sends supplier only for stock-ins')
assert.match(inventoryPage, /supplierName: isStockIn && String\(adjustForm\.supplier_name \|\| ''\)\.trim\(\) !== ''/, 'Inventory.tsx name likewise stock-in only')
assert.match(inventoryPage, /const isStockIn = isStockInSubmission\(adjustForm\.type, qty, previousQuantity\)/, 'Inventory.tsx derives that from the shared rule, not its own copy')
ok('Inventory adjust: form cleared on attributed lots, wire is stock-in only')

assert.match(branchAdjuster, /supplierId: row\.type === 'add' && row\.supplierId != null \? row\.supplierId : undefined/, 'BranchStockAdjuster sends supplier only on add rows')
assert.match(branchAdjuster, /onChange\(\{ supplierId: null, supplierName: '' \}\)/, 'BranchStockAdjuster clears the row when its lot is attributed')
ok('BranchStockAdjuster: per-row honesty (adds only, attributed lots cleared)')

// N14-D widened "adds only" here too, and for the same reason S4-16 widened
// it on Inventory.tsx: routes/inventory.ts converts a 'set' that RAISES a
// row's stock into an add, and this surface -- one figure applied to many
// products, with no branch quantity in sight -- cannot tell which rows those
// are. So a bulk set states the supplier too; a remove still states none.
// Asserted by evaluating the shared rule, not by matching the expression.
assert.match(bulkModal, /bulkStockReceiptWire\(action, \{/, 'BulkAddStockModal builds its receipt half from the shared rule')
assert.deepEqual(
  bulkReceiptWire('remove', { unitCost: '3', freeGoods: false, supplierId: 9, supplierName: 'Bong Long', receivedDate: '2026-09-06' }),
  {},
  'a bulk remove carries no supplier and no cost',
)
assert.equal(
  bulkReceiptWire('set', { unitCost: '3', freeGoods: false, supplierId: 9, supplierName: 'Bong Long', receivedDate: '2026-09-06' }).supplierId,
  9,
  'a bulk set can raise a row, and a raise is a receipt that names its supplier',
)
assert.match(bulkModal, /supplier_bulk_hint/, 'BulkAddStockModal explains the fill-not-rewrite semantics for existing lots')
ok('BulkAddStockModal: one supplier per bulk event, receipts only, semantics explained')

// --- Transport: the lot list carries attribution so the pickers can tell
// locked from fill; the receive payload carries the id beside the name.
assert.match(transport, /supplier_id\?: number \| null/, 'ProductBatch list type carries supplier_id')
assert.match(transport, /supplier_name\?: string \| null/, 'ProductBatch list type carries supplier_name')
assert.match(transport, /supplier_id: payload\.supplierId \?\? null/, 'receive POST maps supplierId onto the wire')
ok('batchesTransport: list + receive both carry the attribution fields')

// --- Both language packs carry every new picker key (t() returns the KEY
// on a miss, so a missing key renders raw -- the J3 lesson).
{
  const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
  const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
  for (const key of ['supplier_bulk_hint', 'supplier_first_attribution', 'supplier_free_text_note', 'supplier_linked_note', 'supplier_will_fill_lot']) {
    assert.ok(typeof en[key] === 'string' && en[key].length > 0, `en.json has ${key}`)
    assert.ok(typeof km[key] === 'string' && km[key].length > 0, `km.json has ${key}`)
  }
  ok('en+km packs both carry all five picker keys')
}

console.log(`\n${passed} check(s) passed.`)
