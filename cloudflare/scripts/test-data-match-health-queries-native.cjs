#!/usr/bin/env node
// Fixture proof for the DATA-MATCH paired-ledger health queries
// (ops/queries/health-*.sql). Each query runs exactly as the ops workflow runs
// it (the guard's canonical text) on a fresh node:sqlite database built from
// every migration, seeded with the drift each column must count and the
// correct rows it must not. The constants a query copies from the Worker are
// read from the Worker source, so the two cannot drift apart unseen.
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const { loadAll } = require('./harness/load_migrations.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const LIB = path.join(ROOT, 'cloudflare', 'src', 'lib')
const QUERIES = path.join(ROOT, 'ops', 'queries')
const PERSONAL_COLUMN = /(^|_)(name|phone|address|email|note|notes)$/
const LARGE_TABLES = ['inventory_movements', 'sale_items', 'sales', 'products', 'product_batches', 'branch_batch_stock', 'returns', 'sale_item_batch_allocations']
const MAX_CANONICAL_CHARS = 8000
const DAY_MS = 24 * 60 * 60 * 1000
const CAMBODIA_OFFSET_MS = 7 * 60 * 60 * 1000

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'data-match-health-'))
const TEMPLATE = path.join(SCRATCH, 'migrated.sqlite')
const opened = []

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err && err.stack}`)
    process.exitCode = 1
  }
}

function buildTemplate() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of loadAll()) db.exec(sql)
  db.exec(`VACUUM INTO '${TEMPLATE.replace(/'/g, "''")}'`)
  db.close()
}

// A private copy of the migrated schema, so no check sees another's fixtures.
function migratedDatabase() {
  const file = path.join(SCRATCH, `db-${opened.length + 1}.sqlite`)
  fs.copyFileSync(TEMPLATE, file)
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = OFF;')
  // Migration 0243 fences every stock-table write behind a permit row; fixtures seed through it. No query reads it.
  db.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  opened.push(db)
  return db
}

