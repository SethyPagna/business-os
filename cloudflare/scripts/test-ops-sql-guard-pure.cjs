#!/usr/bin/env node
// Offline checks for the d1-export job's read-only guard
// (ops/scripts/ops-sql-guard.mjs), its query files (ops/queries/*.sql) and the
// pure halves of ops/scripts/ops-d1-export.mjs. No network, no wrangler.
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..', '..')
const QUERIES = path.join(ROOT, 'ops', 'queries')

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err && err.message}`)
    process.exitCode = 1
  }
}

const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

async function main() {
  const guard = await load('ops/scripts/ops-sql-guard.mjs')
  const d1 = await load('ops/scripts/ops-d1-export.mjs')
  const common = await load('ops/scripts/ops-common.mjs')

  const rejects = (sql, code) => {
    let err
    try {
      guard.guardSql(sql)
    } catch (e) {
      err = e
    }
    assert.ok(err, `accepted: ${JSON.stringify(sql)}`)
    assert.ok(err instanceof common.OpsError, `not an OpsError for ${JSON.stringify(sql)}: ${err && err.message}`)
    if (code) assert.strictEqual(err.code, code, `wrong code for ${JSON.stringify(sql)}`)
  }

  await check('the three required queries exist and pass the guard', () => {
    const names = guard.listQueries()
    for (const required of ['product-names', 'r2-url-audit', 'migrations-applied']) {
      assert.ok(names.includes(required), `ops/queries/${required}.sql is missing`)
      const q = guard.loadQuery(required)
      assert.ok(/^(SELECT|WITH) /i.test(q.sql))
      assert.ok(!q.sql.includes('--') && !q.sql.includes('/*') && !/\n/.test(q.sql), 'the canonical SQL still holds comments or newlines')
    }
  })

  await check('every file in ops/queries passes the guard (a new query is just a new file)', () => {
    const files = fs.readdirSync(QUERIES)
    for (const f of files) {
      assert.ok(/^[a-z0-9][a-z0-9-]{0,63}\.sql$/.test(f), `unexpected file in ops/queries: ${f}`)
      guard.loadQuery(f.slice(0, -4))
    }
  })

  await check('a CRLF checkout (the Windows runner) yields the same canonical SQL and rules', () => {
    for (const f of fs.readdirSync(QUERIES)) {
      const lf = fs.readFileSync(path.join(QUERIES, f), 'utf8').replace(/\r\n/g, '\n')
      const a = guard.guardSql(lf)
      const b = guard.guardSql(lf.replace(/\n/g, '\r\n'))
      assert.strictEqual(b.sql, a.sql, f)
      assert.deepStrictEqual(b.rules, a.rules, f)
      assert.ok(!/\r/.test(b.sql), f)
    }
  })

  await check('query rules: product-names withholds its count, migrations-applied may show it, the audit expects all zero', () => {
    const p = guard.loadQuery('product-names')
    assert.deepStrictEqual(p.rules, { minRows: 1, maxRows: null, expectZero: null, publicRowCount: false })
    assert.ok(/\bFROM products WHERE is_active = 1\b/.test(p.sql))
    for (const col of ['id', 'name', 'brand', 'barcode', 'sku', 'category']) assert.ok(new RegExp(`\\b${col}\\b`).test(p.sql))
    const m = guard.loadQuery('migrations-applied')
    assert.strictEqual(m.sql, 'SELECT name FROM d1_migrations ORDER BY id')
    assert.strictEqual(m.rules.publicRowCount, true)
    const a = guard.loadQuery('r2-url-audit')
    assert.deepStrictEqual(a.rules, { minRows: 1, maxRows: 1, expectZero: '*', publicRowCount: false })
    assert.ok(!/\b(UNION|INTERSECT|EXCEPT)\b/i.test(a.sql), 'the audit must be scalar sub-queries, not a compound SELECT')
    const tables = ['products', 'product_images', 'promotions', 'users', 'file_assets', 'customer_share_submissions', 'import_job_files', 'import_job_image_matches', 'settings']
    for (const t of tables) assert.ok(new RegExp(`FROM ${t} WHERE`).test(a.sql), `the audit lost ${t}`)
    assert.strictEqual((a.sql.match(/SELECT COUNT\(\*\)/g) || []).length, 11)
  })

  await check('accepts legitimate read-only shapes', () => {
    const ok = [
      'SELECT 1',
      'select 1;',
      'SELECT 1; -- trailing comment',
      "SELECT ';' AS semi, '--' AS dashes, '/*' AS open FROM t",
      "SELECT replace(name, 'a', 'b') FROM products",
      'SELECT "delete", [drop], `update` FROM t',
      "SELECT CASE WHEN x = 1 THEN 'a' ELSE 'b' END AS c FROM t",
      'WITH a AS (SELECT 1 AS n) SELECT n FROM a',
      'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 3) SELECT x FROM c',
      'SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4',
      "SELECT name FROM products WHERE name = 'សាប៊ូ'",
      'SELECT deleted_at, updated_by, created_at FROM t',
      "SELECT 'it''s' AS s",
      'SELECT 1 /* a ; DROP TABLE t */ AS one',
    ]
    for (const sql of ok) guard.guardSql(sql)
    assert.strictEqual(guard.guardSql('SELECT  1 ,\n\t2 -- x\n FROM t ;').sql, 'SELECT 1 , 2 FROM t')
    assert.strictEqual(guard.guardSql("SELECT 'a  b' AS s").sql, "SELECT 'a  b' AS s")
  })

  await check('rejects every write, schema, transaction, attach and pragma form', () => {
    const forbidden = [
      'INSERT INTO t VALUES (1)',
      'UPDATE t SET x = 1',
      'DELETE FROM t',
      'CREATE TABLE t (x)',
      'DROP TABLE t',
      'ALTER TABLE t ADD COLUMN y',
      'REPLACE INTO t VALUES (1)',
      'PRAGMA table_info(products)',
      'SELECT * FROM pragma_table_info(\'products\')',
      "ATTACH DATABASE 'x' AS y",
      'DETACH DATABASE y',
      'VACUUM',
      'REINDEX',
      'ANALYZE',
      'BEGIN',
      'COMMIT',
      'ROLLBACK',
      'SAVEPOINT a',
      'RELEASE a',
      'CREATE TRIGGER tr AFTER INSERT ON t BEGIN SELECT 1; END',
      'WITH a AS (SELECT 1) DELETE FROM t',
      'WITH a AS (SELECT 1) INSERT INTO t SELECT * FROM a',
      'WITH a AS (SELECT 1) UPDATE t SET x = 1 RETURNING x',
      'SELECT load_extension(\'x\')',
      'EXPLAIN SELECT 1',
      'VALUES (1)',
    ]
    for (const sql of forbidden) rejects(sql)
    rejects('DELETE FROM t', 'sql-not-select')
    // REPLACE the statement (not the replace() function) behind a WITH.
    rejects('WITH a AS (SELECT 1 AS x) REPLACE INTO t SELECT x FROM a', 'sql-forbidden-word')
    rejects('SELECT 1 FROM t WHERE x IN (SELECT 1) AND 0 = 1 OR (DELETE)', 'sql-forbidden-word')
  })

  await check('rejects a trailing second statement, however it is disguised', () => {
    rejects('SELECT 1; SELECT 2', 'sql-multiple-statements')
    rejects('SELECT 1;;', 'sql-multiple-statements')
    rejects('SELECT 1; DROP TABLE t', 'sql-multiple-statements')
    rejects('SELECT 1 -- note\n; DELETE FROM t', 'sql-multiple-statements')
    rejects("SELECT 'x'; DROP TABLE t; --'", 'sql-multiple-statements')
    rejects("SELECT '--', 1; DELETE FROM t", 'sql-multiple-statements')
    rejects('SELECT 1 /* close */ ; /* open */ DROP TABLE t', 'sql-multiple-statements')
    rejects('SELECT 1;\n-- ok\nSELECT 2', 'sql-multiple-statements')
  })

  await check('comments cannot hide a statement: unterminated and nested comments, CR-only line ends', () => {
    rejects('SELECT 1 /* DROP TABLE t', 'sql-unterminated')
    // SQLite has no nested comments: the first */ closes it and DROP is code.
    rejects('SELECT 1 /* a /* b */ DROP TABLE t */', 'sql-forbidden-word')
    rejects('SELECT 1 /* a /* b */ DROP TABLE t; */')
    // -- ends only at LF (as in SQLite), so CR does not end the comment: the
    // DROP after it is still inside the comment and nothing runs it.
    assert.strictEqual(guard.guardSql('SELECT 1 -- x\rDROP TABLE t').sql, 'SELECT 1')
    rejects("SELECT 'unterminated", 'sql-unterminated')
    rejects('SELECT "unterminated', 'sql-unterminated')
    rejects('SELECT [unterminated', 'sql-unterminated')
  })

  await check('rejects look-alike and control characters outside strings', () => {
    rejects('SELECT 1； DROP TABLE t', 'sql-non-ascii') // fullwidth semicolon
    rejects('SELECT 1 FROM t', 'sql-non-ascii') // no-break space
    rejects('SELECT 1\u0000', 'sql-control-character')
    rejects("SELECT 'a\u0000b'", 'sql-control-character')
  })

  await check('caps compound SELECTs at 4 terms (D1 refuses longer ones)', () => {
    guard.guardSql('SELECT 1 UNION SELECT 2 INTERSECT SELECT 3 EXCEPT SELECT 4')
    rejects('SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5', 'sql-compound-too-long')
    const eight = Array.from({ length: 8 }, (_, i) => `SELECT ${i}`).join(' UNION ALL ')
    rejects(eight, 'sql-compound-too-long')
  })

  await check('directives: known ones parse; unknown, duplicate, malformed and block-comment ones are refused', () => {
    const r = guard.guardSql('-- ops:min-rows 0\n-- ops:max-rows 5\n-- ops:expect-zero a, b\n-- ops:public-row-count\nSELECT 0 AS a, 0 AS b').rules
    assert.deepStrictEqual(r, { minRows: 0, maxRows: 5, expectZero: ['a', 'b'], publicRowCount: true })
    assert.deepStrictEqual(guard.guardSql('-- a plain comment\nSELECT 1').rules, { minRows: 1, maxRows: null, expectZero: null, publicRowCount: false })
    rejects('-- ops:export-everything\nSELECT 1', 'sql-unknown-directive')
    rejects('-- ops:min-rows 1\n-- ops:min-rows 2\nSELECT 1', 'sql-duplicate-directive')
    rejects('-- ops:min-rows many\nSELECT 1', 'sql-bad-directive')
    rejects('-- ops:max-rows 0\nSELECT 1', 'sql-bad-directive')
    rejects('-- ops:expect-zero a;b\nSELECT 1', 'sql-bad-directive')
    rejects('/* ops:public-row-count */ SELECT 1', 'sql-bad-directive')
    rejects('-- ops:public-row-count yes\nSELECT 1', 'sql-bad-directive')
  })

  await check('query names are validated before touching the filesystem', () => {
    for (const bad of ['', '../product-names', 'Product-Names', 'product-names.sql', 'a/b', 'a\\b', '-x', 'x'.repeat(65)]) {
      assert.throws(() => guard.loadQuery(bad), (e) => e.code === 'query-name-invalid', bad)
    }
    assert.throws(() => guard.loadQuery('no-such-query'), (e) => e.code === 'query-not-found')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-guard-'))
    try {
      fs.writeFileSync(path.join(tmp, 'evil.sql'), 'SELECT 1; DELETE FROM products')
      fs.writeFileSync(path.join(tmp, 'fine.sql'), 'SELECT 1')
      assert.throws(() => guard.loadQuery('evil', tmp), (e) => e.code === 'sql-multiple-statements')
      assert.strictEqual(guard.loadQuery('fine', tmp).sql, 'SELECT 1')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  await check('the wrangler invocation is the fixed read command with the canonical SQL as one argument', () => {
    const q = guard.loadQuery('r2-url-audit')
    assert.deepStrictEqual(d1.wranglerArgs(q.sql), ['d1', 'execute', 'business-os', '--remote', '--json', '--command', q.sql])
  })

  // ------------------------------------------------ interpretD1Output
  const rules = (over = {}) => ({ minRows: 1, maxRows: null, expectZero: null, publicRowCount: false, ...over })
  const out = (results, meta = { rows_read: 3, rows_written: 0, changes: 0, changed_db: false }, extra = {}) =>
    JSON.stringify([{ results, success: true, meta, ...extra }], null, 2)

  await check('interpretD1Output: a normal result set passes', () => {
    const v = d1.interpretD1Output(out([{ id: 1, name: 'A' }, { id: 2, name: 'B' }]), rules())
    assert.strictEqual(v.ok, true)
    assert.strictEqual(v.rowCount, 2)
    assert.deepStrictEqual(v.problems, [])
  })

  await check('interpretD1Output: no results array, errors, non-JSON and extra result sets all fail', () => {
    const cases = {
      'not json': 'Error: something',
      empty: '',
      'error object': JSON.stringify({ error: { text: 'A request to the Cloudflare API failed. [code: 7500]' } }),
      'no results': JSON.stringify([{ success: true, meta: {} }]),
      'results not array': JSON.stringify([{ results: {}, success: true }]),
      'two sets': JSON.stringify([{ results: [{ a: 1 }], success: true }, { results: [], success: true }]),
      'success false': JSON.stringify([{ results: [{ a: 1 }], success: false }]),
      'rows are not objects': JSON.stringify([{ results: [1, 2], success: true }]),
    }
    for (const [name, stdout] of Object.entries(cases)) {
      const v = d1.interpretD1Output(stdout, rules())
      assert.strictEqual(v.ok, false, `${name} passed`)
    }
    const e = d1.interpretD1Output(cases['error object'], rules())
    assert.deepStrictEqual(e.errorCodes, [7500])
  })

  await check('interpretD1Output: any reported write fails, even with rows', () => {
    for (const meta of [{ rows_written: 1 }, { changes: 2 }, { changed_db: true }]) {
      const v = d1.interpretD1Output(out([{ a: 1 }], meta), rules())
      assert.ok(v.problems.includes('d1-reported-a-write'), JSON.stringify(meta))
    }
  })

  await check('interpretD1Output: min-rows, max-rows and expect-zero discriminate', () => {
    assert.ok(d1.interpretD1Output(out([]), rules()).problems.includes('min-rows-not-met'))
    assert.strictEqual(d1.interpretD1Output(out([]), rules({ minRows: 0 })).ok, true)
    assert.ok(d1.interpretD1Output(out([{ a: 0 }, { a: 0 }]), rules({ maxRows: 1 })).problems.includes('max-rows-exceeded'))
    const zero = rules({ expectZero: '*', maxRows: 1 })
    assert.strictEqual(d1.interpretD1Output(out([{ a: 0, b: 0 }]), zero).ok, true)
    assert.strictEqual(d1.interpretD1Output(out([{ a: 0, b: 0 }]), zero).zeroCheck, 'PASS')
    const bad = d1.interpretD1Output(out([{ a: 0, b: 3 }]), zero)
    assert.strictEqual(bad.ok, false)
    assert.strictEqual(bad.zeroCheck, 'FAIL')
    // the string "0" and null are not zero counts
    assert.strictEqual(d1.interpretD1Output(out([{ a: '0' }]), zero).ok, false)
    assert.strictEqual(d1.interpretD1Output(out([{ a: null }]), zero).ok, false)
    // a row with no columns cannot satisfy expect-zero *
    assert.strictEqual(d1.interpretD1Output(out([{}]), zero).ok, false)
    const named = rules({ expectZero: ['a'] })
    assert.strictEqual(d1.interpretD1Output(out([{ a: 0, b: 9 }]), named).ok, true)
    assert.strictEqual(d1.interpretD1Output(out([{ b: 0 }]), named).ok, false)
  })

  await check('interpretD1Output tolerates text ahead of the JSON', () => {
    const v = d1.interpretD1Output(`warning: something\n${out([{ a: 1 }])}`, rules())
    assert.strictEqual(v.ok, true)
  })

  // ---------------------------------------------------- public lines
  const render = (lines) => lines.map(([t, v]) => common.formatPublic(t, v)).join('\n')

  await check('public lines never carry row data, and show the row count only when the query allows it', () => {
    const rows = [{ id: 7, name: 'SECRET-PRODUCT', brand: 'BRANDX' }]
    const v = d1.interpretD1Output(out(rows), rules())
    const text = render(d1.publicLines({ name: 'product-names', verdict: v, rules: rules(), bytes: 1234 }))
    assert.ok(!/SECRET-PRODUCT|BRANDX/.test(text))
    assert.ok(/rows: withheld/.test(text))
    assert.ok(!/rows: 1\b/.test(text))
    assert.ok(/verdict: PASS/.test(text))
    const pub = rules({ publicRowCount: true })
    const shown = render(d1.publicLines({ name: 'migrations-applied', verdict: d1.interpretD1Output(out(rows), pub), rules: pub, bytes: 10 }))
    assert.ok(/rows: 1\b/.test(shown))
    const audit = rules({ expectZero: '*', maxRows: 1 })
    const failed = render(d1.publicLines({ name: 'r2-url-audit', verdict: d1.interpretD1Output(out([{ products_image_path_absolute: 4 }]), audit), rules: audit, bytes: 10 }))
    assert.ok(/expect-zero check: FAIL/.test(failed))
    assert.ok(!/products_image_path_absolute|\b4\b/.test(failed), 'the failing column or its count leaked')
    assert.ok(/verdict: FAIL/.test(failed))
  })

  await check('the public log refuses raw strings (names, keys, messages)', () => {
    assert.throws(() => common.formatPublic('x {v}', { v: 'SECRET-PRODUCT name' }))
    assert.throws(() => common.formatPublic('x {v}', { v: 'uploads/photo.jpg' }))
    assert.throws(() => common.formatPublic('x {v}', { v: { name: 'x' } }))
    assert.throws(() => common.formatPublic('x {v}', {}))
    assert.throws(() => common.formatPublic('two\nlines', {}))
    assert.strictEqual(common.formatPublic('n={n} ok={ok} v={v} c={c}', { n: 3, ok: true, v: 'PASS', c: 'ede999ec' }), 'n=3 ok=yes v=PASS c=ede999ec')
    assert.strictEqual(common.formatPublic('q={q}', { q: common.publicToken('product-names') }), 'q=product-names')
  })

  if (process.exitCode) console.error(`test-ops-sql-guard-pure: FAILED (${passed} passed)`)
  else console.log(`test-ops-sql-guard-pure: ${passed} checks passed`)
}

main().catch((err) => {
  console.error(`test-ops-sql-guard-pure: crashed: ${err && err.stack}`)
  process.exitCode = 1
})
