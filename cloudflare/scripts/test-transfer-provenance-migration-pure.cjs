const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const Database=require('better-sqlite3')
const dir=path.join(__dirname,'../migrations')
const db=new Database(':memory:')
for(const name of fs.readdirSync(dir).filter(name=>name.endsWith('.sql') && name<'0151').sort()) db.exec(fs.readFileSync(path.join(dir,name),'utf8'))
db.exec(`INSERT INTO branches(id,name) VALUES(1,'Shop'),(2,'Warehouse');
 INSERT INTO products(id,name,stock_quantity) VALUES(1,'Legacy product',10);
 INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,10);
 INSERT INTO stock_transfers(product_id,quantity,client_request_id) VALUES(1,2,'legacy-key');
 INSERT INTO transfer_operation_receipts(actor_id,request_id,request_digest,request_json,response_json) VALUES(7,'legacy-key','digest','{}','{"success":true}');
 INSERT INTO action_history(scope,entity,label,reversible,status,undo_payload,redo_payload) VALUES('inventory','stock_transfer','Legacy transfer',1,'undoable','{}','{}')`)
const before=['products','branch_stock','branch_batch_stock','stock_transfers'].map(table=>db.prepare(`SELECT * FROM ${table}`).all())
const migration=fs.readFileSync(path.join(dir,'0151_transfer_provenance_replay.sql'),'utf8')
assert(!migration.includes('\r'),'migration must remain LF-only')
db.exec(migration)
assert.equal(db.prepare('SELECT provenance_version FROM transfer_operation_receipts').get().provenance_version,0)
assert.equal(db.prepare('SELECT COUNT(*) n FROM transfer_operation_members').get().n,0)
assert.equal(db.prepare('SELECT reversible FROM action_history').get().reversible,0)
for(const [index,table] of ['products','branch_stock','branch_batch_stock'].entries()) assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(),before[index])
const {receipt_id,member_ordinal,generation,...legacy}=db.prepare('SELECT * FROM stock_transfers').get()
assert.deepEqual(legacy,before[3][0]); assert.equal(receipt_id,null)
assert.throws(()=>db.exec("INSERT INTO stock_transfers(product_id,quantity,client_request_id) VALUES(1,2,'legacy-key')"),/UNIQUE/)
db.exec("INSERT INTO stock_transfers(product_id,quantity,client_request_id,receipt_id,member_ordinal,generation) VALUES(1,2,'legacy-key',2,0,0),(1,2,'legacy-key',3,0,0)")
assert.throws(()=>db.exec("INSERT INTO stock_transfers(product_id,quantity,receipt_id,member_ordinal,generation) VALUES(1,2,2,0,0)"),/UNIQUE/)
assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok')
assert.throws(()=>db.exec('DELETE FROM transfer_operation_receipts'),/immutable/)
console.log('PASS populated-0150 upgrade preserves balances and legacy rows, seals legacy reversal, keeps legacy key uniqueness and actor-operation member uniqueness; integrity and LF checks passed')
