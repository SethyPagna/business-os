const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const Database = require('better-sqlite3')

const cloudflareRoot = path.join(__dirname, '..')
const routeSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'products.ts'), 'utf8')
const helperStart = routeSource.indexOf('async function expandSearchResultsToNameSiblings')
const helperEnd = routeSource.indexOf('\nasync function ', helperStart + 1)
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'name-sibling helper must remain discoverable')
const helperSource = routeSource.slice(helperStart, helperEnd)
assert.match(helperSource, /AND p\.name_key IN \(\$\{sql\}\)/, 'sibling lookup must use the indexed name_key')
assert.match(helperSource, /FROM products p INDEXED BY idx_products_name_key_pg/, 'sibling lookup must deterministically select the name_key index')
assert.doesNotMatch(helperSource, /AND lower\(trim\(p\.name\)\) IN/, 'sibling lookup must not wrap the name column')

const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
const migrationsDir = path.join(cloudflareRoot, 'migrations')
const migrationFiles = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()
for (const migration of migrationFiles) {
  db.exec(fs.readFileSync(path.join(migrationsDir, migration), 'utf8'))
}

const insert = db.prepare(`
  INSERT INTO products (name, sku, barcode, is_active)
  VALUES (@name, @sku, @barcode, @is_active)
`)

const fixtures = [
  { name: '  Face Cream  ', sku: 'FACE-A', barcode: '012300', is_active: 1 },
  { name: 'face cream', sku: 'FACE-B', barcode: '12300', is_active: 1 },
  { name: 'FACE CREAM', sku: 'FACE-INACTIVE', barcode: '999', is_active: 0 },
  { name: 'Multi  Space', sku: 'SPACE-DOUBLE', barcode: '200', is_active: 1 },
  { name: 'multi space', sku: 'SPACE-SINGLE', barcode: '201', is_active: 1 },
  { name: 'កាហ្វេ ពិសេស', sku: 'KH-A', barcode: '300', is_active: 1 },
  { name: '  កាហ្វេ ពិសេស  ', sku: 'KH-B', barcode: '301', is_active: 1 },
  { name: 'Élite Cream', sku: 'UNICODE-UPPER', barcode: '400', is_active: 1 },
  { name: 'élite cream', sku: 'UNICODE-LOWER', barcode: '401', is_active: 1 },
  { name: 'Barcode Twin', sku: 'BAR-A', barcode: '000567', is_active: 1 },
  { name: 'barcode twin', sku: 'BAR-B', barcode: '567', is_active: 1 },
  { name: 'Rename Me', sku: 'RENAME-A', barcode: '600', is_active: 1 },
  { name: 'Updated Twin', sku: 'RENAME-B', barcode: '601', is_active: 1 },
]
db.transaction((rows) => rows.forEach((row) => insert.run(row)))(fixtures)
db.prepare("UPDATE products SET name = '  UPDATED TWIN  ' WHERE sku = 'RENAME-A'").run()

const normalizedKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()
const keys = [
  normalizedKey('  Face Cream  '),
  normalizedKey('Multi  Space'),
  normalizedKey('កាហ្វេ ពិសេស'),
  normalizedKey('Élite Cream'),
  normalizedKey('Barcode Twin'),
  normalizedKey('Updated Twin'),
]
const placeholders = keys.map((_, index) => `@name${index}`).join(', ')
const params = Object.fromEntries(keys.map((key, index) => [`name${index}`, key]))
const expressionSql = `SELECT id, sku FROM products p WHERE p.is_active = 1 AND lower(trim(p.name)) IN (${placeholders})`
const indexedSql = `SELECT id, sku FROM products p INDEXED BY idx_products_name_key_pg WHERE p.is_active = 1 AND p.name_key IN (${placeholders})`
const sortSkus = (rows) => rows.map((row) => row.sku).sort()

const expressionRows = sortSkus(db.prepare(expressionSql).all(params))
const indexedRows = sortSkus(db.prepare(indexedSql).all(params))
assert.deepEqual(indexedRows, expressionRows, 'indexed lookup must preserve the existing lower(trim(name)) result set')
assert.deepEqual(indexedRows, [
  'BAR-A',
  'BAR-B',
  'FACE-A',
  'FACE-B',
  'KH-A',
  'KH-B',
  'RENAME-A',
  'RENAME-B',
  'SPACE-SINGLE',
  'UNICODE-LOWER',
])

