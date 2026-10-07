// Executes the real product review appliers. Approval rechecks the original
// requester's current image action before applying changed image fields, while
// unchanged full-form image values are removed from the approved write.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

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

const media = loadTs('lib/media.ts')
const sqlBinding = loadTs('lib/sqlBinding.ts')
const imagePermission = loadTs('lib/productImagePermission.ts', { './media': media, './sqlBinding': sqlBinding })
const permissions = loadTs('lib/permissions.ts')
// lib/db.ts re-exports the import maintenance fence; this permission test never
// reaches it, so the re-export is satisfied with a throwing stand-in.
const dbLib = loadTs('lib/db.ts', { './importMaintenanceFence': {
    getImportFencedDb: async () => { throw new Error('getImportFencedDb should not be called by this pure test') },
    withImportMaintenanceWriteFence: async () => { throw new Error('withImportMaintenanceWriteFence should not be called by this pure test') },
    isImportMaintenanceFenceError: () => false,
    ImportMaintenanceFenceError: class ImportMaintenanceFenceError extends Error {},
  } })
const realProductWrites = loadTs('lib/productWrites.ts', {
  './catalogCostRecompute': loadTs('lib/catalogCostRecompute.ts', { './moneyPrecision': loadTs('lib/moneyPrecision.ts') }),
  './db': dbLib,
  './receivingBranch': loadTs('lib/receivingBranch.ts'),
  './branchRedirectWrite': require('./harness/branch_redirect_write.cjs'), // CUTOVER-LR
  './businessMaintenanceGuard': loadTs('lib/businessMaintenanceGuard.ts'),
  './pendingActions': loadTs('lib/pendingActions.ts', { './db': dbLib }),
  './audit': loadTs('lib/audit.ts', { './db': dbLib }),
  './moneyPrecision': loadTs('lib/moneyPrecision.ts'),
  './media': media,
  './batchCode': loadTs('lib/batchCode.ts'),
  './searchMatch': loadTs('lib/searchMatch.ts'),
  './importImageMatch': { MAX_IMAGES_PER_PRODUCT: 3 },
  './schemaProbe': loadTs('lib/schemaProbe.ts'),
})
const branchRoles = loadTs('lib/branchRoles.ts')
const canonicalBranchIdentity = loadTs('lib/canonicalBranchIdentity.ts', {
  './db': dbLib,
  './branchRoles': branchRoles,
})
assert.equal(typeof canonicalBranchIdentity.assertCanonicalBranchSetMutationAllowed, 'function')

function role(grants) {
  return {
    id: 10,
    name: 'Requester',
    username: 'requester',
    organization_id: 1,
    role_id: null,
    role_code: 'staff',
    permissions: JSON.stringify(grants),
    role_permissions: null,
    is_active: 1,
  }
}

function freshState(requester) {
  return {
    requester,
    current: { id: 77, image_path: '/uploads/one.png' },
    currentGallery: ['/uploads/one.png', '/uploads/two.png'],
    inserted: [],
    updated: [],
    synced: [],
    audits: 0,
    assetPaths: new Set(['/uploads/one.png', '/uploads/two.png', '/uploads/three.png', '/uploads/new.png']),
  }
}

