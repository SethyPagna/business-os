'use strict'
// Pins migration 0307 (idx_products_barcode_key) on the REAL migration chain:
//   - the file is LF-only, keeps rowid, carries PRE / POST / RECOVERY, adds exactly one index and changes no row, and aborts on a second run;
//   - the indexed expression is exactly lib/searchMatch.ts normalizedBarcodeSql('barcode'): SQLite uses an expression index only for the same spelling, so a drift in either
//     file would silently put the catch-all back to a full scan. The EXPLAIN plan of the predicate the search emits is pinned to the index, and a differently spelled index is not used;
//   - the index stays consistent through every writer of a barcode (insert, update, delete): the seek returns what a table scan returns;
//   - the UPC branch of the search (seek the zero-stripped forms, then keep the zero-preserving ones) returns exactly the rows `digits IN (upcA, upcE)` returned.
//
// Run (from cloudflare/): node scripts/test-migration-0307-products-barcode-key-index-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')

const directory = path.join(__dirname, '../migrations')
const migration = '0307_products_barcode_key_index.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const files = fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < migration).sort()
const chain = (withMigration) => { const db = new DatabaseSync(':memory:'); for (const f of files) db.exec(fs.readFileSync(path.join(directory, f), 'utf8')); if (withMigration) db.exec(sql); return db }
const objects = (db) => db.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_autoindex%' ORDER BY name").all().map((r) => `${r.type}:${r.name}`)
let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

