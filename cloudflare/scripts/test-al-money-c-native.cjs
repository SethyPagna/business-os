'use strict'
// AL-C (Requirement gap C, brief 2026-10-12 section 5): imported returned-
// quantity entitlement, reproduced against the WHOLE Worker on workerd + D1.
//
// An imported sale of 3 units whose source row says 2 already came back
// (sale_items.returned_quantity = 2, written by the real
// lib/salesImportCommit.ts applyHistoricalSaleImport) has exactly ONE unit
// left that a customer can still return. A further return of 2 must be
// refused -- addressed by sale line (by-item), addressed by product only
// (by-product), by editing an accepted return upward, and at the final write
// boundary: whatever path is taken, the line may never end with more than 3
// units counted as returned. (The in-batch precondition has no capacity
// predicate of its own on bf7408b49, so the final-boundary probe observes the
// end state after the last unit is returned and one more is attempted.)
//
// Harness (exported below and shared by every test-al-money-*-native.cjs):
// the real src/index.ts is bundled and served by Miniflare with every
// migration applied, a real bcrypt login and the real session cookie. The
// ONLY non-production surfaces are fixture routes outside /api -- one calls
// the real applyHistoricalSaleImport (the sales-import writer the queue
// calls), one returns the messages of rejected D1 batches for diagnosis --
// and a D1 proxy that counts every query an invocation makes, waitUntil work
// included (prepare().run/all/first/raw = 1 call, batch(n) = 1 call and n
// statements), which also sees raw env.DB use the Server-Timing header cannot.
//
// This file asserts the OWNER-CORRECT outcome. On bf7408b49 it is expected to
// be RED; a red case here is the reproduction, not a broken test. Set
// AL_MUTATION=1 for the negative control applied right after the fixture in
// main(): with returned_quantity cleared, every probe must be ACCEPTED.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: splitSql } = require('wrangler')
const bcrypt = require('bcryptjs')

