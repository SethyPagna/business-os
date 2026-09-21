// Real local workerd/D1 statements, with deterministic interleavings at binding
// boundaries. No remote access or migration of a business database.
const assert = require('node:assert/strict')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')

async function main() {
  const bundle = await build({ stdin: { resolveDir: path.resolve(__dirname, '..'), loader: 'ts', contents: `
    import { beginMaintenance, getMaintenance, updateMaintenance, endMaintenance } from './src/lib/maintenance.ts';
    export default { async fetch(request, env) {
      const input = await request.json(); const db = env.DB;
      await db.prepare('DELETE FROM system_flags').run();
      const begin = () => beginMaintenance(env, {backupKey:'test',startedBy:'admin'});
      if(input.mode === 'begin-race') {
        const results = await Promise.allSettled([begin(),begin(),begin()]);
        return Response.json({results, current:await getMaintenance(env)});
      }
      if(input.mode === 'corrupt') {
        await db.prepare('INSERT INTO system_flags(key,value)VALUES(?,?)').bind('maintenance',input.raw).run();
        const current=await getMaintenance(env); let refusal=false;
        try{await begin()}catch{refusal=true}
        await updateMaintenance(env,'old',{phase:'assets'});
        const ended=await endMaintenance(env,null);
        const raw=(await db.prepare('SELECT value FROM system_flags').first()).value;
        const cleared=await endMaintenance(env,null,{force:true});
        return Response.json({current,refusal,ended,raw,cleared});
      }
      const old = await begin(); let replacement=null, intercepted=false;
      if(input.mode==='corrupt-force-race')await db.prepare('UPDATE system_flags SET value=?').bind('{broken').run();
      const wrapped = {DB:{prepare(sql){const statement=db.prepare(sql);return {bind(...args){const bound=statement.bind(...args);return {
        first:()=>bound.first(),
        run:async()=>{
          if(!intercepted && ((input.mode==='progress-race' && sql.startsWith('UPDATE')) || (input.mode!=='progress-race' && sql.startsWith('DELETE')))) {
            intercepted=true;
            await endMaintenance(env,old.token,{force:input.mode==='corrupt-force-race'});
            if(input.mode !== 'progress-after-clear') replacement=await begin();
          }
          return bound.run();
        }
      }}}}}};
      let result=null;
      if(input.mode==='progress-race')await updateMaintenance(wrapped,old.token,{phase:'assets',rowsDone:999});
      else if(input.mode==='progress-after-clear'){
        await endMaintenance(env,old.token);await updateMaintenance(env,old.token,{phase:'assets'});
      }else result=await endMaintenance(wrapped,old.token,{force:input.mode==='force-end-race'||input.mode==='corrupt-force-race'});
      return Response.json({result,old,replacement,current:await getMaintenance(env)});
    }}
  ` }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', d1Databases: ['DB'], log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    await db.prepare('CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)').run()
    await db.prepare('CREATE TABLE import_jobs(status TEXT,lease_token TEXT,lease_expires_at TEXT)').run()
    await db.prepare('CREATE TABLE bulk_delete_jobs(status TEXT)').run()
    const call = async input => {
      const response = await mf.dispatchFetch('http://local.test', { method: 'POST', body: JSON.stringify(input) })
      assert.equal(response.status, 200, await response.clone().text())
      return response.json()
    }
    const concurrent = await call({ mode: 'begin-race' })
    assert.equal(concurrent.results.filter(r => r.status === 'fulfilled').length, 1)
    assert.equal(concurrent.current.token, concurrent.results.find(r => r.status === 'fulfilled').value.token)
    for (const mode of ['progress-race', 'ordinary-end-race', 'force-end-race', 'corrupt-force-race']) {
      const result = await call({ mode })
      assert.equal(result.current.token, result.replacement.token, mode)
      assert.notEqual(result.current.token, result.old.token, mode)
      assert.equal(result.current.phase, 'deleting', mode)
      if (mode !== 'progress-race') assert.equal(result.result, false, mode)
      console.log('PASS', mode)
    }
    assert.equal((await call({ mode: 'progress-after-clear' })).current, null)
    const valid = { mode: 'restore', token: 'old', phase: 'deleting', backupKey: 'backup', startedBy: 'admin', startedAt: '2026-09-21T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z' }
    const malformed = [{ phase: {} }, { startedAt: [] }, { table: {} }, { rowsDone: -1 }, { rowsDone: '1' }, { error: {} }].map(patch => JSON.stringify({ ...valid, ...patch }))
    for (const raw of ['{', 'null', '[]', '{"mode":"restore","token":3}', '{"mode":"other","token":"x"}', '{"mode":"restore","token":""}', ...malformed]) {
      const result = await call({ mode: 'corrupt', raw })
      assert.equal(result.current.phase, 'failed'); assert.equal(result.current.token, '')
      assert.equal(result.refusal, true); assert.equal(result.ended, false)
      assert.equal(result.raw, raw); assert.equal(result.cleared, true)
    }
    console.log('PASS native maintenance acquisition, stale progress, ordinary/force clear races and twelve corrupt states')
  } finally { await mf.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
