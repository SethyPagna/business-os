// Real-SQLite (not mocked) test of the server-side undo/redo applier slice
// (K1) -- lib/undoAppliers.ts's 'branch.update' applier and the shared write it
// replays through, lib/branchWrites.ts's branchUpdateStatements. Same rigor as
// the other *-pure.cjs scripts: real better-sqlite3 (the engine D1 runs), the
// REAL transpiled source (not a reimplementation), and a source-lock proving
// the live route and the applier share one write definition so they cannot
// drift.
//
// Covers, all against real rows: (1) branchUpdateStatements restores a branch's
// fields from an undo payload and reapplies them from a redo payload, and emits
// the "clear other defaults" statement only when is_default is truthy; (2) the
// real 'branch.update' applier, run through a minimal D1-compatible wrapper,
// updates the row and throws (leaving state untouched) when the branch is gone
// or the id is missing; (3) resolveUndoApplier recognizes a proper payload and
// returns null for an unknown/absent applier (the fall-through-to-client case);
// (4) routes/branches.ts's PUT actually calls branchUpdateStatements, so the
// route and the applier replay through the same SQL.
//
// Run: node scripts/test-undo-appliers-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

// --- load real TS modules with a controlled require shim -------------------

function transpile(relPath) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', relPath), 'utf8')
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  }).outputText
}

function loadModule(relPath, requireShim) {
  const module = { exports: {} }
  new Function('exports', 'require', 'module', transpile(relPath))(module.exports, requireShim, module)
  return module.exports
}

// toDbBool copied from lib/db.ts (verbatim) -- branchWrites imports only this
// one symbol from the heavy db module, so stub the rest of db out.
function toDbBool(value, fallback = 1) {
  if (value == null || value === '') return fallback
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return value ? 1 : 0
  const normalized = String(value).trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(normalized) ? 1 : 0
}

const branchRoles = loadModule('lib/branchRoles.ts', require)
const canonicalBranchIdentity = loadModule('lib/canonicalBranchIdentity.ts', (id) => {
  if (id === './db') return { toDbBool }
  if (id === './branchRoles') return branchRoles
  return require(id)
})
const branchWrites = loadModule('lib/branchWrites.ts', (id) => {
  if (id === './db') return { toDbBool }
  if (id === './canonicalBranchIdentity') return canonicalBranchIdentity
  return require(id)
})
const { branchUpdateStatements } = branchWrites

// A D1-compatible getDb stub over better-sqlite3 -- enough of the surface the
// applier uses: prepare(sql).get(params) with an array (positional ?) binding,
// and db.batch([{sql, params}]) with @named params. audit + broadcast are
// no-ops (the applier composes them; the test asserts the DB effect, not the
// side channels, which have their own coverage).
let sharedDb = null
let settlementReplayCalls = 0
let exerciseAtomicSaleItems = false
let failAtomicAllocation = false
let beforeAtomicBatch = null
function wrapDb(sqlite) {
  return {
    prepare(sql) {
      const stmt = sqlite.prepare(sql)
      return {
        get: (params) => (Array.isArray(params) ? stmt.get(...params) : stmt.get(params || {})),
        all: (params) => (Array.isArray(params) ? stmt.all(...params) : stmt.all(params || {})),
        run: (params) => (Array.isArray(params) ? stmt.run(...params) : stmt.run(params || {})),
      }
    },
    batch(statements) {
      if (beforeAtomicBatch) {
        const inject = beforeAtomicBatch
        beforeAtomicBatch = null
        inject(sqlite)
      }
      const tx = sqlite.transaction((stmts) => {
        return stmts.map((s) => {
          const st = sqlite.prepare(s.sql)
          const invoke = (method) => s.params == null
            ? st[method]()
            : Array.isArray(s.params) ? st[method](...s.params) : st[method](s.params)
          if (st.reader) return { results: invoke('all') }
          const result = invoke('run')
          return { results: [], changes: result.changes, meta: { changes: result.changes } }
        })
      })
      return Promise.resolve(tx(statements))
    },
  }
}

