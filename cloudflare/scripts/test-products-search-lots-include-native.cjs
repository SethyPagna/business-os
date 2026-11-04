// INV-A S3 (Inventory replan 2.2): GET /api/products/search?include=lots folds each row's received dates (lots) into the Products answer, so a screen that
// counts or edits by received date reads them from the data it already holds instead of one GET /api/batches per product. Pinned here:
//  1. without the token nothing changes: no `lots` / `lots_more` on any row, no lots statement; with it, the rows minus the new keys are the plain rows;
//  2. PARITY: per product and branch, `lots` is GET /api/batches (same ids, same first-in-first-out order, same fields, the quantity at that branch). The one
//     documented difference: a lot with no branch row at all is not listed (the batches picker shows it at 0 everywhere);
//  3. money-free: no cost, payment or credit key in a lot and none in the statement;
//  4. ONE statement however many rows the page has, bound as a single json_each parameter; an empty page adds none;
//  5. capped per row at productListLotsPerRow (Free 20 / Paid 50), `lots_more: true` only when there are more, and the rows kept are the first in order;
//  6. read live after the page cache (a lot written after caching shows, the page query does not re-run);
//  7. only a caller the batches read admits (Inventory view, POS, Sales view) gets the key.
//
// Run: node scripts/test-products-search-lots-include-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

let checks = 0
function check(label, cond) { assert.ok(cond, `FAIL: ${label}`); checks++; console.log(`  ok  ${label}`) }

const person = (id, role, permissions) => ({ id, username: `u${id}`, name: `U${id}`, role_code: role, organization_id: null,
  permissions: JSON.stringify(permissions), role_permissions: JSON.stringify(permissions) })
const ADMIN = person(71, 'admin', { all: true })
const PRODUCTS_ONLY = person(72, 'employee', { products: true })
const POS_ONLY = person(73, 'employee', { products: true, pos: true })
let USER = ADMIN

const moduleCache = new Map()
const SRC = path.join(__dirname, '..', 'src')
const stubs = {
  'lib/audit.ts': { audit: async () => {} },
  'durable-objects/broadcastHub.ts': { broadcast: async () => {} },
}
function load(rel) {
  if (moduleCache.has(rel)) return moduleCache.get(rel).exports
  const mod = { exports: {} }
  moduleCache.set(rel, mod)
  const sourcePath = path.join(SRC, rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: sourcePath,
  }).outputText
  new Function('require', 'module', 'exports', output)((request) => {
    if (!request.startsWith('.')) return request.startsWith('cloudflare:') ? { DurableObject: class {} } : require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    const file = resolved.endsWith('.ts') ? resolved : `${resolved}.ts`
    if (stubs[file]) return stubs[file]
    if (file === 'lib/db.ts') return { ...load(file), getDb: (env) => env.DB }
    if (file === 'lib/auth.ts') return { ...load(file), requireAuth: async (c, next) => { c.set('user', USER); return next() }, getSessionUser: async () => USER }
    return load(file)
  }, mod, mod.exports)
  return mod.exports
}

const cacheStore = new Map()
globalThis.caches = {
  default: {
    match: async (request) => (cacheStore.has(request.url) ? new Response(cacheStore.get(request.url)) : undefined),
    put: async (request, response) => { cacheStore.set(request.url, await response.text()) },
  },
}
const kv = new Map()
const CACHE = { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, String(v)) }, delete: async (k) => { kv.delete(k) } }

