// Migration 0107 + the guards that stop the defect coming back.
//
// THE DEFECT (2026-09-02): an out-of-band reconciliation pack rewrote 15,004
// of the 15,005 rows in sales.receipt_number to the OLD SYSTEM's invoice
// label `NNNNNN@YYYY-MM-DD`, taking 87 of that week's 88 live POS receipts
// with it. The user's rule: receipt numbers are `YYYYMMDD-HHMMSS` in the
// business timezone, 24-hour (returns keep RET-/SRET-).
//
// This test runs the REAL 0107 SQL on the REAL schema (the whole migration
// chain loaded into better-sqlite3) and asserts the exact resulting numbers,
// idempotency and legacy preservation -- then asserts no live writer can mint
// or accept the `@` shape again.
//
// Run: node scripts/test-receipt-number-format-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')

const cloudflareRoot = path.join(__dirname, '..')
const migrationsDir = path.join(cloudflareRoot, 'migrations')
const MIGRATION_0107 = '0107_receipt_numbers_business_format.sql'
// Normalise line endings: an autocrlf checkout hands this file back with CRLF,
// and the shape checks below look for LF-separated SQL.
const migration0107 = fs.readFileSync(path.join(migrationsDir, MIGRATION_0107), 'utf8').replace(/
/g, '
')

let failed = 0
function check(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// ---- fixture: the real schema, everything up to but NOT including 0107 ----
function freshDb() {
  const db = new Database(':memory:')
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    if (file >= MIGRATION_0107) break
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  }
  return db
}

function seed(db, rows) {
  const insert = db.prepare('INSERT INTO sales (id, receipt_number, created_at, total_usd) VALUES (?, ?, ?, 1)')
  for (const row of rows) insert.run(row.id, row.receipt_number, row.created_at)
}

const numbers = (db) => db.prepare('SELECT id, receipt_number, legacy_receipt_number FROM sales ORDER BY id').all()

// ---------------------------------------------------------------------------
// (a) the migration itself
// ---------------------------------------------------------------------------
check('rewrites every created_at format found in production to the business id', () => {
  const db = freshDb()
  try {
    seed(db, [
      // ISO with T, Z and milliseconds -- what the reconciliation wrote onto
      // all 15,004 rows. 09:42:28 UTC = 16:42:28 Phnom Penh.
      { id: 1, receipt_number: '004434@2026-09-02', created_at: '2026-09-02T09:42:28.000Z' },
      // CURRENT_TIMESTAMP's own shape (the one surviving live row's format).
      { id: 2, receipt_number: '004200@2026-09-01', created_at: '2026-09-01 06:44:55' },
      // ISO seconds, no milliseconds, and ISO with no Z at all -- accepted by
      // datetime() and by importEngine's parseSalesImportDateTime output.
      { id: 3, receipt_number: '000123@2024-07-18', created_at: '2024-07-18T08:21:06Z' },
      { id: 4, receipt_number: '000124@2024-07-18', created_at: '2024-07-18T09:00:00' },
      // UTC evening rolls into the NEXT Phnom Penh day.
      { id: 5, receipt_number: '000999@2026-08-31', created_at: '2026-08-30T17:00:00.000Z' },
    ])
    db.exec(migration0107)
    assert.deepEqual(numbers(db), [
      { id: 1, receipt_number: '20260902-164228', legacy_receipt_number: '004434@2026-09-02' },
      { id: 2, receipt_number: '20260901-134455', legacy_receipt_number: '004200@2026-09-01' },
      { id: 3, receipt_number: '20240718-152106', legacy_receipt_number: '000123@2024-07-18' },
      { id: 4, receipt_number: '20240718-160000', legacy_receipt_number: '000124@2024-07-18' },
      { id: 5, receipt_number: '20260831-000000', legacy_receipt_number: '000999@2026-08-31' },
    ])
  } finally { db.close() }
})

check('two sales in the same business second take the app\'s -2/-3 suffixes, ordered by id', () => {
  const db = freshDb()
  try {
    seed(db, [
      { id: 10, receipt_number: '004001@2026-09-02', created_at: '2026-09-02T03:00:00.000Z' },
      { id: 11, receipt_number: '004002@2026-09-02', created_at: '2026-09-02T03:00:00.000Z' },
      { id: 12, receipt_number: '004003@2026-09-02', created_at: '2026-09-02T03:00:00.000Z' },
    ])
    db.exec(migration0107)
    assert.deepEqual(numbers(db).map((r) => r.receipt_number), [
      '20260902-100000', '20260902-100000-2', '20260902-100000-3',
    ])
    assert.equal(db.prepare('SELECT COUNT(DISTINCT receipt_number) FROM sales').pluck().get(), 3)
  } finally { db.close() }
})

check('a live POS receipt already holding the derived id is never collided with', () => {
  const db = freshDb()
  try {
    seed(db, [
      // Not rewritten (already ours) and already owns 20260902-100000, plus a
      // -2 it took the same second. The repaired rows must start at -3.
      { id: 20, receipt_number: '20260902-100000', created_at: '2026-09-02T03:00:00.000Z' },
      { id: 21, receipt_number: '20260902-100000-2', created_at: '2026-09-02T03:00:00.000Z' },
      { id: 22, receipt_number: '004001@2026-09-02', created_at: '2026-09-02T03:00:00.000Z' },
      { id: 23, receipt_number: '004002@2026-09-02', created_at: '2026-09-02T03:00:00.000Z' },
    ])
    db.exec(migration0107)
    assert.deepEqual(numbers(db).map((r) => r.receipt_number), [
      '20260902-100000', '20260902-100000-2', '20260902-100000-3', '20260902-100000-4',
    ])
    // The untouched rows keep a NULL legacy column -- only rewritten rows get one.
    assert.deepEqual(numbers(db).map((r) => r.legacy_receipt_number), [
      null, null, '004001@2026-09-02', '004002@2026-09-02',
    ])
  } finally { db.close() }
})

check('leaves alone anything that is not the @ shape, and any unparseable created_at', () => {
  const db = freshDb()
  try {
    seed(db, [
      { id: 30, receipt_number: '20260901-134455', created_at: '2026-09-01 06:44:55' },
      { id: 31, receipt_number: 'RCP-20260101-090000', created_at: '2026-01-01 02:00:00' },
      { id: 32, receipt_number: 'IMP-20260101-AB12CD34', created_at: '2026-01-01 02:00:00' },
      // A receipt with a wrong label is a nuisance; a receipt overwritten with
      // NULL is lost data -- an unparseable timestamp must be skipped.
      { id: 33, receipt_number: '004050@2026-09-02', created_at: 'not a date' },
      { id: 34, receipt_number: '004051@2026-09-02', created_at: null },
    ])
    db.exec(migration0107)
    assert.deepEqual(numbers(db), [
      { id: 30, receipt_number: '20260901-134455', legacy_receipt_number: null },
      { id: 31, receipt_number: 'RCP-20260101-090000', legacy_receipt_number: null },
      { id: 32, receipt_number: 'IMP-20260101-AB12CD34', legacy_receipt_number: null },
      { id: 33, receipt_number: '004050@2026-09-02', legacy_receipt_number: '004050@2026-09-02' },
      { id: 34, receipt_number: '004051@2026-09-02', legacy_receipt_number: '004051@2026-09-02' },
    ])
  } finally { db.close() }
})

check('the data statements are a no-op on a rerun (only the plain ADD COLUMN repeats)', () => {
  const db = freshDb()
  try {
    seed(db, [
      { id: 40, receipt_number: '004434@2026-09-02', created_at: '2026-09-02T09:42:28.000Z' },
      { id: 41, receipt_number: '004001@2026-09-02', created_at: '2026-09-02T03:00:00.000Z' },
      { id: 42, receipt_number: '004002@2026-09-02', created_at: '2026-09-02T03:00:00.000Z' },
    ])
    db.exec(migration0107)
    const afterFirst = numbers(db)

    // Re-running the whole file fails ONLY on the un-guardable ADD COLUMN --
    // which is what D1's d1_migrations ledger prevents in production.
    assert.throws(() => db.exec(migration0107), /duplicate column name: legacy_receipt_number/)

    // Everything after that ALTER is genuinely idempotent: replay the file
    // without it and nothing moves -- no double-suffixing, no legacy value
    // overwritten with the repaired one.
    const dataOnly = migration0107.replace(/^ALTER TABLE sales ADD COLUMN legacy_receipt_number TEXT;$/m, '')
    db.exec(dataOnly)
    db.exec(dataOnly)
    assert.deepEqual(numbers(db), afterFirst)
    assert.deepEqual(afterFirst.map((r) => r.receipt_number), [
      '20260902-164228', '20260902-100000', '20260902-100000-2',
    ])
  } finally { db.close() }
})

check('a return follows its sale onto the new label instead of naming a dead receipt', () => {
  const db = freshDb()
  try {
    seed(db, [{ id: 50, receipt_number: '004434@2026-09-02', created_at: '2026-09-02T09:42:28.000Z' }])
    db.prepare('INSERT INTO returns (id, return_number, sale_id, receipt_number) VALUES (?, ?, ?, ?)')
      .run(1, 'RET-20260902-170000', 50, '004434@2026-09-02')
    // A return that names no sale (or a receipt the sale never had) is left alone.
    db.prepare('INSERT INTO returns (id, return_number, sale_id, receipt_number) VALUES (?, ?, ?, ?)')
      .run(2, 'RET-20260902-170001', null, '009999@2026-09-02')
    db.exec(migration0107)
    assert.deepEqual(db.prepare('SELECT id, receipt_number FROM returns ORDER BY id').all(), [
      { id: 1, receipt_number: '20260902-164228' },
      { id: 2, receipt_number: '009999@2026-09-02' },
    ])
  } finally { db.close() }
})

check('the relabel is linear, not a per-row scan of the materialized CTE', () => {
  // The first draft of 0107 wrote `SET receipt_number = (SELECT new_number
  // FROM final WHERE final.id = sales.id) WHERE id IN (SELECT id FROM final)`.
  // SQLite builds NO automatic index on a MATERIALIZED CTE, so that plan was
  // `CORRELATED SCALAR SUBQUERY -> SCAN final`: a full scan of the 15,004-row
  // CTE per updated row. Measured on a copy of production it took 30,220 ms
  // against 1,953 ms for the UPDATE...FROM form -- and 30s of single-statement
  // CPU is what trips remote D1's limit (code 7429), which would leave the
  // migration half-applied with the ALTER and indexes already committed.
  // This check pins the shape so the trap cannot be reintroduced.
  const updateAt = migration0107.indexOf('UPDATE sales\n   SET receipt_number = final.new_number')
  assert.ok(updateAt > 0, 'step 2 is no longer an UPDATE ... FROM final')
  const step2 = migration0107.slice(
    migration0107.indexOf('WITH cand AS ('),
    migration0107.indexOf(';', updateAt) + 1,
  )
  assert.match(step2, /SET receipt_number = final\.new_number\s+FROM final\s+WHERE final\.id = sales\.id;\s*$/)
  // The redundant `WHERE id IN (SELECT id FROM final)` filter is gone with it:
  // UPDATE...FROM already touches only sales rows that have a `final` row, and
  // the IN filter cost a second walk of the CTE for no semantic gain.
  // (the migration's own comment quotes the rejected form, so strip comments
  // before looking for it in the executable text)
  const step2Sql = step2.replace(/^\s*--.*$/gm, '')
  assert.ok(!/WHERE id IN \(SELECT id FROM final\)/.test(step2Sql), 'the redundant IN filter is back')

  const db = freshDb()
  try {
    db.exec('ALTER TABLE sales ADD COLUMN legacy_receipt_number TEXT')
    db.exec('CREATE INDEX IF NOT EXISTS idx_sales_receipt_number ON sales(receipt_number)')
    seed(db, [
      { id: 1, receipt_number: '004434@2026-09-02', created_at: '2026-09-02T09:42:28.000Z' },
      { id: 2, receipt_number: '004433@2026-09-02', created_at: '2026-09-02T09:18:15.000Z' },
    ])
    // EXPLAIN QUERY PLAN rows are a tree: {id, parent, detail}.
    const rows = db.prepare('EXPLAIN QUERY PLAN ' + step2).all()
    const plan = rows.map((row) => row.detail)
    const show = plan.join('\n')
    const byId = new Map(rows.map((row) => [row.id, row]))
    const ancestry = (row) => {
      const out = []
      for (let cur = byId.get(row.parent); cur; cur = byId.get(cur.parent)) out.push(cur.detail)
      return out
    }

    // (i) the CTE is walked ONCE, and at the top level of the UPDATE.
    const finalScans = rows.filter((row) => row.detail === 'SCAN final')
    assert.equal(finalScans.length, 1, show)
    // (ii) nothing correlates back into `final`. This is the exact regression:
    //      a `SCAN final` underneath a CORRELATED SCALAR SUBQUERY is one full
    //      pass of the CTE per updated row.
    assert.ok(
      !finalScans.some((row) => ancestry(row).some((d) => /CORRELATED SCALAR SUBQUERY/.test(d))),
      `step 2 rescans the CTE once per row:\n${show}`,
    )
    // (iii) the target row is reached by rowid: one seek per updated row.
    assert.ok(plan.includes('SEARCH sales USING INTEGER PRIMARY KEY (rowid=?)'), show)
    // (iv) MATERIALIZED still holds, so `taken` reads the PRE-update table and
    //      the result cannot depend on the order SQLite visits rows in.
    assert.ok(plan.includes('MATERIALIZE final'), show)
    assert.ok(plan.includes('MATERIALIZE ranked'), show)
    // (v) the collision probe is an index seek, never a 15k x 15k scan.
    assert.ok(
      plan.some((line) => /SEARCH k USING (COVERING )?INDEX idx_sales_receipt_number/.test(line)),
      `the taken sub-select is not index-backed:\n${show}`,
    )
  } finally { db.close() }
})

check('the migration adds the receipt lookup indexes the mint-time probe needs', () => {
  const db = freshDb()
  try {
    db.exec(migration0107)
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sales'").all().map((r) => r.name)
    assert.ok(indexes.includes('idx_sales_receipt_number'), 'idx_sales_receipt_number missing')
    assert.ok(indexes.includes('idx_sales_legacy_receipt_number'), 'idx_sales_legacy_receipt_number missing')
    // The probe POST /api/sales runs on every checkout must be an index seek.
    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM sales WHERE receipt_number = ? LIMIT 1').all('x')
    assert.match(JSON.stringify(plan), /idx_sales_receipt_number/)
  } finally { db.close() }
})

// ---------------------------------------------------------------------------
// (b) the guard: the `@` shape is refused at the door
// ---------------------------------------------------------------------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-format-'))
const tsPath = path.join(tmpDir, 'receiptNumber.ts')
fs.writeFileSync(tsPath, fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'receiptNumber.ts'), 'utf8'))
const tscBin = path.join(cloudflareRoot, 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${tsPath}`, { cwd: tmpDir, stdio: 'inherit' })
const { isBusinessReceiptNumber, normalizeClientReceiptNumber } = require(path.join(tmpDir, 'receiptNumber.js'))

check('the guard rejects the NNNNNN@YYYY-MM-DD shape and every other foreign label', () => {
  for (const bad of [
    '004434@2026-09-02', '4351@2026-08-28', '004434@20260902', '004434',
    '2026-09-02', '20260902', '20260902-1642', 'sale_26f5f598', '', '   ',
    '20260902-164228@2026-09-02', null, undefined, 12345,
  ]) {
    assert.equal(isBusinessReceiptNumber(bad), false, `should reject ${JSON.stringify(bad)}`)
    assert.equal(normalizeClientReceiptNumber(bad), null, `should drop ${JSON.stringify(bad)}`)
  }
})

check('the guard accepts exactly what the generator mints, prefixes included', () => {
  for (const good of [
    '20260902-164228', '20260902-164228-2', '20260902-164228-10', '20260902-164228-A3F9',
    'RCP-20260101-090000', 'RET-20260902-164228', 'SRET-20260902-164228-2',
  ]) {
    assert.equal(isBusinessReceiptNumber(good), true, `should accept ${good}`)
    assert.equal(normalizeClientReceiptNumber(good), good, `should keep ${good}`)
  }
  // Whitespace an offline payload may carry is trimmed, not rejected.
  assert.equal(normalizeClientReceiptNumber('  20260902-164228  '), '20260902-164228')
})

// ---------------------------------------------------------------------------
// (c) source shape: no writer can mint or pass through the `@` form
// ---------------------------------------------------------------------------
function readSource(...parts) {
  return fs.readFileSync(path.join(cloudflareRoot, 'src', ...parts), 'utf8')
}

check('POST /api/sales normalises a client receipt number instead of trusting it', () => {
  const salesRoute = readSource('routes', 'sales.ts')
  assert.match(salesRoute, /const receiptNumber = normalizeClientReceiptNumber\(body\.receipt_number\) \|\| await uniqueBusinessDateTimeNumber\(/)
  // The old unguarded pass-through must be gone, not merely shadowed.
  assert.doesNotMatch(salesRoute, /const receiptNumber = body\.receipt_number\?\.trim\(\) \|\|/)
  // ...and a legacy number stays findable through search.
  assert.match(salesRoute, /COALESCE\(s\.legacy_receipt_number, ''\)/)
})

check('the sales importer routes a foreign CSV label to legacy_receipt_number', () => {
  const commit = readSource('lib', 'salesImportCommit.ts')
  assert.match(commit, /normalizeClientReceiptNumber\(suppliedReceipt\)/)
  assert.match(commit, /legacy_receipt_number/)
  // The raw CSV value must not reach receipt_number through the params spread.
  assert.match(commit, /receipt_number: receiptNumber,/)
})

// A line that assigns something receipt-shaped to a string literal holding an
// '@' -- the exact shape of the reconciliation pack's minting and of the
// ops/scripts/migration importers' `${invoiceNo}@${date}`.
function mintsAtReceipt(line) {
  const code = line.trimStart()
  if (code.startsWith('//') || code.startsWith('*')) return false
  return /receipt[A-Za-z_]*\s*[:=]\s*[`'"][^`'"\n]*@/i.test(line)
    || /`[^`\n]*\$\{[^`\n]*\}@/.test(line)
}

check('the @-minting detector is not vacuous', () => {
  // If these ever stop matching, the sweep below silently passes forever.
  assert.equal(mintsAtReceipt("  const receipt = `${invoiceNo}@${date}`"), true)
  assert.equal(mintsAtReceipt("  receipt_number: '004434@2026-09-02',"), true)
  assert.equal(mintsAtReceipt('  const receiptNumber = `${counter}@2026-09-01`'), true)
  assert.equal(mintsAtReceipt('  // historical receipts looked like 4351@2026-08-28'), false)
  assert.equal(mintsAtReceipt('  const receiptNumber = businessDateTimeId()'), false)
})

check('no writer under cloudflare/src mints an @ receipt number', () => {
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!entry.name.endsWith('.ts')) continue
      fs.readFileSync(full, 'utf8').split('\n').forEach((line, index) => {
        if (mintsAtReceipt(line)) offenders.push(`${path.relative(cloudflareRoot, full)}:${index + 1}: ${line.trim()}`)
      })
    }
  }
  walk(path.join(cloudflareRoot, 'src'))
  assert.deepEqual(offenders, [], `@-minting receipt writers found:\n${offenders.join('\n')}`)
})

check('no ops legacy importer can write an @ receipt number onto repaired production', () => {
  // These dated one-shots legitimately COMPUTE the old-system `NNNNNN@date`
  // key -- it is the source identity they reconcile against, and 0107 keeps
  // it in legacy_receipt_number. What they must not do is put it back on
  // sales.receipt_number, which post-0107 they can only do by being re-run.
  // So each one that can apply must refuse to apply once 0107 is in.
  const opsDir = path.join(cloudflareRoot, '..', 'ops', 'scripts', 'migration')
  for (const name of ['import-aug30-legacy-reports.mjs', 'import-aug31-legacy-reports.mjs']) {
    const text = fs.readFileSync(path.join(opsDir, name), 'utf8')
    assert.match(text, /import \{[^}]*assertLegacyReceiptEraStillCurrent[^}]*\} from '\.\/legacy-preflight\.mjs'/, `${name} does not import the guard`)
    assert.match(text, /assertLegacyReceiptEraStillCurrent\(queryRows\)/, `${name} does not call the guard`)
  }
  // The Sep-1 tool stays dry-run only, so it never needs the guard.
  const sep01 = fs.readFileSync(path.join(opsDir, 'import-sep01-legacy-reports.mjs'), 'utf8')
  assert.match(sep01, /deliberately dry-run only/)

  const guard = fs.readFileSync(path.join(opsDir, 'legacy-preflight.mjs'), 'utf8')
  assert.match(guard, /pragma_table_info\('sales'\) WHERE name = 'legacy_receipt_number'/)
  // ...and the reviewed-override matcher reads the legacy column, so it still
  // finds a Sep-1 sale after 0107 moved that label off receipt_number.
  assert.match(guard, /item\.legacy_receipt_number \?\? ''\) === legacyLabel/)
})

if (failed > 0) process.exitCode = 1
