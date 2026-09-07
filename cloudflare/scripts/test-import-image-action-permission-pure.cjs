// Runs the real import Hono handlers for image assignment, wiring, approval,
// and apply retry. A blocked products:image action may still approve an import
// whose analyzed image path is unchanged or whose changed row was skipped.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')

const srcRoot = path.join(__dirname, '..', 'src')

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

const permissions = loadTs('lib/permissions.ts')
const media = loadTs('lib/media.ts')

function role(grants) {
  return {
    id: 10,
    username: 'importer',
    name: 'Importer',
    role_code: 'staff',
    permissions: JSON.stringify(grants),
    role_permissions: null,
  }
}

function resultRow(action, imagePath, existingId = 77, rowNumber = 2, plannedMode) {
  return {
    row_number: rowNumber,
    action,
    result_json: JSON.stringify({ rowNumber, action, existingId, plannedMode, data: { name: `Product ${rowNumber}`, image_path: imagePath } }),
  }
}

function freshState(user, options = {}) {
  const policy = options.policy || {}
  return {
    user,
    job: {
      id: 'job-1',
      type: 'products',
      status: options.status || 'awaiting_review',
      cancel_requested: 0,
      policy_json: JSON.stringify(policy),
      summary_json: JSON.stringify(options.summary || {}),
    },
    analyzedRows: options.analyzedRows || [],
    currentProducts: options.currentProducts || [{ id: 77, image_path: '/uploads/old.png' }],
    lateImagePaths: options.lateImagePaths || {},
    dbWrites: 0,
    batches: 0,
    queue: [],
  }
}

function permissiveModule() {
  return new Proxy({}, {
    get(target, property) {
      if (!(property in target)) target[property] = () => undefined
      return target[property]
    },
  })
}