// N13: the appliers take their actor snapshot from the shared kernel now.
// It is a pure module with no imports of its own, so it loads for REAL --
// stubbing it would hide the very substitution the appliers depend on.
const actorSnapshotKernel = loadModule('lib/actorSnapshot.ts', require)
const productMergeKernel = loadModule('lib/productMerge.ts', require)
const undoAppliers = loadModule('lib/undoAppliers.ts', (id) => {
  if (id === './actorSnapshot') return actorSnapshotKernel
  if (id === './productMerge') return productMergeKernel
  // The dedicated bulk test executes this applier with its actual Hono/SQL.
  if (id === './saleBulkStatus') return { replaySaleBulkStatus: async () => { throw new Error('Use the dedicated bulk fixture') } }
  if (id === './saleBulkUpdate') return {
    BULK_UPDATE_KIND: 'sale.fields.bulk',
    BULK_CUSTOMER_UPDATE_KIND: 'sale.customer.bulk',
    MULTI_CUSTOMER_UPDATE_KIND: 'sale.customer.v2.bulk',
    SINGLE_CUSTOMER_UPDATE_KIND: 'sale.customer.single',
    replaySaleBulkUpdate: async () => { throw new Error('Use the dedicated bulk fixture') },
  }
  if (id === './returnBulkAction') return {
    RETURN_BULK_ACTION_KIND: 'return.fields.bulk',
    replayReturnBulkAction: async () => { throw new Error('Use the dedicated return bulk fixture') },
  }
  if (id === './stockSession') return {
    STOCK_SESSION_KIND: 'stock.session',
    replayStockSession: async () => { throw new Error('Use test-stock-session-undo.cjs for real stock replay') },
  }
  if (id === './saleSettlementAction') return {
    SALE_SETTLEMENT_ACTION_KIND: 'sale.settlement',
    saleMutationGuard: (predicate, params) => ({
      sql: `INSERT INTO sale_mutation_guards(id,guard_value) SELECT 1,CASE WHEN ${predicate} THEN 1 ELSE 0 END`,
      params,
    }),
    replaySaleSettlementAction: async (_env, _user, direction, historyId, generation, payload) => {
      settlementReplayCalls += 1
      assert.strictEqual(direction, 'undo')
      assert.strictEqual(historyId, 41)
      assert.strictEqual(generation, 0)
      assert.strictEqual(payload.operation_id, 'settlement-op-1')
    },
  }
  if (id === './db') return { getDb: () => wrapDb(sharedDb) }
  if (id === './audit') return { audit: async () => {} }
  if (id === '../durable-objects/broadcastHub') return { broadcast: async () => {} }
  if (id === './branchWrites') return branchWrites
  // undoAppliers now derives an applier's effective tier through permissions
  // (getActionTier for action-gated appliers like product.merge, else
  // getPermissionTier); the source-lock checks below read the real source, so
  // these stubs only need to let the module load.
  if (id === './permissions') return { getActionTier: () => 'full', getPermissionTier: () => 'full' }
  // S4-24b: the 'sale.add_items' applier's planners. This file exercises the
  // branch/merge appliers only, so these stubs exist to let the module load;
  // the real planners are driven against a live schema by
  // test-sale-add-items-pure.cjs, which is where that applier is proved.
  if (id === './saleLineAddition') return {
    buildAllocationStatements: () => [],
    buildOperationAllocationStatements: (_lines, operationId) => exerciseAtomicSaleItems ? [{
      sql: `INSERT INTO sale_item_batch_allocations(sale_item_id,quantity)
            SELECT entity_id,@quantity FROM sale_mutation_members
            WHERE operation_id=@operation AND entity_kind='sale_item' AND ordinal=0`,
      params: { operation: operationId, quantity: failAtomicAllocation ? -1 : 1 },
    }] : [],
    planSaleLineAddition: ({ saleId, lines }) => exerciseAtomicSaleItems ? ({
      lines,
      statements: [{
        sql: 'INSERT INTO sale_items(sale_id,product_id,product_name,quantity,total_usd) VALUES(@saleId,@productId,@productName,@quantity,@totalUsd)',
        params: { saleId, productId: lines[0].productId, productName: lines[0].productName, quantity: lines[0].quantity, totalUsd: lines[0].lineTotalUsd },
      }],
      saleItemStatementIndexByLine: [0], deductions: [], deductedUnits: 0, addedSubtotalUsd: lines[0].lineTotalUsd,
    }) : ({ lines: [], statements: [], saleItemStatementIndexByLine: [], deductions: [], deductedUnits: 0, addedSubtotalUsd: 0 }),
    planSaleLineRemoval: ({ saleId, lines }) => exerciseAtomicSaleItems ? ({
      statements: [
        { sql: 'DELETE FROM sale_item_batch_allocations WHERE sale_item_id=@lineId', params: { lineId: lines[0].saleItemId } },
        { sql: 'DELETE FROM sale_items WHERE id=@lineId AND sale_id=@saleId', params: { lineId: lines[0].saleItemId, saleId } },
      ],
      restoredUnits: lines[0].heldUnits,
    }) : ({ statements: [], restoredUnits: 0 }),
    plannedLineFromRecord: (record) => record,
    saleMoneyUpdateStatement: (saleId, money) => exerciseAtomicSaleItems
      ? { sql: 'UPDATE sales SET total_usd=@total WHERE id=@saleId', params: { saleId, total: money.total_usd } }
      : { sql: 'SELECT 1', params: {} },
    saleLineKhrSnapshotStatement: () => ({ sql: 'SELECT 1', params: {} }),
  }
  // S4-30: the same applier now also appends an amendment-ledger entry, so an
  // undone addition leaves a visible trail instead of a hole. Stubbed for the
  // same reason as above -- the real statement builder and the append-only
  // triggers behind it are driven against a live schema by
  // test-sale-amendments-pure.cjs.
  if (id === './saleAmendments') return {
    amendmentEntryStatement: () => ({ sql: 'SELECT 1', params: {} }),
  }
  // F65 registers product.remove beside the appliers exercised here. Stub its
  // dependency so this focused harness can continue loading the real registry
  // without executing the separately covered removal kernel.
  if (id === './productDelete') return {
    PRODUCT_REMOVE_ACTION_KIND: 'product.remove',
    parseProductRemoveSnapshot: (value) => value,
    productRemovePlanDigest: async () => '',
    productRemoveReplayStatements: () => [],
  }
  return require(id)
})
const { resolveUndoApplier, registeredUndoAppliers, isServerReplayable, mergeReplayChangesProductImages, registerProductMergeGroupRedo, productMergeGroupPrefixFingerprint } = undoAppliers

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function freshDb() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE branches (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, location TEXT, phone TEXT, manager TEXT,
    notes TEXT, is_default INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
    updated_at TEXT
  )`)
  // Branch names are denormalized display snapshots in these id-linked
  // history tables.  Keep the fixture aligned with the real schema so a
  // branch rename verifies its cascade rather than merely the branch row.
  db.exec(`CREATE TABLE sales (branch_id INTEGER, branch_name TEXT, updated_at TEXT);
           CREATE TABLE inventory_movements (branch_id INTEGER, branch_name TEXT);
           CREATE TABLE returns (branch_id INTEGER, branch_name TEXT);
           CREATE TABLE stock_row_moves (branch_id INTEGER, branch_name TEXT);`)
  return db
}

const atomicUser = { id: 7, name: 'Atomic verifier' }

function atomicSaleItemsFixture() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE sales(id INTEGER PRIMARY KEY,sale_status TEXT,total_usd REAL);
    CREATE TABLE sale_items(id INTEGER PRIMARY KEY AUTOINCREMENT,sale_id INTEGER,product_id INTEGER,product_name TEXT,quantity REAL,total_usd REAL);
    CREATE TABLE sale_item_batch_allocations(id INTEGER PRIMARY KEY AUTOINCREMENT,sale_item_id INTEGER,quantity REAL CHECK(quantity>0));
    CREATE TABLE sale_write_revisions(sale_id INTEGER PRIMARY KEY,revision INTEGER NOT NULL);
    CREATE TABLE undo_snapshots(id INTEGER PRIMARY KEY,kind TEXT,status TEXT,payload_json TEXT,updated_at TEXT);
    CREATE TABLE action_history(id INTEGER PRIMARY KEY,status TEXT,undo_payload TEXT,redo_payload TEXT,last_error TEXT,updated_at TEXT);
    CREATE TABLE sale_mutation_receipts(id TEXT PRIMARY KEY,sale_id INTEGER,history_id INTEGER,mutation_kind TEXT,generation INTEGER,sale_revision INTEGER,updated_at TEXT);
    CREATE TABLE sale_mutation_members(operation_id TEXT,entity_kind TEXT,entity_id INTEGER,ordinal INTEGER,PRIMARY KEY(operation_id,entity_kind,ordinal));
    CREATE TABLE sale_mutation_guards(id INTEGER PRIMARY KEY,guard_value INTEGER NOT NULL CHECK(guard_value=1));
    CREATE TABLE audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,user_name TEXT,action TEXT,entity TEXT,entity_id TEXT,details TEXT,table_name TEXT,record_id TEXT,new_value TEXT);
    CREATE TRIGGER revision_sale_update AFTER UPDATE ON sales BEGIN
      INSERT INTO sale_write_revisions(sale_id,revision) VALUES(NEW.id,1)
      ON CONFLICT(sale_id) DO UPDATE SET revision=revision+1;
    END;
    CREATE TRIGGER revision_line_insert AFTER INSERT ON sale_items BEGIN
      INSERT INTO sale_write_revisions(sale_id,revision) VALUES(NEW.sale_id,1)
      ON CONFLICT(sale_id) DO UPDATE SET revision=revision+1;
    END;
    CREATE TRIGGER revision_line_delete AFTER DELETE ON sale_items BEGIN
      INSERT INTO sale_write_revisions(sale_id,revision) VALUES(OLD.sale_id,1)
      ON CONFLICT(sale_id) DO UPDATE SET revision=revision+1;
    END;
    CREATE TRIGGER revision_allocation_insert AFTER INSERT ON sale_item_batch_allocations BEGIN
      INSERT INTO sale_write_revisions(sale_id,revision)
      SELECT sale_id,1 FROM sale_items WHERE id=NEW.sale_item_id
      ON CONFLICT(sale_id) DO UPDATE SET revision=revision+1;
    END;
    CREATE TRIGGER revision_allocation_delete AFTER DELETE ON sale_item_batch_allocations BEGIN
      INSERT INTO sale_write_revisions(sale_id,revision)
      SELECT sale_id,1 FROM sale_items WHERE id=OLD.sale_item_id
      ON CONFLICT(sale_id) DO UPDATE SET revision=revision+1;
    END;
  `)
  const reversal = {
    saleId: 77, receiptNumber: 'ATOMIC-77', saleStatus: 'completed', exchangeRate: 4100,
    operationId: 'add-operation-77', saleStateRevision: 5,
    moneyBefore: { total_usd: 10 }, moneyAfter: { total_usd: 15 },
    lines: [{ saleItemId: 10, productId: 9, productName: 'Serum', quantity: 1, branchId: 1, heldUnits: 1, lineTotalUsd: 5, takes: [{ batchId: 501, quantity: 1 }] }],
  }
  const payload = { applier: 'sale.add_items', snapshot_id: 1, operation_id: reversal.operationId, generation: 0 }
  db.prepare("INSERT INTO sales(id,sale_status,total_usd) VALUES(77,'completed',15)").run()
  db.prepare("INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,total_usd) VALUES(10,77,9,'Serum',1,5)").run()
  db.prepare('INSERT INTO sale_item_batch_allocations(sale_item_id,quantity) VALUES(10,1)').run()
  db.prepare('INSERT OR REPLACE INTO sale_write_revisions(sale_id,revision) VALUES(77,5)').run()
  db.prepare("INSERT INTO undo_snapshots(id,kind,status,payload_json) VALUES(1,'sale.add_items','applied',?)").run(JSON.stringify(reversal))
  db.prepare("INSERT INTO action_history(id,status,undo_payload,redo_payload) VALUES(41,'undoable',?,?)").run(JSON.stringify(payload), JSON.stringify(payload))
  db.prepare("INSERT INTO sale_mutation_receipts(id,sale_id,history_id,mutation_kind,generation,sale_revision) VALUES('add-operation-77',77,41,'add_items',0,5)").run()
  db.prepare("INSERT INTO sale_mutation_members(operation_id,entity_kind,entity_id,ordinal) VALUES('add-operation-77','sale_item',10,0)").run()
  db.prepare("INSERT INTO sale_mutation_members(operation_id,entity_kind,entity_id,ordinal) VALUES('add-operation-77','undo_snapshot',1,0)").run()
  return { db, payload }
}

