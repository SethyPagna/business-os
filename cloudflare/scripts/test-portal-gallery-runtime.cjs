// Execute the actual public Hono routes and gallery SQL against SQLite.
// Cache/provider/auth services are outside this public-read regression.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const db = openDb(loadAll())
const galleryQueries = []
const observedDb = {
  prepare(sql) {
    const statement = db.prepare(sql)
    if (!/FROM product_images/.test(sql)) return statement
    return {
      all(params) {
        assert.ok(Array.isArray(params) && params.length <= 100, 'D1 gallery binding budget')
        galleryQueries.push([...params])
        return statement.all(params)
      },
    }
  },
}
function loadReal(relative, overrides = {}) {
  const filename = path.join(__dirname, '..', 'src', relative)
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  })
  const module = { exports: {} }
  const localRequire = (request) => {
    if (request in overrides) return overrides[request]
    if (request.startsWith('.')) {
      return loadReal(path.relative(path.join(__dirname, '..', 'src'), path.resolve(path.dirname(filename), `${request}.ts`)))
    }
    return require(request)
  }
  new Function('exports', 'require', 'module', outputText)(module.exports, localRequire, module)
  return module.exports
}
const imageLimit = loadReal('lib/importImageMatch.ts').ADMIN_MAX_IMAGES_PER_PRODUCT
const app = loadReal('routes/portal.ts', {
  '../lib/db': { getDb: () => observedDb },
  '../lib/cache': {
    cachedJsonResponse: async (_request, _ctx, _version, _ttl, producer) => producer(),
    getVersionWithFallback: async () => '0',
  },
  '../lib/auth': { requireAuth: async (_c, next) => next() },
  '../lib/permissions': {},
  '../lib/audit': {},
  '../lib/rateLimit': {},
  '../lib/fileAssets': {},
  '../lib/r2': {},
  '../durable-objects/broadcastHub': {},
  '../lib/portalAi': {},
  '../lib/portalAccounts': {},
  '../lib/portalSession': {},
  '../lib/portalAuthLockout': {},
  '../lib/promotionRulesSql': { loadActivePromotionRules: async () => [], productPromotedSql: () => '0' },
}).default
const env = { DB: db }
const ctx = { waitUntil() {}, passThroughOnException() {} }
async function get(url) {
  galleryQueries.length = 0
  const response = await app.request(url, { method: 'GET' }, env, ctx)
  assert.equal(response.status, 200, `${url}: ${response.status}`)
  const result = await response.json()
  return result.catalog || result
}
function product(id, name, fallback = null, active = 1) {
  db.prepare(`INSERT INTO products (id, name, brand, is_active, stock_quantity,
    low_stock_threshold, out_of_stock_threshold, image_path)
    VALUES (@id, @name, 'Gallery Brand', @active, 12, 10, 0, @fallback)`)
    .run({ id, name, active, fallback })
  db.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, 1, 12)').run({ id })
}
function image(id, productId, imagePath, order) {
  db.prepare('INSERT INTO product_images (id, product_id, image_path, sort_order) VALUES (@id, @productId, @imagePath, @order)')
    .run({ id, productId, imagePath, order })
}
let checks = 0
async function check(name, run) {
  await run()
  checks++
  console.log(`PASS ${name}`)
}
async function run() {
  db.exec('DELETE FROM product_images; DELETE FROM branch_stock; DELETE FROM products; DELETE FROM branches;')
  db.exec("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Shop', 1, 1)")
  product(1, 'Alpha Cream', '/uploads/old-cover.jpg')
  product(2, 'Beta Serum', ' uploads/fallback.jpg?version=2 ')
  product(3, 'Empty Lotion')
  product(4, 'Hidden Product', '/uploads/hidden.jpg', 0)
  image(10, 1, ' uploads/first.jpg?old=1 ', 0)
  image(11, 1, '/uploads/first.jpg#duplicate', 1)
  image(12, 1, ' ', 2)
  image(13, 1, '/uploads/second.jpg', 3)
  image(14, 1, '/uploads/third.jpg', 3)
  for (let i = 4; i <= imageLimit + 2; i++) image(20 + i, 1, `/uploads/image-${i}.jpg`, i)
  image(40, 4, '/uploads/private-hidden-gallery.jpg', 0)
  const expected = ['/uploads/first.jpg', '/uploads/second.jpg', '/uploads/third.jpg', ...Array.from({ length: imageLimit - 3 }, (_, i) => `/uploads/image-${i + 4}.jpg`)]
  for (const url of ['/bootstrap', '/catalog/products', '/catalog/products/search']) {
    await check(`${url}: ordered sanitized galleries, fallback, identity and stock redaction`, async () => {
      const result = await get(url)
      assert.deepEqual(result.items.map((p) => p.id), [1, 2, 3])
      assert.deepEqual(result.items[0].image_gallery, expected)
      assert.equal(result.items[0].image_path, expected[0])
      assert.deepEqual(result.items[1].image_gallery, ['/uploads/fallback.jpg'])
      assert.equal(result.items[1].image_path, '/uploads/fallback.jpg')
      assert.deepEqual(result.items[2].image_gallery, [])
      assert.equal(result.items[2].image_path, null)
      assert.deepEqual(galleryQueries, [[1, 2, 3]], 'only visible page product ids are hydrated')
      for (const row of result.items) {
        for (const field of ['stock_quantity', 'low_stock_threshold', 'out_of_stock_threshold', 'branch_stock', 'cost_price_usd']) {
          assert.ok(!(field in row), `${field} must remain private`)
        }
        assert.equal(row.stock_status, 'in_stock')
        assert.deepEqual(row.branch_availability, [{ branch_id: 1, status: 'in_stock' }])
      }
    })
  }
  await check('exact and fuzzy searches retain every gallery image', async () => {
    for (const query of ['Alpha', 'Alpga']) {
      const result = await get(`/catalog/products/search?q=${query}`)
      assert.deepEqual(result.items.map((p) => p.id), [1], query)
      assert.deepEqual(result.items[0].image_gallery, expected)
    }
  })
  await check('empty result skips gallery queries', async () => {
    const result = await get('/catalog/products/search?brand=Missing')
    assert.deepEqual(result.items, [])
    assert.deepEqual(galleryQueries, [])
  })
  await check('family with over 100 rows chunks reads and never borrows sibling images', async () => {
    for (let i = 0; i < 105; i++) {
      product(100 + i, 'Chunked Family', `/uploads/legacy-${i}.jpg`)
      image(1000 + i, 100 + i, `/uploads/member-${i}.jpg`, 0)
    }
    for (const url of ['/bootstrap', '/catalog/products/search?q=Chunked']) {
      const result = await get(url)
      const family = result.items.filter((p) => p.name === 'Chunked Family')
      assert.equal(family.length, 105)
      assert.ok(galleryQueries.length >= 2)
      for (const row of family) assert.deepEqual(row.image_gallery, [`/uploads/member-${row.id - 100}.jpg`])
    }
  })
  console.log(`${checks} portal gallery runtime checks passed`)
}
run().catch((error) => { console.error(error); process.exitCode = 1 })
