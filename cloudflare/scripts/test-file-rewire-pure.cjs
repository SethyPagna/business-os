// Runs the real Library rewire route. Product references require current
// product-image authority, while avatar-only rewires remain Library actions.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')

const srcRoot = path.join(__dirname, '..', 'src')

function loadTs(relativePath, stubs = {}) {
  const filePath = path.join(srcRoot, relativePath)
  const outputText = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    if (request.startsWith('../lib/') || request.startsWith('../durable-objects/')) return new Proxy({}, { get: () => () => undefined })
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

const permissions = loadTs('lib/permissions.ts')

function role(grants) {
  return {
    id: 7,
    username: 'librarian',
    role_code: 'staff',
    permissions: JSON.stringify(grants),
    role_permissions: null,
  }
}

function loadRoute(state) {
  const assets = new Map([
    [1, { id: 1, public_path: '/uploads/from.png', original_name: 'from.png', media_type: 'image' }],
    [2, { id: 2, public_path: '/uploads/to.png', original_name: 'to.png', media_type: 'image' }],
  ])
  const db = {
    prepare(sql) {
      return {
        async get(params) {
          if (/FROM file_assets WHERE id = \?/i.test(sql)) return assets.get(Number(params?.[0]))
          if (/EXISTS\(SELECT 1 FROM products/i.test(sql)) {
            return { has_cover: state.cover ? 1 : 0, has_gallery: state.gallery ? 1 : 0 }
          }
          return undefined
        },
        async all() { return [] },
        async run() { throw new Error('rewire must use the guarded batch') },
      }
    },
    async batch(statements) {
      state.batches++
      state.batchSql = statements.map((statement) => statement.sql)
      return statements.map((statement) => ({
        changes: /UPDATE users/i.test(statement.sql) ? (state.avatar ? 1 : 0) : 0,
      }))
    },
  }
  const requireAuth = async (c, next) => { c.set('user', c.env.TEST_USER); await next() }
  const route = loadTs('routes/files.ts', {
    hono: { Hono },
    '../lib/auth': { requireAuth },
    '../lib/db': { getDb: () => db },
    '../lib/permissions': permissions,
    '../lib/audit': { audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    '../lib/cache': { bumpVersion: async () => {} },
    '../index': {},
  })
  return route.default
}

async function rewire(state, grants) {
  return loadRoute(state).request('http://local/1/rewire', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to_file_id: 2 }),
  }, { TEST_USER: role(grants) }, { waitUntil() {}, passThroughOnException() {} })
}

async function main() {
  for (const productRef of ['cover', 'gallery']) {
    const state = { cover: productRef === 'cover', gallery: productRef === 'gallery', avatar: false, batches: 0 }
    const response = await rewire(state, { library: true, products: true, 'products:image': false })
    assert.equal(response.status, 403)
    assert.equal(state.batches, 0)
    console.log(`PASS ${productRef} rewire is denied before product image writes`)
  }

  {
    const state = { cover: false, gallery: false, avatar: true, batches: 0 }
    const response = await rewire(state, { library: true, products: true, 'products:image': false })
    assert.equal(response.status, 200, await response.clone().text())
    assert.equal(state.batches, 1)
    assert.equal(state.batchSql.some((sql) => /products|product_images/i.test(sql)), false)
    console.log('PASS avatar-only rewire remains available with Full Library access')
  }

  for (const grants of [
    { library: true, products: true },
    { library: true, products_image_only: true },
  ]) {
    const state = { cover: true, gallery: true, avatar: false, batches: 0 }
    const response = await rewire(state, grants)
    assert.equal(response.status, 200, await response.clone().text())
    assert.equal(state.batches, 1)
  }
  console.log('PASS full products:image and dedicated image-only authority may rewire product images')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