async function productMergeGroupFixture() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE products(id INTEGER PRIMARY KEY,is_active INTEGER,updated_at TEXT,image_path TEXT,barcode TEXT,
      category TEXT,categories TEXT,brand TEXT,brands TEXT,unit TEXT,unit_normalized TEXT,brand_compact TEXT,stock_quantity REAL);
    CREATE TABLE branch_stock(product_id INTEGER,branch_id INTEGER,quantity REAL,rfid_confirmed_qty REAL,PRIMARY KEY(product_id,branch_id));
    CREATE TABLE product_batches(id INTEGER PRIMARY KEY,variant_product_id INTEGER,batch_key TEXT,batch_number INTEGER,is_active INTEGER,updated_at TEXT);
    CREATE TABLE branch_batch_stock(batch_id INTEGER,branch_id INTEGER,quantity REAL,updated_at TEXT,PRIMARY KEY(batch_id,branch_id));
    CREATE TABLE product_images(id INTEGER PRIMARY KEY,product_id INTEGER,image_path TEXT,sort_order INTEGER);
    CREATE TABLE stock_session_members(operation_id TEXT,product_id INTEGER);
    CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY,product_id INTEGER,movement_type TEXT,reason TEXT);
    CREATE TABLE undo_snapshots(id INTEGER PRIMARY KEY,kind TEXT,status TEXT,payload_json TEXT,created_by_id INTEGER,updated_at TEXT);
    CREATE TABLE action_history(id INTEGER PRIMARY KEY,status TEXT,undo_payload TEXT,redo_payload TEXT,last_error TEXT,created_by_id INTEGER,updated_at TEXT);
    CREATE TABLE product_conflict_action_reviews(id TEXT PRIMARY KEY,actor_id INTEGER);
    CREATE TABLE product_conflict_action_groups(review_id TEXT,ordinal INTEGER,group_key TEXT,status TEXT,reversal_generation INTEGER,action_history_id INTEGER,updated_at TEXT,PRIMARY KEY(review_id,ordinal));
    CREATE TABLE product_conflict_action_group_members(review_id TEXT,group_ordinal INTEGER,member_ordinal INTEGER,product_id INTEGER,role TEXT,status TEXT,undo_snapshot_id INTEGER,updated_at TEXT,PRIMARY KEY(review_id,group_ordinal,member_ordinal));
    CREATE TABLE audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,user_name TEXT,action TEXT,entity TEXT,entity_id TEXT,details TEXT,table_name TEXT,record_id TEXT,new_value TEXT);
  `)
  db.prepare("INSERT INTO products VALUES(1,1,NULL,NULL,'GROUP-1','Final','[\"Final\"]','Final','[\"Final\"]','ea','ea','final',0)").run()
  db.prepare("INSERT INTO products VALUES(2,0,NULL,NULL,'GROUP-1','Old A','[\"Old A\"]','A','[\"A\"]','box','box','a',0)").run()
  db.prepare("INSERT INTO products VALUES(3,0,NULL,NULL,'GROUP-1','Old B','[\"Old B\"]','B','[\"B\"]','pack','pack','b',0)").run()
  const reversal = (dupId, label) => ({
    keeperId: 1, keeperName: 'Keeper', dupId, dupName: label, mergeContext: 'group test',
    keeperImagePathBefore: null, dupImagePathBefore: null, keeperBarcodeBefore: 'GROUP-1',
    keeperCatalogBefore: { category: label, categories: `[\"${label}\"]`, brand: label, brands: `[\"${label}\"]`, unit: 'ea', unit_normalized: 'ea', brand_compact: label.toLowerCase() },
    keeperStockBefore: [], dupStockBefore: [], dupImagesBefore: [], imagesMovedToKeeper: [], repointedBatches: [], foldedBatches: [],
    reparentedSaleItemIds: [], reparentedMovementIds: [], adjustmentMovementIds: [], operationId: `op-${dupId}`,
  })
  const childIds = [11, 12]
  db.prepare("INSERT INTO undo_snapshots VALUES(11,'product.merge.group.child','applied',?,7,NULL)").run(JSON.stringify(reversal(2, 'Old A')))
  db.prepare("INSERT INTO undo_snapshots VALUES(12,'product.merge.group.child','applied',?,7,NULL)").run(JSON.stringify(reversal(3, 'Old B')))
  const groupSnapshot = {
    version: 1, review_id: 'review-1', group_key: 'group-1', child_snapshot_ids: childIds,
    prefix_fingerprint: await productMergeGroupPrefixFingerprint('review-1', 'group-1', childIds, 0), generation: 0,
  }
  db.prepare("INSERT INTO undo_snapshots VALUES(10,'product.merge.group','applied',?,7,NULL)").run(JSON.stringify(groupSnapshot))
  const pointer = { applier: 'product.merge.group', snapshot_id: 10, review_id: 'review-1', group_key: 'group-1', generation: 0 }
  db.prepare("INSERT INTO action_history VALUES(41,'undoable',?,?,NULL,7,NULL)").run(JSON.stringify(pointer), JSON.stringify(pointer))
  db.prepare("INSERT INTO product_conflict_action_reviews VALUES('review-1',7)").run()
  db.prepare("INSERT INTO product_conflict_action_groups VALUES('review-1',0,'group-1','completed',0,41,NULL)").run()
  db.prepare("INSERT INTO product_conflict_action_group_members VALUES('review-1',0,0,1,'keeper','undo_ready',NULL,NULL)").run()
  db.prepare("INSERT INTO product_conflict_action_group_members VALUES('review-1',0,1,2,'merged','undo_ready',11,NULL)").run()
  db.prepare("INSERT INTO product_conflict_action_group_members VALUES('review-1',0,2,3,'merged','undo_ready',12,NULL)").run()
  return { db, pointer }
}

