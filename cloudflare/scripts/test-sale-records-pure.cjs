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
const actorSnapshot = compile('actorSnapshot.ts')
const saleCreationSnapshot = compile('saleCreationSnapshot.ts', { './actorSnapshot': actorSnapshot })
const subject = compile('saleRecords.ts', {
  './saleAmendments': saleAmendments,
  './saleCreationSnapshot': saleCreationSnapshot,
})

const {
  SALE_RECORD_FIELDS,
  SALE_RECORD_KINDS,
  SALE_RECORDS_COUNT_BINDS_PER_ID,
  auditRecord,
  buildSaleRecords,
  buildSaleRecordsCountSql,
  bulkRecord,
  ledgerRecord,
  orderSaleRecords,
  reconstructSaleCreation,
  returnAuditRecord,
  returnBulkEventRecord,
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

function changed(record, field) {
  const entry = record.changes.find((candidate) => candidate.field === field)
  assert.ok(entry, `${record.kind} must include changed field ${field}`)
  return entry
}

function known(entry, side = 'after') {
  assert.strictEqual(entry[side].state, 'known_value')
  return entry[side].value
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
  assert.strictEqual(qty.kind, 'item_quantity_changed')
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

  const price = ledgerRecord({
    id: 15, kind: 'line_updated', product_name: 'Serum',
    quantity_before: 2, quantity_after: 2,
    amount_before_usd: 3, amount_after_usd: 4.5,
    total_before_usd: 6, total_after_usd: 9,
    before_json: JSON.stringify({ quantity: 2, unit_price_usd: 3 }),
    after_json: JSON.stringify({ quantity: 2, unit_price_usd: 4.5 }),
    units_moved: 0, stock_skipped: 0, via: 'amend', user_name: 'sokha',
    created_at: '2026-09-06 11:45:00',
  })
  assert.strictEqual(price.kind, 'item_price_changed')
  assert.deepStrictEqual(price.before, { quantity: 2, unit_price_usd: 3, total_usd: 6 })
  assert.deepStrictEqual(price.after, { quantity: 2, unit_price_usd: 4.5, total_usd: 9 })

  const discounted = ledgerRecord({
    id: 16, kind: 'line_updated', product_name: 'Cream',
    quantity_before: 1, quantity_after: 2,
    amount_before_usd: 27, amount_after_usd: 24,
    total_before_usd: 27, total_after_usd: 48,
    before_json: JSON.stringify({ quantity: 1, unit_price_usd: 27, base_price_usd: 30, product_discount_usd: 0, manual_discount_type: 'fixed', manual_discount_value: 3, manual_discount_usd: 3, total_usd: 27 }),
    after_json: JSON.stringify({ quantity: 2, unit_price_usd: 24, base_price_usd: 30, product_discount_usd: 0, manual_discount_type: 'percent', manual_discount_value: 20, manual_discount_usd: 6, total_usd: 48 }),
    units_moved: 1, stock_skipped: 0, via: 'amend', user_name: 'sokha',
    created_at: '2026-09-11 10:00:00',
  })
  assert.deepStrictEqual(discounted.before, {
    quantity: 1, unit_price_usd: 27, base_price_usd: 30, product_discount_usd: 0,
    manual_discount_type: 'fixed', manual_discount_value: 3, manual_discount_usd: 3,
    line_total_usd: 27, total_usd: 27,
  })
  assert.deepStrictEqual(discounted.after, {
    quantity: 2, unit_price_usd: 24, base_price_usd: 30, product_discount_usd: 0,
    manual_discount_type: 'percent', manual_discount_value: 20, manual_discount_usd: 6,
    line_total_usd: 48, total_usd: 48,
  })
})

runTest('adding delivery is one truthful record with driver and complete USD/KHR snapshots', () => {
  const before = {
    is_delivery: false, delivery_contact_id: null, delivery_contact_name: null,
    delivery_contact_phone: null, delivery_contact_address: null,
    delivery_fee_usd: 0, delivery_fee_khr: 0, delivery_fee_paid_by: null,
    delivery_actual_cost_usd: null, delivery_actual_cost_khr: null,
    exchange_rate: 4000, total_usd: 10, total_khr: 40000,
  }
  const after = {
    is_delivery: true, delivery_contact_id: 9, delivery_contact_name: 'Driver Dara',
    delivery_contact_phone: '0123', delivery_contact_address: 'Zone A',
    delivery_fee_usd: 2.5, delivery_fee_khr: 10000, delivery_fee_paid_by: 'customer',
    delivery_actual_cost_usd: 4, delivery_actual_cost_khr: 16000,
    exchange_rate: 4000, total_usd: 12.5, total_khr: 50000,
  }
  const record = ledgerRecord({
    id: 14, kind: 'delivery_added', product_name: null,
    quantity_before: null, quantity_after: null,
    amount_before_usd: 0, amount_after_usd: 2.5,
    total_before_usd: 10, total_after_usd: 12.5,
    before_json: JSON.stringify(before), after_json: JSON.stringify(after),
    units_moved: 0, stock_skipped: 0, via: 'amend', user_name: 'sokha',
    created_at: '2026-09-06 11:40:00',
  })
  assert.strictEqual(record.kind, 'delivery_added')
  assert.strictEqual(record.actor_username, 'sokha')
  assert.strictEqual(record.at, '2026-09-06 11:40:00')
  assert.strictEqual(record.subject, 'Driver Dara')
  assert.deepStrictEqual(record.before, before)
  assert.deepStrictEqual(record.after, after)
})

