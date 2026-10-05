// G37 phase 1, Worker side, through the REAL routes/products.ts on SQLite
// with every migration applied and D1's expression depth limit (100):
//
//   1. GET /search-index pages: fixed id ranges, active rows only, search
//      fields only (no cost/price/stock), a stable hash, a tiny "unchanged"
//      answer when the client already holds that hash, and the same denial
//      rule as the pickers (an image-only reader and a no-catalog user get
//      403).
//   2. GET /search?rankIds=&rankTiers= hydrates the core's ranked ids:
//      exactly those rows (plus the family siblings a search always brings),
//      in the core's order, tier first; filters still apply; malformed ids
//      give no rows, never the catalog.
//   3. The ranked WHERE is constant in expression depth: 1,500 ids parse at
//      depth 100, and the plan reads products by primary key, never a scan.
//   4. The owner's examples end to end: the core ranks over the index pages
//      the endpoint served, and the hydrated page carries them.
//
// Run (from cloudflare/): node scripts/test-product-search-index-native.cjs
'use strict'
const assert = require('node:assert/strict')
const path = require('node:path')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')
const { loadWorkerCore } = require('./harness/search_impls.cjs')

const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const rows = require(path.join(__dirname, 'fixtures', 'search-core-catalog-sample.json')).rows
const core = loadWorkerCore()

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) {
    failed += 1
    console.log(`FAIL ${name}\n${error && error.stack ? error.stack : error}`)
  }
}

function fixture() {
  const h = createProductsRouteHarness({ user: ADMIN })
  h.setUser(ADMIN)
  assert.equal(h.raw.db.limits.exprDepth, 100, 'the harness must parse at D1 depth')
  h.raw.db.exec("INSERT INTO branches(id, name, is_default, is_active) VALUES(1, 'Shop', 1, 1)")
  const insert = h.raw.db.prepare(`INSERT INTO products(id, name, brand, category, barcode, sku, cost_price_usd, selling_price_usd, stock_quantity, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 2, 5, 0, 1)`)
  for (const row of rows) insert.run(row.id, row.name, row.brand, row.category, row.barcode, row.sku)
  // One inactive row inside page 0, one row far away in page 3.
  h.raw.db.exec(`INSERT INTO products(id, name, brand, is_active, cost_price_usd, selling_price_usd) VALUES (1999, 'Retired Blush Palette', 'Hourglass', 0, 1, 2);
    INSERT INTO products(id, name, brand, is_active, cost_price_usd, selling_price_usd) VALUES (7001, 'Far Away Blush Palette', 'Hourglass', 1, 1, 2);`)
  return h
}

async function allIndexRows(h) {
  const first = await h.request('GET', '/search-index?page=0')
  assert.equal(first.status, 200, JSON.stringify(first.json))
  const pages = [first.json]
  for (const page of first.json.buckets.filter((bucket) => bucket !== 0)) {
    const res = await h.request('GET', `/search-index?page=${page}`)
    assert.equal(res.status, 200)
    pages.push(res.json)
  }
  return { pages, rows: pages.flatMap((p) => p.rows.map(([id, name, brand, category, barcode, sku]) => ({ id, name, brand, category, barcode, sku }))) }
}

const rankParams = (result, limit = 1500) => {
  const hits = result.hits.slice(0, limit)
  return `rankIds=${hits.map((hit) => hit.id).join(',')}&rankTiers=${hits.map((hit) => hit.tier).join('')}`
}

