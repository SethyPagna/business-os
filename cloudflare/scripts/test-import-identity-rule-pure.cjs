// The identity rule, enforced on EVERY backend import path (Part 383 R1):
//   same name + same barcode  = the SAME product (attach/merge)
//   same name + diff barcode  = a separate child product (never attach)
//   diff name + same barcode  = a DIFFERENT product (shared/promo barcodes
//                               are real -- never attach across names)
// plus D6b: category/brand unified per touched name group at apply time
// (most frequent non-empty value; tie -> the group's first/lowest-id row).
//
// Before this part, classifyInventory and classifySales kept single-value
// byBarcode maps (last product loaded won a shared barcode, silently), and
// stockActionImport.matchProduct attached a named row to a lone
// DIFFERENT-name barcode match. Each of those shapes has a case here.
//
// Run: node scripts/test-import-identity-rule-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

const libDir = path.join(__dirname, '..', 'src', 'lib')

const REAL = new Set([
  'batchCode', 'importNumbers', 'stockActionResolver', 'stockActionImport',
  'stockActionCatalog', 'stockActionCommit', 'sqlBinding', 'productDetailRule',
  'productDescriptionSections', 'productBatches', 'salesStatus', 'contactOptions',
  'importImageMatch', 'searchMatch',
])
const asyncNoop = async () => {}
const STUBS = {
  './cache': new Proxy({}, { get: () => asyncNoop }),
  '../durable-objects/broadcastHub': new Proxy({}, { get: () => asyncNoop }),
  './db': { getDb: (env) => env.DB },
  './importCsv': {},
  '../index': {},
  './stockActionSeal': new Proxy({}, { get: () => async () => 0 }),
}
const realCache = new Map()
function transpile(abs) {
  return ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: abs,
  }).outputText
}
function makeRequire(fromDir) {
  return function localRequire(request) {
    if (request.startsWith('.')) {
      const base = path.basename(request)
      if (REAL.has(base)) return loadReal(base)
      if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request]
      return {}
    }
    return require(request)
  }
}
function loadReal(base) {
  if (realCache.has(base)) return realCache.get(base)
  const abs = path.join(libDir, base + '.ts')
  const mod = { exports: {} }
  realCache.set(base, mod.exports)
  new Function('exports', 'require', 'module', '__filename', '__dirname', transpile(abs))(
    mod.exports, makeRequire(path.dirname(abs)), mod, abs, path.dirname(abs),
  )
  realCache.set(base, mod.exports)
  return mod.exports
}
const engineAbs = path.join(libDir, 'importEngine.ts')
const engineMod = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', transpile(engineAbs))(
  engineMod.exports, makeRequire(libDir), engineMod, engineAbs, libDir,
)
const { classifyInventory, classifySales, unifyTouchedProductGroups } = engineMod.exports
const { resolveUnifiedStockImportRows } = loadReal('stockActionImport')
assert.strictEqual(typeof classifyInventory, 'function', 'classifyInventory must be exported')
assert.strictEqual(typeof classifySales, 'function', 'classifySales must be exported')
assert.strictEqual(typeof unifyTouchedProductGroups, 'function', 'unifyTouchedProductGroups must be exported')

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, sku TEXT, barcode TEXT, unit TEXT,
      category TEXT, brand TEXT, selling_price_usd REAL DEFAULT 0, selling_price_khr REAL DEFAULT 0,
      special_price_usd REAL DEFAULT 0, cost_price_usd REAL DEFAULT 0, cost_price_khr REAL DEFAULT 0,
      stock_quantity REAL DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT);
    CREATE TABLE branches (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, phone TEXT);
    CREATE TABLE delivery_contacts (id INTEGER PRIMARY KEY, name TEXT, phone TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, name TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE product_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, variant_product_id INTEGER,
      batch_key TEXT, lot_code TEXT, expiry_date TEXT, received_at TEXT, is_active INTEGER DEFAULT 1,
      notes TEXT, batch_number INTEGER, supplier_id INTEGER, supplier_name TEXT, unit_cost_usd REAL,
      payment_status TEXT, credit_due_date TEXT, received_quantity REAL, created_at TEXT, updated_at TEXT);
    CREATE TABLE branch_batch_stock (batch_id INTEGER, branch_id INTEGER, quantity REAL DEFAULT 0,
      updated_at TEXT, UNIQUE(batch_id, branch_id));
    INSERT INTO branches(id, name) VALUES (1, 'Shop'), (2, 'Warehouse');
  `)
  const db = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql)
      return {
        get: (p) => Promise.resolve(stmt.get(p || {})),
        all: (p) => Promise.resolve(stmt.all(p || {})),
        run: (p) => { const i = stmt.run(p || {}); return Promise.resolve({ changes: i.changes, lastInsertRowid: Number(i.lastInsertRowid) }) },
      }
    },
    batch(statements) {
      const run = sqlite.transaction(() => statements.map(({ sql, params }) => sqlite.prepare(sql).run(params || {})))
      return Promise.resolve(run())
    },
  }
  return { sqlite, db }
}

// Catalog used across the classifier cases: B1 is a barcode shared by two
// DIFFERENT-name products (the real-world promo/set barcode shape), and
// "Twin Serum" is a name shared by two products (children with different
// barcodes).
function seedCatalog(sqlite) {
  sqlite.exec(`
    INSERT INTO products (id, name, barcode, category, brand) VALUES
      (1, 'Dior Lip Glow', 'B1', 'Lips', 'Dior'),
      (2, 'YSL Rouge 21', 'B1', 'Lips', 'YSL'),
      (3, 'Twin Serum', 'C1', 'Skincare', 'Lancome'),
      (4, 'Twin Serum', 'C2', 'Skincare', 'Lancome'),
      (5, 'Solo Cream', 'D1', 'Skincare', 'Clarins');
  `)
}

;(async () => {
  // ---- classifyInventory ---------------------------------------------------
  {
    const { sqlite, db } = makeDb()
    seedCatalog(sqlite)
    const rows = [
      { _rowNumber: 2, barcode: 'B1', name: 'YSL Rouge 21', quantity: '5' },
      { _rowNumber: 3, barcode: 'B1', name: 'Chanel No5', quantity: '5' },
      { _rowNumber: 4, barcode: 'B1', quantity: '5' },
      { _rowNumber: 5, name: 'Solo Cream', quantity: '5' },
      { _rowNumber: 6, name: 'Twin Serum', quantity: '5' },
      { _rowNumber: 7, barcode: 'ZZZ', name: 'Solo Cream', quantity: '5' },
    ]
    const results = await classifyInventory(db, rows, 'add')
    const byRow = new Map(results.map((r) => [r.rowNumber, r]))
    assert.strictEqual(byRow.get(2).existingId, 2, 'shared barcode + name attaches to the name-compatible product, not the last-loaded one')
    assert.strictEqual(byRow.get(3).action, 'error', 'shared barcode + a THIRD name errors instead of attaching to either')
    assert.match(byRow.get(3).message, /different product/i)
    assert.strictEqual(byRow.get(4).action, 'error', 'shared barcode with no name is ambiguous')
    assert.match(byRow.get(4).message, /name/i)
    assert.strictEqual(byRow.get(5).existingId, 5, 'name-only row attaches to the single product of that name')
    assert.strictEqual(byRow.get(6).action, 'error', 'name shared by two child products is ambiguous without a barcode')
    assert.strictEqual(byRow.get(7).action, 'error', 'a row carrying an unknown barcode never falls back to name attach -- different barcode = different identity')
    console.log('PASS classifyInventory attaches by name-compatible identity only')
  }

  // ---- classifySales -------------------------------------------------------
  {
    const { sqlite, db } = makeDb()
    seedCatalog(sqlite)
    const saleRow = (rowNumber, ref, fields) => ({
      _rowNumber: rowNumber,
      order_reference: ref,
      date: '08/28/2026',
      quantity: '1',
      selling_price: '10',
      ...fields,
    })
    const results = await classifySales(db, [
      saleRow(2, 'R1', { barcode: 'B1', name: 'Dior Lip Glow' }),
      saleRow(3, 'R2', { barcode: 'B1', name: 'Chanel No5' }),
      saleRow(4, 'R3', { name: 'Solo Cream' }),
    ])
    const byRow = new Map(results.map((r) => [r.rowNumber, r]))
    const r2 = byRow.get(2)
    assert.notStrictEqual(r2.action, 'error', `shared-barcode sale line with a compatible name must classify (got: ${r2.message})`)
    const r2Items = (r2.data && r2.data.items) || []
    assert.strictEqual(Number(r2Items[0]?.product_id), 1, 'sale line lands on the name-compatible product, not the last-loaded barcode twin')
    assert.strictEqual(byRow.get(3).action, 'error', 'shared barcode + a third name cannot resolve -- errors instead of guessing')
    assert.notStrictEqual(byRow.get(4).action, 'error', 'name-only line still resolves the single product of that name')
    console.log('PASS classifySales resolves items through the same identity rule')
  }

  // ---- §12 stockActionImport.matchProduct ---------------------------------
  {
    const products = [
      { id: 1, name: 'Dior Lip Glow', barcode: 'B1', selling_price_usd: 10, special_price_usd: 8, cost_price_usd: 4 },
      { id: 2, name: 'YSL Rouge 21', barcode: 'B1', selling_price_usd: 12, special_price_usd: 9, cost_price_usd: 5 },
      { id: 3, name: 'Solo Cream', barcode: 'D1', selling_price_usd: 15, special_price_usd: 11, cost_price_usd: 6 },
    ]
    const branches = [{ id: 1, name: 'Shop' }, { id: 2, name: 'Warehouse' }]
    const row = (rowNumber, fields) => ({ _rowNumber: rowNumber, date: '2026-08-28', action: 'add', shop: '1', ...fields })
    const resolved = resolveUnifiedStockImportRows([
      row(2, { name: 'YSL Rouge 21', barcode: 'B1' }),
      row(3, { name: 'Chanel No5', barcode: 'B1' }),
      row(4, { name: 'Solo Cream', barcode: 'D9' }),
      row(5, { name: 'Solo Cream', barcode: '' }),
      row(6, { name: '', barcode: 'B1' }),
    ], 'direct', products, branches, [])
    const byRow = new Map(resolved.map((r) => [r.rowNumber, r]))
    assert.strictEqual(byRow.get(2).productId, 2, 'name-compatible barcode match attaches')
    assert.strictEqual(byRow.get(3).productId, null, 'same barcode + different name never attaches')
    assert.strictEqual(byRow.get(3).conflicts.length, 0, 'it is a CREATE of its own product, not a blocked conflict')
    assert.strictEqual(byRow.get(3).identityKey, 'new:chanel no5|b1', 'the new product keeps its own name+barcode identity')
    assert.strictEqual(byRow.get(4).productId, null, 'same name + a NEW barcode is a child row (create), not an attach to the other-barcode sibling')
    assert.strictEqual(byRow.get(4).conflicts.length, 0)
    assert.strictEqual(byRow.get(5).productId, 3, 'a row with NO barcode may attach by unambiguous name')
    assert.strictEqual(byRow.get(6).productId, null, 'barcode shared across names with no row name cannot resolve')
    assert.strictEqual(byRow.get(6).conflicts.length, 1)
    assert.match(byRow.get(6).conflicts[0], /name/i)
    console.log('PASS §12 matchProduct never attaches across names')
  }

  // ---- unifyTouchedProductGroups (D6b) ------------------------------------
  {
    const { sqlite, db } = makeDb()
    sqlite.exec(`
      INSERT INTO products (id, name, barcode, category, brand, updated_at) VALUES
        (1, 'Group A', 'A1', 'Lips',     'Dior', '2026-08-28 10:00:00'),
        (2, 'Group A', 'A2', 'Lips',     '',     '2026-08-28 10:00:00'),
        (3, 'Group A', 'A3', 'Makeup',   'Dior', '2026-08-28 12:00:00'),
        (4, 'Group B', 'B1', 'Old Cat',  'X',    '2026-08-28 10:00:00'),
        (5, 'Group B', 'B2', 'Other',    'Y',    '2026-08-28 10:00:00'),
        (6, 'Tie Grp', 'T1', 'First',    '',     '2026-08-28 10:00:00'),
        (7, 'Tie Grp', 'T2', 'Second',   '',     '2026-08-28 12:00:00');
    `)
    const changed = await unifyTouchedProductGroups(db, '2026-08-28 11:00:00')
    // Group A: touched (row 3); category majority 'Lips' (2v1) wins; brand
    // 'Dior' fills row 2's blank. Group B: NOT touched -- disagreement stays.
    // Tie Grp: touched; 1v1 category tie -> row 6 (lowest id) wins 'First'.
    assert.strictEqual(changed, 2, 'exactly the two touched groups change')
    const rows = sqlite.prepare(`SELECT id, category, brand FROM products ORDER BY id`).all()
    assert.deepStrictEqual(rows.map((r) => r.category), ['Lips', 'Lips', 'Lips', 'Old Cat', 'Other', 'First', 'First'])
    assert.deepStrictEqual(rows.map((r) => r.brand), ['Dior', 'Dior', 'Dior', 'X', 'Y', '', ''])
    console.log('PASS D6b unifies category/brand in touched groups only (majority, tie -> first row)')
  }

  console.log('All import identity-rule tests passed')
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