async function runNativeCreate(state, body, required, maxImages, approval) {
  const database = openDb(loadAll(path.resolve(__dirname, '../migrations')))
  const raw = database.db
  assert.equal(raw.limits.exprDepth, 100)
  const pendingRow = { ...approval.row, created_at: null, updated_at: null }
  const keys = Object.keys(pendingRow)
  raw.prepare(`INSERT INTO pending_actions(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map(key => pendingRow[key]))
  const DB = {
    prepare(sql) {
      let values = []
      const statement = {
        bind(...args) { values = args; return statement },
        args() { return /\?\d/.test(sql) ? [Object.fromEntries(values.map((value, index) => [String(index + 1), value]))] : values },
        async all() { return { results: raw.prepare(sql).all(...statement.args()) } },
        async run() {
          const prepared = raw.prepare(sql)
          if (prepared.columns().length) return { success: true, results: prepared.all(...statement.args()), meta: { changes: 0 } }
          const result = prepared.run(...statement.args())
          return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
        },
      }
      return statement
    },
    async batch(statements) {
      raw.exec('BEGIN IMMEDIATE')
      try { const results=[]; for (const statement of statements) results.push(await statement.run()); raw.exec('COMMIT'); return results }
      catch(error) { raw.exec('ROLLBACK'); throw error }
    },
  }
  try {
    const result = await realProductWrites.createProductWithInitialStock({ DB }, body, required, maxImages, { ...approval, row: pendingRow })
    state.inserted.push(...raw.prepare('SELECT * FROM products').all())
    state.synced.push(raw.prepare('SELECT image_path FROM product_images WHERE product_id=? ORDER BY sort_order').all(result.id).map(row => row.image_path))
    assert.equal(raw.prepare('SELECT status FROM pending_actions WHERE id=?').get(pendingRow.id).status, 'approved')
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM product_batches WHERE variant_product_id=?').get(result.id).n, 1)
    return result
  } finally { raw.close() }
}

function loadReviewApply(state, updateChanges = 1) {
  const db = {
    prepare(sql) {
      return {
        async get() {
          if (/FROM users u/i.test(sql)) return state.requester
          if (/SELECT image_path FROM products/i.test(sql)) return state.current
          if (/SELECT id FROM products/i.test(sql)) return state.current ? { id: state.current.id } : undefined
          return undefined
        },
        async all(params = []) {
          if (/SELECT public_path FROM file_assets/i.test(sql)) {
            return [...state.assetPaths].filter((public_path) => Object.values(params).includes(public_path)).map((public_path) => ({ public_path }))
          }
          if (/FROM product_images/i.test(sql)) return state.currentGallery.map((image_path) => ({ image_path }))
          return []
        },
        async run() { return { changes: 1, lastInsertRowid: 77 } },
      }
    },
    async batch() { return [] },
  }
  const productWrites = {
    readProductMoneyPlan: realProductWrites.readProductMoneyPlan,
    createProductWithInitialStock: async (_env, body, required, maxImages, approval) => runNativeCreate(state, body, required, maxImages, approval),
    updateRow: async (_env, _table, _id, body) => { state.updated.push({ ...body }); return updateChanges },
    defaultBranchId: async () => 1,
    syncProductImageGallery: async (_env, _id, gallery) => { state.synced.push([...gallery]); return [...gallery] },
    seedBranchStockForNewProduct: async () => {},
    seedInitialBatchForNewProduct: async () => {},
  }
  return loadTs('lib/reviewApply.ts', {
    // Real module: an approved plan-less cost edit records its typed-cost entry (U-cost).
    './catalogCostRecompute': loadTs('lib/catalogCostRecompute.ts', { './moneyPrecision': loadTs('lib/moneyPrecision.ts') }),
    './db': { ...dbLib, getDb: () => db },
    './audit': { audit: async () => { state.audits++ } },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    './cache': { bumpVersion: async () => {} },
    './productWrites': productWrites,
    './branchWrites': { branchUpdateStatements: () => [] },
    './canonicalBranchIdentity': canonicalBranchIdentity,
    './conflictControl': loadTs('lib/conflictControl.ts'),
    './businessMaintenanceGuard': loadTs('lib/businessMaintenanceGuard.ts'),
    './permissions': permissions,
    './productImagePermission': imagePermission,
    './productDelete': {
      parseProductRemovePendingPointer: () => null,
      parseProductRemovePlan: () => { throw new Error('unrelated product removal') },
      productRemoveApprovalStatements: () => [],
      productRemovePlanDigest: async () => '',
      ProductRemoveError: class ProductRemoveError extends Error {},
    },
    './pendingActions': {},
    '../index': {},
  })
}

function pending(actionType, payload, requestedBy = 10) {
  return {
    id: 5,
    section: 'products',
    action_type: actionType,
    entity_type: 'product',
    entity_id: actionType === 'update' ? 77 : null,
    payload_json: JSON.stringify(payload),
    summary: null,
    status: 'open',
    requested_by: requestedBy,
    requested_by_name: 'Requester',
  }
}

const reviewer = { id: 99, name: 'Reviewer' }

async function main() {
  {
    const state = freshState(role({ products: 'review', 'products:image': false }))
    const { applyApprovedPendingAction } = loadReviewApply(state)
    await assert.rejects(
      applyApprovedPendingAction({}, pending('update', {
        image_path: '/uploads/three.png', image_gallery: ['/uploads/three.png'],
      }), reviewer),
      /no longer has permission to change product images/,
    )
    assert.equal(state.updated.length + state.synced.length + state.audits, 0)
    console.log('PASS legacy queued image edit fails closed after requester image permission is revoked')
  }

  {
    const state = freshState(role({ products: 'review', 'products:image': false }))
    const { applyApprovedPendingAction } = loadReviewApply(state)
    await applyApprovedPendingAction({}, pending('update', {
      description: 'approved', image_path: '/uploads/one.png?v=7', image_gallery: ['/uploads/one.png', '/uploads/two.png'],
    }), reviewer)
    assert.deepEqual(state.updated, [{ description: 'approved' }])
    assert.equal(state.synced.length, 0)
    assert.equal(state.audits, 1)
    console.log('PASS unchanged queued images are stripped and the non-image edit still applies')
  }

  {
    const state = freshState(role({ products: 'review', 'products:image': false }))
    state.current.image_path = '/uploads/orphan.png'
    state.currentGallery = ['/uploads/orphan.png']
    state.assetPaths.clear()
    const { applyApprovedPendingAction } = loadReviewApply(state)
    await applyApprovedPendingAction({}, pending('update', {
      description: 'approved', image_path: '/uploads/orphan.png', image_gallery: ['/uploads/orphan.png'],
    }), reviewer)
    assert.deepEqual(state.updated, [{ description: 'approved' }])
    assert.equal(state.synced.length, 0)
    console.log('PASS unchanged queued orphan images do not block the approved non-image edit')
  }

  {
    const state = freshState(role({ products: 'review', 'products:image': false }))
    state.current.image_path = '/uploads/ក្រែម ខ្មែរ.webp'
    state.currentGallery = ['/uploads/ក្រែម ខ្មែរ.webp']
    state.assetPaths = new Set(['/uploads/ក្រែម ខ្មែរ.webp'])
    const { applyApprovedPendingAction } = loadReviewApply(state)
    await applyApprovedPendingAction({}, pending('update', {
      description: 'approved', image_path: '/uploads/%E1%9E%80%E1%9F%92%E1%9E%9A%E1%9F%82%E1%9E%98%20%E1%9E%81%E1%9F%92%E1%9E%98%E1%9F%82%E1%9E%9A.webp',
      image_gallery: ['/uploads/%E1%9E%80%E1%9F%92%E1%9E%9A%E1%9F%82%E1%9E%98%20%E1%9E%81%E1%9F%92%E1%9E%98%E1%9F%82%E1%9E%9A.webp'],
    }), reviewer)
    assert.deepEqual(state.updated, [{ description: 'approved' }])
    assert.equal(state.synced.length, 0)
    console.log('PASS legacy queued Khmer alias resolves before approval-time permission comparison')
  }

  {
    const state = freshState(role({ products: 'review' }))
    const { applyApprovedPendingAction } = loadReviewApply(state, 0)
    await applyApprovedPendingAction({}, pending('update', {
      image_path: '/uploads/two.png', image_gallery: ['/uploads/two.png', '/uploads/one.png'],
    }), reviewer)
    assert.equal(state.updated.length, 1)
    assert.deepEqual(state.synced, [["/uploads/two.png", "/uploads/one.png"]])
    assert.equal(state.audits, 1)
    console.log('PASS authorized gallery-only review applies even when no products column changes')
  }

  {
    const state = freshState(role({ products: 'review', 'products:image': false }))
    const { applyApprovedPendingAction } = loadReviewApply(state)
    await assert.rejects(
      applyApprovedPendingAction({}, pending('create', {
        name: 'Queued product', image_path: '/uploads/new.png', image_gallery: ['/uploads/new.png'],
      }), reviewer),
      /no longer has permission to change product images/,
    )
    assert.equal(state.inserted.length + state.synced.length, 0)
    console.log('PASS legacy queued image create fails before product insertion')
  }

  {
    const state = freshState(role({ products: 'review' }))
    const { applyApprovedPendingAction } = loadReviewApply(state)
    await applyApprovedPendingAction({}, pending('create', {
      name: 'Queued product', image_path: '/uploads/new.png', image_gallery: ['/uploads/new.png'],
    }), reviewer)
    assert.equal(state.inserted.length, 1)
    assert.deepEqual(state.synced, [["/uploads/new.png"]])
    console.log('PASS currently authorized queued image create remains approvable')
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
