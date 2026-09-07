// Focused execution coverage for asynchronous import authority. It loads the
// real transpiled importEngine/queue modules and stubs only their unrelated
// Worker dependencies.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const srcRoot = path.join(__dirname, '..', 'src')

function compile(relativePath) {
  const filePath = path.join(srcRoot, relativePath)
  return {
    filePath,
    output: ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: filePath,
    }).outputText,
  }
}

function load(relativePath, stubs = {}) {
  const { filePath, output } = compile(relativePath)
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

const fallback = new Proxy({}, {
  get(target, property) {
    if (!(property in target)) target[property] = () => undefined
    return target[property]
  },
})
const permissions = load('lib/permissions.ts')
const media = load('lib/media.ts')
const sqlBinding = load('lib/sqlBinding.ts')
const productImagePermission = load('lib/productImagePermission.ts', {
  './media': media,
  './sqlBinding': sqlBinding,
  './db': {},
})

function makeState(actor) {
  const state = {
    actor,
    products: [{ id: 77, image_path: '/uploads/Love Nude.webp' }],
    assets: new Set(['/uploads/Love Nude.webp', '/uploads/new.webp']),
    runs: [],
    batches: 0,
    job: {
      id: 'job-1',
      type: 'products',
      policy_json: JSON.stringify({ apply_authorized_by_id: 10 }),
      summary_json: '{}',
    },
  }
  const staging = {
    prepare(sql) {
      return {
        async all() { return [] },
        async get() { return { n: 0 } },
        async run(params = {}) { state.runs.push({ sql, params, staging: true }); return { changes: 1 } },
      }
    },
    async batch(statements) { state.batches++; state.runs.push(...statements); return [] },
  }
  state.db = {
    staging,
    prepare(sql) {
      return {
        async get() {
          if (/FROM users u/i.test(sql)) return state.actor || undefined
          if (/SELECT status, cancel_requested, started_at FROM import_jobs/i.test(sql)) {
            return { status: 'queued', cancel_requested: 0, started_at: null }
          }
          if (/SELECT id, type, policy_json, summary_json FROM import_jobs/i.test(sql)) return state.job
          return undefined
        },
        async all(params = {}) {
          if (/SELECT id, image_path FROM products WHERE id IN/i.test(sql)) return state.products
          if (/SELECT public_path FROM file_assets/i.test(sql)) {
            return [...state.assets]
              .filter((public_path) => Object.values(params).includes(public_path))
              .map((public_path) => ({ public_path }))
          }
          return []
        },
        async run(params = {}) {
          state.runs.push({ sql, params })
          if (/SET lease_token = @token/i.test(sql)) return { changes: 1 }
          return { changes: 1 }
        },
      }
    },
    async batch(statements) { state.batches++; state.runs.push(...statements); return [] },
  }
  return state
}

let activeState = makeState(null)
const exactStubs = {
  '../index': {},
  './db': { getDb: () => activeState.db },
  './permissions': permissions,
  './auth': {},
  './media': media,
  './productImagePermission': productImagePermission,
  './sqlBinding': sqlBinding,
}
const enginePath = path.join(srcRoot, 'lib', 'importEngine.ts')
const originalLoad = Module._load
Module._load = function patchedEngineLoad(request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(exactStubs, request)) return exactStubs[request]
  if (request.startsWith('./') || request.startsWith('../durable-objects/')) return fallback
  return originalLoad.call(this, request, parent, isMain)
}
let engine
try {
  const { filePath, output } = compile('lib/importEngine.ts')
  const loaded = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(loaded.exports, require, loaded, filePath, path.dirname(filePath))
  engine = loaded.exports
} finally {
  Module._load = originalLoad
}

function actor(grants, overrides = {}) {
  return {
    id: 10,
    username: 'importer',
    name: 'Importer',
    organization_id: 1,
    role_id: 2,
    role_code: 'staff',
    role_permissions: null,
    permissions: JSON.stringify(grants),
    is_active: 1,
    ...overrides,
  }
}

function imageResult(action, imagePath, existingId = 77) {
  return { rowNumber: 2, action, identifier: null, existingId, message: null, data: { name: 'Product', image_path: imagePath } }
}

async function expectAuthorityError(promise, permission) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, 'import_apply_permission_revoked')
    assert.equal(error.permission, permission)
    return true
  })
}

