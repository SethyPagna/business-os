'use strict'
// ============================================================================================
// REVIEW QUEUE (REVQ-A, F5, F3) against the REAL Worker in workerd under Miniflare (harness copied from
// test-review-telegram-alerts-native.cjs; Telegram is recorded, nothing leaves the machine; a statement hook runs one
// SQL statement just before a matching D1 statement, to decide a request in the middle of its own approval).
//   M1-M4,M7-M9  approving a queued rename that now matches an existing product performs the merge: confirmation,
//                approver's merge permission, atomic approved mark, audit before/after, undo
//   M5           createPendingAction is idempotent on client_request_id: one row, one alert
//   M6           ?fields= is 400 when empty, repeated or unknown
// Run (from cloudflare/):  node scripts/test-review-queue-merge-native.cjs [--only=M1,M5] [--wrong=<mutant>]
//   mutants: no-confirm-check no-merge-permission mark-outside-batch no-audit-context dedupe-off alert-on-replay fields-first-value
// ============================================================================================
const assert = require('node:assert/strict')
const { executeRawStockTransaction } = require('../src/lib/stockTransaction.ts')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const root = path.resolve(__dirname, '..')
const ARGS = process.argv.slice(2)
const OPTIONS = Object.fromEntries(ARGS.filter(a => a.startsWith('--') && a.includes('=')).map(a => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]))
const sha256 = text => createHash('sha256').update(text).digest('hex')

