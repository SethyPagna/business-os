// F37: the duplicate preview must remain bounded at catalog scale.
//
// This mounts the real preview handler, duplicate detector, money kernel and
// D1 chunk helper over the full migration chain. The fixture deliberately has
// 2,000 duplicate groups so a per-group stock/batch/money query shape performs
// about 6,000 reads and fails the query-count assertion below.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const GROUP_COUNT = 2_000
const FULL_USER = { id: 71, username: 'merge_admin', permissions: JSON.stringify({ products: true }) }
const DENIED_USER = { id: 72, username: 'reviewer', permissions: JSON.stringify({ products: 'review' }) }

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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: abs,
  }).outputText
  const original = Module._load
  Module._load = (request, parent, isMain) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    if (request.startsWith('.') || request === 'hono') return permissive()
    return original.call(Module, request, parent, isMain)
  }
  const mod = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
      mod.exports, require, mod, abs, path.dirname(abs),
    )
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

function countingAdapter(d1) {
  const metrics = { queries: 0, batchRoundTrips: 0, maxBatchStatements: 0, maxBoundParams: 0, sql: [] }
  const record = (sql, params) => {
    metrics.queries += 1
    const bound = Array.isArray(params) ? params.length : Object.keys(params || {}).length
    metrics.maxBoundParams = Math.max(metrics.maxBoundParams, bound)
    metrics.sql.push(String(sql).replace(/\s+/g, ' ').trim())
  }
  return {
    metrics,
    prepare(sql) {
      const statement = d1.prepare(sql)
      return {
        get(params = {}) { record(sql, params); return statement.get(params) },
        all(params = {}) { record(sql, params); return statement.all(params) },
        run(params = {}) {
          record(sql, params)
          const result = statement.run(params)
          return { changes: Number(result.meta?.changes || 0), lastInsertRowid: Number(result.meta?.last_row_id || 0) }
        },
      }
    },
    async batch(statements) {
      metrics.batchRoundTrips += 1
      metrics.maxBatchStatements = Math.max(metrics.maxBatchStatements, statements.length)
      const results = []
      for (const item of statements) {
        record(item.sql, item.params)
        results.push({ success: true, results: await d1.prepare(item.sql).all(item.params || {}) })
      }
      return results
    },
  }
}

function loadPreviewRoute(adapter) {
  const sqlBinding = loadTs(path.join('lib', 'sqlBinding.ts'))
  const detailRule = loadTs(path.join('lib', 'productDetailRule.ts'))
  const productMerge = loadTs(path.join('lib', 'productMerge.ts'))
  const productIdentity = loadTs(path.join('lib', 'productIdentity.ts'), {
    './db': {},
    './sqlBinding': sqlBinding,
    './productDetailRule': detailRule,
  })
  const permissions = loadTs(path.join('lib', 'permissions.ts'))
  const app = loadTs(path.join('routes', 'products.ts'), {
    hono: { Hono: CapturingHono },
    '../lib/db': { getDb: () => adapter },
    '../lib/permissions': permissions,
    '../lib/productIdentity': productIdentity,
    '../lib/productDetailRule': detailRule,
    '../lib/productMerge': productMerge,
    '../lib/sqlBinding': sqlBinding,
    '../lib/undoAppliers': {
      registerMergeFold: () => {},
      MERGE_REPARENT_TABLES: [
        ['sale_items', 'product_id'], ['return_items', 'product_id'], ['return_replacement_items', 'product_id'],
        ['inventory_movements', 'product_id'], ['damaged_stock_lots', 'product_id'], ['stock_transfers', 'product_id'],
        ['rfid_tags', 'product_id'], ['rfid_events', 'product_id'], ['rfid_session_items', 'product_id'], ['promotions', 'link_product_id'],
      ].map(([table, column]) => ({ table, column })),
    },
  }).default
  const route = app.routes.find((entry) => entry.method === 'GET' && entry.path === '/merge-duplicates/preview')
  assert.ok(route, 'real products route must register duplicate preview')
  return route.handler
}

