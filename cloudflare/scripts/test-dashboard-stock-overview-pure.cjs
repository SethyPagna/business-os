// G39 efficiency item 1: the Dashboard stock/expiry overview.
//
//  1. PARITY: getFamilyStockOverview (one statement, one family pass) equals
//     getFamilyStockStats + getFamilyStockAlertPage(low) + (out) -- the three
//     helpers the Dashboard used -- on seeded catalogs that exercise grouped
//     families, header-only families, healthy-sibling suppression, ties,
//     negative stock, null thresholds, all three low-stock configs, and
//     preview truncation. Fixture coverage is asserted, so a fixture that
//     stopped discriminating fails instead of passing vacuously.
//  2. COST: old path = 5 family passes + 2 expiry statements; new = 1 + 2.
//  3. INDEX 0228: the expiry list/count walked every active product (plan
//     control) and now seek idx_products_active_expiry_day with no temp sort;
//     results identical with and without it, including malformed dates.
//  4. CACHE: a repeat load reads no family/expiry rows; a new isolate reads
//     the shared cache; a STOCK bump (and a PRODUCTS bump) invalidates --
//     control: the same stock change WITHOUT a bump is still served cached,
//     proving the version is what invalidates; low-stock config, the UTC day
//     and the plan-tiered TTL change the answer; a version-read fault is
//     computed fresh and never cached; a failed compute is not memoised.
//  5. Server-applied undo/redo bumps 'stock' (the one writer that did not).
//
// Real migration chain through harness/d1compat.cjs (D1's expression depth
// 100). Run: node scripts/test-dashboard-stock-overview-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '../src')
function load(rel, overrides = {}) {
  const filename = path.join(SRC, rel)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  const localRequire = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name]
    if (name === './productStockGuard') return load('lib/productStockGuard.ts')
    if (name.startsWith('.')) throw new Error(`${rel}: unexpected dependency ${name}`)
    return require(name)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

// A D1Compat-shaped wrapper that records every statement.
function counting(db) {
  const log = []
  return {
    log,
    prepare(sql) {
      log.push(sql)
      const stmt = db.prepare(sql)
      return {
        all: async (params) => stmt.all(params),
        get: async (params) => stmt.get(params) ?? null,
        run: async (params) => { const r = stmt.run(params); return { changes: Number(r.meta.changes), lastInsertRowid: Number(r.meta.last_row_id) } },
      }
    },
    batch: (items) => db.batch(items),
  }
}

function modules(cdb, { planTier = load('lib/planTier.ts'), failCompute = null } = {}) {
  const dbStub = { getDb: () => cdb }
  const familyPagination = load('lib/familyPagination.ts', { './db': dbStub })
  const lowStockSettings = load('lib/lowStockSettings.ts', { './db': dbStub })
  const familyStockStats = load('lib/familyStockStats.ts', { './familyPagination': familyPagination, './lowStockSettings': lowStockSettings })
  const cache = load('lib/cache.ts', { './db': dbStub, './quotaGuard': { consumeQuota: async () => ({ zone: 'ok' }) } })
  const overview = load('lib/dashboardStockOverview.ts', {
    './db': dbStub,
    './cache': cache,
    './familyStockStats': failCompute ? { ...familyStockStats, getFamilyStockOverview: failCompute } : familyStockStats,
    './lowStockSettings': lowStockSettings,
    './planTier': planTier,
  })
  return { familyStockStats, cache, overview, lowStockSettings }
}

// Deterministic PRNG so a failure reproduces.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }

