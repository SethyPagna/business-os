'use strict'
// ============================================================================================
// HARNESS -- the same workerd + Miniflare harness as the four test-al-stock-{a,b,i,k}-native.cjs files, copied
// here so this file stays self-contained (it reads from, and changes, no other test).
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
const { executeRawStockTransaction } = require('../src/lib/stockTransaction.ts')
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
// OWNER RULING 16 (13 Oct 2026) -- "A full-access create that matches an existing name + barcode folds into the
// existing product. Any starting quantity typed is recorded as a normal stock-in, never silently dropped."
// Review-tier creates stay held for approval (finding I); an approved create that folds records the same stock-in.
//
// Before (release 2, dde1ba879): POST /api/products folded the create into the existing product and DROPPED
// stock_quantity (lib/createFold.ts did not exist; routes/products.ts foldCreateIntoExisting wrote only the barcode and
// the averaged cost), and approving a queued create that matched an existing product was refused 409
// review_identity_conflict (finding I) because the fold would have dropped that quantity.
//
// Now: the fold carries the quantity as an ordinary stock-in in ONE D1 batch (lot, branch lot stock, branch_stock,
// the product total, the 'add' movement, the catalog-cost recompute, the barcode cleanup and the fold's audit row),
// idempotent on (actor, client_request_id) through the stock-mutation receipt, refused without inventory:adjust, and
// run under the reviewer's authority (same batch as the request's approved mark) when a queued create is approved.
//
// Run (from cloudflare/):  node scripts/test-create-fold-stock-in-native.cjs
//   --wrong=drop-quantity       the fold ignores the typed quantity (the release-2 behaviour)
//   --wrong=no-idempotency      every retry claims a fresh receipt id, so the stock is added again
//   --wrong=no-permission       the fold records stock for a caller without inventory:adjust
//   --wrong=approval-refuses    approving a queued create that matches an existing product is refused (finding I)
//   --wrong=no-quantity-gate    a fold WITHOUT a quantity is also sent through the stock-in (needs a request id)
//   --wrong=no-create-receipt   a create with a starting quantity writes no receipt, so its own resend folds and doubles it
//   --only=<ids>                run only these case ids
//   --plan=free                 run on the Free plan (50 D1 statements per invocation)
// ============================================================================================
const PRODUCTS = 'src/routes/products.ts'
const CREATE_FOLD = 'src/lib/createFold.ts'
const REVIEW_APPLY = 'src/lib/reviewApply.ts'
const PATCHES = {
  'drop-quantity': [
    { name: 'drop-quantity', file: PRODUCTS, from: 'if (destination.quantity > 0 && destination.branchId != null) {', to: 'if (false) {' },
  ],
  'no-idempotency': [
    { name: 'no-idempotency', file: CREATE_FOLD, from: "client_request_id: body.client_request_id, source: 'create_fold'", to: "client_request_id: 'rnd-' + crypto.randomUUID(), source: 'create_fold'" },
  ],
  'no-permission': [
    { name: 'no-permission', file: CREATE_FOLD, from: "if (user && getActionTier(user, 'inventory', 'adjust') === 'full') return null", to: 'if (true) return null' },
  ],
  'approval-refuses': [
    { name: 'approval-refuses', file: REVIEW_APPLY, from: 'if (createTwin) return applyApprovedCreateFold(env, row, reviewer, createTwin, name, body, waitUntil)', to: 'if (createTwin) throw new ReviewIdentityConflictError(createTwin.id)' },
  ],
  'no-create-receipt': [
    { name: 'no-create-receipt', file: 'src/lib/productWrites.ts', from: 'if (startingReceipt) statements.push(startingReceipt)', to: '' },
  ],
  'no-quantity-gate': [
    { name: 'no-quantity-gate', file: PRODUCTS, from: 'if (destination.quantity > 0 && destination.branchId != null) {', to: 'if (destination.branchId != null) {' },
  ],
}

let seq = 0
const NOW = '2026-01-01 00:00:00'
// An existing product the create can land on: same name, barcode stored with two leading zeros (the same identity
// as the clean code), 3 units on hand in ONE lot at cost 2.00.
async function existing(H, { stock = 3, lotCost = 2 } = {}) {
  const n = ++seq, id = 600 + n * 2
  const name = 'CF Serum ' + n, clean = '88600' + String(id).padStart(8, '0')
  await executeRawStockTransaction(H.db, [
    H.db.prepare("INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,selling_price_usd,stock_quantity,is_active,created_at,updated_at) VALUES(?,?,?,?,0,9,?,1,?,?)")
      .bind(id, name, '00' + clean, lotCost, stock, NOW, NOW),
    H.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').bind(id, LC, stock),
    H.db.prepare("INSERT INTO product_batches(variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,unit_cost_usd,received_quantity,received_cost_usd) VALUES(?,?,?,?,1,1,?,?,?)")
      .bind(id, 'seed-lot-' + id, '01012026', '2026-01-01', lotCost, stock, lotCost * stock),
    H.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) SELECT id,?,? FROM product_batches WHERE variant_product_id=?').bind(LC, stock, id),
  ])
  return { id, name, clean, padded: '00' + clean }
}

