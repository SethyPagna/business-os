// Real migration-chain fixture; local-only, no credentials or production data.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const dir = path.join(__dirname, '../migrations')
const name = '0183_supplier_invoices_owner_settled.sql'
const sql = fs.readFileSync(path.join(dir, name), 'utf8')
assert(!sql.includes('\r'), 'migration must be LF only')
const db = new Database(':memory:')
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql') && f < name).sort()) db.exec(fs.readFileSync(path.join(dir,f),'utf8'))
const apply = db.transaction(() => db.exec(sql))
apply() // clean install must work
const rows = [
 [315,22,'ចែ USA','2024-08-26T09:52:00.000Z',28,29,203,174,29],
 [531,22,'ចែ USA','2024-12-20T04:20:00.000Z',244,245,177,165,12],
 [612,19,'Dane japan','2025-02-28T05:31:00.000Z',325,326,1373,935,438],
 [813,28,'naomi','2025-05-28T09:28:00.000Z',526,527,260,250,10]
]
const insert = db.prepare(`INSERT INTO supplier_invoices
 (id,supplier_id,supplier_name,invoice_date,legacy_id,source_row,total_amount_usd,amount_paid_usd,outstanding_balance_usd,source_branch,source_file,status)
 VALUES (?,?,?,?,?,?,?,?,?,'shop','shop-account-payable-report-all.xls','Outstanding')`)
for (const r of rows) insert.run(...r)
insert.run(9999,28,'Control','2025-01-01',9999,9999,500,100,400)
const before = db.prepare('SELECT * FROM supplier_invoices ORDER BY id').all()
const unrelatedBefore = JSON.stringify(before.find(r => r.id===9999))
const ledgerTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('supplier_invoices','audit_logs','sqlite_sequence') ORDER BY name").all().map(r=>r.name)
const ledgerCounts = () => ledgerTables.map(t=>[t,db.prepare(`SELECT COUNT(*) n FROM "${t.replaceAll('"','""')}"`).get().n])
const countsBefore = ledgerCounts()
const totalBefore = db.prepare('SELECT SUM(outstanding_balance_usd) n FROM supplier_invoices').get().n

// Mutation/identity races reject the entire transaction, including new audit rows.
for (const [field,value] of [['supplier_name','Unexpected'],['amount_paid_usd',173],['total_amount_usd',204],['source_row',30],['status','Paid']]) {
 const original = db.prepare(`SELECT ${field} v FROM supplier_invoices WHERE id=315`).get().v
 db.prepare(`UPDATE supplier_invoices SET ${field}=? WHERE id=315`).run(value)
 assert.throws(apply,/CHECK constraint failed/)
 assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='owner_settle_legacy_supplier_0183'").get().n,0)
 db.prepare(`UPDATE supplier_invoices SET ${field}=? WHERE id=315`).run(original)
}
apply()
assert.equal(totalBefore-db.prepare('SELECT SUM(outstanding_balance_usd) n FROM supplier_invoices').get().n,489)
const audit = db.prepare("SELECT * FROM audit_logs WHERE action='owner_settle_legacy_supplier_0183' ORDER BY CAST(record_id AS INTEGER)").all()
assert.equal(audit.length,4)
for (const r of before.filter(r=>r.id!==9999)) {
 const after = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(r.id)
 assert.deepEqual(after,{...r,status:'Paid',amount_paid_usd:r.total_amount_usd,outstanding_balance_usd:0})
 assert.deepEqual(JSON.parse(audit.find(a=>Number(a.record_id)===r.id).old_value),{amount_paid_usd:r.amount_paid_usd,outstanding_balance_usd:r.outstanding_balance_usd,status:r.status})
}
assert.equal(JSON.stringify(db.prepare('SELECT * FROM supplier_invoices WHERE id=9999').get()),unrelatedBefore)
assert.deepEqual(ledgerCounts(),countsBefore)
const settled = db.prepare('SELECT * FROM supplier_invoices ORDER BY id').all()
apply()
assert.deepEqual(db.prepare('SELECT * FROM supplier_invoices ORDER BY id').all(),settled)
assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='owner_settle_legacy_supplier_0183'").get().n,4)
// Reversal proof: exact before-values recoverable without touching unrelated fields.
for (const a of audit) {
 const old = JSON.parse(a.old_value)
 db.prepare("UPDATE supplier_invoices SET status=?,amount_paid_usd=?,outstanding_balance_usd=? WHERE id=? AND status='Paid' AND amount_paid_usd=total_amount_usd AND outstanding_balance_usd=0")
 .run(old.status,old.amount_paid_usd,old.outstanding_balance_usd,Number(a.record_id))
}
assert.deepEqual(db.prepare('SELECT * FROM supplier_invoices ORDER BY id').all(),before)
db.close()
console.log('PASS 0183: full chain, empty install, five stale-target refusals, exact settlement, four audits, unrelated/cash/stock preservation, idempotency, recovery')
