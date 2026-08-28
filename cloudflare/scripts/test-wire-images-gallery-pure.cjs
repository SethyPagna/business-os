// Regression test for POST /api/products/wire-images and its preview.
//
// The bug this file exists for: the strict library matcher deliberately
// returns up to MAX_IMAGES_PER_PRODUCT images for ONE product -- that is
// what the `_1` / `_2` / `_3` filename suffixes are for -- but the apply
// endpoint treated each match as its own change and ran
//   UPDATE products SET image_path = ?
// once per image. Three UPDATEs to one column: the last one silently won,
// the other two photos were dropped, and `product_images` (the table the
// Products page, the edit form and the public portal all actually read a
// gallery from) was never written at all. So wiring a 3-photo product
// stored one photo, in whatever order the library happened to return, and
// the other two vanished with no error anywhere.
//
// Everything below runs the REAL route file against real SQLite with every
// migration applied, so a future edit that reverts to per-image updates
// fails here rather than in someone's catalog.
//
// Run: node scripts/test-wire-images-gallery-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')
const Module = require('module')

const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
const migrationsDir = path.join(__dirname, '..', 'migrations')
for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
}

// D1Compat-shaped shim: @name params, async, plus the batch() the write
// path uses. Same approach as test-group-search-siblings-repro.cjs.
const dbShim = {
  prepare(sql) {
    return {
      async get(params) { return db.prepare(sql).get(params || {}) },
      async all(params) { return db.prepare(sql).all(params || {}) },
      async run(params) {
        const result = db.prepare(sql).run(params || {})
        return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) }
      },
    }
  },
  async batch(statements) {
    const run = db.transaction(() => {
      for (const statement of statements) db.prepare(statement.sql).run(statement.params || {})
    })
    run()
    return statements.map(() => ({}))
  },
}

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.None },
    fileName: sourcePath,
  })
  return { sourcePath, outputText }
}