runTest('an undo keeps the kind of what it moved and says so through via', () => {
  const undone = ledgerRecord({ ...LEDGER[1], id: 14, via: 'undo', quantity_before: 2, quantity_after: 1 })
  assert.strictEqual(undone.kind, 'item_quantity_changed', 'the reader still needs to know WHICH line moved')
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

runTest('sale creation includes products and original tender amounts when no later writer changed them', () => {
  const created = saleCreatedRecord(SALE)
  assert.deepStrictEqual(created.after.products, [
    { product: 'Serum', quantity: 1, unit_price_usd: 12.5, line_total_usd: 12.5 },
  ])
  assert.strictEqual(created.after.payment_method, 'Cash')
  assert.strictEqual(created.after.amount_paid_usd, 12.5)
  assert.deepStrictEqual(created.after.payment_details, [{ method: 'Cash', amount_usd: 12.5, amount_khr: 0 }])
})

runTest('sale creation reconstructs immutable originals instead of restating the current mutable row', () => {
  const current = {
    ...SALE,
    sale_status: 'completed',
    total_usd: 15.5,
    payment_method: 'Cash',
    payment_details: JSON.stringify([{ method: 'Cash', amount_usd: 15.5 }]),
    amount_paid_usd: 15.5,
    items: [{ product_name: 'Serum', quantity: 2, applied_price_usd: 7.75, total_usd: 15.5 }],
  }
  const settlement = {
    id: 700, action: 'sale_settlement', user_name: 'modifier-b', created_at: '2026-09-06 12:30:00',
    details: JSON.stringify({
      before: { sale_status: 'awaiting_payment', payment_method: null, payment_details: null, amount_paid_usd: 0, amount_paid_khr: 0 },
      after: { sale_status: 'completed', payment_method: 'Cash', payment_details: current.payment_details, amount_paid_usd: 15.5, amount_paid_khr: 0 },
    }),
  }
  const original = reconstructSaleCreation({ sale: current, ledger: LEDGER, audit: [settlement], bulk: [] })
  const record = saleCreatedRecord(original)
  assert.strictEqual(record.actor_username, 'sokha', 'creator A remains the creation actor')
  assert.strictEqual(record.after.sale_status, 'awaiting_payment')
  assert.strictEqual(record.after.total_usd, 12)
  assert.strictEqual(record.after.payment_method, null)
  assert.strictEqual(record.after.amount_paid_usd, 0)
  assert.strictEqual(record.after.products, null, 'changed lines are explicitly unknown, never current rows called original')
})

runTest('durable mutation receipt preserves the original tender after audit retention', () => {
  const current = { ...SALE, sale_status: 'completed', payment_method: 'Card', amount_paid_usd: 20 }
  const mutations = [{
    created_at: '2026-09-06 12:00:00',
    before_json: JSON.stringify({ sale_status: 'awaiting_payment', payment_method: null, payment_details: null, amount_paid_usd: 0 }),
  }]
  const record = saleCreatedRecord(reconstructSaleCreation({ sale: current, mutations }))
  assert.strictEqual(record.after.sale_status, 'awaiting_payment')
  assert.strictEqual(record.after.payment_method, null)
  assert.strictEqual(record.after.amount_paid_usd, 0)
})

runTest('legacy mutable creation fields are unknown when no durable before snapshot survives', () => {
  const current = {
    ...SALE,
    sale_status: 'completed',
    payment_method: 'Card',
    payment_details: JSON.stringify([{ method: 'Card', amount_usd: 12.5 }]),
    amount_paid_usd: 12.5,
    amount_paid_khr: 0,
    change_usd: 1,
    change_khr: 4000,
  }
  const record = saleCreatedRecord(reconstructSaleCreation({ sale: current }))
  assert.strictEqual(record.after.sale_status, null)
  assert.strictEqual(record.after.payment_method, null)
  assert.strictEqual(record.after.payment_details, null)
  assert.strictEqual(record.after.amount_paid_usd, null)
  assert.strictEqual(record.after.amount_paid_khr, null)
  assert.strictEqual(record.after.change_usd, null)
  assert.strictEqual(record.after.change_khr, null)
  assert.strictEqual(record.after.total_usd, 12.5, 'total remains known without an amendment')
  assert.strictEqual(record.after.products, null,
    'current sale-item names can be rewritten by product rename/merge sync and must not be called the creation basket')
})

runTest('a future immutable creation snapshot wins over every mutable current sale field', () => {
  const immutable = saleCreationSnapshot.buildSaleCreationSnapshot({
    origin: 'sales_import',
    recordedAt: '2026-09-07T12:00:00.000Z',
    saleAt: '2026-08-28T07:30:00.000Z',
    receiptNumber: '20260828-143000',
    actor: { id: 9, username: 'importer-now' },
    cashierId: 3,
    cashierName: 'source-cashier',
    saleStatus: 'awaiting_payment',
    items: [{ product_id: 4, product_name: 'Original Serum', sku: 'OLD-4', quantity: 2, applied_price_usd: 5, total_usd: 10 }],
    totalUsd: 12,
    paymentMethod: 'Split',
    paymentDetails: [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }, { method: 'ABA', amount_usd: 7, amount_khr: 0 }],
    amountPaidUsd: 12,
    amountPaidKhr: 0,
    changeUsd: 0,
    changeKhr: 0,
    isDelivery: true,
    deliveryContactName: 'Original Driver',
    deliveryContactPhone: '012-ORIGINAL',
    deliveryFeeUsd: 2,
    deliveryActualCostUsd: 1.25,
  })
  const current = {
    ...SALE,
    receipt_number: 'MUTATED-RECEIPT',
    cashier_name: 'renamed-cashier',
    sale_status: 'completed',
    total_usd: 999,
    payment_method: 'Changed',
    payment_details: '[]',
    amount_paid_usd: 999,
    items: [{ product_name: 'Renamed Product', quantity: 99, applied_price_usd: 99, total_usd: 9801 }],
    creation_snapshot_json: immutable,
  }
  const created = buildSaleRecords({ sale: current, ledger: LEDGER, audit: AUDIT })
    .find((record) => record.id === 'sale:77')
  assert.ok(created)
  assert.equal(created.at, '2026-09-07T12:00:00.000Z', 'record time is when the acting account created the row')
  assert.equal(created.actor_username, 'importer-now', 'record actor is the applying account, not the source cashier')
  assert.equal(created.subject, '20260828-143000')
  assert.equal(created.via, 'sales_import')
  assert.equal(created.before, undefined)
  assert.equal(created.after, undefined)
  assert.equal(known(changed(created, 'receipt_number')), '20260828-143000')
  assert.equal(known(changed(created, 'sale_status')), 'awaiting_payment')
  assert.deepEqual(known(changed(created, 'items')), [{ product: 'Original Serum', sku: 'OLD-4', quantity: 2, unit_price_usd: 5, line_total_usd: 10 }])
  assert.deepEqual(known(changed(created, 'payment')), {
    method: 'Split',
    details: [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }, { method: 'ABA', amount_usd: 7, amount_khr: 0 }],
    amount_paid_usd: 12, amount_paid_khr: 0, change_usd: 0, change_khr: 0,
  })
  assert.deepEqual(known(changed(created, 'delivery')), {
    is_delivery: true,
    driver: { id: null, name: 'Original Driver', phone: '012-ORIGINAL', address: null },
    delivery_fee_usd: 2,
    actual_delivery_cost_usd: 1.25,
  })
})

runTest('missing, malformed and unknown-version snapshots retain the honest legacy path', () => {
  for (const raw of [null, '{bad', JSON.stringify({ version: 999, products: [] })]) {
    const record = buildSaleRecords({ sale: { ...SALE, creation_snapshot_json: raw } })[0]
    assert.equal(changed(record, 'items').after.state, 'unknown')
    assert.equal(changed(record, 'payment').after.state, 'unknown')
    assert.equal(record.actor_username, 'sokha')
  }
})