function atomicSaleItemsState(db) {
  return Object.fromEntries(['sales', 'sale_items', 'sale_item_batch_allocations', 'sale_write_revisions', 'undo_snapshots',
    'action_history', 'sale_mutation_receipts', 'sale_mutation_members', 'sale_mutation_guards', 'audit_logs']
    .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}

function readBranch(db, id) {
  return db.prepare('SELECT name, location, phone, manager, notes, is_default, is_active FROM branches WHERE id = ?').get(id)
}

function runStatements(db, statements) {
  for (const s of statements) {
    const st = db.prepare(s.sql)
    if (s.params == null) st.run()
    else st.run(s.params)
  }
}

// --- checks ----------------------------------------------------------------

async function main() {
await check('branchUpdateStatements applies canonical metadata without changing identity', () => {
  const db = freshDb()
  db.prepare(`INSERT INTO branches (id, name, location, phone, manager, notes, is_default, is_active) VALUES (2, 'Shop', 'New Loc', '070', 'Bob', 'edited', 0, 1)`).run()
  const current = db.prepare('SELECT id,name,is_active FROM branches WHERE id=2').get()
  const undoFields = { name: 'Shop', location: 'Old Loc', phone: '012', manager: 'Alice', notes: 'orig', is_default: 0, is_active: 1 }
  runStatements(db, branchUpdateStatements(2, undoFields, current))
  assert.deepStrictEqual(readBranch(db, 2), { name: 'Shop', location: 'Old Loc', phone: '012', manager: 'Alice', notes: 'orig', is_default: 0, is_active: 1 })
})

await check('branchUpdateStatements refuses saved identity changes and legacy conversion', () => {
  const shop = { id: 2, name: 'Shop', is_active: 1 }
  assert.throws(() => branchUpdateStatements(2, { name: 'Shop RENAMED' }, shop), canonicalBranchIdentity.CanonicalBranchIdentityError)
  assert.throws(() => branchUpdateStatements(2, { is_active: 0 }, shop), canonicalBranchIdentity.CanonicalBranchIdentityError)
  assert.throws(
    () => branchUpdateStatements(3, { name: 'Shop', is_active: 1 }, { id: 3, name: 'Old Shop', is_active: 1 }),
    canonicalBranchIdentity.CanonicalBranchIdentityError,
  )
})

await check('branchUpdateStatements changes the default only among canonical rows', () => {
  const db = freshDb()
  db.prepare(`INSERT INTO branches (id, name, is_default, is_active) VALUES (1, 'Warehouse', 1, 1)`).run()
  db.prepare(`INSERT INTO branches (id, name, is_default, is_active) VALUES (2, 'Shop', 0, 1)`).run()
  db.prepare(`INSERT INTO branches (id, name, is_default, is_active) VALUES (3, 'Legacy Depot', 1, 1)`).run()
  const current = db.prepare('SELECT id,name,is_active FROM branches WHERE id=2').get()
  const redoStatements = branchUpdateStatements(2, { name: 'Shop', is_default: true, is_active: 1 }, current)
  assert.ok(redoStatements.some((s) => /UPDATE branches SET is_default = 0/.test(s.sql)), 'expected the clear-other-defaults statement')
  runStatements(db, redoStatements)
  assert.strictEqual(readBranch(db, 1).is_default, 0)
  assert.strictEqual(readBranch(db, 2).is_default, 1)
  assert.strictEqual(readBranch(db, 3).is_default, 1, 'legacy branch is not rewritten')

  const plain = branchUpdateStatements(2, { name: 'Shop', is_default: 0, is_active: 1 }, current)
  assert.ok(!plain.some((s) => /UPDATE branches SET is_default = 0/.test(s.sql)), 'a non-default edit must not clear defaults')
})

await check('the real branch.update applier updates canonical metadata through the D1 wrapper', async () => {
  const db = freshDb()
  db.prepare(`INSERT INTO branches (id, name, location, is_default, is_active) VALUES (2, 'Shop', 'x', 0, 1)`).run()
  sharedDb = db
  const payload = { applier: 'branch.update', id: 2, fields: { name: 'Shop', location: 'Old Loc', is_default: 0, is_active: 1 } }
  const applier = resolveUndoApplier(payload)
  assert.ok(applier && applier.name === 'branch.update')
  await applier.run(payload, { env: {}, user: { id: 9, name: 'Admin' }, direction: 'undo' })
  assert.deepStrictEqual(readBranch(db, 2), { name: 'Shop', location: 'Old Loc', phone: null, manager: null, notes: null, is_default: 0, is_active: 1 })
})

await check('the branch.update applier rejects historical identity changes and an identity race atomically', async () => {
  const db = freshDb()
  db.prepare(`INSERT INTO branches (id, name, location, is_default, is_active) VALUES (2, 'Shop', 'before', 0, 1)`).run()
  sharedDb = db
  const applier = resolveUndoApplier({ applier: 'branch.update', id: 2 })
  await assert.rejects(
    () => applier.run({ applier: 'branch.update', id: 2, fields: { name: 'Depot', location: 'forbidden' } }, { env: {}, user: null, direction: 'undo' }),
    /fixed to Shop and Warehouse/,
  )
  assert.equal(readBranch(db, 2).location, 'before')

  beforeAtomicBatch = (sqlite) => sqlite.prepare("UPDATE branches SET name='Changed elsewhere' WHERE id=2").run()
  await assert.rejects(
    () => applier.run({ applier: 'branch.update', id: 2, fields: { name: 'Shop', location: 'raced' } }, { env: {}, user: null, direction: 'redo' }),
    /NOT NULL/,
  )
  assert.equal(readBranch(db, 2).location, 'before')
  assert.equal(readBranch(db, 2).name, 'Changed elsewhere')
})

await check('the branch.update applier throws when the branch is gone or the id is missing', async () => {
  const db = freshDb()
  sharedDb = db
  const applier = resolveUndoApplier({ applier: 'branch.update', id: 999, fields: { name: 'Ghost' } })
  await assert.rejects(() => applier.run({ applier: 'branch.update', id: 999, fields: { name: 'Ghost' } }, { env: {}, user: null, direction: 'undo' }), /no longer exists/)
  await assert.rejects(() => applier.run({ applier: 'branch.update', id: 0, fields: {} }, { env: {}, user: null, direction: 'undo' }), /branch id/)
})

await check('resolveUndoApplier recognizes a registered applier and falls through (null) otherwise', () => {
  assert.strictEqual(resolveUndoApplier({ applier: 'branch.update', id: 1 })?.name, 'branch.update')
  assert.strictEqual(resolveUndoApplier({ applier: 'not.registered', id: 1 }), null)
  assert.strictEqual(resolveUndoApplier({ id: 1 }), null)            // no applier field -> client replay
  assert.strictEqual(resolveUndoApplier({}), null)
  assert.strictEqual(resolveUndoApplier(null), null)
  assert.ok(registeredUndoAppliers().includes('branch.update'))
  assert.ok(registeredUndoAppliers().includes('sale.fields.bulk'))
  assert.ok(registeredUndoAppliers().includes('sale.customer.bulk'))
  assert.ok(registeredUndoAppliers().includes('sale.customer.v2.bulk'))
  assert.ok(registeredUndoAppliers().includes('sale.customer.single'))
  assert.ok(registeredUndoAppliers().includes('return.fields.bulk'))
})

await check('source lock: routes/branches.ts replays the same write via branchUpdateStatements', () => {
  const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'branches.ts'), 'utf8')
  assert.ok(/branchUpdateStatements\(/.test(routeSrc), 'branches.ts must call the shared branchUpdateStatements')
  assert.ok(/from '\.\.\/lib\/branchWrites'/.test(routeSrc), 'branches.ts must import branchWrites')
})

// --- K1 slice 2: reloaded rows become actionable ---------------------------

await check('isServerReplayable follows the row status to the RIGHT payload and stays false otherwise', () => {
  const replayable = { applier: 'branch.update', id: 2, fields: { name: 'Shop' } }
  const notRegistered = { applier: 'not.registered', id: 2 }
  // undoable rows consult the undo payload, redoable rows the redo payload.
  assert.strictEqual(isServerReplayable({ reversible: 1, status: 'undoable' }, replayable, null), true)
  assert.strictEqual(isServerReplayable({ reversible: 1, status: 'undoable' }, null, replayable), false)
  assert.strictEqual(isServerReplayable({ reversible: 1, status: 'redoable' }, null, replayable), true)
  assert.strictEqual(isServerReplayable({ reversible: 1, status: 'redoable' }, replayable, null), false)
  // Unregistered appliers, terminal/recorded statuses and irreversible rows
  // never read as replayable.
  assert.strictEqual(isServerReplayable({ reversible: 1, status: 'undoable' }, notRegistered, null), false)
  assert.strictEqual(isServerReplayable({ reversible: 1, status: 'recorded' }, replayable, replayable), false)
  assert.strictEqual(isServerReplayable({ reversible: 1, status: 'failed' }, replayable, replayable), false)
  assert.strictEqual(isServerReplayable({ reversible: 0, status: 'undoable' }, replayable, replayable), false)
})

await check('appliers declare their own permission and it is the branches section for branch.update', () => {
  const resolved = resolveUndoApplier({ applier: 'branch.update', id: 1 })
  assert.strictEqual(resolved?.permission, 'branches')
})

await check('the product.merge applier is registered and gated on the granular merge_duplicates action', () => {
  assert.ok(registeredUndoAppliers().includes('product.merge'), 'product.merge must be a registered applier')
  const resolved = resolveUndoApplier({ applier: 'product.merge', snapshot_id: 1 })
  assert.strictEqual(resolved?.permission, 'products')
  // Unlike branch.update (coarse section), the merge replay is gated by the
  // SAME granular action as the live merge, so a user with products=full but
  // merge_duplicates blocked cannot undo/redo a merge.
  assert.strictEqual(resolved?.action, 'merge_duplicates')
})

await check('the product.merge.bulk applier (whole-catalog cleanup) is registered and gated identically', () => {
  assert.ok(registeredUndoAppliers().includes('product.merge.bulk'), 'product.merge.bulk must be a registered applier')
  const resolved = resolveUndoApplier({ applier: 'product.merge.bulk', snapshot_id: 1 })
  assert.strictEqual(resolved?.permission, 'products')
  // Same granular gate as the single merge -- the bulk undo/redo is just the
  // composite of the same folds, so it must demand the SAME merge_duplicates action.
  assert.strictEqual(resolved?.action, 'merge_duplicates')
})

await check('the product.merge.group applier is registered with the merge action gate', () => {
  assert.ok(registeredUndoAppliers().includes('product.merge.group'))
  const resolved = resolveUndoApplier({ applier: 'product.merge.group', snapshot_id: 1 })
  assert.strictEqual(resolved?.permission, 'products')
  assert.strictEqual(resolved?.action, 'merge_duplicates')
})

await check('product.merge.group undo is reverse-order, resumable, atomic, and reconciles a lost final response', async () => {
  const fixture = await productMergeGroupFixture()
  sharedDb = fixture.db
  try {
    const applier = resolveUndoApplier(fixture.pointer)
    const first = await applier.run(fixture.pointer, { env: {}, user: atomicUser, direction: 'undo', historyId: 41, generation: 0 })
    assert.deepEqual(first, { complete: false, continuation_required: true, processed_children: 1, pending_children: 1, generation: 0 })
    assert.equal(fixture.db.prepare('SELECT is_active FROM products WHERE id=3').get().is_active, 1, 'last child reverses first')
    assert.equal(fixture.db.prepare('SELECT is_active FROM products WHERE id=2').get().is_active, 0)
    assert.equal(fixture.db.prepare('SELECT status FROM action_history WHERE id=41').get().status, 'undoable', 'partial undo remains undoable')
    assert.equal(fixture.db.prepare('SELECT status FROM product_conflict_action_groups').get().status, 'partial')

    const second = await applier.run(fixture.pointer, { env: {}, user: atomicUser, direction: 'undo', historyId: 41, generation: 0 })
    assert.deepEqual(second, { complete: true, continuation_required: false, processed_children: 1, pending_children: 0, generation: 1 })
    assert.equal(fixture.db.prepare('SELECT status FROM action_history WHERE id=41').get().status, 'redoable')
    const currentPointer = JSON.parse(fixture.db.prepare('SELECT undo_payload FROM action_history WHERE id=41').get().undo_payload)
    const currentGroupSnapshot = JSON.parse(fixture.db.prepare('SELECT payload_json FROM undo_snapshots WHERE id=10').get().payload_json)
    assert.equal(currentGroupSnapshot.prefix_fingerprint,
      await productMergeGroupPrefixFingerprint('review-1', 'group-1', [11, 12], 1),
      'final child transaction authenticates the same ordered ids under the new generation')
    const reconciled = await applier.run(currentPointer, { env: {}, user: atomicUser, direction: 'undo', historyId: 41, generation: 0 })
    assert.deepEqual(reconciled, { complete: true, continuation_required: false, processed_children: 0, pending_children: 0, generation: 1 })
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n, 2, 'reconciliation writes no duplicate audit')
  } finally { sharedDb = null }
})

