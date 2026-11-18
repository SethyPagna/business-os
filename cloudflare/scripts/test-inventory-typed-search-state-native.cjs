// A typed search inside a check state (Not checked, Checked OK, Issues, Pending, a check day) lists only rows of that state.
// The list re-adds the family members and the same-name siblings of a matching row (so a family is shown whole); inside a check state those re-added rows meet the same restriction.
//   restricted     random worlds: every listed row is in the state, and every row of the state that matches the typed word is listed
//   unrestricted   the Products page and every Inventory list without a check state or day answer exactly as before: the same statements and the same payload as the unfixed source on the same worlds
// The unfixed source is planted by sourceEdits (the two helpers of routes/products.ts made inert); the fix must be killed by the restricted checks and must not move the unrestricted ones.
// Run: node scripts/test-inventory-typed-search-state-native.cjs
const assert = require('node:assert/strict')
const { createInvApp } = require('./harness/inv-app.cjs')

let checks = 0
function check(label, cond, detail) { if (!cond && detail) console.log(typeof detail === 'function' ? detail() : detail); assert.ok(cond, `FAIL: ${label}`); checks++; console.log(`  ok  ${label}`) }

const MOUNT = { '/api/products': 'routes/products.ts', '/api/inventory-checks/products': 'routes/inventoryCheckProducts.ts', '/api/inventory-checks': 'routes/inventoryChecks.ts' }
const PRODUCTS = 'routes/products.ts'
const T = (n) => `2026-11-${String(10 + Math.floor(n / 24)).padStart(2, '0')}T${String(n % 24).padStart(2, '0')}:00:00.000Z`
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

// The source as it was before the fix: the check terms of a typed search and the name-sibling test are inert.
const UNFIXED = { [PRODUCTS]: [
  ['const checkTermsOf = (options: { restrictIdsJson?: string; excludeIdsJson?: string }): string[] => [', 'const checkTermsOf = (_options: { restrictIdsJson?: string; excludeIdsJson?: string }): string[] => [] || ['],
  ['  if (!keep && !drop) return undefined', '  return undefined'],
] }