async function main() {
  activeState = makeState(actor({ products: true, 'products:image': true }))
  activeState.job.policy_json = '{}'
  await expectAuthorityError(engine.assertCurrentImportApplyAuthority({}, activeState.job), 'import')
  console.log('PASS missing persisted apply actor fails closed')

  activeState = makeState(null)
  await expectAuthorityError(engine.assertCurrentImportApplyAuthority({}, activeState.job), 'import')
  console.log('PASS deleted or inactive apply actor fails closed')

  activeState = makeState(actor({ products: false, 'products:image': true }))
  await expectAuthorityError(engine.assertCurrentImportApplyAuthority({}, activeState.job), 'products')
  console.log('PASS current base import permission is rechecked')

  activeState = makeState(actor({ products: true, 'products:import': false, 'products:image': true }))
  await expectAuthorityError(engine.assertCurrentImportApplyAuthority({}, activeState.job), 'products:import')
  console.log('PASS current section import action override is rechecked')

  activeState = makeState(actor({ products: true, 'products:image': false }))
  const allowed = await engine.assertCurrentImportApplyAuthority({}, activeState.job)
  assert.equal(allowed.allowProductImageWrites, false)
  const unchanged = [imageResult('update', '/uploads/Love%20Nude.webp')]
  assert.equal(await engine.productImportResultsChangeImages(activeState.db, unchanged, activeState.job.policy_json), false)
  engine.stripProductImportImageFields(unchanged)
  assert.equal(Object.prototype.hasOwnProperty.call(unchanged[0].data, 'image_path'), false)
  console.log('PASS revoked image action allows an alias-equivalent image only after stripping the write field')

  const changed = [imageResult('update', '/uploads/new.webp')]
  assert.equal(await engine.productImportResultsChangeImages(activeState.db, changed, activeState.job.policy_json), true)
  const created = [imageResult('create', '/uploads/new.webp', null)]
  assert.equal(await engine.productImportResultsChangeImages(activeState.db, created, activeState.job.policy_json), true)
  console.log('PASS revoked image action detects current-window image changes and image-bearing creates')

  activeState = makeState(actor({ products: false, 'products:image': false }))
  await expectAuthorityError(engine.runImportApply({}, 'job-1'), 'products')
  assert.equal(activeState.batches, 0)
  assert.equal(activeState.runs.some((entry) => /UPDATE products|INSERT INTO products/i.test(entry.sql || '')), false)
  assert.equal(activeState.runs.some((entry) => /status = 'failed'.*last_error/is.test(entry.sql || '')), true)
  console.log('PASS real runImportApply marks a revoked actor failed before catalog batches')

  let acked = 0
  let retried = 0
  const permanent = Object.assign(new Error('revoked'), { code: 'import_apply_permission_revoked' })
  const queue = load('queue.ts', {
    './index': {},
    './lib/db': { getDb: () => activeState.db },
    './lib/importEngine': {
      runImportAnalyze: async () => {},
      runImportApply: async () => { throw permanent },
      markJobFailed: async () => {},
      isImportApplyAuthorizationError: (error) => error?.code === 'import_apply_permission_revoked',
    },
    './lib/bulkDeleteEngine': fallback,
    './lib/backup': fallback,
    './lib/driveSyncQueue': fallback,
    './lib/imageAudit': fallback,
  })
  await queue.handleImportQueue({ messages: [{
    body: { jobId: 'job-1', kind: 'apply' },
    timestamp: new Date(),
    ack() { acked++ },
    retry() { retried++ },
  }] }, {})
  assert.equal(acked, 1)
  assert.equal(retried, 0)
  console.log('PASS queue ACKs a permanent apply-authority failure without retry or DLQ churn')

  acked = 0
  retried = 0
  const transientQueue = load('queue.ts', {
    './index': {},
    './lib/db': { getDb: () => activeState.db },
    './lib/importEngine': {
      runImportAnalyze: async () => {},
      runImportApply: async () => { throw new Error('D1 unavailable') },
      markJobFailed: async () => {},
      isImportApplyAuthorizationError: () => false,
    },
    './lib/bulkDeleteEngine': fallback,
    './lib/backup': fallback,
    './lib/driveSyncQueue': fallback,
    './lib/imageAudit': fallback,
  })
  await transientQueue.handleImportQueue({ messages: [{
    body: { jobId: 'job-1', kind: 'apply' },
    timestamp: new Date(),
    ack() { acked++ },
    retry() { retried++ },
  }] }, {})
  assert.equal(acked, 0)
  assert.equal(retried, 1)
  console.log('PASS queue still retries transient apply failures')

  const source = fs.readFileSync(enginePath, 'utf8')
  assert.match(source, /const authority = await assertCurrentImportApplyAuthority\(env, job\)/)
  assert.match(source, /if \(await productImportResultsChangeImages\(db, results, job\.policy_json\)\)/)
  assert.match(source, /stripProductImportImageFields\(results\)/)
  assert.ok(source.indexOf('assertCurrentImportApplyAuthority(env, job)') < source.indexOf('resolveAndCreateBranches(db, actionable)'), 'authority must run before write composition')
  console.log('PASS runImportApply wires the current-invocation check and strip before write composition')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
