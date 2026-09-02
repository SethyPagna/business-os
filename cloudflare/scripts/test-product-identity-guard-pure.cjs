// The ONE product identity rule on the MANUAL path: same normalized name +
// barcode + cost is the SAME product, so POST / and PUT /:id must
// refuse to mint a twin — the import path already merges such rows. Proven
// against the real migration schema with the route's own SQL, plus source
// assertions that the guard sits BEFORE the review queue and covers edits.
const fs = require('fs')
const path = require('path')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.ts'), 'utf8')

// ---- 1. The guard's SQL against the real schema ----
const sqlMatch = source.match(/`\s*\n\s*(SELECT id, name, barcode, cost_price_usd, cost_price_khr FROM products[\s\S]*?LIMIT 1)\s*\n\s*`/)
assert.ok(sqlMatch, 'products.ts still contains the identity-guard query')
const sqlite = new Database(':memory:')
for (const migration of loadAll()) sqlite.exec(migration)
sqlite.prepare(`INSERT INTO products (id, name, barcode, cost_price_usd, cost_price_khr, is_active) VALUES
  (1, 'Dior Lip Glow 001', '3348901', 5.25, 0, 1),
  (2, 'Dior Lip Glow 001', '9999999', 5.25, 0, 1),
  (3, 'Retired Twin', '3348901', 5.25, 0, 0),
  (4, 'No  Barcode', NULL, 2, 0, 1)`).run()
const run = (name, barcode, usd, khr, excludeId) => sqlite.prepare(sqlMatch[1]).get({
  nameKey: String(name).trim().replace(/\s+/g, ' ').toLowerCase(),
  barcode: String(barcode ?? '').trim(),
  costUsdCents: Math.round((Number(usd) || 0) * 100),
  costKhrCents: Math.round((Number(khr) || 0) * 100),
  excludeId,
})
assert.equal(run('Dior Lip Glow 001', '3348901', 5.25, 0, null)?.id, 1, 'same name + barcode + cost finds the twin')
assert.equal(run('  dior  lip glow 001 ', '3348901', 5.25, 0, null)?.id, 1, 'name compare is case/whitespace-insensitive')
assert.equal(run('Dior Lip Glow 001', '3348901', 6, 0, null), undefined, 'different cost is a legitimate child row')
assert.equal(run('Dior Lip Glow 001', '1234567', 5.25, 0, null), undefined, 'different barcode is a legitimate child row')
assert.equal(run('Something Else', '3348901', 5.25, 0, null), undefined, 'same barcode + different name is not this rule')
assert.equal(run('Retired Twin', '3348901', 5.25, 0, null), undefined, 'inactive products never block')
assert.equal(run('Dior Lip Glow 001', '3348901', 5.25, 0, 1), undefined, 'a product never collides with itself on edit')
assert.equal(run('No Barcode', '', 2, 0, null)?.id, 4, 'blank barcode is still an exact detail value')

// ---- 2. Wiring: both routes, guard before the review queue, no override ----
const createAt = source.indexOf("app.post('/', async (c) => {")
const createGuardAt = source.indexOf('findSameProductIdentityProduct(', createAt)
const createQueueAt = source.indexOf("actionType: 'create'", createAt)
assert.ok(createAt > 0 && createGuardAt > createAt && createQueueAt > createGuardAt,
  'create: the identity guard runs BEFORE maybeQueueForReview so reviewers never approve duplicates')
assert.match(source, /findSameProductIdentityProduct\(c\.env, nextName, nextBarcode, nextCostUsd, nextCostKhr, Number\(id\)\)/, 'edit: name/barcode/cost changes are judged too')
assert.match(source, /code: 'duplicate_product'/, 'refusal carries a machine-readable code')
assert.ok(!/confirm_duplicate/.test(source), 'no override flag: the identity rule is absolute on this path')

console.log('test-product-identity-guard-pure: all checks passed')
