// P3 (Part 387): the whole-catalog price adjustment's SQL semantics --
// the exact statement shape routes/products.ts's POST /bulk-price-adjust
// builds, proven against real SQLite:
//   - decrease clamps at 0 (a cheap product never goes negative) and only
//     touches rows with a price > 0 (a 0 stays 0 with no updated_at churn)
//   - increase touches every active row unless skip_zero keeps unpriced
//     rows at 0
//   - KHR rounds to whole riel, USD to cents
//   - inactive rows are never touched
// plus source locks on the route (full-tier gate, preview branch, audit).
//
// Run: node scripts/test-bulk-price-adjust-pure.cjs
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')

function setup() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1,
      selling_price_usd REAL DEFAULT 0, selling_price_khr REAL DEFAULT 0, updated_at TEXT);
    INSERT INTO products (id, name, is_active, selling_price_usd, selling_price_khr) VALUES
      (1, 'A', 1, 10.00, 41000),
      (2, 'B', 1, 0.30, 1200),
      (3, 'Unpriced', 1, 0, 0),
      (4, 'Inactive', 0, 5, 20000);
  `)
  return db
}

// Mirror of the route's statement builder (field + direction + skip_zero).
function statement(field, direction, amount, skipZero) {
  const delta = direction === 'decrease' ? -amount : amount
  const condition = (direction === 'decrease' || skipZero) ? `COALESCE(${field}, 0) > 0` : '1=1'
  return {
    sql: `UPDATE products SET ${field} = MAX(0, ROUND(COALESCE(${field}, 0) + @delta, ${field.endsWith('_khr') ? 0 : 2})), updated_at = CURRENT_TIMESTAMP
          WHERE is_active = 1 AND (${condition})`,
    params: { delta },
  }
}

{
  const db = setup()
  const { sql, params } = statement('selling_price_usd', 'decrease', 0.5, false)
  const info = db.prepare(sql).run(params)
  assert.strictEqual(info.changes, 2, 'decrease touches only the two priced rows -- not the 0 row, not the inactive one')
  const rows = db.prepare('SELECT id, selling_price_usd FROM products ORDER BY id').all()
  assert.strictEqual(rows[0].selling_price_usd, 9.5)
  assert.strictEqual(rows[1].selling_price_usd, 0, 'a 0.30 product decreased by 0.50 clamps at 0, never negative')
  assert.strictEqual(rows[2].selling_price_usd, 0)
  assert.strictEqual(rows[3].selling_price_usd, 5, 'inactive untouched')
  console.log('PASS decrease clamps at 0 and skips already-0 + inactive rows')
}

{
  const db = setup()
  db.prepare(statement('selling_price_usd', 'increase', 0.333, false).sql).run({ delta: 0.333 })
  const rows = db.prepare('SELECT id, selling_price_usd FROM products ORDER BY id').all()
  assert.strictEqual(rows[0].selling_price_usd, 10.33, 'USD rounds to cents')
  assert.strictEqual(rows[2].selling_price_usd, 0.33, 'without skip_zero, unpriced rows are raised too')
  console.log('PASS increase reaches every active row and rounds USD to cents')
}

{
  const db = setup()
  const info = db.prepare(statement('selling_price_khr', 'increase', 100.6, true).sql).run({ delta: 100.6 })
  assert.strictEqual(info.changes, 2, 'skip_zero leaves unpriced rows alone')
  const rows = db.prepare('SELECT id, selling_price_khr FROM products ORDER BY id').all()
  assert.strictEqual(rows[0].selling_price_khr, 41101, 'KHR rounds to whole riel')
  assert.strictEqual(rows[2].selling_price_khr, 0, 'unpriced KHR stays 0 under skip_zero')
  console.log('PASS skip_zero + whole-riel rounding')
}

// ---- source locks ----------------------------------------------------------
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.ts'), 'utf8')
  assert.match(src, /app\.post\('\/bulk-price-adjust', async \(c\) => \{/, 'the endpoint exists')
  assert.match(src, /getPermissionTier\(user, 'products'\) !== 'full'/, 'whole-catalog price edits need FULL products access')
  assert.match(src, /if \(body\.preview\) \{/, 'the preview branch answers with a count before anything writes')
  assert.match(src, /'bulk-price-adjust', \{\s*\n\s*scope: 'all'/, 'the audit entry records the whole-catalog scope + parameters')
  const routeStatement = src.slice(src.indexOf("app.post('/bulk-price-adjust'"), src.indexOf("app.post('/bulk-price-adjust'") + 3200)
  assert.match(routeStatement, /MAX\(0, ROUND\(COALESCE\(\$\{field\}, 0\) \+ @delta, \$\{field\.endsWith\('_khr'\) \? 0 : 2\}\)\)/, 'the route builds exactly the statement shape proven above')
  console.log('PASS route source locks (gate, preview, audit, statement shape)')
}

console.log('All bulk-price-adjust tests passed')
