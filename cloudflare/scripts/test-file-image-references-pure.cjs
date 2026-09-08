// Regression coverage for Library image references owned by promotions.
//
// Runs the real files route against real SQLite/migrations. Promotion paths
// use the same exact-first, known-file identity rule as product images: a
// legacy encoded/cache-busted uploads path protects its stored asset, while a
// literal matching filename keeps precedence over a normalized sibling.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const { Hono } = require('hono')

const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
const migrationsDir = path.join(__dirname, '..', 'migrations')
for (const file of fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort()) {
  db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
}

const promotionReferenceQueries = []

const dbShim = {
  prepare(sql) {
    return {
      async get(params) { return db.prepare(sql).get(params ?? {}) },
      async all(params) {
        if (sql.includes('requested_promotion_paths')) promotionReferenceQueries.push({ sql, params: params ?? {} })
        return db.prepare(sql).all(params ?? {})
      },
      async run(params) {
        const result = db.prepare(sql).run(params ?? {})
        return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) }
      },
    }
  },
  async batch(statements) {
    return db.transaction(() => statements.map(({ sql, params }) => {
      const result = db.prepare(sql).run(params ?? {})
      return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) }
    }))()
  },
}

function loadTs(relativePath, stubs) {
  const filePath = path.join(__dirname, '..', 'src', relativePath)
  const outputText = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const loaded = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      loaded.exports, require, loaded, filePath, path.dirname(filePath),
    )
    return loaded.exports
  } finally {
    Module._load = originalLoad
  }
}

const permissions = loadTs('lib/permissions.ts', {})
const media = loadTs('lib/media.ts', {})
const sqlBinding = loadTs('lib/sqlBinding.ts', {})
const deletedKeys = []
const route = loadTs('routes/files.ts', {
  hono: { Hono },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', c.env.TEST_USER); await next() } },
  '../lib/db': { getDb: () => dbShim },
  '../lib/permissions': permissions,
  '../lib/media': media,
  '../lib/sqlBinding': sqlBinding,
  '../lib/fileAssets': {
    getMediaType: () => 'image',
    buildUniqueStoredName: (name) => name,
    sanitizeOriginalFileName: (name) => name,
    normalizePhysicalStorageSummary: (row) => ({
      totalBytes: Number(row?.total_bytes || 0),
      fileCount: Number(row?.file_count || 0),
      countsByType: {
        image: Number(row?.image_count || 0), video: Number(row?.video_count || 0),
        document: Number(row?.document_count || 0), file: Number(row?.other_count || 0),
      },
    }),
  },
  '../lib/libraryLogicalAssets': { logicalLibraryName: (name) => name },
  '../lib/uploadSecurity': { validateUploadedBuffer: () => ({ ok: true }) },
  '../lib/imageAudit': { enqueueImageNormalization: async () => {} },
  '../lib/imagePipeline': { optimizeImage: async () => ({}), IMAGE_MAX_BYTES: 1024 },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' },
  '../lib/audit': { audit: async () => {} },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
  '../lib/actorSnapshot': { actorSnapshot: () => null },
  '../index': {},
})
const app = route.default || route
const user = { id: 7, username: 'librarian', role_code: 'staff', permissions: JSON.stringify({ library: true }), role_permissions: null }
const viewer = { ...user, permissions: JSON.stringify({}) }

async function request(pathname, init = {}, requestUser = user) {
  const response = await app.request(`http://local${pathname}`, init, {
    TEST_USER: requestUser,
    ASSETS: { delete: async (key) => { deletedKeys.push(key) } },
  }, { waitUntil() {}, passThroughOnException() {} })
  return { status: response.status, json: await response.json().catch(() => null) }
}

function reset() {
  deletedKeys.length = 0
  promotionReferenceQueries.length = 0
  db.exec('DELETE FROM promotions; DELETE FROM product_images; DELETE FROM products; DELETE FROM users; DELETE FROM settings; DELETE FROM file_assets;')
}

function asset(id, storedName, publicPath) {
  db.prepare("INSERT INTO file_assets (id, original_name, stored_name, public_path, media_type) VALUES (@id, @storedName, @storedName, @publicPath, 'image')")
    .run({ id, storedName, publicPath })
}

function findItem(list, id) {
  const item = list.items.find((candidate) => Number(candidate.id) === id)
  assert.ok(item, `asset ${id} must be present: ${JSON.stringify(list.items)}`)
  return item
}

