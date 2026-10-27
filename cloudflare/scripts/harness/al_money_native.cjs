'use strict'
// Shared whole-Worker harness for the AL money native tests: the real
// src/index.ts bundled and served by Miniflare (workerd) with every migration
// applied, a real bcrypt login and the real session cookie, and a D1 proxy
// that counts every statement an invocation makes (waitUntil work included).
// Copied verbatim from the exported part of test-al-money-c-native.cjs
// (0a78962f0, branch claude/al-money-repro-20261012) so a lane can carry one
// AL file without carrying the others' red cases; only the repository root is
// resolved one level higher.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: splitSql } = require('wrangler')
const bcrypt = require('bcryptjs')

const root = path.resolve(__dirname, '..', '..')
const ORIGIN = 'http://127.0.0.1:4391'
const { FREE_QUERY_LIMIT, PAID_QUERY_LIMIT } = require('./plan_query_limits.cjs')

const WRAPPER = `
import worker, { SyncUploadSession, BroadcastHub } from './src/index';
import { applyHistoricalSaleImport } from './src/lib/salesImportCommit';
import { getDb } from './src/lib/db';
export { SyncUploadSession, BroadcastHub };
// Diagnostic only: the message of every rejected D1 batch, so a route's
// generic write_conflict can be traced to the statement that refused.
const d1Errors = [];
function counting(real, counter) {
  const statement = (inner) => new Proxy(inner, { get(target, key) {
    if (key === '__alInner') return target;
    if (key === 'bind') return (...values) => statement(target.bind(...values));
    if (key === 'first' || key === 'all' || key === 'run' || key === 'raw') return (...args) => { counter.calls++; counter.statements++; return target[key](...args) };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value } });
  return new Proxy(real, { get(target, key) {
    if (key === 'prepare') return (sql) => statement(target.prepare(sql));
    if (key === 'batch') return (items) => { counter.calls++; counter.statements += items.length;
      return target.batch(items.map((item) => item.__alInner || item)).catch((error) => { d1Errors.push(String(error && error.message || error)); throw error }) };
    if (key === 'exec') return (sql) => { counter.calls++; counter.statements++; return target.exec(sql) };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value } });
}
export default { ...worker, async fetch(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname === '/__fixture/import-sale' && request.method === 'POST') {
    const input = await request.json();
    try { return Response.json(await applyHistoricalSaleImport(getDb(env), input)) }
    catch (error) { return Response.json({ error: String(error && error.message || error) }, { status: 409 }) }
  }
  if (url.pathname === '/__fixture/d1-errors') return Response.json(d1Errors.splice(0));
  const counter = { calls: 0, statements: 0 };
  const pending = [];
  const context = { waitUntil(promise) { pending.push(Promise.resolve(promise).catch(() => {})) }, passThroughOnException() {} };
  const response = await worker.fetch(request, { ...env, DB: counting(env.DB, counter) }, context);
  const body = await response.arrayBuffer();
  // Background work handed to waitUntil belongs to this invocation's D1 budget too.
  for (let i = 0; i < pending.length; i++) await pending[i];
  const headers = new Headers(response.headers);
  headers.set('x-al-d1-calls', String(counter.calls));
  headers.set('x-al-d1-statements', String(counter.statements));
  return new Response(body, { status: response.status, headers });
} };
`

