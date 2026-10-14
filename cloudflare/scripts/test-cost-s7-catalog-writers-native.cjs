// Release 3, slice S7 -- the catalog writers never turn a missing cost into 0.
// Owner rule (14 Oct 2026, verbatim): "if cost is 0$ then it is 0 for loss. if it is none, it should also be unknown.
// flag it. for all unknown. add in conflicts. conflicts for empty barcode as well."
//
//   a typed 0 is a recorded $0 (and keeps its product_cost_entries row, the proof);
//   a cleared or absent cost is NULL and has NO cost entry.
//
// Real Hono routes/products.ts, real lib/productWrites.ts, catalogCostRecompute.ts, createFold.ts, reviewApply.ts and the
// review queue on the full migrated SQLite schema, through the harness of test-product-money-write-policy-native.cjs
// (everything above its first check). Each case names the base behaviour it replaces.
//
// Run (from cloudflare/scripts): node test-cost-s7-catalog-writers-native.cjs
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
const overrideAudit = (id) => raw.prepare("SELECT * FROM audit_logs WHERE action='cost_override' AND entity_id=? ORDER BY id").all(String(id))
const costs = (id) => { const r = row(id); return { usd: r.cost_price_usd, khr: r.cost_price_khr } }
const seedCosted = (name, usd, khr = null) => Number(raw.prepare('INSERT INTO products(name,cost_price_usd,cost_price_khr,selling_price_usd,is_active,updated_at) VALUES(?,?,?,5,1,NULL)').run(name, usd, khr).lastInsertRowid)
const productColumns = () => new Set(raw.prepare('PRAGMA table_info(products)').all().map((column) => column.name))

