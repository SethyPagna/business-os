// CUTOVER-LC item 4: returns of a sale made at a branch that has since been
// retired (Shop -> "Old Shop", successor "LC Store").
//
// Same harness as test-returns-batch-restock-pure.cjs (the REAL routes/returns.ts
// and its kernels against an in-memory SQLite with every migration applied),
// plus an ORACLE: the route exactly as it was before this lane (git 93057c781),
// run against the same fixtures. The oracle proves two things -- while both
// branches are active the new route writes byte-identical statements (inert), and
// on the post-consolidation fixture the old route strands the units in the
// retired branch (so the fixture discriminates the fix from the defect).
//
// Run (from cloudflare/): node scripts/test-returns-successor-restock-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const rawDb = openDb(loadAll())
function deactivatePre0154LegacyLot(batchId) {
  const deactivate = () => rawDb.prepare('UPDATE product_batches SET is_active=0 WHERE id=?').run([batchId])
  assert.throws(deactivate, /Cannot deactivate a received lot/, 'current schema rejects positive-lot deactivation')
  // Legacy-corruption fixture only: preserve route refusal/race coverage even
  // though 0154 now prevents another writer from creating this state.
  const guard = rawDb.prepare("SELECT sql FROM sqlite_master WHERE name='positive_lot_reject_inactive_update_0154'").get().sql
  rawDb.exec('DROP TRIGGER positive_lot_reject_inactive_update_0154')
  try { deactivate() } finally { rawDb.exec(guard) }
}
let captured = null
let beforeBatchHook = null
let beforeOrdinaryWrite = null
let corruptNextReturnReceipt = false
let corruptNextReturnCreateReceipt = false
let corruptNextSaleRecordEvent = false
let failReturnCreatePostcommitRead = false
let failNextReturnCreateReceiptRead = false
let beforeLineageCoherenceHook = null
// Flatten node:sqlite's run() result the same way lib/db.ts's real
// D1Compat.run() does (see test-pending-actions-pure.cjs's own comment for
// why this matters) -- productBatches.ts and returns.ts both rely on
// `result.lastInsertRowid`/`result.changes` at the top level, not nested
// under `.meta`.
const db = {
  prepare(sql) {
    const stmt = rawDb.prepare(sql)
    return {
      get: (params) => {
        if (failNextReturnCreateReceiptRead && /FROM return_create_receipts/i.test(sql)) {
          failNextReturnCreateReceiptRead = false
          throw new Error('simulated postcommit receipt read failure')
        }
        if (beforeLineageCoherenceHook && /^SELECT CASE WHEN[\s\S]*undo_snapshots/i.test(sql.trim())) {
          const hook = beforeLineageCoherenceHook
          beforeLineageCoherenceHook = null
          hook()
        }
        return stmt.get(params)
      },
      all: (params) => stmt.all(params) ?? [],
      run: (params) => {
        const r = stmt.run(params)
        return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
      },
    }
  },
  async batch(items) {
    if (captured) captured.push(items.map((item) => ({ sql: item.sql, params: item.params })))
    if (beforeOrdinaryWrite && items.some((item) => item.sql.includes('ordinary_business_maintenance_guard'))) {
      const hook = beforeOrdinaryWrite
      beforeOrdinaryWrite = null
      await hook()
    }
    if (beforeBatchHook && items.some((item) => /INSERT INTO return_(?:mutation|create)_receipts/i.test(item.sql)
      || (/INSERT INTO returns/i.test(item.sql) && /supplier_return/.test(item.sql)))) {
      const hook = beforeBatchHook
      beforeBatchHook = null
      await hook()
    }
    if (corruptNextSaleRecordEvent) {
      const event = items.find((item) => /INSERT INTO sale_record_events/i.test(item.sql))
      if (event) {
        corruptNextSaleRecordEvent = false
        event.params.events = JSON.stringify([{ ...JSON.parse(event.params.events)[0], changes_json: '[]' }])
      }
    }
    if (corruptNextReturnReceipt) {
      const receipt = items.find((item) => /INSERT INTO return_mutation_receipts/i.test(item.sql))
      if (receipt) {
        corruptNextReturnReceipt = false
        receipt.params.responseJson = '{"id":"invalid","updated_at":1}'
      }
    }
    if (corruptNextReturnCreateReceipt) {
      const receipt = items.find((item) => /INSERT INTO return_create_receipts/i.test(item.sql))
      if (receipt) {
        corruptNextReturnCreateReceipt = false
        receipt.params.requestDigest = 'G'.repeat(64)
      }
    }
    const results = await rawDb.batch(items)
    if (failReturnCreatePostcommitRead && items.some((item) => /INSERT INTO return_create_receipts/i.test(item.sql))) {
      failReturnCreatePostcommitRead = false
      failNextReturnCreateReceiptRead = true
    }
    return results.map((r) => ({ changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }))
  },
  async transaction(fn) { return fn(this) },
}
const fakeEnv = { DB: db }

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  return { sourcePath, outputText }
}

function loadReal(relPath, requireOverrides = {}, sourceText = null) {
  const { sourcePath, outputText } = sourceText === null ? transpile(relPath) : {
    sourcePath: path.join(__dirname, '..', 'src', relPath),
    outputText: ts.transpileModule(sourceText, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: relPath }).outputText,
  }
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
  )
  Module._load = originalLoad
  return moduleObj.exports
}

// batchCode.ts is pure (no D1/Env dependency) -- productBatches.ts's
// receiveBatchStock now derives lot_code/batch_key through it, so it needs
// to be the real transpiled module here too, not left to fall through to
// node's own require() (which can't resolve a bare .ts file).
const batchCode = loadReal('lib/batchCode.ts')

// Real, pure -- no stubbing needed.
const productBatches = loadReal('lib/productBatches.ts', { './receivingBranch': loadReal('lib/receivingBranch.ts'), './db': { getDb: () => db }, './batchCode': batchCode, './sqlBinding': loadReal('lib/sqlBinding.ts'), './moneyPrecision': loadReal('lib/moneyPrecision.ts') })
const permissions = loadReal('lib/permissions.ts')
const acquisitionCostAccess = loadReal('lib/acquisitionCostAccess.ts', { './permissions': permissions })
// P4-3: real, pure -- used by the new damaged-return-disposition tests below
// to confirm a "remove entirely" write_off is actually counted as a loss
// through the SAME kernel the stats surfaces use, not a parallel check.
const removalLosses = loadReal('lib/removalLosses.ts')

const FAKE_USER = { id: 1, username: 'tester', name: 'Test User', permissions: JSON.stringify({ returns: true, product_cost_edit: true, product_cost_view: true }) }
// Swapped for one request at a time by reqAs() so a permission-shaped probe
// runs through the REAL lib/permissions tier resolution, not a stub of it.
let activeUser = FAKE_USER
let auditCalls = []