async function main() {
  reset()
  asset(1, 'promotion-banner.png', '/uploads/promotion-banner.png')
  db.prepare("INSERT INTO promotions (id, title, image_path, is_active, sort_order) VALUES (9, 'Autumn offer', '/uploads/promotion-banner.png', 0, 4)").run()

  const listed = await request('/')
  assert.equal(listed.status, 200, JSON.stringify(listed.json))
  const promotionAsset = findItem(listed.json, 1)
  assert.equal(promotionAsset.usageCount, 1)
  assert.deepEqual(promotionAsset.usage, { products: 0, gallery: 0, avatars: 0, promotions: 1, settings: 0 })
  assert.equal(promotionAsset.canDelete, false)

  const usage = await request('/1/usage')
  assert.equal(usage.status, 200, JSON.stringify(usage.json))
  assert.deepEqual(usage.json.promotions, [{ id: 9, title: 'Autumn offer', is_active: 0 }])

  const blocked = await request('/1', { method: 'DELETE' })
  assert.equal(blocked.status, 409, JSON.stringify(blocked.json))
  assert.equal(blocked.json.usage.promotions, 1)
  assert.ok(db.prepare('SELECT id FROM file_assets WHERE id = 1').get(), 'a promotion-referenced file must survive a normal delete')
  assert.deepEqual(deletedKeys, [], 'the R2 object must not be deleted when a promotion blocks it')
  const wrongForce = await request('/1', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ force: true, confirmText: 'CONFIRM DELETE NOW' }),
  })
  assert.equal(wrongForce.status, 409, JSON.stringify(wrongForce.json))
  assert.ok(db.prepare('SELECT id FROM file_assets WHERE id = 1').get(), 'a near-match confirmation must not bypass protection')
  const exactForce = await request('/1', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ force: true, confirmText: 'CONFIRM DELETE' }),
  })
  assert.equal(exactForce.status, 200, JSON.stringify(exactForce.json))
  assert.equal(db.prepare('SELECT id FROM file_assets WHERE id = 1').get(), undefined)
  assert.deepEqual(deletedKeys, ['uploads/promotion-banner.png'])
  console.log('PASS promotion references lock list/delete, require the exact force phrase, and appear in usage detail')

  reset()
  asset(2, 'product-cover.png', '/uploads/product-cover.png')
  db.prepare("INSERT INTO products (id, name, image_path, is_active) VALUES (2, 'Existing product', '/uploads/product-cover.png', 1)").run()
  const productListed = await request('/')
  const productAsset = findItem(productListed.json, 2)
  assert.deepEqual(productAsset.usage, { products: 1, gallery: 0, avatars: 0, promotions: 0, settings: 0 })
  const productBlocked = await request('/2', { method: 'DELETE' })
  assert.equal(productBlocked.status, 409, JSON.stringify(productBlocked.json))
  assert.equal(productBlocked.json.usage.products, 1)
  assert.equal(productBlocked.json.usage.promotions, 0)
  console.log('PASS existing product references retain their own list/delete counts')

  reset()
  asset(3, 'orphan.png', '/uploads/orphan.png')
  const orphanListed = await request('/')
  assert.equal(findItem(orphanListed.json, 3).canDelete, true)
  const deleted = await request('/3', { method: 'DELETE' })
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json))
  assert.equal(db.prepare('SELECT id FROM file_assets WHERE id = 3').get(), undefined)
  assert.deepEqual(deletedKeys, ['uploads/orphan.png'])
  console.log('PASS an unreferenced library image still deletes normally')

  reset()
  asset(4, 'space.png', '/uploads/promotion space.png')
  asset(5, 'cache-base.png', '/uploads/promotion-cache.png')
  asset(6, 'cache-literal.png', '/uploads/promotion-cache.png?v=7')
  asset(7, 'cache-only-base.png', '/uploads/promotion-cache-only.png')
  db.prepare("INSERT INTO promotions (id, title, image_path) VALUES (10, 'Encoded only', '/uploads/promotion%20space.png')").run()
  db.prepare("INSERT INTO promotions (id, title, image_path) VALUES (11, 'Literal cache filename', '/uploads/promotion-cache.png?v=7')").run()
  db.prepare("INSERT INTO promotions (id, title, image_path) VALUES (12, 'Cache only', '/uploads/promotion-cache-only.png?v=7')").run()
  const variants = await request('/')
  assert.equal(findItem(variants.json, 4).usage.promotions, 1, 'one legacy URI decode must resolve a known upload path')
  assert.equal(findItem(variants.json, 5).usage.promotions, 0, 'an exact literal cache filename owns the raw promotion path before normalization')
  assert.equal(findItem(variants.json, 6).usage.promotions, 1, 'exact filename identity wins over query stripping')
  assert.equal(findItem(variants.json, 7).usage.promotions, 1, 'a cache-busted legacy upload path resolves to its only known base asset')
  for (const [id, promotionId] of [[4, 10], [6, 11], [7, 12]]) {
    const detail = await request(`/${id}/usage`)
    assert.equal(detail.status, 200, `asset ${id}: ${JSON.stringify(detail.json)}`)
    assert.deepEqual(detail.json.promotions.map((row) => row.id), [promotionId])
  }
  for (const id of [4, 6, 7]) {
    const protectedDelete = await request(`/${id}`, { method: 'DELETE' })
    assert.equal(protectedDelete.status, 409, `asset ${id}: ${JSON.stringify(protectedDelete.json)}`)
  }
  console.log('PASS encoded/cache-busted promotion paths protect the correct exact-first file identity')

  reset()
  for (let id = 1; id <= 100; id += 1) {
    const publicPath = `/uploads/promotion-page-${id}.png`
    asset(id, `promotion-page-${id}.png`, publicPath)
    db.prepare('INSERT INTO promotions (id, title, image_path, sort_order) VALUES (@id, @title, @path, @id)')
      .run({ id, title: `Page ${id}`, path: `${publicPath}?v=7` })
  }
  const page = await request('/?pageSize=100')
  assert.equal(page.status, 200, JSON.stringify(page.json))
  assert.equal(page.json.items.length, 100)
  assert.ok(page.json.items.every((item) => item.usage.promotions === 1), 'every page asset must retain its cache-busted promotion lock')
  assert.ok(promotionReferenceQueries.length > 1, 'the real D1 chunk helper must split a page of candidate paths')
  for (const query of promotionReferenceQueries) {
    assert.ok(Object.keys(query.params).length <= 100, `D1 binding budget exceeded: ${Object.keys(query.params).length}`)
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(query.params)
    const details = plan.map((row) => String(row.detail || '')).join('\n')
    assert.match(details, /SEARCH p USING INDEX idx_promotions_image_path/, details)
    assert.match(details, /image_path>\? AND image_path<\?/, details)
    assert.doesNotMatch(details, /SCAN p(?:\s|$)/m, 'promotion references must not scan the promotion table')
    assert.equal((query.sql.match(/\bUNION\b/g) || []).length, 2, 'candidate count must not increase compound terms')
  }
  console.log('PASS page-sized promotion lookup stays within D1 bindings and uses the promotion image-path index')

  if (process.env.F57_NATIVE_D1 === '1') {
    const { Miniflare } = require('miniflare')
    const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test") } }', compatibilityDate: '2026-08-01', d1Databases: ['DB'] })
    try {
      const native = await mf.getD1Database('DB')
      const adapter = loadTs('lib/db.ts', {}).getDb({ DB: native })
      for (const row of db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = 'promotions' AND sql IS NOT NULL ORDER BY type DESC").all()) {
        await native.prepare(row.sql).run()
      }
      for (const row of db.prepare('SELECT id, title, image_path, sort_order FROM promotions').all()) {
        await adapter.prepare('INSERT INTO promotions (id,title,image_path,sort_order) VALUES (@id,@title,@image_path,@sort_order)').run(row)
      }
      for (const query of promotionReferenceQueries) {
        const expected = db.prepare(query.sql).all(query.params).map((row) => row.id).sort((a,b) => a-b)
        const actual = (await adapter.prepare(query.sql).all(query.params)).map((row) => row.id).sort((a,b) => a-b)
        assert.deepEqual(actual, expected, 'actual route SQL must return the same references in native D1')
      }
      console.log('PASS native D1 executes every real 100-file-page promotion query through the production adapter')
    } finally {
      await mf.dispose()
    }
  }

  reset()
  asset(8, 'permission-check.png', '/uploads/permission-check.png')
  const denied = await request('/8', { method: 'DELETE' }, viewer)
  assert.equal(denied.status, 403, JSON.stringify(denied.json))
  assert.ok(db.prepare('SELECT id FROM file_assets WHERE id = 8').get(), 'a non-Library user cannot delete an otherwise orphaned file')
  assert.deepEqual(deletedKeys, [])
  console.log('PASS missing Full Library permission denies deletion before asset work')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
