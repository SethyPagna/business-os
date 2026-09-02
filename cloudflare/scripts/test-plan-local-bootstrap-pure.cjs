// scripts/bootstrap-local-d1.cjs: the compound-SELECT splitter that lets a
// FRESH local D1 state get past migrations/0098_user_aliases.sql.
//
// The thing that would be catastrophic to get wrong here is silent: a
// splitter that rewrites a migration into something that inserts DIFFERENT
// rows would leave every local database subtly wrong, with nothing failing.
// So the central check is not "does it produce N statements" but "do the
// split statements write byte-identical rows to the original", proved by
// running BOTH forms against real SQLite (better-sqlite3, already a
// dependency of this package) and diffing the resulting table.
//
// The second thing that would be catastrophic is a splitter that accepts a
// shape where concatenation is NOT equivalent (UNION, INTERSECT, EXCEPT,
// anything with ORDER BY/LIMIT/GROUP BY/DISTINCT spanning the terms). Those
// must throw, not "do their best".
//
// Run: node scripts/test-plan-local-bootstrap-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const bootstrap = require('./bootstrap-local-d1.cjs')
const cloudflareRoot = path.join(__dirname, '..')

let passed = 0
const tests = []
function check(name, fn) { tests.push({ name, fn }) }

// The real migration, read from disk -- so this test tracks the file rather
// than a copy of it. bootstrap-local-d1.cjs must never write to it.
const MIGRATION_0098 = path.join(cloudflareRoot, 'migrations', '0098_user_aliases.sql')

check('workerd\'s ceiling is pinned at 5 terms', () => {
  assert.equal(bootstrap.MAX_COMPOUND_SELECT_TERMS, 5,
    'workerd sets sqlite3_limit(db, SQLITE_LIMIT_COMPOUND_SELECT, 5) in src/workerd/util/sqlite.c++')
})

check('0098 really is over the local ceiling (7 terms, six UNION ALLs)', () => {
  const sql = fs.readFileSync(MIGRATION_0098, 'utf8')
  const statements = bootstrap.splitStatements(sql)
  const seed = statements.find((stmt) => /INSERT\s+OR\s+IGNORE\s+INTO\s+user_aliases/i.test(stmt))
  assert.ok(seed, '0098 no longer contains the user_aliases seed INSERT -- update this test')
  const tokens = bootstrap.findUnionAllTokens(seed)
  assert.equal(tokens.length, 6, 'expected six UNION ALL operators')
  assert.ok(tokens.length + 1 > bootstrap.MAX_COMPOUND_SELECT_TERMS, 'seven terms must exceed the ceiling of five')
})

check('the migration file itself is never rewritten by the transform', () => {
  const before = fs.readFileSync(MIGRATION_0098)
  bootstrap.transformSqlForLocalSqlite(before.toString('utf8'))
  const after = fs.readFileSync(MIGRATION_0098)
  assert.ok(before.equals(after), 'transformSqlForLocalSqlite must be pure -- it wrote to migrations/')
})

check('every split statement is inside the ceiling', () => {
  const sql = fs.readFileSync(MIGRATION_0098, 'utf8')
  const transformed = bootstrap.transformSqlForLocalSqlite(sql)
  assert.equal(transformed.changed, true, 'expected 0098 to need a split')
  for (const stmt of bootstrap.splitStatements(transformed.sql)) {
    const terms = bootstrap.findUnionAllTokens(stmt).length + 1
    assert.ok(terms <= bootstrap.MAX_COMPOUND_SELECT_TERMS,
      `split statement still has ${terms} terms:\n${stmt}`)
  }
})

