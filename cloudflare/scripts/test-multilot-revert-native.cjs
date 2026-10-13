'use strict'
// ============================================================================================
// HARNESS -- the same one test-al-stock-{a,b}-native.cjs run (copied, not imported: each native test is
// self-contained on purpose, so a peer's edit to one harness can never change another test's verdict).
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
// MULTILOT-REVERT -- a removal that drew from several received-date lots, then Revert / Redo (R2 review F1).
//
// Four ledgers must move together on every step: the lot ledger (branch_batch_stock), branch_stock, products.stock_quantity
// and the movement ledger (inventory_movements). Before the fix a multi-lot removal wrote a movement with no lot (0084) and
// no record of what it took from each lot, so its Revert put the units back on branch_stock and the product total only:
// the lots stayed drained and the till, which reads lots, could not see them.
//
// The fix records the per-lot shares of any removal whose movement names no single lot, in the same batch as the stock
// change (dated_stock_count_batch_actions, the table a dated count already uses; negative quantity = taken). Revert reads
// them from the ROOT row of the chain, so Revert, Redo and Revert-of-Redo all move exactly those lots.
//
// An OLD multi-lot removal (written before the fix) has no shares. Its Revert would have to guess which lots to refill, so
// on a product that uses lots it is REFUSED (revert_lots_not_recorded, nothing written; Add stock with a received date is
// the way back). On a product that never had a lot the aggregate-only restore is exact and still works.
//
// Run (from cloudflare/):  node scripts/test-multilot-revert-native.cjs
//   --wrong=no-adjust-shares    mutant: /adjust writes the movement but not its lot shares    (M1, M3, M4, M7, M8, M9 go RED)
//   --wrong=no-import-shares    mutant: the CSV import writes the movement but not its shares (M2, M5, M9b go RED)
//   --wrong=ignore-shares       mutant: Revert ignores recorded shares (the pre-fix, aggregate-only Revert) (M1..M7, M9b go RED)
//   --wrong=no-old-refusal      mutant: an old share-less removal on a lot-tracked product is reverted aggregate-only (M6 goes RED)
//   --wrong=active-blind-precheck  mutant: the named-lot pre-check ignores pb.is_active again (R2 F8)           (M10 goes RED)
//   --only=M1,M2                run just those cases (debugging aid)
// Every mutant rewrites source text IN MEMORY at bundle time and fails loudly if its anchor is missing.
// ============================================================================================
const STOCK_REVERT = 'src/lib/stockRevert.ts'
const NO_OLD_REFUSAL = {
  name: 'no-old-refusal', file: STOCK_REVERT,
  from: 'if (!shares.length && OUT_TYPES.has(root.movement_type) && await productHasBatchHistory(db, productId)) {',
  to: 'if (false) {',
}
const PATCHES = {
  'no-adjust-shares': [
    { name: 'no-adjust-shares', file: 'src/routes/inventory.ts',
      from: 'resolvedBatchId == null ? planMovementLotShares(plan.batchQuantities.map((entry) => ({ batchId: entry.batchId, quantity: Math.abs(entry.quantity) }))) : []',
      to: '[]' },
  ],
  'no-import-shares': [
    { name: 'no-import-shares', file: 'src/lib/importEngine.ts',
      from: 'if (singleLot == null) statements.push(...planMovementLotShares(entry.takes).map(asStatement))',
      to: 'void asStatement' },
  ],
  'ignore-shares': [
    { name: 'ignore-shares', file: STOCK_REVERT,
      from: 'WHERE a.movement_id = @movementId AND a.quantity <> 0',
      to: 'WHERE 0 AND a.movement_id = @movementId AND a.quantity <> 0' },
    NO_OLD_REFUSAL,
  ],
  'no-old-refusal': [NO_OLD_REFUSAL],
  'active-blind-precheck': [
    { name: 'active-blind-precheck', file: 'src/routes/inventory.ts',
      from: 'CASE WHEN pb.is_active = 1 THEN COALESCE(bbs.quantity, 0) ELSE 0 END AS available',
      to: 'COALESCE(bbs.quantity, 0) AS available' },
  ],
}

