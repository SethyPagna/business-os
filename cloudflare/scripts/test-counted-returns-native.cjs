const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const assert = require('node:assert/strict'), { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..')
const shared = { exports: require('./test-stock-session-atomic.cjs') }
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
  }, { legacyStock: true })
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
async function route(tier,batch=true,choice=null,legacy=false,race=false,group=false,identity=false,oldReceipt=false){
  const file=path.join(__dirname,'test-branch-transfer-request-budget-epoch-native.cjs')
  const native=fs.readFileSync(file,'utf8').split('async function main(){')[0]
  const mod=new Module(file,module);mod.filename=file;mod.paths=module.paths;mod._compile(native+'\nmodule.exports={bundleWorker}',file)
  const worker=(await mod.exports.bundleWorker())(),f=world(batch,oldReceipt);f.sql.exec("INSERT INTO system_flags(key,value)VALUES('stock_transaction_permit','legacy-separate-pool-v1');UPDATE damaged_stock_lots SET condition_tag='broken' WHERE id=1;DELETE FROM system_flags WHERE key='stock_transaction_permit'");if(legacy) f.sql.exec("INSERT INTO system_flags(key,value)VALUES('stock_transaction_permit','legacy-separate-pool-v1');UPDATE damaged_stock_lots SET quantity_remaining=1 WHERE id=1;INSERT INTO sales(id,receipt_number,branch_id,sale_status,exchange_rate,total_usd,amount_paid_usd)VALUES(50,'COUNTED-LEGACY-RETURN',1,'completed',4000,19,19);INSERT INTO sale_items(id,sale_id,product_id,product_name,branch_id,damaged_lot_id,quantity,applied_price_usd,applied_price_khr,total_usd,total_khr,cost_price_usd)VALUES(50,50,1,'Serum',1,1,2,9.5,38000,19,76000,2);DELETE FROM system_flags WHERE key='stock_transaction_permit'");exclusive(f);convert(f);f.sql.exec("DELETE FROM system_flags WHERE key='maintenance'")
  try {
    f.env.PLAN_TIER=tier;f.env.BUSINESS_OS_ADMIN_PASSWORD='synthetic-admin-password';f.env.PASSWORD_PEPPER='synthetic-native-pepper-at-least-32-characters'
    f.env.CACHE={get:async()=>null,put:async()=>{},delete:async()=>{}}
    f.env.BROADCAST_HUB={idFromName:name=>name,get:()=>({fetch:async()=>new Response('{}')})}
    await worker.ensureCoreDataInvariants(f.env)
    f.sql.exec("INSERT INTO users(id,username,name,password,role_id,permissions,is_active) SELECT 7,'admin','Admin','synthetic',id,'{\"all\":true}',1 FROM roles WHERE code='admin' LIMIT 1")
    const token='counted-native-session',now=Date.now()
    f.sql.prepare('INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at)VALUES(7,?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),new Date(now-3600000).toISOString(),new Date(now+86400000).toISOString(),new Date(now).toISOString())
    let physical=0,failNextReturn=false,loseNextReturn=false,failNextBulk=false,raceRequest=null,loseNextBulk=false
    const raw=f.env.DB
    const wrap=p=>new Proxy(p,{get(t,k){if(k==='bind')return(...xs)=>wrap(t.bind(...xs));if(['all','run','first'].includes(k))return(...xs)=>{physical++;return t[k](...xs)};return t[k]}})
    f.env.DB=new Proxy(raw,{get(t,k){if(k==='prepare')return sql=>wrap(t.prepare(sql));if(k==='batch')return ss=>{physical+=ss.length;if(failNextReturn&&ss.some(s=>s.text.includes('INSERT INTO return_items'))){failNextReturn=false;ss=[...ss.slice(0,-1),raw.prepare("SELECT json_extract('[1]','$[late_return_failure]')")]}if(failNextBulk&&ss.some(s=>s.text.includes('INSERT INTO return_bulk_operations'))){failNextBulk=false;ss=[...ss.slice(0,-1),raw.prepare("SELECT json_extract('[1]','$[late_bulk_failure]')")]}if(loseNextReturn&&ss.some(s=>s.text.includes('INSERT INTO return_items'))){loseNextReturn=false;return Promise.resolve(t.batch(ss)).then(()=>{throw new Error('native committed unknown outcome')})}if(loseNextBulk&&ss.some(s=>s.text.includes('INSERT INTO return_bulk_operations'))){loseNextBulk=false;return Promise.resolve(t.batch(ss)).then(()=>{throw new Error('native grouped committed unknown outcome')})}if(raceRequest&&ss.some(s=>s.text.includes('INSERT INTO return_items'))){const competing=raceRequest;raceRequest=null;const before=physical;return call('/api/returns','POST',competing).then(result=>{assert.equal(result.status,200);physical=before;return t.batch(ss)})}return t.batch(ss)};return t[k]}})
    const receiptBefore=f.sql.prepare('SELECT received_quantity,received_cost_usd,received_at,supplier_id,payment_status FROM product_batches WHERE id=1').get()
    const tasks=[],ctx={waitUntil(p){tasks.push(p)},passThroughOnException(){}}
    const call=async(url,method,body)=>{
      physical=0
      const response=await worker.default.fetch(new Request('https://admin.business.test'+url,{method,headers:{cookie:'bos_session='+token,'content-type':'application/json',origin:'https://admin.business.test'},body:JSON.stringify(body)}),f.env,ctx)
      while(tasks.length) await Promise.all(tasks.splice(0))
      const json=await response.json();assert.deepEqual(f.sql.prepare('SELECT received_quantity,received_cost_usd,received_at,supplier_id,payment_status FROM product_batches WHERE id=1').get(),receiptBefore,'customer restock must not create supplier purchase attribution');console.log(JSON.stringify({tier,url,status:response.status,code:json.code,id:json.id,physical}));assert.ok(physical<=(tier==='free'?50:1000),'full native invocation including tails must fit plan');return {status:response.status,json}
    }


    if(oldReceipt==='depleted'){
      const request={sale_id:50,branch_id:1,reason:'depleted historical source return',items:[{sale_item_id:50,product_id:1,quantity:1}],client_request_id:'counted-depleted-historical-return'}
      const restored=await call('/api/returns','POST',request);assert.equal(restored.status,200);assert.deepEqual(state(f),[11,3]);assert.equal(f.sql.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id=2').get().quantity_remaining,0)
      const item=f.sql.prepare('SELECT * FROM return_items WHERE return_id=?').get(restored.json.id);assert.equal(item.stock_condition,'damaged');const lot=f.sql.prepare('SELECT * FROM damaged_stock_lots WHERE return_item_id=?').get(item.id);assert.equal(lot.batch_id,1);assert.equal(lot.quantity_remaining,1)
      await call('/api/returns','POST',request);assert.deepEqual(state(f),[11,3]);console.log('PASS depleted historical original immutable tagged sale attribution restores chosen D plus physical exactly once');return
    }
    if(oldReceipt){
      const rawBody={sale_id:50,branch_id:1,reason:'historical no restock',items:[{sale_item_id:50,product_id:1,quantity:1,stock_action:'none'}],client_request_id:'historical-raw-return-receipt'}
      const rawJson=JSON.stringify(load('lib/returnCreateAction.ts').canonicalReturnCreateIntent(rawBody)),digest=createHash('sha256').update(rawJson).digest('hex')
      const response={id:51,returnNumber:'NATIVE-OLD-RETURN',replacementSaleId:null,replacementReceiptNumber:null}
      await stock.executeStockTransaction(db(f),[
        {sql:"INSERT INTO returns(id,sale_id,branch_id,return_number,client_request_id,return_scope,status,total_refund_usd)VALUES(51,50,1,'NATIVE-OLD-RETURN','historical-raw-return-receipt','customer','completed',9.5)",params:{}},
        {sql:"INSERT INTO return_items(return_id,sale_item_id,product_id,branch_id,quantity,stock_action,return_to_stock)VALUES(51,50,1,1,1,'none',0)",params:{}},
        {sql:"INSERT INTO return_create_receipts(id,actor_id,return_id,sale_id,request_id,request_digest,request_json,response_json,occurred_at)VALUES('11111111-1111-4111-8111-111111111111',7,51,50,'historical-raw-return-receipt',@digest,@request,@response,@stamp)",params:{digest,request:rawJson,response:JSON.stringify(response),stamp:new Date().toISOString()}}
      ],'once')
      const recovered=await call('/api/returns','POST',rawBody);assert.equal(recovered.status,200);assert.deepEqual(recovered.json,response);assert.deepEqual(state(f),[10,3]);assert.equal(f.sql.prepare('SELECT COUNT(*)n FROM returns').get().n,1);console.log('PASS immutable original raw same-ID receipt recovers before new condition normalization with no resubmission');return
    }
    const total=()=>f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity
    const damaged=()=>f.sql.prepare('SELECT COALESCE(SUM(quantity_remaining),0)n FROM damaged_stock_lots').get().n
    const saleBody={offline_owner:{version:1,actor_id:7,organization_id:null,authority:'https://admin.business.test',runtime:'cloudflare-workers'},branch_id:1,money_precision_version:1,items:[{product_id:1,branch_id:1,damaged_lot_id:1,quantity:2,applied_price_usd:9.5,client_line_key:'counted-return-sale-line',pricing_source:'selling',pricing_quote:{gross_usd:19,product_discount_usd:0,manual_discount_usd:0,total_usd:19,total_khr:76000}}],exchange_rate:4000,payment_method:'Cash',payment_currency:'USD',amount_paid_usd:19,client_request_id:'counted-return-original-sale'}
    const sale=legacy?{status:200}:await call('/api/sales','POST',saleBody);assert.equal(sale.status,200);assert.equal(total(),8);assert.equal(damaged(),1)
    const si=f.sql.prepare('SELECT id,sale_id FROM sale_items ORDER BY id DESC LIMIT 1').get()
    const quoted=legacy?{status:200,json:{}}:await call('/api/returns/quote','POST',{sale_id:si.sale_id,items:[{sale_item_id:si.id,quantity:1}]});assert.equal(quoted.status,200)
    delete quoted.json.customer_return_create_version;delete quoted.json.customer_return_edit_version
    const request={sale_id:si.sale_id,branch_id:1,reason:'native return',money_precision_version:1,expected_quote:quoted.json.quote||quoted.json,items:[{sale_item_id:si.id,quantity:1}],client_request_id:'counted-return-default'}
    if(legacy){delete request.money_precision_version;delete request.expected_quote;request.items[0].product_id=1;request.items[0].applied_price_usd=9.5;request.items[0].applied_price_khr=38000}
    if(choice==='none') request.items[0].stock_action='none'
    else if(choice==='legacyDamaged') request.items[0].stock_action='damaged'
    else if(choice) request.items[0].stock_condition=choice
    const wrongOwner=await call('/api/returns','POST',{...request,client_request_id:'counted-return-wrong-owner',items:[{...request.items[0],product_id:99}]});assert.equal(wrongOwner.status,400);assert.equal(total(),8);assert.equal(damaged(),1)
    if(identity){await stock.executeStockTransaction(db(f),[{sql:"INSERT INTO branches(id,name,is_active)VALUES(2,'Synthetic wrong branch',1)",params:{}},{sql:'UPDATE sale_items SET branch_id=2 WHERE id=@id',params:{id:si.id}}],'once');const bad=await call('/api/returns','POST',request);assert.equal(bad.status,400);assert.equal(bad.json.error,'return_original_condition_unproven');assert.equal(total(),8);assert.equal(damaged(),1);assert.equal(f.sql.prepare('SELECT COUNT(*)n FROM returns').get().n,0);console.log('PASS exact immutable original source branch ownership refusal');return}
    const wrong=await call('/api/returns','POST',{...request,client_request_id:'counted-return-wrong-receipt',items:[{...request.items[0],batch_id:99}]});assert.equal(wrong.status,400);assert.equal(total(),8);assert.equal(damaged(),1)
    if(race){raceRequest={...request,client_request_id:'counted-concurrent-return'};const stale=await call('/api/returns','POST',request);assert.notEqual(stale.status,200);assert.equal(total(),9);assert.equal(damaged(),2);assert.equal(f.sql.prepare("SELECT COUNT(*)n FROM returns WHERE client_request_id='counted-return-default'").get().n,0);assert.equal(f.sql.prepare("SELECT COUNT(*)n FROM returns WHERE client_request_id='counted-concurrent-return'").get().n,1);console.log('PASS actual competing return receipt invalidates stale atomic plan without double physical or subset credit');return}
    failNextReturn=true
    const failed=await call('/api/returns','POST',request);assert.notEqual(failed.status,200);assert.equal(total(),8);assert.equal(damaged(),1);assert.equal(f.sql.prepare('SELECT COUNT(*)n FROM returns').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*)n FROM return_create_receipts').get().n,0)
    loseNextReturn=true
    const returned=await call('/api/returns','POST',request);console.log('RETURN',JSON.stringify(returned));assert.equal(returned.status,200)
    assert.equal(total(),choice==='none'?8:9);assert.equal(damaged(),choice==='ordinary'||choice==='none'?1:2)
    const ri=f.sql.prepare('SELECT * FROM return_items ORDER BY id DESC LIMIT 1').get();assert.equal(ri.stock_condition,choice==='none'?null:choice&&choice!=='legacyDamaged'?choice:'broken')
    const lot=f.sql.prepare('SELECT * FROM damaged_stock_lots WHERE return_item_id=?').get(ri.id);if(choice==='ordinary'||choice==='none') assert.equal(lot,undefined);else {assert.equal(lot.condition_tag,choice&&choice!=='legacyDamaged'?choice:'broken');assert.equal(lot.batch_id,batch?1:null)}
    await call('/api/returns','POST',request);assert.equal(total(),choice==='none'?8:9);assert.equal(damaged(),choice==='ordinary'||choice==='none'?1:2)


    console.log('PASS actual counted default broken condition, physical plus subset once, exact receipt and replay')
    const bulkBody=(source,target,key)=>{const r=f.sql.prepare('SELECT * FROM returns WHERE id=?').get(returned.json.id);return {client_request_id:key,field:'status',source,target,items:[{id:r.id,expected_status:r.status||'completed',expected_method:r.return_type,expected_updated_at:r.updated_at}]}}
    const cancel=bulkBody('completed','cancelled','counted-return-cancel')
    failNextBulk=true
    const bulkFailed=await call('/api/returns/bulk','POST',cancel);assert.notEqual(bulkFailed.status,200);assert.equal(total(),choice==='none'?8:9);assert.equal(damaged(),choice==='ordinary'||choice==='none'?1:2);assert.equal(f.sql.prepare('SELECT COUNT(*)n FROM return_bulk_operations').get().n,0)
    loseNextBulk=true
    const cancelled=await call('/api/returns/bulk','POST',cancel);console.log('CANCEL',JSON.stringify(cancelled));assert.equal(cancelled.status,200);assert.equal(total(),8);assert.equal(damaged(),1)
    await call('/api/returns/bulk','POST',cancel);assert.equal(total(),8);assert.equal(damaged(),1)
    const restored=await call('/api/returns/bulk','POST',bulkBody('cancelled','completed','counted-return-restore'));assert.equal(restored.status,200);assert.equal(total(),choice==='none'?8:9);assert.equal(damaged(),choice==='ordinary'||choice==='none'?1:2)
    console.log('PASS actual cancel/replay/restore preserves original chosen condition and physical receipt')
    if(group){
      const nextQuote=await call('/api/returns/quote','POST',{sale_id:si.sale_id,items:[{sale_item_id:si.id,quantity:1}]});delete nextQuote.json.customer_return_create_version;delete nextQuote.json.customer_return_edit_version
      const second=await call('/api/returns','POST',{...request,client_request_id:'counted-second-condition-return',expected_quote:nextQuote.json,items:[{sale_item_id:si.id,quantity:1,stock_condition:'opened'}]});assert.equal(second.status,200);assert.equal(total(),10);assert.equal(damaged(),3)
      const grouped={client_request_id:'counted-mixed-group-cancel',field:'status',source:'completed',target:'cancelled',items:f.sql.prepare('SELECT * FROM returns ORDER BY id').all().map(r=>({id:r.id,expected_status:r.status,expected_method:r.return_type,expected_updated_at:r.updated_at}))}
      failNextBulk=true;const failed=await call('/api/returns/bulk','POST',grouped);assert.notEqual(failed.status,200);assert.equal(total(),10);assert.equal(damaged(),3);assert.equal(f.sql.prepare("SELECT COUNT(*)n FROM returns WHERE status='completed'").get().n,2)
      const result=await call('/api/returns/bulk','POST',grouped);if(tier==='free'){assert.equal(result.status,400);assert.equal(result.json.code,'customer_return_over_plan_budget');assert.equal(total(),10);assert.equal(damaged(),3);assert.equal(f.sql.prepare("SELECT COUNT(*)n FROM returns WHERE status='completed'").get().n,2);assert.equal(f.sql.prepare("SELECT COUNT(*)n FROM return_bulk_operations WHERE request_id='counted-mixed-group-cancel'").get().n,0);console.log('PASS insufficient Free grouped capacity refuses before physical, tags, receipt or history writes');return}assert.equal(result.status,200);assert.equal(total(),8);assert.equal(damaged(),1);console.log('PASS actual mixed chosen condition grouped final rollback and exact compensation');return
    }
    const editRequest=(condition,key)=>{const r=f.sql.prepare('SELECT * FROM returns WHERE id=?').get(returned.json.id);return {client_request_id:key,expected_updated_at:r.updated_at,reason:'condition edit',items:[{sale_item_id:si.id,product_id:1,quantity:1,stock_condition:condition,applied_price_usd:9.5,applied_price_khr:38000}]}}
    if(!legacy) {
      const before=f.sql.prepare('SELECT COUNT(*)n FROM action_history').get().n
      const denied=await call('/api/returns/'+returned.json.id,'PATCH',editRequest('ordinary','counted-v1-edit-denied'));assert.equal(denied.status,409);assert.equal(denied.json.code,'customer_return_edit_v1_not_supported');assert.equal(total(),choice==='none'?8:9);assert.equal(damaged(),choice==='ordinary'||choice==='none'?1:2);assert.equal(f.sql.prepare('SELECT COUNT(*)n FROM action_history').get().n,before)
    } else {
      const edit=editRequest('ordinary','counted-legacy-condition-edit')
      failNextReturn=true
      const editFailed=await call('/api/returns/'+returned.json.id,'PATCH',edit);assert.notEqual(editFailed.status,200);assert.equal(total(),9);assert.equal(damaged(),2);assert.equal(f.sql.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id=?').get(lot.id).quantity_remaining,1)
      const edited=await call('/api/returns/'+returned.json.id,'PATCH',edit);console.log('EDIT',JSON.stringify(edited));assert.equal(edited.status,200);assert.equal(total(),9);assert.equal(damaged(),1)
      await call('/api/returns/'+returned.json.id,'PATCH',edit);assert.equal(total(),9);assert.equal(damaged(),1)
      assert.equal(f.sql.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id=?').get(lot.id).quantity_remaining,0)
      const tagged=await call('/api/returns/'+returned.json.id,'PATCH',editRequest('opened','counted-legacy-retag-edit'));assert.equal(tagged.status,200);assert.equal(total(),9);assert.equal(damaged(),2)
      console.log('PASS actual supported legacy edit preserves physical once, chosen conditions, receipts and depleted attribution history')
    }


  } finally {f.sql.close()}
}
async function main(){if(process.env.COUNTED_RETURNS_FOCUS==='depleted'){for(const tier of ['free','paid'])await route(tier,true,null,false,false,false,false,'depleted');return}if(process.env.COUNTED_RETURNS_FOCUS==='old-receipt'){for(const tier of ['free','paid'])await route(tier,true,null,false,false,false,false,true);return}if(process.env.COUNTED_RETURNS_FOCUS==='identity'){for(const tier of ['free','paid'])await route(tier,true,null,false,false,false,true);return}if(process.env.COUNTED_RETURNS_FOCUS==='group'){for(const tier of ['paid','free'])await route(tier,true,null,false,false,true);return}if(process.env.COUNTED_RETURNS_FOCUS==='race'){for(const tier of ['free','paid'])for(const legacy of [true,false])await route(tier,true,null,legacy,true);return}if(process.env.COUNTED_RETURNS_FOCUS==='paid-legacy'){for(const batch of [true,false])await route('paid',batch,null,true);return}for(const tier of ['free','paid']) for(const batch of [true,false]) for(const choice of [null,'ordinary','opened','none','legacyDamaged']) await route(tier,batch,choice);for(const tier of ['free','paid'])for(const batch of [true,false])await route(tier,batch,null,true)}
main().catch(error=>{console.error(error);process.exitCode=1})
