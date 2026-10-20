// D1 refuses a statement with more than 100 bound parameters ("too many SQL variables"). The admin product
// search (GET /api/products/search, the one reader behind Products, POS, Stock change and the pickers) used to
// bind ~5 parameters per search word with a 6 x 8 word allowance (196), plus 1-2 per selected brand/category
// value. This runs the REAL routes/products.ts on SQLite with every migration, the variable limit set to D1's
// 100 and a per-statement count of distinct named parameters, over the widest query the route accepts.
//
// Run (from cloudflare/): node scripts/test-admin-search-parameter-limit-native.cjs
'use strict'
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) {
    failed += 1
    console.log(`FAIL ${name}\n${error && error.stack ? error.stack : error}`)
  }
}

const distinctNames = (sql) => new Set([...sql.replace(/'(?:[^']|'')*'/g, '').matchAll(/@(\w+)/g)].map((match) => match[1])).size

function fixture() {
  const h = createProductsRouteHarness({ user: ADMIN })
  h.setUser(ADMIN)
  const raw = h.raw.db
  raw.limits.variableNumber = 100
  raw.exec("INSERT INTO branches(id, name, is_default, is_active) VALUES(1, 'Shop', 1, 1)")
  const insert = raw.prepare(`INSERT INTO products(id, name, brand, category, barcode, sku, unit, supplier, cost_price_usd, selling_price_usd, stock_quantity, is_active, brands, categories)
    VALUES (?, ?, ?, ?, ?, ?, 'pcs', 'Acme', 2, 5, 0, 1, ?, ?)`)
  const rows = [
    [1, 'Glow Serum 30ml', 'Alpha', 'Skincare', '3348901770569', 'SKU1', 'Alpha||Beta', 'Skincare'],
    [2, 'Matte Lipstick Ruby', 'Gamma', 'Makeup', '3348901770570', 'SKU2', 'Gamma', 'Makeup||Gift_Set'],
    [3, 'Cleanser Foam', 'Delta', 'Skincare', '3348901770571', 'SKU3', 'Delta', 'Skincare'],
  ]
  seedStockFixture(raw, () => { for (const row of rows) insert.run(...row) })
  for (const [id, scope, field, value] of [[1, 'category', 'category', 'Skincare'], [2, 'category', 'category', 'Makeup'], [3, 'brand', 'brand', 'Alpha'], [4, 'brand', 'brand', 'Delta']]) {
    raw.prepare(`INSERT INTO promotion_rules (id, title, rule_type, percent_off, scope_type, ${field}, product_ids, is_active)
      VALUES (?, 'rule', 'percent_off', 10, ?, ?, '[]', 1)`).run(id, scope, value)
  }
  // Record every statement the route prepares, so the widest one is known.
  const statements = []
  const prepare = raw.prepare.bind(raw)
  raw.prepare = (sql) => { statements.push(sql); return prepare(sql) }
  return { h, statements }
}

const list = (prefix, count) => Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(',')
const groupsOf = (groups, words, make) => Array.from({ length: groups }, (_, g) => Array.from({ length: words }, (_, w) => make(g, w)).join(' ')).join(', ')
const WORD_KINDS = {
  long: (g, w) => `serum${'abcdefgh'[w]}${'pqrstu'[g]}`,
  code: (g, w) => `100ml${'abcdefgh'[w]}${'pqrstu'[g]}`,
  short: (g, w) => `${'abcdefgh'[w]}${'pqrstu'[g]}`,
  mixed: (g, w) => (w % 2 ? `a${w}` : `cleanser${'pqrstu'[g]}`),
}

async function main() {
  await check('the widest admin search binds at most 100 parameters per statement and still answers', async () => {
    const widest = []
    const { h, statements } = fixture()
    for (const [kind, make] of Object.entries(WORD_KINDS)) {
      for (const mode of ['AND', 'OR']) {
        for (const titleOnly of [false, true]) {
          statements.length = 0
          const url = '/search?' + new URLSearchParams({
            query: groupsOf(6, 8, make), searchMode: mode, ...(titleOnly ? { searchFields: 'name' } : {}),
            brand: list('brand', 30), category: list('category', 30), unit: list('unit', 30), supplier: list('supplier', 30), tag_label: list('tag', 30),
            branchId: '1', stockState: 'in_stock', issueState: 'low_stock', groupState: 'standalone', initial: 'A', promo: 'promoted',
            sort: 'created_desc', pageSize: '100', page: '3',
          })
          const response = await h.request('GET', url)
          assert.equal(response.status, 200, `${kind} ${mode} ${titleOnly}: ${JSON.stringify(response.json)}`)
          widest.push(Math.max(...statements.map(distinctNames)))
        }
      }
    }
    assert.ok(Math.max(...widest) <= 100, `a statement binds ${Math.max(...widest)} parameters`)
    console.log(`  widest admin statement binds ${Math.max(...widest)} parameters`)
  })

  await check('every promo filter form stays under the limit with a maximal search', async () => {
    const { h, statements } = fixture()
    for (const promo of ['promoted', 'discounted', 'rules', 'rule:1', '3']) {
      statements.length = 0
      const response = await h.request('GET', '/search?' + new URLSearchParams({ query: groupsOf(3, 4, WORD_KINDS.short), brand: list('b', 12), category: list('c', 12), branchId: '1', initial: 'A', promo, pageSize: '100', page: '2' }))
      assert.equal(response.status, 200, `${promo}: ${JSON.stringify(response.json)}`)
      assert.ok(Math.max(...statements.map(distinctNames)) <= 100, promo)
    }
  })

  await check('barcode and exact-code search is unchanged: one scanned code finds its row first', async () => {
    const { h } = fixture()
    const response = await h.request('GET', '/search?query=3348901770570')
    assert.equal(response.status, 200)
    assert.equal(response.json.items[0].id, 2)
    const named = await h.request('GET', '/search?query=glow%20serum')
    assert.equal(named.json.items[0].id, 1)
  })

  await check('a multi-value brand/category filter keeps its meaning: primary column, secondary tag, and LIKE metacharacters', async () => {
    const { h } = fixture()
    const ids = async (params) => {
      const response = await h.request('GET', '/search?' + new URLSearchParams({ pageSize: '100', ...params }))
      assert.equal(response.status, 200, JSON.stringify(response.json))
      return response.json.items.map((item) => item.id).sort()
    }
    assert.deepEqual(await ids({ brand: 'gamma,delta' }), [2, 3])
    assert.deepEqual(await ids({ brand: 'beta,delta' }), [1, 3], 'a secondary brand tag matches')
    assert.deepEqual(await ids({ category: 'Makeup,Nothing' }), [2])
    assert.deepEqual(await ids({ category: 'gift_set,Nothing' }), [2], 'underscore in a value is literal')
    assert.deepEqual(await ids({ category: 'gift%,Nothing' }), [], 'percent in a value is literal')
    assert.deepEqual(await ids({ unit: 'pcs,box', supplier: 'acme,other' }), [1, 2, 3])
    assert.deepEqual(await ids({ unit: 'box,crate' }), [])
  })

  if (failed) process.exitCode = 1
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
