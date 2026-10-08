const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const helper=path.join(__dirname,'test-branch-transfer-request-budget-epoch-native.cjs')
let source=fs.readFileSync(helper,'utf8').split('const zero=')[0]
source=source.replaceAll('0, 100, 1','0, 10000, 1').replaceAll('VALUES(1, 1, 100)','VALUES(1, 1, 10000)').replaceAll('VALUES(?,1,?,100,200)','VALUES(?,1,?,10000,200)').replaceAll('lots === 1 ? 100 : 1','lots === 1 ? 10000 : 1')
source=source.replace('export { ensureCoreDataInvariants }',"export {classifyProducts,classifySales,classifyInventory} from './src/lib/importEngine.ts';export {getDb} from './src/lib/db.ts';export { ensureCoreDataInvariants }").replace('return {...f,call,','return {worker,...f,call,')
source=source.replace('function fixture(lots = 1)', 'function fixture(lots = 1, seed)')
  .replace('  })\r\n}', '    seed?.(sql)\r\n  })\r\n}').replace('  })\n}', '    seed?.(sql)\n  })\n}')
  .replace('const f=fixture(options.lots || 1)', 'const f=fixture(options.lots || 1, options.seed)')
  .replace('return {worker,...f,call,', 'return {worker,...f,call,measured(){return {physical,metered}},')
