const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const wt=process.env.COUNTED_RETURN_WORKTREE||path.resolve(__dirname,'../..');
process.env.REVIEW_OUT ||= fs.mkdtempSync(path.join(require('node:os').tmpdir(),'counted-return-native-'));
global.caches={default:{match:async()=>undefined,put:async()=>{},delete:async()=>false}};
const file=path.join(wt,'cloudflare/scripts/test-counted-option-consumers.cjs');
let source=fs.readFileSync(file,'utf8');
source=source.replace("Promise.resolve().then(schemaControls).then(main).then(routeControls)","Promise.resolve().then(routeControls)");
source=source.replace('for(const different of [false,true])','for(const different of [false])');
const start=source.indexOf(' const saleBody='),end=source.indexOf(' }finally{f.sql.close()}}',start);
source=source.slice(0,start)+String.raw`
 const saleBody={offline_owner:{version:1,actor_id:7,organization_id:null,authority:'https://admin.business.test',runtime:'cloudflare-workers'},branch_id:1,money_precision_version:1,items:[{product_id:1,branch_id:1,damaged_lot_id:1,quantity:1,applied_price_usd:9.5,client_line_key:'review-tag',pricing_source:'selling',pricing_quote:{gross_usd:9.5,product_discount_usd:0,manual_discount_usd:0,total_usd:9.5,total_khr:38000}}],exchange_rate:4000,payment_method:'Cash',payment_currency:'USD',amount_paid_usd:9.5,client_request_id:'review-sale-'+tier+'-'+batch};
 const created=await call(saleBody,'/api/sales');assert.equal(created.status,200);const saleId=created.json.id;
 const si=f.sql.prepare('SELECT * FROM sale_items WHERE sale_id=?').get(saleId);
 assert.deepEqual(state(f),[9,2]);
 const before=JSON.stringify(f.sql.prepare('SELECT * FROM sale_items WHERE sale_id=?').all(saleId));
 for(const malformed of [{damaged_lot_id:2},{damaged_lot_id:1,batch_id:1},{damaged_lot_id:1,unlotted_stock:true},{damaged_lot_id:1.5}]){
  const body={money_precision_version:1,client_request_id:'review-invalid-'+JSON.stringify(malformed),expected_exchange_rate:4000,items:[{...saleBody.items[0],...malformed}]};
  const r=await call(body,'/api/sales/'+saleId+'/items');assert([400,409].includes(r.status));assert.deepEqual(state(f),[9,2]);assert.equal(JSON.stringify(f.sql.prepare('SELECT * FROM sale_items WHERE sale_id=?').all(saleId)),before);
 }
 console.log('INDEPENDENT PASS invalid product identity, conflicting receipt/NULL and fractional tagged IDs refuse without mutation '+tier+' '+batch);
 const got=await call(null,'/api/sales?id='+saleId,'GET');assert.equal(got.status,200);const saleDto=got.json[0];
 fs.writeFileSync(path.join(process.env.REVIEW_OUT,'sale-dto-'+tier+'-'+batch+'.json'),JSON.stringify(saleDto,null,2));
 await stock.executeStockTransaction(load('lib/db.ts').getDb(f.env),[{sql:"UPDATE damaged_stock_lots SET condition_tag='opened' WHERE id=1",params:{}}],'once');
 const afterTag=await call(null,'/api/sales?id='+saleId,'GET');assert.deepEqual(afterTag.json[0].items[0].condition_snapshot,{version:1,lot_id:1,product_id:1,branch_id:1,batch_id:batch?1:null,condition_tag:'damaged'});assert.equal(f.sql.prepare('SELECT condition_tag FROM counted_sale_item_conditions WHERE sale_item_id=?').get(si.id).condition_tag,'damaged');console.log('PASS actual sales GET immutable condition/receipt provenance');
 const quote=await call({sale_id:saleId,items:[{sale_item_id:si.id,quantity:1}]},'/api/returns/quote');assert.equal(quote.status,200);
 delete quote.json.customer_return_create_version;delete quote.json.customer_return_edit_version;
 const wholePayload=(override)=>{const name=fs.readdirSync(process.env.REVIEW_OUT).find(name=>name.startsWith('whole-payload-')&&name.endsWith('-'+batch+'-'+override+'.json'));return name?JSON.parse(fs.readFileSync(path.join(process.env.REVIEW_OUT,name),'utf8')).items[0]:null};
 const mountedDefault=wholePayload(false),mountedOrdinary=wholePayload(true);
 const returnBody={sale_id:saleId,branch_id:1,reason:'independent UI default',money_precision_version:1,client_request_id:'review-return-'+tier+'-'+batch,expected_quote:quote.json,items:[{sale_item_id:si.id,product_id:1,quantity:1,stock_action:'restock',return_to_stock:true,branch_id:1}]};
 if(!batch){const bad=await call({...returnBody,client_request_id:'review-picked-lot',items:[{...returnBody.items[0],batch_id:1}]},'/api/returns');assert.equal(bad.status,400);assert.equal(bad.json.error,'return_condition_receipt_identity_conflict');assert.deepEqual(state(f),[9,2]);console.log('INDEPENDENT CONFIRMED NULL historical source rejects forced UI batch pick');}
 if(mountedDefault)returnBody.items=[mountedDefault];const result=await call(returnBody,'/api/returns');assert.equal(result.status,200);
 const returned=f.sql.prepare('SELECT stock_condition,stock_action FROM return_items WHERE return_id=?').get(result.json.id);
 assert.equal(returned.stock_condition,'damaged');assert.equal(returned.stock_action,'damaged');
 const savedReturn=f.sql.prepare('SELECT * FROM returns WHERE id=?').get(result.json.id);const cancelled=await call({client_request_id:'ui-cancel-'+tier+'-'+batch,field:'status',source:'completed',target:'cancelled',items:[{id:savedReturn.id,expected_status:savedReturn.status,expected_method:savedReturn.return_type,expected_updated_at:savedReturn.updated_at}]},'/api/returns/bulk');assert.equal(cancelled.status,200);
 const freshQuote=await call({sale_id:saleId,items:[{sale_item_id:si.id,quantity:1}]},'/api/returns/quote');delete freshQuote.json.customer_return_create_version;delete freshQuote.json.customer_return_edit_version;const ordinary=await call({...returnBody,expected_quote:freshQuote.json,client_request_id:'explicit-ordinary-'+tier+'-'+batch,items:[mountedOrdinary||{...returnBody.items[0],stock_condition:'ordinary'}]},'/api/returns');assert.equal(ordinary.status,200);assert.equal(f.sql.prepare('SELECT stock_condition FROM return_items WHERE return_id=?').get(ordinary.json.id).stock_condition,'ordinary');assert.deepEqual(state(f),[10,2]);if(mountedOrdinary)console.log('PASS actual whole-form captured payloads submitted to native backend '+tier+' '+batch);
 console.log('PASS actual return original default and explicit ordinary override with exact source '+tier+' '+batch);
`+source.slice(end);
const mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));mod._compile(source,file);