const root = path.resolve(__dirname, '..')
const ORIGIN = 'http://127.0.0.1:4391'
const FREE_QUERY_LIMIT = 50
const PAID_QUERY_LIMIT = 1000

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
async function startWorker({ returnIdFloor = 100000 } = {}) {
  const bundle = await build({ stdin: { contents: WRAPPER, resolveDir: root, loader: 'ts' }, bundle: true, write: false,
    platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*', 'cloudflare:*'], logLevel: 'silent' })
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
async function createSale(h, { key, lines, status = 'completed', paymentDetails = null, createdAt, customerId, extra = {}, label }) {
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
  let result = await h.call('POST', '/api/sales', body, label || `POST /api/sales ${key}`)
  if (result.status === 409 && result.body.code === 'sale_pricing_quote_conflict') {
    const quotes = new Map(result.body.pricing_quotes.map(quote => [quote.client_line_key, quote]))
    for (const item of body.items) {
      const { client_line_key: _key, ...amounts } = quotes.get(item.client_line_key)
      item.pricing_quote = Object.fromEntries(['gross_usd', 'product_discount_usd', 'manual_discount_usd', 'total_usd', 'total_khr'].map(name => [name, amounts[name]]))
    }
    result = await h.call('POST', '/api/sales', body, label || `POST /api/sales ${key}`)
  }
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
async function amendSale(h, saleId, body, label) {
  const request = { money_precision_version: 1, expected_exchange_rate: 4000, ...body }
  let result
  for (let attempt = 0; attempt < 4; attempt++) {
    result = await h.call('POST', `/api/sales/${saleId}/amendments`, request, label || `amend ${saleId} ${body.kind}`)
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
async function addSaleItems(h, saleId, key, lines, label) {
  const request = { money_precision_version: 1, expected_exchange_rate: 4000, client_request_id: key,
    items: lines.map((line, index) => ({ product_id: line.productId, quantity: line.quantity, branch_id: 1, batch_id: line.productId + 5000,
      client_line_key: `${key}-line-${index + 1}`, pricing_source: 'selling',
      pricing_quote: { gross_usd: 0, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 0, total_khr: 0 } })) }
  let result
  for (let attempt = 0; attempt < 4; attempt++) {
    result = await h.call('POST', `/api/sales/${saleId}/items`, request, label || `add items ${saleId}`)
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

const { seedProduct } = require('./harness/al_money_native.cjs')

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
  const sale = await h.one('SELECT id,sale_status,return_state,stock_skipped,money_precision_version FROM sales WHERE client_request_id=?', result.body.clientRequestId)
  const items = await h.all('SELECT id,product_id,quantity,returned_quantity FROM sale_items WHERE sale_id=? ORDER BY id', sale.id)
  return { sale, items }
}

// The AL money files (test-al-money-*-native.cjs) share this harness; it is
// exported only, and main() below runs only when this file is executed.
module.exports = { startWorker, setReturnIdFloor, fresh, recorder, budgetLine, seedProduct, createSale, customerReturn, amendSale, addSaleItems, bulkReturnStatus,
  historyStep, importSale, FREE_QUERY_LIMIT, PAID_QUERY_LIMIT }

async function main() {
  const h = await startWorker()
  const mutation = process.env.AL_MUTATION === '1'
  // In the control run each check asserts ACCEPTANCE; the prefix says so.
  const r = recorder(mutation ? 'AL-C [control: returned_quantity=0, every probe must be accepted]' : 'AL-C')
  try {
    await seedProduct(h, 101, 'AL-C Imported Serum', 5, 20)
    await seedProduct(h, 102, 'AL-C Imported Toner', 5, 20)
    await seedProduct(h, 103, 'AL-C Final Balm', 5, 20)
    await seedProduct(h, 104, 'AL-C Edit Mask', 5, 20)
    await seedProduct(h, 105, 'AL-C Restore Oil', 5, 20)

    // Five independent imported sales, one per refusal boundary (create by
    // item, create by product, final write, edit, restore), so one accepted
    // over-return cannot mask the next probe.
    const byItem = await importSale(h, 1, 'partial_return', [{ productId: 101, name: 'AL-C Imported Serum', quantity: 3, price: 5, returned: 2 }])
    const byProduct = await importSale(h, 2, 'partial_return', [{ productId: 102, name: 'AL-C Imported Toner', quantity: 3, price: 5, returned: 2 }])
    const finalBoundary = await importSale(h, 3, 'partial_return', [{ productId: 103, name: 'AL-C Final Balm', quantity: 3, price: 5, returned: 2 }])
    const editSale = await importSale(h, 4, 'partial_return', [{ productId: 104, name: 'AL-C Edit Mask', quantity: 3, price: 5, returned: 2 }])
    const restoreSale = await importSale(h, 5, 'partial_return', [{ productId: 105, name: 'AL-C Restore Oil', quantity: 3, price: 5, returned: 2 }])
    const fixtures = [byItem, byProduct, finalBoundary, editSale, restoreSale]
    r.check('fixture: the real import writer stored quantity 3 with returned_quantity 2 on a stock-skipped legacy sale', () => {
      for (const fixture of fixtures) {
        assert.equal(fixture.items[0].quantity, 3)
        assert.equal(fixture.items[0].returned_quantity, 2)
        assert.equal(fixture.sale.stock_skipped, 1)
        // Owner, 20 Oct 2026: the CSV's partial_return is the return tag of a Completed sale.
        assert.deepEqual([fixture.sale.sale_status, fixture.sale.return_state], ['completed', 'partial'])
        assert.notEqual(fixture.sale.money_precision_version, 1, 'imported sales are legacy-money sales; the legacy return body applies')
      }
    })
    // Mutation control: pretend the import never recorded the returned units.
    // A correct implementation must then ACCEPT the return of 2 -- proving the
    // refusal below is caused by returned_quantity, not by some other guard.
    if (mutation) for (const fixture of fixtures) await h.db.prepare('UPDATE sale_items SET returned_quantity=0 WHERE sale_id=?').bind(fixture.sale.id).run()

    const legacyReturn = (fixture, key, item) => ({ client_request_id: key, sale_id: fixture.sale.id, reason: 'AL-C over-return probe',
      return_type: 'restock', items: [item] })
    // A refusal must be a business refusal with an error message: a 404/405
    // from a wrong route would otherwise "pass" by writing nothing.
    const refused = (attempt) => {
      assert.ok([400, 409, 422].includes(attempt.status), `expected a 400/409/422 business refusal, got ${attempt.status}`)
      assert.equal(typeof attempt.body.error, 'string', 'a refusal names its reason')
    }
    const stockBefore = async productId => (await h.one('SELECT stock_quantity FROM products WHERE id=?', productId)).stock_quantity
    const returnedRows = async saleId => (await h.one(`SELECT COUNT(*) n, COALESCE(SUM(ri.quantity),0) q FROM return_items ri
      JOIN returns rr ON rr.id=ri.return_id WHERE rr.sale_id=? AND COALESCE(rr.status,'completed')<>'cancelled'`, saleId))

    // 1. By item.
    const itemStock = await stockBefore(101)
    const itemAttempt = await h.call('POST', '/api/returns', legacyReturn(byItem, 'al-c-by-item', {
      sale_item_id: byItem.items[0].id, product_id: 101, quantity: 2, applied_price_usd: 5, stock_action: 'restock', branch_id: 1 }), 'C by-item return of 2')
    const itemAfter = await returnedRows(byItem.sale.id)
    r.check(`by-item: returning 2 more of a 3-unit line with 2 already returned is refused (got ${itemAttempt.status} ${JSON.stringify(itemAttempt.body).slice(0, 160)})`, () => {
      if (mutation) { assert.equal(itemAttempt.status, 200, 'control: with returned_quantity cleared the same return must be accepted'); return }
      refused(itemAttempt)
      assert.equal(itemAfter.n, 0, `no return line may be written; found ${itemAfter.n} line(s), ${itemAfter.q} unit(s)`)
    })
    const itemStockAfter = await stockBefore(101)
    r.check('by-item: the two units the import already restocked are not restocked again', () => {
      if (mutation) return
      assert.equal(itemStockAfter, itemStock, `stock moved ${itemStock} -> ${itemStockAfter}`)
    })

    // 2. By product (no sale_item_id; the sale is still named).
    const productStock = await stockBefore(102)
    const productAttempt = await h.call('POST', '/api/returns', legacyReturn(byProduct, 'al-c-by-product', {
      product_id: 102, quantity: 2, applied_price_usd: 5, stock_action: 'restock', branch_id: 1 }),
    'C by-product return of 2')
    const productAfter = await returnedRows(byProduct.sale.id)
    const productStockAfter = await stockBefore(102)
    r.check(`by-product: returning 2 more units of the product is refused (got ${productAttempt.status} ${JSON.stringify(productAttempt.body).slice(0, 160)})`, () => {
      if (mutation) { assert.equal(productAttempt.status, 200, 'control: with returned_quantity cleared the same return must be accepted'); return }
      refused(productAttempt)
      assert.equal(productAfter.n, 0, `no return line may be written; found ${productAfter.n} line(s), ${productAfter.q} unit(s)`)
      assert.equal(productStockAfter, productStock, `stock moved ${productStock} -> ${productStockAfter}`)
    })

    // 3. Final write boundary. One unit is legitimately returnable, so a return
    // of 1 must succeed; a second return of 1 must then be refused. The second
    // return is the write-guard probe: its preflight capacity read and the
    // in-batch precondition both have to count the imported quantity, or the
    // line ends with 2 (imported) + 1 + 1 = 4 returned units of a 3-unit line.
    const first = await h.call('POST', '/api/returns', legacyReturn(finalBoundary, 'al-c-final-1', {
      sale_item_id: finalBoundary.items[0].id, product_id: 103, quantity: 1, applied_price_usd: 5, stock_action: 'restock', branch_id: 1 }), 'C final-guard return of the last unit')
    const second = await h.call('POST', '/api/returns', legacyReturn(finalBoundary, 'al-c-final-2', {
      sale_item_id: finalBoundary.items[0].id, product_id: 103, quantity: 1, applied_price_usd: 5, stock_action: 'restock', branch_id: 1 }), 'C final-guard return beyond capacity')
    const finalRows = await returnedRows(finalBoundary.sale.id)
    r.check(`final boundary: the one genuinely remaining unit can still be returned (got ${first.status})`, () => {
      assert.equal(first.status, 200, JSON.stringify(first.body).slice(0, 200))
    })
    r.check(`final boundary: a return that would make 4 of 3 units returned commits nothing (second ${second.status}; ${finalRows.q} unit(s) recorded beyond the import)`, () => {
      if (mutation) { assert.equal(second.status, 200, 'control: with returned_quantity cleared a second unit is returnable'); return }
      refused(second)
      assert.equal(finalRows.q, 1, `exactly one unit may be recorded on top of the imported 2; found ${finalRows.q}`)
    })

    // 4. Edit. The one remaining unit is returned, then the return is edited
    // from 1 to 2 units: 2 imported + 2 edited = 4 of 3, so the edit must be
    // refused and the recorded return must keep its 1 unit.
    const editFirst = await h.call('POST', '/api/returns', legacyReturn(editSale, 'al-c-edit-1', {
      sale_item_id: editSale.items[0].id, product_id: 104, quantity: 1, applied_price_usd: 5, stock_action: 'restock', branch_id: 1 }), 'C edit fixture: return of the last unit')
    const editTarget = await h.one('SELECT id,updated_at FROM returns WHERE id=?', Number(editFirst.body.id))
    const editAttempt = await h.call('PATCH', `/api/returns/${editTarget.id}`, { client_request_id: 'al-c-edit-2', expected_updated_at: editTarget.updated_at,
      reason: 'AL-C over-return edit probe', return_type: 'restock', branch_id: 1,
      items: [{ sale_item_id: editSale.items[0].id, product_id: 104, quantity: 2, applied_price_usd: 5, stock_action: 'restock', branch_id: 1 }] }, 'C edit return 1 -> 2')
    const editRows = await returnedRows(editSale.sale.id)
    r.check(`edit: raising the recorded return from 1 to 2 units (4 of 3 returned) is refused (got ${editAttempt.status} ${JSON.stringify(editAttempt.body).slice(0, 160)})`, () => {
      assert.equal(editFirst.status, 200, JSON.stringify(editFirst.body).slice(0, 200))
      if (mutation) { assert.equal(editAttempt.status, 200, 'control: with returned_quantity cleared the edit is within capacity'); return }
      refused(editAttempt)
      assert.equal(editRows.q, 1, `the return must keep 1 unit; found ${editRows.q}`)
    })

    // 5. Restore. Return A (1 unit) on the last remaining unit, then try to
    // cancel it so that a later restore could over-count. RET-B E1 (owner
    // default D1, 5 Oct) refuses ANY cancel/restore of a return on a
    // stock-skipped (imported) sale with return_stock_skipped_sale, so the
    // over-capacity restore is unreachable on this sale shape. This check pins
    // that the refusal is that specific guard and that nothing changed.
    const bulk = async (key, id, source, target, label) => {
      const row = await h.one('SELECT id,status,return_type,updated_at FROM returns WHERE id=?', id)
      return h.call('POST', '/api/returns/bulk', { client_request_id: key, field: 'status', source, target,
        items: [{ id, expected_status: String(row.status || 'completed'), expected_method: String(row.return_type || 'restock'),
          expected_updated_at: row.updated_at ?? null }] }, label)
    }
    const restoreA = await h.call('POST', '/api/returns', legacyReturn(restoreSale, 'al-c-restore-a', {
      sale_item_id: restoreSale.items[0].id, product_id: 105, quantity: 1, applied_price_usd: 5, stock_action: 'restock', branch_id: 1 }), 'C restore fixture: return A')
    const cancelA = await bulk('al-c-cancel-a', Number(restoreA.body.id), 'completed', 'cancelled', 'C cancel of a return on an imported sale')
    const restoreRows = await returnedRows(restoreSale.sale.id)
    r.check(`restore: cancel/restore of a return on an imported sale is refused before any over-capacity restore can exist (cancel got ${cancelA.status} ${cancelA.body.code || ''})`, () => {
      assert.equal(restoreA.status, 200, JSON.stringify(restoreA.body).slice(0, 200))
      assert.equal(cancelA.status, 409)
      assert.equal(cancelA.body.code, 'return_stock_skipped_sale')
      assert.equal(restoreRows.q, 1)
    })

    const worst = budgetLine(h.metrics)
    r.check(`D1 budget: worst request ${worst.label} used ${worst.statements} statements (Free ${FREE_QUERY_LIMIT})`, () => {
      assert.ok(worst.statements <= FREE_QUERY_LIMIT, `exceeds the Free per-invocation limit of ${FREE_QUERY_LIMIT}`)
    })
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} AL-C imported returned-quantity entitlement: ${r.results.length - failed.length}/${r.results.length} owner-rule checks hold${mutation ? ' (AL_MUTATION=1 control run)' : ''}`)
  if (failed.length) process.exitCode = 1
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
