// Device id is not a secret (review M1, 12 Nov 2026): the verified cookie always wins over the body id, and a row whose browser
// has had its cookie (trusted_devices.cookie_bound_at, migration 0304) refuses its id when it arrives without that cookie:
// the sender becomes a new browser with a fresh pending id. Rows approved before the release have no cookie yet, so their first
// sign-in with the body id still passes and binds them. Drives the REAL routes/auth.ts, lib/deviceTrust.ts and lib/deviceCookie.ts;
// the mutants at the end must turn the named checks red.
//
// Run: node scripts/test-device-cookie-bound-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { createAuthHarness } = require('./harness/load_auth_route.cjs')

const SRC = path.join(__dirname, '..', 'src')
function loadTs(rel, overrides, mutate = (text) => text, cache = new Map()) {
  if (cache.has(rel)) return cache.get(rel).exports
  const sourcePath = path.join(SRC, rel)
  const text = mutate(fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n'), rel)
  const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: sourcePath }).outputText
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

const UA = 'Mozilla/5.0 (iPhone) Safari'
const COOKIE = '__Host-bos_dev'
const VICTIM = 'victim-approved-device-01'

function setup(mutate = (t) => t, envPatch = {}) {
  let deviceTrust = null
  let cookieLib = null
  const h = createAuthHarness({
    overrides: {
      '../lib/deviceCookie': new Proxy({}, { get: (_t, key) => cookieLib[key] }),
      '../lib/deviceTrust': {
        requiresDeviceApproval: (...args) => deviceTrust.requiresDeviceApproval(...args),
        checkDeviceTrust: (...args) => deviceTrust.checkDeviceTrust(...args),
      },
    },
  })
  Object.assign(h.env, envPatch)
  const stubs = { './db': { getDb: () => h.db }, './audit': { audit: async () => {} }, '../durable-objects/broadcastHub': { broadcast: async () => {} } }
  const cache = new Map()
  deviceTrust = loadTs('lib/deviceTrust.ts', stubs, mutate, cache)
  cookieLib = loadTs('lib/deviceCookie.ts', stubs, mutate, cache)
  h.raw.prepare(`INSERT INTO roles (id, code, name, permissions, is_system) VALUES (1, 'admin', 'Administrator', '{"all":true}', 1), (2, 'cashier', 'Cashier', '{"pos":true}', 0)`).run({})
  h.addUser({ id: 10, username: 'sokha', name: 'Sokha', roleCode: 'cashier' })
  h.addUser({ id: 11, username: 'owner', name: 'Owner', roleCode: 'admin' })
  return { h, cookieLib }
}

const rows = (h) => h.raw.prepare('SELECT device_id, status, cookie_bound_at FROM trusted_devices WHERE user_id = 10 ORDER BY id').all({}).map((r) => ({ ...r }))
const approve = (h, deviceId) => h.raw.prepare("INSERT INTO trusted_devices (user_id, device_id, status, decided_at) VALUES (10, @deviceId, 'approved', CURRENT_TIMESTAMP)").run({ deviceId })
async function signIn(w, { deviceId, cookieFor } = {}) {
  const headers = { 'User-Agent': UA }
  if (cookieFor) headers.Cookie = `${COOKIE}=${await w.cookieLib.signDeviceCookieValue(w.h.env, cookieFor)}`
  return w.h.request('/login', 'POST', { username: 'sokha', password: 'correct-horse', deviceId, deviceName: 'Phone' }, { ip: '203.0.113.5', headers })
}
const lastCookieId = (res) => {
  const line = res.headers.getSetCookie().filter((l) => l.startsWith(`${COOKIE}=`)).pop()
  return line ? decodeURIComponent(line.split(';')[0].slice(COOKIE.length + 1)).split('.')[0] : null
}

const SESSION = 'live-session-token-0001'
const addSession = (h, userId, deviceId, { revoked = false } = {}) => h.raw.prepare(`INSERT INTO user_sessions (user_id, token_hash, device_id, expires_at, revoked_at)
  VALUES (@userId, @hash, @deviceId, '2999-01-01', CASE WHEN @revoked = 1 THEN CURRENT_TIMESTAMP END)`).run({ userId, deviceId, revoked: revoked ? 1 : 0, hash: createHash('sha256').update(SESSION).digest('hex') })
async function me(w, { actorId = 10, cookieFor, path: route = '/me' } = {}) {
  const headers = { 'User-Agent': UA, Cookie: `bos_session=${SESSION}` }
  if (cookieFor) headers.Cookie += `; ${COOKIE}=${await w.cookieLib.signDeviceCookieValue(w.h.env, cookieFor)}`
  const statements = []
  const prepare = w.h.db.prepare.bind(w.h.db)
  w.h.db.prepare = (sql) => { statements.push(sql); return prepare(sql) }
  try {
    const res = await w.h.request(route, 'GET', undefined, { actorId, headers })
    return { res, statements }
  } finally { w.h.db.prepare = prepare }
}

