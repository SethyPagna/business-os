// S-uploads2b: the stale-file sweep never removes an import file younger
// than the threshold its job is judged by.
//
// The race the refuter found: a pending job created 25h ago gets a fresh CSV
// (200). The scheduled sweep (lib/importIncomingFiles.ts) judged the job by
// updated_at alone -- which no upload moved -- and deleted the new CSV with
// everything else under imports/<job>/; /start then answered 400 "Upload a
// CSV before starting the import". A corrected CSV attached to a failed job
// went the same way, because the 1h grace ran from the old finished_at.
//
// The fix has two halves. storeUpload touches the job on every attach (the
// job's idle clock), and the sweep ages every FILE by its own upload time --
// rows by created_at, unregistered objects under the job's prefix by R2's
// `uploaded` -- which still holds when a tick lands between the R2 put and
// the row insert (case 3 inserts rows directly, so no touch can help it).
//
// Executed against local workerd/D1/R2 (Miniflare) through the real Hono
// routes (/csv, /start) and the real sweep. Each case gets its own in-memory
// Miniflare, so one case's sweep never reaches another's jobs. No remote
// database, deployment or production state is touched.
//
// IMPORT_INCOMING_SRC_ROOT points the same test at another checkout (the
// fail-on-base proof); packages still resolve from this checkout.
//
// Run: node scripts/test-import-incoming-files-race-native.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')

const root = path.resolve(process.env.IMPORT_INCOMING_SRC_ROOT || path.resolve(__dirname, '..'))
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

async function bundleWorker() {
  const stubs = {
    auth: `export const requireAuth=async(c,next)=>{c.set('user',{id:1,username:'admin',name:'Admin',role_code:'admin'});return next()};export const revokeUserSessions=async()=>{}`,
    audit: `export const audit=async()=>{};export const changedFields=()=>[];export const auditChangeColumns=()=>[]`,
    broadcastHub: `export const broadcast=async()=>{}`,
    rateLimit: `export const checkRateLimit=async()=>({allowed:true});export const getClientIp=()=>'127.0.0.1'`,
  }
  const real = { auth: 'src/lib/auth.ts', audit: 'src/lib/audit.ts', rateLimit: 'src/lib/rateLimit.ts', broadcastHub: 'src/durable-objects/broadcastHub.ts' }
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: 'ts',
      contents: `
        import { Hono } from 'hono';
        import importJobs from './src/routes/importJobs.ts';
        import { registerInlineImportRunner } from './src/lib/queueDispatch.ts';
        import * as incoming from './src/lib/importIncomingFiles.ts';
        // /start only has to dispatch the analyze here, not run it.
        registerInlineImportRunner(async () => {});
        const app = new Hono();
        app.route('/api/import-jobs', importJobs);
        export default { async fetch(request, env, ctx) {
          const url = new URL(request.url);
          if (url.pathname !== '/__test/sweep') return app.fetch(request, env, ctx);
          const body = await request.json();
          try { return Response.json({ ok: true, value: await incoming.sweepStaleImportIncomingFiles(env, body.nowMs) }); }
          catch (error) { return Response.json({ ok: false, message: String(error?.message || error) }); }
        }};
      `,
    },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent',
    external: ['node:*', 'cloudflare:*'],
    nodePaths: [path.resolve(__dirname, '..', 'node_modules')],
    plugins: [{ name: 'route-stubs', setup(b) {
      b.onResolve({ filter: /\/(lib\/(auth|audit|rateLimit)|durable-objects\/broadcastHub)$/ }, (args) => ({ path: args.path.split('/').pop(), namespace: 'stub' }))
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
        contents: `export * from ${JSON.stringify(path.join(root, real[args.path]).split(path.sep).join('/'))};
${stubs[args.path]}`,
        loader: 'ts', resolveDir: root,
      }))
    } }],
  })
  return bundle.outputFiles[0].text
}