runTest('a payment correction is one rich record, not a status-only duplicate', () => {
  const at = '2026-09-06 12:30:00'
  const generic = {
    id: 700, action: 'update', user_name: 'dara', created_at: at,
    details: JSON.stringify({ operationId: 'settlement-1', oldStatus: 'awaiting_payment', newStatus: 'completed' }),
  }
  const explicit = {
    id: 701, action: 'sale_settlement', user_name: 'dara', created_at: at,
    details: JSON.stringify({
      operationId: 'settlement-1',
      paymentCorrection: true,
      before: { sale_status: 'awaiting_payment', payment_method: null, payment_details: null, amount_paid_usd: 0, amount_paid_khr: 0 },
      after: { sale_status: 'completed', payment_method: 'ABA', payment_details: '[{"method":"ABA","amount_usd":90,"amount_khr":0}]', amount_paid_usd: 90, amount_paid_khr: 0 },
    }),
  }
  const records = buildSaleRecords({ sale: SALE, audit: [generic, explicit] })
  const payments = records.filter((record) => record.kind === 'payment_settled')
  assert.strictEqual(payments.length, 1, 'the matching generic status audit is the explicit settlement twin')
  assert.strictEqual(payments[0].summary, 'Payment corrected')
  assert.deepStrictEqual(changed(payments[0], 'payment_method').before, { state: 'known_none' })
  assert.strictEqual(known(changed(payments[0], 'payment_method')), 'ABA')
  assert.strictEqual(known(changed(payments[0], 'amount_paid_usd')), 90)
  assert.deepStrictEqual(known(changed(payments[0], 'payment_details')), [{ method: 'ABA', amount_usd: 90, amount_khr: 0 }])

  const distinct = buildSaleRecords({
    sale: SALE,
    audit: [{ ...generic, id: 702, details: JSON.stringify({ operationId: 'status-2', oldStatus: 'awaiting_payment', newStatus: 'completed' }) }, explicit],
  })
  assert.strictEqual(distinct.filter((record) => record.source === 'audit').length, 2,
    'same actor, states and timestamp cannot suppress a distinct operation')
})

runTest('a customer swap reports both ids', () => {
  const record = auditRecord(AUDIT[1])
  assert.strictEqual(record.kind, 'customer_changed')
  assert.deepStrictEqual(record.before, { customer_id: null })
  assert.strictEqual(record.after.customer_id, 9)
  assert.strictEqual(record.after.membership_number, 'M-0009')
})

runTest('fixed recovery audits expose only item counts and the allowlisted stock effect', () => {
  const recovered = buildSaleRecords({
    sale: SALE,
    audit: [{
      id: 530,
      action: 'recover_missing_sale_items',
      user_name: 'recovery_admin',
      created_at: '2026-09-09 07:19:33',
      details: JSON.stringify({
        kind: 'sale-zero-items-20260909-v1',
        operation_id: 'must-not-cross-api',
        manifest_sha256: 'must-not-cross-api',
        source: 'must-not-cross-api',
        allocation_basis: 'must-not-cross-api',
        stock_effect: 'deducted_now',
      }),
      old_value: JSON.stringify({ item_count: 0, revision: 1 }),
      new_value: JSON.stringify({ item_count: 1, revision: 3 }),
    }, {
      id: 531,
      action: 'recover_missing_sale_items',
      user_name: 'recovery_admin',
      created_at: '2026-09-09 07:30:00',
      details: JSON.stringify({
        kind: 'sale-zero-items-20260909-v2',
        cost_evidence: { artifact: 'must-not-cross-api' },
        stock_effect: 'released_allocation_only',
      }),
      old_value: JSON.stringify({ item_count: 0, revision: 1 }),
      new_value: JSON.stringify({ item_count: 1, revision: 3 }),
    }],
  }).filter((record) => record.kind === 'sale_items_recovered')
  assert.strictEqual(recovered.length, 2)
  assert.deepStrictEqual(recovered.map((record) => record.summary), ['Sale items recovered', 'Sale items recovered'])
  assert.deepStrictEqual(recovered.map((record) => record.changes), [[
    { field: 'item_count', before: { state: 'known_value', value: 0 }, after: { state: 'known_value', value: 1 } },
    { field: 'stock_effect', before: { state: 'known_none' }, after: { state: 'known_value', value: 'deducted_now' } },
  ], [
    { field: 'item_count', before: { state: 'known_value', value: 0 }, after: { state: 'known_value', value: 1 } },
    { field: 'stock_effect', before: { state: 'known_none' }, after: { state: 'known_value', value: 'released_allocation_only' } },
  ]])
  const serialized = JSON.stringify(recovered)
  for (const forbidden of ['operation_id', 'manifest_sha256', 'cost_evidence', 'allocation_basis', 'revision']) {
    assert.ok(!serialized.includes(forbidden), `${forbidden} must not cross the Records API`)
  }
})

runTest('recovery audit validation fails closed on malformed counts and stock tokens', () => {
  const invalidCounts = [
    { old_value: '{', new_value: JSON.stringify({ item_count: 1 }) },
    { old_value: JSON.stringify({ item_count: -1 }), new_value: JSON.stringify({ item_count: 1 }) },
    { old_value: JSON.stringify({ item_count: 0 }), new_value: JSON.stringify({ item_count: '1' }) },
    { old_value: JSON.stringify({ item_count: 0 }), new_value: JSON.stringify({ item_count: -1 }) },
    { old_value: JSON.stringify({ item_count: 0 }), new_value: JSON.stringify({ item_count: 1.5 }) },
    { old_value: JSON.stringify({ item_count: 0 }), new_value: JSON.stringify({ item_count: Number.MAX_SAFE_INTEGER + 1 }) },
  ]
  for (const [index, values] of invalidCounts.entries()) {
    const malformed = auditRecord({
      id: 532 + index,
      action: 'recover_missing_sale_items',
      details: JSON.stringify({ stock_effect: 'deduct_stock_again' }),
      ...values,
    })
    assert.strictEqual(malformed.kind, 'legacy_sale_change')
    assert.deepStrictEqual(malformed.after, null)
  }

  const noStockToken = buildSaleRecords({
    sale: SALE,
    audit: [{
      id: 533,
      action: 'recover_missing_sale_items',
      details: JSON.stringify({ stock_effect: 'deduct_stock_again' }),
      old_value: JSON.stringify({ item_count: 0, revision: 1 }),
      new_value: JSON.stringify({ item_count: 1, revision: 3 }),
    }],
  }).find((record) => record.kind === 'sale_items_recovered')
  assert.ok(noStockToken)
  assert.deepStrictEqual(noStockToken.changes, [
    { field: 'item_count', before: { state: 'known_value', value: 0 }, after: { state: 'known_value', value: 1 } },
  ])

})

