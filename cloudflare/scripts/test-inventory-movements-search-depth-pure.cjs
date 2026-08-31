// Lock for the depth-100 fix on GET /api/inventory/movements search.
//
// The movement-log search wrapped each of five columns in
// normalizedHaystackSql's default ~78-level diacritic REPLACE chain, ORed the
// five, and ANDed across up to eight words -- an expression tree measured near
// D1's hard depth-100 statement limit (SQLITE_TOOBIG), the class of failure
// migration 0037/0082 fixed elsewhere. It was rewritten to mirror
// buildSalesSearchWhere: ONE shallow concatenated haystack + buildLikeAliasClause
// with alreadyNormalizedCols=true (no REPLACE chain), matching words
// independently.
//
// This test loads the REAL searchMatch.ts, rebuilds the movement search WHERE
// exactly as the route does, and proves (a) the new clause contains ZERO
// diacritic REPLACE() calls while the OLD shape contained hundreds, and (b) the
// new clause still matches the right rows -- case-insensitively, multi-word
// (AND), and per-word (OR) -- against a real inventory_movements table.
//
// Run (from cloudflare/): node scripts/test-inventory-movements-search-depth-pure.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const ts = require('typescript')
const Database = require('better-sqlite3')

// Load the real, self-contained searchMatch.ts.
const smSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'searchMatch.ts'), 'utf8')
const smOut = ts.transpileModule(smSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const smMod = { exports: {} }
new Function('exports', 'require', 'module', smOut)(smMod.exports, require, smMod)
const { buildLikeAliasClause, tokenizeSearchWords, normalizedHaystackSql } = smMod.exports

// The exact haystack the route builds.
const HAYSTACK = `(
  COALESCE(product_name, '') || ' ' || COALESCE(branch_name, '') || ' ' ||
  COALESCE(user_name, '') || ' ' || COALESCE(movement_type, '') || ' ' ||
  COALESCE(reason, '')
)`

// Rebuild the movement search WHERE the way routes/inventory.ts does now.
function buildMovementWhere(raw, mode) {
  const terms = tokenizeSearchWords(raw, 8)
  const params = {}
  const termClauses = terms.map((term, index) => buildLikeAliasClause(term, [HAYSTACK], params, `search${index}`, true))
  return { where: `(${termClauses.join(` ${mode} `)})`, params, termCount: terms.length }
}

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }

// (a) Depth: the new clause has no diacritic REPLACE chain; the old shape had many.
{
  const worst = buildMovementWhere('crème brulee vanilla latte foam art cup lid', 'AND') // 8 words
  const replaceCount = (worst.where.match(/replace\(/gi) || []).length
  check('new movement search clause contains ZERO diacritic replace() calls', replaceCount === 0)

  // The OLD shape: five columns each deep-folded, per word. Count its replace()s
  // to show the contrast that made it a depth-100 risk.
  const cols = ["COALESCE(product_name,'')", "COALESCE(branch_name,'')", "COALESCE(user_name,'')", "COALESCE(movement_type,'')", "COALESCE(reason,'')"]
  const oldOneColOneWord = normalizedHaystackSql(cols[0]) // default (deep) fold
  const perColReplace = (oldOneColOneWord.match(/replace\(/gi) || []).length
  check('the OLD per-column deep fold really did nest dozens of replace() (~70+)', perColReplace >= 60)
  check('OLD shape total replace() (5 cols x 8 words) was in the hundreds', perColReplace * 5 * 8 >= 2000)
}

// (b) Correctness: the new clause matches the right rows.
{
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE inventory_movements (
    id INTEGER PRIMARY KEY, product_name TEXT, branch_name TEXT, user_name TEXT,
    movement_type TEXT, reason TEXT
  )`)
  const rows = [
    [1, 'Real Techniques Sponge', 'Shop', 'admin', 'transfer_out', 'to Warehouse'],
    [2, 'Morphe Concealer', 'Warehouse', 'dara', 'adjust', 'stock count'],
    [3, 'Vanilla Lip Balm', 'Shop', 'sophea', 'sale', 'POS sale'],
    [4, 'Real Deal Serum', 'Shop', 'admin', 'adjust', 'damaged'],
  ]
  const ins = db.prepare('INSERT INTO inventory_movements VALUES (?,?,?,?,?,?)')
  for (const r of rows) ins.run(...r)

  const run = (raw, mode) => {
    const { where, params } = buildMovementWhere(raw, mode)
    return db.prepare(`SELECT id FROM inventory_movements WHERE ${where} ORDER BY id`).all(params).map((r) => r.id)
  }

  check('case-insensitive single word matches (REAL -> ids 1,4)', JSON.stringify(run('REAL', 'AND')) === JSON.stringify([1, 4]))
  check('multi-word AND matches across fields (real techniques -> id 1 only)', JSON.stringify(run('real techniques', 'AND')) === JSON.stringify([1]))
  check('OR mode broadens (morphe vanilla -> ids 2,3)', JSON.stringify(run('morphe vanilla', 'OR')) === JSON.stringify([2, 3]))
  check('matches a movement_type token (adjust -> ids 2,4)', JSON.stringify(run('adjust', 'AND')) === JSON.stringify([2, 4]))
  check('matches a reason token (damaged -> id 4)', JSON.stringify(run('damaged', 'AND')) === JSON.stringify([4]))
  check('a term matching nothing returns nothing', JSON.stringify(run('nonexistentxyz', 'AND')) === JSON.stringify([]))
}

// (c) Source lock: the route uses the shallow, single-haystack form.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'inventory.ts'), 'utf8')
  check('inventory.ts movement search uses buildLikeAliasClause with a single haystack', /buildLikeAliasClause\(term, \[movementHaystack\], params, `search\$\{index\}`, true\)/.test(src))
  check('inventory.ts no longer builds five per-column normalizedHaystackSql folds for movements', !/const productNameSql = normalizedHaystackSql\("COALESCE\(product_name/.test(src))
}

console.log(`\nALL ${passed} CHECKS PASSED`)
