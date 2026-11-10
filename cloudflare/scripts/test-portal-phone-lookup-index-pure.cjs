'use strict'
// idx_customers_phone_normalized is PARTIAL (migration 0087: WHERE phone_normalized IS NOT NULL AND phone_normalized != ''), and SQLite uses a
// partial index only for a query whose WHERE repeats those terms: a bare `phone_normalized = ?` scans the whole customers table. The storefront
// sign-up lookup (lib/portalAccounts.ts findCustomerByCanonicalPhone) ran that bare form. This lifts the statement out of the source, asks SQLite
// for its plan with every migration applied, and checks that it searches the index and answers exactly what the bare form answers.
//
// Not covered, deliberately: the duplicate probes in lib/contactDuplicates.ts OR the cache column with an expression over `phone` and a Contact
// Option scan, so SQLite scans the table whatever is repeated on the indexed term (EXPLAIN on a fixture shows SCAN with and without it).
//
// Run (from cloudflare/): node scripts/test-portal-phone-lookup-index-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')
const db = new Database(':memory:')
for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))

const source = fs.readFileSync(path.join(root, 'src', 'lib', 'portalAccounts.ts'), 'utf8').split('\r\n').join('\n')
const start = source.indexOf('async function findCustomerByCanonicalPhone')
const literal = /\.prepare\(\s*(["'])(SELECT id, name FROM customers WHERE phone_normalized = @p[^\n]*?)\1,/.exec(source.slice(start))
assert.ok(literal, 'the primary lookup statement was not found in findCustomerByCanonicalPhone')
const lookupSql = literal[2]
const bareSql = 'SELECT id, name FROM customers WHERE phone_normalized = @p LIMIT 1'

const indexSql = db.prepare("SELECT sql FROM sqlite_master WHERE name='idx_customers_phone_normalized'").get().sql
const indexWhere = /WHERE\s+(.*)$/is.exec(indexSql)[1].replace(/\s+/g, ' ').trim()
const plan = (sql, params) => db.prepare('EXPLAIN QUERY PLAN ' + sql).all(params).map((row) => row.detail).join(' / ')

const insert = db.prepare('INSERT INTO customers (id, name, phone, phone_normalized) VALUES (?, ?, ?, ?)')
for (let i = 1; i <= 300; i++) insert.run(i, 'C' + i, '097' + String(i).padStart(6, '0'), i % 7 === 0 ? null : i % 11 === 0 ? '' : '097' + String(i).padStart(6, '0'))
insert.run(1000, 'Dup', '012 345 678', '012345678')

let failed = 0
const check = (name, fn) => { try { fn(); console.log('PASS ' + name) } catch (error) { failed += 1; console.log('FAIL ' + name + '\n' + (error && error.stack || error)) } }

check('the statement repeats the partial index predicate exactly as the migration states it', () => {
  assert.equal(indexWhere, "phone_normalized IS NOT NULL AND phone_normalized != ''")
  assert.ok(lookupSql.includes(indexWhere), `${lookupSql} does not repeat: ${indexWhere}`)
})

check('the sign-up lookup searches the index; the bare form it replaces scans the table (control)', () => {
  assert.match(plan(lookupSql, { p: '012345678' }), /SEARCH customers USING (COVERING )?INDEX idx_customers_phone_normalized \(phone_normalized=\?\)/)
  assert.match(plan(bareSql, { p: '012345678' }), /SCAN customers/)
})

check('same answer as the bare form for a held number and a missing one; an empty cache value is never an owner', () => {
  for (const p of ['012345678', '097000005', '097000007', '097000011', '0123456789']) {
    assert.deepEqual(db.prepare(lookupSql).get({ p }), db.prepare(bareSql).get({ p }), `p=${JSON.stringify(p)}`)
  }
  assert.deepEqual(db.prepare(lookupSql).get({ p: '012345678' }), { id: 1000, name: 'Dup' })
  assert.equal(db.prepare(lookupSql).get({ p: '' }), undefined, 'an empty cache value is never a phone owner')
})

if (failed) { console.error(`${failed} check(s) failed`); process.exitCode = 1 } else console.log('PASS portal phone lookup uses the partial index')
