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
  if (/^PENDING/.test(severity) && OPTIONS.pending !== 'run') {
    results.push({ id, title, severity, red: false, deferred: true, misses: [], notes: [] })
    console.log('PENDING ' + id + '  [' + severity + ']  ' + title + ' (not run by default; --pending=run runs it and it stays RED until the schema lands)')
    return
  }
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
  const deferred = results.filter(r => r.deferred)
  console.log('\nSUMMARY ' + finding + ': ' + (results.length - red.length - deferred.length) + ' GREEN, ' + red.length + ' RED, ' + deferred.length + ' PENDING' + (red.length ? ' -> ' + red.map(r => r.id).join(', ') : '') + (deferred.length ? ' (pending, not run: ' + deferred.map(r => r.id).join(', ') + ')' : ''))
  // A pending case stays RED (exit 1) and is named with what it waits for; it is never skipped or counted as GREEN.
  for (const r of red.filter(r => /^PENDING/.test(r.severity))) console.log('  ' + r.id + ' is ' + r.severity)
  const unexpected = red.filter(r => !/^PENDING/.test(r.severity))
  console.log('  RED that is not a named pending item: ' + (unexpected.length ? unexpected.map(r => r.id).join(', ') : 'none'))
  if (red.length) process.exitCode = 1
}

// ============================================================================================
// FINDING K -- expenses (fees) and the generic review family: optimistic versioning, an immutable before/after record,
// atomic mutation + audit + queue, approve/reject races, legacy Undo, reasons, request-device attribution and the
// survival of the restore audit.
//
// Everything runs over HTTP against the real Worker. Fixture: LC Store (id 1) is the selling branch (role "shop", the
// consolidated state fees book to); Old Shop (id 2) is inactive and redirects to it.
//   admin      full access, one session ("Owner Laptop")
//   clerk      fees = Review Required: every DELETE is queued for a reviewer (two sessions, see K8)
//   reviewer   fees full + review; reviewer2 the same (the second reviewer in the approve/reject race)
//   editor     fees full, two live sessions on different devices (K8)
//
// Correct outcome under the owner's rules: an edit or delete is admitted only against the version the person saw; the
// record of it (who, which device, the whole before and after) is written in the SAME transaction as the change and is
// never rewritten; an approval is judged against the thing that was reviewed; a decision and its effect agree even when
// two reviewers act at once; history is append-only (Revert creates a compensating record).
//
// Run (from cloudflare/):  node scripts/test-al-stock-k-native.cjs
//   (no flag)                  the code at HEAD. The fixes landed in src/ (claude/fees-k-fix-20261013), so the in-memory `--fix`
//                              flavour the reproduction lane used is gone: its anchors were the defective code itself.
//   --wrong=<mutant>           re-introduce one defect in memory; the named cases must turn RED (see MUTANTS below)
//   --only=K1c,K6              run just those cases (debugging aid)
//   --pending=run              also run the named pending cases below (they stay RED until their schema lands)
//
// Pending, printed by name with what it needs on every run (never silently skipped; --pending=run shows it RED):
//   K8b  needs a schema column: pending_actions has nowhere to keep the requesting device (migration, not in this lane).
// Owner rulings of 13 Oct (relayed by the coordinator), pinned as expectations:
//   K10a "replace with the backup": a restore replaces the audit trail with the backup's, plus the restore row.
//   K11  "keep old expenses ... the revert, yes": retention keeps expense evidence and revert records. The 14 Oct ruling
//        keeps "sales, payments, returns, stock changes, permission changes, reverts" and names neither undo nor redo; the
//        13 Oct ruling says the Undo/Redo history may be pruned. So an undo of a kept class (here an expense edit) is kept
//        because the class it replayed is kept, and an undo of anything else follows the retention window (pinned in
//        test-audit-retention-keep-forever-native.cjs). Ordinary rows still age out.
// ============================================================================================
const FEES = 'src/routes/fees.ts', REVIEW_QUEUE = 'src/routes/reviewQueue.ts', REVIEW_APPLY = 'src/lib/reviewApply.ts', ACTION_HISTORY = 'src/routes/actionHistory.ts'
// MUTANTS: each re-introduces ONE defect the lane fixed (or a plausible wrong fix) in memory. The cases named in its comment
// must turn RED; a mutant that leaves them GREEN means the test no longer discriminates. Anchors must occur exactly once.
const FEE_DELETE_BATCH_AUDIT = [
  "      buildAuditStatement(user.id, user.username || null, 'delete', 'fee', id, { before: existing, after: null },",
  '        changedFields(existing as unknown as Record<string, unknown>, null, { keys: FEE_AUDIT_COLUMNS })),',
  '    ])'].join('\n')
const FEE_PUT_BATCH_AUDIT = [
  "      buildAuditStatement(user.id, user.username || null, 'update', 'fee', id, {",
  '        before: existing,',
  '        after: fee,',
  '        sale_id: saleId,',
  '        branch_id: branchId,',
  '      }, changedFields(existing as unknown as Record<string, unknown>, fee as unknown as Record<string, unknown>, { keys: FEE_AUDIT_COLUMNS })),',
  '    ])'].join('\n')
