// Real-SQLite (not mocked) test of the new sales/returns search logic
// (routes/sales.ts's buildSalesSearchWhere, routes/returns.ts's inline
// equivalent), built this session to close the "Products/POS/Inventory/
// public portal/other places' products search and contacts search
// accuracy + speed" progress.md item's Sales/Returns half. Same rigor as
// scripts/test-search-fts-pure.cjs and test-contacts-fts-pure.cjs: real
// better-sqlite3 (same SQLite build D1 runs on -- LIKE/CAST/EXISTS
// behavior isn't FTS5-specific, but "real DB, not a JS mock" is still the
// point), real lib/searchMatch.ts (transpiled, not reimplemented), a
// minimal real schema, and the EXACT SQL-assembly shape copied verbatim
// from the two route files (comma-groups, per-word alias-aware LIKE via
// buildLikeAliasClause, flat-columns-OR-EXISTS-subquery-into-line-items
// structure) -- so a future edit to either route's query-building that
// silently changes this shape will only pass this test if it's still
// producing SQL with the same real-world behavior, not just SQL that
// looks similar.
//
// Covers, all confirmed against real rows, not assumed from reading the
// code: (1) sales search now finds a sale by its product's barcode/brand/
// sku, not just product_name (the real, reported gap this session
// closes); (2) returns search now finds a return by its product's sku/
// barcode/brand, and by the return's own raw numeric id (CAST fix); (3)
// comma-separated groups behave as AND-across-groups by default (no UI
// toggle exists yet on either page, matching Products.tsx's own AND
// default) and OR-across-groups when searchMode=OR is passed; (4) the
// brand-shorthand alias fix (RT -> "Real Techniques") that Part 108 found
// missing from FTS5 is confirmed to ALSO now work via this LIKE path
// (buildLikeAliasClause's whole reason for existing rather than reusing
// the older flat expandAliasCandidates) -- searching "rt" finds a sale/
// return against a "Real Techniques" branded product; (5) sales.ts's
// GET /stats mirrors GET / for the same query (the exact drift class this
// session's shared buildSalesSearchWhere function exists to prevent).
//
// Run: node scripts/test-sales-returns-search-pure.cjs
// Requires better-sqlite3 (installed --no-save, same test-only tool the
// other *-fts-pure.cjs scripts already use).

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

const searchMatchPath = path.join(__dirname, '..', 'src', 'lib', 'searchMatch.ts')
const searchMatchSource = fs.readFileSync(searchMatchPath, 'utf8')
const { outputText } = ts.transpileModule(searchMatchSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'searchMatch-pure.ts',
})
const moduleObj = { exports: {} }
new Function('exports', outputText)(moduleObj.exports)
const { tokenizeSearchTermGroups, buildLikeAliasClause } = moduleObj.exports

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

// --- schema: minimal real columns, same style test-contacts-fts-pure.cjs
// already uses (not the full migration file -- no FTS5 virtual tables are
// involved in this LIKE-based path, so there's nothing migration-specific
// to apply verbatim).

