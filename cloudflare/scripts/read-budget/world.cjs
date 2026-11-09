'use strict'
// Read-budget world: the REAL Worker (src/index.ts, bundled in memory) under Miniflare with a counting D1 proxy that
// sums meta.rows_read / rows_written per request and counts physical calls (a db.batch is one call). Seeded once per
// (migrations + seed + bundle) under RUNNER_TEMP with an atomic mkdir lock; every caller works on its own copy.
//   bootWorld({ tier, seedVariant, persistDir, seedTier, switches, enforceCalls, patches }) -> world
//     seedTier: share the seed of another tier (the same data under a different PLAN_TIER)
//     switches: read switches stored for the whole run, { name: 'on' | 'off' } (e.g. { report_atomic: 'on' }), written to the read_switches row before the first request
//     enforceCalls: the 51st D1 call of one request throws, as on Free
//     patches: [{ name, file: 'src/lib/x.ts', from, to }] rewrite source text in memory at bundle time (a mutant); each anchor must occur exactly once
//   runShape(world, shape, { cold, cacheMiss })  -> { status, code, rowsRead, rowsWritten, calls, statements, fingerprints }
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const bcrypt = require('bcryptjs')
const { seedSql, seedContext, ADMIN } = require('./seed.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const ORIGIN = 'http://127.0.0.1:4391'
const DEADLINE_MS = Number(process.env.READ_BUDGET_DEADLINE_MS) || 20000

const WRAPPER = `
import worker, { SyncUploadSession, BroadcastHub } from './src/index';
export { SyncUploadSession, BroadcastHub };
let current = null;
let last = null;
let forceMiss = false;
const queued = [];
let cachePatched = false;
function patchCache() {
  if (cachePatched) return; cachePatched = true;
  const c = caches.default; const realMatch = c.match.bind(c);
  c.match = (...a) => forceMiss ? Promise.resolve(undefined) : realMatch(...a);
}
// The 51st D1 call of one invocation throws, as it does on Free. A db.batch() is ONE call, however many statements it holds.
let callLimit = Infinity;
function tick() {
  if (!current) return;
  current.calls++;
  if (current.calls > callLimit) throw new Error('Too many API requests by single Worker invocation');
}
function note(tag, sql, values) {
  if (!current) return null;
  current.statements++;
  const rec = { tag, raw: String(sql).slice(0, 200000), values: values || [], rr: 0, rw: 0 };
  if (current.stmts.length < 3000) current.stmts.push(rec);
  return rec;
}
function addMeta(rec, meta) {
  if (!current) return;
  const rr = Number(meta && meta.rows_read) || 0, rw = Number(meta && meta.rows_written) || 0;
  current.rr += rr; current.rw += rw;
  if (rec) { rec.rr += rr; rec.rw += rw }
}
function counting(real, tag) {
  const statement = (inner, sql, values) => new Proxy(inner, { get(target, key) {
    if (key === '__inner') return target;
    if (key === '__sql') return sql;
    if (key === '__values') return values;
    if (key === 'bind') return (...vals) => statement(target.bind(...vals), sql, vals);
    if (key === 'all' || key === 'run') return async (...args) => { tick(); const rec = note(tag, sql, values); const r = await target[key](...args); addMeta(rec, r && r.meta); return r };
    if (key === 'first') return async (col) => { tick(); const rec = note(tag, sql, values); const r = await target.all(); addMeta(rec, r && r.meta); const row = r.results[0]; if (!row) return null; return col ? (row[col] ?? null) : row };
    if (key === 'raw') return async (...args) => { tick(); const rec = note(tag, sql, values); if (rec) rec.rawNoMeta = true; return target.raw(...args) };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value } });
  return new Proxy(real, { get(target, key) {
    if (key === 'prepare') return (sql) => statement(target.prepare(sql), sql);
    if (key === 'batch') return async (items) => {
      tick();
      const recs = items.map((i) => note(tag, 'B| ' + String(i.__sql || ''), i.__values));
      if (current) current.batches++;
      const out = await target.batch(items.map((item) => item.__inner || item));
      (out || []).forEach((r, i) => addMeta(recs[i], r && r.meta));
      return out };
    if (key === 'exec') return (sql) => { tick(); note(tag, 'EXEC ' + sql); return target.exec(sql) };
    if (key === 'withSession') return (...a) => counting(target.withSession(...a), tag);
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value } });
}
function fakeQueue(name) {
  return { async send(body, options) { queued.push({ queue: name, body, options }) },
    async sendBatch(messages) { for (const m of messages) queued.push({ queue: name, body: m.body, options: m }) } };
}
let wrappedSource = null, wrapped = null;
function wrapEnv(env) {
  if (wrappedSource === env && wrapped) return wrapped;
  wrappedSource = env;
  callLimit = Number(env.BUDGET_CALL_LIMIT) || Infinity;
  wrapped = { ...env, DB: counting(env.DB, 'db'), IMPORT_DB: env.IMPORT_DB ? counting(env.IMPORT_DB, 'importDb') : undefined,
    IMPORT_QUEUE: fakeQueue('business-os-import'), MEDIA_QUEUE: fakeQueue('business-os-media'), BACKUP_QUEUE: fakeQueue('business-os-backup-assets') };
  return wrapped;
}
async function counted(fn) {
  const counter = { calls: 0, statements: 0, batches: 0, rr: 0, rw: 0, stmts: [] };
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(Promise.resolve(p).catch((e) => { counter.bgError = String(e && e.message || e) })) }, passThroughOnException() {} };
  current = counter;
  let result, error;
  try { result = await fn(ctx) } catch (e) { error = e }
  for (let i = 0; i < pending.length; i++) await pending[i];
  current = null;
  last = counter;
  return { counter, result, error };
}
export default { ...worker, async fetch(request, env, ctx) {
  patchCache();
  const url = new URL(request.url);
  if (url.pathname === '/__budget/last') return Response.json(last);
  const w = wrapEnv(env);
  forceMiss = request.headers.get('x-budget-miss') === '1';
  const { counter, result, error } = await counted((c) => worker.fetch(request, w, c));
  forceMiss = false;
  const h = { 'x-d1-calls': String(counter.calls), 'x-d1-statements': String(counter.statements), 'x-d1-rr': String(counter.rr), 'x-d1-rw': String(counter.rw), 'x-d1-bgerr': counter.bgError ? encodeURIComponent(counter.bgError.slice(0, 200)) : '' };
  if (error) return new Response('WRAPPER ' + String(error && error.stack || error), { status: 599, headers: h });
  const body = await result.arrayBuffer();
  const headers = new Headers(result.headers);
  for (const [k, v] of Object.entries(h)) headers.set(k, v);
  return new Response(body, { status: result.status, headers });
} };
`

async function bundleWorker(patches = []) {
  const applied = new Set()
  const plugins = patches.length ? [{ name: 'read-budget-source-patches', setup(b) {
    b.onLoad({ filter: /[\\/]src[\\/].*\.ts$/ }, (args) => {
      let text = fs.readFileSync(args.path, 'utf8')
      const rel = path.relative(ROOT, args.path).split(path.sep).join('/')
      for (const p of patches.filter((x) => x.file === rel)) {
        if (text.split(p.from).length !== 2) throw new Error('patch ' + p.name + ': anchor must occur exactly once in ' + rel)
        text = text.replace(p.from, () => p.to)
        applied.add(p.name)
      }
      return { contents: text, loader: 'ts' }
    })
  } }] : []
  const out = await build({ plugins, stdin: { contents: WRAPPER, resolveDir: ROOT, loader: 'ts' }, bundle: true, write: false,
    platform: 'browser', format: 'esm', target: 'es2022', conditions: ['workerd', 'worker', 'browser'],
    external: ['node:*', 'cloudflare:*'], nodePaths: [path.join(ROOT, 'node_modules')], logLevel: 'error',
    define: { __WORKER_BUILD_REVISION__: JSON.stringify('readbudget'), __WORKER_BUILD_HASH__: JSON.stringify('readbudgethash'), __WORKER_BUILT_AT__: JSON.stringify('2026-11-02T00:00:00Z') } })
  for (const p of patches) if (!applied.has(p.name)) throw new Error('patch ' + p.name + ' was not applied')
  return out.outputFiles[0].text
}

function outbound(request) {
  const url = new URL(request.url)
  if (url.hostname === 'api.telegram.org') return Response.json({ ok: true, result: { message_id: 1, chat: { id: -100 } } })
  return new Response('External network refused by the read-budget world', { status: 503 })
}

async function migrateDir(db, dir) {
  for (const file of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sqls = split(fs.readFileSync(path.join(dir, file), 'utf8')).filter((s) => s.trim())
      .filter((sql) => !(file === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())))
    try { await db.batch(sqls.map((sql) => db.prepare(sql))) } catch {
      for (const sql of sqls) { try { await db.prepare(sql).run() } catch (error) { throw new Error(`Migration ${file}: ${error.message}`) } }
    }
  }
}

