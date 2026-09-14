// Verifies migrations/0163_stale_receipt_revert_mirror.sql against a fresh
// local better-sqlite3 database. Never touches remote D1.
//
// Proves, per scenario:
//   1. the migration's result equals lib/productBatches.ts
//      planUnreceiveBatchStock run on an identically seeded twin (same
//      arithmetic, derived from the helper rather than hard-coded);
//   2. the coordinator's literal expectations for the four pinned lots;
//   3. attribution is cleared and the lot deactivated ONLY when the lot holds
//      no positive branch_batch_stock (positive control: a whole-lot revert
//      whose lot still holds units keeps supplier + stays active);
//   4. a same-shaped lot that is not one of the pinned ids is untouched;
//   5. a drifted pre-state (received_quantity moved) makes that pair a no-op;
//   6. re-running the file changes nothing (idempotent), and the full chain
//      applies on an empty database (ids absent -> every statement no-op).
//
// Run: node scripts/verify-0163-stale-receipt-reverts.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

const MIGRATION = '0163_stale_receipt_revert_mirror.sql'

function compile(file, stubs = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', file)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const moduleObj = { exports: {} }
  const localRequire = (request) => Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : require(request)
  new Function('exports', 'require', 'module', output)(moduleObj.exports, localRequire, moduleObj)
  return moduleObj.exports
}
const batchCode = compile('batchCode.ts')
const sqlBinding = compile('sqlBinding.ts')
const moneyPrecision = compile('moneyPrecision.ts')
const { planUnreceiveBatchStock } = compile('productBatches.ts', {
  './db': {}, './batchCode': batchCode, './sqlBinding': sqlBinding, './moneyPrecision': moneyPrecision,
})
const { roundMoney4 } = moneyPrecision

const migrationsDir = path.join(__dirname, '..', 'migrations')
const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
assert.deepStrictEqual(migrationFiles.filter((f) => f.startsWith('0163_')), [MIGRATION], 'exactly one 0163 migration')
const migrationSql = fs.readFileSync(path.join(migrationsDir, MIGRATION), 'utf8')
assert.ok(!migrationSql.includes('\r'), 'migration is LF-only')

function chainBefore(file) {
  const sqlite = new Database(':memory:')
  for (const f of migrationFiles) {
    if (f === file) break
    sqlite.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  }
  return sqlite
}
const applyMigration = (sqlite) => sqlite.exec(migrationSql)

// The four production pairs, exactly as measured (SELECT-only, 2026-09-14).
const PAIRS = [
  { batchId: 61035, movementId: 46317, revertId: 46323, quantity: 1, received: 19, cost: 49.400000000000006, supplierId: 7, supplier: 'j secrat' },
  { batchId: 61187, movementId: 46890, revertId: 46898, quantity: 3, received: 3, cost: 149.573577, supplierId: 8, supplier: 'srey now' },
  { batchId: 61155, movementId: 46680, revertId: 46998, quantity: 3, received: 3, cost: 114, supplierId: 9, supplier: 'Lang' },
  { batchId: 61156, movementId: 46691, revertId: 47000, quantity: 3, received: 4, cost: 150, supplierId: 9, supplier: 'Lang' },
]
// Same shape as 61187 but not a pinned id: must come out untouched.
const CONTROL = { batchId: 61999, movementId: 48001, revertId: 48002, quantity: 3, received: 3, cost: 149.573577, supplierId: 8, supplier: 'srey now' }
const AUDIT_USER = 'migration:0163_stale_receipt_revert_mirror'

