'use strict'
// Lane P1.2 (S4): payment-method impact preview and linked replace on the Workers Free plan's limit of 50 D1 calls per
// invocation. The sales scan read 200 rows a page (80 calls for 15.8k sales); it now reads the plan's page of three
// columns (Free 5,000, Paid 200 = today's), keyset on the unique sales.id, so a page edge can never split a sale.
//
// Runs the REAL routes/settings.ts (Hono app) against the full migrated schema in node:sqlite, every D1 call counted
// and call 51 refused. Pinned: identical impact counts for every page size with the edge on any sale, malformed
// allocations found across edges, 12,000 sales in 3 Free pages, an identical linked replace for a one-page and a
// many-page scan, and the revision guard: a sale written after the revision snapshot (between pages or just before the
// batch) refuses the replace and changes nothing. Mutants at the end must each turn a check red.
//
// P12_SRC=<dir> runs the same checks against another src tree (the base commit via git archive): proof of red.
const assert = require('node:assert/strict')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { RUNAWAY, makeLoader, countingDb, plain, runSuite } = require('./harness/free_call_budget.cjs')

const PASSWORD = 'test-password'
const USER = { id: 91, username: 'payments', name: 'Payment Admin', permissions: JSON.stringify({ settings: true, sales_policy: true }) }

const tests = []
const check = (name, fn) => tests.push({ name, fn })

// ---------------------------------------------------------------------------------------------------------------
// B. payment-method impact / replace
// ---------------------------------------------------------------------------------------------------------------
function paymentWorld() {
  const raw = openDb(loadAll())
  const counter = countingDb(raw)
  const env = { DB: counter.db, PLAN_TIER: 'free' }
  let load
  const overrides = {
    '../lib/db': { getDb: (e) => e.DB },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', USER); return next() } },
    '../lib/audit': { requestDeviceColumnSql: (actor, column, fallback) => `CASE WHEN @req_dev_user_id IS NOT NULL AND @req_dev_user_id = ${actor} THEN @req_dev_${column === 'device_name' ? 'name' : 'tz'} ELSE ${fallback} END`, requestDeviceParams: () => ({ req_dev_user_id: null, req_dev_name: null, req_dev_tz: null }), changedFields: () => null, auditChangeColumns: () => ({ old_value: null, new_value: null }), isSecretShapedAuditKey: () => false, audit: async () => {} },
    '../lib/permissions': { hasPermission: () => true, getPermissionTier: () => 'full', isAdminControlUser: () => false },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    '../lib/cache': { bumpVersion: async () => {}, bumpVersions: async () => {} },
    '../lib/destructiveStepUp': { denyUnlessCurrentPassword: async (c, body, status) => (body.currentPassword === PASSWORD ? null : c.json({ code: 'current_password_required' }, status)) },
    // Any page size, so a page edge can be put anywhere; null falls through to the real tier table.
    '../lib/planTier': { getPlanLimits: (e) => (pageSize.value ? { paymentMethodScanPageSize: pageSize.value } : load('lib/planTier.ts').getPlanLimits(e)) },
  }
  const pageSize = { value: null }
  load = makeLoader(overrides)
  const app = load('routes/settings.ts').default
  const planTier = load('lib/planTier.ts')
  const ctx = { waitUntil(p) { p?.catch?.(() => {}) }, passThroughOnException() {} }
  const request = async (route, method = 'GET', body) => {
    if (route === '/payment-methods/replace' && body && body.scope === 'linked' && body.currentPassword === undefined) body = { ...body, currentPassword: PASSWORD }
    counter.state.calls = 0
    const response = await app.request(route, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env, ctx)
    const text = await response.text()
    let parsed = null
    try { parsed = JSON.parse(text) } catch { /* a refused invocation answers a plain 500 */ }
    return { status: response.status, body: parsed, text }
  }
  const run = (sql, params = {}) => raw.prepare(sql).run(params)
  const rows = (sql, ...bind) => plain(raw.db.prepare(sql).all(...bind))
  const exec = (sql) => raw.db.exec(sql)
  const useTier = (tier) => { env.PLAN_TIER = tier; planTier.__resetPlanTierCacheForTests() }
  const salePages = () => counter.state.statements.filter((sql) => /FROM sales\s+WHERE id>@afterId/.test(sql)).length
  run("DELETE FROM settings WHERE key='pos_payment_methods'")
  run("INSERT INTO settings(key,value,updated_at) VALUES('pos_payment_methods',@v,'2026-11-01T00:00:00.000Z')", { v: JSON.stringify(['Cash', 'ABA', 'Wing']) })
  return { raw, counter, env, request, run, rows, exec, useTier, pageSize, salePages }
}

