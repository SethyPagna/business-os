'use strict'
// W3 Slice A round 2 (review F3 + F8), routes/returns.ts. The real POST /api/sales and /api/returns routes over the complete migrated schema
// (the harness of test-sale-create-atomic-pure.cjs), with a SLOW bump stub and a broadcast recorder.
//   F3  POST /api/returns/reasons/replace is ONE bumpVersions call carrying settings and returns (one quota upsert on Free), not two bump calls.
//   F8  A replayed create (same client_request_id after a lost acknowledgement) advances the versions again before it answers: the first Worker
//       may have committed and died before its own bump, and the retry is the only thing that can repair the caches. The bump is idempotent.
//   Control: the first create is still ONE bump call, finished before the response and before any broadcast.
// Run (from cloudflare/): node scripts/test-returns-bump-replay-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const source = fs.readFileSync(file, 'utf8')
const harness = new Module(file, module)
harness.filename = file
harness.paths = Module._nodeModulePaths(__dirname)
harness._compile(source.slice(0, source.indexOf(';(async () => {')) + '\nmodule.exports={fixture,request,postSale,load,overrides,setUser:(u)=>{currentUser=u},USER,executionCtx}', file)
const h = harness.exports
h.setUser({ ...h.USER, permissions: '{"all":true}' })

const events = []
const bumps = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const cache = h.overrides['../lib/cache']
cache.bumpVersion = async (_env, namespace) => cache.bumpVersions(_env, [namespace])
cache.bumpVersions = async (_env, list) => { events.push(`bump-start:${list.join('+')}`); bumps.push([...list]); await sleep(60); events.push(`bump-done:${list.join('+')}`) }
h.overrides['../durable-objects/broadcastHub'].broadcast = async (_env, channel) => { events.push(`broadcast:${channel}`) }
Object.assign(h.overrides['../lib/telegram'], { sendReturnTelegramEvent: async () => {}, sendReturnStatusTelegramEvents: async () => {}, formatReturnTelegramLines: () => [] })
const realDb = h.load('lib/db.ts')
h.overrides['./db'] = h.overrides['../lib/db']
const returns = h.load('routes/returns.ts').default
const sales = h.load('routes/sales.ts').default
const pending = []
const ctx = { waitUntil(promise) { pending.push(promise); promise?.catch?.(() => {}) }, passThroughOnException() {} }

