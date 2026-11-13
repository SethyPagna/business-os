'use strict'
// Wave 3, slice B round 2 (REVIEW-w3-shift F1, F2): the shift close counted through the REAL Worker.
//
// test-shift-close-call-ceiling-native.cjs measures the routes in a world that stubs auth, the cache, the audit trail, the read switches and the maintenance lock, so it cannot see
// the calls those make: the real admin close was 48 cold calls on Free, not 43. This file runs the real src/index.ts (real auth and session, the write gate, the read switches, the
// metrics middleware, the queue consumer and the cron) in Miniflare on a D1 with every migration applied, PLAN_TIER=free, behind a counting proxy on env.DB. Every Worker invocation
// (fetch incl. its waitUntil work, queue, scheduled) gets its own counter, and the proxy REFUSES call 51 exactly as Cloudflare does. The close runs on a cold isolate: a second
// Miniflare on the persisted D1.
//
// What this file pins (printed as it runs):
//   1. CEILING: the close is <= CEILING calls for an admin and for a cashier closing their own drawer, per-account and shop-wide, Telegram on and off, switches off (live) and with
//      the Free-target switches on; the queued report invocation is <= CEILING; no call is refused anywhere.
//   2. THE CAP: when a write lands between the figures and the commit (the digest guard aborts the batch) the close still commits and answers 200 and never reaches call 51 --
//      the recompute is skipped, not attempted into the refusal.
//   3. THE CRON (F2): a tick that carries a fallback report AND a due overview (no queue binding) sends ONE of them per invocation and never leaves the overview stuck 'sending'.
//
// REQUIRED RED: run it on the commit before round 2 (a checkout whose close was 48 calls): SHIFT_REAL_ROOT=<that cloudflare dir> node scripts/test-shift-close-real-worker-ceiling-native.cjs
// Run (from cloudflare/): node scripts/test-shift-close-real-worker-ceiling-native.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = process.env.SHIFT_REAL_ROOT ? path.resolve(process.env.SHIFT_REAL_ROOT) : path.join(__dirname, '..')
const CEILING = 45
const FREE_LIMIT = 50
const ORIGIN = 'https://admin.ceiling.example'

const entry = `import worker from './src/index.ts';
const recs = [];
const LIMIT = ${FREE_LIMIT};
function refuse(rec) { rec.refused++; throw new Error('D1_ERROR: Too many API requests by single Worker invocation.') }
function wrapStmt(stmt, rec, sql, hooks) { return new Proxy(stmt, { get(t, k) {
  if (k === '__raw') return t;
  if (k === 'bind') return (...a) => wrapStmt(t.bind(...a), rec, sql, hooks);
  if (k === 'first' || k === 'all' || k === 'run' || k === 'raw') return async (...a) => {
    rec.calls++; rec.log.push(sql.replace(/\\s+/g, ' ').slice(0, 120)); if (rec.calls > LIMIT) refuse(rec);
    const out = await t[k](...a);
    if (hooks.afterRead) await hooks.afterRead(sql, rec);
    return out };
  const v = Reflect.get(t, k); return typeof v === 'function' ? v.bind(t) : v } }) }
function counting(db, rec, hooks) { return new Proxy(db, { get(t, k) {
  if (k === 'prepare') return (sql) => wrapStmt(t.prepare(sql), rec, sql, hooks);
  if (k === 'batch') return async (s) => { rec.calls++; rec.batches++; rec.log.push('BATCH(' + s.length + ')'); if (rec.calls > LIMIT) refuse(rec); return t.batch(s.map((x) => x.__raw || x)) };
  if (k === 'exec') return async (q) => { rec.calls++; rec.log.push('EXEC'); return t.exec(q) };
  const v = Reflect.get(t, k); return typeof v === 'function' ? v.bind(t) : v } }) }
// RACE=once|always: a write lands (through the raw database, uncounted) right after the close's inputs-digest read, before the batch -- the window the digest guard exists for.
function raceHooks(env) {
  const mode = env.RACE || ''
  let fired = 0
  return { afterRead: async (sql, rec) => {
    if (!mode || rec.batches > 0 || !/^\\s*SELECT json_array\\(\\s*\\(SELECT json_array\\(COUNT\\(\\*\\)/.test(sql)) return
    if (mode === 'once' && fired >= 1) return
    fired++
    await env.DB.prepare("UPDATE sales SET updated_at = 'race-' || ? WHERE id = 1").bind(String(fired)).run()
  } }
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/__counts') { const out = JSON.stringify(recs); if (request.method === 'DELETE') recs.length = 0; return new Response(out) }
    const rec = { kind: 'fetch', path: request.method + ' ' + url.pathname, calls: 0, refused: 0, batches: 0, log: [] }; recs.push(rec);
    return worker.fetch(request, { ...env, DB: counting(env.DB, rec, raceHooks(env)) }, ctx);
  },
  async queue(batch, env, ctx) {
    const rec = { kind: 'queue', path: JSON.stringify(batch.messages.map((m) => m.body)), calls: 0, refused: 0, batches: 0, log: [] }; recs.push(rec);
    return worker.queue(batch, { ...env, DB: counting(env.DB, rec, {}) }, ctx);
  },
  async scheduled(controller, env, ctx) {
    const rec = { kind: 'scheduled', path: controller.cron, calls: 0, refused: 0, batches: 0, log: [] }; recs.push(rec);
    let done; const p = new Promise((r) => { done = r });
    const ctx2 = { waitUntil: (q) => { ctx.waitUntil(Promise.resolve(q).finally(done)) }, passThroughOnException() {} };
    await worker.scheduled(controller, { ...env, DB: counting(env.DB, rec, {}) }, ctx2);
    await p;
  },
};`

