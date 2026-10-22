'use strict'
// ============================================================================================
// HARNESS -- the same workerd + Miniflare harness as the four test-al-stock-{a,b,i,k}-native.cjs files, copied
// here so this file stays self-contained (it reads from, and changes, no other test). Unlike them it keeps the Worker seed
// branches: it sells, and a sale needs an active selling branch.
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
  // This file sells: the Worker seed branches are kept (a sale needs an active SELLING branch, the seeded Shop).
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
// A STOCK MOVEMENT IN A SALE'S WRITE WINDOW IS NOT A PRICING CHANGE (13 Oct 2026).
//
// POST /api/sales and POST /api/sales/:id/items open their write batch with pricingSourceGuard: a SELECT that aborts the
// whole batch (nothing is written) when the product rows read before the write are no longer exactly what is stored. It
// compares EVERY column, so a stock Remove (or another till's sale) that lands between the read and the write -- it moves
// products.stock_quantity and updated_at -- trips it exactly as a price change does. The routes then answered
// "Pricing changed before the sale was saved. Review the current quote." (409 sale_pricing_quote_conflict) for both,
// which sent the cashier back into a quote review for a quote that was fine.
//
// Now the catch asks lib/saleItemPricing.ts classifyPricingSourceConflict: the guard restricted to the columns that price
// a line trips -> still sale_pricing_quote_conflict; only the full guard trips -> 409 sale_stock_changed, "Stock changed
// while this sale was being saved. Nothing was recorded. Try again.".
//
// The interleaving is deterministic: a `hook` runs a request to completion at the instant the sale's batch is about to
// execute (the harness above), so the Remove / the price edit really commits between the read and the write.
//
// Run (from cloudflare/):  node scripts/test-sale-stock-changed-native.cjs
//   --wrong=always-pricing      the classifier calls every guard abort a pricing change (the pre-fix behaviour)
//   --wrong=always-stock        the classifier calls every guard abort a stock change (a price change must stay pricing)
//   --only=<ids>  --plan=free
// ============================================================================================
const PRICING = 'src/lib/saleItemPricing.ts'
const PATCHES = {
  'always-pricing': [
    { name: 'always-pricing', file: PRICING, from: "return row?.verdict==='pricing' ? 'pricing' : row?.verdict==='stock' ? 'stock' : null", to: "return row?.verdict==='pricing' || row?.verdict==='stock' ? 'pricing' : null" },
  ],
  'always-stock': [
    { name: 'always-stock', file: PRICING, from: "return row?.verdict==='pricing' ? 'pricing' : row?.verdict==='stock' ? 'stock' : null", to: "return row?.verdict==='pricing' || row?.verdict==='stock' ? 'stock' : null" },
  ],
}

const SELL = 1 // the seeded Shop, given the shop role below: the active selling branch
let seq = 0
const QUOTE_FIELDS = ['gross_usd', 'product_discount_usd', 'manual_discount_usd', 'total_usd', 'total_khr']
let stockKernelPromise
function stockKernel() {
  return stockKernelPromise ||= require('esbuild').build({ stdin: { contents: "export { executeRawStockTransaction } from './src/lib/stockTransaction'", resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' }).then(bundle => {
    const mod = { exports: {} }
    new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports)
    return mod.exports
  })
}

