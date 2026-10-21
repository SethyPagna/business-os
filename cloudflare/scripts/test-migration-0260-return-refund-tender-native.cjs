'use strict'
// Migration 0260 (lane 6.0.884): two columns on returns, applied on top of the
// full local migration chain (0001..0259, in file order, one transaction per
// file), with the PRE/POST assertions its header names. It moves no data: the
// refund totals are byte-identical after it and every existing row reads as a
// pre-0260 dollar refund that lowered no debt. Its CHECKs refuse only values
// no Worker writes. Local only; nothing here touches a remote database.
//
// Run (from cloudflare/): node scripts/test-migration-0260-return-refund-tender-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const dir = path.join(__dirname, '..', 'migrations')
const FILE = '0260_return_refund_tender.sql'
const text = fs.readFileSync(path.join(dir, FILE), 'utf8')
let passed = 0
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`) }
function apply(db, file) {
  db.exec('BEGIN')
  try { db.exec(fs.readFileSync(path.join(dir, file), 'utf8')); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw new Error(`${file}: ${error.message}`) }
}

const files = fs.readdirSync(dir).filter(file => file.endsWith('.sql')).sort()
check('0260 directly follows 0259 and is the only file with that number', () => {
  assert.equal(files.filter(file => file.startsWith('0260_')).length, 1)
  assert.equal(files[files.indexOf(FILE) - 1].slice(0, 5), '0259_')
  assert.equal(text.includes('\r'), false, 'LF only')
})

const db = new DatabaseSync(':memory:')
for (const file of files.slice(0, files.indexOf(FILE))) apply(db, file)
// Refunds as the Worker writes them before 0260: legacy (v0) and exact (v1), active and cancelled.
const insert = db.prepare(`INSERT INTO returns(return_number,status,return_scope,total_refund_usd,total_refund_khr,
  money_precision_version,calculated_refund_usd,rounding_adjustment_usd) VALUES (?,?,?,?,?,?,?,?)`)
insert.run('RET-1', 'completed', 'customer', 4, 16000, 0, null, 0)
insert.run('RET-2', 'cancelled', 'customer', 2.5, 10250, 0, null, 0)
insert.run('RET-3', 'completed', 'customer', 7.3, 29200, 1, 7.3, 0)
insert.run('SRET-4', 'completed', 'supplier', 0, 0, 0, null, 0)
const PRE = 'SELECT COUNT(*) AS n, ROUND(SUM(total_refund_usd),4) AS usd, SUM(total_refund_khr) AS khr FROM returns'
const pre = { ...db.prepare(PRE).get() }
const rowsBefore = JSON.stringify(db.prepare('SELECT * FROM returns ORDER BY id').all())

apply(db, FILE)
check('POST: the PRE totals are identical and no row carries a currency or a lowered debt', () => {
  assert.deepEqual({ ...db.prepare(PRE).get() }, pre)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM returns WHERE refund_currency IS NOT NULL OR owed_reduction_usd <> 0').get().n, 0)
})
check('every existing column of every row is unchanged; the new ones read NULL / 0', () => {
  const after = db.prepare('SELECT * FROM returns ORDER BY id').all()
  assert.equal(JSON.stringify(after.map(({ refund_currency: _c, owed_reduction_usd: _o, ...row }) => row)), rowsBefore)
  assert.ok(after.every(row => row.refund_currency === null && row.owed_reduction_usd === 0))
})
check('the CHECKs accept what the Worker writes', () => {
  db.exec("UPDATE returns SET refund_currency='KHR', owed_reduction_usd=3 WHERE return_number='RET-1'")
  db.exec("UPDATE returns SET refund_currency='USD', owed_reduction_usd=7.3 WHERE return_number='RET-3'")
  db.exec("UPDATE returns SET refund_currency='USD', owed_reduction_usd=0 WHERE return_number='RET-2'")
})
check('the CHECKs refuse what no Worker writes: another currency, a negative or over-value debt, a text amount', () => {
  for (const statement of [
    "UPDATE returns SET refund_currency='EUR' WHERE return_number='RET-1'",
    "UPDATE returns SET owed_reduction_usd=-0.01 WHERE return_number='RET-1'",
    "UPDATE returns SET owed_reduction_usd=4.01 WHERE return_number='RET-1'",
    "UPDATE returns SET owed_reduction_usd='abc' WHERE return_number='RET-1'",
    "UPDATE returns SET owed_reduction_usd=NULL WHERE return_number='RET-1'",
  ]) assert.throws(() => db.exec(statement), /constraint/i, statement)
})
check('the 0158 money-precision trigger still guards the refund value beside the new columns', () => {
  assert.throws(() => db.exec("UPDATE returns SET total_refund_usd=7.31 WHERE return_number='RET-3'"), /money_precision_invalid_returns/)
})
check('the file is not re-runnable: a second apply fails and changes nothing (append-only chain)', () => {
  const before = JSON.stringify(db.prepare('SELECT * FROM returns ORDER BY id').all())
  assert.throws(() => apply(db, FILE), /duplicate column/i)
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM returns ORDER BY id').all()), before)
})
db.close()
console.log(`GREEN migration 0260 on the full local chain: ${passed} checks`)
