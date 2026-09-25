import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import {
  STOCK_IN_LINE_EDIT_ERRORS, STOCK_IN_LINE_REASON_MAX, STOCK_IN_LINE_MAX_QUANTITY, buildStockInLineEditBody, isStockInLineEditable,
  newStockInLineEditRequestId, stockInLineDraft, stockInLineEditErrorText, stockInLineUnitCost,
} from '../src/utils/stockInLineEdit.ts'

// N6 (owner, 23 Sep 2026): "Stock-in sessions editable (today only add or
// delete)." The Worker writer (cloudflare/src/lib/stockInLineEdit.ts) is the
// enforcement and is driven for real by
// cloudflare/scripts/test-stock-in-line-edit-pure.cjs. These checks hold the
// client half: the smallest honest body, validation that matches the Worker's
// parser, translated refusals, the Edit action on the session surface in the
// compact layout, both language packs, and the guarded undo/redo request.

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const row = {
  id: 41, quantity: 10, batch_id: 7, batch_revision: 4, batch_received_at: '2026-09-05', batch_supplier_id: null,
  batch_supplier_name: 'Fixture Supplier', batch_unit_cost_usd: 2, unit_cost_usd: 2, total_cost_usd: 20,
}
const tr = (_key: string, fallback: string) => fallback

runTest('an untouched draft builds an unchanged body that still pins the line it was opened on', () => {
  const built = buildStockInLineEditBody(row, stockInLineDraft(row), 'sil-request-0001', true)
  assert.equal(built.ok, true)
  if (!built.ok) return
  assert.equal(built.changed, false)
  assert.deepEqual(built.body, { client_request_id: 'sil-request-0001', quantity: 10, expected_quantity: 10, expected_batch_id: 7, expected_batch_revision: 4 })
})

runTest('only the changed fields are sent; a cost is never sent without cost-entry permission', () => {
  const draft = { ...stockInLineDraft(row), quantity: '12', unitCostUsd: '3', receivedDate: '2026-09-07', supplierName: 'Other' }
  const withCost = buildStockInLineEditBody(row, draft, 'sil-request-0002', true)
  assert.ok(withCost.ok && withCost.changed)
  if (!withCost.ok) return
  assert.deepEqual(withCost.body, {
    client_request_id: 'sil-request-0002', quantity: 12, expected_quantity: 10, expected_batch_id: 7, expected_batch_revision: 4,
    unit_cost_usd: 3, received_date: '2026-09-07', supplier_id: null, supplier_name: 'Other',
  })
  const noCost = buildStockInLineEditBody(row, draft, 'sil-request-0003', false)
  assert.ok(noCost.ok)
  if (noCost.ok) assert.equal('unit_cost_usd' in noCost.body, false)
})

runTest('validation matches the Worker parser: quantity >= 0, cost >= 0, reason <= 512', () => {
  const base = stockInLineDraft(row)
  assert.deepEqual(buildStockInLineEditBody(row, { ...base, quantity: '-1' }, 'sil-request-0004', true), { ok: false, errorKey: 'stock_in_line_error_quantity', fallback: 'Enter a quantity between 0 and 1,000,000,000.' })
  assert.equal(buildStockInLineEditBody(row, { ...base, quantity: '' }, 'sil-request-0004', true).ok, false)
  assert.equal(buildStockInLineEditBody(row, { ...base, unitCostUsd: '-2' }, 'sil-request-0004', true).ok, false)
  assert.equal(buildStockInLineEditBody(row, { ...base, reason: 'x'.repeat(513) }, 'sil-request-0004', true).ok, false)
  const zero = buildStockInLineEditBody(row, { ...base, quantity: '0' }, 'sil-request-0004', true)
  assert.ok(zero.ok && zero.changed, 'quantity 0 is how an edited line is removed')
  assert.equal(STOCK_IN_LINE_MAX_QUANTITY, 1_000_000_000)
  for (const quantity of ['1.25', '1000000000']) assert.equal(buildStockInLineEditBody(row, { ...base, quantity }, 'sil-request-0004', true).ok, true)
  for (const quantity of ['1000000001', 'NaN', 'Infinity']) assert.equal(buildStockInLineEditBody(row, { ...base, quantity }, 'sil-request-0004', true).ok, false)
  for (const batch_revision of [undefined, null, -1, 0.1, Number.MAX_SAFE_INTEGER + 1]) assert.equal(buildStockInLineEditBody({ ...row, batch_revision }, base, 'sil-request-0004', true).ok, false)
  assert.equal(buildStockInLineEditBody({ ...row, batch_revision: 0 }, base, 'sil-request-0004', true).ok, true)
  const worker = fs.readFileSync(new URL('../../cloudflare/src/lib/stockInLineEdit.ts', import.meta.url), 'utf8')
  assert.match(worker, /quantity < 0 \|\| quantity > MAX_QUANTITY/)
  assert.match(worker, /body\.unit_cost_usd < 0/)
  assert.match(worker, /stockReasonTooLong\(reason\)/)
  const reasonCap = fs.readFileSync(new URL('../../cloudflare/src/lib/stockReason.ts', import.meta.url), 'utf8')
  assert.match(reasonCap, new RegExp(`STOCK_REASON_MAX_LENGTH = ${STOCK_IN_LINE_REASON_MAX}\\b`))
})

