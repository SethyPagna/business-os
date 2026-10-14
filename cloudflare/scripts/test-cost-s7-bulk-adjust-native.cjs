// Release 3, slice S7 -- the catalog-wide bulk price adjust never turns an unknown cost into a number.
// Owner rule (14 Oct 2026): "if it is none, it should also be unknown." +1 on cost leaves NULL alone and a recorded $0 is a real
// cost that skip_zero (about unset prices) does not hide. Real routes/products.ts on the full migrated schema, through the harness of
// test-product-money-write-policy-native.cjs.
//
// Run (from cloudflare/scripts): node test-cost-s7-bulk-adjust-native.cjs
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const harnessBase = fs.readFileSync(path.join(__dirname, 'test-product-money-write-policy-native.cjs'), 'utf8')
  .split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)).split(';(async () => {')[0]
if (!harnessBase.includes('const frontendWriter')) throw new Error('the harness anchors moved')
const checks = `
let failed = 0
async function check(name, fn) {
  try { await fn(); console.log('PASS ' + name) } catch (error) { failed += 1; console.log('FAIL ' + name + '\\n  ' + String(error && error.stack || error).split('\\n').slice(0, 12).join('\\n  ')) }
}
const entries = (id) => raw.prepare('SELECT * FROM product_cost_entries WHERE product_id=? ORDER BY id').all(id)
const costs = (id) => { const r = row(id); return { usd: r.cost_price_usd, khr: r.cost_price_khr } }
const seedCosted = (name, usd, khr = null) => Number(raw.prepare('INSERT INTO products(name,cost_price_usd,cost_price_khr,selling_price_usd,is_active,updated_at) VALUES(?,?,?,5,1,NULL)').run(name, usd, khr).lastInsertRowid)

;(async () => {
  // --------------------------------------------------------- bulk adjust
  await check('bulk price adjust: +1 on cost leaves an unknown cost unknown, moves a recorded 0 and a real cost (base: NULL became 1)', async () => {
    const unknown = seedCosted('S7 Bulk Unknown', null, null)
    const zero = seedCosted('S7 Bulk Zero', 0, 0)
    const real = seedCosted('S7 Bulk Real', 5, 20500)
    const knownBefore = raw.prepare('SELECT COUNT(*) n FROM products WHERE is_active=1 AND cost_price_usd IS NOT NULL').get().n
    const preview = await request(products, 'POST', '/bulk-price-adjust', { direction: 'increase', amount: 1, fields: ['cost_price_usd'], skip_zero: true, preview: true })
    assert.equal(preview.body.count, knownBefore, 'only rows with a known cost can be adjusted, a recorded 0 included even with skip_zero')
    const applied = await request(products, 'POST', '/bulk-price-adjust', { direction: 'increase', amount: 1, fields: ['cost_price_usd'], skip_zero: true, client_request_id: 's7-bulk-increase-1' })
    assert.equal(applied.status, 200, JSON.stringify(applied))
    assert.equal(costs(unknown).usd, null, 'unknown stays unknown')
    assert.equal(costs(zero).usd, 1, 'a real recorded 0 is adjusted (base: skipped by skip_zero)')
    assert.equal(costs(real).usd, 6)
    assert.equal(entries(unknown).length, 0, 'an unknown cost gets no entry')
    assert.deepEqual(entries(zero).map((entry) => [entry.cost_usd, entry.previous_cost_usd]), [[1, 0]])
    assert.deepEqual(entries(real).map((entry) => [entry.cost_usd, entry.previous_cost_usd]), [[6, 5]])
  })

  await check('bulk price adjust: -1 on cost never touches an unknown cost or pushes a 0 negative; KHR cost follows the same rule', async () => {
    const unknown = seedCosted('S7 Bulk Down Unknown', null, null)
    const zero = seedCosted('S7 Bulk Down Zero', 0, 0)
    const real = seedCosted('S7 Bulk Down Real', 5, 20500)
    const applied = await request(products, 'POST', '/bulk-price-adjust', { direction: 'decrease', amount: 1, fields: ['cost_price_usd', 'cost_price_khr'], client_request_id: 's7-bulk-decrease-1' })
    assert.equal(applied.status, 200, JSON.stringify(applied))
    assert.deepEqual(costs(unknown), { usd: null, khr: null })
    assert.deepEqual(costs(zero), { usd: 0, khr: 0 })
    assert.deepEqual(costs(real), { usd: 4, khr: 20499 })
    assert.equal(entries(unknown).length + entries(zero).length, 0)
  })

  await check('bulk price adjust: a selling price still treats a missing price as 0 (the cost rule does not leak into prices)', async () => {
    const noPrice = Number(raw.prepare('INSERT INTO products(name,selling_price_usd,is_active) VALUES(?,NULL,1)').run('S7 Bulk No Price').lastInsertRowid)
    const applied = await request(products, 'POST', '/bulk-price-adjust', { direction: 'increase', amount: 2, fields: ['selling_price_usd'], client_request_id: 's7-bulk-selling-1' })
    assert.equal(applied.status, 200, JSON.stringify(applied))
    assert.equal(row(noPrice).selling_price_usd, 2)
  })

  console.log(failed ? '\\n' + failed + ' check(s) failed' : '\\nall checks passed')
  process.exitCode = failed ? 1 : 0
})().catch((error) => { console.error(error); process.exitCode = 1 })
`
const runner = new Module(__filename, module)
runner.filename = __filename
runner.paths = module.paths
runner._compile(harnessBase + checks, __filename)
