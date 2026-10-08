const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const root = process.env.DATED_COUNT_TEST_ROOT || path.resolve(__dirname, '..')
const scripts = path.join(root, 'scripts'), requireFixture = createRequire(path.join(scripts, 'test-branch-transfer-request-budget-epoch-native.cjs'))
let source = fs.readFileSync(path.join(scripts, 'test-branch-transfer-request-budget-epoch-native.cjs'), 'utf8').split('async function main(){')[0]
source = source.replace("'https://admin.business.test/api/branches/'+(bulk?'transfer-bulk':'transfer')", "'https://admin.business.test/api/inventory/dated-stock-count/apply'")
source = source.replace('const maybeFail=sql=>{', 'const maybeFail=sql=>{options.failAttempt?.(sql);')
source = source.replace("if(k==='batch')return ss=>{", "if(k==='batch')return async ss=>{")
source = source.replace('return t.batch(ss)', 'await options.beforeBatch?.(ss);return t.batch(ss)')
source = source.replace("cookie:'bos_session='+token", "cookie:options.cookie??('bos_session='+token),...options.headers")
source = source.replace('return {...f,call,', 'return {worker,ctx,...f,call,')
source = source.replace("assert.equal(metered,physical,", "if(id!=='overlap-aggregate')assert.ok(physical<=(tier==='free'?50:1000),'whole invocation cap includes background attempts');assert.equal(metered,physical,")
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
      assert.equal(tier, 'free'); assert.equal(dates, 5, 'one and two date Free requests remain supported')
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
const bodyFor = id => ({ client_request_id: id, offline_owner: owner, user_id: 99,
  entries: [{ productId: 1, branchId: 1, date: '2026-09-05', count: 102 }] })
