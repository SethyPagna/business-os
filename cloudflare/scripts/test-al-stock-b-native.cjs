'use strict'
// ============================================================================================
// HARNESS -- identical in all four test-al-stock-{a,b,i,k}-native.cjs files (each file is
// self-contained on purpose: this lane may only ADD files named test-al-stock-<letter>-native.cjs).
//
// What it runs: the REAL Worker (cloudflare/src/index.ts, every middleware, route and lib) bundled
// with esbuild and executed in workerd under Miniflare, on a D1 migrated with every file in
// cloudflare/migrations, with real KV (cache versions), R2, Durable Objects (the live-update
// WebSocket hub) and a real session cookie. Nothing in src/ is changed. Only authentication
// credential entry is shortcut: the session row is inserted directly (same SHA-256 token hash the
// real login stores) so a user can be given an exact permission set.
//
// A thin wrapper entry sits in FRONT of the Worker (never inside it) so that a test can
//   (a) count D1 statements per invocation (foreground + waitUntil), the number compared with the
//       Free 50 / Paid 1000 per-invocation limits,
//   (b) arm a deterministic interleaving: run request X to completion at the instant request Y is
//       about to execute a matching D1 statement (`hook`), or hold N requests at a matching
//       statement until all have arrived (`barrier`),
//   (c) arm a lost acknowledgement at the D1 binding: the batch really commits, then the call
//       throws a transient "Network connection lost" error, exactly what lib/db.ts withD1Retry
//       treats as retryable.
// Mutation controls (`--fix`, `--wrong=<name>`) rewrite SOURCE TEXT IN MEMORY at bundle time; they
// never touch a file on disk and fail loudly if their anchor text is missing.
// ============================================================================================
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const root = path.resolve(__dirname, '..')
const ARGS = process.argv.slice(2)
const FLAGS = new Set(ARGS.filter(a => a.startsWith('--') && !a.includes('=')).map(a => a.slice(2)))
const OPTIONS = Object.fromEntries(ARGS.filter(a => a.startsWith('--') && a.includes('=')).map(a => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]))
const sha256 = text => createHash('sha256').update(text).digest('hex')

const WRAPPER = `
import worker from './src/index'
export { SyncUploadSession, BroadcastHub } from './src/index'

const control = { hooks: [], barrier: null, ackLoss: [], queueStatements: 0 }
const rawFetch = (request, env, ctx) => worker.fetch(request, env, ctx)
function matches(pattern, sqls) { const re = new RegExp(pattern, 'i'); return sqls.some(sql => re.test(sql)) }

function wrapDb(db, counter, env) {
  const statement = (inner, sql) => ({
    sql, inner,
    bind: (...args) => statement(inner.bind(...args), sql),
    first: async (...a) => { await before([sql], env); counter.n++; counter.log.push(sql); const r = await inner.first(...a); await after([sql]); return r },
    all: async (...a) => { await before([sql], env); counter.n++; counter.log.push(sql); const r = await inner.all(...a); await after([sql]); return r },
    run: async (...a) => { await before([sql], env); counter.n++; counter.log.push(sql); const r = await inner.run(...a); await after([sql]); return r },
    raw: async (...a) => { await before([sql], env); counter.n++; counter.log.push(sql); const r = await inner.raw(...a); await after([sql]); return r },
  })
  return {
    prepare: (sql) => statement(db.prepare(sql), sql),
    batch: async (statements) => {
      const sqls = statements.map(s => s.sql)
      await before(sqls, env)
      counter.n += statements.length
      for (const sql of sqls) counter.log.push(sql)
      const result = await db.batch(statements.map(s => s.inner))
      await after(sqls)
      return result
    },
    exec: (q) => db.exec(q),
  }
}

async function before(sqls, env) {
  if (control.barrier && matches(control.barrier.pattern, sqls)) {
    const barrier = control.barrier
    barrier.arrived++
    if (barrier.arrived >= barrier.count) barrier.release()
    await Promise.race([barrier.promise, new Promise(resolve => setTimeout(resolve, 20000))])
  }
  for (const hook of control.hooks) {
    if (hook.fired || !matches(hook.pattern, sqls)) continue
    hook.fired = true
    const request = new Request(hook.request.url, { method: hook.request.method, headers: hook.request.headers, body: hook.request.body })
    const response = await handle(request, env.__raw, env.__ctx)
    hook.result = { status: response.status, body: await response.text() }
  }
}

async function after(sqls) {
  for (const fault of control.ackLoss) {
    if (fault.times > 0 && matches(fault.pattern, sqls)) {
      fault.times--
      fault.hits++
      throw new Error(fault.message || 'D1_ERROR: Network connection lost')
    }
  }
}

function instrument(rawEnv, ctx, counter) {
  const pending = []
  const env = { ...rawEnv, __raw: rawEnv }
  env.DB = wrapDb(rawEnv.DB, counter, env)
  const ctx2 = { waitUntil(p) { pending.push(Promise.resolve(p).catch(() => {})); try { ctx.waitUntil(p) } catch (e) {} }, passThroughOnException() {} }
  env.__ctx = ctx2
  return { env, ctx2, pending }
}

async function drain(pending) {
  for (let i = 0; i < 20; i++) { const before = pending.length; await Promise.allSettled(pending.slice()); if (pending.length === before) break }
}

async function handle(request, rawEnv, ctx) {
  const url = new URL(request.url)
  if (url.pathname.startsWith('/__al/')) return control_(url, request)
  const counter = { n: 0, log: [] }
  const { env, ctx2, pending } = instrument(rawEnv, ctx, counter)
  const response = await rawFetch(request, env, ctx2)
  if (response.webSocket) return response
  await drain(pending)
  const headers = new Headers(response.headers)
  headers.set('x-al-d1', String(counter.n))
  // The statement log rides in a response header; a request that runs hundreds of statements (a chunked import) would
  // overflow the header limit and drop the connection, so only the first 40 are carried. The count is x-al-d1.
  headers.set('x-al-sql', encodeURIComponent(JSON.stringify(counter.log.slice(0, 40).map(s => s.replace(/\\s+/g, ' ').trim().slice(0, 120)))))
  return new Response(response.body, { status: response.status, headers })
}

async function control_(url, request) {
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}
  switch (url.pathname) {
    case '/__al/hooks': control.hooks = (body.hooks || []).map(h => ({ ...h, fired: false })); return Response.json({ ok: true })
    case '/__al/hooks/result': return Response.json(control.hooks.map(h => ({ fired: h.fired, result: h.result || null })))
    case '/__al/barrier': {
      if (!body.pattern) { control.barrier = null; return Response.json({ ok: true }) }
      let release; const promise = new Promise(r => { release = r })
      control.barrier = { pattern: body.pattern, count: body.count || 2, arrived: 0, release, promise }
      return Response.json({ ok: true })
    }
    case '/__al/barrier/result': return Response.json({ arrived: control.barrier ? control.barrier.arrived : null })
    case '/__al/ackloss': control.ackLoss = (body.faults || []).map(f => ({ ...f, hits: 0 })); return Response.json({ ok: true })
    case '/__al/ackloss/result': return Response.json(control.ackLoss)
    case '/__al/reset': control.hooks = []; control.barrier = null; control.ackLoss = []; return Response.json({ ok: true })
    case '/__al/queue-statements': return Response.json({ n: control.queueStatements })
    default: return new Response('unknown', { status: 404 })
  }
}

export default {
  fetch: (request, env, ctx) => handle(request, env, ctx),
  async queue(batch, rawEnv, ctx) {
    const counter = { n: 0, log: [] }
    const { env, ctx2, pending } = instrument(rawEnv, ctx, counter)
    try { return await worker.queue(batch, env, ctx2) } finally { await drain(pending); control.queueStatements = counter.n }
  },
}
`