source=source.replace('export {classifyProducts', "export {executeStockTransaction} from './src/lib/stockTransaction.ts';export {classifyProducts")
const {bundleWorker,world}=new Function('require','__dirname','module',source+';return {bundleWorker,world}')(require,__dirname,module)
async function scenario(make,{tier,n,inline=false,fault,staleAuth=false,type='inventory',inventoryAction='remove',cacheFailure=false,tailRetries=false,httpTailRetries=false,claimAck=false,cancel=false,files=false,materialize=false,wrongEpoch=false,saleStatus='completed',productMode='fill_blank'}) {
  const f=await world(make,tier,{staleAuth,cacheFailure,tailRetries}),cap=tier==='free'?50:1000,id=`generic-${tier}-${n}-${inline}-${fault||'normal'}-${staleAuth}`
  f.env.ASSETS={list:async()=>({objects:[],truncated:false}),delete:async()=>{}};if(files)f.sql.prepare("INSERT INTO import_job_files(job_id,kind,original_name,stored_path)VALUES(?,'csv','proof.csv',?)").run(id,'imports/'+id+'/incoming/proof.csv')
  const pending=[];if(!inline)f.env.IMPORT_QUEUE={send:async body=>pending.push({body,attempts:1})}
  f.sql.prepare("INSERT INTO import_jobs(id,type,status,policy_json,materialize_done)VALUES(?,?,'awaiting_review',?,1)").run(id,type,JSON.stringify(type==='inventory'?{inventory_action:inventoryAction}:{import_mode:productMode}))
  const rows=Array.from({length:n},(_,i)=>({_rowNumber:i+2,barcode:'SER-1',name:'Serum',quantity:'1',branch:'Shop',unit_cost_usd:'2',date:'2026-09-05',description:'import proof',receipt_number:'receipt-'+i,sale_date:'2026-09-05 12:00',sale_status:saleStatus}))
  for(let i=0;i<n;i++)f.sql.prepare('INSERT INTO import_job_source_rows(job_id,sequence,row_number,data_json)VALUES(?,?,?,?)').run(id,i,i+2,JSON.stringify(rows[i]))
  const analyzed=type==='inventory'?await f.worker.classifyInventory(f.worker.getDb(f.env),rows,inventoryAction,{}):type==='products'?await f.worker.classifyProducts(f.worker.getDb(f.env),rows,id,JSON.stringify({import_mode:productMode})):await f.worker.classifySales(f.worker.getDb(f.env),rows,{})
  assert.ok(analyzed.every(x=>x.action==='create'||x.action==='update'))
  for(const x of analyzed)f.sql.prepare("INSERT INTO import_job_rows(job_id,phase,row_number,action,identifier,result_json)VALUES(?,'analyze',?,?,?,?)").run(id,x.rowNumber,x.action,x.identifier,JSON.stringify(x))
  let count=0,sqls=[],faulted=false,phase='',stockAttempts=0,afterStock=false,tailFaults=new Set(),claimFaulted=false
  const raw=f.env.DB
  const wrap=p=>new Proxy(p,{get(t,k){if(k==='bind')return(...x)=>wrap(t.bind(...x));if(['all','first','run'].includes(k))return(...x)=>{count++;sqls.push(t.text);const tail=t.text.includes('SELECT * FROM import_jobs')?'read':t.text.includes('INSERT INTO audit_logs')?'audit':null;if(httpTailRetries&&afterStock&&tail&&!tailFaults.has(tail)){tailFaults.add(tail);throw Error('D1_ERROR: internal error')}return t[k](...x)};return t[k]}})
  f.env.DB=new Proxy(raw,{get(t,k){if(k==='prepare')return x=>wrap(t.prepare(x));if(k==='batch')return ss=>{count+=ss.length;sqls.push(...ss.map(x=>x.text));if(httpTailRetries&&afterStock&&ss.some(x=>x.text.includes('INSERT INTO audit_logs'))&&!tailFaults.has('audit')){tailFaults.add('audit');throw Error('D1_ERROR: internal error')}if(ss.some(x=>x.text.includes("VALUES ('stock_transaction_permit'"))){stockAttempts++;afterStock=true;if(!faulted&&['cpu','ack','rollback','holder'].includes(fault)){faulted=true;if(fault==='holder'){f.sql.prepare('UPDATE import_jobs SET lease_token=? WHERE id=?').run('foreign-holder',id);return t.batch(ss)}if(fault==='rollback')throw Error('synthetic rollback before commit');if(fault==='cpu')throw Error('D1_ERROR: CPU time limit');return Promise.resolve(t.batch(ss)).then(()=>{throw Error('synthetic lost acknowledgement')})}}if(claimAck&&!claimFaulted&&ss.some(x=>x.text.includes('UPDATE import_jobs')&&x.text.includes('RETURNING status,cancel_requested'))){claimFaulted=true;return Promise.resolve(t.batch(ss)).then(()=>{throw Error('synthetic claim acknowledgement loss')})}if(!faulted&&fault==='persist'&&ss.some(x=>x.text.includes('INSERT OR REPLACE INTO import_job_rows(job_id,phase'))){faulted=true;throw Error('synthetic persistence failure')}if(!faulted&&fault==='lease'&&ss.some(x=>x.text.includes('SET lease_token = NULL'))){faulted=true;return Promise.resolve(t.batch(ss)).then(()=>{throw Error('synthetic release acknowledgement loss')})}return t.batch(ss)};return t[k]}})
  const tasks=[],ctx={waitUntil:p=>tasks.push(p),passThroughOnException(){}}
  const job=()=>f.sql.prepare('SELECT status,phase,processed_rows,failed_rows,chunk_cursor,lease_token FROM import_jobs WHERE id=?').get(id)
  const report=()=>{const x={tier,n,type,inventoryAction,inline,fault,staleAuth,cancel,files,cacheFailure,tailRetries,httpTailRetries,claimAck,phase,count,stockAttempts,materialize,wrongEpoch,saleStatus,job:job()};console.log(JSON.stringify(x));assert.ok(count<=cap,`whole ${phase} invocation ${count}>${cap}`);assert.equal(f.sql.prepare("SELECT COUNT(*)n FROM system_flags WHERE key='stock_transaction_permit'").get().n,0);assert.equal(job().lease_token,fault==='holder'&&faulted?'foreign-holder':null)}
  async function http(action){count=0;sqls=[];phase=action;afterStock=false;tailFaults.clear();const r=await f.worker.default.fetch(new Request(`https://admin.business.test/api/import-jobs/${id}/${action}`,{method:'POST',headers:{cookie:'bos_session=branch-auth-cookie',origin:'https://admin.business.test','content-type':'application/json'},body:'{}'}),f.env,ctx);while(tasks.length)await Promise.all(tasks.splice(0));if(httpTailRetries&&afterStock)assert.equal(tailFaults.size,2,'both real HTTP tails retried');report();assert.equal(r.status,200,await r.text())}
  if(materialize){f.sql.prepare('UPDATE import_jobs SET materialize_done=0 WHERE id=?').run(id);f.sql.prepare('DELETE FROM import_job_source_rows WHERE job_id=?').run(id);f.sql.prepare("INSERT INTO import_job_files(job_id,kind,original_name,stored_path)VALUES(?,'csv','proof.csv',?)").run(id,'imports/'+id+'/incoming/proof.csv');const data=Buffer.from(['barcode,name,quantity,branch,unit_cost_usd,date',...rows.map(()=> 'SER-1,Serum,1,Shop,2,2026-09-05')].join('\n'));f.env.ASSETS.get=async(key,options)=>{const offset=options?.range?.offset||0,range=data.subarray(offset,offset+(options?.range?.length||data.length));return {size:data.length,arrayBuffer:async()=>range.buffer.slice(range.byteOffset,range.byteOffset+range.byteLength)}}}
  assert.throws(()=>f.sql.exec('UPDATE products SET stock_quantity=stock_quantity+1 WHERE id=1'),/stock_transaction_required/)
  await http('approve');if(wrongEpoch)f.sql.prepare("UPDATE system_flags SET value='unrecognized-test-epoch' WHERE key='stock_schema_epoch'").run()
  for(let delivery=0;!['completed','completed_with_errors','cancelled'].includes(job().status);delivery++){
    assert.ok(delivery<(n===1?12:300),'a valid import must make progress')
    if(cancel&&job().chunk_cursor>0&&job().status!=='cancelling'){await http('cancel');cancel=false}
    if(inline){assert.equal(job().status,'approved');await http('retry')}
    else {const message=pending.shift();assert.ok(message,'continuation/redelivery exists');count=0;sqls=[];phase='queue-'+delivery;await f.worker.default.queue({queue:'business-os-import',messages:[{...message,timestamp:new Date(),ack(){},retry(){pending.push({...message,attempts:message.attempts+1})}}]},f.env);report();if(wrongEpoch||fault==='holder'&&faulted){assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity,10000);assert.notEqual(job().status,'failed');return}}
  }
  if(claimAck)assert.equal(claimFaulted,true,'lost claim ACK injected');const done=f.sql.prepare('SELECT COUNT(*)n FROM import_stock_action_guards WHERE job_id=?').get(id).n;const expected=job().status==='cancelled'?done:n;if(type==='inventory')assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity,10000+(inventoryAction==='add'?expected:-expected))
  if(type==='inventory')assert.equal(f.sql.prepare('SELECT COUNT(*)n FROM inventory_movements').get().n,expected)
  if(type==='inventory')assert.equal(f.sql.prepare('SELECT COUNT(*)n FROM import_stock_action_guards WHERE job_id=?').get(id).n,expected)
  assert.equal(job().processed_rows,expected);if(type==='products')assert.equal(f.sql.prepare('SELECT description FROM products WHERE id=1').get().description,'import proof');if(type==='sales'){assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity,10000+(saleStatus==='returned'?n:0));assert.equal(f.sql.prepare('SELECT COUNT(*)n FROM sales').get().n,n);assert.equal(f.sql.prepare('SELECT COUNT(*)n FROM sale_items').get().n,n);assert.equal(f.sql.prepare("SELECT COUNT(*)n FROM import_sales_commits WHERE status='applied'").get().n,n)}
}
async function main(){
  const saved=globalThis.fetch;globalThis.fetch=async()=>new Response('{"ok":true}')
  try{
    const make=await bundleWorker()
    const cases=[
      {tier:'free',n:1},{tier:'free',n:10},{tier:'paid',n:260},
      {tier:'free',n:10,fault:'cpu'},{tier:'free',n:10,fault:'ack'},
      {tier:'free',n:10,inline:true},{tier:'paid',n:260,inline:true},{tier:'free',n:151,inline:true},
      {tier:'free',n:1,inline:true,staleAuth:true},
      {tier:'free',n:10,fault:'persist'},{tier:'free',n:10,fault:'lease'},
      {tier:'free',n:10,cancel:true,files:true},{tier:'free',n:10,cacheFailure:true,tailRetries:true},
      {tier:'free',n:1,inventoryAction:'add'},{tier:'free',n:1,inventoryAction:'add',inline:true},
      {tier:'free',n:1,inventoryAction:'add',inline:true,fault:'ack'},
      {tier:'free',n:1,inventoryAction:'add',inline:true,fault:'ack',httpTailRetries:true},
      {tier:'free',n:10,inline:true,httpTailRetries:true},{tier:'paid',n:260,inline:true,httpTailRetries:true},
      {tier:'free',n:1,claimAck:true},{tier:'free',n:1,inline:true,claimAck:true},
      {tier:'free',n:1,type:'products'},{tier:'paid',n:1,type:'products'},{tier:'free',n:1,type:'products',inline:true},
      {tier:'free',n:1,type:'sales'},{tier:'paid',n:1,type:'sales'},{tier:'free',n:1,type:'sales',inline:true},
      {tier:'free',n:1,type:'sales',saleStatus:'returned'},{tier:'free',n:1,type:'sales',saleStatus:'returned',inline:true},
      {tier:'free',n:1,fault:'holder'},{tier:'free',n:1,fault:'rollback'},{tier:'paid',n:10,type:'sales',saleStatus:'returned',fault:'ack'},{tier:'free',n:1,wrongEpoch:true},{tier:'free',n:10,materialize:true},
      {tier:'free',n:10,inline:true,materialize:true},{tier:'paid',n:260,materialize:true},
    ]
    for(const x of cases)await scenario(make,x)
    console.log('generic actual invocation proof PASS '+cases.length+' scenarios')
  }finally{globalThis.fetch=saved}
}
module.exports={bundleWorker,world,scenario}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1})
