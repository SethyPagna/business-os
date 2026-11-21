// The Settings payment-method rename over exchange refund-credit rows, driven through the REAL settings route on the full in-memory
// schema (node + d1compat, as test-payment-method-route-sqlite.cjs does), so it needs no native lock.
//
// Rule under test: a rename is the same method under a new name.
//   - same drawer kind (cash to cash, non-cash to non-cash): the credit row is renamed with the rest; flag and amounts untouched;
//   - kind would change: the credit keeps its method, a credit-only sale is neither counted nor written, and the "methods used in sales
//     but missing from the list" check ignores credit rows, so its backfill never puts the old name back.
// Each rename mutant in the review (S1-S5) and the preview-count mutant (S4) is red here.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const PASSWORD = 'test-password'
const STAMP = '2026-11-01T08:00:00.000Z'
const USER = { id: 91, username: 'payments', name: 'Payment Admin', permissions: JSON.stringify({ settings: true, sales_policy: true }) }
const overrides = {
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', USER); return next() } },
  '../lib/audit': { requestDeviceColumnSql: (actor, column, fallback) => `CASE WHEN @req_dev_user_id IS NOT NULL AND @req_dev_user_id = ${actor} THEN @req_dev_${column === 'device_name' ? 'name' : 'tz'} ELSE ${fallback} END`, requestDeviceParams: () => ({ req_dev_user_id: null, req_dev_name: null, req_dev_tz: null }), changedFields: () => null, auditChangeColumns: () => ({ old_value: null, new_value: null }), isSecretShapedAuditKey: () => false, audit: async () => {} },
  '../lib/permissions': { hasPermission: () => true, getPermissionTier: () => 'full', isAdminControlUser: () => false },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {}, bumpVersions: async () => {} },
  '../lib/destructiveStepUp': { denyUnlessCurrentPassword: async (c, body, status) => (body.currentPassword === PASSWORD ? null : c.json({ success: false }, status)) },
}

