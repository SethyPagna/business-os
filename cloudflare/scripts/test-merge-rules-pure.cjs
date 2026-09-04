// S4-29: the shop owner's four merge rulings (Sep 4 2026), pinned as tests.
//
//   1. Same name, BOTH rows with no barcode -> merge (costs average as usual).
//   2. Barcodes differing ONLY by leading zeros -> the same barcode, so merge.
//      Narrow: '01234'/'1234' merge, '1234'/'12345' must NOT.
//   3. Cost merges by AVERAGING the distinct costs (already pinned by
//      test-import-engine-pure.cjs and frontend/tests/mergedCostRule.test.ts).
//   4. Selling price and special/VIP price take the MAXIMUM, not the average.
//   5. `Ysl New Item` (id 10185) is a placeholder to DELETE, not to merge --
//      migration 0112, exercised at the bottom of this file by loading the
//      real .sql BY FILENAME and running it against in-memory SQLite.
//
// This loads the REAL lib/productIdentity.ts and lib/productDetailRule.ts
// transpiled, and runs findDuplicateProductGroups against a real migrated
// in-memory SQLite, so the grouping is exactly production's.
//
// Run (from cloudflare/): node scripts/test-merge-rules-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks++
  console.log(`  ok  ${label}`)
}

function loadTs(relPath, requireShim) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const mod = { exports: {} }
  const req = (id) => (requireShim && requireShim[id] !== undefined ? requireShim[id] : require(id))
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, req)
  return mod.exports
}

const detailRule = loadTs('lib/productDetailRule.ts', {})
const identity = loadTs('lib/productIdentity.ts', {
  './db': {},
  './sqlBinding': { buildInClause: () => ({ sql: '', params: {} }), selectInChunks: async () => [] },
  './productDetailRule': detailRule,
})
const { normalizeLeadingZeroBarcodeForCleanup: fold, findDuplicateProductGroups } = identity
const { resolveMergedPricing, resolveMergedCost, productIdentitySignature } = detailRule

// ---------------------------------------------------------------------------
// Ruling 2 -- leading zeros. The MERGE cases.
// ---------------------------------------------------------------------------
check("'01234' folds to '1234'", fold('01234') === '1234')
check("one extra leading zero on a real barcode folds", fold('03614274226546') === '3614274226546')
check("the already-clean barcode is unchanged by the fold", fold('3614274226546') === '3614274226546')
check("a leading-zero pair therefore lands on the SAME key",
  fold('020130264999995') === fold('20130264999995'))

// The bug this lane fixes: stripping EXACTLY ONE zero moved both sides of a
// pair in lockstep, so a double-zero typo never met its clean twin. Three such
// pairs exist in production (Charlotte Tilbury 08339327539/008339327539,
// Colgate 035000463760/0035000463760, Maybelline 041554582277/0041554582277).
check("a DOUBLE leading zero folds onto its single-zero twin",
  fold('008339327539') === fold('08339327539'))
check("...and onto the fully clean form too",
  fold('008339327539') === '8339327539')
check('the fold is idempotent -- folding a folded code changes nothing',
  fold(fold('0035000463760')) === fold('0035000463760'))

// ---------------------------------------------------------------------------
// Ruling 2 -- the NON-merge cases. This rule is narrow on purpose.
// ---------------------------------------------------------------------------
check("'1234' and '12345' must NEVER fold together -- a length difference is "
  + 'a different article, not a leading-zero typo', fold('1234') !== fold('12345'))
check("'1234' is left exactly as it is", fold('1234') === '1234')
check("'12345' is left exactly as it is", fold('12345') === '12345')
check('a trailing zero is not a leading zero', fold('12340') === '12340')
check('an interior zero is untouched', fold('12034') === '12034')
check("placeholder '0' never collapses to a blank barcode -- that would make it "
  + 'collide with every unbarcoded row in its name group', fold('0') === '0')
check('an all-zero code stays exactly as it is', fold('00000') === '00000')
// The MAC shade codes used to be the boundary the 4-digit bound existed to
// hold ('0601' kept its zero because only three digits would survive). The
// owner ruled on 2026-09-04 that those five pairs -- 601, 617, 666, 689, 691
// -- are one product entered twice and must merge, so the bound is 3 and they
// now fold. Measured against production first: the ten MAC rows are the ONLY
// numeric barcodes in the catalogue whose zero-stripped form is three digits,
// so this admits exactly what the owner asked for and nothing else.
check("the MAC shade codes now fold: '0601' strips to '601'", fold('0601') === '601')
check("...so '0601' and '601' land on the SAME key", fold('0601') === fold('601'))
check("the other four shade pairs fold too",
  fold('0617') === fold('617') && fold('0666') === fold('666')
  && fold('0689') === fold('689') && fold('0691') === fold('691'))
