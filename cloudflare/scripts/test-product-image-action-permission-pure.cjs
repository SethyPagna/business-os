// Drives the real products Hono create/update handlers. The products:image
// override applies only when the requested primary/gallery actually changes;
// unchanged full-form submissions are stripped before review/direct writers.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')

const cloudflareRoot = path.join(__dirname, '..')
const srcRoot = path.join(cloudflareRoot, 'src')

function compileTs(filePath) {
  return ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
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

const media = loadTs('lib/media.ts')
const sqlBinding = loadTs('lib/sqlBinding.ts')
const imagePermission = loadTs('lib/productImagePermission.ts', { './media': media, './sqlBinding': sqlBinding })
const permissions = loadTs('lib/permissions.ts')

function permissiveModule() {
  return new Proxy({}, {
    get(target, property) {
      if (!(property in target)) target[property] = () => undefined
      return target[property]
    },
  })
}

function role(grants) {
  return {
    id: 10,
    name: 'Test User',
    username: 'tester',
    role_code: 'staff',
    role_permissions: JSON.stringify(grants),
    permissions: null,
  }
}

function freshState(user, assetPaths = ['/uploads/one.png', '/uploads/two.png', '/uploads/three.png', '/uploads/new.png']) {
  return {
    user,
    current: { id: 77, image_path: '/uploads/one.png', description: 'old' },
    currentGallery: ['/uploads/one.png', '/uploads/two.png'],
    queued: [],
    inserted: [],
    updated: [],
    synced: [],
    dbWrites: 0,
    assetPaths: new Set(assetPaths),
  }
}

function loadProductsRoute(state) {
  const db = {
    prepare(sql) {
      return {
        async all(params = []) {
          if (/SELECT public_path FROM file_assets/i.test(sql)) {
            return [...state.assetPaths].filter((public_path) => Object.values(params).includes(public_path)).map((public_path) => ({ public_path }))
          }
          if (/FROM product_images/i.test(sql)) return state.currentGallery.map((image_path) => ({ image_path }))
          return []
        },
        async get() {
          if (/SELECT image_path FROM products/i.test(sql)) return { image_path: state.current.image_path }
          if (/SELECT \* FROM products/i.test(sql)) return { ...state.current }
          return undefined
        },
        async run() { state.dbWrites++; return { changes: 1, lastInsertRowid: 77 } },
      }
    },
    async batch() { state.dbWrites++; return [] },
  }
  const productWrites = {
    PRODUCT_SKIP_KEYS: new Set(),
    nowIso: () => '',
    tableColumns: async () => [],
    clampNegativeStockQuantity: () => {},
    cleanPayload: (value) => value,
    insertRow: async (_env, _table, body) => { state.inserted.push({ ...body }); return 77 },
    updateRow: async (_env, _table, _id, body) => { state.updated.push({ ...body }); return 1 },
    syncProductImageGallery: async (_env, _id, gallery) => { state.synced.push([...gallery]); return [...gallery] },
    defaultBranchId: async () => 1,
    seedBranchStockForNewProduct: async () => {},
    seedInitialBatchForNewProduct: async () => {},
    isImageOnlyWritePayload: (body) => Object.keys(body).every((key) => ['image_path', 'image_gallery'].includes(key)),
    restrictToImageOnlyFields: (value) => value,
    normalizeMultiValue: () => undefined,
    validateProductImageGallery: (value, limit = 3) => {
      const gallery = media.sanitizeMediaList(value)
      if (gallery.length > limit) throw new productWrites.ProductImageLimitError(limit, gallery.length)
      return gallery
    },
    validatePreservedProductImageGallery: () => null,
    ProductImageLimitError: class ProductImageLimitError extends Error {
      constructor(limit, supplied) { super('too many'); this.limit = limit; this.supplied = supplied; this.code = 'product_image_limit_exceeded' }
    },
  }
  const requireAuth = async (c, next) => { c.set('user', c.env.TEST_USER); await next() }
  const exactStubs = {
    hono: { Hono },
    '../lib/auth': { requireAuth },
    '../lib/permissions': permissions,
    '../lib/db': { getDb: () => db },
    '../lib/media': media,
    '../lib/productImagePermission': imagePermission,
    '../lib/productWrites': productWrites,
    '../lib/reviewGate': {
      maybeQueueForReview: async (_env, user, _section, request) => {
        if (permissions.getPermissionTier(user, 'products') !== 'review') return null
        state.queued.push(request)
        return 901
      },
    },
    '../lib/cache': { cachedJsonResponse: async () => undefined, getVersionWithFallback: async () => '1', bumpVersion: async () => {} },
    '../lib/importImageMatch': { ADMIN_MAX_IMAGES_PER_PRODUCT: 5, MAX_IMAGES_PER_PRODUCT: 3, matchLibraryImagesStrict: () => ({}) },
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
    return loaded.exports.default
  } finally {
    Module._load = originalLoad
  }
}

async function request(state, pathName, method, body) {
  return loadProductsRoute(state).request(pathName, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, { TEST_USER: state.user }, { waitUntil() {}, passThroughOnException() {} })
}

async function main() {
  assert.equal(imagePermission.productImageFieldsChanged({
    image_path: '/uploads/one.png?v=12',
    image_gallery: ['/uploads/one.png?v=12', '/uploads/two.png#cache'],
  }, {
    image_path: '/uploads/one.png',
    image_gallery: ['/uploads/one.png', '/uploads/two.png'],
  }), false, 'cache suffixes do not turn an unchanged image into a mutation')
  assert.equal(imagePermission.productImageFieldsChanged({ image_gallery: ['/uploads/two.png', '/uploads/one.png'] }, {
    image_path: '/uploads/one.png', image_gallery: ['/uploads/one.png', '/uploads/two.png'],
  }), true, 'gallery order is part of the image state')

  {
    const state = freshState(role({ products: true, 'products:image': false }))
    const response = await request(state, '/77', 'PUT', {
      description: 'new', image_path: '/uploads/three.png', image_gallery: ['/uploads/three.png'],
    })
    assert.equal(response.status, 403)
    assert.equal(state.queued.length + state.updated.length + state.synced.length, 0)
    console.log('PASS changed edit is denied before review/direct image writes')
  }

  {
    const state = freshState(role({ products: true, 'products:image': false }))
    const response = await request(state, '/77', 'PUT', {
      description: 'new', image_path: '/uploads/one.png?v=12', image_gallery: ['/uploads/one.png', '/uploads/two.png'],
    })
    assert.equal(response.status, 200)
    assert.equal(state.updated.length, 1)
    assert.deepEqual(state.updated[0], { description: 'new' })
    assert.equal(state.synced.length, 0)
    console.log('PASS unchanged full-form images are omitted and products:edit still succeeds')
  }

  {
    const state = freshState(role({ products: true, 'products:image': false }), [])
    state.current.image_path = '/uploads/orphan.png'
    state.currentGallery = ['/uploads/orphan.png']
    const response = await request(state, '/77', 'PUT', {
      description: 'new', image_path: '/uploads/orphan.png', image_gallery: ['/uploads/orphan.png'],
    })
    assert.equal(response.status, 200, await response.clone().text())
    assert.deepEqual(state.updated[0], { description: 'new' })
    assert.equal(state.synced.length, 0)
    console.log('PASS unchanged orphan image values do not block an authorized non-image edit')
  }

  {
    const state = freshState(role({ products: true, 'products:image': false }), [
      '/uploads/Lovenude Lip Stain.webp', '/uploads/two.png',
    ])
    state.current.image_path = '/uploads/Lovenude Lip Stain.webp'
    state.currentGallery = ['/uploads/Lovenude Lip Stain.webp', '/uploads/two.png']
    const response = await request(state, '/77', 'PUT', {
      description: 'new', image_path: '/uploads/Lovenude%20Lip%20Stain.webp',
      image_gallery: ['/uploads/Lovenude%20Lip%20Stain.webp', '/uploads/two.png'],
    })
    assert.equal(response.status, 200, await response.clone().text())
    assert.deepEqual(state.updated[0], { description: 'new' })
    console.log('PASS one-layer legacy alias resolves before unchanged-image permission comparison')
  }

  {
    const state = freshState(role({ products: true, 'products:image': false }), [
      '/uploads/Lovenude%20Lip%20Stain.webp', '/uploads/Lovenude Lip Stain.webp',
    ])
    state.current.image_path = '/uploads/Lovenude Lip Stain.webp'
    state.currentGallery = ['/uploads/Lovenude Lip Stain.webp']
    const response = await request(state, '/77', 'PUT', {
      image_path: '/uploads/Lovenude%20Lip%20Stain.webp', image_gallery: ['/uploads/Lovenude%20Lip%20Stain.webp'],
    })
    assert.equal(response.status, 403)
    assert.equal(state.updated.length + state.synced.length, 0)
    console.log('PASS exact percent identity wins over a decoded alias and remains a real change')
  }

  {
    const state = freshState(role({ products: true }))
    const response = await request(state, '/77', 'PUT', {
      image_path: '/uploads/missing.png', image_gallery: ['/uploads/missing.png'],
    })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).code, 'missing_image_asset')
    assert.equal(state.updated.length + state.synced.length, 0)
    console.log('PASS a missing upload identity is rejected before product writes')
  }

  {
    const state = freshState(role({ products: 'review' }))
    const response = await request(state, '/77', 'PUT', {
      description: 'new', image_path: '/uploads/two.png', image_gallery: ['/uploads/two.png', '/uploads/one.png'],
    })
    assert.equal(response.status, 202)
    assert.equal(state.queued.length, 1)
    assert.deepEqual(state.queued[0].payload.image_gallery, ['/uploads/two.png', '/uploads/one.png'])
    assert.equal(state.updated.length + state.synced.length, 0)
    console.log('PASS review-tier image change remains review queued when image action is not blocked')
  }

  {
    const state = freshState(role({ products: 'review', 'products:image': false }))
    const response = await request(state, '/77', 'PUT', {
      image_path: '/uploads/two.png', image_gallery: ['/uploads/two.png', '/uploads/one.png'],
    })
    assert.equal(response.status, 403)
    assert.equal(state.queued.length, 0)
    console.log('PASS products:image=false blocks a changed review request before it queues')
  }

  {
    const state = freshState(role({ products_image_only: true }))
    const response = await request(state, '/77', 'PUT', {
      image_path: '/uploads/two.png', image_gallery: ['/uploads/two.png', '/uploads/one.png'],
    })
    assert.equal(response.status, 200)
    assert.equal(state.updated.length, 1)
    assert.equal(state.synced.length, 1)
    console.log('PASS dedicated image-only role keeps its existing changed-image write path')
  }

  {
    const state = freshState(role({ products: true, 'products:image': false }))
    const response = await request(state, '/', 'POST', {
      name: 'New product', image_path: '/uploads/new.png', image_gallery: ['/uploads/new.png'],
    })
    assert.equal(response.status, 403)
    assert.equal(state.inserted.length + state.synced.length, 0)
    console.log('PASS changed create is denied before insert')
  }

  {
    const state = freshState(role({ products: true, 'products:image': false }))
    const response = await request(state, '/', 'POST', { name: 'No image', image_path: null, image_gallery: [] })
    assert.equal(response.status, 200)
    assert.deepEqual(state.inserted[0], { name: 'No image' })
    assert.equal(state.synced.length, 0)
    console.log('PASS empty create image fields need no image grant and perform no image write')
  }

  {
    const state = freshState(role({ products: true, 'products:image': false }))
    const response = await request(state, '/variant', 'POST', { name: 'Variant', image_path: '/uploads/new.png' })
    assert.equal(response.status, 403)
    assert.equal(state.inserted.length, 0)
    console.log('PASS variant creation cannot bypass the image action override')
  }

  const syncSource = fs.readFileSync(path.join(srcRoot, 'routes', 'sync.ts'), 'utf8')
  assert.match(syncSource, /'products\.update': \{ method: 'PUT', path: \(op\) => `\/api\/products\/\$\{encodeURIComponent/)
  assert.match(syncSource, /const result = await replayOperation\(mainApp,[\s\S]*operation, route\)/)
  console.log('PASS offline products.update dispatches through the same guarded real product route')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
