'use strict'
// Lane 6.0.1008: the Workers Free plan allows 50 D1 calls per invocation (one db.batch = one call). This boots the
// REAL Worker (src/index.ts bundled) under Miniflare with every D1 call counted and call 51+ refused exactly as
// Cloudflare refuses it, then drives the four write paths that used to scale their calls with their size:
//   1. POST /api/branches/transfer-bulk -- 3 reads per line after the commit (stock moved, then 500 from 12 lines);
//   2. PATCH /api/sales/:id/status Cancelled -> Completed -- 1 branch_stock read per line (500 from 36 lines);
//   3. GET/POST /api/settings/payment-methods/impact|replace -- 1 call per 200 sales (500 from ~9,600 sales);
//   4. the customers bulk-delete queue job -- ~6 calls per 125-id chunk in ONE delivery (failed at ~1,000 ids).
// Each case also checks the arithmetic: both stock ledgers, replay/double-apply, the reversal, refusal wording.
// BUDGET_TEST_SRC=<dir> bundles another src tree (a base commit or a mutant) with this repo's node_modules.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const SRC = process.env.BUDGET_TEST_SRC ? path.resolve(process.env.BUDGET_TEST_SRC) : path.join(ROOT, 'src')
const ORIGIN = 'http://127.0.0.1:4391'
const LIMIT = 50
const ADMIN_PASSWORD = 'budget-admin-password-1'

const WRAPPER = `
import worker, { SyncUploadSession, BroadcastHub } from './index';
export { SyncUploadSession, BroadcastHub };
let current = null;
const queued = [];
function gate() {
  if (!current) return false;
  current.calls++;
  return current.calls > ${LIMIT};
}
const refuse = () => Promise.reject(new Error('D1_ERROR: Too many API requests by single Worker invocation.'));
function counting(real) {
  const statement = (inner) => new Proxy(inner, { get(target, key) {
    if (key === '__inner') return target;
    if (key === 'bind') return (...values) => statement(target.bind(...values));
    if (key === 'first' || key === 'all' || key === 'run' || key === 'raw') return (...args) => gate() ? refuse() : target[key](...args);
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value } });
  return new Proxy(real, { get(target, key) {
    if (key === 'prepare') return (sql) => statement(target.prepare(sql));
    if (key === 'batch') return (items) => gate() ? refuse() : target.batch(items.map((item) => item.__inner || item));
    if (key === 'exec') return (sql) => gate() ? refuse() : target.exec(sql);
    if (key === 'withSession') return (...a) => counting(target.withSession(...a));
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value } });
}
const queue = { async send(body) { queued.push(body) }, async sendBatch(messages) { for (const m of messages) queued.push(m.body) } };
let source = null, wrapped = null;
function wrap(env) {
  if (source !== env) { source = env; wrapped = { ...env, DB: counting(env.DB), IMPORT_DB: env.IMPORT_DB && counting(env.IMPORT_DB), IMPORT_QUEUE: queue } }
  return wrapped;
}
async function counted(fn) {
  const counter = { calls: 0 };
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(Promise.resolve(p).catch((e) => { counter.bgError = String(e && e.message || e) })) }, passThroughOnException() {} };
  current = counter;
  let result, error;
  try { result = await fn(ctx) } catch (e) { error = e }
  for (let i = 0; i < pending.length; i++) await pending[i];
  current = null;
  return { counter, result, error };
}
export default { ...worker, async fetch(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/__t/queued') return Response.json(queued);
  if (url.pathname === '/__t/enqueue') { queued.push(await request.json()); return Response.json({ ok: true }) }
  if (url.pathname === '/__t/deliver' || url.pathname === '/__t/deliver-twice') {
    if (!queued.length) return Response.json({ empty: true });
    const body = queued.shift();
    // deliver-twice: at-least-once delivery handing the SAME message to two consumers at the same moment; both
    // start from the same job row, so only an in-batch cursor guard keeps the chunk from applying twice.
    const copies = url.pathname === '/__t/deliver-twice' ? 2 : 1;
    const outcomes = [];
    const { counter, error } = await counted(() => Promise.all(Array.from({ length: copies }, () => {
      const outcome = { acked: false, retried: false };
      outcomes.push(outcome);
      const message = { id: 'm', timestamp: new Date(), body, attempts: 1, ack() { outcome.acked = true }, retry() { outcome.retried = true } };
      return worker.queue({ queue: 'business-os-import', messages: [message], ackAll() { outcome.acked = true }, retryAll() { outcome.retried = true } }, wrap(env));
    })));
    if (outcomes.some((o) => o.retried)) queued.push(body);
    return Response.json({ calls: counter.calls, outcome: outcomes[0], outcomes, body, error: error ? String(error) : null });
  }
  const { counter, result, error } = await counted((ctx) => worker.fetch(request, wrap(env), ctx));
  if (error) return new Response(String(error && error.stack || error), { status: 599, headers: { 'x-calls': String(counter.calls) } });
  const headers = new Headers(result.headers);
  headers.set('x-calls', String(counter.calls));
  headers.set('x-bg-error', encodeURIComponent(counter.bgError || ''));
  return new Response(await result.arrayBuffer(), { status: result.status, headers });
} };
`