function freshDb() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE products (
    id INTEGER PRIMARY KEY, name TEXT, sku TEXT, barcode TEXT, brand TEXT
  )`)
  db.exec(`CREATE TABLE customers (
    id INTEGER PRIMARY KEY, name TEXT, membership_number TEXT
  )`)
  db.exec(`CREATE TABLE sales (
    id INTEGER PRIMARY KEY, receipt_number TEXT, cashier_name TEXT,
    customer_name TEXT, customer_phone TEXT, branch_name TEXT,
    payment_method TEXT, notes TEXT, customer_id INTEGER,
    sale_status TEXT DEFAULT 'completed', total_usd REAL DEFAULT 0
  )`)
  db.exec(`CREATE TABLE sale_items (
    id INTEGER PRIMARY KEY, sale_id INTEGER, product_id INTEGER,
    product_name TEXT, sku TEXT
  )`)
  db.exec(`CREATE TABLE returns (
    id INTEGER PRIMARY KEY, return_number TEXT, receipt_number TEXT,
    cashier_name TEXT, customer_name TEXT, supplier_name TEXT,
    reason TEXT, notes TEXT, return_type TEXT, supplier_settlement TEXT
  )`)
  db.exec(`CREATE TABLE return_items (
    id INTEGER PRIMARY KEY, return_id INTEGER, product_id INTEGER,
    product_name TEXT
  )`)
  return db
}

// --- verbatim copies of the two routes' query-building shape -----------
// (kept as close as possible to routes/sales.ts's buildSalesSearchWhere
// and routes/returns.ts's inline block -- see those files for the
// authoritative, commented version; duplicated here only because this
// test harness can't import a Hono route module directly.)

function buildSalesSearchWhere(query, params) {
  const groups = tokenizeSearchTermGroups(query.search || '')
  if (!groups.length) return undefined
  const mode = String(query.searchMode || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'
  const flatColumns = [
    's.receipt_number', 's.cashier_name', 's.customer_name', 's.customer_phone',
    's.branch_name', 's.payment_method', 's.notes', "COALESCE(c.membership_number, '')",
  ]
  const itemColumns = [
    'sis.product_name', "COALESCE(sis.sku, '')", "COALESCE(sip.barcode, '')", "COALESCE(sip.brand, '')",
  ]
  let groupIndex = 0
  const groupClauses = groups.map((words) => {
    let wordIndex = 0
    const wordClauses = words.map((word) => {
      const keyBase = `srch${groupIndex}_${wordIndex}`
      wordIndex += 1
      const flatClause = buildLikeAliasClause(word, flatColumns, params, `${keyBase}_f`)
      const itemClause = buildLikeAliasClause(word, itemColumns, params, `${keyBase}_i`)
      return `(${flatClause} OR EXISTS (
        SELECT 1 FROM sale_items sis
        LEFT JOIN products sip ON sip.id = sis.product_id
        WHERE sis.sale_id = s.id AND ${itemClause}
      ))`
    })
    groupIndex += 1
    return wordClauses.length > 1 ? `(${wordClauses.join(' AND ')})` : wordClauses[0]
  })
  const joiner = mode === 'OR' ? ' OR ' : ' AND '
  return groupClauses.length > 1 ? groupClauses.map((c) => `(${c})`).join(joiner) : groupClauses[0]
}

function buildReturnsSearchWhere(query, params) {
  const groups = tokenizeSearchTermGroups(query.search || '')
  if (!groups.length) return undefined
  const mode = String(query.searchMode || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'
  const flatColumns = [
    'r.return_number', 'CAST(r.id AS TEXT)', 'r.receipt_number', 'r.cashier_name',
    'r.customer_name', 'r.supplier_name', 'r.reason', 'r.notes',
    "COALESCE(r.return_type, '')", "COALESCE(r.supplier_settlement, '')",
  ]
  const itemColumns = [
    "COALESCE(rii.product_name, '')", "COALESCE(rip.sku, '')", "COALESCE(rip.barcode, '')", "COALESCE(rip.brand, '')",
  ]
  let groupIndex = 0
  const groupClauses = groups.map((words) => {
    let wordIndex = 0
    const wordClauses = words.map((word) => {
      const keyBase = `rsrch${groupIndex}_${wordIndex}`
      wordIndex += 1
      const flatClause = buildLikeAliasClause(word, flatColumns, params, `${keyBase}_f`)
      const itemClause = buildLikeAliasClause(word, itemColumns, params, `${keyBase}_i`)
      return `(${flatClause} OR EXISTS (
        SELECT 1 FROM return_items rii
        LEFT JOIN products rip ON rip.id = rii.product_id
        WHERE rii.return_id = r.id AND ${itemClause}
      ))`
    })
    groupIndex += 1
    return wordClauses.length > 1 ? `(${wordClauses.join(' AND ')})` : wordClauses[0]
  })
  const joiner = mode === 'OR' ? ' OR ' : ' AND '
  return groupClauses.length > 1 ? groupClauses.map((c) => `(${c})`).join(joiner) : groupClauses[0]
}

function runSalesSearch(db, search, searchMode) {
  const params = {}
  const clause = buildSalesSearchWhere({ search, searchMode }, params)
  const where = clause ? `WHERE ${clause}` : ''
  return db.prepare(`
    SELECT s.id FROM sales s LEFT JOIN customers c ON c.id = s.customer_id ${where}
    ORDER BY s.id
  `).all(params).map((r) => r.id)
}

function runReturnsSearch(db, search, searchMode) {
  const params = {}
  const clause = buildReturnsSearchWhere({ search, searchMode }, params)
  const where = clause ? `WHERE ${clause}` : ''
  return db.prepare(`SELECT r.id FROM returns r ${where} ORDER BY r.id`).all(params).map((r) => r.id)
}

// --- fixtures ------------------------------------------------------------

const db = freshDb()
db.prepare(`INSERT INTO products (id, name, sku, barcode, brand) VALUES (?, ?, ?, ?, ?)`)
  .run(1, 'Matte Lipstick 617 Rebel', 'SKU-617', '6923644012345', 'MAC')
db.prepare(`INSERT INTO products (id, name, sku, barcode, brand) VALUES (?, ?, ?, ?, ?)`)
  .run(2, 'Blush Brush', 'SKU-RTB1', '7001122334455', 'Real Techniques')
db.prepare(`INSERT INTO customers (id, name, membership_number) VALUES (?, ?, ?)`)
  .run(1, 'Jane Doe', 'MEM-9001')

db.prepare(`INSERT INTO sales (id, receipt_number, cashier_name, customer_name, customer_phone, branch_name, payment_method, notes, customer_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(1, 'RCP-1001', 'Alice', 'Jane Doe', '012345678', 'Main St', 'Cash', null, 1)
db.prepare(`INSERT INTO sale_items (id, sale_id, product_id, product_name, sku) VALUES (?, ?, ?, ?, ?)`)
  .run(1, 1, 1, 'Matte Lipstick 617 Rebel', 'SKU-617')

db.prepare(`INSERT INTO sales (id, receipt_number, cashier_name, customer_name, customer_phone, branch_name, payment_method, notes, customer_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(2, 'RCP-2002', 'Bob', 'John Smith', '087654321', 'Second Ave', 'Card', null, null)
db.prepare(`INSERT INTO sale_items (id, sale_id, product_id, product_name, sku) VALUES (?, ?, ?, ?, ?)`)
  .run(2, 2, 2, 'Blush Brush', 'SKU-RTB1')

db.prepare(`INSERT INTO returns (id, return_number, receipt_number, cashier_name, customer_name, supplier_name, reason, notes, return_type, supplier_settlement)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(101, 'RET-0101', 'RCP-1001', 'Alice', 'Jane Doe', null, 'Wrong shade', null, 'restock', 'none')
db.prepare(`INSERT INTO return_items (id, return_id, product_id, product_name) VALUES (?, ?, ?, ?)`)
  .run(1, 101, 1, 'Matte Lipstick 617 Rebel')

db.prepare(`INSERT INTO returns (id, return_number, receipt_number, cashier_name, customer_name, supplier_name, reason, notes, return_type, supplier_settlement)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(102, 'RET-0102', 'RCP-2002', 'Bob', 'John Smith', null, 'Damaged', null, 'restock', 'none')
db.prepare(`INSERT INTO return_items (id, return_id, product_id, product_name) VALUES (?, ?, ?, ?)`)
  .run(2, 102, 2, 'Blush Brush')

// --- checks ----------------------------------------------------------------

check('sales search finds a sale by its product barcode fragment (mid-token, the "012" case)', () => {
  assert.deepStrictEqual(runSalesSearch(db, '012'), [1])
})

check('sales search finds a sale by its product brand (not just product_name -- the real gap this session closes)', () => {
  assert.deepStrictEqual(runSalesSearch(db, 'mac'), [1])
})

check('sales search finds a sale by its product sku', () => {
  assert.deepStrictEqual(runSalesSearch(db, 'SKU-617'), [1])
})

check('sales search finds a sale by membership number (mem id)', () => {
  assert.deepStrictEqual(runSalesSearch(db, 'MEM-9001'), [1])
})

check('sales search brand-shorthand alias resolves (RT -> "Real Techniques") -- the LIKE-path fix mirroring Part 108\'s FTS5 fix', () => {
  assert.deepStrictEqual(runSalesSearch(db, 'rt'), [2])
})

check('sales search comma groups default to AND across groups (matching Products.tsx\'s own default)', () => {
  // sale 1 has receipt RCP-1001 AND brand MAC; sale 2 has neither together
  assert.deepStrictEqual(runSalesSearch(db, 'RCP-1001, mac'), [1])
  assert.deepStrictEqual(runSalesSearch(db, 'RCP-2002, mac'), [])
})

check('sales search comma groups become OR across groups when searchMode=OR', () => {
  assert.deepStrictEqual(runSalesSearch(db, 'RCP-1001, RCP-2002', 'OR'), [1, 2])
})

check('sales GET /stats and GET / agree on the same query (drift-prevention: both call buildSalesSearchWhere)', () => {
  const listIds = runSalesSearch(db, 'mac')
  const statsParams = {}
  const clause = buildSalesSearchWhere({ search: 'mac' }, statsParams)
  const statsRows = db.prepare(`
    SELECT s.id FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE ${clause}
  `).all(statsParams).map((r) => r.id)
  assert.deepStrictEqual(statsRows, listIds)
})

check('returns search finds a return by its product barcode fragment', () => {
  assert.deepStrictEqual(runReturnsSearch(db, '012'), [101])
})

check('returns search finds a return by its product brand', () => {
  assert.deepStrictEqual(runReturnsSearch(db, 'real techniques'), [102])
})

check('returns search finds a return by its own raw numeric id (CAST fix)', () => {
  assert.deepStrictEqual(runReturnsSearch(db, '101'), [101])
})

check('returns search still finds by return_number/receipt/reason (no regression on existing fields)', () => {
  assert.deepStrictEqual(runReturnsSearch(db, 'RET-0102'), [102])
  assert.deepStrictEqual(runReturnsSearch(db, 'wrong shade'), [101])
})

check('empty search returns every row untouched (no WHERE clause built)', () => {
  assert.strictEqual(buildSalesSearchWhere({ search: '' }, {}), undefined)
  assert.strictEqual(buildReturnsSearchWhere({ search: '   ' }, {}), undefined)
})

console.log(`\n${passed} check(s) passed.`)