const WRAPPER = `
import worker from './src/index'
export { SyncUploadSession, BroadcastHub } from './src/index'

const control = { barrier: null, lastLog: [], lastRespondedAt: 0, hook: null, rawDb: null }
const telegram = { calls: [], script: [] }

// Every outbound call a request makes. Telegram is recorded and scripted; anything else is refused.
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === 'string' ? input : input.url)
  if (!url.startsWith('https://api.telegram.org/')) return new Response('blocked by test', { status: 599 })
  let body = null
  try { body = JSON.parse((init && init.body) || 'null') } catch (e) { /* not json */ }
  const call = { method: url.split('/').pop(), body, signal: Boolean(init && init.signal), startedAt: Date.now(), doneAt: 0 }
  telegram.calls.push(call)
  const step = telegram.script.length ? telegram.script.shift() : null
  if (step && step.delay) await new Promise(resolve => setTimeout(resolve, step.delay))
  call.doneAt = Date.now()
  if (step && step.throw) { const error = new Error(step.throw); error.name = step.name || 'TypeError'; throw error }
  if (step && step.status) return new Response(step.body || '', { status: step.status })
  return new Response(JSON.stringify({ ok: true, result: { message_id: telegram.calls.length } }), { status: 200 })
}

const rawFetch = (request, env, ctx) => worker.fetch(request, env, ctx)
function matches(pattern, sqls) { const re = new RegExp(pattern, 'i'); return sqls.some(sql => re.test(sql)) }

function wrapDb(db, counter) {
  const statement = (inner, sql) => ({
    sql, inner,
    bind: (...args) => statement(inner.bind(...args), sql),
    first: async (...a) => { await before([sql]); counter.n++; counter.log.push(sql); return inner.first(...a) },
    all: async (...a) => { await before([sql]); counter.n++; counter.log.push(sql); return inner.all(...a) },
    run: async (...a) => { await before([sql]); counter.n++; counter.log.push(sql); return inner.run(...a) },
    raw: async (...a) => { await before([sql]); counter.n++; counter.log.push(sql); return inner.raw(...a) },
  })
  return {
    prepare: (sql) => statement(db.prepare(sql), sql),
    batch: async (statements) => {
      const sqls = statements.map(s => s.sql)
      await before(sqls)
      counter.n += statements.length
      for (const sql of sqls) counter.log.push(sql)
      return db.batch(statements.map(s => s.inner))
    },
    exec: (q) => db.exec(q),
  }
}

async function before(sqls) {
  if (control.hook && !control.hook.fired && matches(control.hook.pattern, sqls)) { control.hook.fired = true; await control.rawDb.prepare(control.hook.sql).run() }
  if (control.barrier && matches(control.barrier.pattern, sqls)) {
    const barrier = control.barrier
    barrier.arrived++
    if (barrier.arrived >= barrier.count) barrier.release()
    await Promise.race([barrier.promise, new Promise(resolve => setTimeout(resolve, 20000))])
  }
}

function instrument(rawEnv, ctx, counter) {
  const pending = []
  control.rawDb = rawEnv.DB
  const env = { ...rawEnv, DB: wrapDb(rawEnv.DB, counter) }
  const ctx2 = { waitUntil(p) { pending.push(Promise.resolve(p).catch(() => {})); try { ctx.waitUntil(p) } catch (e) {} }, passThroughOnException() {} }
  return { env, ctx2, pending }
}

async function drain(pending) {
  for (let i = 0; i < 20; i++) { const n = pending.length; await Promise.allSettled(pending.slice()); if (pending.length === n) break }
}

async function handle(request, rawEnv, ctx) {
  const url = new URL(request.url)
  if (url.pathname.startsWith('/__al/')) return control_(url, request)
  const counter = { n: 0, log: [] }
  const { env, ctx2, pending } = instrument(rawEnv, ctx, counter)
  const response = await rawFetch(request, env, ctx2)
  // The instant the Worker's own answer was ready: a deferred alert must still be running after this.
  const respondedAt = Date.now()
  if (response.webSocket) return response
  await drain(pending)
  control.lastLog = counter.log.slice()
  const headers = new Headers(response.headers)
  headers.set('x-al-d1', String(counter.n))
  headers.set('x-rt-responded-at', String(respondedAt))
  return new Response(response.body, { status: response.status, headers })
}

async function control_(url, request) {
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}
  switch (url.pathname) {
    case '/__al/barrier': {
      if (!body.pattern) { control.barrier = null; return Response.json({ ok: true }) }
      let release; const promise = new Promise(r => { release = r })
      control.barrier = { pattern: body.pattern, count: body.count || 2, arrived: 0, release, promise }
      return Response.json({ ok: true })
    }
    case '/__al/barrier/result': return Response.json({ arrived: control.barrier ? control.barrier.arrived : null })
    case '/__al/tg/script': telegram.script = body.steps || []; return Response.json({ ok: true })
    case '/__al/tg/reset': telegram.calls = []; telegram.script = []; return Response.json({ ok: true })
    case '/__al/tg/calls': return Response.json(telegram.calls)
    case '/__al/hook': control.hook = body.pattern ? { pattern: body.pattern, sql: body.sql, fired: false } : null; return Response.json({ ok: true })
    case '/__al/hook/fired': return Response.json({ fired: Boolean(control.hook && control.hook.fired) })
    case '/__al/lastlog': return Response.json(control.lastLog)
    default: return new Response('unknown', { status: 404 })
  }
}

export default { fetch: (request, env, ctx) => handle(request, env, ctx) }
`

