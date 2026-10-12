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
// FINDING I -- an identity PUT (name or barcode) that is refused with 403 for the missing IMAGE permission.
//
// PUT /api/products/:id that moves a row onto the identity of another product folds the row into it (the Sep 16 2026
// ruling). When the edited row carries an image the fold would move, a caller without products:image must get 403.
// The correct outcome of a 403 is "nothing happened": name, barcode, every other column, updated_at, the stock
// revisions that open stock sessions compare, the audit log, the products cache version and the live-update socket
// are all exactly as before. Evidence from the pair-merge routes (POST /merge-duplicates etc.) does not cover this PUT.
//
// Run (from cloudflare/):  node scripts/test-al-stock-i-native.cjs
//   --fix                     apply the minimal fix in memory (check the image permission BEFORE writing the identity)
//   --wrong=no-image-check    mutant: the image permission is never checked on the fold
// ============================================================================================
const PRODUCTS = 'src/routes/products.ts'
const PATCHES = {
  fix: [
    { name: 'fix-check-before-write', file: PRODUCTS,
      from: "        try { await db.batch([productStockGuardStatement([Number(id), duplicate.id], 'active'), {",
      to: [
        "        if (getActionTier(user, 'products', 'image') !== 'full' && await productMergeChangesImages(",
        '          db, [{ keeper: { id: duplicate.id, image_path: null }, discarded: dupRow }],',
        '        )) {',
        "          return c.json({ error: 'You do not have permission to perform this action' }, 403)",
        '        }',
        "        try { await db.batch([productStockGuardStatement([Number(id), duplicate.id], 'active'), {"].join('\n') },
    { name: 'fix-queue-before-fold', file: PRODUCTS,
      from: "        // Sep 16 2026 ruling: this row's edit now identifies it as the SAME",
      to: [
        '        if (!isImageOnlyEdit) {',
        "          const pendingId = await maybeQueueForReview(c.env, user, 'products', { actionType: 'update', entityType: 'product', entityId: Number(id), payload: body, summary: 'Update product #' + id })",
        '          if (pendingId != null) return c.json({ success: true, pending: true, pendingActionId: pendingId }, 202)',
        '        }',
        "        // Sep 16 2026 ruling: this row's edit now identifies it as the SAME"].join('\n') },
    { name: 'fix-drop-late-check', file: PRODUCTS,
      from: [
        "        if (getActionTier(user, 'products', 'image') !== 'full' && await productMergeChangesImages(",
        '          db, [{ keeper: { id: duplicate.id, image_path: null }, discarded: dupRow }],',
        '        )) {',
        "          return c.json({ error: 'You do not have permission to perform this action' }, 403)",
        '        }',
        '        let foldResult: Awaited<ReturnType<typeof foldDuplicateProductInto>>'].join('\n'),
      to: '        let foldResult: Awaited<ReturnType<typeof foldDuplicateProductInto>>' },
  ],
  'no-image-check': [
    { name: 'no-image-check', file: PRODUCTS,
      from: "        if (getActionTier(user, 'products', 'image') !== 'full' && await productMergeChangesImages(\n          db, [{ keeper: { id: duplicate.id, image_path: null }, discarded: dupRow }],",
      to: "        if (false && await productMergeChangesImages(\n          db, [{ keeper: { id: duplicate.id, image_path: null }, discarded: dupRow }]," },
  ],
}