// returnIdFloor: return ids start above this, so a fixture's return id never
// equals one of its own sale ids. On bf7408b49 a cancelled (or line-decreased,
// or add-items-undone) sale N writes a 'return' movement with reference_id N,
// and the return-create postcondition counts movements by reference_id alone,
// so return id N could never be created (see AL-MONEY-REPRO.md, side finding
// M; test-al-money-g-native.cjs pins it with floor 0). Production return and
// sale ids live in different ranges, which the floor models.
//
// patches: [{ name, file: 'src/lib/x.ts', from, to }] rewrite SOURCE TEXT IN MEMORY
// at bundle time (a negative control's mutant). Nothing on disk changes, and an
// anchor that does not occur exactly once is a hard error, never a silent no-op.
async function startWorker({ returnIdFloor = 100000, patches = [] } = {}) {
  const applied = new Set()
  const plugins = patches.length ? [{ name: 'al-source-patches', setup(b) {
    b.onLoad({ filter: /[\\/]src[\\/].*\.ts$/ }, args => {
      const here = path.relative(root, args.path).replaceAll('\\', '/')
      const mine = patches.filter(p => p.file === here)
      if (!mine.length) return undefined
      let text = fs.readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n')
      for (const p of mine) {
        if (p.whole !== undefined) { text = p.whole.replace(/\r\n/g, '\n'); applied.add(p.name); continue }
        assert.equal(text.split(p.from).length - 1, 1, `patch anchor must occur exactly once in ${p.file}: ${p.from.slice(0, 80)}`)
        text = text.replace(p.from, () => p.to)
        applied.add(p.name)
      }
      return { contents: text, loader: 'ts' }
    })
  } }] : []
  const bundle = await build({ stdin: { contents: WRAPPER, resolveDir: root, loader: 'ts' }, bundle: true, write: false,
    platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*', 'cloudflare:*'], logLevel: 'silent', plugins })
  for (const p of patches) assert.ok(applied.has(p.name), `patch ${p.name} was not applied`)
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-01',
    compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], r2Buckets: ['ASSETS'], kvNamespaces: ['CACHE'],
    durableObjects: { BROADCAST_HUB: 'BroadcastHub', SYNC_UPLOADS: 'SyncUploadSession' },
    bindings: { PLAN_TIER: process.env.AL_PLAN_TIER || 'paid', BUSINESS_OS_LOCAL_DEV: '1', BUSINESS_OS_PUBLIC_URL: ORIGIN, BUSINESS_OS_ADMIN_URL: ORIGIN,
      BUSINESS_OS_ORGANIZATION_SLUG: 'leang-cosmetics', BUSINESS_OS_ORGANIZATION_NAME: 'AL money fixture' },
    outboundService: () => new Response('External network refused by local fixture', { status: 503 }),
    log: new Log(LogLevel.ERROR) })
  const db = await mf.getD1Database('DB')
  // Every migration file, in order, one atomic batch per file (a failed batch
  // rolls back, so the per-statement retry below starts from a clean file and
  // names the exact statement that fails).
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter(name => name.endsWith('.sql')).sort()) {
    const sqls = splitSql(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
      .filter(sql => !(file === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())))
    try { await db.batch(sqls.map(sql => db.prepare(sql))) } catch {
      for (const sql of sqls) {
        try { await db.prepare(sql).run() } catch (error) { throw new Error(`Migration ${file}: ${error.message}`) }
      }
    }
  }
  const org = (await db.prepare('SELECT id FROM organizations ORDER BY id LIMIT 1').all()).results[0]
  const hash = bcrypt.hashSync('al-money-fixture', 4)
  await db.prepare("INSERT INTO roles(id,name,code,permissions,is_system) VALUES(901,'AL admin','admin','{\"all\":true}',0)").run()
  await db.prepare("INSERT INTO users(id,username,name,password,role_id,permissions,is_active,organization_id,must_change_password) VALUES(901,'al_admin','AL Admin',?,901,'{}',1,?,0)").bind(hash, org.id).run()
  await db.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)").run()
  if (returnIdFloor > 0) await setReturnIdFloor(db, returnIdFloor)
  for (const [key, value] of [['exchange_rate', '4000'], ['change_exchange_rate', '4000'], ['pos_payment_methods', '["Cash","ABA"]']]) {
    await db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, value).run()
  }
  const metrics = []
  let cookie = null
  async function call(method, url, body, label, options = {}) {
    const sessionCookie = options.cookie === undefined ? cookie : options.cookie
    const response = await mf.dispatchFetch(ORIGIN + url, { method, headers: { 'content-type': 'application/json',
      'sec-fetch-site': 'same-origin', origin: ORIGIN, ...(sessionCookie ? { cookie: sessionCookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const text = await response.text()
    let parsed
    try { parsed = JSON.parse(text) } catch { parsed = { raw: text } }
    const timing = response.headers.get('server-timing') || ''
    const q = /q=(\d+)/.exec(timing)
    const entry = { label: label || `${method} ${url}`, status: response.status,
      calls: Number(response.headers.get('x-al-d1-calls') || 0), statements: Number(response.headers.get('x-al-d1-statements') || 0),
      serverTimingStatements: q ? Number(q[1]) : null, observe: !!options.observe }
    if (!url.startsWith('/__fixture')) metrics.push(entry)
    return { status: response.status, body: parsed, cookie: response.headers.get('set-cookie') }
  }
  const login = await call('POST', '/api/auth/login', { username: 'al_admin', password: 'al-money-fixture', organizationId: org.id }, 'login')
  if (login.status !== 200 || !login.cookie) throw new Error(`fixture admin login failed ${login.status} ${JSON.stringify(login.body)}`)
  cookie = login.cookie.split(';')[0]
  const all = async (sql, ...values) => (await db.prepare(sql).bind(...values).all()).results
  const one = async (sql, ...values) => (await all(sql, ...values))[0]
  // A second, non-admin account: role permissions as given, an approved
  // trusted device, and a real login carrying that device id.
  async function addEmployee(id, username, permissions) {
    await db.prepare("INSERT INTO roles(id,name,code,permissions,is_system) VALUES(?,?,'employee',?,0)").bind(id, `AL ${username}`, JSON.stringify(permissions)).run()
    await db.prepare("INSERT INTO users(id,username,name,password,role_id,permissions,is_active,organization_id,must_change_password) VALUES(?,?,?,?,?,'{}',1,?,0)")
      .bind(id, username, `AL ${username}`, hash, id, org.id).run()
    await db.prepare("INSERT INTO trusted_devices(user_id,device_id,device_name,status,decided_at,decided_by_user_id,decided_by_name) VALUES(?,?,'AL fixture device','approved',CURRENT_TIMESTAMP,901,'AL Admin')")
      .bind(id, `al-device-${id}`).run()
    const result = await call('POST', '/api/auth/login', { username, password: 'al-money-fixture', organizationId: org.id, deviceId: `al-device-${id}` }, `login ${username}`, { cookie: null })
    if (result.status !== 200 || !result.cookie) throw new Error(`fixture employee login failed ${result.status} ${JSON.stringify(result.body)}`)
    return result.cookie.split(';')[0]
  }
  return { mf, db, call, all, one, metrics, orgId: org.id, addEmployee,
    owner: { version: 1, actor_id: 901, organization_id: org.id, authority: ORIGIN, runtime: 'cloudflare-workers' } }
}

// POST /api/sales the way the POS does: v1 money, captured pricing quote, and
// the owner stamp. A first pricing-quote refusal is answered once with the
// server's own quote (the till's review step); anything else is returned.
async function createSale(h, { key, lines, status = 'completed', paymentDetails = null, createdAt, backdateTo, customerId, extra = {}, label, cookie }) {
  const body = { branch_id: 1, money_precision_version: 1, sale_status: status, exchange_rate: 4000, payment_currency: 'USD',
    client_request_id: key, offline_owner: h.owner, ...(createdAt ? { created_at: createdAt } : {}),
    ...(customerId ? { customer_id: customerId } : {}),
    ...(paymentDetails ? { payment_details: paymentDetails, payment_method: paymentDetails.map(detail => detail.method).join(' + '),
      amount_paid_usd: paymentDetails.reduce((sum, detail) => sum + (detail.amount_usd || 0), 0),
      amount_paid_khr: paymentDetails.reduce((sum, detail) => sum + (detail.amount_khr || 0), 0) } : { amount_paid_usd: 0, amount_paid_khr: 0 }),
    items: lines.map((line, index) => ({ product_id: line.productId, quantity: line.quantity, branch_id: 1, batch_id: line.productId + 5000,
      client_line_key: `${key}-line-${index + 1}`, pricing_source: line.manualPrice == null ? 'selling' : 'manual',
      ...(line.manualPrice == null ? {} : { selling_price_input_usd: line.manualPrice }),
      ...(line.fixedDiscount ? { manual_discount_type: 'fixed', manual_discount_value: line.fixedDiscount } : {}),
      // A caller that already knows the exact quote saves the review round trip.
      pricing_quote: line.quote || { gross_usd: 0, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 0, total_khr: 0 } })),
    ...extra }
  const options = cookie ? { cookie } : {}
  let result = await h.call('POST', '/api/sales', body, label || `POST /api/sales ${key}`, options)
  if (result.status === 409 && result.body.code === 'sale_pricing_quote_conflict') {
    const quotes = new Map(result.body.pricing_quotes.map(quote => [quote.client_line_key, quote]))
    for (const item of body.items) {
      const { client_line_key: _key, ...amounts } = quotes.get(item.client_line_key)
      item.pricing_quote = Object.fromEntries(['gross_usd', 'product_discount_usd', 'manual_discount_usd', 'total_usd', 'total_khr'].map(name => [name, amounts[name]]))
    }
    result = await h.call('POST', '/api/sales', body, label || `POST /api/sales ${key}`, options)
  }
  // POST /api/sales stamps the server clock and refuses a claim older than minutes (lib/clientTimestamp.ts), so a fixture
  // sale is put on its report day by a direct write right after the real POST. createdAt stays the raw claim for the window tests.
  if (backdateTo && result.status === 200) await h.db.prepare('UPDATE sales SET created_at=? WHERE id=?').bind(String(backdateTo).slice(0, 19).replace('T', ' '), result.body.id).run()
  return result
}

// The v1 customer return the Returns screen records: server quote, then the
// create carrying that exact quote.
async function customerReturn(h, { key, saleId, lines, label }) {
  const quote = await h.call('POST', '/api/returns/quote', { sale_id: saleId,
    items: lines.map(line => ({ sale_item_id: line.saleItemId, quantity: line.quantity })) }, `quote ${label || key}`)
  if (quote.status !== 200) return { quote, created: null }
  const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expected } = quote.body
  const created = await h.call('POST', '/api/returns', { client_request_id: key, money_precision_version: 1, sale_id: saleId,
    reason: 'AL money probe', expected_quote: expected,
    items: lines.map(line => ({ sale_item_id: line.saleItemId, product_id: line.productId, quantity: line.quantity,
      stock_action: line.stockAction || 'restock', branch_id: 1 })) }, label || `POST /api/returns ${key}`)
  return { quote, created }
}

// POST /api/sales/:id/amendments with the till's two review answers: the
// recalculated line quote and the exact header quote, each taken from the
// server's own uncommitted refusal.
async function amendSale(h, saleId, body, label, cookie) {
  const request = { money_precision_version: 1, expected_exchange_rate: 4000, ...body }
  let result
  for (let attempt = 0; attempt < 4; attempt++) {
    result = await h.call('POST', `/api/sales/${saleId}/amendments`, request, label || `amend ${saleId} ${body.kind}`, cookie ? { cookie } : {})
    if (result.status === 409 && result.body.code === 'sale_pricing_quote_conflict' && Array.isArray(result.body.pricing_quotes)) {
      const target = result.body.pricing_quotes.find(quote => quote.client_line_key === body.client_line_key) || result.body.pricing_quotes[0]
      request.pricing_quote = Object.fromEntries(['gross_usd', 'product_discount_usd', 'manual_discount_usd', 'total_usd', 'total_khr'].map(name => [name, target[name]]))
      continue
    }
    if (result.status === 409 && result.body.code === 'sale_header_quote_conflict') { request.expected_header_quote = result.body.header_quote; continue }
    break
  }
  return result
}

// POST /api/sales/:id/items (the Sales page "Add items"), with the same two
// review answers taken from the server's own uncommitted refusals.
async function addSaleItems(h, saleId, key, lines, label, cookie) {
  const request = { money_precision_version: 1, expected_exchange_rate: 4000, client_request_id: key,
    items: lines.map((line, index) => ({ product_id: line.productId, quantity: line.quantity, branch_id: 1, batch_id: line.productId + 5000,
      client_line_key: `${key}-line-${index + 1}`, pricing_source: 'selling',
      pricing_quote: { gross_usd: 0, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 0, total_khr: 0 } })) }
  let result
  for (let attempt = 0; attempt < 4; attempt++) {
    result = await h.call('POST', `/api/sales/${saleId}/items`, request, label || `add items ${saleId}`, cookie ? { cookie } : {})
    if (result.status === 409 && result.body.code === 'sale_pricing_quote_conflict' && Array.isArray(result.body.pricing_quotes)) {
      const quotes = new Map(result.body.pricing_quotes.map(quote => [quote.client_line_key, quote]))
      for (const item of request.items) {
        const amounts = quotes.get(item.client_line_key)
        if (amounts) item.pricing_quote = Object.fromEntries(['gross_usd', 'product_discount_usd', 'manual_discount_usd', 'total_usd', 'total_khr'].map(name => [name, amounts[name]]))
      }
      continue
    }
    if (result.status === 409 && result.body.code === 'sale_header_quote_conflict') { request.expected_header_quote = result.body.header_quote; continue }
    break
  }
  return result
}

async function bulkReturnStatus(h, key, id, source, target, label) {
  const row = await h.one('SELECT id,status,return_type,updated_at FROM returns WHERE id=?', id)
  return h.call('POST', '/api/returns/bulk', { client_request_id: key, field: 'status', source, target,
    items: [{ id, expected_status: String(row.status || 'completed'), expected_method: String(row.return_type || 'restock'),
      expected_updated_at: row.updated_at ?? null }] }, label || `bulk ${source}->${target} ${id}`)
}

// Server-managed Undo/Redo: the Worker replays the reversal itself, at the
// replay generation the history row last reported.
// Observation reads carry a unique query parameter so the Sales read cache
// (Cache API, 20 s TTL, keyed by URL + versions) cannot answer with an older
// state; a check that wants what the till sees omits it on purpose.
let freshCounter = 0
const fresh = url => `${url}${url.includes('?') ? '&' : '?'}al_fresh=${++freshCounter}`

const historyStep = (h, id, direction, generation, label) => h.call('POST', `/api/action-history/${id}/${direction}`,
  { require_applied: true, expected_generation: generation }, label || `${direction} ${id}`)

async function setReturnIdFloor(db, floor) {
  await db.prepare("DELETE FROM sqlite_sequence WHERE name='returns'").run()
  await db.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES('returns',?)").bind(floor).run()
}

// Soft assertions: every case is evaluated and reported with its actual
// values, so one run shows the whole counterexample rather than the first red.
function recorder(prefix) {
  const results = []
  return {
    results,
    check(name, fn) {
      try { fn(); results.push({ name, ok: true }); console.log(`PASS ${prefix} ${name}`) }
      catch (error) { results.push({ name, ok: false, error: error.message }); console.log(`FAIL ${prefix} ${name}\n     ${error.message.split('\n').join('\n     ')}`) }
    },
  }
}

// Every request is printed; the returned worst case covers the requests under
// test only -- reads a check makes just to observe state are marked observe.
function budgetLine(metrics) {
  const worst = metrics.filter(entry => !entry.observe && !entry.setup).reduce((max, entry) => entry.statements > max.statements ? entry : max, { statements: 0 })
  for (const entry of metrics) {
    console.log(`D1 ${entry.setup ? '(setup) ' : entry.observe ? '(observation) ' : ''}${entry.label}: status ${entry.status}, ${entry.calls} calls, ${entry.statements} statements` +
      ` (Server-Timing q=${entry.serverTimingStatements ?? 'n/a'}); Free ${entry.statements <= FREE_QUERY_LIMIT ? 'fits' : 'EXCEEDS'} ${FREE_QUERY_LIMIT}, Paid ${entry.statements <= PAID_QUERY_LIMIT ? 'fits' : 'EXCEEDS'} ${PAID_QUERY_LIMIT}`)
  }
  return worst
}

async function seedProduct(h, id, name, priceUsd, stock, costUsd = 1) {
  const permitCount = async () => (await h.db.prepare("SELECT COUNT(*) AS n FROM system_flags WHERE key='stock_transaction_permit'").first()).n
  assert.equal(await permitCount(), 0)
  try {
    await h.db.batch([
      h.db.prepare("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'"),
      h.db.prepare('INSERT INTO products(id,name,barcode,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active) VALUES(?,?,?,?,?,?,?,?,?,1)')
        .bind(id, name, `88500${id}`, `AL-${id}`, stock, priceUsd, priceUsd * 4000, costUsd, costUsd * 4000),
      h.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,?)').bind(id, stock),
      h.db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number) VALUES(?,?,?,?,'2026-09-01',1,1)")
        .bind(id + 5000, id, `al-batch-${id}`, `AL-${id}`),
      h.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,?)').bind(id + 5000, stock),
      h.db.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'"),
    ])
  } finally {
    assert.equal(await permitCount(), 0)
  }
}

