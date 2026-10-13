'use strict'
// ============================================================================================
// HARNESS -- copied from test-al-stock-i-native.cjs (each native test is self-contained on purpose).
//
// What it runs: the REAL Worker (cloudflare/src/index.ts, every middleware, route and lib) bundled
// with esbuild and executed in workerd under Miniflare, on a D1 migrated with every file in
// cloudflare/migrations, with real KV (cache versions), R2, Durable Objects (the live-update
// WebSocket hub) and a real session cookie. Nothing in src/ is changed. Only authentication
// credential entry is shortcut: the session row is inserted directly (same SHA-256 token hash the
// real login stores) so a user can be given an exact permission set.
//
// A thin wrapper entry sits in FRONT of the Worker (never inside it) so that a test can count D1
// statements per invocation and arm interleavings (`hook`, `barrier`, `ackLoss`; unused by this file).
// Mutation controls (`--wrong=<name>`) rewrite SOURCE TEXT IN MEMORY at bundle time; they never
// touch a file on disk and fail loudly if their anchor text is missing.
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
// OPUS F1 (13 Oct 2026) -- an editor whose products:merge_duplicates is OFF merged two products by editing one
// product's name/barcode onto the other's.
//
// PUT /api/products/:id that moves a row onto another product's identity folds the row INTO it (the Sep 16 2026
// ruling): the edited row is retired, its stock/lots/history move, a `product.merge` undo record is written. That is the
// same operation as POST /api/products/merge-duplicates, which refuses unless the action tier is 'full'. The PUT fold
// never read the grant (Employee default: merge_duplicates = false; the person who merged could not Undo it either).
//
// Required outcome by the editor's products:merge_duplicates ACTION tier (getActionTier):
//   none   -> 403 product_merge_permission_required; both rows, revisions, audit, history, cache, socket untouched;
//             NOTHING queued (a switched-off action is refused, not held: the same rule the image check follows)
//   review -> 202 queued (finding I's queue), nothing merged
//   full   -> the fold runs
// Required ORDER inside the fold branch: [merge-permission refusal, image refusal, review queue] (identityFoldRefusal)
// -> survivor-price refusal (finding H) -> identity write.
//
// Run (from cloudflare/):  node scripts/test-merge-permission-fold-native.cjs
//   --wrong=no-merge-check              the grant is never read (the base behaviour)
//   --wrong=section-only                judge the SECTION tier, ignoring the per-action switch
//   --wrong=tier-not-full               copy of the merge routes' `!== 'full'`: refuses a Review-tier editor instead of queueing
//   --wrong=queue-before-merge-check    queue a review-tier request before the grant is read (merge-off + review gets 202)
//   --wrong=merge-after-survivor-price  read the grant after finding H's survivor-price refusal
//   --only=<ids>                        run only these case ids
// ============================================================================================
const PRODUCTS = 'src/routes/products.ts'
const SURVIVOR_PRICE_CALL = '        if (await foldSurvivorPriceChangeDenied(c.env, user, duplicate.id, body)) return c.json(PRODUCT_DISCOUNT_PRICE_REFUSAL, 403)'
const MERGE_TIER = "getActionTier(user, 'products', 'merge_duplicates') === 'none'"
const MERGE_GATE_OPEN = '  if (' + MERGE_TIER + ') {'
const PATCHES = {
  'no-merge-check': [
    { name: 'no-merge-check', file: PRODUCTS, from: MERGE_TIER, to: 'false' },
  ],
  'section-only': [
    { name: 'section-only', file: PRODUCTS, from: MERGE_TIER, to: "getPermissionTier(user, 'products') === 'none'" },
  ],
  'tier-not-full': [
    { name: 'tier-not-full', file: PRODUCTS, from: MERGE_TIER, to: "getActionTier(user, 'products', 'merge_duplicates') !== 'full'" },
  ],
  'queue-before-merge-check': [
    { name: 'queue-before-merge-check', file: PRODUCTS, from: MERGE_GATE_OPEN,
      to: [
        "  if (!isImageOnlyEdit) { const early = await maybeQueueForReview(c.env, user, 'products', { actionType: 'update', entityType: 'product', entityId: dupRow.id, payload: body, summary: 'Update product #' + dupRow.id })",
        '    if (early != null) return c.json({ success: true, pending: true, pendingActionId: early }, 202) }',
        MERGE_GATE_OPEN].join('\n') },
  ],
  'merge-after-survivor-price': [
    { name: 'gate-off-inside', file: PRODUCTS, from: MERGE_TIER, to: 'false' },
    { name: 'gate-after-price', file: PRODUCTS, from: SURVIVOR_PRICE_CALL,
      to: [SURVIVOR_PRICE_CALL,
        "        if (getActionTier(user, 'products', 'merge_duplicates') === 'none') return c.json({ error: 'merge', code: 'product_merge_permission_required' }, 403)"].join('\n') },
  ],
}