await check('product.merge.group redo is forward-order, resumable, and stale generations fail without writes', async () => {
  const fixture = await productMergeGroupFixture()
  sharedDb = fixture.db
  try {
    const applier = resolveUndoApplier(fixture.pointer)
    await applier.run(fixture.pointer, { env: {}, user: atomicUser, direction: 'undo', historyId: 41, generation: 0 })
    await applier.run(fixture.pointer, { env: {}, user: atomicUser, direction: 'undo', historyId: 41, generation: 0 })
    registerProductMergeGroupRedo(async ({ db, reversal, completionStatements }) => {
      const fresh = { ...reversal }
      await db.batch([
        { sql: 'UPDATE products SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE id=@id', params: { id: reversal.dupId } },
        ...completionStatements(fresh),
      ])
    })
    let pointer = JSON.parse(fixture.db.prepare('SELECT redo_payload FROM action_history WHERE id=41').get().redo_payload)
    const first = await applier.run(pointer, { env: {}, user: atomicUser, direction: 'redo', historyId: 41, generation: 1 })
    assert.deepEqual(first, { complete: false, continuation_required: true, processed_children: 1, pending_children: 1, generation: 1 })
    assert.equal(fixture.db.prepare('SELECT is_active FROM products WHERE id=2').get().is_active, 0, 'first child reapplies first')
    assert.equal(fixture.db.prepare('SELECT is_active FROM products WHERE id=3').get().is_active, 1)
    assert.equal(fixture.db.prepare('SELECT status FROM action_history WHERE id=41').get().status, 'redoable', 'partial redo remains redoable')
    const second = await applier.run(pointer, { env: {}, user: atomicUser, direction: 'redo', historyId: 41, generation: 1 })
    assert.equal(second.complete, true)
    assert.equal(second.generation, 2)
    const state = JSON.stringify(fixture.db.prepare('SELECT status,reversal_generation FROM product_conflict_action_groups').get())
    pointer = JSON.parse(fixture.db.prepare('SELECT redo_payload FROM action_history WHERE id=41').get().redo_payload)
    await assert.rejects(
      () => applier.run(pointer, { env: {}, user: atomicUser, direction: 'redo', historyId: 41, generation: 0 }),
      error => error?.statusCode === 409,
    )
    assert.equal(JSON.stringify(fixture.db.prepare('SELECT status,reversal_generation FROM product_conflict_action_groups').get()), state)
  } finally { sharedDb = null }
})