// A legacy (money v0) sale written by the REAL sales-import writer
// (lib/salesImportCommit.ts applyHistoricalSaleImport) -- the only producer of
// new legacy-money sales on bf7408b49, since POST /api/sales is v1-only.
async function importSale(h, rowNumber, status, lines, { paidUsd, jobId = 'al-import-job', createdAt = '2026-08-20T03:00:00.000Z' } = {}) {
  const total = lines.reduce((sum, line) => sum + line.quantity * line.price, 0)
  const paid = paidUsd === undefined ? total : paidUsd
  const data = { branch_id: 1, sale_status: status, receipt_number: `OLD-${rowNumber}`, created_at: createdAt,
    payment_method: paid ? 'Cash' : '', payment_currency: 'USD', exchange_rate: 4000, subtotal_usd: total, total_usd: total,
    amount_paid_usd: paid, amount_paid_khr: 0,
    items: lines.map(line => ({ product_id: line.productId, product_name: line.name, quantity: line.quantity,
      applied_price_usd: line.price, total_usd: line.quantity * line.price, returned_quantity: line.returned || 0,
      cost_price_usd: 1, branch_id: 1 })) }
  const result = await h.call('POST', '/__fixture/import-sale', { jobId, rowNumber, data,
    nowIso: '2026-10-12T02:00:00.000Z', actor: { id: 901, username: 'al_admin', name: 'AL Admin' } })
  assert.equal(result.status, 200, `real import writer refused the fixture sale: ${JSON.stringify(result.body)}`)
  const sale = await h.one('SELECT id,sale_status,stock_skipped,money_precision_version FROM sales WHERE client_request_id=?', result.body.clientRequestId)
  const items = await h.all('SELECT id,product_id,quantity,returned_quantity FROM sale_items WHERE sale_id=? ORDER BY id', sale.id)
  return { sale, items }
}

// The Worker exactly as a commit had it, for a test's own "red on the base" run: every
// src file that differs from `commit` is bundled from that commit instead (nothing on
// disk changes). A file added since `commit` is simply not imported by the old code.
function basePatches(commit) {
  const { execFileSync } = require('node:child_process')
  const repo = path.resolve(root, '..')
  const git = (...args) => execFileSync('git', args, { cwd: repo, maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
  return git('diff', '--name-only', '--diff-filter=M', commit, '--', 'cloudflare/src').split('\n').filter(Boolean)
    .map(name => ({ name: `base:${name}`, file: name.replace(/^cloudflare\//, ''), whole: git('show', `${commit}:${name}`) }))
}

module.exports = { basePatches, startWorker, setReturnIdFloor, fresh, recorder, budgetLine, seedProduct, createSale, customerReturn, amendSale, addSaleItems, bulkReturnStatus,
  historyStep, importSale, FREE_QUERY_LIMIT, PAID_QUERY_LIMIT }
