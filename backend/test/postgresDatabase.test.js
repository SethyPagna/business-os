'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { PostgresCompatDatabase } = require('../src/postgresDatabase')

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

class FakeClient {
  constructor() {
    this.queries = []
  }

  querySync(sql, values = []) {
    this.queries.push({ sql, values })
    if (/INSERT INTO products/i.test(sql)) return [{ id: '123' }]
    if (/UPDATE products/i.test(sql)) return [{ __changed: '1' }]
    if (/SELECT \* FROM products/i.test(sql)) return [{ id: '7', name: 'AHC', barcode: '001234' }]
    return []
  }

  end() {}
}

function createFakeDb() {
  const client = new FakeClient()
  const db = new PostgresCompatDatabase({
    connectionString: 'postgres://business_os:test@postgres/business_os',
    client,
  })
  client.queries = []
  return { db, client }
}

runTest('statement get/all/run use translated Postgres queries', () => {
  const { db, client } = createFakeDb()
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(7)
  assert.equal(product.id, 7)
  assert.equal(product.barcode, '001234')

  db.prepare('SELECT * FROM products WHERE id IN (?)').all(9)
  assert.equal(client.queries.at(-1).sql, 'SELECT * FROM products WHERE id IN ($1)')
  assert.deepEqual(client.queries.at(-1).values, [9])

  const insert = db.prepare('INSERT INTO products (name) VALUES (?)').run('AHC')
  assert.equal(insert.lastInsertRowid, 123)
  assert.equal(insert.changes, 1)

  assert.match(client.queries[0].sql, /\$1/)
  assert.match(client.queries.at(-1).sql, /RETURNING id/)
})

runTest('transaction commits and rolls back with sync query boundaries', () => {
  const { db, client } = createFakeDb()
  db.transaction(() => {
    db.prepare('UPDATE products SET name = ? WHERE id = ?').run('A', 1)
  })()
  assert.equal(client.queries[0].sql, 'BEGIN')
  assert.equal(client.queries.at(-1).sql, 'COMMIT')

  assert.throws(() => db.transaction(() => {
    throw new Error('boom')
  })(), /boom/)
  assert.equal(client.queries.at(-1).sql, 'ROLLBACK')
})

runTest('default organization seed reuses existing slug or public id', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'postgresDatabase.js'), 'utf8')
  assert.match(source, /WHERE public_id = \$1 OR slug = \$2/)
  assert.match(source, /UPDATE organizations[\s\S]+WHERE id = \$2/)
})

runTest('default role seed avoids partial-index ON CONFLICT', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'postgresDatabase.js'), 'utf8')
  assert.doesNotMatch(source, /ON CONFLICT \(code\)/)
  assert.match(source, /SELECT id, code FROM roles WHERE code = \$1 LIMIT 1/)
  assert.match(source, /UPDATE roles[\s\S]+WHERE id = \$4/)
})

if (failed > 0) {
  process.exitCode = 1
}
