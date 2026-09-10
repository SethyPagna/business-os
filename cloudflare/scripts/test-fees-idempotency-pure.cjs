const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
const helperSource = fs.readFileSync(path.join(root, 'src/lib/feeOperationReceipt.ts'), 'utf8')
const helperOutput = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const moduleObj = { exports: {} }
new Function('exports', 'require', 'module', helperOutput)(moduleObj.exports, require, moduleObj)
const subject = moduleObj.exports

const intent = {
  fee_type: 'expense', label: 'Packing tape', amount_usd: 2.5, amount_khr: 1000,
  fee_date: '2026-09-11', sale_id: null, branch_id: 1,
  delivery_contact_id: null, notes: 'counter',
}
const canonical = subject.canonicalFeeCreateRequest(intent)
assert.equal(canonical, subject.canonicalFeeCreateRequest({ ...intent }), 'equal intent has byte-identical canonical JSON')
assert.notEqual(canonical, subject.canonicalFeeCreateRequest({ ...intent, amount_usd: 3 }), 'changed money changes canonical JSON')
assert.equal(subject.normalizeFeeRequestId(' fee_req_123456 '), 'fee_req_123456')
assert.equal(subject.normalizeFeeRequestId('short'), null)

const migration = fs.readFileSync(path.join(root, 'migrations/0150_fee_operation_receipts.sql'), 'utf8')
assert(!migration.includes('\r'), '0150 receipt migration must remain LF-only')
const db = new Database(':memory:')
for (const sql of loadAll()) db.exec(sql)
db.pragma('foreign_keys = ON')
db.prepare('DELETE FROM fees').run()

const requestId = 'fee_req_123456'
const digest = 'a'.repeat(64)
const occurredAt = '2026-09-11T01:02:03.004Z'
const insertFee = db.prepare(`INSERT INTO fees(
  fee_type,label,amount_usd,amount_khr,fee_date,sale_id,branch_id,delivery_contact_id,
  notes,created_by,created_by_name,created_at,updated_at
) VALUES(
  @feeType,@label,@amountUsd,@amountKhr,@feeDate,@saleId,@branchId,@deliveryContactId,
  @notes,@createdBy,@createdByName,@now,@now
)`)

const commit = db.transaction((receiptId) => {
  insertFee.run({
    feeType: intent.fee_type, label: intent.label, amountUsd: intent.amount_usd,
    amountKhr: intent.amount_khr, feeDate: intent.fee_date, saleId: intent.sale_id,
    branchId: 1, deliveryContactId: intent.delivery_contact_id, notes: intent.notes,
    createdBy: 7, createdByName: 'cashier', now: occurredAt,
  })
  const receipt = subject.feeOperationReceiptStatement({
    receiptId, actorId: 7, actorName: 'cashier', requestId, digest,
    requestJson: canonical, occurredAt, intent, resolvedBranchId: 1,
  })
  db.prepare(receipt.sql).run(receipt.params)
  const audit = subject.feeCreateAuditStatement({
    actorId: 7, actorName: 'cashier', requestId, digest, resolvedBranchId: 1,
  })
  db.prepare(audit.sql).run(audit.params)
})

commit(crypto.randomUUID())
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fees').get().n, 1)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fee_operation_receipts').get().n, 1)
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='create' AND entity='fee'").get().n, 1, 'one create audit is atomic with the fee')

const receiptRow = db.prepare('SELECT * FROM fee_operation_receipts WHERE actor_id=? AND request_id=?').get(7, requestId)
const replay = subject.feeOperationReceiptResponse(receiptRow)
assert.equal(replay.fee.id, receiptRow.fee_id)
assert.equal(replay.fee.amount_usd, 2.5)
assert.equal(replay.fee.amount_khr, 1000)

assert.throws(() => commit(crypto.randomUUID()), /unique/i, 'concurrent/equal request cannot create a second receipt')
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fees').get().n, 1, 'receipt conflict rolls the second fee back')
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='create' AND entity='fee'").get().n, 1, 'receipt conflict rolls the second audit back')

const totals = db.prepare('SELECT SUM(amount_usd) AS usd,SUM(amount_khr) AS khr FROM fees').get()
assert.deepEqual(totals, { usd: 2.5, khr: 1000 }, 'native USD/KHR expense totals remain unchanged')
const shiftTotals = db.prepare("SELECT SUM(amount_usd) AS usd,SUM(amount_khr) AS khr FROM fees WHERE created_at>=? AND created_at<=?").get('2026-09-11T00:00:00.000Z', '2026-09-11T23:59:59.999Z')
assert.deepEqual(shiftTotals, totals, 'the committed row participates once in timestamp-scoped shift accounting')

assert.throws(() => db.prepare('UPDATE fee_operation_receipts SET occurred_at=? WHERE id=?').run('2026-09-12T01:02:03.004Z', receiptRow.id), /immutable/i)
assert.throws(() => db.prepare('DELETE FROM fee_operation_receipts WHERE id=?').run(receiptRow.id), /immutable/i)
db.prepare('DELETE FROM fees WHERE id=?').run(receiptRow.fee_id)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fee_operation_receipts WHERE id=?').get(receiptRow.id).n, 1, 'deleting an expense keeps its retry receipt without blocking the existing delete flow')
db.prepare("INSERT INTO system_flags(key,value) VALUES('sale_record_events_reset_guard','{\"mode\":\"reset\",\"token\":\"test\"}')").run()
db.prepare('DELETE FROM fee_operation_receipts WHERE id=?').run(receiptRow.id)
db.close()

console.log('PASS fee create canonical identity, atomic receipt/audit, exact replay, conflict rollback, currency and shift accounting')
