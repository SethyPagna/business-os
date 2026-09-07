const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const FULL_USER = { id: 91, username: 'merge_operator', permissions: JSON.stringify({ products: true }) }

function permissive() {
  return new Proxy(function () {}, {
    get: (_target, prop) => (prop === 'default' ? permissive() : permissive()),
    apply: () => undefined,
    construct: () => ({}),
  })
}

function loadTs(relPath, stubs = {}) {
  const abs = path.join(SRC, relPath)
  const output = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: abs,
  }).outputText
  const original = Module._load
  Module._load = (request, parent, isMain) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    if (request.startsWith('.') || request === 'hono') return permissive()
    return original.call(Module, request, parent, isMain)
  }
  const mod = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', output)(mod.exports, require, mod, abs, path.dirname(abs))
  } finally {
    Module._load = original
  }
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

function makeAdapter(d1, hooks = {}) {
  const state = { durableCases: 0, finalized: 0, statements: 0 }
  return {
    state,
    prepare(sql) {
      const prepared = d1.prepare(sql)
      const maybeThrow = () => {
        if (hooks.failHistoryLookupAfterCommitted && state.durableCases >= hooks.failHistoryLookupAfterCommitted
          && /FROM action_history[\s\S]*operation_id/i.test(sql)) {
          throw new Error('D1_ERROR: D1 DB is overloaded. Requests queued for too long.')
        }
        if (hooks.failAfterFinalized && state.finalized >= hooks.failAfterFinalized
          && /SELECT id, name, barcode,[\s\S]*FROM products WHERE id = @id/i.test(sql)) {
          throw new Error('D1_ERROR: D1 DB is overloaded. Requests queued for too long.')
        }
      }
      return {
        get(params = {}) { state.statements += 1; maybeThrow(); return prepared.get(params) },
        all(params = {}) { state.statements += 1; maybeThrow(); return prepared.all(params) },
        run(params = {}) {
          state.statements += 1
          const result = prepared.run(params)
          return { changes: Number(result.meta?.changes || 0), lastInsertRowid: Number(result.meta?.last_row_id || 0) }
        },
      }
    },
    async batch(statements) {
      state.statements += statements.length
      if (hooks.failAfterFinalized && state.finalized >= hooks.failAfterFinalized
        && statements.some((entry) => /SELECT id, name, barcode,[\s\S]*FROM products WHERE id = @id/i.test(entry.sql))) {
        throw new Error('D1_ERROR: D1 DB is overloaded. Requests queued for too long.')
      }
      if (statements.every((entry) => /^\s*(?:SELECT|WITH|PRAGMA)\b/i.test(entry.sql))) {
        return statements.map((entry) => ({
          success: true,
          results: d1.prepare(entry.sql).all(entry.params || {}),
        }))
      }
      const result = await d1.batch(statements)
      if (statements.some((entry) => /INSERT INTO undo_snapshots/i.test(entry.sql))) state.durableCases += 1
      if (statements.some((entry) => /UPDATE action_history SET reversible=1,status='undoable'/i.test(entry.sql))) {
        state.finalized += 1
        hooks.afterFinalize?.(state.finalized)
      }
      return result
    },
  }
}

function loadMergeHandler(adapter) {
  const detail = loadTs('lib/productDetailRule.ts')
  const sqlBinding = loadTs('lib/sqlBinding.ts')
  const identity = loadTs('lib/productIdentity.ts', {
    './productDetailRule': detail, './sqlBinding': sqlBinding, './db': {},
  })
  const economics = loadTs('lib/productMerge.ts')
  const snapshots = loadTs('lib/productMergeSnapshot.ts', { './db': {} })
  const actor = loadTs('lib/actorSnapshot.ts')
  const permissions = loadTs('lib/permissions.ts')
  const never = () => { throw new Error('unrelated undo branch invoked') }
  const undo = loadTs('lib/undoAppliers.ts', {
    '../index': {}, './auth': {}, './db': { getDb: () => adapter }, './audit': { audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} }, './branchWrites': { branchUpdateStatements: () => [] },
    './permissions': permissions, './actorSnapshot': actor,
    './saleBulkStatus': { replaySaleBulkStatus: never },
    './saleBulkUpdate': { BULK_UPDATE_KIND: 'sale.fields.bulk', BULK_CUSTOMER_UPDATE_KIND: 'sale.customer.bulk', replaySaleBulkUpdate: never },
    './returnBulkAction': { RETURN_BULK_ACTION_KIND: 'return.fields.bulk', replayReturnBulkAction: never },
    './saleSettlementAction': { SALE_SETTLEMENT_ACTION_KIND: 'sale.settlement', replaySaleSettlementAction: never, saleMutationGuard: never },
    './stockSession': { STOCK_SESSION_KIND: 'stock.session', replayStockSession: never },
    './saleLineAddition': {
      buildAllocationStatements: () => [], buildOperationAllocationStatements: () => [], planSaleLineAddition: never,
      planSaleLineRemoval: never, plannedLineFromRecord: never, saleLineKhrSnapshotStatement: never, saleMoneyUpdateStatement: never,
    },
    './saleAmendments': { amendmentEntryStatement: never },
  })
  const app = loadTs('routes/products.ts', {
    hono: { Hono: CapturingHono }, '../lib/db': { getDb: () => adapter }, '../lib/audit': { audit: async () => {} },
    '../lib/productDetailRule': detail, '../lib/productIdentity': identity, '../lib/productMerge': economics,
    '../lib/productMergeSnapshot': snapshots,
    '../lib/undoAppliers': undo, '../lib/sqlBinding': sqlBinding, '../lib/actorSnapshot': actor, '../lib/permissions': permissions,
  }).default
  const route = app.routes.find((entry) => entry.method === 'POST' && entry.path === '/merge-duplicates')
  assert.ok(route, 'real merge route must be registered')
  return route.handler
}