let bundleText = null
async function bundle() {
  if (bundleText) return bundleText
  const result = await build({ stdin: { resolveDir: root, loader: 'ts', contents: entry }, nodePaths: [path.join(__dirname, '..', 'node_modules'), path.join(root, 'node_modules')],
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*', 'cloudflare:workers'], logLevel: 'silent' })
  return (bundleText = result.outputFiles[0].text)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const iso = (ms) => new Date(ms).toISOString()
const sqlTime = (ms) => iso(ms).slice(0, 19).replace('T', ' ')

const telegramSent = []
const miniflareOptions = (script, persist, { queue = true, bindings = {} } = {}) => ({
  modules: true, script, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'], d1Persist: persist, kvNamespaces: ['CACHE'], cache: false,
  ...(queue ? { queueProducers: { BACKUP_QUEUE: 'business-os-backup-assets' }, queueConsumers: { 'business-os-backup-assets': { maxBatchSize: 1, maxBatchTimeout: 0 } } } : {}),
  bindings: { PLAN_TIER: 'free', BUSINESS_OS_ADMIN_URL: ORIGIN, TELEGRAM_BOT_TOKEN: 'test-token-not-real', ...bindings },
  outboundService: async (request) => {
    if (request.url.startsWith('https://api.telegram.org/')) {
      const body = await request.json().catch(() => ({}))
      telegramSent.push(String(body.text || ''))
      return Response.json({ ok: true, result: { message_id: telegramSent.length } })
    }
    return new Response('refused', { status: 503 })
  },
  log: new Log(LogLevel.ERROR),
})

/**
 * The day, built ONCE (the migration chain is the slow part): a warm Miniflare applies every migration, makes the users, opens a cashier's shift through the real Worker and
 * fills the window with every kind of money the drawer and the report carry. Its persisted D1 is the template every scenario copies.
 */
let template = null
async function world() {
  if (template) return template
  const script = await bundle()
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'ceiling-d1-'))
  const mf = new Miniflare(miniflareOptions(script, persist))
  const now = Date.now()
  const opened = now - 8 * 3600e3
  const at = (min) => sqlTime(opened + min * 60e3)
  const tokens = {}
  try {
    const raw = await mf.getD1Database('DB')
    for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
      for (const statement of split(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))) {
        if (file === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
        await raw.prepare(statement).run()
      }
    }
    const run = (sql, ...v) => raw.prepare(sql).bind(...v).run()
    const first = (sql, ...v) => raw.prepare(sql).bind(...v).first()
    await run("INSERT OR IGNORE INTO roles(code,name,permissions) VALUES('admin','admin','{\"all\":true}')")
    await run("INSERT OR IGNORE INTO roles(code,name,permissions) VALUES('probe_cashier','probe_cashier','{\"pos\":true,\"sales\":true}')")
    const adminRole = (await first("SELECT id FROM roles WHERE code='admin'")).id
    const cashRole = (await first("SELECT id FROM roles WHERE code='probe_cashier'")).id
    for (const [key, id, role, perms] of [['admin', 90, adminRole, '{"all":true}'], ['cashier', 7, cashRole, '{"pos":true,"sales":true}'], ['other', 8, cashRole, '{"pos":true,"sales":true}']]) {
      await run("INSERT INTO users(id,username,name,password,role_id,permissions,is_active) VALUES(?,?,?,'fixture',?,?,1)", id, key, key, role, perms)
      tokens[key] = 'ceiling-token-' + key
      await run('INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)', id, createHash('sha256').update(tokens[key]).digest('hex'), iso(now - 3600e3), iso(now + 86400e3), iso(now))
    }
    await run("INSERT INTO branches(id,name,role,is_default,is_active) VALUES(1,'Shop','shop',1,1)")
    const setting = (k, v) => run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, v)
    await setting('pos_payment_methods', '["Cash","ABA"]')
    await setting('telegram_chat_id', '-1001111111111')
    await setting('telegram_automation_enabled', 'true')
    await setting('business_name', 'Leang')
    const open = await mf.dispatchFetch(`${ORIGIN}/api/shifts/open`, { method: 'POST',
      headers: { cookie: `bos_session=${tokens.cashier}`, origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-device-name': 'ceiling' },
      body: JSON.stringify({ branch_id: 1, opening_float_usd: 10, opening_float_khr: 0 }) })
    const opening = await open.json()
    assert.equal(open.status, 201, `open ${JSON.stringify(opening)}`)
    const shiftId = opening.shift.id
    await sleep(1500) // the open's own report goes through the queue; let it finish, then retire it so it cannot be mistaken for the close's
    await run("UPDATE shift_sessions SET opened_at=?, business_date=date(?, '+7 hours') WHERE id=?", iso(opened), iso(opened), shiftId)
    await run("UPDATE telegram_shift_report_sends SET status='skipped'").catch(() => {})
    const sale = `INSERT INTO sales(id,receipt_number,sale_status,branch_id,branch_name,cashier_id,cashier_name,payment_method,payment_details,payment_currency,exchange_rate,amount_paid_usd,amount_paid_khr,change_usd,change_khr,total_usd,total_khr,delivery_actual_cost_usd,created_at,updated_at,payments_version)
      VALUES (?,?,'completed',1,'Shop',?,?,?,?,?,4100,?,?,0,0,?,?,?,?,'v1',?)`
    const tender = (m, u, k) => JSON.stringify([{ method: m, amount_usd: u, amount_khr: k }])
    await run(sale, 1, 'R1', 7, 'cashier', 'Cash', tender('Cash', 50, 0), 'USD', 50, 0, 50, 0, 0, at(5), 0)
    await run(sale, 2, 'R2', 7, 'cashier', 'Cash', tender('Cash', 30, 0), 'USD', 30, 0, 30, 0, 2, at(10), 0)
    await run(sale, 3, 'R3', 7, 'cashier', 'ABA', tender('ABA', 20, 0), 'USD', 20, 0, 20, 0, 0, at(15), 0)
    await run(sale, 4, 'R4', 7, 'cashier', 'Cash', tender('Cash', 0, 42500), 'KHR', 0, 42500, 10.37, 42500, 0, at(20), 0)
    await run(sale, 6, 'R6', 8, 'other', 'Cash', tender('Cash', 12, 0), 'USD', 12, 0, 12, 0, 0, at(25), 0)
    await run(sale, 5, 'R5', 7, 'cashier', 'Cash', tender('Cash', 7, 0), 'USD', 7, 0, 7, 0, 0, sqlTime(opened - 3 * 3600e3), 1)
    await run(`INSERT INTO sale_payment_events(event_id,sale_id,direction,origin,payment_method,payment_details,amount_paid_usd,exchange_rate,received_at,branch_id,cashier_id,cashier_name,created_at)
      VALUES ('ev5',5,'in','late_record','Cash',?,7,4100,?,1,7,'cashier',?)`, tender('Cash', 7, 0), at(30), at(30))
    await run(`INSERT INTO returns(id,return_number,sale_id,receipt_number,cashier_id,cashier_name,branch_id,branch_name,reason,total_refund_usd,total_refund_khr,exchange_rate,status,created_at)
      VALUES (1,'RT1',1,'R1',7,'cashier',1,'Shop','x',5,20500,4100,'completed',?)`, at(35))
    await run("INSERT INTO fees(id, created_at, fee_date, branch_id, fee_type, label, amount_usd, amount_khr, created_by) VALUES (9900, ?, date('now'), 1, 'other', 'Ice', 5, 0, 7)", at(40))
    await run("INSERT INTO fees(id, created_at, fee_date, branch_id, fee_type, label, amount_usd, amount_khr, created_by) VALUES (9901, ?, date('now'), 1, 'delivery', 'Courier', 3, 0, 7)", at(41))
    await run(`INSERT INTO inventory_movements(product_id, product_name, branch_id, branch_name, movement_type, quantity, unit_cost_usd, total_cost_usd, reason, user_id, user_name, created_at)
      VALUES (1,'Soap',1,'Shop','remove',2,3,6,'damaged',7,'cashier',?)`, at(45))
    template = { persist, tokens, shiftId }
  } finally { await mf.dispose() }
  return template
}

