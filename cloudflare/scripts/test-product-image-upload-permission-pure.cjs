// Executes the real products upload-image Hono handler with binding/database
// doubles. Authorization must finish before multipart parsing or any side
// effect, while existing full/admin and image-only upload paths stay working.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')

const cloudflareRoot = path.join(__dirname, '..')
const srcRoot = path.join(cloudflareRoot, 'src')

function compileTs(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText
}

function executeCommonJs(filePath, output, stubs) {
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const loaded = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
      loaded.exports, require, loaded, filePath, path.dirname(filePath),
    )
    return loaded.exports
  } finally {
    Module._load = originalLoad
  }
}

const permissionsPath = path.join(srcRoot, 'lib', 'permissions.ts')
const permissions = executeCommonJs(permissionsPath, compileTs(permissionsPath), {})

function permissiveModule() {
  return new Proxy({}, {
    get(target, property) {
      if (!(property in target)) target[property] = () => undefined
      return target[property]
    },
  })
}

function loadProductsRoute(state) {
  const routePath = path.join(srcRoot, 'routes', 'products.ts')
  const requireAuth = async (c, next) => {
    c.set('user', c.env.TEST_USER)
    await next()
  }
  const db = {
    prepare(sql) {
      state.dbStatements.push(sql)
      return {
        async run() {
          state.dbWrites++
          return { lastInsertRowid: 77, changes: 1 }
        },
        async get() {
          return { id: 77, public_path: '/uploads/product-test.png' }
        },
        async all() { return [] },
      }
    },
    async batch() { state.dbWrites++; return [] },
  }
  const exactStubs = {
    hono: { Hono },
    '../lib/auth': { requireAuth },
    '../lib/permissions': permissions,
    '../lib/db': { getDb: () => db },
    '../lib/rateLimit': {
      getClientIp: () => '127.0.0.1',
      checkRateLimit: async () => { state.rateLimitCalls++; return { allowed: true } },
    },
    '../lib/fileAssets': {
      getMediaType: () => 'image',
      buildUniqueStoredName: () => 'product-test.png',
      sanitizeOriginalFileName: (name) => String(name || 'image'),
    },
    '../lib/uploadSecurity': { validateUploadedBuffer: () => {} },
    '../lib/imageAudit': {
      enqueueImageNormalization: async () => { state.normalizationCalls++ },
    },
    '../lib/audit': { audit: async () => { state.auditWrites++ } },
    '../lib/cache': {
      cachedJsonResponse: async () => undefined,
      getVersionWithFallback: async () => '1',
      bumpVersion: async () => { state.versionWrites++ },
    },
    '../lib/importImageMatch': {
      matchLibraryImagesStrict: () => ({ matches: [], unmatched: [], ambiguous: [] }),
      ADMIN_MAX_IMAGES_PER_PRODUCT: 5,
      MAX_IMAGES_PER_PRODUCT: 3,
    },
    '../lib/productWrites': {
      PRODUCT_SKIP_KEYS: new Set(),
      nowIso: () => '',
      tableColumns: async () => [],
      clampNegativeStockQuantity: () => {},
      cleanPayload: (value) => value,
      insertRow: async () => 1,
      updateRow: async () => 1,
      syncProductImageGallery: async () => [],
      defaultBranchId: async () => 1,
      seedBranchStockForNewProduct: async () => {},
      seedInitialBatchForNewProduct: async () => {},
      isImageOnlyWritePayload: () => false,
      restrictToImageOnlyFields: (value) => value,
      normalizeMultiValue: () => undefined,
      validateProductImageGallery: (value) => value,
      validatePreservedProductImageGallery: () => null,
      ProductImageLimitError: class ProductImageLimitError extends Error {},
    },
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
    const loaded = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', compileTs(routePath))(
      loaded.exports, require, loaded, routePath, path.dirname(routePath),
    )
    return loaded.exports.default
  } finally {
    Module._load = originalLoad
  }
}