const raw = openDb(loadAll())
seedStockFixture(raw.db, () => {
  raw.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1),(2,'Store',0,1)").run()
  for (const [id, name] of [[10, 'Powder Foundation'], [11, 'Powder Brush'], [12, 'Rose Serum']]) {
    raw.prepare(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active,updated_at)
      VALUES(?,?,?,?,5,9.5,38000,4,16000,1,'2026-09-01 00:00:00')`).run([id, name, `SKU${id}`, `88500000${id}`])
    raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,5)').run([id])
  }
})
let nextBatch = 100
// A lot with its branch rows ([branchId, quantity] pairs); cost, payment and credit are set so a leak would show.
const addLot = (productId, { expiry = null, received, lot = null, number = 1, supplier = null, active = 1, rows = [] }) => seedStockFixture(raw.db, () => {
  const id = nextBatch++
  raw.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,expiry_date,received_at,batch_number,unit_cost_usd,is_active,supplier_name,payment_status,credit_due_date)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run([id, productId, `K${id}`, lot ?? `L${id}`, expiry, received, number, 4.25, active, supplier, 'unpaid', '2027-02-02'])
  for (const [branchId, quantity] of rows) raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)').run([id, branchId, quantity])
  return id
})
// Product 10: five lots. FIFO is expiry (nulls last), received date, id.
const L_LATE_EXPIRY = addLot(10, { expiry: '2027-01-01', received: '2026-08-01', lot: 'A', number: 1, supplier: 'Dane', rows: [[1, 3], [2, 1]] })
const L_NO_EXPIRY = addLot(10, { received: '2026-07-01', lot: 'B', number: 2, rows: [[1, 2]] })
const L_EARLY_EXPIRY_ZERO = addLot(10, { expiry: '2026-12-01', received: '2026-09-01', lot: 'C', number: 3, supplier: 'Mei', rows: [[1, 0]] })
// Same (missing) expiry as B, received EARLIER, inserted LATER: only the received date puts it before B (the id would put it after).
const L_EARLIER_NULL = addLot(10, { received: '2026-06-15', lot: 'N', number: 6, rows: [[1, 1]] })
const L_INACTIVE = addLot(10, { expiry: '2026-11-01', received: '2026-06-01', lot: 'D', number: 4, active: 0, rows: [[1, 0]] })
const L_NO_ROW = addLot(10, { expiry: '2026-10-01', received: '2026-05-01', lot: 'E', number: 5, rows: [] })
addLot(11, { received: '2026-08-15', lot: 'F', number: 1, supplier: 'Dane', rows: [[2, 4]] })
addLot(12, { received: '2026-08-15', lot: 'G', number: 1, rows: [[1, 5]] }) // outside the "powder" page

let pageQueries = 0
const statements = []
const db = {
  prepare(sql) { statements.push(String(sql)); if (/\bmatched AS\b/.test(sql)) pageQueries++; return raw.prepare(sql) },
  batch: async (list) => { if (list.some((s) => /\bmatched AS\b/.test(s.sql))) pageQueries++; return raw.batch(list) },
  exec: (sql) => raw.exec(sql),
}
db.staging = db
const env = { DB: db, CACHE, ENVIRONMENT: 'test' }
const app = new Hono()
app.route('/api/products', load('routes/products.ts').default)
app.route('/api/batches', load('routes/batches.ts').default)

async function get(url, withEnv = env) {
  load('lib/planTier.ts').__resetPlanTierCacheForTests() // the tier is memoised per isolate; this run asks as both
  const waits = []
  const response = await app.request(`http://localhost${url}`, {}, withEnv, { waitUntil: (p) => waits.push(p), passThroughOnException() {} })
  const text = await response.text()
  await Promise.all(waits)
  return { status: response.status, json: JSON.parse(text) }
}
const lotStatements = () => statements.filter((sql) => /product_batches/.test(sql) && /json_each/.test(sql))
const marker = () => statements.length
const since = (mark) => statements.slice(mark)

;(async () => {
  const LIST = '/api/products/search?query=powder&page=1&pageSize=20&sort=name_asc'
  const PLAIN = `${LIST}&include=branch_stock,images,batches,tagged_lots`
  const WITH = `${PLAIN},lots`

  // 1. the token is additive
  let mark = marker()
  const plain = await get(PLAIN)
  check(`plain list answers 200 (${plain.status})`, plain.status === 200)
  check('without the token no row has lots or lots_more and no lots statement ran', plain.json.items.every((r) => !('lots' in r) && !('lots_more' in r)) && !since(mark).some((sql) => /json_each/.test(sql) && /product_batches/.test(sql)))
  mark = marker()
  const folded = await get(WITH)
  check(`list with the token answers 200 (${folded.status})`, folded.status === 200)
  const strip = (items) => items.map(({ lots: _l, lots_more: _m, ...rest }) => rest)
  check('the rows minus lots / lots_more are exactly the plain rows (same order, same fields)', JSON.stringify(strip(folded.json.items)) === JSON.stringify(plain.json.items))
  check('payload keys other than items are unchanged', JSON.stringify({ ...folded.json, items: null }) === JSON.stringify({ ...plain.json, items: null }))
  const ids = folded.json.items.map((r) => r.id)
  check('page holds exactly the two powder products', ids.length === 2 && ids.includes(10) && ids.includes(11))
  check('every row carries a lots array', folded.json.items.every((r) => Array.isArray(r.lots)))

  // 4. one statement for the page, one parameter
  check('exactly one lots statement for the whole page', lotStatements().length === 1)
  check('the ids are bound as ONE json_each parameter, not an IN list of bound ids', lotStatements()[0].includes('json_each(@ids)') && !/IN\s*\(\s*@\w+\d/.test(lotStatements()[0]))

  // 3. money-free
  check('no cost, payment or credit word in the statement', !/cost|payment|credit|price/i.test(lotStatements()[0]))
  check('no cost, payment or credit key in any lot', !/cost|payment|credit|price/i.test(JSON.stringify(folded.json.items.map((r) => r.lots))))

  // 2. parity with GET /api/batches
  const row10 = folded.json.items.find((r) => r.id === 10)
  check('lot row shape is exactly the listed keys', row10.lots.every((l) => JSON.stringify(Object.keys(l)) === JSON.stringify(['id', 'received_at', 'expiry_date', 'lot_code', 'batch_number', 'supplier_name', 'branches'])))
  check('FIFO: soonest expiry first, no expiry last, then received date (N before B although inserted after it): C, A, N, B', row10.lots.map((l) => l.lot_code).join(',') === 'C,A,N,B' && L_EARLIER_NULL > L_NO_EXPIRY)
  check('the inactive lot and the lot with no branch row are not listed; the zero-quantity row is', !row10.lots.some((l) => [L_INACTIVE, L_NO_ROW].includes(l.id)) && row10.lots.some((l) => l.id === L_EARLY_EXPIRY_ZERO))
  check('a branch row at 0 is listed (C: shop 0), so a Set to 0 and back has a row to patch', JSON.stringify(row10.lots.find((l) => l.id === L_EARLY_EXPIRY_ZERO).branches) === JSON.stringify([{ branch_id: 1, quantity: 0 }]))
  check('a lot lists its branch rows (A: shop 3, store 1)', JSON.stringify(row10.lots.find((l) => l.id === L_LATE_EXPIRY).branches.map((b) => [b.branch_id, b.quantity]).sort()) === JSON.stringify([[1, 3], [2, 1]]))
  for (const row of folded.json.items) {
    for (const branchId of [1, 2]) {
      const batches = await get(`/api/batches?productId=${row.id}&branchId=${branchId}`)
      check(`/api/batches answers for product ${row.id} branch ${branchId}`, batches.status === 200)
      const listed = batches.json.batches.filter((b) => row.lots.some((l) => l.id === b.id))
      const unlisted = batches.json.batches.filter((b) => !row.lots.some((l) => l.id === b.id))
      check(`product ${row.id} branch ${branchId}: same lots in the same order`, JSON.stringify(listed.map((b) => b.id)) === JSON.stringify(row.lots.map((l) => l.id)))
      check(`product ${row.id} branch ${branchId}: same fields and the quantity at that branch`, row.lots.every((l, i) => {
        const b = listed[i]
        const here = l.branches.find((x) => x.branch_id === branchId)
        return b.received_at === l.received_at && b.expiry_date === l.expiry_date && b.lot_code === l.lot_code && b.batch_number === l.batch_number
          && b.supplier_name === l.supplier_name && b.quantity === (here ? here.quantity : 0)
      }))
      check(`product ${row.id} branch ${branchId}: what the picker lists beyond the lots is only lots with no branch row, at 0`, unlisted.every((b) => b.quantity === 0 && b.id === L_NO_ROW))
    }
  }

  // empty page: no lots statement
  mark = marker()
  const empty = await get('/api/products/search?query=zzzznomatch&page=1&pageSize=20&include=branch_stock,lots')
  check(`an empty page answers 200 (${empty.status}) with no rows and no lots statement`, empty.status === 200 && empty.json.items.length === 0 && lotStatements().length === 1 && !since(mark).some((sql) => /json_each/.test(sql) && /product_batches/.test(sql)))

  // 6. live after the cache
  const beforeQueries = pageQueries
  addLot(11, { received: '2026-09-20', lot: 'H', number: 2, rows: [[1, 6]] })
  const after = await get(WITH)
  check('cache hit: the page query did not re-run', pageQueries === beforeQueries)
  const row11 = after.json.items.find((r) => r.id === 11)
  check('LIVE: a lot written after the page was cached is in lots', row11.lots.some((l) => l.lot_code === 'H' && l.branches.some((b) => b.branch_id === 1 && b.quantity === 6)))

  // 5. the cap
  const free = { ...env, PLAN_TIER: 'free' }
  const paid = { ...env, PLAN_TIER: 'paid' }
  const { PLAN_LIMITS_BY_TIER } = load('lib/planTier.ts')
  const FREE_CAP = PLAN_LIMITS_BY_TIER.free.productListLotsPerRow
  const PAID_CAP = PLAN_LIMITS_BY_TIER.paid.productListLotsPerRow
  check(`the caps are the plan fields (Free ${FREE_CAP}, Paid ${PAID_CAP}), Free smaller`, FREE_CAP === 20 && PAID_CAP === 50 && FREE_CAP < PAID_CAP)
  // An active lot with no branch row that would rank FIRST: it must not take a place under the cap (the statement ranks only lots that have a row).
  const NOROW_11 = addLot(11, { expiry: '2026-01-01', received: '2026-01-01', lot: 'NR', number: 50, rows: [] })
  const have11 = (await get(WITH, free)).json.items.find((r) => r.id === 11).lots.length
  for (let n = have11; n < FREE_CAP; n++) addLot(11, { received: `2026-10-${String(1 + (n % 28)).padStart(2, '0')}`, lot: `M${n}`, number: 10 + n, rows: [[1, 1]] })
  const exact = (await get(WITH, free)).json.items.find((r) => r.id === 11)
  check(`exactly ${FREE_CAP} lots on Free: all listed, no lots_more`, exact.lots.length === FREE_CAP && exact.lots_more !== true)
  const lastLot = addLot(11, { received: '2026-11-30', lot: 'LAST', number: 99, rows: [[1, 1]] })
  const over = (await get(WITH, free)).json.items.find((r) => r.id === 11)
  check(`${FREE_CAP + 1} lots on Free: ${FREE_CAP} listed and lots_more is true`, over.lots.length === FREE_CAP && over.lots_more === true)
  check('the lot left out is the last in order, not an arbitrary one', !over.lots.some((l) => l.id === lastLot))
  const overPaid = (await get(WITH, paid)).json.items.find((r) => r.id === 11)
  check(`the same ${FREE_CAP + 1} lots on Paid: all listed, no lots_more`, overPaid.lots.length === FREE_CAP + 1 && overPaid.lots_more !== true)
  check('a row inside the cap has no lots_more key beyond true (row 10 has 3 lots)', (await get(WITH, free)).json.items.find((r) => r.id === 10).lots_more !== true)
  const everyLot = (await get('/api/batches?productId=11&branchId=1')).json.batches.map((b) => b.id).filter((id) => id !== NOROW_11) // product 11 has no lot without a branch row, so this is the whole first-in-first-out list
  check('the kept lots are exactly the first ' + FREE_CAP + ' of that list, in its order', JSON.stringify(over.lots.map((l) => l.id)) === JSON.stringify(everyLot.slice(0, FREE_CAP)) && everyLot.length === FREE_CAP + 1)

  // 7. who gets the key
  USER = PRODUCTS_ONLY
  const denied = await get(WITH)
  check(`products-only caller: list answers (${denied.status}) without lots`, denied.status === 200 && denied.json.items.every((r) => !('lots' in r) && !('lots_more' in r)))
  const refused = await get('/api/batches?productId=10&branchId=1')
  check(`the batches read still refuses that caller (${refused.status})`, refused.status === 403)
  USER = POS_ONLY
  const pos = await get(WITH)
  check('a POS caller (admitted by the batches read) gets lots', pos.status === 200 && pos.json.items.every((r) => Array.isArray(r.lots)))
  console.log(`\n${checks} checks passed`)
})().catch((e) => { console.error(e); process.exit(1) })