const telegram = []
async function boot() {
  const { build } = require('esbuild')
  const { Miniflare, Log, LogLevel } = require('miniflare')
  const out = await build({ stdin: { contents: WRAPPER, resolveDir: SRC, loader: 'ts' }, bundle: true, write: false, platform: 'browser',
    format: 'esm', target: 'es2022', conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'],
    nodePaths: [path.join(ROOT, 'node_modules')], logLevel: 'error' })
  const mf = new Miniflare({ modules: true, script: out.outputFiles[0].text, compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB', 'IMPORT_DB'], kvNamespaces: ['CACHE'], r2Buckets: ['ASSETS'],
    durableObjects: { BROADCAST_HUB: 'BroadcastHub', SYNC_UPLOADS: 'SyncUploadSession' },
    bindings: { PLAN_TIER: 'free', BUSINESS_OS_LOCAL_DEV: '1', BUSINESS_OS_PUBLIC_URL: ORIGIN, BUSINESS_OS_ADMIN_URL: ORIGIN,
      BUSINESS_OS_ORGANIZATION_SLUG: 'leangbeauty', BUSINESS_OS_ADMIN_PASSWORD: ADMIN_PASSWORD, TELEGRAM_BOT_TOKEN: '123456:budget-token' },
    outboundService: async (request) => {
      const url = new URL(request.url)
      if (url.hostname !== 'api.telegram.org') return new Response('offline', { status: 503 })
      const body = await request.text()
      try { telegram.push(JSON.parse(body)) } catch { telegram.push({ text: body }) }
      return Response.json({ ok: true, result: { message_id: telegram.length, chat: { id: -100 } } })
    },
    log: new Log(LogLevel.NONE) })
  const db = await mf.getD1Database('DB')
  const { unstable_splitSqlQuery: split } = require('wrangler')
  for (const [binding, dir] of [[db, 'migrations'], [await mf.getD1Database('IMPORT_DB'), 'migrations-import']]) {
    const folder = path.join(ROOT, dir)
    if (!fs.existsSync(folder)) continue
    for (const name of fs.readdirSync(folder).filter((n) => n.endsWith('.sql')).sort()) {
      const sqls = split(fs.readFileSync(path.join(folder, name), 'utf8')).filter((s) => s.trim())
        .filter((sql) => !(name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())))
      try { await binding.batch(sqls.map((sql) => binding.prepare(sql))) } catch (error) { error.message = `${name}: ${error.message}`; throw error }
    }
  }
  await mf.dispatchFetch(ORIGIN + '/api/settings')
  return { mf, db }
}