function seedCatalog() {
  const d1 = openDb(loadAll())
  const raw = d1.db
  raw.exec('BEGIN IMMEDIATE')
  try {
    raw.exec("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1),(2,'Warehouse',0,1)")
    const insert = raw.prepare(`INSERT INTO products(
      id,name,barcode,cost_price_usd,cost_price_khr,
      selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr,
      stock_quantity,is_active,is_group
    ) VALUES(?,?,?,?,?,?,?,?,?,?,1,0)`)
    let nextId = 1
    const fixtureGroups = []
    for (let groupIndex = 0; groupIndex < GROUP_COUNT; groupIndex += 1) {
      const memberCount = groupIndex === 0 || groupIndex === 3 ? 3 : groupIndex === 1 ? 27 : 2
      const ids = []
      const name = `Scale Item ${String(groupIndex).padStart(4, '0')}`
      const barcode = `88${String(groupIndex).padStart(10, '0')}`
      for (let memberIndex = 0; memberIndex < memberCount; memberIndex += 1) {
        const id = nextId++
        ids.push(id)
        const usdCost = groupIndex === 0
          ? [4, 5, 6][memberIndex]
          : groupIndex === 2 && memberIndex === 1
            ? -1
            : 2 + (groupIndex % 5)
        const khrCost = groupIndex === 0
          ? [4000, 5000, 6000][memberIndex]
          : Math.max(0, usdCost * 4000)
        insert.run(
          id, name, barcode, usdCost, khrCost,
          10 + memberIndex, 40000 + memberIndex * 4000,
          8 + memberIndex, 32000 + memberIndex * 4000,
          0,
        )
      }
      fixtureGroups.push(ids)
    }

    const complexIds = fixtureGroups[3]
    raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').run(complexIds[1], 1, 2)
    const insertBatch = raw.prepare(`INSERT INTO product_batches(
      id,variant_product_id,batch_key,lot_code,batch_number,received_at,unit_cost_usd,is_active
    ) VALUES(?,?,?,?,?,?,?,1)`)
    insertBatch.run(9001, complexIds[1], 'complex-a', 'COMPLEX-A', 1, '2026-01-01', 5)

    // Simulate the durable state after the first case of the 4/5/6 cluster
    // committed but the request stopped before member 6. The active keeper is
    // already the synthetic whole-cluster result (5), so recomputing from only
    // keeper 5 + remaining source 6 would drift to 5.5. Preview must recover
    // the saved immutable plan in one catalog-wide batched read.
    const plannedRows = raw.prepare(`
      SELECT id, updated_at, cost_price_usd, cost_price_khr,
             selling_price_usd, selling_price_khr,
             wholesale_price_usd, wholesale_price_khr
      FROM products WHERE id IN (?,?,?) ORDER BY id
    `).all(...fixtureGroups[0])
    const moneyFields = [
      'cost_price_usd', 'cost_price_khr', 'selling_price_usd',
      'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr',
    ]
    const bulkClusterPlan = {
      version: 1,
      identityKey: JSON.stringify(['scale item 0000', '880000000000']),
      keeperId: fixtureGroups[0][0],
      memberIds: [...fixtureGroups[0]],
      members: plannedRows.map((row) => ({
        id: row.id,
        updated_at: row.updated_at,
        money: Object.fromEntries(moneyFields.map((field) => [field, row[field]])),
      })),
    }
    raw.prepare(`UPDATE products SET
      cost_price_usd=5, cost_price_khr=5000,
      selling_price_usd=12, selling_price_khr=48000,
      wholesale_price_usd=10, wholesale_price_khr=40000
      WHERE id=?`).run(fixtureGroups[0][0])
    raw.prepare('UPDATE products SET is_active=0 WHERE id=?').run(fixtureGroups[0][1])
    raw.prepare(`INSERT INTO undo_snapshots(kind,status,payload_json)
      VALUES('product.merge','applied',?)`).run(JSON.stringify({ bulkClusterPlan }))
    const originalPlanSnapshotId = raw.prepare('SELECT MAX(id) AS id FROM undo_snapshots').get().id
    raw.exec('COMMIT')
    return { d1, fixtureGroups, productCount: nextId - 1, bulkClusterPlan, originalPlanSnapshotId }
  } catch (error) {
    raw.exec('ROLLBACK')
    throw error
  }
}

