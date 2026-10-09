const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const assert = require('node:assert/strict'), { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..')
const original = path.join(__dirname, 'test-stock-session-atomic.cjs')
let source = fs.readFileSync(original, 'utf8').replaceAll('\r\n', '\n')
source = source.replace("&& !name.startsWith('0243_')", "&& !name.startsWith('0243_') && !name.startsWith('0246_')")
source = source.replace('    let result\n    try { result = sqliteD1Call', "    if(sql.prepare(statement.text).reader) return {results:sqliteD1Call(sql.prepare(statement.text),'all',statement.params),meta:{changes:0}}\n    let result\n    try { result = sqliteD1Call")
const shared = new Module(original, module); shared.filename = original; shared.paths = module.paths; shared._compile(source, original)
const conversion = fs.readFileSync(path.join(root, 'migrations/0246_counted_tagged_stock.sql'), 'utf8')
function world(batch = true, historical = false) {
  return shared.exports.fixture(sql => {
    sql.exec(`UPDATE products SET stock_quantity=7,selling_price_usd=9.5,selling_price_khr=38000 WHERE id=1;
      UPDATE branch_stock SET quantity=7 WHERE product_id=1 AND branch_id=1;
      INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,is_active,received_at) VALUES(1,1,'native-counted','NATIVE',1,'2026-09-01');
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,${batch ? 7 : 0});
      INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)
      VALUES(1,1,1,${batch ? 1 : 'NULL'},3,3,'damaged','remove',2);`)
    if(historical) sql.exec(`INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(2,1,1,1,1,0,'damaged','remove',2);
      INSERT INTO sales(id,receipt_number,branch_id,sale_status,exchange_rate,total_usd,amount_paid_usd)VALUES(50,'NATIVE-HISTORICAL-TAGGED',1,'completed',4000,9.5,9.5);
      INSERT INTO sale_items(id,sale_id,product_id,product_name,branch_id,damaged_lot_id,quantity,applied_price_usd,total_usd)VALUES(50,50,1,'Serum',1,2,1,9.5,9.5);`)
  })
}
function exclusive(f) {
  f.sql.exec(`INSERT INTO system_flags(key,value)VALUES('stock_transaction_permit','legacy-separate-pool-v1');INSERT INTO system_flags(key,value)VALUES('maintenance','{"mode":"counted_conversion","token":"counted-native-exclusive"}');DELETE FROM system_flags WHERE key='stock_transaction_permit'`)
}
function convert(f, tail = '') { f.sql.transaction(() => f.sql.exec(conversion + tail))() }
function state(f) {
  return [f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity,
    f.sql.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id=1').get().quantity_remaining]
}
const load = shared.exports.loadStockSession
const stock = load('lib/stockTransaction.ts'), batches = load('lib/productBatches.ts'), actions = load('lib/damagedLotActions.ts')
const db = f => load('lib/db.ts').getDb(f.env)
const change = { productId: 1, productName: 'Serum', branchId: 1, branchName: 'Shop', tag: 'damaged',
  takes: [{lotId:1,batchId:1,quantity:1,unitCostUsd:2}], reason:'native', fallbackUnitCostUsd:2,fallbackUnitCostKhr:0,actor:{userId:7,userName:'Admin'} }
async function main() {
  assert.equal(stock.STOCK_SCHEMA_EPOCH, 'counted-tagged-subset-v1')
  for (const batch of [true, false]) {
    const f = world(batch)
    try {
      await assert.rejects(stock.executeStockTransaction(db(f), batches.planBranchStockRemoval({productId:1,branchId:1,quantity:1}), 'once'))
      exclusive(f)
      assert.throws(() => convert(f, "SELECT json_extract('[1]','$[injected_final_failure]');"))
      assert.deepEqual(state(f), [7,3]);assert.equal(f.sql.prepare("SELECT value FROM system_flags WHERE key='stock_schema_epoch'").get().value,'legacy-separate-pool-v1')
      assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='counted_stock_conversion_lots'").get().n,0)
      console.log(JSON.stringify({phase:'before conversion',flags:f.sql.prepare('SELECT key,value FROM system_flags').all(),lots:f.sql.prepare('SELECT * FROM damaged_stock_lots').all(),batch:f.sql.prepare('SELECT id,is_active FROM product_batches').all(),products:f.sql.prepare('SELECT id,is_active FROM products').all()}))
      convert(f);assert.deepEqual(state(f),[10,3]);console.log('first conversion succeeded');convert(f);assert.deepEqual(state(f),[10,3])
      assert.equal(f.sql.prepare('SELECT credited_quantity FROM counted_stock_conversion_lots WHERE lot_id=1').get().credited_quantity,3)
      f.sql.exec("DELETE FROM system_flags WHERE key='maintenance'")
      await assert.rejects(stock.executeStockTransaction(db(f), batches.planRemoveStockAcrossBatches({productId:1,branchId:1,quantity:8,allocations:batch?[{batchId:1,quantity:8}]:[]}).statements,'once'))
      assert.deepEqual(state(f),[10,3])
      const allocated = batch ? [{batchId:1,quantity:7}] : []
      await stock.executeStockTransaction(db(f),batches.planRemoveStockAcrossBatches({productId:1,branchId:1,quantity:7,allocations:allocated}).statements,'once')
      assert.deepEqual(state(f),[3,3]);console.log('PASS conversion/repeat/final rollback/ordinary reservation '+(batch?'receipt':'true NULL'))
    } finally { f.sql.close() }
  }
  for (const invalid of ['owner', 'archived', 'missing-branch']) {
    const f=world(false)
    try {
      f.sql.transaction(()=>{
        f.sql.exec("INSERT INTO system_flags(key,value)VALUES('stock_transaction_permit','legacy-separate-pool-v1')")
        if(invalid==='owner') f.sql.exec("INSERT INTO products(id,name,is_active,stock_quantity)VALUES(2,'Other',1,0);UPDATE product_batches SET variant_product_id=2 WHERE id=1;UPDATE damaged_stock_lots SET batch_id=1 WHERE id=1")
        if(invalid==='archived') f.sql.exec('UPDATE product_batches SET is_active=0 WHERE id=1;UPDATE damaged_stock_lots SET batch_id=1 WHERE id=1')
        if(invalid==='missing-branch') f.sql.exec('UPDATE damaged_stock_lots SET branch_id=99 WHERE id=1')
        f.sql.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
      })()
      exclusive(f);assert.throws(()=>convert(f));assert.deepEqual(state(f),[7,3])
      assert.equal(f.sql.prepare("SELECT value FROM system_flags WHERE key='stock_schema_epoch'").get().value,'legacy-separate-pool-v1')
      console.log('PASS invalid conversion refuses '+invalid)
    } finally {f.sql.close()}
  }
  {
    const f=world()
    try {
      f.sql.transaction(()=>{f.sql.exec("INSERT INTO system_flags(key,value)VALUES('stock_transaction_permit','legacy-separate-pool-v1');UPDATE branch_batch_stock SET quantity=4 WHERE batch_id=1;UPDATE damaged_stock_lots SET quantity=2,quantity_remaining=2 WHERE id=1;INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)VALUES(2,1,1,NULL,1,1,'damaged','remove');DELETE FROM system_flags WHERE key='stock_transaction_permit'")})()
      exclusive(f);convert(f);f.sql.exec("DELETE FROM system_flags WHERE key='maintenance'")
      await assert.rejects(stock.executeStockTransaction(db(f),batches.planRemoveStockAcrossBatches({productId:1,branchId:1,quantity:6,allocations:[{batchId:1,quantity:6}]}).statements,'once'))
      await assert.rejects(stock.executeStockTransaction(db(f),batches.planRemoveStockAcrossBatches({productId:1,branchId:1,quantity:4,allocations:[]}).statements,'once'))
      await stock.executeStockTransaction(db(f),batches.planRemoveStockAcrossBatches({productId:1,branchId:1,quantity:7,allocations:[{batchId:1,quantity:4}]}).statements,'once')
      assert.equal(state(f)[0],3);assert.equal(f.sql.prepare('SELECT SUM(quantity_remaining) n FROM damaged_stock_lots').get().n,3)
      assert.throws(()=>f.sql.exec('UPDATE branch_stock SET quantity=0 WHERE product_id=1'))
      console.log('PASS mixed receipt and genuine NULL floors, unowned raw writer refusal')
    } finally {f.sql.close()}
  }
  const f=world();exclusive(f);convert(f);f.sql.exec("DELETE FROM system_flags WHERE key='maintenance'")
  try {
    await stock.executeStockTransaction(db(f),actions.planRestoreTagged(change),'once');assert.deepEqual(state(f),[10,2])
    const before=JSON.stringify(f.sql.prepare('SELECT * FROM inventory_movements').all())
    await assert.rejects(stock.executeStockTransaction(db(f),[...actions.planDisposeTagged(change),{sql:"SELECT json_extract('[1]','$[late_failure]')"}],'once'))
    assert.deepEqual(state(f),[10,2]);assert.equal(JSON.stringify(f.sql.prepare('SELECT * FROM inventory_movements').all()),before)
    await stock.executeStockTransaction(db(f),actions.planDisposeTagged(change),'once');assert.deepEqual(state(f),[9,1])
    assert.equal(f.sql.prepare("SELECT quantity FROM inventory_movements WHERE movement_type='condition_clear'").get().quantity,0)
    console.log('PASS actual condition action clear/dispose and final rollback')
  } finally { f.sql.close() }
  await actualSale('free')
  await actualSale('paid')
  await actualSale('paid', true)
}
async function actualSale(tier, historical = false) {
  const file=path.join(__dirname,'test-branch-transfer-request-budget-epoch-native.cjs')
  const native=fs.readFileSync(file,'utf8').split('async function main(){')[0]
  const mod=new Module(file,module);mod.filename=file;mod.paths=module.paths;mod._compile(native+'\nmodule.exports={bundleWorker}',file)
  const worker=(await mod.exports.bundleWorker())(),f=world(true,historical);exclusive(f);convert(f);f.sql.exec("DELETE FROM system_flags WHERE key='maintenance'")
  try {
    f.env.PLAN_TIER=tier;f.env.BUSINESS_OS_ADMIN_PASSWORD='synthetic-admin-password';f.env.PASSWORD_PEPPER='synthetic-native-pepper-at-least-32-characters'
    f.env.CACHE={get:async()=>null,put:async()=>{},delete:async()=>{}}
    f.env.BROADCAST_HUB={idFromName:name=>name,get:()=>({fetch:async()=>new Response('{}')})}
    await worker.ensureCoreDataInvariants(f.env)
    f.sql.exec("INSERT INTO users(id,username,name,password,role_id,permissions,is_active) SELECT 7,'admin','Admin','synthetic',id,'{\"all\":true}',1 FROM roles WHERE code='admin' LIMIT 1")
    const token='counted-native-session',now=Date.now()
    f.sql.prepare('INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at)VALUES(7,?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),new Date(now-3600000).toISOString(),new Date(now+86400000).toISOString(),new Date(now).toISOString())
    let physical=0,failNextSale=false
    const raw=f.env.DB
    const wrap=p=>new Proxy(p,{get(t,k){if(k==='bind')return(...xs)=>wrap(t.bind(...xs));if(['all','run','first'].includes(k))return(...xs)=>{physical++;return t[k](...xs)};return t[k]}})
    f.env.DB=new Proxy(raw,{get(t,k){if(k==='prepare')return sql=>wrap(t.prepare(sql));if(k==='batch')return ss=>{physical+=ss.length;if(failNextSale&&ss.some(s=>s.text.includes('UPDATE damaged_stock_lots'))){failNextSale=false;ss=[...ss.slice(0,-1),raw.prepare("SELECT json_extract('[1]','$[late_sale_failure]')")]}return t.batch(ss)};return t[k]}})
    const tasks=[],ctx={waitUntil(p){tasks.push(p)},passThroughOnException(){}}
    const call=async(url,method,body)=>{
      physical=0
      const response=await worker.default.fetch(new Request('https://admin.business.test'+url,{method,headers:{cookie:'bos_session='+token,'content-type':'application/json',origin:'https://admin.business.test'},body:JSON.stringify(body)}),f.env,ctx)
      while(tasks.length) await Promise.all(tasks.splice(0))
      const json=await response.json();console.log(JSON.stringify({tier,url,status:response.status,code:json.code,id:json.id,physical}));assert.ok(physical<=(tier==='free'?50:1000),'full native invocation including tails must fit plan');return {status:response.status,json}
    }
    if(historical) {
      assert.equal(f.sql.prepare('SELECT credited_quantity FROM counted_stock_conversion_lots WHERE lot_id=2').get().credited_quantity,0)
      assert.deepEqual(state(f),[10,3])
      const cancelled=await call('/api/sales/50/status','PATCH',{sale_status:'cancelled',cancel_reason:'buyer_refused',client_request_id:'counted-historical-cancel'})
      assert.equal(cancelled.status,200);assert.equal(state(f)[0],11);assert.equal(f.sql.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id=2').get().quantity_remaining,1)
      await call('/api/sales/50/status','PATCH',{sale_status:'cancelled',cancel_reason:'buyer_refused',client_request_id:'counted-historical-cancel'});assert.equal(state(f)[0],11)
      console.log('PASS actual historical depleted tagged cancellation with zero conversion credit, exact provenance and replay')
      return
    }
    await stock.executeStockTransaction(db(f),actions.planRestoreTagged(change),'once');assert.deepEqual(state(f),[10,2])
    const body={offline_owner:{version:1,actor_id:7,organization_id:null,authority:'https://admin.business.test',runtime:'cloudflare-workers'},branch_id:1,money_precision_version:1,items:[{product_id:1,branch_id:1,damaged_lot_id:1,quantity:1,applied_price_usd:9.5,client_line_key:'counted-line',pricing_source:'selling',pricing_quote:{gross_usd:9.5,product_discount_usd:0,manual_discount_usd:0,total_usd:9.5,total_khr:38000}}],exchange_rate:4000,payment_method:'Cash',payment_currency:'USD',amount_paid_usd:9.5,client_request_id:'counted-native-sale'}
    const created=await call('/api/sales','POST',body);assert.equal(created.status,200);assert.deepEqual(state(f),[9,1]);assert.deepEqual(created.json.sale.items[0].condition_snapshot,{version:1,lot_id:1,product_id:1,branch_id:1,batch_id:1,condition_tag:'damaged'})
    failNextSale=true
    const refused=await call('/api/sales','POST',{...body,client_request_id:'counted-native-rollback-sale'})
    assert.notEqual(refused.status,200);assert.deepEqual(state(f),[9,1]);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM sales').get().n,1)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM counted_sale_item_conditions').get().n,1);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n,0)
    console.log('PASS actual entire tagged sale rollback including header, condition attribution and permit')
    await call('/api/sales','POST',body);assert.deepEqual(state(f),[9,1])
    const id=f.sql.prepare("SELECT id FROM sales WHERE client_request_id='counted-native-sale'").get().id
    const cancelled=await call('/api/sales/'+id+'/status','PATCH',{sale_status:'cancelled',cancel_reason:'buyer_refused',client_request_id:'counted-native-cancel'});assert.equal(cancelled.status,200);assert.deepEqual(state(f),[10,2])
    await call('/api/sales/'+id+'/status','PATCH',{sale_status:'cancelled',cancel_reason:'buyer_refused',client_request_id:'counted-native-cancel'});assert.deepEqual(state(f),[10,2])
    assert.equal(f.sql.prepare('SELECT batch_id FROM counted_sale_item_conditions').get().batch_id,1)
    console.log('PASS actual bundled index tagged sale/cancel physical plus immutable subset provenance')
    const tagged=await call('/api/inventory/adjust','POST',{productId:1,branchId:1,batchId:1,type:'remove',quantity:1,conditionTag:'damaged',reason:'damaged',client_request_id:'counted-tagged-adjust-native'})
    assert.equal(tagged.status,200);assert.equal(state(f)[0],10);assert.equal(f.sql.prepare('SELECT SUM(quantity_remaining) n FROM damaged_stock_lots').get().n,3)
    const inventoryState=()=>({stock:state(f),tagged:f.sql.prepare('SELECT SUM(quantity_remaining) n FROM damaged_stock_lots').get().n,movements:f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n})
    for(const action of ['restore','dispose'])for(const field of ['productId','branchId']){
      const invalidIds=['1suffix','1.5',1.5,true,[1],{id:1},null,0,-1,'','1e0','0x1',9007199254740992]
      for(const [index,value] of invalidIds.entries()){
        const before=inventoryState()
        const invalid=await call('/api/inventory/tagged-lots/'+action,'POST',{productId:1,branchId:1,[field]:value,quantity:1,conditionTag:'damaged',reason:'invalid identity',client_request_id:`counted-invalid-${action}-${field}-${index}`})
        assert.equal(invalid.status,400,`${action} must refuse the entire raw ${field}: ${JSON.stringify(value)}`)
        assert.deepEqual(inventoryState(),before,'invalid identity cannot change physical stock, tagged stock or movements')
      }
    }
    console.log('PASS actual tagged clear/remove reject malformed product and branch identity without effects')
    const cleared=await call('/api/inventory/tagged-lots/restore','POST',{productId:' 1 ',branchId:'1',quantity:1,conditionTag:'damaged',reason:'cleared',client_request_id:'counted-cleared-adjust-native'})
    assert.equal(cleared.status,200);assert.equal(state(f)[0],10);assert.equal(f.sql.prepare('SELECT SUM(quantity_remaining) n FROM damaged_stock_lots').get().n,2)
    console.log('PASS actual inventory tag and clear are quantity-neutral')
    const retagged=await call('/api/inventory/adjust','POST',{productId:1,branchId:1,batchId:1,type:'remove',quantity:1,conditionTag:'damaged',reason:'damaged',client_request_id:'counted-retagged-adjust-native'})
    assert.equal(retagged.status,200)
    const ordinary=q=>({...body,client_request_id:'counted-ordinary-'+q,amount_paid_usd:q*9.5,items:[{...body.items[0],damaged_lot_id:null,batch_id:1,quantity:q,pricing_quote:{gross_usd:q*9.5,product_discount_usd:0,manual_discount_usd:0,total_usd:q*9.5,total_khr:q*38000}}]})
    const tooMany=await call('/api/sales','POST',ordinary(8));assert.notEqual(tooMany.status,200);assert.equal(state(f)[0],10)
    const admitted=await call('/api/sales','POST',ordinary(7));assert.equal(admitted.status,200);assert.equal(state(f)[0],3)
    assert.equal(f.sql.prepare('SELECT SUM(quantity_remaining) n FROM damaged_stock_lots').get().n,3)
    console.log('PASS actual index ordinary eight refusal/seven success preserves all tagged receipt units')
  } finally {f.sql.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
