// Drives the real product merge Hono endpoints far enough to prove that an
// explicit products:image override blocks only a merge plan that mutates the
// keeper/discarded image state.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const Database = require('better-sqlite3')

const srcRoot = path.join(__dirname, '..', 'src')

function compileTs(filePath) {
  return ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filePath,
  }).outputText
}

function loadTs(relativePath, stubs = {}) {
  const filePath = path.join(srcRoot, relativePath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const loaded = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', compileTs(filePath))(
      loaded.exports, require, loaded, filePath, path.dirname(filePath),
    )
    return loaded.exports
  } finally {
    Module._load = originalLoad
  }
}

const permissions = loadTs('lib/permissions.ts')

function permissiveModule() {
  return new Proxy({}, {
    get(target, property) {
      if (!(property in target)) target[property] = () => undefined
      return target[property]
    },
  })
}

function product(id, imagePath = null) {
  return {
    id, name: 'Same product', barcode: 'SAME-1', image_path: imagePath, is_active: 1, is_group: 0,
    cost_price_usd: 1, cost_price_khr: 0, selling_price_usd: 2, selling_price_khr: 0,
    wholesale_price_usd: 0, wholesale_price_khr: 0, updated_at: '2026-09-07 00:00:00',
  }
}

function freshState(groups, galleryProductIds = []) {
  const products = new Map()
  for (const group of groups) {
    products.set(group.canonical.id, group.canonical)
    for (const duplicate of group.duplicates) products.set(duplicate.id, duplicate)
  }
  return { groups, galleryProductIds: new Set(galleryProductIds), products }
}

function loadProductsRoute(state) {
  const db = {
    prepare(sql) {
      return {
        async all(params = {}) {
          if (/SELECT DISTINCT product_id FROM product_images/i.test(sql)) {
            return [...state.galleryProductIds].map((product_id) => ({ product_id }))
          }
          if (/SELECT id, name FROM branches/i.test(sql)) return []
          if (/FROM branch_stock|FROM branch_batch_stock/i.test(sql)) return []
          return []
        },
        async get(params = {}) {
          if (/FROM stock_session_operations/i.test(sql)) return undefined
          if (/FROM products WHERE id = @id/i.test(sql)) return state.products.get(Number(params.id))
          return undefined
        },
        async run() { throw new Error('permission test unexpectedly reached a write') },
      }
    },
    async batch() { throw new Error('permission test unexpectedly reached a batch write') },
  }
  const requireAuth = async (c, next) => { c.set('user', c.env.TEST_USER); await next() }
  const identity = {
    findDuplicateProductGroups: async () => state.groups,
    normalizeProductClusterKey: (value) => String(value || '').trim().toLowerCase(),
    identityBarcodeKey: (value) => String(value || '').trim().toLowerCase(),
    productsShareExactIdentity: () => true,
    canonicalProductBarcode: (rows) => rows.find((row) => row.barcode)?.barcode || null,
  }
  const productMerge = {
    MERGE_COST_FIELDS: ['cost_price_usd', 'cost_price_khr'],
    MERGE_PRICE_FIELDS: ['selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr'],
    resolveProductMergeEconomics: (rows) => ({ merged: { ...rows[0] }, issues: [] }),
    resolveProductMergeClusterPlanEconomics: () => ({ merged: {}, issues: [] }),
    productMergeNumericError: () => '',
    productMergeCaseKey: (keepId, mergeId) => `${keepId}:${mergeId}`,
  }
  const sqlBinding = {
    buildInClause: (prefix, values) => ({ sql: values.map((_, index) => `@${prefix}${index}`).join(','), params: Object.fromEntries(values.map((value, index) => [`${prefix}${index}`, value])) }),
    chunkForBinding: (values) => [values],
    selectInChunks: async (values, reserve, select) => select(values),
  }
  const exactStubs = {
    hono: { Hono },
    '../lib/auth': { requireAuth },
    '../lib/db': { getDb: () => db },
    '../lib/permissions': permissions,
    '../lib/productIdentity': identity,
    '../lib/productDetailRule': {
      normalizeProductGroupName: (value) => String(value || '').trim().toLowerCase(),
      compareCosts: () => ({ same: true }),
    },
    '../lib/productMerge': productMerge,
    '../lib/sqlBinding': sqlBinding,
    '../lib/undoAppliers': { registerMergeFold: () => {}, MERGE_REPARENT_TABLES: [] },
    '../lib/importImageMatch': { ADMIN_MAX_IMAGES_PER_PRODUCT: 5, MAX_IMAGES_PER_PRODUCT: 3 },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    '../index': {},
  }
  const fallback = permissiveModule()
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(exactStubs, request)) return exactStubs[request]
    if (request.startsWith('../lib/') || request.startsWith('../durable-objects/')) return fallback
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const filePath = path.join(srcRoot, 'routes', 'products.ts')
    const loaded = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', compileTs(filePath))(
      loaded.exports, require, loaded, filePath, path.dirname(filePath),
    )
    return { app: loaded.exports.default, db, helpers: loaded.exports }
  } finally {
    Module._load = originalLoad
  }
}

