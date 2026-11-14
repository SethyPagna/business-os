'use strict'
// B-C7 (audit 14 Nov), products: a matched product's whole-row UPDATE (default / override modes and fill_blank) rewrote every column
// and fired three FTS triggers plus the stock-revision trigger even when the file said exactly what was stored. The UPDATE is now
// conditional on at least one written column differing (productImportChangedGuardSql), decided in SQL against the current row.
//
// This runs the REAL two UPDATE statements out of lib/importEngine.ts (extracted from the source, so they cannot drift from what
// the importer runs) against the full migration chain with every trigger live. The proofs:
//   1. an unchanged row writes nothing: sqlite changes() is 0, updated_at and the stock-revision counters do not move;
//   2. for EVERY written column, changing that one column alone does write the row (a guard that forgets a column is red);
//   3. the null-vs-blank rule, a case-only change, the purchase twin drift (healed) and the image rule.
// Mutation controls at the bottom: a guard missing a column, or comparing case-insensitively, turns a check red.
//
// Run (from cloudflare/): node scripts/test-import-unchanged-product-update-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src', 'lib')
const engineSource = fs.readFileSync(path.join(SRC, 'importEngine.ts'), 'utf8').replace(/\r\n/g, '\n')
const costMirrorSource = fs.readFileSync(path.join(SRC, 'catalogCostRecompute.ts'), 'utf8').replace(/\r\n/g, '\n')

