const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
// Load the actual dependency before any permissive per-module shim is active.
const moneyPrecision = require('../src/lib/moneyPrecision.ts')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const FULL_USER = { id: 91, username: 'merge_operator', permissions: JSON.stringify({ products: true }) }

function loadTs(relPath, stubs = {}) {
  const root = path.join(SRC, relPath)
  const resolvedStubs = new Map(Object.entries(stubs).map(([request, value]) => [request.startsWith('.') ? path.resolve(path.dirname(root), request.replace(/\.ts$/, '') + '.ts') : request, value]))
  resolvedStubs.set(path.join(SRC, 'lib', 'moneyPrecision.ts'), moneyPrecision)
  const cache = new Map()
  function compile(full) {
    if (resolvedStubs.has(full)) return resolvedStubs.get(full)
    if (cache.has(full)) return cache.get(full).exports
    const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const mod = { exports: {} }
    cache.set(full, mod)
    const localRequire = (request) => request.startsWith('.')
      ? compile(path.resolve(path.dirname(full), request.replace(/\.ts$/, '') + '.ts'))
      : resolvedStubs.has(request) ? resolvedStubs.get(request) : require(request)
    new Function('require', 'module', 'exports', '__filename', '__dirname', code)(localRequire, mod, mod.exports, full, path.dirname(full))
    return mod.exports
  }
  return compile(root)
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
  const state = { durableCases: 0, finalized: 0, statements: 0, historyDiscoveryReads: 0, snapshotReadinessReads: 0 }
  return {
    state,
    prepare(sql) {
      const prepared = d1.prepare(sql)
      const maybeThrow = () => {
        if (/SELECT id, reversible, status,[\s\S]*FROM action_history[\s\S]*operation_id/i.test(sql)) {
          state.historyDiscoveryReads += 1
        }
        if (/SELECT CAST\(json_extract\(payload_json,'\$\.fingerprintPending'\)[\s\S]*FROM undo_snapshots WHERE id=@snapshotId/i.test(sql)) {
          state.snapshotReadinessReads += 1
        }
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
      return result.map((entry, index) => {
        const isMergeIdInsert = /INSERT INTO (?:undo_snapshots|action_history)/i.test(statements[index]?.sql || '')
        if (!isMergeIdInsert) return entry
        if (hooks.omitMergeInsertMetadata) return { ...entry, meta: { ...entry.meta, last_row_id: undefined } }
        if (hooks.offsetMergeInsertMetadata) {
          return { ...entry, meta: { ...entry.meta, last_row_id: Number(entry.meta?.last_row_id || 0) + hooks.offsetMergeInsertMetadata } }
        }
        return entry
      })
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
  // U-cost: merge folds and their undo re-derive the keeper's catalog cost.
  const catalogCost = loadTs('lib/catalogCostRecompute.ts', { './db': {} })
  const undo = loadTs('lib/undoAppliers.ts', {
    './catalogCostRecompute': catalogCost,
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
    '../lib/catalogCostRecompute': catalogCost,
    '../lib/cache': { bumpVersion: async () => {}, bumpVersions: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
  }).default
  const route = app.routes.find((entry) => entry.method === 'POST' && entry.path === '/merge-duplicates')
  assert.ok(route, 'real merge route must be registered')
  return route.handler
}

function seedGroups(groupSizes, extra = () => {}) {
  const d1 = openDb(loadAll())
  d1.db.exec("BEGIN IMMEDIATE; INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
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
  extra(d1)
  d1.db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'; COMMIT")
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
  assert.throws(() => d1.db.exec('UPDATE products SET stock_quantity=stock_quantity+1 WHERE id=1'), /stock_transaction_required/)
  return d1
}

async function invoke(handler) {
  return handler({
    get: (key) => key === 'user' ? FULL_USER : undefined,
    req: { json: async () => ({ client_request_id: 'partial-test' }) },
    env: { PLAN_TIER: 'paid' },
    executionCtx: { waitUntil: () => {} },
    json: (body, status = 200) => ({ body, status }),
  })
}

async function overloadAfterTwo() {
  const d1 = seedGroups(Array(9).fill(1))
  const adapter = makeAdapter(d1, { failAfterFinalized: 2 })
  const result = await invoke(loadMergeHandler(adapter))
  assert.equal(result.status, 200)
  assert.equal(result.body.success, true)
  assert.equal(result.body.complete, false)
  assert.equal(result.body.interrupted, true)
  assert.equal(result.body.interruptionCode, 'merge_infrastructure_interrupted')
  assert.equal(result.body.mergedProducts, 2)
  assert.equal(result.body.mergedGroups, 2)
  assert.equal(result.body.processedCaseKeys.length, 2)
  assert.equal(result.body.actionHistoryIds.length, 2)
  assert.equal(result.body.remainingProducts, null, 'failed reconciliation must not invent an exact remaining count')
  assert.equal(result.body.maxAdditionalRequests, null, 'infrastructure interruption must not trigger an automatic retry')
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM products WHERE is_active=0").get().n, 2)
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM action_history WHERE status='undoable' AND reversible=1").get().n, 2)
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM undo_snapshots WHERE status='applied'").get().n, 2)
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
    assert.equal(mergedCost.cost_price_usd, 4, 'without recorded lot cost or a manual override, the current cluster keeps keeper USD authority')
    assert.equal(mergedCost.cost_price_khr, 4000, 'without recorded lot cost or a manual override, the current cluster keeps keeper KHR authority')
    const snapshot = JSON.parse(d1.db.prepare('SELECT payload_json FROM undo_snapshots ORDER BY id LIMIT 1').get().payload_json)
    assert.equal(snapshot.bulkClusterPlan.version, 3)
    assert.deepEqual(snapshot.bulkClusterPlan.keeperCost, { usd: 4, khr: 4000 })
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

async function batchMetadataFastPathSkipsDiscoveryReads() {
  const d1 = seedGroups([1])
  const adapter = makeAdapter(d1)
  const result = await invoke(loadMergeHandler(adapter))
  assert.equal(result.status, 200)
  assert.equal(result.body.success, true)
  assert.equal(result.body.complete, true)
  assert.equal(result.body.mergedProducts, 1)
  assert.equal(result.body.undoPendingCount, 0)
  assert.equal(result.body.actionHistoryIds.length, 1)
  assert.equal(adapter.state.historyDiscoveryReads, 0, 'batch metadata must avoid the operation-id history lookup')
  assert.equal(adapter.state.snapshotReadinessReads, 0, 'a newly inserted pending snapshot needs no readiness lookup')
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM action_history WHERE status='undoable' AND reversible=1").get().n, 1)
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM undo_snapshots WHERE status='applied' AND json_extract(payload_json,'$.fingerprintPending')=0").get().n, 1)
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='merge_duplicate'").get().n, 1)
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM products WHERE is_active=0").get().n, 1)
}

async function missingBatchMetadataUsesLegacyDiscovery() {
  const d1 = seedGroups([1])
  const adapter = makeAdapter(d1, { omitMergeInsertMetadata: true })
  const result = await invoke(loadMergeHandler(adapter))
  assert.equal(result.status, 200)
  assert.equal(result.body.success, true)
  assert.equal(result.body.complete, true)
  assert.equal(result.body.mergedProducts, 1)
  assert.equal(result.body.undoPendingCount, 0)
  assert.equal(result.body.actionHistoryIds.length, 1)
  assert.equal(adapter.state.historyDiscoveryReads, 1, 'missing metadata must retain the legacy operation-id lookup')
  assert.equal(adapter.state.snapshotReadinessReads, 1, 'legacy finalization must retain its readiness check')
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM action_history WHERE status='undoable' AND reversible=1").get().n, 1)
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM undo_snapshots WHERE json_extract(payload_json,'$.fingerprintPending')=0").get().n, 1)
}

async function postCommitHistoryLookupFailureRemainsReported() {
  const d1 = seedGroups([1, 1])
  const adapter = makeAdapter(d1, { omitMergeInsertMetadata: true, failHistoryLookupAfterCommitted: 1 })
  const result = await invoke(loadMergeHandler(adapter))
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
  assert.equal(adapter.state.historyDiscoveryReads, 1)
  assert.equal(adapter.state.snapshotReadinessReads, 0, 'history lookup failed before snapshot readiness could run')
}

async function wrongBatchMetadataFailsClosed() {
  const d1 = seedGroups([1, 1])
  const adapter = makeAdapter(d1, { offsetMergeInsertMetadata: 100_000 })
  const result = await invoke(loadMergeHandler(adapter))
  assert.equal(result.status, 200)
  assert.equal(result.body.complete, false)
  assert.equal(result.body.interrupted, true)
  assert.equal(result.body.interruptionCode, 'merge_infrastructure_interrupted')
  assert.equal(result.body.mergedProducts, 1, 'the durable first fold remains reported')
  assert.equal(result.body.undoPendingCount, 1)
  assert.equal(result.body.actionHistoryIds.length, 1, 'the supplied positive id remains visible but must not become undoable')
  assert.equal(adapter.state.historyDiscoveryReads, 0, 'positive metadata takes the fast path even when its row is wrong')
  assert.equal(adapter.state.snapshotReadinessReads, 0)
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM action_history WHERE status='recorded' AND reversible=0").get().n, 1)
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM action_history WHERE status='undoable' OR reversible=1").get().n, 0)
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM undo_snapshots WHERE json_extract(payload_json,'$.fingerprintPending')=1").get().n, 1)
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM products WHERE is_active=0").get().n, 1)
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='merge_duplicate'").get().n, 1)
}

async function oversizedWritePlanRefusesBeforeMutation() {
  const d1 = seedGroups([1], d1 => {
    const insertStock = d1.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,1)')
    for (let branchId = 1; branchId <= 101; branchId += 1) insertStock.run(1, branchId)
    for (let branchId = 1; branchId <= 100; branchId += 1) insertStock.run(2, branchId)
  })
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
  const d1 = seedGroups([1], d1 => {
    const insertBatch = d1.db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,is_active) VALUES(?,?,?,?,1)')
    for (let ordinal = 1; ordinal <= 21; ordinal += 1) {
      insertBatch.run(1000 + ordinal, 1, `shared-${ordinal}`, ordinal)
      insertBatch.run(2000 + ordinal, 2, `shared-${ordinal}`, ordinal)
    }
  })
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
  const d1 = seedGroups([2], d1 => {
    d1.db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,is_active) VALUES(3001,3,?,1,1)')
      .run('later-member-lot')
  })
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

async function laterPrimaryImageBlocksWholeThreeRowCluster() {
  const d1 = seedGroups([2])
  d1.db.prepare("UPDATE products SET image_path='/uploads/later.webp' WHERE id=3").run()
  const result = await invoke(loadMergeHandler(makeAdapter(d1)))
  assert.equal(result.status, 200)
  assert.equal(result.body.mergedProducts, 0, 'a later primary image blocks the whole cluster before its simple first member')
  assert.equal(result.body.refusals.length, 2)
  assert.ok(result.body.refusals.every((refusal) => refusal.code === 'cluster_requires_manifest'))
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM products WHERE is_active=0').get().n, 0)
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM action_history').get().n, 0)
}

function currentPairClusterPlan(d1) {
  const rows = d1.db.prepare(`SELECT id,updated_at,cost_price_usd,cost_price_khr,
    selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr
    FROM products WHERE id IN (1,2) ORDER BY id`).all()
  const fields = [
    'cost_price_usd', 'cost_price_khr', 'selling_price_usd',
    'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr',
  ]
  return {
    version: 1,
    identityKey: JSON.stringify(['partial item 00', '991000000000']),
    keeperId: 1,
    memberIds: [1, 2],
    members: rows.map((row) => ({
      id: row.id,
      updated_at: row.updated_at,
      money: Object.fromEntries(fields.map((field) => [field, row[field]])),
    })),
  }
}

function legacyClusterWireEconomicsStayFrozen() {
  const merge = loadTs('lib/productMerge.ts')
  const wire = {
    identityKey: 'legacy-4-5-6', keeperId: 1, memberIds: [1, 2, 3],
    members: [4, 5, 6].map((cost, index) => ({ id: index + 1, updated_at: null,
      money: { cost_price_usd: cost, cost_price_khr: cost * 1000, selling_price_usd: 10 + index,
        selling_price_khr: 40000, wholesale_price_usd: 8 + index, wholesale_price_khr: 32000 } })),
  }
  for (const version of [1, 2]) {
    const plan = merge.parseProductMergeClusterPlan(JSON.parse(JSON.stringify({ ...wire, version })))
    assert.ok(plan)
    assert.equal(plan.version, version)
    assert.equal(Object.hasOwn(plan, 'keeperCost'), false)
    const result = merge.resolveProductMergeClusterPlanEconomics(plan).merged
    assert.equal(result.cost_price_usd, 5)
    assert.equal(result.cost_price_khr, 5000)
    assert.equal(result.selling_price_usd, 12)
    assert.equal(result.wholesale_price_usd, 10)
  }
  assert.equal(merge.parseProductMergeClusterPlan({ ...wire, version: 3 }), null, 'current plans require their explicit keeper authority')
}

async function saturatedPlanHistoryRefusesBeforeMutation() {
  const d1 = seedGroups([1])
  const plan = currentPairClusterPlan(d1)
  const insert = d1.db.prepare(`INSERT INTO undo_snapshots(kind,status,payload_json)
    VALUES('product.merge','applied',?)`)
  for (let copy = 0; copy < 9; copy += 1) insert.run(JSON.stringify({ bulkClusterPlan: plan }))
  const result = await invoke(loadMergeHandler(makeAdapter(d1)))
  assert.equal(result.status, 200)
  assert.equal(result.body.mergedProducts, 0, 'saturated matching history refuses before the pair fold')
  assert.equal(result.body.blockedOnly, true)
  assert.equal(result.body.refusals[0]?.code, 'merge_plan_history_unavailable')
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM products WHERE is_active=0').get().n, 0)
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM action_history').get().n, 0)
}

async function malformedPlanHistoryRefusesBeforeMutation() {
  const d1 = seedGroups([1])
  d1.db.prepare(`INSERT INTO undo_snapshots(kind,status,payload_json)
    VALUES('product.merge','applied','{malformed')`).run()
  const result = await invoke(loadMergeHandler(makeAdapter(d1)))
  assert.equal(result.status, 200)
  assert.equal(result.body.mergedProducts, 0, 'malformed plan history refuses before the pair fold')
  assert.equal(result.body.blockedOnly, true)
  assert.equal(result.body.refusals[0]?.code, 'merge_plan_history_unavailable')
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM products WHERE is_active=0').get().n, 0)
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM action_history').get().n, 0)
}

async function oversizedPlanHistoryRefusesBeforeMutation() {
  const d1 = seedGroups([1])
  const plan = { ...currentPairClusterPlan(d1), padding: 'x'.repeat(5_000) }
  d1.db.prepare(`INSERT INTO undo_snapshots(kind,status,payload_json)
    VALUES('product.merge','applied',?)`).run(JSON.stringify({ bulkClusterPlan: plan }))
  const result = await invoke(loadMergeHandler(makeAdapter(d1)))
  assert.equal(result.status, 200)
  assert.equal(result.body.mergedProducts, 0, 'oversized matching plan history refuses before the pair fold')
  assert.equal(result.body.blockedOnly, true)
  assert.equal(result.body.refusals[0]?.code, 'merge_plan_history_unavailable')
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM products WHERE is_active=0').get().n, 0)
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM action_history').get().n, 0)
}

;(async () => {
  legacyClusterWireEconomicsStayFrozen()
  await overloadAfterTwo()
  await budgetStopsBetweenWholeGroups()
  await oversizedFirstClusterIsRefusedWhole()
  await batchMetadataFastPathSkipsDiscoveryReads()
  await missingBatchMetadataUsesLegacyDiscovery()
  await postCommitHistoryLookupFailureRemainsReported()
  await wrongBatchMetadataFailsClosed()
  await oversizedWritePlanRefusesBeforeMutation()
  await oversizedDependentReadRefusesBeforeMutation()
  await complexLaterMemberBlocksWholeThreeRowCluster()
  await laterPrimaryImageBlocksWholeThreeRowCluster()
  await saturatedPlanHistoryRefusesBeforeMutation()
  await malformedPlanHistoryRefusesBeforeMutation()
  await oversizedPlanHistoryRefusesBeforeMutation()
  console.log('PASS merge route reports committed partial work and stops only between complete clusters')
})().catch((error) => { console.error(error); process.exitCode = 1 })
