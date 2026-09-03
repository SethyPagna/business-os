// The ONE product identity rule on the MANUAL path: same normalized name +
// barcode + cost is the SAME product, so POST / and PUT /:id must
// refuse to mint a twin — the import path already merges such rows. Proven
// against the real migration schema by running the route's OWN
// findSameProductIdentityProducts (transpiled, its dependencies stubbed), plus
// source assertions that the guard sits BEFORE the review queue and covers
// edits.
//
// It runs the real function rather than string-extracting its SQL because the
// rule is no longer expressible in SQL alone: the query narrows to the name
// group and the SHARED productDetailSignature decides identity in JS. Testing
// only the SQL half would test the half that is deliberately approximate.
//
// It also pins the two things the sweep must never regress to:
//   * a LIMIT 1 that reduces N identical child rows to whichever one SQLite
//     returned first (the rows[0] defect class), and
//   * matching only products.name_key, which is lower(trim(name)) and does NOT
//     collapse internal whitespace, so a "No  Barcode" sibling goes invisible.
const fs = require('fs')
const path = require('path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const source = fs.readFileSync(path.join(SRC, 'routes', 'products.ts'), 'utf8')

// --- load the real route module with its route-level deps stubbed ----------
function loadTs(relPath, stubs) {
  const abs = path.join(SRC, relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(abs),
  })
  const permissive = () => new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'default' ? permissive() : function () { return undefined }),
    apply: () => undefined,
    construct: () => ({}),
  })
  const original = Module._load
  Module._load = (request, parent, isMain) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    if (request.startsWith('.') || request === 'hono') return permissive()
    return original.call(Module, request, parent, isMain)
  }
  const mod = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      mod.exports, require, mod, abs, path.dirname(abs),
    )
  } finally {
    Module._load = original
  }
  return mod.exports
}

class FakeHono {
  get() { return this } post() { return this } put() { return this } patch() { return this }
  delete() { return this } use() { return this } on() { return this } all() { return this }
  route() { return this } onError() { return this } notFound() { return this }
}

const d1 = openDb(loadAll())
const adapter = {
  prepare(sql) {
    const st = d1.prepare(sql)
    return { get: (p) => st.get(p || {}), all: (p) => st.all(p || {}), run: (p) => st.run(p || {}) }
  },
  batch: (stmts) => d1.batch(stmts),
}
const mod = loadTs(path.join('routes', 'products.ts'), {
  hono: { Hono: FakeHono },
  '../lib/db': { getDb: () => adapter },
  '../lib/audit': { audit: async () => {} },
  '../lib/productDetailRule': loadTs(path.join('lib', 'productDetailRule.ts'), {}),
})
const find = mod.findSameProductIdentityProducts
assert.equal(typeof find, 'function', 'products.ts must export the identity sweep')

// ---- 1. The guard against the real schema --------------------------------
// name_key is written by migration 0010's AFTER INSERT trigger, so these rows
// carry exactly the keys production carries -- including id 4's UNCOLLAPSED
// "no  barcode".
d1.db.prepare(`INSERT INTO products (id, name, barcode, cost_price_usd, cost_price_khr, is_active) VALUES
  (1, 'Dior Lip Glow 001', '3348901', 5.25, 0, 1),
  (2, 'Dior Lip Glow 001', '9999999', 5.25, 0, 1),
  (3, 'Retired Twin', '3348901', 5.25, 0, 0),
  (4, 'No  Barcode', NULL, 2, 0, 1)`).run()

const run = async (name, barcode, usd, khr, excludeId) =>
  (await find({}, name, barcode, usd, khr, excludeId))[0]