let seq = 0
// A product at LC Store holding `lots` (units per lot, oldest received first) plus `undated` units under no lot.
async function seed(H, { lots = [5, 5], undated = 0 } = {}) {
  const n = ++seq, p = 900 + n
  const name = 'ML Probe ' + p, barcode = '88700' + String(p).padStart(8, '0')
  const ids = lots.map((_, i) => p * 100 + i + 1)
  const total = lots.reduce((a, b) => a + b, 0) + undated
  await H.db.batch([
    H.db.prepare('INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,stock_quantity,is_active) VALUES(?,?,?,2,0,10,40000,?,1)').bind(p, name, barcode, total),
    H.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').bind(p, LC, total),
    ...ids.flatMap((id, i) => [
      H.db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(?,?,?,?,?,?,?,1)')
        .bind(id, p, 'L' + id, 'L' + id, '2026-08-' + String(i + 1).padStart(2, '0'), i + 1, 3 + i),
      H.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)').bind(id, LC, lots[i]),
    ]),
  ])
  return { p, ids, name, barcode, total }
}

const OUT = new Set(['out', 'remove']), IN = new Set(['in', 'add'])
const netMoved = movements => movements.reduce((sum, m) => sum + (OUT.has(m.t) ? -Number(m.q) : IN.has(m.t) ? Number(m.q) : 0), 0)

async function snap(H, s) {
  const lots = s.ids.length
    ? (await H.q('SELECT batch_id id, quantity q FROM branch_batch_stock WHERE batch_id IN (' + s.ids.map(() => '?').join(',') + ') AND branch_id=? ORDER BY batch_id', ...s.ids, LC)).map(r => r.q)
    : []
  return {
    lots, lotsSum: lots.reduce((a, b) => a + b, 0),
    branch: (await H.q1('SELECT quantity q FROM branch_stock WHERE product_id=? AND branch_id=?', s.p, LC))?.q ?? null,
    product: (await H.q1('SELECT stock_quantity q FROM products WHERE id=?', s.p)).q,
    movements: await H.q('SELECT id, movement_type t, quantity q, batch_id b, reference_id ref FROM inventory_movements WHERE product_id=? ORDER BY id', s.p),
    shares: await H.q('SELECT a.movement_id m, a.batch_id b, a.quantity q FROM dated_stock_count_batch_actions a WHERE a.movement_id IN (SELECT id FROM inventory_movements WHERE product_id=?) ORDER BY a.id', s.p),
  }
}

// The four ledgers after a step. `lots` = units each lot must hold, `undated` = units branch_stock holds under no lot.
// Lot ledger, branch_stock and the product total agree with each other AND with the movement ledger: opening stock plus the
// signed sum of every movement is the branch figure.
function expectLedgers(t, label, x, s, { lots, undated = 0 }) {
  const branch = lots.reduce((a, b) => a + b, 0) + undated
  t.eq(label + ': lot ledger', x.lots, lots)
  t.eq(label + ': branch_stock', x.branch, branch)
  t.eq(label + ': products.stock_quantity', x.product, branch)
  t.eq(label + ': branch_stock minus the lot sum is the undated units', Math.round((x.branch - x.lotsSum) * 1e9) / 1e9, undated)
  t.eq(label + ': opening stock + signed movements', Math.round((s.total + netMoved(x.movements)) * 1e9) / 1e9, branch)
}

const revert = (H, id) => H.api('POST', '/api/inventory/movements/' + id + '/revert', {})
const adjustRemove = (H, s, quantity, id, extra = {}) => H.api('POST', '/api/inventory/adjust',
  { productId: s.p, branchId: LC, type: 'remove', quantity, reason: 'ML remove', client_request_id: 'ml-' + s.p + '-' + id, ...extra })