function seed(sqlite, lotStock, overrides = {}) {
  sqlite.prepare(`INSERT INTO branches (id, name, is_active) VALUES (1, 'Shop', 1)`).run()
  sqlite.prepare(`INSERT INTO suppliers (id, name) VALUES (7, 'j secrat'), (8, 'srey now'), (9, 'Lang')`).run()
  for (const p of [...PAIRS, CONTROL]) {
    const received = overrides[p.batchId]?.received ?? p.received
    const stock = lotStock[p.batchId] ?? 0
    const productId = 9000 + (p.batchId % 1000)
    sqlite.prepare(`INSERT INTO products (id, name, stock_quantity) VALUES (@id, @name, @stock)`)
      .run({ id: productId, name: `Lot ${p.batchId} product`, stock })
    sqlite.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@productId, 1, @stock)`).run({ productId, stock })
    sqlite.prepare(`
      INSERT INTO product_batches (id, variant_product_id, batch_key, is_active, supplier_id, supplier_name, payment_status,
        credit_due_date, unit_cost_usd, received_quantity, received_branch_id, received_cost_usd)
      VALUES (@id, @productId, '09012026', 1, @supplierId, @supplier, 'paid', NULL, @unitCost, @received, 1, @cost)`)
      .run({ id: p.batchId, productId, supplierId: p.supplierId, supplier: p.supplier, unitCost: roundMoney4(p.cost / p.received), received, cost: p.cost })
    sqlite.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (@batchId, 1, @stock)`).run({ batchId: p.batchId, stock })
    const unit = roundMoney4(p.cost / p.received)
    const total = roundMoney4(unit * p.quantity)
    sqlite.prepare(`
      INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity,
        unit_cost_usd, total_cost_usd, reason, reference_id, batch_id)
      VALUES (@id, @productId, 'p', 1, 'Shop', 'add', @quantity, @unit, @total, 'Stock in', NULL, @batchId)`)
      .run({ id: p.movementId, productId, quantity: p.quantity, unit, total, batchId: p.batchId })
    sqlite.prepare(`
      INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity,
        unit_cost_usd, total_cost_usd, reason, reference_id, batch_id)
      VALUES (@id, @productId, 'p', 1, 'Shop', 'remove', @quantity, @unit, @total, 'Reverted', @ref, @batchId)`)
      .run({ id: p.revertId, productId, quantity: p.quantity, unit, total, ref: `revert:${p.movementId}`, batchId: p.batchId })
  }
}

