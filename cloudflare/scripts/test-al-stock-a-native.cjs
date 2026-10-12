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
// FINDING A -- explicit selected-lot Remove (POST /api/inventory/adjust, type "remove", batchId = the lot).
//
// Start: lot A = 5 and lot B = 5 at LC Store (branch_stock 10, products.stock_quantity 10).
// The correct outcome under the owner's rules: ONE request removes 4 from the SELECTED lot; a second request for 4
// from the same lot (5 - 4 = 1 left) is refused; nothing is taken from the other lot; the four ledgers (selected lot,
// branch_stock, products.stock_quantity, inventory_movements) always agree with each other; the idempotency receipt,
// the cache version and the live-update frames follow the stock.
//
// Run (from cloudflare/):  node scripts/test-al-stock-a-native.cjs
//   --fix                       apply the minimal fix in memory (the selected-lot Remove joins the one atomic batch the
//                               auto-routed and tagged removals already use) -- every case must then be GREEN
//   --wrong=wrong-lot           mutant: removes from the previous lot id (a plausible off-by-one)
//   --wrong=no-replay           mutant: a completed receipt is no longer replayed
// ============================================================================================
const INVENTORY = 'src/routes/inventory.ts'
const PATCHES = {
  fix: [
    { name: 'fix-atomic-flag', file: INVENTORY,
      from: "    && (Boolean(conditionTag) || (useBatchLedger && batchIdRequested == null && (rawBatchId == null || rawBatchId === '')))",
      to: "    && (Boolean(conditionTag) || (useBatchLedger && batchIdRequested == null && (rawBatchId == null || rawBatchId === '')) || (useBatchLedger && batchIdRequested != null))" },
    { name: 'fix-strict-lot-id', file: INVENTORY,
      from: '  const rawBatchId = body.batchId',
      to: [
        '  const rawBatchId = body.batchId',
        "  if (rawBatchId != null && rawBatchId !== '' && rawBatchId !== 'new' && !/^[1-9][0-9]*$/.test(String(rawBatchId).trim())) {",
        "    return c.json({ error: 'Selected received date is not valid.', code: 'invalid_batch_id' }, 400)",
        '  }'].join('\n') },
    { name: 'fix-atomic-batch', file: INVENTORY,
      from: '        } else await removeStockFromBatch(db, { batchId: batchIdRequested, productId: targetProductId, branchId, quantity })',
      to: [
        '        } else {',
        '          resolvedBatchId = batchIdRequested',
        '          const removal = planRemoveStockAcrossBatches({ productId: targetProductId, branchId, quantity,',
        '            allocations: [{ batchId: batchIdRequested, quantity }] })',
        '          const mark = atomicMark?.statement() ?? null',
        '          await db.batch(addressedStatements(landing, [...(mark ? [mark] : []), ...removal.statements, movementRowStatement()]))',
        '          atomicMark?.committed()',
        '          movementWrittenAtomically = true',
        '        }'].join('\n') },
  ],
  'wrong-lot': [
    { name: 'wrong-lot', file: 'src/lib/productBatches.ts',
      from: '      params: { batchId: input.batchId, branchId: input.branchId, quantity: input.quantity },',
      to: '      params: { batchId: input.batchId - 1, branchId: input.branchId, quantity: input.quantity },' },
  ],
  'no-replay': [
    { name: 'no-replay', file: 'src/lib/stockMutationReceipt.ts',
      from: "  if (claim.state === 'replay') return json({ ...claim.body, replayed: true }, claim.status)",
      to: '  if (false) return json({}, 200)' },
  ],
}