/**
 * One scenario: a copy of the day's D1, a COLD Miniflare on it (a fresh isolate: every cache empty), the scenario's own settings applied through the raw database before the
 * Worker has served a request, then the close. Returns the per-invocation counters, the Telegram texts and the rows.
 */
async function scenario({ name, closer = 'admin', shopWide = false, telegram = true, switches = 'off', queue = true, race = '', after = null }) {
  const { persist: templateDir, tokens, shiftId } = await world()
  const script = await bundle()
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'ceiling-run-'))
  fs.cpSync(templateDir, persist, { recursive: true })
  const mf = new Miniflare(miniflareOptions(script, persist, { queue, bindings: race ? { RACE: race } : {} }))
  telegramSent.length = 0
  try {
    const raw = await mf.getD1Database('DB')
    if (!telegram) await raw.prepare("UPDATE settings SET value = 'false' WHERE key = 'telegram_automation_enabled'").run()
    if (shopWide) {
      await raw.prepare("INSERT INTO settings(key,value) VALUES('shift_scope_mode','shop_wide') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
      await raw.prepare('UPDATE shift_sessions SET scope_mode = ? WHERE id = ?').bind('shop_wide', shiftId).run()
    }
    if (switches === 'free') {
      await raw.prepare("INSERT OR REPLACE INTO system_flags(key,value) VALUES('read_switches',?)").bind(JSON.stringify({ epoch: 1, switches: { report_atomic: 'on', report_atomic_long: 'on', expense_reads: 'on', dash_overview_5m: 'on', call_counting: 'on' } })).run()
    }
    const revision = (await raw.prepare('SELECT revision FROM shift_sessions WHERE id=?').bind(shiftId).first()).revision
    const response = await mf.dispatchFetch(`${ORIGIN}/api/shifts/${shiftId}/close`, { method: 'POST',
      headers: { cookie: 'bos_session=' + tokens[closer], origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-device-name': 'ceiling' },
      body: JSON.stringify({ client_request_id: 'ceiling-close-0000000001', expected_revision: revision, closing_counted_usd: 100, closing_counted_khr: 41000 }) })
    const text = await response.text()
    const counts = async () => JSON.parse(await (await mf.dispatchFetch(`${ORIGIN}/__counts`)).text())
    // The queue consumer runs after the close answers; wait for its invocation (when a report is expected), then let anything else settle.
    for (let i = 0; i < 40; i += 1) {
      const recs = await counts()
      if (!telegram || !queue || recs.some((r) => r.kind === 'queue')) break
      await sleep(500)
    }
    await sleep(1500)
    const recs = await counts()
    let json = null; try { json = JSON.parse(text) } catch { /* not json */ }
    const out = { name, status: response.status, json, recs, telegram: telegramSent.slice() }
    out.shift = await raw.prepare('SELECT closed_at, revision FROM shift_sessions WHERE id=?').bind(shiftId).first()
    out.stored = await raw.prepare('SELECT COUNT(*) AS n FROM shift_close_figures WHERE shift_session_id=?').bind(shiftId).first()
    out.reports = (await raw.prepare('SELECT send_key, status, dispatch FROM telegram_shift_report_sends ORDER BY created_at').all()).results
    out.overviews = (await raw.prepare('SELECT send_key, status, dispatch FROM telegram_scheduled_sends').all()).results
    if (after) await after({ mf, raw, out, counts, sleep, iso, telegramSent })
    return out
  } finally { await mf.dispose(); fs.rmSync(persist, { recursive: true, force: true }) }
}

const closeOf = (out) => out.recs.find((r) => r.kind === 'fetch' && /\/close$/.test(r.path))
const queueOf = (out) => out.recs.filter((r) => r.kind === 'queue')
let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

async function main() {
  const rows = []
  const note = (out) => { const c = closeOf(out); const q = queueOf(out); rows.push(`${out.name}: close ${c.calls} (refused ${c.refused})${q.length ? `, queued report ${q.map((r) => r.calls).join('/')}` : ''}`); return out }

  const admin = note(await scenario({ name: 'admin close, switches off (live)' }))
  const adminFree = note(await scenario({ name: 'admin close, Free-target switches on', switches: 'free' }))
  const cashier = note(await scenario({ name: 'cashier closes own drawer', closer: 'cashier' }))
  const shopWide = note(await scenario({ name: 'shop-wide, admin close', shopWide: true }))
  const noTelegram = note(await scenario({ name: 'Telegram off, admin close', telegram: false }))
  console.log(`     real Worker, cold isolate, PLAN_TIER=free, call 51 refused:\n       ${rows.join('\n       ')}`)

  await check(`CEILING: the real admin and cashier close is <= ${CEILING} D1 calls cold (per-account and shop-wide, Telegram on and off, switches off and on) and no call is refused`, () => {
    for (const out of [admin, adminFree, cashier, shopWide, noTelegram]) {
      assert.equal(out.status, 200, `${out.name}: ${out.json ? JSON.stringify(out.json).slice(0, 300) : ''}`)
      const close = closeOf(out)
      assert.ok(close.calls <= CEILING, `${out.name}: the close made ${close.calls} calls`)
      assert.equal(close.refused, 0, `${out.name}: a call was refused`)
      assert.ok(out.shift.closed_at, `${out.name}: the shift is closed`)
    }
  })
  await check('CONTROL: the admin response carries the drawer and the report figures, the cashier\'s does not, and the days differ', () => {
    for (const out of [admin, adminFree, shopWide, noTelegram]) {
      assert.ok(out.json.shift.reconciliation && out.json.shift.figures, `${out.name}: the admin response is complete`)
      assert.equal(out.json.shift.reconciliation_source, 'stored', `${out.name}: the drawer is the stored close`)
    }
    assert.equal(cashier.json.shift.figures ?? null, null, 'a cashier sees no report figures')
    assert.notEqual(JSON.stringify(admin.json.shift.figures), JSON.stringify(shopWide.json.shift.figures), 'CONTROL: shop-wide counts the other cashier too, so its figures differ')
  })
  await check(`CEILING: the queued report invocation is <= ${CEILING} calls cold, sends once, and no call is refused`, () => {
    for (const out of [admin, adminFree, cashier, shopWide]) {
      const queued = queueOf(out)
      assert.equal(queued.length, 1, `${out.name}: one queue invocation`)
      assert.ok(queued[0].calls <= CEILING && queued[0].refused === 0, `${out.name}: the report made ${queued[0].calls} calls`)
      assert.equal(out.reports.filter((r) => r.status === 'sent' && /:close$/.test(r.send_key)).length, 1, `${out.name}: one close report sent`)
      assert.ok(out.telegram.some((text) => text.length > 300), `${out.name}: the report text reached Telegram`)
    }
    assert.equal(queueOf(noTelegram).length, 0, 'Telegram off: nothing is queued')
    assert.equal(noTelegram.telegram.length, 0, 'Telegram off: nothing is sent')
  })

  // The cap: a write lands after the digest read (once, then always). The close commits either way and never reaches call 51.
  const raceOnce = note(await scenario({ name: 'admin close, one write races the figures', race: 'once' }))
  const raceAlways = note(await scenario({ name: 'admin close, writes keep racing the figures', race: 'always' }))
  console.log(`       ${rows.slice(-2).join('\n       ')}`)
  await check('THE CAP: when a write lands between the figures and the commit the close still commits (200) and never reaches call 51; the recompute is skipped when it cannot fit', () => {
    for (const out of [raceOnce, raceAlways]) {
      const close = closeOf(out)
      assert.equal(out.status, 200, `${out.name}: ${JSON.stringify(out.json).slice(0, 300)}`)
      assert.ok(out.shift.closed_at && out.json.shift.closed_at, `${out.name}: the close committed`)
      assert.equal(close.refused, 0, `${out.name}: call 51 was attempted (${close.calls} calls)`)
      assert.ok(close.calls <= FREE_LIMIT, `${out.name}: ${close.calls} calls`)
      assert.equal(out.reports.filter((r) => /:close$/.test(r.send_key)).length, 1, `${out.name}: the report is recorded once`)
    }
    // always: every attempt is aborted by the guard, so no figures were stored and the close says so instead of failing
    assert.equal(raceAlways.stored.n, 0, 'figures that could never be proven are not stored')
    assert.equal(raceOnce.stored.n, 0, 'one race on Free: the recompute does not fit the invocation, so the close commits without stored figures')
    for (const out of [raceOnce, raceAlways]) assert.equal(out.json.shift.figures_pending, true, out.name + ': the answer says the report figures are pending')
  })

  // F2: no queue binding -> the report AND the overview sit on the cron. ONE of them per invocation, the overview never stuck 'sending'.
  const cron = await scenario({ name: 'no queue binding, overview due', queue: false, after: async ({ mf, raw, out, counts, sleep: wait, iso: toIso, telegramSent: sent }) => {
    await raw.prepare('UPDATE telegram_scheduled_sends SET due_at = ?').bind(toIso(Date.now() - 1000)).run()
    await mf.dispatchFetch(`${ORIGIN}/__counts`, { method: 'DELETE' })
    const worker = await mf.getWorker()
    out.ticks = []
    for (let tick = 0; tick < 3; tick += 1) {
      await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now() })
      await wait(2500)
      const recs = (await counts()).filter((r) => r.kind === 'scheduled')
      out.ticks.push({ calls: recs[tick]?.calls, refused: recs[tick]?.refused })
      // a tick later than the first finds the earlier claim 'sending' only if it was stranded: age nothing, just record
    }
    out.telegramAfter = sent.slice()
    out.reportsAfter = (await raw.prepare('SELECT send_key, status FROM telegram_shift_report_sends').all()).results
    out.overviewsAfter = (await raw.prepare('SELECT send_key, status, last_error FROM telegram_scheduled_sends').all()).results
  } })
  console.log(`       cron ticks with a fallback report and a due overview: ${cron.ticks.map((t) => `${t.calls} calls/${t.refused} refused`).join(', ')}`)
  await check('THE CRON: a tick sends one report OR one overview, fits the invocation, and the overview is never left stuck sending', () => {
    for (const [index, tick] of cron.ticks.entries()) {
      assert.ok(tick.calls <= CEILING && tick.refused === 0, `tick ${index + 1}: ${tick.calls} calls, ${tick.refused} refused`)
    }
    assert.ok(cron.reportsAfter.some((r) => /:close$/.test(r.send_key) && r.status === 'sent'), 'the close report was delivered by the cron')
    const overview = cron.overviewsAfter[0]
    assert.equal(overview.status, 'sent', `the overview: ${JSON.stringify(overview)}`)
    assert.ok(!cron.overviewsAfter.some((r) => r.status === 'sending'), 'nothing stuck sending')
    assert.equal(cron.telegramAfter.length, 2, 'the report and the overview were each sent once')
  })

  console.log(`${passed} checks passed.`)
}
main().then(() => { if (template) fs.rmSync(template.persist, { recursive: true, force: true }) }, (error) => { console.error(error); process.exit(1) })