function makeWorld() {
  const db = openDb(loadAll())
  const cache = new Map()
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel).exports
    const sourcePath = path.join(__dirname, '..', 'src', rel)
    const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: sourcePath }).outputText
    const mod = { exports: {} }
    cache.set(rel, mod)
    const localRequire = (request) => {
      if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
      if (!request.startsWith('.')) return require(request)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
      return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
    }
    new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
    return mod.exports
  }
  const app = load('routes/settings.ts').default
  const ctx = { waitUntil(p) { p?.catch?.(() => {}) }, passThroughOnException() {} }
  const world = {
    db,
    async request(pathname, method = 'GET', body) {
      const response = await app.request(pathname, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, { DB: db }, ctx)
      return { status: response.status, body: await response.json() }
    },
    run: (sql, params = {}) => db.prepare(sql).run(params),
    get: (sql, params = {}) => db.prepare(sql).get(params),
    setMethods(list, kinds) {
      world.run("DELETE FROM settings WHERE key IN ('pos_payment_methods','pos_payment_method_kinds')")
      world.run("INSERT INTO settings(key,value,updated_at) VALUES('pos_payment_methods',@value,@stamp)", { value: JSON.stringify(list), stamp: STAMP })
      if (kinds) world.run("INSERT INTO settings(key,value,updated_at) VALUES('pos_payment_method_kinds',@value,@stamp)", { value: JSON.stringify(kinds), stamp: STAMP })
    },
    seed(id, method, details) {
      world.run('INSERT INTO sales(id,receipt_number,payment_method,payment_details,search_normalized,updated_at) VALUES(@id,@r,@m,@d,@s,@stamp)',
        { id, r: `R-${id}`, m: method, d: JSON.stringify(details), s: `r ${id} ${method.toLowerCase()}`, stamp: STAMP })
    },
    sale: (id) => world.get('SELECT payment_method,payment_details,updated_at FROM sales WHERE id=@id', { id }),
    details: (id) => JSON.parse(world.sale(id).payment_details),
    rename: (from, to) => world.request('/payment-methods/replace', 'POST', { from, to, scope: 'linked', expected_updated_at: world.get("SELECT updated_at FROM settings WHERE key='pos_payment_methods'").updated_at, currentPassword: PASSWORD }),
    impact: (from, to) => world.request(`/payment-methods/impact?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  }
  return world
}

const cr = (method) => ({ method, amount_usd: 10, amount_khr: 0, refund_credit: true })
const cust = (method, usd = 10) => ({ method, amount_usd: usd, amount_khr: 0 })
const results = []
async function check(name, fn) {
  try { await fn(); results.push(`PASS ${name}`) } catch (e) { results.push(`FAIL ${name}: ${String(e && e.message).split('\n')[0].slice(0, 200)}`) }
}

;(async () => {
  // --- Kind changes (Cash -> Bank transfer): the credit keeps its method, the missing-methods check never offers it back.
  {
    const w = makeWorld()
    w.setMethods(['Cash', 'ABA'])
    w.seed(201, 'Cash', [cr('Cash'), cust('Cash')])
    w.seed(202, 'Cash + ABA', [cr('Cash'), cust('ABA')])
    w.seed(203, 'Cash', [cust('Cash', 5)])
    const before202 = w.sale(202)
    const impact = await w.impact('Cash', 'Bank')
    await check('kind change: the preview counts the two sales with a customer Cash row, not the credit-only one', () => {
      assert.equal(impact.status, 200, JSON.stringify(impact.body).slice(0, 200))
      assert.equal(impact.body.live_snapshots.sales, 2, JSON.stringify(impact.body.live_snapshots))
      assert.equal(impact.body.live_snapshots.payment_detail_lines, 2, JSON.stringify(impact.body.live_snapshots))
    })
    const renamed = await w.rename('Cash', 'Bank')
    await check('kind change: rename succeeds', () => assert.equal(renamed.status, 200, JSON.stringify(renamed.body).slice(0, 200)))
    await check('kind change: 201 credit keeps Cash, the customer row is renamed', () => assert.deepEqual(w.details(201), [cr('Cash'), cust('Bank')]))
    await check('kind change: 201 summary keeps both names', () => assert.equal(w.sale(201).payment_method, 'Cash + Bank'))
    await check('kind change: 202 (credit-only Cash) is not written at all', () => assert.deepEqual(w.sale(202), before202))
    await check('kind change: 203 (no credit) is renamed as before', () => { assert.equal(w.sale(203).payment_method, 'Bank'); assert.deepEqual(w.details(203), [cust('Bank', 5)]) })
    await check('kind change: the audit counts 2 sales and 2 lines', () => {
      const d = JSON.parse(w.get("SELECT details FROM audit_logs WHERE action='replace' AND entity='payment_method' ORDER BY id DESC LIMIT 1").details)
      assert.equal(d.linkedSales, 2); assert.equal(d.linkedDetails, 2)
    })
    await check('kind change: the missing-methods check ignores credit rows, so the old name is not offered back', async () => {
      const un = await w.request('/payment-methods/unregistered')
      assert.equal(un.status, 200)
      assert.deepEqual(un.body.missing, [], JSON.stringify(un.body))
      assert.equal(un.body.missing_count, 0)
    })
    await check('kind change: the backfill adds nothing and leaves the list as renamed', async () => {
      const list = () => JSON.parse(w.get("SELECT value FROM settings WHERE key='pos_payment_methods'").value)
      const before = list()
      const back = await w.request('/payment-methods/backfill', 'POST', {})
      assert.equal(back.status, 200)
      assert.deepEqual(back.body.added, [])
      assert.deepEqual(list(), before)
    })
  }

  // --- Same kind (Cash -> Cash USD): the credit is renamed too, so no row stays under the old name.
  {
    const w = makeWorld()
    w.setMethods(['Cash', 'ABA'])
    w.seed(301, 'Cash', [cr('Cash'), cust('Cash')])
    w.seed(302, 'Cash', [cr('Cash')])
    w.seed(303, 'Cash + ABA', [cr('Cash'), cust('ABA')])
    w.seed(304, 'Cash', [cust('Cash', 5)])
    const impact = await w.impact('Cash', 'Cash USD')
    await check('same kind: the preview counts every sale with a Cash row, credit-only included', () => {
      assert.equal(impact.body.live_snapshots.sales, 4, JSON.stringify(impact.body.live_snapshots))
      assert.equal(impact.body.live_snapshots.payment_detail_lines, 5, JSON.stringify(impact.body.live_snapshots))
    })
    const renamed = await w.rename('Cash', 'Cash USD')
    await check('same kind: rename succeeds and reports what the preview said', () => {
      assert.equal(renamed.status, 200, JSON.stringify(renamed.body).slice(0, 200))
      assert.equal(renamed.body.linkedSales, impact.body.live_snapshots.sales)
      assert.equal(renamed.body.linkedDetails, impact.body.live_snapshots.payment_detail_lines)
    })
    await check('same kind: the credit follows the name; flag and amounts are untouched', () => {
      assert.deepEqual(w.details(301), [cr('Cash USD'), cust('Cash USD')])
      assert.deepEqual(w.details(302), [cr('Cash USD')])
      assert.deepEqual(w.details(303), [cr('Cash USD'), cust('ABA')])
    })
    await check('same kind: no row is left under the old name (summary or detail)', () => {
      assert.equal(w.get("SELECT COUNT(*) n FROM sales WHERE payment_method LIKE '%Cash%' AND payment_method NOT LIKE '%Cash USD%'").n, 0)
      assert.equal(w.get("SELECT COUNT(*) n FROM sales s, json_each(s.payment_details) d WHERE json_extract(d.value,'$.method')='Cash'").n, 0)
      assert.equal(w.sale(301).payment_method, 'Cash USD')
      assert.equal(w.sale(303).payment_method, 'Cash USD + ABA')
    })
    await check('same kind: the missing-methods check returns nothing', async () => {
      const un = await w.request('/payment-methods/unregistered')
      assert.deepEqual(un.body.missing, [], JSON.stringify(un.body))
    })
  }

  // --- The kinds setting decides the kind, not the spelling: "Drawer" pinned cash -> "Cash" is cash to cash; "Wing" digital -> "Cash" changes kind.
  {
    const w = makeWorld()
    w.setMethods(['Drawer', 'Wing'], { Drawer: 'cash' })
    w.seed(401, 'Drawer', [cr('Drawer')])
    w.seed(402, 'Wing', [cr('Wing')])
    const a = await w.rename('Drawer', 'Cash')
    await check('kinds setting: Drawer (pinned cash) to Cash renames the credit', () => { assert.equal(a.status, 200); assert.deepEqual(w.details(401), [cr('Cash')]) })
    const b = await w.rename('Wing', 'Cash')
    await check('kinds setting: Wing (digital) to Cash would change the kind, so the credit keeps Wing', () => { assert.equal(b.status, 200); assert.deepEqual(w.details(402), [cr('Wing')]) })
  }

  // --- Preview equals write, including a case-only rename (same key, so same kind).
  {
    const w = makeWorld()
    w.setMethods(['cash', 'ABA'])
    w.seed(501, 'cash + Cash', [cr('cash'), cust('Cash')])
    w.seed(502, 'cash', [cr('cash')])
    w.seed(503, 'cash', [cust('cash', 5)])
    const impact = await w.impact('cash', 'Cash')
    const renamed = await w.rename('cash', 'Cash')
    await check('case-only rename: the preview count equals what is written', () => {
      assert.equal(renamed.status, 200, JSON.stringify(renamed.body).slice(0, 200))
      assert.equal(renamed.body.linkedSales, impact.body.live_snapshots.sales, `preview ${JSON.stringify(impact.body.live_snapshots)} written ${renamed.body.linkedSales}`)
      assert.equal(renamed.body.linkedDetails, impact.body.live_snapshots.payment_detail_lines)
      const changed = w.get("SELECT COUNT(*) n FROM sales WHERE updated_at<>@stamp", { stamp: STAMP }).n
      assert.equal(changed, impact.body.live_snapshots.sales, 'sales actually written')
    })
    await check('case-only rename: the credit takes the new spelling', () => {
      assert.deepEqual(w.details(501), [cr('Cash'), cust('Cash')])
      assert.deepEqual(w.details(502), [cr('Cash')])
    })
  }

  // --- Preview equals write on a kind change with a credit-only sale in the mix.
  {
    const w = makeWorld()
    w.setMethods(['Cash', 'ABA'])
    w.seed(601, 'Cash', [cr('Cash')])
    w.seed(602, 'Cash', [cust('Cash')])
    const impact = await w.impact('Cash', 'Bank')
    const renamed = await w.rename('Cash', 'Bank')
    await check('kind change: preview count equals what is written when a credit-only sale is present', () => {
      assert.equal(impact.body.live_snapshots.sales, 1)
      assert.equal(renamed.body.linkedSales, 1)
      assert.equal(w.get("SELECT COUNT(*) n FROM sales WHERE updated_at<>@stamp", { stamp: STAMP }).n, 1)
    })
  }

  for (const line of results) console.log(line)
  const failed = results.filter((l) => l.startsWith('FAIL'))
  console.log(`${results.length - failed.length}/${results.length} passed`)
  if (failed.length) process.exitCode = 1
})().catch((e) => { console.error(e); process.exitCode = 1 })
