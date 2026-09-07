const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const { performance } = require('node:perf_hooks')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const srcRoot = path.join(__dirname, '..', 'src')

function loadTs(rel, stubs = {}) {
  const abs = path.join(srcRoot, rel)
  const { outputText } = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: abs,
  })
  const permissive = () => new Proxy(function () {}, {
    get: (_target, prop) => prop === 'default' ? permissive() : permissive(),
    apply: () => undefined, construct: () => ({}),
  })
  const original = Module._load
  Module._load = (request, parent, isMain) => Object.prototype.hasOwnProperty.call(stubs, request)
    ? stubs[request]
    : (request.startsWith('.') || request === 'hono' ? permissive() : original.call(Module, request, parent, isMain))
  const mod = { exports: {} }
  try {
    new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod)
  } finally {
    Module._load = original
  }
  return mod.exports
}

class FakeHono {
  get() { return this } post() { return this } put() { return this } patch() { return this }
  delete() { return this } use() { return this } on() { return this } all() { return this }
}

function countedAdapter(d1) {
  const counters = { reads: 0, writes: 0, batches: 0, readBatches: 0, statementsInBatches: 0 }
  const adapter = {
    prepare(sql) {
      const statement = d1.prepare(sql)
      return {
        get(params) { counters.reads += 1; return statement.get(params || {}) },
        all(params) { counters.reads += 1; return statement.all(params || {}) },
        run(params) {
          counters.writes += 1
          const result = statement.run(params || {})
          return { changes: Number(result.meta?.changes || 0), lastInsertRowid: Number(result.meta?.last_row_id || 0) }
        },
      }
    },
    batch(statements) {
      counters.batches += 1
      counters.statementsInBatches += statements.length
      const readOnly = statements.every((statement) => /^\s*(?:SELECT|WITH|PRAGMA)\b/i.test(statement.sql))
      if (readOnly) {
        counters.readBatches += 1
        return Promise.resolve(statements.map((statement) => ({
          success: true,
          results: d1.prepare(statement.sql).all(statement.params || {}),
        })))
      }
      return d1.batch(statements)
    },
  }
  return { adapter, counters }
}

function loadRealModules(adapter) {
  const detail = loadTs('lib/productDetailRule.ts')
  const sqlBinding = loadTs('lib/sqlBinding.ts')
  const identity = loadTs('lib/productIdentity.ts', {
    './productDetailRule': detail, './sqlBinding': sqlBinding, './db': {},
  })
  const economics = loadTs('lib/productMerge.ts')
  const actor = loadTs('lib/actorSnapshot.ts')
  const never = () => { throw new Error('unrelated undo branch invoked') }
  const undo = loadTs('lib/undoAppliers.ts', {
    '../index': {}, './auth': {}, './db': { getDb: () => adapter }, './audit': { audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} }, './branchWrites': { branchUpdateStatements: () => [] },
    './permissions': { getActionTier: () => 'full', getPermissionTier: () => 'full' }, './actorSnapshot': actor,
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
  const route = loadTs('routes/products.ts', {
    hono: { Hono: FakeHono }, '../lib/db': { getDb: () => adapter }, '../lib/audit': { audit: async () => {} },
    '../lib/productDetailRule': detail, '../lib/productIdentity': identity, '../lib/productMerge': economics,
    '../lib/undoAppliers': undo, '../lib/sqlBinding': sqlBinding, '../lib/actorSnapshot': actor,
  })
  return { identity, economics, undo, route }
}

async function main() {
  const d1 = openDb(loadAll())
  d1.db.exec('BEGIN')
  const insert = d1.db.prepare(`INSERT INTO products
    (id,name,barcode,cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr,is_active)
    VALUES(?,?,?,?,?,?,?,?,?,1)`)
  for (let pair = 1; pair <= 1600; pair += 1) {
    const keeper = pair * 2 - 1
    const duplicate = pair * 2
    const name = `Benchmark item ${String(pair).padStart(4, '0')}`
    const barcode = String(100000 + pair)
    insert.run(keeper, name, barcode, 4, 0, 5, 20000, 3, 12000)
    insert.run(duplicate, name, `0${barcode}`, 6, 0, 7, 24000, 4, 16000)
  }
  d1.db.exec('COMMIT')

  const { adapter, counters } = countedAdapter(d1)
  const { identity, economics, route } = loadRealModules(adapter)
  const scanStarted = performance.now()
  const groups = await identity.findDuplicateProductGroups(adapter)
  const scanMs = performance.now() - scanStarted
  assert.equal(groups.length, 1600)
  assert.equal(groups.reduce((sum, group) => sum + group.duplicates.length, 0), 1600)

  const runStarted = performance.now()
  for (const group of groups.slice(0, 25)) {
    const ids = [group.canonical.id, group.duplicates[0].id]
    const rows = await adapter.prepare(`SELECT id,cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr FROM products WHERE id IN (?,?)`).all(ids)
    const merged = economics.resolveProductMergeEconomics(rows)
    const operationId = `benchmark-${group.canonical.id}`
    const result = await route.foldDuplicateProductInto(
      {}, adapter, { id: 9, username: 'benchmark' }, group.canonical, group.duplicates[0], new Map(),
      'local 1600-pair benchmark', 'merge', merged, { operationId },
    )
    assert.equal(result.undoReady, true)
  }
  const runMs = performance.now() - runStarted
  const active = d1.db.prepare('SELECT COUNT(*) AS n FROM products WHERE is_active=1').get().n
  assert.equal(active, 3175)
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM action_history').get().n, 25)
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM undo_snapshots').get().n, 25)
  assert.ok(runMs < 30000, `a 25-case local chunk took ${runMs.toFixed(1)}ms`)

  console.log(JSON.stringify({
    candidates: 1600, chunk: 25, scanMs: Number(scanMs.toFixed(1)), runMs: Number(runMs.toFixed(1)), ...counters,
  }))
  console.log('test-product-merge-bulk-benchmark: all checks passed')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