check("a 2-digit survivor is still too short to fold -- '0012' keeps its zeros",
  fold('0012') === '0012' && fold('0012') !== fold('12'))
check('a non-numeric code keeps its leading zero (an alphanumeric SKU zero is '
  + 'not a GTIN artefact)', fold('0abc123') === '0abc123')
check('a blank barcode folds to blank', fold('') === '' && fold(null) === '')
check('the fold trims and lowercases like every other barcode normalizer',
  fold('  03614274226546  ') === '3614274226546')

// ---------------------------------------------------------------------------
// Ruling 4 -- selling and wholesale price take the MAXIMUM.
// ---------------------------------------------------------------------------
// The discounted tier is `wholesale_price_usd`/`wholesale_price_khr`. It used
// to be `special_price_*`; migration 0111 moved the numbers and zeroed the old
// pair, and S4-32 moved this rule with them -- while the field list still said
// special_price_* the merge resolved max(0, 0) and a folded-away duplicate's
// wholesale price left the catalogue silently.
const maxed = resolveMergedPricing([
  { selling_price_usd: 12, wholesale_price_usd: 9, selling_price_khr: 40000 },
  { selling_price_usd: 15, wholesale_price_usd: 7, selling_price_khr: 38000 },
])
check('selling price takes the maximum, never the average', maxed.selling_price_usd === 15)
check('wholesale price takes the maximum too', maxed.wholesale_price_usd === 9)
check('KHR selling price is resolved independently', maxed.selling_price_khr === 40000)
check('each field picks its own best row -- the higher selling price and the '
  + 'higher wholesale price can come from different rows',
  maxed.selling_price_usd === 15 && maxed.wholesale_price_usd === 9)
check('a field no row carried is omitted rather than zeroed',
  !('wholesale_price_khr' in maxed))
check('the retired special_price_* pair is never resolved or emitted again',
  !('special_price_usd' in resolveMergedPricing([{ special_price_usd: 9 }, { special_price_usd: 7 }])))
check('price is NOT averaged (the deliberate contrast with cost)',
  maxed.selling_price_usd !== 13.5)

// Cost, by contrast, averages the DISTINCT values -- ruling 3.
const averaged = resolveMergedCost([{ cost_price_usd: 10 }, { cost_price_usd: 15 }])
check('cost averages while price maximises -- the two rules must not converge',
  averaged.cost_price_usd === 12.5)

// The real category-A pair, ids 9809/9810 (SK-II Facial Treatment Essence).
const skii = resolveMergedCost([
  { cost_price_usd: 130.541696 },
  { cost_price_usd: 130.777307 },
])
check('the real SK-II no-barcode pair averages to 130.6596 (rounded UP to 4dp)',
  skii.cost_price_usd === 130.6596)

// ---------------------------------------------------------------------------
// Ruling 1 -- same name, BOTH barcodes empty, merges.
// ---------------------------------------------------------------------------
check('two same-name rows with no barcode share one identity signature',
  productIdentitySignature({ name: 'SK-II Facial Treatment Essence 230mL', barcode: null })
  === productIdentitySignature({ name: 'SK-II Facial Treatment Essence 230mL', barcode: '' }))
check('a same-name row WITH a barcode is still a separate child row -- the owner '
  + 'authorised merging two UNbarcoded rows, not absorbing an unbarcoded row '
  + 'into a barcoded one',
  productIdentitySignature({ name: 'Thing', barcode: '' })
  !== productIdentitySignature({ name: 'Thing', barcode: '5012345678900' }))

