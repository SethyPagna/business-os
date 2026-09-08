// Focused F46 regression: a committed merge stays retryable until its
// fingerprint and history pointer are BOTH durably ready. The real
// undoAppliers module is loaded; only unrelated appliers are stubbed.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')

const cloudflareRoot = path.join(__dirname, '..')
const libDir = path.join(cloudflareRoot, 'src', 'lib')

function loadFinalizer(db) {
  const stubs = {
    '../index': {}, './auth': {}, './db': { getDb: () => db }, './audit': { audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    './branchWrites': { branchUpdateStatements: () => [] },
    './permissions': { getActionTier: () => 'full', getPermissionTier: () => 'full' },
    './actorSnapshot': { actorSnapshot: () => 'F46 test' },
    './productMerge': { parseProductMergeClusterPlan: () => ({}), resolveProductMergeClusterPlanEconomics: () => ({}) },
    './saleBulkStatus': { replaySaleBulkStatus: () => {} },
    './saleBulkUpdate': { BULK_CUSTOMER_UPDATE_KIND: 'sale.customer.bulk', BULK_UPDATE_KIND: 'sale.fields.bulk', replaySaleBulkUpdate: () => {} },
    './returnBulkAction': { RETURN_BULK_ACTION_KIND: 'return.fields.bulk', replayReturnBulkAction: () => {} },
    './saleSettlementAction': { SALE_SETTLEMENT_ACTION_KIND: 'sale.settlement', replaySaleSettlementAction: () => {}, saleMutationGuard: () => ({ sql: 'SELECT 1' }) },
    './stockSession': { STOCK_SESSION_KIND: 'stock.session', replayStockSession: () => {} },
    './saleLineAddition': {
      buildAllocationStatements: () => [], buildOperationAllocationStatements: () => [],
      planSaleLineAddition: () => ({ lines: [], statements: [] }), planSaleLineRemoval: () => ({ statements: [] }),
      plannedLineFromRecord: (row) => row, saleLineKhrSnapshotStatement: () => ({ sql: 'SELECT 1' }), saleMoneyUpdateStatement: () => ({ sql: 'SELECT 1' }),
    },
    './saleAmendments': { amendmentEntryStatement: () => ({ sql: 'SELECT 1' }) },
  }
  const source = fs.readFileSync(path.join(libDir, 'undoAppliers.ts'), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } })
  const original = Module._load
  Module._load = (request, parent, isMain) => Object.prototype.hasOwnProperty.call(stubs, request)
    ? stubs[request] : original.call(Module, request, parent, isMain)
  const mod = { exports: {} }
  try { new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, require, mod, path.join(libDir, 'undoAppliers.ts'), libDir) } finally { Module._load = original }
  return mod.exports
}

function finalizerDb({ failFinalization = false } = {}) {
  const batches = []
  return {
    batches,
    prepare(sql) {
      return { get: async () => sql.includes('FROM action_history')
        ? { id: 118, reversible: 0, status: 'recorded', snapshot_id: 82 }
        : { pending: 1 } }
    },
    async batch(statements) {
      batches.push(statements)
      if (statements.every((statement) => /^\s*SELECT\b/i.test(statement.sql))) {
        return statements.map(() => ({ success: true, results: [] }))
      }
      if (failFinalization) throw new Error('native guarded finalization fault')
      return statements.map(() => ({ success: true, results: [] }))
    },
  }
}

const reversal = { keeperId: 2001, dupId: 2002, keeperName: 'fixture', dupName: 'fixture', reparentedByTable: [] }

async function run() {
  const db = finalizerDb()
  const undo = loadFinalizer(db)
  const result = await undo.finalizeAtomicMergeHistory({}, 'f46-local-operation', reversal, db)
  assert.deepEqual(result, { operationId: 'f46-local-operation', committed: true, snapshotId: 82, actionHistoryId: 118, historyResolved: true, fingerprintReady: true })
  const finalization = db.batches.at(-1)
  assert.match(finalization[2].sql, /AS merge_history_guard/)
  assert.match(finalization[2].sql, /json_extract\('', '\$'\)/)

  const retryDb = finalizerDb({ failFinalization: true })
  const retryUndo = loadFinalizer(retryDb)
  const first = await retryUndo.finalizeAtomicMergeHistory({}, 'f46-retry-operation', reversal, retryDb)
  assert.equal(first.fingerprintReady, false, 'a failed guarded result must keep undo unavailable')
  assert.equal(first.historyResolved, true, 'the committed durable rows remain discoverable for retry')
  const secondDb = finalizerDb()
  const secondUndo = loadFinalizer(secondDb)
  const second = await secondUndo.finalizeAtomicMergeHistory({}, 'f46-retry-operation', reversal, secondDb)
  assert.equal(second.fingerprintReady, true, 'a later guarded retry may complete the same committed merge')
  console.log('F46 finalizer runtime regression: 2/2 passed')
}

run().catch((error) => { console.error(error); process.exit(1) })
