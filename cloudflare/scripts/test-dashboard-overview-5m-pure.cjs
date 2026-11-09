'use strict'
// TIME-1 / P1.8b: the Dashboard stock overview says when it was calculated, and (read switch `dash_overview_5m`, default off) is kept for up
// to 5 minutes instead of being recomputed after every sale. Owner, 27 Oct and 1 Nov: "the stock overview may be up to 5 minutes old and shows
// the time it was calculated".
//
//  1. ASOF     the overview carries `asOf` (UTC ISO, the moment it was computed); a memo hit and a Workers Cache API hit keep THAT value, never
//              a fresh stamp (switch off and on).
//  2. OFF      with the switch off the body equals the composition of the helpers the Dashboard used before (stats + low page + out page +
//              expiry list + count), minus `asOf`, over 24 randomized stock states; the key is the old key under the new schema token.
//              With it on, a cold compute is the same body.
//  3. WINDOW   on, an entry is never served more than 300 s after `asOf` (fake clock, every second for 12 minutes, one isolate and a new
//              isolate on alternate seconds); the window is planTier.ts dashboardOverviewMaxAgeSeconds, so another plan value moves it;
//              buckets are business time (UTC+7): a boundary falls on :00/:05 Phnom Penh time, business midnight included. A stored entry
//              older than the window is recomputed even when the key matches.
//  4. KEY      on, a sale or any other 'stock'-only bump does not recompute (off does: the control), a 'products' bump does; the 'stock'
//              version is not even read; the branch scope, the cost grant and the organisation each give their own entry and their own key;
//              an asker who is not named (no org / branch scope / cost grant) gets an uncached compute; on and off never read each other's entries.
//
// Run (from cloudflare/): node scripts/test-dashboard-overview-5m-pure.cjs
const assert = require('node:assert/strict')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { load, modules, counting, rng, fixtureWrite, seedCatalog, LOW_CONFIGS, cacheWorld, heavy } = require('./harness/dashboard_overview_world.cjs')

let passed = 0
async function check(name, fn) { await fn(); passed++; console.log('PASS', name) }

const WINDOW_MS = 300 * 1000
const BUSINESS_OFFSET_MS = 7 * 3600 * 1000
const planWindow = load('lib/planTier.ts').PLAN_LIMITS_BY_TIER.paid.dashboardOverviewMaxAgeSeconds * 1000
const stripAsOf = ({ asOf, ...rest }) => rest
const iso = (ms) => new Date(ms).toISOString()
// the start of the business-time bucket that holds `ms`
const bucketStart = (ms, window = WINDOW_MS) => Math.floor((ms + BUSINESS_OFFSET_MS) / window) * window - BUSINESS_OFFSET_MS

const ASKER = { org: '1', branchScope: '', costGrant: 'cost' }
const asker = (w, extra = {}) => ({ ...w.ctx, ...ASKER, ...extra })

