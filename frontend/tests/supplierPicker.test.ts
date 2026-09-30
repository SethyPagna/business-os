// D5a: the manual supplier picker -- cross-surface consistency pins.
// The user's standing rule (the one that forced D4b): a capability must
// exist on EVERY sibling stock-add surface, never on one with the others
// carved out. These pins make that rule a law for the supplier picker the
// same way the D4b batch picker got it, plus the honesty rules that make
// first-attribution-sticks visible instead of silently ignored.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bulkStockReceiptWire as bulkReceiptWire } from '../src/utils/stockReceiptFields.ts'
import { buildStockLineRequest, type StockSessionLine } from '../src/utils/stockSessionDraft.ts'

let passed = 0
function ok(label: string) {
  passed += 1
  console.log(`PASS ${label}`)
}

function read(rel: string): string {
  return readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')
}

const picker = read('components/shared/SupplierPickerField.tsx')
// Receive batch, the Inventory adjust form and Bulk add stock were retired
// into the one Stock Session (UI-STOCK-3); its supplier lives in the shared
// details, and a stock-in session's edit header and line editor keep theirs.
const sessionDetails = read('components/stock-session/StockSessionSharedDetails.tsx')
const stockInSessions = read('components/products/StockInSessionsSection.tsx')
const transport = read('api/batchesTransport.ts')