function seedGroups(groupSizes) {
  const d1 = openDb(loadAll())
  d1.db.exec("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)")
  const insert = d1.db.prepare(`INSERT INTO products(
    id,name,barcode,cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,
    wholesale_price_usd,wholesale_price_khr,is_active,is_group
  ) VALUES(?,?,?,?,?,?,?,?,?,1,0)`)
  let id = 1
  for (let group = 0; group < groupSizes.length; group += 1) {
    const name = `Partial item ${String(group).padStart(2, '0')}`
    const barcode = `991${String(group).padStart(9, '0')}`
    for (let member = 0; member < groupSizes[group] + 1; member += 1) {
      insert.run(id++, name, barcode, 4 + member, 4000 + member * 1000, 10 + member, 40000, 8 + member, 32000)
    }
  }
  return d1
}

async function invoke(handler) {
  return handler({
    get: (key) => key === 'user' ? FULL_USER : undefined,
    req: { json: async () => ({ client_request_id: 'partial-test' }) },
    env: {},
    executionCtx: { waitUntil: () => {} },
    json: (body, status = 200) => ({ body, status }),
  })
}

async function overloadAfterEight() {
  const d1 = seedGroups(Array(9).fill(1))
  const adapter = makeAdapter(d1, { failAfterFinalized: 8 })
  const result = await invoke(loadMergeHandler(adapter))
  assert.equal(result.status, 200)
  assert.equal(result.body.success, true)
  assert.equal(result.body.complete, false)
  assert.equal(result.body.interrupted, true)
  assert.equal(result.body.interruptionCode, 'merge_infrastructure_interrupted')
  assert.equal(result.body.mergedProducts, 8)
  assert.equal(result.body.mergedGroups, 8)
  assert.equal(result.body.processedCaseKeys.length, 8)
  assert.equal(result.body.actionHistoryIds.length, 8)
  assert.equal(result.body.remainingProducts, null, 'failed reconciliation must not invent an exact remaining count')
  assert.equal(result.body.maxAdditionalRequests, null, 'infrastructure interruption must not trigger an automatic retry')
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM products WHERE is_active=0").get().n, 8)
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM action_history WHERE status='undoable' AND reversible=1").get().n, 8)
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM undo_snapshots WHERE status='applied'").get().n, 8)
}

async function budgetStopsBetweenWholeGroups() {
  const d1 = seedGroups([2, 1])
  let now = 0
  const realNow = Date.now
  Date.now = () => now
  try {
    const adapter = makeAdapter(d1, { afterFinalize: () => { now += 8_000 } })
    const result = await invoke(loadMergeHandler(adapter))
    assert.equal(result.status, 200)
    assert.equal(result.body.interrupted, true)
    assert.equal(result.body.interruptionCode, 'merge_budget_reached')
    assert.equal(result.body.mergedProducts, 2, 'the 4/5/6 three-row cluster must complete before a normal budget yield')
    assert.equal(result.body.mergedGroups, 1)
    assert.equal(result.body.processedCaseKeys.length, 2)
    assert.equal(result.body.remainingProducts, null)
    assert.equal(result.body.maxAdditionalRequests, 2, 'the initial group scan provides a bounded same-confirmation continuation ceiling')
    assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM products WHERE is_active=0").get().n, 2)
    assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM products WHERE is_active=1").get().n, 3)
    const mergedCost = d1.db.prepare('SELECT cost_price_usd,cost_price_khr FROM products WHERE id=1').get()
    assert.equal(mergedCost.cost_price_usd, 5, 'the accepted plain 4/5/6 cluster keeps its one whole-cluster USD mean')
    assert.equal(mergedCost.cost_price_khr, 5000, 'the accepted plain 4/5/6 cluster keeps its one whole-cluster KHR mean')
    assert.ok(adapter.state.statements <= 700, `the accepted first cluster used ${adapter.state.statements} counted D1 statements`)
  } finally {
    Date.now = realNow
  }
}

