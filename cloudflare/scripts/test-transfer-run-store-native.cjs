// Actual workerd/local D1 execution of the real store AND retrying D1Compat.
// No remote config, credentials, persistent fixture files, or production writes.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib', file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace("from './permissions'", "from './permissions.js'")
const worker = `
import { D1Compat } from './db.js';
import { registerTransferRunStatements,sealTransferRunChunkStatements,commitTransferRunChunk,committedTransferRunChunk } from './store.js';
export default { async fetch(request,env) {
  const {mode,phase='first'} = await request.json();
  const db = new D1Compat(env.DB);
  const key = 'child-'+mode, runId = 'run-'+mode;
  const generation = await db.prepare("SELECT json_extract(value,'$.generation') generation FROM system_flags WHERE key='business_dataset_generation'").get();
  const owner = {actual:{actorId:7,organizationId:4},expected:{actorId:7,organizationId:4},datasetGeneration:generation.generation};
  const pos = {...owner,runId,revision:0,sequence:0};
  const intent = {requestId:key,requestJson:JSON.stringify({quantity:1,reason:mode}),digest:'a'.repeat(64)};
  if (phase==='first' || phase==='setup') {
    await db.batch(registerTransferRunStatements({...owner,runId,scope:'branches',requestId:'original-'+mode,requestJson:'{}',digest:'b'.repeat(64)}));
    await db.batch(sealTransferRunChunkStatements({...pos,...intent,cursorBefore:'{}',cursorAfter:'{"done":1}',final:true}));
    await env.DB.prepare('INSERT INTO native_stock(key,quantity,cost) VALUES(?,20,3.123456)').bind(mode).run();
  }
  if (phase==='setup') return Response.json({ready:true});
  const effects = [
    {sql:'UPDATE native_stock SET quantity=quantity-1 WHERE key=@mode',params:{mode}},
    {sql:"INSERT INTO action_history(scope,entity,entity_id,label,reversible,status) VALUES('branches','stock_transfer',@key,'native',1,'undoable')",params:{key}},
    {sql:"INSERT INTO transfer_operation_receipts(actor_id,request_id,request_digest,request_json,response_json,status,operation_id,provenance_version,action_history_id,replay_state,generation) VALUES(7,@key,@digest,@body,json_object('success',1),'committed',@key,1,last_insert_rowid(),'applied',0)",params:{key,digest:intent.digest,body:intent.requestJson}},
  ];
  const counts = {attempts:0,submitted:[],prepared:[]};
  const traced = {
    prepare(sql) { return env.DB.prepare(sql); },
    async batch(statements) {
      counts.attempts++; counts.prepared.push(statements.length);
      if (phase==='first' && ['transient','legacy'].includes(mode) && counts.attempts===1) throw new Error('network timeout injected before dispatch');
      const actual = mode==='rollback' && phase==='first' ? [...statements,env.DB.prepare('INSERT INTO branches(name) VALUES(NULL)')] : statements;
      counts.submitted.push(actual.length);
      const result = await env.DB.batch(actual);
      if (mode==='lostack' && phase==='first' && counts.attempts===1) throw new Error('network timeout injected after commit');
      return result;
    },
  };
  const tracked = new D1Compat(traced);
  let error = null;
  try {
    if (phase==='recover') { /* read-only subsequent-request reconciliation */ }
    else if (mode==='old' && phase==='first') await tracked.batch(effects);
    else if (mode==='legacy') await tracked.batch([{sql:'UPDATE native_stock SET quantity=quantity-1 WHERE key=@mode',params:{mode}}]);
    else await commitTransferRunChunk(tracked,pos,effects,mode==='budget' && phase==='first'?6:7);
  } catch(e) { error = e.message; }
  const receipt = await committedTransferRunChunk(db,{...owner,runId,sequence:0});
  const state = await env.DB.prepare('SELECT status,revision,next_sequence FROM transfer_runs WHERE id=?').bind(runId).first();
  const chunk = await env.DB.prepare('SELECT status,receipt_id FROM transfer_run_chunks WHERE run_id=?').bind(runId).first();
  const stock = await env.DB.prepare('SELECT quantity,cost FROM native_stock WHERE key=?').bind(mode).first();
  const history = await env.DB.prepare('SELECT COUNT(*) n FROM action_history WHERE entity_id=?').bind(key).first();
  return Response.json({mode,phase,error,counts,receipt,state,chunk,stock,history});
} };
`

