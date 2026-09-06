// The identity rule, enforced on EVERY backend import path (Part 383 R1):
//   same name + same barcode + same cost = the SAME product (attach/merge)
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
  // productIdentity carries identityBarcodeKeySql -- the ONE SQL spelling of the
  // fold the bounded catalog query uses. Stubbing it would let this test pass
  // over a query that never folds.
  'productIdentity',
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
      wholesale_price_usd REAL DEFAULT 0, cost_price_usd REAL DEFAULT 0, cost_price_khr REAL DEFAULT 0,
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

  // ---- N15: the leading-zero twin resolves, on BOTH classifiers -----------
  // A stocktake or sales export written in the GTIN-14 form of a code the
  // catalog stores as EAN-13 (one extra leading zero) used to fail "Product
  // not found for sku/barcode" on every line: byBarcode was keyed by the RAW
  // lowercased barcode, while classifyProducts, the Conflicts sweep and the
  // merge tool all called that pair one product. Both maps now key -- and are
  // read -- through identityBarcodeKey, so the row lands on the clean-barcode
  // product. The stored barcode is never rewritten.
  //
  // DISCRIMINATING: on the raw-key code the inventory row and the sale line
  // below are both action='error'.
  {
    const { sqlite, db } = makeDb()
    sqlite.exec(`
      INSERT INTO products (id, name, barcode, category, brand) VALUES
        (1, 'Rose Lip Oil', '3614274226546', 'Lips', 'Dior'),
        (2, 'Short Code Balm', '0012', 'Lips', 'Dior');
    `)
    const inventory = await classifyInventory(db, [
      { _rowNumber: 2, barcode: '03614274226546', name: 'Rose Lip Oil', quantity: '5' },
      { _rowNumber: 3, barcode: '12', name: 'Short Code Balm', quantity: '5' },
    ], 'add')
    const inv = new Map(inventory.map((r) => [r.rowNumber, r]))
    assert.notStrictEqual(inv.get(2).action, 'error', `a zero-padded inventory row must resolve (got: ${inv.get(2).message})`)
    assert.strictEqual(inv.get(2).existingId, 1, 'it is the SAME product, not a missing one')
    assert.strictEqual(inv.get(3).action, 'error', "'0012' and '12' are NOT one code -- stripping would leave under 3 characters")

    const sales = await classifySales(db, [
      { _rowNumber: 2, order_reference: 'RZ1', date: '08/28/2026', quantity: '1', selling_price: '10', barcode: '03614274226546', name: 'Rose Lip Oil' },
    ])
    const sale = sales.find((r) => r.rowNumber === 2)
    assert.notStrictEqual(sale.action, 'error', `a zero-padded sale line must resolve (got: ${sale.message})`)
    assert.strictEqual(Number(((sale.data && sale.data.items) || [])[0]?.product_id), 1,
      'the sale lands on the clean-barcode product, not a new one')
    console.log('PASS N15 a leading-zero barcode resolves to the clean-barcode product on both import classifiers')
  }

  // ---- §12 stockActionImport.matchProduct ---------------------------------
  {
    const products = [
      { id: 1, name: 'Dior Lip Glow', barcode: 'B1', selling_price_usd: 10, wholesale_price_usd: 8, cost_price_usd: 4 },
      { id: 2, name: 'YSL Rouge 21', barcode: 'B1', selling_price_usd: 12, wholesale_price_usd: 9, cost_price_usd: 5 },
      { id: 3, name: 'Solo Cream', barcode: 'D1', selling_price_usd: 15, wholesale_price_usd: 11, cost_price_usd: 6 },
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
    assert.strictEqual(byRow.get(3).identityKey, 'new:chanel no5|b1', 'the new product keeps its exact name+barcode identity')
    assert.strictEqual(byRow.get(4).productId, null, 'same name + a NEW barcode is a child row (create), not an attach to the other-barcode sibling')
    assert.strictEqual(byRow.get(4).conflicts.length, 0)
    assert.strictEqual(byRow.get(5).productId, null, 'blank barcode differs from a real barcode and creates a child row')
    assert.strictEqual(byRow.get(6).productId, null, 'barcode shared across names with no row name cannot resolve')
    assert.strictEqual(byRow.get(6).conflicts.length, 1)
    assert.match(byRow.get(6).conflicts[0], /name/i)
    console.log('PASS §12 matchProduct never attaches across names')
  }

  // ---- N15 §12: the live stock_actions import asks the SAME identity question
  // Two rules used to live only here and nowhere else in the app, and each one
  // MINTED the rows the merge tool then has to clean up:
  //   * the barcode was compared RAW, so a sheet written in the GTIN-14 form of
  //     a code stored as EAN-13 matched nothing and the import created the
  //     leading-zero twin itself;
  //   * a different COST forked a new product -- the pre-Sep-4 rule, gone from
  //     products.ts and stockSession.ts, so a restock at a new price silently
  //     became a second product row.
  //
  // DISCRIMINATING: on the pre-fix code rows 2, 3 and 4 below all report
  // productId null (three fresh products), and rows 2 and 3 carry two DIFFERENT
  // new-product identity keys.
  {
    const products = [
      { id: 10, name: 'Rose Lip Oil', barcode: '3614274226546', selling_price_usd: 20, wholesale_price_usd: 18, cost_price_usd: 4 },
      { id: 11, name: 'Short Code Balm', barcode: '0012', selling_price_usd: 6, wholesale_price_usd: 5, cost_price_usd: 3 },
    ]
    const branches = [{ id: 1, name: 'Shop' }, { id: 2, name: 'Warehouse' }]
    const row = (rowNumber, fields) => ({ _rowNumber: rowNumber, date: '2026-08-28', action: 'add', shop: '1', ...fields })
    const resolved = resolveUnifiedStockImportRows([
      row(2, { name: 'Rose Lip Oil', barcode: '03614274226546', cost_price: '4' }),
      row(3, { name: 'Rose Lip Oil', barcode: '3614274226546', cost_price: '9' }),
      row(4, { name: '', barcode: '03614274226546' }),
      row(5, { name: 'Short Code Balm', barcode: '12', cost_price: '3' }),
      row(6, { name: 'Brand New Thing', barcode: '00099887766554', cost_price: '2' }),
      row(7, { name: 'Brand New Thing', barcode: '99887766554', cost_price: '7' }),
    ], 'direct', products, branches, [])
    const byRow = new Map(resolved.map((r) => [r.rowNumber, r]))
    assert.strictEqual(byRow.get(2).productId, 10, 'a zero-padded stock-action row attaches to the clean-barcode product instead of minting the twin')
    assert.strictEqual(byRow.get(2).conflicts.length, 0)
    assert.strictEqual(byRow.get(3).productId, 10, 'a different COST is not a different product -- cost stopped being identity on Sep 4 2026')
    assert.strictEqual(byRow.get(3).costPriceUsd, 9, 'the row still carries its own cost onto the batch it adds')
    assert.strictEqual(byRow.get(2).identityKey, byRow.get(3).identityKey,
      'both rows resolve to ONE product identity, so the resolver plans one product, not a cost fork')
    assert.strictEqual(byRow.get(4).productId, 10, 'a barcode-only row folds too (no name to disambiguate, one candidate)')
    assert.strictEqual(byRow.get(5).productId, null, "'0012' and '12' are NOT one code -- stripping would leave under 3 characters")
    assert.strictEqual(byRow.get(5).conflicts.length, 0, 'so that row is a plain create, not a blocked conflict')
    // Same fold for rows that must CREATE: two sheet lines writing one new code
    // two ways, at two costs, are one new product -- not three.
    assert.strictEqual(byRow.get(6).productId, null)
    assert.strictEqual(byRow.get(6).identityKey, byRow.get(7).identityKey,
      'two spellings of the same new barcode at two costs share one new-product identity')
    assert.strictEqual(byRow.get(6).identityKey, 'new:brand new thing|99887766554')
    console.log('PASS N15 §12 the stock-action import folds the barcode and no longer forks on cost')
  }

  // ---- N15 §12: the CATALOG QUERY has to fold too --------------------------
  // matchProduct can only fold candidates the SQL actually selected. The
  // barcode prefilter compared LOWER(TRIM(barcode)) raw, so for a barcode-only
  // sheet row the clean-barcode product was never even loaded and the import
  // created the twin regardless of what matchProduct decided. This runs the
  // real classifyUnifiedStockActions against a real SQLite.
  //
  // DISCRIMINATING: on the pre-fix code row 2 is action='create'.
  {
    const { normalizeSearchText } = loadReal('searchMatch')
    const { classifyUnifiedStockActions } = loadReal('stockActionCatalog')
    const sqlite = new Database(':memory:')
    sqlite.exec(`
      CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, name_normalized TEXT,
        barcode TEXT, selling_price_usd REAL DEFAULT 0, wholesale_price_usd REAL DEFAULT 0,
        cost_price_usd REAL DEFAULT 0, is_active INTEGER DEFAULT 1);
      CREATE TABLE branches (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1);
      CREATE TABLE product_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, variant_product_id INTEGER,
        batch_key TEXT, lot_code TEXT, is_active INTEGER DEFAULT 1);
      CREATE TABLE branch_stock (product_id INTEGER, branch_id INTEGER, quantity REAL DEFAULT 0);
      INSERT INTO branches (id, name) VALUES (1, 'Shop'), (2, 'Warehouse');
    `)
    const insert = sqlite.prepare(`INSERT INTO products (id, name, name_normalized, barcode, selling_price_usd, wholesale_price_usd, cost_price_usd)
      VALUES (@id, @name, @normalized, @barcode, @selling, @wholesale, @cost)`)
    insert.run({ id: 10, name: 'Rose Lip Oil', normalized: normalizeSearchText('Rose Lip Oil'), barcode: '3614274226546', selling: 20, wholesale: 18, cost: 4 })
    insert.run({ id: 11, name: 'Short Code Balm', normalized: normalizeSearchText('Short Code Balm'), barcode: '0012', selling: 6, wholesale: 5, cost: 3 })
    sqlite.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10, 1, 5), (11, 1, 5)`).run()
    const db = {
      prepare(sql) {
        const stmt = sqlite.prepare(sql)
        return {
          get: (p) => Promise.resolve(stmt.get(p || {})),
          all: (p) => Promise.resolve(stmt.all(p || {})),
          run: (p) => { const i = stmt.run(p || {}); return Promise.resolve({ changes: i.changes, lastInsertRowid: Number(i.lastInsertRowid) }) },
        }
      },
    }
    // The barcode-only rows go through ALONE on purpose: `found` is one map
    // for the whole window, so a sibling row naming the same product would
    // load it through the NAME prefilter and hide a barcode prefilter that
    // never folds.
    const results = await classifyUnifiedStockActions(db, [
      { _rowNumber: 2, name: '', barcode: '03614274226546', date: '2026-08-28', action: 'add', shop: '1' },
      { _rowNumber: 4, name: '', barcode: '12', date: '2026-08-28', action: 'add', shop: '1' },
    ], null)
    const named = await classifyUnifiedStockActions(db, [
      { _rowNumber: 3, name: 'Rose Lip Oil', barcode: '3614274226546', date: '2026-08-28', action: 'add', shop: '1', cost_price: '9' },
    ], null)
    const byRow = new Map([...results, ...named].map((r) => [r.rowNumber, r]))
    assert.strictEqual(byRow.get(2).existingId, 10, `the barcode prefilter must SELECT the folded match (got: ${byRow.get(2).message})`)
    assert.strictEqual(byRow.get(2).action, 'update', 'so the row updates the existing product instead of creating the twin')
    assert.strictEqual(byRow.get(3).existingId, 10, 'a different cost still lands on the same product')
    // Negative control on the same instrument: a fold that also swallowed
    // short codes would report this one as an update too.
    assert.strictEqual(byRow.get(4).existingId, null, "'12' must NOT reach the '0012' product")
    assert.strictEqual(byRow.get(4).action, 'create')
    console.log('PASS N15 §12 the bounded catalog query folds the barcode the same way matchProduct does')
  }

  // ---- N15 §12: the client's in-sheet grouping mirrors the server ----------
  // The review screen groups sheet rows by name+barcode to raise the
  // cost/batch confirm gate. Keyed on the RAW barcode, one file listing '0601'
  // and '601' looked like two products to the reviewer while the import that
  // followed treated them as one.
  //
  // DISCRIMINATING: on the pre-fix code this conflict map is empty.
  {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'products', 'import', 'unifiedStockImport.ts'), 'utf8')
    assert.match(src, /import \{ identityBarcodeKey \} from '\.\.\/\.\.\/\.\.\/utils\/productDetailRule\.ts'/,
      'the sheet review must reach the fold through the rule module both packages carry verbatim')
    assert.match(src, /\$\{identityBarcodeKey\(row\.barcode\)\}/,
      'findUnifiedStockCostBatchConflicts must group on the FOLDED barcode')
    assert.doesNotMatch(src, /\$\{row\.barcode\.trim\(\)\.toLowerCase\(\)\}/,
      'the raw-barcode grouping key is the bug; it must be gone')
    console.log('PASS N15 §12 the client sheet review groups on the same folded key')
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