const searchMatchSource = fs.readFileSync(path.join(__dirname, '../src/lib/searchMatch.ts'), 'utf8').replace(/\r\n/g, '\n')
const searchMatch = (() => {
  const { outputText } = ts.transpileModule(searchMatchSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(mod.exports, (id) => { throw new Error(`unmapped require(${id})`) }, mod)
  return mod.exports
})()
const NORM_ROW = searchMatch.normalizedBarcodeSql('barcode')
const NORM_P = searchMatch.normalizedBarcodeSql('p.barcode')
const DIGITS_P = searchMatch.normalizedBarcodeDigitsSql('p.barcode')

check('the file is LF-only, numbered 0307 once, keeps rowid, and carries PRE / POST / recovery notes', () => {
  assert.equal(sql.includes('\r'), false)
  assert.equal(/WITHOUT\s+ROWID/i.test(sql.replace(/^--.*$/gm, '')), false)
  assert.match(sql, /RECOVERY:/); assert.match(sql, /PRE:/); assert.match(sql, /POST:/)
  assert.deepEqual(fs.readdirSync(directory).filter((f) => f.startsWith('0307_')), [migration])
})

const db = chain(false)
const insert = db.prepare("INSERT INTO products (id, name, barcode, is_active) VALUES (?, ?, ?, 1)")
const stocks = (fn) => { db.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'"); try { fn() } finally { db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'") } }
const BARCODES = ['885000100', ' 885-000-4001 ', 'ABC-123x', '0000000000000000000885000301', '042100005264', '04252614', '0 42100 00526-4', '000000000000', '', null, '0', ' - ', 'Cream', 'c-ream', '0042100005264']
stocks(() => BARCODES.forEach((barcode, index) => insert.run(2000 + index, `P${index}`, barcode)))
const before = objects(db), rowsBefore = JSON.stringify(db.prepare('SELECT * FROM products ORDER BY id').all())

check('applies on a fresh chain, adds exactly the one index and changes no row; a second run aborts on its PRE check', () => {
  db.exec(sql)
  assert.deepEqual(objects(db).filter((o) => !before.includes(o)), ['index:idx_products_barcode_key'])
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM products ORDER BY id').all()), rowsBefore)
  assert.throws(() => db.exec(sql), /bad JSON path|already exists/i)
})

check('the indexed expression is exactly normalizedBarcodeSql(barcode)', () => {
  const stored = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_products_barcode_key'").get().sql
  assert.equal(stored, `CREATE INDEX idx_products_barcode_key ON products (${NORM_ROW})`)
})

const plan = (text, ...args) => db.prepare(`EXPLAIN QUERY PLAN ${text}`).all(...args).map((r) => r.detail).join(' | ')
check('PLAN: the catch-all predicate the search emits seeks the index; a differently spelled index would not be used (control)', () => {
  const seek = plan(`SELECT p.id FROM products p WHERE ${NORM_P} = ?`, 'cream')
  assert.match(seek, /SEARCH p USING (COVERING )?INDEX idx_products_barcode_key \(<expr>=\?\)/, seek)
  const pair = plan(`SELECT p.id FROM products p WHERE ${NORM_P} IN (ltrim(?, '0'), ltrim(?, '0')) AND ${DIGITS_P} IN (?, ?)`, '042100005264', '04252614', '042100005264', '04252614')
  assert.match(pair, /SEARCH p USING (COVERING )?INDEX idx_products_barcode_key/, pair)
  const control = chain(true)
  control.exec('DROP INDEX idx_products_barcode_key')
  control.exec("CREATE INDEX idx_products_barcode_key ON products (ltrim(lower(replace(trim(COALESCE(barcode, '')), ' ', '')), '0'))")   // one replace short: another spelling
  const other = control.prepare(`EXPLAIN QUERY PLAN SELECT p.id FROM products p WHERE ${NORM_P} = ?`).all('cream').map((r) => r.detail).join(' | ')
  assert.doesNotMatch(other, /SEARCH p USING (COVERING )?INDEX idx_products_barcode_key/, `a differently spelled expression must not be used: ${other}`)
})

const sorted = (rows) => rows.map((r) => r.id).sort((a, b) => a - b)
const viaIndex = (key) => sorted(db.prepare(`SELECT p.id FROM products p WHERE ${NORM_P} = ?`).all(key))
const viaScan = (key) => sorted(db.prepare(`SELECT p.id FROM products p NOT INDEXED WHERE ${NORM_P} = ?`).all(key))
const KEYS = ['885000100', '8850004001', 'abc123x', '885000301', '42100005264', '4252614', 'cream', '', '0', '-']
check('the seek returns what a table scan returns, for every key, before and after every kind of write to a barcode', () => {
  const compare = (label) => KEYS.forEach((key) => assert.deepEqual(viaIndex(key), viaScan(key), `${label}: key ${JSON.stringify(key)}`))
  compare('fresh')
  stocks(() => {
    insert.run(3000, 'New', '  885-000-100 ')
    db.prepare("UPDATE products SET barcode = 'CREAM' WHERE id = 2000").run()
    db.prepare("UPDATE products SET name = 'Renamed' WHERE id = 2001").run()
    db.prepare("UPDATE products SET barcode = NULL WHERE id = 2002").run()
    db.prepare("DELETE FROM products WHERE id = 2003").run()
  })
  compare('after insert, barcode update, other-column update, null and delete')
  assert.deepEqual(viaIndex('cream'), [2000, 2012, 2013].sort((a, b) => a - b), '"CREAM" and "c-ream" and the original "Cream" all normalize to cream')
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
})

check('the UPC branch (seek the zero-stripped forms, keep the zero-preserving ones) returns exactly the rows `digits IN (upcA, upcE)` returned', () => {
  for (const [upcA, upcE] of [['042100005264', '04252614'], ['000000000000', '00000000'], ['', ''], ['042100005264', '']]) {
    const old = sorted(db.prepare(`SELECT p.id FROM products p NOT INDEXED WHERE ${DIGITS_P} IN (?, ?)`).all(upcA, upcE))
    const seek = sorted(db.prepare(`SELECT p.id FROM products p WHERE ${NORM_P} IN (ltrim(?, '0'), ltrim(?, '0')) AND ${DIGITS_P} IN (?, ?)`).all(upcA, upcE, upcA, upcE))
    assert.deepEqual(seek, old, `pair ${upcA}/${upcE}`)
  }
  const found = sorted(db.prepare(`SELECT p.id FROM products p WHERE ${NORM_P} IN (ltrim(?, '0'), ltrim(?, '0')) AND ${DIGITS_P} IN (?, ?)`).all('042100005264', '04252614', '042100005264', '04252614'))
  assert.ok(found.length >= 3, `the plain UPC-A, the UPC-E and the spaced UPC-A are all found: ${found}`)
})

console.log(`${passed} checks passed`)
