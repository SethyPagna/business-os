const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
function seedFixture(raw, seed) {
  const value = seedStockFixture(raw, seed)
  assert.throws(() => raw.exec("INSERT INTO products(name) VALUES('unadmitted fixture probe')"), /stock_transaction_required/)
  return value
}
// Cost-unknown slice S8 (owner, 14 Oct 2026): "if cost is 0$ then it is 0 for loss. if it is none, it should also be unknown."
//
// The imports used to turn "the file states no cost" into 0 (a blank products-CSV cell, a missing cost column) or
// into TODAY's catalog cost (a sales line with no cost, an inventory removal, a unified stock-action row). A 0 on a
// cost now means "free"; only a cost the file or the item's own lot recorded may be stored.
//
//   - products CSV: a blank cost cell, or no cost column, is NULL on create; a merge row with a blank cell keeps what
//     the product has (NULL included); a typed 0 stays 0.
//   - sales CSV: a line with no cost is NULL (never the catalog's), a typed 0 stays 0, and the imported return's
//     restock movement carries that line cost (or NULL) instead of the DEFAULT 0 its INSERT left.
//   - inventory CSV: a removal is valued at the lots it drains (each lot's OWN cost; NULL lot or stock under no lot ->
//     NULL; a recorded $0 lot -> 0), never the catalog cost.
//   - unified stock actions: the resolver counts a recorded $0 as a cost ($0 against $5 in two batches is a conflict).
//
// Every case pairs the unknown case with a recorded-$0 control and a recorded-cost control, so neither a `|| 0` nor
// a `> 0` implementation passes. COST_S8_SRC_ROOT points the test at another copy of the Worker (the base commit) so
// the same file runs red-before / green-after.
//
// Run: node scripts/test-cost-s8-imports-pure.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')

const root = process.env.COST_S8_SRC_ROOT ? path.resolve(process.env.COST_S8_SRC_ROOT) : path.join(__dirname, '..')
const STUB = new Map([
  ['../index', {}],
  ['../durable-objects/broadcastHub', {}],
  ['./db', { isImportMaintenanceFenceError: () => false, getDb: () => ({}), getImportFencedDb: () => ({}), isRetryableD1Error: () => false }],
])
const cache = new Map()
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const mod = { exports: {} }
  cache.set(rel, mod)
  const source = fs.readFileSync(path.join(root, 'src', rel), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const require_ = (name) => {
    if (!name.startsWith('.')) return require(name)
    if (STUB.has(name)) return STUB.get(name)
    return load(path.posix.normalize(path.posix.join(path.posix.dirname(rel), name)) + '.ts')
  }
  new Function('require', 'module', 'exports', output)(require_, mod, mod.exports)
  return mod.exports
}

const migrations = path.join(__dirname, '..', 'migrations')
function freshDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(migrations, file), 'utf8'))
  return db
}
// A D1-shaped wrapper over better-sqlite3 for the code under test (named @params, async results).
function d1(sqlite) {
  const bind = (sql, params) => {
    if (Array.isArray(params)) return params
    const out = {}
    for (const match of sql.matchAll(/@(\w+)/g)) out[match[1]] = params?.[match[1]] ?? null
    return out
  }
  return {
    prepare: (sql) => ({
      all: async (params = {}) => sqlite.prepare(sql).all(bind(sql, params)),
      get: async (params = {}) => sqlite.prepare(sql).get(bind(sql, params)),
      run: async (params = {}) => sqlite.prepare(sql).run(bind(sql, params)),
    }),
    batch: async (statements) => sqlite.transaction(() => statements.map(({ sql, params }) => sqlite.prepare(sql).run(bind(sql, params))))(),
  }
}