// N13: the shared actor / branch kernels these routes now import.
const actorSnapshotKernel = loadReal('lib/actorSnapshot.ts')
const branchRolesKernel = loadReal('lib/branchRoles.ts')
const anonymousCustomerKernel = loadReal('lib/anonymousCustomer.ts')
const moneyPrecisionKernel = loadReal('lib/moneyPrecision.ts')
const promotionRulesKernel = loadReal('lib/promotionRules.ts', { './moneyPrecision': moneyPrecisionKernel })
const saleItemPricingKernel = loadReal('lib/saleItemPricing.ts', {
  './moneyPrecision': moneyPrecisionKernel, './promotionRules': promotionRulesKernel,
})
const productMergeLineageKernel = loadReal('lib/productMergeLineage.ts')
const saleMoneyPrecisionKernel = loadReal('lib/saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecisionKernel })
const saleCreationSnapshotKernel = loadReal('lib/saleCreationSnapshot.ts', {
  './actorSnapshot': actorSnapshotKernel, './saleMoneyPrecision': saleMoneyPrecisionKernel,
})
const refundMoneyPrecisionKernel = loadReal('lib/refundMoneyPrecision.ts', {
  './moneyPrecision': moneyPrecisionKernel, './saleMoneyPrecision': saleMoneyPrecisionKernel,
})
const customerReturnEntitlementKernel = loadReal('lib/customerReturnEntitlement.ts', {
  './moneyPrecision': moneyPrecisionKernel, './refundMoneyPrecision': refundMoneyPrecisionKernel,
  './saleItemPricing': saleItemPricingKernel, './saleMoneyPrecision': saleMoneyPrecisionKernel,
})
const saleRecordsContract = {
  SALE_RECORD_KINDS: ['sale_created', 'status_changed', 'item_added', 'item_removed', 'item_quantity_changed', 'items_replaced', 'driver_changed', 'delivery_fee_changed', 'delivery_cost_changed', 'delivery_added', 'customer_changed', 'membership_changed', 'payment_changed', 'payment_settled', 'cancelled', 'legacy_sale_change'],
  SALE_RECORD_FIELDS: ['receipt_number', 'sale_status', 'items', 'total_usd', 'payment', 'delivery', 'customer', 'membership', 'item', 'quantity', 'removed_items', 'added_items', 'delivery_fee_usd', 'actual_delivery_cost_usd', 'is_delivery', 'driver', 'payment_method', 'payment_details', 'amount_paid_usd', 'amount_paid_khr', 'change_usd', 'change_khr', 'cancel_reason', 'cancel_note'],
}
const saleRecordEventsKernel = loadReal('lib/saleRecordEvents.ts', { './saleRecords': saleRecordsContract })
const returnCreateActionKernel = loadReal('lib/returnCreateAction.ts', {
  './saleRecordEvents': saleRecordEventsKernel, './moneyPrecision': moneyPrecisionKernel,
  './customerReturnEntitlement': customerReturnEntitlementKernel,
})
const saleBulkStatusKernel = {
  bulkAssertion: (predicate, params = {}) => ({ sql: `INSERT INTO sale_bulk_guards(guard_value) SELECT CASE WHEN (${predicate}) THEN 1 ELSE 0 END`, params }),
  saleRevisionGuard: (id, revision) => ({
    sql: `INSERT INTO sale_bulk_guards(guard_value) SELECT CASE WHEN (
      NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance')
      AND EXISTS(SELECT 1 FROM sales WHERE id=@id)
      AND COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=@id),0)=@revision
    ) THEN 1 ELSE 0 END`,
    params: { id, revision },
  }),
}
const returnsRouteOverrides = {
  '../lib/acquisitionCostAccess': acquisitionCostAccess,
  '../lib/returnCostAccess': loadReal('lib/returnCostAccess.ts'),
  '../lib/branchRoleGuards': loadReal('lib/branchRoleGuards.ts', { './branchRoles': branchRolesKernel }),
  '../lib/branchRoles': branchRolesKernel,
  '../lib/branchEffect': loadReal('lib/branchEffect.ts', { './branchRoles': branchRolesKernel, './sqlBinding': loadReal('lib/sqlBinding.ts') }),
  '../lib/actorSnapshot': actorSnapshotKernel,
  '../lib/saleCreationSnapshot': saleCreationSnapshotKernel,
  // N21: the display-address kernel, REAL. A stub resolves every address to
  // undefined and would make the assertion below agree with itself.
  '../lib/contactOptions': loadReal('lib/contactOptions.ts'),
  '../lib/anonymousCustomer': anonymousCustomerKernel,
  '../lib/db': { getDb: () => db },
  '../lib/businessMaintenanceGuard': loadReal('lib/businessMaintenanceGuard.ts'),
  // routes/returns.ts buckets return dates in UTC+7 through the pure
  // businessDateWindow helpers; provide the real module so its date SQL resolves.
  '../lib/businessDateWindow': loadReal('lib/businessDateWindow.ts'),
  // Real, pure -- its chunking is what keeps these reads inside D1's
  // 100-bound-parameter limit, so a stub would test the stub.
  '../lib/sqlBinding': loadReal('lib/sqlBinding.ts'),
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', activeUser); return next() } },
  '../lib/audit': { changedFields: () => null, auditChangeColumns: () => ({ old_value: null, new_value: null }), isSecretShapedAuditKey: () => false, audit: async (...args) => { auditCalls.push(args) } },
  '../lib/telegram': { sendReturnTelegramEvent: async () => false, sendTelegramEvent: async () => false, formatSaleTelegramLines: () => [], formatSaleStatusTelegramLines: () => [] },
  '../lib/permissions': permissions,
  '../lib/conflictControl': loadReal('lib/conflictControl.ts'),
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {}, bumpVersions: async () => {} },
  '../lib/returnBulkAction': { applyReturnBulkAction: async () => ({}), applyReturnBulkActionOutcome: async () => ({ receipt: {}, wrote: false }), notifyReturnBulkAction: async () => {}, ReturnBulkError: class ReturnBulkError extends Error {} },
  '../lib/saleBulkStatus': saleBulkStatusKernel,
  '../lib/saleRecordEvents': saleRecordEventsKernel,
  '../lib/returnCreateAction': returnCreateActionKernel,
  // The records reader (GET /:id/records); this file exercises the write paths.
  '../lib/returnRecords': { loadReturnRecords: async () => null },
  '../lib/customerReturnEntitlement': customerReturnEntitlementKernel,
  '../lib/productMergeLineage': productMergeLineageKernel,
  '../lib/saleMoneyPrecision': saleMoneyPrecisionKernel,
  '../lib/searchMatch': { buildLikeAliasClause: () => '1=1', tokenizeSearchTermGroups: () => [], normalizeSearchText: (value) => String(value || '') },
  '../lib/productBatches': productBatches,
  // K2 (Part 410): real, pure -- the three-way stock_action + Replace
  // kernel the route now imports (test-returns-replace-damaged-pure.cjs
  // covers it in isolation; here it runs under the real route).
  '../lib/returnsStock': loadReal('lib/returnsStock.ts', { './db': { getDb: () => db }, './productBatches': productBatches, './sqlBinding': loadReal('lib/sqlBinding.ts'), './stockCondition': loadReal('lib/stockCondition.ts') }),
  // P4-3: routes/returns.ts now reads TAGGED_DISPOSAL_MOVEMENT_TYPE directly
  // (its postcondition movement-count check), so the route itself needs the
  // real module too, not just returnsStock.ts's copy above.
  '../lib/stockCondition': loadReal('lib/stockCondition.ts'),
  // Part 519 (session 0b) gave the route a datetime return-number generator;
  // the real one reads the DB for same-second collisions -- a deterministic
  // stub keeps this suite's return numbers stable.
  '../lib/receiptNumber': { uniqueBusinessDateTimeNumber: async (prefix, exists) => {
    const base = `${prefix ? `${prefix}-` : ''}20260830-120000`
    if (!await exists(base)) return base
    for (let suffix = 1; suffix < 100; suffix += 1) {
      const candidate = `${base}-${String(suffix).padStart(2, '0')}`
      if (!await exists(candidate)) return candidate
    }
    throw new Error('test receipt space exhausted')
  } },
  // Real money kernel -- the replacement sale derives its totals through the
  // same function routes/sales.ts uses, so it must be the real one here too.
  '../lib/saleTotals': loadReal('lib/saleTotals.ts', {
    './moneyPrecision': moneyPrecisionKernel, './saleMoneyPrecision': saleMoneyPrecisionKernel,
  }),
}
const loadReturnsRoute = (sourceText = null) => loadReal('routes/returns.ts', returnsRouteOverrides, sourceText)
const returnsRoute = loadReturnsRoute()
// The route as it was before this lane.
const oracleRoute = loadReturnsRoute(require('child_process').execFileSync('git', ['show', '93057c781:cloudflare/src/routes/returns.ts'], { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))

// The route as it stood before the residual-gap lane (edit / supplier redirect): the oracle for those writers.
const oracleBeforeResidualRoute = loadReturnsRoute(require('child_process').execFileSync('git', ['show', 'b2b57f90b:cloudflare/src/routes/returns.ts'], { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))

let app = returnsRoute.default

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function seed() {
  auditCalls = []
  rawDb.exec(`INSERT INTO system_flags(key,value) VALUES('sale_record_events_reset_guard','{"mode":"reset","token":"return-test-seed"}')
    ON CONFLICT(key) DO UPDATE SET value=excluded.value;
    DELETE FROM sale_record_events; DELETE FROM return_mutation_receipts; DELETE FROM return_create_receipts; DELETE FROM return_create_guards;
    DELETE FROM system_flags WHERE key='sale_record_events_reset_guard';
    DELETE FROM return_bulk_guards; DELETE FROM sale_bulk_guards;
    DELETE FROM branch_batch_stock; DELETE FROM product_batches; DELETE FROM branch_stock; DELETE FROM products; DELETE FROM branches; DELETE FROM sale_items; DELETE FROM sale_item_batch_allocations; DELETE FROM sales; DELETE FROM customers; DELETE FROM returns; DELETE FROM return_items; DELETE FROM return_item_batch_allocations; DELETE FROM inventory_movements; DELETE FROM damaged_stock_lots; DELETE FROM return_replacement_items;`)
  rawDb.prepare('INSERT INTO branches (id, name, is_active, is_default) VALUES (1, \'Shop\', 1, 1)').run()
  rawDb.prepare('INSERT INTO branches (id, name, is_active, is_default) VALUES (2, \'Warehouse\', 1, 0)').run()
  rawDb.prepare("INSERT INTO products (id, name, is_active, stock_quantity) VALUES (1, 'Widget', 1, 0)").run()
  rawDb.prepare("INSERT INTO products (id, name, is_active, stock_quantity, selling_price_usd) VALUES (2, 'Different Serum', 1, 0, 10)").run()
  rawDb.prepare("INSERT INTO sales (id, branch_id) VALUES (1, 1)").run()
}

function seedReplacementStock() {
  rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (2, 1, 10)').run()
  rawDb.prepare('UPDATE products SET stock_quantity = 10 WHERE id = 2').run()
  rawDb.prepare("INSERT INTO product_batches (variant_product_id, batch_key, lot_code, received_at, is_active, batch_number) VALUES (2, 'replacement-lot', 'REPL-LOT', '2026-08-01', 1, 1)").run()
  const batchId = Number(rawDb.prepare('SELECT id FROM product_batches WHERE variant_product_id = 2').get().id)
  rawDb.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (?, 1, 5)').run([batchId])
  return batchId
}

// routes/returns.ts fires several c.executionCtx.waitUntil(...) calls after
// each write (broadcast/cache-bump side effects, unrelated to the batch
// logic under test) -- Hono's Context throws "This context has no
// ExecutionContext" if none is supplied, since app.request()'s real Worker
// caller always provides one. A minimal fake that runs the callback
// immediately (no real background-task deferral needed in a synchronous
// test) is enough; passThroughOnException is provided for the same reason
// even though nothing here calls it.
const fakeExecutionCtx = { waitUntil: (p) => { p?.catch?.(() => {}) }, passThroughOnException: () => {} }

async function req(method, url, body) {
  let requestBody = body
  if (method === 'POST' && url === '/' && body && typeof body === 'object') {
    requestBody = { client_request_id: body.client_request_id || `return-create-${crypto.randomUUID()}`, ...body }
  }
  if (method === 'PATCH' && /^\/\d+$/.test(url) && body && typeof body === 'object') {
    const returnId = Number(url.slice(1))
    const current = rawDb.prepare('SELECT updated_at FROM returns WHERE id=@id').get({ id: returnId })
    requestBody = {
      client_request_id: body.client_request_id || `return-edit-${crypto.randomUUID()}`,
      expected_updated_at: Object.prototype.hasOwnProperty.call(body, 'expected_updated_at') ? body.expected_updated_at : current?.updated_at,
      ...body,
    }
  }
  return reqExact(method, url, requestBody)
}

// CUTOVER-LR: the X-Branch-Redirect header every request carries (the branch the operator confirmed for a change addressed
// to a retired branch). LC Store is id 1 here; null sends none.
let redirectTo = 1
async function reqExact(method, url, body) {
  const res = await app.request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(redirectTo == null ? {} : { 'X-Branch-Redirect': String(redirectTo) }) },
    body: body != null ? JSON.stringify(body) : undefined,
  }, fakeEnv, fakeExecutionCtx)
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