// The bound frontend assets, as far as the Worker reads them: the build manifest that X-BOS-Build is taken from.
const TEST_BUILD_HASH = 'testbuild-1'
const staticAssets = async (request) => (new URL(request.url).pathname === '/business-os-build.json'
  ? Response.json({ revision: 'test', hash: TEST_BUILD_HASH, builtAt: '2026-11-02T00:00:00.000Z' })
  : new Response('not found', { status: 404 }))

function options({ tier, script, persist, extra = {}, callLimit }) {
  const bindings = { ...extra, PLAN_TIER: tier, ...(callLimit ? { BUDGET_CALL_LIMIT: String(callLimit) } : {}), BUSINESS_OS_LOCAL_DEV: '1', BUSINESS_OS_PUBLIC_URL: ORIGIN, BUSINESS_OS_ADMIN_URL: ORIGIN,
    BUSINESS_OS_ORGANIZATION_SLUG: 'budgetorg', BUSINESS_OS_ORGANIZATION_NAME: 'Budget Org', TELEGRAM_BOT_TOKEN: '123456:budget-token', BUSINESS_OS_ADMIN_PASSWORD: ADMIN.bootstrapPassword }
  return { workers: [{ name: 'w0', modules: true, script, compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'db-main', IMPORT_DB: 'db-import' }, r2Buckets: { ASSETS: 'r2-assets' }, kvNamespaces: { CACHE: 'kv-cache' },
    durableObjects: { BROADCAST_HUB: 'BroadcastHub', SYNC_UPLOADS: 'SyncUploadSession' }, serviceBindings: { STATIC_ASSETS: staticAssets }, bindings, outboundService: outbound }],
    log: new Log(LogLevel.ERROR),
    d1Persist: path.join(persist, 'd1'), kvPersist: path.join(persist, 'kv'), r2Persist: path.join(persist, 'r2'), cachePersist: path.join(persist, 'cache'), durableObjectsPersist: path.join(persist, 'do') }
}