function loadImportRoute(state) {
  const staging = {
    prepare(sql) {
      return {
        async all() {
          if (/FROM import_job_rows/i.test(sql)) return state.analyzedRows
          return []
        },
        async get() { return { n: 0 } },
        async run() { state.dbWrites++; return { changes: 1 } },
      }
    },
    async batch() { state.batches++; return [] },
  }
  const db = {
    staging,
    prepare(sql) {
      return {
        async all() {
          if (/SELECT id, image_path FROM products WHERE id IN/i.test(sql)) return state.currentProducts
          return []
        },
        async get() {
          if (/SELECT \* FROM import_jobs/i.test(sql)) return state.job
          if (/COUNT\(\*\).*import_job_files/i.test(sql)) return { n: 1 }
          return undefined
        },
        async run() { state.dbWrites++; return { changes: 1, lastInsertRowid: 1 } },
      }
    },
    async batch() { state.batches++; return [] },
  }
  const requireAuth = async (c, next) => { c.set('user', c.env.TEST_USER); await next() }
  const importEngine = new Proxy({
    PREFLIGHT_MAX_ROWS: 1000,
    SERIOUS_IMPORT_WARNING_KINDS: [],
    IMPORT_WARNING_LABELS: {},
    computeImportImageMatch: async () => ({
      rowImagePaths: new Map(Object.entries(state.lateImagePaths).map(([rowNumber, imagePath]) => [Number(rowNumber), imagePath])),
      rowGalleryPaths: new Map(), matched: [], unmatched: [], overLimit: [], renamePlan: new Map(),
    }),
  }, { get(target, property) { if (!(property in target)) target[property] = async () => undefined; return target[property] } })
  const exactStubs = {
    hono: { Hono },
    '../lib/auth': { requireAuth },
    '../lib/db': { getDb: () => db },
    '../lib/permissions': permissions,
    '../lib/media': media,
    '../lib/importEngine': importEngine,
    '../lib/importLifecycleGate': {
      canEditImportDecisions: () => true,
      canReplaceImportCsv: () => true,
      retryModeForImportStatus: (status) => status === 'failed' ? 'apply' : 'analyze',
    },
    '../lib/importRetention': { importJobFullDeleteStatements: () => [], importJobStagingDeleteStatements: () => [] },
    '../lib/importReviewQuery': {
      buildImportReviewOrder: () => '',
      buildImportReviewWhere: () => ({ sql: '1=1', params: {} }),
      buildUnresolvedContactReviewWhere: () => ({ sql: '1=0', params: {} }),
      buildUnresolvedProductReviewWhere: () => ({ sql: '1=0', params: {} }),
    },
    '../lib/audit': { audit: async () => {} },
    '../lib/actorSnapshot': { actorSnapshot: (user) => user?.name || null },
    '../lib/cache': { bumpVersion: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    '../lib/importImageMatch': { MAX_IMAGES_PER_PRODUCT: 3, buildImageDisplayName: () => 'image.png' },
    '../index': {},
  }
  const fallback = permissiveModule()
  const routePath = path.join(srcRoot, 'routes', 'importJobs.ts')
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

async function request(state, routePath, method = 'POST', body = {}) {
  return loadImportRoute(state).request(routePath, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, {
    TEST_USER: state.user,
    IMPORT_QUEUE: { send: async (message) => { state.queue.push(message) } },
  }, { waitUntil() {}, passThroughOnException() {} })
}

async function main() {
  const blocked = () => role({ products: true, 'products:image': false })

  {
    const state = freshState(blocked())
    const response = await request(state, '/job-1/images/assign-existing', 'PATCH', { file_id: 2, product_id: 77 })
    assert.equal(response.status, 403)
    assert.equal(state.dbWrites + state.batches, 0)
    console.log('PASS assign-existing blocks before live product image writes')
  }

  {
    const state = freshState(blocked())
    const response = await request(state, '/job-1/images/wire')
    assert.equal(response.status, 403)
    assert.equal(state.dbWrites, 0)
    console.log('PASS wire opt-in requires the product image action')
  }

  {
    const state = freshState(blocked(), { analyzedRows: [resultRow('update', '/uploads/new.png')] })
    const response = await request(state, '/job-1/approve')
    assert.equal(response.status, 403)
    assert.equal(state.dbWrites + state.queue.length, 0)
    console.log('PASS approval blocks an analyzed image change before status or queue writes')
  }

  {
    const state = freshState(blocked(), { policy: { wire_images: true }, analyzedRows: [] })
    const response = await request(state, '/job-1/approve')
    assert.equal(response.status, 200)
    assert.equal(state.queue.length, 1)
    console.log('PASS a late wire plan with no actual image match remains approvable')
  }

  {
    const state = freshState(blocked(), { analyzedRows: [resultRow('update', '/uploads/old.png?v=2')] })
    const response = await request(state, '/job-1/approve')
    assert.equal(response.status, 200)
    assert.equal(state.queue.length, 1)
    console.log('PASS unchanged imported image path remains approvable with image action blocked')
  }

  {
    const state = freshState(blocked(), {
      policy: { wire_images: true, imageOverrides: { 5: 2 }, decisionsByRowNumber: { 2: { action: 'skip' } } },
      analyzedRows: [resultRow('update', '/uploads/new.png')],
      lateImagePaths: { 2: '/uploads/override.png' },
      summary: { imageMatch: { matchedCount: 1 } },
    })
    const response = await request(state, '/job-1/approve')
    assert.equal(response.status, 200)
    assert.equal(state.queue.length, 1)
    console.log('PASS a skipped changed-image row and its manual override do not require image authority')
  }

  {
    const state = freshState(blocked(), {
      policy: { import_mode: 'replace_columns', replace_columns: ['selling_price_usd'] },
      analyzedRows: [resultRow('update', '/uploads/new.png')],
    })
    const response = await request(state, '/job-1/approve')
    assert.equal(response.status, 200)
    assert.equal(state.queue.length, 1)
    console.log('PASS replace-columns excluding image_path ignores analyzed image data')
  }

  {
    const state = freshState(blocked(), { analyzedRows: [resultRow('update', '/uploads/new.png', 77, 2, 'merge_stock')] })
    const response = await request(state, '/job-1/approve')
    assert.equal(response.status, 200)
    assert.equal(state.queue.length, 1)
    console.log('PASS merge-stock ignores analyzed image data')
  }

  {
    const state = freshState(blocked(), {
      policy: { wire_images: true }, analyzedRows: [resultRow('update', '')], lateImagePaths: { 2: '/uploads/new.png' },
    })
    const response = await request(state, '/job-1/approve')
    assert.equal(response.status, 403)
    assert.equal(state.dbWrites + state.queue.length, 0)
    console.log('PASS a late wire plan with an effective image change is blocked')
  }

  {
    const state = freshState(blocked(), { status: 'failed', analyzedRows: [resultRow('create', '/uploads/new.png', null)] })
    const response = await request(state, '/job-1/retry')
    assert.equal(response.status, 403)
    assert.equal(state.dbWrites + state.queue.length, 0)
    console.log('PASS apply retry rechecks changed product image authority')
  }

  {
    const state = freshState(role({ products: true }))
    const response = await request(state, '/job-1/images/wire')
    assert.equal(response.status, 200)
    assert.equal(state.dbWrites, 1)
    console.log('PASS existing full-products import image wiring remains allowed')
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