function insert(db, table, rows) {
  for (const row of [].concat(rows)) {
    const columns = Object.keys(row)
    db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})`).run(row)
  }
}

function loadRealLib(fileName, loaded = new Map()) {
  const file = path.join(LIB, fileName)
  if (loaded.has(file)) return loaded.get(file).exports
  const mod = { exports: {} }
  loaded.set(file, mod)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText
  const requireLib = (request) => request.startsWith('./') ? loadRealLib(`${request.slice(2).replace(/\.ts$/, '')}.ts`, loaded) : require(request)
  new Function('require', 'module', 'exports', output)(requireLib, mod, mod.exports)
  return mod.exports
}

const squash = (sql) => sql.replace(/\s+/g, ' ').trim()
const isoDaysAgo = (days, time = '03:00:00') => `${new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10)}T${time}.000Z`
const cambodiaDateDaysAgo = (days) => new Date(Date.now() + CAMBODIA_OFFSET_MS - days * DAY_MS).toISOString().slice(0, 10)

async function main() {
  buildTemplate()
  const guard = await import(pathToFileURL(path.join(ROOT, 'ops', 'scripts', 'ops-sql-guard.mjs')).href)
  const healthQueries = guard.listQueries().filter((name) => name.startsWith('health-'))
  const one = (db, name) => ({ ...db.prepare(guard.loadQuery(name).sql).get() })
  const all = (db, name) => db.prepare(guard.loadQuery(name).sql).all().map((row) => ({ ...row }))
  const pick = (row, keys) => Object.fromEntries(keys.map((key) => [key, row[key]]))

  await check('the fifteen DATA-MATCH health queries exist, pass the guard and run on the bare migrated schema', () => {
    assert.deepEqual(healthQueries, [
      'health-catalog-cost', 'health-identifiers', 'health-legacy-ledgers', 'health-loyalty', 'health-movement-balance',
      'health-movement-balance-rows', 'health-product-family', 'health-r2-references', 'health-references',
      'health-returns-money', 'health-sale-money', 'health-sale-stock-parity', 'health-shift-coverage',
      'health-stock-ledgers', 'health-supplier-lots',
    ])
    const db = migratedDatabase()
    db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)')
    for (const name of healthQueries) {
      const query = guard.loadQuery(name)
      const header = fs.readFileSync(query.file, 'utf8').split(/\r?\n/).filter((line) => line.startsWith('--')).join('\n')
      assert.match(header, /DATA-MATCH/, `${name}: the header names no DATA-MATCH row`)
      assert.match(header, /^-- ops:min-rows \d+$/m, `${name}: no ops:min-rows`)
      assert.match(header, /^-- ops:max-rows \d+$/m, `${name}: no ops:max-rows`)
      assert.ok(query.sql.length <= MAX_CANONICAL_CHARS, `${name}: ${query.sql.length} canonical characters`)
      assert.doesNotMatch(query.sql, /json_object\(/i, `${name}: json_object`)
      const statement = db.prepare(query.sql)
      const columns = statement.columns().map((c) => c.name)
      assert.deepEqual(columns.filter((c) => PERSONAL_COLUMN.test(c)), [], `${name} returns a personal column`)
      for (const column of Array.isArray(query.rules.expectZero) ? query.rules.expectZero : []) assert.ok(columns.includes(column), `${name}: expect-zero names ${column}`)
      const rows = statement.all()
      assert.ok(rows.length >= query.rules.minRows && (query.rules.maxRows === null || rows.length <= query.rules.maxRows), `${name}: ${rows.length} rows`)
    }
  })

  await check('no health query scans a large table beneath a correlated sub-query (the SQLITE_NOMEM shape)', () => {
    const db = migratedDatabase()
    db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)')
    // The plan names an aliased table by its alias only ("SCAN si"), so every
    // alias the SQL gives a large table counts as that table.
    const largeScanNames = (sql) => {
      const names = new Set(LARGE_TABLES)
      for (const [, table, alias] of sql.matchAll(/\b(?:FROM|JOIN) ([a-z_]+)(?: (?:AS )?([a-z_]+))?/gi)) {
        if (LARGE_TABLES.includes(table) && alias && !/^(WHERE|JOIN|LEFT|ON|GROUP|ORDER|UNION|CROSS|INNER|LIMIT)$/i.test(alias)) names.add(alias)
      }
      return names
    }
    const correlatedLargeScans = (sql) => {
      const names = largeScanNames(sql)
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()
      const byId = new Map(plan.map((row) => [row.id, row]))
      const underCorrelated = (row) => {
        for (let node = byId.get(row.parent); node; node = byId.get(node.parent)) if (/^CORRELATED /.test(node.detail)) return true
        return false
      }
      return plan.filter((row) => /^SCAN \w+$/.test(row.detail) && names.has(row.detail.slice(5)) && underCorrelated(row)).map((row) => row.detail)
    }
    assert.deepEqual(correlatedLargeScans('SELECT (SELECT COUNT(*) FROM sale_items si WHERE si.total_usd = s.total_usd) FROM sales s'), ['SCAN si'],
      'the detector sees an aliased correlated scan')
    assert.equal(healthQueries.length, 15, 'no health queries to plan')
    const found = healthQueries.flatMap((name) => correlatedLargeScans(guard.loadQuery(name).sql).map((detail) => `${name}: ${detail}`))
    assert.deepEqual(found, [])
  })

  await check('the constants the health queries copy still match the Worker source', () => {
    const { LEDGER_OUT_TYPES } = loadRealLib('stockLedgerQuery.ts')
    const signed = `CASE WHEN movement_type IN (${LEDGER_OUT_TYPES.map((t) => `'${t}'`).join(', ')}) THEN -ABS(COALESCE(quantity, 0)) ELSE ABS(COALESCE(quantity, 0)) END`
    for (const name of ['health-movement-balance', 'health-movement-balance-rows']) assert.ok(guard.loadQuery(name).sql.includes(signed), `${name} lost the ledger's signed quantity`)
    assert.match(fs.readFileSync(path.join(LIB, 'importEngine.ts'), 'utf8'), /notes: 'Received via product import',/)
    assert.match(fs.readFileSync(path.join(LIB, 'productBatches.ts'), 'utf8'), /@receivedAt,1,'Stock reconciled from product import snapshot',/)
    assert.ok(guard.loadQuery('health-movement-balance-rows').sql.includes("pb.notes IN ('Received via product import', 'Stock reconciled from product import snapshot')"))
    const { STOCK_RECEIPT_MOVEMENT_TYPES } = loadRealLib('stockInSessionsQuery.ts')
    assert.ok(guard.loadQuery('health-supplier-lots').sql.includes(`movement_type IN (${STOCK_RECEIPT_MOVEMENT_TYPES.map((t) => `'${t}'`).join(', ')})`), 'health-supplier-lots lost STOCK_RECEIPT_MOVEMENT_TYPES')
    const { CATALOG_COST_DERIVE_SQL } = loadRealLib('catalogCostRecompute.ts')
    assert.ok(squash(guard.loadQuery('health-catalog-cost').sql).includes(squash(CATALOG_COST_DERIVE_SQL)), 'health-catalog-cost lost CATALOG_COST_DERIVE_SQL')
    const { UPLOAD_REFERENCE_SOURCES } = loadRealLib('uploadReferences.ts')
    const r2 = guard.loadQuery('health-r2-references').sql
    for (const source of UPLOAD_REFERENCE_SOURCES) {
      assert.match(r2, new RegExp(`FROM ${source.table}\\b`), `health-r2-references never reads ${source.table}`)
      const prefiltered = source.table === 'import_job_files' ? [] : source.columns
      for (const column of prefiltered) assert.ok(r2.includes(`instr(lower(${column}), '`), `health-r2-references never reads ${source.table}.${column}`)
    }
    assert.match(fs.readFileSync(path.join(LIB, 'uploadReferences.ts'), 'utf8'), /TERMINAL_IMPORT_STATUS_SQL = `\('completed', 'completed_with_errors', 'failed', 'cancelled'\)`/)
    assert.ok(r2.includes("j.status IN ('completed', 'completed_with_errors', 'failed', 'cancelled')"))
    assert.match(fs.readFileSync(path.join(LIB, 'loyaltyEligibility.ts'), 'utf8'), /\['1', 'true', 'yes', 'on'\]\.includes\(String\(value \?\? ''\)\.trim\(\)\.toLowerCase\(\)\)/)
    const loyalty = guard.loadQuery('health-loyalty').sql
    assert.ok(loyalty.includes("lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'), ''))) IN ('1', 'true', 'yes', 'on')"))
    const { LOYALTY_POINTS_RESET_KEY, loyaltyAfterResetSql } = loadRealLib('customerPointsReturn.ts')
    assert.ok(loyalty.includes(`key = '${LOYALTY_POINTS_RESET_KEY}'`))
    for (const ledger of ['sales', 'returns', 'submissions', 'adjustments']) {
      assert.ok(loyaltyAfterResetSql(ledger).includes(`$.${ledger}`), ledger)
      assert.ok(loyalty.includes(`json_extract(reset_json, '$.${ledger}')`), `health-loyalty reads the ${ledger} checkpoint`)
    }
    const r0 = fs.readFileSync(path.join(QUERIES, 'forensics-r0-return-on-undeducted-sale.sql'), 'utf8')
    const customerReturnReason = "LIKE 'Return: %' OR COALESCE(m.reason, '') LIKE 'Return #%' OR m.reason IN ('Apply grouped return status', 'Undo grouped return status')"
    assert.ok(guard.loadQuery('health-sale-stock-parity').sql.includes(customerReturnReason))
    for (const literal of ["LIKE 'Return: %'", "LIKE 'Return #%'", "IN ('Apply grouped return status', 'Undo grouped return status')"]) assert.ok(r0.includes(literal), literal)
  })

  await check('health-references counts one orphan per owned link, keeps soft links apart, and reads the core invariants', () => {
    const db = migratedDatabase()
    insert(db, 'branches', [{ id: 1, name: 'Store', is_default: 1 }, { id: 2, name: 'Shop' }, { id: 4, name: 'Old', is_default: 1, is_active: 0 }])
    insert(db, 'roles', [{ id: 1, name: 'Admin', code: 'admin' }, { id: 2, name: 'Manager', code: 'manager' }, { id: 3, name: 'Employee', code: 'employee' }, { id: 5, name: 'Employee 2', code: 'employee' }])
    insert(db, 'users', [
      { id: 1, username: 'owner', name: 'Owner', password: 'x', role_id: 1 },
      { id: 2, username: 'gone', name: 'Gone', password: 'x', role_id: 1, is_active: 0 },
      { id: 3, username: 'lost', name: 'Lost', password: 'x', role_id: 980 },
    ])
    insert(db, 'customers', { id: 1, name: 'C' })
    insert(db, 'suppliers', { id: 1, name: 'S' })
    insert(db, 'products', [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'Variant', parent_id: 981 }, { id: 4, name: 'Child', parent_id: 1 }])
    insert(db, 'sales', [{ id: 10, customer_id: 1 }, { id: 11, customer_id: 990 }, { id: 12, cancel_fee_id: 987654 }])
    insert(db, 'sale_items', [{ id: 100, sale_id: 10, product_id: 1 }, { id: 101, sale_id: 99, product_id: 1 }, { id: 102, sale_id: 10, product_id: 999 }])
    insert(db, 'returns', [{ id: 20, customer_id: 1 }, { id: 21, customer_id: 989 }, { id: 22, supplier_id: 988, return_scope: 'supplier' }])
    insert(db, 'return_items', [{ id: 200, return_id: 20 }, { id: 201, return_id: 98 }])
    insert(db, 'product_batches', [
      { id: 50, variant_product_id: 1, batch_key: 'a', supplier_id: 1 },
      { id: 51, variant_product_id: 996, batch_key: 'b' },
      { id: 52, variant_product_id: 1, batch_key: 'c', supplier_id: 988 },
    ])
    insert(db, 'sale_item_batch_allocations', [
      { id: 300, sale_item_id: 100, batch_id: 50, quantity: 1 },
      { id: 301, sale_item_id: 999, batch_id: 50, quantity: 1 },
      { id: 302, sale_item_id: 100, batch_id: 998, quantity: 1 },
    ])
    insert(db, 'return_item_batch_allocations', [{ id: 400, return_item_id: 200, batch_id: 50, quantity: 1 }, { id: 401, return_item_id: 997, batch_id: 50, quantity: 1 }])
    insert(db, 'branch_batch_stock', [{ batch_id: 50, branch_id: 1, quantity: 0 }, { batch_id: 994, branch_id: 1, quantity: 0 }, { batch_id: 50, branch_id: 993, quantity: 0 }])
    insert(db, 'branch_stock', [{ product_id: 1, branch_id: 1 }, { product_id: 992, branch_id: 1 }, { product_id: 2, branch_id: 991 }])
    insert(db, 'fees', [{ id: 987000, fee_date: '2026-09-20', sale_id: 10 }, { id: 987001, fee_date: '2026-09-20', sale_id: 986 }])
    // 0251 refuses a positive award while the programme is off; an orphan row is what this check needs
    db.exec('DROP TRIGGER loyalty_award_on_insert')
    insert(db, 'loyalty_point_adjustments', [{ customer_id: 1, points: 1 }, { customer_id: 985, points: 1 }])
    insert(db, 'customer_receivables', [
      { legacy_id: 'r1', customer_id: 1, customer_name: 'C', invoice_date: '2026-01-01', status: 'Paid', source_file: 'f', source_row: 1 },
      { legacy_id: 'r2', customer_id: 984, customer_name: 'C', invoice_date: '2026-01-01', status: 'Paid', source_file: 'f', source_row: 2 },
    ])
    insert(db, 'product_images', [{ product_id: 1, image_path: '/uploads/a.png' }, { product_id: 983, image_path: '/uploads/b.png' }])
    insert(db, 'damaged_stock_lots', [{ product_id: 1 }, { product_id: 982 }])
    insert(db, 'inventory_movements', [{ product_id: 1, movement_type: 'add', quantity: 1 }, { product_id: 979, movement_type: 'add', quantity: 1 }])
    const row = one(db, 'health-references')
    const orphanColumns = Object.keys(row).filter((key) => key.endsWith('_orphans'))
    assert.equal(orphanColumns.length, 22)
    assert.deepEqual(orphanColumns.filter((key) => row[key] !== 1), [], 'every owned link has exactly one orphan')
    assert.deepEqual(pick(row, ['soft_sale_item_product', 'soft_movement_product', 'core_active_default_branches', 'core_system_roles', 'core_active_admins']),
      { soft_sale_item_product: 1, soft_movement_product: 1, core_active_default_branches: 1, core_system_roles: 3, core_active_admins: 1 })
    insert(db, 'branches', { id: 3, name: 'Second default', is_default: 1 })
    assert.equal(one(db, 'health-references').core_active_default_branches, 2)
  })

  await check('health-stock-ledgers counts roll-up drift, lot/branch disagreement, damaged units and stocked group headers', async () => {
    const db = migratedDatabase()
    // 0242 refuses stock on an inactive product from now on; these are the rows that predate it (the census inactive-products-with-stock.sql counts them).
    db.exec('DROP TRIGGER product_insert_stock_0242')
    db.exec('DROP TRIGGER damaged_stock_insert_active_0242')
    insert(db, 'branches', { id: 1, name: 'Store', is_default: 1 })
    insert(db, 'products', [
      { id: 1, name: 'Drift', stock_quantity: 5 }, { id: 2, name: 'Gone', stock_quantity: 3, is_active: 0 },
      { id: 3, name: 'No row' }, { id: 4, name: 'Lots high', stock_quantity: 2 }, { id: 5, name: 'Unlotted', stock_quantity: 5 },
      { id: 6, name: 'Legacy', stock_quantity: 7 }, { id: 7, name: 'Residue', stock_quantity: 1 },
      { id: 8, name: 'Header', is_group: 1, parent_id: 0, stock_quantity: 1 }, { id: 9, name: 'Empty header', is_group: 1, parent_id: 0 },
      { id: 10, name: 'Lots equal', stock_quantity: 2 },
    ])
    insert(db, 'branch_stock', [
      { product_id: 1, branch_id: 1, quantity: 4 }, { product_id: 4, branch_id: 1, quantity: 2 }, { product_id: 5, branch_id: 1, quantity: 5 },
      { product_id: 6, branch_id: 1, quantity: 7 }, { product_id: 7, branch_id: 1, quantity: 1.000000001 },
      { product_id: 8, branch_id: 1, quantity: 1 }, { product_id: 9, branch_id: 1, quantity: 0 },
      { product_id: 10, branch_id: 1, quantity: 2 },
    ])
    insert(db, 'product_batches', [
      { id: 41, variant_product_id: 4, batch_key: 'l41' }, { id: 51, variant_product_id: 5, batch_key: 'l51' },
      { id: 61, variant_product_id: 6, batch_key: 'l61', is_active: 0 },
      { id: 101, variant_product_id: 10, batch_key: 'l101' },
    ])
    insert(db, 'branch_batch_stock', [
      { batch_id: 41, branch_id: 1, quantity: 3 }, { batch_id: 51, branch_id: 1, quantity: 3 }, { batch_id: 61, branch_id: 1, quantity: 0 },
      { batch_id: 101, branch_id: 1, quantity: 2 },
    ])
    insert(db, 'damaged_stock_lots', [{ product_id: 2, quantity_remaining: 2 }, { product_id: 1, quantity_remaining: 1 }, { product_id: 999, quantity_remaining: 1 }])
    const row = one(db, 'health-stock-ledgers')
    assert.deepEqual(row, {
      rollup_drift_products: 2, rollup_drift_active: 1, rollup_drift_units: 4, active_products_without_branch_row: 1,
      pairs_lots_exceed_branch: 1, tracked_pairs_unlotted: 1, tracked_units_unlotted: 2,
      damaged_remaining_on_inactive_product: 2, group_headers_with_stock: 1,
    })
    assert.equal(row.pairs_lots_exceed_branch, one(db, 'lots-exceed-branch-stock').pairs_lots_exceed_branch, 'the same figure as lots-exceed-branch-stock')
    const { getTrackedProductIds } = loadRealLib('productBatches.ts')
    const d1 = { prepare: (sql) => ({ all: async (params) => db.prepare(sql).all(params || {}) }) }
    const tracked = new Set(await getTrackedProductIds(d1, 1))
    assert.ok(tracked.has(5) && !tracked.has(6), 'an active lot is tracked, an inactive empty one is not')
    const lotSum = new Map(db.prepare('SELECT pb.variant_product_id AS pid, SUM(bbs.quantity) AS q FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id = bbs.batch_id WHERE bbs.branch_id = 1 GROUP BY pb.variant_product_id').all().map((r) => [r.pid, r.q]))
    const unlottedOnTill = db.prepare('SELECT product_id, quantity FROM branch_stock WHERE branch_id = 1').all()
      .filter((b) => tracked.has(b.product_id) && b.quantity - (lotSum.get(b.product_id) || 0) > 0.000001)
    assert.equal(row.tracked_pairs_unlotted, unlottedOnTill.length, 'tracked pairs as the till (getTrackedProductIds) sees them')
  })

  await check('health-movement-balance holds still under correct writes and moves only for stock changed without a movement', () => {
    const db = migratedDatabase()
    insert(db, 'products', { id: 1, name: 'A' })
    insert(db, 'branch_stock', [{ product_id: 1, branch_id: 1, quantity: 4 }, { product_id: 1, branch_id: 2, quantity: 2 }])
    insert(db, 'inventory_movements', [
      { id: 1, product_id: 1, branch_id: 1, movement_type: 'add', quantity: 10 },
      { id: 2, product_id: 1, branch_id: 1, movement_type: 'sale', quantity: -2 },
      { id: 3, product_id: 1, branch_id: 1, movement_type: 'remove', quantity: 1 },
      { id: 4, product_id: 1, branch_id: 1, movement_type: 'remove', quantity: -1 },
      { id: 5, product_id: 1, branch_id: 1, movement_type: 'transfer_out', quantity: 2 },
      { id: 6, product_id: 1, branch_id: 2, movement_type: 'transfer_in', quantity: 2 },
    ])
    const balance = () => one(db, 'health-movement-balance')
    const clean = balance()
    assert.deepEqual(pick(clean, ['products_seen', 'products_unbalanced', 'product_checksum', 'pairs_unbalanced', 'pair_checksum', 'movement_rows', 'max_movement_id']),
      { products_seen: 1, products_unbalanced: 0, product_checksum: 0, pairs_unbalanced: 0, pair_checksum: 0, movement_rows: 6, max_movement_id: 6 })
    assert.deepEqual(all(db, 'health-movement-balance-rows'), [])
    db.exec('UPDATE branch_stock SET quantity = quantity - 1 WHERE product_id = 1 AND branch_id = 1')
    db.exec('UPDATE branch_stock SET quantity = quantity + 1 WHERE product_id = 1 AND branch_id = 2')
    const legless = balance()
    assert.deepEqual([legless.products_unbalanced, legless.product_checksum, legless.pairs_unbalanced], [0, 0, 2], 'a leg-less branch move leaves the product balanced')
    assert.notEqual(legless.pair_checksum, 0)
    db.exec('UPDATE branch_stock SET quantity = quantity - 1 WHERE product_id = 1 AND branch_id = 2')
    const lost = balance()
    assert.deepEqual([lost.products_unbalanced, lost.product_abs_implied, lost.pairs_unbalanced], [1, 1, 1], 'a unit gone with no movement')
    assert.notEqual(lost.product_checksum, 0)
    const rows = all(db, 'health-movement-balance-rows')
    assert.deepEqual(rows.map((r) => [r.product_id, r.branch_id, r.implied_opening, r.on_hand, r.movement_net, r.movement_rows, r.last_movement_id, r.unbalanced_pairs_total]),
      [[1, 1, -1, 3, 4, 5, 5, 1]])
  })

  await check('health-movement-balance counts the explained sources beside the checksum: a merge that carries stock, and the damaged pool', () => {
    const db = migratedDatabase()
    insert(db, 'products', [{ id: 5, name: 'Keeper' }, { id: 8, name: 'Returned damaged' }, { id: 9, name: 'Held' }, { id: 10, name: 'Balanced' },
      { id: 11, name: 'Disposed' }, { id: 12, name: 'Written off' }])
    insert(db, 'branch_stock', [
      { product_id: 5, branch_id: 1, quantity: 12 }, { product_id: 8, branch_id: 1, quantity: 10 }, { product_id: 9, branch_id: 1, quantity: 7 }, { product_id: 10, branch_id: 1, quantity: 4 },
      { product_id: 11, branch_id: 1, quantity: 7 }, { product_id: 12, branch_id: 1, quantity: 4 },
    ])
    insert(db, 'damaged_stock_lots', [
      { product_id: 8, branch_id: 1, quantity: 2, quantity_remaining: 2 }, { product_id: 9, branch_id: 1, quantity: 3, quantity_remaining: 3 },
      { product_id: 11, branch_id: 1, quantity: 3, quantity_remaining: 0 },
    ])
    const move = (id, productId, type, quantity, extra = {}) => ({ id, product_id: productId, branch_id: 1, movement_type: type, quantity, ...extra })
    insert(db, 'inventory_movements', [
      // keeper: 5 own units, the duplicate's 7 reparented onto it, and the 7 written again as an adjustment (the F1 double count)
      move(1, 5, 'add', 5), move(2, 5, 'add', 7), move(3, 5, 'adjustment', 7, { reason: 'Merged duplicate product "Old" (#6) into this product -- review 3' }),
      // a damaged return puts 2 units into the held pool: a ledger row, no branch_stock change
      move(4, 8, 'add', 10), move(5, 8, 'damage_in', 2, { reference_id: '55', reason: 'broken seal' }),
      // a hold moves 3 units from sellable stock into the pool: -3 in both ledgers, balanced
      move(6, 9, 'add', 10), move(7, 9, 'damage_out', 3, { reference_id: 'session-1', reason: 'damaged: dropped' }),
      move(8, 10, 'add', 4),
      // a merge-looking reason on a movement that is not an adjustment is not counted
      move(9, 10, 'remove', 0, { reason: 'Merged duplicate product "X" (#2) into this product' }),
      // disposing a held row writes a write_off of units that were never in branch_stock (referenced damaged_lot:<id>, no damage type); a plain write_off of sellable stock is balanced and not held
      move(10, 11, 'add', 10), move(11, 11, 'damage_out', 3, { reference_id: 'session-2' }), move(12, 11, 'write_off', 3, { reference_id: 'damaged_lot:9' }),
      move(13, 12, 'add', 6), move(14, 12, 'write_off', 2, { reference_id: 'product_remove:op-1:1' }),
    ])
    const row = one(db, 'health-movement-balance')
    assert.deepEqual(pick(row, ['products_seen', 'products_unbalanced', 'pairs_unbalanced', 'movement_rows', 'merge_adjustment_rows', 'held_movement_rows', 'held_pool_units']),
      { products_seen: 6, products_unbalanced: 3, pairs_unbalanced: 3, movement_rows: 14, merge_adjustment_rows: 1, held_movement_rows: 4, held_pool_units: 5 })
    assert.deepEqual(all(db, 'health-movement-balance-rows').map((r) => [r.product_id, r.implied_opening, r.merge_rows, r.held_rows, r.held_remaining]),
      [[5, -7, 1, 0, 0], [8, -2, 0, 1, 2], [11, 3, 0, 2, 0]], 'each unbalanced pair says which explained source it carries; the balanced hold is absent')
  })

  await check('health-movement-balance-rows names the newest movement-less products-import lot of a pair, and no other lot', () => {
    const db = migratedDatabase()
    insert(db, 'products', [{ id: 1, name: 'Hand loss' }, { id: 2, name: 'Imported new' }, { id: 3, name: 'Snapshot raised' }])
    insert(db, 'branch_stock', [{ product_id: 1, branch_id: 1, quantity: 3 }, { product_id: 2, branch_id: 1, quantity: 5 }, { product_id: 3, branch_id: 1, quantity: 4 }])
    insert(db, 'inventory_movements', [
      { id: 1, product_id: 1, branch_id: 1, movement_type: 'add', quantity: 4 },
      { id: 2, product_id: 3, branch_id: 1, movement_type: 'add', quantity: 3 },
    ])
    insert(db, 'product_batches', [
      { id: 69, variant_product_id: 2, batch_key: 'snap-old', notes: 'Stock reconciled from product import snapshot' },
      { id: 70, variant_product_id: 2, batch_key: 'import-new', notes: 'Received via product import' },
      { id: 71, variant_product_id: 3, batch_key: 'received', notes: 'Received' },
      { id: 72, variant_product_id: 3, batch_key: 'snap', notes: 'Stock reconciled from product import snapshot' },
      { id: 73, variant_product_id: 1, batch_key: 'merged', notes: 'Stock merged via product import' },
      { id: 74, variant_product_id: 1, batch_key: 'other-branch', notes: 'Received via product import' },
    ])
    insert(db, 'branch_batch_stock', [
      { batch_id: 69, branch_id: 1, quantity: 0 }, { batch_id: 70, branch_id: 1, quantity: 5 },
      { batch_id: 71, branch_id: 1, quantity: 3 }, { batch_id: 72, branch_id: 1, quantity: 1 },
      { batch_id: 73, branch_id: 1, quantity: 3 }, { batch_id: 74, branch_id: 2, quantity: 0 },
    ])
    assert.deepEqual(all(db, 'health-movement-balance-rows').map((r) => [r.product_id, r.branch_id, r.implied_opening, r.import_lot_id]),
      [[1, 1, -1, null], [2, 1, 5, 70], [3, 1, 1, 72]])
  })

  await check('health-sale-money counts v1 headers off their lines or rule, and the paid-within-half-a-cent rule both ways', () => {
    const db = migratedDatabase()
    const v1 = (id, subtotal, calc, adj, total, khr, extra = {}) => ({ id, money_precision_version: 1, subtotal_usd: subtotal, calculated_total_usd: calc,
      rounding_adjustment_usd: adj, total_usd: total, total_khr: khr, exchange_rate: 4100, amount_paid_usd: total, ...extra })
    const v0 = (id, total, extra = {}) => ({ id, total_usd: total, subtotal_usd: total, exchange_rate: 4100, amount_paid_usd: total, ...extra })
    insert(db, 'sales', [
      v1(1, 3.2345, 3.2345, -0.0045, 3.23, 13243), v1(2, 3.2346, 3.2346, -0.0046, 3.23, 13243), v1(3, 3.2345, 3.2345, -0.0045, 3.23, 13244),
      v1(4, 5, 5, 0, 5, 20500, { discount_usd: 1 }), v1(5, 5, 7, 0, 7, 28700, { is_delivery: 1, delivery_fee_usd: 2, delivery_fee_paid_by: 'customer' }),
      v1(6, 5, 5, 0, 5, 20500, { is_delivery: 1, delivery_fee_usd: 2, delivery_fee_paid_by: 'store' }),
      v0(8, 9.99, { amount_paid_usd: 9, amount_paid_khr: 4000 }), v0(9, 9.99, { amount_paid_usd: 9, amount_paid_khr: 4050 }),
      v0(10, 5, { sale_status: 'awaiting_payment' }), v0(11, 5, { sale_status: 'awaiting_payment', amount_paid_usd: 0 }),
      v0(12, 0), v0(13, 0, { legacy_receipt_number: '000013@2026-01-01' }), v0(14, -1), v0(15, 5, { exchange_rate: 0 }),
      v0(16, 10),
      // Two-status model (0263) and the debt half of returns (0260). Each row is the control or the positive of one rule.
      v0(17, 10, { amount_paid_usd: 6 }),                                                                    // paid after a return lowered its debt by 4: NOT short
      v0(18, 10, { amount_paid_usd: 6 }),                                                                    // a cash refund lowers no debt: short
      v0(19, 10, { amount_paid_usd: 6, sale_status: 'returned', status_before_return: 'completed' }),        // retired label over a paid sale: short
      v0(20, 10, { sale_status: 'partial_return', status_before_return: 'awaiting_payment' }),               // retired label over Not Paid, tender covers it
      v0(21, 10, { sale_status: 'partial_return', status_before_return: 'awaiting_payment', amount_paid_usd: 3 }), // reads Not Paid, tender does not cover: neither column
      v0(22, 10, { amount_paid_usd: 0, client_request_id: 'sales-import:job-1:7' }),                          // the sales import keeps its own receipt format: not a system sale
      v1(23, 5, 7, 0, 7, 28700, { is_delivery: 1, delivery_fee_usd: 2, delivery_fee_paid_by: null }),         // a missing payer reads as the customer (saleTotals.ts customerBilledDeliveryFeeUsd)
      v0(24, 10, { sale_status: 'awaiting_payment', amount_paid_usd: 0 }),                                   // Not Paid whose returns lowered the whole debt: owes 0, tender covers nothing
    ])
    // payment_events_mismatch (0271): version 1 sales whose events (in minus out) differ from what the sale says was paid.
    // Imported rows, so no other column moves. 25 and 28 are the controls: a version 0 sale needs no events, and the match is signed.
    const pv1 = (id, extra) => v0(id, 5, { legacy_receipt_number: `0000${id}@2026-01-01`, payments_version: 1, ...extra })
    insert(db, 'sales', [
      pv1(25, { amount_paid_usd: 5 }), pv1(26, { amount_paid_usd: 5 }), pv1(27, { amount_paid_usd: 5 }), pv1(28, { amount_paid_usd: 5 }),
      pv1(29, { amount_paid_usd: 0, amount_paid_khr: 40000 }), pv1(30, { amount_paid_usd: 0, amount_paid_khr: 40000 }),
      pv1(31, { amount_paid_usd: 5 }), pv1(32, { amount_paid_usd: 0, sale_status: 'awaiting_payment' }),
      v0(33, 5, { legacy_receipt_number: '000033@2026-01-01', amount_paid_usd: 5 }),
    ])
    const pev = (saleId, n, direction, usd, khr = 0) => ({ event_id: `t${saleId}-${n}`, sale_id: saleId, direction, origin: direction === 'out' ? 'undo' : 'collect',
      payment_method: 'Cash', payment_details: '[]', amount_paid_usd: usd, amount_paid_khr: khr, exchange_rate: 4100, received_at: '2026-10-25 03:00:00' })
    insert(db, 'sale_payment_events', [
      pev(25, 1, 'in', 5),                                    // matches
      pev(26, 1, 'in', 5), pev(26, 2, 'out', 2),              // 3 against 5 paid: mismatch
      pev(27, 1, 'in', 3),                                    // 3 against 5 paid: mismatch
      pev(28, 1, 'in', 10), pev(28, 2, 'out', 5),             // signed: 5 against 5 paid, matches
      pev(29, 1, 'in', 0, 40000),                             // riel matches
      pev(30, 1, 'in', 0, 39999),                             // riel differs by one: mismatch
      pev(31, 1, 'in', 5.00004),                              // inside the 4 dp tolerance: matches
      // 32: version 1, nothing paid, no event: matches. 27 above, and a paid version 1 sale with no event, are the mismatches:
    ])
    insert(db, 'sales', pv1(34, { amount_paid_usd: 5 }))     // paid $5, no event at all: mismatch
    db.exec('DROP TRIGGER sales_money_precision_insert')
    db.exec('DROP TRIGGER sales_money_precision_update_0161')
    insert(db, 'sales', v1(7, 3.2351, 3.2351, -0.0051, 3.23, 13243))
    const lines = { 1: [1.2345, 2], 2: [1.2345, 2], 3: [1.2345, 2], 4: [5], 5: [5], 6: [5], 7: [3.2351], 8: [9.99], 9: [9.99], 10: [5], 11: [5], 14: [-1], 15: [5], 16: [8],
      17: [10], 18: [10], 19: [10], 20: [10], 21: [10], 22: [10], 23: [5], 24: [10] }
    let lineId = 0
    for (const [saleId, totals] of Object.entries(lines)) for (const total of totals) insert(db, 'sale_items', { id: lineId += 1, sale_id: Number(saleId), total_usd: total })
    const refund = (id, saleId, extra) => ({ id, sale_id: saleId, return_scope: 'customer', status: 'completed', exchange_rate: 4100, total_refund_usd: 4, refund_currency: 'USD', ...extra })
    insert(db, 'returns', [
      refund(1, 17, { owed_reduction_usd: 4 }), refund(2, 18, { owed_reduction_usd: 0 }), refund(3, 24, { total_refund_usd: 10, owed_reduction_usd: 10 }),
      refund(4, 8, { owed_reduction_usd: 0.5, status: 'cancelled' }), refund(5, 8, { owed_reduction_usd: 0.5, return_scope: 'supplier' }),
    ])
    assert.deepEqual(one(db, 'health-sale-money'), {
      v1_sales: 8, v1_subtotal_ne_lines: 1, v1_calc_ne_components: 1, v1_payable_equation: 1, v1_khr_twin: 1, v0_header_drift: 1,
      completed_short: 3, not_paid_but_covered: 2, system_sales_without_lines: 1, negative_totals: 1, bad_rate: 1,
      payment_events_mismatch: 4,
    })
  })

  await check('health-sale-money applies lib/saleStatusResolution.ts paymentCoversSaleTotal to every tender at the half-cent edge', () => {
    const { paymentCoversSaleTotal } = loadRealLib('saleStatusResolution.ts')
    const db = migratedDatabase()
    let seed = 20260929
    const next = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    let covered = 0
    for (let id = 1; id <= 300; id += 1) {
      const totalCents = 100 + next(5000)
      const shortRiel = next(120) - 20
      const usdCents = totalCents - 1 - next(3)
      const paidKhr = Math.round(((totalCents - usdCents) / 100) * 4100) - shortRiel
      const tender = { totalUsd: totalCents / 100, paidUsd: usdCents / 100, paidKhr, exchangeRate: 4100 }
      if (paymentCoversSaleTotal(tender)) covered += 1
      insert(db, 'sales', { id, total_usd: tender.totalUsd, subtotal_usd: tender.totalUsd, amount_paid_usd: tender.paidUsd, amount_paid_khr: paidKhr, exchange_rate: 4100 })
      insert(db, 'sales', { id: 1000 + id, sale_status: 'awaiting_payment', total_usd: tender.totalUsd, subtotal_usd: tender.totalUsd, amount_paid_usd: tender.paidUsd, amount_paid_khr: paidKhr, exchange_rate: 4100 })
    }
    assert.ok(covered > 30 && covered < 270, `${covered} of 300 covered: the tenders do not straddle the edge`)
    const row = one(db, 'health-sale-money')
    assert.deepEqual([row.completed_short, row.not_paid_but_covered], [300 - covered, covered])
  })

  await check('health-returns-money counts refund-rule drift, pre-0260 returns on Not Paid, and the return tag against its evidence', () => {
    const db = migratedDatabase()
    const sale = (id, status, total, extra = {}) => ({ id, sale_status: status, total_usd: total, amount_paid_usd: total, ...extra })
    insert(db, 'sales', [
      sale(2, 'awaiting_payment', 5, { amount_paid_usd: 0 }), sale(3, 'returned', 5), sale(4, 'completed', 5),
      sale(5, 'partial_return', 5, { status_before_return: 'awaiting_payment', amount_paid_usd: 0 }),
      sale(6, 'completed', 5, { status_before_return: 'awaiting_payment' }), sale(7, 'partial_return', 5),
      sale(8, 'partial_return', 100), sale(9, 'partial_return', 5), sale(10, 'partial_return', 50),
      // the two-status model: a return is a tag beside the payment state, never a status
      sale(11, 'completed', 5, { return_state: 'partial' }),
      sale(12, 'completed', 5, { return_state: 'full' }),
      sale(13, 'completed', 5),
      sale(14, 'completed', 5, { return_state: 'partial' }),
      sale(15, 'cancelled', 5, { return_state: 'full' }),
      sale(16, 'completed', 5),
      sale(17, 'completed', 5, { return_state: 'full' }),
      // the debt half of a return (0260)
      sale(18, 'awaiting_payment', 10, { amount_paid_usd: 0, return_state: 'partial' }),
      sale(19, 'awaiting_payment', 10, { amount_paid_usd: 0, return_state: 'partial' }),
      sale(20, 'completed', 10, { return_state: 'partial' }),
      sale(21, 'partial_return', 10, { status_before_return: 'awaiting_payment', amount_paid_usd: 0 }),
      sale(22, 'completed', 100, { return_state: 'partial' }),
      // pre-0260 whole-refund rows: on a Not Paid sale they are the debt lowered (8 of a 5 debt), on a paid sale they are cash and lower nothing
      sale(23, 'awaiting_payment', 5, { amount_paid_usd: 0, return_state: 'partial' }),
      sale(24, 'completed', 5, { return_state: 'partial' }),
    ])
    insert(db, 'sale_items', [{ id: 1, sale_id: 16, product_id: 1, quantity: 3, returned_quantity: 2 }, { id: 2, sale_id: 17, product_id: 1, quantity: 1, returned_quantity: 1 }])
    const ret = (id, saleId, extra = {}) => ({ id, sale_id: saleId, return_scope: 'customer', status: 'completed', exchange_rate: 4100, ...extra })
    const v1 = (usd, calc, adj, khr, extra = {}) => ({ money_precision_version: 1, total_refund_usd: usd, calculated_refund_usd: calc, rounding_adjustment_usd: adj, total_refund_khr: khr, ...extra })
    insert(db, 'returns', [
      ret(1, 7, v1(5, 4.995, 0.005, 20500)), ret(2, 8, v1(1, 1, 0, 4101)), ret(3, 8, { total_refund_usd: 0, total_refund_khr: 4100 }),
      ret(4, 9, v1(3, 3, 0, 12300)), ret(5, 9, v1(3, 3, 0, 12300)), ret(6, 2, { total_refund_usd: 1 }), ret(7, 5, { total_refund_usd: 1 }),
      ret(8, 6, { total_refund_usd: 1 }), ret(9, 3, { status: 'cancelled', total_refund_usd: 5 }), ret(10, 4, { total_refund_usd: 1 }),
      ret(11, 999, { total_refund_usd: 1 }), ret(12, null, { return_scope: 'supplier', total_refund_khr: 4100 }),
      ret(13, 2, { status: 'cancelled', total_refund_usd: 1 }),
      ret(15, 11, v1(2, 2, 0, 8200)), ret(16, 13, { total_refund_usd: 1 }), ret(17, 14, { status: 'cancelled', total_refund_usd: 1 }),
      // two lowered 6 of a $10 debt: more than the sale ever owed
      ret(18, 18, { total_refund_usd: 6, refund_currency: 'USD', owed_reduction_usd: 6 }), ret(19, 18, { total_refund_usd: 6, refund_currency: 'USD', owed_reduction_usd: 6 }),
      // no refund_currency = recorded before 0260: a whole-cash refund on a Not Paid sale is counted, on a paid sale it is not
      ret(20, 19, { total_refund_usd: 4 }), ret(21, 20, { total_refund_usd: 4 }), ret(22, 21, { total_refund_usd: 3 }),
      // riel refunds: exact twin, 50 riel under it, a full 100 under it, over it
      ret(23, 22, v1(4, 4, 0, 16400, { refund_currency: 'KHR' })), ret(24, 22, v1(4, 4, 0, 16350, { refund_currency: 'KHR' })),
      ret(25, 22, v1(4, 4, 0, 16300, { refund_currency: 'KHR' })), ret(26, 22, v1(4, 4, 0, 16401, { refund_currency: 'KHR' })),
      ret(27, 23, { total_refund_usd: 4 }), ret(28, 23, { total_refund_usd: 4 }), ret(29, 24, { total_refund_usd: 4 }), ret(30, 24, { total_refund_usd: 4 }),
    ])
    db.exec('DROP TRIGGER returns_money_precision_insert')
    insert(db, 'returns', ret(14, 10, v1(5, 4.99, 0.01, 20500)))
    assert.deepEqual(one(db, 'health-returns-money'), {
      customer_returns: 29, v1_refund_equation: 1, v1_refund_khr_twin: 1, v1_refund_khr_paid: 2, riel_only_customer_returns: 1, sales_refunded_over_total: 1,
      returns_on_not_paid_before_0260: 6, debt_lowered_over_total: 2, returns_on_missing_sale: 1,
      return_tag_without_evidence: 3, return_evidence_without_tag: 5, retired_return_labels: 7,
    })
    assert.equal(all(db, 'forensics-u11-return-on-not-paid-sale').length, 6, 'the U11 count and the U11 row list agree')
  })

  await check('health-sale-stock-parity lists system sales whose stock did not move by the line quantity', () => {
    const db = migratedDatabase()
    const recent = isoDaysAgo(2)
    const sale = (id, extra = {}) => ({ id, branch_id: 1, created_at: recent, ...extra })
    insert(db, 'sales', [
      sale(501), sale(502), sale(503, { sale_status: 'cancelled' }), sale(504, { sale_status: 'cancelled' }), sale(505),
      sale(506, { legacy_receipt_number: '000506@2026-09-01' }), sale(507, { stock_skipped: 1 }), sale(508, { created_at: '2026-09-04T03:00:00.000Z' }),
      sale(509, { source_return_id: 1 }), sale(510, { sale_status: 'cancelled' }), sale(511), sale(512),
      // the two-status model: a return is a tag beside the status, and the sales import and the unified stock import have their own shapes
      sale(513, { sale_status: 'partial_return', status_before_return: 'completed' }), sale(514, { return_state: 'full' }), sale(515, { cashier_name: 'Unified stock import' }),
      sale(516, { sale_status: 'awaiting_payment' }), sale(517, { client_request_id: 'sales-import:job-1:3', stock_skipped: 1 }),
      sale(518),
    ])
    for (const id of [501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511, 512, 513, 514, 515, 516, 517]) insert(db, 'sale_items', { id: id + 100, sale_id: id, product_id: 1, quantity: id === 501 || id === 514 || id === 515 ? 2 : 1 })
    const move = (ref, type, quantity, reason = 'Sale') => ({ product_id: 1, branch_id: 1, movement_type: type, quantity, reference_id: ref, reason })
    insert(db, 'inventory_movements', [
      move(501, 'sale', 2), move(503, 'sale', 1), move(503, 'return', 1, 'Mistake'), move(504, 'sale', 1),
      move(505, 'sale', 1), move(505, 'return', 1, 'Return: RT-505'), move(510, 'sale', 1), move(510, 'return', 1, 'Mistake'),
      move(511, 'sale', 1), move(512, 'sale', 2),
      move(513, 'sale', 1), move(513, 'return', 1, 'Return: RT-513'),
      move(514, 'sale', 2), move(514, 'return', 1, 'Return #RT-514 updated: wrong shade'), move(514, 'return', 1, 'Apply grouped return status'),
      move(515, 'sale', -2, 'Unified stock import job-1, group sale, row 4'),
    ])
    // a line sold out of a held damaged lot writes 'damage_out', not 'sale': it is outside this ledger, and the regular line of the same product beside it still counts
    insert(db, 'sale_items', [{ id: 800, sale_id: 518, product_id: 1, quantity: 2, damaged_lot_id: 1 }, { id: 801, sale_id: 518, product_id: 1, quantity: 1 }])
    insert(db, 'inventory_movements', [move(518, 'damage_out', -2, 'Sale'), move(518, 'sale', 1)])
    insert(db, 'sale_item_batch_allocations', [{ sale_item_id: 610, batch_id: 1, branch_id: 1, quantity: 1 }, { sale_item_id: 611, batch_id: 1, branch_id: 1, quantity: 2 }])
    assert.deepEqual(all(db, 'health-sale-stock-parity').map((r) => [r.sale_id, r.class, r.line_qty, r.deducted_now, r.alloc_held]), [
      [502, 'undeducted', 1, 0, 0], [504, 'cancelled_still_deducted', 1, 1, 0], [510, 'cancelled_alloc_held', 1, 0, 1],
      [511, 'alloc_over_line', 1, 1, 2], [512, 'over_deducted', 1, 2, 0], [516, 'undeducted', 1, 0, 0],
    ])
  })

  await check('health-shift-coverage counts drawer events no shift window holds, and shifts left open or uncounted', () => {
    const db = migratedDatabase()
    const day = isoDaysAgo(2, '00:00:00').slice(0, 10)
    const at = (time) => `${day}T${time}.000Z`
    const shift = (id, extra) => ({ id, shift_code: `SH${id}`, business_date: cambodiaDateDaysAgo(2), scope_mode: 'per_account', ...extra })
    insert(db, 'shift_sessions', [
      shift(1, { user_id: 1, branch_id: 1, opened_at: at('01:00:00'), closed_at: at('10:00:00'), closing_counted_usd: 100 }),
      shift(2, { user_id: 5, branch_id: 1, business_date: cambodiaDateDaysAgo(1), opened_at: isoDaysAgo(1, '01:00:00') }),
      shift(3, { user_id: 6, branch_id: 1, business_date: cambodiaDateDaysAgo(5), opened_at: isoDaysAgo(5, '01:00:00'), closed_at: isoDaysAgo(5, '02:00:00') }),
      shift(4, { user_id: 7, branch_id: 1, business_date: cambodiaDateDaysAgo(6), opened_at: isoDaysAgo(6, '10:00:00'), closed_at: isoDaysAgo(6, '09:00:00'), closing_counted_khr: 0 }),
    ])
    insert(db, 'sales', [
      { id: 701, cashier_id: 1, branch_id: 1, created_at: at('02:00:00') },
      { id: 702, cashier_id: 2, branch_id: 1, created_at: at('03:00:00') },
      { id: 703, cashier_id: 2, branch_id: 1, created_at: at('03:00:00'), legacy_receipt_number: '000703@2026-09-01' },
      // origin: the unified stock import writes a sale with no cashier at its own date (not a drawer event); an exchange replacement is rung at the till
      { id: 704, branch_id: 1, created_at: at('03:00:00'), creation_snapshot_json: '{"origin":"stock_action_import"}' },
      { id: 705, cashier_id: 1, branch_id: 1, created_at: at('02:30:00'), creation_snapshot_json: '{"origin":"pos"}' },
      { id: 706, cashier_id: 2, branch_id: 1, created_at: at('03:30:00'), creation_snapshot_json: '{"origin":"return_replacement"}' },
      // the two import origins are not drawer events; any other origin is a till sale, so a replayed offline sale outside every shift is still flagged
      { id: 707, branch_id: 1, created_at: at('03:00:00'), creation_snapshot_json: '{"origin":"sales_import"}' },
      { id: 708, cashier_id: 2, branch_id: 1, created_at: at('03:15:00'), creation_snapshot_json: '{"origin":"offline_replay"}' },
    ])
    insert(db, 'returns', [
      { id: 801, cashier_id: 1, branch_id: 1, created_at: at('11:00:00') },
      { id: 802, cashier_id: 1, branch_id: 1, created_at: `${day} 04:00:00` },
    ])
    insert(db, 'fees', [
      { id: 990001, fee_date: day, created_by: 1, created_at: `${day} 05:00:00` },
      { id: 990002, fee_date: day, created_by: 3, branch_id: 1, created_at: `${day} 05:00:00` },
    ])
    const counts = ['sales_outside_shift', 'returns_outside_shift', 'fees_outside_shift', 'events_checked', 'open_shifts_before_today', 'closed_without_count', 'closed_before_opened']
    assert.deepEqual(pick(one(db, 'health-shift-coverage'), counts), {
      sales_outside_shift: 3, returns_outside_shift: 1, fees_outside_shift: 1, events_checked: 9, open_shifts_before_today: 1, closed_without_count: 1, closed_before_opened: 1,
    })
    insert(db, 'shift_sessions', shift(5, { user_id: 9, branch_id: 1, scope_mode: 'shop_wide', opened_at: at('00:00:00'), closed_at: at('12:00:00'), closing_counted_usd: 0 }))
    const covered = one(db, 'health-shift-coverage')
    assert.deepEqual([covered.sales_outside_shift, covered.returns_outside_shift, covered.fees_outside_shift], [0, 0, 0], 'a shop-wide shift holds every cashier')
  })

  await check('health-identifiers counts duplicated receipts, return numbers, product twins, suppliers and customers', () => {
    const db = migratedDatabase()
    insert(db, 'sales', [
      { id: 1001, receipt_number: 'R-1', created_at: '2025-01-01T00:00:00.000Z' }, { id: 1002, receipt_number: 'R-1', created_at: isoDaysAgo(1) },
      { id: 1003, receipt_number: 'L-9', created_at: '2025-01-01T00:00:00.000Z' }, { id: 1004, receipt_number: 'L-9', created_at: '2025-01-02T00:00:00.000Z' },
      { id: 1005, receipt_number: 'R-5' }, { id: 1006, receipt_number: '' }, { id: 1007, receipt_number: '' },
    ])
    insert(db, 'returns', [{ id: 1, return_number: 'RT-1' }, { id: 2, return_number: 'RT-1' }, { id: 3, return_number: 'RT-2' }])
    insert(db, 'products', [
      { id: 1, name: 'Soap', barcode: '885' }, { id: 2, name: 'soap ', barcode: ' 885' }, { id: 3, name: 'Soap', barcode: '885', is_active: 0 },
      { id: 4, name: 'A', barcode: '777' }, { id: 5, name: 'B', barcode: '777' }, { id: 6, name: 'Blank', barcode: '' }, { id: 7, name: 'Blank', barcode: '' },
      { id: 8, name: 'Cream', barcode: '999' }, { id: 9, name: 'Cream', barcode: '999', is_active: 0 },
      // the child-row model: one name, two barcodes is two rows, not a twin
      { id: 10, name: 'Lotion', barcode: '111' }, { id: 11, name: 'Lotion', barcode: '222' },
    ])
    insert(db, 'suppliers', [{ id: 1, name: ' Srun ' }, { id: 2, name: 'srun' }, { id: 3, name: 'Dara' }])
    insert(db, 'customers', [
      { id: 1, name: 'Sok', phone_normalized: '012345678' }, { id: 2, name: ' sok', phone_normalized: '012345678' }, { id: 3, name: 'Dara', phone_normalized: '012345678' },
    ])
    assert.deepEqual(one(db, 'health-identifiers'), {
      receipt_dup_groups: 2, receipt_dup_sales: 4, receipt_dup_groups_recent: 1, return_number_dup_groups: 1,
      product_identity_twins: 1, supplier_name_dup_groups: 1, customer_phone_name_dup_groups: 1,
    })
  })

  await check('health-legacy-ledgers joins receivables to sales on number AND date, with the join itself as a control', () => {
    const db = migratedDatabase()
    insert(db, 'sales', [
      { id: 2001, legacy_receipt_number: '004430@2026-02-01', total_usd: 10, customer_id: 1 },
      { id: 2002, legacy_receipt_number: '004431@2026-02-02', total_usd: 5, customer_id: 1 },
      { id: 2003, legacy_receipt_number: '004432@2026-02-03', total_usd: 7, customer_id: 2 },
    ])
    const ar = (id, invoiceNo, date, total, extra = {}) => ({ id, legacy_id: `ar${id}`, customer_id: 1, customer_name: 'C', invoice_no: invoiceNo, invoice_date: date,
      total_amount_usd: total, taxable_amount_usd: total, amount_paid_usd: total, status: 'Paid', source_file: 'ar.xls', source_row: id, ...extra })
    insert(db, 'customer_receivables', [
      ar(1, '004430', '2026-02-01', 12), ar(2, '004430', '2025-02-01 00:00:00', 7.5, { amount_paid_usd: 0, outstanding_balance_usd: 7.5, status: 'Unpaid' }),
      ar(3, '004431', '2026-02-02', 5), ar(4, '004432', '2026-02-03', 7, { customer_id: 3 }), ar(5, '', '2026-02-04', 1, { vat_amount_usd: 0.5 }),
    ])
    const ap = (id, extra = {}) => ({ id, source_branch: 'Store', legacy_id: `ap${id}`, supplier_name: 'S', invoice_date: '2026-01-01', total_amount_usd: 3,
      amount_paid_usd: 3, status: 'Paid', source_file: 'ap.xls', source_row: id, ...extra })
    insert(db, 'supplier_invoices', [ap(1, { amount_paid_usd: 0, outstanding_balance_usd: 3, status: 'Unpaid' }), ap(2), ap(3, { supplier_id: 999 })])
    assert.deepEqual(one(db, 'health-legacy-ledgers'), {
      ar_rows: 5, ar_not_settled: 1, ar_paid_ne_total: 1, ar_taxable_ne_total: 0, ar_vat_nonzero: 1, ar_joined: 3, ar_unjoined: 1, ar_join_multi: 0,
      ar_join_total_mismatch: 1, ar_join_customer_mismatch: 1, ap_rows: 3, ap_not_settled: 1, ap_paid_ne_total: 1, ap_orphan_supplier: 1,
    })
    insert(db, 'sales', { id: 2004, legacy_receipt_number: '004431@2026-02-02', total_usd: 5, customer_id: 1 })
    assert.equal(one(db, 'health-legacy-ledgers').ar_join_multi, 1)
  })

  await check('health-loyalty reads the switch like the Worker and counts only activity past the 0251 checkpoint', () => {
    const { loyaltyPointsEnabled } = loadRealLib('loyaltyEligibility.ts')
    const db = migratedDatabase()
    assert.deepEqual({ ...db.prepare("SELECT value FROM settings WHERE key = 'loyalty_points_enabled'").get() }, { value: 'false' }, '0251 leaves the programme off')
    // Move the checkpoint so ids on both sides of it exist, and date the switch-off.
    db.prepare("UPDATE settings SET value = ' Off ', updated_at = '2026-09-17 10:00:00' WHERE key = 'loyalty_points_enabled'").run()
    db.prepare("UPDATE system_flags SET value = ? WHERE key = 'loyalty_points_reset'")
      .run(JSON.stringify({ version: 1, reset_at: '2026-09-17T10:00:00.000Z', sales: 3000, returns: 0, submissions: 1, adjustments: 1 }))
    // The rows below are what a restore can bring back: its maintenance window switches the 0251 birth triggers off.
    db.prepare("INSERT INTO system_flags (key, value) VALUES ('maintenance', '{\"mode\":\"restore\"}')").run()
    const after = '2026-09-20T03:00:00.000Z'
    const paid = (id, extra = {}) => ({ id, total_usd: 5, created_at: after, ...extra })
    insert(db, 'sales', [
      paid(2999, { legacy_receipt_number: '002999@2026-01-01' }),                                  // at or below the checkpoint: never counts
      paid(3001, { legacy_receipt_number: '003001@2026-01-01' }),                                  // imported, still accruing
      paid(3002, { legacy_receipt_number: '003002@2026-01-01', sale_status: 'cancelled' }),
      paid(3007, { client_request_id: 'sales-import:job-1:7' }),                                    // the sales import keeps an own-format receipt: the key is the tell
      paid(3008, { legacy_receipt_number: '003008@2026-01-01', loyalty_accrual: 0 }),
      paid(3003, { customer_id: 1 }),                                                                // a customer's paid sale accruing after the switch-off
      paid(3004, { customer_id: 1, sale_status: 'awaiting_payment' }),
      paid(3005, { customer_id: 1, created_at: '2026-09-10T03:00:00.000Z' }),                       // earned while the programme was on
      paid(3006, { customer_id: 1, loyalty_accrual: 0, membership_points_redeemed: 100 }),
      paid(3010, { loyalty_accrual: 1 }),                                                            // no customer, nothing to accrue to
      paid(2998, { customer_id: 2, sale_status: 'awaiting_payment' }),
      paid(3009, { customer_id: 2, sale_status: 'awaiting_payment' }),
      // live rows still carry the retired return labels: only the one that was Not Paid before the return reads Not Paid
      paid(3011, { sale_status: 'partial_return', status_before_return: 'awaiting_payment' }),
      paid(3012, { sale_status: 'partial_return', status_before_return: 'completed' }),
    ])
    const adjustment = (id, extra) => ({ id, customer_id: 1, points: 5, ...extra })
    insert(db, 'loyalty_point_adjustments', [adjustment(1, {}), adjustment(2, {}), adjustment(3, { voided_at: '2026-09-17 10:00:00' }), adjustment(4, { points: 2 })])
    const share = (id, extra) => ({ id, customer_id: 1, status: 'approved', reward_points: 10, loyalty_eligible: 1, ...extra })
    insert(db, 'customer_share_submissions', [
      share(1, {}), share(2, {}), share(3, { reward_points_voided_at: '2026-09-17 10:00:00' }), share(4, { status: 'pending' }), share(5, { loyalty_eligible: 0 }),
    ])
    const refund = (id, saleId, extra = {}) => ({ id, sale_id: saleId, customer_id: 1, total_refund_usd: 1, ...extra })
    insert(db, 'returns', [
      refund(1, 3009), refund(2, 3003), refund(3, 3009, { status: 'cancelled' }), refund(4, 2998), refund(5, 3009, { customer_id: null }),
      refund(6, 3009, { return_scope: 'supplier' }), refund(7, 3011), refund(8, 3012),
    ])
    db.prepare("DELETE FROM system_flags WHERE key = 'maintenance'").run()
    assert.deepEqual(one(db, 'health-loyalty'), {
      programme_on: 0, reset_present: 1, switch_off_since: '2026-09-17 10:00:00', legacy_sales_accruing: 2, accruing_since_switch_off: 1,
      redeemed_since_switch_off: 1, live_adjustments: 2, live_share_rewards: 1, returns_deducting_unaccrued: 2,
    })
    // The switch is read exactly as the Worker reads it, an absent key included (OFF since 0251).
    for (const value of [null, '', ' Off ', 'on', ' ON ', 'true', 'YES', '1', '0', 'false', 'enabled']) {
      if (value === null) db.prepare("DELETE FROM settings WHERE key = 'loyalty_points_enabled'").run()
      else db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('loyalty_points_enabled', ?, '2026-09-17 10:00:00') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(value)
      assert.equal(one(db, 'health-loyalty').programme_on, loyaltyPointsEnabled(value) ? 1 : 0, `programme_on for ${JSON.stringify(value)}`)
    }
    db.prepare("UPDATE settings SET value = 'on' WHERE key = 'loyalty_points_enabled'").run()
    const on = one(db, 'health-loyalty')
    assert.deepEqual([on.programme_on, on.accruing_since_switch_off, on.redeemed_since_switch_off], [1, 0, 0], 'while the programme is on, accruing and redeeming are legitimate')
    db.prepare("DELETE FROM system_flags WHERE key = 'loyalty_points_reset'").run()
    const noCheckpoint = one(db, 'health-loyalty')
    assert.deepEqual([noCheckpoint.reset_present, noCheckpoint.legacy_sales_accruing, noCheckpoint.live_adjustments, noCheckpoint.live_share_rewards], [0, 3, 3, 2], 'with no checkpoint every id counts')
  })

  await check('health-product-family is 0 on trigger-maintained rows and counts every hand-made cache drift', () => {
    const db = migratedDatabase()
    insert(db, 'products', [
      { id: 1, name: 'Soap' }, { id: 2, name: ' soap' }, { id: 3, name: 'Solo' }, { id: 4, name: 'Old', is_active: 0 },
    ])
    db.exec("UPDATE products SET name = 'Solo 2' WHERE id = 3")
    db.exec("UPDATE products SET name = 'Solo' WHERE id = 3")
    assert.deepEqual(one(db, 'health-product-family'), { name_key_drift: 0, grouped_cache_drift: 0, variant_parent_inactive: 0, blank_name_active: 0 })
    db.exec('UPDATE products SET is_grouped_cached = 0 WHERE id = 1')
    db.exec("UPDATE products SET name_key = 'wrong' WHERE id = 3")
    db.exec('UPDATE products SET is_grouped_cached = 1 WHERE id = 4')
    insert(db, 'products', [{ id: 5, name: 'Kid', parent_id: 4 }, { id: 6, name: '' }, { id: 7, name: 'Lotion' }])
    db.exec('UPDATE products SET name_key = NULL WHERE id = 7')
    assert.deepEqual(one(db, 'health-product-family'), { name_key_drift: 2, grouped_cache_drift: 2, variant_parent_inactive: 1, blank_name_active: 1 })
  })

  await check('health-catalog-cost is 0 after the 0195 triggers and counts a hand-set cost and a split mirror', () => {
    const db = migratedDatabase()
    insert(db, 'branches', { id: 1, name: 'Store', is_default: 1 })
    insert(db, 'products', [{ id: 1, name: 'Costed' }, { id: 2, name: 'Frozen', is_active: 0, cost_price_usd: 1, purchase_price_usd: 2 }, { id: 3, name: 'Uncosted' }])
    insert(db, 'product_batches', [
      { id: 11, variant_product_id: 1, batch_key: 'a', unit_cost_usd: 12 }, { id: 12, variant_product_id: 1, batch_key: 'b', unit_cost_usd: 12.5 },
      { id: 21, variant_product_id: 2, batch_key: 'c', unit_cost_usd: 30 }, { id: 31, variant_product_id: 3, batch_key: 'd' },
    ])
    insert(db, 'branch_batch_stock', [
      { batch_id: 11, branch_id: 1, quantity: 2 }, { batch_id: 12, branch_id: 1, quantity: 8 }, { batch_id: 21, branch_id: 1, quantity: 0 }, { batch_id: 31, branch_id: 1, quantity: 4 },
    ])
    assert.equal(db.prepare('SELECT cost_price_usd FROM products WHERE id = 1').get().cost_price_usd, 12.4)
    assert.deepEqual(one(db, 'health-catalog-cost'), { active_cost_drift: 0, active_mirror_drift: 0, active_mirror_drift_khr: 0, active_with_formula: 1 })
    db.exec('UPDATE products SET cost_price_usd = 12.3 WHERE id = 1')
    assert.deepEqual(one(db, 'health-catalog-cost'), { active_cost_drift: 1, active_mirror_drift: 1, active_mirror_drift_khr: 0, active_with_formula: 1 })
    // The mirror rule: an unknown (NULL) cost with a twin of 0 or NULL is aligned (not counted), a known cost with a twin of 0 is not;
    // the KHR pair follows the same rule in its own column; an inactive product never counts.
    db.exec('UPDATE products SET cost_price_usd = 12.4 WHERE id = 1')
    db.exec('UPDATE products SET cost_price_usd = NULL, purchase_price_usd = 0, cost_price_khr = NULL, purchase_price_khr = 0 WHERE id = 3')
    assert.deepEqual(one(db, 'health-catalog-cost'), { active_cost_drift: 0, active_mirror_drift: 0, active_mirror_drift_khr: 0, active_with_formula: 1 }, 'NULL cost with a 0 twin is aligned')
    db.exec('UPDATE products SET cost_price_usd = NULL, purchase_price_usd = NULL WHERE id = 3')
    db.exec('UPDATE products SET cost_price_khr = 4000, purchase_price_khr = 0 WHERE id = 3')
    assert.deepEqual(one(db, 'health-catalog-cost'), { active_cost_drift: 0, active_mirror_drift: 0, active_mirror_drift_khr: 1, active_with_formula: 1 }, 'a known KHR cost with a 0 twin counts, in its own column')
    db.exec('UPDATE products SET cost_price_khr = NULL, purchase_price_khr = 9 WHERE id = 3')
    assert.equal(one(db, 'health-catalog-cost').active_mirror_drift_khr, 1, 'an unknown KHR cost with a positive twin counts')
    db.exec('UPDATE products SET cost_price_khr = NULL, purchase_price_khr = NULL, cost_price_usd = 5, purchase_price_usd = 0 WHERE id = 3')
    assert.deepEqual(one(db, 'health-catalog-cost'), { active_cost_drift: 0, active_mirror_drift: 1, active_mirror_drift_khr: 0, active_with_formula: 1 }, 'a known cost with a 0 twin counts')
  })

  await check('health-supplier-lots counts receipt-field drift but not reverted lots, returns or ambiguous names', () => {
    const db = migratedDatabase()
    insert(db, 'suppliers', [{ id: 1, name: 'Srun' }, { id: 2, name: 'Dara' }, { id: 3, name: 'dara ' }])
    const lot = (id, extra = {}) => ({ id, variant_product_id: 1, batch_key: `k${id}`, ...extra })
    insert(db, 'product_batches', [
      lot(1, { received_cost_usd: 10 }), lot(2, { received_cost_usd: 10 }), lot(3, { received_cost_usd: 5 }), lot(4, { supplier_name: 'srun ' }),
      lot(5, { supplier_name: 'DARA' }), lot(6, { received_quantity: -1 }), lot(7, { payment_status: 'credit' }), lot(8, { received_cost_usd: 10 }),
    ])
    const move = (batchId, type, cost, extra = {}) => ({ product_id: 1, batch_id: batchId, movement_type: type, quantity: 1, total_cost_usd: cost, ...extra })
    insert(db, 'inventory_movements', [
      move(1, 'add', 12), move(2, 'add', 12), move(2, 'remove', 12, { reference_id: 'revert:77' }), move(3, 'return', 7), move(8, 'stock_in', 12),
    ])
    assert.deepEqual(one(db, 'health-supplier-lots'), { negative_received: 1, lots_name_only_resolvable: 1, credit_without_due: 1, receipt_cost_drift: 2 })
  })

  await check('health-r2-references counts every stored upload form per source and the Drive mirror freshness', () => {
    const db = migratedDatabase()
    insert(db, 'products', [
      { id: 1, name: 'A', image_path: '/uploads/a.png' }, { id: 2, name: 'B', image_path: 'uploads%2Fb.png', is_active: 0 },
      { id: 3, name: 'C', image_path: '/Uploads/c.png' }, { id: 4, name: 'D', image_path: 'https://cdn.example/x.png' },
      { id: 5, name: 'E', description: 'see \\/uploads\\/d.png' },
    ])
    insert(db, 'product_images', { product_id: 1, image_path: '/uploads/g.png' })
    insert(db, 'users', { id: 1, username: 'u', name: 'U', password: 'x', avatar_path: '/uploads/u.png' })
    insert(db, 'promotions', [{ title: 'P', image_path: '/uploads/p.png' }, { title: 'Q', link_url: 'https://x.example' }])
    insert(db, 'settings', { key: 'customer_portal_logo_image', value: '/uploads/logo.png' })
    insert(db, 'customer_share_submissions', [{ screenshots_json: '["private/portal-submissions/x.jpg"]' }, { screenshots_json: '["/uploads/s.png"]' }])
    insert(db, 'import_job_image_matches', { job_id: 'j1', row_number: 1, image_path: '/uploads/i.png' })
    insert(db, 'import_jobs', [{ id: 'j1', type: 'products', status: 'processing' }, { id: 'j2', type: 'products', status: 'completed' }])
    insert(db, 'import_job_files', [{ job_id: 'j1', kind: 'csv', stored_path: 'imports/j1.csv' }, { job_id: 'j2', kind: 'csv', stored_path: 'imports/j2.csv' }])
    insert(db, 'pending_actions', [
      { section: 'products', action_type: 'update', entity_type: 'product', payload_json: '{"image":"/uploads/q.png"}' },
      { section: 'products', action_type: 'update', entity_type: 'product', payload_json: '{"image":"/uploads/r.png"}', status: 'approved' },
    ])
    insert(db, 'file_assets', [{ original_name: 'a', stored_name: 'a.png', public_path: '/uploads/a.png' }, { original_name: 'b', stored_name: 'b.png', public_path: '' }])
    insert(db, 'google_drive_sync_entries', [
      { relative_path: 'db.json', remote_file_id: 'r1', last_synced_at: '2026-09-28 10:00:00' },
      { relative_path: 'x.json', remote_file_id: 'r2', last_synced_at: '2026-09-27 10:00:00', last_error: 'quota' },
    ])
    const row = one(db, 'health-r2-references')
    delete row.checked_at_utc
    assert.deepEqual(row, {
      products_image_rows: 3, products_image_rows_active: 2, gallery_rows: 1, avatar_rows: 1, promotion_rows: 1, settings_rows: 1,
      product_text_rows: 1, private_screenshot_rows: 1, submission_upload_rows: 1, import_match_rows: 1, import_files_open_jobs: 1,
      pending_action_rows: 1, library_rows: 2, library_rows_without_key: 1, drive_entries: 2, drive_entries_with_error: 1,
      drive_last_synced_at: '2026-09-28 10:00:00',
    })
  })

  if (process.exitCode) console.error(`test-data-match-health-queries-native: FAILED (${passed} passed)`)
  else console.log(`test-data-match-health-queries-native: ${passed} checks passed`)
}

main().catch((err) => {
  console.error(`test-data-match-health-queries-native: crashed: ${err && err.stack}`)
  process.exitCode = 1
}).finally(() => {
  for (const db of opened) db.close()
  fs.rmSync(SCRATCH, { recursive: true, force: true })
})