async function main() {
  assert.equal((await run('Dior Lip Glow 001', '3348901', 5.25, 0, null))?.id, 1, 'same name + barcode + cost finds the twin')
  assert.equal((await run('  dior  lip glow 001 ', '3348901', 5.25, 0, null))?.id, 1, 'name compare is case/whitespace-insensitive')
  assert.equal(await run('Dior Lip Glow 001', '3348901', 6, 0, null), undefined, 'different cost is a legitimate child row')
  assert.equal(await run('Dior Lip Glow 001', '1234567', 5.25, 0, null), undefined, 'different barcode is a legitimate child row')
  assert.equal(await run('Something Else', '3348901', 5.25, 0, null), undefined, 'same barcode + different name is not this rule')
  assert.equal(await run('Retired Twin', '3348901', 5.25, 0, null), undefined, 'inactive products never block')
  assert.equal(await run('Dior Lip Glow 001', '3348901', 5.25, 0, 1), undefined, 'a product never collides with itself on edit')
  assert.equal((await run('No Barcode', '', 2, 0, null))?.id, 4, 'blank barcode is still an exact detail value')

  // The doubled-space row, stated as its own fact: its stored name_key is
  // "no  barcode" (the trigger does not collapse), so a sweep that trusted
  // name_key alone would never see it.
  const storedKey = d1.db.prepare('SELECT name_key FROM products WHERE id = 4').get().name_key
  assert.equal(storedKey, 'no  barcode', 'migration 0010 stores lower(trim(name)), uncollapsed')
  assert.equal((await run('No Barcode', '', 2, 0, null))?.id, 4, 'and the sweep finds it anyway')

  // ---- 1b. The COST RULING on this guard ---------------------------------
  // A cost of 0/NULL is MISSING, not "a different cost". So a row typed with
  // no cost does NOT get to become a second child row beside one that already
  // carries the real cost -- they do not disagree, they are one product, and
  // the guard refuses the twin. Two costs that are BOTH set and differ stay a
  // legitimate sibling child row (asserted above with 6 vs 5.25) and are the
  // operator's to resolve in Conflicts, never this route's to fold.
  assert.equal((await run('Dior Lip Glow 001', '3348901', 0, 0, null))?.id, 1,
    'no cost typed collides with the row that has one -- missing is not different')
  assert.equal((await run('Dior Lip Glow 001', '3348901', null, null, null))?.id, 1,
    'a NULL cost is missing too')
  d1.db.prepare(`INSERT INTO products (id, name, barcode, cost_price_usd, cost_price_khr, is_active)
    VALUES (5, 'Costless Row', 'CL-1', 0, 0, 1)`).run()
  assert.equal((await run('Costless Row', 'CL-1', 7.5, 0, null))?.id, 5,
    'and the mirror case: a real cost collides with the row that has none')
  assert.equal(await run('Costless Row', 'CL-2', 7.5, 0, null), undefined,
    'the barcode is still hard identity -- the cost ruling never widens it')

  // ---- 2. EVERY child row, not the first ---------------------------------
  d1.db.prepare(`INSERT INTO products (id, name, barcode, cost_price_usd, cost_price_khr, is_active) VALUES
    (10, 'Triple Row Item', 'TRIPLE', 4, 0, 1),
    (11, 'Triple Row Item', 'TRIPLE', 4, 0, 1),
    (12, 'Triple  Row Item', 'TRIPLE', 4, 0, 1),
    (13, 'Triple Row Item', 'OTHER', 4, 0, 1)`).run()
  const twins = await find({}, 'Triple Row Item', 'TRIPLE', 4, 0, null)
  assert.deepEqual(twins.map((r) => r.id), [10, 11, 12],
    'all three identical child rows are returned (including the doubled-space one), and the different-barcode sibling is not')
  assert.equal(twins[0].id, 10, 'the offered twin is deterministic -- the lowest id, never an arbitrary row')

  // ---- 3. Wiring: both routes, guard before the review queue, no override --
  const createAt = source.indexOf("app.post('/', async (c) => {")
  const createGuardAt = source.indexOf('findSameProductIdentityProducts(', createAt)
  const createQueueAt = source.indexOf("actionType: 'create'", createAt)
  assert.ok(createAt > 0 && createGuardAt > createAt && createQueueAt > createGuardAt,
    'create: the identity guard runs BEFORE maybeQueueForReview so reviewers never approve duplicates')
  assert.match(source, /findSameProductIdentityProducts\(c\.env, nextName, nextBarcode, nextCostUsd, nextCostKhr, Number\(id\)\)/, 'edit: name/barcode/cost changes are judged too')
  assert.match(source, /code: 'duplicate_product'/, 'refusal carries a machine-readable code')
  assert.match(source, /duplicateCount: identityTwins\.length/, 'the 409 reports how many rows share the identity, not just one')
  assert.ok(!/confirm_duplicate/.test(source), 'no override flag: the identity rule is absolute on this path')

  const sweepAt = source.indexOf('export async function findSameProductIdentityProducts')
  const sweep = source.slice(sweepAt, sweepAt + 1400)
  assert.ok(!/LIMIT 1/.test(sweep), 'a LIMIT 1 here is the rows[0] defect, not the fix')
  assert.match(sweep, /ORDER BY id ASC/)
  assert.match(sweep, /detailsMergeCompatible\(details, row\)/,
    'identity is decided by the SHARED rule (productDetailRule.ts), never re-spelled in SQL')
  assert.match(sweep, /normalizeProductGroupName\(row\.name\) === nameKey/)
  assert.ok(!/ROUND\(COALESCE\(cost_price/.test(sweep),
    'the cost comparison must not be re-spelled in SQL -- that is the copy that drifts')

  console.log('test-product-identity-guard-pure: all checks passed')
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