runTest('an undo/redo replay that writes no ledger entry is the one thing kind "undone" is for', () => {
  const record = auditRecord({
    id: 506, action: 'action_undo', user_name: 'admin', created_at: '2026-09-06 14:00:00',
    details: JSON.stringify({ applier: 'sale.settlement', operationId: 'op-1', direction: 'undo' }),
  })
  assert.strictEqual(record.kind, 'legacy_sale_change')
  assert.deepStrictEqual(record.after, null)
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
  assert.ok(settlement && settlement.kind === 'legacy_sale_change', 'legacy sale.settlement replays stay in the list without raw details')
})

runTest('return creation and later update are separate events with their actual actors', () => {
  const returns = [{
    id: 5, return_number: 'R-0005', status: 'completed', return_scope: 'customer',
    total_refund_usd: 3, cashier_name: 'creator-a',
    created_at: '2026-09-06 14:00:00', updated_at: '2026-09-06 14:00:00', is_current: 1,
  }]
  const returnAudit = [{
    audit_id: 801, return_id: 5, action: 'create', user_name: 'creator-a',
    created_at: '2026-09-06 14:00:00', return_number: 'R-0005', details: JSON.stringify({ reason: 'Wrong shade' }),
  }, {
    audit_id: 802, return_id: 5, action: 'update', user_name: 'modifier-b',
    created_at: '2026-09-06 15:00:00', return_number: 'R-0005', details: JSON.stringify({ reason: 'Changed quantity' }),
  }]
  const records = buildSaleRecords({ sale: SALE, ledger: [], audit: [], bulk: [], returns, returnAudit })
  const changes = records.filter((r) => r.source === 'return')
  assert.strictEqual(changes.length, 2, 'creation and edit are separate acts')
  assert.strictEqual(changes[0].id, 'return-audit:801')
  assert.strictEqual(changes[0].kind, 'legacy_sale_change')
  assert.strictEqual(changes[0].actor_username, 'creator-a')
  assert.strictEqual(changes[0].subject, 'R-0005', 'the subject is the return the reader must open next')
  assert.deepStrictEqual(changes[0].changes, [])
  assert.strictEqual(changes[1].actor_username, 'modifier-b')
  assert.strictEqual(changes[1].at, '2026-09-06 15:00:00')
  assert.deepStrictEqual(changes[1].changes, [])
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
  assert.deepStrictEqual(kept.map((r) => r.id), ['return-legacy:8'], 'the supplier one is dropped, the customer one is not')
  assert.deepStrictEqual(kept[0].changes, [], 'legacy current state is not presented as an original snapshot')
})

runTest('return bulk cancel, undo and redo keep exact direction, actor and time', () => {
  const base = {
    operation_id: 'return-op', return_id: 7, return_number: 'R-0007',
    request_json: JSON.stringify({ field: 'status', source: 'completed', target: 'cancelled' }),
    receipt_json: JSON.stringify({ items: [{ id: 7, before: 'completed', after: 'cancelled', changed: true }] }),
    details: JSON.stringify({ kind: 'return.fields.bulk' }),
  }
  const cancel = returnBulkEventRecord({ ...base, audit_id: 810, action: 'return_fields_bulk', user_name: 'modifier-b', created_at: '2026-09-06 16:30:00' })
  const undo = returnBulkEventRecord({ ...base, audit_id: 811, action: 'action_undo', user_name: 'manager-c', created_at: '2026-09-06 17:00:00' })
  const redo = returnBulkEventRecord({ ...base, audit_id: 812, action: 'action_redo', user_name: 'manager-d', created_at: '2026-09-06 17:30:00' })
  assert.strictEqual(cancel.actor_username, 'modifier-b')
  assert.deepStrictEqual(cancel.before, { return_status: 'completed' })
  assert.deepStrictEqual(cancel.after, { return_status: 'cancelled' })
  assert.strictEqual(undo.actor_username, 'manager-c')
  assert.strictEqual(undo.via, 'undo')
  assert.deepStrictEqual(undo.before, { return_status: 'cancelled' })
  assert.deepStrictEqual(undo.after, { return_status: 'completed' })
  assert.strictEqual(redo.actor_username, 'manager-d')
  assert.strictEqual(redo.via, 'redo')
  assert.strictEqual(redo.at, '2026-09-06 17:30:00')
})

