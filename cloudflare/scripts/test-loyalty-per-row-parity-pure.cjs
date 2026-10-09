'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
let harness
if (process.env.LOYALTY_PARITY_BASELINE) {
  const file = path.join(__dirname, 'test-notifications-summary-trim-pure.cjs')
  const source = fs.readFileSync(file, 'utf8').split('async function main()')[0]
    .replace("const SRC = path.join(__dirname, '..', 'src')", `const SRC = ${JSON.stringify(path.resolve(process.env.LOYALTY_PARITY_BASELINE, 'src'))}`)
  const compiled = new Module(file, module)
  compiled.filename = file; compiled.paths = Module._nodeModulePaths(__dirname)
  compiled._compile(source + '\nmodule.exports = { raw,load,env,summary,section,cacheModule,ADMIN,ledger };', file)
  harness = compiled.exports
} else harness = require('./test-notifications-summary-trim-pure.cjs')
const { raw, load, env, summary, section, cacheModule, ledger } = harness
const set = (key, value) => raw.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value))
const customer = (id) => raw.db.prepare('INSERT INTO customers(id,name,membership_number) VALUES(?,?,?)').run(id, `Synthetic ${id}`, `LC-${id}`)
let receipt = 0
const sale = (id, amount, options = {}) => raw.db.prepare('INSERT INTO sales(receipt_number,customer_id,sale_status,total_usd,total_khr,membership_points_redeemed,loyalty_accrual) VALUES(?,?,?,?,?,?,?)')
  .run(`PARITY-${++receipt}`, id, options.status || 'completed', amount, amount * 4000, options.redeemed || 0, options.accrual ?? 1)
