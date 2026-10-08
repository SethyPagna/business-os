const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const root = process.env.DATED_COUNT_TEST_ROOT || path.resolve(__dirname, '..')
const scripts = path.join(root, 'scripts'), requireFixture = createRequire(path.join(scripts, 'test-branch-transfer-request-budget-epoch-native.cjs'))
let source = fs.readFileSync(path.join(scripts, 'test-branch-transfer-request-budget-epoch-native.cjs'), 'utf8').split('async function main(){')[0]
source = source.replace("'https://admin.business.test/api/branches/'+(bulk?'transfer-bulk':'transfer')", "'https://admin.business.test/api/inventory/dated-stock-count/apply'")
const { bundleWorker, world } = new Function('require', '__dirname', 'module', source + ';return {bundleWorker,world}')(requireFixture, scripts, { paths: requireFixture.resolve.paths('esbuild') })
const owner = { version: 1, actor_id: 7, organization_id: null, authority: 'https://admin.business.test', runtime: 'cloudflare-workers' }
const snapshot = f => JSON.stringify({ stock: f.sql.prepare('SELECT * FROM branch_stock').all(), lots: f.sql.prepare('SELECT * FROM branch_batch_stock').all(),
  history: f.sql.prepare('SELECT * FROM inventory_movements').all(), provenance: f.sql.prepare('SELECT * FROM dated_stock_count_batch_actions').all(),
  audit: f.sql.prepare("SELECT * FROM audit_logs WHERE action='dated_stock_count_import'").all() })
async function scenario(make, tier, dates, lostAck) {
  const f = await world(make, tier, { cacheFailure: true, tailRetries: true })
  try {
    const body = { client_request_id: `dated-count-${tier}-${dates}-${lostAck}`, offline_owner: owner, user_id: 99,
      entries: Array.from({ length: dates }, (_, i) => ({ productId: 1, branchId: 1, date: `2026-09-${String(5 + i).padStart(2, '0')}`, count: 102 + i * 2 })) }
    const before = snapshot(f)
    if (lostAck) f.loseNextCommitAcknowledgement()
    const first = await f.call('apply', body)
    assert.ok(first.physical <= (tier === 'free' ? 50 : 1000))
    if (first.json.code === 'dated_count_over_plan_budget') {
      assert.equal(first.status, 409); assert.equal(first.json.can_review_again, true); assert.equal(snapshot(f), before)
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dated_count_apply_receipts').get().n, 0)
      console.log(`PASS ${tier}/${dates}/${lostAck} whole plan refused before effects`); return
    }
    assert.equal(first.status, 200)
    const committed = snapshot(f), second = await f.call('apply', body)
    assert.equal(second.status, 200); assert.equal(snapshot(f), committed, 'same ID must not append compensation/history/audit')
    assert.ok(second.physical <= (tier === 'free' ? 50 : 1000))
    assert.equal(second.json.replayed, true)
    for (const field of ['movementsDeleted', 'movementsCompensated', 'movementsApplied', 'batchTrackedGroups', 'plainGroups']) assert.equal(second.json[field], first.json[field])
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dated_count_apply_receipts').get().n, 1)
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='dated_stock_count_import'").get().n, 1)
    assert.equal(f.sql.prepare('SELECT user_id FROM inventory_movements ORDER BY id LIMIT 1').get().user_id, 7)
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
    console.log(`PASS ${tier}/${dates}/${lostAck} receipt replay keeps original result and history`)
  } finally { f.sql.close() }
}
async function main() {
  const saved = globalThis.fetch; globalThis.fetch = async () => new Response('{"ok":true}')
  try {
    const make = await bundleWorker()
    if (process.env.DATED_COUNT_BASELINE_ACK === '1') return scenario(make, 'free', 1, true)
    for (const tier of ['free', 'paid']) for (const dates of [1, 2, 5]) for (const lostAck of [false, true]) await scenario(make, tier, dates, lostAck)
    console.log('dated count durable receipt proof PASS 12 schedules')
  } finally { globalThis.fetch = saved }
}
module.exports = { bundleWorker, world, owner, snapshot, scenario }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
