'use strict'
// Lane 6.0.891 (slice S0): the Not-Paid conversion census finds the wrongly
// converted sales it is meant to find, and only those, and its control sets
// make a broken join visible instead of reading as "nothing wrong".
//
// Seeded on the full local migration chain: one planted wrong conversion each
// for C2 (born Not Paid, now reads paid, still owes after returns), C3
// (replacement with invented tender off a Not Paid original) and C5 (legacy
// receivable still owed, sale booked paid), beside decoys that must NOT be hit
// (tender covers, half-cent band, debt cleared by returns, different invoice
// date, correct Not Paid). Local only; nothing here touches a remote database.
//
// Run (from cloudflare/): node scripts/test-not-paid-census-control-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')

const root = path.join(__dirname, '..', '..')
const migrations = path.join(__dirname, '..', 'migrations')
const censusDir = path.join(root, 'ops', 'scripts', 'census')
let passed = 0
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`) }

function chain() {
  const db = new DatabaseSync(':memory:')
  for (const file of fs.readdirSync(migrations).filter(f => f.endsWith('.sql')).sort()) {
    db.exec('BEGIN')
    try { db.exec(fs.readFileSync(path.join(migrations, file), 'utf8')); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw new Error(`${file}: ${error.message}`) }
  }
  return db
}

const AWAITING_SNAPSHOT = JSON.stringify({ sale_status: 'awaiting_payment', origin: 'pos' })
function sale(db, row) {
  const cols = { total_usd: 10, amount_paid_usd: 0, amount_paid_khr: 0, exchange_rate: 4100, sale_status: 'completed', ...row }
  const keys = Object.keys(cols)
  db.prepare(`INSERT INTO sales(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => cols[k]))
}
function ret(db, row) {
  const cols = { status: 'completed', return_scope: 'customer', total_refund_usd: 0, ...row }
  const keys = Object.keys(cols)
  db.prepare(`INSERT INTO returns(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => cols[k]))
}
function auditOldStatus(db, saleId, oldStatus) {
  db.prepare("INSERT INTO audit_logs(action, entity, entity_id, details) VALUES ('update','sale',?,?)").run(String(saleId), JSON.stringify({ oldStatus, newStatus: 'completed' }))
}
function statusEvent(db, saleId, uuid) {
  const changes = [{ field: 'sale_status', before: { state: 'known_value', value: 'awaiting_payment' }, after: { state: 'known_value', value: 'completed' } }]
  db.prepare(`INSERT INTO sale_record_events(id, sale_id, source_kind, source_id, generation, kind, via, occurred_at, changes_json)
    VALUES (?, ?, 'sale_status', ?, 0, 'status_changed', 'apply', '2026-09-01T00:00:00Z', ?)`).run(uuid, saleId, `src-${saleId}`, JSON.stringify(changes))
}

function seed(db) {
  // ---- C2 ----
  sale(db, { id: 1, receipt_number: 'W-1', sale_status: 'returned', status_before_return: null, total_usd: 10 }) // PLANTED: payment state lost, born Not Paid (audit only), owes $6 after the $4 return
  ret(db, { id: 1, sale_id: 1, return_number: 'R-1', total_refund_usd: 4 })
  auditOldStatus(db, 1, 'awaiting_payment')
  sale(db, { id: 2, receipt_number: 'D-2', amount_paid_usd: 10, creation_snapshot_json: AWAITING_SNAPSHOT }) // settled in full later
  sale(db, { id: 3, receipt_number: 'D-3', total_usd: 10 }) // debt cleared by a full-value return (event evidence)
  ret(db, { id: 3, sale_id: 3, return_number: 'R-3', total_refund_usd: 10 })
  statusEvent(db, 3, '11111111-1111-4111-8111-111111111111')
  sale(db, { id: 4, receipt_number: 'D-4', amount_paid_usd: 3 }) // underpaid, but no Not Paid evidence
  sale(db, { id: 5, receipt_number: 'D-5', amount_paid_usd: 9.9955, creation_snapshot_json: AWAITING_SNAPSHOT }) // 0.45 cent short: inside the half-cent band
  sale(db, { id: 6, receipt_number: 'D-6', sale_status: 'awaiting_payment', creation_snapshot_json: AWAITING_SNAPSHOT }) // correctly Not Paid
  sale(db, { id: 7, receipt_number: 'D-7', sale_status: 'partial_return', status_before_return: 'awaiting_payment', creation_snapshot_json: AWAITING_SNAPSHOT }) // Not Paid kept beside the return
  sale(db, { id: 8, receipt_number: 'D-8', sale_status: 'cancelled', creation_snapshot_json: AWAITING_SNAPSHOT }) // cancelled is not "reads paid"
  sale(db, { id: 9, receipt_number: 'U-9', total_usd: 5, amount_paid_khr: 1000, exchange_rate: 0, creation_snapshot_json: AWAITING_SNAPSHOT }) // money cannot be read
  // ---- C3 / C4 ----
  sale(db, { id: 10, receipt_number: 'O-10', sale_status: 'awaiting_payment' })
  ret(db, { id: 100, sale_id: 10, return_number: 'R-100', total_refund_usd: 4, refund_currency: 'USD', owed_reduction_usd: 4 })
  sale(db, { id: 11, receipt_number: 'W-11', total_usd: 4, amount_paid_usd: 4, payment_method: 'Cash', source_return_id: 100 }) // PLANTED: tender invented on a debt
  sale(db, { id: 12, receipt_number: 'O-12', amount_paid_usd: 10 }) // a paid original
  ret(db, { id: 101, sale_id: 12, return_number: 'R-101', total_refund_usd: 4, refund_currency: 'USD', owed_reduction_usd: 0 })
  sale(db, { id: 13, receipt_number: 'D-13', total_usd: 4, amount_paid_usd: 4, source_return_id: 101 }) // paid replacement on a paid original: fine
  sale(db, { id: 14, receipt_number: 'O-14', sale_status: 'awaiting_payment' })
  ret(db, { id: 102, sale_id: 14, return_number: 'R-102', total_refund_usd: 4, refund_currency: 'USD', owed_reduction_usd: 4 })
  sale(db, { id: 15, receipt_number: 'D-15', sale_status: 'awaiting_payment', total_usd: 4, payment_method: null, source_return_id: 102 }) // Not Paid, zero tender: correct
  // ---- C5 ----
  sale(db, { id: 20, receipt_number: 'W-20', legacy_receipt_number: 'INV-1@2026-09-01', amount_paid_usd: 10 }) // PLANTED: booked paid, receivable still owes
  sale(db, { id: 21, receipt_number: 'D-21', legacy_receipt_number: 'INV-2@2026-09-01', amount_paid_usd: 10 })
  sale(db, { id: 22, receipt_number: 'D-22', legacy_receipt_number: 'INV-3@2026-09-01', sale_status: 'awaiting_payment' })
  sale(db, { id: 23, receipt_number: 'D-23', legacy_receipt_number: 'INV-1@2026-09-05', amount_paid_usd: 10 }) // same number, another day
  const ar = db.prepare(`INSERT INTO customer_receivables(legacy_id, customer_name, invoice_no, invoice_date, total_amount_usd, outstanding_balance_usd, status, source_file, source_row)
    VALUES (?, 'C', ?, ?, 10, ?, 'open', 'f.xls', ?)`)
  ar.run(1, 'INV-1', '2026-09-01', 5, 1)
  ar.run(2, 'INV-2', '2026-09-01', 0, 2)
  ar.run(3, 'INV-3', '2026-09-01', 4, 3)
  ar.run(4, 'INV-1', '2026-09-02', 7, 4) // no sale carries INV-1@2026-09-02
  // ---- C6 ----
  db.prepare("INSERT INTO audit_logs(action, entity, user_name, details, created_at) VALUES ('repair','data-integrity','Admin','{}','2026-09-10 00:00:00')").run()
  db.prepare("UPDATE sales SET updated_at='2026-09-11 00:00:00' WHERE id=1").run()
}

const rootSqlText = fs.readFileSync(path.join(censusDir, 'not-paid-conversion-census.sql'), 'utf8')
const COMPOSITE = "s.legacy_receipt_number = cr.invoice_no || '@' || substr(cr.invoice_date, 1, 10)"

;(async () => {
  const census = await import(pathToFileURL(path.join(censusDir, 'not-paid-conversion-census.mjs')).href)
  const rulePath = path.join(root, 'frontend', 'src', 'utils', 'saleStatusResolution.ts')
  const rule = (await import(pathToFileURL(rulePath).href)).recordedSaleOutstandingUsd
  const db = chain()
  seed(db)
  const query = sql => db.prepare(sql).all().map(row => ({ ...row }))
  const run = (extra = {}) => census.runCensus({ query, ...extra })
  const ids = rows => rows.map(r => r.id ?? r.replacement_id ?? r.receivable_id ?? r.return_id)

  await check('the SQL file is SELECT-only: every block passes the guard, and a write block is refused', async () => {
    for (const [name, sql] of census.parseQueries(rootSqlText)) census.assertSelectOnly(name, sql)
    for (const bad of ['DELETE FROM sales', 'SELECT 1; SELECT 2', 'WITH x AS (SELECT 1) UPDATE sales SET sale_status = 1', 'PRAGMA table_info(sales)']) {
      assert.throws(() => census.assertSelectOnly('bad', bad), /SELECT|write keyword|statement/, bad)
    }
  })

  const report = await run()

  await check('the planted wrong conversions are the only hits: C2 sale 1, C3 replacement 11, C5 receivable 1', () => {
    assert.deepEqual(ids(report.C2.hits), [1])
    assert.deepEqual(ids(report.C3.hits), [11])
    assert.deepEqual(ids(report.C5.hits), [1])
    assert.equal(report.C4.hits.length, 0, 'the 884 negative control stays empty')
  })
  await check('C2 sorts every candidate: owes -> hit; cleared by returns -> review; inside the half-cent band -> covered; unreadable money -> its own list', () => {
    assert.equal(report.C2.hits[0].owed_after_returns_usd, 6)
    assert.deepEqual(ids(report.C2.review), [3])
    assert.equal(report.C2.covered, 1, 'sale 5 sits inside the half-cent band; sale 2 was settled in full and is no candidate')
    assert.deepEqual(ids(report.C2.unreadable), [9])
  })
  await check('the control sets are printed and non-zero where the join must match', () => {
    const c = report.control
    assert.equal(c.sales_total, 19, 'every seeded sale is counted')
    assert.equal(c.replacement_sales_direct, 3)
    assert.equal(c.replacement_sales_joined, 3, 'the join keeps every replacement sale')
    assert.equal(c.ar_rows, 4)
    assert.equal(c.ar_rows_with_sale_composite, 3, 'INV-1@2026-09-02 has no sale')
    assert.equal(c.ar_rows_owed, 3)
    assert.equal(c.ar_rows_owed_with_sale, 2)
    assert.equal(c.integrity_repairs, 1)
    const text = census.formatReport(report)
    assert.match(text, /ar_rows_with_sale_composite\s+3/)
    assert.match(text, /C5 .*1 hit\(s\)/)
  })
  await check('C1 counts the retired-status rows and C6 correlates the repair with the casualty it left', () => {
    assert.equal(report.C1.reduce((sum, r) => sum + r.n, 0), 2, 'sales 1 and 7')
    assert.equal(report.C1.find(r => r.sale_status === 'returned').status_before_return, null)
    assert.equal(report.C6.length, 1)
    assert.equal(report.C6[0].casualties_since, 1)
  })

  await check('MUTANT: a C5 join on invoice_no alone matches nothing, so the control stops the run', async () => {
    const mutant = rootSqlText.split(COMPOSITE).join('s.legacy_receipt_number = cr.invoice_no')
    assert.notEqual(mutant, rootSqlText)
    await assert.rejects(run({ sqlText: mutant }), err => err instanceof census.CensusControlError && /C5 join is broken/.test(err.message))
  })
  await check('MUTANT: a base-number-only C5 join keeps the control non-zero but its count and hits drift', async () => {
    const base = "s.legacy_receipt_number = cr.invoice_no OR s.legacy_receipt_number LIKE cr.invoice_no || '@%'"
    const mutant = rootSqlText.split(COMPOSITE).join(base)
    const drifted = await run({ sqlText: mutant })
    assert.notEqual(drifted.control.ar_rows_with_sale_composite, 3, 'the real count is 3')
    assert.ok(drifted.C5.hits.length > 1, 'the same-number sale on another day is wrongly hit')
  })
  await check('MUTANT: a judge that ignores the debt the returns lowered turns the cleared-by-returns decoy into a hit', async () => {
    const blind = row => rule({ ...row, refund_usd: 0 })
    const wrong = await run({ fn: blind })
    assert.deepEqual(ids(wrong.C2.hits).sort(), [1, 3])
  })
  await check('MUTANT: dropping the audit evidence path loses the planted C2 sale', async () => {
    const mutant = rootSqlText.replace(/OR EXISTS\(SELECT 1 FROM audit_logs a WHERE a\.entity = 'sale' AND a\.entity_id = CAST\(k\.id AS TEXT\) AND a\.action = 'update'\s+AND json_extract\(a\.details,'\$\.oldStatus'\) = 'awaiting_payment'\)/, 'OR 0')
    assert.notEqual(mutant, rootSqlText)
    const lost = await run({ sqlText: mutant })
    assert.deepEqual(ids(lost.C2.hits), [])
  })

  await check('an empty database or one with no rows read stops the run (a --file style read observes nothing)', async () => {
    await assert.rejects(census.runCensus({ query: () => [] }), err => err instanceof TypeError || err instanceof census.CensusControlError)
    const empty = chain()
    await assert.rejects(census.runCensus({ query: sql => empty.prepare(sql).all().map(r => ({ ...r })) }), err => err instanceof census.CensusControlError && /sales_total is 0/.test(err.message))
  })

  await check('C4 detects the 884 flip when one exists (positive control on a scratch copy)', async () => {
    const copy = chain()
    seed(copy)
    sale(copy, { id: 40, receipt_number: 'F-40', amount_paid_usd: 10 })
    ret(copy, { id: 140, sale_id: 40, return_number: 'R-140', total_refund_usd: 10, refund_currency: 'USD', owed_reduction_usd: 4 })
    const flipped = await census.runCensus({ query: sql => copy.prepare(sql).all().map(r => ({ ...r })) })
    assert.deepEqual(flipped.C4.hits.map(r => r.return_id), [140])
  })

  await check('the CLI opens a file read-only, prints the report, and exits 2 on a failed control', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'census-'))
    try {
      const file = path.join(dir, 'seeded.sqlite')
      db.exec(`VACUUM INTO '${file.replace(/\\/g, '/').replace(/'/g, "''")}'`)
      const script = path.join(censusDir, 'not-paid-conversion-census.mjs')
      const ok = spawnSync(process.execPath, [script, '--db', file], { encoding: 'utf8' })
      assert.equal(ok.status, 0, ok.stderr)
      assert.match(ok.stdout, /HIT sale 1 W-1/)
      assert.match(ok.stdout, /HIT replacement 11 W-11/)
      assert.match(ok.stdout, /HIT receivable 1 INV-1@2026-09-01/)
      const emptyFile = path.join(dir, 'empty.sqlite')
      chain().exec(`VACUUM INTO '${emptyFile.replace(/\\/g, '/')}'`)
      const bad = spawnSync(process.execPath, [script, '--db', emptyFile], { encoding: 'utf8' })
      assert.equal(bad.status, 2)
      assert.match(bad.stderr, /CONTROL FAILED/)
      assert.equal(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status, 64)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  db.close()
  console.log(`GREEN not-paid census control: ${passed} checks`)
})().catch(error => { console.error(error); process.exit(1) })