async function reqAs(user, method, url, body) {
  activeUser = user
  try {
    return await req(method, url, body)
  } finally {
    activeUser = FAKE_USER
  }
}


// ---------------------------------------------------------------------------
// CUTOVER-LC item 4: a return of a sale made at a RETIRED branch.
//
// Production ids: 1 = Warehouse (becomes "LC Store"), 2 = Shop (becomes
// "Old Shop", inactive, successor 1). Both states are built here:
//   before  both branches active, roles/keys NULL (what runs today)
//   after   LC Store (role shop, key warehouse, active), Old Shop (role shop,
//           key shop, inactive, successor 1) -- the consolidation's end state
// ---------------------------------------------------------------------------
function seedWorld(state) {
  seed()
  rawDb.exec('DELETE FROM branches; DELETE FROM audit_logs;')
  if (state === 'before') {
    rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Warehouse', 1, 0)").run()
    rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (2, 'Shop', 1, 1)").run()
  } else {
    rawDb.prepare("INSERT INTO branches (id, name, role, canonical_key, is_active, is_default) VALUES (1, 'LC Store', 'shop', 'warehouse', 1, 1)").run()
    rawDb.prepare("INSERT INTO branches (id, name, role, canonical_key, is_active, is_default, successor_branch_id) VALUES (2, 'Old Shop', 'shop', 'shop', 0, 0, 1)").run()
  }
  rawDb.exec('DELETE FROM sales')
  rawDb.prepare("INSERT INTO sales (id, branch_id, branch_name, receipt_number, sale_status) VALUES (1, 2, 'Shop', 'R-OLD-1', 'completed')").run()
}

// Lot 1: received 2026-01-01 (the survivor at LC Store). Lot 3: received the
// same day at Shop only, folded into lot 1 by the consolidation (audit row).
// The old Shop sale drew `fromLot` (5 units out of it).
function seedLots(state, fromLot) {
  const lot = (id, key, receivedAt) => rawDb.prepare("INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number) VALUES (?, 1, ?, ?, ?, 1, ?)").run([id, key, key, receivedAt, id])
  lot(1, 'lot-a', '2026-01-01')
  lot(3, 'lot-c', '2026-01-01')
  const home = state === 'before' ? 2 : 1
  const stock = (batch, branch, qty) => rawDb.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (?, ?, ?)').run([batch, branch, qty])
  stock(1, home, 10)
  stock(3, home, state === 'before' ? 4 : 0)
  rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, ?, ?)').run([home, state === 'before' ? 14 : 10])
  if (state !== 'before') {
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 2, 0)').run()
    stock(1, 2, 0); stock(3, 2, 0)
    rawDb.prepare("INSERT INTO audit_logs (user_name, action, entity, entity_id, details) VALUES ('op', 'branch_cutover_lot_fold', 'product_batch', '1', ?)")
      .run([JSON.stringify({ operationId: 'op-1', productId: 1, survivorBatchId: 1, foldedBatchIds: [3], branchId: 1 })])
  }
  rawDb.prepare('UPDATE products SET stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id=1) WHERE id=1').run()
  rawDb.prepare('INSERT INTO sale_items (id, sale_id, product_id, quantity, branch_id, batch_id) VALUES (1, 1, 1, 5, 2, ?)').run([fromLot])
  rawDb.prepare('INSERT INTO sale_item_batch_allocations (sale_item_id, batch_id, branch_id, quantity, released_quantity) VALUES (1, ?, 2, 5, 0)').run([fromLot])
}

