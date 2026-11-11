'use strict'
// S9 siblings (11 Nov D1 audit, wave 2): every lookup of a row by the client_request_id the same batch just wrote must repeat the `<> ''` half of the
// partial unique indexes (products and returns: client_request_id IS NOT NULL AND client_request_id <> ''), or SQLite cannot use them and scans the table.
// Owners: lib/productWrites.ts (createProductWithInitialStock, keys `product-create:<uuid>`), routes/returns.ts (supplier return, key `supplier-return:<uuid>` or the
// client's non-empty id) The keys are never empty, so the rows found are
// the same as before; an empty key now matches nothing instead of every empty-key row.
//
// Pinned: (1) every `client_request_id=@x` of the two files carries the guard (a new bare lookup is red); (2) EXPLAIN on the real migration chain: the guarded
// forms SEARCH the index, the unguarded ones SCAN (the pin is discriminating); (3) rows found are equal for an existing, a missing and an empty key.
//
// Run (from cloudflare/): node scripts/test-writes-request-id-index-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n')
const FILES = ['src/lib/productWrites.ts', 'src/routes/returns.ts']
const BARE = /((?:\w+\.)?client_request_id)\s*=\s*@(key|createdProductKey|supplier_write_key)\b(?!\s+AND\s+(?:\w+\.)?client_request_id\s*<>\s*'')/g

let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

check('no bare client_request_id=@key / @supplier_write_key lookup remains in the two writer files', () => {
  for (const file of FILES) {
    const text = read(file)
    const bare = [...text.matchAll(BARE)].map((m) => text.slice(Math.max(0, m.index - 50), m.index + 70).replace(/\s+/g, ' '))
    assert.deepEqual(bare, [], file)
  }
  assert.equal([...read('src/lib/productWrites.ts').matchAll(/client_request_id=@(key|createdProductKey) AND (?:p\.)?client_request_id<>''/g)].length, 9)
  assert.equal([...read('src/routes/returns.ts').matchAll(/client_request_id=@supplier_write_key AND client_request_id<>''/g)].length, 2)
})

const db = new Database(':memory:')
for (const migration of loadAll()) db.exec(migration)
const detail = (sql, params) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(params).map((r) => r.detail).join(' | ')

check('EXPLAIN: guarded product lookup SEARCHes idx_products_client_request_unique_pg; the unguarded one SCANs', () => {
  const guarded = detail("SELECT id FROM products WHERE client_request_id=@key AND client_request_id<>''", { key: 'product-create:x' })
  assert.match(guarded, /SEARCH products USING (COVERING )?INDEX idx_products_client_request_unique_pg/)
  assert.doesNotMatch(guarded, /SCAN products/)
  assert.match(detail('SELECT id FROM products WHERE client_request_id=@key', { key: 'product-create:x' }), /SCAN products/)
})
check('EXPLAIN: the guarded supplier-return lookup SEARCHes the returns index', () => {
  assert.match(detail("SELECT id FROM returns WHERE client_request_id=@k AND client_request_id<>''", { k: 'supplier-return:x' }), /SEARCH returns USING (COVERING )?INDEX idx_returns_client_request_unique_pg/)
})
check('same rows for an existing, a missing and an empty key (the guarded form matches no empty-key row)', () => {
  db.exec("INSERT INTO system_flags(key,value) VALUES('stock_transaction_permit','legacy-separate-pool-v1')")
  db.exec("INSERT INTO products(id,name,client_request_id,is_active) VALUES (920001,'a','product-create:x',1),(920002,'b','',1),(920003,'c','',1),(920004,'d',NULL,1)")
  const ids = (sql, key) => db.prepare(sql).all({ key }).map((r) => r.id)
  const g = "SELECT id FROM products WHERE client_request_id=@key AND client_request_id<>''"
  const u = 'SELECT id FROM products WHERE client_request_id=@key'
  for (const key of ['product-create:x', 'product-create:missing']) assert.deepEqual(ids(g, key), ids(u, key), key)
  assert.deepEqual(ids(g, 'product-create:x'), [920001])
  assert.deepEqual(ids(u, ''), [920002, 920003])
  assert.deepEqual(ids(g, ''), [])
  db.exec('DELETE FROM products WHERE id BETWEEN 920001 AND 920004')
  db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
})
console.log(`${passed} checks passed.`)