const SCHEMA = [
  'CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)',
  `CREATE TABLE import_jobs(id TEXT PRIMARY KEY,type TEXT DEFAULT 'products',status TEXT,phase TEXT,queue_driver TEXT,policy_json TEXT DEFAULT '{}',
    summary_json TEXT DEFAULT '{}',cancel_requested INTEGER DEFAULT 0,created_by_id INTEGER,created_by_name TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,started_at TEXT,finished_at TEXT,
    processed_rows INTEGER DEFAULT 0,failed_rows INTEGER DEFAULT 0,warning_count INTEGER DEFAULT 0,last_error TEXT,
    details_pruned_at TEXT,materialize_state_json TEXT,materialize_done INTEGER DEFAULT 0,lease_token TEXT,lease_expires_at TEXT,
    dismissed_at TEXT,dismissed_status TEXT)`,
  `CREATE TABLE import_job_files(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL,kind TEXT NOT NULL,original_name TEXT,
    stored_path TEXT NOT NULL,relative_path TEXT,mime_type TEXT,byte_size INTEGER DEFAULT 0,status TEXT DEFAULT 'stored',error_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,file_asset_id INTEGER)`,
]
const STAGING_SCHEMA = [
  'CREATE TABLE import_job_source_rows(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT,sequence INTEGER,row_number INTEGER,raw_json TEXT)',
  'CREATE TABLE import_job_rows(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT,phase TEXT,action TEXT,result_json TEXT)',
]

// One fresh in-memory worker per case.
async function withWorker(script, run) {
  const mf = new Miniflare({
    modules: true, script, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB', 'IMPORT_DB'], r2Buckets: ['ASSETS'], log: new Log(LogLevel.NONE),
  })
  try {
    const db = await mf.getD1Database('DB')
    const staging = await mf.getD1Database('IMPORT_DB')
    const r2 = await mf.getR2Bucket('ASSETS')
    for (const sql of SCHEMA) await db.prepare(sql).run()
    for (const sql of STAGING_SCHEMA) await staging.prepare(sql).run()
    const read = async (response) => {
      const text = await response.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* not json */ }
      return { status: response.status, json, text }
    }
    const ctx = {
      db,
      r2,
      sql: (statement, ...binds) => db.prepare(statement).bind(...binds).run(),
      async job(id, status, { ageSql = null, finishedSql = null } = {}) {
        await db.prepare(`INSERT INTO import_jobs(id,status,phase) VALUES(?,?,?)`).bind(id, status, status === 'pending' ? 'created' : status).run()
        if (ageSql) await db.prepare(`UPDATE import_jobs SET created_at = datetime('now', ?), updated_at = datetime('now', ?) WHERE id = ?`).bind(ageSql, ageSql, id).run()
        if (finishedSql) await db.prepare(`UPDATE import_jobs SET finished_at = datetime('now', ?) WHERE id = ?`).bind(finishedSql, id).run()
      },
      // A registered import file written straight to D1/R2 -- no route, so
      // no touch: exactly what a sweep sees mid-upload.
      async file(jobId, kind, name, { ageSql = null, status = 'stored', object = true } = {}) {
        const key = `imports/${jobId}/incoming/${name}`
        if (object) await r2.put(key, kind === 'zip' ? new Uint8Array([0x50, 0x4b, 3, 4]) : 'name,price\nSerum,1\n')
        await db.prepare(`INSERT INTO import_job_files(job_id,kind,stored_path,status) VALUES(?,?,?,?)`).bind(jobId, kind, key, status).run()
        if (ageSql) await db.prepare(`UPDATE import_job_files SET created_at = datetime('now', ?) WHERE stored_path = ?`).bind(ageSql, key).run()
        return key
      },
      async uploadCsv(jobId, name = 'corrected-items.csv') {
        const form = new FormData()
        form.append('file', new File(['name,price\nSerum,1\nToner,2\n'], name, { type: 'text/csv' }))
        // Encode the multipart body in Node and hand Miniflare plain bytes.
        const encoded = new Request('http://encode.local/', { method: 'POST', body: form })
        const body = Buffer.from(await encoded.arrayBuffer())
        const response = await read(await mf.dispatchFetch(`http://local.test/api/import-jobs/${jobId}/csv`, {
          method: 'POST', body, headers: { 'content-type': encoded.headers.get('content-type') },
        }))
        assert.equal(response.status, 200, `the CSV upload itself succeeds: ${response.text}`)
        const row = await db.prepare(`SELECT stored_path FROM import_job_files WHERE job_id = ? AND kind = 'csv' ORDER BY id DESC LIMIT 1`).bind(jobId).first()
        return row.stored_path
      },
      start: async (jobId) => read(await mf.dispatchFetch(`http://local.test/api/import-jobs/${jobId}/start`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      })),
      async sweep(nowMs) {
        const response = await mf.dispatchFetch('http://local.test/__test/sweep', { method: 'POST', body: JSON.stringify({ nowMs }) })
        const json = await response.json()
        assert.equal(json.ok, true, `sweep: ${json.message}`)
        return json.value
      },
      exists: async (key) => Boolean(await r2.head(key)),
      fileStatus: async (key) => (await db.prepare('SELECT status FROM import_job_files WHERE stored_path = ?').bind(key).first())?.status,
      jobStatus: async (id) => (await db.prepare('SELECT status FROM import_jobs WHERE id = ?').bind(id).first())?.status,
    }
    ctx.assertKept = async (key, label) => {
      assert.equal(await ctx.exists(key), true, `${label}: the file is still in R2`)
      assert.equal(await ctx.fileStatus(key), 'stored', `${label}: its row is not marked purged`)
    }
    ctx.assertSwept = async (key, label) => {
      assert.equal(await ctx.exists(key), false, `${label}: the file is deleted`)
      assert.equal(await ctx.fileStatus(key), 'purged', `${label}: its row records the delete`)
    }
    return await run(ctx)
  } finally {
    await mf.dispose()
  }
}

