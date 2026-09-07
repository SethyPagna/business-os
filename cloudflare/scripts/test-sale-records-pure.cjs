// A sale's RECORDS list: the union of every writer that changes a sale (N41,
// lib/saleRecords.ts + migration 0129).
//
// The expanded sale detail opens "Records n", a float that says who changed
// what, with before and after. A sale is changed by
// four different writers that each record themselves somewhere different, so the
// interesting failures are all failures of the UNION, and every case here is
// chosen because a plausible simpler implementation gets it WRONG:
//
//   1. ORDER. sale_amendments/audit_logs store 'YYYY-MM-DD HH:MM:SS' while a
//      sale's own created_at can be a client ISO stamp with a 'T'. 'T' > ' ',
//      so sorting the raw strings puts the sale's creation AFTER changes made
//      to it hours later. The fixture is built so a string sort is visibly
//      wrong.
//   2. ONE ACT, ONE RECORD. Every amendment writes a ledger entry AND an audit
//      row. A naive union shows the same correction twice, and -- worse -- the
//      "Records n" on the list row disagrees with the number of lines in the
//      float. Both the detail builder and the count SQL must suppress the twin.
//   3. THE BULK GAP. A bulk status change writes ONE audit row keyed by the
//      operation id, not by sale. Reading audit_logs alone reports NOTHING for
//      a sale that was cancelled in a bulk action.
//   4. BEFORE/AFTER per kind: quantities for a line, dollars for the two
//      delivery kinds, status strings for a transition, ids for a customer
//      swap, and the per-sale entry dug out of a bulk receipt's items array.
//   5. THE ACTOR is the account USERNAME (N13), taken from the row.
//   6. THE NEW LEDGER KIND. 0129 (Codex) widened sale_amendments.kind with
//      'delivery_actual_cost_changed'; this module normalizes it to the record
//      kind 'delivery_cost_changed'. Driven against the real migration files
//      read off disk, not a retyped schema, so a renamed kind fails here.
//
// Run: node scripts/test-sale-records-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

function compile(file, stubs = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', file)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const moduleObj = { exports: {} }
  const localRequire = (request) => Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : require(request)
  new Function('exports', 'require', 'module', output)(moduleObj.exports, localRequire, moduleObj)
  return moduleObj.exports
}

const salesStatus = compile('salesStatus.ts')
const productBatches = compile('productBatches.ts', {
  './db': {},
  './batchCode': compile('batchCode.ts'),
  './sqlBinding': compile('sqlBinding.ts'),
})
const saleTransitions = compile('saleTransitions.ts', { './salesStatus': salesStatus, './productBatches': productBatches })
const saleTotals = compile('saleTotals.ts')
const financialPrecision = compile('financialPrecision.ts')
const saleLineAddition = compile('saleLineAddition.ts', {
  './salesStatus': salesStatus,
  './saleTransitions': saleTransitions,
  './productBatches': productBatches,
  './saleTotals': saleTotals,
  './financialPrecision': financialPrecision,
})
const saleAmendments = compile('saleAmendments.ts', {
  './salesStatus': salesStatus,
  './saleTransitions': saleTransitions,
  './productBatches': productBatches,
  './saleTotals': saleTotals,
  './financialPrecision': financialPrecision,
  './saleLineAddition': saleLineAddition,
})
const subject = compile('saleRecords.ts', { './saleAmendments': saleAmendments })

const {
  SALE_RECORD_KINDS,
  SALE_RECORDS_COUNT_BINDS_PER_ID,
  auditRecord,
  buildSaleRecords,
  buildSaleRecordsCountSql,
  bulkRecord,
  ledgerRecord,
  orderSaleRecords,
  saleCreatedRecord,
  saleRecordsCountBinds,
  SALE_RECORDS_SELF_COUNT,
} = subject