const stockOf = (batch, branch) => rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = ? AND branch_id = ?').get([batch, branch])?.quantity ?? null
const branchStockOf = (branch) => rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = ?').get([branch])?.quantity ?? null
const returnBody = (extra = {}) => ({
  sale_id: 1,
  items: [{ sale_item_id: 1, product_id: 1, quantity: 3, return_to_stock: true, applied_price_usd: 10 }],
  reason: 'Customer changed mind',
  ...extra,
})

// Statement capture normalised for comparison: ids and clocks differ per run.
function normalised(batches) {
  const text = JSON.stringify(batches)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<ts>')
    .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, '<ts>')
    .replace(/(revision\\+"):\d+/g, '$1:<n>')
  return text
}

async function runWith(appToUse, body, state, fromLot) {
  seedWorld(state)
  seedLots(state, fromLot)
  const previous = app
  app = appToUse
  captured = []
  try {
    const response = await req('POST', '/', { client_request_id: 'fixed-request-1', ...body })
    return { response, captured }
  } finally {
    app = previous
    captured = null
  }
}

async function successorChecks() {
  await check('INERT while both branches are active: the new route writes the exact statements the old one wrote', async () => {
    const fresh = await runWith(returnsRoute.default, returnBody(), 'before', 1)
    const old = await runWith(oracleRoute.default, returnBody(), 'before', 1)
    assert.strictEqual(fresh.response.status, 200, JSON.stringify(fresh.response.json))
    assert.strictEqual(old.response.status, 200, JSON.stringify(old.response.json))
    const freshText = normalised(fresh.captured)
    const oldText = normalised(old.captured)
    let at = 0
    while (at < freshText.length && freshText[at] === oldText[at]) at += 1
    assert.strictEqual(freshText, oldText, `statement lists differ while both branches are active, first difference at ${at}: new ${JSON.stringify(freshText.slice(Math.max(0, at - 120), at + 160))} / old ${JSON.stringify(oldText.slice(Math.max(0, at - 120), at + 160))}`)
    assert.strictEqual(stockOf(1, 2), 13, 'the return stays at the sale branch (Shop id 2)')
    assert.strictEqual(branchStockOf(2), 17)
    const header = rawDb.prepare('SELECT branch_id, branch_name, addressed_branch_name FROM returns').get()
    assert.deepStrictEqual({ ...header }, { branch_id: 2, branch_name: 'Shop', addressed_branch_name: null })
  })

  await check('CONTROL: the old route restocks an old Shop sale into the retired branch (the defect this fixes)', async () => {
    const old = await runWith(oracleRoute.default, returnBody(), 'after', 1)
    assert.strictEqual(old.response.status, 200, JSON.stringify(old.response.json))
    assert.strictEqual(stockOf(1, 2), 3, 'old code strands the units in Old Shop')
    assert.strictEqual(stockOf(1, 1), 10)
  })

  await check('CUTOVER-LR: a return of an old Shop sale is refused until the redirect is confirmed, and an invalid target is refused, with nothing written', async () => {
    seedWorld('after'); seedLots('after', 1)
    const before = JSON.stringify([rawDb.prepare('SELECT * FROM branch_stock').all(), rawDb.prepare('SELECT * FROM branch_batch_stock').all()])
    try {
      redirectTo = null
      const asked = await req('POST', '/', returnBody({ client_request_id: 'ask-1' }))
      assert.strictEqual(asked.status, 409, JSON.stringify(asked.json))
      assert.strictEqual(asked.json.code, 'branch_redirect_required')
      assert.deepStrictEqual(asked.json.redirect, { addressed_branch_id: 2, addressed_branch_name: 'Old Shop', successor_branch_id: 1, successor_branch_name: 'LC Store', targets: [{ id: 1, name: 'LC Store' }], requested_target_id: null })
      redirectTo = 2
      const invalid = await req('POST', '/', returnBody({ client_request_id: 'ask-1' }))
      assert.strictEqual(invalid.json.code, 'branch_redirect_target_invalid', 'the disabled branch cannot be its own redirect')
      redirectTo = null
      const refundOnly = await req('POST', '/', returnBody({ client_request_id: 'ask-2', items: [{ sale_item_id: 1, product_id: 1, quantity: 2, stock_action: 'none', applied_price_usd: 10 }] }))
      assert.strictEqual(refundOnly.json.code, 'branch_redirect_required', 'a refund-only return still asks: its cash leaves an active drawer')
    } finally { redirectTo = 1 }
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) n FROM returns').get().n, 0, 'no return is recorded')
    assert.strictEqual(JSON.stringify([rawDb.prepare('SELECT * FROM branch_stock').all(), rawDb.prepare('SELECT * FROM branch_batch_stock').all()]), before, 'and no stock moves')
  })

  await check('return of an old Shop sale lands in LC Store, same lot; the sale keeps Shop and the return records the real target', async () => {
    const { response } = await runWith(returnsRoute.default, returnBody(), 'after', 1)
    assert.strictEqual(response.status, 200, JSON.stringify(response.json))
    assert.strictEqual(stockOf(1, 1), 13, 'LC Store lot received 3 units')
    assert.strictEqual(stockOf(1, 2), 0, 'Old Shop stays empty')
    assert.strictEqual(branchStockOf(1), 13)
    assert.strictEqual(branchStockOf(2), 0)
    const header = rawDb.prepare('SELECT branch_id, branch_name, addressed_branch_name FROM returns WHERE id = ?').get([response.json.id])
    assert.deepStrictEqual({ ...header }, { branch_id: 1, branch_name: 'LC Store', addressed_branch_name: 'Shop' })
    const line = rawDb.prepare('SELECT branch_id, batch_id FROM return_items WHERE return_id = ?').get([response.json.id])
    assert.deepStrictEqual({ ...line }, { branch_id: 1, batch_id: 1 })
    const allocation = rawDb.prepare('SELECT batch_id, branch_id, quantity FROM return_item_batch_allocations').all().map((row) => ({ ...row }))
    assert.deepStrictEqual(allocation, [{ batch_id: 1, branch_id: 1, quantity: 3 }])
    const movement = rawDb.prepare("SELECT branch_id, branch_name, addressed_branch_name, batch_id, reason FROM inventory_movements WHERE movement_type = 'return'").get()
    assert.deepStrictEqual({ ...movement }, { branch_id: 1, branch_name: 'LC Store', addressed_branch_name: 'Shop', batch_id: 1, reason: 'Return: Customer changed mind (sale at Shop)' })
    const sale = rawDb.prepare('SELECT branch_id, branch_name FROM sales WHERE id = 1').get()
    assert.deepStrictEqual({ ...sale }, { branch_id: 2, branch_name: 'Shop' }, 'the original sale is never relabelled')
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) n FROM product_batches').get().n, 2, 'no lot was created')
    const audit = JSON.parse(rawDb.prepare("SELECT details FROM audit_logs WHERE entity = 'return_create'").get().details)
    assert.strictEqual(audit.addressed_branch_name, 'Shop')
    assert.strictEqual(audit.branch_id, 1)
  })

  await check('a sale that drew a FOLDED lot gives the units back to the merged lot (same product + received date), not to the folded id', async () => {
    const { response } = await runWith(returnsRoute.default, returnBody(), 'after', 3)
    assert.strictEqual(response.status, 200, JSON.stringify(response.json))
    assert.strictEqual(stockOf(1, 1), 13, 'the survivor lot received the units')
    assert.strictEqual(stockOf(3, 1), 0, 'the folded lot stays empty')
    assert.strictEqual(stockOf(3, 2), 0)
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) n FROM product_batches').get().n, 2, 'no second same-date lot is created')
    assert.strictEqual(rawDb.prepare('SELECT batch_id FROM return_items').get().batch_id, 1)
    assert.strictEqual(rawDb.prepare("SELECT batch_id FROM inventory_movements WHERE movement_type = 'return'").get().batch_id, 1)
    // Control: without the fold mapping the units would land in lot 3.
    const old = await runWith(oracleRoute.default, returnBody(), 'after', 3)
    assert.strictEqual(old.response.status, 200)
    assert.strictEqual(stockOf(3, 2), 3, 'control: the old route restocks the folded lot id at the retired branch')
  })

  await check('the same request id twice moves the stock once; the replay answers the recorded return', async () => {
    const first = await runWith(returnsRoute.default, returnBody(), 'after', 3)
    assert.strictEqual(first.response.status, 200)
    const again = await req('POST', '/', { client_request_id: 'fixed-request-1', ...returnBody() })
    assert.strictEqual(again.status, 200, JSON.stringify(again.json))
    assert.deepStrictEqual(again.json, first.response.json)
    assert.strictEqual(stockOf(1, 1), 13)
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) n FROM returns').get().n, 1)
  })

  await check('editing the new return reverses it at LC Store (its own row), never at Old Shop', async () => {
    const { response } = await runWith(returnsRoute.default, returnBody(), 'after', 3)
    assert.strictEqual(response.status, 200)
    const edited = await req('PATCH', `/${response.json.id}`, {
      items: [{ sale_item_id: 1, product_id: 1, quantity: 1, return_to_stock: true, applied_price_usd: 10 }],
      reason: 'Edited down',
    })
    assert.strictEqual(edited.status, 200, JSON.stringify(edited.json))
    assert.strictEqual(stockOf(1, 1), 11, 'reversed 3 then restocked 1, all at LC Store in the survivor lot')
    assert.strictEqual(stockOf(1, 2), 0)
    assert.strictEqual(stockOf(3, 2), 0)
    assert.strictEqual(branchStockOf(1), 11)
    assert.strictEqual(branchStockOf(2), 0)
  })

  await check('a retired branch with NO active branch to take the return refuses 409 before any write, even with a target', async () => {
    for (const mutate of [
      (db) => db.prepare('UPDATE branches SET is_active = 0 WHERE id = 1').run(),
      (db) => db.prepare('UPDATE branches SET successor_branch_id = NULL, is_active = 0 WHERE id IN (1, 2)').run(),
    ]) {
      seedWorld('after'); seedLots('after', 1)
      // Triggers forbid some of these states; drop them for the fixture only.
      const triggers = rawDb.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'branches'").all()
      for (const trigger of triggers) rawDb.exec(`DROP TRIGGER "${trigger.name}"`)
      mutate(rawDb)
      for (const trigger of triggers) rawDb.exec(trigger.sql)
      const before = JSON.stringify([rawDb.prepare('SELECT * FROM branch_stock').all(), rawDb.prepare('SELECT * FROM branch_batch_stock').all()])
      const { status, json } = await req('POST', '/', returnBody({ client_request_id: 'refused-1' }))
      assert.strictEqual(status, 409, JSON.stringify(json))
      assert.strictEqual(json.code, 'branch_retired_no_successor')
      assert.strictEqual(rawDb.prepare('SELECT COUNT(*) n FROM returns').get().n, 0)
      assert.strictEqual(JSON.stringify([rawDb.prepare('SELECT * FROM branch_stock').all(), rawDb.prepare('SELECT * FROM branch_batch_stock').all()]), before)
    }
  })

  await check('a retired branch with no successor still asks (no default) and takes the active branch the operator chose', async () => {
    seedWorld('after'); seedLots('after', 1)
    const triggers = rawDb.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'branches'").all()
    for (const trigger of triggers) rawDb.exec(`DROP TRIGGER "${trigger.name}"`)
    rawDb.prepare('UPDATE branches SET successor_branch_id = NULL WHERE id = 2').run()
    for (const trigger of triggers) rawDb.exec(trigger.sql)
    try {
      redirectTo = null
      const asked = await req('POST', '/', returnBody({ client_request_id: 'money-only-1', items: [{ sale_item_id: 1, product_id: 1, quantity: 2, stock_action: 'none', applied_price_usd: 10 }] }))
      assert.strictEqual(asked.json.code, 'branch_redirect_required')
      assert.strictEqual(asked.json.redirect.successor_branch_id, null)
      assert.deepStrictEqual(asked.json.redirect.targets, [{ id: 1, name: 'LC Store' }])
    } finally { redirectTo = 1 }
    const { status, json } = await req('POST', '/', returnBody({ client_request_id: 'money-only-1', items: [{ sale_item_id: 1, product_id: 1, quantity: 2, stock_action: 'none', applied_price_usd: 10 }] }))
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(rawDb.prepare('SELECT branch_id FROM returns WHERE id = ?').get([json.id]).branch_id, 1, 'the refund is recorded at the chosen active branch')
    assert.strictEqual(stockOf(1, 2), 0)
    assert.strictEqual(stockOf(1, 1), 10)
  })

  await check('a replacement hand-out for an old Shop sale is sold from LC Store (header branch = the landing branch)', async () => {
    seedWorld('after'); seedLots('after', 1)
    rawDb.prepare("INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number) VALUES (9, 2, 'rep', 'REP', '2026-02-01', 1, 1)").run()
    rawDb.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (9, 1, 6)').run()
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (2, 1, 6)').run()
    rawDb.prepare('UPDATE products SET stock_quantity = 6 WHERE id = 2').run()
    const { status, json } = await req('POST', '/', returnBody({
      client_request_id: 'replacement-1',
      items: [{ sale_item_id: 1, product_id: 1, quantity: 2, stock_action: 'restock', applied_price_usd: 10 }],
      replacement_items: [{ product_id: 2, quantity: 2, branch_id: 2, applied_price_usd: 10 }],
    }))
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(stockOf(9, 1), 4, 'replacement stock left LC Store')
    assert.strictEqual(rawDb.prepare('SELECT branch_id FROM sales WHERE id = ?').get([json.replacementSaleId]).branch_id, 1)
    assert.strictEqual(rawDb.prepare('SELECT branch_id FROM sale_items WHERE sale_id = ?').get([json.replacementSaleId]).branch_id, 1)
    assert.strictEqual(stockOf(1, 1), 12)
  })

  await check('a branch change between plan and commit (Old Shop reactivated) aborts the return with nothing written', async () => {
    seedWorld('after'); seedLots('after', 1)
    beforeBatchHook = async () => {
      const triggers = rawDb.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'branches'").all()
      for (const trigger of triggers) rawDb.exec(`DROP TRIGGER "${trigger.name}"`)
      rawDb.prepare('UPDATE branches SET is_active = 1, successor_branch_id = NULL WHERE id = 2').run() // Old Shop reactivated between plan and commit
      for (const trigger of triggers) rawDb.exec(trigger.sql)
    }
    const { status, json } = await req('POST', '/', returnBody({ client_request_id: 'race-1' }))
    assert.strictEqual(status, 409, JSON.stringify(json))
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) n FROM returns').get().n, 0)
    assert.strictEqual(stockOf(1, 1), 10)
    assert.strictEqual(stockOf(1, 2), 0)
  })

  // Wrong implementations: each mutation removes ONE piece of the fix from the real source and the scenario
  // that depends on it must go red -- otherwise the scenario above could pass without the piece.
  await check('CONTROLS: without the redirect or the fold mapping the matching scenario fails', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'returns.ts'), 'utf8')
    const mutate = (edits) => {
      let text = source
      for (const [from, to] of edits) {
        assert.ok(text.includes(from), `mutation anchor missing: ${from}`)
        text = text.replace(from, to)
      }
      return loadReturnsRoute(text).default
    }
    const noRedirect = mutate([
      ['const branchId = headerEffect?.redirected ? headerEffect.effectBranchId : recordedBranchId', 'const branchId = recordedBranchId'],
      ['returnItems = returnItems.map((item, index) => itemEffects[index]?.redirected ?', 'returnItems = returnItems.map((item, index) => false ?'],
    ])
    const noFold = mutate([['await foldedLotSurvivors(db, effectId, wanted)', '[]']])
    const lands = async (route, fromLot) => {
      const { response } = await runWith(route, returnBody(), 'after', fromLot)
      return response.status === 200 && stockOf(1, 1) === 13 && stockOf(1, 2) === 0 && stockOf(3, 2) === 0 && stockOf(3, 1) === 0
    }
    assert.strictEqual(await lands(returnsRoute.default, 3), true, 'sanity: the real route passes the scenario')
    assert.strictEqual(await lands(noRedirect, 1), false, 'no redirect: the units are stranded in Old Shop')
    assert.strictEqual(await lands(noFold, 3), false, 'no fold mapping: the folded lot id is restocked')
  })

  await check('the in-batch chain guard is true only while the landing branch is active and the addressed branch is retired and points at it', async () => {
    const kernel = loadReal('lib/branchEffect.ts', { './branchRoles': branchRolesKernel, './sqlBinding': loadReal('lib/sqlBinding.ts') })
    const holds = (effects) => rawDb.prepare(`SELECT ${kernel.branchEffectGuardPredicate('@effects')} AS ok`).get({ effects: JSON.stringify(effects) }).ok
    const pair = [{ addressed: 2, effect: 1, sells: 1 }]
    const withoutTriggers = (mutate) => {
      const triggers = rawDb.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'branches'").all()
      for (const trigger of triggers) rawDb.exec(`DROP TRIGGER "${trigger.name}"`)
      try { mutate() } finally { for (const trigger of triggers) rawDb.exec(trigger.sql) }
    }
    seedWorld('after')
    assert.strictEqual(holds(pair), 1, 'the consolidation end state holds')
    assert.strictEqual(holds([]), 1, 'nothing redirected, nothing to prove')
    withoutTriggers(() => rawDb.prepare('UPDATE branches SET is_active = 1, successor_branch_id = NULL WHERE id = 2').run())
    assert.strictEqual(holds(pair), 0, 'the addressed branch was reactivated: nothing may be redirected away from it')
    seedWorld('after')
    withoutTriggers(() => rawDb.prepare('UPDATE branches SET successor_branch_id = NULL WHERE id = 2').run())
    assert.strictEqual(holds(pair), 1, 'CUTOVER-LR: the landing branch is the one the operator confirmed, so the successor pointer is not required')
    seedWorld('after')
    withoutTriggers(() => rawDb.prepare('UPDATE branches SET is_active = 0 WHERE id = 1').run())
    assert.strictEqual(holds(pair), 0, 'the landing branch is no longer active')
    seedWorld('after')
    withoutTriggers(() => rawDb.prepare("UPDATE branches SET role = 'warehouse' WHERE id = 1").run())
    assert.strictEqual(holds(pair), 0, 'a replacement hand-out needs the landing branch to sell')
    assert.strictEqual(holds([{ addressed: 2, effect: 1, sells: 0 }]), 1, 'a plain restock does not')
  })

  await check('foldedLotSurvivors answers only for the consolidation target branch', async () => {
    seedWorld('after'); seedLots('after', 1)
    const kernel = loadReal('lib/branchEffect.ts', { './branchRoles': branchRolesKernel, './sqlBinding': loadReal('lib/sqlBinding.ts') })
    assert.deepStrictEqual([...(await kernel.foldedLotSurvivors(db, 1, [1, 3, 99]))], [[3, 1]])
    assert.deepStrictEqual([...(await kernel.foldedLotSurvivors(db, 2, [3]))], [], 'a fold recorded at another branch does not apply')
    assert.deepStrictEqual([...(await kernel.foldedLotSurvivors(db, 1, []))], [])
  })
}

