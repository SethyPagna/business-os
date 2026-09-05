// The ONE product identity rule on the MANUAL path: same normalized name +
// barcode is the SAME product, so POST / and PUT /:id must refuse to mint a
// twin -- the import path already merges such rows.
//
// TWO things changed here on 2026-09-06 (N15), and both are pinned below with
// the case that discriminates them:
//
//  1. COST LEFT THE GUARD. It was in the SQL, which contradicted the Sep-4
//     ruling ("so now only diffeerent barcode creates new child row... rest
//     merge") head-on: the manual form happily minted a second row for one
//     article bought at a second price -- the exact duplicate the merge tool
//     then had to clean up. This file used to assert that behaviour as
//     intended ("different cost is a legitimate child row"); it now asserts
//     the opposite, which is what the ruling says.
//  2. THE BARCODE IS COMPARED FOLDED. A code retyped with a leading zero is
//     the same code, so the guard refuses it too. The fold is NOT written in
//     SQL -- that would be a third hand-copy of a rule this codebase has
//     already been bitten by having in three disagreeing places -- so the SQL
//     narrows to the name group and lib/productIdentity.ts's pickSameIdentityRow
//     (the route's own function, loaded for real below) does the comparison.
//
// Run (from cloudflare/): node scripts/test-product-identity-guard-pure.cjs
const fs = require('fs')
const path = require('path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.ts'), 'utf8')

// ---- Load the REAL comparison the route uses ----
function loadTs(relPath, requireShim) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const mod = { exports: {} }
  const req = (id) => (requireShim && requireShim[id] !== undefined ? requireShim[id] : require(id))
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, req)
  return mod.exports
}
const detailRule = loadTs('lib/productDetailRule.ts', {})
const { pickSameIdentityRow } = loadTs('lib/productIdentity.ts', {
  './db': {},
  './sqlBinding': { buildInClause: () => ({ sql: '', params: {} }), selectInChunks: async () => [] },
  './productDetailRule': detailRule,
})
assert.equal(typeof pickSameIdentityRow, 'function', 'productIdentity must export pickSameIdentityRow')

// ---- 1. The guard's SQL against the real schema, then the real comparison ----
const sqlMatch = source.match(/`\s*\n\s*(SELECT id, name, barcode, cost_price_usd, cost_price_khr FROM products[\s\S]*?LIMIT 200)\s*\n\s*`/)
assert.ok(sqlMatch, 'products.ts still contains the identity-guard query')
assert.ok(!/ROUND\(COALESCE\(cost_price_usd/.test(sqlMatch[1]),
  'cost must NOT be part of the identity guard any more -- it stopped being identity on Sep 4 2026')

const sqlite = new Database(':memory:')
for (const migration of loadAll()) sqlite.exec(migration)
sqlite.prepare(`INSERT INTO products (id, name, barcode, cost_price_usd, cost_price_khr, is_active) VALUES
  (1, 'Dior Lip Glow 001', '3348901', 5.25, 0, 1),
  (2, 'Dior Lip Glow 001', '9999999', 5.25, 0, 1),
  (3, 'Retired Twin', '3348901', 5.25, 0, 0),
  (4, 'No  Barcode', NULL, 2, 0, 1),
  (5, 'Zero Twin', '3614274226546', 5, 0, 1),
  (6, 'Short Code', '0012', 1, 0, 1),
  (7, 'Placeholder', '0', 1, 0, 1)`).run()

// Exactly what the route does: narrow in SQL, compare with the shared fold.
const run = (name, barcode, excludeId) => pickSameIdentityRow(
  sqlite.prepare(sqlMatch[1]).all({
    nameKey: String(name).trim().replace(/\s+/g, ' ').toLowerCase(),
    excludeId,
  }),
  barcode,
)

assert.equal(run('Dior Lip Glow 001', '3348901', null)?.id, 1, 'same name + barcode finds the twin')
assert.equal(run('  dior  lip glow 001 ', '3348901', null)?.id, 1, 'name compare is case/whitespace-insensitive')
// DISCRIMINATING (this file previously asserted `undefined` for a differing
// cost): cost is no longer identity, so a second row for the same article
// bought at a second price is a duplicate the form must refuse, not a
// legitimate child row. The caller passes no cost at all any more.
assert.equal(run('Dior Lip Glow 001', '3348901', null)?.cost_price_usd, 5.25,
  'a different cost no longer forks a child row -- the twin is still found')
// DISCRIMINATING: the leading-zero twin. Pre-fix the SQL compared the raw
// barcode, so the form minted exactly the pairs N15 exists to clean up.
assert.equal(run('Zero Twin', '03614274226546', null)?.id, 5, 'a leading zero is not a different barcode')
assert.equal(run('Zero Twin', '003614274226546', null)?.id, 5, 'the fold is idempotent, so a double zero is caught too')
// NEGATIVE CONTROLS: nothing but a leading zero folds.
assert.equal(run('Dior Lip Glow 001', '1234567', null), null, 'different barcode is a legitimate child row')
assert.equal(run('Short Code', '12', null), null, 'a 2-digit survivor is too short to fold')
assert.equal(run('Placeholder', '', null), null, "the placeholder '0' never collides with an unbarcoded row")
assert.equal(run('Something Else', '3348901', null), null, 'same barcode + different name is not this rule')
assert.equal(run('Retired Twin', '3348901', null), null, 'inactive products never block')
assert.equal(run('Dior Lip Glow 001', '3348901', 1), null, 'a product never collides with itself on edit')
assert.equal(run('No Barcode', '', null)?.id, 4, 'blank barcode is still an exact detail value')

// ---- 2. Wiring: both routes, guard before the review queue, no override ----
const createAt = source.indexOf("app.post('/', async (c) => {")
const createGuardAt = source.indexOf('findSameProductIdentityProduct(', createAt)
const createQueueAt = source.indexOf("actionType: 'create'", createAt)
assert.ok(createAt > 0 && createGuardAt > createAt && createQueueAt > createGuardAt,
  'create: the identity guard runs BEFORE maybeQueueForReview so reviewers never approve duplicates')
assert.match(source, /findSameProductIdentityProduct\(c\.env, nextName, nextBarcode, Number\(id\)\)/, 'edit: name/barcode changes are judged too')
assert.match(source, /return pickSameIdentityRow\(rows, barcode\)/, 'the guard compares through the shared fold, not a local one')
assert.match(source, /code: 'duplicate_product'/, 'refusal carries a machine-readable code')
assert.ok(!/confirm_duplicate/.test(source), 'no override flag: the identity rule is absolute on this path')

console.log('test-product-identity-guard-pure: all checks passed')