async function product(H, { stock = 20, price = 10 } = {}) {
  const { executeRawStockTransaction } = await stockKernel()
  const n = ++seq, id = 700 + n, lot = id * 10 + 1
  await executeRawStockTransaction(H.db, [
    H.db.prepare('INSERT INTO products(id,name,barcode,sku,cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,stock_quantity,is_active) VALUES(?,?,?,?,4,0,?,?,?,1)')
      .bind(id, 'SS Powder ' + id, '88700' + String(id).padStart(8, '0'), 'SS-' + id, price, price * 4000, stock),
    H.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').bind(id, SELL, stock),
    H.db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(?,?,?,?,'2026-09-02',1,4,1)").bind(lot, id, 'SS' + id, 'SS' + id),
    H.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)').bind(lot, SELL, stock),
  ])
  assert.deepEqual(await H.q("SELECT value FROM system_flags WHERE key='stock_transaction_permit'"),[],'product fixture releases its stock permit')
  const stockState = async () => Object.fromEntries(await Promise.all(['products','branch_stock','product_batches','branch_batch_stock','damaged_stock_lots','system_flags'].map(async table => [table,await H.q('SELECT * FROM '+table+' ORDER BY rowid')])))
  const beforeRawMutation = await stockState()
  await assert.rejects(H.db.prepare('UPDATE products SET stock_quantity=stock_quantity+1 WHERE id=?').bind(id).run(), /stock_transaction_required/)
  assert.deepEqual(await stockState(),beforeRawMutation,'raw mutation stays refused before any actual competing business request')
  return { id, lot, price }
}

// The POS body: v1 money, a captured pricing quote and the owner stamp. The first answer to a zero quote is the server's own
// quote (the till's review step), which the real request then carries.
async function saleBody(H, p, key, quantity = 1) {
  const org = (await H.q1('SELECT organization_id o FROM users WHERE id=1')).o
  const total = p.price * quantity
  const body = {
    branch_id: SELL, money_precision_version: 1, sale_status: 'completed', exchange_rate: 4000, payment_currency: 'USD', client_request_id: key,
    offline_owner: { version: 1, actor_id: 1, organization_id: org ?? null, authority: 'http://localhost', runtime: 'cloudflare-workers' },
    payment_details: [{ method: 'Cash', amount_usd: total, amount_khr: 0 }], payment_method: 'Cash', amount_paid_usd: total, amount_paid_khr: 0,
    items: [{ product_id: p.id, quantity, branch_id: SELL, batch_id: p.lot, client_line_key: key + '-line-1', pricing_source: 'selling',
      pricing_quote: { gross_usd: 0, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 0, total_khr: 0 } }],
  }
  const first = await H.api('POST', '/api/sales', body)
  assert.equal(first.status, 409, 'the zero quote is answered with the server quote: ' + JSON.stringify(first.body).slice(0, 200))
  assert.equal(first.body.code, 'sale_pricing_quote_conflict')
  const quote = first.body.pricing_quotes.find(q => q.client_line_key === key + '-line-1')
  body.items[0].pricing_quote = Object.fromEntries(QUOTE_FIELDS.map(name => [name, quote[name]]))
  return body
}

const stockOf = async (H, p) => ({
  product: (await H.q1('SELECT stock_quantity q FROM products WHERE id=?', p.id)).q,
  branch: (await H.q1('SELECT quantity q FROM branch_stock WHERE product_id=? AND branch_id=?', p.id, SELL)).q,
  lot: (await H.q1('SELECT quantity q FROM branch_batch_stock WHERE batch_id=? AND branch_id=?', p.lot, SELL)).q,
  movements: (await H.q('SELECT movement_type t, quantity q FROM inventory_movements WHERE product_id=? ORDER BY id', p.id)).map(m => [m.t, m.q]),
})
const salesFor = async (H, key) => (await H.q1('SELECT COUNT(*) n FROM sales WHERE client_request_id=?', key)).n
const removeRequest = (H, p, id, quantity = 2) => H.hookRequest('POST', '/api/inventory/adjust',
  { productId: p.id, branchId: SELL, type: 'remove', quantity, batchId: p.lot, reason: 'SS concurrent remove', client_request_id: id })