function seedCatalog(db, seed) {
  const r = rng(seed)
  const pick = (xs) => xs[Math.floor(r() * xs.length)]
  const names = Array.from({ length: 36 }, (_, i) => `Family ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? i : ''}`)
  let id = 1
  const ins = db.prepare(`INSERT INTO products (id, name, category, unit, stock_quantity, low_stock_threshold, out_of_stock_threshold,
    cost_price_usd, cost_price_khr, is_active, is_group, parent_id) VALUES (@id, @name, @category, 'pcs', @qty, @low, @out, @usd, @khr, @active, @isGroup, @parent)`)
  const headers = new Map()
  for (const name of names.slice(0, 8)) {
    // Group headers (is_group=1, parent_id=0); the last two have no members.
    ins.run({ id, name, category: 'Hdr', qty: pick([0, 0, 5]), low: null, out: null, usd: 0, khr: 0, active: 1, isGroup: 1, parent: 0 })
    headers.set(name, id++)
  }
  for (let i = 0; i < 160; i++) {
    const name = pick(names.slice(0, 34)) // names 34/35 never get members
    const parent = headers.has(name) && !['Family G', 'Family H'].includes(name) && r() < 0.6 ? headers.get(name) : null
    const row = {
      id: id++, name, category: pick(['A', 'B', null]),
      qty: pick([-2, -1, 0, 0, 0, 1, 2, 3, 3, 5, 8, 9, 10, 11, 25]),
      low: pick([null, null, 3, 5, 10, 12]), out: pick([null, 0, 0, 1, 2]),
      usd: Math.round(r() * 1000) / 100, khr: Math.round(r() * 40000), active: r() < 0.93 ? 1 : 0, isGroup: 0, parent,
    }
    if (!row.active) row.qty = 0
    ins.run(row)
  }
}

const LOW_CONFIGS = [
  { enabled: true, mode: 'product', threshold: 10 },
  { enabled: true, mode: 'global', threshold: 4 },
  { enabled: false, mode: 'product', threshold: 10 },
]

let passed = 0
async function check(name, fn) { await fn(); passed++; console.log('PASS', name) }