async function oversizedFirstClusterIsRefusedWhole() {
  const d1 = seedGroups([4])
  const result = await invoke(loadMergeHandler(makeAdapter(d1)))
  assert.equal(result.status, 200)
  assert.equal(result.body.mergedProducts, 0)
  assert.equal(result.body.complete, false, 'blocked products remain and must not be reported as merged')
  assert.equal(result.body.blockedOnly, true, 'the client can finish the reviewed run and display refusal reasons')
  assert.equal(result.body.stalled, false)
  assert.equal(result.body.refusals.length, 4)
  assert.ok(result.body.refusals.every((refusal) => refusal.code === 'cluster_exceeds_atomic_limit'))
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM products WHERE is_active=0").get().n, 0)
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM action_history').get().n, 0)
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM undo_snapshots').get().n, 0)
}

async function postCommitHistoryLookupFailureRemainsReported() {
  const d1 = seedGroups([1, 1])
  const result = await invoke(loadMergeHandler(makeAdapter(d1, { failHistoryLookupAfterCommitted: 1 })))
  assert.equal(result.status, 200)
  assert.equal(result.body.complete, false)
  assert.equal(result.body.interrupted, true)
  assert.equal(result.body.interruptionCode, 'merge_infrastructure_interrupted')
  assert.equal(result.body.mergedProducts, 1, 'the already committed case remains in the response')
  assert.equal(result.body.processedCaseKeys.length, 1)
  assert.equal(result.body.mergeOperationIds.length, 1)
  assert.deepEqual(result.body.undoPendingOperationIds, result.body.mergeOperationIds)
  assert.equal(result.body.actionHistoryIds.length, 0, 'an unresolved numeric id must not be invented')
  assert.equal(result.body.undoPendingCount, 1)
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM products WHERE is_active=0").get().n, 1)
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM products WHERE is_active=1").get().n, 3, 'no later case starts after finalization becomes pending')
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM action_history WHERE status='recorded' AND reversible=0").get().n, 1)
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM undo_snapshots WHERE status='applied'").get().n, 1)
}

async function oversizedWritePlanRefusesBeforeMutation() {
  const d1 = seedGroups([1])
  const insertStock = d1.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,1)')
  for (let branchId = 1; branchId <= 101; branchId += 1) insertStock.run(1, branchId)
  for (let branchId = 1; branchId <= 100; branchId += 1) insertStock.run(2, branchId)
  const result = await invoke(loadMergeHandler(makeAdapter(d1)))
  assert.equal(result.status, 200)
  assert.equal(result.body.complete, false)
  assert.equal(result.body.blockedOnly, true)
  assert.equal(result.body.mergedProducts, 0)
  assert.equal(result.body.refusals[0]?.code, 'merge_case_exceeds_safe_limit')
  assert.equal(d1.db.prepare('SELECT is_active FROM products WHERE id=2').get().is_active, 1)
  assert.equal(d1.db.prepare('SELECT cost_price_usd FROM products WHERE id=1').get().cost_price_usd, 4)
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM action_history').get().n, 0)
}

async function oversizedDependentReadRefusesBeforeMutation() {
  const d1 = seedGroups([1])
  const insertBatch = d1.db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,is_active) VALUES(?,?,?,?,1)')
  for (let ordinal = 1; ordinal <= 21; ordinal += 1) {
    insertBatch.run(1000 + ordinal, 1, `shared-${ordinal}`, ordinal)
    insertBatch.run(2000 + ordinal, 2, `shared-${ordinal}`, ordinal)
  }
  const result = await invoke(loadMergeHandler(makeAdapter(d1)))
  assert.equal(result.status, 200)
  assert.equal(result.body.complete, false)
  assert.equal(result.body.blockedOnly, true)
  assert.equal(result.body.mergedProducts, 0)
  assert.equal(result.body.refusals[0]?.code, 'merge_case_exceeds_safe_limit')
  assert.equal(d1.db.prepare('SELECT is_active FROM products WHERE id=2').get().is_active, 1)
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM action_history').get().n, 0)
}

async function complexLaterMemberBlocksWholeThreeRowCluster() {
  const d1 = seedGroups([2])
  d1.db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,is_active) VALUES(3001,3,?,1,1)')
    .run('later-member-lot')
  const result = await invoke(loadMergeHandler(makeAdapter(d1)))
  assert.equal(result.status, 200)
  assert.equal(result.body.complete, false)
  assert.equal(result.body.blockedOnly, true)
  assert.equal(result.body.mergedProducts, 0, 'the simple first member must not commit before a later complex member is refused')
  assert.equal(result.body.refusals.length, 2)
  assert.ok(result.body.refusals.every((refusal) => refusal.code === 'cluster_requires_manifest'))
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM products WHERE is_active=0').get().n, 0)
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM action_history').get().n, 0)
}

;(async () => {
  await overloadAfterEight()
  await budgetStopsBetweenWholeGroups()
  await oversizedFirstClusterIsRefusedWhole()
  await postCommitHistoryLookupFailureRemainsReported()
  await oversizedWritePlanRefusesBeforeMutation()
  await oversizedDependentReadRefusesBeforeMutation()
  await complexLaterMemberBlocksWholeThreeRowCluster()
  console.log('PASS merge route reports committed partial work and stops only between complete clusters')
})().catch((error) => { console.error(error); process.exitCode = 1 })