let checks = 0
const failures = []
const ok = (label) => { checks++; console.log(`PASS ${label}`) }
async function section(name, body) {
  try { await body(); ok(name) } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}: ${String(error.message).split(String.fromCharCode(10))[0]}`)
  }
}

const COST = 'unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr'
const UNKNOWN = { unit_cost_usd: null, unit_cost_khr: null, total_cost_usd: null, total_cost_khr: null }

;(async () => {
  const numbers = load('lib/importNumbers.ts')
  const engine = load('lib/importEngine.ts')

  await section('authoritative product classifier refuses malformed costs across all accepted aliases', async () => {
    const db = { prepare: (sql) => ({ all: async () => /FROM branches/.test(sql) ? [{ id: 1, name: 'Shop', is_default: 1, is_active: 1 }] : [] }) }
    for (const field of ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr', 'cost_usd', 'cost_khr']) {
      for (const value of ['abc', '12oops', '-1', '100000000001', '100000000000.0001', '0.0000000000000000000000001']) {
        const [row] = await engine.classifyProducts(db, [{ _rowNumber: 2, name: 'Invalid cost', [field]: value }], 'strict-cost', null, new Map())
        assert.equal(row.action, 'error', `${field}=${value}`)
        assert.equal(row.code, 'invalid_cost')
      }
      for (const [value, expected] of [['', null], ['NULL', null], ['0', 0], ['0.0001', 0.0001], ['៥.១២៣៤', 5.1234]]) {
        const [row] = await engine.classifyProducts(db, [{ _rowNumber: 2, name: 'Valid cost', [field]: value }], 'strict-cost', null, new Map())
        assert.notEqual(row.action, 'error', row.message)
        assert.equal(row.data[field.endsWith('_usd') ? 'cost_price_usd' : 'cost_price_khr'], expected)
      }
    }
    for (const currency of ['usd', 'khr']) {
      const canonical = `cost_price_${currency}`, purchase = `purchase_price_${currency}`, alias = `cost_${currency}`
      for (const value of [null, '', 'NULL', '0']) {
        const [row] = await engine.classifyProducts(db, [{ _rowNumber: 2, name: 'Precedence', [canonical]: value, [purchase]: '9', [alias]: '8' }], 'strict-cost', null, new Map())
        assert.equal(row.data[canonical], value === '0' ? 0 : null)
      }
      const [bad] = await engine.classifyProducts(db, [{ _rowNumber: 2, name: 'Shadowed', [canonical]: '5', [alias]: '12oops' }], 'strict-cost', null, new Map())
      assert.equal(bad.action, 'error')
    }
  })

  await section('malformed cost keeps the actual matched identity for explicit skip', async () => {
    const existing = { id: 77, name: 'Skip keeper', sku: 'KEEP', barcode: '123', cost_price_usd: 7, is_active: 1 }
    const db = { prepare: (sql) => ({ all: async () => /FROM products/.test(sql) ? [existing] : /FROM branches/.test(sql) ? [{ id: 1, name: 'Shop', is_default: 1, is_active: 1 }] : [] }) }
    const [row] = await engine.classifyProducts(db, [{ _rowNumber: 2, name: 'Skip keeper', sku: 'KEEP', barcode: '123', cost_usd: '12oops' }], 'skip-cost', null, new Map())
    assert.equal(row.action, 'error')
    assert.equal(row.existingId, 77)
  })

  await section('cost validation and blank preservation survive import modes and override choices', async () => {
    const existing = { id: 77, name: 'Mode keeper', sku: 'MODE', barcode: '123', cost_price_usd: 7, cost_price_khr: 28000, stock_quantity: 0, is_active: 1 }
    const db = { prepare: (sql) => ({ all: async () => /FROM products/.test(sql) ? [existing] : /FROM branches/.test(sql) ? [{ id: 1, name: 'Shop', is_default: 1, is_active: 1 }] : [] }) }
    for (const mode of ['merge', 'fill_blank', 'replace_columns', 'replace_all']) for (const action of ['', 'merge_stock', 'override_add', 'override_replace']) {
      const policy = JSON.stringify({ import_mode: mode, replace_columns: ['cost_price_usd', 'cost_price_khr'] })
      const base = { _rowNumber: 2, name: 'Mode keeper', sku: 'MODE', barcode: '123', _action: action }
      const [bad] = await engine.classifyProducts(db, [{ ...base, cost_usd: '12oops' }], 'mode-cost', policy, new Map())
      assert.equal(bad.action, 'error', `${mode}:${action}`)
      assert.equal(bad.existingId, 77)
      const [unknown] = await engine.classifyProducts(db, [{ ...base, cost_price_usd: 'NULL', purchase_price_usd: '9' }], 'mode-cost', policy, new Map())
      assert.notEqual(unknown.action, 'error', unknown.message)
      if ((mode === 'merge' && action !== 'override_replace') || mode === 'fill_blank') assert.equal(unknown.data.cost_price_usd, 7, `${mode}:${action}:preserve`)
    }
  })

  await section('strict cost bound and generic quantity/sale rounding controls', () => {
    for (const [value, expected] of [['100000000000', 100000000000], ['99999999999.9999', 99999999999.9999], ['100000000000.0001', 'invalid'], ['100000000001', 'invalid'], ['0.0000000000000000000000001', 'invalid']]) assert.equal(numbers.parseImportCost(value), expected)
    assert.equal(numbers.parseImportNumericValue('12oops', 0), 12)
    assert.equal(numbers.parseImportNumericValue('-2', 0, { allowNegative: true }), -2)
    assert.equal(numbers.normalizeImportMoney('1.2345'), 1.24)
    assert.equal(numbers.normalizeImportSellingPrice('1.2345'), 1.24)
  })

  await section('normalizeImportCost4: a null fallback keeps blank / unreadable unknown, a typed 0 stays 0', () => {
    for (const blank of ['', '   ', undefined, null, 'abc', '-3']) {
      assert.equal(numbers.normalizeImportCost4(blank, null), null, `${JSON.stringify(blank)} is unknown`)
    }
    assert.ok(Object.is(numbers.normalizeImportCost4('0', null), 0) || numbers.normalizeImportCost4('0', null) === 0, 'a typed 0 is 0')
    assert.equal(numbers.normalizeImportCost4('0.00', null), 0)
    assert.equal(numbers.normalizeImportCost4('3.12345', null), 3.1235)
    assert.equal(numbers.normalizeImportCost4('', 0), 0, 'the legacy numeric fallback is unchanged for other callers')
  })

  await section('products CSV: blank cell / no column -> NULL on create; typed 0 -> 0; typed cost kept', async () => {
    const makeDb = (existing = []) => ({
      prepare: (sql) => ({
        all: async () => {
          if (/FROM import_job_files/.test(sql)) return []
          if (/FROM products/.test(sql)) return existing.map((product) => ({ is_active: 1, ...product }))
          if (/FROM branches/.test(sql)) return [{ id: 1, name: 'Shop', is_default: 1, is_active: 1 }]
          return []
        },
      }),
    })
    const run = async (row, existing = [], policy = null) => (await engine.classifyProducts(makeDb(existing), [{ _rowNumber: 1, name: 'Toner', sku: 'T-1', selling_price_usd: '5', ...row }], 'job-s8', policy, new Map()))[0]
    const blank = await run({ cost_price_usd: '', cost_price_khr: '' })
    assert.equal(blank.action, 'create')
    assert.deepEqual([blank.data.cost_price_usd, blank.data.cost_price_khr], [null, null], 'blank cells are unknown (old: 0)')
    assert.equal(blank.data.__receiptCostUsd, null)
    const absent = await run({})
    assert.deepEqual([absent.data.cost_price_usd, absent.data.cost_price_khr], [null, null], 'no cost column is unknown (old: 0)')
    const zero = await run({ cost_price_usd: '0', cost_price_khr: '0' })
    assert.ok(zero.data.cost_price_usd === 0 && zero.data.cost_price_khr === 0, 'control: a typed 0 is a recorded free cost and stays 0')
    assert.equal(zero.data.__receiptCostUsd, 0)
    const typed = await run({ cost_price_usd: '4.25', cost_price_khr: '17425' })
    assert.deepEqual([typed.data.cost_price_usd, typed.data.cost_price_khr], [4.25, 17425], 'control: a typed cost is kept')
    const legacyHeader = await run({ purchase_price_usd: '2.5' })
    assert.equal(legacyHeader.data.cost_price_usd, 2.5, 'control: the legacy purchase_price_usd alias still reads')
    assert.equal(legacyHeader.data.cost_price_khr, null)
  })

  await section('products CSV, merge mode: a blank cell keeps the existing cost, NULL and a recorded 0 included', async () => {
    const makeDb = (existing) => ({
      prepare: (sql) => ({
        all: async () => {
          if (/FROM import_job_files/.test(sql)) return []
          if (/FROM products/.test(sql)) return existing.map((product) => ({ is_active: 1, ...product }))
          if (/FROM branches/.test(sql)) return [{ id: 1, name: 'Shop', is_default: 1, is_active: 1 }]
          return []
        },
      }),
    })
    const base = { id: 61, sku: 'T-1', barcode: null, name: 'Toner', selling_price_usd: 5, selling_price_khr: null, category: null, brand: null, unit: 'pcs', supplier: null, description: null, low_stock_threshold: 10 }
    const merge = async (cost, row) => (await engine.classifyProducts(makeDb([{ ...base, ...cost }]),
      [{ _rowNumber: 1, name: 'Toner', sku: 'T-1', selling_price_usd: '5', ...row }], 'job-s8-merge', JSON.stringify({ product_import_mode: 'merge' }), new Map()))[0]
    const keptNull = await merge({ cost_price_usd: null, cost_price_khr: null }, { cost_price_usd: '' })
    assert.equal(keptNull.action, 'update')
    assert.deepEqual([keptNull.data.cost_price_usd, keptNull.data.cost_price_khr], [null, null], 'NULL stays NULL (old: written as 0)')
    const keptZero = await merge({ cost_price_usd: 0, cost_price_khr: 0 }, { cost_price_usd: '' })
    assert.deepEqual([keptZero.data.cost_price_usd, keptZero.data.cost_price_khr], [0, 0], 'control: a recorded 0 stays 0')
    const keptCost = await merge({ cost_price_usd: 38, cost_price_khr: 155800 }, { cost_price_usd: '' })
    assert.deepEqual([keptCost.data.cost_price_usd, keptCost.data.cost_price_khr], [38, 155800], 'control: a recorded cost is kept')
    const typedZero = await merge({ cost_price_usd: 38, cost_price_khr: 155800 }, { cost_price_usd: '0' })
    assert.ok(typedZero.data.cost_price_usd === 0, 'control: a typed 0 over a recorded cost lands as 0')
  })

  const sqlite = freshDb()
  sqlite.prepare("INSERT INTO branches (id, name, is_active, is_default, role, canonical_key) VALUES (1, 'Shop', 1, 1, 'shop', 'shop')").run()
  const addProduct = (id, name, catalogCost) => {
    seedFixture(sqlite, () => sqlite.prepare('INSERT INTO products (id, name, sku, stock_quantity, cost_price_usd, cost_price_khr) VALUES (?, ?, ?, 10, ?, ?)').run(id, name, `SKU-${id}`, catalogCost, catalogCost == null ? null : catalogCost * 4100))
    seedFixture(sqlite, () => sqlite.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 1, 10)').run(id))
  }
  const addLot = (id, productId, qty, unitCost) => {
    seedFixture(sqlite, () => sqlite.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number, unit_cost_usd, received_quantity)
      VALUES (?, ?, ?, ?, '2026-08-01', 1, 1, ?, ?)`).run(id, productId, `lot-${id}`, `LOT-${id}`, unitCost, qty))
    seedFixture(sqlite, () => sqlite.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (?, 1, ?)').run(id, qty))
  }
  // The catalog cost is 9 everywhere, so a catalog-priced removal is visible as 9.
  addProduct(101, 'Lot unknown', 9); addLot(1101, 101, 10, null)
  addProduct(102, 'Lot free', 9); addLot(1102, 102, 10, 0)
  addProduct(103, 'Lot costed', 9); addLot(1103, 103, 10, 2.5)
  addProduct(104, 'No lot', 9)
  addProduct(105, 'Mixed lots', 9); addLot(1105, 105, 4, 2); addLot(1106, 105, 6, null)
  addProduct(106, 'Catalog unknown', null); addLot(1107, 106, 10, 3)

  const movementRows = () => sqlite.prepare(`SELECT product_id, movement_type, quantity, ${COST} FROM inventory_movements ORDER BY id`).all()

  await section('inventory CSV remove: valued at the drained lots\' own cost; a NULL lot, no lot or a mixed removal is NULL; a $0 lot is 0', async () => {
    const removalRow = (productId, qty, rowNumber) => ({
      rowNumber, action: 'create', identifier: `SKU-${productId}`, existingId: productId, message: null, changes: {},
      data: { product_id: productId, product_name: `p${productId}`, branch_id: 1, branch_name: 'Shop', movement_type: 'out', quantity: qty, signedQuantity: -qty,
        reason: 'import', created_at: null, ...UNKNOWN },
    })
    const rows = [removalRow(101, 3, 1), removalRow(102, 3, 2), removalRow(103, 3, 3), removalRow(104, 3, 4), removalRow(105, 6, 5), removalRow(105, 0.0001, 6)]
    // A second removal of product 105 would drain the NULL lot after the costed lot is spent; keep the first five.
    const planned = await engine.planInventoryImportStockGroups(d1(sqlite), rows.slice(0, 5), (rowNumber) => ({ sql: 'SELECT 1 WHERE ? IS NOT NULL', params: [rowNumber] }), '2026-10-15T00:00:00.000Z')
    assert.equal(planned.refused.length, 0, JSON.stringify(planned.refused))
    await engine.runD1BatchGroupsInChunks(d1(sqlite), planned.groups, undefined, true)
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
    const byProduct = new Map(movementRows().map((row) => [row.product_id, row]))
    const cost = (row) => ({ unit_cost_usd: row.unit_cost_usd, unit_cost_khr: row.unit_cost_khr, total_cost_usd: row.total_cost_usd, total_cost_khr: row.total_cost_khr })
    assert.deepEqual(cost(byProduct.get(101)), UNKNOWN, 'removal of a NULL-cost lot is unknown (old: the catalog 9)')
    assert.deepEqual(cost(byProduct.get(102)), { unit_cost_usd: 0, unit_cost_khr: null, total_cost_usd: 0, total_cost_khr: null }, 'control: a recorded $0 lot is a $0 removal')
    assert.deepEqual(cost(byProduct.get(103)), { unit_cost_usd: 2.5, unit_cost_khr: null, total_cost_usd: 7.5, total_cost_khr: null }, 'control: a costed lot values the removal at its own cost')
    assert.deepEqual(cost(byProduct.get(104)), UNKNOWN, 'stock held under no lot has no cost to use')
    assert.deepEqual(cost(byProduct.get(105)), UNKNOWN, 'a removal part-covered by an unknown lot is unknown, never a blend')
  })

  await section('inventory CSV classify: no plan-time catalog cost on a removal or a count, a receipt keeps its sheet cost', async () => {
    const product = { id: 101, sku: 'SKU-101', barcode: 'BC-101', name: 'Lot unknown', stock_quantity: 10, cost_price_usd: 9, cost_price_khr: 36900, is_active: 1 }
    const db = {
      prepare: (sql) => ({ all: async () => String(sql).includes('FROM products') ? [product]
        : String(sql).includes('FROM branches') ? [{ id: 1, name: 'Shop', is_default: 1, is_active: 1 }]
          : String(sql).includes('JOIN branch_stock') ? [{ product_id: 101, branch_id: 1, quantity: 10 }] : [] }),
    }
    const classify = async (action, row) => (await engine.classifyInventory(db, [{ _rowNumber: 1, sku: 'SKU-101', quantity: 2, ...row }], action))[0]
    const removal = await classify('remove', {})
    assert.equal(removal.action, 'create')
    assert.deepEqual({ unit_cost_usd: removal.data.unit_cost_usd, total_cost_usd: removal.data.total_cost_usd }, { unit_cost_usd: null, total_cost_usd: null }, 'removal (old: catalog 9)')
    const count = await classify('set', { quantity: 7 })
    assert.equal(count.data.unit_cost_usd, null, 'a count down is judged against branch stock and carries no catalog cost')
    const receipt = await classify('add', { unit_cost_usd: '3.5' })
    assert.deepEqual([receipt.data.unit_cost_usd, receipt.data.total_cost_usd], [3.5, 7], 'control: a receipt keeps the sheet cost')
    const freeReceipt = await classify('add', { unit_cost_usd: '0', free_goods: 'true' })
    assert.deepEqual([freeReceipt.data.unit_cost_usd, freeReceipt.data.total_cost_usd], [0, 0], 'control: a declared free receipt is a recorded $0')
    for (const field of ['unit_cost_usd', 'unit_cost_khr']) for (const value of ['12oops', '-1', '100000000001', '100000000000.0001', '0.0000000000000000000000001']) {
      const refused = await classify('add', { unit_cost_usd: '2', [field]: value })
      assert.equal(refused.action, 'error', `${field}=${value}`)
      assert.match(refused.message, /cost/i)
    }

  })

  await section('sales CSV: a line with no cost is NULL (not the catalog\'s); a typed 0 and a typed cost are kept', async () => {
    const product = { id: 10, sku: 'SKU-1', barcode: 'BC-1', name: 'Widget', stock_quantity: 5, selling_price_usd: 5, selling_price_khr: 20500, cost_price_usd: 6, cost_price_khr: 24600, is_active: 1 }
    const db = {
      prepare: (sql) => ({
        all: async () => {
          if (/FROM products/.test(sql)) return [product]
          if (/FROM branches/.test(sql)) return [{ id: 1, name: 'Shop', is_default: 1, is_active: 1, role: 'shop' }]
          return []
        },
        get: async () => null,
      }),
    }
    const classify = async (extra) => (await engine.classifySales(db, [{ _rowNumber: 1, receipt_number: `R-${Math.random()}`, sku: 'SKU-1', quantity: 1, sale_date: '2026-08-28 14:30', ...extra }], null))[0]
    const blank = await classify({})
    assert.equal(blank.action, 'create', JSON.stringify(blank.message))
    const item = blank.data.items[0]
    assert.deepEqual([item.cost_price_usd, item.cost_price_khr], [null, null], 'blank line cost is unknown (old: catalog 6 / 24600)')
    const zero = (await classify({ cost_price_usd: '0', cost_price_khr: '0' })).data.items[0]
    assert.ok(zero.cost_price_usd === 0 && zero.cost_price_khr === 0, 'control: a typed 0 stays 0')
    const typed = (await classify({ cost_price_usd: '4.25', cost_price_khr: '17425' })).data.items[0]
    assert.deepEqual([typed.cost_price_usd, typed.cost_price_khr], [4.25, 17425], 'control: a typed cost is kept')
  })

  await section('imported return restock: the movement carries the line cost, NULL when unknown, 0 when recorded 0', async () => {
    const importCommit = load('lib/salesImportCommit.ts')
    const run = async (index, itemCosts) => {
      const sqliteDb = freshDb()
      sqliteDb.prepare("INSERT INTO branches (id, name, is_active) VALUES (1, 'Shop', 1)").run()
      seedFixture(sqliteDb, () => sqliteDb.prepare("INSERT INTO products (id, name, sku, stock_quantity, cost_price_usd) VALUES (10, 'Widget', 'SKU-1', 5, 9)").run())
      seedFixture(sqliteDb, () => sqliteDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10, 1, 5)').run())
      const data = {
        receipt_number: `R-${index}`, cashier_id: null, cashier_name: 'Admin', branch_id: 1, branch_name: 'Shop', customer_id: null, customer_name: 'Dara', customer_phone: '012345678',
        customer_address: null, payment_method: 'Cash', payment_currency: 'USD', exchange_rate: 4100, notes: null, subtotal_usd: 15, subtotal_khr: 61500, discount_usd: 0, discount_khr: 0,
        tax_usd: 0, tax_khr: 0, total_usd: 15, total_khr: 61500, amount_paid_usd: 15, amount_paid_khr: 0, change_usd: 0, change_khr: 0, membership_discount_usd: 0, membership_discount_khr: 0,
        membership_points_redeemed: 0, is_delivery: 0, delivery_contact_id: null, delivery_contact_name: null, delivery_contact_phone: null, delivery_contact_address: null,
        delivery_fee_usd: 0, delivery_fee_khr: 0, delivery_fee_paid_by: 'customer', sale_status: 'partial_return', created_at: '2026-08-28T07:30:00.000Z',
        items: [{ product_id: 10, product_name: 'Widget', sku: 'SKU-1', quantity: 3, applied_price_usd: 5, applied_price_khr: 20500, total_usd: 15, total_khr: 61500,
          ...itemCosts, base_price_usd: 5, base_price_khr: 20500, product_discount_type: null, product_discount_label: null, product_discount_usd: 0, product_discount_khr: 0,
          manual_discount_type: null, manual_discount_value: 0, manual_discount_usd: 0, manual_discount_khr: 0, branch_id: 1, batch_id: null, batch_label: null, batch_expiry_date: null, returned_quantity: 2 }],
      }
      await importCommit.applyHistoricalSaleImport(d1(sqliteDb), { jobId: `job-${index}`, rowNumber: 2, data, nowIso: '2026-10-05T08:00:00.000Z', actor: { id: 41, username: 'importer' } })
      return sqliteDb.prepare(`SELECT movement_type, quantity, ${COST} FROM inventory_movements`).all()
    }
    assert.deepEqual(await run(1, { cost_price_usd: null, cost_price_khr: null }), [{ movement_type: 'return', quantity: 2, ...UNKNOWN }], 'unknown line cost -> unknown movement (old: DEFAULT 0)')
    assert.deepEqual(await run(2, { cost_price_usd: 0, cost_price_khr: 0 }), [{ movement_type: 'return', quantity: 2, unit_cost_usd: 0, unit_cost_khr: 0, total_cost_usd: 0, total_cost_khr: 0 }], 'control: a recorded $0 line is a $0 return')
    assert.deepEqual(await run(3, { cost_price_usd: 3, cost_price_khr: 12300 }), [{ movement_type: 'return', quantity: 2, unit_cost_usd: 3, unit_cost_khr: 12300, total_cost_usd: 6, total_cost_khr: 24600 }], 'control: a costed line carries its cost')
  })

  await section('unified stock action resolver: a recorded $0 is a cost; an unknown cost is not', () => {
    const resolver = load('lib/stockActionResolver.ts')
    const rows = (...costs) => costs.map((costPriceUsd, index) => ({ rowNumber: index + 1, identityKey: 'serum|abc', costPriceUsd, batchLabel: `B${index + 1}` }))
    assert.equal(resolver.detectCostBatchConflicts(rows(0, 5)).size, 2, '$0 against $5 in two batches is a conflict (old: the $0 was ignored)')
    assert.equal(resolver.detectCostBatchConflicts(rows(5, 7)).size, 2, 'control: $5 against $7 is a conflict')
    assert.equal(resolver.detectCostBatchConflicts(rows(null, 5)).size, 0, 'control: an unknown cost against $5 is not two costs')
    assert.equal(resolver.detectCostBatchConflicts(rows(0, 0)).size, 0, 'control: $0 twice is one cost')
    assert.equal(resolver.detectCostBatchConflicts(rows(5, 5)).size, 0, 'control: one cost is no conflict')
  })

  await section('unified stock action import: the row cost is the sheet\'s own cell, never the catalog cost', () => {
    const source = fs.readFileSync(path.join(root, 'src', 'lib', 'stockActionImport.ts'), 'utf8')
    assert.ok(!/costPriceUsd:\s*cost\.value\s*\?\?\s*matched\.product/.test(source), 'costPriceUsd no longer falls back to matched.product.cost_price_usd')
    assert.ok(/costPriceUsd:\s*cost\.value,/.test(source), 'costPriceUsd is the sheet cell')
  })

  await section('importEngine: the receipt writers name their cost columns and keep unknown money unknown', () => {
    const source = fs.readFileSync(path.join(root, 'src', 'lib', 'importEngine.ts'), 'utf8')
    assert.ok(!/COALESCE\(@receiptTotalCostUsd, 0\)/.test(source), 'a lot\'s received money is the receipt\'s own (NULL when unknown), never COALESCE(x, 0)')
    assert.ok(/received_cost_usd = CASE WHEN @receiptTotalCostUsd IS NULL THEN NULL/.test(source), 'an unknown receipt leaves the lot total unknown')
    assert.ok(!/product\.cost_price_usd \|\| 0|fallbackUsd: product\.cost_price_usd/.test(source), 'no catalog cost feeds a sales line or an inventory movement')
  })

  if (failures.length) {
    console.log(`\n${failures.length} section(s) failed: ${failures.join('; ')}`)
    process.exitCode = 1
  } else {
    console.log(`\nOK - ${checks} sections passed`)
  }
})().catch((error) => { console.error(error); process.exitCode = 1 })
