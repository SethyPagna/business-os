// Drives the real review approval Hono handler. A product image request whose
// requester's authority was revoked remains open and returns a typed conflict,
// rather than presenting a permission decision as an internal server error.

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

class NoReviewApplierError extends Error {}
class ReviewRequesterPermissionError extends Error {
  constructor(message) { super(message); this.code = 'request_permission_revoked' }
}
class ProductImageAssetError extends Error {
  constructor(imagePath) { super(`Image asset ${imagePath} does not exist.`); this.code = 'missing_image_asset' }
}

function loadRoute(state) {
  const filePath = path.join(srcRoot, 'routes', 'reviewQueue.ts')
  const requireAuth = async (c, next) => { c.set('user', c.env.TEST_USER); await next() }
  const stubs = {
    hono: { Hono },
    '../lib/auth': { requireAuth },
    '../lib/permissions': {
      getPermissionTier: () => 'full',
      hasPermission: () => true,
    },
    '../lib/pendingActions': {
      getPendingAction: async () => state.row,
      listPendingActions: async () => [],
      markPendingActionApproved: async () => { state.marked++; return true },
      markPendingActionRejected: async () => true,
    },
    '../lib/reviewApply': {
      NoReviewApplierError,
      ReviewRequesterPermissionError,
      applyApprovedPendingAction: async () => { throw state.applyError },
    },
    '../lib/productImagePermission': { ProductImageAssetError },
    '../lib/audit': { audit: async () => { state.audits++ } },
    '../lib/actorSnapshot': { actorSnapshot: (user) => user.name },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    '../index': {},
  }
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
    return loaded.exports.default
  } finally {
    Module._load = originalLoad
  }
}

async function main() {
  const state = {
    row: { id: 5, status: 'open', section: 'products', action_type: 'update', entity_type: 'product' },
    marked: 0,
    audits: 0,
    applyError: new ReviewRequesterPermissionError('The requester no longer has permission to change product images.'),
  }
  const response = await loadRoute(state).request('/5/approve', { method: 'POST' }, {
    TEST_USER: { id: 99, name: 'Reviewer' },
  })
  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), {
    error: 'The requester no longer has permission to change product images.',
    code: 'request_permission_revoked',
  })
  assert.equal(state.marked, 0, 'failed authorization must leave the pending row open')
  assert.equal(state.audits, 0, 'failed authorization must not audit an approval')
  console.log('PASS revoked requester image authority returns a typed conflict and leaves review open')

  state.applyError = new ProductImageAssetError('/uploads/missing.png')
  const missingResponse = await loadRoute(state).request('/5/approve', { method: 'POST' }, {
    TEST_USER: { id: 99, name: 'Reviewer' },
  })
  assert.equal(missingResponse.status, 409)
  assert.deepEqual(await missingResponse.json(), {
    error: 'Image asset /uploads/missing.png does not exist.',
    code: 'missing_image_asset',
  })
  assert.equal(state.marked, 0)
  assert.equal(state.audits, 0)
  console.log('PASS missing legacy review image returns a typed conflict and leaves review open')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
