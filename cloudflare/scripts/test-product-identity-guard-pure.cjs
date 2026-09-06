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
const { pickSameIdentityRow, resolveProductIdentityEdit } = loadTs('lib/productIdentity.ts', {
  './db': {},
  './sqlBinding': { buildInClause: () => ({ sql: '', params: {} }), selectInChunks: async () => [] },
  './productDetailRule': detailRule,
})
assert.equal(typeof pickSameIdentityRow, 'function', 'productIdentity must export pickSameIdentityRow')
assert.equal(typeof resolveProductIdentityEdit, 'function', 'productIdentity must export resolveProductIdentityEdit')

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

// ---- 1b. The EDIT guard asks whether the edit MOVES the row's identity ----
// DISCRIMINATING, and the reason this section exists: the guard used to run the
// lookup on every save that carried a name, barcode OR COST, and the editor
// (ProductForm.tsx / Products.tsx) posts the whole form every time. So for a
// pair that ALREADY shares an identity -- a pre-existing leading-zero twin, or
// the cost-forked siblings the Sep-4 ruling folded into one identity -- the
// lookup was a permanent yes and every ordinary save of either row came back
// 409 "Merge into it instead". For a cost-outlier pair that deadlocked outright:
// the merge tool refuses ("correct whichever figure is wrong, then merge") and
// the edit that would correct the figure was refused too.
//
// The rows below are a real twin pair (same name, '0601'/'601') and a real
// cost-forked pair (same name, same barcode, different cost).
sqlite.prepare(`INSERT INTO products (id, name, barcode, cost_price_usd, cost_price_khr, is_active) VALUES
  (10, 'Mac Lipstick 601', '0601', 6, 0, 1),
  (11, 'Mac Lipstick 601', '601', 9, 0, 1),
  (12, 'Fork Cost', '778899', 3, 0, 1),
  (13, 'Fork Cost', '778899', 12, 0, 1)`).run()

// The route, reproduced exactly: resolve the edit, and only look for a twin
// when the resolution says the identity moved.
const edit = (currentId, body) => {
  const current = sqlite.prepare('SELECT name, barcode FROM products WHERE id = ?').get(currentId)
  const resolved = resolveProductIdentityEdit(current, body)
  if (!resolved.changesIdentity) return { queried: false, duplicate: null }
  return { queried: true, duplicate: run(resolved.nextName, resolved.nextBarcode, currentId) }
}

// The whole form, unchanged identity, new selling price / cost / image.
const wholeForm = (extra) => ({ name: 'Mac Lipstick 601', barcode: '0601', ...extra })
assert.equal(edit(10, wholeForm({ selling_price_usd: 21 })).queried, false,
  'editing the selling price on one row of an EXISTING twin pair must not even ask')
assert.equal(edit(10, wholeForm({ cost_price_usd: 7.5 })).queried, false,
  'cost is not identity, so correcting a cost-outlier figure must not be refused')
assert.equal(edit(10, wholeForm({ image_path: '/img/601.jpg' })).queried, false,
  'an image edit on a twin row is not an identity change')
assert.equal(edit(13, { name: 'Fork Cost', barcode: '778899', cost_price_usd: 3 }).queried, false,
  'the cost-forked sibling can be corrected -- otherwise edit and merge deadlock')
assert.equal(edit(11, { cost_price_usd: 4 }).queried, false, 'a cost-only body never reaches the lookup')
// ...and the rule it must still enforce: moving ONTO another row's identity.
const renamed = edit(2, { name: 'Dior Lip Glow 001', barcode: '3348901' })
assert.equal(renamed.queried, true, 're-barcoding into another row IS an identity change')
assert.equal(renamed.duplicate?.id, 1, 'and the twin it would create is refused')
const zeroPadded = edit(2, { name: 'Dior Lip Glow 001', barcode: '03348901' })
assert.equal(zeroPadded.queried, true, 'a folded-equal barcode still moves this row off 9999999')
assert.equal(zeroPadded.duplicate?.id, 1, 'a leading zero does not buy a way past the guard')
const renamedIntoTwin = edit(12, { name: 'Mac Lipstick 601', barcode: '601' })
assert.equal(renamedIntoTwin.queried, true, 'renaming into an existing name+barcode is judged')
assert.ok(renamedIntoTwin.duplicate, 'and refused')
// Whitespace/case-only edits are not identity changes either.
assert.equal(edit(10, { name: '  Mac   Lipstick 601 ', barcode: '0601' }).queried, false,
  'the key is the NORMALIZED name, so re-spacing is not a move')