async function ledger(H, e, rid = null) {
  const lots = await H.q('SELECT pb.id, pb.unit_cost_usd, pb.received_quantity, pb.is_active, pb.received_branch_id, COALESCE((SELECT SUM(quantity) FROM branch_batch_stock WHERE batch_id=pb.id AND branch_id=?),0) AS qty FROM product_batches pb WHERE pb.variant_product_id=? ORDER BY pb.id', LC, e.id)
  const product = await H.q1('SELECT stock_quantity, cost_price_usd, barcode, updated_at FROM products WHERE id=?', e.id)
  return {
    product: product.stock_quantity, cost: product.cost_price_usd, barcode: product.barcode, updatedAt: product.updated_at,
    branch: (await H.q1('SELECT quantity q FROM branch_stock WHERE product_id=? AND branch_id=?', e.id, LC)).q,
    lots,
    lotSum: lots.reduce((s, l) => s + Number(l.qty), 0),
    movements: await H.q("SELECT movement_type t, quantity q, unit_cost_usd c, reason, batch_id b, user_id u, user_name n, branch_id br, branch_name bn FROM inventory_movements WHERE product_id=? ORDER BY id", e.id),
    folds: await H.q("SELECT details, user_id u FROM audit_logs WHERE action='fold' AND entity='product' AND CAST(entity_id AS INTEGER)=? ORDER BY id", e.id),
    receipts: await H.q('SELECT kind, written, response_status st FROM stock_mutation_receipts WHERE request_id=?', rid || '-'),
    products: (await H.q1('SELECT COUNT(*) n FROM products')).n,
    cache: await H.cacheVersion('products'),
  }
}
const requestId = () => 'cf-' + (++seq) + '-' + Math.random().toString(36).slice(2, 10) + '-fold'
const createBody = (e, extra = {}) => ({ name: e.name, barcode: e.clean, stock_quantity: 7, branch_id: LC, cost_price_usd: 3.5, client_request_id: requestId(), ...extra })

// Evidence of "a normal stock-in": the same four ledgers POST /api/batches moves, by the same quantity.
function expectStockIn(t, label, before, after, { qty = 7, cost = 3.5 } = {}) {
  t.eq(label + ' product total', after.product - before.product, qty)
  t.eq(label + ' branch_stock', after.branch - before.branch, qty)
  t.eq(label + ' lot stock sums to the branch (no fork)', after.lotSum - before.lotSum, qty)
  t.eq(label + ' lot stock equals the branch figure', after.lotSum, after.branch)
  const newLots = after.lots.filter(l => !before.lots.some(b => b.id === l.id))
  t.eq(label + ' one new lot at the addressed branch', newLots.map(l => [l.qty, l.unit_cost_usd, l.received_quantity, l.received_branch_id, l.is_active]), [[qty, cost, qty, LC, 1]])
  const fresh = after.movements.slice(before.movements.length)
  t.eq(label + ' one movement: add, the quantity, the lot, the standard reason', fresh.map(m => [m.t, m.q, m.c, m.b === (newLots[0] && newLots[0].id), /^Stock received \(\d{8}\)$/.test(String(m.reason)), m.br]), [['add', qty, cost, true, true, LC]])
}

