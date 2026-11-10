// INV-A S4a (Inventory replan 2.3): GET /api/products/search is a thin handler over one exported reader, readProductSearchList, which the Inventory Check list also calls.
// Pinned here, with a tiny route that calls the reader the way the Inventory Check route does:
//  1. a `lots` token in the URL's include parameter is not part of the cache key: the entry written without it serves the request with it (and the reverse);
//  2. a caller-built canonical request (keyRequest) produces the SAME key as the Products URL with the same parameters, so the second route is a cache hit;
//  3. the server-only restriction: restrictIdsJson keeps only those rows, excludeIdsJson drops them, the total follows, and neither is readable from the query string;
//  4. a restricted read has its own entry per set label and per inventory_checks version, and never pollutes the unrestricted entry (or the reverse);
//  5. no restriction -> the statements of the unrestricted read are exactly the old ones (no json_each over a restriction anywhere).
//
// Run: node scripts/test-products-search-shared-reader-native.cjs
const assert = require('node:assert/strict')
const { Hono } = require('hono')
const { createInvApp } = require('./harness/inv-app.cjs')

let checks = 0
function check(label, cond) { assert.ok(cond, `FAIL: ${label}`); checks++; console.log(`  ok  ${label}`) }

const app = createInvApp({
  mount: {
    '/api/products': 'routes/products.ts',
    '/x': (load) => {
      const { readProductSearchList } = load('routes/products.ts')
      const route = new Hono()
      route.use('*', async (c, next) => { c.set('user', app.users.admin); return next() })
      route.get('/list', async (c) => {
        const query = c.req.query()
        const restrict = query.__restrict, exclude = query.__exclude
        const canonical = new URLSearchParams(Object.entries(query).filter(([k]) => !k.startsWith('__')))
        const keyRequest = new Request(`https://elsewhere.invalid/api/products/search?${canonical}`)
        const rest = Object.fromEntries([...canonical.entries()])
        return c.json(await readProductSearchList(c, rest, { keyRequest, restrictIdsJson: restrict, excludeIdsJson: exclude, setKey: query.__set, setVersion: query.__ver,
          include: query.__lots ? new Set(['lots']) : new Set() }))
      })
      return route
    },
  },
  seed(raw, seedStockFixture) {
    seedStockFixture(raw.db, () => {
      for (const [id, name] of [[10, 'Powder Foundation'], [11, 'Powder Brush'], [12, 'Powder Puff'], [13, 'Rose Serum']]) {
        raw.prepare(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active,updated_at)
          VALUES(?,?,?,?,5,9.5,38000,4,16000,1,'2026-09-01 00:00:00')`).run([id, name, `SKU${id}`, `88500000${id}`])
        raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,5)').run([id])
      }
    })
  },
})
const ids = (r) => r.json.items.map((row) => row.id).sort((a, b) => a - b)

;(async () => {
  const BASE = 'page=1&pageSize=20&sort=name_asc&include=branch_stock,images,batches,tagged_lots'
  // 1. the lots token is not in the key
  let before = app.counters.pageQueries
  const plain = await app.get(`/api/products/search?${BASE}`)
  check('plain list answers with all four products', plain.status === 200 && ids(plain).join() === '10,11,12,13')
  check('the plain read ran the page query once', app.counters.pageQueries === before + 1)
  const withLots = await app.get(`/api/products/search?${BASE},lots`)
  check('the same request with the lots token is a cache hit (the page query did not re-run)', withLots.status === 200 && app.counters.pageQueries === before + 1)
  check('and it carries lots arrays the plain answer does not', withLots.json.items.every((r) => Array.isArray(r.lots)) && plain.json.items.every((r) => !('lots' in r)))
  app.clearCaches(); before = app.counters.pageQueries
  await app.get(`/api/products/search?${BASE},lots`)
  await app.get(`/api/products/search?${BASE}`)
  check('reverse order: written WITH the token, served WITHOUT it from the same entry', app.counters.pageQueries === before + 1)

  // 2. a built canonical request has Products' key
  app.clearCaches(); before = app.counters.pageQueries
  await app.get(`/api/products/search?${BASE}`)
  const viaReader = await app.get(`/x/list?${BASE}&__canonical=1`)
  check('the reader called with a canonical request on another host and path prefix hits the Products entry', viaReader.status === 200 && app.counters.pageQueries === before + 1 && ids(viaReader).join() === '10,11,12,13')
  const otherParams = await app.get(`/x/list?${BASE.replace('pageSize=20', 'pageSize=10')}&__canonical=1`)
  check('control: different parameters are a different entry (the page query ran again)', otherParams.status === 200 && app.counters.pageQueries === before + 2)

  // 3. the restriction
  const only = await app.get(`/x/list?${BASE}&__restrict=${encodeURIComponent('[10,12]')}&__set=issue&__ver=1`)
  check('restrictIdsJson keeps exactly those rows and the total follows', only.status === 200 && ids(only).join() === '10,12' && only.json.total === 2)
  const without = await app.get(`/x/list?${BASE}&__exclude=${encodeURIComponent('[10,12]')}&__set=not_checked&__ver=1`)
  check('excludeIdsJson drops those rows and the total follows', without.status === 200 && ids(without).join() === '11,13' && without.json.total === 2)
  const spoof = await app.get(`/api/products/search?${BASE}&restrictIdsJson=${encodeURIComponent('[10]')}&excludeIdsJson=${encodeURIComponent('[11]')}&icRestrictIds=${encodeURIComponent('[10]')}`)
  check('the restriction cannot be sent as a query parameter (the route ignores all three spellings)', spoof.status === 200 && ids(spoof).join() === '10,11,12,13')

  // 4. its own entries, and no pollution
  before = app.counters.pageQueries
  await app.get(`/x/list?${BASE}&__restrict=${encodeURIComponent('[10,12]')}&__set=issue&__ver=1`)
  check('the same restricted read again is a hit', app.counters.pageQueries === before)
  const otherSet = await app.get(`/x/list?${BASE}&__restrict=${encodeURIComponent('[11]')}&__set=ok&__ver=1`)
  check('another set label is another entry and answers its own rows', app.counters.pageQueries === before + 1 && ids(otherSet).join() === '11')
  const newVersion = await app.get(`/x/list?${BASE}&__restrict=${encodeURIComponent('[10]')}&__set=issue&__ver=2`)
  check('the same label at a newer inventory_checks version recomputes with the new ids', app.counters.pageQueries === before + 2 && ids(newVersion).join() === '10')
  const again = await app.get(`/api/products/search?${BASE}`)
  check('the unrestricted entry is untouched by all of it (still four rows, still a hit)', ids(again).join() === '10,11,12,13' && app.counters.pageQueries === before + 2)

  // 5. no restriction -> the old statements
  app.clearCaches()
  const mark = app.mark()
  await app.get(`/api/products/search?${BASE}`)
  check('an unrestricted read prepares no json_each over a restriction', !app.since(mark).some((sql) => /icRestrictIds|icExcludeIds/.test(sql)))
  const markR = app.mark()
  app.clearCaches()
  await app.get(`/x/list?${BASE}&__restrict=${encodeURIComponent('[10]')}&__set=issue&__ver=1`)
  check('a restricted read does (one parameter each, in the page statement)', app.since(markR).some((sql) => /p\.id IN \(SELECT value FROM json_each\(@icRestrictIds\)\)/.test(sql)))
  console.log(`\n${checks} checks passed`)
})().catch((e) => { console.error(e); process.exit(1) })
