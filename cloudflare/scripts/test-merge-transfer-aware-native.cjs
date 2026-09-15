// Native route regression for the transfer-aware merge (owner ruling
// 2026-09-15: "transfer aware merge"). Mounts the real products route over
// the full D1 migration chain (same harness as test-merge-duplicates-
// leading-zero-scope-native.cjs) and proves two things against the exact
// production shape ("dior addict lip glow new 075", ids 1616/7161 -- a
// leading-zero pair where the clean spelling is ALSO the destination side
// of a committed transfer_operation_members row):
//   1. A product referenced by a committed, still-APPLIED transfer no
//      longer gets refused with merge_state_conflict -- it merges, and the
//      transfer's own provenance is rewritten onto the keeper.
//   2. A product referenced only by a REVERSED (undone) transfer is still
//      refused -- that carve-out stays in place.
// No production database or network is used.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')

function permissive() {
  return new Proxy(function () {}, {
    get: (_target, prop) => prop === 'default' ? permissive() : permissive(),
    apply: () => undefined,
    construct: () => ({}),
  })
}

function loadTs(relPath, stubs = {}) {
  const abs = path.join(SRC, relPath)
  const output = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: abs,
  }).outputText
  const original = Module._load
  Module._load = (request, parent, isMain) => {
    if (request === './moneyPrecision' || request === '../lib/moneyPrecision') return original.call(Module, path.join(SRC, 'lib/moneyPrecision.ts'), parent, isMain)
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    if (request.startsWith('.') || request === 'hono') return permissive()
    return original.call(Module, request, parent, isMain)
  }
  const mod = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
      mod.exports, require, mod, abs, path.dirname(abs),
    )
  } finally { Module._load = original }
  return mod.exports
}

class CapturingHono {
  constructor() { this.routes = [] }
  add(method, routePath, handler) { this.routes.push({ method, path: routePath, handler }); return this }
  get(routePath, handler) { return this.add('GET', routePath, handler) }
  post(routePath, handler) { return this.add('POST', routePath, handler) }
  put(routePath, handler) { return this.add('PUT', routePath, handler) }
  patch(routePath, handler) { return this.add('PATCH', routePath, handler) }
  delete(routePath, handler) { return this.add('DELETE', routePath, handler) }
  use() { return this }
  on() { return this }
  all() { return this }
  route() { return this }
  onError() { return this }
  notFound() { return this }
}

function adapter(d1) {
  return {
    prepare(sql) {
      const statement = d1.prepare(sql)
      return {
        get: (params = {}) => statement.get(params),
        all: (params = {}) => statement.all(params),
        run: (params = {}) => {
          const result = statement.run(params)
          return { changes: Number(result.meta?.changes || 0), lastInsertRowid: Number(result.meta?.last_row_id || 0) }
        },
      }
    },
    async batch(statements) {
      return d1.batch(statements)
    },
  }
}