const blockedImageUser = {
  id: 10, username: 'merge-user', name: 'Merge User', role_code: 'staff',
  role_permissions: JSON.stringify({ products: true, 'products:merge_duplicates': true, 'products:image': false }),
  permissions: null,
}

async function request(state, routePath, body = {}) {
  const { app } = loadProductsRoute(state)
  return app.request(routePath, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, { TEST_USER: blockedImageUser }, { waitUntil() {}, passThroughOnException() {} })
}

async function main() {
  {
    const keeper = product(1, '/uploads/keeper.png')
    const duplicate = product(2, '/uploads/duplicate.png')
    const state = freshState([{ canonical: keeper, duplicates: [duplicate] }], [2])
    const response = await request(state, '/merge-duplicates')
    assert.equal(response.status, 403)
    console.log('PASS bulk merge blocks a discarded gallery mutation')
  }
  {
    const keeper = product(1)
    const duplicate = product(2, '/uploads/duplicate.png')
    const state = freshState([{ canonical: keeper, duplicates: [duplicate] }])
    const response = await request(state, '/merge-duplicates')
    assert.equal(response.status, 403)
    console.log('PASS bulk merge blocks primary-image adoption')
  }
  {
    const keeper = product(1, '/uploads/keeper.png')
    const duplicates = Array.from({ length: 26 }, (_, index) => product(index + 2, `/uploads/duplicate-${index}.png`))
    const state = freshState([{ canonical: keeper, duplicates }])
    const response = await request(state, '/merge-duplicates')
    assert.equal(response.status, 200, await response.clone().text())
    console.log('PASS bulk merge with unchanged image fields remains allowed')
  }
  {
    const keeper = product(1, '/uploads/keeper.png')
    const duplicate = product(2, '/uploads/duplicate.png')
    const state = freshState([{ canonical: keeper, duplicates: [duplicate] }], [2])
    const response = await request(state, '/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge' })
    assert.equal(response.status, 403, await response.clone().text())
    console.log('PASS pair merge blocks an eligible discarded gallery mutation')
  }
  {
    const keeper = product(1, '/uploads/keeper.png')
    const duplicate = product(2, '/uploads/duplicate.png')
    const state = freshState([{ canonical: keeper, duplicates: [duplicate] }])
    const { db, helpers } = loadProductsRoute(state)
    assert.equal(await helpers.productMergeChangesImages(db, [{ keeper, discarded: duplicate }]), false)
    console.log('PASS different primary values alone do not block when the keeper stays unchanged')
  }
  {
    const keeper = product(1, '/uploads/keeper.png')
    const duplicate = product(2)
    const state = freshState([{ canonical: keeper, duplicates: [duplicate] }])
    const { helpers } = loadProductsRoute(state)
    const guard = helpers.productMergeNoImageEffectAssertion(1, 2)
    const sqlite = new Database(':memory:')
    sqlite.exec('CREATE TABLE products(id INTEGER PRIMARY KEY,image_path TEXT); CREATE TABLE product_images(product_id INTEGER,image_path TEXT)')
    sqlite.prepare('INSERT INTO products(id,image_path) VALUES(?,?)').run(1, keeper.image_path)
    sqlite.prepare('INSERT INTO products(id,image_path) VALUES(?,?)').run(2, duplicate.image_path)
    sqlite.prepare('INSERT INTO product_images(product_id,image_path) VALUES(?,?)').run(2, '/uploads/concurrent.png')
    assert.throws(() => sqlite.prepare(guard.sql).get(guard.params), /malformed JSON/)
    const source = fs.readFileSync(path.join(srcRoot, 'routes', 'products.ts'), 'utf8')
    const guardedImageBlock = source.slice(source.indexOf('if (canChangeProductImages)'), source.indexOf("statements.push({ sql: 'UPDATE products SET is_active", source.indexOf('if (canChangeProductImages)')))
    assert.match(guardedImageBlock, /INSERT INTO product_images/)
    assert.match(guardedImageBlock, /DELETE FROM product_images/)
    assert.match(guardedImageBlock, /UPDATE products SET image_path/)
    console.log('PASS atomic no-image guard rejects a gallery attached after preflight')
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
