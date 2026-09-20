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
}).outputText
const worker = `
import { D1Compat } from './db.js';
import { registerTransferRunStatements,sealTransferRunChunkStatements,commitTransferRunChunk,committedTransferRunChunk } from './store.js';
export default { async fetch(request,env) {
  const {mode} = await request.json();
  const db = new D1Compat(env.DB);
  const key = 'child-'+mode, runId = 'run-'+mode;
  const owner = {actual:{actorId:7,organizationId:4},expected:{actorId:7,organizationId:4}};
  const pos = {...owner,runId,revision:0,sequence:0};
  const intent = {requestId:key,requestJson:JSON.stringify({quantity:1,reason:mode}),digest:'a'.repeat(64)};
  await db.batch(registerTransferRunStatements({...owner,runId,scope:'branches',requestId:'original-'+mode,requestJson:'{}',digest:'b'.repeat(64)}));
  await db.batch(sealTransferRunChunkStatements({...pos,...intent,cursorBefore:'{}',cursorAfter:'{"done":1}',final:true}));
  await env.DB.prepare('INSERT INTO native_stock(key,quantity,cost) VALUES(?,20,3.123456)').bind(mode).run();
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
      if (mode==='transient' && counts.attempts===1) throw new Error('network timeout injected before dispatch');
      const actual = mode==='rollback' ? [...statements,env.DB.prepare('INSERT INTO branches(name) VALUES(NULL)')] : statements;
      counts.submitted.push(actual.length);
      const result = await env.DB.batch(actual);
      if (mode==='lostack' && counts.attempts===1) throw new Error('network timeout injected after commit');
      return result;
    },
  };
  const tracked = new D1Compat(traced);
  let error = null;
  try {
    if (mode==='old') await tracked.batch(effects);
    else await commitTransferRunChunk(tracked,pos,effects,7);
  } catch(e) { error = e.message; }
  const receipt = await committedTransferRunChunk(db,{...owner,runId,sequence:0});
  const state = await env.DB.prepare('SELECT status,revision,next_sequence FROM transfer_runs WHERE id=?').bind(runId).first();
  const chunk = await env.DB.prepare('SELECT status,receipt_id FROM transfer_run_chunks WHERE run_id=?').bind(runId).first();
  const stock = await env.DB.prepare('SELECT quantity,cost FROM native_stock WHERE key=?').bind(mode).first();
  const history = await env.DB.prepare('SELECT COUNT(*) n FROM action_history WHERE entity_id=?').bind(key).first();
  const beforeDuplicate = counts.attempts;
  let duplicateError = null;
  if (receipt) {
    try { await commitTransferRunChunk(tracked,pos,effects,7); } catch(e) { duplicateError=e.message; }
  }
  const afterStock = await env.DB.prepare('SELECT quantity FROM native_stock WHERE key=?').bind(mode).first();
  return Response.json({mode,error,counts,beforeDuplicate,duplicateError,receipt,state,chunk,stock,history,afterStock});
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
  ], compatibilityDate:'2026-08-01',d1Databases:['DB'],log:new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    for (let i=0;i<schema.length;i+=25) await db.batch(schema.slice(i,i+25).map(row=>db.prepare(row.sql)))
    const migration = fs.readFileSync(path.join(dir,'0185_transfer_runs.sql'),'utf8')
    await db.batch(split(migration).map(sql=>db.prepare(sql)))
    await db.prepare('CREATE TABLE native_stock(key TEXT PRIMARY KEY,quantity REAL,cost REAL)').run()
    for (const mode of ['normal','rollback','lostack','transient','old']) {
      const response = await mf.dispatchFetch('http://native-transfer.test/',{method:'POST',body:JSON.stringify({mode})})
      assert.equal(response.status,200,await response.clone().text())
      const result = await response.json()
      const committed = ['normal','lostack','transient'].includes(mode)
      assert.equal(result.state.status,committed?'completed':'active')
      assert.equal(result.state.next_sequence,committed?1:0)
      assert.equal(result.state.revision,committed?1:0)
      assert.equal(result.chunk.status,committed?'committed':'planned')
      assert.equal(result.stock.quantity,committed?19:20)
      assert.equal(result.afterStock.quantity,result.stock.quantity)
      assert.equal(result.stock.cost,3.123456)
      assert.equal(result.history.n,committed?1:0)
      assert.equal(!!result.receipt,committed)
      if (committed) {
        assert.match(result.duplicateError,/NOT NULL|constraint/i)
        assert.equal(result.counts.attempts,result.beforeDuplicate+1,'deterministic duplicate guard must not retry')
        const external = await db.prepare('SELECT receipt_id FROM transfer_run_chunks WHERE run_id=?').bind('run-'+mode).first()
        assert.equal(external.receipt_id,result.receipt.receipt_id)
      }
      if (mode==='normal') { assert.equal(result.error,null); assert.equal(result.beforeDuplicate,1) }
      if (mode==='rollback') { assert.match(result.error,/NOT NULL|constraint/i); assert.equal(result.beforeDuplicate,1); assert.deepEqual(result.counts.submitted,[8]) }
      if (mode==='lostack') {
        assert.match(result.error,/NOT NULL|constraint/i)
        assert.equal(result.beforeDuplicate,2)
        assert.deepEqual(result.counts.submitted.slice(0,2),[7,7],'ambiguous acknowledgement retries whole envelope')
      }
      if (mode==='transient') { assert.equal(result.error,null); assert.equal(result.beforeDuplicate,2); assert.equal(result.counts.submitted[0],7) }
      if (mode==='old') assert.match(result.error,/active intent/)
      console.log('PASS actual workerd D1',mode,JSON.stringify({attemptsBeforeDuplicate:result.beforeDuplicate,submittedStatements:result.counts.submitted}))
    }
    console.log('BUDGET: real D1Compat may submit full N-statement envelope twice on ambiguous transient failure; reserve 2*N plus all reads/handler overhead. maxAtomicStatements alone bounds one attempt, not invocation.')
  } finally { await mf.dispose() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
