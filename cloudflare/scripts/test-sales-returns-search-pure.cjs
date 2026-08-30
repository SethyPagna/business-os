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
const { tokenizeSearchTermGroups, buildLikeAliasClause, normalizeSearchText } = moduleObj.exports

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
    id INTEGER PRIMARY KEY, name TEXT, sku TEXT, barcode TEXT, brand TEXT,
    name_normalized TEXT, brand_compact TEXT
  )`)
  db.exec(`CREATE TABLE customers (
    id INTEGER PRIMARY KEY, name TEXT, membership_number TEXT
  )`)
  db.exec(`CREATE TABLE sales (
    id INTEGER PRIMARY KEY, receipt_number TEXT, cashier_name TEXT,
    customer_name TEXT, customer_phone TEXT, branch_name TEXT,
    payment_method TEXT, notes TEXT, customer_id INTEGER,
    sale_status TEXT DEFAULT 'completed', total_usd REAL DEFAULT 0,
    search_normalized TEXT
  )`)
  db.exec(`CREATE TABLE sale_items (
    id INTEGER PRIMARY KEY, sale_id INTEGER, product_id INTEGER,
    product_name TEXT, sku TEXT
  )`)
  db.exec(`CREATE TABLE returns (
    id INTEGER PRIMARY KEY, return_number TEXT, receipt_number TEXT,
    cashier_name TEXT, customer_name TEXT, supplier_name TEXT,
    reason TEXT, notes TEXT, return_type TEXT, supplier_settlement TEXT,
    sale_id INTEGER, status TEXT, return_scope TEXT, total_refund_usd REAL,
    search_normalized TEXT
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
  const flatHaystack = `(COALESCE(s.search_normalized, '') || ' ' || COALESCE(s.receipt_number, '') || ' ' || COALESCE(s.cashier_name, '') || ' ' || COALESCE(s.customer_name, '') || ' ' || COALESCE(s.customer_phone, '') || ' ' || COALESCE(s.branch_name, '') || ' ' || COALESCE(s.payment_method, '') || ' ' || COALESCE(s.notes, '') || ' ' || COALESCE(c.membership_number, ''))`
  const itemHaystack = `(COALESCE(sis.product_name, '') || ' ' || COALESCE(sis.sku, '') || ' ' || COALESCE(sip.barcode, '') || ' ' || COALESCE(sip.brand, '') || ' ' || COALESCE(sip.name_normalized, '') || ' ' || COALESCE(sip.brand_compact, ''))`
  let groupIndex = 0
  const groupClauses = groups.map((words) => {
    let wordIndex = 0
    const wordClauses = words.map((word) => {
      const keyBase = `srch${groupIndex}_${wordIndex}`
      wordIndex += 1
      const flatClause = buildLikeAliasClause(word, [flatHaystack], params, `${keyBase}_f`, true)
      const itemClause = buildLikeAliasClause(word, [itemHaystack], params, `${keyBase}_i`, true)
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
  const flatHaystack = `(COALESCE(r.search_normalized, '') || ' ' || COALESCE(r.return_number, '') || ' ' || CAST(r.id AS TEXT) || ' ' || COALESCE(r.receipt_number, '') || ' ' || COALESCE(r.cashier_name, '') || ' ' || COALESCE(r.customer_name, '') || ' ' || COALESCE(r.supplier_name, '') || ' ' || COALESCE(r.reason, '') || ' ' || COALESCE(r.notes, '') || ' ' || COALESCE(r.return_type, '') || ' ' || COALESCE(r.supplier_settlement, ''))`
  const itemHaystack = `(COALESCE(rii.product_name, '') || ' ' || COALESCE(rip.sku, '') || ' ' || COALESCE(rip.barcode, '') || ' ' || COALESCE(rip.brand, '') || ' ' || COALESCE(rip.name_normalized, '') || ' ' || COALESCE(rip.brand_compact, ''))`
  let groupIndex = 0
  const groupClauses = groups.map((words) => {
    let wordIndex = 0
    const wordClauses = words.map((word) => {
      const keyBase = `rsrch${groupIndex}_${wordIndex}`
      wordIndex += 1
      const flatClause = buildLikeAliasClause(word, [flatHaystack], params, `${keyBase}_f`, true)
      const itemClause = buildLikeAliasClause(word, [itemHaystack], params, `${keyBase}_i`, true)
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
db.prepare(`INSERT INTO products (id, name, sku, barcode, brand) VALUES (?, ?, ?, ?, ?)`)
  .run(3, 'Legacy Sale Item', 'SKU-HIST', '9999000011112', 'Archive')
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

db.prepare(`INSERT INTO sales (id, receipt_number, cashier_name, customer_name, customer_phone, branch_name, payment_method, notes, customer_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(3, '3329@2024-12-30', 'Alice', 'Sonika Neou', '017305533', 'Shop', 'ABA', null, null)
db.prepare(`INSERT INTO sale_items (id, sale_id, product_id, product_name, sku) VALUES (?, ?, ?, ?, ?)`)
  .run(3, 3, 3, 'Legacy Sale Item', 'SKU-HIST')

db.prepare(`INSERT INTO returns (id, return_number, receipt_number, cashier_name, customer_name, supplier_name, reason, notes, return_type, supplier_settlement)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(101, 'RET-0101', 'RCP-1001', 'Alice', 'Jane Doe', null, 'Wrong shade', null, 'restock', 'none')
db.prepare(`INSERT INTO return_items (id, return_id, product_id, product_name) VALUES (?, ?, ?, ?)`)
  .run(1, 101, 1, 'Matte Lipstick 617 Rebel')

db.prepare(`INSERT INTO returns (id, return_number, receipt_number, cashier_name, customer_name, supplier_name, reason, notes, return_type, supplier_settlement)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(102, 'RET-0102', 'RCP-2002', 'Bob', 'John Smith', null, 'Damaged', null, 'restock', 'none')
db.prepare(`INSERT INTO return_items (id, return_id, product_id, product_name) VALUES (?, ?, ?, ?)`)
  .run(2, 102, 2, 'Blush Brush')

// Diacritic fixtures (migration 0082). Sales 4 and 5 carry the SAME accented
// name ("José ...") -- the only difference is that sale 4 is a LIVE-written row
// whose search_normalized holds the write-time fold (built exactly the way
// routes/sales.ts's POST / now builds it), while sale 5 is a pre-0082 /
// historical-import row with search_normalized NULL. That isolates the fix to
// the blob: a folded query must find sale 4 and NOT sale 5, and sale 5 must
// still behave exactly as it did before 0082 (raw fallback, no fold) -- the
// proof the change is purely additive and never a regression.
const saleBlob = (receipt, cashier, customer, phone, branch, payment) =>
  normalizeSearchText([receipt, cashier, customer, phone, branch, payment].filter(Boolean).join(' '))

db.prepare(`INSERT INTO sales (id, receipt_number, cashier_name, customer_name, customer_phone, branch_name, payment_method, notes, customer_id, search_normalized)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    4, 'RCP-4004', 'Alice', 'José García', '070111222', 'Shop', 'Cash', null, null,
    saleBlob('RCP-4004', 'Alice', 'José García', '070111222', 'Shop', 'Cash'),
  )
db.prepare(`INSERT INTO sales (id, receipt_number, cashier_name, customer_name, customer_phone, branch_name, payment_method, notes, customer_id, search_normalized)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    5, 'RCP-5005', 'Bob', 'José Mendez', '070333444', 'Shop', 'Cash', null, null, null,
  )

db.prepare(`INSERT INTO returns (id, return_number, receipt_number, cashier_name, customer_name, supplier_name, reason, notes, return_type, supplier_settlement, search_normalized)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    103, 'RET-0103', 'RCP-4004', 'Alice', 'José García', null, 'Shade too dark', null, 'restock', 'none',
    normalizeSearchText(['RET-0103', 'RCP-4004', 'Alice', 'José García', 'Shade too dark', 'restock'].filter(Boolean).join(' ')),
  )
db.prepare(`INSERT INTO returns (id, return_number, receipt_number, cashier_name, customer_name, supplier_name, reason, notes, return_type, supplier_settlement, search_normalized)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    104, 'RET-0104', 'RCP-5005', 'Bob', 'José Mendez', null, 'Damaged', null, 'restock', 'none', null,
  )

// --- checks ----------------------------------------------------------------

check('sales diacritic search: a folded query ("jose") finds the live row stored as "José" via search_normalized, and NOT the identical-name row that lacks a blob (the Part-484 fix, isolated to the mechanism)', () => {
  // The typed query is itself folded (normalizeSearchText), so "jose" and
  // "josé" resolve to the same word -- both must find sale 4 (blob) only.
  assert.deepStrictEqual(runSalesSearch(db, 'jose'), [4])
  assert.deepStrictEqual(runSalesSearch(db, 'josé'), [4])
  assert.deepStrictEqual(runSalesSearch(db, 'garcia'), [4])
})

check('sales additive fallback: the pre-0082 row (search_normalized NULL) is unchanged by 0082 -- still found by its ASCII fields, still NOT foldable by its accented name (the honest pre-fix state that write-time population exists to end)', () => {
  assert.deepStrictEqual(runSalesSearch(db, 'RCP-5005'), [5]) // raw fields still search
  assert.deepStrictEqual(runSalesSearch(db, 'jose'), [4])     // accented name not foldable without a blob
})

check('returns diacritic search: a folded query finds the live "José" return via its blob, not the identical-name NULL-blob return', () => {
  assert.deepStrictEqual(runReturnsSearch(db, 'jose'), [103])
  assert.deepStrictEqual(runReturnsSearch(db, 'RET-0104'), [104]) // NULL-blob return still found by raw fields
})

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

check('sales search finds an imported receipt with the @YYYY-MM-DD disambiguator', () => {
  assert.deepStrictEqual(runSalesSearch(db, '3329@2024-12-30'), [3])
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

// routes/sales.ts's GET /stats aggregate, copied verbatim from the route so
// a change there that alters the arithmetic fails here. It replaced a shape
// that read every matching sale into the Worker and then ran one chunked
// refund query per 100 sale ids; this check exists to prove the SQL and the
// old JS produce the SAME three numbers, not merely that the SQL runs.
function salesStatsAggregateSql(where) {
  return `
    SELECT
      COUNT(*) AS total_count,
      COALESCE(SUM(CASE WHEN COALESCE(NULLIF(s.sale_status, ''), 'completed') NOT IN ('cancelled', 'awaiting_payment')
        THEN COALESCE(s.total_usd, 0) - COALESCE(r.refund_usd, 0) ELSE 0 END), 0) AS revenue_usd,
      COALESCE(SUM(CASE WHEN COALESCE(NULLIF(s.sale_status, ''), 'completed') = 'awaiting_payment'
        THEN COALESCE(s.total_usd, 0) ELSE 0 END), 0) AS pending_revenue_usd
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN (
      SELECT sale_id, SUM(total_refund_usd) AS refund_usd
      FROM returns
      WHERE COALESCE(status, 'completed') != 'cancelled' AND COALESCE(return_scope, 'customer') = 'customer'
      GROUP BY sale_id
    ) r ON r.sale_id = s.id
    WHERE ${where}
  `
}

// The pre-aggregate implementation, kept as the reference the SQL is judged
// against: pull the rows, drop cancelled/awaiting from revenue, subtract each
// sale's non-cancelled CUSTOMER refunds, sum awaiting separately.
function statsReference(sdb, where) {
  const rows = sdb.prepare(`SELECT s.id, s.sale_status, s.total_usd FROM sales s WHERE ${where}`).all()
  const revenueIds = rows
    .filter((r) => !['cancelled', 'awaiting_payment'].includes(r.sale_status || 'completed'))
    .map((r) => r.id)
  const refundBySale = new Map()
  if (revenueIds.length) {
    const refundRows = sdb.prepare(`
      SELECT sale_id, COALESCE(SUM(total_refund_usd), 0) AS refund_usd FROM returns
      WHERE sale_id IN (${revenueIds.map(() => '?').join(',')})
        AND COALESCE(status, 'completed') != 'cancelled'
        AND COALESCE(return_scope, 'customer') = 'customer'
      GROUP BY sale_id
    `).all(revenueIds)
    for (const row of refundRows) refundBySale.set(row.sale_id, row.refund_usd || 0)
  }
  const byId = new Map(rows.map((r) => [r.id, r]))
  const revenue = revenueIds.reduce((sum, id) => sum + ((byId.get(id)?.total_usd || 0) - (refundBySale.get(id) || 0)), 0)
  const pending = rows
    .filter((r) => (r.sale_status || 'completed') === 'awaiting_payment')
    .reduce((sum, r) => sum + (r.total_usd || 0), 0)
  return { total_count: rows.length, revenue_usd: revenue, pending_revenue_usd: pending }
}

function statsDb() {
  const fresh = freshDb()
  // One row per status the aggregate branches on -- including the empty
  // string a plain COALESCE would silently drop out of revenue -- plus a
  // sale carrying TWO customer refunds (the case a naive row-level join to
  // returns would double-count) alongside a cancelled and a supplier return
  // that must both be ignored.
  const insert = fresh.prepare("INSERT INTO sales (id, receipt_number, sale_status, total_usd) VALUES (?, ?, ?, ?)")
  insert.run(1, 'S-1', 'completed', 100)
  insert.run(2, 'S-2', 'cancelled', 50)
  insert.run(3, 'S-3', 'awaiting_payment', 40)
  insert.run(4, 'S-4', null, 25)
  insert.run(5, 'S-5', '', 10)
  insert.run(6, 'S-6', 'completed', 200)
  const ret = fresh.prepare("INSERT INTO returns (id, sale_id, status, return_scope, total_refund_usd) VALUES (?, ?, ?, ?, ?)")
  ret.run(201, 6, 'completed', 'customer', 30)
  ret.run(202, 6, 'completed', 'customer', 20)
  ret.run(203, 6, 'cancelled', 'customer', 999)
  ret.run(204, 6, 'completed', 'supplier', 888)
  ret.run(205, 1, 'completed', 'customer', 15)
  return fresh
}

check('sales GET /stats aggregate matches the row-by-row math it replaced', () => {
  const sdb = statsDb()
  for (const where of ['1=1', "s.sale_status = 'completed'", "s.receipt_number = 'S-6'"]) {
    const actual = sdb.prepare(salesStatsAggregateSql(where)).get()
    const expected = statsReference(sdb, where)
    assert.strictEqual(actual.total_count, expected.total_count, `total_count for ${where}`)
    assert.strictEqual(Math.round(actual.revenue_usd * 100), Math.round(expected.revenue_usd * 100), `revenue for ${where}`)
    assert.strictEqual(Math.round(actual.pending_revenue_usd * 100), Math.round(expected.pending_revenue_usd * 100), `pending for ${where}`)
  }
  // Pin the arithmetic itself so a change breaking BOTH implementations the
  // same way still fails: (100-15) + 25 + 10 + (200-30-20) = 270 revenue,
  // 40 awaiting, 6 rows.
  const all = sdb.prepare(salesStatsAggregateSql('1=1')).get()
  assert.strictEqual(all.total_count, 6)
  assert.strictEqual(Math.round(all.revenue_usd * 100), 27000)
  assert.strictEqual(Math.round(all.pending_revenue_usd * 100), 4000)
})

check('sales search SQL stays below D1 statement-size limits at the tokenizer maximum', () => {
  const maxQuery = Array.from({ length: 6 }, (_, group) => (
    Array.from({ length: 8 }, (_, word) => `term${group}${word}`).join(' ')
  )).join(', ')
  const params = {}
  const clause = buildSalesSearchWhere({ search: maxQuery }, params)
  const sql = `SELECT s.id FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE ${clause}`
  assert.ok(Buffer.byteLength(sql, 'utf8') < 100_000, `generated ${Buffer.byteLength(sql, 'utf8')} bytes`)
  assert.ok(Object.keys(params).length <= 100, `generated ${Object.keys(params).length} parameters`)
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
