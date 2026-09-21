const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const root = path.resolve(__dirname, '..')
async function main() {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import {beginDatasetOperation,executeDatasetChunk} from './src/lib/datasetOperationStore.ts';
    export default {async fetch(request,env){
      const input=await request.json();let batches=0;
      const db={prepare:sql=>env.DB.prepare(sql),batch:async statements=>{
        batches++;
        if(input.beforeBatch)await env.DB.prepare(input.beforeBatch.sql).bind(...input.beforeBatch.params).run();
        if(Number.isInteger(input.crashBoundary))statements.splice(input.crashBoundary,0,env.DB.prepare('INSERT INTO effects(actor_id,amount)VALUES(NULL,NULL)'));
        const result=await env.DB.batch(statements);
        if(input.loseAck)throw new Error('simulated lost acknowledgement');
        return result;
      }};
      try{
        const result=input.mode==='begin'?await beginDatasetOperation(db,input.value):await executeDatasetChunk(db,input.value,input.budget);
        return Response.json({result,batches});
      }catch(error){return Response.json({error:error.message,batches}, {status:409})}
    }}
  ` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', d1Databases: ['DB'], log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    const fullSchema = process.argv.includes('--migrated-schema')
    const schema = `CREATE TABLE users(id INTEGER PRIMARY KEY,organization_id INTEGER,created_at TEXT,username TEXT,role_id INTEGER,permissions TEXT,is_active INTEGER,deleted_at TEXT,password TEXT,name TEXT);
      CREATE TABLE roles(id INTEGER PRIMARY KEY,code TEXT,permissions TEXT);
      CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
      INSERT INTO roles VALUES(1,'admin','{}');`
    if(fullSchema) {
      // Historical 0098 data SQL exceeds native D1's compound SELECT limit.
      // This mode verifies the exact resulting schema, not fresh deployment of
      // every historical migration or historical seed/data parity.
      const SQLite = require('better-sqlite3'), migrated = new SQLite(':memory:')
      try {
        console.log('Building actual post-migration schema in SQLite')
        for(const file of fs.readdirSync(path.join(root,'migrations')).filter(file=>file.endsWith('.sql')&&!file.startsWith('0190_')).sort()) migrated.exec(fs.readFileSync(path.join(root,'migrations',file),'utf8'))
        // Virtual table creation recreates its own shadow tables in native D1.
        const definitions=migrated.prepare("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT IN(SELECT name FROM pragma_table_list WHERE type='shadow') ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END,rowid").all()
        console.log('Loading '+definitions.length+' real schema definitions into native D1')
        for(const {sql} of definitions) await db.prepare(sql).run()
      } finally { migrated.close() }
      await db.prepare("INSERT INTO roles(id,name,code,permissions)VALUES(1,'Administrator','admin','{}') ON CONFLICT(id) DO UPDATE SET code='admin',permissions='{}'").run()
    } else for (const sql of split(schema)) await db.prepare(sql).run()
    await db.prepare('CREATE TABLE effects(actor_id INTEGER NOT NULL,amount REAL NOT NULL)').run()
    const migration = fs.readFileSync(path.join(root, 'migrations/0190_dataset_operation_journal.sql'), 'utf8')
    assert.equal(migration.includes('\r'), false, 'trigger SQL must be LF-only')
    for (const sql of split(migration)) await db.prepare(sql).run()
    const call = async payload => {
      const response = await mf.dispatchFetch('http://local.test', { method: 'POST', body: JSON.stringify(payload) })
      return { status: response.status, ...await response.json() }
    }
    let nextActor = (await db.prepare('SELECT COALESCE(MAX(id),0) n FROM users').first()).n
    async function setup() {
      const id = ++nextActor
      await db.prepare("INSERT INTO users(id,organization_id,created_at,username,role_id,permissions,is_active,deleted_at,password,name) VALUES(?,NULL,?,?,1,?,1,NULL,?,'Admin')").bind(id, '2026-09-21T00:00:00Z', 'admin'+id, '{}', 'password').run()
      await db.prepare('INSERT INTO system_flags(key,value)VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('maintenance', JSON.stringify({ mode: 'restore', token: 'owner'+id, backupKey:'backup.json',startedAt:'2026-09-21T00:00:00Z',startedBy:'admin',updatedAt:'2026-09-21T00:00:00Z',phase:'inserting' })).run()
      await db.prepare('INSERT INTO system_flags(key,value)VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('business_dataset_generation', JSON.stringify({ generation: 'dataset'+id })).run()
      return { actorId:id,organizationId:null,requestId:'request-'+id,kind:'restore',source:{key:'backup.json',version:'v1',sha256:'a'.repeat(64)},request:{scope:'all'},maintenanceToken:'owner'+id,datasetGeneration:'dataset'+id,initialPhase:'rows' }
    }
    async function begin(value) {
      const result = await call({ mode:'begin', value }); assert.equal(result.status,200,result.error); return result.result
    }
    function chunk(owner,op) { return { actorId:owner.actorId,organizationId:null,operationId:op.id,epoch:op.epoch,sequence:0,phase:'rows',cursor:{},nextPhase:'rows',nextCursor:{page:1},final:false,
      effects:[{sql:'INSERT INTO effects(actor_id,amount)VALUES(?,?)',params:[owner.actorId,1.2345],maxChangedRows:1}] } }
    const count = async id => (await db.prepare('SELECT COUNT(*) n FROM effects WHERE actor_id=?').bind(id).first()).n
    {
      const owner=await setup(); const attempts=await Promise.all([call({mode:'begin',value:owner}),call({mode:'begin',value:owner})]);
      assert.ok(attempts.some(r=>r.status===200));
      assert.equal((await db.prepare('SELECT COUNT(*) n FROM dataset_operations WHERE actor_id=?').bind(owner.actorId).first()).n,1)
      const op=await begin(owner), plan=chunk(owner,op)
      const lost=await call({value:plan,loseAck:true});assert.equal(lost.status,409);assert.equal(lost.batches,1)
      const replay=await call({value:plan});assert.equal(replay.status,200);assert.equal(replay.batches,0);assert.equal(await count(owner.actorId),1)
      assert.equal((await db.prepare('SELECT amount FROM effects WHERE actor_id=?').bind(owner.actorId).first()).amount,1.2345)
      assert.equal((await call({value:{...plan,effects:[{...plan.effects[0],params:[owner.actorId,9]}]}})).status,409)
      assert.equal((await call({mode:'begin',value:{...owner,source:{...owner.source,version:'changed'}}})).status,409)
      await db.prepare('UPDATE users SET permissions=? WHERE id=?').bind('{"changed":true}',owner.actorId).run()
      await db.prepare('UPDATE users SET permissions=? WHERE id=?').bind('{}',owner.actorId).run()
      assert.equal((await call({value:plan})).status,409,'permission ABA cannot disclose replay')
      console.log('PASS acquisition contention, lost ack, exact replay, precision and permanent permission ABA')
    }
    for(const invalidation of ['owner','generation','principal','role','delete-recreate','replace']) {
      const owner=await setup(),op=await begin(owner),plan=chunk(owner,op)
      if(invalidation==='delete-recreate'){
        const row=await db.prepare('SELECT * FROM users WHERE id=?').bind(owner.actorId).first()
        await db.prepare('DELETE FROM users WHERE id=?').bind(owner.actorId).run()
        await db.prepare('INSERT INTO users('+Object.keys(row).join(',')+')VALUES('+Object.keys(row).map(()=>'?').join(',')+')').bind(...Object.values(row)).run()
      }
      const beforeBatch = invalidation==='owner'?{sql:'UPDATE system_flags SET value=? WHERE key=?',params:['{"mode":"restore","token":"replacement"}','maintenance']}
        :invalidation==='generation'?{sql:'UPDATE system_flags SET value=? WHERE key=?',params:['{"generation":"replacement"}','business_dataset_generation']}
        :invalidation==='principal'?{sql:'UPDATE users SET is_active=0 WHERE id=?',params:[owner.actorId]}
        :invalidation==='role'?{sql:'UPDATE roles SET permissions=? WHERE id=1',params:['{"changed":'+owner.actorId+'}']}
        :invalidation==='replace'?{sql:'INSERT OR REPLACE INTO users SELECT * FROM users WHERE id=?',params:[owner.actorId]}:undefined
      const result=await call({value:plan,beforeBatch});assert.equal(result.status,409,invalidation);assert.equal(await count(owner.actorId),0,invalidation)
      assert.equal((await db.prepare('SELECT revision FROM dataset_operations WHERE id=?').bind(op.id).first()).revision,0)
    }
    for(const failure of ['effect-error','row-budget','self-revoke','budget']) {
      const owner=await setup(),op=await begin(owner),plan=chunk(owner,op)
      if(failure==='effect-error')plan.effects.push({sql:'INSERT INTO effects(actor_id,amount)VALUES(?,NULL)',params:[owner.actorId],maxChangedRows:1})
      if(failure==='row-budget')plan.effects[0].maxChangedRows=0
      if(failure==='self-revoke')plan.effects.push({sql:'UPDATE users SET is_active=0 WHERE id=?',params:[owner.actorId],maxChangedRows:1})
      const result=await call({value:plan,budget:failure==='budget'?1:45});assert.equal(result.status,409,failure)
      assert.equal(await count(owner.actorId),0);assert.equal((await db.prepare('SELECT revision FROM dataset_operations WHERE id=?').bind(op.id).first()).revision,0)
      assert.equal((await db.prepare('SELECT COUNT(*) n FROM dataset_operation_fence').first()).n,0)
      assert.equal((await db.prepare('SELECT is_active FROM users WHERE id=?').bind(owner.actorId).first()).is_active,1)
    }
    for(const malformed of [state=>({mode:state.mode,token:state.token}),state=>({...state,phase:{}}),state=>({...state,startedAt:'invalid'}),state=>({...state,rowsDone:-1})]) {
      const owner=await setup(),op=await begin(owner),plan=chunk(owner,op)
      const good=(await db.prepare("SELECT value FROM system_flags WHERE key='maintenance'").first()).value
      const bad=JSON.stringify(malformed(JSON.parse(good)))
      const beforeBatch={sql:"UPDATE system_flags SET value=? WHERE key='maintenance'",params:[bad]}
      assert.equal((await call({value:plan,beforeBatch})).status,409,'corruption after validation fails transaction fence')
      assert.equal(await count(owner.actorId),0)
      await db.prepare("UPDATE system_flags SET value=? WHERE key='maintenance'").bind(good).run()
      assert.equal((await call({value:plan})).status,200)
      await db.prepare("UPDATE system_flags SET value=? WHERE key='maintenance'").bind(bad).run()
      assert.equal((await call({value:plan})).status,409,'corrupt matching token cannot disclose receipt')
      assert.equal((await call({mode:'begin',value:owner})).status,409,'corrupt matching token cannot resume operation')
    }
    for(let crashBoundary=0;crashBoundary<=7;crashBoundary++) {
      const owner=await setup(),op=await begin(owner),plan=chunk(owner,op)
      const result=await call({value:plan,crashBoundary})
      assert.equal(result.status,409);assert.equal(result.batches,1)
      assert.equal(await count(owner.actorId),0)
      assert.equal((await db.prepare('SELECT revision FROM dataset_operations WHERE id=?').bind(op.id).first()).revision,0)
      assert.equal((await db.prepare('SELECT COUNT(*) n FROM dataset_operation_chunks WHERE operation_id=?').bind(op.id).first()).n,0)
      assert.equal((await db.prepare('SELECT COUNT(*) n FROM dataset_operation_fence').first()).n,0)
    }
    {
      const owner=await setup(),op=await begin(owner),plan=chunk(owner,op)
      const results=await Promise.all([call({value:plan}),call({value:plan})]);assert.ok(results.some(r=>r.status===200));assert.equal(await count(owner.actorId),1)
      const next={...plan,sequence:1,cursor:{page:1},nextCursor:{page:2},final:true}
      assert.equal((await call({value:next})).status,200);assert.equal(await count(owner.actorId),2)
      assert.equal((await call({value:next})).status,200);assert.equal(await count(owner.actorId),2)
      await assert.rejects(db.prepare('DELETE FROM dataset_operations WHERE id=?').bind(op.id).run())
      await assert.rejects(db.prepare('DELETE FROM dataset_operation_chunks WHERE operation_id=?').bind(op.id).run())
    }
    console.log('PASS native transaction-time owner/generation/principal fences, rollback boundaries, chunk contention and permanent receipts')
  } finally { await mf.dispose() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