let seq = 0
// A fresh product per case (unique ids) so cases never see each other's rows; global tables are filtered by product.
async function seed(H, { a = 5, b = 5, extra = [] } = {}) {
  const n = ++seq, p = 100 + n, lotA = p * 10 + 1, lotB = p * 10 + 2
  await H.db.batch([
    H.db.prepare("INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active) VALUES(?,?,?,2,0,?,1)").bind(p, 'AL Serum ' + p, '88500' + String(p).padStart(8, '0'), a + b),
    H.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').bind(p, LC, a + b),
    H.db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(?,?,?,?,?,1,3,1)").bind(lotA, p, 'A' + p, 'A' + p, '2026-09-02'),
    H.db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(?,?,?,?,?,2,5,1)").bind(lotB, p, 'B' + p, 'B' + p, '2026-09-09'),
    H.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)').bind(lotA, LC, a),
    H.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)').bind(lotB, LC, b),
    ...extra.map(sql => H.db.prepare(sql.replaceAll('$P', p).replaceAll('$A', lotA).replaceAll('$B', lotB))),
  ])
  return { p, lotA, lotB }
}

async function snap(H, s) {
  const lot = async id => (await H.q1('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=?', id, LC))?.quantity ?? null
  const frames = H.frames.length
  return {
    lotA: await lot(s.lotA), lotB: await lot(s.lotB),
    branch: (await H.q1('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=?', s.p, LC))?.quantity ?? null,
    product: (await H.q1('SELECT stock_quantity q FROM products WHERE id=?', s.p)).q,
    movements: (await H.q('SELECT movement_type t, quantity q, batch_id b, branch_id br, addressed_branch_name ab FROM inventory_movements WHERE product_id=? ORDER BY id', s.p)),
    receipts: (await H.q("SELECT request_id id, written w, response_status st, completed_at c FROM stock_mutation_receipts WHERE request_id LIKE ? ORDER BY request_id", 'al-a-' + s.p + '-%')),
    cache: await H.cacheVersion('products'),
    frameMark: frames,
  }
}

// The conservation law of the four ledgers: whatever left the selected lot left the branch, the product total and
// was written to the movement ledger -- once.
function ledgers(t, label, before, after, { lot = 'lotA' } = {}) {
  const out = (key) => Number(before[key]) - Number(after[key])
  const sum = (snapshot) => snapshot.movements.filter(m => m.t === 'remove').reduce((total, m) => total + Number(m.q), 0)
  const moved = sum(after) - sum(before)
  t.eq(label + ' selected lot, branch_stock, products.stock_quantity and movement quantity removed the same amount',
    { lot: out(lot), branch: out('branch'), product: out('product'), movement: moved },
    { lot: moved, branch: moved, product: moved, movement: moved })
}

function adjust(s, quantity, id, extra = {}) {
  return { productId: s.p, branchId: LC, type: 'remove', quantity, batchId: s.lotA, reason: 'AL counted damage', client_request_id: 'al-a-' + s.p + '-' + id, ...extra }
}

