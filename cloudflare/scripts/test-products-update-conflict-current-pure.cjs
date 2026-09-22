// The product write-conflict answer names the product.
//
// Owner report, 22 Sep 2026: every product edit from the phone met "Product
// changed on another device" with "Current saved details: UPDATED AT
// 2026-09-22T06:33:25.086Z" -- a raw timestamp and nothing else, because the
// PUT /products/:id conflict pre-read selected only `updated_at`, so the
// generic dialog had nothing better to show. The client half of that report
// (the token itself came from a days-old local mirror) is pinned by
// frontend/tests/productWriteConflictToken.test.ts; this file pins the Worker
// half: the pre-read carries id, name, barcode and updated_at, that row is the
// one handed to assertUpdatedAtMatch, and the 409 body's `current` is that
// row. conflictControl.ts is pure and is executed verbatim; the route is
// pinned at source with a negative control (the old one-column SELECT must
// fail the same check).
//
// Run (from cloudflare/): node scripts/test-products-update-conflict-current-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

let passed = 0
const check = (name, fn) => { fn(); console.log('PASS', name); passed += 1 }

const control = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'conflictControl.ts'), 'utf8')
const compiled = ts.transpileModule(control, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const mod = { exports: {} }
new Function('exports', 'require', 'module', compiled)(mod.exports, require, mod)
const { assertUpdatedAtMatch, writeConflictResponse, WriteConflictError } = mod.exports

const ROW = { id: 2154, name: 'Abercrombie Fierce Cologne 100ml', barcode: '085715160002', updated_at: '2026-09-22T06:33:25.086Z' }
const STALE = '2026-09-16T12:10:41.000Z'

check('a stale token is refused with the product row as `current`', () => {
  let error = null
  try { assertUpdatedAtMatch('product', ROW, STALE) } catch (e) { error = e }
  assert.ok(error instanceof WriteConflictError, 'WriteConflictError expected')
  const { body, status } = writeConflictResponse(error)
  assert.equal(status, 409)
  assert.equal(body.code, 'write_conflict')
  assert.equal(body.entity, 'product')
  assert.equal(body.reason, 'updated')
  assert.equal(body.expectedUpdatedAt, STALE)
  assert.equal(body.actualUpdatedAt, ROW.updated_at)
  assert.deepEqual(body.current, ROW, 'the dialog receives name and barcode, not only the timestamp')
})

check('the matching token passes, and no token skips the guard', () => {
  assertUpdatedAtMatch('product', ROW, ROW.updated_at)
  assertUpdatedAtMatch('product', ROW, `  ${ROW.updated_at}  `)
  assertUpdatedAtMatch('product', ROW, undefined)
  assertUpdatedAtMatch('product', ROW, '')
})

check('a token against a missing row is a `deleted` conflict', () => {
  let error = null
  try { assertUpdatedAtMatch('product', null, STALE) } catch (e) { error = e }
  assert.ok(error instanceof WriteConflictError)
  assert.equal(error.reason, 'deleted')
  assert.equal(writeConflictResponse(error).body.current, null)
})

const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.ts'), 'utf8')
const PRE_READ = "SELECT id, name, barcode, updated_at FROM products WHERE id = @id"
function pinsConflictPreRead(source) {
  const at = source.indexOf('const expectedProductUpdatedAt = getExpectedUpdatedAt(body)')
  if (at < 0) return false
  const block = source.slice(at, source.indexOf('prepareProductMoneyWrite(c.env, body', at))
  return block.includes(PRE_READ)
    && /assertUpdatedAtMatch\('product', currentForConflict, expectedProductUpdatedAt\)/.test(block)
    && /writeConflictResponse\(error\)/.test(block)
}

check('PUT /products/:id pre-reads id, name, barcode and updated_at for the conflict answer', () => {
  assert.ok(pinsConflictPreRead(route))
})

check('negative control: the old one-column pre-read fails the same pin', () => {
  const old = route.replace(PRE_READ, 'SELECT updated_at FROM products WHERE id = @id')
  assert.notEqual(old, route, 'the replacement must change the source')
  assert.equal(pinsConflictPreRead(old), false)
})

check('no cost column reaches the conflict answer', () => {
  assert.ok(!/SELECT[^\n]*cost_price[^\n]*FROM products WHERE id = @id'\)\s*\n\s*\.get<[^\n]*>\(\{ id \}\)\s*\n\s*try \{\s*\n\s*assertUpdatedAtMatch\('product'/.test(route))
  assert.ok(!Object.keys(ROW).some((key) => key.includes('cost')))
})

console.log(`${passed} checks passed`)