// ---------------------------------------------------------------------------
// CUTOVER-LC residual gaps: editing a return recorded at a retired branch, and a supplier return addressed to one.
// ---------------------------------------------------------------------------
// The consolidation, applied to the 'before' world: Old Shop (2) hands everything to LC Store (1) and lot 3 is folded
// into lot 1. Returns made at Shop before it keep branch 2 and their lines.
function consolidate() {
  const triggers = rawDb.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'branches'").all()
  for (const trigger of triggers) rawDb.exec(`DROP TRIGGER "${trigger.name}"`)
  try {
    const lot1 = stockOf(1, 2) ?? 0; const lot3 = stockOf(3, 2) ?? 0
    rawDb.exec('DELETE FROM branch_batch_stock; DELETE FROM branch_stock; DELETE FROM branches')
    rawDb.prepare("INSERT INTO branches (id, name, role, canonical_key, is_active, is_default) VALUES (1, 'LC Store', 'shop', 'warehouse', 1, 1)").run()
    rawDb.prepare("INSERT INTO branches (id, name, role, canonical_key, is_active, is_default, successor_branch_id) VALUES (2, 'Old Shop', 'shop', 'shop', 0, 0, 1)").run()
    rawDb.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (1, 1, ?), (3, 1, 0), (1, 2, 0), (3, 2, 0)').run([lot1 + lot3])
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 1, ?), (1, 2, 0)').run([lot1 + lot3])
    rawDb.prepare("INSERT INTO audit_logs (user_name, action, entity, entity_id, details) VALUES ('op', 'branch_cutover_lot_fold', 'product_batch', '1', ?)")
      .run([JSON.stringify({ operationId: 'op-1', productId: 1, survivorBatchId: 1, foldedBatchIds: [3], branchId: 1 })])
  } finally { for (const trigger of triggers) rawDb.exec(trigger.sql) }
}

