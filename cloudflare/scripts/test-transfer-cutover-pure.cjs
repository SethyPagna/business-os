const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const h = require('./test-transfer-operation-receipt-pure.cjs')

async function main() {
  for (const [app, route] of [['branches','/transfer'],['branches','/transfer-bulk'],['inventory','/transfer']]) {
    for (const marker of [undefined, null, 0, 2, '1', true]) {
      h.fresh()
      const before = h.getDb().serialize()
      const body = { ...h.intent(1, 1, 'cutover-key', route.endsWith('bulk')), transfer_provenance_version: marker }
      const result = await h.request(app, route, body)
      assert.equal(result.status, 409, JSON.stringify(result))
      assert.equal(result.body.code, 'client_upgrade_required')
      assert.deepEqual(h.getDb().serialize(), before, 'rejected old client must have no stock/receipt/audit or any other DB effects')
    }
  }
  const db = new Database(':memory:')
  const dir = path.join(__dirname, '../migrations')
  for (const file of fs.readdirSync(dir).filter(file => file.endsWith('.sql') && file < '0152').sort()) db.exec(fs.readFileSync(path.join(dir,file),'utf8'))
  const insert = key => db.prepare("INSERT INTO transfer_operation_receipts(actor_id,request_id,request_digest,request_json) VALUES(7,?,'digest','{}')").run(key)
  insert('legacy-before-cutover')
  db.exec("INSERT INTO action_history(scope,entity,label,reversible,status,undo_payload,redo_payload) VALUES('inventory','stock_transfer','Gap legacy',1,'undoable','{}','{}'),('inventory','other','Transfer',1,'undoable','{}','{}')")
  db.exec("INSERT INTO action_history(id,scope,entity,label,reversible,status,undo_payload,redo_payload) VALUES(900,'inventory','stock_transfer','Exact receipt',1,'undoable','{}','{}'); INSERT INTO transfer_operation_receipts(actor_id,request_id,request_digest,request_json,provenance_version,action_history_id) VALUES(7,'existing-v1','digest','{}',1,900)")
  const legacy = db.prepare('SELECT * FROM transfer_operation_receipts').all()
  const migration = fs.readFileSync(path.join(dir,'0152_transfer_provenance_enforcement.sql'),'utf8')
  assert(!migration.includes('\r'), '0152 must be LF-only')
  db.exec(migration)
  assert.deepEqual(db.prepare('SELECT * FROM transfer_operation_receipts').all(),legacy)
  assert.equal(db.prepare("SELECT reversible FROM action_history WHERE entity='stock_transfer' AND id<>900").get().reversible,0)
  assert.equal(db.prepare('SELECT reversible FROM action_history WHERE id=900').get().reversible,1,'exact v1 receipt retains replay')
  assert.equal(db.prepare("SELECT reversible FROM action_history WHERE entity='other'").get().reversible,1,'labels cannot identify legacy transfer provenance')
  assert.throws(() => insert('old-worker'), /provenance version 1 required/)
  db.exec("INSERT INTO branches(id,name) VALUES(1,'Shop'); INSERT INTO products(id,name,stock_quantity) VALUES(1,'Tea',10); INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,10)")
  assert.throws(() => db.transaction(() => {
    db.exec('UPDATE branch_stock SET quantity=8 WHERE product_id=1 AND branch_id=1')
    insert('old-worker-atomic-batch')
  })(), /provenance version 1 required/)
  assert.equal(db.prepare('SELECT quantity FROM branch_stock').get().quantity,10,'old Worker atomic batch rolls back stock even if the receipt insert follows it')
  for (const value of ['{}','{"mode":"restore"}','{"mode":"restore","token":" "}','{"mode":"restore","token":1}','not-json','{"mode":"restore","token":"deployment-token","backupKey":"deployment:transfer-provenance-v1"}']) {
    db.prepare("INSERT OR REPLACE INTO system_flags(key,value) VALUES('maintenance',?)").run(value)
    assert.throws(() => insert('invalid-restore'), /provenance version 1 required/)
  }
  db.exec("DELETE FROM system_flags WHERE key='maintenance'")
  db.exec("INSERT INTO transfer_operation_receipts(actor_id,request_id,request_digest,request_json,status,provenance_version) VALUES(7,'new-worker','digest','{}','planning',1)")
  db.exec("INSERT INTO system_flags(key,value) VALUES('maintenance','{\"mode\":\"restore\",\"token\":\"restore-test-token\"}')")
  insert('restored-legacy')
  db.exec("DELETE FROM transfer_operation_receipts WHERE request_id='restored-legacy'; DELETE FROM system_flags WHERE key='maintenance'")
  assert.throws(() => insert('old-worker-after-restore'), /provenance version 1 required/)
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok')
  console.log('PASS 18 real route rejection scenarios preserve exact database; 0152 fresh/legacy upgrade, default-0 block, v1 planning, tokened restore, history gap, LF and integrity checks')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