function loadRoute(db) {
  const sqlBinding = loadTs(path.join('lib', 'sqlBinding.ts'))
  const detailRule = loadTs(path.join('lib', 'productDetailRule.ts'))
  const productMerge = loadTs(path.join('lib', 'productMerge.ts'))
  const productIdentity = loadTs(path.join('lib', 'productIdentity.ts'), {
    './db': {}, './sqlBinding': sqlBinding, './productDetailRule': detailRule,
  })
  const productMergeSnapshot = loadTs(path.join('lib', 'productMergeSnapshot.ts'), { './db': {} })
  const conflictBatch = loadTs(path.join('lib', 'productConflictMergeBatch.ts'))
  const undoAppliers = loadTs(path.join('lib', 'undoAppliers.ts'), {
    '../index': {}, './auth': {}, './db': { getDb: () => db }, './audit': { audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    './branchWrites': { branchUpdateStatements: () => [] },
    './permissions': { getActionTier: () => 'full', getPermissionTier: () => 'full' },
  })
  return loadTs(path.join('routes', 'products.ts'), {
    hono: { Hono: CapturingHono },
    '../lib/db': { getDb: () => db },
    '../lib/permissions': { getActionTier: () => 'full', hasPermission: () => true, getPermissionTier: () => 'full' },
    '../lib/productIdentity': productIdentity,
    '../lib/productDetailRule': detailRule,
    '../lib/productMerge': productMerge,
    '../lib/productMergeSnapshot': productMergeSnapshot,
    '../lib/productConflictMergeBatch': conflictBatch,
    '../lib/sqlBinding': sqlBinding,
    '../lib/audit': { audit: async () => {} },
    '../lib/undoAppliers': undoAppliers,
  }).default
}

function addProduct(raw, id, name, barcode, stock = 0, cost = 4) {
  raw.prepare(`INSERT INTO products(
    id,name,barcode,cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,
    wholesale_price_usd,wholesale_price_khr,stock_quantity,is_active,is_group
  ) VALUES(?,?,?,?,?,?,?,?,?,?,1,0)`).run(id, name, barcode, cost, cost * 4000, 10, 40000, 8, 32000, stock)
}

// Seeds ONE leading-zero pair (dupId = padded/loser, keeperId = clean
// spelling/keeper -- same shape as production ids 1616/7161) plus a
// committed transfer_operation_members row naming both, with the given
// replay_state ('applied' = live, 'reversed' = undone).
function seedTransferPair({ dupId, keeperId, receiptId, replayState }) {
  const d1 = openDb(loadAll())
  const raw = d1.db
  raw.exec("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1),(2,'Second',0,1)")
  addProduct(raw, dupId, 'Dior Addict Lip Glow New 075', `0${8339000 + dupId}`, 0, 33)
  addProduct(raw, keeperId, 'Dior Addict Lip Glow New 075', `${8339000 + dupId}`, 1, 33)
  raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').run(dupId, 1, 0)
  raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').run(keeperId, 2, 1)
  raw.prepare(`INSERT INTO transfer_operation_receipts
      (id, actor_id, request_id, request_digest, request_json, status, provenance_version, replay_state, generation)
    VALUES (?, 1, ?, ?, '{}', 'pending', 1, 'applied', 0)`).run(receiptId, `req-${receiptId}`, `digest-${receiptId}`)
  raw.prepare(`INSERT INTO transfer_operation_members
      (receipt_id, ordinal, source_product_id, destination_product_id, source_branch_id, destination_branch_id,
       quantity, untracked_quantity, source_snapshot, destination_snapshot, allocations_json)
    VALUES (?, 0, ?, ?, 1, 2, 1, 0, '{}', '{}', '[]')`).run(receiptId, dupId, keeperId)
  raw.prepare("UPDATE transfer_operation_receipts SET status='committed', replay_state=? WHERE id=?").run(replayState, receiptId)
  return { d1, raw }
}

function context({ scope, body } = {}) {
  return {
    get: (key) => key === 'user' ? { id: 1, username: 'admin' } : undefined,
    env: {},
    req: {
      query: (key) => key === 'scope' ? scope : undefined,
      json: async () => body || {},
    },
    executionCtx: { waitUntil: () => {} },
    json: (responseBody, status = 200) => ({ status, body: responseBody }),
  }
}

async function testAppliedTransferMerges() {
  const { d1, raw } = seedTransferPair({ dupId: 1616, keeperId: 7161, receiptId: 7, replayState: 'applied' })
  const app = loadRoute(adapter(d1))
  const preview = app.routes.find((route) => route.method === 'GET' && route.path === '/merge-duplicates/preview').handler
  const apply = app.routes.find((route) => route.method === 'POST' && route.path === '/merge-duplicates').handler

  const previewed = await preview(context({ scope: 'leading_zero' }))
  assert.equal(previewed.status, 200)
  assert.deepEqual(previewed.body.applyManifest.groups, [{ keeper_id: 7161, member_ids: [1616, 7161] }],
    'the transfer-evidenced pair is still offered for merge, not silently excluded')

  const result = await apply(context({ body: { ...previewed.body.applyManifest, client_request_id: 'transfer-aware-applied' } }))
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.success, true)
  assert.equal(result.body.mergedProducts, 1, 'an APPLIED transfer no longer refuses the merge')

  assert.equal(raw.prepare('SELECT is_active FROM products WHERE id=1616').get().is_active, 0, 'loser deactivated')
  assert.equal(raw.prepare('SELECT is_active FROM products WHERE id=7161').get().is_active, 1, 'keeper survives')

  const member = raw.prepare('SELECT source_product_id, destination_product_id FROM transfer_operation_members WHERE receipt_id=7 AND ordinal=0').get()
  assert.equal(member.source_product_id, 7161, 'source_product_id rewritten from loser to keeper')
  assert.equal(member.destination_product_id, 7161, 'destination_product_id stays keeper')

  // The trigger is back and still enforced for an unrelated edit afterward.
  assert.throws(
    () => raw.prepare('UPDATE transfer_operation_members SET quantity=9 WHERE receipt_id=7').run(),
    /transfer provenance is immutable/,
    'transfer_members_immutable_update is restored and still enforced after a real route merge',
  )
  raw.close()
}

async function testReversedTransferStillRefuses() {
  const { raw, d1 } = seedTransferPair({ dupId: 1716, keeperId: 7261, receiptId: 8, replayState: 'reversed' })
  const app = loadRoute(adapter(d1))
  const preview = app.routes.find((route) => route.method === 'GET' && route.path === '/merge-duplicates/preview').handler
  const apply = app.routes.find((route) => route.method === 'POST' && route.path === '/merge-duplicates').handler

  const previewed = await preview(context({ scope: 'leading_zero' }))
  assert.equal(previewed.status, 200)
  assert.deepEqual(previewed.body.applyManifest.groups, [{ keeper_id: 7261, member_ids: [1716, 7261] }])

  const result = await apply(context({ body: { ...previewed.body.applyManifest, client_request_id: 'transfer-aware-reversed' } }))
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.mergedProducts, 0, 'a REVERSED transfer still refuses the merge -- the carve-out that stays')
  assert.ok(result.body.refusals.some((refusal) => refusal.code === 'merge_state_conflict'),
    'refusal is surfaced with the standard conflict code, not a silent drop')
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM products WHERE id IN (1716,7261) AND is_active=1').get().n, 2,
    'both rows remain active -- nothing was merged')
  raw.close()
}

async function main() {
  await testAppliedTransferMerges()
  await testReversedTransferStillRefuses()
  console.log('OK test-merge-transfer-aware-native.cjs')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