async function main() {
  const migrations = loadAll()
  const world = (opts) => cacheWorld(migrations, opts)

  await check('ASOF: the plan window is the config field, 300 s on both tiers', async () => {
    const tiers = load('lib/planTier.ts').PLAN_LIMITS_BY_TIER
    assert.equal(planWindow, WINDOW_MS)
    assert.equal(tiers.free.dashboardOverviewMaxAgeSeconds, 300)
  })

  for (const on of [false, true]) {
    const label = on ? 'switch ON' : 'switch OFF'
    await check(`ASOF (${label}): present, the compute instant, and a memo hit / a new isolate's Cache API hit keep it`, async () => {
      const w = world({ switchOn: on })
      const a = w.isolate()
      const t0 = w.ctx.now()
      const first = await a.overview.loadDashboardStockOverview(w.env, asker(w))
      await Promise.all(w.waits)
      assert.equal(first.asOf, iso(t0), 'stamped with the clock the load ran on')
      assert.match(first.asOf, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
      w.tick(45 * 1000)
      const memoHit = await a.overview.loadDashboardStockOverview(w.env, asker(w))
      assert.equal(heavy(w.cdb), 3, 'one compute so far')
      assert.equal(memoHit.asOf, first.asOf, 'a memo hit keeps the original asOf')
      const shared = await w.isolate().overview.loadDashboardStockOverview(w.env, asker(w))
      assert.equal(heavy(w.cdb), 3, 'a new isolate read the shared cache')
      assert.equal(shared.asOf, first.asOf, 'a Cache API hit keeps the original asOf')
      assert.notEqual(shared.asOf, iso(w.ctx.now()), 'never re-stamped with the time of the hit')
      assert.deepEqual(shared, first)
    })
  }

  await check('OFF: the key is the old key under the new schema token, and the 5m key is another schema with no stock version', async () => {
    const { overview } = modules(counting(openDb(migrations)))
    const low = { enabled: true, mode: 'product', threshold: 10 }
    assert.equal(overview.dashboardStockOverviewKey({ productsVersion: 'P', stockVersion: 'S', lowStock: low, utcDate: '2026-10-05', build: 'B', epoch: 'E' }),
      ['dso3', '2026-10-05', 'p=P', 's=S', 'l=1:product:10', 'n=10', 'b=B', 'e=E'].join('|'))
    const five = overview.dashboardStockOverviewFiveMinuteKey({ productsVersion: 'P', lowStock: low, bucket: 7, utcDate: '2026-10-05', build: 'B', epoch: 'E', org: '1', branchScope: '3', costGrant: 'cost' })
    assert.equal(five, ['dso3-5m', 'b=B', 'o=1', 'e=E', 'br=3', 'cg=cost', 'l=1:product:10', 'n=10', 'p=P', 'd=2026-10-05', 't=7'].join('|'))
    assert.doesNotMatch(five, /(^|\|)s=/, 'no stock version in the key')
  })

  await check('OFF equals the helpers the Dashboard used before, for 24 randomized stock states (and ON computes the same body cold)', async () => {
    const w = world()
    const r = rng(20261104)
    const pick = (xs) => xs[Math.floor(r() * xs.length)]
    const { familyStockStats, overview } = w.isolate()
    const legacy = async (lowStock) => {
      const stats = await familyStockStats.getFamilyStockStats({ db: w.cdb, lowStock, joinSql: '', whereSql: 'WHERE p.is_active = 1', params: {}, qtyExpr: 'COALESCE(p.stock_quantity, 0)' })
      const low = await familyStockStats.getFamilyStockAlertPage({ db: w.cdb, lowStock, state: 'low', page: 1, pageSize: 10 })
      const out = await familyStockStats.getFamilyStockAlertPage({ db: w.cdb, lowStock, state: 'out', page: 1, pageSize: 10 })
      const expiring = await w.cdb.prepare(overview.dashboardExpiringProductsSql(10)).all()
      const count = await w.cdb.prepare(`SELECT (SELECT COUNT(*) FROM products p WHERE ${overview.DASHBOARD_EXPIRY_WHERE_SQL}) + (SELECT COUNT(*) FROM products p WHERE p.is_active IS NOT 1 AND (COALESCE(p.stock_quantity, 0) <> 0 OR EXISTS (SELECT 1 FROM branch_stock s WHERE s.product_id = p.id AND COALESCE(s.quantity, 0) <> 0) OR EXISTS (SELECT 1 FROM branch_batch_stock b JOIN product_batches pb ON pb.id = b.batch_id WHERE pb.variant_product_id = p.id AND COALESCE(b.quantity, 0) <> 0)) AND expiry_date IS NOT NULL AND date(expiry_date) <= date('now', '+' || COALESCE(expiry_alert_days, 30) || ' day')) AS count`).get()
      return { inventory: stats, low, out, expiring: expiring || [], expiringCount: Number(count?.count || 0) }
    }
    let lowSeen = 0, outSeen = 0, expiringSeen = 0, changed = new Set()
    for (let state = 0; state < 24; state++) {
      fixtureWrite(w.db, () => {
        const update = w.db.prepare('UPDATE products SET stock_quantity = @q, expiry_date = @e, expiry_alert_days = @d WHERE id = @id')
        for (const { id } of w.db.prepare('SELECT id FROM products WHERE is_group = 0 AND is_active = 1 ORDER BY RANDOM() LIMIT 40').all()) {
          update.run({ id, q: pick([-1, 0, 0, 1, 2, 3, 5, 9, 12, 40]), e: pick([null, null, "2026-10-08", "2026-12-30", "2027-06-01", "2026-10-01"]), d: pick([null, 7, 30, 90]) })
        }
      })
      const lowStock = pick(LOW_CONFIGS)
      const expected = await legacy(lowStock)
      lowSeen += expected.low.total > 0 ? 1 : 0; outSeen += expected.out.total > 0 ? 1 : 0; expiringSeen += expected.expiringCount > 0 ? 1 : 0
      changed.add(JSON.stringify([expected.inventory.in_stock, expected.inventory.low_stock, expected.inventory.out_of_stock]))
      // each load in its own isolate with no cache: a real compute through the real loader
      const off = await w.isolate({ switchOn: false }).overview.loadDashboardStockOverview(w.env, { ...w.ctx, cache: null })
      const onCold = await w.isolate({ switchOn: true }).overview.loadDashboardStockOverview(w.env, { ...asker(w), cache: null })
      // the loader reads the low-stock config from the settings table; the legacy side must read the same one
      const stored = await w.isolate().lowStockSettings.loadLowStockConfig(w.env)
      const expectedStored = await legacy(stored)
      assert.deepEqual(stripAsOf(off), expectedStored, `state ${state}: switch off equals the old composition`)
      assert.deepEqual(stripAsOf(onCold), expectedStored, `state ${state}: switch on computes the same body`)
      // and the answer moves with the data, so the comparison is not between two copies of one stale value
      if (state % 8 === 7) w.db.exec(`INSERT INTO settings (key, value) VALUES ('low_stock_threshold_mode', '${pick(['product', 'global'])}') ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    }
    assert.ok(lowSeen > 4 && outSeen > 4 && expiringSeen > 4, `fixture reaches every list (low ${lowSeen}, out ${outSeen}, expiring ${expiringSeen})`)
    assert.ok(changed.size >= 10, `the 24 states really differ (${changed.size} distinct stock summaries)`)
  })

  await check('WINDOW: on, nothing is ever served more than 300 s after its asOf (12 minutes of seconds, one isolate and a new isolate in turn)', async () => {
    const w = world({ switchOn: true })
    // start 100 s into a bucket, so the first entry lives 200 s and the next ones the whole window
    w.setClock(bucketStart(Date.UTC(2026, 9, 5, 3, 0, 0)) + 100 * 1000)
    const start = w.ctx.now()
    const shared = w.isolate()
    let worst = 0
    let lastAsOf = ''
    const computes = new Set()
    for (let second = 0; second <= 12 * 60; second++) {
      const mod = second % 2 === 0 ? shared : w.isolate()
      const value = await mod.overview.loadDashboardStockOverview(w.env, asker(w))
      await Promise.all(w.waits.splice(0))
      const age = w.ctx.now() - Date.parse(value.asOf)
      worst = Math.max(worst, age)
      assert.ok(age >= 0 && age <= WINDOW_MS, `at +${second} s the served overview is ${age} ms old`)
      assert.ok(value.asOf >= lastAsOf, 'asOf never goes backwards')
      lastAsOf = value.asOf
      computes.add(value.asOf)
      w.tick(1000)
    }
    // entries at +0 (bucket 0, 200 s left), then a new one each 300 s: +200, +500 and +800 is past the loop
    assert.equal(computes.size, 3, `three computes in 12 minutes (${[...computes].map((x) => x.slice(11, 19))})`)
    assert.ok(worst > 150 * 1000 && worst <= WINDOW_MS, `an entry really was served late in its window (${worst} ms): the sweep reaches the limit`)
    assert.equal(heavy(w.cdb), 9, 'three computes of 1 family pass + 2 expiry statements')
    assert.ok(start > 0)
  })

  await check('WINDOW: exactly 299 s after a bucket opens is a hit, the next bucket is a compute; the window is the plan field', async () => {
    for (const [seconds, label] of [[300, 'plan 300 s'], [120, 'plan 120 s']]) {
      const w = world({ switchOn: true })
      const plan = load('lib/planTier.ts')
      const patched = { ...plan, getPlanLimits: (env) => ({ ...plan.getPlanLimits(env), dashboardOverviewMaxAgeSeconds: seconds }) }
      const mod = w.isolate({ planTier: patched })
      w.setClock(bucketStart(Date.UTC(2026, 9, 5, 3, 0, 0), seconds * 1000) + 1000)
      await mod.overview.loadDashboardStockOverview(w.env, asker(w, { cache: null }))
      w.cdb.log.length = 0
      w.tick((seconds - 2) * 1000)
      await mod.overview.loadDashboardStockOverview(w.env, asker(w, { cache: null }))
      assert.equal(heavy(w.cdb), 0, `${label}: still inside the bucket at +${seconds - 1} s`)
      w.tick(2000)
      await mod.overview.loadDashboardStockOverview(w.env, asker(w, { cache: null }))
      assert.equal(heavy(w.cdb), 3, `${label}: the next bucket computes`)
    }
  })

  await check('WINDOW: the shared cache entry lives to the end of its bucket, never past the window; off keeps its own lifetime', async () => {
    const paid = load('lib/planTier.ts').PLAN_LIMITS_BY_TIER.paid.dashboardStockOverviewCacheSeconds
    for (const [offset, expected] of [[0, 300], [100, 200], [299, 1]]) {
      const w = world({ switchOn: true })
      w.setClock(bucketStart(Date.UTC(2026, 9, 5, 3, 0, 0)) + offset * 1000)
      await w.isolate().overview.loadDashboardStockOverview(w.env, asker(w))
      await Promise.all(w.waits.splice(0))
      assert.deepEqual([...w.maxAge.values()], [expected], `${offset} s into a bucket the entry lives ${expected} s`)
    }
    const off = world({ switchOn: false })
    await off.isolate().overview.loadDashboardStockOverview(off.env, asker(off))
    await Promise.all(off.waits.splice(0))
    assert.deepEqual([...off.maxAge.values()], [paid], 'off: the existing lifetime')
  })

  await check('WINDOW: buckets are business time: a boundary is :00 / :05 in Phnom Penh, business midnight included', async () => {
    const { overview } = modules(counting(openDb(migrations)))
    const at = (h, m, s, ms = 0) => Date.UTC(2026, 9, 5, h, m, s, ms)
    // 03:02:30 UTC = 10:02:30 in Phnom Penh -> the bucket ends at 10:05:00 = 03:05:00 UTC
    assert.equal(overview.businessBucket(at(3, 2, 30), WINDOW_MS).endsAt, at(3, 5, 0))
    // 16:59:59.999 UTC is the last millisecond before business midnight; 17:00:00 starts the next bucket
    const before = overview.businessBucket(at(16, 59, 59, 999), WINDOW_MS)
    const after = overview.businessBucket(at(17, 0, 0), WINDOW_MS)
    assert.equal(before.endsAt, at(17, 0, 0))
    assert.equal(after.bucket, before.bucket + 1)
    assert.equal((after.bucket * WINDOW_MS) % (24 * 3600 * 1000), 0, 'business midnight is the start of a bucket')
    // UTC midnight (the expiry window's clock) is 07:00 in Phnom Penh: also a boundary
    assert.equal(overview.businessBucket(at(23, 59, 59), WINDOW_MS).endsAt, Date.UTC(2026, 9, 6, 0, 0, 0))
  })

  await check('WINDOW: a stored entry older than the window is recomputed even when its key matches (headers or clocks that lie)', async () => {
    const w = world({ switchOn: true })
    w.setClock(bucketStart(Date.UTC(2026, 9, 5, 3, 0, 0)) + 10 * 1000)
    await w.isolate().overview.loadDashboardStockOverview(w.env, asker(w))
    await Promise.all(w.waits.splice(0))
    assert.equal(w.store.size, 1)
    const [url, body] = [...w.store.entries()][0]
    const stale = JSON.parse(body)
    // same key, stamped 400 s ago
    w.store.set(url, JSON.stringify({ ...stale, asOf: iso(w.ctx.now() - 400 * 1000) }))
    w.cdb.log.length = 0
    const value = await w.isolate().overview.loadDashboardStockOverview(w.env, asker(w))
    assert.equal(heavy(w.cdb), 3, 'recomputed')
    assert.equal(value.asOf, iso(w.ctx.now()), 'and stamped now')
    // a stamp inside the window is served as it is
    await Promise.all(w.waits.splice(0))
    w.store.set(url, JSON.stringify({ ...stale, asOf: iso(w.ctx.now() - 250 * 1000) }))
    w.cdb.log.length = 0
    const kept = await w.isolate().overview.loadDashboardStockOverview(w.env, asker(w))
    assert.equal(heavy(w.cdb), 0)
    assert.equal(kept.asOf, iso(w.ctx.now() - 250 * 1000))
    // an unreadable stamp is not trusted
    w.store.set(url, JSON.stringify({ ...stale, asOf: 'yesterday' }))
    w.cdb.log.length = 0
    await w.isolate().overview.loadDashboardStockOverview(w.env, asker(w))
    assert.equal(heavy(w.cdb), 3, 'a garbage asOf is recomputed')
  })

  await check('KEY: a stock-only bump recomputes with the switch off (control) and not on; a products bump recomputes on; stock is not read on', async () => {
    for (const on of [false, true]) {
      const w = world({ switchOn: on })
      const gets = []
      const realGet = w.env.CACHE.get
      w.env.CACHE.get = async (key, ...rest) => { gets.push(String(key)); return realGet(key, ...rest) }
      const mod = w.isolate()
      await mod.overview.loadDashboardStockOverview(w.env, asker(w))
      await Promise.all(w.waits.splice(0))
      assert.equal(heavy(w.cdb), 3)
      assert.equal(gets.some((key) => /stock/.test(key)), !on, on ? 'the stock version is never read with the switch on' : 'CONTROL: it is read with the switch off')
      w.cdb.log.length = 0
      await mod.cache.bumpVersion(w.env, 'stock')
      w.tick(5000)
      await mod.overview.loadDashboardStockOverview(w.env, asker(w))
      assert.equal(heavy(w.cdb), on ? 0 : 3, on ? 'a sale (stock bump) does not recompute inside the window' : 'CONTROL: off recomputes after a stock bump')
      await Promise.all(w.waits.splice(0))
      w.cdb.log.length = 0
      await mod.cache.bumpVersion(w.env, 'products')
      w.tick(5000)
      const afterProducts = await mod.overview.loadDashboardStockOverview(w.env, asker(w))
      assert.equal(heavy(w.cdb), 3, 'a product edit ends the entry at once, switch on or off')
      assert.equal(afterProducts.asOf, iso(w.ctx.now()))
    }
  })

  await check('KEY: branch scope, cost grant and organisation each get their own entry and key; the same asker shares one', async () => {
    const w = world({ switchOn: true })
    const mod = w.isolate()
    const load = (extra) => mod.overview.loadDashboardStockOverview(w.env, asker(w, extra))
    const solo = await load({})
    await Promise.all(w.waits.splice(0))
    assert.equal(heavy(w.cdb), 3)
    await load({})
    assert.equal(heavy(w.cdb), 3, 'the same asker shares the entry')
    const variants = [{ branchScope: '2' }, { costGrant: 'nocost' }, { org: '2' }]
    let expected = 3
    for (const extra of variants) {
      w.tick(1000)
      const value = await load(extra)
      await Promise.all(w.waits.splice(0))
      expected += 3
      assert.equal(heavy(w.cdb), expected, `${JSON.stringify(extra)} computed its own entry`)
      assert.notEqual(value.asOf, solo.asOf)
      assert.deepEqual(stripAsOf(value), stripAsOf(solo), 'same data, as the catalogue-wide body is')
    }
    assert.equal(w.store.size, 4, 'four entries in the shared cache')
    const keys = [...w.store.keys()].map((url) => new URL(url).searchParams.get('k'))
    assert.equal(new Set(keys).size, 4)
    assert.match(keys.join('\n'), /br=2/); assert.match(keys.join('\n'), /cg=nocost/); assert.match(keys.join('\n'), /o=2/)
    // the first asker's entry is still there and still shared
    w.tick(1000)
    const again = await mod.overview.loadDashboardStockOverview(w.env, asker(w, { branchScope: '2' }))
    assert.equal(heavy(w.cdb), expected, 'and each entry is a hit for its own asker')
    assert.ok(again.asOf)
  })

  await check('KEY: an asker who is not named gets an uncached compute, every time', async () => {
    for (const missing of ['org', 'branchScope', 'costGrant']) {
      const w = world({ switchOn: true })
      const mod = w.isolate()
      const ctx = asker(w)
      delete ctx[missing]
      await mod.overview.loadDashboardStockOverview(w.env, ctx)
      await mod.overview.loadDashboardStockOverview(w.env, ctx)
      await Promise.all(w.waits.splice(0))
      assert.equal(heavy(w.cdb), 6, `no ${missing}: two computes`)
      assert.equal(w.store.size, 0, `no ${missing}: nothing stored`)
    }
    // an empty branch scope is a real answer ("all branches"), not a missing one
    const w = world({ switchOn: true })
    await w.isolate().overview.loadDashboardStockOverview(w.env, asker(w, { branchScope: '' }))
    await Promise.all(w.waits.splice(0))
    assert.equal(w.store.size, 1)
  })

  await check('KEY: switching on or off never reads the other mode\'s entry, and keeps both', async () => {
    const state = { on: false }
    const w = world({ switchOn: () => state.on })
    const mod = w.isolate()
    await mod.overview.loadDashboardStockOverview(w.env, asker(w))
    await Promise.all(w.waits.splice(0))
    assert.equal(heavy(w.cdb), 3, 'off computed')
    state.on = true
    w.tick(1000)
    const onValue = await mod.overview.loadDashboardStockOverview(w.env, asker(w))
    await Promise.all(w.waits.splice(0))
    assert.equal(heavy(w.cdb), 6, 'on did not read the off entry: it computed its own')
    assert.equal(onValue.asOf, iso(w.ctx.now()))
    state.on = false
    w.tick(1000)
    const offAgain = await w.isolate().overview.loadDashboardStockOverview(w.env, asker(w))
    assert.equal(heavy(w.cdb), 6, 'back off: the off entry was kept, and is read from the shared cache')
    assert.notEqual(offAgain.asOf, onValue.asOf)
    assert.equal(w.store.size, 2)
  })

  await check('WIRING: compat.ts names the asker and returns stock_as_of; the loader has no window literal', async () => {
    const fs = require('node:fs'), path = require('node:path')
    const read = (rel) => fs.readFileSync(path.join(__dirname, '../src', rel), 'utf8').replace(/\r\n/g, '\n')
    const compat = read('routes/compat.ts')
    const ctx = compat.slice(compat.indexOf('function dashboardOverviewContext'), compat.indexOf('// NOTE: /users and /roles routes moved'))
    assert.match(ctx, /org: cacheIdentity\(c\)\.org/)
    assert.match(ctx, /branchScope: String\(c\.req\.query\('branchId'\) \|\| ''\)\.trim\(\)/)
    assert.match(ctx, /costGrant: canViewAcquisitionCosts\(c\.get\('user'\)\) \? 'cost' : 'nocost'/)
    assert.match(compat, /stock_as_of: stockOverview\.asOf/)
    const source = read('lib/dashboardStockOverview.ts')
    assert.match(source, /getPlanLimits\(env\)/)
    assert.match(source, /limits\.dashboardOverviewMaxAgeSeconds \* 1000/)
    assert.doesNotMatch(source.replace(/\/\/.*$/gm, ''), /\b300\b|\b5 \* 60\b|300_000|300000/, 'the window is a plan field, not a number in the loader')
    assert.match(read('lib/readSwitches.ts'), /KNOWN_READ_SWITCHES = \[[^\]]*'dash_overview_5m'/)
  })

  console.log(`\n${passed} dashboard overview 5-minute checks passed.`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