// In-memory source rewrites. `patches` = [{ name, file: 'src/...ts', from, to }]. Line endings are normalised first
// (the working tree may be CRLF), and a missing anchor is a hard error, never a silent no-op.
async function bundle(patches) {
  const { build } = require('esbuild')
  const applied = new Set()
  const result = await build({
    stdin: { contents: WRAPPER, resolveDir: root, loader: 'ts', sourcefile: 'rt-wrapper.ts' },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], logLevel: 'error',
    plugins: [{ name: 'rt-source-patches', setup(b) {
      b.onLoad({ filter: /[\\/]cloudflare[\\/]src[\\/].*\.ts$/ }, args => {
        const here = args.path.replaceAll('\\', '/')
        const mine = patches.filter(p => here.endsWith('/cloudflare/' + p.file))
        if (!mine.length) return undefined
        let text = fs.readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n')
        for (const p of mine) {
          assert.equal(text.split(p.from).length - 1, 1, 'patch anchor must occur exactly once in ' + p.file + ': ' + p.from.slice(0, 80))
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
      // no-op on an empty users table (same exemption test-al-stock-*-native.cjs makes).
      if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
      statements.push({ name, statement })
    }
  }
  for (let i = 0; i < statements.length; i += 100) {
    const chunk = statements.slice(i, i + 100)
    try { await db.batch(chunk.map(x => db.prepare(x.statement))) } catch (error) { error.message = chunk[0].name + '+: ' + error.message; throw error }
  }
}

const CHAT = '-1001111111111'   // made up
const TOPIC = 777

async function world({ patches = [] } = {}) {
  const { Miniflare, Log, LogLevel } = require('miniflare')
  const script = await bundle(patches)
  const mf = new Miniflare({
    modules: true, script, compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat', 'no_handle_cross_request_promise_resolution'],
    d1Databases: ['DB'], kvNamespaces: ['CACHE'], r2Buckets: ['ASSETS'],
    durableObjects: { BROADCAST_HUB: 'BroadcastHub', SYNC_UPLOADS: 'SyncUploadSession' },
    bindings: { PLAN_TIER: 'paid', BUSINESS_OS_PUBLIC_URL: 'https://leangbeauty.com', BUSINESS_OS_ADMIN_URL: 'https://admin.leangbeauty.com',
      BUSINESS_OS_ADMIN_PASSWORD: 'rt-repro-admin-password-1', BUSINESS_OS_ORGANIZATION_SLUG: 'leangbeauty',
      TELEGRAM_BOT_TOKEN: 'test-token-not-a-real-one' },
    // A second wall: even if the fetch replacement above were bypassed, nothing leaves this machine.
    outboundService: () => new Response('External network refused by local fixture', { status: 503 }),
    log: new Log(LogLevel.ERROR),
  })
  const db = await mf.getD1Database('DB')
  await migrate(db)
  // First request: the Worker seeds its default organization / branches / roles / admin (once per isolate).
  await mf.dispatchFetch('http://localhost/api/settings')
  await db.batch([
    db.prepare("UPDATE branches SET is_active=0,is_default=0,name='Old Shop',role='shop',canonical_key='shop',successor_branch_id=1 WHERE id=2"),
    db.prepare("UPDATE branches SET name='LC Store',role='warehouse',canonical_key='warehouse',is_default=1,is_active=1 WHERE id=1"),
  ])
  const H = { mf, db, tokens: {} }

  H.addUser = async (id, username, permissions, extra = {}) => {
    await db.prepare(`INSERT INTO users(id,username,name,password,role_id,permissions,is_active,organization_id,organization_group_id)
      VALUES(?,?,?,?,?,?,1,2,2)`).bind(id, username, extra.name || username, 'x', extra.role_id ?? null, JSON.stringify(permissions)).run()
    const token = 'tok-' + username + '-' + sha256(username + id).slice(0, 8)
    H.tokens[username] = token
    await db.prepare(`INSERT INTO user_sessions(user_id,token_hash,device_name,device_tz,expires_at,last_seen_at)
      VALUES(?,?,?,?,'2099-01-01T00:00:00.000Z',datetime('now'))`).bind(id, sha256(token), 'Test Device', 'Asia/Phnom_Penh').run()
  }
  const adminToken = 'tok-admin-' + sha256('admin1').slice(0, 8)
  H.tokens.admin = adminToken
  await db.prepare(`INSERT INTO user_sessions(user_id,token_hash,device_name,device_tz,expires_at,last_seen_at)
    VALUES(1,?,?,?,'2099-01-01T00:00:00.000Z',datetime('now'))`).bind(sha256(adminToken), 'Owner Laptop', 'Asia/Phnom_Penh').run()

  H.api = async (method, route, body, { as = 'admin', headers = {} } = {}) => {
    const response = await mf.dispatchFetch('http://localhost' + route, {
      method, headers: { 'content-type': 'application/json', cookie: 'bos_session=' + H.tokens[as], ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    let json; try { json = JSON.parse(text) } catch { json = text }
    return { status: response.status, body: json, d1: Number(response.headers.get('x-al-d1') || 0), respondedAt: Number(response.headers.get('x-rt-responded-at') || 0) }
  }
  H.control = async (route, body) => (await mf.dispatchFetch('http://localhost/__al/' + route, { method: 'POST', body: JSON.stringify(body || {}) })).json()
  H.controlGet = async route => (await mf.dispatchFetch('http://localhost/__al/' + route)).json()
  H.q = async (sql, ...bind) => (await db.prepare(sql).bind(...bind).all()).results
  H.q1 = async (sql, ...bind) => (await db.prepare(sql).bind(...bind).first())
  H.setting = async (key, value) => {
    if (value === null) await db.prepare('DELETE FROM settings WHERE key = ?').bind(key).run()
    else await db.prepare("INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key, value).run()
  }
  // The Telegram fake.
  H.tg = {
    reset: () => H.control('tg/reset'),
    script: steps => H.control('tg/script', { steps }),
    calls: () => H.controlGet('tg/calls'),
    texts: async () => (await H.controlGet('tg/calls')).map(call => call.body && call.body.text),
  }
  H.hook = (pattern, sql) => H.control('hook', { pattern, sql })
  H.hookFired = async () => (await H.controlGet('hook/fired')).fired
  H.lastLog = () => H.controlGet('lastlog')
  H.dispose = async () => { await mf.dispose() }
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
  if (OPTIONS.only && !OPTIONS.only.split(',').includes(id)) return
  const c = caseRun(id, title, severity)
  try { await fn(c.t) } catch (error) { c.misses.push('THREW ' + (error && error.stack ? error.stack.split('\n').slice(0, 4).join(' | ') : String(error))) }
  const red = c.misses.length > 0
  results.push({ id, title, severity, red, misses: c.misses, notes: c.notes })
  console.log((red ? 'RED   ' : 'GREEN ') + id + '  [' + severity + ']  ' + title)
  for (const m of c.misses) console.log('        - ' + m)
  for (const n of c.notes) console.log('        . ' + n)
}
function finish(subject) {
  const red = results.filter(r => r.red)
  console.log('\nSUMMARY ' + subject + ': ' + (results.length - red.length) + ' GREEN, ' + red.length + ' RED' + (red.length ? ' -> ' + red.map(r => r.id).join(', ') : ''))
  if (red.length) process.exitCode = 1
}


// ------------------------------------------------------------------------------------------------
// Mutants: plausible WRONG implementations. Each must turn at least one case RED.
// ------------------------------------------------------------------------------------------------
const APPLY = 'src/lib/reviewApply.ts'
const PENDING = 'src/lib/pendingActions.ts'
const QUEUE = 'src/routes/reviewQueue.ts'
const PATCHES = {
  'no-confirm-check': [
    { name: 'no-confirm-check', file: APPLY, from: '  if (reviewer.confirmMergeInto !== twin.id) {\n', to: '  if (false) {\n' },
  ],
  'no-merge-permission': [
    { name: 'no-merge-permission', file: APPLY, from: "  if (!reviewerUser || getActionTier(reviewerUser, 'products', 'merge_duplicates') !== 'full') {", to: '  if (!reviewerUser) {' },
  ],
  'mark-outside-batch': [
    { name: 'mark-outside-batch', file: APPLY, from: '        additionalStatements: pendingActionApprovalStatements(row, { reviewedBy: reviewer.id, reviewedByName: reviewer.name }),\n', to: '' },
    { name: 'mark-outside-batch-flag', file: APPLY, from: "  return { pendingActionMarkedAtomically: true, restUnapplied:", to: "  return { pendingActionMarkedAtomically: false, restUnapplied:" },
  ],
  'no-audit-context': [
    { name: 'no-audit-context', file: APPLY, from: "          source: 'review_identity_fold',\n          pending_action_id: row.id,", to: "          source: 'review_identity_fold',\n          pending_action_id: null," },
  ],
  'dedupe-off': [
    { name: 'dedupe-off', file: PENDING, from: "  return trimmed && trimmed.length <= 200 ? trimmed : null\n", to: '  return null\n' },
  ],
  'alert-on-replay': [
    { name: 'alert-on-replay', file: 'src/lib/reviewGate.ts', from: '  if (!created) return pendingId\n', to: '' },
  ],
  'fields-first-value': [
    { name: 'fields-first-value', file: QUEUE, from: "  return values.length === 1 && values[0] === 'targets' ? 'targets' : 'invalid'", to: "  return values[0] === 'targets' ? 'targets' : values[0] === '' ? undefined : 'invalid'" },
  ],
}
const WRONG = OPTIONS.wrong || ''
if (WRONG && !PATCHES[WRONG]) { console.error('unknown --wrong=' + WRONG + '; known: ' + Object.keys(PATCHES).join(', ')); process.exit(2) }

const FULL_REVIEWER = { review: true, products: true, fees: true, branches: true, inventory: true }
let seq = 0
async function pair(H) {
  const n = ++seq
  const nameX = 'RQ Rename ' + n, nameY = 'RQ Target ' + n
  const barX = '88511' + String(2 * n).padStart(8, '0'), barY = '88511' + String(2 * n + 1).padStart(8, '0')
  const old = '2026-01-01 00:00:00'
  const ins = (name, bar) => H.db.prepare('INSERT INTO products(name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active,image_path,created_at,updated_at) VALUES(?,?,2,0,0,1,NULL,?,?)').bind(name, bar, old, old)
  const [rx, ry] = await executeRawStockTransaction(H.db, [ins(nameX, barX), ins(nameY, barY)])
  return { x: rx.meta.last_row_id, y: ry.meta.last_row_id, nameX, nameY, barX, barY }
}
const product = (H, id) => H.q1('SELECT id,name,barcode,is_active,updated_at FROM products WHERE id = ?', id)
const pendingOf = (H, id) => H.q1('SELECT * FROM pending_actions WHERE id = ?', id)
const count = async (H, sql, ...bind) => (await H.q1(sql, ...bind)).n
const mergeAudits = H => count(H, "SELECT COUNT(*) n FROM audit_logs WHERE action = 'merge_duplicate'")
const mergeHistory = H => H.q("SELECT id,status,undo_payload FROM action_history WHERE entity = 'product' ORDER BY id")

async function main() {
  const H = await world({ patches: WRONG ? PATCHES[WRONG] : [] })
  try {
    await H.addUser(21, 'sokha', { products: 'review', fees: 'review' }, { name: 'Sok Requester' })
    await H.addUser(27, 'sokha2', { products: 'review', fees: 'review' }, { name: 'Sok Second' })
    await H.addUser(22, 'dara', FULL_REVIEWER, { name: 'Dara Reviewer' })
    await H.addUser(23, 'nomerge', { ...FULL_REVIEWER, 'products:merge_duplicates': false }, { name: 'No Merge Reviewer' })
    await H.addUser(24, 'noimage', { ...FULL_REVIEWER, 'products:image': false }, { name: 'No Image Reviewer' })
    await H.setting('telegram_chat_id', CHAT)
    await H.setting('telegram_topic_alerts', String(TOPIC))
    await H.tg.reset()

    const queueRename = async (s, as = 'sokha', extra = {}) => {
      const r = await H.api('PUT', '/api/products/' + s.x, { name: s.nameY, barcode: s.barY, ...extra }, { as })
      return { ...r, pendingId: r.body && r.body.pendingActionId }
    }
    const approve = (pendingId, body, as = 'dara') => H.api('POST', '/api/review/' + pendingId + '/approve', body, { as })

    await check('M1', 'REVQ-A: approving a queued rename with confirm_merge_into merges the product (survivor kept, source retired, request approved, one audit row with before/after, one undoable history row, one Merged alert)', 'high', async t => {
      const s = await pair(H)
      const queued = await queueRename(s, 'sokha', { description: 'queued note', selling_price_usd: 9 })
      t.eq('the rename is queued (202)', queued.status, 202)
      await H.tg.reset()
      const r = await approve(queued.pendingId, { confirm_merge_into: s.y })
      t.eq('approval status', r.status, 200)
      t.eq('the answer names the kept product', r.body && r.body.merged_into, { id: s.y, name: s.nameY })
      t.eq('and the changes it did not apply', r.body && [...r.body.rest_unapplied].sort(), ['description', 'selling_price_usd'])
      const x = await product(H, s.x), y = await product(H, s.y)
      t.eq('the kept product did not take the queued price or note', await H.q1('SELECT selling_price_usd p, description d FROM products WHERE id = ?', s.y), { p: 0, d: null })
      t.eq('the survivor stays active with its own identity', [y.is_active, y.name, y.barcode], [1, s.nameY, s.barY])
      t.eq('the renamed product is retired into it', x.is_active, 0)
      const p = await pendingOf(H, queued.pendingId)
      t.eq('request approved by the approver', [p.status, p.reviewed_by], ['approved', 22])
      const audit = await H.q1("SELECT user_id, details FROM audit_logs WHERE action = 'merge_duplicate' AND entity_id = ?", String(s.x))
      t.ok('one merge audit row exists', Boolean(audit))
      const details = audit ? JSON.parse(audit.details) : {}
      t.eq('the merge audit row is the approver\'s', audit && audit.user_id, 22)
      t.eq('it names the request and the requester', [details.pending_action_id, details.requested_by], [queued.pendingId, 21])
      t.eq('it records the rename before and after', details.rename, { before: { name: s.nameX, barcode: s.barX }, after: { name: s.nameY, barcode: s.barY } })
      t.eq('the audit row lists the unapplied fields', [...(details.not_applied_fields || [])].sort(), ['description', 'selling_price_usd'])
      t.eq('exactly one merge audit row', await mergeAudits(H), 1)
      const history = await mergeHistory(H)
      t.eq('one undoable history row', history.map(h => h.status), ['undoable'])
      t.ok('with a real undo payload', history[0] && Object.keys(JSON.parse(history[0].undo_payload || '{}')).length > 0, history[0] && history[0].undo_payload)
      const texts = await H.tg.texts()
      t.eq('exactly one alert (the decision)', texts.length, 1)
      t.ok('it carries the Merged row naming both products', /Merged\/[^\n]*: RQ Rename \d+ → RQ Target \d+/.test(String(texts[0])), texts[0])
    })

    await check('M2', 'REVQ-A: without a confirmed survivor approval is refused 409 review_merge_confirm_required with the preview; a different id is review_merge_target_changed; nothing is written', 'high', async t => {
      const s = await pair(H)
      await executeRawStockTransaction(H.db, [H.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,3)').bind(s.x), H.db.prepare('UPDATE products SET stock_quantity=3, selling_price_usd=4 WHERE id=?').bind(s.x), H.db.prepare('UPDATE products SET selling_price_usd=6 WHERE id=?').bind(s.y)])
      const queued = await queueRename(s)
      const auditsBefore = await mergeAudits(H)
      for (const [label, body, code] of [['no body', {}, 'review_merge_confirm_required'], ['a string that is not an id', { confirm_merge_into: 'abc' }, 'review_merge_confirm_required'],
        ['a different product', { confirm_merge_into: s.x }, 'review_merge_target_changed']]) {
        const r = await approve(queued.pendingId, body)
        t.eq(label + ': 409 ' + code, [r.status, r.body && r.body.code], [409, code])
        const p = r.body && r.body.preview
        t.eq(label + ': the preview names the kept product, the stock that moves, the price after, the sessions closing', p && [p.survivorId, p.survivorName, p.stockMoved, p.priceAfter, p.sessionsClosing], [s.y, s.nameY, 3, 6, 0])
      }
      t.eq('request still open', (await pendingOf(H, queued.pendingId)).status, 'open')
      t.eq('both products untouched', [(await product(H, s.x)).name, (await product(H, s.x)).is_active, (await product(H, s.y)).is_active], [s.nameX, 1, 1])
      t.eq('no merge audit row', await mergeAudits(H), auditsBefore)
    })

    await check('M3', 'REVQ-A: the merge permission is checked against the approver (merge switched off: 403, nothing written, request open); a reviewer with it succeeds', 'high', async t => {
      const s = await pair(H)
      const queued = await queueRename(s)
      const auditsBefore = await mergeAudits(H)
      await H.tg.reset()
      const r = await approve(queued.pendingId, { confirm_merge_into: s.y }, 'nomerge')
      t.eq('refused 403 review_merge_permission_required', [r.status, r.body && r.body.code], [403, 'review_merge_permission_required'])
      t.eq('request still open', (await pendingOf(H, queued.pendingId)).status, 'open')
      t.eq('the product was not renamed or retired', [(await product(H, s.x)).name, (await product(H, s.x)).is_active], [s.nameX, 1])
      t.eq('no merge audit row', await mergeAudits(H), auditsBefore)
      t.eq('no alert for a refusal', (await H.tg.calls()).length, 0)
      const ok = await approve(queued.pendingId, { confirm_merge_into: s.y }, 'dara')
      t.eq('the same request approved by a reviewer who can merge', ok.status, 200)
    })

    await check('M4', 'REVQ-A: a second approval of the same request is refused and does not merge twice or alert twice', 'high', async t => {
      const s = await pair(H)
      const queued = await queueRename(s)
      await H.tg.reset()
      const first = await approve(queued.pendingId, { confirm_merge_into: s.y })
      const second = await approve(queued.pendingId, { confirm_merge_into: s.y })
      t.eq('first 200, second 409', [first.status, second.status], [200, 409])
      t.eq('one merge audit row for this product', await count(H, "SELECT COUNT(*) n FROM audit_logs WHERE action = 'merge_duplicate' AND entity_id = ?", String(s.x)), 1)
      t.eq('one alert', (await H.tg.calls()).length, 1)
    })

    await check('M5', 'F5: a retry with the same client_request_id returns the same queued row and sends ONE alert; different keys, other requesters and keyless requests are separate rows', 'high', async t => {
      await H.tg.reset()
      const rows = () => count(H, "SELECT COUNT(*) n FROM pending_actions WHERE section = 'products' AND action_type = 'create'")
      const base = await rows()
      const body = key => ({ name: 'RQ Idem ' + key, barcode: '88512' + String(700000 + key), selling_price_usd: 3, ...(key % 2 === 0 ? {} : {}), client_request_id: 'rq-idem-' + key })
      const a1 = await H.api('POST', '/api/products', body(1), { as: 'sokha' })
      const a2 = await H.api('POST', '/api/products', body(1), { as: 'sokha' })
      t.eq('both answers 202', [a1.status, a2.status], [202, 202])
      t.ok('the retry answers with the first row\'s id', a1.body.pendingActionId && a1.body.pendingActionId === a2.body.pendingActionId, [a1.body, a2.body])
      t.eq('one row queued', (await rows()) - base, 1)
      t.eq('one alert for the pair', (await H.tg.calls()).length, 1)
      const b = await H.api('POST', '/api/products', body(2), { as: 'sokha' })
      t.ok('another key is a new row', b.body.pendingActionId !== a1.body.pendingActionId)
      const c = await H.api('POST', '/api/products', body(1), { as: 'sokha2' })
      t.ok('the same key from another requester is a new row', c.body.pendingActionId !== a1.body.pendingActionId)
      const keyless = { name: 'RQ Keyless', barcode: '88512700999', selling_price_usd: 3 }
      const k1 = await H.api('POST', '/api/products', keyless, { as: 'sokha' })
      const k2 = await H.api('POST', '/api/products', { ...keyless, barcode: '88512700998', name: 'RQ Keyless 2' }, { as: 'sokha' })
      t.ok('requests without a key are never merged into one', k1.body.pendingActionId !== k2.body.pendingActionId)
      t.eq('alerts: one per distinct request (a, b, c, k1, k2)', (await H.tg.calls()).length, 5)
      // the retry after the first was decided still answers with the decided row (no second request appears)
      const decided = await approve(a1.body.pendingActionId, {})
      t.eq('the first was approved', decided.status, 200)
      const a3 = await H.api('POST', '/api/products', body(1), { as: 'sokha' })
      t.eq('a late retry still answers with the same row', a3.body && a3.body.pendingActionId, a1.body.pendingActionId)
    })

    await check('M6', 'F3: ?fields= answers 400 invalid_fields when empty, repeated or unknown on both lists; absent and targets are accepted', 'high', async t => {
      for (const [list, as] of [['/api/review', 'dara'], ['/api/review/mine', 'sokha']]) {
        for (const query of ['?fields=', '?fields=targets&fields=targets', '?fields=targets&fields=', '?fields=&fields=targets', '?fields=all', '?fields=Targets']) {
          const r = await H.api('GET', list + query, undefined, { as })
          t.eq(list + query + ' -> 400 invalid_fields', [r.status, r.body && r.body.code], [400, 'invalid_fields'])
        }
        for (const query of ['', '?fields=targets', '?status=all']) {
          const r = await H.api('GET', list + query, undefined, { as })
          t.eq(list + query + ' -> 200', r.status, 200)
        }
      }
    })

    await check('M7', 'REVQ-A: undo of an approved merge restores the retired product and its history row; the survivor is unchanged', 'high', async t => {
      const s = await pair(H)
      const queued = await queueRename(s)
      const approved = await approve(queued.pendingId, { confirm_merge_into: s.y })
      t.eq('approved', approved.status, 200)
      const row = (await H.q("SELECT id,status FROM action_history WHERE entity = 'product' AND entity_id = ? ORDER BY id DESC", String(s.x)))[0]
        || (await H.q("SELECT id,status FROM action_history WHERE entity = 'product' ORDER BY id DESC"))[0]
      t.ok('a history row to undo', Boolean(row), row)
      const undo = await H.api('POST', '/api/action-history/' + row.id + '/undo', { expected_generation: 0 }, { as: 'dara' })
      t.eq('undo answered 200', undo.status, 200)
      const x = await product(H, s.x), y = await product(H, s.y)
      t.eq('the retired product is active again', x.is_active, 1)
      t.eq('the survivor is still active and unchanged', [y.is_active, y.name, y.barcode], [1, s.nameY, s.barY])
      t.eq('history row now redoable', (await H.q1('SELECT status FROM action_history WHERE id = ?', row.id)).status, 'redoable')
      t.note('after undo the restored product is named "' + x.name + '" / ' + x.barcode)
    })

    await check('M9', 'REVQ-A: a request decided in the middle of its own approval (rejected just before the merge writes) merges NOTHING: the identity write is put back and the answer is 409', 'high', async t => {
      const s = await pair(H)
      const queued = await queueRename(s)
      const auditsBefore = await mergeAudits(H)
      await H.tg.reset()
      await H.hook('SET is_active = 0', "UPDATE pending_actions SET status='rejected', reject_reason='race', reviewed_by=23, reviewed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=" + queued.pendingId)
      const r = await approve(queued.pendingId, { confirm_merge_into: s.y })
      t.ok('the decision really landed in the middle', await H.hookFired())
      await H.hook(null)
      t.eq('approval answered 409', r.status, 409)
      t.eq('the request stays as the other reviewer decided it', (await pendingOf(H, queued.pendingId)).status, 'rejected')
      const x = await product(H, s.x), y = await product(H, s.y)
      t.eq('the product was not merged', x.is_active, 1)
      t.eq('and kept its own name and barcode', [x.name, x.barcode], [s.nameX, s.barX])
      t.eq('the survivor is untouched', [y.is_active, y.name], [1, s.nameY])
      t.eq('no merge audit row', await mergeAudits(H), auditsBefore)
      t.eq('no Merged alert', (await H.tg.calls()).length, 0)
    })

    await check('M8', 'REVQ-A: a request that is a plain edit (no collision) still applies without any confirmation', 'medium', async t => {
      const n = ++seq
      const [ri] = await executeRawStockTransaction(H.db, [H.db.prepare("INSERT INTO products(name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active,created_at,updated_at) VALUES(?,?,2,0,0,1,'2026-01-01 00:00:00','2026-01-01 00:00:00')").bind('RQ Plain ' + n, '88513' + String(n).padStart(8, '0'))])
      const id = ri.meta.last_row_id
      const q = await H.api('PUT', '/api/products/' + id, { name: 'RQ Plain renamed ' + n, barcode: '88513' + String(n).padStart(8, '0') }, { as: 'sokha' })
      t.eq('queued', q.status, 202)
      const r = await approve(q.body.pendingActionId, {})
      t.eq('approved with no body', r.status, 200)
      t.eq('renamed', (await product(H, id)).name, 'RQ Plain renamed ' + n)
    })
  } finally {
    await H.dispose()
  }
  finish('review queue approve-merge, idempotent queue, fields' + (WRONG ? ' [--wrong=' + WRONG + ']' : ''))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
