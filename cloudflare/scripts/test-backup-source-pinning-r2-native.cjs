const assert = require('node:assert/strict')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare } = require('miniflare')

async function main() {
  const code = `
    import { restoreCloudflareBackup } from './src/lib/backup.ts';
    export default { async fetch(request, bindings) {
      const mode = new URL(request.url).searchParams.get('mode');
      const key = 'backups/cloudflare/' + mode + '.json';
      const doc = value => JSON.stringify({format:'business-os-cloudflare-backup',formatVersion:1,createdAt:'2026-09-20T00:00:00Z',source:'manual',runtime:'cloudflare-workers',tables:{settings:{columns:['key','value'],rows:[{key:'proof',value}]}},r2:{assets:[],copiedKeys:[]},summary:{tableCount:1,rowCount:1}});
      await bindings.ASSETS.put(key,doc('VALIDATED'));
      let reads=0,deletes=0,value='LIVE',conditional=false;
      const env={ASSETS:{get:async(k,options)=>{
        if(k===key){reads++;if(reads===2){
          conditional=!!options?.onlyIf?.etagMatches;
          if(mode==='changed'||mode==='same') await bindings.ASSETS.put(key,doc(mode==='same'?'VALIDATED':'REPLACEMENT'));
          if(mode==='deleted') await bindings.ASSETS.delete(key);
        }}
        return bindings.ASSETS.get(k,options);
      }},DB:{prepare(sql){
        let params=[];const stmt={bind(...p){params=p;return stmt},
          async first(){return sql.includes('sqlite_master') && params[1]==='settings'?{name:'settings'}:null},
          async all(){return {results:sql.startsWith('PRAGMA table_info')?[{name:'key'},{name:'value'}]:[]}},
          async run(){if(sql.startsWith('DELETE')){deletes++;value=null}if(sql.startsWith('INSERT'))value=params[1];return {success:true}}};return stmt;
      },async batch(statements){return Promise.all(statements.map(s=>s.run()))}}};
      let error=null;
      try{await restoreCloudflareBackup(env,key,async progress=>{
        if(progress.phase==='deleting'){
          if(mode==='held')await bindings.ASSETS.put(key,doc('REPLACEMENT'));
          if(mode==='callback')throw new Error('admission failed');
        }
      })}catch(e){error=e.message}
      return Response.json({mode,reads,deletes,value,conditional,error});
    }};
  `
  const bundle = await build({ stdin: { contents: code, resolveDir: path.join(__dirname, '..'), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' })
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-08-01', r2Buckets: ['ASSETS'], script: bundle.outputFiles[0].text })
  try {
    for (const mode of ['unchanged', 'changed', 'same', 'deleted', 'held', 'callback']) {
      const response = await mf.dispatchFetch('http://local.test/?mode=' + mode)
      assert.equal(response.status, 200)
      const result = await response.json()
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