const PATCHES = {
  // PUT /api/fees/:id ignores expected_updated_at. Must turn K1b and K1d RED.
  'no-version-check': [
    { name: 'no-version-check-pre', file: FEES, from: "    assertRequiredUpdatedAtMatch('fee', existing, expectedUpdatedAt)", to: '    void expectedUpdatedAt' },
    { name: 'no-version-check-sql', file: FEES, from: '    WHERE id = @id AND updated_at IS @expectedUpdatedAt', to: '    WHERE id = @id AND (@expectedUpdatedAt IS NULL OR 1 = 1)' },
  ],
  // The delete keeps its audit in the batch but is not predicated on the version read. Must turn K2 RED (stale before-image).
  'delete-no-version': [
    { name: 'delete-no-version', file: FEES,
      from: '      { sql: `DELETE FROM fees WHERE id = @id AND updated_at IS @deleteVersion`, params: { id, deleteVersion } },\n'
        + "      { sql: `SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('fee_changed_since_read', '$') END AS fee_delete_guard`, params: {} },",
      to: '      { sql: `DELETE FROM fees WHERE id = @id`, params: { id } },' },
  ],
  // The delete's audit row goes back to a best-effort call after the commit. Must turn K5b RED.
  'delete-audit-best-effort': [
    { name: 'delete-audit-best-effort', file: FEES, from: FEE_DELETE_BATCH_AUDIT,
      to: "    ])\n    await audit(c.env, user.id, user.username || null, 'delete', 'fee', id, { before: existing, after: null }, changedFields(existing as unknown as Record<string, unknown>, null, { keys: FEE_AUDIT_COLUMNS }))" },
  ],
  // The approval ignores the version the requester saw (judges only what it reads now). Must turn K3 RED.
  'approve-ignores-reviewed-version': [
    { name: 'approve-ignores-reviewed-version', file: REVIEW_APPLY,
      from: '  if (reviewed.known && version !== reviewed.updatedAt) throw new FeeReviewStaleError()',
      to: '  void reviewed' },
  ],
  // The approved delete's audit row carries no before-image (the pre-fix applier wrote details = null). Must turn K4 RED.
  'approve-no-before-image': [
    { name: 'approve-no-before-image', file: REVIEW_APPLY,
      from: [
        "      buildAuditStatement(reviewer.id, reviewer.name, 'delete', 'fee', id, {",
        '        before: existing,',
        '        after: null,',
        '        pending_action_id: row.id,',
        '        requested_by: row.requested_by,',
        '        requested_by_name: row.requested_by_name,',
        '      }, changedFields(existing, null, { keys: FEE_DELETE_AUDIT_COLUMNS })),'].join('\n'),
      to: "      buildAuditStatement(reviewer.id, reviewer.name, 'delete', 'fee', id, null)," },
  ],
  // The decision is marked after the effect, in a separate commit (the pre-fix shape). Must turn K5c and K6 RED.
  'approve-decision-separate': [
    { name: 'approve-decision-separate-batch', file: REVIEW_APPLY,
      from: "      { sql: `SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('review_not_open', '$') END AS review_decision_guard`, params: {} },",
      to: '' },
    { name: 'approve-decision-separate-update', file: REVIEW_APPLY,
      from: "        WHERE id = @pendingId AND status = 'open' AND updated_at IS @pendingVersion`,",
      to: "        WHERE 0`," },
    { name: 'approve-decision-separate-outcome', file: REVIEW_APPLY,
      from: "  await notify(env, waitUntil, 'fees', { type: 'deleted', id })\n  return { pendingActionMarkedAtomically: true }",
      to: "  await notify(env, waitUntil, 'fees', { type: 'deleted', id })\n  return { pendingActionMarkedAtomically: false }" },
  ],
  // The audit row takes the user's most recently seen session again (the pre-fix device). Must turn K8a RED.
  'freshest-session-device': [
    { name: 'freshest-session-device', file: 'src/lib/audit.ts',
      from: [
        '        CASE WHEN @request_user_id IS NOT NULL AND @request_user_id = @user_id THEN @request_device_name ELSE s.device_name END,',
        '        CASE WHEN @request_user_id IS NOT NULL AND @request_user_id = @user_id THEN @request_device_tz ELSE s.device_tz END'].join('\n'),
      to: '        s.device_name,\n        s.device_tz' },
  ],
  // A legacy Undo flips the status whatever it was (the pre-fix flip). Must turn K9a RED.
  'undo-unconditional': [
    { name: 'undo-unconditional', file: ACTION_HISTORY,
      from: '            WHERE id = @id AND status IS @fromStatus`, params: { status: nextStatus, id: existing.id, fromStatus: existing.status } },',
      to: '            WHERE id = @id`, params: { status: nextStatus, id: existing.id } },' },
  ],
  // The restore's audit row is a swallowed best-effort write again. Must turn K10b RED.
  'restore-audit-swallowed': [
    { name: 'restore-audit-swallowed', file: 'src/routes/backups.ts',
      from: "        await auditOrThrow(c.env, user.id, user.username || null, 'restore', 'backup', sourceDir, {",
      to: "        await audit(c.env, user.id, user.username || null, 'restore', 'backup', sourceDir, {" },
  ],
  // Retention without the kept-forever classes (the blanket 21-day sweep). Must turn K11 RED.
  'retention-blanket': [
    { name: 'retention-blanket', file: 'src/lib/audit.ts',
      from: '      AND NOT (${AUDIT_RETENTION_KEPT_FOREVER_SQL})\n',
      to: '' },
  ],
  // Every Undo and Redo is kept again, whatever entity it replayed. Must turn K11 RED.
  'retention-undo-all': [
    { name: 'retention-undo-all', file: 'src/lib/audit.ts',
      from: 'OR (${AUDIT_ENTITY_KEY_SQL} IN (${sqlList(AUDIT_RETENTION_KEPT_UNDO_ENTITIES)})',
      to: "OR (${AUDIT_ENTITY_KEY_SQL} LIKE '%'" },
  ],
  // A sweep that deletes nothing (keeps everything). Must turn K11 RED.
  'retention-off': [
    { name: 'retention-off', file: 'src/lib/audit.ts',
      from: '    SELECT id FROM audit_logs\n    WHERE created_at < @cutoff\n      AND NOT (${AUDIT_RETENTION_KEPT_FOREVER_SQL})',
      to: '    SELECT id FROM audit_logs\n    WHERE 0\n      AND NOT (${AUDIT_RETENTION_KEPT_FOREVER_SQL})' },
  ],
  // The reject reason is taken as-is again. Must turn K7 and K7b RED.
  'no-reason-cap': [
    { name: 'no-reason-cap-type', file: REVIEW_QUEUE,
      from: "    if (supplied !== null && typeof supplied !== 'string') return c.json({ error: 'The reason must be text.', code: 'invalid_reason' }, 400)",
      to: '' },
    { name: 'no-reason-cap-length', file: REVIEW_QUEUE,
      from: '  if (reason !== null && reason.length > REVIEW_REASON_MAX_LENGTH) {',
      to: '  if (false) {' },
  ],
  // The edit's audit row goes back to a best-effort call after the commit. Must turn K5a RED.
  'put-audit-best-effort': [
    { name: 'put-audit-best-effort', file: FEES, from: FEE_PUT_BATCH_AUDIT,
      to: "    ])\n    await audit(c.env, user.id, user.username || null, 'update', 'fee', id, { before: existing, after: fee }, changedFields(existing as unknown as Record<string, unknown>, fee as unknown as Record<string, unknown>, { keys: FEE_AUDIT_COLUMNS }))" },
  ],
}