const LOT_COLUMNS = 'id, is_active, supplier_id, supplier_name, payment_status, credit_due_date, unit_cost_usd, received_quantity, received_branch_id, received_cost_usd'
const lot = (sqlite, id) => sqlite.prepare(`SELECT ${LOT_COLUMNS} FROM product_batches WHERE id = @id`).get({ id })
const auditCount = (sqlite) => sqlite.prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE user_name = @u`).get({ u: AUDIT_USER }).n
const bind = (sql, params) => Object.fromEntries(Object.entries(params).filter(([k]) => sql.includes('@' + k)))

// The twin: the helper the revert kernel calls today, with each pair's units
// priced at the lot's own average (the coordinator's ruling for these rows).
function applyHelper(sqlite) {
  sqlite.transaction(() => {
    for (const p of PAIRS) {
      const totalCostUsd = roundMoney4((p.cost / p.received) * p.quantity)
      for (const s of planUnreceiveBatchStock({ batchId: p.batchId, quantity: p.quantity, totalCostUsd })) {
        sqlite.prepare(s.sql).run(bind(s.sql, s.params))
      }
    }
  })()
}

function scenario(name, lotStock) {
  const a = chainBefore(MIGRATION)
  seed(a, lotStock)
  const twin = chainBefore(MIGRATION)
  seed(twin, lotStock)
  const controlBefore = lot(a, CONTROL.batchId)

  applyMigration(a)
  applyHelper(twin)

  for (const p of PAIRS) {
    assert.deepStrictEqual(lot(a, p.batchId), lot(twin, p.batchId), `${name}: lot ${p.batchId} equals planUnreceiveBatchStock`)
  }
  assert.deepStrictEqual(lot(a, CONTROL.batchId), controlBefore, `${name}: unpinned lot ${CONTROL.batchId} untouched`)
  assert.strictEqual(auditCount(a), 4, `${name}: one audit row per pair`)

  // Coordinator's literal expectations.
  const l35 = lot(a, 61035)
  assert.deepStrictEqual(
    [l35.received_quantity, l35.received_cost_usd, l35.supplier_name, l35.payment_status, l35.is_active],
    [18, 46.8, 'j secrat', 'paid', 1], `${name}: 61035 -> 18 / 46.8, supplier + paid kept`)
  const l56 = lot(a, 61156)
  assert.deepStrictEqual(
    [l56.received_quantity, l56.received_cost_usd, l56.supplier_name, l56.payment_status, l56.is_active],
    [1, 37.5, 'Lang', 'paid', 1], `${name}: 61156 -> 1 / 37.5, supplier + paid kept`)
  for (const id of [61187, 61155]) {
    const l = lot(a, id)
    assert.deepStrictEqual([l.received_quantity, l.received_cost_usd, l.payment_status, l.credit_due_date], [0, 0, null, null],
      `${name}: ${id} -> 0 / 0, payment cleared`)
    if ((lotStock[id] ?? 0) > 0) {
      assert.strictEqual(l.is_active, 1, `${name}: ${id} still holds stock -> stays active`)
      assert.ok(l.supplier_id != null && l.supplier_name != null && l.unit_cost_usd != null && l.received_branch_id != null,
        `${name}: ${id} still holds stock -> attribution kept`)
    } else {
      assert.deepStrictEqual([l.is_active, l.supplier_id, l.supplier_name, l.unit_cost_usd, l.received_branch_id], [0, null, null, null, null],
        `${name}: ${id} empty everywhere -> attribution cleared, inactive`)
    }
  }
  // The audit row carries the live pre-image (recovery source), not the header literals.
  const audit = a.prepare(`SELECT old_value, details FROM audit_logs WHERE user_name = @u AND record_id = '61035'`).get({ u: AUDIT_USER })
  const old = JSON.parse(audit.old_value)
  assert.deepStrictEqual([old.received_quantity, old.received_cost_usd, old.payment_status, old.supplier_id, old.is_active],
    [19, 49.400000000000006, 'paid', 7, 1], `${name}: audit old_value is the pre-image`)
  assert.strictEqual(JSON.parse(audit.details).revert_movement_id, 46323)

  // Idempotent: a second run is a no-op.
  const snapshot = [...PAIRS, CONTROL].map((p) => lot(a, p.batchId))
  applyMigration(a)
  assert.deepStrictEqual([...PAIRS, CONTROL].map((p) => lot(a, p.batchId)), snapshot, `${name}: re-run changes nothing`)
  assert.strictEqual(auditCount(a), 4, `${name}: re-run adds no audit rows`)
  console.log(`PASS ${name}`)
}

scenario('both whole-lot reverts leave empty lots', { 61035: 18, 61187: 0, 61155: 0, 61156: 1 })
scenario('61155 still holds 2 units (empty-lot guard positive control)', { 61035: 18, 61187: 0, 61155: 2, 61156: 1 })
scenario('61187 still holds 1 unit (empty-lot guard positive control)', { 61035: 18, 61187: 1, 61155: 0, 61156: 1 })

// Drift: 61035 no longer at its measured pre-state -> that pair is a no-op, the other three still apply.
{
  const a = chainBefore(MIGRATION)
  seed(a, { 61035: 19, 61187: 0, 61155: 0, 61156: 1 }, { 61035: { received: 20 } })
  const before = lot(a, 61035)
  applyMigration(a)
  assert.deepStrictEqual(lot(a, 61035), before, 'drifted 61035 untouched')
  assert.strictEqual(auditCount(a), 3, 'drifted pair writes no audit row; other three do')
  assert.strictEqual(lot(a, 61156).received_quantity, 1, 'other pairs still applied')
  console.log('PASS drifted pre-state makes that pair a no-op')
}

// Fresh chain: ids absent -> the file is inert, and the chain still applies end to end.
{
  const sqlite = new Database(':memory:')
  for (const f of migrationFiles) sqlite.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  assert.strictEqual(auditCount(sqlite), 0, 'fresh chain: no audit rows')
  assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) AS n FROM product_batches`).get().n, 0)
  console.log(`PASS full chain applies on an empty database (${migrationFiles.length} migrations, 0163 inert)`)
}

console.log('verify-0163-stale-receipt-reverts: all checks passed')
