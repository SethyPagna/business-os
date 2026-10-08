const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const guard = require('./harness/product_stock_guard.cjs')
function load(name, dependencies = {}) {
  const file = path.join(__dirname, '../src/lib', name + '.ts')
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', output)(mod, mod.exports, id => {
    if (Object.hasOwn(dependencies, id)) return dependencies[id]
    throw new Error(`Unmapped ${name} import: ${id}`)
  })
  return mod.exports
}
const search = load('searchMatch')
const builder = load('productSearchQuery', { './searchMatch': search, './productStockGuard': guard })
const db = new DatabaseSync(':memory:')
db.limits.exprDepth = 100
// Minimal legacy-reader fixture deliberately permits retained inactive stock.
db.exec(`CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,sku TEXT,barcode TEXT,brand TEXT,category TEXT,supplier TEXT,description TEXT,unit TEXT,is_active INTEGER,stock_quantity REAL,name_normalized TEXT,unit_normalized TEXT,brand_compact TEXT);
CREATE TABLE branch_stock(product_id INTEGER,quantity REAL);
CREATE TABLE product_batches(id INTEGER PRIMARY KEY,variant_product_id INTEGER);
CREATE TABLE branch_batch_stock(batch_id INTEGER,quantity REAL);
CREATE TABLE damaged_stock_lots(product_id INTEGER,quantity_remaining REAL);`)
const insert = db.prepare('INSERT INTO products(id,name,brand,is_active,stock_quantity,name_normalized,brand_compact) VALUES(?,?,?,?,?,?,?)')
for (let id = 1; id <= 7; id++) insert.run(id, 'Bright Serum Glow100ml Blush', 'e.l.f.', id === 5 ? 1 : 0, id === 1 ? 1 : id === 7 ? -1 : 0, 'bright serum glow100ml blush', 'elf')
db.exec('INSERT INTO branch_stock VALUES(2,1); INSERT INTO product_batches VALUES(3,3); INSERT INTO branch_batch_stock VALUES(3,1); INSERT INTO damaged_stock_lots VALUES(4,1)')
for (const file of ['0018_products_fts.sql', '0019_products_fts_code.sql', '0021_products_fts_name_trigram.sql']) db.exec(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'))
const visible = guard.stockVisibleProductSql()
const expected = [1,2,3,4,5,7]
function ids(clause, params) {
  const sql = `SELECT p.id FROM products p WHERE ${clause} ORDER BY p.id`
  const used = Object.fromEntries([...sql.matchAll(/@(\w+)/g)].map(match => [match[1], params[match[1]]]))
  return db.prepare(sql).all(used).map(row => row.id)
}
for (const [label, make] of [
  ['short', (p, visibility) => search.buildShortWordFallbackClause([['ml']], 'AND', ['p.name_normalized'], p, 's', true, visibility)],
  ['partial', (p, visibility) => search.buildPartialWordMatchClause([['bright','serum','blush','absent']], 'AND', ['p.name_normalized'], p, 'p', 4, true, visibility)],
  ['compact', (p, visibility) => search.buildCompactBrandMatchClause([['elf']], 'AND', p, 'c', visibility)],
]) {
  let params = {}; const clause = make(params, visible)
  assert.deepEqual(ids(clause, params), expected, `${label}: every ledger alone remains visible; empty inactive stays hidden`)
  assert.match(clause, new RegExp(`LIMIT ${label === 'short' ? 500 : 200}`))
  params = {}; assert.deepEqual(ids(make(params, undefined), params), [5], `${label}: legacy default remains active-only`)
  console.log(`PASS ${label} ledger-only visibility, negative legacy stock, zero exclusion, unchanged cap and default`)
}
for (const query of ['ml', 'bright serum blush absent', 'elf blush']) {
  const params = {}; const built = builder.buildProductSearchQuery(query, params, {})
  assert.deepEqual(ids(`(${visible}) AND (${built.whereClause})`, params), expected, query)
  console.log(`PASS real shared builder fallback ${query}`)
}
db.close()