async function invokePreview(handler, user) {
  return handler({
    get: (key) => key === 'user' ? user : undefined,
    env: {},
    json: (body, status = 200) => ({ status, body }),
  })
}

function verifyPlanLookupMigrationPreservesRows() {
  const migrations = loadAll()
  const planLookupMigrationIndex = migrations.findIndex((sql) => /idx_undo_product_merge_plan_keeper/.test(sql))
  assert.notEqual(planLookupMigrationIndex, -1, 'the full migration chain must include the 0135 product merge plan indexes')
  assert.ok(migrations.some((sql) => /CREATE TABLE product_conflict_merge_runs/.test(sql)), 'the fixture must include the 0136 receipt migration even after later migrations are appended')
  const before0135 = openDb(migrations.slice(0, planLookupMigrationIndex))
  const raw = before0135.db
  raw.prepare(`INSERT INTO undo_snapshots(id,kind,status,payload_json)
    VALUES(501,'product.merge','applied',?), (502,'product.merge','applied','{malformed')`)
    .run(JSON.stringify({ bulkClusterPlan: { version: 1, keeperId: 10, identityKey: 'x', memberIds: [10], members: [] } }))
  raw.prepare(`INSERT INTO action_history(id,scope,entity,entity_id,label,status)
    VALUES(601,'products','product','10','preserved','undoable')`).run()
  const snapshotsBefore = raw.prepare('SELECT id,kind,status,payload_json FROM undo_snapshots ORDER BY id').all()
  const historyBefore = raw.prepare('SELECT id,scope,entity,entity_id,label,status FROM action_history ORDER BY id').all()
  raw.exec(migrations[planLookupMigrationIndex])
  assert.deepEqual(raw.prepare('SELECT id,kind,status,payload_json FROM undo_snapshots ORDER BY id').all(), snapshotsBefore,
    '0135 preserves valid and malformed opaque snapshot bytes')
  assert.deepEqual(raw.prepare('SELECT id,scope,entity,entity_id,label,status FROM action_history ORDER BY id').all(), historyBefore,
    '0135 preserves action-history rows')
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name LIKE 'idx_undo_product_merge_%'").get().n, 2)
}

