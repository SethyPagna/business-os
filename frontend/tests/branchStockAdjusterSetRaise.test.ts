// N14-D: a `set` that RAISES a branch's stock must not be a dead end.
//
// THE DEFECT. BranchStockAdjuster.tsx asked three different questions about
// one row and acted as if they were the same question:
//
//   the submit gate   isStockInSubmission(row.type, delta, row.current)
//   the field on screen  row.type === 'add' && row.batchId !== ''
//   the payload          row.type === 'add'
//
// routes/inventory.ts converts a `set` above the branch's on-hand figure into
// an add of the difference, so cloudflare/src/lib/stockReceiptGate.ts gates it
// exactly like an add. The form's gate loop agreed and refused such a row with
// "Choose the supplier these goods came from." -- while the row rendered no
// supplier field anywhere (the picker was nested inside the add/remove batch
// block, which a `set` never shows), and even had one existed the payload
// would have dropped its value. The operator could neither answer the refusal
// nor proceed: the row was unsubmittable, and no test in the suite covered
// this file's render/wire pairing, which is why the suite stayed green.
//
// WHAT THIS FILE PINS. The three questions are now ONE question, asked through
// the shared rule the Worker applies. The checks below are structural (the
// component is JSX and cannot be imported by the node test runner) but they are
// not string-spotting: `defectsIn()` is run against a POSITIVE CONTROL holding
// the pre-fix expressions and must report every defect there, then against the
// real file and must report none. A check that stopped discriminating would
// fail on the control rather than passing quietly on both.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isStockInSubmission, isSetDownSubmission, stockReceiptGateCode } from '../src/utils/stockReceiptFields.ts'

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

const ADJUSTER = 'src/components/products/forms/BranchStockAdjuster.tsx'
const source = readFileSync(new URL(`../${ADJUSTER}`, import.meta.url), 'utf8')

/**
 * The JSX condition guarding a marker: the expression between the `{` that
 * opens the conditional and its `? (`. Structural, so it reports what the
 * source ACTUALLY gates the field on rather than whether some string appears
 * somewhere in the file.
 */
function guardAbove(text: string, marker: string): string {
  const at = text.indexOf(marker)
  assert.notEqual(at, -1, `marker not found: ${marker}`)
  const head = text.slice(0, at)
  const question = head.lastIndexOf('? (')
  assert.notEqual(question, -1, `no conditional guards ${marker}`)
  const open = head.lastIndexOf('{', question)
  return head.slice(open + 1, question).trim()
}

/** Every way this file can re-open the dead end. Empty means closed. */
function defectsIn(text: string): string[] {
  const found: string[] = []
  // 1. The supplier field rendered on a predicate of its own -- anything
  //    naming a row TYPE shows nothing for a raising set, whatever else it
  //    says. Read off the actual JSX guard, so the same expression quoted in a
  //    comment is not mistaken for the defect.
  if (/row\.type\s*===/.test(guardAbove(text, '<SupplierPickerField'))) {
    found.push('supplier field gated on the row type instead of the gate rule')
  }
  // 2. The payload dropping the supplier for anything that is not a literal
  //    add, so even a typed name never reached routes/inventory.ts.
  if (text.includes("supplierId: row.type === 'add' &&") || text.includes("supplierName: row.type === 'add' &&")) {
    found.push('payload sends the supplier on add rows only')
  }
  // 3. The gate loop and the field must funnel through the ONE shared rule,
  //    not a locally re-derived copy of it.
  if (!text.includes('isStockInSubmission')) {
    found.push('file does not use the shared stock-in rule at all')
  }
  return found
}

// The pre-fix expressions, verbatim in shape, as the instrument's known
// positive: a checker that reports nothing here is broken, not reassuring.
const PRE_FIX_CONTROL = [
  "import { isStockInSubmission } from '../../../utils/stockReceiptFields.ts'",
  "          {row.type === 'add' && row.batchId !== '' ? (",
  '            <div className="mt-1.5">',
  '              <SupplierPickerField',
  '                idPrefix={`branch-stock-${row.branchId}`}',
  '              />',
  '            </div>',
  '          ) : null}',
  "          supplierId: row.type === 'add' && row.supplierId != null ? row.supplierId : undefined,",
  "          supplierName: row.type === 'add' && row.supplierName.trim() ? row.supplierName.trim() : undefined,",
].join('\n')

runTest('positive control: the checker DOES report the pre-fix shape', () => {
  const control = defectsIn(PRE_FIX_CONTROL)
  assert.deepEqual(control.sort(), [
    'payload sends the supplier on add rows only',
    'supplier field gated on the row type instead of the gate rule',
  ], 'the pre-fix expressions must be flagged, or this file proves nothing')
  assert.equal(
    guardAbove(PRE_FIX_CONTROL, '<SupplierPickerField'),
    "row.type === 'add' && row.batchId !== ''",
    'the control must reproduce the guard the defect actually had',
  )
})

runTest('a set that RAISES stock is a receipt the Worker refuses without a supplier', () => {
  // Why the field has to be there at all: 4 on hand, set to 12.
  assert.equal(isStockInSubmission('set', 12, 4), true)
  assert.equal(isSetDownSubmission('set', 12, 4), false)
  // A raising set has no batch picker (nothing to pick against a total), so it
  // always creates or date-matches its own lot -- lotAttributionDeferred is
  // false and the supplier question falls to the operator.
  assert.equal(
    stockReceiptGateCode({ isStockIn: true, supplierName: '', lotAttributionDeferred: false, unitCostUsd: '2.5', freeGoods: false }),
    'supplier_required',
  )
  // ...and answered, it passes. So the refusal is answerable -- provided the
  // form renders somewhere to answer it.
  assert.equal(
    stockReceiptGateCode({ isStockIn: true, supplierName: 'Bong Long', lotAttributionDeferred: false, unitCostUsd: '2.5', freeGoods: false }),
    '',
  )
  // The mirror image still owes nothing: a set that lowers stock is a removal.
  assert.equal(isStockInSubmission('set', 2, 10), false)
})