let failed = 0
function runTest(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// ---------------------------------------------------------------------------
// The fixture. Sale 77 was rung up at 09:00 (a client ISO stamp), then during
// the day: the delivery fee was corrected, a line's quantity raised, the actual
// courier cost recorded, the customer attached, and finally the whole thing
// cancelled inside a bulk action.
// ---------------------------------------------------------------------------
const SALE = {
  id: 77,
  created_at: '2026-09-06T09:00:00Z',
  cashier_name: 'sokha',
  receipt_number: '20260906-090000',
  sale_status: 'cancelled',
  total_usd: 12.5,
  payment_method: 'Cash',
  payment_details: JSON.stringify([{ method: 'Cash', amount_usd: 12.5, amount_khr: 0 }]),
  amount_paid_usd: 12.5,
  amount_paid_khr: 0,
  items: [{ product_name: 'Serum', quantity: 1, applied_price_usd: 12.5, total_usd: 12.5 }],
}

const LEDGER = [
  {
    id: 11, kind: 'delivery_fee_changed', product_name: null,
    quantity_before: null, quantity_after: null,
    amount_before_usd: 1.5, amount_after_usd: 2, total_before_usd: 12, total_after_usd: 12.5,
    units_moved: 0, stock_skipped: 0, via: 'amend', user_name: 'sokha',
    created_at: '2026-09-06 10:15:00',
  },
  {
    id: 12, kind: 'line_quantity_increased', product_name: 'Serum',
    quantity_before: 1, quantity_after: 2,
    amount_before_usd: null, amount_after_usd: null, total_before_usd: 12.5, total_after_usd: 15.5,
    units_moved: -1, stock_skipped: 0, via: 'amend', user_name: 'dara',
    created_at: '2026-09-06 11:00:00',
  },
  {
    id: 13, kind: 'delivery_actual_cost_changed', product_name: null,
    quantity_before: null, quantity_after: null,
    amount_before_usd: null, amount_after_usd: 0.75, total_before_usd: 15.5, total_after_usd: 15.5,
    units_moved: 0, stock_skipped: 0, via: 'amend', user_name: 'dara',
    created_at: '2026-09-06 11:30:00',
  },
]

const AUDIT = [
  // The twin of ledger entry 11 -- one act, and it must not be reported twice.
  {
    id: 501, action: 'update', user_name: 'sokha', created_at: '2026-09-06 10:15:00',
    details: JSON.stringify({ action: 'amend', kind: 'delivery_fee_changed', fee_before: 1.5, fee_after: 2 }),
  },
  {
    id: 502, action: 'update', user_name: 'dara', created_at: '2026-09-06 12:00:00',
    details: JSON.stringify({ previous_customer_id: null, next_customer_id: 9, membership_number: 'M-0009' }),
  },
  {
    id: 503, action: 'update', user_name: 'dara', created_at: '2026-09-06 12:30:00',
    details: JSON.stringify({ oldStatus: 'awaiting_payment', newStatus: 'completed' }),
  },
]

const BULK = [{
  operation_id: 'op-abc',
  request_json: JSON.stringify({ client_request_id: 'r1', target_status: 'cancelled', items: [{ id: 77 }] }),
  receipt_json: JSON.stringify({
    operationId: 'op-abc',
    items: [
      { id: 76, receipt_number: 'x', before: 'completed', after: 'cancelled', changed: true },
      { id: 77, receipt_number: '20260906-090000', before: 'completed', after: 'cancelled', changed: true },
    ],
  }),
  history_id: 90,
  created_at: '2026-09-06 17:45:00',
  created_by_name: 'admin',
}]

// ---------------------------------------------------------------------------
runTest('the sale creation leads the list even though its stamp sorts LAST as a string', () => {
  const records = buildSaleRecords({ sale: SALE, ledger: LEDGER, audit: AUDIT, bulk: BULK })
  // The discriminating fact: a raw string sort would rank the ISO 'T' stamp
  // above every 'YYYY-MM-DD HH:MM:SS' one, so this fixture separates the two
  // implementations rather than merely exercising the right one.
  const rawSorted = [...records].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  assert.notStrictEqual(rawSorted[0].id, 'sale:77', 'fixture must be one a naive string sort gets wrong')

  assert.strictEqual(records[0].id, 'sale:77')
  assert.strictEqual(records[0].kind, 'sale_created')
  assert.deepStrictEqual(
    records.map((r) => r.id),
    ['sale:77', 'amendment:11', 'amendment:12', 'amendment:13', 'audit:502', 'audit:503', 'bulk:op-abc'],
  )
})

runTest("an amendment's audit twin is suppressed, so one act is one record", () => {
  const records = buildSaleRecords({ sale: SALE, ledger: LEDGER, audit: AUDIT, bulk: BULK })
  assert.ok(!records.some((r) => r.id === 'audit:501'), 'the details.action=amend row is the ledger entry, not a second record')
  const feeRecords = records.filter((r) => r.kind === 'delivery_fee_changed')
  assert.strictEqual(feeRecords.length, 1, 'the fee correction appears exactly once')
  assert.strictEqual(auditRecord(AUDIT[0]), null)
})

runTest('every record carries the acting account USERNAME, never a display name', () => {
  const records = buildSaleRecords({ sale: SALE, ledger: LEDGER, audit: AUDIT, bulk: BULK })
  assert.deepStrictEqual(
    records.map((r) => r.actor_username),
    ['sokha', 'sokha', 'dara', 'dara', 'dara', 'dara', 'admin'],
  )
})

runTest('before/after is money for the delivery kinds and units for a line', () => {
  const fee = ledgerRecord(LEDGER[0])
  assert.strictEqual(fee.kind, 'delivery_fee_changed')
  assert.strictEqual(fee.subject, 'delivery')
  assert.deepStrictEqual(fee.before, { amount_usd: 1.5, total_usd: 12 })
  assert.deepStrictEqual(fee.after, { amount_usd: 2, total_usd: 12.5 })

  const qty = ledgerRecord(LEDGER[1])
  assert.strictEqual(qty.kind, 'item_qty_changed')
  assert.strictEqual(qty.subject, 'Serum')
  assert.deepStrictEqual(qty.before, { quantity: 1, total_usd: 12.5 })
  assert.deepStrictEqual(qty.after, { quantity: 2, total_usd: 15.5 })

  // The courier cost is NOT part of what the customer owes, so the sale total
  // is the same on both sides -- and saying so is the point: a reader must be
  // able to see that this change moved cost without moving the total.
  const cost = ledgerRecord(LEDGER[2])
  assert.strictEqual(cost.kind, 'delivery_cost_changed')
  assert.deepStrictEqual(cost.before, { amount_usd: null, total_usd: 15.5 })
  assert.deepStrictEqual(cost.after, { amount_usd: 0.75, total_usd: 15.5 })
})

runTest('an undo keeps the kind of what it moved and says so through via', () => {
  const undone = ledgerRecord({ ...LEDGER[1], id: 14, via: 'undo', quantity_before: 2, quantity_after: 1 })
  assert.strictEqual(undone.kind, 'item_qty_changed', 'the reader still needs to know WHICH line moved')
  assert.strictEqual(undone.via, 'undo')
})

runTest('settling a credit sale is its own kind, and cancelling is not just "status changed"', () => {
  const settled = auditRecord(AUDIT[2])
  assert.strictEqual(settled.kind, 'payment_settled')
  assert.deepStrictEqual(settled.before, { sale_status: 'awaiting_payment' })

  const cancelled = auditRecord({
    id: 504, action: 'update', user_name: 'admin', created_at: '2026-09-06 13:00:00',
    details: JSON.stringify({ oldStatus: 'completed', newStatus: 'cancelled', cancelReason: 'customer_changed_mind', cancelNote: 'called back' }),
  })
  assert.strictEqual(cancelled.kind, 'cancelled')
  assert.strictEqual(cancelled.after.cancel_reason, 'customer_changed_mind')

  const plain = auditRecord({
    id: 505, action: 'update', user_name: 'admin', created_at: '2026-09-06 13:10:00',
    details: JSON.stringify({ oldStatus: 'completed', newStatus: 'awaiting_delivery' }),
  })
  assert.strictEqual(plain.kind, 'status_changed')
})

runTest('sale creation includes products and original tender amounts', () => {
  const created = saleCreatedRecord(SALE)
  assert.deepStrictEqual(created.after.products, [
    { product: 'Serum', quantity: 1, unit_price_usd: 12.5, line_total_usd: 12.5 },
  ])
  assert.strictEqual(created.after.payment_method, 'Cash')
  assert.strictEqual(created.after.amount_paid_usd, 12.5)
  assert.deepStrictEqual(created.after.payment_details, [{ method: 'Cash', amount_usd: 12.5, amount_khr: 0 }])
})

runTest('a payment correction is one rich record, not a status-only duplicate', () => {
  const at = '2026-09-06 12:30:00'
  const generic = {
    id: 700, action: 'update', user_name: 'dara', created_at: at,
    details: JSON.stringify({ oldStatus: 'awaiting_payment', newStatus: 'completed' }),
  }
  const explicit = {
    id: 701, action: 'sale_settlement', user_name: 'dara', created_at: at,
    details: JSON.stringify({
      paymentCorrection: true,
      before: { sale_status: 'awaiting_payment', payment_method: null, payment_details: null, amount_paid_usd: 0, amount_paid_khr: 0 },
      after: { sale_status: 'completed', payment_method: 'ABA', payment_details: '[{"method":"ABA","amount_usd":90,"amount_khr":0}]', amount_paid_usd: 90, amount_paid_khr: 0 },
    }),
  }
  const records = buildSaleRecords({ sale: SALE, audit: [generic, explicit] })
  const payments = records.filter((record) => record.kind === 'payment_settled')
  assert.strictEqual(payments.length, 1, 'the matching generic status audit is the explicit settlement twin')
  assert.strictEqual(payments[0].summary, 'Payment corrected')
  assert.strictEqual(payments[0].before.payment_method, null)
  assert.strictEqual(payments[0].after.payment_method, 'ABA')
  assert.strictEqual(payments[0].after.amount_paid_usd, 90)
  assert.deepStrictEqual(payments[0].after.payment_details, [{ method: 'ABA', amount_usd: 90, amount_khr: 0 }])
})

runTest('a customer swap reports both ids', () => {
  const record = auditRecord(AUDIT[1])
  assert.strictEqual(record.kind, 'customer_changed')
  assert.deepStrictEqual(record.before, { customer_id: null })
  assert.strictEqual(record.after.customer_id, 9)
  assert.strictEqual(record.after.membership_number, 'M-0009')
})

runTest('an undo/redo replay that writes no ledger entry is the one thing kind "undone" is for', () => {
  const record = auditRecord({
    id: 506, action: 'action_undo', user_name: 'admin', created_at: '2026-09-06 14:00:00',
    details: JSON.stringify({ applier: 'sale.settlement', operationId: 'op-1', direction: 'undo' }),
  })
  assert.strictEqual(record.kind, 'undone')
  assert.strictEqual(record.after.direction, 'undo')
})

runTest('the add-items undo applier writes BOTH a ledger row and an audit row, and the pair is ONE record', () => {
  // undoAppliers.ts:486-496 (atomic) and :1197-1213 (non-atomic) write a
  // 'line_removed' amendment via 'undo', AND :561 / :1284-1290 write an
  // action_undo audit row carrying details.applier = 'sale.add_items'. Both
  // describe the same act. Without the suppression the float shows the reversal
  // twice -- once as "Item removed", once as the contentless "Undone".
  const ledger = [{
    id: 21, kind: 'line_removed', product_name: 'Serum',
    quantity_before: 2, quantity_after: 0,
    amount_before_usd: null, amount_after_usd: null, total_before_usd: 15.5, total_after_usd: 12.5,
    units_moved: 2, stock_skipped: 0, via: 'undo', user_name: 'dara',
    created_at: '2026-09-06 13:00:00',
  }]
  const audit = [{
    id: 520, action: 'action_undo', user_name: 'dara', created_at: '2026-09-06 13:00:00',
    details: JSON.stringify({ via: 'undo_applier', applier: 'sale.add_items', operation_id: 'op-add', lines: 1 }),
  }]
  const records = buildSaleRecords({ sale: SALE, ledger, audit, bulk: [] })
  const changes = records.filter((r) => r.source !== 'sale')
  assert.strictEqual(changes.length, 1, 'one act, one record -- the audit twin is the ledger row again')
  assert.strictEqual(changes[0].kind, 'item_removed', 'the surviving record is the one that says WHICH line moved')
  assert.strictEqual(changes[0].via, 'undo', 'and how it was done rides on via, not on the kind')
  assert.strictEqual(auditRecord(audit[0]), null)
  assert.strictEqual(auditRecord({ ...audit[0], id: 521, action: 'action_redo' }), null, 'the redo twin too')

  // The suppression must be exactly this applier: the settlement replay writes
  // NO ledger row, so dropping it would erase the only trace of the act.
  const settlement = auditRecord({
    id: 522, action: 'action_undo', user_name: 'admin', created_at: '2026-09-06 13:05:00',
    details: JSON.stringify({ applier: 'sale.settlement', operationId: 'op-1', direction: 'undo' }),
  })
  assert.ok(settlement && settlement.kind === 'undone', 'sale.settlement replays stay in the list')
})

runTest('a return is a change to the SALE row, so it is a record on the sale', () => {
  // routes/returns.ts:1658 and :2558 and lib/returnBulkAction.ts:253 all write
  // sales.sale_status = 'returned' / 'partial_return' (and back). None of them
  // writes an entity 'sale' audit row -- returns.ts:2563 audits entity 'return'
  // -- so without a returns source the one change the shop cares about most is
  // missing from the sale's own history.
  const returns = [{
    id: 5, return_number: 'R-0005', status: 'completed', return_scope: 'customer',
    total_refund_usd: 3, cashier_name: 'dara',
    created_at: '2026-09-06 14:00:00', updated_at: '2026-09-06 14:00:00', is_current: 1,
  }]
  const sale = { ...SALE, sale_status: 'partial_return', status_before_return: 'completed' }
  const records = buildSaleRecords({ sale, ledger: [], audit: [], bulk: [], returns })
  const changes = records.filter((r) => r.source === 'return')
  assert.strictEqual(changes.length, 1, 'exactly one record per customer-scope return')
  assert.strictEqual(changes[0].id, 'return:5')
  assert.strictEqual(changes[0].kind, 'status_changed')
  assert.strictEqual(changes[0].actor_username, 'dara')
  assert.strictEqual(changes[0].subject, 'R-0005', 'the subject is the return the reader must open next')
  assert.strictEqual(changes[0].summary, 'Partial return')
  assert.deepStrictEqual(changes[0].before, { sale_status: 'completed' })
  assert.strictEqual(changes[0].after.sale_status, 'partial_return')
  assert.strictEqual(changes[0].after.refund_usd, 3)
})

runTest('a supplier-scope return never touched sales.sale_status, so it is not a sale record', () => {
  // Every writer filters on COALESCE(return_scope,'customer')='customer'
  // (returns.ts:1653, :2550, returnBulkAction.ts:254). Claiming a status change
  // a supplier return never made would be a fabricated record.
  // A sweep that answers "absent" for everything is indistinguishable from a
  // broken instrument, so the KNOWN-OPPOSITE case rides in the same input: a
  // customer-scope return the source must keep.
  const returns = [{
    id: 6, return_number: 'R-0006', status: 'completed', return_scope: 'supplier',
    total_refund_usd: 9, cashier_name: 'dara',
    created_at: '2026-09-06 15:00:00', updated_at: '2026-09-06 15:00:00', is_current: 0,
  }, {
    id: 8, return_number: 'R-0008', status: 'completed', return_scope: 'customer',
    total_refund_usd: 2, cashier_name: 'dara',
    created_at: '2026-09-06 15:30:00', updated_at: '2026-09-06 15:30:00', is_current: 1,
  }]
  const records = buildSaleRecords({ sale: SALE, ledger: [], audit: [], bulk: [], returns })
  const kept = records.filter((r) => r.source === 'return')
  assert.deepStrictEqual(kept.map((r) => r.id), ['return:8'], 'the supplier one is dropped, the customer one is not')
})

runTest('a cancelled return is stamped when it was cancelled, and says the sale came back', () => {
  const returns = [{
    id: 7, return_number: 'R-0007', status: 'cancelled', return_scope: 'customer',
    total_refund_usd: 3, cashier_name: 'sokha',
    created_at: '2026-09-06 14:00:00', updated_at: '2026-09-06 16:30:00', is_current: 0,
  }]
  const records = buildSaleRecords({ sale: SALE, ledger: [], audit: [], bulk: [], returns })
  const record = records.find((r) => r.source === 'return')
  assert.strictEqual(record.summary, 'Return cancelled')
  // created_at would place the reversal two and a half hours before it happened.
  assert.strictEqual(record.at, '2026-09-06 16:30:00')
})

runTest("a bulk action finds THIS sale's own before/after inside the operation receipt", () => {
  const record = bulkRecord(BULK[0], 77)
  assert.strictEqual(record.kind, 'cancelled')
  assert.strictEqual(record.actor_username, 'admin')
  assert.deepStrictEqual(record.before, { sale_status: 'completed' })
  assert.deepStrictEqual(record.after, { sale_status: 'cancelled' })
  // Sale 76 is in the same receipt; picking the first entry would report the
  // wrong sale's transition.
  const other = bulkRecord(BULK[0], 76)
  assert.deepStrictEqual(other.before, { sale_status: 'completed' })
})

runTest('a bulk FIELD update reports the object snapshot rather than a status string', () => {
  const record = bulkRecord({
    operation_id: 'op-cust',
    request_json: JSON.stringify({ client_request_id: 'r2', action: { kind: 'customer', source_id: null, target_id: 4 }, items: [{ id: 77 }] }),
    receipt_json: JSON.stringify({ items: [{ id: 77, before: { customer_id: null, customer_name: null }, after: { customer_id: 4, customer_name: 'Rith' }, changed: true }] }),
    created_at: '2026-09-06 18:00:00',
    created_by_name: 'admin',
  }, 77)
  assert.strictEqual(record.kind, 'customer_changed')
  assert.deepStrictEqual(record.after, { customer_id: 4, customer_name: 'Rith' })
})

runTest('every kind a classifier can produce is in the declared closed set', () => {
  const records = buildSaleRecords({ sale: SALE, ledger: LEDGER, audit: AUDIT, bulk: BULK })
  for (const record of records) {
    assert.ok(SALE_RECORD_KINDS.includes(record.kind), `${record.kind} is not a declared kind`)
  }
})

runTest('an unparseable timestamp keeps a stable position instead of jumping to 1970', () => {
  const broken = { ...LEDGER[0], id: 99, created_at: 'not a date' }
  const ordered = orderSaleRecords([ledgerRecord(broken), saleCreatedRecord(SALE), ledgerRecord(LEDGER[1])])
  assert.strictEqual(ordered[0].id, 'sale:77')
  assert.strictEqual(ordered[ordered.length - 1].id, 'amendment:99')
})

// ---------------------------------------------------------------------------
// The count query, against a real database.
// ---------------------------------------------------------------------------
const MIGRATIONS = path.join(__dirname, '..', 'migrations')
const MIGRATION_0115 = fs.readFileSync(path.join(MIGRATIONS, '0115_sale_amendments.sql'), 'utf8')
// 0129 is Codex's, not this lane's: it is what widened sale_amendments.kind
// with 'delivery_actual_cost_changed'. It is read off disk rather than retyped,
// so renaming the kind there breaks the mapping test here instead of silently
// dropping every courier-cost correction into 'other'.
const MIGRATION_0129 = fs.readFileSync(path.join(MIGRATIONS, '0129_sale_actual_delivery_cost_amendment.sql'), 'utf8')

function setup(withCostKind) {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE system_flags (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE sale_write_revisions (sale_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE sales (id INTEGER PRIMARY KEY, receipt_number TEXT, sale_status TEXT, cashier_name TEXT,
      total_usd REAL, created_at TEXT);
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, user_name TEXT, action TEXT,
      entity TEXT, entity_id TEXT, details TEXT, table_name TEXT, record_id TEXT, old_value TEXT, new_value TEXT,
      device_name TEXT, device_tz TEXT, client_time TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE sale_bulk_operations (id TEXT PRIMARY KEY, actor_id INTEGER NOT NULL, request_id TEXT NOT NULL,
      request_json TEXT NOT NULL, snapshot_id INTEGER, history_id INTEGER, generation INTEGER NOT NULL DEFAULT 0,
      receipt_json TEXT NOT NULL, UNIQUE(actor_id, request_id));
    CREATE TABLE sale_bulk_members (operation_id TEXT NOT NULL, sale_id INTEGER NOT NULL, revision INTEGER NOT NULL,
      movement_fingerprint TEXT NOT NULL, PRIMARY KEY(operation_id, sale_id));
    CREATE TABLE returns (id INTEGER PRIMARY KEY AUTOINCREMENT, return_number TEXT, sale_id INTEGER,
      cashier_name TEXT, status TEXT DEFAULT 'completed', return_scope TEXT DEFAULT 'customer',
      total_refund_usd REAL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE action_history (id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT DEFAULT 'global', entity TEXT,
      entity_id TEXT, label TEXT NOT NULL, undo_label TEXT, redo_label TEXT, reversible INTEGER DEFAULT 1,
      status TEXT DEFAULT 'undoable', undo_payload TEXT DEFAULT '{}', redo_payload TEXT DEFAULT '{}', last_error TEXT,
      created_by_id INTEGER, created_by_name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  `)
  sqlite.exec(MIGRATION_0115)
  if (withCostKind) sqlite.exec(MIGRATION_0129)
  return sqlite
}

// The two rows an add-items UNDO leaves behind: one amendment (the record) and
// one audit row (its twin). Seeded so the count SQL is measured against the
// same pair the detail builder collapses.
const UNDO_LEDGER = {
  id: 21, kind: 'line_removed', product_name: 'Serum',
  quantity_before: 2, quantity_after: 0,
  amount_before_usd: null, amount_after_usd: null, total_before_usd: 15.5, total_after_usd: 12.5,
  units_moved: 2, stock_skipped: 0, via: 'undo', user_name: 'dara',
  created_at: '2026-09-06 13:00:00',
}
const UNDO_AUDIT = {
  id: 520, action: 'action_undo', user_name: 'dara', created_at: '2026-09-06 13:00:00',
  details: JSON.stringify({ via: 'undo_applier', applier: 'sale.add_items', operation_id: 'op-add', lines: 1 }),
}
// ...and the REDO of the same act, which leaves the same pair again. Two pairs
// rather than one is deliberate: with a single pair the over-count from the
// missing audit suppression (+1) exactly cancels the under-count from the
// missing returns leg (-1), and a badge that is wrong twice sums to the right
// number. Measured -- the fixture was built with one pair first and both
// implementations answered 9.
const REDO_LEDGER = {
  id: 22, kind: 'line_added', product_name: 'Serum',
  quantity_before: 0, quantity_after: 2,
  amount_before_usd: null, amount_after_usd: null, total_before_usd: 12.5, total_after_usd: 15.5,
  units_moved: -2, stock_skipped: 0, via: 'redo', user_name: 'dara',
  created_at: '2026-09-06 13:30:00',
}
const REDO_AUDIT = {
  id: 521, action: 'action_redo', user_name: 'dara', created_at: '2026-09-06 13:30:00',
  details: JSON.stringify({ via: 'undo_applier', applier: 'sale.add_items', operation_id: 'op-add', lines: 1 }),
}
// One customer-scope return (a record) and one supplier-scope return (not one).
const RETURNS = [
  {
    id: 5, return_number: 'R-0005', status: 'completed', return_scope: 'customer',
    total_refund_usd: 3, cashier_name: 'dara',
    created_at: '2026-09-06 14:00:00', updated_at: '2026-09-06 14:00:00', is_current: 1,
  },
  {
    id: 6, return_number: 'R-0006', status: 'completed', return_scope: 'supplier',
    total_refund_usd: 9, cashier_name: 'dara',
    created_at: '2026-09-06 15:00:00', updated_at: '2026-09-06 15:00:00', is_current: 0,
  },
]
// The sale as the database holds it once the return has landed.
const SALE_RETURNED = { ...SALE, sale_status: 'partial_return', status_before_return: 'completed' }

function seedRecords(sqlite) {
  sqlite.prepare('INSERT INTO sales (id, receipt_number, sale_status, cashier_name, total_usd, created_at) VALUES (@id,@r,@s,@c,@t,@at)')
    .run({ id: SALE.id, r: SALE.receipt_number, s: SALE.sale_status, c: SALE.cashier_name, t: SALE.total_usd, at: SALE.created_at })
  // A second sale with NOTHING but its own creation, so the count query has to
  // answer for a sale that has no rows in any of the three tables.
  sqlite.prepare("INSERT INTO sales (id, receipt_number, sale_status, cashier_name, total_usd, created_at) VALUES (78,'20260906-091500','completed','sokha',4,'2026-09-06T09:15:00Z')").run()

  for (const row of [...LEDGER, UNDO_LEDGER, REDO_LEDGER]) {
    sqlite.prepare(`INSERT INTO sale_amendments (id, sale_id, kind, product_name, quantity_before, quantity_after,
      amount_before_usd, amount_after_usd, total_before_usd, total_after_usd, units_moved, via, user_name, created_at)
      VALUES (@id, 77, @kind, @product_name, @quantity_before, @quantity_after, @amount_before_usd, @amount_after_usd,
      @total_before_usd, @total_after_usd, @units_moved, @via, @user_name, @created_at)`).run({
      id: row.id, kind: row.kind, product_name: row.product_name,
      quantity_before: row.quantity_before, quantity_after: row.quantity_after,
      amount_before_usd: row.amount_before_usd, amount_after_usd: row.amount_after_usd,
      total_before_usd: row.total_before_usd, total_after_usd: row.total_after_usd,
      units_moved: row.units_moved, via: row.via, user_name: row.user_name, created_at: row.created_at,
    })
  }
  for (const row of [...AUDIT, UNDO_AUDIT, REDO_AUDIT]) {
    sqlite.prepare("INSERT INTO audit_logs (id, user_name, action, entity, entity_id, details, created_at) VALUES (@id,@u,@a,'sale','77',@d,@at)")
      .run({ id: row.id, u: row.user_name, a: row.action, d: row.details, at: row.created_at })
  }
  for (const row of RETURNS) {
    sqlite.prepare(`INSERT INTO returns (id, return_number, sale_id, cashier_name, status, return_scope,
      total_refund_usd, created_at, updated_at) VALUES (@id,@n,77,@c,@s,@scope,@r,@at,@up)`).run({
      id: row.id, n: row.return_number, c: row.cashier_name, s: row.status, scope: row.return_scope,
      r: row.total_refund_usd, at: row.created_at, up: row.updated_at,
    })
  }
  // A return on the OTHER sale: sale 78's count must move by exactly one, and
  // sale 77's must not move at all.
  sqlite.prepare("INSERT INTO returns (id, return_number, sale_id, cashier_name, status, return_scope, total_refund_usd, created_at, updated_at) VALUES (9,'R-0009',78,'sokha','completed','customer',1,'2026-09-06 19:30:00','2026-09-06 19:30:00')").run()
  // An audit row about a DIFFERENT sale and a row about another entity: both
  // must be invisible to sale 77's count.
  sqlite.prepare(`INSERT INTO audit_logs (id, user_name, action, entity, entity_id, details, created_at) VALUES (600,'admin','update','sale','78','{"oldStatus":"completed","newStatus":"cancelled"}','2026-09-06 19:00:00')`).run()
  sqlite.prepare(`INSERT INTO audit_logs (id, user_name, action, entity, entity_id, details, created_at) VALUES (602,'admin','sale_payment_correction_opened','sale','78','{"oldStatus":"completed","newStatus":"cancelled"}','2026-09-06 19:00:00')`).run()
  sqlite.prepare("INSERT INTO audit_logs (id, user_name, action, entity, entity_id, details, created_at) VALUES (601,'admin','update','product','77','{}','2026-09-06 19:00:00')").run()

  sqlite.prepare("INSERT INTO sale_bulk_operations (id, actor_id, request_id, request_json, receipt_json, history_id) VALUES ('op-abc',1,'r1',@req,@rec,90)")
    .run({ req: BULK[0].request_json, rec: BULK[0].receipt_json })
  sqlite.prepare("INSERT INTO sale_bulk_members (operation_id, sale_id, revision, movement_fingerprint) VALUES ('op-abc',77,1,'[]')").run()
  sqlite.prepare("INSERT INTO action_history (id, scope, entity, entity_id, label, created_by_name, created_at) VALUES (90,'global','sale','op-abc','2 sales -> cancelled','admin','2026-09-06 17:45:00')").run()
}

runTest('the list-row count equals the number of lines the float shows, for both a busy sale and an untouched one', () => {
  const sqlite = setup(true)
  seedRecords(sqlite)
  const ids = [77, 78]
  const placeholders = ids.map(() => '?').join(',')
  const sql = buildSaleRecordsCountSql(placeholders)
  assert.strictEqual(SALE_RECORDS_COUNT_BINDS_PER_ID, 4, 'the chunker has to know how many lists each id is bound into')
  const rows = sqlite.prepare(sql).all(...saleRecordsCountBinds(ids))
  const counts = new Map(rows.map((row) => [Number(row.sale_id), Number(row.n)]))

  // +1 for the sale's own creation, which no table records.
  const count77 = (counts.get(77) || 0) + SALE_RECORDS_SELF_COUNT
  const count78 = (counts.get(78) || 0) + SALE_RECORDS_SELF_COUNT

  // The badge and the float are computed by two completely different code
  // paths -- SQL against a real database on one side, the classifier on the
  // other -- and this is the assertion that makes them one number.
  const detail77 = buildSaleRecords({
    sale: SALE_RETURNED, ledger: [...LEDGER, UNDO_LEDGER, REDO_LEDGER], audit: [...AUDIT, UNDO_AUDIT, REDO_AUDIT],
    bulk: BULK, returns: RETURNS,
  })
  assert.strictEqual(count77, detail77.length, 'the row badge and the float must agree')
  assert.strictEqual(count77, 10,
    '5 ledger + 2 audit (the amend twin and both add-items twins suppressed) + 1 bulk + 1 customer return + the sale itself')
  assert.strictEqual(count78, 3, "sale 78's own creation, the one audit row about it, and its return")

  // The discriminating half, three ways -- each is a suppression a plausible
  // implementation omits, and each would make the badge disagree with the float.
  const naiveAudit = sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity='sale' AND entity_id='77'").get().n
  assert.strictEqual(naiveAudit, 5, 'five audit rows exist for sale 77')
  assert.strictEqual(detail77.filter((r) => r.source === 'audit').length, 2, 'but only two of them are records')
  const naiveReturns = sqlite.prepare('SELECT COUNT(*) n FROM returns WHERE sale_id=77').get().n
  assert.strictEqual(naiveReturns, 2, 'two returns exist on sale 77')
  assert.strictEqual(detail77.filter((r) => r.source === 'return').length, 1, 'but the supplier one never moved the sale')
  assert.strictEqual(
    detail77.filter((r) => r.via === 'undo' || r.via === 'redo').length, 2,
    'the add-items undo and its redo are their ledger rows, once each',
  )
  sqlite.close()
})

runTest('the applier this module suppresses is spelled the way undoAppliers.ts spells it', () => {
  // The suppression is a string match on details.applier. Import is impossible
  // here (undoAppliers.ts pulls in the D1 binding), so the two spellings are
  // pinned against each other instead of trusted.
  const appliers = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'undoAppliers.ts'), 'utf8')
  const declared = /SALE_ADD_ITEMS_ACTION_KIND\s*=\s*'([^']+)'/.exec(appliers)
  assert.ok(declared, 'undoAppliers.ts must still declare the kind')
  assert.strictEqual(declared[1], 'sale.add_items')
  const moduleSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'saleRecords.ts'), 'utf8')
  assert.ok(moduleSource.includes("'" + declared[1] + "'"), 'saleRecords.ts must suppress exactly that applier')
  // And the applier really does write a ledger entry, which is WHY it is
  // suppressed: if that stops being true the suppression starts hiding the
  // only trace of the reversal.
  assert.match(appliers, /kind: 'line_removed',[\s\S]{0,400}via: 'undo'/,
    'sale.add_items undo must still write its own amendment row')
})

runTest('the audit half of the count binds the sale id as TEXT, which is why the binds are built in one place', () => {
  const sqlite = setup(true)
  seedRecords(sqlite)
  // audit_logs.entity_id is TEXT; sale_amendments.sale_id is INTEGER. Binding
  // the same JavaScript number into both lists -- the obvious implementation --
  // matches NOTHING in audit_logs, so the badge silently drops every status
  // change and every customer swap.
  const sql = buildSaleRecordsCountSql('?')
  const numberBound = sqlite.prepare(sql).all(77, 77, 77, 77)
  const viaHelper = sqlite.prepare(sql).all(...saleRecordsCountBinds([77]))
  const sum = (rows) => rows.reduce((total, row) => total + Number(row.n), 0)
  assert.strictEqual(sum(numberBound), 7, 'number-bound: the two audit records vanish')
  assert.strictEqual(sum(viaHelper), 9, 'text-bound: 5 ledger + 2 audit + 1 bulk + 1 customer return')
  sqlite.close()
})

// ---------------------------------------------------------------------------
// The ledger kind this lane renders, read off the real migrations.
// ---------------------------------------------------------------------------
runTest('0115 alone refuses the courier-cost kind, and 0129 is what admits it', () => {
  const before = setup(false)
  assert.throws(
    () => before.prepare("INSERT INTO sale_amendments (sale_id, kind, total_before_usd, total_after_usd) VALUES (77,'delivery_actual_cost_changed',1,1)").run(),
    /CHECK constraint failed/,
    'without 0129 the kind this lane renders cannot exist',
  )
  before.close()

  const after = setup(true)
  after.prepare("INSERT INTO sale_amendments (id, sale_id, kind, amount_before_usd, amount_after_usd, total_before_usd, total_after_usd, user_name, created_at) VALUES (13,77,'delivery_actual_cost_changed',NULL,0.75,15.5,15.5,'dara','2026-09-06 11:30:00')").run()
  assert.strictEqual(after.prepare("SELECT COUNT(*) n FROM sale_amendments WHERE kind='delivery_actual_cost_changed'").get().n, 1)
  // Still closed, and still append-only: a typo stays a constraint failure
  // rather than a row the float would have to render as 'other'.
  assert.throws(
    () => after.prepare("INSERT INTO sale_amendments (sale_id, kind, total_before_usd, total_after_usd) VALUES (77,'delivery_cost_changed',1,1)").run(),
    /CHECK constraint failed/,
    'the RECORD kind name is not a ledger kind -- the mapping is what bridges them',
  )
  assert.throws(() => after.prepare('UPDATE sale_amendments SET note = ? WHERE id = 13').run('x'), /append-only/)
  assert.throws(() => after.prepare('DELETE FROM sale_amendments WHERE id = 13').run(), /immutable/)
  after.close()
})

runTest('the ledger kind 0129 ships is the one this module maps, not a name it invented', () => {
  assert.match(MIGRATION_0129, /'delivery_actual_cost_changed'/)
  const mapped = ledgerRecord(LEDGER[2])
  assert.strictEqual(mapped.kind, 'delivery_cost_changed', 'the ledger kind normalizes to the record kind the float labels')
  assert.notStrictEqual(mapped.kind, 'other', 'an unmapped ledger kind lands on other and prints a raw string')
})

// ---------------------------------------------------------------------------
// The route, by source shape. There is no Worker runtime in this harness, so
// these assert the four properties that would otherwise only be provable in
// production: the route exists, it reads its meaning from this module, it is
// READ-gated rather than write-gated, and the list badge is not an N+1.
// ---------------------------------------------------------------------------
const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8')

function routeBody(marker) {
  const start = ROUTES.indexOf(marker)
  assert.ok(start >= 0, `${marker} must exist`)
  const end = ROUTES.indexOf("\napp.", start + marker.length)
  return ROUTES.slice(start, end < 0 ? ROUTES.length : end)
}

runTest('the Worker route is actually wired to this module', () => {
  assert.match(ROUTES, /from '\.\.\/lib\/saleRecords'/, 'routes/sales.ts must read the records union from the pure module')
  assert.match(ROUTES, /app\.get\('\/:id\/records'/, 'GET /api/sales/:id/records must exist')
  assert.match(ROUTES, /buildSaleRecordsCountSql/, 'the list must carry records_count from the shared count SQL')
  // The fifth read. A returns source the route never queries is a source that
  // exists only in the tests.
  assert.match(ROUTES, /FROM returns r\s+WHERE r\.sale_id = \?/,
    'the route must read the returns that rewrote this sale status')
  assert.match(ROUTES, /returns: returnRows/, 'and hand them to the union')
  assert.match(ROUTES, /status_before_return/, "the returns source's before comes from the sale row")
  // The customer-scope filter, in the route AND in the count SQL: a supplier
  // return never moved sales.sale_status, and counting it would put a number on
  // the row that the float cannot account for.
  assert.match(ROUTES, /COALESCE\(r\.return_scope,'customer'\) = 'customer'/)
  assert.match(buildSaleRecordsCountSql('?'), /COALESCE\(return_scope, 'customer'\) = 'customer'/)
  assert.match(buildSaleRecordsCountSql('?'), /json_extract\(a\.details, '\$\.applier'\) = 'sale\.add_items'/,
    'the count SQL must drop the add-items undo twin the classifier drops')
})

runTest('the records route is gated on READING a sale, not on amending one', () => {
  const body = routeBody("app.get('/:id/records'")
  assert.match(body, /canReadSales\(/, 'a view-tier bookkeeper who can see the sale can see how it got that way')
  assert.ok(!/getActionTier|hasPermission\(/.test(body), 'gating this on the amend action would hide the trail from the people who reconcile the books')
  // All four sources, or the union is a union of three.
  assert.match(body, /FROM sale_amendments/)
  assert.match(body, /FROM audit_logs/)
  assert.match(body, /FROM sale_items WHERE sale_id = \?/, 'sale creation must include the products actually recorded')
  assert.match(body, /payment_method, payment_details, amount_paid_usd, amount_paid_khr/, 'sale creation must include its original tender')
  assert.match(body, /FROM sale_bulk_members/)
  assert.match(body, /buildSaleRecords\(/)
  // The TEXT bind, in the route as well as in the count SQL.
  assert.match(body, /String\(saleId\)/, "audit_logs.entity_id is TEXT; binding the number matches nothing")
})

runTest('the list badge is one statement per chunk, not one query per sale', () => {
  const list = ROUTES.slice(ROUTES.indexOf('const recordsBySale'), ROUTES.indexOf('records_count:'))
  assert.match(list, /chunkForBinding\(saleIds, 0, SALE_RECORDS_COUNT_BINDS_PER_ID\)/,
    'each id is bound into three IN lists, so the chunker must be told that cost')
  assert.ok(!/for \(const sale of sales\)/.test(list), 'a per-sale loop over the database is the N+1 this exists to avoid')
  assert.match(ROUTES, /records_count: \(recordsBySale\.get\(sale\.id\) \|\| 0\) \+ SALE_RECORDS_SELF_COUNT/,
    'the badge adds the sale\'s own creation, which no table records')
})

if (failed) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('sale records union: all cases pass')