await check('product.merge.group rejects duplicate, missing, foreign-actor, and mismatched-member children', async () => {
  for (const mutate of [
    db => {
      const snap = JSON.parse(db.prepare('SELECT payload_json FROM undo_snapshots WHERE id=10').get().payload_json)
      snap.prefix_fingerprint = `sha256-${'f'.repeat(64)}`
      db.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=10').run(JSON.stringify(snap))
    },
    db => {
      const snap = JSON.parse(db.prepare('SELECT payload_json FROM undo_snapshots WHERE id=10').get().payload_json)
      snap.child_snapshot_ids = [11, 11]
      db.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=10').run(JSON.stringify(snap))
    },
    db => db.prepare('DELETE FROM undo_snapshots WHERE id=12').run(),
    db => db.prepare('UPDATE undo_snapshots SET created_by_id=8 WHERE id=12').run(),
    db => db.prepare('UPDATE product_conflict_action_group_members SET product_id=99 WHERE undo_snapshot_id=12').run(),
  ]) {
    const fixture = await productMergeGroupFixture()
    sharedDb = fixture.db
    mutate(fixture.db)
    const before = JSON.stringify(fixture.db.prepare('SELECT id,is_active FROM products ORDER BY id').all())
    await assert.rejects(
      () => resolveUndoApplier(fixture.pointer).run(fixture.pointer, { env: {}, user: atomicUser, direction: 'undo', historyId: 41, generation: 0 }),
      error => error?.statusCode === 409,
    )
    assert.equal(JSON.stringify(fixture.db.prepare('SELECT id,is_active FROM products ORDER BY id').all()), before)
  }
  sharedDb = null
})

await check('product.merge.group CAS rejects a boundary race without a partial child reversal', async () => {
  const fixture = await productMergeGroupFixture()
  sharedDb = fixture.db
  beforeAtomicBatch = db => db.prepare('UPDATE product_conflict_action_groups SET reversal_generation=1').run()
  try {
    await assert.rejects(
      () => resolveUndoApplier(fixture.pointer).run(fixture.pointer, { env: {}, user: atomicUser, direction: 'undo', historyId: 41, generation: 0 }),
      error => error?.statusCode === 409,
    )
    assert.equal(fixture.db.prepare('SELECT is_active FROM products WHERE id=3').get().is_active, 0)
    assert.equal(fixture.db.prepare('SELECT status FROM undo_snapshots WHERE id=12').get().status, 'applied')
    assert.equal(fixture.db.prepare('SELECT status FROM action_history WHERE id=41').get().status, 'undoable')
  } finally {
    beforeAtomicBatch = null
    sharedDb = null
  }
})

await check('sale bulk replay needs sales.bulk while one-customer replay keeps sales.customer', () => {
  assert.strictEqual(resolveUndoApplier({ applier: 'sale.status.bulk' })?.action, 'bulk')
  assert.strictEqual(resolveUndoApplier({ applier: 'sale.fields.bulk' })?.action, 'bulk')
  assert.strictEqual(resolveUndoApplier({ applier: 'sale.customer.v2.bulk' })?.action, 'bulk')
  assert.strictEqual(resolveUndoApplier({ applier: 'sale.customer.bulk' })?.action, 'customer', 'legacy outer gate remains compatible; replay rechecks multi size')
  assert.strictEqual(resolveUndoApplier({ applier: 'sale.customer.single' })?.action, 'customer')
})

await check('merge replay image authority is required only for saved cover/gallery effects', async () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE undo_snapshots(id INTEGER PRIMARY KEY, kind TEXT, payload_json TEXT); CREATE TABLE products(id INTEGER PRIMARY KEY, image_path TEXT)')
  sharedDb = db
  const base = {
    keeperId: 1, dupId: 2, keeperImagePathBefore: null, dupImagePathBefore: null,
    dupImagesBefore: [], imagesMovedToKeeper: [],
  }
  db.prepare('INSERT INTO undo_snapshots(id,kind,payload_json) VALUES(1,?,?)').run('product.merge', JSON.stringify(base))
  assert.equal(await mergeReplayChangesProductImages({}, { applier: 'product.merge', snapshot_id: 1 }, 'undo'), false)
  db.prepare('INSERT INTO undo_snapshots(id,kind,payload_json) VALUES(2,?,?)').run('product.merge', JSON.stringify({
    ...base, dupImagesBefore: [{ image_path: '/uploads/a.png', sort_order: 0 }], imagesMovedToKeeper: ['/uploads/a.png'],
  }))
  assert.equal(await mergeReplayChangesProductImages({}, { applier: 'product.merge', snapshot_id: 2 }, 'undo'), true)
  db.prepare('INSERT INTO undo_snapshots(id,kind,payload_json) VALUES(3,?,?)').run('product.merge', JSON.stringify({
    ...base, dupImagePathBefore: '/uploads/primary.png',
  }))
  assert.equal(await mergeReplayChangesProductImages({}, { applier: 'product.merge', snapshot_id: 3 }, 'redo'), true)
  db.prepare('INSERT INTO undo_snapshots(id,kind,payload_json) VALUES(4,?,?)').run('product.merge.bulk', JSON.stringify({ reversals: [base, {
    ...base, keeperId: 3, dupId: 4, dupImagesBefore: [{ image_path: '/uploads/b.png', sort_order: 0 }],
  }] }))
  assert.equal(await mergeReplayChangesProductImages({}, { applier: 'product.merge.bulk', snapshot_id: 4 }, 'redo'), true)
  db.prepare('INSERT INTO undo_snapshots(id,kind,payload_json) VALUES(5,?,?)').run('product.merge.group.child', JSON.stringify(base))
  db.prepare('INSERT INTO undo_snapshots(id,kind,payload_json) VALUES(6,?,?)').run('product.merge.group.child', JSON.stringify({
    ...base, keeperId: 3, dupId: 4, dupImagesBefore: [{ image_path: '/uploads/group.png', sort_order: 0 }],
  }))
  db.prepare('INSERT INTO undo_snapshots(id,kind,payload_json) VALUES(7,?,?)').run('product.merge.group', JSON.stringify({ child_snapshot_ids: [5, 6] }))
  assert.equal(await mergeReplayChangesProductImages({}, { applier: 'product.merge.group', snapshot_id: 7 }, 'undo'), true)
  db.prepare('INSERT INTO undo_snapshots(id,kind,payload_json) VALUES(8,?,?)').run('product.merge.group', JSON.stringify({ child_snapshot_ids: [5, 999] }))
  assert.equal(await mergeReplayChangesProductImages({}, { applier: 'product.merge.group', snapshot_id: 8 }, 'undo'), true, 'missing child fails closed')
  sharedDb = null
})

await check('the supplier.backfill applier is registered and gated on the products edit action', () => {
  assert.ok(registeredUndoAppliers().includes('supplier.backfill'), 'supplier.backfill must be a registered applier')
  const resolved = resolveUndoApplier({ applier: 'supplier.backfill', snapshot_id: 1 })
  assert.strictEqual(resolved?.permission, 'products')
  // Attributing a lot's supplier is a product edit, so the replay demands the
  // SAME granular products/edit action (full tier) the live route gates on.
  assert.strictEqual(resolved?.action, 'edit')
})

await check('sale.settlement is a real server applier and invokes the authoritative replay helper', async () => {
  assert.ok(registeredUndoAppliers().includes('sale.settlement'), 'sale.settlement must be a registered applier')
  const resolved = resolveUndoApplier({ applier: 'sale.settlement', operation_id: 'settlement-op-1' })
  assert.strictEqual(resolved?.permission, 'sales')
  assert.strictEqual(resolved?.action, 'status')
  settlementReplayCalls = 0
  await resolved.run(
    { applier: 'sale.settlement', operation_id: 'settlement-op-1' },
    { env: {}, user: { id: 7, name: 'Verifier' }, direction: 'undo', historyId: 41, generation: 0 },
  )
  assert.strictEqual(settlementReplayCalls, 1, 'the registered applier must execute the settlement replay helper exactly once')
})