;(async () => {
  let failed = 0
  const check = async (name, fn) => { try { await fn(); console.log('PASS ' + name) } catch (error) { failed++; console.error('FAIL ' + name, error.stack || error.message) } }
  const f = h.fixture()
  const body = h.request('bump-replay-sale-1')
  const admitted = { ...body, offline_owner: { version: 1, actor_id: h.USER.id, organization_id: null, authority: 'http://localhost', runtime: 'cloudflare-workers' } }
  const res = await sales.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(admitted) }, { DB: f.route }, ctx)
  const saved = { status: res.status, body: await res.json() }
  assert.equal(saved.status, 200, JSON.stringify(saved.body).slice(0, 300))
  await Promise.allSettled(pending.splice(0))
  const saleItemId = f.raw.prepare('SELECT id FROM sale_items WHERE sale_id=@id').get({ id: saved.body.id }).id
  const native = { prepare(sql) { const st = { sql, values: [], bind(...v) { st.values = v; return st }, async all() { return { results: f.raw.prepare(sql).all(st.values), meta: {} } }, async run() { return f.raw.prepare(sql).run(st.values) } }; return st }, async batch(items) { return f.raw.batch(items.map((i) => ({ sql: i.sql, params: i.values }))) } }
  const rdb = new realDb.D1Compat(native)
  const post = async (url, payload) => {
    events.length = 0; bumps.length = 0
    const r = await returns.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }, { DB: rdb }, ctx)
    events.push('response')
    const text = await r.text()
    let json; try { json = JSON.parse(text) } catch { json = { error: text } }
    const trace = events.join(' > ')
    await Promise.allSettled(pending.splice(0))
    return { status: r.status, json, trace }
  }
  const quote = await post('/quote', { sale_id: saved.body.id, items: [{ sale_item_id: saleItemId, quantity: 1 }] })
  assert.equal(quote.status, 200, JSON.stringify(quote.json).slice(0, 300))
  const { customer_return_create_version, customer_return_edit_version, ...expected_quote } = quote.json
  const returnBody = { client_request_id: 'bump-replay-ret-1', money_precision_version: 1, sale_id: saved.body.id, expected_quote, reason: 'Probe', items: [{ sale_item_id: saleItemId, quantity: 1, stock_action: 'restock', branch_id: 1 }] }

  await check('control: the first return create is one bump call, finished before the response and before any broadcast', async () => {
    const created = await post('/', returnBody)
    assert.equal(created.status, 200, JSON.stringify(created.json).slice(0, 400))
    assert.equal(bumps.length, 1, created.trace)
    const order = created.trace.split(' > ')
    const done = order.findIndex((event) => event.startsWith('bump-done:'))
    assert.ok(done >= 0 && done < order.indexOf('response'), created.trace)
    assert.ok(!order.slice(0, done).some((event) => event.startsWith('broadcast:')), created.trace)
  })

  await check('F8: a replayed create bumps again before it answers (the first attempt may have died before its own bump)', async () => {
    const replayed = await post('/', returnBody)
    assert.equal(replayed.status, 200, JSON.stringify(replayed.json).slice(0, 400))
    assert.equal(bumps.length, 1, `one bump call on the replay (${replayed.trace})`)
    for (const namespace of ['products', 'returns', 'sales', 'stock']) assert.ok(bumps[0].includes(namespace), `${namespace} is advanced (${bumps[0]})`)
    const order = replayed.trace.split(' > ')
    assert.ok(order.findIndex((event) => event.startsWith('bump-done:')) < order.indexOf('response'), `the bump finished before the replay answered (${replayed.trace})`)
  })

  await check('F3: POST /reasons/replace is ONE bump call carrying settings and returns', async () => {
    const replaced = await post('/reasons/replace', { from: 'Probe', to: 'Probe renamed', scope: 'presets_only', return_scope: 'customer' })
    assert.equal(replaced.status, 200, JSON.stringify(replaced.json).slice(0, 300))
    assert.equal(bumps.length, 1, `one bump call (${replaced.trace})`)
    assert.deepEqual([...bumps[0]].sort(), ['returns', 'settings'])
  })

  await check('F8 (N2): a replayed return EDIT (receipt already stored) bumps again before it answers', async () => {
    const row = f.raw.prepare('SELECT id, sale_id, updated_at FROM returns ORDER BY id DESC LIMIT 1').get()
    const absent = { present: false }
    const intent = { return_id: row.id, expected_updated_at: row.updated_at, items: { present: false, value: [] }, reason: absent, return_type: absent,
      notes: { present: true, value: 'edited once' }, total_refund_usd: absent, total_refund_khr: absent, branch_id: absent }
    const requestJson = JSON.stringify(intent)
    const digest = require('node:crypto').createHash('sha256').update(requestJson).digest('hex')
    f.raw.prepare("INSERT INTO return_mutation_receipts(id,actor_id,return_id,sale_id,mutation_kind,request_id,request_digest,request_json,response_json,occurred_at) VALUES('00000000-0000-4000-8000-000000000001',@actor,@rid,@sid,'edit','bump-replay-edit-1',@digest,@rj,@resp,'2026-11-13 00:00:00')")
      .run({ actor: h.USER.id, rid: row.id, sid: row.sale_id, digest, rj: requestJson, resp: JSON.stringify({ id: row.id, updated_at: row.updated_at }) })
    events.length = 0; bumps.length = 0
    const r = await returns.request('/' + row.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_request_id: 'bump-replay-edit-1', expected_updated_at: row.updated_at, notes: 'edited once' }) }, { DB: rdb }, ctx)
    events.push('response')
    const json = await r.json().catch(() => null)
    const trace = events.join(' > ')
    await Promise.allSettled(pending.splice(0))
    assert.equal(r.status, 200, JSON.stringify(json).slice(0, 400))
    assert.equal(bumps.length, 1, 'one bump call on the edit replay (' + trace + ')')
    for (const namespace of ['products', 'returns', 'sales', 'stock']) assert.ok(bumps[0].includes(namespace), namespace + ' is advanced (' + bumps[0] + ')')
    const order = trace.split(' > ')
    assert.ok(order.findIndex((event) => event.startsWith('bump-done:')) < order.indexOf('response'), 'the bump finished before the replay answered (' + trace + ')')
  })

  if (failed) { console.error(`${failed} check(s) failed`); process.exit(1) }
  console.log('PASS test-returns-bump-replay-pure')
  process.exit(0)
})().catch((error) => { console.error(error); process.exit(2) })
