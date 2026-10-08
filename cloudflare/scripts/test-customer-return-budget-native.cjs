const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const source = fs.readFileSync(file, 'utf8')
const harness = new Module(file, module)
harness.filename = file
harness.paths = module.paths
harness._compile(source.slice(0, source.indexOf(';(async () => {')).replace("const app = load('routes/sales.ts').default", "const app = { request(...args) { return load('routes/sales.ts').default.request(...args) } }") + '\nmodule.exports={fixture,request,postSale,load,USER,overrides,setUser(u){currentUser=u}}', file)
const h = harness.exports
h.setUser({ ...h.USER, permissions: '{"all":true}' })
h.overrides['./db'] = h.overrides['../lib/db']
delete h.overrides['../lib/cache']
delete h.overrides['../lib/telegram']
const app = h.load('routes/returns.ts').default
const plan = h.load('lib/planTier.ts')
assert.match(fs.readFileSync(path.join(__dirname, '../src/lib/requestMetrics.ts'), 'utf8'), /const CONTEXT_KEY = 'requestMetrics'/)
global.fetch = async () => new Response('{"ok":true,"result":{}}', { status: 200 })
async function request(db, url, body, env = {}) {
  const pending = []
  const response = await app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, { ...env, DB: db }, { waitUntil(p) { pending.push(p) } })
  await Promise.allSettled(pending)
  return { status: response.status, body: await response.json() }
}
async function fixture(allocations) {
  const f = h.fixture()
  const sale = h.request(`sale-${allocations}`)
  sale.items[0].quantity = allocations
  sale.items[0].batch_id = null
  sale.items[0].pricing_quote = { ...sale.items[0].pricing_quote, gross_usd: 9.5 * allocations, total_usd: 9.5 * allocations, total_khr: 38000 * allocations }
  sale.amount_paid_usd = 9.5 * allocations
  f.raw.prepare('UPDATE products SET stock_quantity=@a WHERE id=10').run({ a: allocations })
  f.raw.prepare('UPDATE branch_stock SET quantity=@a WHERE product_id=10').run({ a: allocations })
  f.raw.prepare('UPDATE branch_batch_stock SET quantity=1 WHERE batch_id=500').run()
  for (let i = 1; i < allocations; i++) {
    f.raw.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,is_active) VALUES(@id,10,@key,'2026-09-01',1)").run({ id: 500 + i, key: `lot-${i}` })
    f.raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(@id,1,1)').run({ id: 500 + i })
  }
  const saved = await h.postSale(f.route, sale)
  assert.equal(saved.status, 200)
  const saleItemId = f.raw.prepare('SELECT id FROM sale_items WHERE sale_id=@id').get({ id: saved.body.id }).id
  const quote = await request(f.route, '/quote', { sale_id: saved.body.id, items: [{ sale_item_id: saleItemId, quantity: allocations }] })
  assert.equal(quote.status, 200)
  const { customer_return_create_version, customer_return_edit_version, ...expected_quote } = quote.body
  const body = { client_request_id: `return-${allocations}`, money_precision_version: 1, sale_id: saved.body.id, expected_quote, reason: 'Fixture return',
    items: [{ sale_item_id: saleItemId, quantity: allocations, stock_action: 'restock', branch_id: 1 }] }
  const kv = new Map()
  for (const namespace of ['products', 'returns', 'sales']) f.raw.prepare('INSERT INTO cache_versions(namespace,version) VALUES(@namespace,1)').run({ namespace })
  const env = { CACHE: { get: async key => kv.get(key) ?? null, put: async (key,value) => kv.set(key,value), delete: async key => kv.delete(key) }, PLAN_TIER: 'free' }
  return { ...f, body, env }
}
function meter(db, limit, outer) {
  const events = []
  let used = outer
  const count = (n, kind) => { events.push({ n, kind }); if (used + n > limit) throw new Error('fixture cumulative D1 limit exceeded'); used += n }
  return { db: { ...db, prepare(sql) { const st = db.prepare(sql); return {
    async get(p) { count(1, 'read'); return st.get(p) }, async all(p) { count(1, 'read'); return st.all(p) }, async run(p) { count(1, 'write'); return st.run(p) },
  } }, batch(items) { count(items.length, 'atomic'); return db.batch(items) }, batchOnce(items) { count(items.length, 'atomic'); return db.batch(items) } },
  used: () => used, events }
}
async function main() {
  for (const allocations of [1, 4, 81, 82]) {
    const f = await fixture(allocations)
    const tier = allocations >= 81 ? 'paid' : 'free'
    f.env.PLAN_TIER = tier
    plan.__resetPlanTierCacheForTests()
    const m = meter(f.route, tier === 'free' ? 50 : 1000, 10)
    const result = await request(m.db, '/', f.body, f.env)
    if (allocations === 1 || allocations === 81) {
      assert.equal(result.status, 200, JSON.stringify(result))
      assert.ok(10 + m.events.reduce((sum, event) => sum + event.n, 0) <= (tier === 'free' ? 50 : 1000), 'all attempted tail statements fit')
      assert.equal(f.raw.prepare('SELECT stock_quantity FROM products WHERE id=10').get().stock_quantity, allocations)
      f.env.PLAN_TIER = 'free'
      plan.__resetPlanTierCacheForTests()
      const replayMeter = meter(f.route, 50, 10)
      const replay = await request(replayMeter.db, '/', f.body, f.env)
      assert.equal(replay.status, 200)
      assert.deepEqual(replay.body, result.body)
      assert.equal(replayMeter.events.length, 1)
    } else {
      assert.equal(result.status, 400, JSON.stringify(result))
      assert.equal(result.body.code, allocations === 82 ? 'return_too_large' : 'customer_return_over_plan_budget')
      assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM returns').get().n, 0)
      assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM return_items').get().n, 0)
      assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM return_create_receipts').get().n, 0)
      assert.equal(m.events.filter(event => event.kind === 'atomic').length, 0)
      assert.equal(f.raw.prepare('SELECT stock_quantity FROM products WHERE id=10').get().stock_quantity, 0)
    }
    console.log(`PASS ${tier} allocations${allocations}: ${m.used()} cumulative statements, status${result.status}`)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
