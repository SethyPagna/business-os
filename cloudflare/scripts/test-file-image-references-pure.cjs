// Regression coverage for Library image references owned by promotions.
//
// Runs the real files route against real SQLite/migrations. Promotion paths
// are intentionally compared to file_assets.public_path exactly, matching the
// canonical path written by the upload/promotion-editor flow. Encoded URLs and
// cache-busted URLs are not alternate stored paths and must not lock a file.

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

const dbShim = {
  prepare(sql) {
    return {
      async get(params) { return db.prepare(sql).get(params ?? {}) },
      async all(params) { return db.prepare(sql).all(params ?? {}) },
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
const deletedKeys = []
const route = loadTs('routes/files.ts', {
  hono: { Hono },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', c.env.TEST_USER); await next() } },
  '../lib/db': { getDb: () => dbShim },
  '../lib/permissions': permissions,
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

async function request(pathname, init = {}) {
  const response = await app.request(`http://local${pathname}`, init, {
    TEST_USER: user,
    ASSETS: { delete: async (key) => { deletedKeys.push(key) } },
  }, { waitUntil() {}, passThroughOnException() {} })
  return { status: response.status, json: await response.json().catch(() => null) }
}

function reset() {
  deletedKeys.length = 0
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
  console.log('PASS promotion references lock list/delete and appear in usage detail')

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
  asset(5, 'cache.png', '/uploads/promotion-cache.png')
  db.prepare("INSERT INTO promotions (id, title, image_path) VALUES (10, 'Encoded only', '/uploads/promotion%20space.png')").run()
  db.prepare("INSERT INTO promotions (id, title, image_path) VALUES (11, 'Cache only', '/uploads/promotion-cache.png?v=7')").run()
  const variants = await request('/')
  assert.equal(findItem(variants.json, 4).usage.promotions, 0, 'URL-encoded text is not a second spelling of a stored canonical path')
  assert.equal(findItem(variants.json, 5).usage.promotions, 0, 'cache-busted text is not a second spelling of a stored canonical path')
  assert.equal((await request('/4', { method: 'DELETE' })).status, 200)
  assert.equal((await request('/5', { method: 'DELETE' })).status, 200)
  console.log('PASS encoded/cache-busted promotion strings do not broaden exact canonical-path matching')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