async function mainBody() {
  const flavour = OPTIONS.wrong
  const patches = flavour ? (PATCHES[flavour] || assert.fail('unknown control ' + flavour)) : []
  console.log('MODE: ' + (flavour ? 'control ' + flavour : 'production code at HEAD (no patch)') + '; plan ' + (OPTIONS.plan || 'paid'))
  const H = await world({ patches, plan: OPTIONS.plan || 'paid' })
  try {
    // The Worker seed leaves the branch roles empty; a sale needs an active branch with the shop role.
    await H.db.batch([
      H.db.prepare("UPDATE branches SET role='shop', canonical_key='shop' WHERE id=1"),
      H.db.prepare("UPDATE branches SET role='warehouse', canonical_key='warehouse' WHERE id=2"),
    ])
    if (OPTIONS.debug) console.log(JSON.stringify(await H.q('SELECT id,name,role,canonical_key,is_active,is_default FROM branches')))
    await check('S1', 'a stock Remove that lands in the sale\'s write window: 409 sale_stock_changed (not "pricing changed"), nothing recorded, the Remove stands, and the same request id then succeeds', 'high', async (t) => {
      const p = await product(H)
      const key = 'ss-stock-' + p.id
      const body = await saleBody(H, p, key)
      await H.control('hooks', { hooks: [{ pattern: 'INSERT INTO sales\\b', request: removeRequest(H, p, 'ss-rm-' + p.id) }] })
      const refused = await H.api('POST', '/api/sales', body)
      const hook = (await H.controlGet('hooks/result'))[0]
      await H.disarm()
      await H.settle()
      const after = await stockOf(H, p)
      t.eq('the concurrent Remove really committed between the read and the write', [hook.fired, hook.result && hook.result.status], [true, 200])
      t.eq('the sale is refused 409 with the stock code', [refused.status, refused.body && refused.body.code], [409, 'sale_stock_changed'])
      t.eq('the sentence is the stock sentence, not the pricing one', refused.body && refused.body.error, 'Stock changed while this sale was being saved. Nothing was recorded. Try again.')
      t.eq('no sale, no sale line recorded', [await salesFor(H, key), (await H.q1('SELECT COUNT(*) n FROM sale_items WHERE product_id=?', p.id)).n], [0, 0])
      t.eq('only the Remove moved stock (20 - 2), in every ledger, and it wrote one movement', [after.product, after.branch, after.lot, after.movements], [18, 18, 18, [['remove', 2]]])
      t.note('refused request: ' + refused.d1 + ' D1 statements (Free 50 / Paid 1000)')
      t.ok('the refusal fits the plan\'s per-invocation budget', refused.d1 <= (OPTIONS.plan === 'free' ? 50 : 1000), refused.d1)
      // "Try again" is true: the same body, the same request id, no concurrent change.
      const retry = await H.api('POST', '/api/sales', body)
      await H.settle()
      const done = await stockOf(H, p)
      t.eq('the retry with the same request id records the sale', [retry.status, await salesFor(H, key)], [200, 1])
      t.eq('and takes exactly one unit more (18 - 1)', [done.product, done.branch, done.lot], [17, 17, 17])
    })

    await check('S2', 'a PRICE change in the write window is still "pricing changed": 409 sale_pricing_quote_conflict, nothing recorded', 'high', async (t) => {
      const p = await product(H)
      const key = 'ss-price-' + p.id
      const body = await saleBody(H, p, key)
      await H.control('hooks', { hooks: [{ pattern: 'INSERT INTO sales\\b', request: H.hookRequest('PUT', '/api/products/' + p.id, { selling_price_usd: p.price + 1 }) }] })
      const refused = await H.api('POST', '/api/sales', body)
      const hook = (await H.controlGet('hooks/result'))[0]
      await H.disarm()
      t.eq('the price edit really committed in the window', [hook.fired, hook.result && hook.result.status], [true, 200])
      t.eq('refused as a pricing change', [refused.status, refused.body && refused.body.code], [409, 'sale_pricing_quote_conflict'])
      t.eq('nothing recorded, stock untouched', [await salesFor(H, key), (await stockOf(H, p)).product], [0, 20])
    })

    await check('S3', 'a price change AND a stock movement in the window: pricing wins (the quote is stale, so the cashier must review it)', 'medium', async (t) => {
      const p = await product(H)
      const key = 'ss-both-' + p.id
      const body = await saleBody(H, p, key)
      // Two interleaved requests at the same instant: the price edit and a Remove.
      await H.control('hooks', { hooks: [
        { pattern: 'INSERT INTO sales\\b', request: H.hookRequest('PUT', '/api/products/' + p.id, { selling_price_usd: p.price + 1 }) },
        { pattern: 'INSERT INTO sales\\b', request: removeRequest(H, p, 'ss-both-rm-' + p.id) },
      ] })
      const refused = await H.api('POST', '/api/sales', body)
      const hooks = await H.controlGet('hooks/result')
      t.eq('both concurrent requests committed in the window', hooks.map(h => [h.fired, h.result && h.result.status]), [[true, 200], [true, 200]])
      await H.disarm()
      t.eq('refused as a pricing change', [refused.status, refused.body && refused.body.code], [409, 'sale_pricing_quote_conflict'])
    })

    await check('S4', 'control: no concurrent change -> the sale is recorded (the guard never fires, the classifier is not consulted)', 'control', async (t) => {
      const p = await product(H)
      const key = 'ss-clean-' + p.id
      const body = await saleBody(H, p, key)
      const ok = await H.api('POST', '/api/sales', body)
      await H.settle()
      t.eq('recorded', [ok.status, await salesFor(H, key)], [200, 1])
      t.eq('one unit out of every ledger', [(await stockOf(H, p)).product, (await stockOf(H, p)).branch, (await stockOf(H, p)).lot], [19, 19, 19])
    })

    await check('S5', 'POST /api/sales/:id/items has the same two answers: a stock Remove in the write window is sale_stock_changed, nothing added', 'high', async (t) => {
      const p = await product(H)
      const key = 'ss-add-' + p.id
      const sale = await H.api('POST', '/api/sales', await saleBody(H, p, key))
      assert.equal(sale.status, 200, 'fixture sale: ' + JSON.stringify(sale.body).slice(0, 200))
      const saleId = sale.body.id
      const addRequest = { money_precision_version: 1, expected_exchange_rate: 4000, client_request_id: 'ss-add-req-' + p.id,
        items: [{ product_id: p.id, quantity: 1, branch_id: SELL, batch_id: p.lot, client_line_key: 'ss-add-line-' + p.id, pricing_source: 'selling',
          pricing_quote: { gross_usd: 0, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 0, total_khr: 0 } }] }
      await H.control('hooks', { hooks: [{ pattern: 'INSERT INTO sale_items\\b', request: removeRequest(H, p, 'ss-add-rm-' + p.id, 3) }] })
      // The till's review handshake: take the server's quotes from its own uncommitted refusals, then the real write.
      let answer
      for (let attempt = 0; attempt < 5; attempt++) {
        answer = await H.api('POST', '/api/sales/' + saleId + '/items', addRequest)
        if (answer.status === 409 && answer.body.code === 'sale_pricing_quote_conflict' && Array.isArray(answer.body.pricing_quotes)) {
          const quote = answer.body.pricing_quotes.find(q => q.client_line_key === addRequest.items[0].client_line_key)
          if (quote) { addRequest.items[0].pricing_quote = Object.fromEntries(QUOTE_FIELDS.map(name => [name, quote[name]])); continue }
        }
        if (answer.status === 409 && answer.body.code === 'sale_header_quote_conflict') { addRequest.expected_header_quote = answer.body.header_quote; continue }
        break
      }
      const hook = (await H.controlGet('hooks/result'))[0]
      await H.disarm()
      await H.settle()
      const lines = (await H.q1('SELECT COUNT(*) n FROM sale_items WHERE sale_id=?', saleId)).n
      t.eq('the concurrent Remove really committed in the window', [hook.fired, hook.result && hook.result.status], [true, 200])
      t.eq('refused with the stock code', [answer.status, answer.body && answer.body.code], [409, 'sale_stock_changed'])
      t.eq('no line added', lines, 1)
      t.eq('only the sale\'s own unit and the Remove left the product (20 - 1 - 3)', (await stockOf(H, p)).product, 16)
    })
  } finally {
    await H.disarm().catch(() => {})
    await H.dispose()
  }
  finish('SS')
}
mainBody().catch(error => { console.error(error); process.exitCode = 2 })
