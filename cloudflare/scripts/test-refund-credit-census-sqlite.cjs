// ops/queries/refund-credit-relabelled-count.sql, run through the ops SQL guard and on a local fixture holding every damage shape and every healthy
// shape the review named. The query must list exactly the damaged rows (sale id, position, current method, snapshot method, damage) and nothing else.
// No remote database, no native lock: the in-memory schema only.

const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const db = openDb(loadAll())
const run = (sql, params = []) => db.prepare(sql).run(params)
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const KHMER_CASH = 'សាច់ប្រាក់'
const credit = (method, usd = 10) => ({ method, amount_usd: usd, amount_khr: 0, refund_credit: true })
const row = (method, usd) => ({ method, amount_usd: usd, amount_khr: 0 })
// The creation snapshot copies the credit as row 0 WITHOUT the flag (saleCreationSnapshot.ts keeps method and amounts only).
const snapshot = (rows) => JSON.stringify({ origin: 'return_replacement', payment_details: rows.map((r) => row(r.method, r.amount_usd)) })

let seq = 0
// One exchange: a return, its replacement sale, the create receipt. `oneStep` false models the two-step replacement (no exchange_payment).
function exchange({ id, details, snap, oneStep = true, returnStatus = 'completed', saleStatus = 'completed', refund = 10, owed = 0, withReturn = true }) {
  const stamp = '2026-11-01T08:00:00.000Z'
  if (!withReturn) {
    run(`INSERT INTO sales(id,receipt_number,payment_method,payment_details,money_precision_version,calculated_total_usd,total_usd,sale_status,creation_snapshot_json,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)`, [id, `R-${id}`, 'Cash', JSON.stringify(details), 1, 10, 10, saleStatus, snap, stamp])
    return
  }
  const returnId = 5000 + id
  run(`INSERT INTO returns(id,return_number,sale_id,status,total_refund_usd,owed_reduction_usd,money_precision_version,calculated_refund_usd,refund_currency,client_request_id,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`, [returnId, `RT-${id}`, null, returnStatus, refund, owed, 1, refund, 'USD', `crq-${id}`, stamp])
  run(`INSERT INTO sales(id,receipt_number,payment_method,payment_details,money_precision_version,calculated_total_usd,total_usd,sale_status,creation_snapshot_json,source_return_id,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`, [id, `R-${id}`, 'Cash', JSON.stringify(details), 1, 10, 10, saleStatus, snap, returnId, stamp])
  run('UPDATE returns SET replacement_sale_id=? WHERE id=?', [id, returnId])
  const request = oneStep ? { sale_id: null, exchange_payment: { details: [], change_currency: 'USD' } } : { sale_id: null }
  run(`INSERT INTO return_create_receipts(id,actor_id,return_id,sale_id,request_id,request_digest,request_json,response_json,occurred_at)
       VALUES(?,?,?,?,?,?,?,?,?)`, [uuid(++seq), 1, returnId, null, `rid-${id}`, 'a'.repeat(64), JSON.stringify(request),
    JSON.stringify({ id: returnId, returnNumber: `RT-${id}`, replacementSaleId: id, replacementReceiptNumber: `R-${id}` }), stamp])
}

// ---- Damaged (the query must list each one)
exchange({ id: 1, details: [credit('ABA'), row('Cash', 5)], snap: snapshot([credit('Cash'), row('Cash', 5)]) })                       // relabelled to a digital method
exchange({ id: 2, details: [credit('Cash App'), row('ABA', 5)], snap: snapshot([credit('Cash'), row('ABA', 5)]) })                  // relabelled to a digital method whose name contains "cash"
exchange({ id: 3, details: [credit('Cash USD'), row('ABA', 5)], snap: snapshot([credit('Cash'), row('ABA', 5)]) })                  // renamed between two cash names
exchange({ id: 4, details: [row('Cash', 10), row('ABA', 5)], snap: snapshot([credit('Cash'), row('ABA', 5)]) })                     // flag lost by a settle or a correction
exchange({ id: 5, details: [row(KHMER_CASH, 10)], snap: snapshot([credit(KHMER_CASH)]) })                                           // flag lost, Khmer cash name (a name test would call it cash)
exchange({ id: 6, details: [row('Cash', 10)], snap: snapshot([credit('Cash')]) })                                                    // flag lost, then payment_details became unreadable
run("UPDATE sales SET payment_details='not json' WHERE id=6")
// ---- Healthy (the query must not list any of them)
exchange({ id: 11, details: [credit(KHMER_CASH), row('ABA', 5)], snap: snapshot([credit(KHMER_CASH), row('ABA', 5)]) })               // Khmer cash name
exchange({ id: 12, details: [credit('Drawer'), row('ABA', 5)], snap: snapshot([credit('Drawer'), row('ABA', 5)]) })                 // a method marked cash in the kinds setting
exchange({ id: 13, details: [credit('Cash App'), row('ABA', 5)], snap: snapshot([credit('Cash App'), row('ABA', 5)]) })             // a method marked cash whose name says cash app
exchange({ id: 14, details: [credit('cash'), row('ABA', 5)], snap: snapshot([credit('Cash'), row('ABA', 5)]) })                     // case only
exchange({ id: 15, details: [credit(' Cash '), row('ABA', 5)], snap: snapshot([credit('Cash'), row('ABA', 5)]) })                   // spacing only
exchange({ id: 16, details: [credit('Cash'), row('Cash', 5)], snap: snapshot([credit('Cash'), row('Cash', 5)]) })                   // customer row of the same method
exchange({ id: 17, details: [row('ABA', 10)], snap: snapshot([row('ABA', 10)]), oneStep: false })                                    // two-step replacement: paid in full, never a credit
exchange({ id: 18, details: [row('Cash', 10)], snap: snapshot([credit('Cash')]), returnStatus: 'cancelled' })                         // exchange cancelled: the credit left on purpose
exchange({ id: 19, details: [row('Cash', 10)], snap: snapshot([credit('Cash')]), saleStatus: 'cancelled' })                           // replacement sale cancelled
exchange({ id: 20, details: [row('ABA', 10)], snap: snapshot([row('ABA', 10)]), refund: 10, owed: 10 })                               // refund fully taken off what was owed: no credit exists
exchange({ id: 21, details: [row('Cash', 10)], snap: snapshot([row('Cash', 10)]), withReturn: false })                                // ordinary sale
exchange({ id: 22, details: [credit('ABA')], snap: null, withReturn: true })                                                         // no creation snapshot: nothing to compare against