async function main() {
  const script = await bundleWorker()
  let failed = 0
  const check = async (name, fn) => {
    try {
      await withWorker(script, fn)
      console.log(`PASS ${name}`)
    } catch (error) {
      failed += 1
      console.error(`FAIL ${name}`)
      console.error(error)
    }
  }

  await check('the refuter\'s race: a CSV uploaded to a pending job created 25h ago survives the next sweep, and /start accepts it', async (ctx) => {
    await ctx.job('stale', 'pending', { ageSql: '-25 hours' })
    const csv = await ctx.uploadCsv('stale')
    await ctx.sweep(Date.now())
    await ctx.assertKept(csv, 'CSV uploaded a moment ago')
    const start = await ctx.start('stale')
    assert.equal(start.status, 200, `/start must not answer "Upload a CSV": ${start.text}`)
    assert.equal(await ctx.jobStatus('stale'), 'queued')
  })

  await check('a corrected CSV attached to a job that failed 25h ago survives the next sweep, and /start accepts it', async (ctx) => {
    await ctx.job('refix', 'failed', { ageSql: '-25 hours', finishedSql: '-25 hours' })
    // The failed run's own file, already purged when it stopped.
    await ctx.file('refix', 'csv', 'original.csv', { ageSql: '-26 hours', status: 'purged', object: false })
    const csv = await ctx.uploadCsv('refix')
    await ctx.sweep(Date.now())
    await ctx.assertKept(csv, 'corrected CSV uploaded a moment ago')
    const start = await ctx.start('refix')
    assert.equal(start.status, 200, `/start must not answer "Upload a CSV": ${start.text}`)
    assert.equal(await ctx.jobStatus('refix'), 'queued')
  })

  await check('a tick between the R2 put and the row insert: each file is aged by its own upload time (pending job idle 25h)', async (ctx) => {
    await ctx.job('race', 'pending', { ageSql: '-25 hours' })
    const old = await ctx.file('race', 'csv', 'first-try.csv', { ageSql: '-25 hours' })
    const fresh = await ctx.file('race', 'csv', 'second-try.csv')
    // Put a moment ago, row not inserted yet.
    const landing = 'imports/race/incoming/landing-1-aaaaaaaa.csv'
    await ctx.r2.put(landing, 'name,price\n')
    await ctx.sweep(Date.now())
    await ctx.assertSwept(old, 'the 25h-old CSV of the idle job')
    await ctx.assertKept(fresh, 'the CSV registered a moment ago')
    assert.equal(await ctx.exists(landing), true, 'the object whose row has not landed yet is kept')
  })

  await check('a tick between the R2 put and the row insert: each file is aged by its own upload time (job failed 2h ago)', async (ctx) => {
    await ctx.job('race-failed', 'failed', { ageSql: '-2 hours', finishedSql: '-2 hours' })
    const oldZip = await ctx.file('race-failed', 'zip', 'images-1-bbbbbbbb.zip', { ageSql: '-3 hours' })
    const fresh = await ctx.file('race-failed', 'csv', 'corrected-1-cccccccc.csv')
    await ctx.sweep(Date.now())
    await ctx.assertSwept(oldZip, 'the failed run\'s ZIP, terminal for 2h')
    await ctx.assertKept(fresh, 'the CSV attached a moment ago')
  })

  await check('the graces still run out: 1h after the last attach for a failed job, 24h for a never-started one', async (ctx) => {
    const now = Date.now()
    await ctx.job('refix-late', 'failed', { ageSql: '-25 hours', finishedSql: '-25 hours' })
    await ctx.job('abandoned', 'pending', { ageSql: '-25 hours' })
    const refixCsv = await ctx.uploadCsv('refix-late')
    const abandonedCsv = await ctx.uploadCsv('abandoned')
    await ctx.sweep(now + 30 * MINUTE)
    await ctx.assertKept(refixCsv, 'failed job, 30 minutes after the attach')
    await ctx.assertKept(abandonedCsv, 'never started, 30 minutes after the attach')
    await ctx.sweep(now + 2 * HOUR)
    await ctx.assertSwept(refixCsv, 'failed job, 2h after the attach')
    await ctx.assertKept(abandonedCsv, 'never started, 2h after the attach')
    await ctx.sweep(now + 25 * HOUR)
    await ctx.assertSwept(abandonedCsv, 'never started, 25h after the attach')
    const start = await ctx.start('abandoned')
    assert.equal(start.status, 400, start.text)
    assert.match(start.json.error, /Upload a CSV/)
  })

  await check('a job reaped long ago, retried and failed again inside a chunk keeps its file for the full 1h grace', async (ctx) => {
    // finished_at is the first run's (the reaper's); markJobFailed stamps
    // only updated_at, so the grace must run from the later of the two.
    await ctx.job('refailed', 'failed', { ageSql: '-26 hours', finishedSql: '-25 hours' })
    await ctx.sql(`UPDATE import_jobs SET updated_at = datetime('now', '-10 minutes') WHERE id = 'refailed'`)
    const csv = await ctx.file('refailed', 'csv', 'items-1-dddddddd.csv', { ageSql: '-26 hours' })
    await ctx.sweep(Date.now())
    await ctx.assertKept(csv, 'failed 10 minutes ago (a queue retry may still read it)')
    await ctx.sweep(Date.now() + 2 * HOUR)
    await ctx.assertSwept(csv, 'terminal for over an hour')
  })

  await check('running and awaiting-review jobs keep their files whatever their age', async (ctx) => {
    const statuses = ['queued', 'analyzing', 'running', 'applying', 'approved', 'awaiting_review', 'cancelling']
    const keys = []
    for (const status of statuses) {
      const id = `live-${status}`
      await ctx.job(id, status, { ageSql: '-3 days' })
      keys.push([status, await ctx.file(id, 'csv', 'items-1-eeeeeeee.csv', { ageSql: '-3 days' })])
      keys.push([status, await ctx.file(id, 'zip', 'images-1-ffffffff.zip', { ageSql: '-3 days' })])
    }
    await ctx.sweep(Date.now())
    // 25h on, every R2 object is old enough to be an orphan candidate too.
    await ctx.sweep(Date.now() + 25 * HOUR)
    for (const [status, key] of keys) await ctx.assertKept(key, `${status} job, files 3 days old`)
  })

  if (failed) {
    console.error(`${failed} failed`)
    process.exitCode = 1
  } else {
    console.log('PASS the import-file sweep never removes a file younger than its threshold; live jobs keep theirs')
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
