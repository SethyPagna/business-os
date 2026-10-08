const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const helper=path.join(__dirname,'test-branch-transfer-request-budget-epoch-native.cjs')
let source=fs.readFileSync(helper,'utf8').split('const zero=')[0]
source=source.replaceAll('0, 100, 1','0, 10000, 1').replaceAll('VALUES(1, 1, 100)','VALUES(1, 1, 10000)').replaceAll('VALUES(?,1,?,100,200)','VALUES(?,1,?,10000,200)').replaceAll('lots === 1 ? 100 : 1','lots === 1 ? 10000 : 1')
source=source.replace('export { ensureCoreDataInvariants }',"export {classifyInventory} from './src/lib/importEngine.ts';export {getDb} from './src/lib/db.ts';export { ensureCoreDataInvariants }").replace('return {...f,call,','return {worker,...f,call,')
const {bundleWorker,world}=new Function('require','__dirname','module',source+';return {bundleWorker,world}')(require,__dirname,module)
async function scenario(make,{tier,n,inline=false,fault,staleAuth=false}) {
  const f=await world(make,tier,{staleAuth}),cap=tier==='free'?50:1000,id=`generic-${tier}-${n}-${inline}-${fault||'normal'}-${staleAuth}`
  f.env.ASSETS={list:async()=>({objects:[],truncated:false})}
  const pending=[];if(!inline)f.env.IMPORT_QUEUE={send:async body=>pending.push({body,attempts:1})}
  f.sql.prepare("INSERT INTO import_jobs(id,type,status,policy_json,materialize_done)VALUES(?,'inventory','awaiting_review',?,1)").run(id,JSON.stringify({inventory_action:'remove'}))
  const rows=Array.from({length:n},(_,i)=>({_rowNumber:i+2,barcode:'SER-1',name:'Serum',quantity:'1',branch:'Shop'}))
  for(let i=0;i<n;i++)f.sql.prepare('INSERT INTO import_job_source_rows(job_id,sequence,row_number,data_json)VALUES(?,?,?,?)').run(id,i,i+2,JSON.stringify(rows[i]))
  const analyzed=await f.worker.classifyInventory(f.worker.getDb(f.env),rows,'remove',{})
  assert.ok(analyzed.every(x=>x.action==='create'||x.action==='update'))
  for(const x of analyzed)f.sql.prepare("INSERT INTO import_job_rows(job_id,phase,row_number,action,identifier,result_json)VALUES(?,'analyze',?,?,?,?)").run(id,x.rowNumber,x.action,x.identifier,JSON.stringify(x))
  let count=0,sqls=[],faulted=false,phase='',stockAttempts=0
  const raw=f.env.DB
  const wrap=p=>new Proxy(p,{get(t,k){if(k==='bind')return(...x)=>wrap(t.bind(...x));if(['all','first','run'].includes(k))return(...x)=>{count++;sqls.push(t.text);return t[k](...x)};return t[k]}})
  f.env.DB=new Proxy(raw,{get(t,k){if(k==='prepare')return x=>wrap(t.prepare(x));if(k==='batch')return ss=>{count+=ss.length;sqls.push(...ss.map(x=>x.text));if(ss.some(x=>x.text.includes("VALUES ('stock_transaction_permit'"))){stockAttempts++;if(!faulted&&fault){faulted=true;if(fault==='cpu')throw Error('D1_ERROR: CPU time limit');return Promise.resolve(t.batch(ss)).then(()=>{throw Error('synthetic lost acknowledgement')})}}return t.batch(ss)};return t[k]}})
  const tasks=[],ctx={waitUntil:p=>tasks.push(p),passThroughOnException(){}}
  const job=()=>f.sql.prepare('SELECT status,phase,processed_rows,failed_rows,chunk_cursor,lease_token FROM import_jobs WHERE id=?').get(id)
  const report=()=>{const x={tier,n,inline,fault,staleAuth,phase,count,stockAttempts,job:job()};console.log(JSON.stringify(x));assert.ok(count<=cap,`whole ${phase} invocation ${count}>${cap}`);assert.equal(f.sql.prepare("SELECT COUNT(*)n FROM system_flags WHERE key='stock_transaction_permit'").get().n,0);assert.equal(job().lease_token,null)}
  async function http(action){count=0;sqls=[];phase=action;const r=await f.worker.default.fetch(new Request(`https://admin.business.test/api/import-jobs/${id}/${action}`,{method:'POST',headers:{cookie:'bos_session=branch-auth-cookie',origin:'https://admin.business.test','content-type':'application/json'},body:'{}'}),f.env,ctx);while(tasks.length)await Promise.all(tasks.splice(0));report();assert.equal(r.status,200,await r.text())}
  await http('approve')
  for(let delivery=0;!['completed','completed_with_errors'].includes(job().status);delivery++){
    assert.ok(delivery<1000,'a valid import must make progress')
    if(inline){assert.equal(job().status,'approved');await http('retry')}
    else {const message=pending.shift();assert.ok(message,'continuation/redelivery exists');count=0;sqls=[];phase='queue-'+delivery;await f.worker.default.queue({queue:'business-os-import',messages:[{...message,timestamp:new Date(),ack(){},retry(){pending.push({...message,attempts:message.attempts+1})}}]},f.env);report()}
  }
  assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity,10000-n)
  assert.equal(f.sql.prepare('SELECT COUNT(*)n FROM inventory_movements').get().n,n)
  assert.equal(f.sql.prepare('SELECT COUNT(*)n FROM import_stock_action_guards WHERE job_id=?').get(id).n,n)
  assert.equal(job().processed_rows,n)
}
async function main(){const saved=globalThis.fetch;globalThis.fetch=async()=>new Response('{"ok":true}');try{const make=await bundleWorker();for(const x of [{tier:'free',n:1},{tier:'free',n:10},{tier:'paid',n:260},{tier:'free',n:10,fault:'cpu'},{tier:'free',n:10,fault:'ack'},{tier:'free',n:10,inline:true},{tier:'paid',n:260,inline:true},{tier:'free',n:151,inline:true},{tier:'free',n:1,inline:true,staleAuth:true}])await scenario(make,x);console.log('generic actual invocation proof PASS')}finally{globalThis.fetch=saved}}
main().catch(e=>{console.error(e);process.exitCode=1})
