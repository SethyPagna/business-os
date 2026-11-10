'use strict'
// P2.8-F (3 Nov 2026): the REAL Sales and Returns search code, run on real SQLite without a Worker. buildSalesSearchWhere
// (routes/sales.ts) and returnsFilter (routes/returns.ts) are sliced out of the source files between two anchors and executed with the
// real lib/searchMatch.ts and lib/phoneSearchGuard.ts (transpiled, relative imports resolved among the libs). A mutant rewrites one
// source before it is loaded. Used by test-phone-search-mixed-words-pure.cjs and test-phone-search-masked-columns-pure.cjs.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')
const Database = require('better-sqlite3')

const ROOT = path.join(__dirname, '..', '..')
const BASE_COMMIT = 'd1a29856a'
const unix = (text) => text.split('\r\n').join('\n')
const readSrc = (rel) => unix(fs.readFileSync(path.join(ROOT, 'src', rel), 'utf8'))
const readBase = (rel, commit = BASE_COMMIT) => unix(execFileSync('git', ['show', `${commit}:cloudflare/src/${rel}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
const transpile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText

const must = (source, needle) => { assert.ok(source.includes(needle), `mutation anchor missing: ${needle}`); return needle }
const replaceOnce = (needle, replacement) => (source) => source.replace(must(source, needle), () => replacement)

/** The real lib modules (relative imports resolved among themselves). `mutate[name]` rewrites one module's source; `commit` reads them from that commit. */
function libLoader(mutate = {}, commit = null) {
  const cache = new Map()
  const load = (name) => {
    if (cache.has(name)) return cache.get(name).exports
    const module = { exports: {} }
    cache.set(name, module)
    let source = commit ? readBase(`lib/${name}.ts`, commit) : readSrc(`lib/${name}.ts`)
    if (mutate[name]) source = mutate[name](source)
    new Function('require', 'module', 'exports', transpile(source))((id) => {
      if (id.startsWith('./')) return load(id.slice(2))
      throw new Error(`unexpected import ${id}`)
    }, module, module.exports)
    return module.exports
  }
  return load
}

/** A function copied out of a route file between two anchors and run with the named dependencies. */
function sliceOf(source, start, end, deps, exported, prelude = '') {
  const from = source.indexOf(must(source, start))
  const to = source.indexOf(must(source, end), from)
  assert.ok(to > from, `slice end after start: ${end}`)
  const names = Object.keys(deps)
  return new Function('deps', `const { ${names.join(', ')} } = deps\n${prelude}\n${transpile(source.slice(from, to))}\nreturn { ${exported.join(', ')} }`)(deps)
}

const SALES_SLICE = ['function concatBalanced(', '\n// GET /api/sales -- the real list']
const RETURNS_SLICE = ['type ReturnsFilter =', "\napp.get('/', async (c) => {\n  const db = getDb(c.env)\n  const query = c.req.query()\n  const includeItems"]
const RETURNS_PRELUDE = "const CUSTOMER_SCOPE = 'customer'; const SUPPLIER_SCOPE = 'supplier'; const normalizeScope = (value, fallback) => (String(value || '').toLowerCase() === 'supplier' ? 'supplier' : fallback)"

/**
 * The Sales and Returns search builders of the working tree, with optional source mutations. `base`: the routes of `commit`, the libs of the
 * working tree; `baseLib` too: the libs of `commit` as well (the whole search as it was then).
 */
function build({ lib = {}, sales = (s) => s, returns = (s) => s, base = false, baseLib = false, commit = BASE_COMMIT } = {}) {
  const load = libLoader(lib, base && baseLib ? commit : null)
  const guard = load('phoneSearchGuard')
  const match = load('searchMatch')
  const deps = { ...guard, tokenizeSearchTermGroups: match.tokenizeSearchTermGroups, buildLikeAliasClause: match.buildLikeAliasClause }
  const read = base ? (rel) => readBase(rel, commit) : readSrc
  const { buildSalesSearchWhere } = sliceOf(sales(read('routes/sales.ts')), SALES_SLICE[0], SALES_SLICE[1], deps, ['buildSalesSearchWhere'])
  const { returnsFilter } = sliceOf(returns(read('routes/returns.ts')), RETURNS_SLICE[0], RETURNS_SLICE[1], deps, ['returnsFilter'], RETURNS_PRELUDE)
  return { load, guard, match, buildSalesSearchWhere, returnsFilter }
}

const OPEN = { fullPhone: true }
const CLOSED = { fullPhone: false }

const SCHEMA = [
  'CREATE TABLE customers (id INTEGER PRIMARY KEY, membership_number TEXT)',
  'CREATE TABLE products (id INTEGER PRIMARY KEY, sku TEXT, barcode TEXT, brand TEXT, name_normalized TEXT, brand_compact TEXT)',
  `CREATE TABLE sales (id INTEGER PRIMARY KEY, receipt_number TEXT, legacy_receipt_number TEXT, cashier_name TEXT, customer_name TEXT, customer_phone TEXT,
    branch_name TEXT, payment_method TEXT, notes TEXT, search_normalized TEXT, customer_id INTEGER)`,
  'CREATE TABLE sale_items (id INTEGER PRIMARY KEY, sale_id INTEGER, product_id INTEGER, product_name TEXT, sku TEXT)',
  `CREATE TABLE returns (id INTEGER PRIMARY KEY, return_number TEXT, receipt_number TEXT, cashier_name TEXT, customer_name TEXT, supplier_name TEXT, reason TEXT,
    notes TEXT, return_type TEXT, supplier_settlement TEXT, search_normalized TEXT, return_scope TEXT, created_at TEXT)`,
  'CREATE TABLE return_items (id INTEGER PRIMARY KEY, return_id INTEGER, product_id INTEGER, product_name TEXT)',
]

/**
 * An in-memory database with the Sales and Returns tables and one product. `seed({ addSale, addReturn, normalize })` adds the rows.
 * search_normalized is written the way the app writes it: the folded text of the row's own fields.
 */
function freshDb(normalize, seed) {
  const db = new Database(':memory:')
  for (const ddl of SCHEMA) db.exec(ddl)
  db.prepare('INSERT INTO products (id, sku, barcode, brand, name_normalized, brand_compact) VALUES (1, ?, ?, ?, ?, ?)').run('P28-SKU-1', '8871000000019', 'Fixture Brand', 'fixture soap', 'fixturebrand')
  const saleInsert = db.prepare(`INSERT INTO sales (id, receipt_number, cashier_name, customer_name, customer_phone, branch_name, payment_method, notes, search_normalized)
    VALUES (?, ?, ?, ?, ?, ?, 'Cash', ?, ?)`)
  const item = db.prepare('INSERT INTO sale_items (sale_id, product_id, product_name, sku) VALUES (?, 1, ?, ?)')
  const addSale = (id, receipt, { cashier = 'Admin', name = 'Walk-in', phone = '', branch = 'Main', notes = null, folded } = {}) => {
    saleInsert.run(id, receipt, cashier, name, phone, branch, notes, folded ?? normalize([receipt, cashier, name, phone.replace(/\s+/g, ''), branch, notes].filter(Boolean).join(' ')))
    item.run(id, 'Fixture Soap', 'P28-SKU-1')
  }
  const returnInsert = db.prepare(`INSERT INTO returns (id, return_number, receipt_number, cashier_name, customer_name, supplier_name, reason, notes, search_normalized, return_scope, created_at)
    VALUES (?, ?, 'P28-0101', ?, ?, ?, ?, ?, ?, ?, '2026-11-03 01:00:00')`)
  const addReturn = (id, number, { cashier = 'Admin', name = null, supplier = null, reason = null, notes = null, scope = 'customer', folded } = {}) => {
    returnInsert.run(id, number, cashier, name, supplier, reason, notes, folded ?? normalize([number, 'P28-0101', cashier, name, supplier, reason, notes].filter(Boolean).join(' ')), scope)
  }
  seed({ addSale, addReturn, normalize })
  return db
}

/** The finders a test calls: receipts a Sales search returns, return numbers a Returns search returns. */
function finders(db, world) {
  const sales = (search, access, searchMode) => {
    const params = {}
    const where = world.buildSalesSearchWhere({ search, ...(searchMode ? { searchMode } : {}) }, params, access)
    if (!where) return null
    return db.prepare(`SELECT s.receipt_number AS r FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE ${where} ORDER BY s.id`).all(params).map((row) => row.r)
  }
  const returns = (search, access, scope = 'customer') => {
    const filter = world.returnsFilter({ search, scope }, { sql: '1=1', params: {} }, access)
    return db.prepare(`SELECT r.return_number AS n FROM returns r WHERE ${filter.where.join(' AND ')} ORDER BY r.id`).all(filter.params).map((row) => row.n)
  }
  return { sales, returns }
}

module.exports = { ROOT, BASE_COMMIT, readSrc, readBase, transpile, must, replaceOnce, libLoader, sliceOf, build, OPEN, CLOSED, SCHEMA, freshDb, finders }
