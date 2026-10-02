const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
// Load the actual dependency before any permissive per-module shim is active.
const moneyPrecision = require('../src/lib/moneyPrecision.ts')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadStockLifecycleFixture, nativeStockFixtureBinding } = require('./harness/load_stock_lifecycle_fixture.cjs')
const lifecycleEffects = []

function linkedStockFixture(kind) {
  const d1 = require('./harness/d1compat.cjs').openDb(require('./harness/load_migrations.cjs').loadAll())
  const native = d1.db
  native.exec(`
    INSERT INTO branches(id,name,is_active,is_default) VALUES(9,'Shop',1,1);
    INSERT INTO users(id,username,name,password,permissions,is_active) VALUES(101,'fixture-owner','Owner','admin123','{"products":true,"inventory":true}',1);
    INSERT INTO suppliers(id,name) VALUES(31,'Pinned supplier');
    INSERT INTO products(id,name,barcode,stock_quantity,is_active) VALUES(91,'Pinned stock','GUARD91',3,1),(92,'Unlinked product','GUARD92',0,0);
    INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,supplier_id,supplier_name,payment_status,received_quantity,received_cost_usd,received_branch_id,unit_cost_usd)
      VALUES(951,91,'GUARD951','GUARD951','2026-10-01',1,1,31,'Pinned supplier','credit',3,7.0001,9,2.3334);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(951,9,3);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(91,9,3);
    INSERT INTO inventory_movements(id,product_id,branch_id,batch_id,movement_type,quantity,free_quantity,total_cost_usd,reference_id,user_id)
      VALUES(991,91,9,951,'add',3,0.5,7.0001,'fixture-real-source',101);
  `)
  if (kind === 'disposition') native.exec("INSERT INTO stock_disposition_sources(id,movement_id,batch_id,product_id,branch_id,supplier_id,quantity,free_quantity,gross4,opening_paid4,opening_debt4,funding_state) VALUES('source-disposition',991,951,91,9,31,'3','0.5',70001,0,70001,'reconciled_unpaid')")
  else native.exec("INSERT INTO stock_funding_sources(id,movement_id,batch_id,product_id,branch_id,supplier_id,quantity,free_quantity,gross4,opening_paid4,opening_debt4,reconciliation_proof,actor_id,source_json) VALUES('source-funding',991,951,91,9,31,'3','0.5',70001,40000,30001,'fixture trusted opening',101,'{}'); INSERT INTO stock_funding_events(id,source_id,generation,kind,amount4,gross4,paid4,debt4,credit4,asset4,cash_in4,cash_out4,shipping4,proof,actor_id,occurred_at) VALUES('funding-admit','source-funding',0,'admit',0,70001,40000,30001,0,0,0,0,0,'fixture trusted opening',101,'2026-10-01T00:00:00Z')")
  return { d1, native }
}

function linkedStockSnapshot(native) {
  const encode = value => JSON.stringify(value, (_, cell) => typeof cell === 'bigint' ? { integer64: String(cell) }
    : ArrayBuffer.isView(cell) ? { blob: Buffer.from(cell.buffer, cell.byteOffset, cell.byteLength).toString('hex') } : cell)
  const schema = native.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all()
  const quote = value => '"' + value.replaceAll('"', '""') + '"'
  const tables = schema.filter(row => row.type === 'table').map(({ name }) => {
    const columns = native.prepare('PRAGMA table_info(' + quote(name) + ')').all()
    const probes = columns.map(column => 'typeof(' + quote(column.name) + ') AS ' + quote('__stock_type_' + column.name))
    const rows = native.prepare('SELECT *' + (probes.length ? ',' + probes.join(',') : '') + ' FROM ' + quote(name)).all().map(encode).sort()
    return [name, columns, rows]
  })
  return encode([schema, tables])
}
async function verifyLinkedMergeLifecycle() {
  for (const kind of ['disposition', 'funding']) for (const linkedSide of ['keeper', 'duplicate']) {
    const fixture = linkedStockFixture(kind)
    try {
      const undo = loadUndoAppliers(fixture.d1)
      const reversal = { keeperId: 91, keeperName: 'Pinned stock', dupId: 92, dupName: 'Unlinked product',
        keeperImagePathBefore: null, dupImagePathBefore: null, keeperStockBefore: [], dupStockBefore: [],
        dupImagesBefore: [], imagesMovedToKeeper: [], repointedBatches: [], foldedBatches: [],
        reparentedSaleItemIds: [], reparentedMovementIds: [], adjustmentMovementIds: [] }
      if (linkedSide === 'duplicate') {
        ;[reversal.keeperId, reversal.dupId] = [reversal.dupId, reversal.keeperId]
        ;[reversal.keeperName, reversal.dupName] = [reversal.dupName, reversal.keeperName]
      }
      const recorded = await undo.recordMergeUndoSnapshot({}, { id: 101, username: 'fixture-owner' }, reversal)
      const payload = { applier: 'product.merge', snapshot_id: recorded.snapshotId }
      const applier = undo.resolveUndoApplier(payload)
      assert.ok(applier)
      const before = linkedStockSnapshot(fixture.native)
      const effectsBefore = [...lifecycleEffects]
      await assert.rejects(() => applier.run(payload, { env: {}, user: { id: 101, username: 'fixture-owner' }, direction: 'undo' }), error => {
        assert.equal(error instanceof require('hono/http-exception').HTTPException, true)
        assert.equal(error.status, 409)
        assert.equal(error.code, 'stock_lifecycle_dependency')
        return true
      })
      assert.equal(linkedStockSnapshot(fixture.native), before)
      assert.deepEqual(lifecycleEffects, effectsBefore)
      const db = loadStockLifecycleFixture('lib/db.ts').getDb({ DB: nativeStockFixtureBinding(fixture.native, statements => fixture.d1.batch(statements)) })
      await loadStockLifecycleFixture().assertStockLifecycleMutable(db, { productId: 92 })
      await loadStockLifecycleFixture().assertStockLifecycleMutable(db, { productId: 91, branchId: 8 })
      console.log('PASS actual ' + kind + ' linked ' + linkedSide + ' merge replay refuses before effects; unrelated scopes remain allowed')
    } finally { fixture.native.close() }
  }
}



