const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const dir = path.join(__dirname, '../migrations')
const sql = fs.readFileSync(path.join(dir, '0153_received_date_saleability_repair.sql'), 'utf8')
// D1 migrations apply owns the entire file transaction, including its ledger.
const apply = db => db.transaction(() => db.exec(sql))()
const manifest = [
  [165,9,0,56007,46189,16786,40033,'14:48:57'],
  [238,0,0,51164,46194,16795,40058,'14:49:00'],
  [939,7,7,53519,46197,16801,40071,'14:49:02'],
  [955,2,2,53526,46196,16798,40061,'14:49:01'],
  [3924,5,5,54618,46195,16796,40059,'14:49:00'],
  [4115,16,1,54771,46192,16789,40044,'14:48:57'],
  [4259,82,26,54816,46193,16791,40053,'14:48:58'],
  [5067,5,1,55159,46191,16786,40035,'14:48:57'],
  [5196,8,2,56824,46190,16786,40034,'14:48:57'],
]
const base = new Database(':memory:')
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql') && f < '0153').sort()) base.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
const schema = base.serialize()
base.close()
const dbNew = () => new Database(schema)
const tables = ['products','branch_stock','product_batches','branch_batch_stock','sales','sale_items','returns','return_items','sale_item_batch_allocations','return_item_batch_allocations','inventory_movements','audit_logs']
const snapshot = db => Object.fromEntries(tables.map(t => [t,db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()]))
const insert = (db,table,row) => db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row))
function seeded() {
  const db = dbNew()
  db.exec("INSERT INTO branches(id,name) VALUES(1,'Warehouse'),(2,'Shop')")
  for (const [product,stock,shop,batch,movement,sale,item,time] of manifest) {
    insert(db,'products',{id:product,name:`Incident ${product}`,stock_quantity:stock,cost_price_usd:13,cost_price_khr:52000})
    insert(db,'branch_stock',{product_id:product,branch_id:2,quantity:shop})
    if (stock-shop) insert(db,'branch_stock',{product_id:product,branch_id:1,quantity:stock-shop})
    insert(db,'product_batches',{id:batch,variant_product_id:product,batch_key:`receipt-${batch}`,received_at:'2026-08-15',unit_cost_usd:13,received_quantity:100,received_cost_usd:1300})
    insert(db,'branch_batch_stock',{batch_id:batch,branch_id:2,quantity:shop+1})
    if (stock-shop) insert(db,'branch_batch_stock',{batch_id:batch,branch_id:1,quantity:stock-shop})
    if (!db.prepare('SELECT id FROM sales WHERE id=?').get(sale)) insert(db,'sales',{id:sale,branch_id:2,sale_status:'completed',stock_skipped:1,total_usd:99})
    insert(db,'sale_items',{id:item,sale_id:sale,product_id:product,branch_id:2,quantity:1,cost_price_usd:13,total_usd:19})
    insert(db,'inventory_movements',{id:movement,product_id:product,branch_id:2,movement_type:'sale',quantity:-1,reference_id:sale,reason:'Sale status changed from awaiting_payment to completed',created_at:`2026-09-03 ${time}`,unit_cost_usd:13,unit_cost_khr:52000,total_cost_usd:-13,total_cost_khr:-52000})
  }
  for (const [id,stock,active] of [[1244,5,1],[4758,27,1],[47155,28,0]]) insert(db,'products',{id,name:`Product ${id}`,stock_quantity:stock,is_active:active,cost_price_usd:id===1244?61:17.5})
  for (const [product,branch,quantity] of [[1244,1,4],[1244,2,1],[4758,1,10],[4758,2,17]]) insert(db,'branch_stock',{product_id:product,branch_id:branch,quantity})
  insert(db,'product_batches',{id:61020,variant_product_id:47155,batch_key:'09032026',lot_code:'09032026',expiry_date:'2029',received_at:'2026-09-03',is_active:1,synthetic:0,unit_cost_usd:17.5,received_quantity:28,received_cost_usd:490,received_branch_id:2,supplier_id:20,supplier_name:'j secrat',payment_status:'paid',batch_number:1,created_at:'2026-09-03 05:34:29',updated_at:'2026-09-03 05:34:29'})
  insert(db,'inventory_movements',{id:46182,product_id:4758,branch_id:2,movement_type:'add',quantity:28,batch_id:61020,reference_id:1788409077320,unit_cost_usd:17.5,total_cost_usd:490,created_at:'2026-09-03 05:34:29'})
  insert(db,'product_batches',{id:61029,variant_product_id:4758,batch_key:'existing-61029',received_at:'2026-09-03',batch_number:3,unit_cost_usd:17.5,received_quantity:20,received_cost_usd:350})
  insert(db,'product_batches',{id:61030,variant_product_id:1244,batch_key:'clarins-warehouse',received_at:'2026-08-01',batch_number:1,unit_cost_usd:61,received_quantity:4,received_cost_usd:244})
  for (const [id,batch,branch,quantity] of [[77792,61020,2,28],[77806,61029,1,10],[77995,61029,2,10],[77996,61030,1,4]]) insert(db,'branch_batch_stock',{id,batch_id:batch,branch_id:branch,quantity})
  for (const [id,stockSkipped] of [[16790,1],[16903,0],[16671,1]]) insert(db,'sales',{id,branch_id:2,sale_status:'completed',stock_skipped:stockSkipped,total_usd:100})
  insert(db,'sale_items',{id:39876,sale_id:16671,product_id:1244,branch_id:2,quantity:1,cost_price_usd:61,total_usd:80})
  for (const [id,sale,qty] of [[40261,16790,20],[40286,16903,1]]) insert(db,'sale_items',{id,sale_id:sale,product_id:4758,branch_id:2,quantity:qty,cost_price_usd:17.5,total_usd:qty*20})
  for (const [id,sale,qty,time] of [[46271,16790,-20,'04:38:38'],[46304,16903,-1,'09:50:28']]) insert(db,'inventory_movements',{id,product_id:4758,branch_id:2,movement_type:'sale',quantity:qty,reference_id:sale,created_at:`2026-09-05 ${time}`,unit_cost_usd:17.5,total_cost_usd:qty*17.5})
  insert(db,'returns',{id:1,return_number:'RET-20260903-140759',sale_id:16671,branch_id:2,status:'completed',created_at:'2026-09-03 07:08:00',updated_at:'2026-09-03 07:19:07'})
  insert(db,'return_items',{id:3,return_id:1,sale_item_id:39876,product_id:1244,quantity:1,return_to_stock:1,branch_id:2,applied_price_usd:80,cost_price_usd:61,stock_action:'restock'})
  for (const [id,qty,time,type] of [[46185,1,'07:08:00','return'],[46186,-1,'07:17:05','return_reversal'],[46187,1,'07:19:07','return']]) insert(db,'inventory_movements',{id,product_id:1244,branch_id:2,movement_type:type,quantity:qty,reference_id:1,created_at:`2026-09-03 ${time}`,unit_cost_usd:61})
  // Deleted 7091 is deliberately absent; an unrelated active product is untouched.
  insert(db,'products',{id:99999,name:'Unrelated',stock_quantity:3})
  insert(db,'branch_stock',{product_id:99999,branch_id:2,quantity:3})
  return db
}
if (require.main !== module) module.exports = { seeded, snapshot }
else {
let passed=0
function check(name,fn) { fn(); passed++; console.log(`PASS ${name}`) }
check('LF-only migration applies and reruns without data on fresh installation', () => {
  assert(!sql.includes('\r'))
  assert.doesNotMatch(sql, /CREATE\s+TRIGGER|\bRAISE\s*\(|\bCASE\b/)
  const db=dbNew(); const before=snapshot(db); apply(db); apply(db)
  assert.deepEqual(snapshot(db),before); db.close()
})
check('non-incident installation freezes no-op mode and leaves unrelated data unchanged', () => {
  const db=dbNew()
  db.exec("INSERT INTO products(id,name,stock_quantity) VALUES(900001,'Unrelated product',7); INSERT INTO branches(id,name) VALUES(900001,'Unrelated branch'); INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(900001,900001,7)")
  const before=snapshot(db)
  apply(db); apply(db)
  assert.deepEqual(snapshot(db),before)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE '_received_date_%_0153'").get().n,0)
  db.close()
})
check('exact incident repair restores nine units and connects all 11 active Shop products', () => {
  const db=seeded(); const before=snapshot(db); apply(db)
  for(const [product,stock,shop] of manifest) {
    assert.equal(db.prepare('SELECT stock_quantity q FROM products WHERE id=?').get(product).q,stock+1)
    assert.equal(db.prepare('SELECT quantity q FROM branch_stock WHERE product_id=? AND branch_id=2').get(product).q,shop+1)
  }
  assert.equal(db.prepare('SELECT stock_quantity q FROM products WHERE id=47155').get().q,0)
  assert.equal(db.prepare('SELECT variant_product_id p FROM product_batches WHERE id=61020').get().p,4758)
  assert.equal(db.prepare('SELECT quantity q FROM branch_batch_stock WHERE id=77792').get().q,7)
  assert.equal(db.prepare('SELECT stock_quantity q FROM products WHERE id=4758').get().q,27)
  assert.equal(db.prepare('SELECT stock_quantity q FROM products WHERE id=1244').get().q,5)
  const ids=[...manifest.map(r=>r[0]),1244,4758]
  for(const id of ids) {
    const branch=db.prepare('SELECT quantity q FROM branch_stock WHERE product_id=? AND branch_id=2').get(id).q
    const lots=db.prepare('SELECT SUM(b.quantity) q FROM branch_batch_stock b JOIN product_batches p ON p.id=b.batch_id WHERE p.variant_product_id=? AND p.is_active=1 AND b.branch_id=2 AND b.quantity>0 AND date(p.received_at) IS NOT NULL').get(id).q
    assert.equal(lots,branch,`product ${id} can select its entire available Shop quantity`)
  }
  const lot=db.prepare("SELECT * FROM product_batches WHERE batch_key='repair-0153-return-1-item-3'").get()
  assert.equal(lot.received_at,'2026-09-03'); assert.match(lot.notes,/Original supplier received date unknown/)
  assert.equal(lot.unit_cost_usd,61); assert.equal(lot.received_quantity,0); assert.equal(lot.received_cost_usd,0)
  assert.equal(db.prepare('SELECT batch_id FROM return_items WHERE id=3').get().batch_id,lot.id)
  assert.equal(db.prepare('SELECT batch_id FROM inventory_movements WHERE id=46187').get().batch_id,lot.id)
  assert.equal(db.prepare('SELECT SUM(quantity) q FROM return_item_batch_allocations WHERE return_item_id=3 AND reversed_at IS NULL').get().q,1)
  assert.deepEqual(db.prepare('SELECT sale_item_id,quantity,batch_id FROM sale_item_batch_allocations ORDER BY sale_item_id').all(),[{sale_item_id:40261,quantity:20,batch_id:61020},{sale_item_id:40286,quantity:1,batch_id:61020}])
  for(const id of [46271,46304]) assert.equal(db.prepare('SELECT batch_id FROM inventory_movements WHERE id=?').get(id).batch_id,61020)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE user_name='System repair 0153'").get().n,9)
  for(const t of ['sales','returns']) assert.deepEqual(db.prepare(`SELECT * FROM ${t} ORDER BY id`).all(),before[t],`${t} money and status unchanged`)
  for(const row of before.product_batches) {
    const after=db.prepare('SELECT * FROM product_batches WHERE id=?').get(row.id)
    const expected={...row}; if(row.id===61020) { expected.variant_product_id=4758; expected.batch_number=4 }
    assert.deepEqual(after,expected,'existing lot dates, cost, receipts and other metadata preserved')
  }
  assert.deepEqual(db.prepare('SELECT * FROM branch_stock WHERE branch_id=1 ORDER BY id').all(),before.branch_stock.filter(r=>r.branch_id===1))
  assert.equal(db.prepare('SELECT COUNT(*) n FROM products WHERE id=7091').get().n,0)
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok')
  const after=snapshot(db); apply(db); assert.deepEqual(snapshot(db),after,'retry changes nothing')
  db.close()
})
check('Clarins and Olay next ordinals ignore legacy text and never collide with numeric lots',()=>{
  const db=seeded()
  for(const product of [1244,4758]) {
    for(const [key,number] of [['legacy-text','RECON-20260903'],['integer',8],['real',9.5],['numeric-text','12']]) {
      insert(db,'product_batches',{variant_product_id:product,batch_key:key,batch_number:number,is_active:0})
    }
  }
  // INTEGER affinity stores well-formed numeric text numerically already.
  assert.equal(db.prepare("SELECT typeof(batch_number) t FROM product_batches WHERE variant_product_id=1244 AND batch_key='numeric-text'").get().t,'integer')
  const before=db.prepare('SELECT id,batch_number FROM product_batches ORDER BY id').all()
  apply(db)
  const repaired=db.prepare("SELECT id,variant_product_id,batch_number FROM product_batches WHERE id=61020 OR batch_key='repair-0153-return-1-item-3'").all()
  assert.equal(repaired.length,2)
  for(const row of repaired) {
    assert.equal(row.batch_number,13)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM product_batches WHERE variant_product_id=? AND batch_number=?').get(row.variant_product_id,row.batch_number).n,1)
  }
  for(const row of before.filter(row=>row.id!==61020)) assert.deepEqual(db.prepare('SELECT id,batch_number FROM product_batches WHERE id=?').get(row.id),row)
  db.close()
})
const staleCases=[
  ['stock changed',"UPDATE branch_stock SET quantity=1 WHERE product_id=165 AND branch_id=2"],
  ['dated lot changed',"UPDATE product_batches SET received_at=NULL WHERE id=56007"],
  ['duplicate movement changed',"UPDATE inventory_movements SET quantity=-2 WHERE id=46189"],
  ['historical item changed',"UPDATE sale_items SET quantity=2 WHERE id=40033"],
  ['sale cancelled',"UPDATE sales SET sale_status='cancelled' WHERE id=16786"],
  ['missing target',"DELETE FROM branch_stock WHERE product_id=238"],
  ['already partly reparented',"UPDATE product_batches SET variant_product_id=4758 WHERE id=61020"],
  ['Olay allocation already present',"INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity) VALUES(40261,61020,2,20)"],
  ['original receipt changed',"UPDATE inventory_movements SET quantity=27 WHERE id=46182"],
  ['legitimate live sale changed',"UPDATE inventory_movements SET quantity=-19 WHERE id=46271"],
  ['return reversed',"UPDATE returns SET status='cancelled' WHERE id=1"],
  ['return already linked',"UPDATE return_items SET batch_id=61030 WHERE id=3"],
  ['return allocation already present',"INSERT INTO return_item_batch_allocations(return_item_id,batch_id,branch_id,quantity) VALUES(3,61030,2,1)"],
  ['inactive sibling changed',"UPDATE products SET is_active=1 WHERE id=47155"],
  ['wrong Shop',"UPDATE branches SET name='Elsewhere' WHERE id=2"],
]
for(const [name,mutation] of staleCases) check(`stale ${name} aborts without business writes`,()=>{
  const db=seeded();db.exec(mutation);const before=snapshot(db)
  assert.throws(()=>apply(db),/0153:/);assert.deepEqual(snapshot(db),before);db.close()
})
check('an isolated partial signature never masquerades as fresh empty data',()=>{
  for(const mutation of ["INSERT INTO products(id,name) VALUES(165,'partial')","INSERT INTO sales(id) VALUES(16790)","INSERT INTO inventory_movements(id) VALUES(46189)","INSERT INTO returns(id) VALUES(1)"]) {
    const db=dbNew();db.exec(mutation);const before=snapshot(db)
    assert.throws(()=>apply(db),/0153:/);assert.deepEqual(snapshot(db),before);db.close()
  }
})
check('postcondition failure rolls back ALL writes including audit, lots and allocations',()=>{
  const db=seeded()
  db.exec("CREATE TRIGGER test_0153_corrupt AFTER INSERT ON sale_item_batch_allocations BEGIN UPDATE branch_stock SET quantity=quantity+1 WHERE product_id=1244 AND branch_id=1; END;")
  const before=snapshot(db);assert.throws(()=>apply(db),/0153:/);assert.deepEqual(snapshot(db),before);db.close()
})
check('a completion marker cannot hide partial repair or recovered quantities',()=>{
  for(const mutate of ["INSERT INTO audit_logs(action,entity_id) VALUES('received_date_saleability_repair','0153')",null]) {
    const db=seeded()
    if(mutate) db.exec(mutate)
    else { apply(db);db.exec('UPDATE branch_batch_stock SET quantity=8 WHERE id=77792') }
    const before=snapshot(db);assert.throws(()=>apply(db),/0153: completed/);assert.deepEqual(snapshot(db),before);db.close()
  }
})
check('audit snapshots support exact stock/lot/financial recovery during the write pause',()=>{
  const db=seeded();const before=snapshot(db);apply(db)
  const audit=db.prepare("SELECT * FROM audit_logs WHERE action='received_date_saleability_repair'").get()
  const old=JSON.parse(audit.old_value),added=JSON.parse(audit.new_value)
  db.transaction(()=>{
    for(const [table,ids] of [['inventory_movements',added.correction_movement_ids],['sale_item_batch_allocations',added.sale_allocation_ids],['return_item_batch_allocations',added.return_allocation_ids]]) for(const id of ids) db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id)
    db.prepare('DELETE FROM branch_batch_stock WHERE batch_id=?').run(added.return_batch_id)
    db.prepare('DELETE FROM product_batches WHERE id=?').run(added.return_batch_id)
    for(const [table,rows] of Object.entries(old)) for(const row of rows) {
      const fields=Object.keys(row).filter(k=>k!=='id')
      db.prepare(`UPDATE ${table} SET ${fields.map(f=>`${f}=?`).join(',')} WHERE id=?`).run(...fields.map(f=>row[f]),row.id)
    }
  })()
  const recovered=snapshot(db);delete recovered.audit_logs;delete before.audit_logs
  assert.deepEqual(recovered,before)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_logs WHERE id=?').get(audit.id).n,1,'recovery evidence retained')
  db.close()
})
console.log(`\n${passed} received-date repair scenarios passed`)
}