// A customer return made at Shop (3 units back into lot 3) BEFORE the consolidation.
async function preConsolidationReturn(appToUse) {
  seedWorld('before'); seedLots('before', 3)
  const previous = app
  app = appToUse
  try {
    const made = await req('POST', '/', { client_request_id: 'pre-cutover-1', ...returnBody() })
    assert.strictEqual(made.status, 200, JSON.stringify(made.json))
    return made.json.id
  } finally { app = previous }
}
const editBody = (id, extra = {}) => ({
  client_request_id: 'edit-1',
  expected_updated_at: rawDb.prepare('SELECT updated_at FROM returns WHERE id = ?').get([id]).updated_at,
  items: [{ sale_item_id: 1, product_id: 1, quantity: 1, return_to_stock: true, applied_price_usd: 10 }],
  reason: 'Edited down',
  ...extra,
})
// Row ids and the revision counters keep growing across fixtures; the statements are otherwise compared byte for byte.
const normalisedRun = (batches) => normalised(batches).replace(/\b(id|revision|return_id|reference_id|returnId)(\\*)":\d+/g, '$1$2":<n>').replace(/[0-9a-f]{64}/g, '<digest>').replace(/"(\d{1,6})"/g, '"<n>"')
const lotsSnapshot = () => ({ lot1AtStore: stockOf(1, 1), lot3AtStore: stockOf(3, 1), lot1AtOld: stockOf(1, 2), lot3AtOld: stockOf(3, 2), store: branchStockOf(1), old: branchStockOf(2) })
const movementRows = () => rawDb.prepare('SELECT movement_type, branch_id, branch_name, addressed_branch_name, quantity, batch_id FROM inventory_movements ORDER BY id').all().map((row) => ({ ...row }))
async function withRoute(appToUse, fn) { const previous = app; app = appToUse; try { return await fn() } finally { app = previous } }

async function residualChecks() {
  // E7: a lot fully sold at Shop before the cutover was never folded (nothing to move). A return of that sale lands in the
  // lot of the same product, day, expiry and supplier that holds stock at LC Store, never in a second same-date lot.
  await check('RETURN into a lot sold out at Shop before the cutover lands in the same-day lot at LC Store (no same-date split)', async () => {
    const soldOutLot = (extra = '') => {
      rawDb.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number${extra ? ', ' + extra.split('=')[0] : ''}) VALUES (4, 1, 'lot-d', 'lot-d', '2026-01-01', 1, 4${extra ? ', ' + extra.split('=')[1] : ''})`).run()
      rawDb.prepare('UPDATE sale_items SET batch_id = 4 WHERE id = 1').run()
      rawDb.prepare('UPDATE sale_item_batch_allocations SET batch_id = 4 WHERE sale_item_id = 1').run()
    }
    seedWorld('after'); seedLots('after', 1); soldOutLot()
    const { status, json } = await req('POST', '/', returnBody({ client_request_id: 'sold-out-lot-1' }))
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(stockOf(1, 1), 13, 'the 3 units went into the same-day lot that holds stock at LC Store')
    assert.strictEqual(stockOf(4, 1), null, 'no stock row was created for the sold-out lot: no second same-date lot')
    assert.strictEqual(rawDb.prepare('SELECT batch_id FROM return_items WHERE return_id = ?').get([json.id]).batch_id, 1)
    // Wrong implementations: a different expiry, a different supplier or a different day each keep the lot apart.
    for (const extra of ["expiry_date='2027-01-01'", "supplier_name='Acme'", "received_at='2026-01-02'"]) {
      seedWorld('after'); seedLots('after', 1)
      const [column, value] = extra.split('=')
      if (column === 'received_at') { soldOutLot(); rawDb.prepare('UPDATE product_batches SET received_at = ? WHERE id = 4').run([value.replace(/'/g, '')]) } else soldOutLot(extra)
      const apart = await req('POST', '/', returnBody({ client_request_id: 'sold-out-apart-' + column }))
      assert.strictEqual(apart.status, 200, JSON.stringify(apart.json))
      assert.strictEqual(stockOf(4, 1), 3, `${column} differs: the lot keeps its own identity at LC Store`)
      assert.strictEqual(stockOf(1, 1), 10)
    }
    // The business day is Cambodia's (UTC+7): 18:00Z on 31 Dec is already 1 Jan, 16:00Z is still 31 Dec.
    for (const [stamp, merges] of [['2025-12-31T18:00:00Z', true], ['2025-12-31T16:00:00Z', false], ['1/1/2026', true]]) {
      seedWorld('after'); seedLots('after', 1); soldOutLot()
      rawDb.prepare('UPDATE product_batches SET received_at = ? WHERE id = 4').run([stamp])
      const day = await req('POST', '/', returnBody({ client_request_id: 'sold-out-day-' + stamp }))
      assert.strictEqual(day.status, 200, JSON.stringify(day.json))
      assert.strictEqual(stockOf(4, 1), merges ? null : 3, `${stamp}: ${merges ? 'same business day merges' : 'another business day stays apart'}`)
    }
    // A lot that HOLDS stock at the landing branch is never remapped.
    seedWorld('after'); seedLots('after', 1); soldOutLot()
    rawDb.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (4, 1, 2)').run()
    rawDb.prepare('UPDATE branch_stock SET quantity = 12 WHERE product_id = 1 AND branch_id = 1').run()
    const held = await req('POST', '/', returnBody({ client_request_id: 'held-lot-1' }))
    assert.strictEqual(held.status, 200, JSON.stringify(held.json))
    assert.strictEqual(stockOf(4, 1), 5, 'a lot with stock at LC Store takes its own units back')
    assert.strictEqual(stockOf(1, 1), 10)
  })

  await check('EDIT of a return made at Shop before the consolidation reverses and restocks at LC Store in the merged lot', async () => {
    const id = await preConsolidationReturn(returnsRoute.default)
    assert.deepStrictEqual(lotsSnapshot(), { lot1AtStore: null, lot3AtStore: null, lot1AtOld: 10, lot3AtOld: 7, store: null, old: 17 })
    consolidate()
    assert.deepStrictEqual(lotsSnapshot(), { lot1AtStore: 17, lot3AtStore: 0, lot1AtOld: 0, lot3AtOld: 0, store: 17, old: 0 })
    const body = editBody(id)
    const edited = await reqExact('PATCH', `/${id}`, body)
    assert.strictEqual(edited.status, 200, JSON.stringify(edited.json))
    assert.deepStrictEqual(lotsSnapshot(), { lot1AtStore: 15, lot3AtStore: 0, lot1AtOld: 0, lot3AtOld: 0, store: 15, old: 0 }, '3 taken back out of LC Store lot 1, 1 restocked into it; nothing at Old Shop')
    const moves = movementRows().filter((row) => row.movement_type === 'return_reversal' || row.addressed_branch_name)
    assert.deepStrictEqual(moves, [
      { movement_type: 'return_reversal', branch_id: 1, branch_name: 'LC Store', addressed_branch_name: 'Shop', quantity: -3, batch_id: 1 },
      { movement_type: 'return', branch_id: 1, branch_name: 'LC Store', addressed_branch_name: 'Shop', quantity: 1, batch_id: 1 },
    ])
    assert.deepStrictEqual({ ...rawDb.prepare('SELECT branch_id, branch_name FROM returns WHERE id = ?').get([id]) }, { branch_id: 2, branch_name: 'Shop' }, 'the return keeps its own branch and label')
    assert.strictEqual(rawDb.prepare('SELECT COALESCE(SUM(quantity),0) n FROM branch_batch_stock WHERE branch_id = 1').get().n, branchStockOf(1), 'lot ledger and branch ledger agree')
    // Double apply: the same edit request again moves nothing.
    const settled = JSON.stringify([lotsSnapshot(), movementRows()])
    const again = await reqExact('PATCH', `/${id}`, body)
    assert.strictEqual(again.status, 200, JSON.stringify(again.json))
    assert.strictEqual(JSON.stringify([lotsSnapshot(), movementRows()]), settled, 'a replayed edit moves nothing')
    // CONTROL: the code before this lane cannot edit it (the reversal asks the empty retired branch).
    const oldId = await preConsolidationReturn(oracleBeforeResidualRoute.default)
    consolidate()
    const before = JSON.stringify(lotsSnapshot())
    const refused = await withRoute(oracleBeforeResidualRoute.default, () => reqExact('PATCH', `/${oldId}`, editBody(oldId)))
    assert.notStrictEqual(refused.status, 200, 'CONTROL: the old edit path refuses or fails against the consolidated branches')
    assert.strictEqual(JSON.stringify(lotsSnapshot()), before, 'and writes nothing')
  })

  await check('EDIT asks before it moves anything, refuses an invalid target, and with no active branch at all refuses 409, all with nothing written', async () => {
    const id = await preConsolidationReturn(returnsRoute.default)
    consolidate()
    const before = JSON.stringify([lotsSnapshot(), movementRows()])
    try {
      redirectTo = null
      const asked = await reqExact('PATCH', `/${id}`, editBody(id))
      assert.strictEqual(asked.status, 409, JSON.stringify(asked.json))
      assert.strictEqual(asked.json.code, 'branch_redirect_required')
      assert.strictEqual(asked.json.redirect.successor_branch_name, 'LC Store')
      redirectTo = 2
      assert.strictEqual((await reqExact('PATCH', `/${id}`, editBody(id))).json.code, 'branch_redirect_target_invalid')
    } finally { redirectTo = 1 }
    assert.strictEqual(JSON.stringify([lotsSnapshot(), movementRows()]), before)
    const triggers = rawDb.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'branches'").all()
    for (const trigger of triggers) rawDb.exec(`DROP TRIGGER "${trigger.name}"`)
    rawDb.prepare('UPDATE branches SET successor_branch_id = NULL, is_active = 0 WHERE id IN (1, 2)').run()
    for (const trigger of triggers) rawDb.exec(trigger.sql)
    const refused = await reqExact('PATCH', `/${id}`, editBody(id))
    assert.strictEqual(refused.status, 409, JSON.stringify(refused.json))
    assert.strictEqual(refused.json.code, 'branch_retired_no_successor')
    assert.strictEqual(JSON.stringify([lotsSnapshot(), movementRows()]), before)
  })

  await check('INERT while both branches are active: an edit writes the exact statements the code before this lane wrote', async () => {
    const run = async (appToUse) => {
      const id = await preConsolidationReturn(appToUse)
      captured = []
      try {
        const edited = await withRoute(appToUse, () => reqExact('PATCH', `/${id}`, editBody(id)))
        assert.strictEqual(edited.status, 200, JSON.stringify(edited.json))
        return { text: normalisedRun(captured), stock: JSON.stringify([lotsSnapshot(), movementRows()]) }
      } finally { captured = null }
    }
    const fresh = await run(returnsRoute.default)
    const old = await run(oracleBeforeResidualRoute.default)
    let at = 0
    while (at < fresh.text.length && fresh.text[at] === old.text[at]) at += 1
    assert.strictEqual(fresh.text, old.text, `edit statements differ while both branches are active, first difference at ${at}: ${JSON.stringify(fresh.text.slice(Math.max(0, at - 120), at + 160))} / ${JSON.stringify(old.text.slice(Math.max(0, at - 120), at + 160))}`)
    assert.strictEqual(fresh.stock, old.stock)
    assert.deepStrictEqual(lotsSnapshot().lot3AtOld, 5, 'both branches active: reversal and restock stay at Shop in its own lot (7 - 3 + 1)')
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) n FROM inventory_movements WHERE addressed_branch_name IS NOT NULL').get().n, 0)
  })

  const supplierBody = (extra = {}) => ({
    client_request_id: 'supplier-1', items: [{ product_id: 1, quantity: 4, branch_id: 2, cost_price_usd: 2 }], branch_id: 2,
    reason: 'Defective lot returned', settlement: 'refund', supplier_name: 'Acme', ...extra,
  })
  await check('SUPPLIER return addressed to Old Shop takes its units out of LC Store and records both branches', async () => {
    seedWorld('before'); seedLots('before', 3)
    consolidate()
    try {
      redirectTo = null
      const asked = await reqExact('POST', '/supplier', supplierBody())
      assert.strictEqual(asked.status, 409, JSON.stringify(asked.json))
      assert.strictEqual(asked.json.code, 'branch_redirect_required', 'a supplier return addressed to Old Shop asks first')
    } finally { redirectTo = 1 }
    const made = await reqExact('POST', '/supplier', supplierBody())
    assert.strictEqual(made.status, 200, JSON.stringify(made.json))
    assert.deepStrictEqual(lotsSnapshot(), { lot1AtStore: 10, lot3AtStore: 0, lot1AtOld: 0, lot3AtOld: 0, store: 10, old: 0 }, 'the 4 of the 14 units left LC Store lot 1; Old Shop stays empty and is never driven negative')
    const header = rawDb.prepare('SELECT branch_id, branch_name, addressed_branch_name FROM returns WHERE return_type = ?').get(['supplier_return'])
    assert.deepStrictEqual({ ...header }, { branch_id: 1, branch_name: 'LC Store', addressed_branch_name: 'Old Shop' })
    assert.deepStrictEqual(movementRows().filter((row) => row.movement_type === 'supplier_return'), [{ movement_type: 'supplier_return', branch_id: 1, branch_name: 'LC Store', addressed_branch_name: 'Old Shop', quantity: -4, batch_id: 1 }])
    const settled = JSON.stringify([lotsSnapshot(), movementRows()])
    const again = await reqExact('POST', '/supplier', supplierBody())
    assert.strictEqual(again.status, 200, JSON.stringify(again.json))
    assert.strictEqual(JSON.stringify([lotsSnapshot(), movementRows()]), settled, 'the same request id moves the stock once')
    assert.strictEqual(rawDb.prepare("SELECT COUNT(*) n FROM returns WHERE return_type = 'supplier_return'").get().n, 1)
    // CONTROL: the code before this lane refuses the empty retired branch.
    seedWorld('before'); seedLots('before', 3)
    consolidate()
    const stranded = await withRoute(oracleBeforeResidualRoute.default, () => reqExact('POST', '/supplier', supplierBody({ client_request_id: 'supplier-old' })))
    assert.notStrictEqual(stranded.status, 200, 'CONTROL: the old supplier path cannot take stock out of the emptied retired branch')
  })

  await check('SUPPLIER return to a retired branch with no successor refuses 409; both branches active is byte-identical to the old route', async () => {
    seedWorld('before'); seedLots('before', 3)
    consolidate()
    const triggers = rawDb.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'branches'").all()
    for (const trigger of triggers) rawDb.exec(`DROP TRIGGER "${trigger.name}"`)
    rawDb.prepare('UPDATE branches SET successor_branch_id = NULL, is_active = 0 WHERE id IN (1, 2)').run()
    for (const trigger of triggers) rawDb.exec(trigger.sql)
    const before = JSON.stringify([lotsSnapshot(), movementRows()])
    const refused = await reqExact('POST', '/supplier', supplierBody({ client_request_id: 'supplier-orphan' }))
    assert.strictEqual(refused.status, 409, JSON.stringify(refused.json))
    assert.strictEqual(refused.json.code, 'branch_retired_no_successor')
    assert.strictEqual(JSON.stringify([lotsSnapshot(), movementRows()]), before)
    const run = async (appToUse) => {
      seedWorld('before'); seedLots('before', 3)
      captured = []
      try {
        const made = await withRoute(appToUse, () => reqExact('POST', '/supplier', supplierBody({ client_request_id: 'supplier-inert' })))
        assert.strictEqual(made.status, 200, JSON.stringify(made.json))
        return normalisedRun(captured)
      } finally { captured = null }
    }
    const fresh = await run(returnsRoute.default)
    const old = await run(oracleBeforeResidualRoute.default)
    assert.strictEqual(fresh, old, 'both branches active: the supplier return writes the same statements as before')
  })
}

successorChecks().then(residualChecks).then(() => { console.log(`${passed} returns successor restock checks passed`) }).catch((error) => { console.error(error); process.exitCode = 1 })