await check('sale.add_items atomically advances revision, receipt, snapshot, history, allocations and audit', async () => {
  exerciseAtomicSaleItems = true
  try {
    const fixture = atomicSaleItemsFixture()
    sharedDb = fixture.db
    const resolved = resolveUndoApplier(fixture.payload)
    assert.ok(resolved)
    await resolved.run(fixture.payload, { env: {}, user: atomicUser, direction: 'undo', historyId: 41, generation: 0 })
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM sale_items').get().n, 0)
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM sale_item_batch_allocations').get().n, 0)
    assert.equal(fixture.db.prepare('SELECT status FROM action_history WHERE id=41').get().status, 'redoable')
    assert.equal(fixture.db.prepare('SELECT generation FROM sale_mutation_receipts').get().generation, 1)
    const reversedSnapshot = fixture.db.prepare('SELECT status,payload_json FROM undo_snapshots WHERE id=1').get()
    assert.equal(reversedSnapshot.status, 'reversed')
    const reversedRevision = JSON.parse(reversedSnapshot.payload_json).saleStateRevision
    assert.equal(reversedRevision, fixture.db.prepare('SELECT revision FROM sale_write_revisions WHERE sale_id=77').get().revision)
    assert.equal(reversedRevision, fixture.db.prepare('SELECT sale_revision FROM sale_mutation_receipts').get().sale_revision)

    const afterUndo = atomicSaleItemsState(fixture.db)
    await assert.rejects(
      () => resolved.run(fixture.payload, { env: {}, user: atomicUser, direction: 'undo', historyId: 41, generation: 0 }),
      error => error?.statusCode === 409,
    )
    assert.deepEqual(atomicSaleItemsState(fixture.db), afterUndo, 'an exact retry of the acknowledged generation cannot replay or write twice')

    const redoPayload = JSON.parse(fixture.db.prepare('SELECT redo_payload FROM action_history WHERE id=41').get().redo_payload)
    await resolved.run(redoPayload, { env: {}, user: atomicUser, direction: 'redo', historyId: 41, generation: 1 })
    const newLineId = fixture.db.prepare('SELECT id FROM sale_items').get().id
    assert.notEqual(newLineId, 10, 'redo must persist the newly inserted sale-item identity')
    assert.equal(fixture.db.prepare('SELECT sale_item_id FROM sale_item_batch_allocations').get().sale_item_id, newLineId)
    assert.equal(fixture.db.prepare("SELECT entity_id FROM sale_mutation_members WHERE entity_kind='sale_item'").get().entity_id, newLineId)
    const appliedSnapshot = fixture.db.prepare('SELECT status,payload_json FROM undo_snapshots WHERE id=1').get()
    assert.equal(appliedSnapshot.status, 'applied')
    assert.equal(JSON.parse(appliedSnapshot.payload_json).lines[0].saleItemId, newLineId)
    assert.equal(JSON.parse(appliedSnapshot.payload_json).saleStateRevision, fixture.db.prepare('SELECT revision FROM sale_write_revisions WHERE sale_id=77').get().revision)
    assert.equal(fixture.db.prepare('SELECT generation FROM sale_mutation_receipts').get().generation, 2)
    assert.equal(fixture.db.prepare('SELECT status FROM action_history WHERE id=41').get().status, 'undoable')
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n, 2)
  } finally {
    exerciseAtomicSaleItems = false
    sharedDb = null
  }
})

await check('sale.add_items rejects stale and boundary races without partial replay writes', async () => {
  exerciseAtomicSaleItems = true
  try {
    const stale = atomicSaleItemsFixture()
    sharedDb = stale.db
    const resolved = resolveUndoApplier(stale.payload)
    stale.db.prepare('UPDATE sales SET total_usd=16 WHERE id=77').run()
    const staleState = atomicSaleItemsState(stale.db)
    await assert.rejects(
      () => resolved.run(stale.payload, { env: {}, user: atomicUser, direction: 'undo', historyId: 41, generation: 0 }),
      error => error?.statusCode === 409,
    )
    assert.deepEqual(atomicSaleItemsState(stale.db), staleState, 'pre-existing stale revision changes nothing')

    const malformed = atomicSaleItemsFixture()
    sharedDb = malformed.db
    const malformedSnapshot = JSON.parse(malformed.db.prepare('SELECT payload_json FROM undo_snapshots WHERE id=1').get().payload_json)
    malformedSnapshot.saleStateRevision = '5'
    malformed.db.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=1').run(JSON.stringify(malformedSnapshot))
    const malformedState = atomicSaleItemsState(malformed.db)
    await assert.rejects(
      () => resolved.run(malformed.payload, { env: {}, user: atomicUser, direction: 'undo', historyId: 41, generation: 0 }),
      error => error?.statusCode === 409,
    )
    assert.deepEqual(atomicSaleItemsState(malformed.db), malformedState, 'operation-backed snapshots cannot fall back to legacy replay when their revision is malformed')

    const raced = atomicSaleItemsFixture()
    sharedDb = raced.db
    beforeAtomicBatch = sqlite => sqlite.prepare('UPDATE sales SET total_usd=17 WHERE id=77').run()
    await assert.rejects(
      () => resolved.run(raced.payload, { env: {}, user: atomicUser, direction: 'undo', historyId: 41, generation: 0 }),
      error => error?.statusCode === 409,
    )
    assert.equal(raced.db.prepare('SELECT total_usd FROM sales WHERE id=77').get().total_usd, 17, 'the adversarial concurrent write occurs')
    assert.equal(raced.db.prepare('SELECT COUNT(*) n FROM sale_items').get().n, 1, 'guard race cannot remove the line')
    assert.equal(raced.db.prepare('SELECT status FROM action_history WHERE id=41').get().status, 'undoable')
    assert.equal(raced.db.prepare('SELECT status FROM undo_snapshots WHERE id=1').get().status, 'applied')
    assert.equal(raced.db.prepare('SELECT generation FROM sale_mutation_receipts').get().generation, 0)
    assert.equal(raced.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n, 0)

    const boundary = atomicSaleItemsFixture()
    sharedDb = boundary.db
    await resolved.run(boundary.payload, { env: {}, user: atomicUser, direction: 'undo', historyId: 41, generation: 0 })
    const redoPayload = JSON.parse(boundary.db.prepare('SELECT redo_payload FROM action_history WHERE id=41').get().redo_payload)
    const beforeFailedRedo = atomicSaleItemsState(boundary.db)
    failAtomicAllocation = true
    await assert.rejects(
      () => resolved.run(redoPayload, { env: {}, user: atomicUser, direction: 'redo', historyId: 41, generation: 1 }),
      error => error?.statusCode === 409,
    )
    assert.deepEqual(atomicSaleItemsState(boundary.db), beforeFailedRedo, 'allocation failure rolls back line, member, money, revision, snapshot, history, receipt and audit')
  } finally {
    exerciseAtomicSaleItems = false
    failAtomicAllocation = false
    beforeAtomicBatch = null
    sharedDb = null
  }
})

