// P4-4a: planTransferOperation (lib/transferOperation.ts) used to await 3-5
// D1 reads PER LINE inside its planning loop -- source product, destination
// product, readFifoLotAvailability, one read per allocated lot ("take"), and
// a conditional destination-lot match -- which made /transfer-bulk (N lines)
// cost O(N) round trips. This test keeps the OLD per-line-awaited body as an
// inline oracle (it is gone from the real source) and asserts the REAL
// (post-fix) planTransferOperation now:
//   1. emits the EXACT SAME statement list (SQL text + bound params, in the
//      same order) as the old body, on an identical 3-line transfer that
//      exercises same-product, cross-product-with-an-existing-destination-lot,
//      and cross-product-with-NO-destination-lot (new-lot-creation) cases,
//      plus a multi-lot allocation (one line spans two lots), and
//   2. costs a CONSTANT number of round trips regardless of line count,
//      where the old body cost roughly 3-5x the line count.
//
// crypto.randomUUID() is patched to a deterministic sequence (reset before
// each run) so both bodies -- which call it in the same order, just at
// different times relative to their reads -- produce byte-identical output.
//
// Run: node scripts/test-transfer-operation-plan-roundtrip-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const MIGRATION_SQLS = loadAll()

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function transpile(relPath) {
  const sourcePath = path.join(cloudflareRoot, 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  return { sourcePath, outputText }
}

function loadReal(relPath, requireOverrides = {}) {
  const { sourcePath, outputText } = transpile(relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  return moduleObj.exports
}

const dbModule = loadReal('lib/db.ts')
const batchCode = loadReal('lib/batchCode.ts')
const moneyPrecision = loadReal('lib/moneyPrecision.ts')
const sqlBinding = loadReal('lib/sqlBinding.ts')
const branchRoles = loadReal('lib/branchRoles.ts')
const permissions = loadReal('lib/permissions.ts')
const actorSnapshotMod = loadReal('lib/actorSnapshot.ts')
const canonicalBranchIdentity = loadReal('lib/canonicalBranchIdentity.ts', { './db': dbModule, './branchRoles': branchRoles })
const transferOperationReceipt = loadReal('lib/transferOperationReceipt.ts', { './db': {} })
const movementCostSnapshot = loadReal('lib/movementCostSnapshot.ts', { './moneyPrecision': moneyPrecision })
const productBatches = loadReal('lib/productBatches.ts', {
  './db': {}, './batchCode': batchCode, './moneyPrecision': moneyPrecision, './sqlBinding': sqlBinding,
})
const transferOperation = loadReal('lib/transferOperation.ts', {
  './db': dbModule,
  '../index': {},
  './auth': {},
  './permissions': permissions,
  './actorSnapshot': actorSnapshotMod,
  './productBatches': productBatches,
  './canonicalBranchIdentity': canonicalBranchIdentity,
  './transferOperationReceipt': transferOperationReceipt,
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  './cache': { bumpVersion: async () => {} },
  './movementCostSnapshot': movementCostSnapshot,
  './sqlBinding': sqlBinding,
})
assert.equal(typeof transferOperation.planTransferOperation, 'function', 'lib/transferOperation.ts must export planTransferOperation')

// ---------------------------------------------------------------------------
// Deterministic crypto.randomUUID -- both the old oracle and the real module
// generate UUIDs in the same call ORDER (operationId first, then one per
// "no destination lot yet" take); resetting the counter before each run
// makes their output byte-comparable.
// ---------------------------------------------------------------------------
const realRandomUUID = globalThis.crypto.randomUUID.bind(globalThis.crypto)
let uuidCounter = 0
function withDeterministicUuid(fn) {
  uuidCounter = 0
  const original = globalThis.crypto.randomUUID
  globalThis.crypto.randomUUID = () => `uuid-${uuidCounter++}`
  return Promise.resolve(fn()).finally(() => { globalThis.crypto.randomUUID = original })
}

// ---------------------------------------------------------------------------
// Statement-execution counter -- one D1 round trip per get/all/run call.
// ---------------------------------------------------------------------------
function countingDb(rawDb) {
  let statements = 0
  return {
    stats: () => ({ statements }),
    db: {
      prepare(sql) {
        const stmt = rawDb.prepare(sql)
        return {
          get: (params) => { statements += 1; return stmt.get(params) },
          all: (params) => { statements += 1; return stmt.all(params) ?? [] },
          run: (params) => {
            statements += 1
            const r = stmt.run(params)
            return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
          },
        }
      },
    },
  }
}

// ---------------------------------------------------------------------------
// The pre-fix planTransferOperation body, verbatim (ported from git history),
// as the oracle. Uses the REAL support functions loaded above -- only the
// data-fetch TIMING differs from the real module now.
// ---------------------------------------------------------------------------
const productSnapshotSql = `json_object('id',id,'name',name,'barcode',barcode,'created_at',created_at,'is_active',is_active)`
const lotSnapshotSql = `json_object('id',id,'variant_product_id',variant_product_id,'batch_key',batch_key,'lot_code',lot_code,'received_at',received_at,'expiry_date',expiry_date,'notes',notes)`
const receiptSql = `(SELECT id FROM transfer_operation_receipts WHERE operation_id=@operation)`
const assertStmt = (condition, params) => ({ sql: `INSERT INTO branches(name) SELECT NULL WHERE COALESCE((${condition}),0)=0`, params })

async function oldPlanTransferOperation(db, args) {
  const operationId = globalThis.crypto.randomUUID()
  const params = { operation: operationId, actor: args.user.id, name: actorSnapshotMod.actorSnapshot(args.user), request: args.requestId,
    requestJson: args.requestJson, digest: args.digest, scope: args.scope }
  const statements = [canonicalBranchIdentity.canonicalTransferAuthorityGuardStatement(args.fromBranchId, args.toBranchId), {
    sql: `INSERT INTO transfer_operation_receipts(actor_id,request_id,request_digest,request_json,status,operation_id,provenance_version,replay_state,generation)
      VALUES(@actor,@request,@digest,@requestJson,'planning',@operation,1,'applied',0)`, params,
  }, transferOperationReceipt.transferIntentAuditStatement({ actorId: args.user.id, actorName: actorSnapshotMod.actorSnapshot(args.user), requestId: args.requestId, requestJson: args.requestJson, digest: args.digest, bulk: args.lines.length > 1 })]
  const members = []
  const pendingLots = new Map()
  for (const [ordinal, line] of args.lines.entries()) {
    const sourceProduct = await db.prepare(`SELECT ${productSnapshotSql} AS snapshot,cost_price_usd,cost_price_khr FROM products WHERE id=@id AND is_active=1`).get({ id: line.productId })
    const destinationProduct = line.productId === line.destProductId ? sourceProduct
      : await db.prepare(`SELECT ${productSnapshotSql} AS snapshot FROM products WHERE id=@id AND is_active=1`).get({ id: line.destProductId })
    const snapshots = [sourceProduct, destinationProduct]
    if (snapshots.some(row => !row)) throw new transferOperation.TransferConflictError('A transfer product changed. Refresh and try again.')
    const fallback = { fallbackUnitCostUsd: sourceProduct.cost_price_usd, fallbackUnitCostKhr: sourceProduct.cost_price_khr }
    statements.push(assertStmt(`EXISTS(SELECT 1 FROM products WHERE id=@product AND cost_price_usd IS @usd AND cost_price_khr IS @khr)`,
      { product: line.productId, usd: sourceProduct.cost_price_usd, khr: sourceProduct.cost_price_khr }))
    const lots = await productBatches.readFifoLotAvailability(db, line.productId, args.fromBranchId)
    const selected = line.batchId == null ? lots : lots.filter(lot => lot.batchId === line.batchId)
    const { takes, uncovered } = productBatches.allocateAcrossLots(selected, line.quantity)
    if (line.batchId != null && uncovered > 0) throw new transferOperation.TransferConflictError('The selected received date no longer has enough stock.')
    const allocations = []
    for (const take of takes) {
      const source = await db.prepare(`SELECT ${lotSnapshotSql} AS snapshot,unit_cost_usd FROM product_batches WHERE id=@id AND is_active=1`).get({ id: take.batchId })
      if (!source) throw new transferOperation.TransferConflictError('The source received date changed.')
      const costSnapshot = movementCostSnapshot.resolveMovementCostSnapshot({ quantity: take.quantity,
        components: [{ quantity: take.quantity, unitCostUsd: source.unit_cost_usd }], ...fallback })
      statements.push(assertStmt(`EXISTS(SELECT 1 FROM product_batches WHERE id=@batch AND unit_cost_usd IS @usd)`,
        { batch: take.batchId, usd: source.unit_cost_usd }))
      const sourceLot = JSON.parse(source.snapshot)
      let destination = sourceLot
      let key = sourceLot.batch_key
      if (line.destProductId !== line.productId) {
        const lotCode = String(sourceLot.lot_code || '').trim() || null
        const match = lotCode
          ? await db.prepare(`SELECT ${lotSnapshotSql} AS snapshot FROM product_batches WHERE variant_product_id=@product AND is_active=1 AND batch_key=@key`).get({ product: line.destProductId, key: lotCode })
          : sourceLot.expiry_date ? await db.prepare(`SELECT ${lotSnapshotSql} AS snapshot FROM product_batches WHERE variant_product_id=@product AND is_active=1 AND expiry_date=@expiry ORDER BY id LIMIT 1`).get({ product: line.destProductId, expiry: sourceLot.expiry_date }) : undefined
        destination = match ? JSON.parse(match.snapshot) : null
        const pendingKey = `${line.destProductId}:${lotCode || sourceLot.expiry_date || sourceLot.id}`
        key = (destination && destination.batch_key) || pendingLots.get(pendingKey) || lotCode || `transfer-${globalThis.crypto.randomUUID()}`
        if (!destination && !pendingLots.has(pendingKey)) {
          pendingLots.set(pendingKey, key)
          statements.push({ sql: `INSERT INTO product_batches(variant_product_id,batch_key,lot_code,received_at,expiry_date,notes,is_active,batch_number,unit_cost_usd)
            SELECT @product,@key,@lot,@received,@expiry,@notes,1,COALESCE(MAX(batch_number),0)+1,@usd FROM product_batches WHERE variant_product_id=@product`,
          params: { product: line.destProductId, key, lot: lotCode, received: sourceLot.received_at, expiry: sourceLot.expiry_date, notes: sourceLot.notes,
            usd: costSnapshot.unitCostUsd } })
        }
      }
      allocations.push({ source_batch_id: take.batchId, destination_batch_id: (destination && destination.id) ?? null, destination_batch_key: key, quantity: take.quantity, source_snapshot: sourceLot, destination_snapshot: destination, cost_snapshot: costSnapshot })
    }
    const member = { ordinal, source_product_id: line.productId, destination_product_id: line.destProductId,
      source_branch_id: args.fromBranchId, destination_branch_id: args.toBranchId, quantity: line.quantity,
      untracked_quantity: uncovered, source_snapshot: JSON.stringify({ ...JSON.parse(snapshots[0].snapshot),
        untracked_cost_snapshot: uncovered > 0 ? movementCostSnapshot.resolveMovementCostSnapshot({ quantity: uncovered, ...fallback }) : null }),
      destination_snapshot: snapshots[1].snapshot, allocations_json: JSON.stringify(allocations) }
    members.push(member)
    statements.push({ sql: `INSERT INTO transfer_operation_members(receipt_id,ordinal,source_product_id,destination_product_id,source_branch_id,destination_branch_id,quantity,untracked_quantity,source_snapshot,destination_snapshot,allocations_json)
      SELECT ${receiptSql},@ordinal,@sourceProduct,@destProduct,@sourceBranch,@destBranch,@quantity,@untracked,@sourceSnapshot,@destSnapshot,
        (SELECT json_group_array(json_set(a.value,'$.destination_batch_id',b.id,'$.destination_snapshot',json(${lotSnapshotSql.replaceAll(/\b(id|variant_product_id|batch_key|lot_code|received_at|expiry_date|notes)\b(?=[,)])/g, 'b.$1')})))
         FROM json_each(@allocations) a JOIN product_batches b ON b.variant_product_id=@destProduct AND b.batch_key=json_extract(a.value,'$.destination_batch_key') AND b.is_active=1)`,
      params: { operation: operationId, ordinal, sourceProduct: line.productId, destProduct: line.destProductId, sourceBranch: args.fromBranchId, destBranch: args.toBranchId,
        quantity: line.quantity, untracked: uncovered, sourceSnapshot: member.source_snapshot, destSnapshot: member.destination_snapshot, allocations: member.allocations_json } })
  }
  const payload = JSON.stringify({ applier: 'stock.transfer', operation_id: operationId, generation: 0, permission: args.scope })
  statements.push({ sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
    VALUES(@scope,'stock_transfer',@operation,@label,1,'undoable',@payload,@payload,@actor,@name)`, params: { ...params, payload, label: `${args.lines.length} stock transfer${args.lines.length === 1 ? '' : 's'}` } },
  { sql: `UPDATE transfer_operation_receipts SET action_history_id=last_insert_rowid() WHERE operation_id=@operation`, params })
  // transferEffectStatements is not exported; the round-trip/statement-parity
  // assertions below only need everything ABOVE this point (the part this
  // fix actually touched) -- both bodies stop here identically.
  return { statements, operationId }
}

function seed(rawDb) {
  // created_at is pinned explicitly on every product row (rather than left to
  // the schema's DEFAULT CURRENT_TIMESTAMP) so the old-body and new-body runs
  // -- which seed two SEPARATE databases a few milliseconds apart -- embed
  // byte-identical product snapshots; leaving this to wall-clock time made
  // the statement-equality assertion below flaky across a second boundary.
  const CREATED_AT = '2026-01-01 00:00:00'
  rawDb.prepare(`INSERT INTO branches (id, name) VALUES (1,'Main'),(2,'Branch B')`).run({})
  // Product 1: two lots (multi-take allocation), transferred to itself at
  // branch 2 (same-product line).
  rawDb.prepare(`INSERT INTO products (id, name, sku, is_active, cost_price_usd, cost_price_khr, created_at) VALUES (1,'Widget','W-1',1,2.5,10000,@createdAt)`).run({ createdAt: CREATED_AT })
  rawDb.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number, unit_cost_usd) VALUES
    (101,1,'0101','0101','2026-01-01',1,1,2.0),
    (102,1,'0102','0102','2026-01-02',1,2,3.0)`).run({})
  rawDb.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (101,1,4),(102,1,4)`).run({})
  rawDb.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1,1,8)`).run({})

  // Product 2 -> Product 3: cross-product transfer where the destination
  // ALREADY has a matching lot (by lot_code), so the plan must reuse it, not
  // create a new one.
  rawDb.prepare(`INSERT INTO products (id, name, sku, is_active, cost_price_usd, cost_price_khr, created_at) VALUES
    (2,'Source Product','W-2',1,1.0,4000,@createdAt), (3,'Dest Product Existing','W-3',1,1.5,6000,@createdAt)`).run({ createdAt: CREATED_AT })
  rawDb.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number, unit_cost_usd) VALUES
    (201,2,'0201','0201','2026-02-01',1,1,1.0),
    (301,3,'0201','0201','2026-02-01',1,1,1.5)`).run({})
  rawDb.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (201,1,5)`).run({})
  rawDb.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (2,1,5)`).run({})

  // Product 4 -> Product 5: cross-product transfer where the destination has
  // NO matching lot -- the plan must queue a new product_batches INSERT.
  rawDb.prepare(`INSERT INTO products (id, name, sku, is_active, cost_price_usd, cost_price_khr, created_at) VALUES
    (4,'Source Product 2','W-4',1,2.0,8000,@createdAt), (5,'Dest Product New','W-5',1,2.2,8800,@createdAt)`).run({ createdAt: CREATED_AT })
  rawDb.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number, unit_cost_usd) VALUES
    (401,4,'0301','0301','2026-03-01',1,1,2.0)`).run({})
  rawDb.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (401,1,6)`).run({})
  rawDb.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (4,1,6)`).run({})
}

