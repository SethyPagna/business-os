// The ONE product identity rule on the MANUAL path (Aug 28): same name +
// same non-empty barcode is the SAME product, so POST / and PUT /:id must
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
const sqlMatch = source.match(/`\s*\n\s*(SELECT id, name, barcode FROM products[\s\S]*?LIMIT 1)\s*\n\s*`/)
assert.ok(sqlMatch, 'products.ts still contains the identity-guard query')
const sqlite = new Database(':memory:')
for (const migration of loadAll()) sqlite.exec(migration)
sqlite.prepare(`INSERT INTO products (id, name, barcode, is_active) VALUES
  (1, 'Dior Lip Glow 001', '3348901', 1),
  (2, 'Dior Lip Glow 001', '9999999', 1),
  (3, 'Retired Twin', '3348901', 0)`).run()
const run = (name, barcode, excludeId) => sqlite.prepare(
  sqlMatch[1].replace(/@(\w+)/g, (_, key) => ({ name: `'${name}'`, barcode: `'${barcode}'`, excludeId: excludeId == null ? 'NULL' : String(excludeId) })[key]),
).get()
assert.equal(run('Dior Lip Glow 001', '3348901', null)?.id, 1, 'same name + same barcode finds the twin')
assert.equal(run('  dior lip glow 001 ', '3348901', null)?.id, 1, 'name compare is case/trim-insensitive')
assert.equal(run('Dior Lip Glow 001', '1234567', null), undefined, 'same name + DIFFERENT barcode is a legitimate child row')
assert.equal(run('Something Else', '3348901', null), undefined, 'same barcode + different name is not this rule')
assert.equal(run('Retired Twin', '3348901', null), undefined, 'inactive products never block')
assert.equal(run('Dior Lip Glow 001', '3348901', 1), undefined, 'a product never collides with itself on edit')

// ---- 2. Wiring: both routes, guard before the review queue, no override ----
const createAt = source.indexOf("app.post('/', async (c) => {")
const createGuardAt = source.indexOf('findSameNameBarcodeProduct(c.env, name, body.barcode, null)')
const createQueueAt = source.indexOf("actionType: 'create'", createAt)
assert.ok(createAt > 0 && createGuardAt > createAt && createQueueAt > createGuardAt,
  'create: the identity guard runs BEFORE maybeQueueForReview so reviewers never approve duplicates')
assert.match(source, /findSameNameBarcodeProduct\(c\.env, nextName, nextBarcode, Number\(id\)\)/, 'edit: renames/re-barcodes are judged too')
assert.match(source, /code: 'duplicate_product'/, 'refusal carries a machine-readable code')
assert.ok(!/confirm_duplicate/.test(source), 'no override flag: the identity rule is absolute on this path')

console.log('test-product-identity-guard-pure: all checks passed')