async function importCsv(H, action, rows) {
  const created = await H.api('POST', '/api/import-jobs', { type: 'inventory', policy: { source: 'ml-repro', inventory_action: action } })
  const id = created.body.job.id
  const csv = 'date,branch,name,sku,barcode,quantity,reason\n' + rows.map(r => r.join(',')).join('\n') + '\n'
  await H.multipart('/api/import-jobs/' + id + '/csv', 'file', action + '.csv', csv)
  await H.api('POST', '/api/import-jobs/' + id + '/start')
  const approved = await H.api('POST', '/api/import-jobs/' + id + '/approve', {})
  const detail = (await H.api('GET', '/api/import-jobs/' + id)).body
  return { id, approved, job: detail.job }
}
const row = (s, qty, reason) => ['', 'LC Store', s.name, '', s.barcode, String(qty), reason || 'ML CSV']

// Drive the Worker's real queue() consumer, exactly as Cloudflare Queues redelivers a message whose first attempt died.
async function redeliver(H, jobId, kind, attempts) {
  const worker = await H.mf.getWorker()
  await worker.queue('business-os-import', [{ id: 'ml-msg-' + attempts, timestamp: new Date(), body: { jobId, kind }, attempts }])
}

// The whole chain on one movement: Revert -> second Revert refused -> Redo -> second Redo refused -> Revert of the Redo.
// `drained` = the lot ledger right after the removal; `restored` = what it was before it. Every step is checked on all four ledgers.
async function chain(t, H, s, label, removal, { drained, restored, undatedDrained = 0, undatedRestored = 0 }) {
  const m1 = removal.movements[removal.movements.length - 1]
  const r2 = await revert(H, m1.id)
  const a2 = await snap(H, s)
  t.eq(label + ' revert answered', r2.status, 200)
  expectLedgers(t, label + ' after Revert (lots back where they were)', a2, s, { lots: restored, undated: undatedRestored })
  const m2 = a2.movements[a2.movements.length - 1]
  t.eq(label + ' the Revert is one compensating movement of the same units', [m2.t, m2.q, m2.ref, a2.movements.length], ['add', m1.q, 'revert:' + m1.id, removal.movements.length + 1])

  // Double apply: the same Revert again changes nothing.
  const again = await revert(H, m1.id)
  const a2b = await snap(H, s)
  t.eq(label + ' second Revert of the removal is refused', [again.status, again.body && again.body.code], [409, 'already_reverted'])
  expectLedgers(t, label + ' after the refused repeat', a2b, s, { lots: restored, undated: undatedRestored })
  t.eq(label + ' the refused repeat wrote no movement', a2b.movements.length, a2.movements.length)

  // Redo = Revert of the Revert: the same lot shares come off again.
  const r3 = await revert(H, m2.id)
  const a3 = await snap(H, s)
  t.eq(label + ' Redo answered', r3.status, 200)
  expectLedgers(t, label + ' after Redo (lots drained exactly as the removal drained them)', a3, s, { lots: drained, undated: undatedDrained })
  const m3 = a3.movements[a3.movements.length - 1]
  t.eq(label + ' the Redo is a remove of the same units', [m3.t, m3.q, m3.ref], ['remove', m1.q, 'revert:' + m2.id])
  const again2 = await revert(H, m2.id)
  t.eq(label + ' second Redo is refused', [again2.status, again2.body && again2.body.code], [409, 'already_reverted'])
  expectLedgers(t, label + ' after the refused second Redo', await snap(H, s), s, { lots: drained, undated: undatedDrained })

  // And back again: Revert of the Redo restores the same shares once more.
  const r4 = await revert(H, m3.id)
  const a4 = await snap(H, s)
  t.eq(label + ' Revert of the Redo answered', r4.status, 200)
  expectLedgers(t, label + ' after Revert of the Redo', a4, s, { lots: restored, undated: undatedRestored })
  t.eq(label + ' four movements in the chain', a4.movements.length, removal.movements.length + 3)
  return { m1, m2, m3 }
}