function seedKey({ seedVariant, tier, script }) {
  const hash = crypto.createHash('sha256')
  for (const dir of ['migrations', 'migrations-import']) {
    for (const file of fs.readdirSync(path.join(ROOT, dir)).filter((n) => n.endsWith('.sql')).sort()) hash.update(file).update(fs.readFileSync(path.join(ROOT, dir, file)))
  }
  hash.update(fs.readFileSync(path.join(__dirname, 'seed.cjs'))).update(fs.readFileSync(__filename)).update(seedVariant).update(tier).update(script)
  hash.update(seedContext().anchorDate)
  return hash.digest('hex').slice(0, 16)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const STALE_MS = 6 * 3600 * 1000
const age = (p) => { try { return Date.now() - fs.statSync(p).mtimeMs } catch { return 0 } }

// Seeds, locks and work copies left by an earlier run or a killed process.
function pruneStale(tmp, keep) {
  for (const name of fs.readdirSync(tmp)) {
    const full = path.join(tmp, name)
    if (name.startsWith('read-budget-') && full !== keep && full !== keep + '.lock' && age(full) > STALE_MS) fs.rmSync(full, { recursive: true, force: true })
  }
}

// Builds the seeded state into dir. Every statement is a real migration or seed statement run through the D1 binding.
async function buildSeed(dir, { seedVariant, tier, script }) {
  const mf = new Miniflare(options({ tier, script, persist: dir }))
  try {
    const db = await mf.getD1Database('DB', 'w0')
    const importDb = await mf.getD1Database('IMPORT_DB', 'w0')
    await migrateDir(db, path.join(ROOT, 'migrations'))
    await migrateDir(importDb, path.join(ROOT, 'migrations-import'))
    // wrangler keeps this table; ops/queries/migrations-applied.sql reads it.
    await db.prepare('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)').run()
    await db.batch(fs.readdirSync(path.join(ROOT, 'migrations')).filter((n) => n.endsWith('.sql')).sort().map((n) => db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(n)))
    await mf.dispatchFetch(ORIGIN + '/api/settings')
    const org = (await db.prepare("SELECT id FROM organizations WHERE slug='budgetorg'").all()).results[0]
    for (const sql of seedSql({ variant: seedVariant })) {
      try { await db.prepare(sql).run() } catch (e) { throw new Error(`seed: ${sql.slice(0, 160).replace(/\s+/g, ' ')}: ${e.message}`) }
    }
    const hash = bcrypt.hashSync(ADMIN.password, 4)
    await db.prepare("INSERT INTO roles(id,name,code,permissions,is_system) VALUES(901,'Budget admin','admin','{\"all\":true}',0)").run()
    await db.prepare("INSERT INTO users(id,username,name,password,role_id,permissions,is_active,organization_id,must_change_password) VALUES(901,?,'Budget Admin',?,901,'{}',1,?,0)").bind(ADMIN.username, hash, org.id).run()
    // Production state: a stamped build verified AFTER the catalogue exists (watermark = current max product id).
    await db.prepare("DELETE FROM system_flags WHERE key='core_invariants_build'").run()
    await mf.setOptions(options({ tier, script, persist: dir }))
    await mf.dispatchFetch(ORIGIN + '/api/settings')
    const flag = (await (await mf.getD1Database('DB', 'w0')).prepare("SELECT value FROM system_flags WHERE key='core_invariants_build'").all()).results[0]
    if (!flag || !/"status":"verified"/.test(flag.value)) throw new Error('seed: the core invariants gate did not verify the seeded catalogue: ' + (flag && flag.value))
    fs.writeFileSync(path.join(dir, 'org.json'), JSON.stringify({ orgId: org.id }))
  } finally { await mf.dispose() }
}

// First caller builds under an atomic mkdir lock; the others wait for READY and copy.
async function ensureSeed({ seedVariant, tier, script }) {
  const tmp = process.env.RUNNER_TEMP || os.tmpdir()
  const base = path.join(tmp, `read-budget-${seedKey({ seedVariant, tier, script })}`)
  const ready = path.join(base, 'READY')
  const lock = base + '.lock'
  const deadline = Date.now() + 10 * 60 * 1000
  for (;;) {
    if (fs.existsSync(ready)) return base
    let won = false
    try { fs.mkdirSync(lock); won = true } catch (e) { if (e.code !== 'EEXIST') throw e }
    if (!won && age(lock) > 10 * 60 * 1000) { fs.rmSync(lock, { recursive: true, force: true }); continue }
    if (won) {
      try {
        pruneStale(tmp, base)
        fs.rmSync(base, { recursive: true, force: true })
        fs.mkdirSync(base, { recursive: true })
        await buildSeed(base, { seedVariant, tier, script })
        fs.writeFileSync(ready, new Date().toISOString())
        return base
      } finally { fs.rmSync(lock, { recursive: true, force: true }) }
    }
    if (Date.now() > deadline) throw new Error('read-budget seed: gave up waiting for another process to finish seeding ' + base)
    await sleep(1000)
  }
}

// READ_BUDGET_SEED_SCRIPT_FILE pins the bundle that BUILDS the seed (written on first use, then reused), so editing the Worker no
// longer re-seeds for ~4 minutes. The run itself always uses the fresh bundle: the seed is then data made by an older build, which is
// what production is. Unset = the seed is keyed by the fresh bundle, exactly as before.
function seedScriptFor(script) {
  const pinned = process.env.READ_BUDGET_SEED_SCRIPT_FILE
  if (!pinned) return script
  if (!fs.existsSync(pinned)) { fs.mkdirSync(path.dirname(pinned), { recursive: true }); fs.writeFileSync(pinned, script) }
  return fs.readFileSync(pinned, 'utf8')
}

async function bootWorld({ tier = 'free', seedVariant = 'base', persistDir, seedTier = tier, switches, enforceCalls = false, patches = [] } = {}) {
  const cleanScript = await bundleWorker()
  const script = patches.length ? await bundleWorker(patches) : cleanScript
  const callLimit = enforceCalls ? 50 : 0
  const seeded = await ensureSeed({ seedVariant, tier: seedTier, script: seedScriptFor(cleanScript) })
  const persist = persistDir || fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'read-budget-work-'))
  fs.rmSync(persist, { recursive: true, force: true })
  fs.cpSync(seeded, persist, { recursive: true })
  const { orgId } = JSON.parse(fs.readFileSync(path.join(persist, 'org.json'), 'utf8'))
  const mf = new Miniflare(options({ tier, script, persist, callLimit }))
  const world = { mf, tier, persist, orgId, script, cookie: null, ctx: seedContext(), deadlineHits: 0 }
  world.db = await mf.getD1Database('DB', 'w0')
  const refresh = async () => { world.db = await mf.getD1Database('DB', 'w0') }
  // restart(extra) starts a fresh isolate on the same storage; `extra` bindings (CF_VERSION_METADATA: { id } simulates a deploy) stay for later restarts.
  world.extra = {}
  world.restart = async (extra) => { if (extra !== undefined) world.extra = extra; await mf.setOptions(options({ tier, script, persist, extra: world.extra, callLimit })); await refresh() }
  // The switches row, in the shape lib/readSwitches.ts reads. A later isolate restart reads it afresh.
  world.setSwitches = async (map) => {
    await world.db.prepare("INSERT OR REPLACE INTO system_flags(key, value) VALUES('read_switches', ?)").bind(JSON.stringify({ epoch: 1, switches: map })).run()
  }
  world.all = async (sql, ...values) => (await world.db.prepare(sql).bind(...values).all()).results
  // One request through the counting proxy. Past the deadline the isolate is restarted (a runaway statement dies with it).
  world.send = async (method, url, body, opts = {}) => {
    const cookie = opts.cookie === undefined ? world.cookie : opts.cookie
    const init = { method, headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: ORIGIN, ...(cookie ? { cookie } : {}), ...(opts.miss ? { 'x-budget-miss': '1' } : {}) },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }
    const started = Date.now()
    let timer
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), opts.deadlineMs || DEADLINE_MS) })
    const response = await Promise.race([mf.dispatchFetch(ORIGIN + url, init), timeout])
    clearTimeout(timer)
    if (!response) {
      world.deadlineHits += 1
      await world.restart()
      return { status: 0, overDeadline: true, ms: Date.now() - started, calls: NaN, statements: NaN, rr: NaN, rw: NaN, json: null, text: '' }
    }
    const text = await response.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* not JSON */ }
    const h = (k) => response.headers.get(k)
    const cache = /cache;desc="(\w+)"/.exec(h('server-timing') || '')
    return { status: response.status, cache: cache ? cache[1] : undefined, ms: Date.now() - started, calls: Number(h('x-d1-calls')), statements: Number(h('x-d1-statements')), rr: Number(h('x-d1-rr')), rw: Number(h('x-d1-rw')),
      bgError: decodeURIComponent(h('x-d1-bgerr') || '') || undefined, setCookie: h('set-cookie'), json, text }
  }
  world.last = async () => (await mf.dispatchFetch(ORIGIN + '/__budget/last')).json()
  world.login = async () => {
    const r = await world.send('POST', '/api/auth/login', { username: ADMIN.username, password: ADMIN.password, organizationId: orgId }, { cookie: null })
    if (r.status !== 200) throw new Error('login ' + r.status + ' ' + r.text.slice(0, 300))
    world.cookie = r.setCookie.split(';')[0]
  }
  world.analyze = async () => { await world.db.prepare('ANALYZE').run() }
  // Stored once, before the first request of the run, through the raw binding: the isolate reads it like production does and no later flip,
  // restart or login can move the rows another shape reads.
  if (switches && Object.keys(switches).length) await world.setSwitches(switches)
  world.dispose = async () => { await mf.dispose(); fs.rmSync(persist, { recursive: true, force: true }) }
  await world.restart()
  await world.login()
  return world
}

