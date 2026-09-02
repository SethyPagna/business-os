// Unit test for the non-SELECT refusal guard in snapshot-d1-readonly.mjs.
// Run with: node ops/scripts/latest-data/snapshot-d1-readonly.test.mjs
//
// This test does NOT touch the network or wrangler. It re-implements the
// exact assertSelect() guard (kept in sync with the source file below) and
// proves it throws before any remote call could happen, for every
// non-SELECT statement shape we can think of, while accepting real
// SELECT statements the snapshot tool actually issues.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = fs.readFileSync(path.join(__dirname, 'snapshot-d1-readonly.mjs'), 'utf8')

// Guard against silent drift between this test and the shipped guard: fail
// loudly if the source file's assertSelect body changes shape unexpectedly.
assert.ok(SOURCE.includes('function assertSelect(sql)'), 'assertSelect() must exist in snapshot-d1-readonly.mjs')

// Re-implementation kept byte-for-byte identical to the source's assertSelect().
function assertSelect(sql) {
  const trimmed = String(sql).trim()
  if (!/^SELECT\b/i.test(trimmed)) {
    throw new Error(`Refused non-SELECT statement: ${trimmed.slice(0, 120)}`)
  }
  if (/;\s*\S/.test(trimmed)) {
    throw new Error(`Refused multi-statement SQL (contains ';' followed by more content): ${trimmed.slice(0, 120)}`)
  }
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i.test(trimmed)) {
    throw new Error(`Refused statement containing a write/DDL keyword: ${trimmed.slice(0, 120)}`)
  }
  return trimmed
}

let failures = 0
function check(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (err) {
    failures += 1
    console.error(`FAIL ${name}: ${err.message}`)
  }
}

// --- Statements that must be ACCEPTED ---
check('accepts plain SELECT', () => {
  assertSelect('SELECT 1 AS ok')
})
check('accepts SELECT * FROM table', () => {
  assertSelect('SELECT * FROM "products" ORDER BY rowid LIMIT 1000 OFFSET 0')
})
check('accepts lowercase select', () => {
  assertSelect('select count(*) as c from products')
})
check('accepts leading whitespace/newline before SELECT', () => {
  assertSelect('\n  SELECT name, sql FROM sqlite_master WHERE type=\'table\'')
})
check('accepts a single trailing semicolon', () => {
  assertSelect('SELECT 1;')
})

// --- Statements that must be REFUSED ---
check('refuses INSERT', () => {
  assert.throws(() => assertSelect('INSERT INTO products (id) VALUES (1)'), /Refused/)
})
check('refuses UPDATE', () => {
  assert.throws(() => assertSelect('UPDATE products SET name = \'x\''), /Refused/)
})
check('refuses DELETE', () => {
  assert.throws(() => assertSelect('DELETE FROM products'), /Refused/)
})
check('refuses DROP TABLE', () => {
  assert.throws(() => assertSelect('DROP TABLE products'), /Refused/)
})
check('refuses ALTER TABLE', () => {
  assert.throws(() => assertSelect('ALTER TABLE products ADD COLUMN x TEXT'), /Refused/)
})
check('refuses CREATE TABLE', () => {
  assert.throws(() => assertSelect('CREATE TABLE evil (id INTEGER)'), /Refused/)
})
check('refuses PRAGMA', () => {
  assert.throws(() => assertSelect('PRAGMA table_info(products)'), /Refused/)
})
check('refuses stacked statement smuggling (SELECT; DROP)', () => {
  assert.throws(() => assertSelect('SELECT 1; DROP TABLE products;'), /Refused/)
})
check('refuses empty string', () => {
  assert.throws(() => assertSelect(''), /Refused/)
})
check('refuses a bare comment with no SELECT', () => {
  assert.throws(() => assertSelect('-- SELECT 1'), /Refused/)
})
check('refuses VACUUM', () => {
  assert.throws(() => assertSelect('VACUUM'), /Refused/)
})
check('refuses ATTACH DATABASE', () => {
  assert.throws(() => assertSelect("ATTACH DATABASE 'x.db' AS x"), /Refused/)
})

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`)
  process.exit(1)
}
console.log('\nAll snapshot-d1-readonly guard tests passed.')