let passed = 0
const failures = []
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}: ${String(error.message).split(/\r?\n/)[0]}`.slice(0, 400))
  }
}

async function suite(mutate, label) {
  failures.length = 0
  passed = 0
  console.log(`\n== ${label}`)

  await check('a. transition: an approved row with no cookie yet signs in with its body id once, gets the cookie, and is bound', async () => {
    const w = setup(mutate)
    approve(w.h, VICTIM)
    assert.equal(rows(w.h)[0].cookie_bound_at, null)
    const res = await signIn(w, { deviceId: VICTIM })
    assert.equal(res.body.success, true)
    assert.equal(lastCookieId(res), VICTIM)
    assert.ok(rows(w.h)[0].cookie_bound_at, 'bound by that sign-in')
  })

  await check('b. after binding, the same id in a body with no cookie gets a fresh pending id; the approved row is untouched', async () => {
    const w = setup(mutate)
    approve(w.h, VICTIM)
    await signIn(w, { deviceId: VICTIM })
    const attack = await signIn(w, { deviceId: VICTIM })
    assert.equal(attack.body.deviceApprovalRequired, true)
    assert.notEqual(attack.body.deviceId, VICTIM, 'told to adopt a new id')
    assert.equal(lastCookieId(attack), attack.body.deviceId, 'the cookie is pinned to the new id, not the victim id')
    assert.ok(attack.body.deviceTicket, 'a ticket for the new id so the waiting screen works')
    const approvedRowId = w.h.raw.prepare('SELECT id FROM trusted_devices WHERE device_id = @d').get({ d: VICTIM }).id
    assert.equal(w.h.raw.prepare('SELECT claimed_approval_ref AS c FROM trusted_devices WHERE device_id = @d').get({ d: attack.body.deviceId }).c, approvedRowId, 'the pending row records which approved device it claimed (L4)')
    const pendingAudit = w.h.audits.filter((a) => a[3] === 'login_device_pending').pop()
    assert.equal(pendingAudit[6].claimedTrustedDeviceRowId, approvedRowId, 'and so does its audit row')
    const state = rows(w.h)
    assert.equal(state.find((r) => r.device_id === VICTIM).status, 'approved')
    assert.deepEqual(state.filter((r) => r.device_id !== VICTIM).map((r) => r.status), ['pending'])
    const retry = await signIn(w, { deviceId: attack.body.deviceId, cookieFor: attack.body.deviceId })
    assert.equal(retry.body.deviceApprovalRequired, true)
    assert.equal(rows(w.h).length, 2, 'the retry reuses the new pending row')
  })

  await check('c. review probe: the attacker\'s own pending cookie plus the victim approved id in the body is still pending (cookie wins)', async () => {
    const w = setup(mutate)
    approve(w.h, VICTIM)
    const first = await signIn(w, { deviceId: 'attacker-own-device-1' })
    assert.equal(first.body.deviceApprovalRequired, true)
    const probe = await signIn(w, { deviceId: VICTIM, cookieFor: 'attacker-own-device-1' })
    assert.equal(probe.body.deviceApprovalRequired, true)
    assert.equal(probe.body.deviceId, 'attacker-own-device-1')
  })

  await check('d. the genuine browser (cookie and body agree) keeps signing in', async () => {
    const w = setup(mutate)
    approve(w.h, VICTIM)
    await signIn(w, { deviceId: VICTIM })
    for (let n = 0; n < 2; n++) assert.equal((await signIn(w, { deviceId: VICTIM, cookieFor: VICTIM })).body.success, true)
    assert.equal((await signIn(w, { deviceId: 'stale-local-id-0001', cookieFor: VICTIM })).body.success, true, 'a stale body id is ignored when the cookie is right')
  })

  await check('e. a first pending sign-in also binds, so approving it later gives a bound row', async () => {
    const w = setup(mutate)
    const first = await signIn(w, { deviceId: 'new-browser-device-1' })
    assert.equal(first.body.deviceApprovalRequired, true)
    assert.ok(rows(w.h)[0].cookie_bound_at)
    w.h.raw.prepare("UPDATE trusted_devices SET status = 'approved'").run({})
    assert.equal((await signIn(w, { deviceId: 'new-browser-device-1' })).body.deviceApprovalRequired, true, 'its id without its cookie is refused')
    assert.equal((await signIn(w, { deviceId: 'new-browser-device-1', cookieFor: 'new-browser-device-1' })).body.success, true)
  })

  await check('f. with no signing key (no cookies exist) nothing is bound and the body id still works', async () => {
    const w = setup(mutate, { APP_ENCRYPTION_KEY: undefined })
    approve(w.h, VICTIM)
    assert.equal((await signIn(w, { deviceId: VICTIM })).body.success, true)
    assert.equal(rows(w.h)[0].cookie_bound_at, null)
    assert.equal((await signIn(w, { deviceId: VICTIM })).body.success, true)
  })

  await check('g. a long session that never passes /login again is bound and given the cookie on /me and /bootstrap (L3), and then the id alone no longer works', async () => {
    const routeText = fs.readFileSync(path.join(SRC, 'routes/auth.ts'), 'utf8')
    assert.equal(routeText.split('if (requiresDeviceApproval(user)) await adoptSessionDeviceCookie(c, user.id)').length - 1, 2, '/me and /bootstrap both adopt (the harness stubs the session layer /bootstrap needs, so it is pinned by source)')
    for (const route of ['/me']) {
      const w = setup(mutate)
      approve(w.h, VICTIM)
      addSession(w.h, 10, VICTIM)
      const { res } = await me(w, { path: route })
      assert.equal(res.status, 200, `${route} answered ${res.status}`)
      assert.equal(lastCookieId(res), VICTIM, `${route} set the cookie`)
      assert.ok(rows(w.h)[0].cookie_bound_at, `${route} bound the row`)
      const attack = await signIn(w, { deviceId: VICTIM })
      assert.equal(attack.body.deviceApprovalRequired, true, 'the id without its cookie is refused from now on')
    }
  })

  await check('h. the ordinary request costs no D1 call; only a browser without the cookie costs one UPDATE; a bound row, a revoked session, an admin, another account never bind', async () => {
    const w = setup(mutate)
    approve(w.h, VICTIM)
    addSession(w.h, 10, VICTIM)
    const withCookie = await me(w, { cookieFor: VICTIM })
    assert.equal(withCookie.statements.length, 0, 'a valid cookie: no statement at all')
    assert.equal(rows(w.h)[0].cookie_bound_at, null, 'and nothing is bound by it')
    const bare = await me(w)
    assert.equal(bare.statements.length, 1, 'no cookie: one UPDATE ... RETURNING')
    assert.equal(lastCookieId(bare.res), VICTIM)
    const again = await me(w)
    assert.equal(again.statements.length, 1)
    assert.equal(lastCookieId(again.res), null, 'a bound row is not re-issued its cookie from a session')
    const w2 = setup(mutate)
    approve(w2.h, VICTIM)
    addSession(w2.h, 10, VICTIM, { revoked: true })
    assert.equal(lastCookieId((await me(w2)).res), null, 'a revoked session proves nothing')
    assert.equal(rows(w2.h)[0].cookie_bound_at, null)
    const w3 = setup(mutate)
    approve(w3.h, VICTIM)
    addSession(w3.h, 11, VICTIM)
    const admin = await me(w3, { actorId: 11 })
    assert.equal(admin.statements.length, 0, 'administrators have no device gate and cost nothing')
    assert.equal(rows(w3.h)[0].cookie_bound_at, null, "another account's row is never bound")
  })

  await check('i. the session cookie name used by the helper is the one lib/auth.ts sets', () => {
    const auth = fs.readFileSync(path.join(SRC, 'lib/auth.ts'), 'utf8')
    const cookie = fs.readFileSync(path.join(SRC, 'lib/deviceCookie.ts'), 'utf8')
    assert.equal(/const SESSION_COOKIE_NAME = '([^']+)'/.exec(auth)[1], /const SESSION_COOKIE_NAME = '([^']+)'/.exec(cookie)[1])
  })

  console.log(`   ${passed} passed, ${failures.length} failed`)
  return [...failures]
}

const inFile = (file, from, to) => (text, rel) => (rel === file ? text.replace(from, to) : text)
const mutants = [
  ['bound rows no longer refuse a cookie-less id', inFile('lib/deviceTrust.ts', 'existing.cookie_bound_at && !meta.cookieVerified', 'false'), ['b.', 'e.']],
  ['the body id wins over the cookie again', inFile('lib/deviceCookie.ts', 'const chosen = cookieId || body', 'const chosen = body || cookieId'), ['c.']],
  ['the session never binds an unbound row', inFile('lib/deviceCookie.ts', 'const token = getCookie(c, SESSION_COOKIE_NAME)', 'const token = null as string | null'), ['g.', 'h.']],
  ['a bound row is re-issued its cookie by a session', inFile('lib/deviceCookie.ts', ' AND cookie_bound_at IS NULL', ''), ['h.']],
  ['binding never happens', inFile('lib/deviceTrust.ts', "cookie_bound_at = COALESCE(cookie_bound_at, CASE WHEN @bind = 1 THEN CURRENT_TIMESTAMP END)", 'cookie_bound_at = cookie_bound_at'), ['a.']],
]

async function main() {
  const base = await suite((t) => t, 'real code')
  let bad = base.length
  for (const [name, mutate, expectRed] of mutants) {
    const red = await suite(mutate, `mutant: ${name}`)
    const missing = expectRed.filter((prefix) => !red.some((n) => n.startsWith(prefix)))
    if (missing.length) { console.log(`MUTANT SURVIVED: ${name}; ${missing.join(', ')} stayed green`); bad += 1 } else console.log(`mutant killed: ${name} (red: ${red.map((n) => n.split('.')[0]).join(', ')})`)
  }
  if (bad) { console.log(`\n${bad} problem(s)`); process.exit(1) }
  console.log('\ntest-device-cookie-bound-pure: all checks passed and every mutant was killed')
}
main().catch((error) => { console.error(error); process.exit(1) })