;(async () => {
  // ---------------------------------------------------------------- creates
  await check('POST a product with no cost -> BOTH cost columns NULL (base: the DEFAULT 0 of the omitted column)', async () => {
    const created = await request(products, 'POST', '/', { name: 'S7 No Cost', barcode: '9807000000011', selling_price_usd: 4 })
    assert.equal(created.status, 200, JSON.stringify(created))
    assert.deepEqual(costs(created.body.id), { usd: null, khr: null })
    assert.equal(entries(created.body.id).length, 0, 'creating without a cost records no cost entry')
  })

  await check('POST with only a USD cost leaves KHR unknown; a typed 0 is a recorded 0; a blank string is unknown', async () => {
    const usdOnly = await request(products, 'POST', '/', { name: 'S7 Usd Only', barcode: '9807000000028', cost_price_usd: 3.5, selling_price_usd: 4 })
    assert.deepEqual(costs(usdOnly.body.id), { usd: 3.5, khr: null })
    const zero = await request(products, 'POST', '/', { name: 'S7 Typed Zero', barcode: '9807000000035', cost_price_usd: 0, cost_price_khr: 0, selling_price_usd: 4 })
    assert.deepEqual(costs(zero.body.id), { usd: 0, khr: 0 }, 'a typed 0 stays a recorded 0')
    const blank = await request(products, 'POST', '/', { name: 'S7 Blank Cost', barcode: '9807000000042', cost_price_usd: '', cost_price_khr: '   ', selling_price_usd: 4 })
    assert.deepEqual(costs(blank.body.id), { usd: null, khr: null }, 'a blank cost is unknown, not 0')
  })

  await check('POST /variant without a cost -> NULL (base 0)', async () => {
    const variant = await request(products, 'POST', '/variant', { name: 'S7 Variant No Cost', selling_price_usd: 4 })
    assert.equal(variant.status, 200, JSON.stringify(variant))
    assert.deepEqual(costs(variant.body.id), { usd: null, khr: null })
  })

  await check('a review-tier create without a cost is NULL once approved (reviewApply replays the same writer)', async () => {
    const queued = await request(products, 'POST', '/', { name: 'S7 Reviewed No Cost', barcode: '9807000000059', selling_price_usd: 4 }, requester)
    assert.equal(queued.status, 202, JSON.stringify(queued))
    assert.equal((await request(reviews, 'POST', '/' + queued.body.pendingActionId + '/approve', {})).status, 200)
    const made = raw.prepare("SELECT * FROM products WHERE name='S7 Reviewed No Cost'").get()
    assert.deepEqual([made.cost_price_usd, made.cost_price_khr], [null, null])
  })

  await check('planInsertRow (stock-session / review create statement) lists both cost columns, NULL when omitted', async () => {
    const planned = writer.planInsertRow('products', { name: 'S7 Planned', selling_price_usd: 3 }, productColumns())
    assert.match(planned.sql, /"cost_price_usd"/)
    assert.match(planned.sql, /"cost_price_khr"/)
    const byColumn = Object.fromEntries(Object.keys(planned.params).map((key, index) => [planned.sql.match(/\\(([^)]*)\\) VALUES/)[1].split(', ')[index].replaceAll('"', ''), planned.params[key]]))
    assert.equal(byColumn.cost_price_usd, null)
    assert.equal(byColumn.cost_price_khr, null)
    const typed = writer.planInsertRow('products', { name: 'S7 Planned Zero', cost_price_usd: 0 }, productColumns())
    assert.equal(Object.values(typed.params).includes(0), true, 'a typed 0 is carried as 0')
  })

  // ------------------------------------------------------------------ PUT
  await check('PUT clearing the cost -> NULL, NO cost entry, an audit row that says so (base: a $0 manual entry)', async () => {
    for (const cleared of [null, '']) {
      const id = seedCosted('S7 Clear ' + JSON.stringify(cleared), 4, 16000)
      const result = await request(products, 'PUT', '/' + id, { cost_price_usd: cleared })
      assert.equal(result.status, 200, JSON.stringify(result))
      assert.equal(costs(id).usd, null, 'the cleared cost is unknown')
      assert.equal(costs(id).khr, 16000, 'the other currency is untouched')
      assert.equal(entries(id).length, 0, 'no entry: product_cost_entries records typed costs, not their absence')
      const audit = overrideAudit(id)
      assert.equal(audit.length, 1, 'the clear is still audited')
      assert.equal(JSON.parse(audit[0].old_value).cost_price_usd, 4)
      assert.equal(JSON.parse(audit[0].new_value).cost_price_usd, null)
      assert.equal(JSON.parse(audit[0].details).cost_entry_id, null)
    }
  })

  await check('PUT a typed 0 -> a recorded $0 with its entry (the proof), previous cost kept', async () => {
    const id = seedCosted('S7 Typed Zero Edit', 4)
    assert.equal((await request(products, 'PUT', '/' + id, { cost_price_usd: 0 })).status, 200)
    assert.equal(costs(id).usd, 0)
    const written = entries(id)
    assert.equal(written.length, 1)
    assert.deepEqual([written[0].cost_usd, written[0].previous_cost_usd], [0, 4])
    assert.equal(overrideAudit(id).length, 1)
    const fromUnknown = seedCosted('S7 Unknown To Zero', null)
    assert.equal((await request(products, 'PUT', '/' + fromUnknown, { cost_price_usd: 0 })).status, 200)
    assert.equal(costs(fromUnknown).usd, 0)
    assert.deepEqual(entries(fromUnknown).map((entry) => [entry.cost_usd, entry.previous_cost_usd]), [[0, null]], 'unknown -> $0 is a typed zero with its entry')
  })

  await check('PUT that only changes KHR on an unknown-USD product records no entry (cost_usd is NOT NULL) but is audited', async () => {
    const id = seedCosted('S7 Khr Only', null, null)
    assert.equal((await request(products, 'PUT', '/' + id, { cost_price_khr: 8000 })).status, 200)
    assert.deepEqual(costs(id), { usd: null, khr: 8000 })
    assert.equal(entries(id).length, 0, 'base wrote a $0 USD entry here')
    assert.equal(overrideAudit(id).length, 1)
  })

  await check('PUT resaving the same unknown cost writes nothing', async () => {
    const id = seedCosted('S7 Same Unknown', null)
    assert.equal((await request(products, 'PUT', '/' + id, { cost_price_usd: null })).status, 200)
    assert.equal(costs(id).usd, null)
    assert.equal(entries(id).length, 0)
    assert.equal(overrideAudit(id).length, 0)
  })

  // ---------------------------------------------------------------- folds
  await check('create-fold: a typed $0 onto an unknown-cost twin records $0 with its entry; no cost or a blank cost changes nothing (base: ignored)', async () => {
    const twin = Number(raw.prepare("INSERT INTO products(name,barcode,cost_price_usd,cost_price_khr,selling_price_usd,is_active) VALUES('S7 Fold Twin','9807000000103',NULL,NULL,5,1)").run().lastInsertRowid)
    const untouched = await request(products, 'POST', '/', { name: 'S7 Fold Twin', barcode: '9807000000103', selling_price_usd: 5 })
    assert.equal(untouched.status, 200, JSON.stringify(untouched))
    assert.equal(untouched.body.folded_into, twin)
    assert.deepEqual(costs(twin), { usd: null, khr: null }, 'a create without a cost leaves the twin unknown')
    const blank = await request(products, 'POST', '/', { name: 'S7 Fold Twin', barcode: '9807000000103', cost_price_usd: '', selling_price_usd: 5 })
    assert.equal(blank.body.folded_into, twin)
    assert.equal(costs(twin).usd, null)
    assert.equal(entries(twin).length, 0)
    const typed = await request(products, 'POST', '/', { name: 'S7 Fold Twin', barcode: '9807000000103', cost_price_usd: 0, selling_price_usd: 5 })
    assert.equal(typed.body.folded_into, twin)
    assert.equal(costs(twin).usd, 0, 'a typed $0 is a recorded $0')
    assert.deepEqual(entries(twin).map((entry) => [entry.cost_usd, entry.previous_cost_usd]), [[0, null]])
  })

  await check('create-fold: a real cost still averages into a costed twin and a typed 0 does not drag it down (control, green on base)', async () => {
    const twin = Number(raw.prepare("INSERT INTO products(name,barcode,cost_price_usd,cost_price_khr,selling_price_usd,is_active) VALUES('S7 Fold Costed','9807000000110',4,16000,5,1)").run().lastInsertRowid)
    assert.equal((await request(products, 'POST', '/', { name: 'S7 Fold Costed', barcode: '9807000000110', cost_price_usd: 6, selling_price_usd: 5 })).body.folded_into, twin)
    assert.equal(costs(twin).usd, 5, 'mean of the distinct costs 4 and 6')
    assert.equal((await request(products, 'POST', '/', { name: 'S7 Fold Costed', barcode: '9807000000110', cost_price_usd: 0, selling_price_usd: 5 })).body.folded_into, twin)
    assert.equal(costs(twin).usd, 5, 'the averaging formula is unchanged (Q2): a 0 is not weighed in')
  })

  console.log(failed ? '\\n' + failed + ' check(s) failed' : '\\nall checks passed')
  process.exitCode = failed ? 1 : 0
})().catch((error) => { console.error(error); process.exitCode = 1 })
`
const runner = new Module(__filename, module)
runner.filename = __filename
runner.paths = module.paths
runner._compile(harnessBase + checks, __filename)