assert.equal(
  db.prepare("SELECT name_key FROM products WHERE sku = 'RENAME-A'").get().name_key,
  'updated twin',
  'migration 0010 update trigger must keep name_key authoritative after a rename',
)
assert.ok(!indexedRows.includes('FACE-INACTIVE'), 'inactive same-name rows must remain excluded')
assert.ok(indexedRows.includes('BAR-A') && indexedRows.includes('BAR-B'), 'barcode and leading-zero twins must both remain name siblings')
assert.ok(!indexedRows.includes('SPACE-DOUBLE'), 'indexed lookup must preserve SQL trim semantics rather than adopting JS whitespace collapse')
assert.ok(!indexedRows.includes('UNICODE-UPPER'), 'indexed lookup must preserve SQLite lower() Unicode semantics')

const fullExpressionSql = expressionSql.replace('SELECT id, sku', 'SELECT p.*')
const fullIndexedSql = indexedSql.replace('SELECT id, sku', 'SELECT p.*')
const indexedPlan = db.prepare(`EXPLAIN QUERY PLAN ${fullIndexedSql}`).all(params).map((row) => row.detail).join('\n')
const expressionPlan = db.prepare(`EXPLAIN QUERY PLAN ${fullExpressionSql}`).all(params).map((row) => row.detail).join('\n')
assert.match(indexedPlan, /idx_products_name_key_pg/, `expected name_key index, got:\n${indexedPlan}`)
assert.doesNotMatch(expressionPlan, /idx_products_name_key_pg/, 'wrapped name expression must not be mistaken for an indexed name_key lookup')

const catalogRows = 5_000
db.transaction(() => {
  for (let index = 0; index < catalogRows; index += 1) {
    insert.run({
      name: `Benchmark Product ${String(index).padStart(5, '0')}`,
      sku: `BENCH-${index}`,
      barcode: `9${String(index).padStart(11, '0')}`,
      is_active: index % 29 === 0 ? 0 : 1,
    })
  }
})()

const benchmarkKeys = Array.from({ length: 40 }, (_, index) => `benchmark product ${String(index * 431).padStart(5, '0')}`)
const benchmarkPlaceholders = benchmarkKeys.map(() => '?').join(', ')
const expressionBenchmark = db.prepare(`SELECT p.* FROM products p WHERE p.is_active = 1 AND lower(trim(p.name)) IN (${benchmarkPlaceholders})`)
const indexedBenchmark = db.prepare(`SELECT p.* FROM products p INDEXED BY idx_products_name_key_pg WHERE p.is_active = 1 AND p.name_key IN (${benchmarkPlaceholders})`)
assert.deepEqual(
  indexedBenchmark.all(...benchmarkKeys).map((row) => row.id).sort((a, b) => a - b),
  expressionBenchmark.all(...benchmarkKeys).map((row) => row.id).sort((a, b) => a - b),
)

for (let index = 0; index < 20; index += 1) {
  expressionBenchmark.all(...benchmarkKeys)
  indexedBenchmark.all(...benchmarkKeys)
}
const iterations = 100
const elapsed = (statement) => {
  const started = performance.now()
  for (let index = 0; index < iterations; index += 1) statement.all(...benchmarkKeys)
  return performance.now() - started
}
const expressionMs = elapsed(expressionBenchmark)
const indexedMs = elapsed(indexedBenchmark)
assert.ok(indexedMs < expressionMs, `expected indexed lookup to beat wrapped expression (${indexedMs.toFixed(2)}ms vs ${expressionMs.toFixed(2)}ms)`)

console.log(JSON.stringify({
  status: 'PASS',
  migrations: migrationFiles.length,
  parity_rows: indexedRows.length,
  benchmark: {
    catalog_rows: catalogRows,
    keys: benchmarkKeys.length,
    iterations,
    expression_ms: Number(expressionMs.toFixed(2)),
    indexed_ms: Number(indexedMs.toFixed(2)),
  },
  plans: { expression: expressionPlan, indexed: indexedPlan },
}, null, 2))
db.close()