function loadReal(relPath, requireOverrides = {}) {
  const { sourcePath, outputText } = transpile(relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  return moduleObj.exports
}

// Real, pure modules -- the matcher and the naming rule ARE what is being
// tested, so stubbing either would test the stub.
const importImageMatch = loadReal('lib/importImageMatch.ts')
const media = loadReal('lib/media.ts')
const sqlBinding = loadReal('lib/sqlBinding.ts')
const batchCode = loadReal('lib/batchCode.ts')
const searchMatch = loadReal('lib/searchMatch.ts')
const productWrites = loadReal('lib/productWrites.ts', {
  './db': { getDb: () => dbShim },
  './media': media,
  './importImageMatch': importImageMatch,
  './batchCode': batchCode,
  './searchMatch': searchMatch,
})

const FAKE_USER = { id: 1, username: 'tester', name: 'Test User', permissions: JSON.stringify({ products: true }) }

const productsRoute = loadReal('routes/products.ts', {
  '../lib/db': { getDb: () => dbShim },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', FAKE_USER); return next() } },
  '../lib/permissions': {
    hasPermission: () => true,
    getPermissionTier: () => 'full',
    getActionTier: () => 'full',
    getMergedPermissions: () => ({}),
  },
  '../lib/audit': { audit: async () => {} },
  // G1: rules load stubbed empty + promoted-SQL collapsed to a constant --
  // this test asserts pre-existing behavior (sort/wiring), not promotion
  // ranking; test-promotion-rules-pure.cjs covers the real SQL against the
  // real kernel.
  '../lib/promotionRulesSql': { loadActivePromotionRules: async () => [], productPromotedSql: () => '0', productDiscountActiveSql: () => '0', anyRuleAppliesSql: () => '0', singleRuleAppliesSql: () => '0' },
  // D6 rename engine stubbed inert -- this test asserts image wiring;
  // test-rename-cascade-pure.cjs covers the real engine on real sqlite.
  '../lib/renameCascade': { computeRenameImpact: async () => ({}), applyRenameCarry: async () => ({ products: 0, batches: 0 }) },

  '../lib/cache': { cachedJsonResponse: async (_r, _c, _v, _t, producer) => producer(), getVersion: async () => '0', bumpVersion: async () => {} },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' },
  '../lib/uploadSecurity': { validateUploadedBuffer: () => ({ ok: true }) },
  '../lib/reviewGate': { maybeQueueForReview: async () => null },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/bulkDeleteEngine': { createBulkDeleteJob: async () => ({}), getBulkDeleteJob: async () => null, reapStalledBulkDeleteJobs: async () => {} },
  '../lib/importImageMatch': importImageMatch,
  '../lib/media': media,
  '../lib/sqlBinding': sqlBinding,
  '../lib/productWrites': productWrites,
  '../lib/productIdentity': { findDuplicateProductGroups: async () => [] },
  '../lib/productBatches': { attachBatchCounts: async () => {} },
  '../lib/searchMatch': searchMatch,
  '../lib/familyPagination': loadReal('lib/familyPagination.ts'),
  '../lib/fileAssets': { getMediaType: () => 'image', buildUniqueStoredName: (n) => n, sanitizeOriginalFileName: (n) => n },
  '../lib/catalogText': { normalizeCatalogText: (v) => v, hasSuspiciousCatalogText: () => false },
})

const app = productsRoute.default || productsRoute

async function post(pathname, body) {
  const response = await app.request(`http://local${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  }, { ASSETS: {}, DB: {} }, { waitUntil: () => {}, passThroughOnException: () => {} })
  return { status: response.status, json: await response.json().catch(() => null) }
}

function seed() {
  db.exec('DELETE FROM product_images; DELETE FROM products; DELETE FROM file_assets;')
  db.prepare("INSERT INTO products (id, name, is_active, stock_quantity) VALUES (1, 'Rose Serum', 1, 0)").run()
  db.prepare("INSERT INTO products (id, name, is_active, stock_quantity) VALUES (2, 'Chanel No 5', 1, 0)").run()
  db.prepare("INSERT INTO products (id, name, is_active, stock_quantity) VALUES (3, 'Lip Balm', 1, 0)").run()
  const insertAsset = db.prepare(
    "INSERT INTO file_assets (id, original_name, stored_name, public_path, media_type) VALUES (@id, @name, @name, @path, 'image')",
  )
  // Deliberately inserted out of order (_3 before _1) so a test that passes
  // only because the library happened to return them sorted would fail.
  insertAsset.run({ id: 10, name: 'Rose Serum_3.jpg', path: '/uploads/rose-3.jpg' })
  insertAsset.run({ id: 11, name: 'Rose Serum_1.jpg', path: '/uploads/rose-1.jpg' })
  insertAsset.run({ id: 12, name: 'Rose Serum_2.jpg', path: '/uploads/rose-2.jpg' })
  insertAsset.run({ id: 13, name: 'Chanel No 5.jpg', path: '/uploads/chanel-5.jpg' })
  insertAsset.run({ id: 14, name: 'Nothing Matches This.jpg', path: '/uploads/orphan.jpg' })
}

function gallery(productId) {
  return db.prepare('SELECT image_path FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC')
    .all(productId).map((row) => row.image_path)
}

let passed = 0
let failed = 0
async function check(name, fn) {
  try {
    await fn()
    console.log('PASS', name)
    passed++
  } catch (err) {
    console.log('FAIL', name, '--', err.message)
    failed++
  }
}

async function main() {
  await check('preview groups a product\'s three photos into ONE change, ordered by the _1/_2/_3 suffix', async () => {
    seed()
    const { status, json } = await post('/wire-images/preview', {})
    assert.strictEqual(status, 200, JSON.stringify(json))
    const rose = json.changes.find((change) => change.productId === 1)
    assert.ok(rose, `Rose Serum must have a pending change, got ${JSON.stringify(json.changes)}`)
    assert.deepStrictEqual(
      rose.imagePaths,
      ['/uploads/rose-1.jpg', '/uploads/rose-2.jpg', '/uploads/rose-3.jpg'],
      'all three photos, in suffix order -- not library-id order, and not just one of them',
    )
    assert.strictEqual(json.changes.filter((change) => change.productId === 1).length, 1, 'one change per PRODUCT, not one per image')
  })

  await check('"Chanel No 5" keeps its 5 -- a trailing number above the image cap is part of the name, not an index', async () => {
    seed()
    const { json } = await post('/wire-images/preview', {})
    const chanel = json.changes.find((change) => change.productId === 2)
    assert.ok(chanel, 'Chanel No 5 must match its own photo')
    assert.deepStrictEqual(chanel.imagePaths, ['/uploads/chanel-5.jpg'])
  })

  await check('a file matching no product is reported as unmatched rather than attached to something', async () => {
    seed()
    const { json } = await post('/wire-images/preview', {})
    assert.ok(json.unmatched.includes('Nothing Matches This.jpg'), `expected the orphan in unmatched, got ${JSON.stringify(json.unmatched)}`)
    assert.ok(!json.changes.some((change) => change.imagePaths.includes('/uploads/orphan.jpg')), 'an unmatched file must never be wired')
    assert.ok(!json.changes.some((change) => change.productId === 3), 'Lip Balm has no photo and must not appear as a change')
  })

  await check('applying stores every photo -- cover column AND the gallery table', async () => {
    seed()
    const preview = await post('/wire-images/preview', {})
    const { status, json } = await post('/wire-images', { changes: preview.json.changes })
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.updated, 2, 'two products had photos to wire')

    const rose = db.prepare('SELECT image_path FROM products WHERE id = 1').get()
    assert.strictEqual(rose.image_path, '/uploads/rose-1.jpg', 'the cover must be the photo named _1')
    assert.deepStrictEqual(
      gallery(1),
      ['/uploads/rose-1.jpg', '/uploads/rose-2.jpg', '/uploads/rose-3.jpg'],
      'all three photos must reach product_images -- this is the exact bug: only one used to survive, and the gallery was never written',
    )
  })

  await check('re-running finds nothing left to do -- already-wired products are not re-listed', async () => {
    seed()
    const first = await post('/wire-images/preview', {})
    await post('/wire-images', { changes: first.json.changes })
    const second = await post('/wire-images/preview', {})
    assert.strictEqual(second.json.counts.wouldChange, 0, `expected nothing pending on a second run, got ${JSON.stringify(second.json.changes)}`)
  })

  await check('a product whose COVER is already right but whose gallery is incomplete still shows as pending', async () => {
    seed()
    db.prepare("UPDATE products SET image_path = '/uploads/rose-1.jpg' WHERE id = 1").run()
    const { json } = await post('/wire-images/preview', {})
    const rose = json.changes.find((change) => change.productId === 1)
    assert.ok(rose, 'a matching cover is not proof the other two photos are attached')
    assert.strictEqual(rose.imagePaths.length, 3)
  })

  await check('unwire detaches the selected products only, and deletes no files', async () => {
    seed()
    const preview = await post('/wire-images/preview', {})
    await post('/wire-images', { changes: preview.json.changes })

    const { status, json } = await post('/unwire-images', { productIds: [1] })
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(db.prepare('SELECT image_path FROM products WHERE id = 1').get().image_path, null)
    assert.deepStrictEqual(gallery(1), [], 'the gallery rows must go too, not just the cover column')
    assert.strictEqual(
      db.prepare('SELECT image_path FROM products WHERE id = 2').get().image_path,
      '/uploads/chanel-5.jpg',
      'unwiring one product must not touch another',
    )
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM file_assets').get().n, 5, 'unwire detaches; it must never delete the library files')
  })

  await check('unwire refuses an empty selection instead of reading it as "everything"', async () => {
    seed()
    const preview = await post('/wire-images/preview', {})
    await post('/wire-images', { changes: preview.json.changes })

    const { status, json } = await post('/unwire-images', { productIds: [] })
    assert.strictEqual(status, 400, JSON.stringify(json))
    assert.strictEqual(
      db.prepare('SELECT image_path FROM products WHERE id = 1').get().image_path,
      '/uploads/rose-1.jpg',
      'a dropped id array must not clear the whole catalog',
    )
  })

  await check('unwire with all: true clears every product, and re-wiring restores them from the untouched library', async () => {
    seed()
    const preview = await post('/wire-images/preview', {})
    await post('/wire-images', { changes: preview.json.changes })

    await post('/unwire-images', { all: true })
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM products WHERE image_path IS NOT NULL').get().n, 0)
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM product_images').get().n, 0)

    // The whole point of detach-not-delete: this is recoverable.
    const again = await post('/wire-images/preview', {})
    await post('/wire-images', { changes: again.json.changes })
    assert.deepStrictEqual(gallery(1), ['/uploads/rose-1.jpg', '/uploads/rose-2.jpg', '/uploads/rose-3.jpg'])
  })

  console.log(failed ? `\n${failed} check(s) FAILED, ${passed} passed.` : `\nAll ${passed} wire-image checks passed.`)
  process.exit(failed ? 1 : 0)
}

main()