// The load-bearing check: same rows, both forms, real SQLite.
function seedUsersSchema(db) {
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );
    INSERT INTO users (username) VALUES
      ('Za'), ('Rath'), ('james'), ('admin'), ('someone-else');
  `)
}

function runMigrationForm(sqlText) {
  const db = new Database(':memory:')
  try {
    seedUsersSchema(db)
    db.exec(sqlText)
    return db.prepare('SELECT user_id, alias FROM user_aliases ORDER BY user_id, alias').all()
  } finally {
    db.close()
  }
}

check('split form inserts EXACTLY the same rows as the original (real SQLite)', () => {
  const original = fs.readFileSync(MIGRATION_0098, 'utf8')
  const transformed = bootstrap.transformSqlForLocalSqlite(original)
  const before = runMigrationForm(original)
  const after = runMigrationForm(transformed.sql)
  assert.ok(before.length > 0, 'fixture produced no aliases -- the equivalence check would be vacuous')
  assert.deepEqual(after, before)
})

check('split form is idempotent, like the original (INSERT OR IGNORE + unique index)', () => {
  const original = fs.readFileSync(MIGRATION_0098, 'utf8')
  const transformed = bootstrap.transformSqlForLocalSqlite(original)
  const db = new Database(':memory:')
  try {
    seedUsersSchema(db)
    db.exec(transformed.sql)
    const once = db.prepare('SELECT user_id, alias FROM user_aliases ORDER BY user_id, alias').all()
    db.exec(transformed.sql)
    const twice = db.prepare('SELECT user_id, alias FROM user_aliases ORDER BY user_id, alias').all()
    assert.deepEqual(twice, once)
  } finally {
    db.close()
  }
})

check('a compound SELECT already inside the ceiling is left untouched', () => {
  const sql = "INSERT INTO t (a) SELECT s.a FROM (SELECT 1 AS a UNION ALL SELECT 2 UNION ALL SELECT 3) AS s;\n"
  const transformed = bootstrap.transformSqlForLocalSqlite(sql)
  assert.equal(transformed.changed, false)
  assert.deepEqual(transformed.notes, [])
})

check('semicolons inside string literals and comments do not split statements', () => {
  const sql = "INSERT INTO t (a) VALUES ('x;y'); -- trailing ; comment\nINSERT INTO t (a) VALUES ('z');\n"
  const statements = bootstrap.splitStatements(sql).map((stmt) => stmt.trim()).filter(Boolean)
  assert.equal(statements.length, 2)
  assert.ok(statements[0].includes("'x;y'"))
})

check('UNION ALL inside a string literal is not treated as an operator', () => {
  const sql = "INSERT INTO t (a) VALUES ('union all union all union all union all union all union all');\n"
  const transformed = bootstrap.transformSqlForLocalSqlite(sql)
  assert.equal(transformed.changed, false)
})

// Refusals -- each of these would change the result if split.
const REFUSALS = [
  ['UNION (de-duplicating) is refused',
    'INSERT INTO t (a) SELECT s.a FROM (SELECT 1 AS a UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6) AS s;',
    /UNION\/INTERSECT\/EXCEPT/],
  ['a bare (non-INSERT) compound SELECT is refused',
    'SELECT x.a FROM (SELECT 1 AS a UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6) AS x;',
    /not an INSERT/],
  ['ORDER BY spanning the compound is refused',
    'INSERT INTO t (a) SELECT s.a FROM (SELECT 1 AS a UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6) AS s ORDER BY s.a;',
    /ORDER BY/],
  ['DISTINCT over the compound is refused',
    'INSERT INTO t (a) SELECT DISTINCT s.a FROM (SELECT 1 AS a UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6) AS s;',
    /DISTINCT/],
  ['an un-parenthesised top-level compound is refused',
    'INSERT INTO t (a) SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6;',
    /not inside a parenthesised sub-select/],
]
for (const [name, sql, pattern] of REFUSALS) {
  check(name, () => {
    assert.throws(() => bootstrap.transformSqlForLocalSqlite(sql), pattern)
  })
}

check('the seven seeded aliases from 0098 are all present after the split', () => {
  const original = fs.readFileSync(MIGRATION_0098, 'utf8')
  const transformed = bootstrap.transformSqlForLocalSqlite(original)
  const rows = runMigrationForm(transformed.sql)
  const aliases = rows.map((row) => row.alias).sort()
  assert.deepEqual(aliases, ['aza', 'dev-usmart', 'pagna', 'rout', 'routh', 'sethyka', 'super admin'])
})

async function main() {
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log('PASS', name)
      passed++
    } catch (e) {
      console.log('FAIL', name, '-', e.message)
      process.exitCode = 1
    }
  }
  console.log(`\n${passed} check(s) passed.`)
  if (process.exitCode) console.log('SOME CHECKS FAILED')
}

void main()
