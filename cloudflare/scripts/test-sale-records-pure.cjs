// A sale's RECORDS list: the union of every writer that changes a sale (N41,
// lib/saleRecords.ts + migration 0129).
//
// The owner asked for one line under every sale row -- "Records n" -- opening a
// float that says who changed what, with before and after. A sale is changed by
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

function seedRecords(sqlite) {
  sqlite.prepare('INSERT INTO sales (id, receipt_number, sale_status, cashier_name, total_usd, created_at) VALUES (@id,@r,@s,@c,@t,@at)')
    .run({ id: SALE.id, r: SALE.receipt_number, s: SALE.sale_status, c: SALE.cashier_name, t: SALE.total_usd, at: SALE.created_at })
  // A second sale with NOTHING but its own creation, so the count query has to
  // answer for a sale that has no rows in any of the three tables.
  sqlite.prepare("INSERT INTO sales (id, receipt_number, sale_status, cashier_name, total_usd, created_at) VALUES (78,'20260906-091500','completed','sokha',4,'2026-09-06T09:15:00Z')").run()

  for (const row of LEDGER) {
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
  for (const row of AUDIT) {
    sqlite.prepare("INSERT INTO audit_logs (id, user_name, action, entity, entity_id, details, created_at) VALUES (@id,@u,@a,'sale','77',@d,@at)")
      .run({ id: row.id, u: row.user_name, a: row.action, d: row.details, at: row.created_at })
  }
  // An audit row about a DIFFERENT sale and a row about another entity: both
  // must be invisible to sale 77's count.
  sqlite.prepare(`INSERT INTO audit_logs (id, user_name, action, entity, entity_id, details, created_at) VALUES (600,'admin','update','sale','78','{"oldStatus":"completed","newStatus":"cancelled"}','2026-09-06 19:00:00')`).run()
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
  assert.strictEqual(SALE_RECORDS_COUNT_BINDS_PER_ID, 3, 'the chunker has to know how many lists each id is bound into')
  const rows = sqlite.prepare(sql).all(...saleRecordsCountBinds(ids))
  const counts = new Map(rows.map((row) => [Number(row.sale_id), Number(row.n)]))

  // +1 for the sale's own creation, which no table records.
  const count77 = (counts.get(77) || 0) + SALE_RECORDS_SELF_COUNT
  const count78 = (counts.get(78) || 0) + SALE_RECORDS_SELF_COUNT

  const detail77 = buildSaleRecords({ sale: SALE, ledger: LEDGER, audit: AUDIT, bulk: BULK })
  assert.strictEqual(count77, detail77.length, 'the row badge and the float must agree')
  assert.strictEqual(count77, 7, '3 ledger + 2 audit (one twin suppressed) + 1 bulk + the sale itself')
  assert.strictEqual(count78, 2, "sale 78's own creation plus the one audit row about it")

  // The discriminating half: without the suppression the badge would say 8
  // while the float still showed 7.
  const naive = sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity='sale' AND entity_id='77'").get().n
  assert.strictEqual(naive, 3, 'three audit rows exist for sale 77')
  assert.strictEqual(count77 - 1 - 3 - 1, 2, 'but only two of them are records')
  sqlite.close()
})

runTest('the audit half of the count binds the sale id as TEXT, which is why the binds are built in one place', () => {
  const sqlite = setup(true)
  seedRecords(sqlite)
  // audit_logs.entity_id is TEXT; sale_amendments.sale_id is INTEGER. Binding
  // the same JavaScript number into both lists -- the obvious implementation --
  // matches NOTHING in audit_logs, so the badge silently drops every status
  // change and every customer swap.
  const sql = buildSaleRecordsCountSql('?')
  const numberBound = sqlite.prepare(sql).all(77, 77, 77)
  const viaHelper = sqlite.prepare(sql).all(...saleRecordsCountBinds([77]))
  const sum = (rows) => rows.reduce((total, row) => total + Number(row.n), 0)
  assert.strictEqual(sum(numberBound), 4, 'number-bound: the two audit records vanish')
  assert.strictEqual(sum(viaHelper), 6, 'text-bound: 3 ledger + 2 audit + 1 bulk')
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
})

runTest('the records route is gated on READING a sale, not on amending one', () => {
  const body = routeBody("app.get('/:id/records'")
  assert.match(body, /canReadSales\(/, 'a view-tier bookkeeper who can see the sale can see how it got that way')
  assert.ok(!/getActionTier|hasPermission\(/.test(body), 'gating this on the amend action would hide the trail from the people who reconcile the books')
  // All four sources, or the union is a union of three.
  assert.match(body, /FROM sale_amendments/)
  assert.match(body, /FROM audit_logs/)
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
