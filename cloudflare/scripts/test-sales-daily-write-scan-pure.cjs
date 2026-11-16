'use strict'
// The "every writer" scanner of the stored daily totals (harness/sales-daily-write-scan.cjs) must not be blind. Opus review of lane/sales-daily-totals phase A:
// its old comment stripper treated the `/uploads/*` in the LINE comment at backup.ts:1777 as the start of a block comment and hid backup.ts:1777-2269 (the
// restore's DELETE / INSERT), and missed six of eight mutants. This file keeps those eight as FIXTURES, runs each one against the REAL tree (the scan must
// report the new site as unlisted), and shows the old stripper really was blind to the two that sit after the `/uploads/*` comment.
// Run (from cloudflare/): node scripts/test-sales-daily-write-scan-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const scanner = require('./harness/sales-daily-write-scan.cjs')
const LISTED = require('./sales-daily-writer-sites.cjs')

const ROOT = path.join(__dirname, '..')
const KERNEL_TABLES = ['sales', 'sale_items', 'returns', 'return_items', 'fees', 'sale_amendments', 'sale_payment_events', 'sale_item_batch_allocations', 'return_item_batch_allocations']
let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }
const scan = (text) => scanner.scanText(text, KERNEL_TABLES).map((s) => `${s.table} ${s.verb}`).sort()