// 60 sales with gaps in their ids: plain, ABA, split 'Cash + ABA', other spellings of the same method, and (optionally)
// malformed allocations that name it.
function seedSales(world, { malformed }) {
  const insert = (id, method, details) => world.run(`INSERT INTO sales(id,receipt_number,cashier_name,payment_method,payment_details,search_normalized,updated_at)
    VALUES(@id,@r,'Cashier',@m,@d,@s,'2026-11-01T00:00:00.000Z')`, { id, r: `R-${id}`, m: method, d: details, s: `r ${id} ${String(method).toLowerCase()}` })
  const D = (...methods) => JSON.stringify(methods.map((m) => ({ method: m, amount_usd: 2, amount_khr: 0 })))
  for (let k = 1; k <= 60; k += 1) {
    const id = 100 + k * 3
    if (k % 5 === 0) insert(id, 'ABA', D('ABA'))
    else if (k % 7 === 0) insert(id, 'Cash + ABA', D('Cash', 'ABA'))
    else if (k % 11 === 0) insert(id, 'Aba', D('Aba'))
    else if (k === 13 && malformed) insert(id, 'Cash', '7')
    else if (k === 17 && malformed) insert(id, 'Cash', '[{"method":"ABA"},7]')
    else insert(id, 'Cash', D('Cash'))
  }
}

// Independent of the route: the counts a person would get by reading the clean data set.
const expectedClean = (world) => {
  let sales = 0, details = 0, summary = 0, split = 0
  for (const row of world.rows('SELECT payment_method,payment_details FROM sales ORDER BY id')) {
    const tokens = String(row.payment_method).split('+').map((t) => t.trim().toLowerCase()).filter(Boolean)
    const hits = tokens.filter((t) => t === 'aba').length
    const lines = JSON.parse(row.payment_details).filter((d) => String(d.method).trim().toLowerCase() === 'aba').length
    if (!hits && !lines) continue
    sales += 1; details += lines; summary += hits
    if (hits && tokens.length > 1) split += 1
  }
  return { sales, payment_detail_lines: details, summary_matches: summary, split_summary_sales: split, malformed_sales: 0 }
}

check('B1 impact counts are exact and identical for every page size, with the page edge on any sale', async () => {
  const w = paymentWorld(); seedSales(w, { malformed: false })
  w.counter.state.limit = RUNAWAY
  const expected = expectedClean(w)
  assert.ok(expected.sales >= 20 && expected.split_summary_sales >= 2, 'the fixture must contain every kind of row')
  let reference = null
  for (const size of [1, 2, 3, 7, 13, 59, 60, 61, 200, null]) {
    w.pageSize.value = size
    const r = await w.request('/payment-methods/impact?from=ABA&to=Wing')
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.deepEqual(r.body.live_snapshots, expected, `page size ${size}`)
    reference = reference || r.body
    assert.deepEqual(r.body, reference, `page size ${size} must answer byte-for-byte what every other page size answers`)
  }
})

check('B2 malformed allocations that name the method are found wherever the page edge falls', async () => {
  const w = paymentWorld(); seedSales(w, { malformed: true }); w.counter.state.limit = RUNAWAY
  for (const size of [1, 2, 5, 200]) {
    w.pageSize.value = size
    const r = await w.request('/payment-methods/impact?from=ABA&to=Wing')
    assert.equal(r.status, 200)
    assert.equal(r.body.live_snapshots.malformed_sales, 1, `page size ${size}`)
    assert.deepEqual(r.body.malformed_sale_ids, [100 + 17 * 3])
  }
})