;(async () => {
  const guard = await import(pathToFileURL(path.join(__dirname, '..', '..', 'ops', 'scripts', 'ops-sql-guard.mjs')).href)
  const query = guard.loadQuery('refund-credit-relabelled-count')
  const results = []
  const check = (name, fn) => { try { fn(); results.push(`PASS ${name}`) } catch (e) { results.push(`FAIL ${name}: ${String(e && e.message).replace(/\n/g, ' ').slice(0, 300)}`) } }

  check('the guard accepts the file: one SELECT, a read budget, zero minimum rows', () => {
    assert.equal(query.rules.minRows, 0)
    assert.ok(Number.isInteger(query.maxRowsRead) && query.maxRowsRead > 0)
    assert.match(query.sql, /^SELECT /)
  })
  const rows = db.prepare(query.sql).all()
  check('it lists exactly the six damaged sales, ordered by sale id', () => {
    assert.deepEqual(rows.map((r) => r.sale_id), [1, 2, 3, 4, 5, 6], JSON.stringify(rows))
  })
  check('it names the damage shape, row position, current and snapshot method of each', () => {
    const by = Object.fromEntries(rows.map((r) => [r.sale_id, r]))
    assert.deepEqual([by[1].damage, by[1].row_id, by[1].current_method, by[1].snapshot_method], ['method_changed', 0, 'ABA', 'Cash'])
    assert.deepEqual([by[2].damage, by[2].row_id, by[2].current_method], ['method_changed', 0, 'Cash App'])
    assert.deepEqual([by[3].damage, by[3].current_method, by[3].snapshot_method], ['method_changed', 'Cash USD', 'Cash'])
    assert.deepEqual([by[4].damage, by[4].row_id, by[4].current_method, by[4].snapshot_method], ['flag_lost', null, 'Cash', 'Cash'])
    assert.deepEqual([by[5].damage, by[5].row_id, by[5].current_method], ['flag_lost', null, KHMER_CASH])
    assert.deepEqual([by[6].damage, by[6].row_id, by[6].current_method, by[6].snapshot_method], ['flag_lost', null, null, 'Cash'], 'an unreadable payment_details is listed, not an error')
  })
  check('it exposes no customer, receipt or amount column', () => {
    assert.deepEqual(Object.keys(rows[0]).sort(), ['current_method', 'damage', 'row_id', 'sale_id', 'snapshot_method'])
  })
  check('it walks returns, then sales by primary key, then the receipt by return_id, with no statistics (plan)', () => {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all().map((r) => r.detail).join(' | ')
    assert.match(plan, /^(SCAN|SEARCH) r /, plan)
    assert.match(plan, /SEARCH s USING INTEGER PRIMARY KEY/, plan)
    assert.doesNotMatch(plan, /SCAN s\b/, plan)
  })
  check('it only reads: no write word survives in the canonical text', () => {
    assert.doesNotMatch(query.sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|PRAGMA|ATTACH)\b/i)
  })

  for (const line of results) console.log(line)
  const failed = results.filter((l) => l.startsWith('FAIL'))
  console.log(`${results.length - failed.length}/${results.length} passed`)
  if (failed.length) process.exitCode = 1
})().catch((e) => { console.error(e); process.exitCode = 1 })