const libDir = path.join(__dirname, '..', 'src', 'lib')

function loadProductMerge() {
  const source = fs.readFileSync(path.join(libDir, 'productMerge.ts'), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'productMerge.ts',
  })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(mod.exports, (request) => request === './moneyPrecision' ? moneyPrecision : require(request), mod)
  return mod.exports
}

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
  const actualDb = loadStockLifecycleFixture('lib/db.ts').getDb({ DB: nativeStockFixtureBinding(db.db, statements => dbAdapter.batch(statements)) })
  const stubs = {
    './stockLifecycle': loadStockLifecycleFixture(),
    '../index': {}, './auth': {}, './db': { ...loadStockLifecycleFixture('lib/db.ts'), getDb: () => actualDb }, './audit': { audit: async () => { lifecycleEffects.push('audit') } },
    '../durable-objects/broadcastHub': { broadcast: async () => { lifecycleEffects.push('broadcast') } }, './branchWrites': { branchUpdateStatements: () => [] },
    './permissions': { getActionTier: () => 'full', getPermissionTier: () => 'full' },
    './actorSnapshot': { actorSnapshot: (user) => user?.name || user?.username || null },
    './productMerge': loadProductMerge(),
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
    // F65 registers product.remove in the shared undo module. This harness
    // exercises only atomic merge history, so keep removal replay inert.
    './productDelete': {
      PRODUCT_REMOVE_ACTION_KIND: 'product.remove',
      parseProductRemoveSnapshot: (value) => value,
      productRemovePlanDigest: async () => '',
      productRemoveReplayStatements: () => [],
    },
  }
  // Register the real newly imported undo branch, including its TS dependencies.
  // Existing DB/effect adapters remain in force; no fake monetary exports.
  const dependencyModules = new Map()
  function loadDependency(filename) {
    if (dependencyModules.has(filename)) return dependencyModules.get(filename).exports
    const dependency = { exports: {} }
    dependencyModules.set(filename, dependency)
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: filename,
    })
    const dependencyRequire = (request) => {
      if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
      if (request === './moneyPrecision' || request === './moneyPrecision.ts') return moneyPrecision
      if (request.startsWith('.')) {
        return loadDependency(path.resolve(path.dirname(filename), request.endsWith('.ts') ? request : request + '.ts'))
      }
      return require(request)
    }
    new Function('exports', 'require', 'module', outputText)(dependency.exports, dependencyRequire, dependency)
    return dependency.exports
  }
  stubs['./customerGenderRestoration'] = loadDependency(path.join(libDir, 'customerGenderRestoration.ts'))
  // undoAppliers.ts now imports the exact sale money kernel; it depends only on
  // moneyPrecision, so the dependency loader resolves it against the real lib.
  stubs['./saleMoneyPrecision'] = loadDependency(path.join(libDir, 'saleMoneyPrecision.ts'))
  stubs['./productMergeLineage'] = loadDependency(path.join(libDir, 'productMergeLineage.ts'))
  stubs['./saleItemPricing'] = loadDependency(path.join(libDir, 'saleItemPricing.ts'))
  // U-cost: merge undo re-derives catalog cost with the real formula.
  stubs['./catalogCostRecompute'] = loadDependency(path.join(libDir, 'catalogCostRecompute.ts'))
  const source = fs.readFileSync(path.join(libDir, 'undoAppliers.ts'), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'undoAppliers.ts',
  })
  const originalLoad = Module._load
  Module._load = (request, parent, isMain) => ['./moneyPrecision', '../lib/moneyPrecision', './moneyPrecision.ts', '../lib/moneyPrecision.ts'].includes(request) ? moneyPrecision : Object.prototype.hasOwnProperty.call(stubs, request)
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
  await verifyLinkedMergeLifecycle()
  const db = openDb([`
    CREATE TABLE products(id INTEGER PRIMARY KEY,is_active INTEGER NOT NULL);
    CREATE TABLE undo_snapshots(
      id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT,status TEXT,payload_json TEXT,
      created_by_id INTEGER,created_by_name TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE action_history(
      id INTEGER PRIMARY KEY AUTOINCREMENT,scope TEXT,entity TEXT,entity_id TEXT,label TEXT,undo_label TEXT,redo_label TEXT,
      reversible INTEGER,status TEXT,undo_payload TEXT,redo_payload TEXT,created_by_id INTEGER,created_by_name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
  assert.equal(action.reversible, 0, 'undo is not advertised before the fingerprint is finalized')
  assert.equal(action.status, 'recorded')
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
  const undoSource = fs.readFileSync(path.join(libDir, 'undoAppliers.ts'), 'utf8')
  assert.match(undoSource, /UPDATE action_history SET reversible=1,status='undoable'/)
  assert.match(undoSource, /merge_history_guard/)
  console.log('test-product-merge-atomic-pure: all checks passed')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
