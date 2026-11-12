// Approve-and-replace (owner 12 Nov 2026, cap 5): an account at the cap can
// have one pending device approved by revoking one of its approved devices in
// the same step. Drives the REAL routes/devices.ts and lib/deviceTrust.ts over
// every migration applied in SQLite. The mutant at the end removes the closing
// guard and must leave a half-done swap, proving the assertions bite.
//
// Run: node scripts/test-device-cap-replace-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { createAuthHarness } = require('./harness/load_auth_route.cjs')

const SRC = path.join(__dirname, '..', 'src')

function loadTs(rel, overrides, mutate = (text) => text, cache = new Map()) {
  if (cache.has(rel)) return cache.get(rel).exports
  const sourcePath = path.join(SRC, rel)
  const text = mutate(fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n'), rel)
  const output = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  cache.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return loadTs(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`, overrides, mutate, cache)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const ADMIN = { id: 1, username: 'owner', name: 'Owner' }

function setup(mutate) {
  const h = createAuthHarness()
  const audits = []
  const db = h.db
  const stubs = { './db': { getDb: () => db }, './audit': { audit: async () => {} }, './permissions': { isAdminControlUser: () => true } }
  const trust = loadTs('lib/deviceTrust.ts', stubs)
  const app = loadTs('routes/devices.ts', {
    '../lib/db': { getDb: () => db },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', ADMIN); return next() }, revokeSessionsForDevice: async () => 0, revokeUserSessions: async () => {} },
    '../lib/audit': { audit: async (...args) => { audits.push(args) } },
    '../lib/permissions': { isAdminControlUser: () => true },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    '../lib/deviceTrust': trust,
    '../index': {},
  }, mutate).default
  h.raw.prepare(`INSERT INTO users (id, username, name, password) VALUES (1, 'owner', 'Owner', 'x'), (10, 'sokha', 'Sokha', 'x'), (11, 'dara', 'Dara', 'x')`).run({})
  const post = async (id, body) => {
    const res = await app.request(`/${id}/approve-replacing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, h.env, { waitUntil() {}, passThroughOnException() {} })
    return { status: res.status, body: await res.json() }
  }
  const postApprove = async (id) => {
    const res = await app.request(`/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, h.env, { waitUntil() {}, passThroughOnException() {} })
    return { status: res.status, body: await res.json() }
  }
  return { h, audits, post, postApprove, limit: trust.MAX_APPROVED_DEVICES_PER_USER }
}

const addDevice = (h, userId, deviceId, status) => h.raw.prepare(`INSERT INTO trusted_devices (user_id, device_id, device_name, status, decided_at)
  VALUES (@userId, @deviceId, @deviceId, @status, CASE WHEN @status = 'pending' THEN NULL ELSE CURRENT_TIMESTAMP END)`).run({ userId, deviceId, status })
const idOf = (h, userId, deviceId) => h.raw.prepare('SELECT id FROM trusted_devices WHERE user_id = @userId AND device_id = @deviceId').get({ userId, deviceId }).id
const state = (h, userId = 10) => Object.fromEntries(h.raw.prepare('SELECT device_id, status FROM trusted_devices WHERE user_id = @userId').all({ userId }).map((r) => [r.device_id, r.status]))
const approvedCount = (h, userId = 10) => Object.values(state(h, userId)).filter((s) => s === 'approved').length
const addSession = (h, id, userId, deviceId, family = null) => h.raw.prepare(`INSERT INTO user_sessions (id, user_id, token_hash, device_id, expires_at, limit_family_id)
  VALUES (@id, @userId, @token, @deviceId, @expires, @family)`).run({ id, userId, token: `tok-${id}`, deviceId, expires: new Date(Date.now() + 864e5).toISOString(), family })
const liveSessions = (h) => h.raw.prepare('SELECT id FROM user_sessions WHERE revoked_at IS NULL ORDER BY id').all({}).map((r) => r.id)

function atCap(world, extraPending = 1) {
  const { h, limit } = world
  for (let n = 1; n <= limit; n++) addDevice(h, 10, `approved-device-${n}`, 'approved')
  for (let n = 1; n <= extraPending; n++) addDevice(h, 10, `pending-device-${n}`, 'pending')
}

let passed = 0
const failures = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    const detail = 'actual' in error ? ` actual=${JSON.stringify(error.actual)} expected=${JSON.stringify(error.expected)}` : ''
    console.log(`FAIL ${name}: ${String(error.message).split(/\r?\n/)[0]}${detail}`.slice(0, 600))
  }
}

async function main() {
  await check('at the cap, plain approve is refused; approve-replacing swaps exactly one device and never exceeds the cap', async () => {
    const world = setup()
    atCap(world)
    const pendingId = idOf(world.h, 10, 'pending-device-1')
    const oldId = idOf(world.h, 10, 'approved-device-3')
    assert.equal(world.limit, 5)
    assert.equal((await world.postApprove(pendingId)).body.code, 'device_limit_reached')
    addSession(world.h, 1, 10, 'approved-device-3')
    addSession(world.h, 2, 10, 'approved-device-1')
    addSession(world.h, 3, 10, 'other-device', 1)
    addSession(world.h, 4, 11, 'approved-device-3')
    const res = await world.post(pendingId, { revokeId: oldId })
    assert.equal(res.status, 200)
    assert.equal(res.body.success, true)
    assert.equal(state(world.h)['pending-device-1'], 'approved')
    assert.equal(state(world.h)['approved-device-3'], 'rejected')
    assert.equal(approvedCount(world.h), 5, 'the cap is neither exceeded nor under-filled')
    const row = world.h.raw.prepare('SELECT revoked_at, decided_by_name FROM trusted_devices WHERE id = @oldId').get({ oldId })
    assert.ok(row.revoked_at && row.decided_by_name === 'Owner', 'the replaced row is a normal revoke')
    assert.deepEqual(liveSessions(world.h), [2, 4], 'the replaced device session and its family end; another device and another account stay')
    assert.deepEqual(world.audits.map((a) => a[3]), ['device_revoked', 'device_approved'], 'two audit rows')
    assert.equal(world.audits[0][6].replacedByTrustedDeviceRowId, pendingId)
    assert.equal(world.audits[1][6].replacedTrustedDeviceRowId, oldId)
  })

  await check('the replaced device\'s session family ends with it, other accounts and devices are untouched', async () => {
    const world = setup()
    atCap(world)
    addSession(world.h, 1, 10, 'approved-device-3')
    addSession(world.h, 2, 10, 'renewed-device', 1)
    addSession(world.h, 3, 10, 'approved-device-1')
    addSession(world.h, 4, 11, 'approved-device-3')
    await world.post(idOf(world.h, 10, 'pending-device-1'), { revokeId: idOf(world.h, 10, 'approved-device-3') })
    assert.deepEqual(liveSessions(world.h), [3, 4])
  })

  await check('a device of another account cannot be chosen to replace', async () => {
    const world = setup()
    atCap(world)
    addDevice(world.h, 11, 'dara-phone-0001', 'approved')
    const before = JSON.stringify([state(world.h), state(world.h, 11)])
    const res = await world.post(idOf(world.h, 10, 'pending-device-1'), { revokeId: idOf(world.h, 11, 'dara-phone-0001') })
    assert.equal(res.status, 400)
    assert.equal(res.body.code, 'device_replace_invalid')
    assert.equal(JSON.stringify([state(world.h), state(world.h, 11)]), before, 'nothing changed')
  })

  await check('a pending, rejected or missing target and malformed ids are refused without change', async () => {
    const world = setup()
    atCap(world, 2)
    addDevice(world.h, 10, 'rejected-device-1', 'rejected')
    const pendingId = idOf(world.h, 10, 'pending-device-1')
    const before = JSON.stringify(state(world.h))
    for (const revokeId of [idOf(world.h, 10, 'pending-device-2'), idOf(world.h, 10, 'rejected-device-1'), 99999, pendingId, 'x', 0, null, undefined]) {
      const res = await world.post(pendingId, { revokeId })
      assert.equal(res.status, 400, String(revokeId))
    }
    assert.equal((await world.post(99999, { revokeId: 1 })).status, 404)
    assert.equal(JSON.stringify(state(world.h)), before)
  })

  await check('an already approved device is idempotent and revokes nothing; a rejected one needs its reset', async () => {
    const world = setup()
    atCap(world)
    addDevice(world.h, 10, 'rejected-device-1', 'rejected')
    const res = await world.post(idOf(world.h, 10, 'approved-device-1'), { revokeId: idOf(world.h, 10, 'approved-device-2') })
    assert.deepEqual(res.body, { success: true, idempotent: true })
    assert.equal(approvedCount(world.h), 5)
    const rejected = await world.post(idOf(world.h, 10, 'rejected-device-1'), { revokeId: idOf(world.h, 10, 'approved-device-2') })
    assert.equal(rejected.status, 409)
    assert.equal(rejected.body.code, 'device_reapproval_reset_required')
  })

  await check('a state change between the read and the write rolls everything back (409, nothing half-done)', async () => {
    const world = setup()
    atCap(world)
    addSession(world.h, 1, 10, 'approved-device-3')
    const pendingId = idOf(world.h, 10, 'pending-device-1')
    const oldId = idOf(world.h, 10, 'approved-device-3')
    const realBatch = world.h.db.batch
    world.h.db.batch = async (items) => {
      world.h.raw.prepare(`UPDATE trusted_devices SET status = 'rejected' WHERE id = @oldId`).run({ oldId })
      return realBatch(items)
    }
    const res = await world.post(pendingId, { revokeId: oldId })
    world.h.db.batch = realBatch
    assert.equal(res.status, 409)
    assert.equal(res.body.code, 'device_replace_conflict')
    assert.equal(state(world.h)['pending-device-1'], 'pending')
    assert.deepEqual(liveSessions(world.h), [1])
    assert.equal(world.audits.length, 0, 'no audit row for a decision that did not happen')
  })

  await check('a competing approval that fills the freed slot rolls the swap back instead of exceeding the cap', async () => {
    const world = setup()
    atCap(world, 2)
    addSession(world.h, 1, 10, 'approved-device-3')
    const pendingId = idOf(world.h, 10, 'pending-device-1')
    const oldId = idOf(world.h, 10, 'approved-device-3')
    const realBatch = world.h.db.batch
    world.h.db.batch = async (items) => {
      addDevice(world.h, 10, 'sneaked-in-device', 'approved')
      return realBatch(items)
    }
    const res = await world.post(pendingId, { revokeId: oldId })
    world.h.db.batch = realBatch
    assert.equal(res.status, 409)
    assert.equal(state(world.h)['approved-device-3'], 'approved', 'the old device keeps its approval')
    assert.equal(state(world.h)['pending-device-1'], 'pending')
    assert.deepEqual(liveSessions(world.h), [1], 'and its sessions')
    assert.equal(approvedCount(world.h), 6, 'only the competing insert changed anything')
  })

  await check('mutant without the closing guard leaves a half-done swap, so the rollback test above bites', async () => {
    const strip = (text, rel) => rel === 'routes/devices.ts'
      ? text.replace(/      \{\n        sql: `SELECT CASE WHEN EXISTS \(SELECT 1 FROM trusted_devices WHERE id = @id AND user_id = @user_id AND status = 'approved'\)\n          THEN 1 ELSE json_extract\(@replace_guard_error, '\$'\) END AS device_replace_landed`,\n        params,\n      \},\n/, '')
      : text
    const mutantSource = fs.readFileSync(path.join(SRC, 'routes', 'devices.ts'), 'utf8').replace(/\r\n/g, '\n')
    assert.notEqual(strip(mutantSource, 'routes/devices.ts'), mutantSource, 'the mutation applied')
    const world = setup(strip)
    atCap(world, 2)
    const pendingId = idOf(world.h, 10, 'pending-device-1')
    const oldId = idOf(world.h, 10, 'approved-device-3')
    const realBatch = world.h.db.batch
    world.h.db.batch = async (items) => {
      addDevice(world.h, 10, 'sneaked-in-device', 'approved')
      return realBatch(items)
    }
    await world.post(pendingId, { revokeId: oldId })
    world.h.db.batch = realBatch
    assert.equal(state(world.h)['approved-device-3'], 'rejected', 'the mutant revoked the old device')
    assert.equal(state(world.h)['pending-device-1'], 'pending', 'and approved nothing')
  })

  await check('source: admin-only router, one atomic batch, cap repeated inside the write, both audits', async () => {
    const route = fs.readFileSync(path.join(SRC, 'routes', 'devices.ts'), 'utf8').replace(/\r\n/g, '\n')
    const at = route.indexOf("app.post('/:id/approve-replacing'")
    assert.ok(at > route.indexOf("app.use('*', async (c, next) => {"), 'declared after the admin-control middleware')
    const block = route.slice(at, route.indexOf("app.post('/:id/reset'", at))
    assert.match(block, /db\.batch\(\[/)
    assert.match(block, /status = 'approved' AND id != @id\) < @approved_device_limit/)
    assert.match(block, /'device_revoked'[\s\S]*'device_approved'/)
    assert.doesNotMatch(block, /await db\.prepare\([^)]*UPDATE/, 'no write outside the batch')
  })

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) process.exit(1)
  console.log('test-device-cap-replace-pure: all checks passed')
}

main().catch((error) => { console.error(error); process.exit(1) })