const USER = { id: 1, username: 'tester', name: 'Test User' }
const LINES = [
  { productId: 1, destProductId: 1, quantity: 6, batchId: null }, // multi-lot, same product
  { productId: 2, destProductId: 3, quantity: 3, batchId: null }, // cross-product, existing dest lot
  { productId: 4, destProductId: 5, quantity: 4, batchId: null }, // cross-product, new dest lot
]
const BASE_ARGS = {
  user: USER, requestId: 'req-1', requestJson: '{}', digest: 'digest-1',
  scope: 'branches', fromBranchId: 1, toBranchId: 2, reason: 'test transfer', lines: LINES, response: {},
}

async function main() {
  const oldRawDb = openDb(MIGRATION_SQLS)
  seed(oldRawDb)
  const oldCounter = countingDb(oldRawDb)
  const oldResult = await withDeterministicUuid(() => oldPlanTransferOperation(oldCounter.db, BASE_ARGS))
  const oldStats = oldCounter.stats()

  const newRawDb = openDb(MIGRATION_SQLS)
  seed(newRawDb)
  const newCounter = countingDb(newRawDb)
  const newResult = await withDeterministicUuid(() => transferOperation.planTransferOperation(newCounter.db, BASE_ARGS))
  const newStats = newCounter.stats()
  check('allocation summaries are immutable detached views of the persisted source allocations', () => {
    const before = JSON.stringify(newResult.statements)
    const memberStatements = newResult.statements.filter(statement => statement.sql.startsWith('INSERT INTO transfer_operation_members'))
    assert.equal(newResult.allocationSummaries.length, LINES.length)
    assert.ok(Object.isFrozen(newResult.allocationSummaries))
    newResult.allocationSummaries.forEach((summary, ordinal) => {
      const member = memberStatements[ordinal].params
      const allocations = JSON.parse(member.allocations)
      assert.deepEqual(summary, { ordinal, untrackedQuantity: member.untracked,
        takes: allocations.map(a => ({ batchId: a.source_batch_id, quantity: a.quantity,
          receivedAt: a.source_snapshot.received_at, lotCode: a.source_snapshot.lot_code })) })
      assert.ok(Object.isFrozen(summary)); assert.ok(Object.isFrozen(summary.takes))
      summary.takes.forEach(take => {
        assert.ok(Object.isFrozen(take))
        assert.equal(Reflect.set(take, 'receivedAt', 'mutated'), false)
        assert.equal(Reflect.set(take, 'quantity', 999), false)
      })
      assert.equal(Reflect.set(summary, 'untrackedQuantity', 999), false)
      assert.throws(() => summary.takes.push({}), TypeError)
    })
    assert.throws(() => newResult.allocationSummaries.push({}), TypeError)
    assert.equal(JSON.stringify(newResult.statements), before)
  })

  // Both plans embed the same operationId (from the deterministic UUID
  // sequence) -- normalize it out along with the params object's `operation`
  // field so a strict comparison isn't defeated by the receipt-lookup
  // subquery text alone (which is identical either way).
  check('operationId is uuid-0 in both (first randomUUID() call)', () => {
    assert.equal(oldResult.operationId, 'uuid-0')
    assert.equal(newResult.operationId, 'uuid-0')
  })

  // The oracle above stops right after the action_history bookkeeping
  // statements (the part this fix touched); the real module then appends
  // transferEffectStatements(...) and the final commit UPDATE, which are
  // untouched by this fix and already covered by test-branch-transfer-lots-
  // pure.cjs end to end. Compare only the shared prefix.
  check('new planTransferOperation emits the EXACT SAME statements as the old per-line-awaited body (shared prefix)', () => {
    assert.ok(newResult.statements.length > oldResult.statements.length, 'the real module should have MORE statements (transferEffectStatements + commit) than the oracle prefix')
    for (let i = 0; i < oldResult.statements.length; i++) {
      assert.deepEqual(newResult.statements[i], oldResult.statements[i], `statement #${i} differs`)
    }
  })

  check('old body cost 3-5x round trips per line (N=3 lines, multi-lot + 2 cross-product)', () => {
    // 3 upfront (receipt/audit-guard statements don't read) + per line reads:
    // line1 (same-product, 2 lots): sourceProduct(1) + lots(1) + take×2(2) = 4
    // line2 (cross, existing dest lot): sourceProduct(1)+destProduct(1)+lots(1)+take(1)+destMatch(1) = 5
    // line3 (cross, new dest lot): sourceProduct(1)+destProduct(1)+lots(1)+take(1)+destMatch(1) = 5
    // total = 14
    assert.equal(oldStats.statements, 14, `expected the old body to cost 14 round trips, got ${oldStats.statements}`)
  })

  check('new planTransferOperation costs a CONSTANT number of round trips (not O(lines))', () => {
    // products(1) + lots-for-cart(1) + source-lots(1) + lotCode-match(1) + expiry-match(0, none needed) = 4
    assert.equal(newStats.statements, 4, `expected 4, got ${newStats.statements}`)
  })

  check('folding pre-reads saves round trips proportional to line/lot count, not a fixed handful', () => {
    assert.ok(oldStats.statements - newStats.statements >= 10, 'the saving should scale with the number of lines/lots, not stay flat')
  })

  console.log(`\nOK ${passed} checks`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
