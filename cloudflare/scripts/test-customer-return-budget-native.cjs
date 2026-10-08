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
const realDb = h.load('lib/db.ts')
const originalAuth = h.overrides['../lib/auth'].requireAuth
h.overrides['../lib/auth'].requireAuth = async (c, next) => {
  if (c.env.TEST_METRICS) c.set('requestMetrics', c.env.TEST_METRICS)
  return originalAuth(c, next)
}
h.overrides['./db'] = h.overrides['../lib/db']
delete h.overrides['../lib/cache']
delete h.overrides['../lib/telegram']
const app = h.load('routes/returns.ts').default
const plan = h.load('lib/planTier.ts')
assert.match(fs.readFileSync(path.join(__dirname, '../src/lib/requestMetrics.ts'), 'utf8'), /const CONTEXT_KEY = 'requestMetrics'/)
let sends = 0
global.fetch = async () => { sends++; return new Response('{"ok":true,"result":{}}', { status: 200 }) }
async function request(db, url, body, env = {}) {
  plan.__resetPlanTierCacheForTests()
  const pending = []
  const response = await app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, { ...env, DB: db }, { waitUntil(p) { pending.push(p) } })
  await Promise.allSettled(pending)
  const text = await response.text()
  let responseBody
  try { responseBody = JSON.parse(text) } catch { responseBody = { error: text } }
  return { status: response.status, body: responseBody }
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
function meter(db, limit, outer, options = {}) {
  const events = []
  const injected = new Set()
  let receiptReads = 0
  let quotaAttempts = 0
  let settingsAttempts = 0
  let used = outer
  const count = (n, kind, sql = '') => {
    events.push({ n, kind, sql }); used += n
    if (options.metrics) options.metrics.attemptedStatements += n
    if (used > limit) throw new Error('fixture cumulative D1 limit exceeded')
    if (options.preflightFailure && /FROM sales s LEFT JOIN sale_write_revisions/.test(sql)) throw new Error('network timeout preflight fixture')
    if (options.quotaTransient && /INSERT INTO quota_usage/.test(sql) && quotaAttempts++ % 2 === 0) throw new Error('network timeout quota fixture')
    if (options.settingsEach && /FROM settings WHERE key IN/.test(sql)) {
      injected.add('settings')
      if (settingsAttempts++ % 2 === 0) throw new Error('network timeout settings fixture')
    }
    if (/JOIN return_create_receipts/.test(sql) && kind === 'read') {
      receiptReads++
      if (options.receiptFailure && receiptReads === 2) throw new Error('network timeout receipt fixture')
    }
    if (options.transient && kind === 'atomic' && /INSERT INTO cache_versions/.test(sql) && !injected.has('cache-write')) {
      injected.add('cache-write'); throw new Error('network timeout cache batch fixture')
    }
    if (options.transient && kind !== 'atomic' && /cache_versions|FROM return_items ri LEFT JOIN|FROM return_replacement_items|FROM settings WHERE key IN/.test(sql)) {
      const key = /cache_versions/.test(sql) ? (/INSERT/.test(sql) ? 'cache-write' : 'cache-read') : /return_replacement_items/.test(sql) ? 'replacements' : /settings/.test(sql) ? 'settings' : 'items'
      if (!injected.has(key)) { injected.add(key); throw new Error('network timeout fixture') }
    }
  }
  const native = { prepare(sql) {
    const statement = { sql, values: [], bind(...values) { statement.values = values; return statement },
      async all() { count(1, 'read', sql); return { results: db.prepare(sql).all(statement.values), meta: {} } },
      async run() { count(1, 'write', sql); return db.prepare(sql).run(statement.values) } }
    return statement
  }, async batch(items) {
    count(items.length, 'atomic', items.map(item => item.sql).join('\n'))
    const out = await db.batch(items.map(item => ({ sql: item.sql, params: item.values })))
    if (options.lostAck && !injected.has('ack')) { injected.add('ack'); throw new Error('network timeout after committed batch') }
    return out
  } }
  return { db: new realDb.D1Compat(native),
  used: () => used, events }
}
async function main() {
  for (const allocations of [1, 4, 81, 82]) {
    const f = await fixture(allocations)
    const tier = allocations >= 81 ? 'paid' : 'free'
    f.env.PLAN_TIER = tier
    plan.__resetPlanTierCacheForTests()
    const m = meter(f.raw, tier === 'free' ? 50 : 1000, 10)
    const result = await request(m.db, '/', f.body, f.env)
    if (allocations === 1 || allocations === 81) {
      assert.equal(result.status, 200, JSON.stringify(result))
      assert.ok(10 + m.events.reduce((sum, event) => sum + event.n, 0) <= (tier === 'free' ? 50 : 1000), 'all attempted tail statements fit')
      assert.equal(f.raw.prepare('SELECT stock_quantity FROM products WHERE id=10').get().stock_quantity, allocations)
      f.env.PLAN_TIER = 'free'
      plan.__resetPlanTierCacheForTests()
      const replayMeter = meter(f.raw, 50, 10)
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
  const prior = await fixture(2)
  prior.env.PLAN_TIER = 'paid'
  plan.__resetPlanTierCacheForTests()
  for (let i = 0; i < 2; i++) {
    const quote = await request(prior.route, '/quote', { sale_id: prior.body.sale_id, items: [{ sale_item_id: prior.body.items[0].sale_item_id, quantity: 1 }] })
    const { customer_return_create_version, customer_return_edit_version, ...expected_quote } = quote.body
    const body = { ...prior.body, client_request_id: `partial-${i}`, expected_quote, items: [{ ...prior.body.items[0], quantity: 1 }] }
    const m = meter(prior.raw, 1000, 0)
    const result = await request(m.db, '/', body, prior.env)
    assert.equal(result.status, 200, JSON.stringify(result))
    assert.equal(prior.raw.prepare('SELECT sale_status FROM sales WHERE id=@id').get({ id: prior.body.sale_id }).sale_status, i === 0 ? 'partial_return' : 'returned')
  }
  console.log('PASS successive v1 partial returns project completed cohort status without another read')
  const legacyOccupied = await fixture(1)
  legacyOccupied.raw.prepare("INSERT INTO returns(return_number,client_request_id,reason,return_type,status) VALUES('legacy-fixture',@request,'fixture','restock','completed')").run({ request: legacyOccupied.body.client_request_id })
  const occupiedMeter = meter(legacyOccupied.raw, 50, 10)
  const occupied = await request(occupiedMeter.db, '/', legacyOccupied.body, legacyOccupied.env)
  assert.equal(occupied.status, 409)
  assert.equal(occupied.body.code, 'idempotency_conflict')
  assert.equal(occupiedMeter.events.length, 1)
  const stopped = await fixture(1)
  const stoppedMeter = meter(stopped.raw, 50, 10, { preflightFailure: true })
  const stoppedResult = await request(stoppedMeter.db, '/', stopped.body, stopped.env)
  assert.equal(stoppedResult.status, 500)
  assert.equal(stoppedMeter.events.filter(event => /FROM sales s LEFT JOIN sale_write_revisions/.test(event.sql)).length, 1)
  assert.equal(stopped.raw.prepare('SELECT COUNT(*) n FROM returns').get().n, 0)
  console.log('PASS one-read legacy ownership refusal and single-attempt transient preflight with zero return effects')
  const retry = await fixture(1)
  const metrics = { statements: 0, attemptedStatements: 0, failed: 0 }
  retry.env.TEST_METRICS = metrics
  const worst = meter(retry.raw, 50, 1, { transient: true, metrics })
  const result = await request(worst.db, '/', retry.body, retry.env)
  assert.equal(result.status, 200, JSON.stringify(result))
  assert.ok(worst.used() <= 50, 'all physical retry attempts fit')
  console.log(`PASS warm observed context with native transient tail retries: ${worst.used()} physical statements`)
  const warm = await fixture(2)
  const warmMetrics = { statements: 1, attemptedStatements: 1, failed: 1 }
  warm.env.TEST_METRICS = warmMetrics
  const warmMeter = meter(warm.raw, 50, 2, { metrics: warmMetrics })
  const warmResult = await request(warmMeter.db, '/', warm.body, warm.env)
  assert.equal(warmResult.status, 200, JSON.stringify(warmResult))
  assert.ok(warmMeter.used() <= 50)
  console.log(`PASS observed warm capacity2 with known failed attempt cost: ${warmMeter.used()} physical statements`)
  const cold = await fixture(1)
  const coldMeter = meter(cold.raw, 50, 10, { transient: true })
  assert.equal((await request(coldMeter.db, '/', cold.body, cold.env)).status, 200)
  assert.ok(coldMeter.used() <= 50, 'cold fallback includes every real cache/Telegram retry attempt')
  console.log(`PASS cold context fallback with worst transient tails: ${coldMeter.used()} physical statements`)
  for (const replacement of [false, true]) {
    const enabled = await fixture(1)
    enabled.env.TELEGRAM_BOT_TOKEN = 'fixture-token'
    enabled.raw.prepare("INSERT INTO settings(key,value) VALUES('telegram_chat_id','123456') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    if (replacement) {
      enabled.env.PLAN_TIER = 'paid'
      enabled.raw.prepare('UPDATE sales SET money_precision_version=0 WHERE id=@id').run({ id: enabled.body.sale_id })
      delete enabled.body.money_precision_version
      delete enabled.body.expected_quote
      enabled.body.items[0].product_id = 10
      enabled.raw.prepare("INSERT INTO products(id,name,stock_quantity,selling_price_usd,cost_price_usd,is_active) VALUES(11,'Replacement',1,9.5,4,1)").run()
      enabled.raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(11,1,1)').run()
      enabled.raw.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,is_active) VALUES(501,11,'replacement','2026-09-01',1)").run()
      enabled.raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(501,1,1)').run()
      enabled.body.replacement_items = [{ product_id: 11, branch_id: 1, batch_id: 501, quantity: 1, applied_price_usd: 9.5 }]
    }
    const beforeSends = sends
    const m = meter(enabled.raw, replacement ? 1000 : 50, 10, { transient: true })
    const response = await request(m.db, '/', enabled.body, enabled.env)
    assert.equal(response.status, 200, JSON.stringify(response))
    assert.equal(sends - beforeSends, replacement ? 2 : 1)
    const notificationReads = m.events.filter(event => event.kind === 'read' && /FROM return_items ri LEFT JOIN|FROM return_replacement_items|FROM settings WHERE key IN/.test(event.sql)).length
    assert.equal(notificationReads, replacement ? 7 : 6)
    console.log(`PASS enabled actual notifications replacement${replacement}: ${notificationReads} SQL attempts, ${sends - beforeSends} fake external sends`)
    if (replacement) {
      const separate = meter(enabled.raw, 1000, 0, { settingsEach: true })
      const telegram = h.load('lib/telegram.ts')
      for (let i = 0; i < 2; i++) await telegram.sendTelegramEvent({ ...enabled.env, DB: separate.db }, { type: 'sales', heading: 'Fixture', lines: ['Fixture'] })
      assert.equal(separate.events.length, 4, 'each enabled settings lookup can consume two SQL attempts; replacement tail bound8')
    }
  }
  const handoff = await fixture(1)
  handoff.raw.prepare('DELETE FROM cache_versions').run()
  handoff.env.CACHE.put = async () => { throw new Error('KV write unavailable fixture') }
  const handoffMeter = meter(handoff.raw, 50, 10, { transient: true, quotaTransient: true })
  const handoffResult = await request(handoffMeter.db, '/', handoff.body, handoff.env)
  assert.equal(handoffResult.status, 200)
  assert.ok(handoffMeter.used() <= 50, 'cold missing cache versions with Free quota and KV handoff includes every attempt')
  console.log(`PASS cold KV quota handoff/retries: ${handoffMeter.used()} physical statements`)
  for (const option of ['lostAck', 'receiptFailure']) {
    const recovery = await fixture(1)
    const m = meter(recovery.raw, 50, 10, { lostAck: true, [option]: true })
    const first = await request(m.db, '/', recovery.body, recovery.env)
    assert.equal(first.status, option === 'lostAck' ? 200 : 503, JSON.stringify(first))
    if (option === 'receiptFailure') assert.equal(first.body.code, 'unknown_outcome')
    assert.equal(recovery.raw.prepare('SELECT COUNT(*) n FROM return_create_receipts').get().n, 1)
    const replay = meter(recovery.raw, 50, 10)
    assert.equal((await request(replay.db, '/', recovery.body, recovery.env)).status, 200)
    assert.equal(replay.events.length, 1)
    assert.equal(recovery.raw.prepare('SELECT stock_quantity FROM products WHERE id=10').get().stock_quantity, 1)
    console.log(`PASS single-attempt ${option}: durable receipt, one-read replay, no duplicate effects`)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
