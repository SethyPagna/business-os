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
    '../lib/undoAppliers': { registerMergeFold: () => {}, MERGE_REPARENT_TABLES: [] },
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
    raw.exec('COMMIT')
    return { d1, fixtureGroups, productCount: nextId - 1 }
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

;(async () => {
  const { d1, fixtureGroups, productCount } = seedCatalog()
  assert.equal(productCount, 4_027)
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
  assert.equal(response.body.duplicateProductCount, 2_027)
  assert.equal(response.body.mergeableDuplicateProductCount, 1_998)
  assert.equal(response.body.blockedGroupCount, 3)
  assert.equal(response.body.costRefusalCount, 1)
  assert.equal(response.body.batchLimit, 25)
  assert.equal(response.body.groups.length, GROUP_COUNT)

  const meanGroup = response.body.groups.find((group) => group.canonicalId === fixtureGroups[0][0])
  assert.ok(meanGroup)
  assert.equal(meanGroup.canonicalName, 'Scale Item 0000')
  assert.equal(meanGroup.canonicalBarcode, '880000000000')
  assert.deepEqual(meanGroup.caseKeys, [
    `${fixtureGroups[0][0]}:${fixtureGroups[0][1]}`,
    `${fixtureGroups[0][0]}:${fixtureGroups[0][2]}`,
  ])
  assert.deepEqual(meanGroup.duplicates, [
    { id: fixtureGroups[0][1], name: 'Scale Item 0000', barcode: '880000000000', quantity: 0, batchCount: 0 },
    { id: fixtureGroups[0][2], name: 'Scale Item 0000', barcode: '880000000000', quantity: 0, batchCount: 0 },
  ])
  assert.equal(meanGroup.totalQuantityToMove, 0)
  assert.deepEqual(meanGroup.branchBreakdown, [])
  assert.deepEqual(meanGroup.costBefore, { cost_price_usd: 4, cost_price_khr: 4000 })
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

  // 4,027 unique member ids fit in 41 100-bind reads. One additional UNION
  // statement maps every potentially linked member of a multi-row cluster,
  // plus one duplicate detector query and one branch-name query. This bound is deliberately
  // independent of group count; the old per-group route executes 6,002.
  assert.ok(adapter.metrics.queries <= 44, `preview executed ${adapter.metrics.queries} D1 reads for ${GROUP_COUNT} groups`)
  assert.equal(adapter.metrics.batchRoundTrips, 1, 'preview hydration and the linked-member map must share one D1 round trip')
  assert.equal(adapter.metrics.maxBatchStatements, 42)
  assert.ok(adapter.metrics.maxBoundParams <= 100, `preview bound ${adapter.metrics.maxBoundParams} params in one statement`)
  assert.ok(
    adapter.metrics.sql.some((sql) => /FROM products p LEFT JOIN branch_stock/i.test(sql)),
    'preview hydration must retain the real product/branch stock relationship',
  )
  console.log(JSON.stringify({
    status: 'PASS',
    groups: response.body.groupCount,
    duplicates: response.body.duplicateProductCount,
    queries: adapter.metrics.queries,
    maxBoundParams: adapter.metrics.maxBoundParams,
    elapsedMs,
  }))
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
