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
      counter.maxBatch = Math.max(counter.maxBatch, statements.length)
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
  const counter = { n: 0, log: [], maxBatch: 0 }
  const { env, ctx2, pending } = instrument(rawEnv, ctx, counter)
  const response = await rawFetch(request, env, ctx2)
  if (response.webSocket) return response
  await drain(pending)
  const headers = new Headers(response.headers)
  headers.set('x-al-d1', String(counter.n))
  headers.set('x-al-maxbatch', String(counter.maxBatch))
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
    return { status: response.status, body: json, d1: Number(response.headers.get('x-al-d1') || 0), maxBatch: Number(response.headers.get('x-al-maxbatch') || 0), sql }
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
// the lots stayed drained: the units came back as stock with no received date (the till sells them as "Received date not
// recorded"), and their lot identity -- FIFO order, expiry, cost, supplier -- was lost.
//
// The fix records the per-lot shares of any removal whose movement names no single lot, in the same batch as the stock
// change (dated_stock_count_batch_actions, the table a dated count already uses; negative quantity = taken). Revert reads
// them from the ROOT row of the chain, so Revert, Redo and Revert-of-Redo all move exactly those lots.
//
// A removal that took NOTHING from lots (units under no lot) records a zero row on the product's newest lot, so its Revert
// restores the aggregate exactly (M12, SF-1 of the Opus refute). A removal made before any lot of its product existed, and a
// dated-count removal (which always records its lot effects), need no record.
//
// An OLD removal (written before the fix) has no record at all. If a lot of its product already existed, its Revert would
// have to guess which lots to refill, so it is REFUSED (revert_lots_not_recorded, nothing written). Otherwise the
// aggregate-only restore is exact and still works. "Old" is decided by the mark migration 0250 stores in system_flags (the
// highest movement id at apply time): a record-less removal ABOVE it was written by recording code and is never refused (M16, M16c),
// whatever a product merge did to its product's lots since. Without a mark row the timestamps alone decide (M6k).
//
// Run (from cloudflare/):  node scripts/test-multilot-revert-native.cjs
//   --wrong=no-adjust-shares    mutant: /adjust writes the movement but not its lot shares    (M1, M3, M4, M7, M9 go RED; M8 only counts statements)
//   --wrong=no-import-shares    mutant: the CSV import writes the movement but not its shares (M2, M5, M9b go RED)
//   --wrong=ignore-shares       mutant: Revert ignores recorded shares (the pre-fix, aggregate-only Revert) (M1..M7, M9b go RED)
//   --wrong=no-old-refusal      mutant: an old share-less removal on a lot-tracked product is reverted aggregate-only (M6 goes RED)
//   --wrong=no-zero-record      mutant: a removal that took nothing from lots records nothing, so its Revert is refused (M12, M12b, M12c go RED)
//   --wrong=refuse-any-lot      mutant: the refusal fires for any lot of the product, not only lots that existed before the removal (M12d, M6d go RED)
//   --wrong=tie-strict          mutant: a lot created in the same second as the removal does not count as existing before it (M6g, M6h go RED)
//   --wrong=string-time         mutant: lot and movement times are compared as text, not through datetime() (M6j goes RED)
//   --wrong=ignore-watermark    mutant: the refusal ignores the migration's movement-id mark, so a recording removal can be refused (M16 goes RED)
//   --wrong=watermark-strict    mutant: the movement at the mark itself is not refused (M16b goes RED)
//   --wrong=zero-as-share       mutant: a zero record is read as a lot share (M12e goes RED)
//   --wrong=recorded-ignores-zero  mutant: the refusal does not see a zero record, so a database without the mark refuses a recording removal (M12 goes RED)
//   --wrong=no-dated-exemption  mutant: a dated-count removal with no record is refused too (M6e goes RED)
//   --wrong=reason-only-exemption  mutant: the dated-count exemption goes by the reason text alone, so an old removal typed with it skips the refusal (M6l goes RED)
//   --wrong=no-move-row-shares  mutant: /move-row writes its move_out without the per-lot shares (M14 goes RED)
//   --wrong=import-record-on-add  mutant: the CSV import writes the record after Add rows too, past the group estimate (M15b goes RED)
//   --wrong=import-estimate-blind  mutant: the CSV group cost estimate forgets the share statement, so a group outgrows the 300-statement chunk (M15 goes RED)
//   --wrong=hold-cost-null      mutant: a held row of a lot with no unit cost carries no cost, so Dispose books it at the later catalog cost (M13 goes RED)
//   --wrong=one-held-row        mutant: a multi-lot damaged hold writes ONE held row with no lot (the pre-fix shape) (M11 goes RED)
//   --wrong=active-blind-precheck  mutant: the named-lot pre-check ignores pb.is_active again (R2 F8)           (M10 goes RED)
//   --only=M1,M2                run just those cases (debugging aid)
// Every mutant rewrites source text IN MEMORY at bundle time and fails loudly if its anchor is missing.
// ============================================================================================
const STOCK_REVERT = 'src/lib/stockRevert.ts'
const NO_OLD_REFUSAL = {
  name: 'no-old-refusal', file: STOCK_REVERT,
  from: 'if (!shares.length && OUT_TYPES.has(root.movement_type) && await lotDrawUnrecorded(db, root.id, productId)) {',
  to: 'if (false) {',
}
const PATCHES = {
  'no-adjust-shares': [
    { name: 'no-adjust-shares', file: 'src/routes/inventory.ts',
      from: 'resolvedBatchId == null ? planRemovalLotRecord(targetProductId, plan.batchQuantities.map((entry) => ({ batchId: entry.batchId, quantity: Math.abs(entry.quantity) }))) : []',
      to: '[]' },
  ],
  'no-import-shares': [
    { name: 'no-import-shares', file: 'src/lib/importEngine.ts',
      from: 'if (entry.delta < 0 && singleLot == null) statements.push(...planRemovalLotRecord(entry.productId, entry.takes).map(asStatement))',
      to: 'void asStatement' },
  ],
  'ignore-shares': [
    { name: 'ignore-shares', file: STOCK_REVERT,
      from: 'WHERE a.movement_id = @movementId AND a.quantity <> 0',
      to: 'WHERE 0 AND a.movement_id = @movementId AND a.quantity <> 0' },
    NO_OLD_REFUSAL,
  ],
  'no-old-refusal': [NO_OLD_REFUSAL],
  'no-zero-record': [
    { name: 'no-zero-record', file: 'src/lib/productBatches.ts', from: 'if (shares.length) return shares', to: 'return shares' },
  ],
  'refuse-any-lot': [
    { name: 'refuse-any-lot', file: STOCK_REVERT, from: 'AND datetime(pb.created_at) <= datetime(m.created_at)', to: 'AND 1' },
  ],
  'tie-strict': [
    { name: 'tie-strict', file: STOCK_REVERT, from: 'AND datetime(pb.created_at) <= datetime(m.created_at)', to: 'AND datetime(pb.created_at) < datetime(m.created_at)' },
  ],
  'string-time': [
    { name: 'string-time', file: STOCK_REVERT, from: 'AND datetime(pb.created_at) <= datetime(m.created_at)', to: 'AND pb.created_at <= m.created_at' },
  ],
  'ignore-watermark': [
    { name: 'ignore-watermark', file: STOCK_REVERT, from: 'return watermark == null || Number(row.id) <= watermark', to: 'return true' },
  ],
  'watermark-strict': [
    { name: 'watermark-strict', file: STOCK_REVERT, from: 'return watermark == null || Number(row.id) <= watermark', to: 'return watermark == null || Number(row.id) < watermark' },
  ],
  'zero-as-share': [
    { name: 'zero-as-share', file: STOCK_REVERT, from: 'WHERE a.movement_id = @movementId AND a.quantity <> 0', to: 'WHERE a.movement_id = @movementId' },
  ],
  'recorded-ignores-zero': [
    { name: 'recorded-ignores-zero', file: STOCK_REVERT, from: 'WHERE a.movement_id = m.id) AS recorded', to: 'WHERE a.movement_id = m.id AND a.quantity <> 0) AS recorded' },
  ],
  'reason-only-exemption': [
    { name: 'reason-only-exemption', file: STOCK_REVERT, from: ' && row.stampTime === DATED_STOCK_COUNT_STAMP_TIME', to: '' },
  ],
  'no-dated-exemption': [
    { name: 'no-dated-exemption', file: STOCK_REVERT, from: '(row.reason === DATED_STOCK_COUNT_REASON && row.stampTime === DATED_STOCK_COUNT_STAMP_TIME) || ', to: '' },
  ],
  'no-move-row-shares': [
    { name: 'no-move-row-shares', file: 'src/routes/inventory.ts',
      from: 'removal.remainder === 0 ? [] : planMovementLotShares(removal.batchQuantities.map((entry) => ({ batchId: entry.batchId, quantity: Math.abs(entry.quantity) })))',
      to: 'removal.remainder === 0 ? [] : []' },
  ],
  'import-record-on-add': [
    { name: 'import-record-on-add', file: 'src/lib/importEngine.ts', from: 'if (entry.delta < 0 && singleLot == null) statements.push', to: 'if (singleLot == null) statements.push' },
  ],
  'import-estimate-blind': [
    { name: 'import-estimate-blind', file: 'src/lib/importEngine.ts', from: '(entry.delta < 0 && singleLotOf(entry) == null ? 1 : 0)', to: '0' },
  ],
  'hold-cost-null': [
    { name: 'hold-cost-null', file: 'src/routes/inventory.ts',
      from: 'unitCostUsd: removalCostByBatch.get(entry.batchId) ?? productCostSnapshot?.cost_price_usd ?? null }))',
      to: 'unitCostUsd: removalCostByBatch.get(entry.batchId) ?? null }))' },
  ],
  'one-held-row': [
    { name: 'one-held-row', file: 'src/lib/damagedLotActions.ts',
      from: 'const rows = input.lotSplit?.length ? input.lotSplit',
      to: 'const rows = false ? input.lotSplit' },
  ],
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

const OUT = new Set(['out', 'remove', 'damage_out']), IN = new Set(['in', 'add'])
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

const held = async (H, s) => (await H.q('SELECT batch_id b, quantity q, quantity_remaining r, unit_cost_usd c FROM damaged_stock_lots WHERE product_id=? ORDER BY id', s.p))
const heldRemaining = rows => rows.reduce((sum, row) => sum + row.r, 0)
const taggedAction = (H, s, action, quantity, id) => H.api('POST', '/api/inventory/tagged-lots/' + action,
  { productId: s.p, branchId: LC, conditionTag: 'damaged', quantity, reason: 'ML ' + action, client_request_id: 'ml-' + s.p + '-' + id })
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
    // The migration's mark (system_flags 'multilot_revert_watermark'): the highest movement id that existed before removals recorded.
    // The migrated test database holds 0, so a movement written by the code under test is above it; a fixture standing for an OLD
    // removal calls setWatermark to cover itself, or deletes the mark to stand for a database not yet migrated.
    const WATERMARK = 'multilot_revert_watermark'
    const setWatermark = (value) => value == null
      ? H.db.prepare('DELETE FROM system_flags WHERE key=?').bind(WATERMARK).run()
      : H.db.prepare('INSERT INTO system_flags(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(WATERMARK, String(value)).run()
    const maxMovementId = async () => (await H.q1('SELECT COALESCE(MAX(id),0) m FROM inventory_movements')).m
    const oldRemoval = async (s, lotsNow, branchNow, { reason = 'ML old multi-lot remove', lotsExistedBefore = true, createdAt = '2026-09-20 10:00:00', lotCreatedAt = '2026-09-01 00:00:00', watermark = 'covers' } = {}) => {
      // Exactly what the pre-fix writers left behind: lots and branch already drained, one batch-less 'remove' movement, no share rows,
      // written (2026-09-20) after the product's lots existed unless `lotsExistedBefore` is false. `watermark`: 'covers' = the mark sits
      // at this movement (written before removals recorded), 'absent' = a database without the mark, or a number = the mark itself.
      if (lotsExistedBefore && s.ids.length) await H.db.prepare('UPDATE product_batches SET created_at=? WHERE id IN (' + s.ids.join(',') + ')').bind(lotCreatedAt).run()
      await H.db.batch([
        ...s.ids.map((id, i) => H.db.prepare('UPDATE branch_batch_stock SET quantity=? WHERE batch_id=? AND branch_id=?').bind(lotsNow[i], id, LC)),
        H.db.prepare('UPDATE branch_stock SET quantity=? WHERE product_id=? AND branch_id=?').bind(branchNow, s.p, LC),
        H.db.prepare('UPDATE products SET stock_quantity=? WHERE id=?').bind(branchNow, s.p),
        H.db.prepare("INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,reason,created_at) VALUES(?,?,?,'LC Store','remove',?,?,?)")
          .bind(s.p, s.name, LC, s.total - branchNow, reason, createdAt),
      ])
      const movement = (await snap(H, s)).movements[0]
      await setWatermark(watermark === 'covers' ? movement.id : watermark === 'absent' ? null : watermark)
      return movement
    }
    await check('M6', 'an OLD batch-less removal on a product that uses lots has no shares: Revert is refused whole (nothing written), never a guess', 'high', async (t) => {
      const s = await seed(H, { lots: [5, 5] })
      const old = await oldRemoval(s, [0, 3], 3)
      const before = await snap(H, s)
      const r = await revert(H, old.id)
      const after = await snap(H, s)
      t.eq('refused with a stable code', [r.status, r.body && r.body.code], [400, 'revert_lots_not_recorded'])
      t.ok('the refusal points at the scoped lot Set, not at Add stock (a second purchase)', /Use Set instead/.test(String(r.body && r.body.error)) && !/Add stock/i.test(String(r.body && r.body.error)), r.body)
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

    await check('M6d', 'control: an old removal written BEFORE any lot of its product existed drew on none, so its Revert is the exact aggregate restore even though a lot exists now', 'control', async (t) => {
      const s = await seed(H, { lots: [5], undated: 3 })
      const old = await oldRemoval(s, [5], 6, { lotsExistedBefore: false })
      const r = await revert(H, old.id)
      const a = await snap(H, s)
      t.eq('Revert answered', r.status, 200)
      t.eq('the 2 undated units are back, the lot is untouched', [a.lots, a.branch, a.product], [[5], 8, 8])
    })
    await check('M6e', 'control: a removal made by the dated stock count importer with no lot record drew nothing from lots (it always records its lot effects), so its Revert is not refused', 'control', async (t) => {
      const s = await seed(H, { lots: [5], undated: 3 })
      const old = await oldRemoval(s, [5], 6, { reason: 'Dated stock count import', createdAt: '2026-09-20 00:00:00' })
      const r = await revert(H, old.id)
      const a = await snap(H, s)
      t.eq('Revert answered', r.status, 200)
      t.eq('the 2 undated units are back, the lot is untouched', [a.lots, a.branch, a.product], [[5], 8, 8])
    })
    await check('M6l', 'an OLD multi-lot removal whose reason was typed as the dated-count text (stamped at a real clock time) is still refused: the reason alone does not exempt it', 'high', async (t) => {
      const s = await seed(H, { lots: [5, 5] })
      const old = await oldRemoval(s, [0, 3], 3, { reason: 'Dated stock count import' })
      const r = await revert(H, old.id)
      const a = await snap(H, s)
      t.eq('refused with a stable code', [r.status, r.body && r.body.code], [400, 'revert_lots_not_recorded'])
      t.eq('nothing was written (lots, branch, movements)', [a.lots, a.branch, a.movements.length], [[0, 3], 3, 1])
    })

    await check('M6f', 'the way back the refusal names works: a scoped lot Set puts each lot back, moves branch_stock with it, and books no purchase', 'high', async (t) => {
      const s = await seed(H, { lots: [5, 5] })
      await H.db.batch(s.ids.map((id, i) => H.db.prepare('UPDATE product_batches SET received_quantity=5, received_cost_usd=? WHERE id=?').bind(15 + 5 * i, id)))
      const old = await oldRemoval(s, [0, 3], 3)
      const refused = await revert(H, old.id)
      t.eq('the Revert is refused', [refused.status, refused.body && refused.body.code], [400, 'revert_lots_not_recorded'])
      for (const [i, target] of [[0, 5], [1, 5]]) {
        const set = await H.api('POST', '/api/inventory/adjust', { productId: s.p, branchId: LC, type: 'set', setScope: 'lot', batchId: s.ids[i], quantity: target, reason: 'ML put back', client_request_id: 'ml-' + s.p + '-set' + i })
        t.eq('scoped Set of lot ' + i + ' answered', set.status, 200)
      }
      const a = await snap(H, s)
      t.eq('lots, branch and product are back together', [a.lots, a.branch, a.product], [[5, 5], 10, 10])
      const lots = await H.q('SELECT received_quantity rq, received_cost_usd rc FROM product_batches WHERE id IN (' + s.ids.join(',') + ') ORDER BY id')
      t.eq('no purchase was booked: received quantity and cost are unchanged', lots.map(x => [x.rq, x.rc]), [[5, 15], [5, 20]])
    })

    // ------------------------------------------------------------------ M6g..M6k: the refusal's time test (R2 refute, round 2 SF-B)
    // Lot and movement times are whole seconds (CURRENT_TIMESTAMP) or ISO text with milliseconds (an import), so a removal written in the
    // same second as the lots it drew on must still count as "a lot existed", and mixed formats must compare as times, not as text.
    await check('M6g', 'an OLD multi-lot removal written in the SAME SECOND as the lots it drew on is refused, not reverted aggregate-only', 'high', async (t) => {
      const s = await seed(H, { lots: [5, 5] })
      const old = await oldRemoval(s, [0, 3], 3, { createdAt: '2026-09-20 10:00:00', lotCreatedAt: '2026-09-20 10:00:00' })
      const r = await revert(H, old.id)
      const a = await snap(H, s)
      t.eq('refused with a stable code', [r.status, r.body && r.body.code], [400, 'revert_lots_not_recorded'])
      t.eq('nothing was written (lots, branch, movements)', [a.lots, a.branch, a.movements.length], [[0, 3], 3, 1])
    })
    await check('M6h', 'the same, the removal stamped ISO with milliseconds 0.9 s after its lot (an import)', 'high', async (t) => {
      const s = await seed(H, { lots: [5, 5] })
      const old = await oldRemoval(s, [0, 3], 3, { createdAt: '2026-09-20T10:00:00.900Z', lotCreatedAt: '2026-09-20 10:00:00' })
      const r = await revert(H, old.id)
      t.eq('refused', [r.status, r.body && r.body.code], [400, 'revert_lots_not_recorded'])
      t.eq('nothing was refilled by a guess', (await snap(H, s)).lots, [0, 3])
    })
    await check('M6i', 'control: one second after its lots the same old removal is refused', 'control', async (t) => {
      const s = await seed(H, { lots: [5, 5] })
      const old = await oldRemoval(s, [0, 3], 3, { createdAt: '2026-09-20 10:00:01', lotCreatedAt: '2026-09-20 10:00:00' })
      const r = await revert(H, old.id)
      t.eq('refused', [r.status, r.body && r.body.code], [400, 'revert_lots_not_recorded'])
    })
    await check('M6j', 'a lot stamped ISO with milliseconds, an old removal stamped in the database format 5 s later: the lot existed first, so it is refused (times, not text, are compared)', 'high', async (t) => {
      const s = await seed(H, { lots: [5, 5] })
      const old = await oldRemoval(s, [0, 3], 3, { createdAt: '2026-09-20 10:00:05', lotCreatedAt: '2026-09-20T10:00:00.900Z' })
      const r = await revert(H, old.id)
      t.eq('refused', [r.status, r.body && r.body.code], [400, 'revert_lots_not_recorded'])
      t.eq('nothing was refilled by a guess', (await snap(H, s)).lots, [0, 3])
    })
    await check('M6k', 'a database without the migration mark decides by time alone: the same-second old removal is refused there too', 'high', async (t) => {
      const s = await seed(H, { lots: [5, 5] })
      const old = await oldRemoval(s, [0, 3], 3, { createdAt: '2026-09-20 10:00:00', lotCreatedAt: '2026-09-20 10:00:00', watermark: 'absent' })
      t.eq('the mark is absent', (await H.q('SELECT value FROM system_flags WHERE key=?', WATERMARK)).length, 0)
      const r = await revert(H, old.id)
      t.eq('refused', [r.status, r.body && r.body.code], [400, 'revert_lots_not_recorded'])
    })

    // ------------------------------------------------------------------ M16: the mark separates old removals from recording ones (R2 refute, round 2 SF-A)
    // A product merge re-points the duplicate's lots onto the keeper and keeps their old created_at. A NEW removal on a product that had
    // no lot wrote no record (it had none to record against), and after the merge "a lot existed before it" is true by time alone.
    const duplicateOf = async (k, { lotUnits = 0, undated = 0 } = {}) => {
      const d = 7000 + k.p, lot = d * 10 + 1
      await H.db.batch([
        H.db.prepare('INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,stock_quantity,is_active) VALUES(?,?,?,2,0,10,40000,?,1)').bind(d, k.name, k.barcode, lotUnits + undated),
        H.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').bind(d, LC, lotUnits + undated),
        ...(lotUnits ? [
          H.db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active,created_at) VALUES(?,?,?,?,'2026-08-01',1,2,1,'2026-08-01 00:00:00')").bind(lot, d, 'dup' + lot, 'dup' + lot),
          H.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)').bind(lot, LC, lotUnits),
        ] : []),
      ])
      return { p: d, ids: lotUnits ? [lot] : [], name: k.name, barcode: k.barcode, total: lotUnits + undated, lot }
    }
    const mergeInto = (k, d) => H.api('POST', '/api/products/possible-duplicates/merge', { keepId: k.p, mergeId: d.p, stock: 'merge' })
    const branchQty = async (p) => (await H.q1('SELECT quantity q FROM branch_stock WHERE product_id=? AND branch_id=?', p, LC)).q
    await check('M16', 'a NEW removal on a lot-less keeper, then a merge brings an OLDER lot onto it: Revert still puts the 3 undated units back, and so does the Redo', 'high', async (t) => {
      const k = await seed(H, { lots: [], undated: 10 })
      const d = await duplicateOf(k, { lotUnits: 5 })
      await setWatermark(await maxMovementId())
      const removed = await adjustRemove(H, k, 3, 'q2')
      const a1 = await snap(H, k)
      t.eq('Remove answered; the keeper had no lot, so there was nothing to record against', [removed.status, a1.shares.length], [200, 0])
      const merged = await mergeInto(k, d)
      t.eq('merge answered', merged.status, 200)
      t.eq('the older lot now belongs to the keeper', (await H.q1('SELECT variant_product_id v FROM product_batches WHERE id=?', d.lot)).v, k.p)
      const before = await branchQty(k.p)
      const r = await revert(H, a1.movements[0].id)
      t.eq('Revert answered 200 and put the 3 undated units back', [r.status, (await branchQty(k.p)) - before], [200, 3])
      const lot = await H.q1('SELECT quantity q FROM branch_batch_stock WHERE batch_id=? AND branch_id=?', d.lot, LC)
      t.eq('the merged-in lot kept its 5', lot.q, 5)
      const a2 = await snap(H, k)
      const redo = await revert(H, a2.movements[a2.movements.length - 1].id)
      t.eq('the Redo answered 200 and took the 3 undated units again', [redo.status, (await branchQty(k.p)) - before], [200, 0])
    })
    await check('M16c', 'a NEW removal on the DUPLICATE (no lot) before the merge, whose movement moves to a keeper that has older lots: Revert puts its units back', 'high', async (t) => {
      const k = await seed(H, { lots: [5], undated: 0 })
      await H.db.prepare("UPDATE product_batches SET created_at='2026-08-01 00:00:00' WHERE id=?").bind(k.ids[0]).run()
      const d = await duplicateOf(k, { undated: 4 })
      await setWatermark(await maxMovementId())
      const removed = await adjustRemove(H, d, 2, 'q2c')
      t.eq('Remove on the duplicate answered', removed.status, 200)
      const merged = await mergeInto(k, d)
      t.eq('merge answered', merged.status, 200)
      const moved = await H.q1("SELECT id, product_id p FROM inventory_movements WHERE movement_type='remove' AND product_id IN (?, ?) ORDER BY id DESC LIMIT 1", k.p, d.p)
      t.eq('the removal now sits on the keeper', moved.p, k.p)
      const before = await branchQty(k.p)
      const r = await revert(H, moved.id)
      t.eq('Revert answered 200 and put the 2 units back', [r.status, (await branchQty(k.p)) - before], [200, 2])
    })
    await check('M16b', 'the mark is inclusive: a record-less removal AT the mark is refused, one just above it is the exact aggregate restore', 'high', async (t) => {
      const at = await seed(H, { lots: [5, 5] })
      const atOld = await oldRemoval(at, [0, 3], 3, { watermark: 'covers' })
      const refused = await revert(H, atOld.id)
      t.eq('at the mark: refused', [refused.status, refused.body && refused.body.code], [400, 'revert_lots_not_recorded'])
      const above = await seed(H, { lots: [5, 5] })
      const aboveOld = await oldRemoval(above, [0, 3], 3, { watermark: 'covers' })
      await setWatermark(aboveOld.id - 1)
      const r = await revert(H, aboveOld.id)
      t.eq('just above the mark: not refused', r.status, 200)
      t.eq('the 7 units came back as undated units (what a removal that recorded nothing because it had nothing to record gets)', [(await snap(H, above)).lots, await branchQty(above.p)], [[0, 3], 10])
    })

    // ------------------------------------------------------------------ M12: a removal taken wholly from units that sit under no lot (R2 refute SF-1)
    // Written AFTER the fix, so it must say so: with no record it is indistinguishable from an old multi-lot removal and its
    // Revert would be refused on any product that has a lot row, even a dead one.
    // The dead lot is dated a day before the removal (R2 refute Q10), and M12, M12b and M12c run on a database without the mark, so the
    // ONLY thing that lets the Revert through is the zero record: not a same-second tie, not the mark.
    const deadLot = async (s) => {
      const id = s.p * 100 + 50
      await H.db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active,created_at) VALUES(?,?,?,?,?,1,3,0,'2026-08-01 00:00:00')")
        .bind(id, s.p, 'dead' + id, 'dead' + id, '2026-08-01').run()
      return id
    }
    await check('M12', '/adjust Remove 3 of 10 units under no lot (the product only has a dead lot): the removal records that it drew nothing from lots; Revert / Redo / Revert restore the aggregate exactly', 'high', async (t) => {
      await setWatermark(null)
      const s = await seed(H, { lots: [], undated: 10 })
      const dead = await deadLot(s)
      const removed = await adjustRemove(H, s, 3, 'a')
      const after = await snap(H, s)
      t.eq('Remove answered', removed.status, 200)
      expectLedgers(t, 'after the Remove', after, s, { lots: [], undated: 7 })
      t.eq('the movement names no lot', after.movements.map(m => [m.t, m.q, m.b]), [['remove', 3, null]])
      t.eq('a zero row on the product\'s newest lot records that no lot gave a unit', after.shares.map(x => [x.m, x.b, x.q]), [[after.movements[0].id, dead, 0]])
      await chain(t, H, s, 'M12', after, { drained: [], restored: [], undatedDrained: 7, undatedRestored: 10 })
    })
    await check('M12b', 'CSV Remove 3 of 10 units under no lot (dead lot only): the same zero record, and Revert / Redo / Revert restore the aggregate exactly', 'high', async (t) => {
      await setWatermark(null)
      const s = await seed(H, { lots: [], undated: 10 })
      const dead = await deadLot(s)
      const imported = await importCsv(H, 'remove', [row(s, 3)])
      const after = await snap(H, s)
      t.eq('import finished', imported.job.status, 'completed')
      expectLedgers(t, 'after the import', after, s, { lots: [], undated: 7 })
      t.eq('the zero record is written with the movement', after.shares.map(x => [x.m, x.b, x.q]), [[after.movements[0].id, dead, 0]])
      await chain(t, H, s, 'M12b', after, { drained: [], restored: [], undatedDrained: 7, undatedRestored: 10 })
    })
    await check('M12c', 'a TRACKED pair (an active, empty lot beside 5 undated units): Remove 3 takes undated units only, and Revert / Redo / Revert put exactly them back', 'high', async (t) => {
      await setWatermark(null)
      const s = await seed(H, { lots: [0], undated: 5 })
      const removed = await adjustRemove(H, s, 3, 'a')
      const after = await snap(H, s)
      t.eq('Remove answered', removed.status, 200)
      expectLedgers(t, 'after the Remove', after, s, { lots: [0], undated: 2 })
      t.eq('the zero record sits on that lot', after.shares.map(x => [x.m, x.b, x.q]), [[after.movements[0].id, s.ids[0], 0]])
      await chain(t, H, s, 'M12c', after, { drained: [0], restored: [0], undatedDrained: 2, undatedRestored: 5 })
    })
    await check('M12e', 'a zero record is not a lot movement: when the lot it sits on has since moved to another product, the Revert still restores the undated units', 'high', async (t) => {
      const s = await seed(H, { lots: [], undated: 10 })
      const dead = await deadLot(s)
      const other = await seed(H, { lots: [], undated: 1 })
      const removed = await adjustRemove(H, s, 3, 'a')
      t.eq('Remove answered with its zero record', [removed.status, (await snap(H, s)).shares.map(x => [x.b, x.q])], [200, [[dead, 0]]])
      await H.db.prepare('UPDATE product_batches SET variant_product_id=? WHERE id=?').bind(other.p, dead).run()
      const r = await revert(H, (await snap(H, s)).movements[0].id)
      t.eq('Revert answered 200 and put the 3 undated units back', [r.status, await branchQty(s.p)], [200, 10])
    })
    await check('M12d', 'a removal made while its product had no lot at all needs no record; a lot received afterwards does not make its Revert refused', 'high', async (t) => {
      await setWatermark(null) // no mark: the time rule alone decides, so a lot dated after the removal is what this case exercises
      const s = await seed(H, { lots: [], undated: 10 })
      const removed = await adjustRemove(H, s, 3, 'a')
      const a1 = await snap(H, s)
      t.eq('Remove answered, and there was no lot to record against', [removed.status, a1.shares], [200, []])
      // The first lot of the product arrives later: 4 units received at the branch, dated after the removal.
      const late = s.p * 100 + 60
      await H.db.batch([
        H.db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active,created_at) VALUES(?,?,?,?,'2026-10-10',1,3,1,'2099-01-01 00:00:00')").bind(late, s.p, 'late', 'late'),
        H.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,4)').bind(late, LC),
        H.db.prepare('UPDATE branch_stock SET quantity=quantity+4 WHERE product_id=? AND branch_id=?').bind(s.p, LC),
        H.db.prepare('UPDATE products SET stock_quantity=stock_quantity+4 WHERE id=?').bind(s.p),
      ])
      const r = await revert(H, a1.movements[0].id)
      const a2 = await snap(H, s)
      t.eq('Revert answered (the removal predates the lot, so it drew on none)', r.status, 200)
      t.eq('the 3 undated units are back and the late lot is untouched', [a2.branch, a2.product], [14, 14])
      const late2 = await H.q('SELECT quantity q FROM branch_batch_stock WHERE batch_id=? AND branch_id=?', late, LC)
      t.eq('the late lot still holds its 4', late2[0].q, 4)
      const redo = await revert(H, (a2.movements[1] || {}).id)
      const a3 = await snap(H, s)
      t.eq('Redo answered and took undated units only', [redo.status, a3.branch, a3.product], [200, 11, 11])
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

    // ------------------------------------------------------------------ M14: /move-row (a move out is not reverted here, but it records its shares)
    await check('M14', '/move-row of 7 from lots 5+5 records the per-lot shares with its move_out; a move that one lot covers names that lot and writes none', 'medium', async (t) => {
      const src = await seed(H, { lots: [5, 5] })
      const dst = await seed(H, { lots: [], undated: 0 })
      const moved = await H.api('POST', '/api/inventory/move-row', { sourceProductId: src.p, destinationProductId: dst.p, quantity: 7, branchId: LC, reason: 'ML move' })
      const a = await snap(H, src)
      t.eq('move answered', moved.status, 200)
      t.eq('the move_out names no single lot', a.movements.map(m => [m.t, m.q, m.b]), [['move_out', 7, null]])
      t.eq('the shares are recorded', a.shares.map(x => [x.m, x.b, x.q]), [[a.movements[0].id, src.ids[0], -5], [a.movements[0].id, src.ids[1], -2]])
      const one = await seed(H, { lots: [5, 5] })
      const dst2 = await seed(H, { lots: [], undated: 0 })
      const single = await H.api('POST', '/api/inventory/move-row', { sourceProductId: one.p, destinationProductId: dst2.p, quantity: 4, branchId: LC, reason: 'ML move' })
      const b = await snap(H, one)
      t.eq('single-lot move answered', single.status, 200)
      t.eq('it names the lot and writes no share rows', [b.movements.map(m => [m.t, m.q, m.b]), b.shares], [[['move_out', 4, one.ids[0]]], []])
    })

    // ------------------------------------------------------------------ M15: the CSV group cost estimate counts the record statement
    // 100 removals that each spread over two lots: with the record counted (3 statements a row) a group stops at 93 rows and stays
    // inside the 300-statement chunk; without it the estimate lets all 100 rows into one group of about 306 statements.
    await check('M15', 'a 100-row CSV Remove (each row over two lots) is applied in groups that stay inside the 300-statement batch limit, every row once with its two shares', 'medium', async (t) => {
      const products = []
      for (let i = 0; i < 100; i++) products.push(await seed(H, { lots: [5, 5] }))
      const imported = await importCsv(H, 'remove', products.map(p => row(p, 7)))
      t.eq('import finished', imported.job.status, 'completed')
      const ids = products.map(p => p.p).join(',')
      const moved = await H.q1("SELECT COUNT(*) n, COALESCE(SUM(quantity),0) q FROM inventory_movements WHERE movement_type='out' AND product_id IN (" + ids + ')')
      const shares = await H.q1('SELECT COUNT(*) n FROM dated_stock_count_batch_actions WHERE movement_id IN (SELECT id FROM inventory_movements WHERE product_id IN (' + ids + '))')
      const lots = await H.q1('SELECT COALESCE(SUM(bbs.quantity),0) q FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id WHERE pb.variant_product_id IN (' + ids + ') AND bbs.branch_id=' + LC)
      t.eq('one movement per row, 7 units each', [moved.n, moved.q], [100, 700])
      t.eq('two shares per row', shares.n, 200)
      t.eq('the lots hold the 3 units left per product', lots.q, 300)
      t.note('largest db.batch of the apply request: ' + imported.approved.maxBatch + ' statements')
      t.ok('no single batch outgrows the 300-statement chunk', imported.approved.maxBatch <= 300, imported.approved.maxBatch)
    })

    // ------------------------------------------------------------------ M8: D1 statements per request (Paid 1000, Free 50)
    await check('M8', 'D1 statement counts: Remove, Revert, Redo, damaged hold and Restore at 2, 5 and 10 lots on Paid, and 2 and 5 lots on Free, stay inside the invocation limit', 'medium', async (t) => {
      const counts = []
      for (const lotsCount of [2, 5, 10]) {
        const s = await seed(H, { lots: Array(lotsCount).fill(2) })
        const removed = await adjustRemove(H, s, lotsCount * 2 - 1, 'n' + lotsCount)
        const m1 = (await snap(H, s)).movements[0]
        const rev = await revert(H, m1.id)
        const redo = await revert(H, (await snap(H, s)).movements[1].id)
        // The damaged (kept-as-tagged) spread of the same size: the hold and the Restore.
        const tagSeed = await seed(H, { lots: Array(lotsCount).fill(2) })
        const hold = await adjustRemove(H, tagSeed, lotsCount * 2 - 1, 't' + lotsCount, { conditionTag: 'damaged' })
        const restore = await taggedAction(H, tagSeed, 'restore', lotsCount * 2 - 1, 'tr' + lotsCount)
        counts.push({ lots: lotsCount, remove: removed.d1, revert: rev.d1, redo: redo.d1, damagedHold: hold.d1, damagedRestore: restore.d1 })
        t.eq(lotsCount + ' lots: all five answered 200', [removed.status, rev.status, redo.status, hold.status, restore.status], [200, 200, 200, 200, 200])
        t.ok(lotsCount + ' lots: inside the Paid limit of 1000', Math.max(removed.d1, rev.d1, redo.d1, hold.d1, restore.d1) <= 1000, counts[counts.length - 1])
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
        const tagSeed = await seed(F, { lots: Array(lotsCount).fill(2) })
        const hold = await adjustRemove(F, tagSeed, lotsCount * 2 - 1, 'ft' + lotsCount, { conditionTag: 'damaged' })
        const restore = await taggedAction(F, tagSeed, 'restore', lotsCount * 2 - 1, 'ftr' + lotsCount)
        free.push({ lots: lotsCount, remove: removed.d1, revert: rev.d1, redo: redo.d1, damagedHold: hold.d1, damagedRestore: restore.d1 })
        t.eq('Free ' + lotsCount + ' lots: all five answered 200', [removed.status, rev.status, redo.status, hold.status, restore.status], [200, 200, 200, 200, 200])
        t.ok('Free ' + lotsCount + ' lots: every request inside the Free limit of 50', Math.max(removed.d1, rev.d1, redo.d1, hold.d1, restore.d1) <= 50, free[free.length - 1])
      }
      t.note('Free, statements per request: ' + JSON.stringify(free))
    })

    // ------------------------------------------------------------------ M11: a damaged (kept-as-tagged) Remove spread across lots
    // The held stock is a fourth place the units can sit, so the units are conserved across lot ledger + held rows:
    // branch_stock = lot sum, and branch_stock + held = the opening 10 at every step. A Restore puts held units back where they came from.
    await check('M11', 'a damaged Remove 7 across lots 5+5 holds one row per source lot (with its own cost); Restore puts each unit back on its lot', 'high', async (t) => {
      const s = await seed(H, { lots: [5, 5] })
      const tagged = await adjustRemove(H, s, 7, 'a', { conditionTag: 'damaged' })
      const a1 = await snap(H, s)
      const h1 = await held(H, s)
      t.eq('tagged Remove answered', tagged.status, 200)
      t.eq('the units left the lots and branch_stock (lot A first)', [a1.lots, a1.branch, a1.product], [[0, 3], 3, 3])
      t.eq('the movement is the damage_out of 7 and names no single lot', a1.movements.map(m => [m.t, m.q, m.b]), [['damage_out', 7, null]])
      t.eq('one held row per source lot, each carrying its own lot and cost', h1.map(r => [r.b, r.q, r.r, r.c]), [[s.ids[0], 5, 5, 3], [s.ids[1], 2, 2, 4]])
      t.eq('held units + sellable units = the opening 10', a1.branch + heldRemaining(h1), 10)

      const restored = await taggedAction(H, s, 'restore', 7, 'r')
      const a2 = await snap(H, s)
      const h2 = await held(H, s)
      t.eq('Restore answered', restored.status, 200)
      t.eq('every unit is back on the lot it came from: lots 5/5, branch 10, product 10', [a2.lots, a2.branch, a2.product], [[5, 5], 10, 10])
      t.eq('lot ledger = branch_stock after the Restore', a2.lotsSum, a2.branch)
      t.eq('nothing is held any more', heldRemaining(h2), 0)
      t.eq('the same Restore again is a replay, not a second Restore', [(await taggedAction(H, s, 'restore', 7, 'r')).body.replayed, (await snap(H, s)).branch], [true, 10])
    })
    await check('M11b', 'a PARTIAL Restore of a multi-lot hold takes the oldest held row first and moves that lot, branch_stock and the product total together', 'high', async (t) => {
      const s = await seed(H, { lots: [5, 5] })
      await adjustRemove(H, s, 7, 'a', { conditionTag: 'damaged' })
      const restored = await taggedAction(H, s, 'restore', 3, 'r')
      const a = await snap(H, s)
      const h = await held(H, s)
      t.eq('Restore answered', restored.status, 200)
      t.eq('3 units went back on lot A (the first held row), lot B untouched', [a.lots, a.branch, a.product], [[3, 3], 6, 6])
      t.eq('lot ledger = branch_stock', a.lotsSum, a.branch)
      t.eq('held rows: lot A 2 left, lot B 2', h.map(r => [r.b, r.r]), [[s.ids[0], 2], [s.ids[1], 2]])
      t.eq('held units + sellable units = the opening 10', a.branch + heldRemaining(h), 10)
      const disposed = await taggedAction(H, s, 'dispose', 2, 'd')
      const a2 = await snap(H, s)
      t.eq('Dispose answered and moved no sellable stock', [disposed.status, a2.lots, a2.branch, a2.product], [200, [3, 3], 6, 6])
      t.eq('the 2 disposed came off the oldest held row', (await held(H, s)).map(r => [r.b, r.r]), [[s.ids[0], 0], [s.ids[1], 2]])
    })
    await check('M13', 'a damaged hold over lots 5+5 where lot A has no unit cost: its held row is stamped at the product cost of the day it was held, so a later catalog price change does not move the Dispose loss', 'high', async (t) => {
      const s = await seed(H, { lots: [5, 5] })
      await H.db.prepare('UPDATE product_batches SET unit_cost_usd=NULL WHERE id=?').bind(s.ids[0]).run()
      const holdCost = (await H.q1('SELECT cost_price_usd c FROM products WHERE id=?', s.p)).c
      const tagged = await adjustRemove(H, s, 7, 'a', { conditionTag: 'damaged' })
      const h = await held(H, s)
      t.eq('tagged Remove answered', tagged.status, 200)
      const total = Math.round((5 * holdCost + 2 * 4) * 10000) / 10000
      t.ok('the product has a cost of its own to fall back on, different from what a later price will be', holdCost > 0 && holdCost !== 9, holdCost)
      t.eq('lot A (no cost) is held at the product cost of the day it was held, lot B at its own (4)', h.map(r => [r.b, r.q, r.c]), [[s.ids[0], 5, holdCost], [s.ids[1], 2, 4]])
      const costs = async () => (await H.q('SELECT movement_type t, total_cost_usd c FROM inventory_movements WHERE product_id=? ORDER BY id', s.p)).map(r => [r.t, Math.round(Number(r.c) * 10000) / 10000])
      t.eq('the hold books 5 x product cost + 2 x 4', (await costs()).filter(r => r[0] === 'damage_out'), [['damage_out', total]])
      await H.db.prepare('UPDATE products SET cost_price_usd=9 WHERE id=?').bind(s.p).run()
      const disposed = await taggedAction(H, s, 'dispose', 7, 'd')
      t.eq('Dispose answered', disposed.status, 200)
      t.eq('the loss is booked at what the goods cost when they were held, not at the new catalog cost (9 a unit)', (await costs()).filter(r => r[0] === 'write_off'), [['write_off', total]])
    })
    await check('M11c', 'control: a damaged Remove from a NAMED lot is one held row on that lot and its Restore already put the units back', 'control', async (t) => {
      const s = await seed(H, { lots: [5, 5] })
      const tagged = await adjustRemove(H, s, 3, 'a', { conditionTag: 'damaged', batchId: s.ids[1] })
      const h = await held(H, s)
      t.eq('tagged Remove answered', tagged.status, 200)
      t.eq('one held row on the named lot', h.map(r => [r.b, r.q]), [[s.ids[1], 3]])
      const restored = await taggedAction(H, s, 'restore', 3, 'r')
      const a = await snap(H, s)
      t.eq('Restore answered, lots back', [restored.status, a.lots, a.branch, a.product], [200, [5, 5], 10, 10])
    })
    await check('M11d', 'a damaged Remove of lot 5 + 3 undated units holds a lot row and an undated row; Restore puts the lot units on the lot and the rest branch-only', 'high', async (t) => {
      const s = await seed(H, { lots: [5], undated: 3 })
      const tagged = await adjustRemove(H, s, 7, 'a', { conditionTag: 'damaged' })
      const h = await held(H, s)
      t.eq('tagged Remove answered', tagged.status, 200)
      t.eq('a held row for the lot units and one for the 2 undated units', h.map(r => [r.b, r.q]), [[s.ids[0], 5], [null, 2]])
      const restored = await taggedAction(H, s, 'restore', 7, 'r')
      const a = await snap(H, s)
      t.eq('Restore answered', restored.status, 200)
      expectLedgers(t, 'after the Restore', a, s, { lots: [5], undated: 3 })
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

    // ------------------------------------------------------------------ M15b: a CSV row that RAISES stock writes no lot record, and the group estimate does not count one
    // Last on purpose: the lots this import creates take the next free ids, which the id-derived seeds of the earlier cases would collide with.
    // Only the stock-group path (Remove, Set, legacy rows) carries the record; the plain Add receipt path is a different writer. The estimate
    // counts the one record statement a removal row emits and none for a Set that raises the count. A raising row that also wrote a record would
    // be past the estimate, and a large Set file would outgrow the 300-statement chunk.
    await check('M15b', 'a 150-row CSV Set that raises each product from 10 to 12 (two lots each) writes no lot record, and its groups stay inside the 300-statement batch limit', 'medium', async (t) => {
      const products = []
      for (let i = 0; i < 150; i++) products.push(await seed(H, { lots: [5, 5] }))
      const imported = await importCsv(H, 'set', products.map(p => row(p, 12)))
      t.eq('import finished', imported.job.status, 'completed')
      const ids = products.map(p => p.p).join(',')
      const moved = await H.q1('SELECT COUNT(*) n, COALESCE(SUM(quantity),0) q FROM inventory_movements WHERE product_id IN (' + ids + ')')
      const shares = await H.q1('SELECT COUNT(*) n FROM dated_stock_count_batch_actions WHERE movement_id IN (SELECT id FROM inventory_movements WHERE product_id IN (' + ids + '))')
      t.eq('one movement per row, 2 units each', [moved.n, moved.q], [150, 300])
      t.eq('a raising row records no lot shares and no zero row', shares.n, 0)
      t.note('largest db.batch of the apply request: ' + imported.approved.maxBatch + ' statements')
      t.ok('no single batch outgrows the 300-statement chunk', imported.approved.maxBatch <= 300, imported.approved.maxBatch)
    })
  } finally {
    await H.disarm().catch(() => {})
    await H.dispose()
    if (F) { await F.disarm().catch(() => {}); await F.dispose() }
  }
  finish('MULTILOT-REVERT')
}
main().catch(error => { console.error(error); process.exitCode = 2 })