const receipts = f => f.sql.prepare('SELECT COUNT(*) n FROM dated_count_apply_receipts').get().n
async function controls(make, tier) {
  const opts = { cacheFailure: true, tailRetries: true }, f = await world(make, tier, opts)
  try {
    const body = bodyFor(`controls-${tier}-request`), before = snapshot(f)
    for (const [changed, code, status] of [
      [{...body, client_request_id: null}, 'dated_count_invalid_id', 400],
      [{...body, client_request_id: 123456789}, 'dated_count_invalid_id', 400],
      [{...body, offline_owner: {...owner, actor_id: 99}}, 'dated_count_owner_mismatch', 409],
      [{...body, offline_owner: {...owner, authority: 'https://other.test'}}, 'dated_count_owner_mismatch', 409],
    ]) {
      const result = await f.call('identity', changed)
      assert.equal(result.status, status); assert.equal(result.json.code, code); assert.equal(snapshot(f), before); assert.equal(receipts(f), 0)
    }
    const first = await f.call('initial', body); assert.equal(first.status, 200)
    const committed = snapshot(f)
    const normalized = await f.call('normalized', {...body, client_request_id:` ${body.client_request_id} `, entries:[{...body.entries[0],date:'09/05/2026'}]})
    assert.equal(normalized.status,200);assert.equal(normalized.json.replayed,true);assert.equal(snapshot(f),committed)
    const changed = await f.call('changed', {...body, entries: [{...body.entries[0], count: 103}]})
    assert.equal(changed.status, 409); assert.equal(changed.json.code, 'dated_count_request_conflict'); assert.equal(snapshot(f), committed)
    opts.headers = {'x-branch-redirect': '2'}
    const redirectChanged = await f.call('redirect-changed', body)
    assert.equal(redirectChanged.json.code, 'dated_count_request_conflict'); assert.equal(snapshot(f), committed); delete opts.headers
    f.sql.exec("UPDATE dated_count_apply_receipts SET invalidated_at=datetime('now')")
    const reset = await f.call('reset', {...body, entries: [{...body.entries[0], count: 103}]})
    assert.equal(reset.status, 409); assert.equal(reset.json.code, 'dated_count_reset_conflict'); assert.equal(snapshot(f), committed)
    opts.cookie = ''
    const unauthorized = await f.call('no-auth', body); assert.equal(unauthorized.status, 401); assert.equal(snapshot(f), committed)
    delete opts.cookie
    f.sql.exec("UPDATE users SET role_id=NULL,permissions='{}' WHERE id=7")
    const denied = await f.call('no-inventory-grant', body); assert.equal(denied.status, 403); assert.equal(snapshot(f), committed)
    console.log(`PASS ${tier} identity, payload/redirect, invalidation before saved success, auth/permission controls`)
  } finally { f.sql.close() }
  const noop = await world(make, tier, {cacheFailure:true,tailRetries:true})
  try {
    const body = bodyFor(`noop-${tier}-request`); body.entries[0].count=100
    const result = await noop.call('noop', body); assert.equal(result.status, 200); assert.equal(result.json.movementsApplied, 0)
    const saved = snapshot(noop), replay = await noop.call('noop-replay', body)
    assert.equal(replay.status, 200); assert.equal(replay.json.replayed, true); assert.equal(snapshot(noop), saved); assert.equal(receipts(noop), 1)
    console.log(`PASS ${tier} no-op has durable receipt and one audit`)
  } finally { noop.sql.close() }
}
async function faults(make, tier) {
  let reads = 0, recoveryUnavailable = true
  const opts = {cacheFailure:true,tailRetries:true,failAttempt(sql){
    if (/SELECT request_json,result_json,invalidated_at FROM dated_count_apply_receipts/.test(sql) && ++reads === 2 && recoveryUnavailable) throw Error('D1_ERROR: internal error')
  }}
  const f = await world(make, tier, opts)
  try {
    const body=bodyFor(`unknown-${tier}-request`); f.loseNextCommitAcknowledgement()
    const unknown=await f.call('unknown',body)
    assert.equal(unknown.status,503); assert.equal(unknown.json.code,'dated_count_outcome_unknown'); assert.equal(unknown.json.can_review_again,undefined)
    assert.equal(receipts(f),1); const saved=snapshot(f); recoveryUnavailable=false
    const replay=await f.call('unknown-same-id',body); assert.equal(replay.status,200);assert.equal(replay.json.replayed,true);assert.equal(snapshot(f),saved)
    assert.ok(unknown.physical <= (tier==='free'?50:1000)); console.log(`PASS ${tier} committed lost ACK plus unavailable recovery is truthful unknown, same-ID replay`)
  } finally {f.sql.close()}
  const missing=await world(make,tier)
  try {
    missing.sql.exec('DROP TABLE dated_count_apply_receipts');const before=snapshot(missing), result=await missing.call('missing-receipt',bodyFor(`missing-${tier}-request`))
    assert.equal(result.status,503);assert.equal(result.json.code,'dated_count_receipt_unavailable');assert.equal(snapshot(missing),before)
    console.log(`PASS ${tier} unavailable receipt fails closed`)
  } finally {missing.sql.close()}
}
async function overlap(make, tier) {
  let f, second, paused=true
  const body=bodyFor(`overlap-${tier}-request`), opts={cacheFailure:true,tailRetries:true,async beforeBatch(ss){
    if (!paused || !ss.some(s=>s.text.includes("VALUES ('stock_transaction_permit'"))) return
    paused=false
    second=await f.worker.default.fetch(new Request('https://admin.business.test/api/inventory/dated-stock-count/apply',{
      method:'POST',headers:{cookie:'bos_session=branch-auth-cookie','content-type':'application/json',origin:'https://admin.business.test'},body:JSON.stringify(body)
    }),f.env,f.ctx)
  }}
  f=await world(make,tier,opts)
  try {
    const first=await f.call('overlap-aggregate',body); assert.equal(first.status,200);assert.equal(second.status,200)
    assert.equal(receipts(f),1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,1)
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='dated_stock_count_import'").get().n,1)
    console.log(`PASS ${tier} paused atomic dispatch overlaps same ID: one receipt/history/audit; physical=${first.physical} is TWO invocations combined`)
  } finally {f.sql.close()}
}
async function costRace(make, tier) {
  let f, changed=false
  const opts={cacheFailure:true,tailRetries:true,beforeBatch(ss){
    if(changed || !ss.some(s=>s.text.includes("VALUES ('stock_transaction_permit'")))return
    changed=true;f.sql.exec("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id)VALUES(1,3,'manual',1)")
  }}
  f=await world(make,tier,opts)
  try {
    const before=snapshot(f), result=await f.call('cost-race',bodyFor(`cost-race-${tier}-request`))
    assert.equal(result.status,409);assert.equal(result.json.code,'dated_stock_count_conflict');assert.equal(snapshot(f),before);assert.equal(receipts(f),0)
    console.log(`PASS ${tier} concurrent cost baseline change rolls whole receipt/stock/history/audit back`)
  } finally {f.sql.close()}
}
async function requestBoundaries(make,tier) {
  const f=await world(make,tier,{cacheFailure:true,tailRetries:true,staleAuth:true})
  try {
    const first=await f.call('stale-auth',bodyFor(`stale-auth-${tier}-request`));assert.equal(first.status,200)
    assert.equal(receipts(f),1);console.log(`PASS ${tier} actual stale auth/core request fits with cache/retry tails`)
  } finally {f.sql.close()}
  const ordered=await world(make,tier,{cacheFailure:true,tailRetries:true})
  try {
    const body=bodyFor(`ordered-${tier}-request`);body.entries.push({...body.entries[0],date:'2026-09-06',count:104})
    assert.equal((await ordered.call('ordered',body)).status,200);const saved=snapshot(ordered)
    const changed=await ordered.call('reordered',{...body,entries:[...body.entries].reverse()})
    assert.equal(changed.status,409);assert.equal(changed.json.code,'dated_count_request_conflict');assert.equal(snapshot(ordered),saved)
    console.log(`PASS ${tier} original normalized entry order is receipt identity`)
  } finally {ordered.sql.close()}
  const opts={cacheFailure:true,tailRetries:true,headers:{'x-branch-redirect':'2'}},redirect=await world(make,tier,opts)
  try {
    redirect.sql.exec('UPDATE branches SET is_default=0,is_active=0,successor_branch_id=2 WHERE id=1; UPDATE branches SET is_default=1 WHERE id=2')
    const body=bodyFor(`branch-${tier}-request`),first=await redirect.call('redirected',body)
    assert.equal(first.status,200);const saved=snapshot(redirect)
    assert.equal(redirect.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity,100)
    assert.equal(redirect.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=2').get().quantity,102)
    const replay=await redirect.call('redirect-replay',body);assert.equal(replay.status,200);assert.equal(replay.json.replayed,true);assert.equal(snapshot(redirect),saved)
    console.log(`PASS ${tier} explicit retired branch redirect lands once and keeps addressed request identity`)
  } finally {redirect.sql.close()}
}
async function main() {
  const saved = globalThis.fetch; globalThis.fetch = async () => new Response('{"ok":true}')
  try {
    const make = await bundleWorker()
    if (process.env.DATED_COUNT_BASELINE_ACK === '1') return scenario(make, 'free', 1, true)
    for (const tier of ['free', 'paid']) for (const dates of [1, 2, 5]) for (const lostAck of [false, true]) await scenario(make, tier, dates, lostAck)
    for (const tier of ['free','paid']) {await controls(make,tier);await faults(make,tier);await overlap(make,tier);await costRace(make,tier);await requestBoundaries(make,tier)}
    console.log('dated count durable receipt proof PASS 12 size/ACK schedules and 18 control groups')
  } finally { globalThis.fetch = saved }
}
module.exports = { bundleWorker, world, owner, snapshot, scenario }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