const TOKEN0 = '2026-10-01T00:00:00.000Z'
// K8b cannot be fixed without a schema change, which this lane may not make (0243-0248 are local and nondeployable, 0249+ is
// unreserved). What it needs, exactly: two nullable TEXT columns on pending_actions, requested_device_name and
// requested_device_tz, written by createPendingAction from the request's own session (the device K8a attributes); no backfill.
const K8B_PENDING = 'PENDING (schema): needs pending_actions.requested_device_name + requested_device_tz (append-only migration >= 0249)'
async function seedFee(H, { amount = 10, label = 'Rent', notes = 'monthly' } = {}) {
  // The migrated database already holds the historical expenses, so the new row takes the next free id.
  const res = await H.db.prepare(`INSERT INTO fees(fee_type,label,amount_usd,amount_khr,fee_date,branch_id,branch_name,notes,created_by,created_by_name,created_at,updated_at)
    VALUES('expense',?,?,0,'2026-10-01',?,?,?,1,'admin',?,?)`).bind(label, amount, LC, 'LC Store', notes, TOKEN0, TOKEN0).run()
  return { id: res.meta.last_row_id, token: TOKEN0, amount, label }
}
const feeOf = (H, id) => H.q1('SELECT * FROM fees WHERE id=?', id)
// entity_id is compared as a number: this harness's D1 stores the update/delete audit ids as the text "4241.0" (a JS number
// bound to a TEXT column) while create/undo rows hold "4241"; both mean the same record.
const feeAudits = (H, id, action) => H.q("SELECT * FROM audit_logs WHERE entity='fee' AND CAST(entity_id AS REAL)=?" + (action ? ' AND action=?' : '') + ' ORDER BY id', ...(action ? [Number(id), action] : [Number(id)]))
const auditCount = async H => (await H.q1('SELECT COUNT(*) n FROM audit_logs')).n
const pendingOf = (H, id) => H.q1('SELECT * FROM pending_actions WHERE id=?', id)
const parse = text => { try { return JSON.parse(text) } catch { return null } }
const canon = value => value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value
const pick = (value, keys) => value ? Object.fromEntries(keys.map(key => [key, value[key]])) : value
const putFee = (H, f, body, as = 'admin') => H.api('PUT', '/api/fees/' + f.id, { expected_updated_at: f.token, ...body }, { as })
const queueDelete = async (H, f, as = 'clerk') => { const r = await H.api('DELETE', '/api/fees/' + f.id, undefined, { as }); return { r, pid: r.body && r.body.pendingActionId } }
const approve = (H, pid, as = 'reviewer') => H.api('POST', '/api/review/' + pid + '/approve', {}, { as })
const reject = (H, pid, reason, as = 'reviewer') => H.api('POST', '/api/review/' + pid + '/reject', { reason }, { as })
const hookResult = async H => (await H.controlGet('hooks/result'))[0]
const withTrigger = async (H, name, sql, fn) => {
  await H.db.prepare(sql).run()
  try { return await fn() } finally { await H.db.prepare('DROP TRIGGER IF EXISTS ' + name).run() }
}