async function main() {
  const flavour = FLAGS.has('fix') ? 'fix' : OPTIONS.wrong
  const patches = flavour ? (PATCHES[flavour] || assert.fail('unknown control ' + flavour)) : []
  console.log('MODE: ' + (flavour ? 'control ' + flavour : 'production code at HEAD (no patch)'))
  const H = await world({ patches })
  try {
    // --------------------------------------------------------------------------------------------
    await check('A1', 'one Remove-4 of the SELECTED lot takes exactly 4 from it, nothing from the other lot (control for wrong-lot mutants)', 'high', async (t) => {
      const s = await seed(H)
      const before = await snap(H, s)
      const r = await H.api('POST', '/api/inventory/adjust', adjust(s, 4, '1', { batchId: s.lotB }))   // the NEWER lot: a FIFO or off-by-one implementation takes lot A
      await H.settle()
      const after = await snap(H, s)
      t.eq('HTTP status', r.status, 200)
      t.eq('lot A (not selected) untouched', after.lotA, 5)
      t.eq('lot B (selected) 5 -> 1', after.lotB, 1)
      t.eq('branch_stock 10 -> 6', after.branch, 6)
      t.eq('products.stock_quantity 10 -> 6', after.product, 6)
      t.eq('one movement, remove 4, attributed to lot B', after.movements.map(m => [m.t, m.q, m.b]), [['remove', 4, s.lotB]])
      t.eq('products cache version bumped once', after.cache - before.cache, 1)
      t.eq('live-update frames for this product (products + inventory)', H.syncFrames(before.frameMark).filter(f => f.payload && f.payload.id === s.p).length, 2)
      t.eq('receipt completed', after.receipts.map(x => [x.w, x.st]), [[1, 200]])
      t.note('D1 statements for this request: ' + r.d1 + ' (Free limit 50, Paid limit 1000)')
    })

    // --------------------------------------------------------------------------------------------
    await check('A2', 'second Remove-4 (new request id) from the same lot, which now holds 1, is refused and changes nothing', 'high', async (t) => {
      const s = await seed(H)
      await H.api('POST', '/api/inventory/adjust', adjust(s, 4, '1'))
      await H.settle()
      const before = await snap(H, s)
      const r = await H.api('POST', '/api/inventory/adjust', adjust(s, 4, '2'))
      await H.settle()
      const after = await snap(H, s)
      t.ok('HTTP status is a refusal (4xx)', r.status >= 400 && r.status < 500, { status: r.status, body: r.body })
      t.eq('lot A still 1', after.lotA, 1)
      t.eq('lot B still 5 (no removal from the wrong lot)', after.lotB, 5)
      t.eq('branch_stock still 6', after.branch, 6)
      t.eq('products.stock_quantity still 6', after.product, 6)
      t.eq('still one movement', after.movements.length, 1)
      t.eq('cache version unchanged by the refusal', after.cache, before.cache)
      t.eq('no new live-update frame for the refusal', H.syncFrames(before.frameMark).filter(f => f.payload && f.payload.id === s.p).length, 0)
    })

    await check('A2b', 'a REFUSED Remove leaves no written receipt behind (the same request id stays usable)', 'low', async (t) => {
      const s = await seed(H, { a: 1, b: 5 })
      const r = await H.api('POST', '/api/inventory/adjust', adjust(s, 4, '1'))
      const receipts = await H.q("SELECT written w, response_status st FROM stock_mutation_receipts WHERE request_id=?", 'al-a-' + s.p + '-1')
      t.ok('request refused', r.status >= 400, r.status)
      t.eq('receipt rows for a request that moved nothing', receipts, [])
    })

    // --------------------------------------------------------------------------------------------
    await check('A3', 'TWO concurrent Remove-4 of lot A (5): exactly one wins, the other is refused, ledgers agree', 'high', async (t) => {
      const s = await seed(H)
      const before = await snap(H, s)
      await H.control('barrier', { pattern: 'UPDATE branch_batch_stock SET quantity', count: 2 })
      const [r1, r2] = await Promise.all([
        H.api('POST', '/api/inventory/adjust', adjust(s, 4, '1')),
        H.api('POST', '/api/inventory/adjust', adjust(s, 4, '2')),
      ])
      await H.disarm()
      await H.settle()
      const after = await snap(H, s)
      const statuses = [r1.status, r2.status].sort()
      t.eq('one request succeeds and one is refused', statuses.filter(x => x === 200).length, 1)
      t.eq('lot A (5 - 4)', after.lotA, 1)
      t.eq('lot B untouched', after.lotB, 5)
      t.eq('branch_stock (10 - 4)', after.branch, 6)
      t.eq('products.stock_quantity (10 - 4)', after.product, 6)
      t.eq('exactly one movement of 4', after.movements.map(m => [m.t, m.q]), [['remove', 4]])
      t.eq('cache version bumped once (one effective removal)', after.cache - before.cache, 1)
      ledgers(t, 'ledgers:', before, after)
      t.note('statuses ' + JSON.stringify([r1.status, r2.status]) + '; bodies ' + JSON.stringify([r1.body.error || r1.body.success, r2.body.error || r2.body.success]))
    })

    // --------------------------------------------------------------------------------------------
    await check('A4', 'LOST ACKNOWLEDGEMENT inside the Worker: the stock batch commits, the call then throws "Network connection lost" and the D1 layer retries it', 'high', async (t) => {
      const s = await seed(H)
      const before = await snap(H, s)
      await H.control('ackloss', { faults: [{ pattern: 'UPDATE branch_batch_stock SET quantity', times: 1, message: 'D1_ERROR: Network connection lost' }] })
      const r = await H.api('POST', '/api/inventory/adjust', adjust(s, 4, '1'))
      const hits = (await H.controlGet('ackloss/result'))[0].hits
      await H.disarm()
      await H.settle()
      const after = await snap(H, s)
      t.eq('the fault really fired once', hits, 1)
      ledgers(t, 'ledgers:', before, after)
      t.ok('quantity removed from the selected lot is 0 or exactly the 4 requested', [0, 4].includes(before.lotA - after.lotA), { removedFromLot: before.lotA - after.lotA, removedFromBranch: before.branch - after.branch })
      t.ok('quantity removed from the branch is 0 or exactly the 4 requested', [0, 4].includes(before.branch - after.branch), { removedFromBranch: before.branch - after.branch })
      t.note('status ' + r.status + ' body ' + JSON.stringify(r.body).slice(0, 160))
    })

    await check('A5', 'lost acknowledgement at the HTTP edge: the client re-sends the identical request id -- replayed, never applied twice', 'high', async (t) => {
      const s = await seed(H)
      const first = await H.api('POST', '/api/inventory/adjust', adjust(s, 4, '1'))
      await H.settle()
      const afterFirst = await snap(H, s)
      const retry = await H.api('POST', '/api/inventory/adjust', adjust(s, 4, '1'))
      const changed = await H.api('POST', '/api/inventory/adjust', adjust(s, 3, '1'))
      await H.settle()
      const after = await snap(H, s)
      t.eq('first status', first.status, 200)
      t.eq('retry answered from the receipt (200 + replayed)', [retry.status, retry.body.replayed], [200, true])
      t.eq('same id with different details is a conflict', [changed.status, changed.body.code], [409, 'idempotency_conflict'])
      t.eq('lot A', [afterFirst.lotA, after.lotA], [1, 1])
      t.eq('branch_stock', [afterFirst.branch, after.branch], [6, 6])
      t.eq('products.stock_quantity', [afterFirst.product, after.product], [6, 6])
      t.eq('one movement', after.movements.length, 1)
      t.eq('replay and conflict do not bump the cache again', after.cache - afterFirst.cache, 0)
    })

    // --------------------------------------------------------------------------------------------
    await check('A6', 'FAILURE BEFORE THE MOVEMENT IS WRITTEN: stock, movement, receipt and cache must stay in step', 'high', async (t) => {
      const s = await seed(H)
      const before = await snap(H, s)
      await H.db.prepare("CREATE TRIGGER al_a6_movement_fault BEFORE INSERT ON inventory_movements WHEN NEW.product_id=" + s.p + " BEGIN SELECT RAISE(ABORT,'al_movement_fault'); END").run()
      let r, retry
      try {
        r = await H.api('POST', '/api/inventory/adjust', adjust(s, 4, '1'))
        await H.settle()
      } finally { await H.db.prepare('DROP TRIGGER al_a6_movement_fault').run() }
      const mid = await snap(H, s)
      retry = await H.api('POST', '/api/inventory/adjust', adjust(s, 4, '1'))   // the operator re-sends once the fault clears
      await H.settle()
      const after = await snap(H, s)
      ledgers(t, 'after the failed request:', before, mid)
      const changedStock = before.lotA !== mid.lotA || before.branch !== mid.branch || before.product !== mid.product
      t.eq('cache version follows stock (bumped iff stock changed)', mid.cache - before.cache, changedStock ? 1 : 0)
      t.ok('the failed request is not reported as a success', r.status >= 400, r.status)
      t.ok('after the fault clears the SAME request id can complete exactly once (or was already complete)', after.lotA === 1 && after.branch === 6 && after.product === 6 && after.movements.length === 1,
        { lotA: after.lotA, branch: after.branch, product: after.product, movements: after.movements.length, retryStatus: retry.status, retryBody: retry.body.code || retry.body.error })
      t.note('failed request: status ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 140) + '; retry: ' + retry.status)
    })

    // --------------------------------------------------------------------------------------------
    await check('A7', 'Old Shop (inactive, id 2) -> LC Store: refused without confirmation, lands on the SELECTED LC Store lot with confirmation', 'high', async (t) => {
      const s = await seed(H)
      const before = await snap(H, s)
      const refused = await H.api('POST', '/api/inventory/adjust', adjust(s, 4, '1', { branchId: OLD, batchId: s.lotB }))
      const mid = await snap(H, s)
      const ok = await H.api('POST', '/api/inventory/adjust', adjust(s, 4, '2', { branchId: OLD, batchId: s.lotB }), { headers: { 'X-Branch-Redirect': String(LC) } })
      await H.settle()
      const after = await snap(H, s)
      t.eq('without confirmation: 409 branch_redirect_required', [refused.status, refused.body.code], [409, 'branch_redirect_required'])
      t.eq('and nothing changed', [mid.lotA, mid.lotB, mid.branch, mid.product, mid.movements.length], [5, 5, 10, 10, 0])
      t.eq('with confirmation: 200', ok.status, 200)
      t.eq('lot A untouched, lot B 5 -> 1', [after.lotA, after.lotB], [5, 1])
      t.eq('branch_stock and product total 10 -> 6', [after.branch, after.product], [6, 6])
      t.eq('movement lands on LC Store lot B, addressed to Old Shop', after.movements.map(m => [m.t, m.q, m.b, m.br, m.ab]), [['remove', 4, s.lotB, LC, 'Old Shop']])
      ledgers(t, 'ledgers:', before, after, { lot: 'lotB' })
    })

    await check('A8', 'a lot that belongs to ANOTHER product is refused and nothing moves', 'medium', async (t) => {
      const mine = await seed(H)
      const other = await seed(H)
      const before = { mine: await snap(H, mine), other: await snap(H, other) }
      const r = await H.api('POST', '/api/inventory/adjust', adjust(mine, 2, '1', { batchId: other.lotA }))
      await H.settle()
      const after = { mine: await snap(H, mine), other: await snap(H, other) }
      t.ok('refused (4xx)', r.status >= 400 && r.status < 500, { status: r.status, body: r.body })
      t.eq('the other product\'s lot untouched', [after.other.lotA, after.other.branch, after.other.product], [5, 10, 10])
      t.eq('my product untouched', [after.mine.lotA, after.mine.lotB, after.mine.branch, after.mine.product, after.mine.movements.length], [5, 5, 10, 10, 0])
    })

    await check('A9', 'a malformed lot id ("<id>x") is refused, not silently read as the lot with that numeric prefix', 'low', async (t) => {
      const s = await seed(H)
      const r = await H.api('POST', '/api/inventory/adjust', adjust(s, 2, '1', { batchId: String(s.lotB) + 'x' }))
      await H.settle()
      const after = await snap(H, s)
      t.ok('refused (4xx)', r.status >= 400 && r.status < 500, { status: r.status, body: r.body })
      t.eq('no lot changed', [after.lotA, after.lotB, after.branch, after.product, after.movements.length], [5, 5, 10, 10, 0])
    })
  } finally {
    await H.disarm().catch(() => {})
    await H.dispose()
  }
  finish('A')
}
main().catch(error => { console.error(error); process.exitCode = 2 })
