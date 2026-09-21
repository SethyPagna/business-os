// Actual Hono import routes against local workerd/D1, not copied route SQL.
const assert = require('node:assert/strict')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')

async function main() {
  const root = path.resolve(__dirname, '..')
  const stubs = {
    auth: `export const requireAuth=async(c,next)=>{c.set('user',{id:1,username:'admin',role_code:'admin'});return next()}`,
    audit: `export const audit=async(env)=>{await env.DB.prepare('INSERT INTO audit_probe DEFAULT VALUES').run()}`,
  }
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import app from './src/routes/importJobs.ts';
    import { registerInlineImportRunner } from './src/lib/queueDispatch.ts';
    registerInlineImportRunner(async (env, message) => {
      await env.DB.prepare('INSERT INTO dispatch_probe(job_id,kind) VALUES(?,?)').bind(message.jobId,message.kind).run();
    });
    export default { fetch(request,env,ctx) { return app.fetch(request,env,ctx); } };
  ` }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', plugins: [{ name: 'route-auth-and-audit', setup(b) {
    b.onResolve({ filter: /\/lib\/(auth|audit)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }))
  } }] })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', d1Databases: ['DB', 'IMPORT_DB'], log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    await db.prepare('CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)').run()
    await db.prepare(`CREATE TABLE import_jobs(id TEXT PRIMARY KEY,type TEXT,status TEXT,phase TEXT,queue_driver TEXT,
      policy_json TEXT,summary_json TEXT,cancel_requested INTEGER DEFAULT 0,created_by_id INTEGER,created_by_name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      processed_rows INTEGER DEFAULT 0,failed_rows INTEGER DEFAULT 0,last_error TEXT,details_pruned_at TEXT)`).run()
    await db.prepare('CREATE TABLE import_job_files(id INTEGER PRIMARY KEY,job_id TEXT,kind TEXT,original_name TEXT)').run()
    await db.prepare('CREATE TABLE dispatch_probe(job_id TEXT,kind TEXT)').run()
    await db.prepare('CREATE TABLE audit_probe(id INTEGER PRIMARY KEY)').run()
    for (const [id, status] of [['start','pending'],['approve','awaiting_review'],['retry','failed']]) {
      await db.prepare("INSERT INTO import_jobs(id,type,status,phase,policy_json,summary_json) VALUES(?,'inventory',?,?,'{}','{}')")
        .bind(id,status,status).run()
    }
    await db.prepare("INSERT INTO import_job_files(job_id,kind) VALUES('start','csv')").run()
    await db.prepare("INSERT INTO import_jobs(id,type,status,phase,policy_json,summary_json,updated_at) VALUES('stale','inventory','queued','queued','{}','{}','2000-01-01 00:00:00')").run()
    const held = JSON.stringify({ mode: 'restore', token: 'held', backupKey: 'test', startedAt: new Date().toISOString(),
      startedBy: 'admin', phase: 'deleting', updatedAt: new Date().toISOString() })
    await db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").bind(held).run()
    const call = async (url, body = {}) => {
      const response = await mf.dispatchFetch('http://local.test'+url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      return { status: response.status, data: await response.json() }
    }
    for (const [url, body] of [['/',{ type: 'inventory' }],['/start/start',{}],['/approve/approve',{}],['/retry/retry',{}]]) {
      const result = await call(url,body)
      assert.equal(result.status, 503, url)
      assert.equal(result.data.code, 'import_maintenance_active', url)
    }
    const poll = await mf.dispatchFetch('http://local.test/', { method: 'GET' })
    assert.equal(poll.status, 200, await poll.clone().text())
    assert.equal((await db.prepare("SELECT status FROM import_jobs WHERE id='stale'").first()).status, 'queued', 'GET reaper cannot write during maintenance')
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM import_jobs').first()).n, 4, 'create refused')
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM dispatch_probe').first()).n, 0, 'no queue dispatch')
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM audit_probe').first()).n, 0, 'no audit on refusal')
    for (const [id, status] of [['start','pending'],['approve','awaiting_review'],['retry','failed']]) {
      assert.equal((await db.prepare('SELECT status FROM import_jobs WHERE id=?').bind(id).first()).status, status, id)
    }
    await db.prepare("DELETE FROM system_flags WHERE key='maintenance'").run()
    for (const [url, body] of [['/',{ type: 'inventory' }],['/start/start',{}],['/approve/approve',{}],['/retry/retry',{}]]) {
      const result = await call(url,body)
      assert.equal(result.status, 200, JSON.stringify({url,...result}))
    }
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM dispatch_probe').first()).n, 3)
    console.log('PASS native D1 actual Hono import create/start/approve/retry refusal and recovery; no queue/audit/status write on fence')
  } finally { await mf.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