check('B3 the scan is one call per page, and the page comes from the plan tier (Free 5,000, Paid 200)', async () => {
  const w = paymentWorld()
  w.exec(`WITH RECURSIVE n(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM n WHERE k<12000)
    INSERT INTO sales(id,receipt_number,payment_method,payment_details,search_normalized,updated_at)
    SELECT 200000+k,'B'||k,CASE WHEN k%3=0 THEN 'ABA' ELSE 'Cash' END,
      json_array(json_object('method',CASE WHEN k%3=0 THEN 'ABA' ELSE 'Cash' END,'amount_usd',1,'amount_khr',0)),'b '||k,'2026-11-01T00:00:00.000Z' FROM n`)
  w.useTier('free'); w.counter.state.statements.length = 0; w.counter.state.calls = 0
  const free = await w.request('/payment-methods/impact?from=ABA&to=Wing')
  assert.equal(free.status, 200, JSON.stringify(free.body))
  assert.equal(free.body.live_snapshots.sales, 4000)
  assert.equal(w.salePages(), 3, '12,000 sales over the 5,000-row pages: 5000 + 5000 + 2000')
  assert.ok(w.counter.state.calls <= 8, `the whole impact preview is ${w.counter.state.calls} calls`)
  const freeReplace = await (async () => { w.counter.state.calls = 0; return w.request('/payment-methods/replace', 'POST', { from: 'ABA', to: 'Wing', scope: 'linked', expected_updated_at: free.body.settings_updated_at }) })()
  assert.equal(freeReplace.status, 200, JSON.stringify(freeReplace.body))
  assert.equal(freeReplace.body.linkedSales, 4000)
  assert.ok(w.counter.state.calls <= 16, `the linked replace is ${w.counter.state.calls} calls`)
  assert.equal(w.rows("SELECT COUNT(*) n FROM sales WHERE payment_method='Wing'")[0].n, 4000)
  assert.equal(w.rows("SELECT COUNT(*) n FROM sales WHERE payment_method='ABA' OR payment_details LIKE '%\"ABA\"%'")[0].n, 0)
  // Paid keeps today's page: 60 pages, which only Paid's 1000 calls can carry.
  const paid = paymentWorld(); paid.exec(`WITH RECURSIVE n(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM n WHERE k<12000)
    INSERT INTO sales(id,receipt_number,payment_method,payment_details,search_normalized,updated_at)
    SELECT 200000+k,'B'||k,'Cash',json_array(json_object('method','Cash','amount_usd',1,'amount_khr',0)),'b '||k,'2026-11-01T00:00:00.000Z' FROM n`)
  paid.useTier('paid')
  paid.counter.state.statements.length = 0
  const refused = await paid.request('/payment-methods/impact?from=ABA&to=Wing')
  assert.equal(refused.status, 500, 'the Paid page (200) needs 60 calls: it would not fit Free, which is why the page is a plan field')
  assert.ok(paid.salePages() > 40)
})

check('B4 linked replace is identical for a one-page and a many-page scan (same sales, same text, same audit counts)', async () => {
  const snapshot = async (size) => {
    const w = paymentWorld(); seedSales(w, { malformed: false }); w.counter.state.limit = RUNAWAY
    w.pageSize.value = size
    const preview = await w.request('/payment-methods/impact?from=ABA&to=Wing')
    const r = await w.request('/payment-methods/replace', 'POST', { from: 'ABA', to: 'Wing', scope: 'linked', expected_updated_at: preview.body.settings_updated_at })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    return { methods: r.body.methods, linkedSales: r.body.linkedSales, linkedDetails: r.body.linkedDetails,
      sales: w.rows('SELECT id,payment_method,payment_details,search_normalized FROM sales ORDER BY id') }
  }
  const one = await snapshot(5000)
  assert.ok(one.linkedSales > 0)
  assert.deepEqual(await snapshot(2), one)
  assert.deepEqual(await snapshot(7), one)
  assert.equal(one.sales.filter((s) => /aba/i.test(s.payment_method) || /aba/i.test(s.payment_details)).length, 0)
})