async function run() {
  // --- the grouping, against a real migrated DB --------------------------
  const db = openDb(loadAll())
  const products = [
    // Ruling 1: both unbarcoded, same name -> auto-mergeable.
    { id: 10, name: 'No Barcode Twin', barcode: null },
    { id: 11, name: 'No Barcode Twin', barcode: '' },
    // Ruling 1's boundary: one barcoded, one not -> NOT auto-mergeable.
    { id: 20, name: 'Half Barcoded', barcode: null },
    { id: 21, name: 'Half Barcoded', barcode: '5012345678900' },
    // Ruling 2: single extra leading zero -> auto-mergeable, clean row keeps.
    { id: 30, name: 'Zero Twin', barcode: '03614274226546' },
    { id: 31, name: 'Zero Twin', barcode: '3614274226546' },
    // Ruling 2: DOUBLE leading zero vs single -> must also merge (the fix).
    { id: 40, name: 'Double Zero Twin', barcode: '008339327539' },
    { id: 41, name: 'Double Zero Twin', barcode: '08339327539' },
    // Ruling 2's boundary: a length difference is NOT a leading-zero typo.
    { id: 50, name: 'Length Twin', barcode: '1234' },
    { id: 51, name: 'Length Twin', barcode: '12345' },
    // Ruling 2 (owner ruling, 2026-09-04): the MAC shade codes merge after all.
    { id: 60, name: 'Mac Matte Lipstick No Box 601', barcode: '0601' },
    { id: 61, name: 'Mac Matte Lipstick No Box 601', barcode: '601' },
    // Ruling 2's boundary, moved down with it: a 2-digit survivor is still too
    // short to fold, so a placeholder pair like this stays for manual review.
    { id: 70, name: 'Two Digit Twin', barcode: '0012' },
    { id: 71, name: 'Two Digit Twin', barcode: '12' },
  ]
  for (const p of products) {
    await db.prepare('INSERT INTO products (id, name, barcode, is_active, is_group) VALUES (@id, @name, @barcode, 1, 0)')
      .run({ id: p.id, name: p.name, barcode: p.barcode })
  }
  await db.prepare("INSERT INTO branches (id, name, is_active) VALUES (1, 'Main', 1)").run({})

  const groups = await findDuplicateProductGroups(db)
  const idsIn = (g) => [g.canonical.id, ...g.duplicates.map((d) => d.id)].sort((a, b) => a - b).join(',')
  const groupFor = (ids) => groups.find((g) => idsIn(g) === ids)

  check('RULING 1: two same-name rows with NO barcode are proposed as one merge',
    !!groupFor('10,11'))
  check('RULING 1 boundary: an unbarcoded row is NOT merged into a barcoded '
    + 'sibling of the same name', !groupFor('20,21'))
  check('RULING 2: a single extra leading zero is proposed as one merge',
    !!groupFor('30,31'))
  check('RULING 2: the CLEAN barcode row survives, so no barcode is ever '
    + 'rewritten and no code can collide with a live one',
    groupFor('30,31')?.canonical.id === 31)
  check('RULING 2 (the fix): a DOUBLE leading zero merges with its single-zero '
    + 'twin -- this was impossible before, both sides moved in lockstep',
    !!groupFor('40,41'))
  check('RULING 2 (the fix): the cleaner of the two zero-prefixed rows survives',
    groupFor('40,41')?.canonical.id === 41)
  check("RULING 2 boundary: '1234' and '12345' are NOT proposed for merge",
    !groupFor('50,51'))
  check("OWNER RULING 2026-09-04: the MAC shade codes '0601'/'601' now ARE "
    + 'auto-merged -- the fold bound moved from 4 surviving digits to 3',
    !!groupFor('60,61'))
  check('...and the CLEAN 3-digit row survives, so no barcode is rewritten',
    groupFor('60,61')?.canonical.id === 61)
  check("RULING 2 boundary: a 2-digit survivor still does NOT fold ('0012' vs '12')",
    !groupFor('70,71'))

  // --- Ruling 5: migration 0112, loaded BY FILENAME and actually run -----
  const migrationsDir = path.join(__dirname, '..', 'migrations')
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
  const target = '0112_delete_ysl_new_item_placeholder.sql'
  check('migration 0112 exists under the expected filename', files.includes(target))
  const migrationSql = fs.readFileSync(path.join(migrationsDir, target), 'utf8')

  // Build a DB with every migration UP TO but excluding 0112, seed the real
  // placeholder shape, then run 0112 itself and assert on the result.
  function dbUpTo0112() {
    const raw = new DatabaseSync(':memory:')
    raw.exec('PRAGMA foreign_keys = OFF;')
    for (const f of files) {
      if (f === target) continue
      raw.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
    }
    return raw
  }
  function seedPlaceholder(raw, overrides = {}) {
    const row = { name: 'Ysl New Item', barcode: null, cost: 0, ...overrides }
    raw.exec("INSERT INTO branches (id, name, is_active) VALUES (1, 'Main', 1), (2, 'Two', 1)")
    raw.prepare('INSERT INTO products (id, name, barcode, cost_price_usd, cost_price_khr, is_active, is_group) VALUES (10185, ?, ?, ?, 0, 1, 0)')
      .run(row.name, row.barcode, row.cost)
    raw.exec('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10185, 1, 0), (10185, 2, 0)')
    raw.exec("INSERT INTO product_batches (id, variant_product_id, batch_key) VALUES (55409, 10185, 'latest-data-20260902-v1:08ce80a181e805318b28')")
    raw.exec('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (55409, 1, 0), (55409, 2, 0)')
    return raw
  }
  const countIn = (raw, sql) => raw.prepare(sql).get().n

  // (a) the happy path -- the placeholder and its empty scaffolding all go.
  {
    const raw = seedPlaceholder(dbUpTo0112())
    check('0112 precondition: the placeholder is present before the migration',
      countIn(raw, 'SELECT COUNT(*) AS n FROM products WHERE id = 10185') === 1)
    raw.exec(migrationSql)
    check('0112 deletes the Ysl New Item product row',
      countIn(raw, 'SELECT COUNT(*) AS n FROM products WHERE id = 10185') === 0)
    check('0112 leaves no orphaned branch_stock behind',
      countIn(raw, 'SELECT COUNT(*) AS n FROM branch_stock WHERE product_id = 10185') === 0)
    check('0112 leaves no orphaned product_batches behind',
      countIn(raw, 'SELECT COUNT(*) AS n FROM product_batches WHERE variant_product_id = 10185') === 0)
    check('0112 leaves no orphaned branch_batch_stock behind',
      countIn(raw, 'SELECT COUNT(*) AS n FROM branch_batch_stock WHERE batch_id = 55409') === 0)
    raw.exec(migrationSql)
    check('0112 is idempotent -- running it twice is harmless',
      countIn(raw, 'SELECT COUNT(*) AS n FROM products WHERE id = 10185') === 0)
  }

  // (b) a database that never had the row at all -- the pure-test harness
  // replays every migration, so 0112 must be a clean no-op.
  {
    const raw = dbUpTo0112()
    raw.exec(migrationSql)
    check('0112 is a no-op on a database with no product 10185',
      countIn(raw, 'SELECT COUNT(*) AS n FROM products WHERE id = 10185') === 0)
  }

  // (c) the guards. If id 10185 is not still exactly that placeholder, or has
  // acquired history or stock, the migration must destroy nothing.
  {
    const raw = seedPlaceholder(dbUpTo0112(), { name: 'Something Real' })
    raw.exec(migrationSql)
    check('0112 refuses to delete when the id has been reused under another name',
      countIn(raw, 'SELECT COUNT(*) AS n FROM products WHERE id = 10185') === 1)
  }
  {
    const raw = seedPlaceholder(dbUpTo0112(), { cost: 12.5 })
    raw.exec(migrationSql)
    check('0112 refuses to delete once the row has a real cost',
      countIn(raw, 'SELECT COUNT(*) AS n FROM products WHERE id = 10185') === 1)
  }
  {
    const raw = seedPlaceholder(dbUpTo0112(), { barcode: '5012345678900' })
    raw.exec(migrationSql)
    check('0112 refuses to delete once the row has a barcode',
      countIn(raw, 'SELECT COUNT(*) AS n FROM products WHERE id = 10185') === 1)
  }
  {
    const raw = seedPlaceholder(dbUpTo0112())
    raw.exec('UPDATE branch_stock SET quantity = 3 WHERE product_id = 10185 AND branch_id = 1')
    raw.exec(migrationSql)
    check('0112 refuses to delete once the row holds real stock',
      countIn(raw, 'SELECT COUNT(*) AS n FROM products WHERE id = 10185') === 1)
    check('...and leaves that stock exactly where it was',
      countIn(raw, 'SELECT COALESCE(SUM(quantity), 0) AS n FROM branch_stock WHERE product_id = 10185') === 3)
  }
  {
    const raw = seedPlaceholder(dbUpTo0112())
    raw.exec('INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity) '
      + "VALUES (10185, 'Ysl New Item', 1, 'adjustment', 1)")
    raw.exec(migrationSql)
    check('0112 refuses to delete once the row has movement history',
      countIn(raw, 'SELECT COUNT(*) AS n FROM products WHERE id = 10185') === 1)
  }

  console.log(`\n${checks} checks passed`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