runTest('return bulk generation exposes pruned replay history without inventing actor or time', () => {
  const base = {
    operation_id: 'return-op-pruned', return_id: 7, return_number: 'R-0007', generation: 2,
    request_json: JSON.stringify({ field: 'status', source: 'completed', target: 'cancelled' }),
    receipt_json: JSON.stringify({ items: [{ id: 7, before: 'completed', after: 'cancelled', changed: true }] }),
    details: JSON.stringify({ kind: 'return.fields.bulk' }),
  }
  const original = { ...base, audit_id: 'history:90', action: 'return_fields_bulk', user_name: 'modifier-b', created_at: '2026-06-01 16:30:00' }
  const fullyPruned = buildSaleRecords({ sale: SALE, returnBulk: [original] }).filter((record) => record.source === 'return')
  assert.deepStrictEqual(fullyPruned.map((record) => record.via), [null, 'undo', 'redo'])
  assert.strictEqual(fullyPruned[1].actor_username, null)
  assert.strictEqual(fullyPruned[1].at, null)
  assert.strictEqual(fullyPruned[1].provenance_unknown, true)
  assert.match(fullyPruned[1].summary, /actor and time unavailable/)
  assert.strictEqual(fullyPruned[2].actor_username, null)
  assert.deepStrictEqual(fullyPruned[2].changes, [], 'legacy return replay has no fabricated sale-status detail')

  const survivingRedo = {
    ...base, audit_id: 'audit:92', action: 'action_redo', user_name: 'manager-d', created_at: '2026-09-06 17:30:00',
  }
  const unrelatedCollision = {
    ...base, audit_id: 'audit:unrelated', action: 'action_undo', user_name: 'intruder', created_at: '2026-09-06 17:00:00',
    details: JSON.stringify({ kind: 'something.else' }),
  }
  const partiallyPruned = buildSaleRecords({ sale: SALE, returnBulk: [original, unrelatedCollision, survivingRedo] })
    .filter((record) => record.source === 'return')
  assert.deepStrictEqual(partiallyPruned.map((record) => record.via), [null, 'undo', 'redo'],
    'the unknown oldest replay stays between the original act and the surviving suffix')
  assert.strictEqual(partiallyPruned[1].actor_username, null)
  assert.strictEqual(partiallyPruned[2].actor_username, 'manager-d')
  assert.strictEqual(partiallyPruned[2].at, '2026-09-06 17:30:00')
  assert.ok(!partiallyPruned.some((record) => record.actor_username === 'intruder'),
    'an unrelated replay audit with a colliding operation id is not a sale record')
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
    CREATE TABLE sale_mutation_receipts (id TEXT PRIMARY KEY, sale_id INTEGER NOT NULL,
      mutation_kind TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE sale_record_events (id TEXT PRIMARY KEY, sale_id INTEGER NOT NULL, source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL, generation INTEGER NOT NULL, kind TEXT NOT NULL, via TEXT NOT NULL,
      subject TEXT, actor_username TEXT, occurred_at TEXT NOT NULL, changes_json TEXT NOT NULL,
      UNIQUE(source_kind,source_id,generation,sale_id));
    CREATE TABLE return_bulk_operations (id TEXT PRIMARY KEY, request_json TEXT NOT NULL, receipt_json TEXT NOT NULL,
      history_id INTEGER, generation INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE return_bulk_members (operation_id TEXT NOT NULL, return_id INTEGER NOT NULL, sale_id INTEGER,
      PRIMARY KEY(operation_id, return_id));
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
const RETURN_AUDIT = [{
  audit_id: 701, return_id: 5, action: 'create', user_name: 'creator-a',
  created_at: '2026-09-06 14:00:00', return_number: 'R-0005', details: JSON.stringify({ reason: 'Wrong shade' }),
}, {
  audit_id: 702, return_id: 5, action: 'update', user_name: 'modifier-b',
  created_at: '2026-09-06 15:30:00', return_number: 'R-0005', details: JSON.stringify({ reason: 'Changed quantity' }),
}]
const RETURN_BULK_BASE = {
  operation_id: 'return-op', return_id: 5, return_number: 'R-0005', generation: 2,
  request_json: JSON.stringify({ field: 'status', source: 'completed', target: 'cancelled' }),
  receipt_json: JSON.stringify({ items: [{ id: 5, before: 'completed', after: 'cancelled', changed: true }] }),
  details: JSON.stringify({ kind: 'return.fields.bulk' }),
}
const RETURN_BULK_EVENTS = [
  { ...RETURN_BULK_BASE, audit_id: 703, action: 'return_fields_bulk', user_name: 'modifier-b', created_at: '2026-09-06 16:00:00' },
  { ...RETURN_BULK_BASE, audit_id: 704, action: 'action_undo', user_name: 'manager-c', created_at: '2026-09-06 16:30:00' },
  { ...RETURN_BULK_BASE, audit_id: 705, action: 'action_redo', user_name: 'manager-d', created_at: '2026-09-06 17:00:00' },
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
  for (const row of RETURN_AUDIT) {
    sqlite.prepare("INSERT INTO audit_logs (id, user_name, action, entity, entity_id, details, created_at) VALUES (@id,@u,@a,'return',@returnId,@d,@at)")
      .run({ id: row.audit_id, u: row.user_name, a: row.action, returnId: String(row.return_id), d: row.details, at: row.created_at })
  }
  sqlite.prepare("INSERT INTO return_bulk_operations (id, request_json, receipt_json, history_id, generation) VALUES ('return-op',@req,@receipt,91,2)")
    .run({ req: RETURN_BULK_BASE.request_json, receipt: RETURN_BULK_BASE.receipt_json })
  sqlite.prepare("INSERT INTO return_bulk_members (operation_id, return_id, sale_id) VALUES ('return-op',5,77)").run()
  sqlite.prepare("INSERT INTO action_history (id, scope, entity, entity_id, label, created_by_name, created_at) VALUES (91,'returns','return','return-op','return cancelled','modifier-b','2026-09-06 16:00:00')").run()
  for (const row of RETURN_BULK_EVENTS.filter((event) => event.action !== 'return_fields_bulk')) {
    sqlite.prepare("INSERT INTO audit_logs (id, user_name, action, entity, entity_id, details, created_at) VALUES (@id,@u,@a,'return','return-op',@details,@at)")
      .run({ id: row.audit_id, u: row.user_name, a: row.action, details: row.details, at: row.created_at })
  }
  // A return on the OTHER sale: sale 78's count must move by exactly one, and
  // sale 77's must not move at all.
  sqlite.prepare("INSERT INTO returns (id, return_number, sale_id, cashier_name, status, return_scope, total_refund_usd, created_at, updated_at) VALUES (9,'R-0009',78,'sokha','completed','customer',1,'2026-09-06 19:30:00','2026-09-06 19:30:00')").run()
  // An audit row about a DIFFERENT sale and a row about another entity: both
  // must be invisible to sale 77's count.
  sqlite.prepare(`INSERT INTO audit_logs (id, user_name, action, entity, entity_id, details, created_at) VALUES (600,'admin','update','sale','78','{"operationId":"correction-78","oldStatus":"completed","newStatus":"cancelled"}','2026-09-06 19:00:00')`).run()
  sqlite.prepare(`INSERT INTO audit_logs (id, user_name, action, entity, entity_id, details, created_at) VALUES (602,'admin','sale_payment_correction_opened','sale','78','{"operationId":"correction-78","oldStatus":"completed","newStatus":"cancelled"}','2026-09-06 19:00:00')`).run()
  sqlite.prepare("INSERT INTO audit_logs (id, user_name, action, entity, entity_id, details, created_at) VALUES (601,'admin','update','product','77','{}','2026-09-06 19:00:00')").run()

  sqlite.prepare("INSERT INTO sale_bulk_operations (id, actor_id, request_id, request_json, receipt_json, history_id) VALUES ('op-abc',1,'r1',@req,@rec,90)")
    .run({ req: BULK[0].request_json, rec: BULK[0].receipt_json })
  sqlite.prepare("INSERT INTO sale_bulk_members (operation_id, sale_id, revision, movement_fingerprint) VALUES ('op-abc',77,1,'[]')").run()
  sqlite.prepare("INSERT INTO action_history (id, scope, entity, entity_id, label, created_by_name, created_at) VALUES (90,'global','sale','op-abc','2 sales -> cancelled','admin','2026-09-06 17:45:00')").run()
  sqlite.prepare(`INSERT INTO sale_record_events(
    id,sale_id,source_kind,source_id,generation,kind,via,actor_username,occurred_at,changes_json
  ) VALUES('00000000-0000-4000-8000-000000000077',77,'sale_bulk_status','op-abc',0,'cancelled','apply','admin','2026-09-06 17:45:00',?)`)
    .run(JSON.stringify([{ field: 'sale_status', before: { state: 'known_value', value: 'completed' }, after: { state: 'known_value', value: 'cancelled' } }]))
}

const DURABLE_BULK_EVENT = {
  id: '00000000-0000-4000-8000-000000000077', sale_id: 77,
  source_kind: 'sale_bulk_status', source_id: 'op-abc', generation: 0,
  kind: 'cancelled', via: 'apply', actor_username: 'admin', occurred_at: '2026-09-06 17:45:00',
  changes_json: JSON.stringify([{ field: 'sale_status', before: { state: 'known_value', value: 'completed' }, after: { state: 'known_value', value: 'cancelled' } }]),
}

runTest('the list-row count equals the number of lines the float shows, for both a busy sale and an untouched one', () => {
  const sqlite = setup(true)
  seedRecords(sqlite)
  const ids = [77, 78]
  const placeholders = ids.map(() => '?').join(',')
  const sql = buildSaleRecordsCountSql(placeholders)
  assert.strictEqual(SALE_RECORDS_COUNT_BINDS_PER_ID, 1, 'the sales driver binds each id once')
  assert.doesNotMatch(sql, /\bUNION\b/i, 'D1 rejects the former six-arm compound SELECT; counts must use scalar sources')
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
    events: [DURABLE_BULK_EVENT], bulk: BULK, returns: RETURNS, returnAudit: RETURN_AUDIT, returnBulk: RETURN_BULK_EVENTS,
  })
  assert.strictEqual(count77, detail77.length, 'the row badge and the float must agree')
  assert.strictEqual(count77, 14,
    '5 ledger + 2 sale audit + 1 sale bulk + 2 individual return acts + 3 return bulk/replays + the sale itself')
  assert.strictEqual(count78, 3, "sale 78's own creation, the one audit row about it, and its return")

  // The discriminating half, three ways -- each is a suppression a plausible
  // implementation omits, and each would make the badge disagree with the float.
  const naiveAudit = sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity='sale' AND entity_id='77'").get().n
  assert.strictEqual(naiveAudit, 5, 'five audit rows exist for sale 77')
  assert.strictEqual(detail77.filter((r) => r.source === 'audit').length, 2, 'but only two of them are records')
  const naiveReturns = sqlite.prepare('SELECT COUNT(*) n FROM returns WHERE sale_id=77').get().n
  assert.strictEqual(naiveReturns, 2, 'two returns exist on sale 77')
  assert.strictEqual(detail77.filter((r) => r.source === 'return').length, 5,
    'the customer return has create/edit/cancel/undo/redo events; the supplier return remains absent')
  assert.strictEqual(
    detail77.filter((r) => r.via === 'undo' || r.via === 'redo').length, 4,
    'sale line and return status undo/redo are each represented once',
  )

  sqlite.prepare("DELETE FROM audit_logs WHERE entity='return' AND entity_id='return-op' AND action IN ('action_undo','action_redo')").run()
  const afterPrune = sqlite.prepare(sql).all(...saleRecordsCountBinds(ids))
  const afterPruneCount77 = Number(afterPrune.find((row) => Number(row.sale_id) === 77)?.n || 0) + SALE_RECORDS_SELF_COUNT
  const detailAfterPrune = buildSaleRecords({
    sale: SALE_RETURNED, ledger: [...LEDGER, UNDO_LEDGER, REDO_LEDGER], audit: [...AUDIT, UNDO_AUDIT, REDO_AUDIT],
    events: [DURABLE_BULK_EVENT], bulk: BULK, returns: RETURNS, returnAudit: RETURN_AUDIT, returnBulk: [RETURN_BULK_EVENTS[0]],
  })
  assert.strictEqual(afterPruneCount77, 14, 'durable generation keeps the badge count after replay audit pruning')
  assert.strictEqual(detailAfterPrune.length, afterPruneCount77, 'synthesized unknown replay rows keep detail/count parity')
  assert.deepStrictEqual(
    detailAfterPrune.filter((record) => record.source === 'return' && record.via).map((record) => record.via),
    ['undo', 'redo'],
  )
  sqlite.close()
})

runTest('the existing list count already includes one recovery audit as one record', () => {
  const sqlite = setup(true)
  sqlite.prepare("INSERT INTO sales(id,receipt_number,sale_status,cashier_name,total_usd,created_at) VALUES(77,'S-77','awaiting_payment','admin',185,'2026-09-09 06:02:29')").run()
  sqlite.prepare(`INSERT INTO audit_logs(id,user_name,action,entity,entity_id,details,old_value,new_value,created_at)
    VALUES(540,'recovery_admin','recover_missing_sale_items','sale','77',@details,@old,@next,'2026-09-09 07:19:33')`).run({
    details: JSON.stringify({ stock_effect: 'released_allocation_only' }),
    old: JSON.stringify({ item_count: 0, revision: 1 }),
    next: JSON.stringify({ item_count: 1, revision: 3 }),
  })
  const count = Number(sqlite.prepare(buildSaleRecordsCountSql('?')).get(77).n) + SALE_RECORDS_SELF_COUNT
  const detail = buildSaleRecords({ sale: SALE, audit: [{
    id: 540, user_name: 'recovery_admin', action: 'recover_missing_sale_items',
    details: JSON.stringify({ stock_effect: 'released_allocation_only' }),
    old_value: JSON.stringify({ item_count: 0, revision: 1 }),
    new_value: JSON.stringify({ item_count: 1, revision: 3 }),
    created_at: '2026-09-09 07:19:33',
  }] })
  assert.strictEqual(count, 2)
  assert.strictEqual(detail.length, count)
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

runTest('the scalar count driver casts each sale id for the TEXT audit key', () => {
  const sqlite = setup(true)
  seedRecords(sqlite)
  // audit_logs.entity_id is TEXT while sales.id is INTEGER. The correlated
  // audit term must cast the driver id rather than asking the caller to bind a
  // second differently typed copy.
  const sql = buildSaleRecordsCountSql('?')
  const viaHelper = sqlite.prepare(sql).all(...saleRecordsCountBinds([77]))
  const sum = (rows) => rows.reduce((total, row) => total + Number(row.n), 0)
  assert.match(sql, /a\.entity_id = CAST\(s\.id AS TEXT\)/)
  assert.strictEqual(sum(viaHelper), 13, 'every non-creation event is counted from one numeric sale bind')
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

runTest('the public field vocabulary is exact and closed', () => {
  assert.deepStrictEqual(SALE_RECORD_FIELDS, [
    'receipt_number', 'sale_status', 'items', 'total_usd', 'payment', 'delivery',
    'customer', 'membership', 'item', 'quantity', 'unit_price_usd', 'removed_items', 'added_items',
    'delivery_fee_usd', 'actual_delivery_cost_usd', 'is_delivery', 'driver',
    'payment_method', 'payment_details', 'amount_paid_usd', 'amount_paid_khr',
    'change_usd', 'change_khr', 'cancel_reason', 'cancel_note', 'item_count',
    'held_units', 'stock_effect',
  ])
  const records = buildSaleRecords({ sale: SALE, ledger: LEDGER, audit: AUDIT, bulk: BULK })
  for (const record of records) {
    for (const change of record.changes) {
      assert.ok(SALE_RECORD_FIELDS.includes(change.field), `${change.field} is not a declared field`)
    }
  }
})

runTest('the durable event vocabulary recognizes only the recovery projector fields', () => {
  const eventsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'saleRecordEvents.ts'), 'utf8')
  assert.match(eventsSource, /sale_items_recovered:\s*\['item_count',\s*'stock_effect'\]/)
})

runTest('the public contract is changed-only and distinguishes General from unknown history', () => {
  const customer = buildSaleRecords({ sale: SALE, audit: [AUDIT[1]] }).find((record) => record.kind === 'customer_changed')
  assert.ok(customer)
  assert.equal(customer.before, undefined)
  assert.equal(customer.after, undefined)
  const identity = changed(customer, 'customer')
  assert.deepStrictEqual(identity.before, { state: 'known_none' }, 'General is a known anonymous assignment')
  assert.deepStrictEqual(identity.after, { state: 'known_value', value: { id: 9, name: null } })
  const legacy = buildSaleRecords({ sale: SALE })[0]
  assert.equal(changed(legacy, 'items').after.state, 'unknown')
  assert.equal(changed(legacy, 'payment').after.state, 'unknown')
  assert.equal(changed(legacy, 'delivery').after.state, 'unknown')
  assert.equal(changed(legacy, 'customer').after.state, 'unknown')
  assert.equal(changed(legacy, 'membership').after.state, 'unknown')
  assert.ok(legacy.changes.every((entry) => ['receipt_number', 'sale_status', 'items', 'total_usd', 'payment', 'delivery', 'customer', 'membership'].includes(entry.field)))
})

runTest('one grouped replacement is one record with removed and added historical labels', () => {
  const ledger = [
    { id: 31, group_id: 'replace-1', kind: 'line_removed', product_id: 4, product_name: 'Old Serum', quantity_before: 2, quantity_after: 0, total_before_usd: 20, total_after_usd: 10, via: 'amend', user_name: 'dara', created_at: '2026-09-06 15:00:00' },
    { id: 32, group_id: 'replace-1', kind: 'line_added', product_id: 8, product_name: 'New Serum', quantity_before: 0, quantity_after: 1, total_before_usd: 10, total_after_usd: 18, via: 'amend', user_name: 'dara', created_at: '2026-09-06 15:00:00' },
  ]
  const records = buildSaleRecords({ sale: SALE, ledger })
  const replacement = records.find((record) => record.kind === 'items_replaced')
  assert.ok(replacement)
  assert.equal(records.filter((record) => record.source === 'ledger').length, 1)
  assert.equal(known(changed(replacement, 'removed_items'), 'before')[0].name, 'Old Serum')
  assert.equal(known(changed(replacement, 'added_items'))[0].name, 'New Serum')
})

runTest('durable settlement receipt emits original plus every replay after audit pruning', () => {
  const records = buildSaleRecords({
    sale: SALE,
    mutations: [{
      id: 'settle-1', mutation_kind: 'settlement', generation: 2,
      request_json: JSON.stringify({ replace_existing_payment: false }),
      before_json: JSON.stringify({ sale_status: 'awaiting_payment', payment_method: null, payment_details: null, amount_paid_usd: 0, amount_paid_khr: 0, change_usd: 0, change_khr: 0 }),
      after_json: JSON.stringify({ sale_status: 'completed', payment_method: 'ABA', payment_details: [{ method: 'ABA', amount_usd: 12.5, amount_khr: 0 }], amount_paid_usd: 12.5, amount_paid_khr: 0, change_usd: 0, change_khr: 0 }),
      history_created_at: '2026-09-06 13:00:00', history_created_by_name: 'dara',
    }],
  }).filter((record) => record.source === 'mutation')
  assert.equal(records.length, 3)
  assert.deepStrictEqual(records.map((record) => record.via), [null, 'undo', 'redo'])
  assert.deepStrictEqual(records.map((record) => record.actor_username), ['dara', null, null])
  assert.deepStrictEqual(records.map((record) => record.provenance_unknown || false), [false, true, true])
  assert.equal(known(changed(records[1], 'payment_method'), 'before'), 'ABA')
  assert.deepStrictEqual(changed(records[1], 'payment_method').after, { state: 'known_none' })
})

runTest('durable sale bulk receipt emits exact replay directions and surviving actors', () => {
  const row = { ...BULK[0], generation: 2 }
  const records = buildSaleRecords({
    sale: SALE,
    bulk: [row],
    bulkReplays: [
      { operation_id: 'op-abc', audit_id: 1, action: 'action_undo', user_name: 'owner-a', created_at: '2026-09-06 18:00:00' },
      { operation_id: 'op-abc', audit_id: 2, action: 'action_redo', user_name: 'owner-b', created_at: '2026-09-06 18:05:00' },
    ],
  }).filter((record) => record.source === 'bulk')
  assert.equal(records.length, 3)
  assert.deepStrictEqual(records.map((record) => record.via), [null, 'undo', 'redo'])
  assert.deepStrictEqual(records.map((record) => record.actor_username), ['admin', 'owner-a', 'owner-b'])
  assert.equal(known(changed(records[1], 'sale_status'), 'before'), 'cancelled')
  assert.equal(known(changed(records[1], 'sale_status')), 'completed')
})

runTest('durable events suppress only the exact four-key legacy twin', () => {
  const event = {
    id: '00000000-0000-4000-8000-000000000088', sale_id: 77,
    source_kind: 'sale_status', source_id: 'actor:1:request:stable', generation: 0,
    kind: 'status_changed', via: 'apply', actor_username: 'admin', occurred_at: '2026-09-06 18:00:00',
    changes_json: JSON.stringify([{ field: 'sale_status', before: { state: 'known_value', value: 'completed' }, after: { state: 'known_value', value: 'awaiting_delivery' } }]),
  }
  const exact = { id: 901, action: 'update', user_name: 'admin', created_at: event.occurred_at, details: JSON.stringify({
    oldStatus: 'completed', newStatus: 'awaiting_delivery',
    record_event: { source_kind: event.source_kind, source_id: event.source_id, generation: 0, sale_id: 77 },
  }) }
  const distinct = { ...exact, id: 902, details: JSON.stringify({
    oldStatus: 'completed', newStatus: 'awaiting_delivery',
    record_event: { source_kind: event.source_kind, source_id: 'actor:1:request:distinct', generation: 0, sale_id: 77 },
  }) }
  const records = buildSaleRecords({ sale: SALE, events: [event], audit: [exact, distinct] })
  assert.ok(records.some((record) => record.id === `event:${event.id}`))
  assert.ok(!records.some((record) => record.id === 'audit:901'))
  assert.ok(records.some((record) => record.id === 'audit:902'), 'same actor/time/state is still a real event when provenance differs')
  assert.deepEqual(records.find((record) => record.id === `event:${event.id}`).changes, JSON.parse(event.changes_json))

  const malformed = { ...exact, id: 903, details: JSON.stringify({
    oldStatus: 'completed', newStatus: 'awaiting_delivery',
    record_event: { source_kind: event.source_kind, source_id: event.source_id, generation: null, sale_id: 77 },
  }) }
  const sqlite = setup(true)
  sqlite.prepare("INSERT INTO sales(id,receipt_number,sale_status,cashier_name,total_usd,created_at) VALUES(77,'S-77','completed','admin',1,'2026-09-06 17:00:00')").run()
  sqlite.prepare(`INSERT INTO sale_record_events(id,sale_id,source_kind,source_id,generation,kind,via,actor_username,occurred_at,changes_json)
    VALUES(@id,@sale_id,@source_kind,@source_id,@generation,@kind,@via,@actor_username,@occurred_at,@changes_json)`).run(event)
  sqlite.prepare("INSERT INTO audit_logs(id,user_name,action,entity,entity_id,details,created_at) VALUES(903,'admin','update','sale','77',?,'2026-09-06 18:00:00')").run(malformed.details)
  const count = Number(sqlite.prepare(buildSaleRecordsCountSql('?')).get(77).n) + SALE_RECORDS_SELF_COUNT
  const malformedDetail = buildSaleRecords({ sale: SALE, events: [event], audit: [malformed] })
  assert.equal(count, 3)
  assert.equal(malformedDetail.length, count, 'malformed provenance preserves the audit in both count and detail')
  assert.ok(malformedDetail.some(record => record.id === 'audit:903'))
  sqlite.close()
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
  // Return row, individual audit, and grouped audit/receipt are all needed:
  // creator A on the row cannot stand in for modifier B.
  assert.match(ROUTES, /FROM returns r\s+WHERE r\.sale_id = \?/,
    'the route must read the returns that rewrote this sale status')
  assert.match(ROUTES, /returns: returnRows/, 'and hand them to the union')
  assert.match(ROUTES, /returnAudit: returnAuditRows/)
  assert.match(ROUTES, /returnBulk: returnBulkRows/)
  assert.match(ROUTES, /SELECT \* FROM \([\s\S]*?\) ordered_return_bulk\s+ORDER BY created_at ASC, audit_id ASC/,
    'the return replay UNION must be wrapped before ordering by its output aliases on D1')
  assert.match(ROUTES, /JOIN return_bulk_operations/)
  assert.match(ROUTES, /r\.return_number, o\.generation/,
    'detail must carry durable replay generation even after audit retention')
  assert.match(ROUTES, /json_extract\(a\.details, '\$\.kind'\) = 'return\.fields\.bulk'/,
    'detail accepts only the replay audit family counted by durable generation')
  assert.match(ROUTES, /FROM sale_mutation_receipts/,
    'permanent mutation before-snapshots survive audit retention for creation reconstruction')
  assert.match(ROUTES, /FROM sale_record_events\s+WHERE sale_id = \?/,
    'the detail route reads the immutable event ledger by its indexed sale key')
  assert.match(ROUTES, /events: eventRows/, 'durable events participate in the shared detail classifier')
  assert.match(buildSaleRecordsCountSql('?'), /SELECT COUNT\(\*\) FROM sale_record_events sre WHERE sre\.sale_id=s\.id/,
    'the list badge counts the same immutable event rows')
  assert.match(ROUTES, /status_before_return/, "the returns source's before comes from the sale row")
  // The customer-scope filter, in the route AND in the count SQL: a supplier
  // return never moved sales.sale_status, and counting it would put a number on
  // the row that the float cannot account for.
  assert.match(ROUTES, /COALESCE\(r\.return_scope,'customer'\) = 'customer'/)
  assert.match(buildSaleRecordsCountSql('?'), /COALESCE\(return_scope, 'customer'\) = 'customer'/)
  assert.match(buildSaleRecordsCountSql('?'), /json_extract\(a\.details, '\$\.applier'\)[^\n]*= 'sale\.add_items'/,
    'the count SQL must drop the add-items undo twin the classifier drops')
})

runTest('the records route is gated on READING a sale, not on amending one', () => {
  const body = routeBody("app.get('/:id/records'")
  assert.match(body, /canReadSales\(/, 'a view-tier bookkeeper who can see the sale can see how it got that way')
  assert.ok(!/getActionTier|hasPermission\(/.test(body), 'gating this on the amend action would hide the trail from the people who reconcile the books')
  // Every durable source needed by the union and creation reconstruction.
  assert.match(body, /FROM sale_amendments/)
  assert.match(body, /FROM audit_logs/)
  assert.match(body, /SELECT id, action, details, old_value, new_value, user_name, created_at/,
    'recovery Records must read the applied audit count snapshots without exposing raw metadata')
  assert.doesNotMatch(body, /SELECT product_name, quantity, applied_price_usd, total_usd\s+FROM sale_items/,
    'mutable sale-item names are not evidence of the creation basket')
  assert.match(body, /payment_method, payment_details, amount_paid_usd, amount_paid_khr/)
  assert.match(body, /FROM sale_mutation_receipts/, 'current tender alone must not be called original')
  assert.match(body, /FROM sale_bulk_members/)
  assert.match(body, /JOIN return_bulk_operations/)
  assert.match(body, /buildSaleRecords\(/)
  // The TEXT bind, in the route as well as in the count SQL.
  assert.match(body, /String\(saleId\)/, "audit_logs.entity_id is TEXT; binding the number matches nothing")
})

runTest('the list badge is one statement per chunk, not one query per sale', () => {
  const list = ROUTES.slice(ROUTES.indexOf('const recordsBySale'), ROUTES.indexOf('records_count:'))
  assert.match(list, /chunkForBinding\(saleIds, 0, SALE_RECORDS_COUNT_BINDS_PER_ID\)/,
    'the chunker must account for every repeated id list in the count union')
  assert.ok(!/for \(const sale of sales\)/.test(list), 'a per-sale loop over the database is the N+1 this exists to avoid')
  assert.match(ROUTES, /records_count: \(recordsBySale\.get\(sale\.id\) \|\| 0\) \+ SALE_RECORDS_SELF_COUNT/,
    'the badge adds the sale\'s own creation, which no table records')
})

if (failed) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('sale records union: all cases pass')