await check('source lock: sale settlement history is server-managed and never takes the generic status-only path', () => {
  const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'actionHistory.ts'), 'utf8')
  assert.ok(/SALE_SETTLEMENT_ACTION_KIND/.test(routeSrc), 'action history must import the settlement kind')
  assert.ok(/SERVER_BULK_KINDS[^\n]*SALE_SETTLEMENT_ACTION_KIND/.test(routeSrc), 'settlement must be a server-managed history kind')
  assert.ok(/applier\.name === SALE_SETTLEMENT_ACTION_KIND[\s\S]*notifySaleSettlementAction/.test(routeSrc), 'successful settlement replay must notify through its helper')
  assert.ok(/SALE_SETTLEMENT_ACTION_KIND[\s\S]*sale_mutation_receipts/.test(routeSrc), 'settlement details must load its durable receipt table')
  assert.ok(/response_json/.test(routeSrc), 'settlement details must read the saved settlement response')
  const serverBranchAt = routeSrc.indexOf('if (serverManagedReplay && applier)')
  const genericFlipAt = routeSrc.indexOf('UPDATE action_history SET status = @status, last_error = NULL', serverBranchAt)
  assert.ok(serverBranchAt > -1 && genericFlipAt > serverBranchAt, 'server-managed settlement must return before the generic status-only flip')
})

await check('source lock: add-items replay restores optional exact KHR snapshots and preserves legacy snapshots', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'undoAppliers.ts'), 'utf8')
  assert.ok(/reversal\.lineMoneyBefore\s*\?\s*\[saleLineKhrSnapshotStatement\(saleId, reversal\.lineMoneyBefore\)\]\s*:\s*\[\]/.test(source), 'undo must restore the optional before-line snapshot')
  assert.ok(/reversal\.lineMoneyAfter\s*\?\s*\[saleLineKhrSnapshotStatement\(saleId, reversal\.lineMoneyAfter\)\]\s*:\s*\[\]/.test(source), 'redo must restore the optional after-line snapshot')
  assert.ok(/Number\(reversal\.moneyAfter\.exchange_rate \?\? reversal\.exchangeRate\) \|\| 4100/.test(source), 'redo must prefer the frozen after-snapshot rate and retain the legacy fallback')
  assert.ok(/saleStateRevision[\s\S]*replayAtomicSaleAddItems/.test(source), 'new snapshots must enter the revision-guarded atomic replay path')
  assert.ok(/buildOperationAllocationStatements\(plan\.lines, operationId, stamp\)/.test(source), 'redo allocations must be statements in the operation batch')
  assert.ok(/UPDATE undo_snapshots SET status=@status,payload_json=\$\{snapshotPayload\}/.test(source), 'snapshot status, line ids and post-direction revision must update in the replay batch')
  assert.ok(/UPDATE sale_mutation_receipts SET generation=@nextGeneration/.test(source), 'durable receipt generation must advance in the replay batch')
  const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'actionHistory.ts'), 'utf8')
  assert.ok(/SALE_ADD_ITEMS_ACTION_KIND[\s\S]*operation_id/.test(route), 'operation-backed add-items history must be server-managed')
  assert.ok(/if \(serverManagedReplay && applier\)/.test(route), 'operation-backed add-items must return before the generic history flip')
})

await check('source lock: the applier permission gate (full tier) guards BOTH record and operate, before any status flip or replay', () => {
  const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'actionHistory.ts'), 'utf8')
  // Record time: canRecordHistory must consult the applier registry, not
  // only the client-supplied entity/scope.
  assert.ok(/canUseNamedAppliers\(user, \[body\.undo_payload, body\.redo_payload\]\)/.test(routeSrc),
    'canRecordHistory must gate payloads naming a registered applier')
  assert.ok(/applierPermissionTier\(user, applier\) !== 'full'/.test(routeSrc),
    'non-stock appliers must demand the FULL tier of their declared permission')
  // Operate time: the gate must sit inside the transition handler BEFORE the
  // status-flip UPDATE (and therefore before applier.run, which follows it).
  const handlerStart = routeSrc.indexOf('completeServerHistoryTransition')
  const operateGateAt = routeSrc.indexOf("applierPermissionTier(user, applier) !== 'full'", handlerStart)
  const applierRunAt = routeSrc.indexOf('applier.run(payload', handlerStart)
  const statusFlipAt = routeSrc.indexOf('UPDATE action_history SET status = @status, last_error = NULL', handlerStart)
  assert.ok(operateGateAt > -1, 'the operate-time applier permission gate must exist in the transition handler')
  assert.ok(applierRunAt > -1 && statusFlipAt > -1, 'expected the applier run and the status-flip UPDATE')
  assert.ok(operateGateAt < applierRunAt, 'the permission gate must run before the applier replays')
  assert.ok(operateGateAt < statusFlipAt, 'the permission gate must run before the status flip')
})

await check('source lock: routes/actionHistory.ts stamps server_replayable and refuses require_applied BEFORE the status flip', () => {
  const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'actionHistory.ts'), 'utf8')
  assert.ok(/const replayable = isServerReplayable\(row, undoPayload, redoPayload\)/.test(routeSrc), 'mapRow must derive replayability from the shared helper')
  // ...ANDed with the requesting user's full tier on the applier-declared
  // permission, so the UI is never offered a button the operate gate refuses.
  assert.ok(/server_replayable: !!\(applier[\s\S]*canUseNamedAppliers\(user, \[undoPayload, redoPayload\]\)[\s\S]*replayChangesImages[\s\S]*getActionTier\(user, 'products', 'image'\) === 'full'/.test(routeSrc), 'mapRow must gate BOTH the merge action and saved image effects')
  const permissionHelper = routeSrc.slice(routeSrc.indexOf('function canUseNamedAppliers('), routeSrc.indexOf('function canRecordHistory('))
  assert.ok(/else if \(applier && applierPermissionTier\(user, applier\) !== 'full'\) return false/.test(permissionHelper), 'shared helper must retain the full-tier gate for every non-stock applier')
  assert.ok(/payload\.snapshot_version !== 2 \|\| !canReplayStockSessionPayload\(user, payload\)/.test(permissionHelper), 'stock list/replayability must use the authoritative payload permission union and reject old snapshot formats')
  assert.ok(/STOCK_SESSION_KIND, canReplayStockSessionPayload, notifyStockSession/.test(routeSrc), 'action history must import the stock permission helper')
  const operateHandler = routeSrc.slice(routeSrc.indexOf('completeServerHistoryTransition'))
  assert.ok(/await mergeReplayChangesProductImages\(c\.env, payload, direction\)/.test(operateHandler), 'merge replay must inspect saved image effects at operate time')
  assert.ok(/replayChangesProductImages && getActionTier\(user, 'products', 'image'\) !== 'full'/.test(operateHandler), 'saved image effects must require current full image authority')
  assert.ok(/applier\.name === STOCK_SESSION_KIND[\s\S]*!canReplayStockSessionPayload\(user, payload\)[\s\S]*applierPermissionTier\(user, applier\) !== 'full'/.test(operateHandler), 'stock operate-time permission must use the authoritative union while other appliers keep their static full-tier gate')
  // The require_applied refusal must come BEFORE the status-flip UPDATE inside
  // the transition handler -- refusing after the flip would record a reversal
  // that never happened.
  const handlerStart = routeSrc.indexOf('completeServerHistoryTransition')
  const refusalAt = routeSrc.indexOf('requireApplied && !applier', handlerStart)
  const statusFlipAt = routeSrc.indexOf('UPDATE action_history SET status = @status, last_error = NULL', handlerStart)
  assert.ok(refusalAt > -1, 'the require_applied refusal must exist in the transition handler')
  assert.ok(statusFlipAt > -1, 'expected the transition status-flip UPDATE')
  assert.ok(refusalAt < statusFlipAt, 'the require_applied refusal must run before the status flip')
})

}

main().then(() => {
  console.log(`\n${passed} check(s) passed.`)
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
