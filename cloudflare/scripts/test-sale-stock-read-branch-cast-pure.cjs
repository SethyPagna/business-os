// W2-PAGES #3 (d1-money): the checkout and add-lines stock pre-reads seek branch_stock by product
// (idx_branch_stock_product_branch_unique) instead of walking the branch's whole covering index.
//
// `+branch_id = ?` takes the column's INTEGER affinity away, so a TEXT-bound id ('1') matches ZERO
// rows and every line reads "available 0", refusing every sale. The statement must therefore be
// `+branch_id = CAST(? AS INTEGER)`. This test pins: the built SQL (captured from the real route),
// its plan, a TEXT-bound id returning the same rows as an INTEGER-bound one, the 200 / 409 bodies,
// and that no bare `+branch_id = ?` exists in the route source.
//
// Run: node scripts/test-sale-stock-read-branch-cast-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const harnessFile = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const harnessSource = fs.readFileSync(harnessFile, 'utf8')
const boundary = harnessSource.indexOf(';(async () => {')
assert.ok(boundary > 0, 'test-sale-create-atomic-pure.cjs changed shape; update this harness import')
const harness = new Module(harnessFile, module)
harness.filename = harnessFile
harness.paths = module.paths
harness._compile(harnessSource.slice(0, boundary) + '\nmodule.exports={fixture,request,postSale};', harnessFile)
const h = harness.exports

const translate = (sql) => sql.replace(/@(\w+)/g, '?')
let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failed += 1; console.log(`FAIL ${name}\n      ${error && error.message}`) }
}
const STOCK_READ = /FROM branch_stock WHERE\s+\+?branch_id/i

;(async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8')
  await check('route source: every branch_stock list read uses the CAST form, none the bare +branch_id = ?', () => {
    assert.ok(!/\+branch_id\s*=\s*\?/.test(source), 'bare +branch_id = ? (TEXT-bound id would match 0 rows)')
    const casted = source.match(/FROM branch_stock WHERE \+branch_id = CAST\(\? AS INTEGER\) AND product_id IN/g) || []
    assert.equal(casted.length, 2, 'checkout and add-lines must both use the CAST form')
  })

  const f = h.fixture()
  const seen = []
  const origPrepare = f.route.prepare.bind(f.route)
  f.route.prepare = (sql) => { if (STOCK_READ.test(sql) && /product_id IN/.test(sql)) seen.push(sql); return origPrepare(sql) }
  const raw = f.raw.db

  const ok = await h.postSale(f.route, h.request('cast-ok'))
  await check('whole route: a one-line sale still completes (200)', () => assert.equal(ok.status, 200, JSON.stringify(ok.body)))
  const stockSql = seen[0]
  await check('the checkout stock read was captured from the real route', () => assert.ok(stockSql, 'no branch_stock IN read seen'))

  await check('plan seeks by product (idx_branch_stock_product_branch_unique), not the branch covering index', () => {
    const plan = raw.prepare('EXPLAIN QUERY PLAN ' + translate(stockSql)).all().map((r) => r.detail).join(' | ')
    assert.match(plan, /idx_branch_stock_product_branch_unique/, plan)
    assert.ok(!/idx_branch_stock_branch_qty_product/.test(plan), plan)
  })

  await check('TEXT-bound and INTEGER-bound branch ids return the same rows', () => {
    const asInt = raw.prepare(translate(stockSql)).all(1, 10)
    const asText = raw.prepare(translate(stockSql)).all('1', 10)
    assert.equal(asInt.length, 1)
    assert.deepEqual(asText, asInt)
    const bare = raw.prepare(translate(stockSql).replace('CAST(? AS INTEGER)', '?')).all('1', 10)
    assert.equal(bare.length, 0, 'control: the bare +branch_id form loses the conversion (this is why the CAST is required)')
  })

  await check('over-asked line: 409 with the same text, stock untouched', async () => {
    const body = h.request('cast-over')
    body.items[0].quantity = 99
    body.items[0].pricing_quote = { gross_usd: 940.5, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 940.5, total_khr: 3762000 }
    body.amount_paid_usd = 940.5
    const before = raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1').get().quantity
    const res = await h.postSale(f.route, body)
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.match(JSON.stringify(res.body), /Insufficient stock.*available 9\b/)
    assert.equal(raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1').get().quantity, before)
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
})().catch((error) => { console.error(error); process.exit(1) })