const CODE = 'product_merge_permission_required'
let seq = 0
// X is the row being edited (it carries an image the fold would move); Y already holds the identity X is moved onto.
async function pair(H, { shape, xImage = '/uploads/mp-x.jpg' } = {}) {
  const n = ++seq, x = 300 + n * 2, y = x + 1
  const nameX = 'MP Identity ' + n, nameY = shape === 'barcode' ? nameX : 'MP Identity ' + n + ' Large'
  const barX = '88600' + String(x).padStart(8, '0'), barY = shape === 'name' ? barX : '88600' + String(y).padStart(8, '0')
  const old = '2026-01-01 00:00:00'
  await H.db.batch([
    H.db.prepare('INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active,image_path,created_at,updated_at) VALUES(?,?,?,2,0,0,1,?,?,?)').bind(x, nameX, barX, xImage, old, old),
    H.db.prepare('INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active,image_path,created_at,updated_at) VALUES(?,?,?,2,0,0,1,NULL,?,?)').bind(y, nameY, barY, old, old),
  ])
  return { x, y, nameX, nameY, barX, barY }
}
// An existing product a create can land on: same name, the barcode stored with two leading zeros.
async function existingForCreate(H) {
  const n = ++seq, id = 300 + n * 2
  const name = 'MP Create ' + n, clean = '88600' + String(id).padStart(8, '0')
  await H.db.prepare("INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active,image_path,created_at,updated_at) VALUES(?,?,?,2,0,0,1,NULL,'2026-01-01 00:00:00','2026-01-01 00:00:00')")
    .bind(id, name, '00' + clean).run()
  return { id, name, clean }
}