async function main() {
  const migrations = loadAll()

  await check('PARITY: one statement equals stats + low page + out page, on every config and preview size', async () => {
    const coverage = { truncatedLow: 0, truncatedOut: 0, lowOnly: 0, outOnly: 0, headerOnlyFamily: 0, lowRepNotMin: 0 }
    for (const seed of [1, 7, 42]) {
      const db = openDb(migrations)
      seedCatalog(db, seed)
      const cdb = counting(db)
      const { familyStockStats } = modules(cdb)
      // Coverage probes against the raw rows.
      coverage.headerOnlyFamily += db.prepare(`SELECT COUNT(*) n FROM products h WHERE h.is_group=1 AND h.parent_id=0 AND h.is_active=1
        AND NOT EXISTS (SELECT 1 FROM products m WHERE m.is_active=1 AND m.name_key=h.name_key AND m.id<>h.id)`).get().n
      for (const lowStock of LOW_CONFIGS) {
        for (const previewSize of [1, 3, 10, 1000]) {
          const stats = await familyStockStats.getFamilyStockStats({ db: cdb, lowStock, joinSql: '', whereSql: 'WHERE p.is_active = 1', params: {}, qtyExpr: 'COALESCE(p.stock_quantity, 0)' })
          const low = await familyStockStats.getFamilyStockAlertPage({ db: cdb, lowStock, state: 'low', page: 1, pageSize: previewSize })
          const out = await familyStockStats.getFamilyStockAlertPage({ db: cdb, lowStock, state: 'out', page: 1, pageSize: previewSize })
          const one = await familyStockStats.getFamilyStockOverview({ db: cdb, lowStock, previewSize })
          const label = `seed ${seed} ${JSON.stringify(lowStock)} preview ${previewSize}`
          assert.deepEqual(one.stats, stats, `stats ${label}`)
          assert.deepEqual(one.low, low, `low page ${label}`)
          assert.deepEqual(one.out, out, `out page ${label}`)
          if (low.hasMore) coverage.truncatedLow++
          if (out.hasMore) coverage.truncatedOut++
          if (low.total > 0) coverage.lowOnly++
          if (out.total > 0) coverage.outOnly++
          for (const item of low.items) {
            // A representative that is not simply the family's minimum-qty row.
            const min = db.prepare('SELECT MIN(COALESCE(stock_quantity,0)) q FROM products WHERE is_active=1 AND name=?').get(item.name).q
            if (item.stock_quantity !== min) coverage.lowRepNotMin++
          }
        }
      }
    }
    assert.ok(coverage.truncatedLow > 0 && coverage.truncatedOut > 0, `fixture must truncate both previews ${JSON.stringify(coverage)}`)
    assert.ok(coverage.lowOnly > 0 && coverage.outOnly > 0, 'fixture must have low and out families')
    assert.ok(coverage.headerOnlyFamily > 0, 'fixture must have a header-only family')
    assert.ok(coverage.lowRepNotMin > 0, 'fixture must make the low representative rule matter (an out member in a low family)')
    console.log('   coverage', JSON.stringify(coverage))
  })

  await check('COST: old Dashboard stock block = 5 family passes + 2 expiry statements; new = 1 + 2', async () => {
    const db = openDb(migrations)
    seedCatalog(db, 3)
    const cdb = counting(db)
    const { familyStockStats, overview } = modules(cdb)
    const lowStock = LOW_CONFIGS[0]
    const families = () => cdb.log.filter((sql) => /family_agg AS/.test(sql)).length
    const expiry = () => cdb.log.filter((sql) => /COALESCE\(expiry_alert_days, 30\)/.test(sql)).length
    // The old composition, verbatim from the pre-change compat.ts.
    await familyStockStats.getFamilyStockStats({ db: cdb, lowStock, joinSql: '', whereSql: 'WHERE p.is_active = 1', params: {}, qtyExpr: 'COALESCE(p.stock_quantity, 0)' })
    await familyStockStats.getFamilyStockAlertPage({ db: cdb, lowStock, state: 'low', page: 1, pageSize: 10 })
    await familyStockStats.getFamilyStockAlertPage({ db: cdb, lowStock, state: 'out', page: 1, pageSize: 10 })
    assert.equal(families(), 5, 'CONTROL: the old block runs five family passes')
    cdb.log.length = 0
    await overview.computeDashboardStockOverview({}, lowStock)
    assert.equal(families(), 1, 'one family pass')
    assert.equal(expiry(), 2, 'expiry list + count')
    assert.equal(cdb.log.length, 3, 'three statements in total')
  })

  await check('INDEX 0228: expiry list/count walked the active catalog; now seek the partial index, same rows', async () => {
    const before = openDb(loadAll({ through: 227 }))
    const seedExpiry = (db) => db.exec(`
      INSERT INTO products (id, name, is_active, expiry_date, expiry_alert_days) VALUES
        (1,'past',1,date('now','-3 day'),30),(2,'soon',1,date('now','+5 day'),30),(3,'later',1,date('now','+60 day'),30),
        (4,'later wide',1,date('now','+60 day'),90),(5,'inactive soon',0,date('now','+1 day'),30),(6,'no date',1,NULL,30),
        (7,'empty',1,'',30),(8,'garbage',1,'not a date',30),(9,'with time',1,datetime('now','+2 day'),NULL),
        (10,'zero window',1,date('now'),0),(11,'negative window',1,date('now','+1 day'),-5),(12,'fraction',1,date('now','+1 day'),1.5),
        (13,'text window',1,date('now','+1 day'),'abc'),(14,'tie a',1,date('now','+7 day'),30),(15,'tie b',1,date('now','+7 day'),30);
      INSERT INTO products (name, is_active, stock_quantity) SELECT 'bulk ' || value, 1, 5 FROM json_each('[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]');`)
    seedExpiry(before)
    const { DASHBOARD_EXPIRY_WHERE_SQL } = modules(counting(before)).overview
    const LIST = `SELECT id, name, category, unit, expiry_date, CAST(julianday(expiry_date) - julianday('now') AS INTEGER) AS days_until_expiry
      FROM products p WHERE ${DASHBOARD_EXPIRY_WHERE_SQL} ORDER BY date(expiry_date) ASC LIMIT 10`
    const COUNT = `SELECT COUNT(*) AS count FROM products p WHERE ${DASHBOARD_EXPIRY_WHERE_SQL}`
    const plan = (db, sql) => db.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((row) => row.detail).join(' | ')
    const listBefore = plan(before, LIST), countBefore = plan(before, COUNT)
    assert.match(listBefore, /idx_products_active_grouped_pg \(is_active=\?\)/, `CONTROL list walks the active catalog: ${listBefore}`)
    assert.match(listBefore, /TEMP B-TREE/, `CONTROL list sorts: ${listBefore}`)
    assert.doesNotMatch(countBefore, /idx_products_active_expiry_day/, countBefore)
    const rowsBefore = [before.db.prepare(LIST).all(), before.db.prepare(COUNT).get()]

    const migration = fs.readFileSync(path.join(__dirname, '../migrations/0228_dashboard_expiry_index.sql'), 'utf8')
    assert.ok(!migration.includes('\r'), '0228 is LF-only')
    assert.equal(fs.readdirSync(path.join(__dirname, '../migrations')).filter((f) => f.startsWith('0228')).length, 1, 'one file claims 0228')
    before.exec(migration)
    const listAfter = plan(before, LIST), countAfter = plan(before, COUNT)
    console.log('   EQP list  before:', listBefore, '\n   EQP list  after :', listAfter)
    console.log('   EQP count before:', countBefore, '\n   EQP count after :', countAfter)
    assert.match(listAfter, /SEARCH p USING INDEX idx_products_active_expiry_day \(is_active=\?\)/, listAfter)
    assert.doesNotMatch(listAfter, /TEMP B-TREE/, listAfter)
    assert.match(countAfter, /SEARCH p USING INDEX idx_products_active_expiry_day \(is_active=\?\)/, countAfter)
    const rowsAfter = [before.db.prepare(LIST).all(), before.db.prepare(COUNT).get()]
    assert.deepEqual(rowsAfter, rowsBefore, 'identical list and count with the index')
    assert.ok(rowsBefore[1].count >= 4, `fixture has several expiring rows (${rowsBefore[1].count})`)
    // ANALYZE must not flip it back.
    before.exec('ANALYZE')
    assert.match(plan(before, LIST), /idx_products_active_expiry_day/)
    before.exec(migration)
    assert.equal(before.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='idx_products_active_expiry_day'").get().n, 1, 'idempotent')
    before.exec('DROP INDEX IF EXISTS idx_products_active_expiry_day')
    assert.equal(before.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='idx_products_active_expiry_day'").get().n, 0, 'documented recovery')
    // The full chain (what the Worker runs on) carries it.
    const full = openDb(migrations)
    assert.equal(full.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='idx_products_active_expiry_day'").get().n, 1)
  })

  // ---- cache behaviour --------------------------------------------------
  function cacheWorld({ tier = 'paid' } = {}) {
    const db = openDb(migrations)
    seedCatalog(db, 11)
    const cdb = counting(db)
    const kv = new Map()
    const env = { PLAN_TIER: tier, CACHE: { get: async (k) => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v) }, delete: async (k) => { kv.delete(k) } } }
    const store = new Map()
    const cacheApi = {
      match: async (req) => store.has(req.url) ? new Response(store.get(req.url)) : undefined,
      put: async (req, res) => { store.set(req.url, await res.text()) },
    }
    let clock = Date.UTC(2026, 9, 5, 3, 0, 0)
    const waits = []
    const ctx = { requestUrl: 'https://admin.example.test/api/dashboard/startup?startDate=2026-10-05', waitUntil: (p) => waits.push(p), now: () => clock, cache: cacheApi }
    const isolate = (opts) => modules(cdb, { planTier: load('lib/planTier.ts'), ...opts })
    return { db, cdb, env, kv, store, ctx, waits, isolate, tick: (ms) => { clock += ms }, setClock: (ms) => { clock = ms } }
  }
  const heavy = (cdb) => cdb.log.filter((sql) => /family_agg AS|COALESCE\(expiry_alert_days, 30\)/.test(sql)).length

  await check('CACHE: repeat load = no family/expiry statement; a new isolate reads the shared cache', async () => {
    const w = cacheWorld()
    const a = w.isolate()
    const first = await a.overview.loadDashboardStockOverview(w.env, w.ctx)
    await Promise.all(w.waits)
    assert.equal(heavy(w.cdb), 3, 'miss: 1 family pass + 2 expiry')
    w.cdb.log.length = 0
    const second = await a.overview.loadDashboardStockOverview(w.env, w.ctx)
    assert.equal(heavy(w.cdb), 0, 'isolate memo hit')
    assert.deepEqual(second, first)
    assert.ok(w.cdb.log.every((sql) => !/\bproducts\b/.test(sql)), `a hit reads no products row (${w.cdb.log.join(' || ')})`)
    const fresh = await w.isolate().overview.loadDashboardStockOverview(w.env, w.ctx)
    assert.equal(heavy(w.cdb), 0, 'Cache API hit in a new isolate')
    assert.deepEqual(fresh, first)
    assert.equal(w.store.size, 1, 'one shared entry, keyed off the request query (range/branch do not fragment it)')
    assert.match([...w.store.keys()][0], /^https:\/\/admin\.example\.test\/__internal-cache\/dashboard-stock-overview\?k=/)
  })

  await check('CACHE CONTROL: a stock change is served cached until the stock version is bumped, then recomputed', async () => {
    const w = cacheWorld()
    const mod = w.isolate()
    const before = await mod.overview.loadDashboardStockOverview(w.env, w.ctx)
    await Promise.all(w.waits)
    // Sell everything: every active product to 0.
    w.db.exec('UPDATE products SET stock_quantity = 0 WHERE is_active = 1')
    const stale = await mod.overview.loadDashboardStockOverview(w.env, w.ctx)
    assert.deepEqual(stale, before, 'CONTROL: without a bump the cached answer is served (the version is the invalidator)')
    await mod.cache.bumpVersion(w.env, 'stock')
    w.cdb.log.length = 0
    const after = await mod.overview.loadDashboardStockOverview(w.env, w.ctx)
    assert.equal(heavy(w.cdb), 3, 'recomputed after the stock bump')
    assert.notDeepEqual(after.inventory, before.inventory)
    assert.equal(after.inventory.in_stock, 0, 'reflects the sale-out immediately')
    assert.deepEqual(after, await mod.overview.computeDashboardStockOverview(w.env, await mod.lowStockSettings.loadLowStockConfig(w.env)), 'equals a live compute')
    // A new isolate must not read the pre-bump Cache API entry either.
    const other = await w.isolate().overview.loadDashboardStockOverview(w.env, w.ctx)
    assert.equal(other.inventory.in_stock, 0)
  })

  await check('CACHE: a products bump, a low-stock config change and the UTC day each invalidate', async () => {
    const w = cacheWorld()
    w.setClock(Date.UTC(2026, 9, 5, 23, 59, 45))
    const mod = w.isolate()
    await mod.overview.loadDashboardStockOverview(w.env, w.ctx)
    w.cdb.log.length = 0
    await mod.cache.bumpVersion(w.env, 'products')
    await mod.overview.loadDashboardStockOverview(w.env, w.ctx)
    assert.equal(heavy(w.cdb), 3, 'products bump')
    w.cdb.log.length = 0
    w.db.exec("INSERT INTO settings (key, value) VALUES ('low_stock_threshold_mode', 'global') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    await mod.overview.loadDashboardStockOverview(w.env, w.ctx)
    assert.equal(heavy(w.cdb), 3, 'config change is part of the key, no bump needed')
    w.cdb.log.length = 0
    await mod.overview.loadDashboardStockOverview(w.env, w.ctx)
    assert.equal(heavy(w.cdb), 0, 'CONTROL: same key, same day, inside the TTL = hit')
    w.tick(20 * 1000) // crosses 00:00 UTC, still inside the 30 s TTL
    await mod.overview.loadDashboardStockOverview(w.env, w.ctx)
    assert.equal(heavy(w.cdb), 3, 'new UTC day (the expiry window moves) even inside the TTL')
  })

  await check('CACHE: TTL is plan-tiered -- Paid 30 s, Free 300 s (Free = fewer rows)', async () => {
    for (const [tier, ttl] of [['paid', 30], ['free', 300]]) {
      const w = cacheWorld({ tier })
      const mod = w.isolate({ planTier: load('lib/planTier.ts') })
      await mod.overview.loadDashboardStockOverview(w.env, { ...w.ctx, cache: null })
      w.cdb.log.length = 0
      w.tick((ttl - 1) * 1000)
      await mod.overview.loadDashboardStockOverview(w.env, { ...w.ctx, cache: null })
      assert.equal(heavy(w.cdb), 0, `${tier}: still fresh at ${ttl - 1} s`)
      w.tick(2000)
      await mod.overview.loadDashboardStockOverview(w.env, { ...w.ctx, cache: null })
      assert.equal(heavy(w.cdb), 3, `${tier}: recomputed after ${ttl} s`)
    }
  })

  await check('FAIL SAFE: a version-read fault computes fresh every time and caches nothing', async () => {
    const w = cacheWorld()
    w.env.CACHE.get = async () => { throw new Error('KV down') }
    const mod = w.isolate()
    await mod.overview.loadDashboardStockOverview(w.env, w.ctx)
    await mod.overview.loadDashboardStockOverview(w.env, w.ctx)
    assert.equal(heavy(w.cdb), 6, 'no memo, no cache without a trustworthy key')
    assert.equal(w.store.size, 0)
  })

  await check('FAIL SAFE: a failed compute is not memoised', async () => {
    const w = cacheWorld()
    let fail = true
    const real = modules(w.cdb).familyStockStats.getFamilyStockOverview
    const mod = w.isolate({ failCompute: async (o) => { if (fail) throw new Error('D1 hiccup'); return real(o) } })
    await assert.rejects(mod.overview.loadDashboardStockOverview(w.env, { ...w.ctx, cache: null }), /D1 hiccup/)
    fail = false
    const ok = await mod.overview.loadDashboardStockOverview(w.env, { ...w.ctx, cache: null })
    assert.ok(ok.inventory.total_products > 0)
  })

  await check('WIRING: compat.ts serves the stock block from the shared overview; undo/redo bumps stock', async () => {
    const compat = fs.readFileSync(path.join(SRC, 'routes/compat.ts'), 'utf8').replace(/\r\n/g, '\n')
    const summary = compat.slice(compat.indexOf('async function dashboardSummary'), compat.indexOf('async function dashboardAnalytics'))
    assert.match(summary, /loadDashboardStockOverview\(env, overviewCtx\)/)
    assert.doesNotMatch(summary, /getFamilyStockAlertPage|getFamilyStockStats\(|expiry_alert_days/, 'no second copy of the stock queries left in the summary')
    assert.equal((compat.match(/dashboardSummary\(c\.env, c\.req\.query\(\), dashboardOverviewContext\(c\)\)/g) || []).length, 2, '/dashboard and /dashboard/startup')
    const history = fs.readFileSync(path.join(SRC, 'routes/actionHistory.ts'), 'utf8').replace(/\r\n/g, '\n')
    assert.match(history, /applied = true\n[\s\S]{0,700}import\('\.\.\/lib\/cache'\)\.then\(\(\{ bumpVersion \}\) => bumpVersion\(c\.env, 'stock'\)\)\.catch\(\(\) => \{\}\)/)
    const tiers = load('lib/planTier.ts').PLAN_LIMITS_BY_TIER
    assert.equal(tiers.paid.dashboardStockOverviewCacheSeconds, 30)
    assert.equal(tiers.free.dashboardStockOverviewCacheSeconds, 300)
  })

  console.log(`\n${passed} dashboard stock overview checks passed.`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
