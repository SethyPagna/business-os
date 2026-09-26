// S-uploads (owner ruling 2026-09-26): import files are TEMPORARY. The CSV
// or ZIP uploaded for an import lives in R2 only while the import needs it
// and is deleted when the job finishes -- after commit, after failure and
// after cancel -- plus a scheduled sweep for stale ones. Product images
// extracted from a ZIP are Library images (uploads/, file_asset_id set) and
// stay.
//
// Executed against local workerd/D1/R2 (Miniflare): the real apply
// finalizer, the real dead-letter handler, the real engine cancel branch,
// the real /cancel, /retry and /start routes, and the real sweep. No remote
// database, deployment or production state is touched.
//
// On f8ca5443 every "is gone" assertion below was false: nothing deleted an
// import file until the 7-day retention tier removed the whole job.
const assert = require('node:assert/strict')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')

// IMPORT_INCOMING_SRC_ROOT lets the fail-on-base proof point the same test
// at a checkout of the base commit.
const root = path.resolve(process.env.IMPORT_INCOMING_SRC_ROOT || path.resolve(__dirname, '..'))
const HOUR = 60 * 60 * 1000

async function main() {
  const stubs = {
    auth: `export const requireAuth=async(c,next)=>{c.set('user',{id:1,username:'admin',name:'Admin',role_code:'admin'});return next()};export const revokeUserSessions=async()=>{}`,
    audit: `export const audit=async()=>{};export const changedFields=()=>[];export const auditChangeColumns=()=>[]`,
    broadcastHub: `export const broadcast=async()=>{}`,
    rateLimit: `export const checkRateLimit=async()=>({allowed:true});export const getClientIp=()=>'127.0.0.1'`,
  }
  const real = { auth: 'src/lib/auth.ts', audit: 'src/lib/audit.ts', rateLimit: 'src/lib/rateLimit.ts', broadcastHub: 'src/durable-objects/broadcastHub.ts' }
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import { Hono } from 'hono';
    import importJobs from './src/routes/importJobs.ts';
    import { handleImportDeadLetterQueue } from './src/queue.ts';
    import { finalizeImportApply, runImportApply, markJobFailed } from './src/lib/importEngine.ts';
    import { getImportFencedDb } from './src/lib/db.ts';
    import { registerInlineImportRunner } from './src/lib/queueDispatch.ts';
    import * as incoming from './src/lib/importIncomingFiles.ts';
    // queue.ts registers the real inline runner; a retry here only needs
    // to be dispatched, not run.
    registerInlineImportRunner(async () => {});
    const app = new Hono();
    app.route('/api/import-jobs', importJobs);
    async function outcome(operation) {
      try { return { ok: true, value: await operation() }; }
      catch (error) { return { ok: false, message: String(error?.message || error) }; }
    }
    export default { async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/__test/')) return app.fetch(request, env, ctx);
      const body = await request.json();
      const mode = url.pathname.slice('/__test/'.length);
      if (mode === 'finalize') return Response.json(await outcome(async () =>
        finalizeImportApply(env, await getImportFencedDb(env), body.jobId, 1, Date.now(), {}, 0, 0)));
      if (mode === 'dlq') return Response.json(await outcome(async () => {
        const acks = [];
        await handleImportDeadLetterQueue({ messages: [{ body: { jobId: body.jobId, kind: 'apply' }, ack() { acks.push('ack') }, retry() { acks.push('retry') } }] }, env);
        return acks;
      }));
      if (mode === 'engine-apply') return Response.json(await outcome(() => runImportApply(env, body.jobId)));
      if (mode === 'mark-failed') return Response.json(await outcome(async () => markJobFailed(await getImportFencedDb(env), body.jobId, 'chunk crashed')));
      if (mode === 'sweep') return Response.json(await outcome(() => incoming.sweepStaleImportIncomingFiles(env, body.nowMs)));
      throw new Error('Unknown mode ' + mode);
    }};
  ` }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent',
  external: ['node:*', 'cloudflare:*'],
  plugins: [{ name: 'route-stubs', setup(b) {
    b.onResolve({ filter: /\/(lib\/(auth|audit|rateLimit)|durable-objects\/broadcastHub)$/ }, (args) => ({ path: args.path.split('/').pop(), namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
      contents: `export * from ${JSON.stringify(path.join(root, real[args.path]).split(path.sep).join('/'))};