// In-memory source rewrites. `patches` = [{ name, file: 'src/...ts', from, to }]. Line endings are normalised first
// (the working tree may be CRLF), and a missing anchor is a hard error, never a silent no-op.
async function bundle(patches) {
  const { build } = require('esbuild')
  const applied = new Set()
  const result = await build({
    stdin: { contents: WRAPPER, resolveDir: root, loader: 'ts', sourcefile: 'al-wrapper.ts' },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], logLevel: 'error',
    plugins: [{ name: 'al-source-patches', setup(b) {
      b.onLoad({ filter: /[\\/]cloudflare[\\/]src[\\/].*\.ts$/ }, args => {
        const here = args.path.replaceAll('\\', '/')
        const mine = patches.filter(p => here.endsWith('/cloudflare/' + p.file))
        if (!mine.length) return undefined
        let text = fs.readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n')
        for (const p of mine) {
          assert.equal(text.split(p.from).length - 1, 1, 'negative-control anchor must occur exactly once in ' + p.file + ': ' + p.from.slice(0, 80))
          text = text.replace(p.from, () => p.to)
          applied.add(p.name)
        }
        return { contents: text, loader: 'ts' }
      })
    } }],
  })
  for (const p of patches) assert.ok(applied.has(p.name), 'patch ' + p.name + ' was not applied')
  return result.outputFiles[0].text
}

async function migrate(db) {
  const { unstable_splitSqlQuery: split } = require('wrangler')
  const dir = path.join(root, 'migrations')
  const statements = []
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) {
    for (const statement of split(fs.readFileSync(path.join(dir, name), 'utf8')).filter(s => s.trim())) {
      // Miniflare's test D1 caps compound SELECT terms lower than the deployed runner; this one seed statement is a
      // no-op on an empty users table (same exemption test-customer-return-create-d1-native.cjs makes).
      if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
      statements.push({ name, statement })
    }
  }
  for (let i = 0; i < statements.length; i += 100) {
    const chunk = statements.slice(i, i + 100)
    try { await db.batch(chunk.map(x => db.prepare(x.statement))) } catch (error) { error.message = chunk[0].name + '+: ' + error.message; throw error }
  }
}

const LC = 1   // LC Store: the only active branch
const OLD = 2  // Old Shop: inactive, successor = LC Store