async function refresh(threshold = 1) {
  set('notifications_loyalty_threshold', threshold)
  await cacheModule.bumpVersion(env, 'settings'); await cacheModule.bumpVersion(env, 'customers')
  const response = await summary()
  assert.equal(response.status, 200, JSON.stringify(response.json))
  return section(response, 'loyalty')
}
async function membership(id) {
  const response = await load('routes/contacts.ts').default.request(`http://local/customers/membership/LC-${id}`, {}, env, { waitUntil() {}, passThroughOnException() {} })
  assert.equal(response.status, 200)
  const json = await response.json()
  return json.points.balance
}
const points = (value, id) => Number(value?.items.find(item => item.id === `loyalty-${id}`)?.meta.split(' ')[0])
async function main() {
  set('loyalty_points_enabled', 'true'); set('customer_portal_points_basis', 'usd'); set('customer_portal_points_per_usd', 1.5)
  customer(9901); [0.01, 1.32].forEach(amount => sale(9901, amount))
  let value = await refresh(2)
  assert.equal(await membership(9901), 1.99)
  if (process.argv[2] !== 'projection') assert.ok(!value?.items.some(item => item.id === 'loyalty-9901'), 'actual Contacts1.99 must not appear at notification threshold2')
  customer(9902); [0.01, 0.66].forEach(amount => sale(9902, amount))
  value = await refresh(1)
  if (process.argv[2] !== 'projection') {
    assert.equal(points(value, 9902), await membership(9902), 'actual two-sale displayed rounding witness')
    assert.equal(points(value, 9902), 1)
  }
  customer(9903); [3.12, 53.49, 54.65, 42.97, 24.06].forEach(amount => sale(9903, amount))
  value = await refresh(1)
  assert.equal(await membership(9903), 267.43)
  assert.equal(points(value, 9903), 267.43, 'SQL per-row SUM must not change267.43 to267.44')
  customer(9904); [24.06, 42.97, 54.65, 53.49, 3.12].forEach(amount => sale(9904, amount))
  value = await refresh()
  assert.equal(points(value, 9904), await membership(9904), 'the explicit row order is shared even when insertion order reverses')
  assert.notEqual(await membership(9903), await membership(9904), 'order fixture must discriminate non-associative accumulation')

  customer(9999)
  const existing = Number(raw.db.prepare('SELECT COUNT(*) count FROM sales').get().count)
  for (let index = existing; index < 498; index++) sale(9999, 0)
  ;[3.12, 53.49, 54.65, 42.97, 24.06].forEach(amount => sale(9999, amount))
  for (let id = 12000; id < 12065; id++) { customer(id); sale(id, 0.01); sale(id, 0.66) }
  value = await refresh()
  assert.equal(value.count, 70, 'all65 additional customers count beyond the50-name preview')
  assert.equal(value.items.length, 50)
  assert.equal(points(value, 9999), 267.43)
  assert.equal(points(value, 9999), await membership(9999), 'splitting one customer across the500-row boundary cannot round page subtotals')
  const contacts = await load('routes/contacts.ts').default.request('http://local/customers?page=1&pageSize=100', {}, env, { waitUntil() {}, passThroughOnException() {} })
  assert.equal(contacts.status, 200, await contacts.clone().text())
  const contactsJson = await contacts.json()
  const directory = Array.isArray(contactsJson) ? contactsJson : contactsJson.items || contactsJson.data || contactsJson.customers
  assert.equal(directory.filter(row => row.id >= 12000 && row.id < 12065).length, 65, 'actual bulk Contacts reader crosses binding chunks')
  for (const item of value.items) assert.equal(Number(item.meta.split(' ')[0]), Number(directory.find(row => item.id === `loyalty-${row.id}`).points_balance))

  customer(9998); sale(9998, 30); sale(9998, 90, { accrual: 0, redeemed: 1.125 }); sale(9998, 99, { status: 'awaiting_payment', redeemed: 2.125 }); sale(9998, 999, { status: 'cancelled', redeemed: 999 })
  raw.db.exec(`INSERT INTO returns(return_number,customer_id,status,return_scope,total_refund_usd,total_refund_khr) VALUES('PARITY-RET',9998,'completed','customer',0.01,40),('PARITY-VOIDRET',9998,'cancelled','customer',999,999);
    INSERT INTO customer_share_submissions(customer_id,status,reward_points,reward_points_voided_at) VALUES(9998,'approved',0.125,NULL),(9998,'pending',999,NULL),(9998,'approved',999,'2026-10-09');
    INSERT INTO loyalty_point_adjustments(customer_id,points,voided_at) VALUES(9998,0.125,NULL),(9998,0.01,NULL),(9998,999,'2026-10-09');`)
  for (const basis of ['usd', 'khr']) {
    set('customer_portal_points_basis', basis); set('customer_portal_points_per_khr', 0.0015)
    value = await refresh()
    assert.equal(points(value, 9998), await membership(9998), `${basis} per-row terms, redemption, manual/reward and void parity`)
  }
  set('customer_portal_points_basis', 'usd')
  const savedCache = globalThis.caches
  delete globalThis.caches
  const before = process.memoryUsage().heapUsed
  const measured = await summary()
  const after = process.memoryUsage().heapUsed
  assert.equal(measured.status, 200)
  const pages = ledger.filter(entry => /ORDER BY id ASC LIMIT/.test(entry.sql))
  assert.ok(pages.length >= 5 && pages.every(entry => entry.rows <= 500))
  assert.ok(ledger.length < 40, `Free/Paid complete route harness ceiling with auth reserve: ${ledger.length}`)
  console.log(JSON.stringify({ tier: env.PLAN_TIER, sqlReads: ledger.length, ledgerRows: pages.reduce((total, page) => total + page.rows, 0), peakPageRows: Math.max(...pages.map(page => page.rows)), peakPageProjectionBytes: Math.max(...pages.map(page => page.bytes)), heapUsedDelta: after - before, names: ledger.find(entry => /FROM customers WHERE id IN/.test(entry.sql))?.rows, note: 'SQLite route harness; heap delta includes runtime noise, not billed CPU or D1 rows-scanned' }))
  globalThis.caches = savedCache

  const cap = env.PLAN_TIER === 'free' ? 10000 : 100000
  raw.db.exec(`WITH RECURSIVE seq(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<${cap + 1}) INSERT INTO loyalty_point_adjustments(customer_id,points) SELECT 9901,1 FROM seq`)
  await cacheModule.bumpVersion(env, 'customers')
  const refused = await summary()
  assert.equal(refused.status, 503, 'oversized complete read must fail visibly instead of hiding/truncating the loyalty section')
  assert.equal(refused.json.code, 'loyalty_read_budget_exceeded')
  assert.equal(ledger.filter(entry => /ORDER BY id ASC LIMIT/.test(entry.sql)).length, 0, 'preflight refuses before allocating full raw ledgers')
  console.log('PASS actual Contacts/Notification rounding, order, pages,65 customers, configured rates, void terms and budget refusal')
}
main().catch(error => { console.error(error); process.exitCode = 1 })