${stubs[args.path]}`,
      loader: 'ts', resolveDir: root,
    }))
  } }] })

  const mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB', 'IMPORT_DB'], r2Buckets: ['ASSETS'], log: new Log(LogLevel.NONE),
  })
  try {
    const db = await mf.getD1Database('DB')
    const staging = await mf.getD1Database('IMPORT_DB')
    const r2 = await mf.getR2Bucket('ASSETS')
    for (const sql of [
      'CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)',
      `CREATE TABLE import_jobs(id TEXT PRIMARY KEY,type TEXT DEFAULT 'products',status TEXT,phase TEXT,queue_driver TEXT,policy_json TEXT DEFAULT '{}',
        summary_json TEXT DEFAULT '{}',cancel_requested INTEGER DEFAULT 0,created_by_id INTEGER,created_by_name TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,started_at TEXT,finished_at TEXT,
        processed_rows INTEGER DEFAULT 0,failed_rows INTEGER DEFAULT 0,warning_count INTEGER DEFAULT 0,last_error TEXT,
        details_pruned_at TEXT,materialize_done INTEGER DEFAULT 0,lease_token TEXT,lease_expires_at TEXT,
        dismissed_at TEXT,dismissed_status TEXT)`,
      `CREATE TABLE import_job_files(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL,kind TEXT NOT NULL,original_name TEXT,
        stored_path TEXT NOT NULL,relative_path TEXT,mime_type TEXT,byte_size INTEGER DEFAULT 0,status TEXT DEFAULT 'stored',error_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,file_asset_id INTEGER)`,
    ]) await db.prepare(sql).run()
    await staging.prepare(`CREATE TABLE import_job_rows(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT,phase TEXT,action TEXT,result_json TEXT)`).run()

    // A job with the three kinds of file an import can have: the CSV and
    // the ZIP (temporary, private imports/ objects) and an image extracted
    // from the ZIP into the Library (uploads/, file_asset_id set -- stays).
    async function seedJob(id, status, extra = {}) {
      const cols = { id, status, phase: status, ...extra }
      const names = Object.keys(cols)
      await db.prepare(`INSERT INTO import_jobs(${names.join(',')}) VALUES(${names.map(() => '?').join(',')})`).bind(...names.map((n) => cols[n])).run()
      const csv = `imports/${id}/incoming/items-1-aaaaaaaa.csv`
      const zip = `imports/${id}/incoming/images-1-bbbbbbbb.zip`
      const image = `uploads/${id}-photo-1-cccccccc.png`
      await r2.put(csv, 'name,price\nSerum,1\n', { httpMetadata: { contentType: 'text/csv' } })
      await r2.put(zip, new Uint8Array([0x50, 0x4b, 3, 4]), { httpMetadata: { contentType: 'application/zip' } })
      await r2.put(image, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { httpMetadata: { contentType: 'image/png' } })
      await db.prepare(`INSERT INTO import_job_files(job_id,kind,stored_path) VALUES(?,'csv',?),(?,'zip',?)`).bind(id, csv, id, zip).run()
      await db.prepare(`INSERT INTO import_job_files(job_id,kind,stored_path,file_asset_id) VALUES(?,'image',?,99)`).bind(id, image).run()
      return { csv, zip, image }
    }
    const exists = async (key) => Boolean(await r2.head(key))
    const fileStatuses = async (id) => (await db.prepare('SELECT kind, status FROM import_job_files WHERE job_id = ? ORDER BY id').bind(id).all()).results
    async function assertGone(id, files, label) {
      assert.equal(await exists(files.csv), false, `${label}: the import CSV must be deleted`)
      assert.equal(await exists(files.zip), false, `${label}: the import ZIP must be deleted`)
      assert.equal(await exists(files.image), true, `${label}: the extracted Library image stays`)
      assert.deepEqual(await fileStatuses(id), [
        { kind: 'csv', status: 'purged' }, { kind: 'zip', status: 'purged' }, { kind: 'image', status: 'stored' },
      ], `${label}: the rows record the delete; the Library image row is untouched`)
    }
    async function assertKept(files, label) {
      assert.equal(await exists(files.csv), true, `${label}: the CSV must still be there`)
      assert.equal(await exists(files.zip), true, `${label}: the ZIP must still be there`)
    }
    const test = async (mode, body) => {
      const response = await mf.dispatchFetch(`http://local.test/__test/${mode}`, { method: 'POST', body: JSON.stringify(body) })
      assert.equal(response.status, 200, await response.clone().text())
      const json = await response.json()
      assert.equal(json.ok, true, `${mode}: ${json.message}`)
      return json.value
    }
    const route = async (url) => {
      const response = await mf.dispatchFetch(`http://local.test/api/import-jobs${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const text = await response.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* not json */ }
      return { status: response.status, json, text }
    }
    const jobStatus = async (id) => (await db.prepare('SELECT status FROM import_jobs WHERE id = ?').bind(id).first()).status

    // ---- after commit: the apply finalizer.
    {
      const files = await seedJob('commit', 'applying', { materialize_done: 1 })
      await staging.prepare(`INSERT INTO import_job_rows(job_id,phase,action) VALUES('commit','apply','create')`).run()
      const outcome = await test('finalize', { jobId: 'commit' })
      assert.deepEqual(outcome, { applied: 1, failed: 0 })
      assert.equal(await jobStatus('commit'), 'completed')
      await assertGone('commit', files, 'after commit')
    }

    // ---- after failure: the dead-letter handler (Cloudflare gave up).
    {
      const files = await seedJob('dlq', 'applying')
      assert.deepEqual(await test('dlq', { jobId: 'dlq' }), ['ack'])
      assert.equal(await jobStatus('dlq'), 'failed')
      await assertGone('dlq', files, 'after DLQ failure')
    }

    // ---- after failure inside a chunk: markJobFailed is NOT final (the
    // queue retries the chunk and a retry may still read the CSV), so the
    // file stays until the sweep finds the job terminal for over an hour.
    {
      const files = await seedJob('chunkfail', 'analyzing')
      await test('mark-failed', { jobId: 'chunkfail' })
      assert.equal(await jobStatus('chunkfail'), 'failed')
      await assertKept(files, 'failed chunk, retry still possible')
      // The files were uploaded before the run, so before it failed: the
      // sweep ages each file as well as the job (S-uploads2b; a file younger
      // than the grace is kept -- test-import-incoming-files-race-native.cjs).
      await db.prepare(`UPDATE import_job_files SET created_at = datetime('now', '-3 hours') WHERE job_id = 'chunkfail'`).run()
      await db.prepare(`UPDATE import_jobs SET finished_at = datetime('now', '-30 minutes'), updated_at = datetime('now', '-30 minutes') WHERE id = 'chunkfail'`).run()
      await test('sweep', { nowMs: Date.now() })
      await assertKept(files, 'failed 30 minutes ago (inside the 1h grace)')
      await db.prepare(`UPDATE import_jobs SET finished_at = datetime('now', '-2 hours'), updated_at = datetime('now', '-2 hours') WHERE id = 'chunkfail'`).run()
      await test('sweep', { nowMs: Date.now() })
      await assertGone('chunkfail', files, 'failed 2 hours ago, swept')
    }

    // ---- after cancel: a job that is not running settles straight to
    // 'cancelled' in the route.
    {
      const files = await seedJob('cancelnow', 'awaiting_review', { materialize_done: 1 })
      const result = await route('/cancelnow/cancel')
      assert.equal(result.status, 200, result.text)
      assert.equal(await jobStatus('cancelnow'), 'cancelled')
      await assertGone('cancelnow', files, 'after an immediate cancel')
    }

    // ---- after cancel of a running job: the route only asks
    // ('cancelling'; the run may still be reading the file) and the engine
    // deletes when it honours the cancel.
    {
      const files = await seedJob('cancelrun', 'applying', { materialize_done: 1 })
      const result = await route('/cancelrun/cancel')
      assert.equal(result.status, 200, result.text)
      assert.equal(await jobStatus('cancelrun'), 'cancelling')
      await assertKept(files, 'cancel requested, run still in flight')
      assert.deepEqual(await test('engine-apply', { jobId: 'cancelrun' }), { applied: 0, failed: 0 })
      assert.equal(await jobStatus('cancelrun'), 'cancelled')
      await assertGone('cancelrun', files, 'after the engine honoured the cancel')
    }

    // ---- retry after the file is gone: from materialized rows it still
    // runs; with nothing materialized it is refused with the real reason.
    {
      await db.prepare(`UPDATE import_jobs SET status = 'failed', phase = 'failed' WHERE id = 'dlq'`).run()
      const refused = await route('/dlq/retry')
      assert.equal(refused.status, 409, refused.text)
      assert.equal(refused.json.code, 'import_source_deleted')
      assert.match(refused.json.error, /Upload the file again/)
      assert.equal(await jobStatus('dlq'), 'failed', 'a refused retry changes nothing')

      await db.prepare(`UPDATE import_jobs SET status = 'failed', phase = 'failed' WHERE id = 'commit'`).run()
      const allowed = await route('/commit/retry')
      assert.equal(allowed.status, 200, allowed.text)
      assert.equal(await jobStatus('commit'), 'queued', 'materialized rows are enough to retry from')
    }

    // ---- start: a purged CSV is not a CSV to start from.
    {
      await db.prepare(`INSERT INTO import_jobs(id,status,phase) VALUES('restart','pending','created')`).run()
      await db.prepare(`INSERT INTO import_job_files(job_id,kind,stored_path,status) VALUES('restart','csv','imports/restart/incoming/x.csv','purged')`).run()
      const result = await route('/restart/start')
      assert.equal(result.status, 400, result.text)
      assert.match(result.json.error, /Upload a CSV/)
    }

    // ---- sweep: never-started jobs after 24h, orphans after 24h; running
    // and awaiting-review jobs keep their file whatever its age.
    {
      const idleOld = await seedJob('idle-old', 'pending')
      await db.prepare(`UPDATE import_jobs SET updated_at = datetime('now', '-25 hours') WHERE id = 'idle-old'`).run()
      await db.prepare(`UPDATE import_job_files SET created_at = datetime('now', '-25 hours') WHERE job_id = 'idle-old'`).run()
      const idleNew = await seedJob('idle-new', 'pending')
      const running = await seedJob('running', 'applying')
      await db.prepare(`UPDATE import_jobs SET updated_at = datetime('now', '-3 days') WHERE id = 'running'`).run()
      const review = await seedJob('review', 'awaiting_review')
      await db.prepare(`UPDATE import_jobs SET updated_at = datetime('now', '-3 days') WHERE id = 'review'`).run()
      await r2.put('imports/ghost/incoming/lost.csv', 'a,b\n')
      await r2.put('imports/cancelnow/incoming/leftover.csv', 'a,b\n')

      // Now: only the idle-over-24h job qualifies; the orphans are fresh.
      await test('sweep', { nowMs: Date.now() })
      await assertGone('idle-old', idleOld, 'never started, idle 25h')
      await assertKept(idleNew, 'never started, idle minutes')
      await assertKept(running, 'running job')
      await assertKept(review, 'awaiting review')
      assert.equal(await exists('imports/ghost/incoming/lost.csv'), true, 'a fresh orphan is not swept yet')

      // 25h later every R2 object is old enough to be an orphan candidate:
      // objects of a missing or finished job go; a live job's stay.
      await test('sweep', { nowMs: Date.now() + 25 * HOUR })
      assert.equal(await exists('imports/ghost/incoming/lost.csv'), false, 'orphan of a missing job')
      assert.equal(await exists('imports/cancelnow/incoming/leftover.csv'), false, 'orphan of a finished job')
      await assertKept(running, 'running job, old objects')
      await assertKept(review, 'awaiting review, old objects')
      assert.equal(await exists(running.image), true)
    }

    console.log('PASS import files are deleted after commit, DLQ failure, swept chunk failure and cancel; retry/start honour the delete; sweep keeps live jobs')
  } finally {
    await mf.dispose()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
