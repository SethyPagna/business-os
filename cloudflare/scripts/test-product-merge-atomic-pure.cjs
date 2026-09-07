const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')

const libDir = path.join(__dirname, '..', 'src', 'lib')

function loadUndoAppliers(db) {
  const dbAdapter = {
    prepare(sql) {
      const statement = db.prepare(sql)
      return {
        get: (params) => statement.get(params || {}),
        all: (params) => statement.all(params || {}),
        run: (params) => {
          const result = statement.run(params || {})
          return { changes: Number(result.meta?.changes || 0), lastInsertRowid: Number(result.meta?.last_row_id || 0) }
        },
      }
    },
    batch: (statements) => db.batch(statements),
  }
  const never = () => { throw new Error('unrelated undo branch invoked') }
  const stubs = {
    '../index': {}, './auth': {}, './db': { getDb: () => dbAdapter }, './audit': { audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} }, './branchWrites': { branchUpdateStatements: () => [] },
    './permissions': { getActionTier: () => 'full', getPermissionTier: () => 'full' },
    './actorSnapshot': { actorSnapshot: (user) => user?.name || user?.username || null },
    './saleBulkStatus': { replaySaleBulkStatus: never },
    './saleBulkUpdate': { BULK_UPDATE_KIND: 'sale.fields.bulk', BULK_CUSTOMER_UPDATE_KIND: 'sale.customer.bulk', replaySaleBulkUpdate: never },
    './returnBulkAction': { RETURN_BULK_ACTION_KIND: 'return.fields.bulk', replayReturnBulkAction: never },
    './saleSettlementAction': { SALE_SETTLEMENT_ACTION_KIND: 'sale.settlement', replaySaleSettlementAction: never, saleMutationGuard: never },
    './stockSession': { STOCK_SESSION_KIND: 'stock.session', replayStockSession: never },
    './saleLineAddition': {
      buildAllocationStatements: () => [], buildOperationAllocationStatements: () => [],
      planSaleLineAddition: never, planSaleLineRemoval: never, plannedLineFromRecord: never,
      saleLineKhrSnapshotStatement: never, saleMoneyUpdateStatement: never,
    },
    './saleAmendments': { amendmentEntryStatement: never },
  }
  const source = fs.readFileSync(path.join(libDir, 'undoAppliers.ts'), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'undoAppliers.ts',
  })
  const originalLoad = Module._load
  Module._load = (request, parent, isMain) => Object.prototype.hasOwnProperty.call(stubs, request)
    ? stubs[request]
    : originalLoad.call(Module, request, parent, isMain)
  const mod = { exports: {} }
  try {
    new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod)
  } finally {
    Module._load = originalLoad
  }
  return mod.exports
}

async function main() {
  const db = openDb([`
    CREATE TABLE products(id INTEGER PRIMARY KEY,is_active INTEGER NOT NULL);
    CREATE TABLE undo_snapshots(
      id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT,status TEXT,payload_json TEXT,
      created_by_id INTEGER,created_by_name TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE action_history(
      id INTEGER PRIMARY KEY AUTOINCREMENT,scope TEXT,entity TEXT,entity_id TEXT,label TEXT,undo_label TEXT,redo_label TEXT,
      reversible INTEGER,status TEXT,undo_payload TEXT,redo_payload TEXT,created_by_id INTEGER,created_by_name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE audit_logs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,user_name TEXT,action TEXT,entity TEXT,entity_id TEXT,
      details TEXT,table_name TEXT,record_id TEXT,new_value TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO products(id,is_active) VALUES(1,1),(2,1);
  `])
  const { buildAtomicMergeHistoryStatements } = loadUndoAppliers(db)
  const reversal = {
    keeperId: 1, keeperName: 'Tea', dupId: 2, dupName: 'Tea',
    keeperStockBefore: [], dupStockBefore: [], reparentedSaleItemIds: [],
    reparentedMovementIds: [], adjustmentMovementIds: [],
  }
  const history = buildAtomicMergeHistoryStatements({ id: 7, name: 'Operator' }, reversal, 'case-op-1', { exact_identity: true })
  assert.equal(history.length, 3)
  assert.match(history[0].sql, /INSERT INTO undo_snapshots/)
  assert.equal(JSON.parse(history[0].params.payload).fingerprintPending, true)
  assert.match(history[1].sql, /INSERT INTO action_history/)
  assert.match(history[2].sql, /INSERT INTO audit_logs/)

  await db.batch([
    { sql: 'UPDATE products SET is_active=0 WHERE id=@id', params: { id: 2 } },
    ...history,
  ])
  assert.equal(db.prepare('SELECT is_active FROM products WHERE id=2').get({}).is_active, 0)
  const snapshot = db.prepare('SELECT * FROM undo_snapshots').get({})
  const action = db.prepare('SELECT * FROM action_history').get({})
  assert.equal(JSON.parse(action.undo_payload).snapshot_id, snapshot.id)
  assert.equal(JSON.parse(action.redo_payload).snapshot_id, snapshot.id)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get({}).n, 1)

  const before = {
    active: db.prepare('SELECT is_active FROM products WHERE id=1').get({}).is_active,
    snapshots: db.prepare('SELECT COUNT(*) AS n FROM undo_snapshots').get({}).n,
    actions: db.prepare('SELECT COUNT(*) AS n FROM action_history').get({}).n,
  }
  const failedHistory = buildAtomicMergeHistoryStatements(null, { ...reversal, dupId: 1 }, 'case-op-2', {})
  await assert.rejects(
    db.batch([
      { sql: 'UPDATE products SET is_active=0 WHERE id=1', params: {} },
      ...failedHistory,
      { sql: "SELECT json_extract('', '$')", params: {} },
    ]),
  )
  assert.equal(db.prepare('SELECT is_active FROM products WHERE id=1').get({}).is_active, before.active)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM undo_snapshots').get({}).n, before.snapshots)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM action_history').get({}).n, before.actions)
  console.log('test-product-merge-atomic-pure: all checks passed')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