let seq = 0
// X is the row being edited (it carries an image the fold would move); Y already holds the identity X is moved onto.
async function pair(H, { shape, xImage = '/uploads/al-x.jpg', xStock = 0 } = {}) {
  const n = ++seq, x = 300 + n * 2, y = x + 1
  const nameX = 'AL Identity ' + n, nameY = shape === 'barcode' ? nameX : 'AL Identity ' + n + ' Large'
  const barX = '88500' + String(x).padStart(8, '0'), barY = shape === 'name' ? barX : '88500' + String(y).padStart(8, '0')
  const old = '2026-01-01 00:00:00'
  await H.db.batch([
    H.db.prepare('INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active,image_path,created_at,updated_at) VALUES(?,?,?,2,0,0,1,?,?,?)').bind(x, nameX, barX, xImage, old, old),
    H.db.prepare('INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active,image_path,created_at,updated_at) VALUES(?,?,?,2,0,0,1,NULL,?,?)').bind(y, nameY, barY, old, old),
  ])
  return { x, y, nameX, nameY, barX, barY }
}

async function snap(H, s) {
  const ids = [s.x, s.y]
  return {
    rows: Object.fromEntries((await H.q('SELECT * FROM products WHERE id IN (?,?) ORDER BY id', ...ids)).map(r => [r.id, r])),
    revisions: Object.fromEntries((await H.q("SELECT entity_type t, entity_key k, revision r FROM stock_session_revisions WHERE (entity_type='product' AND entity_key IN (?,?)) OR entity_type='product_catalog'", ...ids.map(String))).map(r => [r.t + ':' + r.k, r.r])),
    audits: (await H.q1('SELECT COUNT(*) n FROM audit_logs')).n,
    history: (await H.q1('SELECT COUNT(*) n FROM action_history')).n,
    cache: await H.cacheVersion('products'),
    frames: H.frames.length,
  }
}
function changedColumns(before, after) {
  const out = {}
  for (const id of Object.keys(before.rows)) {
    const diff = {}
    for (const column of Object.keys(before.rows[id])) if (JSON.stringify(before.rows[id][column]) !== JSON.stringify(after.rows[id]?.[column])) diff[column] = [before.rows[id][column], after.rows[id]?.[column] ?? null]
    if (Object.keys(diff).length) out[id] = diff
  }
  return out
}
function revisionChanges(before, after) {
  const out = {}
  for (const key of new Set([...Object.keys(before.revisions), ...Object.keys(after.revisions)])) if (before.revisions[key] !== after.revisions[key]) out[key] = [before.revisions[key] ?? null, after.revisions[key] ?? null]
  return out
}

function assertNothingHappened(t, before, after, H) {
  t.eq('both product rows unchanged (name, barcode, updated_at and every other column)', changedColumns(before, after), {})
  t.eq('stock revisions unchanged (open stock sessions compare these)', revisionChanges(before, after), {})
  t.eq('audit rows added', after.audits - before.audits, 0)
  t.eq('action-history rows added', after.history - before.history, 0)
  t.eq('products cache version bumped', after.cache - before.cache, 0)
  t.eq('live-update frames emitted', H.syncFrames(before.frames).length, 0)
}