async function main() {
  const flavour = OPTIONS.wrong
  const patches = flavour ? (PATCHES[flavour] || assert.fail('unknown control ' + flavour)) : []
  console.log('MODE: ' + (flavour ? 'control ' + flavour : 'production code at HEAD (no patch)'))
  const H = await world({ patches })
  let F
  try {
    // ------------------------------------------------------------------ M1: POST /adjust, auto-routed across two lots
    await check('M1', '/adjust Remove 7 (lots 5+5, no lot named) takes 5 + 2; the shares are recorded; Revert / Redo / Revert move the same lots on all four ledgers', 'high', async (t) => {
      const s = await seed(H, { lots: [5, 5] })
      const removed = await adjustRemove(H, s, 7, 'a')
      const after = await snap(H, s)
      t.eq('Remove answered', removed.status, 200)
      expectLedgers(t, 'after the Remove', after, s, { lots: [0, 3] })
      t.eq('the movement names no single lot (0084)', after.movements.map(m => [m.t, m.q, m.b]), [['remove', 7, null]])
      t.eq('the per-lot shares are recorded with the movement (negative = taken)', after.shares.map(x => [x.m, x.b, x.q]), [[after.movements[0].id, s.ids[0], -5], [after.movements[0].id, s.ids[1], -2]])
      await chain(t, H, s, 'M1', after, { drained: [0, 3], restored: [5, 5] })
    })

    // ------------------------------------------------------------------ M2: CSV Remove, two lots
    await check('M2', 'CSV Remove 7 (lots 5+5) takes 5 + 2; the shares are recorded; Revert / Redo / Revert move the same lots on all four ledgers', 'high', async (t) => {
      const s = await seed(H, { lots: [5, 5] })
      const imported = await importCsv(H, 'remove', [row(s, 7)])
      const after = await snap(H, s)
      t.eq('import finished', imported.job.status, 'completed')
      expectLedgers(t, 'after the import', after, s, { lots: [0, 3] })
      t.eq('the movement names no single lot', after.movements.map(m => [m.t, m.q, m.b]), [['out', 7, null]])
      t.eq('the per-lot shares are recorded with the movement', after.shares.map(x => [x.m, x.b, x.q]), [[after.movements[0].id, s.ids[0], -5], [after.movements[0].id, s.ids[1], -2]])
      await chain(t, H, s, 'M2', after, { drained: [0, 3], restored: [5, 5] })
    })

    // ------------------------------------------------------------------ M3: one lot plus units that sit under no lot
    await check('M3', '/adjust Remove 7 of lot 5 + 3 undated units: the lot share is recorded, the 2 undated units stay branch-only through Revert / Redo', 'high', async (t) => {
      const s = await seed(H, { lots: [5], undated: 3 })
      const removed = await adjustRemove(H, s, 7, 'a')
      const after = await snap(H, s)
      t.eq('Remove answered', removed.status, 200)
      expectLedgers(t, 'after the Remove', after, s, { lots: [0], undated: 1 })
      t.eq('one lot covers only part of the movement, so no single lot is named', after.movements.map(m => [m.t, m.q, m.b]), [['remove', 7, null]])
      t.eq('the one lot share is recorded', after.shares.map(x => [x.m, x.b, x.q]), [[after.movements[0].id, s.ids[0], -5]])
      await chain(t, H, s, 'M3', after, { drained: [0], restored: [5], undatedDrained: 1, undatedRestored: 3 })
    })

    // ------------------------------------------------------------------ M4: five lots (a realistic wide spread), explicit-lot control
    await check('M4', '/adjust Remove 17 across five lots (4+4+4+4+4) records five shares and Revert / Redo / Revert move every one of them', 'high', async (t) => {
      const s = await seed(H, { lots: [4, 4, 4, 4, 4] })
      const removed = await adjustRemove(H, s, 17, 'a')
      const after = await snap(H, s)
      t.eq('Remove answered', removed.status, 200)
      expectLedgers(t, 'after the Remove', after, s, { lots: [0, 0, 0, 0, 3] })
      t.eq('five shares recorded', after.shares.map(x => [x.b, x.q]), [[s.ids[0], -4], [s.ids[1], -4], [s.ids[2], -4], [s.ids[3], -4], [s.ids[4], -1]])
      await chain(t, H, s, 'M4', after, { drained: [0, 0, 0, 0, 3], restored: [4, 4, 4, 4, 4] })
    })
    await check('M4b', 'control: a named-lot Remove names its lot on the movement, records no shares, and Revert / Redo already moved that lot', 'control', async (t) => {
      const s = await seed(H, { lots: [5, 5] })
      const removed = await adjustRemove(H, s, 4, 'a', { batchId: s.ids[1] })
      const after = await snap(H, s)
      t.eq('Remove answered', removed.status, 200)
      expectLedgers(t, 'after the Remove', after, s, { lots: [5, 1] })
      t.eq('the movement names the lot', after.movements.map(m => [m.t, m.q, m.b]), [['remove', 4, s.ids[1]]])
      t.eq('a single-lot movement needs no share rows', after.shares, [])
      await chain(t, H, s, 'M4b', after, { drained: [5, 1], restored: [5, 5] })
    })

    // ------------------------------------------------------------------ M5: CSV Set down across lots
    await check('M5', 'CSV Set 10 -> 3 (lots 5+5) drains 5 + 2 and records the shares; Revert / Redo / Revert move the same lots', 'high', async (t) => {
      const s = await seed(H, { lots: [5, 5] })
      const imported = await importCsv(H, 'set', [row(s, 3)])
      const after = await snap(H, s)
      t.eq('import finished', imported.job.status, 'completed')
      expectLedgers(t, 'after the Set', after, s, { lots: [0, 3] })
      t.eq('the movement names no single lot', after.movements.map(m => [m.t, m.q, m.b]), [['out', 7, null]])
      t.eq('the per-lot shares are recorded', after.shares.map(x => [x.m, x.b, x.q]), [[after.movements[0].id, s.ids[0], -5], [after.movements[0].id, s.ids[1], -2]])
      await chain(t, H, s, 'M5', after, { drained: [0, 3], restored: [5, 5] })
    })

    // ------------------------------------------------------------------ M6: an OLD movement (written before the fix) has no shares
    const oldRemoval = async (s, lotsNow, branchNow) => {
      // Exactly what the pre-fix writers left behind: lots and branch already drained, one batch-less 'remove' movement, no share rows.
      await H.db.batch([
        ...s.ids.map((id, i) => H.db.prepare('UPDATE branch_batch_stock SET quantity=? WHERE batch_id=? AND branch_id=?').bind(lotsNow[i], id, LC)),
        H.db.prepare('UPDATE branch_stock SET quantity=? WHERE product_id=? AND branch_id=?').bind(branchNow, s.p, LC),
        H.db.prepare('UPDATE products SET stock_quantity=? WHERE id=?').bind(branchNow, s.p),
        H.db.prepare("INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,reason,created_at) VALUES(?,?,?,'LC Store','remove',?,'ML old multi-lot remove','2026-09-20 10:00:00')")
          .bind(s.p, s.name, LC, s.total - branchNow),
      ])
      return (await snap(H, s)).movements[0]
    }
    await check('M6', 'an OLD batch-less removal on a product that uses lots has no shares: Revert is refused whole (nothing written), never a guess', 'high', async (t) => {
      const s = await seed(H, { lots: [5, 5] })
      const old = await oldRemoval(s, [0, 3], 3)
      const before = await snap(H, s)
      const r = await revert(H, old.id)
      const after = await snap(H, s)
      t.eq('refused with a stable code', [r.status, r.body && r.body.code], [400, 'revert_lots_not_recorded'])
      t.ok('the refusal says what to do instead', /Add stock|received date/i.test(String(r.body && r.body.error)), r.body)
      t.eq('nothing changed (lots, branch, total, movements, shares)', [after.lots, after.branch, after.product, after.movements.length, after.shares], [before.lots, before.branch, before.product, before.movements.length, []])
      t.eq('no lot was refilled by a guess', after.lots, [0, 3])
    })
    await check('M6b', 'control: an old batch-less removal on a product that never had a lot still reverts aggregate-only (the exact reversal), and so does the Redo', 'control', async (t) => {
      const s = await seed(H, { lots: [], undated: 10 })
      const old = await oldRemoval(s, [], 3)
      const r = await revert(H, old.id)
      const a = await snap(H, s)
      t.eq('Revert answered', r.status, 200)
      expectLedgers(t, 'after the Revert', a, s, { lots: [], undated: 10 })
      const r2 = await revert(H, a.movements[1].id)
      t.eq('Redo answered', r2.status, 200)
      expectLedgers(t, 'after the Redo', await snap(H, s), s, { lots: [], undated: 3 })
    })
    await check('M6c', 'control: re-adding an undated ADD (Revert of its Revert) is exact even on a product that uses lots -- only a removed root is refused', 'control', async (t) => {
      const s = await seed(H, { lots: [5, 5], undated: 4 })
      // An old aggregate-only receipt of 4 (no lot): the 4 undated units above are its units.
      await H.db.prepare("INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,reason,created_at) VALUES(?,?,?,'LC Store','add',4,'ML old undated add','2026-09-20 10:00:00')").bind(s.p, s.name, LC).run()
      const m1 = (await snap(H, s)).movements[0]
      const r1 = await revert(H, m1.id)
      const a1 = await snap(H, s)
      t.eq('Revert of the undated add answered', r1.status, 200)
      t.eq('lots untouched, the 4 undated units gone', [a1.lots, a1.branch, a1.product], [[5, 5], 10, 10])
      const r2 = await revert(H, a1.movements[1].id)
      const a2 = await snap(H, s)
      t.eq('Revert of that Revert (re-adding the 4) is not refused', r2.status, 200)
      t.eq('lots untouched, the 4 undated units back', [a2.lots, a2.branch, a2.product], [[5, 5], 14, 14])
    })

    // ------------------------------------------------------------------ M7: a Redo whose lot has since been drawn down
    await check('M7', 'Redo refuses whole when a recorded lot no longer holds its share (drawn since): nothing written, the units stay restored', 'high', async (t) => {
      const s = await seed(H, { lots: [5, 5, 5] })
      const removed = await adjustRemove(H, s, 7, 'a')
      const after = await snap(H, s)
      t.eq('Remove answered', removed.status, 200)
      const r2 = await revert(H, after.movements[0].id)
      t.eq('Revert answered', r2.status, 200)
      const a2 = await snap(H, s)
      // 4 units of the second lot leave through another writer (a named-lot Remove) before the Redo: the branch (11) still covers
      // the 7, but the second lot (1) cannot give back its share of 2.
      const other = await adjustRemove(H, s, 4, 'b', { batchId: s.ids[1] })
      t.eq('other writer answered', other.status, 200)
      const before = await snap(H, s)
      const redo = await revert(H, a2.movements[1].id)
      const end = await snap(H, s)
      t.eq('the Redo is refused for the lot that cannot cover its share', [redo.status, redo.body && redo.body.code], [400, 'revert_insufficient_lot_stock'])
      t.eq('nothing changed by the refused Redo', [end.lots, end.branch, end.product, end.movements.length], [before.lots, before.branch, before.product, before.movements.length])
      expectLedgers(t, 'ledgers still agree', end, s, { lots: [5, 1, 5] })
    })

    // ------------------------------------------------------------------ M9: the same write twice (double apply)
    await check('M9', '/adjust: the same client_request_id twice, and again after a lost acknowledgement, removes once and records the shares once', 'high', async (t) => {
      const s = await seed(H, { lots: [5, 5] })
      const first = await adjustRemove(H, s, 7, 'dup')
      const second = await adjustRemove(H, s, 7, 'dup')
      const a = await snap(H, s)
      t.eq('first and repeat both answered 200', [first.status, second.status], [200, 200])
      t.eq('the repeat is a replay', second.body && second.body.replayed, true)
      expectLedgers(t, 'after the repeat', a, s, { lots: [0, 3] })
      t.eq('one movement, two shares (not four)', [a.movements.length, a.shares.length], [1, 2])
      // A lost acknowledgement: the batch commits, the call then reports a network failure; the client retries the same id.
      const s2 = await seed(H, { lots: [5, 5] })
      await H.control('ackloss', { faults: [{ pattern: 'INSERT INTO inventory_movements', times: 1, message: 'D1_ERROR: Network connection lost' }] })
      const lost = await adjustRemove(H, s2, 7, 'lost')
      const fired = (await H.controlGet('ackloss/result'))[0].hits
      await H.disarm()
      const retry = await adjustRemove(H, s2, 7, 'lost')
      const b = await snap(H, s2)
      t.eq('the fault fired', fired, 1)
      t.note('lost-ack first call ' + lost.status + ' ' + JSON.stringify(lost.body).slice(0, 100) + '; retry ' + retry.status + ' ' + JSON.stringify(retry.body).slice(0, 100))
      expectLedgers(t, 'after the retry', b, s2, { lots: [0, 3] })
      t.eq('one movement, two shares (not four)', [b.movements.length, b.shares.length], [1, 2])
    })
    await check('M9b', 'CSV Remove: the chunk commits but its acknowledgement is lost; after redelivery the removal and its shares are written once', 'high', async (t) => {
      const s = await seed(H, { lots: [5, 5] })
      await H.control('ackloss', { faults: [{ pattern: 'INSERT INTO inventory_movements', times: 1, message: 'D1_ERROR: Network connection lost' }] })
      const r = await importCsv(H, 'remove', [row(s, 7)])
      const fired = (await H.controlGet('ackloss/result'))[0].hits
      await H.disarm()
      let job = (await H.api('GET', '/api/import-jobs/' + r.id)).body.job
      if (job.status !== 'completed') {
        await redeliver(H, r.id, 'apply', 2)
        job = (await H.api('GET', '/api/import-jobs/' + r.id)).body.job
      }
      await H.settle()
      const a = await snap(H, s)
      t.eq('the fault fired', fired, 1)
      t.eq('job finished', job.status, 'completed')
      expectLedgers(t, 'after the redelivery', a, s, { lots: [0, 3] })
      t.eq('one movement, two shares (not four)', [a.movements.length, a.shares.length], [1, 2])
      const rev = await revert(H, a.movements[0].id)
      t.eq('Revert answered', rev.status, 200)
      expectLedgers(t, 'after the Revert', await snap(H, s), s, { lots: [5, 5] })
    })

    // ------------------------------------------------------------------ M8: D1 statements per request (Paid 1000, Free 50)
    await check('M8', 'D1 statement counts: 2, 5 and 10 lots on Paid, and 2 and 5 lots on Free, stay inside the invocation limit', 'medium', async (t) => {
      const counts = []
      for (const lotsCount of [2, 5, 10]) {
        const s = await seed(H, { lots: Array(lotsCount).fill(2) })
        const removed = await adjustRemove(H, s, lotsCount * 2 - 1, 'n' + lotsCount)
        const m1 = (await snap(H, s)).movements[0]
        const rev = await revert(H, m1.id)
        const redo = await revert(H, (await snap(H, s)).movements[1].id)
        counts.push({ lots: lotsCount, remove: removed.d1, revert: rev.d1, redo: redo.d1 })
        t.eq(lotsCount + ' lots: all three answered 200', [removed.status, rev.status, redo.status], [200, 200, 200])
        t.ok(lotsCount + ' lots: inside the Paid limit of 1000', Math.max(removed.d1, rev.d1, redo.d1) <= 1000, counts[counts.length - 1])
      }
      t.note('Paid, statements per request: ' + JSON.stringify(counts))
      F = await world({ plan: 'free', patches })
      const free = []
      for (const lotsCount of [2, 5]) {
        const s = await seed(F, { lots: Array(lotsCount).fill(2) })
        const removed = await adjustRemove(F, s, lotsCount * 2 - 1, 'f' + lotsCount)
        const m1 = (await snap(F, s)).movements[0]
        const rev = await revert(F, m1.id)
        const redo = await revert(F, (await snap(F, s)).movements[1].id)
        free.push({ lots: lotsCount, remove: removed.d1, revert: rev.d1, redo: redo.d1 })
        t.eq('Free ' + lotsCount + ' lots: all three answered 200', [removed.status, rev.status, redo.status], [200, 200, 200])
        t.ok('Free ' + lotsCount + ' lots: every request inside the Free limit of 50', Math.max(removed.d1, rev.d1, redo.d1) <= 50, free[free.length - 1])
      }
      t.note('Free, statements per request: ' + JSON.stringify(free))
    })

    // ------------------------------------------------------------------ M10 (R2 review F8): a named lot that is not active
    // Last in this world: it drops migration 0154's "cannot deactivate a lot that holds stock" trigger to build the state the
    // removal batch's guard (pb.is_active = 1) was written for, which the trigger otherwise makes unreachable.
    await check('M10', 'F8: Remove from a NAMED lot that is not active is answered "only 0 available" (400, nothing written), not as a "refresh and try again" 409', 'medium', async (t) => {
      const emptied = await seed(H, { lots: [5, 5] })
      // The ordinary way a picker goes stale: the lot was emptied and left the pickers (inactive, nothing in it).
      await H.db.batch([
        H.db.prepare('UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=? AND branch_id=?').bind(emptied.ids[1], LC),
        H.db.prepare('UPDATE branch_stock SET quantity=5 WHERE product_id=? AND branch_id=?').bind(emptied.p, LC),
        H.db.prepare('UPDATE products SET stock_quantity=5 WHERE id=?').bind(emptied.p),
        H.db.prepare('UPDATE product_batches SET is_active=0 WHERE id=?').bind(emptied.ids[1]),
      ])
      const stale = await adjustRemove(H, emptied, 2, 'a', { batchId: emptied.ids[1] })
      t.eq('an emptied inactive lot: 400 with the shortage answer', [stale.status, stale.body && stale.body.error], [400, 'Only 0 available under this received date at this branch'])

      const s = await seed(H, { lots: [5, 5] })
      await H.db.exec('DROP TRIGGER positive_lot_reject_inactive_update_0154')
      await H.db.prepare('UPDATE product_batches SET is_active=0 WHERE id=?').bind(s.ids[1]).run()
      const before = await snap(H, s)
      const r = await adjustRemove(H, s, 2, 'b', { batchId: s.ids[1] })
      const after = await snap(H, s)
      const marks = await H.q('SELECT written w FROM stock_mutation_receipts WHERE request_id=?', 'ml-' + s.p + '-b')
      t.eq('an inactive lot that still holds stock answers 400 with the shortage, not the 409 conflict', [r.status, r.body && r.body.code, r.body && r.body.error], [400, undefined, 'Only 0 available under this received date at this branch'])
      t.eq('nothing was written (lots, branch, total, movements)', [after.lots, after.branch, after.product, after.movements.length], [before.lots, before.branch, before.product, 0])
      t.eq('the refused request left no written mark', marks.filter(x => x.w === 1).length, 0)
      // The same state through the auto-routed path is unaffected: it already skips inactive lots, and drains the active one.
      const auto = await adjustRemove(H, s, 4, 'c')
      const drained = await snap(H, s)
      t.eq('an auto-routed Remove skips the inactive lot and takes the active one', [auto.status, drained.lots], [200, [1, 5]])
    })
  } finally {
    await H.disarm().catch(() => {})
    await H.dispose()
    if (F) { await F.disarm().catch(() => {}); await F.dispose() }
  }
  finish('MULTILOT-REVERT')
}
main().catch(error => { console.error(error); process.exitCode = 2 })