check('B5 a sale written after the revision snapshot refuses the replace, whether it lands between scan pages or just before the batch; nothing changes', async () => {
  const attempt = async (mode) => {
    const w = paymentWorld(); seedSales(w, { malformed: false })
    w.pageSize.value = mode === 'between-pages' ? 10 : null
    const preview = await w.request('/payment-methods/impact?from=ABA&to=Wing')
    const before = w.rows('SELECT id,payment_method,payment_details FROM sales ORDER BY id')
    const settingBefore = w.rows("SELECT value FROM settings WHERE key='pos_payment_methods'")
    let fired = 0
    const edit = () => { fired += 1; w.exec("UPDATE sales SET notes='edited behind the scan' WHERE id=130") }
    if (mode === 'before-batch') w.counter.state.beforeBatch = () => { w.counter.state.beforeBatch = null; edit() }
    else {
      // The 3rd scan page is about to be read: a sale is edited behind the scan (its revision moves).
      let pages = 0
      const realPrepare = w.counter.db.prepare
      w.counter.db.prepare = (sql) => { if (/FROM sales\s+WHERE id>@afterId/.test(sql) && ++pages === 3) edit(); return realPrepare(sql) }
    }
    const r = await w.request('/payment-methods/replace', 'POST', { from: 'ABA', to: 'Wing', scope: 'linked', expected_updated_at: preview.body.settings_updated_at })
    assert.equal(fired, 1, `the concurrent edit must really happen (${mode})`)
    assert.equal(r.status, 409, `${mode}: ${r.text}`)
    assert.equal(r.body.code, 'write_conflict')
    assert.deepEqual(w.rows('SELECT id,payment_method,payment_details FROM sales ORDER BY id'), before)
    assert.deepEqual(w.rows("SELECT value FROM settings WHERE key='pos_payment_methods'"), settingBefore)
  }
  await attempt('before-batch')
  await attempt('between-pages')
})

check('B6 the variant cap and malformed refusals are unchanged', async () => {
  const w = paymentWorld(); seedSales(w, { malformed: true })
  const preview = await w.request('/payment-methods/impact?from=ABA&to=Wing')
  const r = await w.request('/payment-methods/replace', 'POST', { from: 'ABA', to: 'Wing', scope: 'linked', expected_updated_at: preview.body.settings_updated_at })
  assert.equal(r.status, 409)
  assert.equal(r.body.code, 'malformed_payment_details')
  assert.equal(r.body.malformed_sales, 1)
  const settingsOnly = await w.request('/payment-methods/replace', 'POST', { from: 'ABA', to: 'Wing', scope: 'settings_only', expected_updated_at: preview.body.settings_updated_at })
  assert.equal(settingsOnly.status, 200)
})


const MUTANTS = [
  { name: 'scan page predicate id>= (the edge sale is read twice)', file: 'routes/settings.ts', from: 'WHERE id>@afterId', to: 'WHERE id>=@afterId', world: 'payment', catches: ['B1'] },
  { name: 'scan stops after the first page', file: 'routes/settings.ts', from: '    if (rows.length < pageSize) break', to: '    break', world: 'payment', catches: ['B1', 'B3'] },
  { name: 'scan page is a literal 200 instead of the plan field', file: 'routes/settings.ts', from: 'const pageSize = getPlanLimits(env).paymentMethodScanPageSize', to: 'const pageSize = 200', world: 'payment', catches: ['B3'] },
  { name: 'revision guard removed from the replace batch', file: 'routes/settings.ts', from: "AND COALESCE((SELECT SUM(revision) FROM sale_write_revisions),0)=@expectedSaleRevisionSum\n              AND NOT EXISTS", to: 'AND NOT EXISTS', world: 'payment', catches: ['B5'] },
]



runSuite(tests, MUTANTS).catch((error) => { console.error(error); process.exit(1) })