;(async () => {
  verifyPlanLookupMigrationPreservesRows()
  const { d1, fixtureGroups, productCount, bulkClusterPlan, originalPlanSnapshotId } = seedCatalog()
  assert.equal(productCount, 4_027)
  const indexNames = d1.db.prepare(`SELECT name FROM sqlite_master WHERE type='index'
    AND name IN ('idx_undo_product_merge_plan_keeper','idx_undo_product_merge_invalid_json') ORDER BY name`).all().map((row) => row.name)
  assert.deepEqual(indexNames, ['idx_undo_product_merge_invalid_json', 'idx_undo_product_merge_plan_keeper'])
  const keeperLookupPlan = d1.db.prepare(`EXPLAIN QUERY PLAN
    SELECT id FROM undo_snapshots INDEXED BY idx_undo_product_merge_plan_keeper
    WHERE kind='product.merge' AND status='applied' AND json_valid(payload_json)=1
      AND CASE WHEN json_valid(payload_json)
        THEN CAST(json_extract(payload_json,'$.bulkClusterPlan.keeperId') AS INTEGER)
        ELSE NULL END IN (?, ?)
    LIMIT 9`).all(fixtureGroups[0][0], 999999)
  assert.ok(keeperLookupPlan.some((row) => /SEARCH undo_snapshots USING INDEX idx_undo_product_merge_plan_keeper/i.test(row.detail)),
    `keeper lookup did not use its expression index: ${JSON.stringify(keeperLookupPlan)}`)
  const exactPlanLookup = d1.db.prepare(`EXPLAIN QUERY PLAN
    SELECT id FROM undo_snapshots INDEXED BY idx_undo_product_merge_plan_keeper
    WHERE kind='product.merge' AND status='applied' AND json_valid(payload_json)=1
      AND CASE WHEN json_valid(payload_json)
        THEN CAST(json_extract(payload_json,'$.bulkClusterPlan.keeperId') AS INTEGER)
        ELSE NULL END=?
      AND CASE WHEN json_valid(payload_json)
        THEN json_extract(payload_json,'$.bulkClusterPlan.identityKey')
        ELSE NULL END=?
    LIMIT 9`).all(fixtureGroups[0][0], bulkClusterPlan.identityKey)
  assert.ok(exactPlanLookup.some((row) => /SEARCH undo_snapshots USING INDEX idx_undo_product_merge_plan_keeper \(<expr>=\? AND <expr>=\?\)/i.test(row.detail)),
    `POST plan lookup did not search keeper plus identity: ${JSON.stringify(exactPlanLookup)}`)
  const adapter = countingAdapter(d1)
  const handler = loadPreviewRoute(adapter)

  const denied = await invokePreview(handler, DENIED_USER)
  assert.equal(denied.status, 403)
  assert.equal(adapter.metrics.queries, 0, 'permission denial must happen before catalog reads')

  const startedAt = Date.now()
  const response = await invokePreview(handler, FULL_USER)
  const elapsedMs = Date.now() - startedAt
  assert.equal(response.status, 200)
  assert.equal(response.body.success, true)
  assert.equal(response.body.groupCount, GROUP_COUNT)
  assert.equal(response.body.duplicateProductCount, 2_026)
  assert.equal(response.body.mergeableDuplicateProductCount, 1_997)
  assert.equal(response.body.blockedGroupCount, 3)
  assert.equal(response.body.costRefusalCount, 1)
  assert.equal(response.body.batchLimit, 25)
  assert.equal(response.body.groups.length, GROUP_COUNT)

  const meanGroup = response.body.groups.find((group) => group.canonicalId === fixtureGroups[0][0])
  assert.ok(meanGroup)
  assert.equal(meanGroup.canonicalName, 'Scale Item 0000')
  assert.equal(meanGroup.canonicalBarcode, '880000000000')
  assert.deepEqual(meanGroup.caseKeys, [
    `${fixtureGroups[0][0]}:${fixtureGroups[0][2]}`,
  ])
  assert.deepEqual(meanGroup.duplicates, [
    { id: fixtureGroups[0][2], name: 'Scale Item 0000', barcode: '880000000000', quantity: 0, batchCount: 0 },
  ])
  assert.equal(meanGroup.totalQuantityToMove, 0)
  assert.deepEqual(meanGroup.branchBreakdown, [])
  assert.deepEqual(meanGroup.costBefore, { cost_price_usd: 5, cost_price_khr: 5000 })
  assert.deepEqual(meanGroup.costAfter, { cost_price_usd: 5, cost_price_khr: 5000 })
  assert.equal(meanGroup.mergeable, true)
  assert.deepEqual(meanGroup.mergeBlockers, [])
  assert.deepEqual(meanGroup.costRefusals, [])

  const oversized = response.body.groups.find((group) => group.canonicalId === fixtureGroups[1][0])
  assert.equal(oversized.duplicates.length, 26)
  assert.equal(oversized.mergeable, false)
  assert.equal(oversized.mergeBlockers[0].code, 'cluster_exceeds_atomic_limit')

  const complex = response.body.groups.find((group) => group.canonicalName === 'Scale Item 0003')
  assert.equal(complex.mergeable, false)
  assert.equal(complex.mergeBlockers[0].code, 'cluster_requires_manifest')

  const invalidCost = response.body.groups.find((group) => group.canonicalId === fixtureGroups[2][0])
  assert.equal(invalidCost.mergeable, false)
  assert.deepEqual(invalidCost.mergeBlockers, [])
  assert.equal(invalidCost.costRefusals.length, 1)
  assert.equal(invalidCost.costRefusals[0].field, 'cost_price_usd')
  assert.equal(invalidCost.costRefusals[0].code, 'negative')

  // 4,026 active member ids fit in 41 100-bind reads. Sixteen additional
  // simple SELECTs map every potentially linked member of a multi-row cluster,
  // twenty indexed plan lookups cover the 2,000 keepers in 100-bind chunks;
  // one indexed malformed-history guard makes invalid JSON fail closed,
  // plus one duplicate detector query and one branch-name query. This bound is deliberately
  // independent of group count; the old per-group route executes 6,002.
  assert.ok(adapter.metrics.queries <= 80, `preview executed ${adapter.metrics.queries} D1 reads for ${GROUP_COUNT} groups`)
  const initialPreviewQueries = adapter.metrics.queries
  assert.equal(adapter.metrics.batchRoundTrips, 1, 'preview hydration and the linked-member map must share one D1 round trip')
  assert.equal(adapter.metrics.maxBatchStatements, 78)
  assert.ok(adapter.metrics.maxBoundParams <= 100, `preview bound ${adapter.metrics.maxBoundParams} params in one statement`)
  assert.ok(
    adapter.metrics.sql.some((sql) => /FROM products p LEFT JOIN branch_stock/i.test(sql)),
    'preview hydration must retain the real product/branch stock relationship',
  )
  const routeSource = fs.readFileSync(path.join(SRC, 'routes', 'products.ts'), 'utf8')
  assert.doesNotMatch(
    routeSource.slice(routeSource.indexOf('function multiClusterComplexLinkPlan'), routeSource.indexOf('async function readMultiClusterComplexProductIds')),
    /\bUNION\b/i,
    'the linked-member map must not exceed D1 compound SELECT term limits',
  )
  assert.match(routeSource, /MERGE_DUPLICATES_MULTI_PREFLIGHT_MAX_PRODUCT_IDS = 600/)
  assert.match(routeSource, /assumedComplexIds: allIds\.slice\(MERGE_DUPLICATES_MULTI_PREFLIGHT_MAX_PRODUCT_IDS\)/)

  const previewAgain = () => invokePreview(handler, FULL_USER)
  const planGroup = (preview) => preview.body.groups.find((group) => group.canonicalId === fixtureGroups[0][0])
  const insertSnapshot = (payload) => d1.db.prepare(`INSERT INTO undo_snapshots(kind,status,payload_json)
    VALUES('product.merge','applied',?)`).run(payload)

  // Unrelated valid plan history is skipped by the indexed keeper locator and
  // cannot consume this active group's bounded candidate budget.
  for (let id = 900_000; id < 900_020; id += 1) {
    const unrelated = {
      ...bulkClusterPlan,
      keeperId: id,
      memberIds: [id, id + 100_000],
      members: bulkClusterPlan.members.slice(0, 2).map((member, index) => ({ ...member, id: index ? id + 100_000 : id })),
    }
    insertSnapshot(JSON.stringify({ bulkClusterPlan: unrelated }))
  }
  let guarded = await previewAgain()
  assert.equal(planGroup(guarded).mergeable, true, 'unrelated keeper plans do not block a valid partial cluster')

  // A changed remaining source is never previewed using a recomputed 5.5.
  // The original timestamp is restored after the assertion for later cases.
  const remainingMember = bulkClusterPlan.members.find((member) => member.id === fixtureGroups[0][2])
  d1.db.prepare("UPDATE products SET updated_at='2099-01-01 00:00:00' WHERE id=?").run(fixtureGroups[0][2])
  guarded = await previewAgain()
  assert.equal(planGroup(guarded).mergeable, false)
  assert.equal(planGroup(guarded).mergeBlockers[0].code, 'merge_cluster_plan_conflict')
  assert.deepEqual(planGroup(guarded).costAfter, planGroup(guarded).costBefore, 'stale plans show no invented recomputed result')
  d1.db.prepare('UPDATE products SET updated_at=? WHERE id=?').run(remainingMember.updated_at, fixtureGroups[0][2])

  // A single oversized candidate is truncated in SQL and blocks the preview;
  // its full reversal payload is never returned to the Worker.
  insertSnapshot(JSON.stringify({ bulkClusterPlan: { ...bulkClusterPlan, padding: 'x'.repeat(5_000) } }))
  guarded = await previewAgain()
  assert.equal(planGroup(guarded).mergeable, false)
  assert.equal(planGroup(guarded).mergeBlockers[0].code, 'merge_plan_history_unavailable')
  assert.deepEqual(planGroup(guarded).costAfter, planGroup(guarded).costBefore, 'oversized plan history shows no recomputed mean')
  d1.db.prepare('DELETE FROM undo_snapshots WHERE id>?').run(originalPlanSnapshotId + 20)

  // A structurally invalid but keeper-addressable plan cannot be ignored and
  // replaced with the wrong current-row mean.
  insertSnapshot(JSON.stringify({ bulkClusterPlan: { version: 99, keeperId: fixtureGroups[0][0], identityKey: bulkClusterPlan.identityKey } }))
  guarded = await previewAgain()
  assert.equal(planGroup(guarded).mergeable, false)
  assert.equal(planGroup(guarded).mergeBlockers[0].code, 'merge_plan_history_unavailable')
  assert.deepEqual(planGroup(guarded).costAfter, planGroup(guarded).costBefore, 'malformed applicable plan shows no recomputed mean')
  d1.db.prepare('DELETE FROM undo_snapshots WHERE id>?').run(originalPlanSnapshotId + 20)

  // Malformed opaque merge history has no trustworthy keeper locator, so the
  // dedicated partial index makes it an explicit global fail-closed condition.
  insertSnapshot('{malformed')
  guarded = await previewAgain()
  assert.equal(planGroup(guarded).mergeable, false)
  assert.equal(planGroup(guarded).mergeBlockers[0].code, 'merge_plan_history_unavailable')
  assert.deepEqual(planGroup(guarded).costAfter, planGroup(guarded).costBefore, 'invalid JSON history shows no recomputed mean')
  d1.db.prepare('DELETE FROM undo_snapshots WHERE id>?').run(originalPlanSnapshotId + 20)

  // More than eight current-keeper candidates in one 100-keeper lookup chunk
  // returns only the sentinel ninth row, then blocks without an unbounded scan
  // or a fallback recomputation.
  for (let copy = 0; copy < 9; copy += 1) insertSnapshot(JSON.stringify({ bulkClusterPlan }))
  guarded = await previewAgain()
  assert.equal(planGroup(guarded).mergeable, false)
  assert.equal(planGroup(guarded).mergeBlockers[0].code, 'merge_plan_history_unavailable')
  assert.deepEqual(planGroup(guarded).costAfter, planGroup(guarded).costBefore, 'saturated history shows no recomputed mean')
  console.log(JSON.stringify({
    status: 'PASS',
    groups: response.body.groupCount,
    duplicates: response.body.duplicateProductCount,
    queries: initialPreviewQueries,
    maxBoundParams: adapter.metrics.maxBoundParams,
    elapsedMs,
  }))
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
