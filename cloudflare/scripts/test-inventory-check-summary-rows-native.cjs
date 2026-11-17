// The Inventory status counts (Not checked / Checked OK / Issues / Pending) over the real routes and migrations. One summary object, built by lib/inventoryCheckList.ts readCheckSummary, answers /list (when the
// request names a branch) and /overlay (always):
//   unit        the product ROW (one barcode), never a name family
//   population  the rows the unfiltered list can show: catalogProductSql, an active product; a row that left the list is in no figure
//   figures     ok / issue / pending = rows of that population whose LATEST count at the branch has the state; total = the population; not_checked = total - ok - issue
//   tap         a chip's number is the number of rows its tap lists (checkState=...)
//   reads       one statement for the population on a cold cache, none on a warm one; the key moves with the inventory_checks version AND the products version
// A brute-force oracle over random catalogues pins the figures, and planted mutants (families, no population, earliest count, swapped states, the old clamp, a key without the products version) must each be caught.
// Run: node scripts/test-inventory-check-summary-rows-native.cjs
const assert = require('node:assert/strict')
const { createInvApp } = require('./harness/inv-app.cjs')

let checks = 0
function check(label, cond, detail) { if (!cond && detail) console.log(typeof detail === 'function' ? detail() : detail); assert.ok(cond, `FAIL: ${label}`); checks++; console.log(`  ok  ${label}`) }

const MOUNT = { '/api/products': 'routes/products.ts', '/api/inventory-checks/products': 'routes/inventoryCheckProducts.ts', '/api/inventory-checks': 'routes/inventoryChecks.ts' }
const LIST = 'lib/inventoryCheckList.ts'
const T = (n) => `2026-11-${String(10 + Math.floor(n / 24)).padStart(2, '0')}T${String(n % 24).padStart(2, '0')}:00:00.000Z`