function load(raw, seedStockFixture, world) {
  seedStockFixture(raw.db, () => {
    for (const table of ['inventory_check_approvals', 'inventory_check_items', 'inventory_check_sessions', 'branch_stock', 'products']) raw.prepare(`DELETE FROM ${table}`).run()
    for (const p of world.products) {
      raw.prepare(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,brand,category,is_active,is_group,parent_id,created_at,updated_at)
        VALUES(?,?,?,?,0,9.5,38000,4,16000,?,?,?,?,?,?,'2026-09-01 00:00:00')`).run([p.id, p.name, p.group ? null : `SKU${p.id}`, p.group ? null : `88500${p.id}`, p.brand, p.cat, p.active === false ? 0 : 1, p.group ? 1 : 0, p.parent ?? null, `2026-09-${String(1 + (p.id % 25)).padStart(2, '0')} 00:00:00`])
    }
    world.counts.forEach((c, i) => {
      raw.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at) VALUES(?,NULL,1,72,?,'closed','{}',?,?)").run([`s${i}`, `Count ${i}`, c.at, c.at])
      raw.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at) VALUES(?,?,1,'{}',10,'{}',?,?,?,1,72,?)")
        .run([`s${i}`, c.product, c.state, c.state === 'issue' ? 8 : 10, c.state === 'issue' ? 'Short' : null, c.at])
    })
  })
}
const make = (world, sourceEdits = {}) => {
  const app = createInvApp({ mount: MOUNT, seed: (raw, seedStockFixture) => load(raw, seedStockFixture, world), sourceEdits })
  app.setSwitch('ic_wired', 'on'); app.setSwitch('ic_fix_stock', 'on'); app.setUser(app.users.checker)
  return app
}
// Names are shared by several rows (same-name duplicates, the usual family), some families have a header row and parent-linked members (the other way a family is shown whole).
function randomWorld(seed) {
  const r = prng(seed), pick = (n) => Math.floor(r() * n)
  const names = ['Aloe Gel', 'Beauty Balm', 'Camellia Oil', 'Dew Mist']
  const products = []
  let id = 100
  for (const name of names) {
    const linked = r() > 0.5
    const header = linked ? id++ : null
    if (linked) products.push({ id: header, name, group: true, brand: 'Brand', cat: 'Cat' })
    for (let i = 0, n = 2 + pick(4); i < n; i++) products.push({ id: id++, name, parent: header ?? undefined, active: r() > 0.12, brand: pick(2) ? 'Brand' : 'Other', cat: pick(2) ? 'Cat' : 'Dog' })
  }
  const members = products.filter((p) => !p.group)
  const counts = []
  for (let i = 0, n = pick(members.length * 2); i < n; i++) counts.push({ product: members[pick(members.length)].id, state: r() > 0.35 ? 'done' : 'issue', at: T(i * 7 % 70 + 1) })
  const seen = new Set()
  return { products, counts: counts.filter((c) => { const k = `${c.product}:${c.at}`; if (seen.has(k)) return false; seen.add(k); return true }) }
}
// The Worker re-reads its read switches when its 15 s memo has run out, which adds one statement to whichever request comes at that moment: it is not part of what a list reads, so it is left out of the comparison.
const listReads = (statements) => JSON.stringify(statements.filter((sql) => !sql.includes('FROM system_flags WHERE key IN (@switches, @epoch)')))
const idsOf = (res) => ((res.json && res.json.items) || []).map((row) => row.id).sort((a, b) => a - b)
const list = (app, query) => app.get(`/api/inventory-checks/list?branchId=1&pageSize=100&${query}`)

// The requests that carry no check state and no check day. They must read and answer exactly as before the fix.
const UNRESTRICTED = ['query=Aloe', 'query=Camellia&page=1', 'query=Dew&brand=Brand', 'query=Beauty&groupBy=checked', 'query=Aloe&stockState=in_stock', 'page=2&pageSize=3', 'groupBy=checked', 'brand=Other&category=Dog']
const PRODUCT_PAGE = ['/api/products/search?query=Aloe&pageSize=50&include=branch_stock', '/api/products/search?query=Dew&pageSize=2&page=2&include=branch_stock', '/api/products/search?query=Camellia&pageSize=50&branchId=1&include=branch_stock']

;(async () => {
  let strays = 0, listed = 0, compared = 0, differing = 0
  for (let seed = 1; seed <= 14; seed++) {
    const world = randomWorld(seed)
    const app = make(world), unfixed = make(world, UNFIXED)
    for (const a of [app, unfixed]) { a.setSwitch('catalog_ranked_scope', seed % 2 ? 'on' : 'off') }
    // the state sets, from the taps with no search text
    const state = {}
    for (const s of ['not_checked', 'ok', 'issue']) state[s] = new Set(idsOf(await list(app, `checkState=${s}`)))
    const days = ((await app.get('/api/inventory-checks/list?branchId=1')).json.summary || {}).days || []
    for (const word of ['Aloe', 'Beauty', 'Camellia', 'Dew']) {
      for (const s of ['not_checked', 'ok', 'issue']) {
        const got = idsOf(await list(app, `checkState=${s}&query=${encodeURIComponent(word)}`))
        const matching = world.products.filter((p) => !p.group && p.name.startsWith(word) && state[s].has(p.id)).map((p) => p.id)
        const stray = got.filter((id) => !state[s].has(id))
        strays += stray.length; listed += got.length
        check(`seed ${seed} "${word}" in ${s}: every listed row is in the state${stray.length ? ` (stray ${stray})` : ''} and every matching row of the state is listed`, stray.length === 0 && matching.every((id) => got.includes(id)), () => JSON.stringify({ got, stray, matching }))
        const before = idsOf(await list(unfixed, `checkState=${s}&query=${encodeURIComponent(word)}`))
        if (JSON.stringify(before) !== JSON.stringify(got)) differing++
      }
    }
    for (const day of days.slice(0, 2)) {
      const dayIds = new Set(idsOf(await list(app, `checkedOn=${day.day}`)))
      const got = idsOf(await list(app, `checkedOn=${day.day}&query=Aloe`))
      check(`seed ${seed} a check day with a typed search lists only rows counted that day`, got.every((id) => dayIds.has(id)), () => JSON.stringify({ got, day: [...dayIds] }))
    }
    // unrestricted: the same statements and the same answer as the unfixed source
    for (const request of UNRESTRICTED) {
      const m1 = app.mark(), m2 = unfixed.mark()
      const fixedRes = await list(app, request), oldRes = await list(unfixed, request)
      compared++
      check(`seed ${seed} no state "${request}": the same statements and the same answer as before the fix`, listReads(app.since(m1)) === listReads(unfixed.since(m2)) && JSON.stringify(fixedRes.json) === JSON.stringify(oldRes.json) && fixedRes.status === oldRes.status)
    }
    for (const url of PRODUCT_PAGE) {
      const m1 = app.mark(), m2 = unfixed.mark()
      const fixedRes = await app.get(url), oldRes = await unfixed.get(url)
      compared++
      check(`seed ${seed} the Products page "${url.slice(20, 60)}": the same statements and the same answer as before the fix`, listReads(app.since(m1)) === listReads(unfixed.since(m2)) && JSON.stringify(fixedRes.json) === JSON.stringify(oldRes.json) && fixedRes.status === oldRes.status)
    }
  }
  console.log(`  ${listed} rows listed in ${strays} strays; ${differing} restricted requests answer differently from the unfixed source; ${compared} unrestricted requests compared`)
  check('the unfixed source fails the restricted checks (the positive control: some world has a checked sibling under Not checked)', differing > 0)
  console.log(`PASS test-inventory-typed-search-state-native (${checks} checks)`)
  process.exit(0)
})().catch((error) => { console.error(error); process.exit(1) })