// The old stripper, verbatim, kept only to show the fixtures are the ones it could not see.
const oldStrip = (text) => text.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n')
const oldDetects = (text) => /\b(UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+sales\b/i.test(oldStrip(text))

// the reviewer's eight mutants: [id, source text, what the scan must report, did the old scan see it]
const MUTANTS = [
  ['M1 dynamic table in a template', 'const q = `UPDATE ${table} SET total_usd = 0`', ['DYNAMIC update'], true],
  ['M2 concatenation', "const q = 'UPDATE ' + table + ' SET total_usd = 0'", ['DYNAMIC update'], false],
  ['M3 quoted identifier', 'const q = `UPDATE "sales" SET total_usd = 0`', ['sales update'], false],
  ['M4 schema qualified', 'const q = `UPDATE main.sales SET total_usd = 0`', ['sales update'], false],
  ['M5 quoted dynamic name', 'const q = `DELETE FROM "${t}"`', ['DYNAMIC delete'], false],
  ['M6 literal inside the region a line comment hid', ['// glob: /uploads/*', 'const keep = 1', "const w = 'UPDATE sales SET total_usd = 0 WHERE id = 1'", '/* a real block comment ends the old stripper\'s span */'].join('\n'), ['sales update'], false],
  ['M7 positive control', "const q = 'UPDATE sales SET total_usd = 0'", ['sales update'], true],
  ['M8 literal after a line comment that contains /*', ['// glob: /uploads/*', "db.prepare('UPDATE sales SET total_usd = 0')", '/* end */'].join('\n'), ['sales update'], false],
]

check('F1 the eight reviewer mutants are all found by text, and the old stripper really missed the six', () => {
  for (const [id, text, expected, oldSaw] of MUTANTS) {
    assert.deepEqual(scan(text), expected, id)
    if (/M[68]/.test(id)) assert.equal(oldDetects(text), false, `${id}: the fixture must be one the old stripper hid`)
    if (id === 'M7 positive control') assert.equal(oldDetects(text), oldSaw)
  }
})

check('F2 every mutant, placed in the REAL tree as a new file, is reported as an unlisted site (so the matrix test would fail)', () => {
  const listed = new Set(Object.keys(LISTED))
  const base = scanner.scanSource(ROOT, KERNEL_TABLES)
  assert.deepEqual([...base.keys()].filter((key) => !listed.has(key)), [], 'the real tree is fully listed first')
  for (const [id, text, expected] of MUTANTS) {
    const found = scanner.scanSource(ROOT, KERNEL_TABLES, new Map([['src/lib/mutantFixture.ts', text]]))
    const added = [...found.keys()].filter((key) => !listed.has(key))
    assert.deepEqual(added.sort(), expected.map((e) => `src/lib/mutantFixture.ts ${e}`), id)
  }
})

check('F3 the real backup.ts: a literal write inserted at line 2001 (inside what the old stripper hid) is found, and the restore writers now appear', () => {
  const file = path.join(ROOT, 'src/lib/backup.ts')
  const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')
  const original = lines.join('\n')
  assert.ok(/\/uploads\/\*/.test(lines.slice(1700, 1790).join('\n')), 'backup.ts still has the line comment that fooled the old stripper')
  const mutated = [...lines.slice(0, 2000), "  const mutant = 'UPDATE sales SET total_usd = 0 WHERE id = 1'", ...lines.slice(2000)].join('\n')
  const found = scanner.scanSource(ROOT, KERNEL_TABLES, new Map([['src/lib/backup.ts', mutated]]))
  assert.ok(found.has('src/lib/backup.ts sales update'), 'the inserted write is seen')
  const real = scanner.scanSource(ROOT, KERNEL_TABLES)
  assert.ok(real.has('src/lib/backup.ts DYNAMIC delete') && real.has('src/lib/backup.ts DYNAMIC insert'), 'the restore DELETE FROM qid(table) / INSERT INTO qid(table) are on the list')
  assert.ok(Object.keys(LISTED).includes('src/lib/backup.ts DYNAMIC delete') && Object.keys(LISTED).includes('src/lib/backup.ts DYNAMIC insert'))
})

check('F4 a write after a /* that sits inside a string, a regex or a template is still seen; a comment can not hide code', () => {
  assert.deepEqual(scan('const glob = "/uploads/*"; const q = \'UPDATE sales SET x = 1\'; const end = "*/"'), ['sales update'])
  assert.deepEqual(scan("const re = /^\\/uploads\\/*/; db.run('DELETE FROM returns WHERE id = 1')"), ['returns delete'])
  assert.deepEqual(scan('const t = `/* ${a} */`; const q = `INSERT INTO sale_items (a) VALUES (1)`'), ['sale_items insert'])
  assert.deepEqual(scan('const t = `x ${`UPDATE sales SET a = ${v}`} y`'), ['sales update'], 'a template nested in a template expression')
  assert.deepEqual(scan("/* UPDATE sales SET x = 1 */ // DELETE FROM sales\nconst q = 'SELECT 1'"), [], 'comments are not sites')
  assert.deepEqual(scan('const q = `\n  -- UPDATE sales SET x = 1\n  SELECT 1`'), [], 'an SQL line comment is not a statement')
  assert.deepEqual(scan("const url = 'https://example.com/a'; db.prepare('UPDATE fees SET a = 1')"), ['fees update'], 'a // inside a string is not a comment')
})

check('F5 forms the old scan could not read: concatenation chains, schema and quote forms, replace, qid helpers', () => {
  assert.deepEqual(scan("const q = 'DELETE FROM ' + qid(table) + ' WHERE id = ' + id"), ['DYNAMIC delete'])
  assert.deepEqual(scan("const q = 'INSERT INTO sales ' + '(a, b) VALUES (1, 2)'"), ['sales insert'])
  assert.deepEqual(scan('const q = `UPDATE "main"."fees" SET a = 1`'), ['fees update'])
  assert.deepEqual(scan('const q = `UPDATE [returns] SET a = 1`'), ['returns update'])
  assert.deepEqual(scan('const q = `DELETE FROM ${qid(table)}`'), ['DYNAMIC delete'])
  assert.deepEqual(scan('const q = `DELETE FROM main.${t}`'), ['DYNAMIC delete'])
  assert.deepEqual(scan('const q = `REPLACE INTO sales (id) VALUES (1)`'), ['sales replace'])
  assert.deepEqual(scan('const q = `INSERT OR REPLACE INTO sale_items (id) VALUES (1)`'), ['sale_items insert'])
  assert.deepEqual(scan('const q = `UPDATE OR IGNORE sales AS s SET a = 1`'), ['sales update'])
})

check('F6 no false positive on a table that only shares a prefix, a read, or prose', () => {
  assert.deepEqual(scan("const q = 'UPDATE sales_daily_totals SET state = 1'"), [])
  assert.deepEqual(scan("const q = 'UPDATE sale_items_archive SET a = 1'"), [])
  assert.deepEqual(scan("const q = 'SELECT * FROM sales WHERE id = 1'"), [])
  assert.deepEqual(scan("const msg = 'Update sales settings'"), [])
  assert.deepEqual(scan("const q = 'INSERT INTO products (name) VALUES (1)'"), [])
})

console.log(`\n${passed} checks passed`)
