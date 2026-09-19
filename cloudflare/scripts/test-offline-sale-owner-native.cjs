// Real Hono sale/sync handlers and the fully migrated node:sqlite fixture.
// Auth is an injected current session, not a caller-controlled body field.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { execFileSync } = require('node:child_process')
const { Hono } = require('hono')
const { createHash } = require('node:crypto')
const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const source = fs.readFileSync(file, 'utf8')
const boundary = source.indexOf(';(async () => {')
assert.ok(boundary > 0)
const harness = new Module(file, module)
harness.filename = file
harness.paths = module.paths
// Optional read-only red test against the parent implementation. No checkout,
// disk rewrite, production data, or mocked ownership/receipt decision involved.
globalThis.__offlineOwnerTestSource = (sourcePath) => {
  const relative = path.relative(path.join(__dirname, '..', 'src'), sourcePath).replaceAll('\\', '/')
  if (process.env.OFFLINE_OWNER_BASELINE === '1' && ['routes/sales.ts', 'routes/sync.ts'].includes(relative)) {
    return execFileSync('git', ['show', `ab623bac1657ef0f031710fc0c53bcb05aab889e:cloudflare/src/${relative}`], { cwd: path.join(__dirname, '..'), encoding: 'utf8' })
  }
  return fs.readFileSync(sourcePath, 'utf8')
}
harness._compile(source.slice(0, boundary)
  .replace("fs.readFileSync(sourcePath, 'utf8')", 'globalThis.__offlineOwnerTestSource(sourcePath)')
  .replace("const overrides = {", "const overrides = { './db': { getDb: env => env.DB }, './files': { hasFullLibraryAccess: () => false, canWireProductImages: () => false },")
  .replace("c.set('user', currentUser); return next()", "if (!currentUser) return c.json({code:'invalid_session'},401); c.set('user', currentUser); return next()")
  + '\nmodule.exports={fixture,request,creationState,app,executionCtx,USER,load,setUser(value){currentUser=value}};', file)