let world
const all = async (sql, ...bind) => (await world.db.prepare(sql).bind(...bind).all()).results
const one = async (sql, ...bind) => (await all(sql, ...bind))[0]
const run = (sql, ...bind) => world.db.prepare(sql).bind(...bind).run()
const permitted = async (fn) => {
  await run("INSERT INTO system_flags(key,value) VALUES('stock_transaction_permit','legacy-separate-pool-v1')")
  try { await fn() } finally { await run("DELETE FROM system_flags WHERE key='stock_transaction_permit'") }
}
let cookie = ''
async function api(method, route, body) {
  const response = await world.mf.dispatchFetch(ORIGIN + route, { method,
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: ORIGIN, cookie },
    body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await response.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  return { status: response.status, calls: Number(response.headers.get('x-calls')), bgError: decodeURIComponent(response.headers.get('x-bg-error') || ''), json, text }
}
const t = async (route, init) => (await world.mf.dispatchFetch(ORIGIN + route, init)).json()

let passed = 0
const failures = []
async function check(name, fn) {
  try { await fn(); passed++; console.log(`GREEN ${name}`) } catch (error) { failures.push(name); console.log(`RED   ${name}\n      ${String(error && error.stack || error).split('\n').slice(0, 4).join('\n      ')}`) }
}

// Products 1000..1099, two branches, one lot per product holding all of its branch stock.
const P0 = 1000
const ledgers = async (ids) => {
  const list = ids.join(',')
  const key = (rows) => Object.fromEntries(rows.map((r) => [`${r.p}:${r.b}`, r.q]))
  return {
    bs: key(await all(`SELECT product_id p, branch_id b, quantity q FROM branch_stock WHERE product_id IN (${list})`)),
    lots: key(await all(`SELECT b.variant_product_id p, s.branch_id b, SUM(s.quantity) q FROM branch_batch_stock s JOIN product_batches b ON b.id=s.batch_id WHERE b.variant_product_id IN (${list}) GROUP BY 1,2`)),
    total: Object.fromEntries((await all(`SELECT id, stock_quantity q FROM products WHERE id IN (${list})`)).map((r) => [r.id, r.q])),
  }
}
const delta = (before, after, ledger, p, b) => (after[ledger][`${p}:${b}`] || 0) - (before[ledger][`${p}:${b}`] || 0)

async function main() {
  world = await boot()
  const admin = await one("SELECT id, organization_id FROM users WHERE username='admin'")
  const token = 'tok-budget-admin'
  await run("INSERT INTO user_sessions (user_id, token_hash, device_name, device_tz, expires_at, last_seen_at) VALUES (?, ?, 'Test', 'Asia/Phnom_Penh', '2099-01-01T00:00:00.000Z', datetime('now'))",
    admin.id, createHash('sha256').update(token).digest('hex'))
  cookie = `bos_session=${token}`
  await run("INSERT OR IGNORE INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1),(2,'Warehouse',1,0)")
  await run("INSERT INTO settings(key,value) VALUES('exchange_rate','4000'),('change_exchange_rate','4000'),('pos_payment_methods','[\"Cash\",\"ABA\"]'),('telegram_chat_id','-1001234'),('telegram_automation_enabled','true') ON CONFLICT(key) DO UPDATE SET value=excluded.value")
  await permitted(async () => {
    await run(`WITH RECURSIVE n(j) AS (SELECT 0 UNION ALL SELECT j+1 FROM n WHERE j<99)
      INSERT INTO products(id,name,barcode,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active)
      SELECT ${P0}+j,'Budget item '||j,'885'||printf('%010d',${P0}+j),'SKU-'||j,0,5+j%7,(5+j%7)*4000,2,8000,1 FROM n`)
    await run(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,expiry_date,unit_cost_usd)
      SELECT id+500000,id,'b-'||id,'L-'||id,'2026-09-01',1,1,'2027-06-01',2 FROM products WHERE id>=${P0}`)
    // Distinct quantities per product and branch, so a swapped column or misordered row shows in the numbers.
    await run(`INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT id,1,40+(id-${P0}) FROM products WHERE id>=${P0}`)
    await run(`INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT id,2,3+(id-${P0})%11 FROM products WHERE id>=${P0}`)
    await run('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) SELECT product_id+500000,branch_id,quantity FROM branch_stock')
    await run('UPDATE products SET stock_quantity=(SELECT SUM(quantity) FROM branch_stock WHERE product_id=products.id)')
  })

  await check('transfer-bulk 60 lines with lots: one atomic move inside 50 calls, receipt + Telegram on-hand from the batch', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => P0 + i)
    const before = await ledgers(ids)
    const rows0 = (await one('SELECT COUNT(*) n FROM stock_transfers')).n
    const body = { transfer_provenance_version: 1, fromBranchId: 1, toBranchId: 2, reason: 'budget move', client_request_id: 'budget-transfer-60',
      items: ids.map((id, i) => ({ productId: id, quantity: 1 + (i % 3), batchId: id + 500000 })) }
    telegram.length = 0
    const r = await api('POST', '/api/branches/transfer-bulk', body)
    assert.equal(r.status, 200, r.text.slice(0, 300))
    assert.ok(r.calls <= 20, `calls ${r.calls}`)
    assert.equal(r.json.transferredCount, 60)
    assert.ok(r.json.action_history_id > 0 && r.json.replayed === false, JSON.stringify(r.json).slice(0, 200))
    const after = await ledgers(ids)
    ids.forEach((id, i) => {
      const q = 1 + (i % 3)
      for (const ledger of ['bs', 'lots']) {
        assert.equal(delta(before, after, ledger, id, 1), -q, `${ledger} ${id} source`)
        assert.equal(delta(before, after, ledger, id, 2), q, `${ledger} ${id} destination`)
      }
      assert.equal(after.total[id], before.total[id], `total ${id}`)
    })
    assert.equal((await one('SELECT COUNT(*) n FROM stock_transfers')).n - rows0, 60)
    // The notice carries each line's committed on-hand at both branches and in total (first 20 lines are listed).
    const text = telegram.map((m) => String(m.text || '')).join('\n').replace(/\s+/g, ' ')
    assert.ok(/Stock transferred/.test(text), 'Telegram transfer notice sent')
    ids.slice(0, 20).forEach((id) => {
      const expect = `Shop ${after.bs[`${id}:1`]} · Warehouse ${after.bs[`${id}:2`]} · all branches ${after.total[id]}`
      assert.ok(text.includes(expect), `on-hand for ${id}: ${expect}`)
    })
    // Double-apply: the same client_request_id replays the receipt and moves nothing.
    const replay = await api('POST', '/api/branches/transfer-bulk', body)
    assert.equal(replay.status, 200)
    assert.equal(replay.json.replayed, true)
    assert.deepEqual(await ledgers(ids), after)
    // Reversal: undo replays the exact allocation back, both ledgers.
    const undo = await api('POST', `/api/action-history/${r.json.action_history_id}/undo`, { require_applied: true, expected_generation: 0 })
    assert.equal(undo.status, 200, undo.text.slice(0, 300))
    assert.ok(undo.calls <= LIMIT, `undo calls ${undo.calls}`)
    assert.deepEqual(await ledgers(ids), before)
  })

  await check('transfer-bulk 200 lines FIFO (no lot picked) stays inside 50 calls and moves both ledgers', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => P0 + i)
    const before = await ledgers(ids)
    // 100 products is the seed; 200 lines need 200 products, so the second hundred is created here.
    await permitted(async () => {
      await run(`INSERT INTO products(id,name,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active)
        SELECT id+100,'Budget extra '||id,'886'||printf('%010d',id),0,5,20000,2,8000,1 FROM products WHERE id BETWEEN ${P0} AND ${P0 + 99}`)
      await run(`INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT id,1,10 FROM products WHERE id BETWEEN ${P0 + 100} AND ${P0 + 199}`)
      await run(`UPDATE products SET stock_quantity=10 WHERE id BETWEEN ${P0 + 100} AND ${P0 + 199}`)
    })
    const extra = Array.from({ length: 100 }, (_, i) => P0 + 100 + i)
    const r = await api('POST', '/api/branches/transfer-bulk', { transfer_provenance_version: 1, fromBranchId: 1, toBranchId: 2, reason: 'budget fifo', client_request_id: 'budget-transfer-200',
      items: [...ids, ...extra].map((id) => ({ productId: id, quantity: 1 })) })
    assert.equal(r.status, 200, r.text.slice(0, 300))
    assert.ok(r.calls <= 25, `calls ${r.calls}`)
    const after = await ledgers(ids)
    for (const id of ids) for (const ledger of ['bs', 'lots']) {
      assert.equal(delta(before, after, ledger, id, 1), -1, `${ledger} ${id}`)
      assert.equal(delta(before, after, ledger, id, 2), 1, `${ledger} ${id}`)
    }
    // The extra hundred carry no lot: the untracked part moves on branch_stock alone.
    const extraAfter = await ledgers(extra)
    for (const id of extra) { assert.equal(extraAfter.bs[`${id}:1`], 9); assert.equal(extraAfter.bs[`${id}:2`], 1) }
  })

  const quoteSale = async (key, productIds) => {
    const prices = new Map((await all(`SELECT id, selling_price_usd p FROM products WHERE id IN (${productIds.join(',')})`)).map((r) => [r.id, r.p]))
    const items = productIds.map((pid, i) => { const p = prices.get(pid); return { product_id: pid, quantity: 1, branch_id: 1, batch_id: pid + 500000, client_line_key: `${key}-l${i}`, pricing_source: 'selling', pricing_quote: { gross_usd: p, product_discount_usd: 0, manual_discount_usd: 0, total_usd: p, total_khr: p * 4000 } } })
    const total = items.reduce((s, it) => s + it.pricing_quote.total_usd, 0)
    return { branch_id: 1, money_precision_version: 1, sale_status: 'completed', exchange_rate: 4000, payment_currency: 'USD', client_request_id: key,
      offline_owner: { version: 1, actor_id: admin.id, organization_id: admin.organization_id ?? null, authority: ORIGIN, runtime: 'cloudflare-workers' },
      items, payment_details: [{ method: 'Cash', amount_usd: total, amount_khr: 0 }], payment_method: 'Cash', amount_paid_usd: total, amount_paid_khr: 0 }
  }

  await check('un-cancel a 45-line sale: one stock read, refusal names the short line, no double deduction, cancel reverses', async () => {
    const ids = Array.from({ length: 45 }, (_, i) => P0 + 10 + i)
    const created = await api('POST', '/api/sales', await quoteSale('budget-sale-45', ids))
    assert.equal(created.status, 200, created.text.slice(0, 300))
    const saleId = created.json.id || created.json.sale_id || created.json.sale.id
    const sold = await ledgers(ids)
    const cancel = await api('PATCH', `/api/sales/${saleId}/status`, { sale_status: 'cancelled', client_request_id: 'budget-cancel-1', cancel_reason: 'mistake', cancel_note: 'budget' })
    assert.equal(cancel.status, 200, cancel.text.slice(0, 300))
    const cancelled = await ledgers(ids)
    for (const id of ids) assert.equal(delta(sold, cancelled, 'bs', id, 1), 1, `cancel restores ${id}`)
    // A line short of stock (not the first one) must be the one the refusal names.
    const short = ids[17]
    const shortName = (await one('SELECT name FROM products WHERE id=?', short)).name
    await permitted(async () => { await run('UPDATE branch_stock SET quantity=0 WHERE product_id=? AND branch_id=1', short) })
    const refused = await api('PATCH', `/api/sales/${saleId}/status`, { sale_status: 'completed', client_request_id: 'budget-uncancel-short', expected_exchange_rate: 4000 })
    assert.equal(refused.status, 409, refused.text.slice(0, 300))
    assert.equal(refused.json.error, `Insufficient stock for ${shortName}: requested 1, available 0`)
    await permitted(async () => { await run('UPDATE branch_stock SET quantity=? WHERE product_id=? AND branch_id=1', cancelled.bs[`${short}:1`], short) })
    const restored = await api('PATCH', `/api/sales/${saleId}/status`, { sale_status: 'completed', client_request_id: 'budget-uncancel-1', expected_exchange_rate: 4000 })
    assert.equal(restored.status, 200, restored.text.slice(0, 300))
    assert.ok(restored.calls <= 20, `calls ${restored.calls}`)
    const completed = await ledgers(ids)
    for (const id of ids) for (const ledger of ['bs', 'lots']) assert.equal(delta(cancelled, completed, ledger, id, 1), -1, `un-cancel ${ledger} ${id}`)
    // Double-apply: the same request again, and a fresh request for the status it already has, deduct nothing more.
    await api('PATCH', `/api/sales/${saleId}/status`, { sale_status: 'completed', client_request_id: 'budget-uncancel-1', expected_exchange_rate: 4000 })
    await api('PATCH', `/api/sales/${saleId}/status`, { sale_status: 'completed', client_request_id: 'budget-uncancel-2', expected_exchange_rate: 4000 })
    assert.deepEqual(await ledgers(ids), completed)
    // Reversal: cancelling again gives every unit back.
    const again = await api('PATCH', `/api/sales/${saleId}/status`, { sale_status: 'cancelled', client_request_id: 'budget-cancel-2', cancel_reason: 'mistake', cancel_note: 'budget' })
    assert.equal(again.status, 200, again.text.slice(0, 300))
    assert.deepEqual(await ledgers(ids), cancelled)
  })

  await check('payment-method impact and linked replace over 12,000 sales inside 50 calls, counts exact', async () => {
    // Ids straddle the 5,000-row page boundary; every third sale is ABA.
    await run(`WITH RECURSIVE n(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM n WHERE k<12000)
      INSERT INTO sales(id,receipt_number,cashier_id,cashier_name,branch_id,branch_name,payment_method,payment_details,exchange_rate,sale_status,created_at,updated_at,money_precision_version,total_usd,amount_paid_usd)
      SELECT 200000+k,'B'||k,${admin.id},'Admin',1,'Shop',CASE WHEN k%3=0 THEN 'ABA' ELSE 'Cash' END,
        json_array(json_object('method',CASE WHEN k%3=0 THEN 'ABA' ELSE 'Cash' END,'amount_usd',1,'amount_khr',0)),4000,'completed',datetime('now'),datetime('now'),0,1,1 FROM n`)
    const aba = (await one("SELECT COUNT(*) n FROM sales WHERE payment_method='ABA'")).n
    assert.ok(aba >= 4000)
    const impact = await api('GET', '/api/settings/payment-methods/impact?from=ABA&to=Wing')
    assert.equal(impact.status, 200, impact.text.slice(0, 300))
    assert.ok(impact.calls <= 15, `impact calls ${impact.calls}`)
    assert.equal(impact.json.live_snapshots.sales, aba)
    assert.equal(impact.json.live_snapshots.payment_detail_lines, aba)
    const replaced = await api('POST', '/api/settings/payment-methods/replace', { from: 'ABA', to: 'Wing', scope: 'linked', currentPassword: ADMIN_PASSWORD, expected_updated_at: impact.json.settings_updated_at })
    assert.equal(replaced.status, 200, replaced.text.slice(0, 300))
    assert.ok(replaced.calls <= 25, `replace calls ${replaced.calls}`)
    assert.equal(replaced.json.linkedSales, aba)
    assert.equal((await one("SELECT COUNT(*) n FROM sales WHERE payment_method='Wing'")).n, aba)
    assert.equal((await one("SELECT COUNT(*) n FROM sales WHERE payment_method='ABA' OR payment_details LIKE '%\"ABA\"%'")).n, 0)
  })

  const deliverAll = async (max = 40) => {
    const deliveries = []
    for (let i = 0; i < max; i++) {
      const d = await t('/__t/deliver')
      if (d.empty) break
      deliveries.push(d)
    }
    return deliveries
  }
  await run(`WITH RECURSIVE n(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM n WHERE k<1400)
    INSERT INTO customers(id,name,phone,phone_normalized) SELECT 10000+k,'Budget customer '||k,'0'||(20000000+k),'0'||(20000000+k) FROM n`)
  const customerAudits = async (lo, hi) => one(`SELECT COUNT(*) n, COUNT(DISTINCT entity_id) d FROM audit_logs WHERE entity='customer' AND action='delete' AND CAST(entity_id AS INTEGER) BETWEEN ${lo} AND ${hi}`)

  await check('customers bulk delete of 1,000: one bounded chunk per delivery, exact audit, redelivery is a no-op', async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => 10001 + i)
    const created = await api('POST', '/api/customers/bulk-delete-jobs', { reason: 'budget', ids })
    assert.equal(created.status, 202, created.text.slice(0, 300))
    const first = await t('/__t/queued')
    // At-least-once delivery: the first message reaches two consumers at once. Both read cursor 0; the batch's
    // cursor guard lets exactly one apply the chunk (no second delete, no duplicate audit rows).
    const raced = await t('/__t/deliver-twice')
    assert.deepEqual(raced.outcomes, [{ acked: true, retried: false }, { acked: true, retried: false }], JSON.stringify(raced).slice(0, 300))
    assert.equal((await one('SELECT processed_count FROM bulk_delete_jobs WHERE id=?', created.json.jobId)).processed_count, 125)
    assert.deepEqual(await customerAudits(10001, 11000), { n: 125, d: 125 })
    const deliveries = await deliverAll()
    assert.ok(deliveries.length >= 7, `deliveries ${deliveries.length}`)
    for (const d of deliveries) {
      assert.equal(d.outcome.acked, true, JSON.stringify(d).slice(0, 300))
      assert.ok(d.calls <= 10, `delivery calls ${d.calls}`)
    }
    const job = await one('SELECT status, processed_count, failed_count FROM bulk_delete_jobs WHERE id=?', created.json.jobId)
    assert.deepEqual(job, { status: 'completed', processed_count: 1000, failed_count: 0 })
    assert.equal((await one('SELECT COUNT(*) n FROM customers WHERE id BETWEEN 10001 AND 11000')).n, 0)
    assert.deepEqual(await customerAudits(10001, 11000), { n: 1000, d: 1000 })
    // Double-apply: a duplicate of the first message after completion writes nothing.
    await t('/__t/enqueue', { method: 'POST', body: JSON.stringify(first[0]) })
    await deliverAll()
    assert.deepEqual(await customerAudits(10001, 11000), { n: 1000, d: 1000 })
  })

  await check('customers bulk delete cancelled after one chunk keeps exactly that chunk and its audit', async () => {
    const ids = Array.from({ length: 400 }, (_, i) => 11001 + i)
    const created = await api('POST', '/api/customers/bulk-delete-jobs', { reason: 'budget cancel', ids })
    assert.equal(created.status, 202)
    const firstDelivery = await t('/__t/deliver')
    assert.equal(firstDelivery.outcome.acked, true)
    const progressed = await one('SELECT processed_count FROM bulk_delete_jobs WHERE id=?', created.json.jobId)
    assert.ok(progressed.processed_count > 0 && progressed.processed_count < 400, JSON.stringify(progressed))
    const cancel = await api('POST', `/api/customers/bulk-delete-jobs/${created.json.jobId}/cancel`)
    assert.equal(cancel.status, 200)
    await deliverAll()
    const job = await one('SELECT status, processed_count FROM bulk_delete_jobs WHERE id=?', created.json.jobId)
    assert.equal(job.status, 'cancelled')
    assert.equal(job.processed_count, progressed.processed_count)
    const deleted = 400 - (await one('SELECT COUNT(*) n FROM customers WHERE id BETWEEN 11001 AND 11400')).n
    assert.equal(deleted, progressed.processed_count)
    assert.deepEqual(await customerAudits(11001, 11400), { n: deleted, d: deleted })
  })

  await world.mf.dispose()
  console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? ': ' + failures.join('; ') : ''}`)
  if (failures.length) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exit(1) })