async function main() {
  if (FLAGS.has('fix')) assert.fail('--fix is superseded: the fixes are in src/ now. Run without flags, or --wrong=<mutant> (' + Object.keys(PATCHES).join(', ') + ')')
  const flavour = OPTIONS.wrong
  const patches = flavour ? (PATCHES[flavour] || assert.fail('unknown mutant ' + flavour + '; known: ' + Object.keys(PATCHES).join(', '))) : []
  console.log('MODE: ' + (flavour ? 'mutant ' + flavour : 'production code at HEAD (no patch)'))
  const H = await world({ patches })
  let R
  try {
    // LC Store is the selling branch after the consolidation (fees book to a branch with the selling role).
    await H.db.prepare("UPDATE branches SET role='shop' WHERE id=1").run()
    await H.addUser(2, 'al-clerk', { fees: 'review' })
    await H.addSession('clerk', 2, { device: 'Counter Tablet', lastSeenSecondsAgo: 200 })
    await H.addSession('clerkPhone', 2, { device: 'Owner Phone', lastSeenSecondsAgo: 20 })
    await H.addUser(3, 'al-reviewer', { fees: true, review: true })
    await H.addSession('reviewer', 3, { device: 'Reviewer Laptop' })
    await H.addUser(4, 'al-reviewer2', { fees: true, review: true })
    await H.addSession('reviewer2', 4, { device: 'Reviewer Phone' })
    await H.addUser(5, 'al-editor', { fees: true })
    await H.addSession('editorA', 5, { device: 'Counter Tablet', lastSeenSecondsAgo: 180 })
    await H.addSession('editorB', 5, { device: 'Owner Phone', lastSeenSecondsAgo: 60 })

    // ------------------------------------------------------------------ K1: optimistic versioning of an expense edit + its record
    await check('K1a', 'PUT without expected_updated_at is refused 400 (expected_updated_at_required) and changes nothing', 'control', async (t) => {
      const f = await seedFee(H)
      const audits0 = await auditCount(H)
      const r = await H.api('PUT', '/api/fees/' + f.id, { amount_usd: 99 })
      t.eq('status', r.status, 400)
      t.eq('code', r.body && r.body.code, 'expected_updated_at_required')
      t.eq('fee unchanged', pick(await feeOf(H, f.id), ['amount_usd', 'updated_at']), { amount_usd: 10, updated_at: TOKEN0 })
      t.eq('no audit row', (await auditCount(H)) - audits0, 0)
    })
    await check('K1b', 'PUT with a stale expected_updated_at is refused 409 and changes nothing (fee, audit)', 'high', async (t) => {
      const f = await seedFee(H)
      const audits0 = await auditCount(H)
      const r = await putFee(H, { ...f, token: '2026-09-30T00:00:00.000Z' }, { amount_usd: 99 })
      t.eq('status', r.status, 409)
      t.eq('fee unchanged', pick(await feeOf(H, f.id), ['amount_usd', 'updated_at']), { amount_usd: 10, updated_at: TOKEN0 })
      t.eq('no audit row', (await auditCount(H)) - audits0, 0)
    })
    await check('K1c', 'PUT with the current token succeeds and records the complete before and after (details, old_value, new_value, actor)', 'high', async (t) => {
      const f = await seedFee(H)
      const r = await putFee(H, f, { amount_usd: 12.5, label: 'Rent edited' })
      const stored = await feeOf(H, f.id)
      const rows = await feeAudits(H, f.id, 'update')
      const d = parse(rows[0] && rows[0].details)
      t.eq('status', r.status, 200)
      t.ok('the version token moved', stored.updated_at !== TOKEN0, stored.updated_at)
      t.eq('exactly one update audit row', rows.length, 1)
      const keys = ['fee_type', 'label', 'amount_usd', 'amount_khr', 'fee_date', 'branch_id', 'notes', 'updated_at']
      t.eq('details.before is the whole record as read before the edit', canon(pick(d && d.before, keys)), canon({ fee_type: 'expense', label: 'Rent', amount_usd: 10, amount_khr: 0, fee_date: '2026-10-01', branch_id: LC, notes: 'monthly', updated_at: TOKEN0 }))
      t.eq('details.after is the record exactly as stored', canon(pick(d && d.after, keys)), canon(pick(stored, keys)))
      t.eq('old_value / new_value hold exactly the fields that changed', [canon(parse(rows[0] && rows[0].old_value)), canon(parse(rows[0] && rows[0].new_value))], [canon({ label: 'Rent', amount_usd: 10 }), canon({ label: 'Rent edited', amount_usd: 12.5 })])
      t.eq('actor', rows[0] && rows[0].user_id, 1)
      t.note('D1 statements, PUT: ' + r.d1)
    })
    await check('K1d', 'two edits against the same token: exactly one wins, the loser gets 409, the record reflects only the winner', 'high', async (t) => {
      const f = await seedFee(H)
      await H.control('hooks', { hooks: [{ pattern: 'UPDATE fees SET fee_type', request: H.hookRequest('PUT', '/api/fees/' + f.id, { expected_updated_at: f.token, amount_usd: 20 }) }] })
      const r = await putFee(H, f, { amount_usd: 30 })
      const hook = await hookResult(H)
      await H.disarm()
      const rows = await feeAudits(H, f.id, 'update')
      t.ok('the competing edit really ran first', hook.fired && hook.result.status === 200, hook)
      t.eq('the late edit is refused', r.status, 409)
      t.eq('the record reflects only the winner', (await feeOf(H, f.id)).amount_usd, 20)
      t.eq('one update audit row, and it is the winner\'s', rows.map(row => parse(row.details)?.after?.amount_usd), [20])
    })

    // ------------------------------------------------------------------ K2: delete has no version admission
    await check('K2', 'delete after a concurrent edit: either refused 409 (fee kept) or the audit before-image is the record that was actually deleted', 'high', async (t) => {
      const f = await seedFee(H)
      await H.control('hooks', { hooks: [{ pattern: 'DELETE FROM fees WHERE id', request: H.hookRequest('PUT', '/api/fees/' + f.id, { expected_updated_at: f.token, amount_usd: 777 }) }] })
      const r = await H.api('DELETE', '/api/fees/' + f.id)
      const hook = await hookResult(H)
      await H.disarm()
      const gone = !(await feeOf(H, f.id))
      const rows = await feeAudits(H, f.id, 'delete')
      t.ok('the concurrent edit really landed first', hook.fired && hook.result.status === 200, hook)
      if (gone) t.eq('the audit before-image is the record that was actually removed (amount 777, not the stale 10)', parse(rows[0] && rows[0].details)?.before?.amount_usd, 777)
      else t.eq('a refused delete answers 409', r.status, 409)
      t.note('delete status ' + r.status + '; fee gone=' + gone + '; audited before.amount_usd=' + parse(rows[0] && rows[0].details)?.before?.amount_usd)
    })
    await check('K2-control-direct', 'control: an undisturbed direct delete removes the fee and records its before-image', 'control', async (t) => {
      const f = await seedFee(H)
      const r = await H.api('DELETE', '/api/fees/' + f.id)
      const rows = await feeAudits(H, f.id, 'delete')
      t.eq('status', r.status, 200)
      t.eq('gone', !(await feeOf(H, f.id)), true)
      t.eq('before-image', pick(parse(rows[0] && rows[0].details)?.before, ['label', 'amount_usd', 'updated_at']), { label: 'Rent', amount_usd: 10, updated_at: TOKEN0 })
      t.note('D1 statements, direct DELETE: ' + r.d1)
    })
    await check('K2b', 'a delete that states a version the expense no longer has (expected_updated_at) is refused 409, nothing removed or queued', 'high', async (t) => {
      const f = await seedFee(H)
      const audits0 = await auditCount(H)
      const pending0 = (await H.q1('SELECT COUNT(*) n FROM pending_actions')).n
      const direct = await H.api('DELETE', '/api/fees/' + f.id, { expected_updated_at: '2026-09-30T00:00:00.000Z' })
      const queued = await H.api('DELETE', '/api/fees/' + f.id, { expected_updated_at: '2026-09-30T00:00:00.000Z' }, { as: 'clerk' })
      t.eq('direct delete status', direct.status, 409)
      t.eq('direct delete code', direct.body && direct.body.code, 'write_conflict')
      t.eq('Review-Required delete status (refused before it is queued)', queued.status, 409)
      t.eq('the expense is still there', !!(await feeOf(H, f.id)), true)
      t.eq('no audit row', (await auditCount(H)) - audits0, 0)
      t.eq('nothing queued', (await H.q1('SELECT COUNT(*) n FROM pending_actions')).n - pending0, 0)
    })
    await check('K2c', 'control: a delete that states the current version is admitted and records its before-image', 'control', async (t) => {
      const f = await seedFee(H)
      const r = await H.api('DELETE', '/api/fees/' + f.id, { expected_updated_at: f.token })
      const rows = await feeAudits(H, f.id, 'delete')
      t.eq('status', r.status, 200)
      t.eq('gone', !(await feeOf(H, f.id)), true)
      t.eq('one delete audit row with the before-image', rows.map(row => parse(row.details)?.before?.amount_usd), [10])
    })

    // ------------------------------------------------------------------ K3 / K4: the generic review path (queued delete)
    await check('K3-control', 'control: a queued delete of an UNCHANGED fee is approved and applied by a second person', 'control', async (t) => {
      const f = await seedFee(H)
      const { r, pid } = await queueDelete(H, f)
      t.eq('queued (202)', r.status, 202)
      const a = await approve(H, pid)
      t.eq('approve status', a.status, 200)
      t.eq('fee gone', !(await feeOf(H, f.id)), true)
      t.eq('request approved', (await pendingOf(H, pid)).status, 'approved')
      t.eq('the request remembers the version it was made against', parse((await pendingOf(H, pid)).expected_entity_state_json), { updated_at: TOKEN0 })
      t.note('D1 statements: queue ' + r.d1 + ', approve ' + a.d1)
    })
    await check('K3', 'a queued delete is judged against what was reviewed: after the fee is edited, approving it is refused 409 and the edited fee survives', 'high', async (t) => {
      const f = await seedFee(H)
      const { pid } = await queueDelete(H, f)
      const e = await putFee(H, f, { amount_usd: 500, label: 'Rent edited' })
      const a = await approve(H, pid)
      t.eq('the edit itself succeeded', e.status, 200)
      t.eq('approve of the stale request is refused', a.status, 409)
      t.eq('the edited fee still exists', !!(await feeOf(H, f.id)), true)
      t.ok('the request is not marked approved', (await pendingOf(H, pid)).status !== 'approved', (await pendingOf(H, pid)).status)
    })
    await check('K4', 'the approved delete writes the deleted record as the audit before-image (as the direct delete does)', 'high', async (t) => {
      const f = await seedFee(H)
      const { pid } = await queueDelete(H, f)
      const a = await approve(H, pid)
      const rows = await feeAudits(H, f.id, 'delete')
      t.eq('approve status', a.status, 200)
      t.eq('one delete audit row', rows.length, 1)
      t.eq('before-image', pick(parse(rows[0] && rows[0].details)?.before, ['label', 'amount_usd', 'updated_at']), { label: 'Rent', amount_usd: 10, updated_at: TOKEN0 })
      t.ok('old_value is populated', rows[0] && rows[0].old_value != null, rows[0] && rows[0].old_value)
      t.note('delete audit details: ' + String(rows[0] && rows[0].details).slice(0, 80))
    })

    // ------------------------------------------------------------------ K5: atomicity of mutation, audit and queue
    await check('K5a', 'an expense edit is never committed without its audit row (audit store unavailable)', 'high', async (t) => {
      const f = await seedFee(H)
      await withTrigger(H, 'al_audit_down', "CREATE TRIGGER al_audit_down BEFORE INSERT ON audit_logs WHEN NEW.entity='fee' AND NEW.action='update' BEGIN SELECT RAISE(ABORT,'al: audit store unavailable'); END", async () => {
        const r = await putFee(H, f, { amount_usd: 41 })
        const mutated = (await feeOf(H, f.id)).amount_usd !== 10
        const audited = (await feeAudits(H, f.id, 'update')).length > 0
        t.eq('a committed edit without an audit row', mutated && !audited, false)
        t.note('PUT status ' + r.status + '; fee mutated=' + mutated + '; audit rows=' + (audited ? '>0' : 0))
      })
    })
    await check('K5b', 'an expense delete is never committed without its audit row (audit store unavailable)', 'high', async (t) => {
      const f = await seedFee(H)
      await withTrigger(H, 'al_audit_down', "CREATE TRIGGER al_audit_down BEFORE INSERT ON audit_logs WHEN NEW.entity='fee' AND NEW.action='delete' BEGIN SELECT RAISE(ABORT,'al: audit store unavailable'); END", async () => {
        const r = await H.api('DELETE', '/api/fees/' + f.id)
        const gone = !(await feeOf(H, f.id))
        const audited = (await feeAudits(H, f.id, 'delete')).length > 0
        t.eq('a committed delete without an audit row', gone && !audited, false)
        t.note('DELETE status ' + r.status + '; fee gone=' + gone + '; audit rows=' + (audited ? '>0' : 0))
      })
    })
    await check('K5-control-create', 'control: creating an expense IS atomic with its audit (the sibling path proves the assertion is satisfiable)', 'control', async (t) => {
      const ok = await H.api('POST', '/api/fees', { client_request_id: 'al-k5-create-0001', fee_type: 'expense', label: 'AL create ok', amount_usd: 5, fee_date: '2026-10-02', branch_id: LC })
      t.eq('a normal create works (fixture reaches the path)', ok.status, 201)
      await withTrigger(H, 'al_audit_down', "CREATE TRIGGER al_audit_down BEFORE INSERT ON audit_logs WHEN NEW.entity='fee' AND NEW.action='create' BEGIN SELECT RAISE(ABORT,'al: audit store unavailable'); END", async () => {
        await H.api('POST', '/api/fees', { client_request_id: 'al-k5-create-0002', fee_type: 'expense', label: 'AL create blocked', amount_usd: 6, fee_date: '2026-10-02', branch_id: LC })
        t.eq('no expense row without its audit row', (await H.q1("SELECT COUNT(*) n FROM fees WHERE label='AL create blocked'")).n, 0)
      })
    })
    await check('K5c', 'an approval and its effect commit together: if the queue row cannot be marked approved, the fee is not deleted', 'high', async (t) => {
      const f = await seedFee(H)
      const { pid } = await queueDelete(H, f)
      await withTrigger(H, 'al_pa_down', "CREATE TRIGGER al_pa_down BEFORE UPDATE ON pending_actions WHEN NEW.status='approved' BEGIN SELECT RAISE(ABORT,'al: queue store unavailable'); END", async () => {
        const a = await approve(H, pid)
        const gone = !(await feeOf(H, f.id))
        const status = (await pendingOf(H, pid)).status
        t.ok('effect and decision agree (deleted and approved, or kept and still open)', (gone && status === 'approved') || (!gone && status === 'open'), { feeGone: gone, requestStatus: status, approveHttp: a.status })
      })
    })

    // ------------------------------------------------------------------ K6: approve / reject race
    await check('K6', 'approve and reject at the same instant: the decision and the effect agree (never "rejected" with the fee deleted)', 'high', async (t) => {
      const f = await seedFee(H)
      const { pid } = await queueDelete(H, f)
      await H.control('hooks', { hooks: [{ pattern: 'DELETE FROM fees WHERE id', request: H.hookRequest('POST', '/api/review/' + pid + '/reject', { reason: 'Duplicate of another expense' }, 'reviewer2') }] })
      const a = await approve(H, pid)
      const hook = await hookResult(H)
      await H.disarm()
      const gone = !(await feeOf(H, f.id))
      const status = (await pendingOf(H, pid)).status
      t.ok('the reject really landed while the approval was applying', hook.fired && hook.result.status === 200, hook)
      t.ok('decision and effect agree (approved and deleted, or rejected and kept)', (status === 'approved' && gone) || (status === 'rejected' && !gone), { requestStatus: status, feeGone: gone, approveHttp: a.status })
    })

    // ------------------------------------------------------------------ K7: reasons
    await check('K7', 'a reject reason over 512 characters (the cap every stock reason has) is refused 400 reason_too_long and the request stays open', 'medium', async (t) => {
      const f = await seedFee(H)
      const { pid } = await queueDelete(H, f)
      const r = await reject(H, pid, 'x'.repeat(513))
      const row = await pendingOf(H, pid)
      t.eq('status', r.status, 400)
      t.eq('code', r.body && r.body.code, 'reason_too_long')
      t.eq('request still open', row.status, 'open')
      t.note('stored reason length: ' + (row.reject_reason ? row.reject_reason.length : 0))
    })
    await check('K7b', 'a reject reason that is not text is refused 400 invalid_reason and the request stays open', 'medium', async (t) => {
      const f = await seedFee(H)
      const { pid } = await queueDelete(H, f)
      const r = await reject(H, pid, { text: 'not a string' })
      t.eq('status', r.status, 400)
      t.eq('code', r.body && r.body.code, 'invalid_reason')
      t.eq('request still open', (await pendingOf(H, pid)).status, 'open')
    })
    await check('K7-control', 'control: a 512-character reason is accepted and stored whole', 'control', async (t) => {
      const f = await seedFee(H)
      const { pid } = await queueDelete(H, f)
      const r = await reject(H, pid, 'y'.repeat(512))
      const row = await pendingOf(H, pid)
      t.eq('status', r.status, 200)
      t.eq('stored length', row.reject_reason && row.reject_reason.length, 512)
    })

    // ------------------------------------------------------------------ K8: request-device attribution
    await check('K8-control', 'control: with ONE live session the audit row names that session\'s device', 'control', async (t) => {
      const f = await seedFee(H)
      const r = await putFee(H, f, { amount_usd: 11 })
      t.eq('status', r.status, 200)
      t.eq('audit device', (await feeAudits(H, f.id, 'update'))[0]?.device_name, 'Owner Laptop')
    })
    await check('K8a', 'the audit row names the device the REQUEST came from, not the user\'s most recently active other session', 'medium', async (t) => {
      const f = await seedFee(H)
      const r = await putFee(H, f, { amount_usd: 13 }, 'editorA')
      const rows = await feeAudits(H, f.id, 'update')
      t.eq('status', r.status, 200)
      t.eq('audit device (request came from the Counter Tablet; the Owner Phone session was seen more recently)', rows[0] && rows[0].device_name, 'Counter Tablet')
    })
    await check('K8b', 'a queued request records the device it was made on', K8B_PENDING, async (t) => {
      const f = await seedFee(H)
      const { r, pid } = await queueDelete(H, f, 'clerk')
      const row = await pendingOf(H, pid)
      const columns = (await H.q("PRAGMA table_info('pending_actions')")).map(c => c.name)
      t.eq('queued', r.status, 202)
      t.ok('the queue row carries the requesting device (Counter Tablet)', JSON.stringify(row).includes('Counter Tablet'), { deviceColumns: columns.filter(c => /device|session|tz/i.test(c)) })
    })

    // ------------------------------------------------------------------ K9: generic legacy Undo (client-closure history record)
    await check('K9a', 'two Undo requests for one legacy history record: exactly one succeeds (the other is 409 stale) and one audit row is written', 'high', async (t) => {
      const created = await H.api('POST', '/api/action-history', { scope: 'fees', entity: 'fee', entity_id: '1', label: 'Edit expense', undo_label: 'Undo edit', redo_label: 'Redo edit', reversible: true, undo_payload: { kind: 'client-closure', note: 'al' }, redo_payload: { kind: 'client-closure', note: 'al' } })
      const hid = created.body && created.body.id
      t.eq('history record created', created.status, 200)
      await H.control('hooks', { hooks: [{ pattern: 'UPDATE action_history SET status', request: H.hookRequest('POST', '/api/action-history/' + hid + '/undo', {}) }] })
      const a = await H.api('POST', '/api/action-history/' + hid + '/undo', {})
      const hook = await hookResult(H)
      await H.disarm()
      const audits = await H.q("SELECT COUNT(*) n FROM audit_logs WHERE action='action_undo' AND CAST(entity_id AS TEXT)='1' AND details LIKE ?", '%"actionHistoryId":' + hid + ',%')
      t.ok('the competing Undo really ran inside the first', hook.fired && hook.result.status === 200, hook)
      t.eq('statuses of the two Undo requests (one 200, one 409)', [a.status, hook.result.status].sort(), [200, 409])
      t.eq('undo audit rows for the record', audits[0].n, 1)
      t.note('each 200 hands the payload back for the browser to replay: ' + [a.status, hook.result.status].join(' / '))
    })

    // ------------------------------------------------------------------ K11: evidence vs the audit-log retention window
    // Owner, 13 Oct (relayed by the coordinator): "keep old expenses ... for the revert, yes, as it is same with stock changes."
    // Owner, 14 Oct: "sales, payments, returns, stock changes, permission changes, reverts" are kept forever; undo and redo are not
    // named, and 13 Oct says the Undo/Redo history may be pruned. Expense evidence and revert records never age out, and neither
    // does the Undo of an expense edit, because an expense is a kept class. The Undo of a brand rename is only history and expires.
    // The sweep must still run (an ordinary old row is deleted), so a sweep that is switched off, keeps everything, or keeps every
    // Undo fails here as surely as the blanket 21-day sweep.
    await check('K11', 'owner rulings 13 and 14 Oct: the retention sweep keeps old expense evidence, revert records and the Undo of a kept class, and still prunes ordinary rows and the Undo of anything else', 'owner-ruling', async (t) => {
      const f = await seedFee(H)
      const e = await putFee(H, f, { amount_usd: 15 })
      const g = await seedFee(H, { label: 'Water' })
      const d = await H.api('DELETE', '/api/fees/' + g.id)
      const hist = await H.api('POST', '/api/action-history', { scope: 'fees', entity: 'fee', entity_id: String(f.id), label: 'Edit expense', undo_label: 'Undo edit', reversible: true, undo_payload: { kind: 'client-closure' }, redo_payload: { kind: 'client-closure' } })
      const u = await H.api('POST', '/api/action-history/' + hist.body.id + '/undo', {})
      const brandHist = await H.api('POST', '/api/action-history', { scope: 'brands', entity: 'brand', entity_id: 'al-k11-brand', label: 'Rename brand', undo_label: 'Undo rename', reversible: true, undo_payload: { kind: 'client-closure' }, redo_payload: { kind: 'client-closure' } })
      const bu = await H.api('POST', '/api/action-history/' + brandHist.body.id + '/undo', {})
      // A revert record in the exact shape POST /api/inventory/movements/:id/revert writes (action 'stock_revert' on the product);
      // test-audit-retention-pure.cjs fails if the source writes a 'stock_revert*' action that retention does not keep.
      await H.db.prepare("INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details) VALUES(1,'admin','stock_revert','product','al-k11-revert',?)").bind(JSON.stringify({ movementId: 1, revertType: 'stock_in', quantity: 2 })).run()
      // Positive control: an ordinary operational row of the same age must still be deleted.
      await H.db.prepare("INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details) VALUES(1,'admin','update','settings','al-k11-control','{}')").run()
      t.eq('fixture: the brand history was recorded and undone', [brandHist.status, bu.status, (await H.q1("SELECT COUNT(*) n FROM audit_logs WHERE entity='brand' AND action='action_undo' AND entity_id='al-k11-brand'")).n], [200, 200, 1])
      t.eq('fixture: edit, delete and undo were recorded', [e.status, d.status, u.status, (await feeAudits(H, f.id, 'update')).length, (await feeAudits(H, g.id, 'delete')).length, (await feeAudits(H, f.id, 'action_undo')).length], [200, 200, 200, 1, 1, 1])
      await H.db.prepare("UPDATE audit_logs SET created_at = datetime('now','-30 days') WHERE (entity='fee' AND CAST(entity_id AS REAL) IN (?, ?)) OR entity_id IN ('al-k11-revert','al-k11-control','al-k11-brand')").bind(Number(f.id), Number(g.id)).run()
      const cleared = await H.api('DELETE', '/api/system/audit-logs/retention?olderThanDays=21&confirm=true', { currentPassword: 'al-repro-admin-password-1' })
      const left = async (sql) => (await H.q1(sql)).n
      t.eq('retention sweep ran', cleared.status, 200)
      t.eq('the 30-day-old expense edit row is kept', (await feeAudits(H, f.id, 'update')).length, 1)
      t.eq('the 30-day-old expense delete row (its before-image) is kept', (await feeAudits(H, g.id, 'delete')).length, 1)
      t.eq('the 30-day-old revert record is kept', await left("SELECT COUNT(*) n FROM audit_logs WHERE entity_id='al-k11-revert'"), 1)
      t.eq('the 30-day-old Undo of an expense edit is kept (an expense is a kept class)', (await feeAudits(H, f.id, 'action_undo')).length, 1)
      t.eq('the 30-day-old Undo of a brand rename is pruned (13 Oct: Undo/Redo history may be pruned)', await left("SELECT COUNT(*) n FROM audit_logs WHERE entity='brand' AND action='action_undo' AND entity_id='al-k11-brand'"), 0)
      t.eq('positive control: the 30-day-old ordinary row is pruned', await left("SELECT COUNT(*) n FROM audit_logs WHERE entity_id='al-k11-control'"), 0)
      t.note('deleted by the sweep: ' + (cleared.body && cleared.body.deleted) + '; D1 statements of the sweep request: ' + cleared.d1)
    })

    // ------------------------------------------------------------------ K10: restore audit (own world: a restore rewinds the whole database)
    // A second Miniflare world costs a minute; it is only built when a K10 case will run.
    if (!OPTIONS.only || OPTIONS.only.split(',').some(id => /^K10/.test(id))) {
    R = await world({ patches })
    await R.db.prepare("UPDATE branches SET role='shop' WHERE id=1").run()
    const mkFee = (label, amount) => R.api('POST', '/api/fees', { client_request_id: 'al-k10-' + label + '-0001', fee_type: 'expense', label, amount_usd: amount, fee_date: '2026-10-02', branch_id: LC })
    const backupName = async () => {
      const bk = await R.api('POST', '/api/backups', { type: 'export-cloudflare' })
      return { status: bk.status, name: bk.body && bk.body.item && bk.body.item.result && bk.body.item.result.packageId }
    }
    // K10b runs first: a restore re-inserts every audit row of its backup, so the fault injected for the restore audit must not exist in the snapshot.
    const maintenanceFlag = async () => !!(await R.q1("SELECT value FROM system_flags WHERE key='maintenance'"))
    await check('K10b', 'a restore that cannot be audited is not reported done: maintenance holds until it is cleared and the same restore is retried, which records it', 'high', async (t) => {
      const bk = await backupName()
      await withTrigger(R, 'al_restore_audit_down', "CREATE TRIGGER al_restore_audit_down BEFORE INSERT ON audit_logs WHEN NEW.action='restore' BEGIN SELECT RAISE(ABORT,'al: audit store unavailable'); END", async () => {
        const restored = await R.api('POST', '/api/backups', { type: 'import-folder', sourceDir: bk.name, currentPassword: 'al-repro-admin-password-1' })
        const audited = (await R.q("SELECT COUNT(*) n FROM audit_logs WHERE entity='backup' AND action='restore'"))[0].n > 0
        t.eq('a restore reported done with no audit row', restored.status === 200 && !audited, false)
        t.eq('the refusal says the data was restored but not recorded', [restored.body && restored.body.code, restored.body && restored.body.data_restored], ['restore_audit_not_recorded', true])
        t.eq('maintenance still holds every other write while the restore is unrecorded', await maintenanceFlag(), true)
        t.note('restore status ' + restored.status + '; audited=' + audited + '; D1 statements: ' + restored.d1)
      })
      // Recovery, with the audit store back: clear maintenance (force), retry the same restore; this time it is recorded.
      const clearedHold = await R.api('POST', '/api/backups/maintenance/clear', { force: true, currentPassword: 'al-repro-admin-password-1' })
      const retried = await R.api('POST', '/api/backups', { type: 'import-folder', sourceDir: bk.name, currentPassword: 'al-repro-admin-password-1' })
      t.eq('recovery: clear, then retry the same restore', [clearedHold.status, retried.status], [200, 200])
      t.eq('the retried restore is on record exactly once', (await R.q("SELECT COUNT(*) n FROM audit_logs WHERE entity='backup' AND action='restore'"))[0].n, 1)
      t.eq('maintenance is released once the restore is recorded', await maintenanceFlag(), false)
    })
    // K10a was NEEDS-OWNER-DECISION in the reproduction. Owner, 13 Oct (relayed by the coordinator): "replace with the backup".
    // A restore replacing the audit trail with the backup's is the chosen design, so it is pinned here as an expectation.
    await check('K10a', 'owner ruling 13 Oct ("replace with the backup"): a restore replaces the audit trail with the backup\'s and records itself', 'owner-ruling', async (t) => {
      const created = await mkFee('Rent', 10)
      const fee = created.body.fee
      const bk = await backupName()
      const restoresInBackup = (await R.q("SELECT COUNT(*) n FROM audit_logs WHERE entity='backup' AND action='restore'"))[0].n
      const e = await R.api('PUT', '/api/fees/' + fee.id, { expected_updated_at: fee.updated_at, amount_usd: 77 })
      const editRows = async () => (await R.q("SELECT COUNT(*) n FROM audit_logs WHERE entity='fee' AND action='update' AND CAST(entity_id AS REAL)=?", Number(fee.id)))[0].n
      const editAudit0 = await editRows()
      const restored = await R.api('POST', '/api/backups', { type: 'import-folder', sourceDir: bk.name, currentPassword: 'al-repro-admin-password-1' })
      t.eq('fixture: create, backup, edit, restore all succeeded', [created.status, bk.status, e.status, restored.status], [201, 200, 200, 200])
      t.eq('fixture: the edit was audited before the restore', editAudit0, 1)
      t.eq('the fee is back to the backed-up amount', (await R.q1('SELECT amount_usd a FROM fees WHERE id=?', fee.id)).a, 10)
      t.eq('the audit trail is the backup\'s: the rolled-back edit\'s row went with it', await editRows(), 0)
      t.eq('the restore itself is on record (one more restore row than the backup holds)', (await R.q("SELECT COUNT(*) n FROM audit_logs WHERE entity='backup' AND action='restore'"))[0].n, restoresInBackup + 1)
      t.note('restore: ' + restored.status + '; D1 statements of the restore request: ' + restored.d1)
    })
    }
  } finally {
    await H.disarm().catch(() => {})
    await H.dispose()
    if (R) { await R.disarm().catch(() => {}); await R.dispose() }
  }
  finish('K')
}
main().catch(error => { console.error(error); process.exitCode = 2 })