async function main() {
  console.log('ENGINES', JSON.stringify({ node:process.version, workerd:require('workerd/package.json').version,
    miniflare:require('miniflare/package.json').version, wrangler:require('wrangler/package.json').version }))
  // Bootstrap the actual pre-0185 schema from its complete migration chain.
  // Exporting SQLite DDL avoids native execution of unrelated historical data
  // backfills. The proposed 0185 SQL itself is parsed/applied to actual D1 below.
  const sqlite = new Database(':memory:')
  const dir = path.join(__dirname, '../migrations')
  for (const file of fs.readdirSync(dir).filter(file=>file.endsWith('.sql')&&file<'0185_').sort()) sqlite.exec(fs.readFileSync(path.join(dir,file),'utf8'))
  const schema = sqlite.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT IN (SELECT name FROM pragma_table_list WHERE type='shadow') ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid").all()
  sqlite.close()
  const mf = new Miniflare({ modules:[
    {type:'ESModule',path:'entry.js',contents:worker},
    {type:'ESModule',path:'db.js',contents:compile('db.ts')},
    {type:'ESModule',path:'store.js',contents:compile('transferRunStore.ts')},
    {type:'ESModule',path:'permissions.js',contents:compile('permissions.ts')},
  ], compatibilityDate:'2026-08-01',d1Databases:['DB'],log:new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    for (let i=0;i<schema.length;i+=25) await db.batch(schema.slice(i,i+25).map(row=>db.prepare(row.sql)))
    const migration = fs.readFileSync(path.join(dir,'0185_transfer_runs.sql'),'utf8')
    await db.batch(split(migration).map(sql=>db.prepare(sql)))
    await db.batch(split(fs.readFileSync(path.join(dir,'0186_transfer_run_retirement.sql'),'utf8')).map(sql=>db.prepare(sql)))
    await db.prepare('CREATE TABLE native_stock(key TEXT PRIMARY KEY,quantity REAL,cost REAL)').run()
    async function fetchCase(mode,phase='first') {
      const response = await mf.dispatchFetch('http://native-transfer.test/',{method:'POST',body:JSON.stringify({mode,phase})})
      assert.equal(response.status,200,await response.clone().text())
      return response.json()
    }
    function check(result,committed) {
      assert.equal(result.state.status,committed?'completed':'active')
      assert.equal(result.state.next_sequence,committed?1:0)
      assert.equal(result.state.revision,committed?1:0)
      assert.equal(result.chunk.status,committed?'committed':'planned')
      assert.equal(result.stock.quantity,committed?19:20)
      assert.equal(result.stock.cost,3.123456)
      assert.equal(result.history.n,committed?1:0)
      assert.equal(!!result.receipt,committed)
      if (committed) {
        assert.ok(result.receipt.receipt_id)
      }
    }
    for (const mode of ['normal','rollback','lostack','transient','old','budget']) {
      const result = await fetchCase(mode)
      const committed = ['normal','lostack'].includes(mode)
      check(result,committed)
      assert.equal(result.counts.attempts,mode==='old'?2:mode==='budget'?0:1)
      if (mode==='normal') assert.equal(result.error,null)
      if (mode==='rollback') { assert.match(result.error,/NOT NULL|constraint/i); assert.deepEqual(result.counts.submitted,[8]) }
      if (mode==='lostack') {
        assert.match(result.error,/network timeout/)
        assert.deepEqual(result.counts.submitted,[7],'ambiguous acknowledgement must not resubmit envelope')
      }
      if (mode==='transient') { assert.match(result.error,/network timeout/); assert.deepEqual(result.counts.submitted,[]) }
      if (mode==='old') assert.match(result.error,/active intent/)
      if (mode==='budget') { assert.match(result.error,/budget/); assert.deepEqual(result.counts.submitted,[]) }
      // Independent HTTP invocation: same sealed identity, no in-invocation
      // recovery loop. A planned state is not proof an earlier request ended.
      const recovered = await fetchCase(mode,'recover')
      check(recovered,committed)
      assert.equal(recovered.counts.attempts,0)
      assert.deepEqual(recovered.receipt,result.receipt)
      const retried = await fetchCase(mode,'commit')
      check(retried,true)
      assert.equal(retried.counts.attempts,1)
      if (committed) { assert.match(retried.error,/NOT NULL|constraint/i); assert.deepEqual(retried.receipt,result.receipt) }
      else assert.equal(retried.error,null)
      const external = await db.prepare('SELECT receipt_id FROM transfer_run_chunks WHERE run_id=?').bind('run-'+mode).first()
      assert.equal(external.receipt_id,retried.receipt.receipt_id)
      console.log('PASS actual workerd D1',mode,'subsequent-request same-key recovery',JSON.stringify(result.counts))
    }
    await fetchCase('overlap','setup')
    const overlap = await Promise.all([fetchCase('overlap','commit'),fetchCase('overlap','commit')])
    overlap.forEach(result=>{check(result,true);assert.equal(result.counts.attempts,1)})
    assert.equal(overlap.filter(result=>result.error===null).length,1)
    assert.equal(overlap[0].receipt.receipt_id,overlap[1].receipt.receipt_id)
    console.log('PASS two overlapping HTTP commits: one effect, one receipt, one attempt each')
    const legacy = await fetchCase('legacy')
    assert.equal(legacy.error,null)
    assert.equal(legacy.counts.attempts,2,'existing batch still retries transient failure')
    assert.deepEqual(legacy.counts.submitted,[1])
    assert.equal(legacy.stock.quantity,19)
    console.log('PASS existing D1Compat.batch retries unchanged; shared named parameter binding works')
    console.log('BUDGET: new store submits at most N atomic statements once. Auth/planning/reads, their retries, registration/seal and notification overhead remain separate; this is not full Free capacity certification.')
  } finally { await mf.dispose() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