// --- The cross-surface law: every manual add surface renders the ONE
// shared picker. A surface dropping this import is exactly the "one place
// not the other" inconsistency the user rejected on D4.
for (const [name, src] of [
  ['StockSessionSharedDetails', sessionDetails],
  ['StockInSessionsSection', stockInSessions],
] as const) {
  assert.match(src, /import SupplierPickerField(?:, \{[^}]*\})? from ['"].*shared\/SupplierPickerField/, `${name} imports the shared picker`)
  assert.match(src, /<SupplierPickerField/, `${name} renders the shared picker`)
}
ok('every manual stock surface renders the ONE shared SupplierPickerField (cross-surface rule): the Stock Session and the stock-in session editors')

// --- The picker itself: typing always breaks the contact link (an id may
// only ever come from an explicit pick), and picks land on mousedown so
// the input's blur can't swallow them.
// The input + floating list is now the ONE shared SuggestionTextInput (the
// same control the product form's Category/Brand/Unit/Supplier and the
// create-products header's Brand render), so the field keeps only what is
// supplier-specific. The GUARANTEES are unchanged and asserted in both
// places: the id semantics here, the pointer safety there.
//
// The pointer rule this file has always pinned is UNCHANGED: a pick lands on
// mousedown. A tap synthesises mousedown before the focus change that blurs
// the input, which is why this picker worked on its four touch surfaces with
// no touch handler at all -- so a touchstart that picks is not "the mobile
// path", it is a regression that turns a scroll of the list into a selection.
const suggestionInput = read('components/shared/SuggestionTextInput.tsx')
assert.match(picker, /import SuggestionTextInput/, 'the picker wraps the shared control instead of copying it')
assert.match(
  picker,
  /if \(option\) \{[\s\S]{0,80}?onChange\(\{ supplierId: Number\(option\.payload\), supplierName: option\.value \}\)/,
  'a pick carries the contact id outright',
)
// P3-9: typing no longer always drops the id. It is RE-RESOLVED from the
// typed text on every keystroke against the loaded name list, so an edited
// name still cannot ride on the previous pick's id, while typing an existing
// supplier's name exactly now attributes the lot to that contact instead of
// minting a second name-only attribution for a supplier that already exists.
// An unmatched OR ambiguous name still resolves to null (name-only).
assert.match(
  picker,
  /const resolved = resolveSupplierByExactName\(resolvable, next\)/,
  'the typed name goes through the exact-name resolver',
)
assert.match(
  picker,
  /onChange\(\{ supplierId: resolved \? resolved\.id : null, supplierName: next \}\)/,
  'an unresolved name is still recorded by name only',
)
assert.doesNotMatch(
  picker,
  /else onChange\(\{ supplierId: null, supplierName: next \}\)/,
  'the unconditional drop is gone',
)
assert.match(suggestionInput, /onMouseDown=\{\(event\) => \{ event\.preventDefault\(\); pick\(option\) \}\}/, 'suggestion picks beat blur via mousedown')
assert.doesNotMatch(suggestionInput, /onTouchStart=\{[^}]*pick\(/, 'a tap already reaches the mousedown path; a touchstart pick would fire mid-scroll')
assert.match(picker, /fields: ['"]names['"]/, 'suggestions come from the permission-free name-only suppliers read')
ok('picker: free text stays name-only, picks are mousedown-safe on mouse and touch, list is the names-only read')

// --- Locked variant: when the lot is already attributed the field is
// read-only -- no input element in that branch, so no choice can be
// collected that the server would ignore.
{
  // Two variants since UI-STOCK-2: the compact one (the Stock Session's
  // shared details) and the default. Each has its own locked branch.
  const text = picker.replace(/\r\n/g, '\n')
  const lockedStarts = [...text.matchAll(/\n {2,4}if \(lockedName\) \{/g)].map((match) => match.index ?? -1)
  assert.equal(lockedStarts.length, 2, 'both variants have a locked branch')
  // The branch ends at the closing brace on its own indentation.
  const blockAt = (start: number): string => {
    const indent = /^\n( *)/.exec(text.slice(start))?.[1] ?? ''
    const end = text.indexOf(`\n${indent}}`, start + 1)
    return end > start ? text.slice(start, end) : ''
  }
  for (const start of lockedStarts) {
    const lockedBlock = blockAt(start)
    assert.ok(lockedBlock.length > 0 && !lockedBlock.includes('<input') && !lockedBlock.includes('<SuggestionTextInput'), 'locked variant renders NO input')
  }
  const defaultLocked = blockAt(lockedStarts[1])
  assert.ok(defaultLocked.includes('supplier_first_attribution'), 'the default locked variant explains first-attribution-sticks')
  ok('picker: attributed lots render read-only, never a dead input')
}

// --- Wire honesty: the supplier rides stock-ins only. Executed through the
// Stock Session's one line writer: a Remove and a Set (a count correction on a
// named lot, owner 24 Sep) state no supplier; an Add states the session's.
{
  const line = {
    key: '1', requestId: 'req-1', product: { id: 7, name: 'Serum' }, productName: 'Serum', quantity: 2, freeQuantity: 0,
    unitCost: '3', sellingPrice: '', freeGoods: false, expiryDate: '', batchChoice: 4, batchLabel: '', reason: '',
    conditionTag: '', createdProduct: false, status: 'queued', detail: '',
  } as unknown as StockSessionLine
  const context = {
    branchId: '1', receivedDate: '2026-09-20', supplier: { supplierId: 9, supplierName: 'Bong Long' },
    paymentStatus: 'paid' as const, creditDueDate: '', sessionId: 1, canEditPrice: false, reasonFor: () => 'Count',
  }
  const body = (mode: 'add' | 'remove' | 'set') => buildStockLineRequest({ ...line, mode }, context).body as Record<string, unknown>
  for (const mode of ['remove', 'set'] as const) {
    assert.equal('supplierId' in body(mode) || 'supplierName' in body(mode), false, `a ${mode} carries no supplier`)
  }
  assert.equal(body('add').supplierId, 9)
  assert.equal(body('add').supplierName, 'Bong Long')
  ok('Stock Session: the supplier rides stock-ins only')
}

// The shared bulk receipt rule (its form, BulkAddStockModal, was retired by
// UI-STOCK-3; the rule stays until its owner removes it). Evaluated, not matched.
assert.deepEqual(
  bulkReceiptWire('remove', { unitCost: '3', freeGoods: false, supplierId: 9, supplierName: 'Bong Long', receivedDate: '2026-09-06' }),
  {},
  'a bulk remove carries no supplier and no cost',
)
// A bulk Set is now SCOPED to a named existing received date (owner, 24 Sep):
// a count correction that keeps that lot's attribution, so it names no supplier.
assert.deepEqual(
  bulkReceiptWire('set', { unitCost: '3', freeGoods: false, supplierId: 9, supplierName: 'Bong Long', receivedDate: '2026-09-06' }),
  {},
  'a bulk scoped Set carries no supplier and no cost',
)
ok('bulk receipt rule: a remove and a scoped Set state no supplier and no cost')

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
  // supplier_bulk_hint and supplier_will_fill_lot were read only by the retired
  // stock forms (UI-STOCK-3); their retirement is handed to UI-STOCK-1.
  for (const key of ['supplier_first_attribution', 'supplier_free_text_note', 'supplier_linked_note']) {
    assert.ok(typeof en[key] === 'string' && en[key].length > 0, `en.json has ${key}`)
    assert.ok(typeof km[key] === 'string' && km[key].length > 0, `km.json has ${key}`)
  }
  ok('en+km packs both carry every picker key the picker reads')
}

console.log(`\n${passed} check(s) passed.`)