async function world({ patches = [], plan = 'paid' } = {}) {
  const { Miniflare, Log, LogLevel } = require('miniflare')
  const script = await bundle(patches)
  const mf = new Miniflare({
    modules: true, script, compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat', 'no_handle_cross_request_promise_resolution'],
    d1Databases: ['DB'], kvNamespaces: ['CACHE'], r2Buckets: ['ASSETS'],
    durableObjects: { BROADCAST_HUB: 'BroadcastHub', SYNC_UPLOADS: 'SyncUploadSession' },
    bindings: { PLAN_TIER: plan, BUSINESS_OS_PUBLIC_URL: 'https://leangbeauty.com', BUSINESS_OS_ADMIN_URL: 'https://admin.leangbeauty.com',
      BUSINESS_OS_ADMIN_PASSWORD: 'al-repro-admin-password-1', BUSINESS_OS_ORGANIZATION_SLUG: 'leangbeauty' },
    log: new Log(LogLevel.ERROR),
  })
  const db = await mf.getD1Database('DB')
  const kv = await mf.getKVNamespace('CACHE')
  await migrate(db)
  // First request: the Worker seeds its default organization / branches / roles / admin (22 D1 statements, once per isolate).
  await mf.dispatchFetch('http://localhost/api/settings')
  // Owner rule: LC Store (id 1) is the only active branch; Old Shop (id 2) is inactive and redirects to it.
  await db.batch([
    db.prepare("UPDATE branches SET is_active=0,is_default=0,name='Old Shop',role='shop',canonical_key='shop',successor_branch_id=1 WHERE id=2"),
    db.prepare("UPDATE branches SET name='LC Store',role='warehouse',canonical_key='warehouse',is_default=1,is_active=1 WHERE id=1"),
  ])
  const H = { mf, db, kv, frames: [], tokens: {}, sockets: [] }

  H.addUser = async (id, username, permissions, extra = {}) => {
    await db.prepare(`INSERT INTO users(id,username,name,password,role_id,permissions,is_active,organization_id,organization_group_id)
      VALUES(?,?,?,?,?,?,1,2,2)`).bind(id, username, extra.name || username, 'x', extra.role_id ?? null, JSON.stringify(permissions)).run()
  }
  H.addSession = async (name, userId, { device = 'Test Device', tz = 'Asia/Phnom_Penh', lastSeenSecondsAgo = 0 } = {}) => {
    const token = 'tok-' + name + '-' + sha256(name + userId + device).slice(0, 8)
    H.tokens[name] = token
    await db.prepare(`INSERT INTO user_sessions(user_id,token_hash,device_name,device_tz,expires_at,last_seen_at)
      VALUES(?,?,?,?,'2099-01-01T00:00:00.000Z',datetime('now', ?))`).bind(userId, sha256(token), device, tz, `-${lastSeenSecondsAgo} seconds`).run()
    return token
  }
  await H.addSession('admin', 1, { device: 'Owner Laptop', lastSeenSecondsAgo: 1 })

  H.api = async (method, route, body, { as = 'admin', headers = {} } = {}) => {
    const response = await mf.dispatchFetch('http://localhost' + route, {
      method, headers: { 'content-type': 'application/json', cookie: 'bos_session=' + H.tokens[as], ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    let json; try { json = JSON.parse(text) } catch { json = text }
    let sql = []; try { sql = JSON.parse(decodeURIComponent(response.headers.get('x-al-sql') || '[]')) } catch { /* none */ }
    return { status: response.status, body: json, d1: Number(response.headers.get('x-al-d1') || 0), sql }
  }
  H.multipart = async (route, field, name, content, { as = 'admin' } = {}) => {
    const form = new FormData(); form.set(field, new File([content], name, { type: 'text/csv' }))
    const encoded = new Request('http://encode.local/', { method: 'POST', body: form })
    const response = await mf.dispatchFetch('http://localhost' + route, { method: 'POST',
      headers: { cookie: 'bos_session=' + H.tokens[as], 'content-type': encoded.headers.get('content-type') }, body: Buffer.from(await encoded.arrayBuffer()) })
    return { status: response.status, body: await response.json().catch(() => null), d1: Number(response.headers.get('x-al-d1') || 0) }
  }
  H.control = async (route, body) => (await mf.dispatchFetch('http://localhost/__al/' + route, { method: 'POST', body: JSON.stringify(body || {}) })).json()
  H.controlGet = async route => (await mf.dispatchFetch('http://localhost/__al/' + route)).json()
  H.disarm = () => H.control('reset')
  H.hookRequest = (method, route, body, as = 'admin') => ({ url: 'http://localhost' + route, method,
    headers: { 'content-type': 'application/json', cookie: 'bos_session=' + H.tokens[as] }, body: body === undefined ? undefined : JSON.stringify(body) })
  // Live-update socket: the real BroadcastHub Durable Object pushes `sync:update` frames to it.
  H.listen = async () => {
    const response = await mf.dispatchFetch('http://localhost/ws', { headers: { Upgrade: 'websocket', cookie: 'bos_session=' + H.tokens.admin } })
    assert.equal(response.status, 101, 'websocket upgrade')
    response.webSocket.accept()
    response.webSocket.addEventListener('message', event => { try { H.frames.push(JSON.parse(String(event.data))) } catch { /* ignore */ } })
    H.sockets.push(response.webSocket)
  }
  H.settle = (ms = 250) => new Promise(resolve => setTimeout(resolve, ms))
  H.syncFrames = (since = 0) => H.frames.slice(since).filter(f => f.type === 'sync:update')
  H.cacheVersion = async (ns = 'products') => Number((await kv.get('v2:' + ns)) || 0)
  H.q = async (sql, ...bind) => (await db.prepare(sql).bind(...bind).all()).results
  H.q1 = async (sql, ...bind) => (await db.prepare(sql).bind(...bind).first())
  H.dispose = async () => { for (const s of H.sockets) { try { s.close() } catch { /* ignore */ } } await mf.dispose() }
  await H.listen()
  return H
}

// ------------------------------------------------------------------------------------------------
// Reporting: a case collects every violated invariant (soft assertions) and is RED if there is any.
// ------------------------------------------------------------------------------------------------
const results = []
function caseRun(id, title, severity) {
  const misses = []
  const notes = []
  const t = {
    eq(label, actual, expected) {
      const a = JSON.stringify(actual), e = JSON.stringify(expected)
      if (a !== e) misses.push(label + ': expected ' + e + ' but actual ' + a)
    },
    ok(label, condition, detail) { if (!condition) misses.push(label + (detail === undefined ? '' : ': ' + JSON.stringify(detail))) },
    note(text) { notes.push(text) },
  }
  return { t, misses, notes, id, title, severity }
}
async function check(id, title, severity, fn) {
  // --only=ID[,ID...] runs just those cases (debugging aid; a full run is the default and the only certified one).
  if (OPTIONS.only && !OPTIONS.only.split(',').includes(id)) return
  const c = caseRun(id, title, severity)
  try { await fn(c.t) } catch (error) { c.misses.push('THREW ' + (error && error.stack ? error.stack.split('\n').slice(0, 4).join(' | ') : String(error))) }
  const red = c.misses.length > 0
  results.push({ id, title, severity, red, misses: c.misses, notes: c.notes })
  console.log((red ? 'RED   ' : 'GREEN ') + id + '  [' + severity + ']  ' + title)
  for (const m of c.misses) console.log('        - ' + m)
  for (const n of c.notes) console.log('        . ' + n)
}
function finish(finding) {
  const red = results.filter(r => r.red)
  console.log('\nSUMMARY ' + finding + ': ' + (results.length - red.length) + ' GREEN, ' + red.length + ' RED' + (red.length ? ' -> ' + red.map(r => r.id).join(', ') : ''))
  if (red.length) process.exitCode = 1
}

// ============================================================================================
// FINDING B -- inventory CSV Remove and Set (import job type "inventory", policy.inventory_action "remove" / "set").
// This is the Remove/Set import. The Add import is a different, already receipt-planned path and is not exercised here.
//
// The whole flow runs over HTTP: POST /api/import-jobs -> POST /:id/csv -> POST /:id/start (classify + analyze)
// -> GET /:id/review -> POST /:id/approve (apply, chunked, finalised). The Worker has no IMPORT_QUEUE binding in this
// harness, so the queue messages run inline in the request; redelivery is driven through the Worker's real queue()
// handler. D1 statement counts are therefore per inline invocation (see the report for how the queue splits them).
//
// Correct outcome under the owner's rules: with 10 on hand (lots A = 5, B = 5) a CSV "Remove 2" leaves 8 in EVERY ledger
// (the lots, branch_stock, products.stock_quantity) and one movement of 2 that names the lot it came out of; a "Set N" is
// judged against the SELECTED branch's own on-hand, not the all-branch total; a Remove larger than what the branch holds is
// refused at analysis; a redelivered chunk applies each row once; the finished job and the cache/live frames say what happened.
// The CSV has no lot column, so "by lot" means the removal must come out of the lot ledger (oldest received first, the same
// rule the till and POST /api/inventory/adjust use when no lot is chosen).
//
// Run (from cloudflare/):  node scripts/test-al-stock-b-native.cjs
// The fix landed in 6.0.56 (Remove / Set rows judged against the row's branch; applied through the lot ledger,
// branch_stock, the product total and the movement in one guarded group), so the repro's in-memory `--fix` patch set
// is retired: its anchors no longer exist. The mutants now target the landed code:
//   --wrong=no-row-guard           mutant: the per-row redelivery guard is a no-op (B5 must catch the double apply)
//   --wrong=aggregate-availability mutant: on-hand is read as the ALL-branch total (B1e and B1c must catch it)
//   --wrong=no-lot-drain           mutant: the lot decrement is a no-op, only branch_stock and the product move (B2)
//   --wrong=unlotted-increase      mutant: a Set above the count adds to branch_stock with no lot (B3: the till reads lots)
//   --wrong=no-applied-override    mutant: a redelivered row that already applied is judged again against stock that
//                                  includes it (B5c: reported as failed although applied)
//   --only=B2,B5                   run just those cases (debugging aid)
//   The B*-control-adjust cases run the same operation through POST /api/inventory/adjust (the live, correct writer) against
//   the same invariants: they must be GREEN, which proves the assertions are satisfiable by this codebase.
// ============================================================================================
const IMPORT_ENGINE = 'src/lib/importEngine.ts'
const PATCHES = {
  'aggregate-availability': [
    { name: 'aggregate-select', file: IMPORT_ENGINE,
      from: 'SELECT bs.product_id, bs.branch_id, bs.quantity',
      to: "SELECT json_extract(pair.value, '$[0]') AS product_id, json_extract(pair.value, '$[1]') AS branch_id, (SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id = json_extract(pair.value, '$[0]')) AS quantity" },
    { name: 'aggregate-join', file: IMPORT_ENGINE,
      from: "\n    JOIN branch_stock bs ON bs.product_id = json_extract(pair.value, '$[0]') AND bs.branch_id = json_extract(pair.value, '$[1]')`)",
      to: '`)' },
  ],
  'no-lot-drain': [
    { name: 'no-lot-drain', file: IMPORT_ENGINE,
      from: "UPDATE branch_batch_stock SET quantity = quantity - (SELECT json_extract(t.value,'$.quantity') FROM json_each(@takes) t",
      to: "UPDATE branch_batch_stock SET quantity = quantity - 0 * (SELECT json_extract(t.value,'$.quantity') FROM json_each(@takes) t" },
  ],
  'unlotted-increase': [
    { name: 'unlotted-increase', file: IMPORT_ENGINE,
      from: '    for (const entry of increased) statements.push(...entry.increase!.statements.map(asStatement))',
      to: '    void asStatement' },
  ],
  'no-applied-override': [
    { name: 'no-applied-override', file: IMPORT_ENGINE,
      from: "    return appliedRowGuards.has(`row:${result.rowNumber}`) && analyzed?.action === 'create' ? analyzed : result",
      to: '    return result' },
  ],
  'no-row-guard': [
    { name: 'no-row-guard', file: IMPORT_ENGINE,
      from: [
        '    const rowGuardStatement = (rowNumber: number) => ({',
        '      sql: `INSERT INTO import_stock_action_guards (job_id, action_key, guard_key, guard_value) VALUES (@jobId, @actionKey, @guardKey, 1)`,'].join('\n'),
      to: [
        '    const rowGuardStatement = (rowNumber: number) => ({',
        '      sql: `SELECT @jobId AS job_id, @actionKey AS action_key, @guardKey AS guard_key`,'].join('\n') },
  ],
}

let seq = 0
async function seedProduct(H, { lc, old = 0, a, b, name }) {
  const n = ++seq, p = 400 + n, lotA = p * 10 + 1, lotB = p * 10 + 2
  const nm = name || 'AL Csv ' + p, bar = '88500' + String(p).padStart(8, '0')
  await H.db.batch([
    H.db.prepare('INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active) VALUES(?,?,?,2,0,?,1)').bind(p, nm, bar, lc + old),
    H.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').bind(p, LC, lc),
    ...(old ? [H.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').bind(p, OLD, old)] : []),
    ...(a != null ? [
      H.db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(?,?,?,?,?,1,3,1)").bind(lotA, p, 'A' + p, 'A' + p, '2026-09-02'),
      H.db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(?,?,?,?,?,2,5,1)").bind(lotB, p, 'B' + p, 'B' + p, '2026-09-09'),
      H.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)').bind(lotA, LC, a),
      H.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)').bind(lotB, LC, b),
    ] : []),
  ])
  return { p, lotA, lotB, name: nm, barcode: bar }
}

async function ledger(H, s) {
  const lots = (await H.q('SELECT batch_id id, quantity q FROM branch_batch_stock WHERE batch_id IN (?,?) AND branch_id=? ORDER BY batch_id', s.lotA, s.lotB, LC)).map(r => r.q)
  return {
    lots, lotsSum: lots.reduce((a, b) => a + b, 0),
    // Every lot of the product at LC Store, including one an import creates (the counted lot of a Set increase).
    allLotsSum: (await H.q1('SELECT COALESCE(SUM(bbs.quantity),0) q FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id WHERE pb.variant_product_id=? AND bbs.branch_id=?', s.p, LC)).q,
    branch: (await H.q1('SELECT quantity q FROM branch_stock WHERE product_id=? AND branch_id=?', s.p, LC))?.q ?? null,
    old: (await H.q1('SELECT quantity q FROM branch_stock WHERE product_id=? AND branch_id=?', s.p, OLD))?.q ?? 0,
    product: (await H.q1('SELECT stock_quantity q FROM products WHERE id=?', s.p)).q,
    movements: await H.q('SELECT movement_type t, quantity q, branch_id br, batch_id b FROM inventory_movements WHERE product_id=? ORDER BY id', s.p),
  }
}
const OUT = new Set(['out', 'remove']), IN = new Set(['in', 'add'])
const netMoved = movements => movements.reduce((sum, m) => sum + (OUT.has(m.t) ? -Number(m.q) : IN.has(m.t) ? Number(m.q) : 0), 0)

async function importCsv(H, action, rows, { approve = true } = {}) {
  const created = await H.api('POST', '/api/import-jobs', { type: 'inventory', policy: { source: 'al-repro', inventory_action: action } })
  const id = created.body.job.id
  const csv = 'date,branch,name,sku,barcode,quantity,reason\n' + rows.map(r => r.join(',')).join('\n') + '\n'
  const upload = await H.multipart('/api/import-jobs/' + id + '/csv', 'file', action + '.csv', csv)
  const start = await H.api('POST', '/api/import-jobs/' + id + '/start')
  const review = await H.api('GET', '/api/import-jobs/' + id + '/review?pageSize=200')
  const approved = approve ? await H.api('POST', '/api/import-jobs/' + id + '/approve', {}) : null
  const detail = (await H.api('GET', '/api/import-jobs/' + id)).body
  return { id, upload, start, review: review.body, approved, job: detail.job, errors: detail.errors }
}
const row = (s, qty, reason) => ['', 'LC Store', s.name, '', s.barcode, String(qty), reason || 'AL CSV']

// Drive the Worker's real queue() consumer, exactly as Cloudflare Queues redelivers a message whose first attempt died.
async function redeliver(H, jobId, kind, attempts) {
  const worker = await H.mf.getWorker()
  await worker.queue('business-os-import', [{ id: 'al-msg-' + attempts, timestamp: new Date(), body: { jobId, kind }, attempts }])
}

async function main() {
  if (FLAGS.has('fix')) assert.fail('--fix is retired: the fix landed in source (6.0.56). Run without flags, or with --wrong=<mutant>.')
  const flavour = OPTIONS.wrong
  const patches = flavour ? (PATCHES[flavour] || assert.fail('unknown control ' + flavour)) : []
  console.log('MODE: ' + (flavour ? 'control ' + flavour : 'production code at HEAD (no patch)'))
  const H = await world({ patches })
  let F
  try {
    // ------------------------------------------------------------------ B1: classify / analyze
    await check('B1a', 'classify+analyze: Remove 2 with 10 on hand is an actionable row of -2', 'control', async (t) => {
      const s = await seedProduct(H, { lc: 10, a: 5, b: 5 })
      const r = await importCsv(H, 'remove', [row(s, 2)], { approve: false })
      t.eq('job reached review', r.job.status, 'awaiting_review')
      t.eq('analysed row', r.review.rows.map(x => [x.action, x.data.movement_type, x.data.signedQuantity, x.data.branch_id]), [['create', 'out', -2, LC]])
      t.note('D1 statements, one inline invocation each: upload ' + r.upload.d1 + ', start(analyze) ' + r.start.d1)
    })
    await check('B1b', 'classify+analyze: Remove 12 with 10 on hand is REFUSED at analysis (row error naming the available quantity)', 'high', async (t) => {
      const s = await seedProduct(H, { lc: 10, a: 5, b: 5 })
      const r = await importCsv(H, 'remove', [row(s, 12)], { approve: false })
      t.eq('analysed row action', r.review.rows.map(x => x.action), ['error'])
      t.ok('error message names the shortage', /10|available|enough|insufficient/i.test(String(r.review.rows[0]?.message || '')), r.review.rows[0]?.message ?? null)
    })
    await check('B1c', 'classify+analyze: Set LC Store (7; Old Shop still holds 3; total 10) to 9 is +2 against LC Store, not -1 against the total', 'high', async (t) => {
      const s = await seedProduct(H, { lc: 7, old: 3, a: 4, b: 3 })
      const r = await importCsv(H, 'set', [row(s, 9)], { approve: false })
      t.eq('analysed Set delta for the selected branch', r.review.rows.map(x => [x.data.movement_type, x.data.signedQuantity, x.data.branch_id]), [['in', 2, LC]])
    })
    await check('B1d', 'classify+analyze: Set LC Store (7; Old Shop 3) to 7 is "already at 7" -- no movement', 'high', async (t) => {
      const s = await seedProduct(H, { lc: 7, old: 3, a: 4, b: 3 })
      const r = await importCsv(H, 'set', [row(s, 7)], { approve: false })
      t.eq('analysed row', r.review.rows.map(x => x.action), ['skip'])
    })
    // Discriminates a branch-aware availability check from one that sums every branch: 8 > 7 at LC Store, but 8 <= 10 in total.
    await check('B1e', 'classify+analyze: Remove 8 at LC Store (7; Old Shop 3; total 10) is REFUSED -- availability is the selected branch\'s, not the total', 'high', async (t) => {
      const s = await seedProduct(H, { lc: 7, old: 3, a: 4, b: 3 })
      const r = await importCsv(H, 'remove', [row(s, 8)], { approve: false })
      t.eq('analysed row action', r.review.rows.map(x => x.action), ['error'])
    })

    // ------------------------------------------------------------------ B2: apply + finalization
    await check('B2', 'apply: Remove 2 of 10 (lots 5+5) leaves 8 in the lot ledger, branch_stock, products.stock_quantity and one lot-attributed movement; the job finalises', 'high', async (t) => {
      const s = await seedProduct(H, { lc: 10, a: 5, b: 5 })
      const cache0 = await H.cacheVersion('products'), frames0 = H.frames.length
      const r = await importCsv(H, 'remove', [row(s, 2)])
      await H.settle()
      const l = await ledger(H, s)
      t.eq('approve HTTP status', r.approved.status, 200)
      t.eq('job status / processed / failed', [r.job.status, r.job.processed_rows, r.job.failed_rows], ['completed', 1, 0])
      t.eq('lot ledger total (5+5 -> 8)', l.lotsSum, 8)
      t.eq('branch_stock LC Store (10 -> 8)', l.branch, 8)
      t.eq('products.stock_quantity (10 -> 8)', l.product, 8)
      t.eq('net movement', netMoved(l.movements), -2)
      t.eq('movement rows', l.movements.map(m => [m.t, m.q, m.br]), [['out', 2, LC]])
      t.ok('the movement names the lot it came out of', l.movements.length > 0 && l.movements.every(m => m.b != null), l.movements)
      t.ok('products cache version bumped by the finished import', (await H.cacheVersion('products')) > cache0, { before: cache0, after: await H.cacheVersion('products') })
      t.ok('a live-update frame announces the import', H.syncFrames(frames0).some(f => f.channel === 'inventory' || f.channel === 'products'), H.syncFrames(frames0).map(f => f.channel))
      t.note('ledger after: ' + JSON.stringify({ lots: l.lots, branch: l.branch, product: l.product }) + '; D1 statements, approve(apply, inline): ' + r.approved.d1)
    })
    await check('B2-control-adjust', 'control: the same Remove 2 through POST /api/inventory/adjust satisfies the same ledger invariants', 'control', async (t) => {
      const s = await seedProduct(H, { lc: 10, a: 5, b: 5 })
      const r = await H.api('POST', '/api/inventory/adjust', { productId: s.p, branchId: LC, type: 'remove', quantity: 2, reason: 'AL control', client_request_id: 'al-b-control-' + s.p })
      const l = await ledger(H, s)
      t.eq('status', r.status, 200)
      t.eq('lot ledger total', l.lotsSum, 8)
      t.eq('branch_stock', l.branch, 8)
      t.eq('products.stock_quantity', l.product, 8)
      t.eq('net movement', netMoved(l.movements), -2)
    })

    // ------------------------------------------------------------------ B3: Set uses the selected branch
    await check('B3', 'apply: Set LC Store (7; Old Shop 3) to 9 -> LC 9, Old Shop untouched at 3, total 12, one +2 movement at LC', 'high', async (t) => {
      const s = await seedProduct(H, { lc: 7, old: 3, a: 4, b: 3 })
      const r = await importCsv(H, 'set', [row(s, 9)])
      await H.settle()
      const l = await ledger(H, s)
      t.eq('approve HTTP status', r.approved.status, 200)
      t.eq('branch_stock LC Store', l.branch, 9)
      t.eq('Old Shop untouched', l.old, 3)
      t.eq('products.stock_quantity = LC + Old Shop', l.product, 12)
      t.eq('net movement', netMoved(l.movements), 2)
      t.ok('lots never hold more than the branch', l.lotsSum <= l.branch, { lotsSum: l.lotsSum, branch: l.branch })
      // The till reads lots: units added with no lot would be on the shelf count and unsellable.
      t.eq('the lot ledger rose with the branch (every unit at LC Store sits in a lot)', l.allLotsSum, l.branch)
      t.ok('the +2 movement names the lot it landed in', l.movements.length === 1 && l.movements[0].b != null, l.movements)
      t.note('ledger after: ' + JSON.stringify({ lots: l.lots, allLots: l.allLotsSum, branch: l.branch, old: l.old, product: l.product, movements: l.movements }))
    })
    await check('B3b', 'apply: Set LC Store (10; lots 5+5) DOWN to 6 -> every ledger 6, one -4 movement', 'high', async (t) => {
      const s = await seedProduct(H, { lc: 10, a: 5, b: 5 })
      const r = await importCsv(H, 'set', [row(s, 6)])
      await H.settle()
      const l = await ledger(H, s)
      t.eq('approve HTTP status', r.approved.status, 200)
      t.eq('lot ledger total', l.lotsSum, 6)
      t.eq('branch_stock', l.branch, 6)
      t.eq('products.stock_quantity', l.product, 6)
      t.eq('net movement', netMoved(l.movements), -4)
    })
    await check('B3-control-adjust', 'control: Set to 6 through POST /api/inventory/adjust (setScope "branch") satisfies the same invariants', 'control', async (t) => {
      const s = await seedProduct(H, { lc: 10, a: 5, b: 5 })
      const r = await H.api('POST', '/api/inventory/adjust', { productId: s.p, branchId: LC, type: 'set', setScope: 'branch', quantity: 6, batchId: s.lotA, reason: 'AL control', client_request_id: 'al-b-control-set-' + s.p })
      await H.settle()
      const l = await ledger(H, s)
      t.eq('status', r.status, 200)
      t.eq('lot ledger total', l.lotsSum, 6)
      t.eq('branch_stock', l.branch, 6)
      t.eq('products.stock_quantity', l.product, 6)
    })

    // ------------------------------------------------------------------ B4: over-removal
    await check('B4', 'apply: a Remove larger than what is on hand never drives any ledger below zero or out of agreement', 'high', async (t) => {
      const s = await seedProduct(H, { lc: 10, a: 5, b: 5 })
      const r = await importCsv(H, 'remove', [row(s, 12)])
      await H.settle()
      const l = await ledger(H, s)
      t.ok('products.stock_quantity is not negative', l.product >= 0, l.product)
      t.eq('products.stock_quantity equals the sum of the branch rows', l.product, l.branch + l.old)
      t.eq('lot ledger total never above branch_stock', l.lotsSum <= l.branch, true)
      t.eq('net movement equals the change in the aggregate', netMoved(l.movements), l.product - 10)
      t.note('job ' + r.job.status + ' processed ' + r.job.processed_rows + ' failed ' + r.job.failed_rows + '; ledger ' + JSON.stringify({ lots: l.lots, branch: l.branch, product: l.product, movements: l.movements }))
    })

    // ------------------------------------------------------------------ B5: retry (lost acknowledgement + queue redelivery)
    // One fault run feeds two cases: B5 pins what the importer writes (exactly once), B5b pins the ledgers it leaves.
    const retry = await (async () => {
      const s = await seedProduct(H, { lc: 10, a: 5, b: 5 })
      await H.control('ackloss', { faults: [{ pattern: 'INSERT INTO inventory_movements', times: 1, message: 'D1_ERROR: Network connection lost' }] })
      const r = await importCsv(H, 'remove', [row(s, 2)])
      const fired = (await H.controlGet('ackloss/result'))[0].hits
      await H.disarm()
      let job = (await H.api('GET', '/api/import-jobs/' + r.id)).body.job
      const statusAfterFault = job.status
      if (job.status !== 'completed') {
        await redeliver(H, r.id, 'apply', 2)
        job = (await H.api('GET', '/api/import-jobs/' + r.id)).body.job
      }
      await H.settle()
      return { s, r, fired, job, statusAfterFault, l: await ledger(H, s) }
    })()
    await check('B5', 'retry: the chunk batch commits but its acknowledgement is lost; after redelivery the job completes and the Remove 2 is applied exactly once', 'high', async (t) => {
      const { r, fired, job, statusAfterFault, l } = retry
      t.eq('the fault really fired', fired, 1)
      t.eq('job finished', job.status, 'completed')
      t.eq('processed / failed rows', [job.processed_rows, job.failed_rows], [1, 0])
      t.eq('exactly one movement of 2', l.movements.map(m => [m.t, m.q]), [['out', 2]])
      t.eq('products.stock_quantity (10 - 2 once)', l.product, 8)
      t.note('job status right after the fault: ' + statusAfterFault + '; approve HTTP ' + (r.approved && r.approved.status))
    })
    await check('B5b', 'retry: after the lost acknowledgement and redelivery every ledger agrees on 8', 'high', async (t) => {
      const { l } = retry
      t.eq('branch_stock (10 - 2 once)', l.branch, 8)
      t.eq('lot ledger total (10 - 2 once)', l.lotsSum, 8)
      t.eq('products.stock_quantity = branch_stock', l.product, l.branch)
    })

    // A Remove 8 of 10 whose batch committed before the acknowledgement was lost: on redelivery the live branch holds 2,
    // so judging the row again would call it "only 2 on hand" although it already applied.
    const retryLarge = await (async () => {
      const s = await seedProduct(H, { lc: 10, a: 5, b: 5 })
      await H.control('ackloss', { faults: [{ pattern: 'INSERT INTO inventory_movements', times: 1, message: 'D1_ERROR: Network connection lost' }] })
      const r = await importCsv(H, 'remove', [row(s, 8)])
      const fired = (await H.controlGet('ackloss/result'))[0].hits
      await H.disarm()
      let job = (await H.api('GET', '/api/import-jobs/' + r.id)).body.job
      if (job.status !== 'completed') {
        await redeliver(H, r.id, 'apply', 2)
        job = (await H.api('GET', '/api/import-jobs/' + r.id)).body.job
      }
      await H.settle()
      return { fired, job, l: await ledger(H, s) }
    })()
    await check('B5c', 'retry: a Remove 8 of 10 that applied before its acknowledgement was lost is reported as applied after redelivery, not judged again', 'high', async (t) => {
      const { fired, job, l } = retryLarge
      t.eq('the fault really fired', fired, 1)
      t.eq('job status / processed / failed', [job.status, job.processed_rows, job.failed_rows], ['completed', 1, 0])
      t.eq('lots, branch_stock and products.stock_quantity (10 - 8 once)', [l.lotsSum, l.branch, l.product], [2, 2, 2])
      t.eq('exactly one movement of 8', l.movements.map(m => [m.t, m.q]), [['out', 8]])
    })

    // ------------------------------------------------------------------ B7: reversal through the Stock Changes ledger
    await check('B7', 'REVERSAL: a Revert of an imported Remove puts the units back on the lot they came out of, once', 'high', async (t) => {
      const s = await seedProduct(H, { lc: 10, a: 5, b: 5 })
      await importCsv(H, 'remove', [row(s, 2)])
      await H.settle()
      const mid = await ledger(H, s)
      const movementId = (await H.q1("SELECT id FROM inventory_movements WHERE product_id=? AND movement_type='out'", s.p)).id
      const reverted = await H.api('POST', '/api/inventory/movements/' + movementId + '/revert', {})
      const again = await H.api('POST', '/api/inventory/movements/' + movementId + '/revert', {})
      await H.settle()
      const l = await ledger(H, s)
      t.eq('the import took 2 from lot A', [mid.lots, mid.branch, mid.product], [[3, 5], 8, 8])
      t.eq('revert answered', reverted.status, 200)
      t.eq('lots, branch_stock and products.stock_quantity back to 10', [l.lots, l.branch, l.product], [[5, 5], 10, 10])
      t.ok('a second revert of the same movement is refused', again.status >= 400 && again.status < 500, { status: again.status, body: again.body })
      t.eq('net movement after the revert', netMoved(l.movements), 0)
    })
    await check('B7b', 'REVERSAL: a Revert of an imported Set increase takes the units back out of the counted lot it landed in', 'high', async (t) => {
      const s = await seedProduct(H, { lc: 7, a: 4, b: 3 })
      await importCsv(H, 'set', [row(s, 9)])
      await H.settle()
      const mid = await ledger(H, s)
      const movementId = (await H.q1("SELECT id FROM inventory_movements WHERE product_id=? AND movement_type='in'", s.p)).id
      const reverted = await H.api('POST', '/api/inventory/movements/' + movementId + '/revert', {})
      await H.settle()
      const l = await ledger(H, s)
      t.eq('the Set landed 2 in a counted lot', [mid.allLotsSum, mid.branch, mid.product], [9, 9, 9])
      t.eq('revert answered', reverted.status, 200)
      t.eq('every lot, branch_stock and products.stock_quantity back to 7', [l.allLotsSum, l.branch, l.product], [7, 7, 7])
      t.eq('the received lots untouched', l.lots, [4, 3])
    })

    // ------------------------------------------------------------------ B8: a concurrent removal between plan and write
    await check('B8', 'RACE: a till Remove lands between the import\'s read and its write -- the import refuses instead of clamping, its retry re-plans from what is left', 'high', async (t) => {
      const s = await seedProduct(H, { lc: 10, a: 5, b: 5 })
      // The import's own lot guard (named parameters reach D1 as ?N, so match its SQL text, not @takes).
      await H.control('hooks', { hooks: [{ pattern: "json_extract\\(t\\.value,'\\$\\.batchId'\\)", request: H.hookRequest('POST', '/api/inventory/adjust',
        { productId: s.p, branchId: LC, type: 'remove', quantity: 3, batchId: s.lotA, reason: 'AL race', client_request_id: 'al-b-race-' + s.p }) }] })
      const r = await importCsv(H, 'remove', [row(s, 4)])
      const hook = (await H.controlGet('hooks/result'))[0]
      await H.disarm()
      const mid = await ledger(H, s)
      let job = (await H.api('GET', '/api/import-jobs/' + r.id)).body.job
      const statusAfterRace = job.status
      if (job.status !== 'completed') {
        await redeliver(H, r.id, 'apply', 2)
        job = (await H.api('GET', '/api/import-jobs/' + r.id)).body.job
      }
      await H.settle()
      const l = await ledger(H, s)
      t.eq('the till removal ran first and succeeded', [hook.fired, hook.result && hook.result.status], [true, 200])
      t.eq('after the race only the till removal is in the ledgers', [mid.lots, mid.branch, mid.product, mid.movements.length], [[2, 5], 7, 7, 1])
      t.ok('the import did not complete on the stale lots', statusAfterRace !== 'completed', statusAfterRace)
      t.eq('after the retry: completed, 1 row applied', [job.status, job.processed_rows, job.failed_rows], ['completed', 1, 0])
      t.eq('the 4 came out of lot A (2) then lot B (2); every ledger agrees on 3', [l.lots, l.branch, l.product], [[0, 3], 3, 3])
      t.eq('movements: the till remove 3, then one import out 4', l.movements.map(m => [m.t, m.q]), [['remove', 3], ['out', 4]])
    })

    // ------------------------------------------------------------------ B9 / B10: rows that only together, or twice, do not fit
    const rowResults = (jobId, phase) => H.q("SELECT action a, json_extract(result_json,'$.code') c FROM import_job_rows WHERE job_id=? AND phase=? ORDER BY row_number", jobId, phase)
    await check('B9', 'apply: two Remove rows that each fit but together exceed the branch -- the first applies, the second is a coded row error', 'high', async (t) => {
      const s = await seedProduct(H, { lc: 10, a: 5, b: 5 })
      const r = await importCsv(H, 'remove', [row(s, 6, 'AL first'), row(s, 6, 'AL second')])
      await H.settle()
      const l = await ledger(H, s)
      t.eq('analysis judged each row on its own', (await rowResults(r.id, 'analyze')).map(x => x.a), ['create', 'create'])
      t.eq('job status / processed / failed', [r.job.status, r.job.processed_rows, r.job.failed_rows], ['completed_with_errors', 1, 1])
      t.eq('apply rows: the first applied, the second refused with its code', (await rowResults(r.id, 'apply')).map(x => [x.a, x.c]), [['create', null], ['error', 'import_insufficient_branch_stock']])
      t.eq('every ledger agrees on 4', [l.lotsSum, l.branch, l.product], [4, 4, 4])
      t.eq('one movement of 6', l.movements.map(m => [m.t, m.q]), [['out', 6]])
    })
    await check('B10', 'classify: a second Set count of the same product and branch is a coded row error (both would be judged against one on-hand)', 'medium', async (t) => {
      const s = await seedProduct(H, { lc: 10, a: 5, b: 5 })
      const r = await importCsv(H, 'set', [row(s, 12), row(s, 8)], { approve: false })
      t.eq('analysed rows', (await rowResults(r.id, 'analyze')).map(x => [x.a, x.c]), [['create', null], ['error', 'import_duplicate_count_row']])
    })

    // ------------------------------------------------------------------ B6: chunk boundary (Free plan: 150 rows per chunk)
    F = await world({ plan: 'free', patches })
    await check('B6', 'chunk: 160 single-unit Remove rows on the Free plan cross the 150-row chunk boundary; every row lands once in every ledger', 'high', async (t) => {
      const s = await seedProduct(F, { lc: 300, a: 200, b: 100 })
      const rows = Array.from({ length: 160 }, (_, i) => row(s, 1, 'AL chunk row ' + (i + 1)))
      const r = await importCsv(F, 'remove', rows)
      await F.settle()
      const l = await ledger(F, s)
      t.eq('job status / processed / failed', [r.job.status, r.job.processed_rows, r.job.failed_rows], ['completed', 160, 0])
      t.eq('movement rows (one per CSV row)', l.movements.length, 160)
      t.eq('net movement', netMoved(l.movements), -160)
      t.eq('products.stock_quantity (300 - 160)', l.product, 140)
      t.eq('branch_stock (300 - 160)', l.branch, 140)
      t.eq('lot ledger total (300 - 160)', l.lotsSum, 140)
      t.note('inline D1 statements for 160 rows: start(analyze) ' + r.start.d1 + ', approve(apply) ' + (r.approved && r.approved.d1) + ' (Free limit 50 per invocation; the queue consumer runs one chunk per invocation)')
    })
  } finally {
    await H.disarm().catch(() => {})
    await H.dispose()
    if (F) { await F.disarm().catch(() => {}); await F.dispose() }
  }
  finish('B')
}
main().catch(error => { console.error(error); process.exitCode = 2 })