function freshState(user) {
  const state = {
    user,
    r2Writes: 0,
    dbWrites: 0,
    dbStatements: [],
    auditWrites: 0,
    normalizationCalls: 0,
    versionWrites: 0,
    rateLimitCalls: 0,
  }
  state.env = {
    TEST_USER: user,
    ASSETS: { put: async () => { state.r2Writes++ } },
  }
  return state
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

async function requestUpload(state, includeImage = true) {
  const app = loadProductsRoute(state)
  const form = new FormData()
  if (includeImage) {
    form.set('image', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'product.png', { type: 'image/png' }))
  }
  return app.request('/upload-image', { method: 'POST', body: form }, state.env, {
    waitUntil(promise) { state.waitUntil = Promise.resolve(promise) },
    passThroughOnException() {},
  })
}

function assertNoUploadSideEffects(state) {
  assert.equal(state.rateLimitCalls, 0, 'denied request stops before rate limiting')
  assert.equal(state.r2Writes, 0, 'denied request must not write R2')
  assert.equal(state.dbWrites, 0, 'denied request must not write file_assets')
  assert.equal(state.dbStatements.length, 0, 'denied request must not even prepare a database statement')
  assert.equal(state.auditWrites, 0, 'denied request must not write audit history')
  assert.equal(state.normalizationCalls, 0, 'denied request must not enqueue normalization')
  assert.equal(state.versionWrites, 0, 'denied request must not bump product cache version')
}

async function checkDenied(name, user) {
  const state = freshState(user)
  const response = await requestUpload(state, false)
  assert.equal(response.status, 403, name)
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'No permission',
    code: 'forbidden',
    permission: 'products',
  })
  assertNoUploadSideEffects(state)
  console.log('PASS', name)
}

async function checkAllowed(name, user) {
  const state = freshState(user)
  const response = await requestUpload(state)
  assert.equal(response.status, 200, name)
  const body = await response.json()
  assert.equal(body.success, true)
  assert.equal(body.path, '/uploads/product-test.png')
  assert.equal(state.rateLimitCalls, 1)
  assert.equal(state.r2Writes, 1)
  assert.equal(state.dbWrites, 1, 'allowed request inserts one file_assets row')
  assert.equal(state.auditWrites, 1)
  assert.equal(state.normalizationCalls, 1)
  assert.equal(state.versionWrites, 1)
  if (state.waitUntil) await state.waitUntil
  console.log('PASS', name)
}

async function main() {
  await checkDenied('products:image=false returns 403 before every side effect', role({ products: true, 'products:image': false }))
  await checkDenied('review-tier image upload returns 403 instead of bypassing review', role({ products: 'review' }))
  await checkDenied('products:image=true cannot widen a missing products section grant', role({ 'products:image': true }))

  await checkAllowed('existing full-products upload remains successful', role({ products: true }))
  await checkAllowed('administrator upload remains successful', { ...role({ products: false, 'products:image': false }), role_code: 'admin' })
  await checkAllowed('dedicated products-image-only upload remains successful', role({ products_image_only: true }))

  const source = fs.readFileSync(path.join(srcRoot, 'routes', 'products.ts'), 'utf8')
  const handler = source.slice(source.indexOf("app.post('/upload-image'"))
  const gate = handler.indexOf("getActionTier(user, 'products', 'image') !== 'full'")
  assert.ok(gate >= 0, 'upload handler must use the image action tier')
  for (const sideEffect of ['checkRateLimit(', 'c.req.formData(', 'c.env.ASSETS.put(', 'INSERT INTO file_assets', 'await audit(']) {
    assert.ok(gate < handler.indexOf(sideEffect), `authorization must precede ${sideEffect}`)
  }
  for (const sibling of ["app.post('/wire-images/preview'", "app.post('/wire-images'", "app.post('/unwire-images'"]) {
    const start = source.indexOf(sibling)
    const end = source.indexOf('\n})', start)
    assert.match(source.slice(start, end), /getActionTier\(user, 'products', 'image'\) !== 'full'/)
  }
  console.log('PASS upload and sibling image mutations share full-tier action semantics')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