const h = harness.exports
const app = new Hono()
app.route('/api/sales', h.app)
app.route('/api/sync', h.load('routes/sync.ts').createSyncRoute(app))
const authority = 'https://shop.example.test'
const userA = { ...h.USER, organization_id: 2 }
const userB = { ...userA, id: 72, name: 'Other cashier' }
const owner = (user = userA) => ({ version: 1, actor_id: user.id, organization_id: user.organization_id, authority, runtime: 'cloudflare-workers' })
const body = (id, user = userA) => ({ ...h.request(id), offline_owner: owner(user) })
async function call(db, route, value, method = 'POST') {
  const response = await app.request(authority + route, {
    method, headers: { 'content-type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  }, { DB: db }, h.executionCtx)
  return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() }
}
const sale = (db, value) => call(db, '/api/sales', value)
function stable(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
}
function operation(payload) {
  const clean = JSON.parse(JSON.stringify(payload))
  return { operation_id: 'sales.create', client_request_id: clean.client_request_id, schema_version: 1,
    base_updated_at: '2026-09-19T10:00:00.000Z', payload: clean,
    payload_digest: createHash('sha256').update(stable(clean)).digest('hex') }
}
function assertDenied(result, code, expectedState, fixture) {
  assert.equal(result.status, 409, `Expected ${code}; got status=${result.status}, code=${result.body.code || 'none'}`)
  assert.equal(result.body.code, code)
  assert.equal(Object.hasOwn(result.body, 'sale'), false)
  assert.equal(Object.hasOwn(result.body, 'receiptNumber'), false)
  assert.match(result.body.error, /Keep the original pending sale/)
  assert.deepEqual(h.creationState(fixture.raw), expectedState)
}
function assertAck(result, requestId, expectedOwner = owner()) {
  assert.equal(result.status, 200, JSON.stringify(result))
  assert.equal(result.body.client_request_id, requestId)
  assert.deepEqual(result.body.offline_owner, expectedOwner)
}
async function run() {
  h.setUser(userA)
  const f = h.fixture()
  const empty = h.creationState(f.raw)
  // Run this first: the old implementation actually creates a sale and fails
  // this assertion, proving the regression is not just a missing new endpoint.
  for (const created_at of [undefined, '2026-09-19T10:00:00.000Z']) {
    assertDenied(await sale(f.route, { ...h.request('ownerless'), ...(created_at ? { created_at } : {}) }), 'offline_owner_required', empty, f)
  }
  for (const bad of [
    { ...owner(), actor_id: 72 }, { ...owner(), organization_id: null }, { ...owner(), organization_id: 3 },
    { ...owner(), authority: 'https://other.example.test' }, { ...owner(), runtime: 'legacy' },
    { ...owner(), version: 2 }, { ...owner(), actor_id: '71' }, { ...owner(), actor_id: 0 },
    { ...owner(), organization_id: '2' }, { ...owner(), authority: authority + '/' },
    { ...owner(), authority: 'https://user@shop.example.test' }, {}, [],
  ]) assertDenied(await sale(f.route, { ...body('wrong-owner'), offline_owner: bad }), 'offline_owner_mismatch', empty, f)
  console.log('PASS ownerless historical/online and malformed/mismatched owner denied before writes')

  const preflight = await call(f.route, '/api/sync/owner', undefined, 'GET')
  assert.equal(preflight.status, 200)
  assert.equal(preflight.cache, 'private, no-store')
  assert.deepEqual(preflight.body, { owner: owner() })
  h.setUser(null)
  assert.equal((await call(f.route, '/api/sync/owner', undefined, 'GET')).status, 401)
  h.setUser({ ...userA, permissions: '{}' })
  assert.equal((await sale(f.route, body('no-pos'))).status, 403)
  h.setUser(userA)
  const created = await sale(f.route, body('original'))
  assertAck(created, 'original')
  const state = h.creationState(f.raw)
  const retry = await sale(f.route, { client_request_id: 'original', offline_owner: owner() })
  assertAck(retry, 'original')
  assert.equal(retry.body.duplicate, true)
  assert.deepEqual(h.creationState(f.raw), state)
  assertDenied(await sale(f.route, { client_request_id: 'original' }), 'offline_owner_required', state, f)
  h.setUser(userB)
  assertDenied(await sale(f.route, body('original')), 'offline_owner_mismatch', state, f)
  // B cannot relabel A's original operation, even with administrator access.
  h.setUser({ ...userB, permissions: '{"all":true}' })
  assertDenied(await sale(f.route, body('original', userB)), 'offline_owner_mismatch', state, f)
  console.log('PASS valid duplicate stable across sessions; wrong actor, including admin, gets no receipt')

  // Simulate a stale pre-insert read: another actor's committed row is visible
  // only when the real unique constraint aborts the attempted transaction.
  let hideOnce = true
  const racedDb = { ...f.route, prepare(sql) {
    const statement = f.route.prepare(sql)
    if (hideOnce && /FROM sales WHERE client_request_id = \?/.test(sql)) {
      hideOnce = false
      return { ...statement, get: async () => undefined }
    }
    return statement
  } }
  assertDenied(await sale(racedDb, body('original', userB)), 'offline_owner_mismatch', state, f)
  h.setUser(userA)
  const lost = h.fixture({ afterBatchThrow: true })
  const recovered = await sale(lost.route, body('lost-response'))
  assertAck(recovered, 'lost-response')
  assert.equal(recovered.body.duplicate, true)
  assert.equal(h.creationState(lost.raw).sales, 1)
  assert.equal(h.creationState(lost.raw).branch, 9)
  console.log('PASS concurrent foreign identity cannot leak; same-owner committed-but-lost response recovers')

  const op = operation(body('outbox-original'))
  const outbox = await call(f.route, '/api/sync/outbox', { operations: [op] })
  assert.equal(outbox.status, 200, JSON.stringify(outbox))
  const applied = outbox.body.results[0]
  assert.equal(applied.operation_id, 'sales.create')
  assert.equal(applied.client_request_id, 'outbox-original')
  assert.equal(applied.status, 'applied')
  assertAck({ status: 200, body: applied.response }, 'outbox-original')
  const afterOutbox = h.creationState(f.raw)
  const same = await call(f.route, '/api/sync/outbox', { operations: [op] })
  assert.equal(same.body.results[0].response.duplicate, true)
  assert.deepEqual(h.creationState(f.raw), afterOutbox)
  for (const user of [userA, userB]) {
    h.setUser(user)
    const legacy = operation(h.request('ownerless-outbox'))
    const rejected = await call(f.route, '/api/sync/outbox', { operations: [legacy] })
    assert.equal(rejected.body.success, false)
    assert.equal(rejected.body.results[0].status, 'rejected')
    assert.equal(rejected.body.results[0].code, 'offline_owner_required')
    assert.equal(Object.hasOwn(rejected.body.results[0], 'response'), false)
  }
  const switched = await call(f.route, '/api/sync/outbox', { operations: [op] })
  assert.equal(switched.body.results[0].code, 'offline_owner_mismatch')
  assert.equal(switched.body.results[0].status, 'rejected')
  const relabeled = await call(f.route, '/api/sync/outbox', { operations: [operation(body('outbox-original', userB))] })
  assert.equal(relabeled.body.results[0].code, 'offline_owner_mismatch')
  assert.equal(Object.hasOwn(relabeled.body.results[0], 'response'), false)
  assert.deepEqual(h.creationState(f.raw), afterOutbox)
  console.log('PASS real outbox preserves authority and correlated acknowledgments; rejects ownerless and switched-cookie replay')
  h.setUser({ ...userA, organization_id: null })
  const nullOrg = await sale(f.route, body('null-org', { ...userA, organization_id: null }))
  assertAck(nullOrg, 'null-org', owner({ ...userA, organization_id: null }))
  console.log('PASS authenticated null organization remains distinct from a positive organization')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