assert.equal(edit(10, { name: 'Mac Lipstick 601', barcode: '00601' }).queried, false,
  'and the FOLDED barcode, so adding a zero to your own code is not a move')

// POSITIVE CONTROL: the fixtures above are only meaningful if the OLD rule
// actually answers differently on them -- a test whose cases both rules pass is
// indistinguishable from a broken one. This is the pre-fix decision, written out
// (query whenever the body carries name, barcode OR cost), and it must 409 the
// very saves the assertions above let through.
const preFixEdit = (currentId, body) => {
  if (body.name === undefined && body.barcode === undefined
    && body.cost_price_usd === undefined && body.cost_price_khr === undefined) return null
  const current = sqlite.prepare('SELECT name, barcode FROM products WHERE id = ?').get(currentId)
  const nextName = body.name !== undefined ? String(body.name || '').trim() : String(current?.name || '')
  const nextBarcode = body.barcode !== undefined ? body.barcode : current?.barcode
  return run(nextName, nextBarcode, currentId)
}
assert.ok(preFixEdit(10, wholeForm({ selling_price_usd: 21 })), 'control: the old rule 409d a price edit on a twin')
assert.ok(preFixEdit(10, wholeForm({ cost_price_usd: 7.5 })), 'control: the old rule 409d the cost correction')
assert.ok(preFixEdit(13, { name: 'Fork Cost', barcode: '778899', cost_price_usd: 3 }),
  'control: the old rule 409d the cost-forked sibling, deadlocking it against the merge tool')
assert.ok(preFixEdit(11, { cost_price_usd: 4 }), 'control: the old rule even queried on a cost-only body')

// ---- 2. Wiring: both routes, guard before the review queue, no override ----
const createAt = source.indexOf("app.post('/', async (c) => {")
const createGuardAt = source.indexOf('findSameProductIdentityProduct(', createAt)
const createQueueAt = source.indexOf("actionType: 'create'", createAt)
assert.ok(createAt > 0 && createGuardAt > createAt && createQueueAt > createGuardAt,
  'create: the identity guard runs BEFORE maybeQueueForReview so reviewers never approve duplicates')
assert.match(source, /findSameProductIdentityProduct\(c\.env, nextName, nextBarcode, Number\(id\)\)/, 'edit: name/barcode changes are judged too')
// The edit guard's trigger, pinned at the source: it resolves the edit first and
// only queries when the identity actually moved, and cost is nowhere in it.
const editGuardAt = source.indexOf('const { nextName, nextBarcode, changesIdentity } = resolveProductIdentityEdit(current, body)')
assert.ok(editGuardAt > 0, 'edit: the guard resolves the edit through the shared helper')
const editTriggerAt = source.lastIndexOf('if (body.name !== undefined', editGuardAt)
const editTrigger = source.slice(editTriggerAt, editGuardAt)
assert.ok(!/cost_price_(usd|khr)/.test(editTrigger),
  'edit: cost stopped being identity on Sep 4 2026, so a cost change must not trigger the duplicate lookup')
const editLookupAt = source.indexOf('findSameProductIdentityProduct(c.env, nextName, nextBarcode, Number(id))', editGuardAt)
assert.match(source.slice(editGuardAt, editLookupAt), /if \(changesIdentity\) \{/,
  'edit: the lookup runs ONLY when the edit moves the row onto a different identity')
assert.match(source, /return pickSameIdentityRow\(rows, barcode\)/, 'the guard compares through the shared fold, not a local one')
assert.match(source, /code: 'duplicate_product'/, 'refusal carries a machine-readable code')
assert.ok(!/confirm_duplicate/.test(source), 'no override flag: the identity rule is absolute on this path')

console.log('test-product-identity-guard-pure: all checks passed')
