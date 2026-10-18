const assert = require('node:assert/strict')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare } = require('miniflare')

async function main() {
  const code = `
    import { restoreCloudflareBackup } from './src/lib/backup.ts';
    import { beginMaintenance, endMaintenance } from './src/lib/maintenance.ts';
    import { STOCK_SCHEMA_EPOCH } from './src/lib/stockTransaction.ts';
    export default { async fetch(request, bindings) {
      const mode = new URL(request.url).searchParams.get('mode');
      const key = 'backups/cloudflare/' + mode + '.json';
      const doc = value => JSON.stringify({format:'business-os-cloudflare-backup',formatVersion:1,createdAt:'2026-09-20T00:00:00Z',source:'manual',runtime:'cloudflare-workers',tables:{settings:{columns:['key','value'],rows:[{key:'proof',value}]}},r2:{assets:[],copiedKeys:[]},summary:{tableCount:1,rowCount:1}});
      await bindings.ASSETS.put(key,doc('VALIDATED'));
      await bindings.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('proof','LIVE')").run();
      await bindings.DB.prepare("INSERT OR REPLACE INTO system_flags(key,value) VALUES('stock_schema_epoch',?)").bind(STOCK_SCHEMA_EPOCH).run();
      let reads=0,deletes=0,conditional=false;
      const isBusinessDelete = sql => /^DELETE FROM "settings"$/.test(sql);
      const prepare = (sql, params=[]) => {
        const native = params.length ? bindings.DB.prepare(sql).bind(...params) : bindings.DB.prepare(sql);
        return {sql,native,bind:(...values)=>prepare(sql,values),
          first:()=>native.first(),all:()=>native.all(),
          async run(){const result=await native.run();if(isBusinessDelete(sql))deletes++;return result}
        };
      };
      const env={ASSETS:{get:async(k,options)=>{
        if(k===key){reads++;if(reads===2){
          conditional=!!options?.onlyIf?.etagMatches;
          if(mode==='changed'||mode==='same') await bindings.ASSETS.put(key,doc(mode==='same'?'VALIDATED':'REPLACEMENT'));
          if(mode==='deleted') await bindings.ASSETS.delete(key);
        }}
        return bindings.ASSETS.get(k,options);
      }},DB:{prepare,async batch(statements){
        const results=await bindings.DB.batch(statements.map(statement=>statement.native));
        deletes+=statements.filter(statement=>isBusinessDelete(statement.sql)).length;
        return results;
      }}};
      const ownership=await beginMaintenance(env,{backupKey:key,startedBy:'R2 source fixture'});
      let error=null;
      try{await restoreCloudflareBackup(env,key,async progress=>{
        if(progress.phase==='deleting'){
          if(mode==='held')await bindings.ASSETS.put(key,doc('REPLACEMENT'));
          if(mode==='callback')throw new Error('admission failed');
        }
      },ownership.token)}catch(e){error=e.message}finally{
        if(!await endMaintenance(env,ownership.token))throw new Error('restore ownership was lost');
      }
      const value=(await bindings.DB.prepare("SELECT value FROM settings WHERE key='proof'").first())?.value??null;
      const permits=(await bindings.DB.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").first()).n;
      return Response.json({mode,reads,deletes,value,conditional,error,permits});
    }};
  `
  const bundle = await build({ stdin: { contents: code, resolveDir: path.join(__dirname, '..'), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['node:*', 'cloudflare:*'] })
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'], r2Buckets: ['ASSETS'], d1Databases: ['DB'], script: bundle.outputFiles[0].text })
  try {
    const db=await mf.getD1Database('DB')
    await db.batch([
      db.prepare('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)'),
      db.prepare('CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)'),
      db.prepare('CREATE TABLE import_jobs(id INTEGER PRIMARY KEY,status TEXT,lease_expires_at TEXT)'),
      db.prepare('CREATE TABLE bulk_delete_jobs(id INTEGER PRIMARY KEY,status TEXT)'),
    ])
    for (const mode of ['unchanged', 'changed', 'same', 'deleted', 'held', 'callback']) {
      const response = await mf.dispatchFetch('http://local.test/?mode=' + mode)
      assert.equal(response.status, 200)
      const result = await response.json()
      assert.equal(result.permits, 0)
      assert.equal(result.reads, 2)
      assert.equal(result.conditional, true)
      if (['changed', 'same', 'deleted', 'callback'].includes(mode)) {
        assert(result.error, mode)
        assert.equal(result.deletes, 0, mode)
        assert.equal(result.value, 'LIVE', mode)
      } else {
        assert.equal(result.error, null, mode)
        assert.equal(result.deletes, 1, mode)
        assert.equal(result.value, 'VALIDATED', mode)
      }
    }
    console.log('PASS actual restore + native workerd R2: 6 source-pinning cases')
  } finally { await mf.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