async function main() {
  const flavour = FLAGS.has('fix') ? 'fix' : OPTIONS.wrong
  const patches = flavour ? (PATCHES[flavour] || assert.fail('unknown control ' + flavour)) : []
  console.log('MODE: ' + (flavour ? 'control ' + flavour : 'production code at HEAD (no patch)'))
  const H = await world({ patches })
  try {
    // A staff member who may edit products but has NO image permission (owner-rule permission tiers: products:image = false).
    await H.addUser(2, 'al-editor', { products: true, 'products:image': false })
    await H.addSession('editor', 2, { device: 'Editor Phone' })
    // Review Required tier on products: every write must be queued for a reviewer, never applied directly.
    await H.addUser(3, 'al-review-tier', { products: 'review' })
    await H.addSession('reviewtier', 3, { device: 'Counter Tablet' })

    for (const [shape, label, body] of [
      ['both', 'name AND barcode both move onto the other product', (s) => ({ name: s.nameY, barcode: s.barY })],
      ['barcode', 'only the BARCODE moves (same name already exists with that barcode)', (s) => ({ barcode: s.barY })],
      ['name', 'only the NAME moves (same barcode already exists under that name)', (s) => ({ name: s.nameY })],
    ]) {
      await check('I-' + shape, 'identity PUT refused 403 for no image permission leaves everything unchanged: ' + label, 'high', async (t) => {
        const s = await pair(H, { shape })
        const before = await snap(H, s)
        const r = await H.api('PUT', '/api/products/' + s.x, body(s), { as: 'editor' })
        await H.settle()
        const after = await snap(H, s)
        t.eq('HTTP status', r.status, 403)
        assertNothingHappened(t, before, after, H)
        t.note('response body: ' + JSON.stringify(r.body).slice(0, 200) + '; D1 statements in this one request: ' + r.d1)
        t.note('changed columns after the 403: ' + JSON.stringify(changedColumns(before, after)).slice(0, 400))
        t.note('revision changes after the 403: ' + JSON.stringify(revisionChanges(before, after)))
      })
    }

    await check('I-control-allowed', 'control: the SAME identity PUT by an admin (image permission held) really folds the row -- the fixture reaches the fold path', 'control', async (t) => {
      const s = await pair(H, { shape: 'both' })
      const r = await H.api('PUT', '/api/products/' + s.x, { name: s.nameY, barcode: s.barY })
      await H.settle()
      t.eq('status', r.status, 200)
      t.eq('merged into the other product', r.body.merged_into, s.y)
      t.eq('the folded row is gone from the active catalog', (await H.q1('SELECT is_active a FROM products WHERE id=?', s.x)).a, 0)
    })

    await check('I-control-no-duplicate', 'control: an identity edit that matches NO other product is allowed for the same user (the 403 is specific to the image-moving fold)', 'control', async (t) => {
      const s = await pair(H, { shape: 'both' })
      const r = await H.api('PUT', '/api/products/' + s.x, { name: 'AL Unique Rename ' + s.x }, { as: 'editor' })
      t.eq('status', r.status, 200)
      t.eq('renamed', (await H.q1('SELECT name n FROM products WHERE id=?', s.x)).n, 'AL Unique Rename ' + s.x)
    })

    await check('I-image-field', 'sibling: an explicit image-field edit refused 403 by the EARLY check also leaves everything unchanged (this earlier branch is clean)', 'control', async (t) => {
      const s = await pair(H, { shape: 'both' })
      const before = await snap(H, s)
      const r = await H.api('PUT', '/api/products/' + s.x, { name: s.nameY, barcode: s.barY, image_path: '/uploads/al-other.jpg' }, { as: 'editor' })
      await H.settle()
      const after = await snap(H, s)
      t.eq('HTTP status', r.status, 403)
      assertNothingHappened(t, before, after, H)
    })

    await check('I-review-tier', 'adjacent: a Review-Required user\'s identity PUT onto a duplicate (no image involved) is QUEUED for a reviewer, not folded directly', 'medium', async (t) => {
      const s = await pair(H, { shape: 'both', xImage: null })
      const before = await snap(H, s)
      const pendingBefore = (await H.q1('SELECT COUNT(*) n FROM pending_actions')).n
      const r = await H.api('PUT', '/api/products/' + s.x, { name: s.nameY, barcode: s.barY }, { as: 'reviewtier' })
      await H.settle()
      const after = await snap(H, s)
      const pendingAfter = (await H.q1('SELECT COUNT(*) n FROM pending_actions')).n
      t.eq('HTTP status (queued = 202)', r.status, 202)
      t.eq('the edited row is not folded/merged before a reviewer approves', (await H.q1('SELECT is_active a FROM products WHERE id=?', s.x)).a, 1)
      t.eq('product rows unchanged until approval', changedColumns(before, after), {})
      t.eq('one pending action queued', pendingAfter - pendingBefore, 1)
      t.note('status ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 160))
    })
  } finally {
    await H.disarm().catch(() => {})
    await H.dispose()
  }
  finish('I')
}
main().catch(error => { console.error(error); process.exitCode = 2 })