function build(mutate = (text) => text) {
  const guardStart = engineSource.indexOf('const PRODUCT_IMPORT_TEXT_COLUMNS')
  const guardEnd = engineSource.indexOf('export const CONTACT_IMPORT_UNCHANGED_CODE')
  assert.ok(guardStart > 0 && guardEnd > guardStart, 'the guard moved')
  const mirror = /export const costMirrorSql = [^\n]+/.exec(costMirrorSource)
  assert.ok(mirror, 'costMirrorSql moved')
  const js = ts.transpileModule(`${mirror[0]}\n${mutate(engineSource.slice(guardStart, guardEnd))}\nexport { productImportChangedGuardSql }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', js)(mod.exports, mod)
  const guard = mod.exports.productImportChangedGuardSql
  const costMirrorSql = mod.exports.costMirrorSql || ((sql) => `COALESCE(${sql}, 0)`)
  const literals = [...engineSource.matchAll(/sql: `(UPDATE products SET name=@name[^`]*WHERE id=@id\$\{productImportChangedGuardSql\(Boolean\(d\.image_path\)\)\})`/g)].map((m) => m[1])
  assert.equal(literals.length, 2, 'both whole-row UPDATEs (fill_blank and the default / override path) carry the guard')
  const render = (body, d) => new Function('d', 'costMirrorSql', 'productImportChangedGuardSql', `return \`${body}\``)(d, costMirrorSql, guard)
  return { guard, render: (d) => literals.map((body) => render(body, d)) }
}

const FIELDS = {
  name: 'Lip Balm', name_normalized: 'lip balm', sku: 'LB-1', barcode: '885000000001', category: 'Care', categories: '["Care"]',
  unit: 'pcs', unit_normalized: 'pcs', description: 'Soft', brand: 'Acme', brands: '["Acme"]', brand_compact: 'acme', supplier: 'S1',
  selling_price_usd: 2.5, selling_price_khr: 10000, wholesale_price_usd: 2, wholesale_price_khr: 8000, cost_price_usd: 1.25, cost_price_khr: 5000,
  low_stock_threshold: 5, out_of_stock_threshold: 0, discount_enabled: 1, discount_type: 'percent', discount_percent: 10, discount_amount_usd: 0,
  discount_amount_khr: 0, discount_label: 'Sale', discount_badge_color: 'red', discount_starts_at: '2026-10-01', discount_ends_at: '2026-12-01',
  expiry_date: '2027-01-01', expiry_alert_days: 30, image_path: 'img/lb.jpg',
}
const STORED = { ...FIELDS, purchase_price_usd: 1.25, purchase_price_khr: 5000 }
const COLUMNS = Object.keys(STORED)

// Migrating the chain takes seconds: one database for the whole file, the product row re-seeded for every check.
const sharedRaw = openDb(loadAll({}))
function world() {
  const sql = sharedRaw.db
  sql.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  sql.exec('DELETE FROM products WHERE id = 900001')
  sql.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
  sql.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  const cols = ['id', ...COLUMNS, 'is_active', 'updated_at', 'created_at']
  sql.prepare(`INSERT INTO products (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`)
    .run({ id: 900001, ...STORED, is_active: 1, updated_at: '2026-10-10 03:00:00', created_at: '2026-10-10 03:00:00' })
  sql.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
  const read = () => sql.prepare('SELECT * FROM products WHERE id = 900001').get()
  const revisions = () => JSON.stringify(sql.prepare('SELECT entity_type, entity_key, revision FROM stock_session_revisions ORDER BY entity_type, entity_key').all())
  // The importer's statement, run for real. Returns how many rows it wrote.
  function run(statement, params) {
    const names = new Set([...statement.matchAll(/@(\w+)/g)].map((m) => m[1]))
    const bound = {}
    for (const name of names) bound[name] = params[name] ?? null
    // The importer runs product writes inside executeStockTransaction, which holds this permit for the batch.
    sql.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
    try { return Number(sql.prepare(statement).run(bound).changes) } finally { sql.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'") }
  }
  const seed = (statement) => {
    sql.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
    try { sql.exec(statement) } finally { sql.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'") }
  }
  return { sql, read, revisions, run, seed }
}
const paramsFor = (overrides = {}) => ({ ...FIELDS, id: 900001, updated_at: '2026-11-14 09:00:00', ...overrides })

let passed = 0
let quiet = false
function check(name, fn) { fn(); if (!quiet) { passed += 1; console.log(`PASS ${name}`) } }

function scenarios(build_) {
  const { render } = build_

  check('an unchanged row writes nothing: no row write, updated_at and the stock revision counters stay put (both UPDATEs)', () => {
    for (let which = 0; which < 2; which += 1) {
      const w = world()
      const beforeRow = JSON.stringify(w.read())
      const beforeRevisions = w.revisions()
      const statement = render(paramsFor())[which]
      assert.equal(w.run(statement, paramsFor()), 0, 'the guarded UPDATE matched no row')
      assert.equal(JSON.stringify(w.read()), beforeRow, 'the product row is byte for byte what it was, updated_at included')
      assert.equal(w.revisions(), beforeRevisions, 'the stock-revision trigger did not fire')
    }
  })

  check('changing any single written column alone writes the row (a guard that forgets a column is red)', () => {
    const change = (column, value) => {
      if (typeof value === 'number') return value + 1
      return `${value}-changed`
    }
    for (const column of Object.keys(FIELDS)) {
      const w = world()
      const params = paramsFor({ [column]: change(column, FIELDS[column]) })
      const statement = render(params)[1]
      const beforeRevisions = w.revisions()
      assert.equal(w.run(statement, params), 1, `${column}: a changed value is written`)
      assert.equal(w.read().updated_at, '2026-11-14 09:00:00', `${column}: updated_at moved with the write`)
      assert.notEqual(w.revisions(), beforeRevisions, `${column}: the write fired the stock-revision trigger as before`)
    }
  })

  check('null and a stored value, either way round, count as a change; the same null does not', () => {
    const w = world()
    assert.equal(w.run(render(paramsFor({ barcode: null }))[1], paramsFor({ barcode: null })), 1, 'value -> null is a write')
    const again = paramsFor({ barcode: null, updated_at: '2026-11-14 10:00:00' })
    assert.equal(w.run(render(again)[1], again), 0, 'null -> null writes nothing')
    const back = paramsFor({ updated_at: '2026-11-14 11:00:00' })
    assert.equal(w.run(render(back)[1], back), 1, 'null -> value is a write')
  })

  check('a case-only or whitespace-only change is a change', () => {
    for (const [column, value] of [['name', 'LIP BALM'], ['sku', 'lb-1'], ['brand', 'Acme '], ['category', 'care']]) {
      const w = world()
      const params = paramsFor({ [column]: value })
      assert.equal(w.run(render(params)[1], params), 1, `${column}: ${JSON.stringify(value)}`)
    }
  })

  check('a drifted purchase twin is healed by the write (cost unchanged, twin != COALESCE(cost, 0)), and a costless product with a zero twin is unchanged', () => {
    const w = world()
    w.seed('UPDATE products SET purchase_price_usd = 0 WHERE id = 900001')
    assert.equal(w.run(render(paramsFor())[1], paramsFor()), 1, 'drifted twin: written')
    assert.equal(w.read().purchase_price_usd, 1.25, 'the twin is back on the cost')
    const bare = world()
    bare.seed('UPDATE products SET cost_price_usd = NULL, cost_price_khr = NULL, purchase_price_usd = 0, purchase_price_khr = 0 WHERE id = 900001')
    const noCost = paramsFor({ cost_price_usd: null, cost_price_khr: null })
    assert.equal(bare.run(render(noCost)[1], noCost), 0, 'unknown cost with a zero twin is exactly what the UPDATE would store')
  })

  check('image_path: a row with no image in the file never touches the stored one; a row with a different image writes', () => {
    const w = world()
    const noImage = paramsFor({ image_path: null })
    assert.equal(w.run(render(noImage)[1], noImage), 0, 'no image in the file, everything else equal: no write')
    assert.equal(w.read().image_path, 'img/lb.jpg', 'the stored image is untouched')
    const sameImage = paramsFor({ image_path: 'img/lb.jpg' })
    assert.equal(w.run(render(sameImage)[1], sameImage), 0, 'same image: no write')
  })
}

scenarios(build())

// Mutation controls: each wrong guard must turn a check red.
const mutants = [
  ['the guard forgets discount_ends_at', (text) => text.replace("'discount_ends_at', ", '')],
  ['the guard forgets expiry_alert_days', (text) => text.replace(", 'expiry_alert_days'", '')],
  ['the guard forgets the purchase twin', (text) => text.replace("    `purchase_price_usd IS NOT ${costMirrorSql('@cost_price_usd')}`,\n", '')],
  ['the guard compares text case-insensitively', (text) => text.replace('COLLATE BINARY', 'COLLATE NOCASE')],
  ['the guard compares with = (null never equals null, so every nullable row looks changed)', (text) => text.replace('${column} IS NOT @${column} COLLATE BINARY', '${column} <> @${column} COLLATE BINARY')],
]
quiet = true
for (const [name, mutate] of mutants) {
  const original = engineSource.slice(engineSource.indexOf('const PRODUCT_IMPORT_TEXT_COLUMNS'), engineSource.indexOf('export const CONTACT_IMPORT_UNCHANGED_CODE'))
  assert.notEqual(mutate(original), original, `mutant anchor must match: ${name}`)
  let red = false
  try { scenarios(build(mutate)) } catch (error) {
    if (/mutant anchor|moved|carry the guard/.test(String(error && error.message))) throw error
    red = true
  }
  assert.ok(red, `mutant survived: ${name}`)
  console.log(`MUTANT killed: ${name}`)
}
console.log(`${passed} checks passed; ${mutants.length} mutants killed`)