async function snap(H, s) {
  const ids = [s.x, s.y]
  return {
    rows: Object.fromEntries((await H.q('SELECT * FROM products WHERE id IN (?,?) ORDER BY id', ...ids)).map(r => [r.id, r])),
    revisions: Object.fromEntries((await H.q("SELECT entity_type t, entity_key k, revision r FROM stock_session_revisions WHERE (entity_type='product' AND entity_key IN (?,?)) OR entity_type='product_catalog'", ...ids.map(String))).map(r => [r.t + ':' + r.k, r.r])),
    audits: (await H.q1('SELECT COUNT(*) n FROM audit_logs')).n,
    history: (await H.q1('SELECT COUNT(*) n FROM action_history')).n,
    merges: (await H.q1("SELECT COUNT(*) n FROM undo_snapshots WHERE kind='product.merge'")).n,
    pending: (await H.q1('SELECT COUNT(*) n FROM pending_actions')).n,
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
// "Nothing happened": rows, stock revisions, audit, action history, merge undo records, pending queue, cache, socket.
function assertNothingHappened(t, before, after, H) {
  t.eq('both product rows unchanged (name, barcode, updated_at, is_active and every other column)', changedColumns(before, after), {})
  t.eq('stock revisions unchanged (open stock sessions compare these)', revisionChanges(before, after), {})
  t.eq('audit rows added', after.audits - before.audits, 0)
  t.eq('action-history rows added', after.history - before.history, 0)
  t.eq('product.merge undo records added', after.merges - before.merges, 0)
  t.eq('pending actions queued', after.pending - before.pending, 0)
  t.eq('products cache version bumped', after.cache - before.cache, 0)
  t.eq('live-update frames emitted', H.syncFrames(before.frames).length, 0)
}
function assertRefusedForMerge(t, r, s) {
  t.eq('HTTP status', r.status, 403)
  t.eq('refusal code', r.body && r.body.code, CODE)
  t.ok('the refusal does not name the survivor product', !JSON.stringify(r.body).includes(String(s.y)), r.body)
}

async function main() {
  const flavour = OPTIONS.wrong
  const patches = flavour ? (PATCHES[flavour] || assert.fail('unknown control ' + flavour)) : []
  console.log('MODE: ' + (flavour ? 'control ' + flavour : 'production code at HEAD (no patch)'))
  const H = await world({ patches })
  try {
    // Products Full, but the merge-duplicates action switched off (the Employee default for that action).
    await H.addUser(2, 'mp-merge-off', { products: true, 'products:merge_duplicates': false })
    await H.addSession('mergeoff', 2, { device: 'Editor Phone' })
    // The reviewer's probe user: merge AND default-price switched off.
    await H.addUser(3, 'mp-probe', { products: true, 'products:merge_duplicates': false, 'products:price': false })
    await H.addSession('probe', 3, { device: 'Probe Laptop' })
    // Review Required on products, merge not switched off: its action tier is 'review'.
    await H.addUser(4, 'mp-review', { products: 'review' })
    await H.addSession('review', 4, { device: 'Counter Tablet' })
    // Review Required AND merge switched off: its action tier is 'none'.
    await H.addUser(5, 'mp-review-merge-off', { products: 'review', 'products:merge_duplicates': false })
    await H.addSession('reviewoff', 5, { device: 'Back Office Tablet' })
    // Products Full, merge not switched off.
    await H.addUser(6, 'mp-full', { products: true })
    await H.addSession('full', 6, { device: 'Manager Laptop' })

    const identityBody = {
      both: (s) => ({ name: s.nameY, barcode: s.barY }),
      barcode: (s) => ({ barcode: s.barY }),
      name: (s) => ({ name: s.nameY }),
    }
    const shapeLabel = { both: 'name AND barcode both move onto the other product', barcode: 'only the BARCODE moves', name: 'only the NAME moves' }

    // ---- none: refused, nothing happens --------------------------------------------------------------------------
    for (const shape of ['both', 'barcode', 'name']) {
      await check('MP-none-' + shape, 'merge_duplicates OFF: identity PUT is refused 403 and BOTH products are unchanged: ' + shapeLabel[shape], 'high', async (t) => {
        const s = await pair(H, { shape })
        const before = await snap(H, s)
        const r = await H.api('PUT', '/api/products/' + s.x, identityBody[shape](s), { as: 'mergeoff' })
        await H.settle()
        const after = await snap(H, s)
        assertRefusedForMerge(t, r, s)
        assertNothingHappened(t, before, after, H)
        t.eq('the edited row is still active', after.rows[s.x].is_active, 1)
        t.note('status ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200) + '; changed columns: ' + JSON.stringify(changedColumns(before, after)).slice(0, 300))
      })
    }

    await check('MP-probe-user', "the Opus reviewer's probe user (merge OFF, price OFF) editing X onto Y: 403, X still active, Y untouched", 'high', async (t) => {
      const s = await pair(H, { shape: 'both' })
      const before = await snap(H, s)
      const r = await H.api('PUT', '/api/products/' + s.x, identityBody.both(s), { as: 'probe' })
      await H.settle()
      assertRefusedForMerge(t, r, s)
      assertNothingHappened(t, before, await snap(H, s), H)
      t.note('status ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200))
    })

    // ORDER: the grant is read before finding H's survivor-price refusal. The probe user has no price grant and posts the
    // whole form, whose prices differ from the survivor's, so the price refusal would also fire -- the merge refusal
    // must be the one the person sees.
    await check('MP-order-merge-before-price', 'ORDER: merge OFF + price OFF + whole-form prices that differ from the survivor: the MERGE refusal wins over the survivor-price refusal', 'high', async (t) => {
      const s = await pair(H, { shape: 'both' })
      await H.db.prepare('UPDATE products SET selling_price_usd=5, wholesale_price_usd=4 WHERE id=?').bind(s.y).run()
      const before = await snap(H, s)
      const r = await H.api('PUT', '/api/products/' + s.x, { name: s.nameY, barcode: s.barY, selling_price_usd: 0, selling_price_khr: 0,
        wholesale_price_usd: 0, wholesale_price_khr: 0, description: 'MP whole form ' + s.x }, { as: 'probe' })
      await H.settle()
      assertRefusedForMerge(t, r, s)
      assertNothingHappened(t, before, await snap(H, s), H)
    })

    // ---- review: queued, never merged ----------------------------------------------------------------------------
    await check('MP-review-queued', 'merge_duplicates not switched off on a Review Required editor: the identity PUT is QUEUED (202) and nothing merges', 'high', async (t) => {
      const s = await pair(H, { shape: 'both', xImage: null })
      const before = await snap(H, s)
      const r = await H.api('PUT', '/api/products/' + s.x, identityBody.both(s), { as: 'review' })
      await H.settle()
      const after = await snap(H, s)
      t.eq('HTTP status (queued = 202)', r.status, 202)
      t.eq('pending flag', r.body && r.body.pending, true)
      t.eq('one pending action queued', after.pending - before.pending, 1)
      t.eq('product rows unchanged until approval', changedColumns(before, after), {})
      t.eq('product.merge undo records added', after.merges - before.merges, 0)
      t.eq('the edited row is still active', after.rows[s.x].is_active, 1)
      const queued = await H.q1('SELECT section, action_type, entity_type, entity_id FROM pending_actions ORDER BY id DESC LIMIT 1')
      t.eq('queued as a product update of the edited row', [queued.section, queued.action_type, queued.entity_type, queued.entity_id], ['products', 'update', 'product', s.x])
    })

    await check('MP-review-merge-off', 'merge_duplicates OFF on a Review Required editor: REFUSED 403, not queued (a switched-off action is refused, never held)', 'high', async (t) => {
      const s = await pair(H, { shape: 'both', xImage: null })
      const before = await snap(H, s)
      const r = await H.api('PUT', '/api/products/' + s.x, identityBody.both(s), { as: 'reviewoff' })
      await H.settle()
      assertRefusedForMerge(t, r, s)
      assertNothingHappened(t, before, await snap(H, s), H)
      t.note('status ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200))
    })

    // ---- full: the fold runs ---------------------------------------------------------------------------------------
    await check('MP-full', 'merge_duplicates not switched off (Products Full): the SAME identity PUT folds X into Y (200, merged_into)', 'control', async (t) => {
      const s = await pair(H, { shape: 'both' })
      const before = await snap(H, s)
      const r = await H.api('PUT', '/api/products/' + s.x, identityBody.both(s), { as: 'full' })
      await H.settle()
      const after = await snap(H, s)
      t.eq('status', r.status, 200)
      t.eq('merged into the other product', r.body && r.body.merged_into, s.y)
      t.eq('the folded row is gone from the active catalog', after.rows[s.x].is_active, 0)
      t.eq('the survivor stays active', after.rows[s.y].is_active, 1)
      t.eq('one product.merge undo record written', after.merges - before.merges, 1)
    })

    await check('MP-admin', 'control: the SAME identity PUT by an admin folds X into Y (the fixture reaches the fold path)', 'control', async (t) => {
      const s = await pair(H, { shape: 'both' })
      const r = await H.api('PUT', '/api/products/' + s.x, identityBody.both(s))
      await H.settle()
      t.eq('status', r.status, 200)
      t.eq('merged into the other product', r.body && r.body.merged_into, s.y)
      t.eq('the folded row is gone from the active catalog', (await H.q1('SELECT is_active a FROM products WHERE id=?', s.x)).a, 0)
    })

    // ---- the grant is specific to the fold ------------------------------------------------------------------------
    await check('MP-control-merge-route', 'control: the same merge-off user on the merge routes gets 403, and a user past the gate reaches the handler (400 on a bad scope)', 'control', async (t) => {
      const route = await H.api('POST', '/api/products/merge-duplicates', {}, { as: 'mergeoff' })
      t.eq('POST /merge-duplicates as the merge-off user', route.status, 403)
      const pair2 = await H.api('POST', '/api/products/possible-duplicates/merge', { keepId: 1, mergeId: 2, keep: true }, { as: 'mergeoff' })
      t.eq('POST /possible-duplicates/merge as the merge-off user', pair2.status, 403)
      const past = await H.api('POST', '/api/products/merge-duplicates', { scope: 'not-a-scope' }, { as: 'full' })
      t.eq('POST /merge-duplicates as a user with the grant reaches the handler (400 unsupported scope, not 403)', past.status, 400)
    })

    await check('MP-control-no-fold', 'control: the merge-off user renaming a product onto a FREE identity is not a fold and is allowed (200)', 'control', async (t) => {
      const s = await pair(H, { shape: 'both' })
      const r = await H.api('PUT', '/api/products/' + s.x, { name: 'MP Unique Rename ' + s.x }, { as: 'mergeoff' })
      t.eq('status', r.status, 200)
      t.eq('renamed', (await H.q1('SELECT name n FROM products WHERE id=?', s.x)).n, 'MP Unique Rename ' + s.x)
    })

    await check('MP-control-resave-with-twin', 'control: the merge-off user re-saving a row that ALREADY shares an identity with a twin (identity unchanged) is not a fold and is allowed', 'control', async (t) => {
      const s = await pair(H, { shape: 'both' })
      const twinId = s.y + 100000
      const x = await H.q1('SELECT name, barcode FROM products WHERE id=?', s.x)
      await H.db.prepare("INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active,created_at,updated_at) VALUES(?,?,?,2,0,0,1,'2026-01-01 00:00:00','2026-01-01 00:00:00')").bind(twinId, x.name, x.barcode).run()
      const r = await H.api('PUT', '/api/products/' + s.x, { name: x.name, barcode: x.barcode, description: 'MP resave ' + s.x }, { as: 'mergeoff' })
      t.eq('status', r.status, 200)
      t.eq('description saved', (await H.q1('SELECT description d FROM products WHERE id=?', s.x)).d, 'MP resave ' + s.x)
      t.eq('the row was not folded', (await H.q1('SELECT is_active a FROM products WHERE id=?', s.x)).a, 1)
    })

    // POST create that matches an existing product is NOT a merge: no existing product is retired (it only normalises
    // the existing row's barcode spelling). Applying the grant there would over-apply it.
    await check('MP-control-create-fold', 'control: the merge-off user creating a product that matches an existing one still folds the create (200, folded_into): a create-fold retires no product, it is not a merge', 'control', async (t) => {
      const e = await existingForCreate(H)
      const before = (await H.q1('SELECT COUNT(*) n FROM products')).n
      const r = await H.api('POST', '/api/products', { name: e.name, barcode: e.clean }, { as: 'mergeoff' })
      await H.settle()
      t.eq('status', r.status, 200)
      t.eq('folded into the existing product', r.body && r.body.folded_into, e.id)
      t.eq('no product row added', (await H.q1('SELECT COUNT(*) n FROM products')).n - before, 0)
      t.eq('the existing product stays active', (await H.q1('SELECT is_active a FROM products WHERE id=?', e.id)).a, 1)
    })
  } finally {
    await H.disarm().catch(() => {})
    await H.dispose()
  }
  finish('MP')
}
main().catch(error => { console.error(error); process.exitCode = 2 })