runTest('every refusal code the client translates is one the Worker actually sends, and {min} is filled', () => {
  // The writer's own codes, plus the receipt-gate kernel's it re-runs on a changed supplier/cost.
  const worker = fs.readFileSync(new URL('../../cloudflare/src/lib/stockInLineEdit.ts', import.meta.url), 'utf8')
    + fs.readFileSync(new URL('../../cloudflare/src/lib/stockReceiptGate.ts', import.meta.url), 'utf8')
  for (const code of Object.keys(STOCK_IN_LINE_EDIT_ERRORS)) assert.ok(worker.includes(`'${code}'`), `Worker sends ${code}`)
  const text = stockInLineEditErrorText({ code: 'below_consumed', message: '4 of these units were already sold or moved out of this received date. The lowest quantity allowed is 4.' }, tr)
  assert.equal(text, 'Some of these units were already sold or moved out. The lowest quantity allowed is 4.')
  assert.equal(stockInLineEditErrorText({ code: 'something_else', message: 'Server words' }, tr), 'Server words')
})

runTest('only a line that received stock into a lot can be edited; the unit cost reads the line total first', () => {
  assert.equal(isStockInLineEditable(row), true)
  assert.equal(isStockInLineEditable({ id: null, batch_id: null }), false)
  assert.equal(isStockInLineEditable({ id: 5, batch_id: null }), false)
  assert.equal(stockInLineUnitCost({ ...row, total_cost_usd: 36, quantity: 12, batch_unit_cost_usd: 3 }), 3)
  assert.equal(stockInLineUnitCost({ ...row, total_cost_usd: null, batch_unit_cost_usd: 2.5 }), 2.5)
  const id = newStockInLineEditRequestId()
  assert.match(id, /^[A-Za-z0-9_-]{8,120}$/, 'the id passes the Worker REQUEST_ID pattern')
  assert.notEqual(id, newStockInLineEditRequestId())
})

runTest('the session surface offers Edit on each received line, in the compact layout, and removes an edited line through the writer', () => {
  const source = fs.readFileSync(new URL('../src/components/products/StockInSessionsSection.tsx', import.meta.url), 'utf8')
  assert.equal((source.match(/aria-label=\{tr\('stock_in_line_edit', 'Edit line'\)\}/g) || []).length, 2, 'desktop table and phone card')
  assert.match(source, /onClick=\{\(\) => startLineEdit\(row\)\}/)
  assert.match(source, /data-testid="stock-in-line-editor"[^>]*>/)
  assert.match(source, /className="grid grid-cols-2 gap-2 sm:grid-cols-4"/, 'two columns on a phone, one row of four on desktop')
  assert.match(source, /idPrefix="stock-in-line-edit"/)
  assert.match(source, /\{canEditCosts \? <label[^]*?unit_cost/, 'the cost field is offered only with cost-entry permission')
  assert.match(source, /Number\(row\.edit_count\) > 0 && row\.id != null\s*\? editStockInLine\(/, 'an edited line is removed as an edit to 0, not a ledger revert')
  assert.match(source, /editStockInLine\(attempt\.movementId, attempt\.body\)/)
  assert.match(source, /<fieldset disabled=\{busy \|\| Boolean\(pendingAttempt\)\}/)
  assert.match(source, /max=\{STOCK_IN_LINE_MAX_QUANTITY\}/)
  assert.match(source, /onClose=\{closeSession\}/)
})

runTest('both language packs carry every key the edit surface uses', () => {
  const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
  const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))
  const keys = ['stock_in_line_edit', 'stock_in_line_edited', 'stock_in_line_updated', 'stock_in_line_edit_action', 'stock_in_line_edit_hint',
    'stock_in_line_edit_reason_placeholder', 'stock_in_line_error_quantity', 'stock_in_line_error_cost', 'stock_in_line_error_reason',
    ...Object.values(STOCK_IN_LINE_EDIT_ERRORS).map(([key]) => key)]
  for (const key of keys) {
    assert.ok(typeof en[key] === 'string' && en[key], `en ${key}`)
    assert.ok(typeof km[key] === 'string' && km[key] && km[key] !== en[key], `km ${key}`)
  }
  assert.ok(km.stock_in_line_error_below_consumed.includes('{min}'))
})

runTest('undo and redo of a line edit send the guarded generation', () => {
  const actionHistorySource = fs.readFileSync(new URL('../src/utils/actionHistory.ts', import.meta.url), 'utf8')
  const helper = actionHistorySource.match(/export function buildServerReplayRequest[\s\S]*?\r?\n}\r?\n/)?.[0] || ''
  const build = new Function(`${stripTypeScriptTypes(helper.replace('export ', ''))}; return buildServerReplayRequest`)()
  assert.deepEqual(build({ applier: 'stock.session_line_edit', generation: 1 }), { require_applied: true, expected_generation: 1 })
})

if (failed) process.exit(1)