runTest('BranchStockAdjuster no longer carries either half of the dead end', () => {
  assert.deepEqual(defectsIn(source), [], `${ADJUSTER} still holds a pre-fix expression`)
})

runTest('the supplier field is gated on the SAME predicate the gate loop applies', () => {
  // Structural: whatever the JSX actually gates the picker on.
  assert.equal(guardAbove(source, '<SupplierPickerField'), 'showReceiptFields',
    'the supplier picker must render on the shared receipt predicate')
  assert.match(source, /const showReceiptFields = rowShowsReceiptFields\(row\)/,
    'showReceiptFields must come from the shared row predicate, not a local rewrite')
  assert.match(source, /function rowShowsReceiptFields\([\s\S]{0,200}?rowIsPending\(row\) && rowIsStockIn\(row\)/,
    'a row shows the receipt fields when it is pending AND a stock-in')
  assert.match(source, /function rowIsStockIn\([\s\S]{0,240}?return isStockInSubmission\(row\.type, parseStockDelta\(row\.delta\), row\.current\)/,
    'rowIsStockIn must BE the shared rule, not a copy of its conditions')
  // The submit gate asks the same function, so the field and the refusal can
  // never disagree again.
  assert.match(source, /if \(!rowIsStockIn\(row\)\) continue/, 'the gate loop asks the same predicate')
  // The picker is no longer trapped inside the add/remove batch block, which a
  // `set` never shows: that block must CLOSE (at the row's own JSX indent)
  // before the picker appears.
  const batchBlock = source.indexOf('{showBatchPicker ? (')
  const picker = source.indexOf('<SupplierPickerField')
  assert.ok(batchBlock !== -1 && picker > batchBlock, 'the batch block must come first')
  assert.match(source.slice(batchBlock, picker), /\n {6}\) : null\}/,
    'the add/remove batch block must close before the supplier picker is rendered')
})

runTest('what the operator typed reaches the wire for a raising set', () => {
  assert.match(source, /supplierId: rowIsStockIn\(row\) && row\.supplierId != null/, 'supplier id rides on every stock-in row')
  assert.match(source, /supplierName: rowIsStockIn\(row\) && row\.supplierName\.trim\(\)/, 'supplier name likewise')
  assert.match(source, /unitCostUsd: rowIsStockIn\(row\) \?/, 'the cost rides on the same predicate')
  // A raising set creates a lot of its own, so it may state the real received
  // date -- the same rule Inventory.tsx applies to the single-target form.
  assert.match(source, /receivedDate: rowCreatesLot\(row\) && row\.receivedDate/, 'the received date rides on the lot-creating predicate')
  assert.match(source, /function rowCreatesLot\([\s\S]{0,300}?row\.type === 'set' \|\| row\.batchId === 'new'/,
    'a set creates a lot (no picker), and so does a "New batch" add')
  assert.ok(!source.includes("receivedDate: row.type === 'add' && row.batchId === 'new'"),
    'the old add-only received-date wire must be gone')
})

runTest('the refusal explains itself at the control that answers it', () => {
  // supplier_required belongs to that row's picker...
  assert.match(source, /supplierGateError\?: string \| null/, 'the row takes its own supplier refusal')
  assert.match(source, /gateFailure\.code === 'supplier_required' && gateFailure\.branchId === row\.branchId/,
    'only the refused row shows the supplier sentence')
  assert.match(source, /\{supplierGateError \? \(\s*\n\s*<p role="alert"/, 'the sentence renders beside the picker as an alert')
  // ...and the three cost codes belong to the one shared cost field.
  assert.match(source, /gateFailure && gateFailure\.code !== 'supplier_required' \? \(/, 'cost refusals render at the cost field')
  // The refusal must stop being a bare form-foot message with no control.
  assert.ok(!source.includes('setMsg(`${row.branchName}: ${T(STOCK_RECEIPT_GATE_KEYS[gate]'),
    'the gate must no longer answer only at the foot of the form')
})

runTest('the required cost field is only shown when a row actually receives stock', () => {
  // It carries a red `*` and `required`; a form whose every change is a
  // removal owes no cost, and the gate loop skips those rows.
  assert.match(source, /const receiptRowCount = rows\.filter\(\(row\) => rowShowsReceiptFields\(row\)\)\.length/,
    'the cost block counts the rows that really are receipts')
  const guard = source.indexOf('{receiptRowCount > 0 ? (')
  const costInput = source.indexOf('id="branch-stock-adjust-unit-cost"')
  assert.ok(guard !== -1 && costInput > guard, 'the required cost input must sit inside the receipt-row guard')
})

runTest('the raising set explains itself in both packs', () => {
  const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
  const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
  for (const key of ['stock_set_up_hint', 'stock_set_down_hint']) {
    assert.ok(en[key], `en.json is missing ${key}`)
    assert.ok(km[key], `km.json is missing ${key}`)
    assert.notEqual(en[key], km[key], `${key} must be really translated, not the English string copied`)
  }
  assert.match(source, /stock_set_up_hint/, 'the Δ line carries the hint that explains why the receipt fields appeared')
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} branch-stock-adjuster set-raise test(s) failed`)
} else {
  console.log('\nAll branch stock adjuster set-raise tests passed')
}