async function mainBody() {
  if (FLAGS.has('fix')) assert.fail('--fix is retired')
  const flavour = OPTIONS.wrong
  const patches = flavour ? (PATCHES[flavour] || assert.fail('unknown control ' + flavour)) : []
  console.log('MODE: ' + (flavour ? 'control ' + flavour : 'production code at HEAD (no patch)') + '; plan ' + (OPTIONS.plan || 'paid'))
  const H = await world({ patches, plan: OPTIONS.plan || 'paid' })
  try {
    // A manager who may add products AND adjust stock (Full on both), not an admin.
    await H.addUser(2, 'cf-manager', { products: true, inventory: true, product_cost_edit: true })
    await H.addSession('manager', 2, { device: 'Manager Phone' })
    // A product editor with NO inventory permission at all.
    await H.addUser(3, 'cf-editor', { products: true, product_cost_edit: true })
    await H.addSession('editor', 3, { device: 'Editor Phone' })
    // Review Required on products (queue-first).
    await H.addUser(4, 'cf-review-tier', { products: 'review', inventory: true, product_cost_edit: true })
    await H.addSession('reviewtier', 4, { device: 'Counter Tablet' })
    // A reviewer: Full on products, may approve, but NO inventory permission.
    await H.addUser(5, 'cf-reviewer-no-stock', { products: true, review: true, product_cost_edit: true })
    await H.addSession('reviewernostock', 5, { device: 'Reviewer Phone' })
    // Full on products, price action off.
    await H.addUser(6, 'cf-no-price', { products: true, 'products:price': false, inventory: true, product_cost_edit: true })
    await H.addSession('noprice', 6, { device: 'No Price Phone' })

    await check('F1', 'a Full create matching an existing name + barcode folds in and records its typed starting quantity as a normal stock-in (lot, branch_stock, product total, movement) in one request', 'high', async (t) => {
      const e = await existing(H)
      const before = await ledger(H, e)
      const r = await H.api('POST', '/api/products', createBody(e), { as: 'manager' })
      await H.settle()
      const after = await ledger(H, e)
      t.eq('status', r.status, 200)
      t.eq('folded into the existing product', r.body && r.body.folded_into, e.id)
      t.eq('no new product row', after.products - before.products, 0)
      t.eq('the fold stored the clean barcode', after.barcode, e.clean)
      expectStockIn(t, 'stock-in:', before, after)
      t.eq('the answer names the stock-in', r.body && r.body.stock_in && [r.body.stock_in.quantity, r.body.stock_in.branch_id], [7, LC])
      t.eq('the answer carries the fresh product row', r.body && r.body.item && r.body.item.stock_quantity, 10)
      t.eq('one fold audit row naming the quantity', after.folds.length - before.folds.length, 1)
      t.ok('the audit row records the stock-in', after.folds.length && JSON.parse(after.folds[after.folds.length - 1].details).stockIn.quantity === 7, after.folds)
      t.eq('products cache version bumped', after.cache > before.cache, true)
      t.note('D1 statements in this one request: ' + r.d1 + ' (Free 50 / Paid 1000); response ' + JSON.stringify(r.body).slice(0, 200))
    })

    await check('F2', 'the typed cost is the stock-in\'s own unit cost: the catalog cost is the quantity-weighted mean over the lots on hand (3 at 2.00 + 7 at 3.50 = 3.05)', 'high', async (t) => {
      const e = await existing(H)
      const r = await H.api('POST', '/api/products', createBody(e), { as: 'manager' })
      await H.settle()
      const after = await ledger(H, e)
      t.eq('status', r.status, 200)
      t.eq('catalog cost (3 x 2.00 + 7 x 3.50) / 10', after.cost, 3.05)
      t.eq('the old lot keeps its own cost, the new lot carries the typed one', after.lots.map(l => l.unit_cost_usd), [2, 3.5])
    })

    // Release 3 slice S7 (owner, 14 Oct 2026): a typed $0 is a recorded $0, an absent cost is unknown -- never the other way round.
    await check('F2a', 'a typed $0 starting quantity is received as free goods: the new lot is a recorded $0, the movement says so, and the catalog cost is still the mean of the lots that have a cost', 'high', async (t) => {
      const e = await existing(H)
      const before = await ledger(H, e)
      const r = await H.api('POST', '/api/products', createBody(e, { cost_price_usd: 0 }), { as: 'manager' })
      await H.settle()
      const after = await ledger(H, e)
      t.eq('status', r.status, 200)
      const newLots = after.lots.filter(l => !before.lots.some(b => b.id === l.id))
      t.eq('one new lot at a recorded $0 (base: NULL)', newLots.map(l => [l.qty, l.unit_cost_usd]), [[7, 0]])
      const fresh = after.movements.slice(before.movements.length)
      t.eq('one add movement at a recorded $0 whose reason carries the free-goods words', fresh.map(m => [m.t, m.q, m.c, /^Stock received \(\d{8}\) \(Free goods \(no cost\)\)$/.test(String(m.reason))]), [['add', 7, 0, true]])
      t.eq('the KHR side of a free receipt is a recorded 0 too', (await H.q1("SELECT unit_cost_khr k, total_cost_khr tk FROM inventory_movements WHERE product_id=? AND movement_type='add' ORDER BY id DESC LIMIT 1", e.id)), { k: 0, tk: 0 })
      t.eq('the catalog cost ignores a 0 lot (averaging formula unchanged, Q2)', after.cost, 2)
    })

    await check('F2b', 'a starting quantity with no cost is received at an UNKNOWN cost: the new lot and the movement are NULL, no free-goods claim is made', 'high', async (t) => {
      const e = await existing(H)
      const before = await ledger(H, e)
      const body = createBody(e)
      delete body.cost_price_usd
      const r = await H.api('POST', '/api/products', body, { as: 'manager' })
      await H.settle()
      const after = await ledger(H, e)
      t.eq('status', r.status, 200)
      const newLots = after.lots.filter(l => !before.lots.some(b => b.id === l.id))
      t.eq('one new lot with no cost', newLots.map(l => [l.qty, l.unit_cost_usd]), [[7, null]])
      const fresh = after.movements.slice(before.movements.length)
      t.eq('one add movement with no cost and the plain reason', fresh.map(m => [m.t, m.q, m.c, /^Stock received \(\d{8}\)$/.test(String(m.reason))]), [['add', 7, null, true]])
      t.eq('the KHR side is unknown too (base: the DEFAULT 0 of the omitted column)', (await H.q1("SELECT unit_cost_khr k, total_cost_khr tk FROM inventory_movements WHERE product_id=? AND movement_type='add' ORDER BY id DESC LIMIT 1", e.id)), { k: null, tk: null })
      t.eq('the catalog cost stays the mean of the lots that have one', after.cost, 2)
    })

    await check('F2c', 'the fold with no starting quantity: a typed $0 onto a twin with an unknown cost records a $0; a blank cost leaves it unknown (base: both ignored)', 'high', async (t) => {
      const e = await existing(H, { stock: 0, lotCost: 0 })
      await executeRawStockTransaction(H.db, [H.db.prepare('UPDATE products SET cost_price_usd=NULL, cost_price_khr=NULL WHERE id=?').bind(e.id)])
      const noQty = (extra) => ({ name: e.name, barcode: e.clean, client_request_id: requestId(), ...extra })
      await H.api('POST', '/api/products', noQty({}), { as: 'manager' })
      await H.settle()
      t.eq('no cost typed: the twin stays unknown', (await H.q1('SELECT cost_price_usd c, cost_price_khr k FROM products WHERE id=?', e.id)), { c: null, k: null })
      await H.api('POST', '/api/products', noQty({ cost_price_usd: 0 }), { as: 'manager' })
      await H.settle()
      t.eq('a typed $0 is recorded as 0', (await H.q1('SELECT cost_price_usd c FROM products WHERE id=?', e.id)), { c: 0 })
      t.eq('and keeps its cost entry', (await H.q('SELECT cost_usd c, previous_cost_usd p FROM product_cost_entries WHERE product_id=?', e.id)), [{ c: 0, p: null }])
    })

    await check('F3', 'the fold never writes the selling price: a typed price (even from a role with the price action off) leaves the survivor\'s price alone, and the stock-in still lands', 'high', async (t) => {
      const e = await existing(H)
      const before = await ledger(H, e)
      const r = await H.api('POST', '/api/products', createBody(e, { selling_price_usd: 99, wholesale_price_usd: 50 }), { as: 'noprice' })
      await H.settle()
      const after = await ledger(H, e)
      t.eq('status', r.status, 200)
      t.eq('survivor selling price unchanged', (await H.q1('SELECT selling_price_usd p FROM products WHERE id=?', e.id)), { p: 9 })
      expectStockIn(t, 'stock-in:', before, after)
    })

    await check('F4', 'a retry with the SAME client_request_id replays the original answer and adds nothing again (lot, branch_stock, total, movement, audit, receipt)', 'high', async (t) => {
      const e = await existing(H)
      const body = createBody(e)
      const before = await ledger(H, e, body.client_request_id)
      const first = await H.api('POST', '/api/products', body, { as: 'manager' })
      await H.settle()
      const mid = await ledger(H, e, body.client_request_id)
      const retry = await H.api('POST', '/api/products', body, { as: 'manager' })
      await H.settle()
      const after = await ledger(H, e, body.client_request_id)
      t.eq('first answered 200', first.status, 200)
      t.eq('retry answered 200 and says it was replayed', [retry.status, retry.body && retry.body.replayed], [200, true])
      t.eq('the replay names the same survivor and stock-in', [retry.body && retry.body.folded_into, retry.body && retry.body.stock_in && retry.body.stock_in.quantity], [e.id, 7])
      t.eq('the replay still carries a fresh item', retry.body && retry.body.item && retry.body.item.stock_quantity, 10)
      expectStockIn(t, 'once:', before, after)
      t.eq('the retry moved no ledger', [after.product, after.branch, after.lotSum, after.lots.length, after.movements.length, after.folds.length], [mid.product, mid.branch, mid.lotSum, mid.lots.length, mid.movements.length, mid.folds.length])
      t.eq('one completed receipt', after.receipts.map(x => [x.kind, x.written, x.st]), [['receive', 1, 200]])
    })

    await check('F5', 'the same request id with DIFFERENT details is refused 409 idempotency_conflict and moves nothing', 'high', async (t) => {
      const e = await existing(H)
      const body = createBody(e)
      await H.api('POST', '/api/products', body, { as: 'manager' })
      await H.settle()
      const mid = await ledger(H, e)
      const r = await H.api('POST', '/api/products', { ...body, stock_quantity: 70 }, { as: 'manager' })
      await H.settle()
      const after = await ledger(H, e)
      t.eq('status and code', [r.status, r.body && r.body.code], [409, 'idempotency_conflict'])
      t.eq('nothing moved', [after.product, after.branch, after.lotSum, after.movements.length], [mid.product, mid.branch, mid.lotSum, mid.movements.length])
    })

    await check('F6', 'LOST ACKNOWLEDGEMENT: the batch commits, the call throws "Network connection lost"; the retry with the same id replays the committed fold and adds nothing', 'high', async (t) => {
      const e = await existing(H)
      const body = createBody(e)
      const before = await ledger(H, e, body.client_request_id)
      await H.control('ackloss', { faults: [{ pattern: 'INSERT INTO branch_batch_stock', times: 1, message: 'D1_ERROR: Network connection lost' }] })
      const first = await H.api('POST', '/api/products', body, { as: 'manager' })
      const hits = (await H.controlGet('ackloss/result'))[0].hits
      await H.disarm()
      await H.settle()
      const mid = await ledger(H, e, body.client_request_id)
      const retry = await H.api('POST', '/api/products', body, { as: 'manager' })
      await H.settle()
      const after = await ledger(H, e, body.client_request_id)
      t.eq('the fault really fired once', hits, 1)
      t.ok('the first answer is the success or "outcome unknown", never a refusal', first.status === 200 || (first.body && first.body.code) === 'stock_request_outcome_unknown', { status: first.status, body: first.body })
      t.eq('the batch committed once', [mid.product - before.product, mid.branch - before.branch, mid.movements.length - before.movements.length], [7, 7, 1])
      t.eq('the retry answers from the receipt (200, replayed)', [retry.status, retry.body && retry.body.replayed], [200, true])
      t.eq('and moved nothing again', [after.product, after.branch, after.lotSum, after.movements.length, after.folds.length], [mid.product, mid.branch, mid.lotSum, mid.movements.length, mid.folds.length])
      t.eq('one completed receipt holding the 200', after.receipts.map(x => [x.written, x.st]), [[1, 200]])
    })

    await check('F7', 'a role without inventory:adjust is refused 403 and NOTHING changes (no fold, no stock, no audit, no receipt) -- refused, not dropped', 'high', async (t) => {
      const e = await existing(H)
      const before = await ledger(H, e)
      const r = await H.api('POST', '/api/products', createBody(e), { as: 'editor' })
      await H.settle()
      const after = await ledger(H, e)
      t.eq('status and code', [r.status, r.body && r.body.code], [403, 'permission_denied'])
      t.eq('nothing changed (barcode spelling and updated_at included)', [after.product, after.branch, after.lotSum, after.lots.length, after.movements.length, after.folds.length, after.barcode, after.updatedAt, after.receipts.length],
        [before.product, before.branch, before.lotSum, before.lots.length, before.movements.length, before.folds.length, before.barcode, before.updatedAt, before.receipts.length])
    })

    await check('F8', 'a fold with a quantity but NO usable request id is refused 400 client_request_id_required and nothing is written', 'medium', async (t) => {
      const e = await existing(H)
      const before = await ledger(H, e)
      const body = createBody(e); delete body.client_request_id
      const r = await H.api('POST', '/api/products', body, { as: 'manager' })
      await H.settle()
      const after = await ledger(H, e)
      t.eq('status and code', [r.status, r.body && r.body.code], [400, 'client_request_id_required'])
      t.eq('nothing changed', [after.product, after.branch, after.lotSum, after.movements.length, after.folds.length, after.barcode], [before.product, before.branch, before.lotSum, before.movements.length, before.folds.length, before.barcode])
    })

    await check('F11', 'a resend of a CREATE that made a new product (same actor, same request id, same body) replays that create: no fold, no second stock-in, one product', 'high', async (t) => {
      const n = ++seq
      const body = { name: 'CF Fresh ' + n, barcode: '88950' + String(n).padStart(8, '0'), stock_quantity: 6, branch_id: LC, cost_price_usd: 2.5, client_request_id: requestId() }
      const first = await H.api('POST', '/api/products', body, { as: 'manager' })
      await H.settle()
      const afterFirst = await H.q1('SELECT id, stock_quantity s FROM products WHERE name=?', body.name)
      const productsBefore = (await H.q1('SELECT COUNT(*) n FROM products')).n
      const retry = await H.api('POST', '/api/products', body, { as: 'manager' })
      await H.settle()
      t.eq('first create answered 200', [first.status, first.body && first.body.success], [200, true])
      t.eq('the resend answers 200, replayed, naming the product the create made', [retry.status, retry.body && retry.body.replayed, retry.body && retry.body.id], [200, true, first.body.id])
      t.eq('the resend is not a fold', retry.body && retry.body.folded_into, undefined)
      t.eq('still one product with this name, holding the typed quantity ONCE', [(await H.q1('SELECT COUNT(*) n FROM products WHERE name=?', body.name)).n, (await H.q1('SELECT stock_quantity s FROM products WHERE id=?', afterFirst.id)).s], [1, 6])
      t.eq('no product added by the resend', (await H.q1('SELECT COUNT(*) n FROM products')).n, productsBefore)
      t.eq('no fold audit row, and no add movement beyond the opening-stock movement of the create itself (audit P2-b), for the resend', [(await H.q1("SELECT COUNT(*) n FROM audit_logs WHERE action='fold' AND CAST(entity_id AS INTEGER)=?", afterFirst.id)).n, (await H.q1("SELECT COUNT(*) n FROM inventory_movements WHERE product_id=?", afterFirst.id)).n], [0, 1])
      t.eq('one completed receipt for the request', (await H.q('SELECT written, response_status st FROM stock_mutation_receipts WHERE request_id=?', body.client_request_id)).map(x => [x.written, x.st]), [[1, 200]])
    })

    await check('F12', 'LOST ACKNOWLEDGEMENT on a CREATE with a starting quantity: it committed; the resend replays it and the quantity is NOT recorded a second time', 'high', async (t) => {
      const n = ++seq
      const body = { name: 'CF Lost Ack ' + n, barcode: '88960' + String(n).padStart(8, '0'), stock_quantity: 4, branch_id: LC, client_request_id: requestId() }
      await H.control('ackloss', { faults: [{ pattern: 'CROSS JOIN branches', times: 1, message: 'D1_ERROR: Network connection lost' }] })
      const first = await H.api('POST', '/api/products', body, { as: 'manager' })
      const hits = (await H.controlGet('ackloss/result'))[0].hits
      await H.disarm()
      await H.settle()
      const made = await H.q1('SELECT id, stock_quantity s FROM products WHERE name=?', body.name)
      const retry = await H.api('POST', '/api/products', body, { as: 'manager' })
      await H.settle()
      t.eq('the fault really fired once', hits, 1)
      t.eq('the first answer is "outcome unknown" (the create committed)', [first.status, first.body && first.body.code], [503, 'product_create_outcome_unknown'])
      t.eq('the create committed with its quantity', made && made.s, 4)
      t.eq('the resend replays the create (200)', [retry.status, retry.body && retry.body.replayed, retry.body && retry.body.id], [200, true, made.id])
      t.eq('one product, the quantity once, only the opening-stock movement of the create itself and no fold from the resend', [(await H.q1('SELECT COUNT(*) n FROM products WHERE name=?', body.name)).n, (await H.q1('SELECT stock_quantity s FROM products WHERE id=?', made.id)).s,
        (await H.q1('SELECT COUNT(*) n FROM inventory_movements WHERE product_id=?', made.id)).n, (await H.q1("SELECT COUNT(*) n FROM audit_logs WHERE action='fold' AND CAST(entity_id AS INTEGER)=?", made.id)).n], [1, 4, 1, 0])
    })

    await check('F13', 'the same request id with a DIFFERENT product (changed intent) is a new create, not a replay', 'medium', async (t) => {
      const n = ++seq
      const id = requestId()
      const a = await H.api('POST', '/api/products', { name: 'CF Intent A ' + n, barcode: '88970' + String(n).padStart(8, '0'), stock_quantity: 2, branch_id: LC, client_request_id: id }, { as: 'manager' })
      const b = await H.api('POST', '/api/products', { name: 'CF Intent B ' + n, barcode: '88980' + String(n).padStart(8, '0'), stock_quantity: 2, branch_id: LC, client_request_id: id }, { as: 'manager' })
      t.eq('both answered 200 and are different products', [a.status, b.status, a.body.id !== b.body.id, b.body.replayed], [200, 200, true, undefined])
    })

    await check('F9', 'control: a fold with NO starting quantity behaves as before (200, barcode cleaned, no lot, no movement, no request id needed)', 'control', async (t) => {
      const e = await existing(H)
      const before = await ledger(H, e)
      const body = createBody(e, { stock_quantity: 0 }); delete body.client_request_id
      const r = await H.api('POST', '/api/products', body, { as: 'editor' })
      await H.settle()
      const after = await ledger(H, e)
      t.eq('status and fold', [r.status, r.body && r.body.folded_into], [200, e.id])
      t.eq('barcode cleaned', after.barcode, e.clean)
      t.eq('no stock moved, no lot, no movement', [after.product, after.branch, after.lots.length, after.movements.length], [before.product, before.branch, before.lots.length, before.movements.length])
      t.eq('no stock_in in the answer', r.body && r.body.stock_in, undefined)
    })

    await check('F10', 'control: a NEW product (no match) with a starting quantity is still created whole, as before', 'control', async (t) => {
      const n = ++seq
      const r = await H.api('POST', '/api/products', { name: 'CF Brand New ' + n, barcode: '88700' + String(n).padStart(8, '0'), stock_quantity: 5, branch_id: LC, client_request_id: requestId() }, { as: 'manager' })
      await H.settle()
      t.eq('status', r.status, 200)
      t.eq('created with its stock', await H.q1('SELECT stock_quantity s FROM products WHERE id=?', r.body.id), { s: 5 })
      t.eq('branch_stock', (await H.q1('SELECT quantity q FROM branch_stock WHERE product_id=? AND branch_id=?', r.body.id, LC)).q, 5)
    })

    // ---------------------------------------------------------------- the review tier (held, then approved) ----
    const approve = (pendingId, as = 'admin') => H.api('POST', '/api/review/' + pendingId + '/approve', {}, { as })
    const pending = async pendingId => (await H.q1('SELECT status, reviewed_by FROM pending_actions WHERE id=?', pendingId))

    await check('R1', 'a Review-Required create matching an existing product stays HELD (202): the existing product, its stock and its barcode spelling are untouched until approval', 'high', async (t) => {
      const e = await existing(H)
      const before = await ledger(H, e)
      const r = await H.api('POST', '/api/products', createBody(e), { as: 'reviewtier' })
      await H.settle()
      const after = await ledger(H, e)
      t.eq('status', r.status, 202)
      t.eq('existing product untouched', [after.product, after.branch, after.lotSum, after.lots.length, after.movements.length, after.folds.length, after.barcode, after.updatedAt],
        [before.product, before.branch, before.lotSum, before.lots.length, before.movements.length, before.folds.length, before.barcode, before.updatedAt])
      t.eq('no receipt claimed while held', after.receipts.length, before.receipts.length)
    })

    await check('R2', 'APPROVING that held create folds it and records the typed quantity as a normal stock-in, in the same batch that marks the request approved; the movement and audit name the reviewer', 'high', async (t) => {
      const e = await existing(H)
      const queued = await H.api('POST', '/api/products', createBody(e), { as: 'reviewtier' })
      t.eq('queued (202)', queued.status, 202)
      const pendingId = queued.body && queued.body.pendingActionId
      const before = await ledger(H, e)
      const r = await approve(pendingId)
      await H.settle()
      const after = await ledger(H, e)
      t.eq('approval status', r.status, 200)
      t.eq('request approved by the admin', await pending(pendingId), { status: 'approved', reviewed_by: 1 })
      t.eq('no twin minted', after.products - before.products, 0)
      t.eq('the fold stored the clean barcode', after.barcode, e.clean)
      expectStockIn(t, 'stock-in:', before, after)
      t.eq('the movement is attributed to the approving reviewer', after.movements.slice(before.movements.length).map(m => m.u), [1])
      const fold = after.folds.slice(before.folds.length).map(f => JSON.parse(f.details))
      t.eq('one fold audit row, from the review path, naming the request', fold.map(f => [f.reason, f.pendingActionId, f.stockIn && f.stockIn.quantity]), [['review_create_identity_fold', pendingId, 7]])
      t.eq('catalog cost is the lot-weighted mean', after.cost, 3.05)
      t.note('approve D1 statements: ' + r.d1)
    })

    await check('R3', 'approving the SAME request again changes nothing (already reviewed): the stock is added once', 'high', async (t) => {
      const e = await existing(H)
      const queued = await H.api('POST', '/api/products', createBody(e), { as: 'reviewtier' })
      const pendingId = queued.body.pendingActionId
      await approve(pendingId)
      await H.settle()
      const mid = await ledger(H, e)
      const again = await approve(pendingId)
      await H.settle()
      const after = await ledger(H, e)
      t.eq('second approval refused', again.status, 409)
      t.eq('nothing moved', [after.product, after.branch, after.lotSum, after.movements.length, after.folds.length], [mid.product, mid.branch, mid.lotSum, mid.movements.length, mid.folds.length])
    })

    await check('R4', 'a request REJECTED (or decided elsewhere) before approval writes no stock: an approval that loses the race rolls the whole batch back', 'high', async (t) => {
      const e = await existing(H)
      const queued = await H.api('POST', '/api/products', createBody(e), { as: 'reviewtier' })
      const pendingId = queued.body.pendingActionId
      const rejected = await H.api('POST', '/api/review/' + pendingId + '/reject', { reason: 'wrong product' })
      t.eq('rejected', rejected.status, 200)
      const before = await ledger(H, e)
      const r = await approve(pendingId)
      await H.settle()
      const after = await ledger(H, e)
      t.ok('approval refused', r.status === 409, { status: r.status, body: r.body })
      t.eq('nothing moved', [after.product, after.branch, after.lotSum, after.movements.length, after.folds.length, after.barcode], [before.product, before.branch, before.lotSum, before.movements.length, before.folds.length, before.barcode])
    })

    await check('R5', 'a reviewer without inventory:adjust cannot approve a create that would add stock to an existing product: 403, the request stays open, nothing written', 'high', async (t) => {
      const e = await existing(H)
      const queued = await H.api('POST', '/api/products', createBody(e), { as: 'reviewtier' })
      const pendingId = queued.body.pendingActionId
      const before = await ledger(H, e)
      const r = await approve(pendingId, 'reviewernostock')
      await H.settle()
      const after = await ledger(H, e)
      t.eq('status and permission', [r.status, r.body && r.body.permission], [403, 'inventory:adjust'])
      t.eq('request still open', (await pending(pendingId)).status, 'open')
      t.eq('nothing moved', [after.product, after.branch, after.lotSum, after.movements.length, after.folds.length, after.barcode], [before.product, before.branch, before.lotSum, before.movements.length, before.folds.length, before.barcode])
    })

    await check('R6', 'control: that same reviewer CAN approve a queued create with no starting quantity that folds (no stock to add): barcode cleaned, request approved', 'control', async (t) => {
      const e = await existing(H)
      const queued = await H.api('POST', '/api/products', createBody(e, { stock_quantity: 0 }), { as: 'reviewtier' })
      const pendingId = queued.body.pendingActionId
      const before = await ledger(H, e)
      const r = await approve(pendingId, 'reviewernostock')
      await H.settle()
      const after = await ledger(H, e)
      t.eq('approval status', r.status, 200)
      t.eq('request approved', (await pending(pendingId)).status, 'approved')
      t.eq('barcode cleaned, no stock moved', [after.barcode, after.product, after.lots.length, after.movements.length], [e.clean, before.product, before.lots.length, before.movements.length])
    })

    await check('R7', 'control: approving a queued create of a NEW product still creates it whole (the fold is only for a create that matches)', 'control', async (t) => {
      const n = ++seq
      const fresh = { name: 'CF Approved New ' + n, barcode: '88800' + String(n).padStart(8, '0'), stock_quantity: 4, branch_id: LC }
      const queued = await H.api('POST', '/api/products', fresh, { as: 'reviewtier' })
      t.eq('queued', queued.status, 202)
      const r = await approve(queued.body.pendingActionId)
      t.eq('approved', r.status, 200)
      const row = await H.q1('SELECT id, stock_quantity s FROM products WHERE name=? AND is_active=1', fresh.name)
      t.eq('created with its stock', row && row.s, 4)
    })

    // ---------------------------------------------------------------- siblings ----
    await check('S1', 'sibling: Stock Session create_receive that matches an existing product already folds into a receive line and records the same four ledgers (the pattern this fix mirrors)', 'control', async (t) => {
      const e = await existing(H)
      const before = await ledger(H, e)
      const r = await H.api('POST', '/api/inventory/sessions', {
        client_request_id: requestId(), mode: 'stock_in',
        defaults: { branch_id: LC, received_date: '2026-10-13', supplier_name: 'CF Supplier' },
        items: [{ line_id: 'cf-line-1', kind: 'create_receive', quantity: 7, unit_cost_usd: 3.5,
          product: { name: e.name, barcode: e.clean, cost_price_usd: 3.5, cost_price_khr: 0, selling_price_usd: 14, stock_quantity: 7, branch_id: LC } }],
      }, { as: 'manager' })
      await H.settle()
      const after = await ledger(H, e)
      t.eq('status', r.status, 200)
      t.eq('product total / branch_stock / lots move by the quantity', [after.product - before.product, after.branch - before.branch, after.lotSum - before.lotSum], [7, 7, 7])
      t.eq('one add movement', after.movements.slice(before.movements.length).map(m => [m.t, m.q]), [['add', 7]])
      t.eq('no twin', after.products - before.products, 0)
    })

    await check('S2', 'sibling: POST /variant never folds (it always inserts a row), so there is no quantity to drop there -- the routes differ, the create-fold ruling is POST /api/products', 'control', async (t) => {
      const e = await existing(H)
      const before = await ledger(H, e)
      const r = await H.api('POST', '/api/products/variant', { name: e.name, barcode: '88900' + String(e.id).padStart(8, '0'), stock_quantity: 2, branch_id: LC, client_request_id: requestId() }, { as: 'manager' })
      await H.settle()
      const after = await ledger(H, e)
      t.eq('status', r.status, 200)
      t.eq('a new variant row was created (different barcode) and the original is untouched', [after.products - before.products, after.product, after.branch], [1, before.product, before.branch])
    })
  } finally {
    await H.disarm().catch(() => {})
    await H.dispose()
  }
  finish('CF')
}
mainBody().catch(error => { console.error(error); process.exitCode = 2 })
