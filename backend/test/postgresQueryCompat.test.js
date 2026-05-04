'use strict'

const assert = require('node:assert/strict')
const { coerceRow, translateSql } = require('../src/db/postgresQueryCompat')

let failed = 0

function runTest(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

runTest('translates positional parameters to Postgres placeholders', () => {
  const translated = translateSql('SELECT * FROM products WHERE id = ? AND name LIKE ?', [12, '%abc%'])
  assert.equal(translated.sql, 'SELECT * FROM products WHERE id = $1 AND name LIKE $2')
  assert.deepEqual(translated.values, [12, '%abc%'])
})

runTest('translates named parameters and reuses repeated names', () => {
  const translated = translateSql('SELECT * FROM products WHERE brand = @brand OR supplier = @brand LIMIT @limit', {
    brand: 'AHC',
    limit: 20,
  })
  assert.equal(translated.sql, 'SELECT * FROM products WHERE brand = $1 OR supplier = $1 LIMIT $2')
  assert.deepEqual(translated.values, ['AHC', 20])
})

runTest('translates common portable SQL functions and conflict inserts', () => {
  const translated = translateSql(
    "INSERT OR IGNORE INTO branch_stock (product_id, branch_id, quantity, updated_at) VALUES (?, ?, 0, CURRENT_TIMESTAMP)",
    [1, 2],
    { mode: 'run' },
  )
  assert.equal(
    translated.sql,
    'INSERT INTO branch_stock (product_id, branch_id, quantity, updated_at) VALUES ($1, $2, 0, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING RETURNING 1 AS __changed',
  )
  assert.deepEqual(translated.values, [1, 2])
})

runTest('does not request id from non-id insert targets', () => {
  const translated = translateSql(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
    ['business_name', 'Leang Cosmetic'],
    { mode: 'run' },
  )
  assert.equal(
    translated.sql,
    "INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING 1 AS __changed",
  )
  assert.deepEqual(translated.values, ['business_name', 'Leang Cosmetic'])
})

runTest('translates max floor expression to Postgres greatest', () => {
  const translated = translateSql('UPDATE branch_stock SET quantity = MAX(0, quantity - ?) WHERE id = ?', [5, 9], { mode: 'run' })
  assert.equal(translated.sql, 'UPDATE branch_stock SET quantity = GREATEST(0, quantity - $1) WHERE id = $2 RETURNING 1 AS __changed')
})

runTest('keeps explicit Postgres stock deduction casts stable', () => {
  const translated = translateSql(
    'INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?,?,0) ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = GREATEST(0, quantity - CAST(? AS numeric))',
    [1, 2, 3],
    { mode: 'run' },
  )
  assert.equal(
    translated.sql,
    'INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES ($1,$2,0) ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = GREATEST(0, quantity - CAST($3 AS numeric)) RETURNING 1 AS __changed',
  )
  assert.doesNotMatch(translated.sql, /GREATEST\(0,\s*-\$/)
})

runTest('coerces numeric database fields without damaging text identifiers', () => {
  const row = coerceRow({
    id: '42',
    product_id: '7',
    stock_quantity: '3.5',
    barcode: '001234567890',
    sku: '0007',
    name: 'Test',
  })
  assert.equal(row.id, 42)
  assert.equal(row.product_id, 7)
  assert.equal(row.stock_quantity, 3.5)
  assert.equal(row.barcode, '001234567890')
  assert.equal(row.sku, '0007')
  assert.equal(row.name, 'Test')
})

if (failed > 0) {
  process.exitCode = 1
}
