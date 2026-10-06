// The held backfill of products.search_doc (ops/scripts/backfill-search-doc.mjs),
// run for real against the migrated schema (better-sqlite3, the 6,200-row
// fixture catalog). The script only PLANS (it reads a JSON export and writes SQL
// files), so this applies its files the way the deploy lead would.
//
//  1. Every active row ends with EXACTLY docTerms(name, brand) at the current
//     version, the FTS index agrees (integrity-check rank=1 + an exact-token
//     cross-check against the table), and the plan's own PRE and POST assertions
//     evaluate to what they claim.
//  2. Re-running the same files writes nothing (every UPDATE is guarded on the
//     document still being NULL).
//  3. A row EDITED after the export is skipped, not overwritten with a document
//     of the old text; a fresh export + plan then fixes exactly that row.
//     POSITIVE CONTROL: the same statement without the name/brand guard overwrites
//     the edit with the stale document.
//  4. Rows with control characters are left out and listed; chunks are bounded;
//     the SQL is LF-only; all three input shapes read; nothing contacts D1.
//
// Run: node scripts/test-backfill-search-doc-pure.cjs
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const Database = require('better-sqlite3')
const { loadWorkerCore } = require('./harness/search_impls.cjs')
const { buildCatalog, seedProducts } = require('./harness/search_catalog_fixture.cjs')

const core = loadWorkerCore()
const root = path.join(__dirname, '..', '..')
const script = path.join(root, 'ops', 'scripts', 'backfill-search-doc.mjs')
const migrationsDir = path.join(__dirname, '..', 'migrations')

let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks += 1
  console.log(`  ok  ${label}`)
}

function migratedDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  return db
}
const MISSING_SQL = 'SELECT id, name, brand FROM products INDEXED BY idx_products_search_doc_missing WHERE search_doc IS NULL AND is_active = 1 ORDER BY id'
function plan(db, outDir, extra = [], shape = 'wrangler') {
  const rows = db.prepare(MISSING_SQL).all()
  const input = path.join(outDir, 'rows.json')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(input, JSON.stringify(shape === 'wrangler' ? [{ results: rows, success: true }] : shape === 'rows' ? { rows } : rows))
  const run = spawnSync(process.execPath, [script, '--input', input, '--out-dir', path.join(outDir, 'plan'), ...extra], { encoding: 'utf8' })
  assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`)
  return { rows, run, dir: path.join(outDir, 'plan'), summary: JSON.parse(fs.readFileSync(path.join(outDir, 'plan', 'plan.json'), 'utf8')) }
}
const apply = (db, dir, summary) => {
  let changes = 0
  for (const file of summary.files) {
    for (const statement of fs.readFileSync(path.join(dir, file.name), 'utf8').split('\n').filter(Boolean)) changes += db.prepare(statement).run().changes
  }
  return changes
}
const integrity = (db) => db.exec("INSERT INTO products_search_fts(products_search_fts, rank) VALUES('integrity-check', 1)")

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-search-doc-'))
const catalog = buildCatalog()
const db = migratedDb()
// An existing production-like state: every row, no document.
seedProducts(db, catalog)
check('state before: every active row is missing its document', db.prepare(MISSING_SQL).all().length === catalog.length)

// ---- 1. the plan, applied
const first = plan(db, path.join(tmp, 'a'), ['--chunk', '150'])
check(`the script reads wrangler's --json shape and plans ${first.summary.updates} guarded updates in ${first.summary.files.length} files`, first.summary.updates === catalog.length && first.summary.files.length === Math.ceil(catalog.length / 150))
check('every chunk file has at most --chunk statements and no CR', first.summary.files.every((file) => file.statements <= 150) && first.summary.files.every((file) => !fs.readFileSync(path.join(first.dir, file.name), 'utf8').includes('\r')))
check('the script says it sent nothing to D1', /nothing was sent to D1/.test(first.run.stdout))
for (const assertion of first.summary.assertions.pre) {
  const got = db.prepare(assertion.sql).get()
  check(`PRE: ${assertion.name} (${JSON.stringify(got)})`, Object.entries(assertion.expect).every(([key, value]) => got[key] === value))
}
const changed = apply(db, first.dir, first.summary)
check(`applying the files updates every planned row (${changed})`, changed === first.summary.updates)
integrity(db)
check('the FTS index agrees with the table (integrity-check rank=1)', true)
const docs = db.prepare('SELECT id, name, brand, search_doc, search_doc_version FROM products ORDER BY id').all()
check('EVERY row carries exactly docTerms(name, brand) at the current version', docs.every((row) => row.search_doc === core.docTerms(row) && row.search_doc_version === core.SEARCH_DOC_VERSION))
for (const assertion of first.summary.assertions.post) {
  const got = db.prepare(assertion.sql).all()
  if (Array.isArray(assertion.expect)) check(`POST: ${assertion.name}`, JSON.stringify(got) === JSON.stringify(assertion.expect))
  else if (assertion.expect === 'indexed = stored') check(`POST: ${assertion.name} (${JSON.stringify(got[0])})`, got[0].indexed === got[0].stored && got[0].indexed > 0)
  else if (assertion.expect.difference !== undefined) check(`POST: ${assertion.name}`, got[0].difference === 0)
  else check(`POST: ${assertion.name} (${JSON.stringify(got[0])})`, got[0].missing === 0)
}
check('the sampled expected documents are real rows of the plan', first.summary.samples.length === 12 && first.summary.samples.every((sample) => docs.find((row) => row.id === sample.id).search_doc === sample.expected))

// ---- 2. idempotent
check('re-applying the same files writes nothing (guarded on search_doc IS NULL)', apply(db, first.dir, first.summary) === 0)
integrity(db)

// ---- 3. an edit after the export
const db2 = migratedDb()
seedProducts(db2, catalog)
const second = plan(db2, path.join(tmp, 'b'), [], 'array')
const victim = catalog.find((row) => row.id > 50000)
db2.prepare('UPDATE products SET name = ? WHERE id = ?').run(`${victim.name} Edited`, victim.id)
const guarded = apply(db2, second.dir, second.summary)
check('a row edited after the export is skipped, every other row is written', guarded === second.summary.updates - 1)
check('the edited row still has no document (never a document of the OLD text)', db2.prepare('SELECT search_doc FROM products WHERE id = ?').get(victim.id).search_doc === null)
const third = plan(db2, path.join(tmp, 'c'), [], 'rows')
check('a fresh export lists exactly that row', third.summary.rows === 1 && third.rows[0].id === victim.id)
apply(db2, third.dir, third.summary)
check('and the next run writes the document of the CURRENT text', db2.prepare('SELECT search_doc FROM products WHERE id = ?').get(victim.id).search_doc === core.docTerms({ id: victim.id, name: `${victim.name} Edited`, brand: victim.brand }))
integrity(db2)
const db3 = migratedDb()
seedProducts(db3, [victim])
db3.prepare('UPDATE products SET name = ? WHERE id = ?').run(`${victim.name} Edited`, victim.id)
db3.prepare('UPDATE products SET search_doc = ?, search_doc_version = 1 WHERE id = ? AND search_doc IS NULL').run(core.docTerms(victim), victim.id)
check('POSITIVE CONTROL: without the name/brand guard the stale document overwrites the edit', db3.prepare('SELECT search_doc FROM products WHERE id = ?').get(victim.id).search_doc === core.docTerms(victim))

// ---- 4. unsafe text, bounds, shapes
const db4 = migratedDb()
seedProducts(db4, [{ id: 1, name: 'Plain Name', brand: "L'Oréal" }, { id: 2, name: 'Line\nBreak', brand: null }, { id: 3, name: 'Quote \'s "mix"', brand: null }, { id: 4, name: 'សេរ៉ូម ឡេ', brand: null }])
const fourth = plan(db4, path.join(tmp, 'd'))
check('a name with a control character is left out and listed', fourth.summary.skipped.length === 1 && fourth.summary.skipped[0].id === 2 && fourth.summary.updates === 3)
apply(db4, fourth.dir, fourth.summary)
const four = Object.fromEntries(db4.prepare('SELECT id, search_doc FROM products').all().map((row) => [row.id, row.search_doc]))
check("quotes, Khmer and an apostrophe round-trip into the document", four[1] === core.docTerms({ name: 'Plain Name', brand: "L'Oréal" }) && four[3] === core.docTerms({ name: 'Quote \'s "mix"' }) && four[4].includes('សេរ៉ូម') && four[2] === null)
check('the one row the script skipped is the one left missing', db4.prepare(MISSING_SQL).all().map((row) => row.id).join() === '2')
const refused = spawnSync(process.execPath, [script, '--input', path.join(tmp, 'd', 'rows.json'), '--out-dir', path.join(tmp, 'e'), '--chunk', '9999'], { encoding: 'utf8' })
check('a chunk above the bound is refused', refused.status !== 0)
check('no network or wrangler use in the script', !/wrangler d1|fetch\(|child_process/.test(fs.readFileSync(script, 'utf8').replace(/^\/\/.*$/gm, '')))
check('the script file is LF-only', !fs.readFileSync(script, 'utf8').includes('\r'))

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\nPASS test-backfill-search-doc-pure (${checks} checks)`)
