'use strict'
// S9 (11 Nov D1 audit): the three statements of lib/stockSession.ts that find the product a stock session line just created by its client_request_id
// (the branch_stock seed, the gallery images, the member row of a quantity-0 line) read every product row, because the unique index on
// products.client_request_id is partial (client_request_id IS NOT NULL AND client_request_id <> '') and a bare `client_request_id=@x` does not imply the
// `<> ''` half. Each now repeats `client_request_id<>''`; the key is `stock-session:<operation>:<line>`, never empty, so the answer is the same.
//
// Pinned on the REAL migration chain:
//   - the statements are lifted from the source, so a rewording or a dropped guard is caught;
//   - EXPLAIN: each SEARCHes products USING idx_products_client_request_unique_pg; the unguarded form SCANs products (the old cost);
//   - the rows found are identical to the old statements for an existing key, a missing key and an empty-string key (the old form matched every empty-key row;
//     the guarded one matches none, so a latent wrong match goes too);
//   - every `client_request_id=@...` of the file carries the guard (a new unguarded lookup is red).
//
// Run (from cloudflare/): node scripts/test-stock-session-request-id-index-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const source = process.env.STOCK_SESSION_SRC
  ? fs.readFileSync(process.env.STOCK_SESSION_SRC, 'utf8').replace(/\r\n/g, '\n')
  : fs.readFileSync(path.join(__dirname, '../src/lib/stockSession.ts'), 'utf8').replace(/\r\n/g, '\n')
const directory = path.join(__dirname, '../migrations')
const db = new DatabaseSync(':memory:')
for (const f of fs.readdirSync(directory).filter((n) => n.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(directory, f), 'utf8'))
let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

const lookups = [...source.matchAll(/`([^`]*client_request_id\s*=\s*@productRequestId[^`]*)`/g)].map((m) => m[1])
const named = (statement) => Object.fromEntries([...new Set([...statement.matchAll(/@(\w+)/g)].map((m) => m[1]))].map((name) => [name, name === 'productRequestId' ? 'stock-session:op:l1' : 1]))
const plan = (statement) => db.prepare(`EXPLAIN QUERY PLAN ${statement}`).all(named(statement)).map((r) => r.detail)
const unguarded = (statement) => statement.replace(/ AND (products\.)?client_request_id<>''/, '')

check('the three product-by-request-id statements are found in the source', () => {
  assert.equal(lookups.length, 3, `found ${lookups.length}`)
  assert.ok(lookups.some((s) => /INSERT OR IGNORE INTO branch_stock/.test(s)))
  assert.ok(lookups.some((s) => /INSERT INTO product_images/.test(s)))
  assert.ok(lookups.some((s) => /INSERT INTO stock_session_members/.test(s)))
})
check('every client_request_id=@... lookup of lib/stockSession.ts carries the <> \'\' guard (a new bare lookup is red)', () => {
  const bare = [...source.matchAll(/client_request_id\s*=\s*@\w+(?!\s+AND\s+(?:\w+\.)?client_request_id\s*<>\s*'')/g)].map((m) => source.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, ' '))
  const insertValues = bare.filter((text) => !/FROM products|products\.client_request_id/.test(text))
  assert.deepEqual(insertValues, [], 'only the session-operation request id is compared bare, and it is on stock_session_operations')
  for (const statement of lookups) assert.match(statement, /client_request_id<>''/)
})
check('EXPLAIN: each statement SEARCHes products by idx_products_client_request_unique_pg, none scans products', () => {
  for (const statement of lookups) {
    const detail = plan(statement).filter((d) => /products/.test(d) && !/product_images|branch_stock|stock_session_members/.test(d.split(' ')[1] || ''))
    assert.ok(detail.some((d) => /SEARCH products USING (COVERING )?INDEX idx_products_client_request_unique_pg \(client_request_id=\?\)/.test(d)), detail.join(' | '))
    assert.ok(!detail.some((d) => /SCAN products/.test(d)), detail.join(' | '))
  }
})
check('the pin is discriminating: the old unguarded statements SCAN products', () => {
  for (const statement of lookups) {
    const old = unguarded(statement)
    assert.notEqual(old, statement)
    assert.ok(plan(old).some((d) => /SCAN products/.test(d)), plan(old).join(' | '))
  }
})
check('same rows: existing key, missing key and an empty-string key (old form matched every empty-key row, the guarded form none)', () => {
  db.exec("INSERT INTO system_flags(key,value) VALUES('stock_transaction_permit','legacy-separate-pool-v1')")
  db.exec("INSERT INTO products(id,name,client_request_id,is_active) VALUES (910001,'a','stock-session:op:l1',1),(910002,'b','other',1),(910003,'c','',1),(910004,'d','',1),(910005,'e',NULL,1)")
  const members = lookups.find((s) => /INSERT INTO stock_session_members/.test(s))
  const picked = (statement, key) => {
    const body = statement.slice(statement.indexOf('SELECT'))
    const clean = body.replace(/^SELECT @operationId,@lineId,@kind,id,1,@branchId,\(SELECT name FROM branches WHERE id=@branchId\),NULL,NULL,0,@unitCostUsd/, 'SELECT id')
    return db.prepare(clean).all(Object.fromEntries(Object.entries(named(clean)).map(([k, v]) => [k, k === 'productRequestId' ? key : v]))).map((r) => r.id)
  }
  for (const key of ['stock-session:op:l1', 'stock-session:op:missing', 'other']) assert.deepEqual(picked(members, key), picked(unguarded(members), key), key)
  assert.deepEqual(picked(members, 'stock-session:op:l1'), [910001])
  assert.deepEqual(picked(unguarded(members), ''), [910003, 910004], 'the old form with an empty key matched every empty-key product')
  assert.deepEqual(picked(members, ''), [], 'the guarded form matches nothing for an empty key')
  db.exec('DELETE FROM products WHERE id BETWEEN 910001 AND 910005')
  db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
})
console.log(`${passed} checks passed.`)