// A world: products [{ id, name, active, stock }], and counts [{ branch, product, state, at }] (each its own session, so a product can have several).
function load(raw, seedStockFixture, world) {
  seedStockFixture(raw.db, () => {
    for (const table of ['inventory_check_approvals', 'inventory_check_items', 'inventory_check_sessions', 'branch_stock', 'products']) raw.prepare(`DELETE FROM ${table}`).run()
    for (const p of world.products) {
      raw.prepare(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,brand,category,is_active,created_at,updated_at)
        VALUES(?,?,?,?,?,9.5,38000,4,16000,'Brand','Cat',?,?,'2026-09-01 00:00:00')`).run([p.id, p.name, `SKU${p.id}`, `88500${p.id}`, p.stock, p.active ? 1 : 0, `2026-09-${String(1 + (p.id % 25)).padStart(2, '0')} 00:00:00`])
      if (p.stock) raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,?)').run([p.id, p.stock])
    }
    world.counts.forEach((c, i) => {
      const sid = `s${i}`
      raw.prepare(`INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at) VALUES(?,NULL,?,72,?,'closed','{}',?,?)`).run([sid, c.branch, `Count ${i}`, c.at, c.at])
      raw.prepare(`INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at)
        VALUES(?,?,?,'{}',10,'{}',?,?,?,1,72,?)`).run([sid, c.product, c.branch, c.state, c.state === 'issue' ? 8 : 10, c.state === 'issue' ? 'Short' : null, c.at])
    })
    for (const id of world.pending ?? []) {
      raw.prepare(`INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at) VALUES(?,NULL,1,72,'Waiting','open','{}',?,?)`).run([`p${id}`, T(100), T(100)])
      raw.prepare(`INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at)
        VALUES(?,?,1,'{}',10,'{}','done',7,NULL,1,72,?)`).run([`p${id}`, id, T(100)])
      raw.prepare(`INSERT INTO inventory_check_approvals(session_id,organization_id,branch_id,status,lines,submitted_by,submitted_at,baselines_json) VALUES(?,NULL,1,'pending',1,72,?,?)`).run([`p${id}`, T(100), `{"${id}":10}`])
    }
  })
}
// The brute-force truth for one branch: population = active products, latest count per product, pending among the population.
function oracle(world, branch, withPending) {
  const active = new Set(world.products.filter((p) => p.active).map((p) => p.id))
  const latest = new Map()
  // A count waiting for approval is a done count at T(100), later than every other count
  const all = [...world.counts, ...(world.pending ?? []).map((product) => ({ branch: 1, product, state: 'done', at: T(100) }))]
  for (const c of all) if (c.branch === branch && (c.state === 'done' || c.state === 'issue')) { const had = latest.get(c.product); if (!had || c.at >= had.at) latest.set(c.product, c) }
  const ok = [...latest.values()].filter((c) => active.has(c.product) && c.state === 'done').map((c) => c.product).sort((a, b) => a - b)
  const issue = [...latest.values()].filter((c) => active.has(c.product) && c.state === 'issue').map((c) => c.product).sort((a, b) => a - b)
  const checked = new Set([...ok, ...issue])
  const notChecked = [...active].filter((id) => !checked.has(id)).sort((a, b) => a - b)
  const pending = branch === 1 ? (world.pending ?? []).filter((id) => active.has(id)).sort((a, b) => a - b) : []
  return { ok, issue, notChecked, pending, total: active.size, ...(withPending ? {} : {}) }
}
const make = (world, sourceEdits = {}) => {
  const app = createInvApp({ mount: MOUNT, seed: (raw, seedStockFixture) => load(raw, seedStockFixture, world), sourceEdits })
  app.setSwitch('ic_wired', 'on'); app.setSwitch('ic_fix_stock', 'on')
  return app
}
const rows = (n, name, start) => Array.from({ length: n }, (_, i) => ({ id: start + i, name, active: true, stock: 0 }))
// F3: 3 names x 3 rows, 4 rows checked: the old formula max(0, 3 families - 4 checked) said 0; 5 rows are unchecked.
const F3 = { products: [...rows(3, 'Aloe Gel', 100), ...rows(3, 'Beauty Balm', 110), ...rows(3, 'Camellia Oil', 120)],
  counts: [100, 101, 110, 120].map((product, i) => ({ branch: 1, product, state: 'done', at: T(i) })) }
const ids = (r) => ((r.json && r.json.items) || []).map((x) => x.id).sort((a, b) => a - b)
const fresh = (app) => { app.setUser(app.users.checker); app.clearCaches(); app.kv.clear() }
const retire = (a, id) => a.seedStockFixture(a.raw.db, () => { a.raw.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run([id]) })
const summaryOf = async (app, url = '/api/inventory-checks/list?branchId=1') => (await app.get(url)).json.summary
const figures = (s) => ({ ok: s.ok, issue: s.issue, not_checked: s.not_checked, total: s.total })

async function figuresMatchOracle(app, world, branch, label) {
  fresh(app)
  const truth = oracle(world, branch, true)
  const fromList = await summaryOf(app, `/api/inventory-checks/list?branchId=${branch}`)
  const fromOverlay = await summaryOf(app, `/api/inventory-checks/overlay?branchId=${branch}&ids=${world.products.slice(0, 5).map((p) => p.id).join(',') || 0}`)
  const want = { ok: truth.ok.length, issue: truth.issue.length, not_checked: truth.notChecked.length, total: truth.total }
  check(`${label}: /list figures are the rows (${JSON.stringify(want)})`, JSON.stringify(figures(fromList)) === JSON.stringify(want), () => JSON.stringify([fromList, want]))
  check(`${label}: /overlay sends the very same object`, JSON.stringify(fromOverlay) === JSON.stringify(fromList), () => JSON.stringify([fromOverlay, fromList]))
  return { fromList, truth }
}
async function tapsMatch(app, branch, truth, summary, label) {
  const tap = async (state) => ids(await app.get(`/api/inventory-checks/list?branchId=${branch}&checkState=${state}&pageSize=100`))
  for (const [state, expected, count] of [['ok', truth.ok, summary.ok], ['issue', truth.issue, summary.issue], ['not_checked', truth.notChecked, summary.not_checked]]) {
    const listed = await tap(state)
    check(`${label}: tapping ${state} lists exactly the ${count} rows the chip says`, listed.length === count && JSON.stringify(listed) === JSON.stringify(expected), () => JSON.stringify([state, listed, expected, count]))
  }
}

// ---- mulberry32, so a failing world can be replayed ---------------------------------------------------------------------------------------------------------------------------------------------
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
function randomWorld(seed) {
  const r = prng(seed), pick = (n) => Math.floor(r() * n)
  const names = ['Aloe', 'Beauty', 'Camellia', 'Dew', 'Elder'], count = 6 + pick(20)
  const products = Array.from({ length: count }, (_, i) => ({ id: 200 + i, name: `${names[pick(names.length)]} ${pick(3)}`, active: r() > 0.25, stock: 0 }))
  for (const p of products) p.stock = p.active && r() > 0.5 ? pick(9) : 0
  const counts = []
  for (let i = 0, n = pick(count * 2); i < n; i++) counts.push({ branch: 1 + (r() > 0.7 ? 1 : 0), product: 200 + pick(count + 3), state: r() > 0.4 ? 'done' : 'issue', at: T(pick(70)) })
  // two counts of one product at the same instant would make "latest" depend on the session id; the oracle and the SQL break that tie the same way only if the times differ
  const seen = new Set(); const unique = counts.filter((c) => { const k = `${c.branch}:${c.product}:${c.at}`; if (seen.has(k)) return false; seen.add(k); return true })
  const pending = products.filter(() => r() > 0.85).map((p) => p.id)
  return { products, counts: unique, pending }
}

;(async () => {
  // ---- F3: families are not rows -------------------------------------------------------------------------------------------------------------------------------------------------------------
  const app = make(F3)
  fresh(app)
  const f3 = await summaryOf(app)
  check('3 names x 3 rows with 4 rows checked: Not checked is 5 (the family formula said 0), total 9, ok 4', f3.not_checked === 5 && f3.total === 9 && f3.ok === 4 && f3.issue === 0, () => JSON.stringify(f3))
  const f3Truth = oracle(F3, 1, true)
  await tapsMatch(app, 1, f3Truth, f3, 'F3')
  const notCheckedList = await app.get('/api/inventory-checks/list?branchId=1&checkState=not_checked&pageSize=100')
  check('tapping Not checked lists only the unchecked children of a family, never its checked siblings (100 and 101 are absent)', !ids(notCheckedList).includes(100) && !ids(notCheckedList).includes(101) && ids(notCheckedList).includes(102), () => JSON.stringify(ids(notCheckedList)))

  // ---- the sole-branch path: no branch in /list, so the overlay carries the figures ----------------------------------------------------------------------------------------------------------------
  fresh(app)
  const noBranch = await app.get('/api/inventory-checks/list')
  check('a list that names no branch carries no summary (the sole-branch open leaves the branch out to share Products\' cache)', noBranch.status === 200 && !('summary' in noBranch.json))
  const overlay = await app.get('/api/inventory-checks/overlay?branchId=1&ids=100,101,102')
  check('the overlay of that open carries the whole summary: Not checked 5, total 9', overlay.json.summary && overlay.json.summary.not_checked === 5 && overlay.json.summary.total === 9 && Array.isArray(overlay.json.summary.days), () => JSON.stringify(overlay.json.summary))
  check('summary=0 leaves it out of both routes', !('summary' in (await app.get('/api/inventory-checks/overlay?branchId=1&ids=100&summary=0')).json) && !('summary' in (await app.get('/api/inventory-checks/list?branchId=1&summary=0')).json))
  check('a filtered list (brand, search, state, day) carries the same branch-wide figures as the unfiltered one', JSON.stringify(await summaryOf(app, '/api/inventory-checks/list?branchId=1&checkState=ok&query=Aloe')) === JSON.stringify(f3)
    && JSON.stringify(await summaryOf(app, '/api/inventory-checks/list?branchId=1&brand=Brand&page=2&pageSize=2')) === JSON.stringify(f3))

  // ---- a row that left the list is in no figure; the list's own predicate decides ---------------------------------------------------------------------------------------------------------------
  const left = { products: [{ id: 300, name: 'Retired', active: false, stock: 0 }, { id: 301, name: 'Retired twin', active: false, stock: 0 }, { id: 302, name: 'Live', active: true, stock: 1 }, { id: 303, name: 'Live two', active: true, stock: 0 }],
    counts: [{ branch: 1, product: 300, state: 'done', at: T(1) }, { branch: 1, product: 301, state: 'issue', at: T(2) }, { branch: 1, product: 302, state: 'done', at: T(3) }], pending: [300, 302] }
  const leftApp = make(left)
  fresh(leftApp)
  const leftSummary = await summaryOf(leftApp)
  check('counts on a retired product are in no figure (migration 0242 makes a retired product holding stock unreachable, so the one predicate of the list is the active flag): ok 1, issue 0, total 2, Not checked 1', figures(leftSummary).ok === 1 && leftSummary.issue === 0 && leftSummary.total === 2 && leftSummary.not_checked === 1, () => JSON.stringify(leftSummary))
  check('the list shows exactly those two rows (the predicate is the list\'s own)', JSON.stringify(ids(await leftApp.get('/api/inventory-checks/list?branchId=1&pageSize=100'))) === '[302,303]')
  check('pending (Fix stock on) counts only rows of the list: 302, not the retired 300', leftSummary.pending === 1, () => JSON.stringify(leftSummary))
  const pendingTap = ids(await leftApp.get('/api/inventory-checks/list?branchId=1&checkState=pending&pageSize=100'))
  check('and tapping Waiting for approval lists that one row', JSON.stringify(pendingTap) === '[302]', () => JSON.stringify(pendingTap))
  leftApp.setSwitch('ic_fix_stock', undefined); leftApp.clearCaches(); leftApp.kv.clear()
  check('Fix stock off: no pending key at all, the other figures unchanged', !('pending' in await summaryOf(leftApp)) && (await summaryOf(leftApp)).ok === 1)
  leftApp.setSwitch('ic_fix_stock', 'on'); leftApp.setUser(leftApp.users.receivedOnly); leftApp.clearCaches(); leftApp.kv.clear()
  const blind = await summaryOf(leftApp)
  check('a viewer without the stock field gets no pending and the same figures', !('pending' in blind) && blind.ok === 1 && blind.total === 2)

  // ---- latest count only ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const twice = { products: rows(3, 'Twice', 400), counts: [{ branch: 1, product: 400, state: 'issue', at: T(1) }, { branch: 1, product: 400, state: 'done', at: T(9) }, { branch: 1, product: 401, state: 'done', at: T(2) }, { branch: 1, product: 401, state: 'done', at: T(8) }, { branch: 1, product: 402, state: 'issue', at: T(4) }, { branch: 2, product: 400, state: 'issue', at: T(3) }] }
  const twiceApp = make(twice); fresh(twiceApp)
  const tw = await summaryOf(twiceApp)
  check('several counts of one row: only the latest counts (400 was an issue and is now ok, 401 twice ok, 402 an issue); another branch has its own', tw.ok === 2 && tw.issue === 1 && tw.not_checked === 0 && tw.total === 3, () => JSON.stringify(tw))
  check('days follow the rows too: the chips count the rows whose latest count was that day', JSON.stringify(tw.days) === JSON.stringify([{ day: '2026-11-10', count: 3 }]), () => JSON.stringify(tw.days))
  const daysWorld = { products: [{ id: 410, name: 'Gone', active: false, stock: 0 }, { id: 411, name: 'Here', active: true, stock: 0 }], counts: [{ branch: 1, product: 410, state: 'done', at: T(30) }, { branch: 1, product: 411, state: 'done', at: T(1) }] }
  const daysApp = make(daysWorld); fresh(daysApp)
  check('a day whose only count was on a retired product is no chip (its tap would list nothing)', JSON.stringify((await summaryOf(daysApp)).days) === JSON.stringify([{ day: '2026-11-10', count: 1 }]))

  // ---- tooLarge -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const bigApp = make(F3)
  bigApp.raw.exec(`INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at) VALUES('sBig',NULL,1,71,'Big','closed','{}','2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z');
    WITH RECURSIVE n(i) AS (SELECT 20000 UNION ALL SELECT i+1 FROM n WHERE i<22100)
    INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,revision,updated_by,updated_at) SELECT 'sBig',i,1,'{}',1,'{}','done',1,1,71,'2026-11-04T00:00:00.000Z' FROM n`)
  bigApp.setUser(bigApp.users.checker); bigApp.clearCaches()
  const free = { ...bigApp.env, PLAN_TIER: 'free' }
  check('too many checked products (Free): both routes say { tooLarge: true } and nothing else', JSON.stringify((await bigApp.get('/api/inventory-checks/list?branchId=1', free)).json.summary) === '{"tooLarge":true}' && JSON.stringify((await bigApp.get('/api/inventory-checks/overlay?branchId=1&ids=100', free)).json.summary) === '{"tooLarge":true}')

  // ---- reads ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const TOTAL = /COUNT\(\*\) AS n FROM products p/, CHECKED = /SELECT p\.id AS id FROM products p WHERE \+p\.is_active = 1 AND p\.id IN/, POP = /COUNT\(\*\) AS n FROM products p|SELECT p\.id AS id FROM products p WHERE \+p\.is_active = 1 AND p\.id IN/
  fresh(app)
  let mark = app.mark(); await app.get('/api/inventory-checks/list?branchId=1')
  const coldTotal = app.since(mark).filter((s) => TOTAL.test(s)).length, coldChecked = app.since(mark).filter((s) => CHECKED.test(s)).length, coldSets = app.since(mark).filter((s) => /inventory_check_(items|sessions|approvals)/.test(s)).length
  check(`a cold list reads the sets (${coldSets} statements, as before), ONE count of the population and ONE seek of the checked ids`, coldTotal === 1 && coldChecked === 1 && coldSets === 2, `${coldTotal} ${coldChecked} ${coldSets}`)
  mark = app.mark(); await app.get('/api/inventory-checks/overlay?branchId=1&ids=100,101')
  check('the overlay right after it reads no population and no check-state statement (the same cached summary)', app.since(mark).filter((s) => POP.test(s) || /ROW_NUMBER\(\) OVER/.test(s)).length === 0)
  mark = app.mark(); await app.get('/api/inventory-checks/list?branchId=1&page=2&pageSize=3'); await app.get('/api/inventory-checks/list?branchId=1&checkState=ok')
  check('a page step and a filter on the warm cache read none either', app.since(mark).filter((s) => POP.test(s) || /ROW_NUMBER\(\) OVER/.test(s)).length === 0)
  // A count saved moves the inventory_checks version only: the checked ids are looked at again, the catalogue is not counted again.
  await app.load('lib/cache.ts').bumpVersion(app.env, 'inventory_checks')
  mark = app.mark(); await app.get('/api/inventory-checks/list?branchId=1')
  check('after a count was saved the catalogue is not counted again (the total is cached on the products version alone), the checked ids are', app.since(mark).filter((s) => TOTAL.test(s)).length === 0 && app.since(mark).filter((s) => CHECKED.test(s)).length === 1)
  // A product leaving the list moves the products version: the figures follow, no stale total.
  retire(app, 101)
  await app.load('lib/cache.ts').bumpVersion(app.env, 'products')
  const afterRetire = await summaryOf(app)
  check('retiring a checked row moves the products version: the next answer has total 8, ok 3, Not checked 5', afterRetire.total === 8 && afterRetire.ok === 3 && afterRetire.not_checked === 5, () => JSON.stringify(afterRetire))

  // ---- the oracle: random catalogues, several counts per row, active and stock states -----------------------------------------------------------------------------------------
  for (let seed = 1; seed <= 24; seed++) {
    const world = randomWorld(seed)
    const prop = make(world)
    for (const branch of [1, 2]) {
      const { fromList, truth } = await figuresMatchOracle(prop, world, branch, `world ${seed} branch ${branch}`)
      if (branch === 1) {
        check(`world ${seed}: pending is the pending rows of the list (${truth.pending.length})`, (fromList.pending ?? 0) === truth.pending.length, () => JSON.stringify([fromList.pending, truth.pending]))
        await tapsMatch(prop, branch, truth, fromList, `world ${seed}`)
      }
    }
  }

  // ---- mutants ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const mutate = async (name, edits, world, probe) => {
    const mutant = make(world, edits); fresh(mutant)
    let caught = false
    try { caught = await probe(mutant) } catch { caught = true }
    check(`mutant "${name}" is caught`, caught === true)
  }
  const wrong = async (m, world, branch = 1) => { const s = await summaryOf(m, `/api/inventory-checks/list?branchId=${branch}`); const t = oracle(world, branch, false); return JSON.stringify(figures(s)) !== JSON.stringify({ ok: t.ok.length, issue: t.issue.length, not_checked: t.notChecked.length, total: t.total }) }
  await mutate('name families instead of rows', { [LIST]: [['COUNT(*) AS n FROM products p', 'COUNT(DISTINCT p.name_key) AS n FROM products p']] }, F3, (m) => wrong(m, F3))
  await mutate('no population restriction', { [LIST]: [['const inList = (ids: readonly number[]) => ids.filter((id) => population.inList.has(id)).length', 'const inList = (ids: readonly number[]) => ids.length']] }, left, (m) => wrong(m, left))
  await mutate('the earliest count instead of the latest', { [LIST]: [['ORDER BY i.updated_at DESC, i.session_id DESC) AS rn', 'ORDER BY i.updated_at ASC, i.session_id ASC) AS rn']] }, twice, (m) => wrong(m, twice))
  await mutate('ok and issue swapped', { [LIST]: [['return { ok, issue,', 'return { ok: issue, issue: ok,']] }, twice, (m) => wrong(m, twice))
  await mutate('the old clamp over raw counts instead of the population rule', { [LIST]: [['not_checked: population.total - ok - issue,', 'not_checked: Math.max(0, population.total - sets.ok.length - sets.issue.length),']] }, left, (m) => wrong(m, left))
  await mutate('a cache key without the products version', { [LIST]: [['`icp:${version}:${products}`', '`icp:${version}`']] }, F3, async (m) => {
    await summaryOf(m); retire(m, 101); await m.load('lib/cache.ts').bumpVersion(m.env, 'products')
    return (await summaryOf(m)).total !== 8
  })
  await mutate('the total counted again after every saved count (keyed with the check version)', { [LIST]: [['`icn:${products}`', '`icn:${products}:${Math.random()}`']] }, F3, async (m) => {
    await m.get('/api/inventory-checks/list?branchId=1'); await m.load('lib/cache.ts').bumpVersion(m.env, 'inventory_checks'); const mark2 = m.mark(); await m.get('/api/inventory-checks/list?branchId=1')
    return m.since(mark2).filter((s) => TOTAL.test(s)).length !== 0
  })
  await mutate('the population read on every call (no cache)', { [LIST]: [['`icp:${version}:${products}`, getPlanLimits(env).productListCacheSeconds', '`icp:${version}:${products}:${Math.random()}`, getPlanLimits(env).productListCacheSeconds']] }, F3, async (m) => {
    await m.get('/api/inventory-checks/list?branchId=1'); const mark2 = m.mark(); await m.get('/api/inventory-checks/overlay?branchId=1&ids=100')
    return m.since(mark2).filter((s) => POP.test(s)).length !== 0
  })
  console.log(`PASS test-inventory-check-summary-rows-native (${checks} checks)`)
  process.exit(0)
})().catch((error) => { console.error(error); process.exit(1) })