const normalizeSql = (sql) => String(sql).replace(/\s+/g, ' ').trim()
const fingerprintOf = (stmts) => (stmts || []).map((s) => ({ h: crypto.createHash('sha1').update(normalizeSql(s.raw)).digest('hex').slice(0, 12), head: normalizeSql(s.raw).slice(0, 110) }))

// Cold = fresh isolate (same storage); cacheMiss = the Cache API answers nothing.
// shape: { method, url, body, anon } or { prepare(world) -> prepared, run(world, send, prepared) -> result of the one measured send }.
// prepare runs before the restart, so a cold shape's measured request is the first on its isolate.
async function runShape(world, shape, { cold = false, cacheMiss = true, counts, fingerprints = false } = {}) {
  const prepared = shape.prepare ? await shape.prepare(world) : undefined
  if (cold) await world.restart()
  const countsBefore = counts ? await counts(world) : undefined
  let measured
  const send = async (method, url, body) => { measured = await world.send(method, url, body, { miss: cacheMiss, cookie: shape.anon ? null : undefined }); return measured }
  const result = (shape.run ? await shape.run(world, send, prepared) : await send(shape.method || 'GET', shape.url, shape.body)) || measured
  const out = { status: result.status, cache: result.cache, code: (result.json && result.json.code) || undefined, overDeadline: result.overDeadline || false,
    rowsRead: result.rr, rowsWritten: result.rw, calls: result.calls, statements: result.statements, ms: result.ms, bgError: result.bgError, json: result.json }
  if (counts) { out.countsBefore = countsBefore; out.countsAfter = await counts(world) }
  if (fingerprints && !result.overDeadline) out.fingerprints = fingerprintOf((await world.last()).stmts)
  return out
}

// The statements of the last request with their bound values, for EXPLAIN QUERY PLAN checks.
async function lastStatements(world) {
  return ((await world.last()).stmts || []).map((s) => ({ sql: s.raw.replace(/^B\| /, ''), values: s.values || [], rr: s.rr }))
}

async function explain(world, stmt) {
  if (!/^\s*(WITH|SELECT)/i.test(stmt.sql)) return null
  const rows = (await world.db.prepare('EXPLAIN QUERY PLAN ' + stmt.sql).bind(...stmt.values).all()).results
  return rows.map((r) => r.detail)
}

module.exports = { bootWorld, runShape, lastStatements, explain, normalizeSql, fingerprintOf, ROOT, ORIGIN, DEADLINE_MS, TEST_BUILD_HASH }