;(async () => {
  const h = fixture()
  const indexRows = await allIndexRows(h)
  const index = core.buildTermIndex(indexRows.rows)

  await check('index pages: fixed id ranges, active rows only, search fields only', async () => {
    const { pages } = indexRows
    const occupied = [...new Set([...rows.map((row) => row.id), 1999, 7001].map((id) => Math.floor(id / 2000)))].sort((a, b) => a - b)
    assert.deepEqual(pages[0].buckets, occupied, 'only occupied id ranges are listed')
    assert.ok(occupied.length < Math.ceil(7001 / 2000) + 30, 'sanity')
    assert.equal(pages[0].pageIds, 2000)
    for (const page of pages) {
      for (const [id] of page.rows) assert.ok(id >= page.page * 2000 && id < (page.page + 1) * 2000, `id ${id} outside page ${page.page}`)
      assert.ok(!JSON.stringify(page).match(/cost|price|stock/i), 'no money or stock fields')
    }
    const ids = new Set(indexRows.rows.map((row) => row.id))
    assert.ok(!ids.has(1999), 'inactive row excluded')
    assert.ok(ids.has(7001), 'far page present')
    assert.equal(ids.size, rows.length + 1)
    assert.deepEqual(pages[0].rows.find(([id]) => id === rows[0].id), [rows[0].id, rows[0].name, rows[0].brand || '', rows[0].category || '', rows[0].barcode || '', rows[0].sku || ''])
  })

  await check('index pages: a held hash gets "unchanged"; an edit changes only its own page hash', async () => {
    const before = await Promise.all([0, 3].map((page) => h.request('GET', `/search-index?page=${page}`)))
    assert.ok(before[1].json.rows.some(([id]) => id === 7001))
    const same = await h.request('GET', `/search-index?page=0&have=${before[0].json.hash}`)
    assert.equal(same.json.unchanged, true)
    assert.equal(same.json.rows, undefined, 'no rows when unchanged')
    const stale = await h.request('GET', '/search-index?page=0&have=deadbeef')
    assert.ok(Array.isArray(stale.json.rows))
    h.raw.db.exec("UPDATE products SET name = 'Far Away Blush Palette Renamed' WHERE id = 7001")
    const after = await Promise.all([0, 3].map((page) => h.request('GET', `/search-index?page=${page}`)))
    assert.equal(after[0].json.hash, before[0].json.hash, 'untouched page keeps its hash')
    assert.notEqual(after[1].json.hash, before[1].json.hash, 'edited page changes hash')
    h.raw.db.exec("UPDATE products SET name = 'Far Away Blush Palette' WHERE id = 7001")
  })

  await check('index pages: an image-only reader and a no-catalog user are refused', async () => {
    try {
      h.setActionTier(() => 'none')
      h.setUser({ id: 9, username: 'img', name: 'Img', permissions: JSON.stringify({ products_image_only: true }) })
      assert.equal((await h.request('GET', '/search-index?page=0')).status, 403)
      h.setUser({ id: 10, username: 'none', name: 'None', permissions: JSON.stringify({}) })
      assert.equal((await h.request('GET', '/search-index?page=0')).status, 403)
      h.setUser({ id: 11, username: 'till', name: 'Till', permissions: JSON.stringify({ pos: true }) })
      assert.equal((await h.request('GET', '/search-index?page=0')).status, 200, 'a POS user may hold it')
    } finally {
      h.setActionTier(() => 'full')
      h.setUser(ADMIN)
    }
  })

  await check('owner examples: core ranks over the served index, /search?rankIds hydrates them in that order', async () => {
    const blush = core.searchTermIndex(index, 'Blush Palette')
    const res = await h.request('GET', `/search?${rankParams(blush)}&pageSize=30`)
    assert.equal(res.status, 200, JSON.stringify(res.json))
    const names = res.json.items.map((item) => item.name)
    assert.ok(names.some((name) => /hourglass blush palette evil eye/i.test(name)), 'Evil Eye in the first 30')
    assert.ok(names.includes('Far Away Blush Palette'), 'a row from the last page is found')
    // Families come back in the core's order (same tier, so rank decides).
    const firstIds = res.json.items.map((item) => item.id)
    const order = blush.hits.map((hit) => hit.id).filter((id) => firstIds.includes(id))
    assert.deepEqual(firstIds.filter((id) => order.includes(id)), order)

    for (const query of ['SK-II', 'skii', 'sk2', 'sk ii', 'sk-2']) {
      const ranked = core.searchTermIndex(index, query)
      const page = await h.request('GET', `/search?${rankParams(ranked)}&pageSize=100`)
      const got = page.json.items.map((item) => item.name)
      assert.ok(got.length > 0 && got.every((name) => /sk-?\s?ii/i.test(name)), `${query}: ${got.filter((n) => !/sk-?\s?ii/i.test(n)).slice(0, 3)}`)
      assert.ok(!got.some((name) => /skin tint 2/i.test(name)), `${query} never brings Skin Tint 2`)
    }
    const pallet = core.searchTermIndex(index, 'blush pallet')
    const typo = await h.request('GET', `/search?${rankParams(pallet)}&pageSize=30`)
    assert.ok(typo.json.items.some((item) => /evil eye/i.test(item.name)), 'typo hydrates the palettes')
    assert.equal(core.searchTermIndex(index, 'zzzz').total, 0, 'nonsense: nothing to hydrate')
  })

  await check('ranked ids: tier leads, filters still apply, bad input gives no rows', async () => {
    const ids = rows.filter((row) => /blush palette/i.test(row.name)).map((row) => row.id)
    const exact = ids[ids.length - 1]
    const tiers = ids.map((id) => (id === exact ? '1' : '3')).join('')
    const res = await h.request('GET', `/search?rankIds=${ids.join(',')}&rankTiers=${tiers}&pageSize=50`)
    assert.equal(res.json.items[0].id, exact, 'the tier-1 id leads although it is listed last')
    const brand = rows.find((row) => row.id === ids[0]).brand
    const filtered = await h.request('GET', `/search?rankIds=${ids.join(',')}&brand=${encodeURIComponent(brand)}&pageSize=50`)
    assert.ok(filtered.json.items.length > 0 && filtered.json.items.every((item) => String(item.brand).toLowerCase() === String(brand).toLowerCase()))
    for (const bad of ['abc', '-5', '0', '1.5', ',,,']) {
      const none = await h.request('GET', `/search?rankIds=${encodeURIComponent(bad)}&pageSize=50`)
      assert.equal(none.status, 200)
      assert.equal(none.json.total, 0, `rankIds=${bad} must not return the catalog`)
    }
  })

  await check('depth and plan: 1,500 ranked ids parse at depth 100; the paged statements read products by primary key', async () => {
    const many = Array.from({ length: 1500 }, (_, i) => rows[i % rows.length].id + (i >= rows.length ? 100000 : 0))
    const statements = []
    const rawBatch = h.raw.batch.bind(h.raw)
    h.raw.batch = (items) => { for (const item of items) statements.push(item); return rawBatch(items) }
    let res
    try {
      res = await h.request('GET', `/search?rankIds=${many.join(',')}&rankTiers=${'3'.repeat(1500)}&pageSize=20`)
    } finally {
      h.raw.batch = rawBatch
    }
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.ok(res.json.total > 0)
    const paged = statements.filter((item) => /rankIdList/.test(item.sql))
    assert.equal(paged.length, 2, 'count + page statements')
    assert.ok(/rankCsv/.test(paged[1].sql) && !/rankCsv/.test(paged[0].sql), 'only the page statement computes the rank')
    for (const item of paged) {
      const used = {}
      for (const match of item.sql.matchAll(/@(\w+)/g)) used[match[1]] = item.params[match[1]] ?? null
      const plan = h.raw.db.prepare(`EXPLAIN QUERY PLAN ${item.sql}`).all(used).map((row) => row.detail)
      const text = plan.join('\n')
      assert.ok(!plan.some((detail) => /^SCAN (p|parent|listed)\b|^SEARCH \w+ USING (COVERING )?INDEX idx_products_active/.test(detail)), `no walk over all products:\n${text}`)
      assert.ok(plan.some((detail) => /SEARCH p USING INTEGER PRIMARY KEY/.test(detail)), text)
    }
    const builder = h.load('lib/productSearchQuery.ts')
    const params = {}
    builder.buildProductSearchQuery('', params, { rankedIds: builder.parseRankedIds(many.join(','), '3'.repeat(1500)) })
    assert.deepEqual(Object.keys(params).sort(), ['rankCsv', 'rankIdList', 'rankTierCut1', 'rankTierCut2', 'rankTierCut3', 'rankTierCut4'], 'six bound parameters whatever the id count')
  })

  if (failed) { console.log(`${failed} check(s) failed`); process.exit(1) }
  console.log('PASS test-product-search-index-native')
})().catch((error) => { console.error(error); process.exit(1) })
