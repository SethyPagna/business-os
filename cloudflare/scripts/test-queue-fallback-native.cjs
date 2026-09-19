// Actual workerd execution of queueDispatch with local D1/R2, no IMPORT_QUEUE.
// No remote bindings, credentials, schema migrations or persistent fixture files.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Miniflare, Log, LogLevel } = require('miniflare')

const source = fs.readFileSync(path.resolve(__dirname,'../src/lib/queueDispatch.ts'),'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
}).outputText
const smokeWorker = `
function barrier() {
  let release;
  const promise = new Promise(resolve => { release = resolve });
  return {promise,release};
}
export default { async fetch(request,env) {
  const {caseId,sameEnv,failureRoot,failAt=0} = await request.json();
  __resetQueueDispatchForTests();
  if (env.IMPORT_QUEUE) throw new Error('Smoke must run without a queue binding');
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS smoke_runs(key TEXT PRIMARY KEY, value TEXT)').run();
  const gates = {A:barrier(),B:barrier()};
  const entered = {A:barrier(),B:barrier()};
  const state = {A:'pending',B:'pending'};
  const depth = {A:0,B:0}, maxDepth = {A:0,B:0}, counts = {A:0,B:0};
  const bindingChecks = [];
  registerInlineImportRunner(async (scoped,message) => {
    const [root,rawIndex] = message.jobId.split(':');
    const index = Number(rawIndex);
    depth[root]++;
    maxDepth[root] = Math.max(maxDepth[root],depth[root]);
    counts[root]++;
    try {
      if (scoped.DB !== env.DB || scoped.BUCKET !== env.BUCKET) throw new Error('Binding identity changed');
      if (index === 0 || index === 199) {
        const key = caseId + '/' + root + '/' + index;
        await scoped.DB.prepare('INSERT INTO smoke_runs(key,value) VALUES(?,?)').bind(key,message.jobId).run();
        await scoped.BUCKET.put(key,message.jobId);
        const stored = await scoped.DB.prepare('SELECT value FROM smoke_runs WHERE key=?').bind(key).first();
        const object = await scoped.BUCKET.get(key);
        if (stored?.value !== message.jobId || !object || await object.text() !== message.jobId) throw new Error('Actual binding read/write mismatch');
        bindingChecks.push(key);
      }
      if (index < 199) await dispatchImportWork(scoped,{jobId:root+':'+(index+1),kind:'apply'});
      if (index === 0) { entered[root].release(); await gates[root].promise; }
      if (root === failureRoot && index === failAt) throw new Error(root+' failed at '+index);
    } finally { depth[root]--; }
  });
  const start = (root,rootEnv) => dispatchImportWork(rootEnv,{jobId:root+':0',kind:'apply'}).then(
    mode => { state[root]='fulfilled'; return {mode}; },
    error => { state[root]='rejected'; return {error:error.message}; },
  );
  const a = start('A',env), b = start('B',sameEnv ? env : {...env});
  let timer;
  try {
    await Promise.race([
      Promise.all([entered.A.promise,entered.B.promise]),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Independent root did not enter')),5000)}),
    ]);
    clearTimeout(timer);
    const beforeRelease = {...state};
    gates.A.release();
    const outcomeA = await a;
    const afterA = {...state};
    gates.B.release();
    const outcomeB = await b;
    return Response.json({beforeRelease,afterA,state,outcomeA,outcomeB,maxDepth,counts,bindingChecks});
  } finally {
    clearTimeout(timer);
    gates.A.release(); gates.B.release();
    await Promise.all([a,b]);
  }
} };
`

async function main() {
  const mf = new Miniflare({
    modules:[
      {type:'ESModule',path:'queue-smoke-entry.js',contents:
        "import { dispatchImportWork, registerInlineImportRunner, __resetQueueDispatchForTests } from './queue-dispatch.js';\n"+smokeWorker},
      {type:'ESModule',path:'queue-dispatch.js',contents:compiled},
    ], compatibilityDate:'2026-08-01',
    d1Databases:['DB'],r2Buckets:['BUCKET'],log:new Log(LogLevel.ERROR),
  })
  try {
    let caseNumber = 0
    for (const sameEnv of [true,false]) for (const failureRoot of [null,'A','B']) {
      await exercise(sameEnv,failureRoot,0)
    }
    await exercise(true,'A',1)
    async function exercise(sameEnv,failureRoot,failAt) {
      const caseId = `case-${++caseNumber}`
      const response = await mf.dispatchFetch('http://queue-smoke.test/',{method:'POST',
        headers:{'content-type':'application/json'},body:JSON.stringify({caseId,sameEnv,failureRoot,failAt})})
      assert.equal(response.status,200,await response.clone().text())
      const result = await response.json()
      assert.deepEqual(result.beforeRelease,{A:'pending',B:'pending'})
      assert.equal(result.afterA.B,'pending','A completion/failure cannot settle B')
      assert.deepEqual(result.maxDepth,{A:1,B:1})
      for (const root of ['A','B']) {
        const failed = root===failureRoot
        assert.equal(result.state[root],failed?'rejected':'fulfilled')
        assert.deepEqual(result['outcome'+root],failed?{error:`${root} failed at ${failAt}`}:{mode:'inline'})
        assert.equal(result.counts[root],failed?failAt+1:200,'only failed root abandons its queued continuation')
      }
      const expectedWrites = failureRoot ? 3 : 4
      assert.equal(result.bindingChecks.length,expectedWrites)
      // Inspect through independent local binding handles as well as inside
      // workerd, proving the proxy forwarded actual D1/R2 writes.
      const db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('BUCKET')
      const rows = await db.prepare('SELECT key,value FROM smoke_runs WHERE key LIKE ?').bind(caseId+'/%').all()
      assert.equal(rows.results.length,expectedWrites)
      for (const row of rows.results) assert.equal(await (await bucket.get(row.key)).text(),row.value)
      console.log('PASS actual workerd D1/R2:',sameEnv?'same env':'different env',failureRoot?`${failureRoot} fails at ${failAt}`:'both succeed','flat 200-chunk roots')
    }
    console.log('7 local workerd queue fallback checks passed')
  } finally {
    // Miniflare owns its ephemeral runtime/storage. No broad filesystem delete.
    await mf.dispose()
  }
}
main().catch(error=>{console.error(error);process.exitCode=1})
