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
const sqlBinding = loadTs('lib/sqlBinding.ts')
const productImagePermission = loadTs('lib/productImagePermission.ts', { './media': media, './sqlBinding': sqlBinding })

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
    assetPaths: new Set(options.assetPaths || ['/uploads/old.png', '/uploads/new.png', '/uploads/override.png']),
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
        async all(params = {}) {
          if (/SELECT id, image_path FROM products WHERE id IN/i.test(sql)) return state.currentProducts
          if (/SELECT public_path FROM file_assets/i.test(sql)) {
            return [...state.assetPaths].filter((public_path) => Object.values(params).includes(public_path)).map((public_path) => ({ public_path }))
          }
          return []
        },
        async get() {
          if (/SELECT \* FROM import_jobs/i.test(sql)) return state.job
          if (/COUNT\(\*\).*import_job_files/i.test(sql)) return { n: 1 }
          return undefined
        },
        async run(params = {}) {
          state.dbWrites++
          if (/UPDATE import_jobs SET/i.test(sql) && typeof params.policy === 'string') state.job.policy_json = params.policy
          return { changes: 1, lastInsertRowid: 1 }
        },
      }
    },
    async batch() { state.batches++; return [] },
  }
  const requireAuth = async (c, next) => { c.set('user', c.env.TEST_USER); await next() }
  const importEngine = new Proxy({
    PREFLIGHT_MAX_ROWS: 1000,
    SERIOUS_IMPORT_WARNING_KINDS: [],
    IMPORT_WARNING_LABELS: {},
    getProductImportReplaceColumns: (policyJson) => {
      const requested = JSON.parse(policyJson || '{}').replace_columns
      return Array.isArray(requested) ? [...new Set(requested.filter((value) => value === 'image_path' || value === 'selling_price_usd'))] : []
    },
    productImportChangesImages: async (_env, job) => {
      const policy = JSON.parse(job.policy_json || '{}')
      const decisions = policy.decisionsByRowNumber || {}
      const updates = []
      for (const row of state.analyzedRows) {
        if (decisions[String(row.row_number)]?.action === 'skip') continue
        const result = JSON.parse(row.result_json || '{}')
        const imagePath = media.sanitizeMediaPath(state.lateImagePaths[row.row_number] || result.data?.image_path, '')
        if (!imagePath || result.plannedMode === 'merge_stock') continue
        if (policy.import_mode === 'replace_columns') {
          const requested = Array.isArray(policy.replace_columns)
            ? [...new Set(policy.replace_columns.filter((value) => value === 'image_path' || value === 'selling_price_usd'))]
            : []
          if (requested.length && !requested.includes('image_path')) continue
        }
        if (row.action === 'create' || !Number.isInteger(Number(result.existingId)) || Number(result.existingId) <= 0) return true
        updates.push({ id: Number(result.existingId), imagePath })
      }
      if (!updates.length) return false
      const current = new Map(state.currentProducts.map((row) => [Number(row.id), media.sanitizeMediaPath(row.image_path, '')]))
      const identities = await productImagePermission.resolveProductImagePathIdentities(db, [
        ...updates.map((entry) => entry.imagePath),
        ...current.values(),
      ])
      return updates.some((entry) => {
        const currentPath = current.get(entry.id) || ''
        return (identities.get(currentPath) || currentPath) !== (identities.get(entry.imagePath) || entry.imagePath)
      })
    },
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
    '../lib/productImagePermission': productImagePermission,
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
    assert.equal(JSON.parse(state.job.policy_json).apply_authorized_by_id, state.user.id)
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

  for (const replaceColumns of [[], ['bogus']]) {
    const state = freshState(blocked(), {
      policy: { import_mode: 'replace_columns', replace_columns: replaceColumns },
      analyzedRows: [resultRow('update', '/uploads/new.png')],
    })
    const response = await request(state, '/job-1/approve')
    assert.equal(response.status, 403)
    assert.equal(state.dbWrites + state.queue.length, 0)
    console.log(`PASS replace-columns ${JSON.stringify(replaceColumns)} follows the exhaustive apply fallback and blocks an image change`)
  }

  {
    const state = freshState(blocked(), {
      analyzedRows: [resultRow('update', '/uploads/Love Nude.webp')],
      currentProducts: [{ id: 77, image_path: '/uploads/Love%20Nude.webp' }],
      assetPaths: ['/uploads/Love Nude.webp'],
    })
    const response = await request(state, '/job-1/approve')
    assert.equal(response.status, 200)
    assert.equal(state.queue.length, 1)
    console.log('PASS a one-layer legacy alias of the same image asset does not require image authority')
  }

  {
    const state = freshState(blocked(), {
      analyzedRows: [resultRow('update', '/uploads/Love%20Nude.webp')],
      currentProducts: [{ id: 77, image_path: '/uploads/Love Nude.webp' }],
      assetPaths: ['/uploads/Love Nude.webp', '/uploads/Love%20Nude.webp'],
    })
    const response = await request(state, '/job-1/approve')
    assert.equal(response.status, 403)
    assert.equal(state.queue.length, 0)
    console.log('PASS two exact percent/space asset identities remain a real image change')
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
    const state = freshState(role({ products: true, 'products:image': true }), { status: 'failed', analyzedRows: [resultRow('update', '/uploads/new.png')] })
    const response = await request(state, '/job-1/retry')
    assert.equal(response.status, 200)
    assert.equal(JSON.parse(state.job.policy_json).apply_authorized_by_id, state.user.id)
    assert.equal(state.queue[0]?.kind, 'apply')
    console.log('PASS authorized apply retry stamps the current actor before enqueue')
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
