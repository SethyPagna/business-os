// B8 L-e: /me and /bootstrap used to run the device-cookie adoption UPDATE for every browser without a valid device cookie, including rows that can
// never be adopted (already bound, or refused because another account bound the id): one statement per call that always wrote 0 rows. The session
// read now answers "could any row be adopted" inside the SAME statement, only on /me and /bootstrap and only for a browser that sent no device
// cookie, and the adoption skips its UPDATE when the answer is no. No extra D1 call anywhere; every other request's session read is unchanged.
//
// Drives the REAL lib/auth.ts and lib/deviceCookie.ts with real Hono, real hono/cookie and the real migrations in SQLite, and counts the statements
// each request prepares. The mutants at the end must turn the named checks red.
//
// Run: node scripts/test-session-adoption-probe-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

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

const TOKEN = 'live-session-token-0001'
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex')
const DEVICE_COOKIE = '__Host-bos_dev'
const ENV = { APP_ENCRYPTION_KEY: 'synthetic-key-for-the-adoption-probe-test-0123456789' }

function setup(mutate = (text) => text) {
  const raw = openDb(loadAll())
  const log = []
  const db = { prepare: (sql) => { log.push(sql); return raw.prepare(sql) } }
  const overrides = { './db': { getDb: () => db }, '../index': {} }
  const cache = new Map()
  const auth = loadTs('lib/auth.ts', overrides, mutate, cache)
  const cookieLib = loadTs('lib/deviceCookie.ts', overrides, mutate, cache)
  raw.prepare(`INSERT INTO roles (id, code, name, permissions, is_system) VALUES (1, 'cashier', 'Cashier', '{"pos":true}', 0)`).run({})
  for (const [id, username] of [[10, 'sokha'], [12, 'dara']]) {
    raw.prepare(`INSERT INTO users (id, username, name, password, permissions, role_id, is_active) VALUES (@id, @username, @username, 'x', '{}', 1, 1)`).run({ id, username })
  }
  const app = new Hono()
  const handler = async (c) => {
    const user = await auth.getSessionUser(c)
    if (!user) return c.json({ error: 'no session' }, 401)
    await cookieLib.adoptSessionDeviceCookie(c, user.id)
    return c.json({ ok: true })
  }
  app.get('/api/auth/me', handler)
  app.get('/api/auth/bootstrap', handler)
  app.get('/api/other', handler)
  return { raw, log, app, cookieLib }
}

const addRow = (w, userId, deviceId, { bound = false, status = 'approved' } = {}) => w.raw.prepare(`INSERT INTO trusted_devices (user_id, device_id, device_name, status, decided_at, cookie_bound_at)
  VALUES (@userId, @deviceId, 'Phone', @status, CURRENT_TIMESTAMP, CASE WHEN @bound = 1 THEN CURRENT_TIMESTAMP END)`).run({ userId, deviceId, status, bound: bound ? 1 : 0 })
const addSession = (w, userId, deviceId) => w.raw.prepare(`INSERT INTO user_sessions (user_id, token_hash, device_id, expires_at, last_seen_at) VALUES (@userId, @hash, @deviceId, '2999-01-01', @seen)`)
  .run({ userId, deviceId, hash: TOKEN_HASH, seen: new Date().toISOString() })
async function call(w, route, { deviceCookie } = {}) {
  w.log.length = 0
  const headers = { Cookie: `bos_session=${TOKEN}${deviceCookie ? `; ${DEVICE_COOKIE}=${deviceCookie}` : ''}` }
  const res = await w.app.request(route, { headers }, ENV, { waitUntil() {}, passThroughOnException() {} })
  assert.equal(res.status, 200, `${route} answers 200`)
  const lookups = w.log.filter((sql) => /FROM user_sessions s\b/.test(sql))
  return {
    updates: w.log.filter((sql) => /UPDATE trusted_devices SET cookie_bound_at/.test(sql)).length,
    lookupAsksAdoptable: lookups.length === 1 && /session_device_adoptable/.test(lookups[0]),
    lookups: lookups.length,
    setCookie: res.headers.get('set-cookie') || '',
  }
}
const boundAt = (w, userId, deviceId) => w.raw.prepare('SELECT cookie_bound_at AS b FROM trusted_devices WHERE user_id = @userId AND device_id = @deviceId').get({ userId, deviceId }).b

let failures = []
async function check(name, fn, mutated = false) {
  try { await fn(); if (!mutated) console.log(`PASS ${name}`) } catch (error) { failures.push(name); if (!mutated) console.log(`FAIL ${name}: ${String(error.message).split('\n')[0]}`); else throw error }
}

async function suite(mutate, label) {
  failures = []
  console.log(`== ${label}`)
  await check('a. an adoptable row (approved, unbound, nobody else bound) still adopts: the session read asks inside its own statement, one UPDATE, the cookie is set', async () => {
    const w = setup(mutate)
    addRow(w, 10, 'phone-device-0001'); addSession(w, 10, 'phone-device-0001')
    const r = await call(w, '/api/auth/me')
    assert.equal(r.lookupAsksAdoptable, true)
    assert.equal(r.updates, 1)
    assert.ok(r.setCookie.includes(DEVICE_COOKIE), 'the device cookie is set')
    assert.notEqual(boundAt(w, 10, 'phone-device-0001'), null, 'the row is bound')
  })
  await check('b. a row another account has bound (the HF shape) costs no UPDATE on /me or /bootstrap, and never gets the cookie', async () => {
    const w = setup(mutate)
    addRow(w, 12, 'shared-device-0001', { bound: true }); addRow(w, 10, 'shared-device-0001'); addSession(w, 10, 'shared-device-0001')
    for (const route of ['/api/auth/me', '/api/auth/bootstrap']) {
      const r = await call(w, route)
      assert.equal(r.updates, 0, `${route}: no UPDATE for a row that can never be adopted`)
      assert.equal(r.lookups, 1, `${route}: one session read`)
      assert.equal(r.setCookie, '', `${route}: no cookie`)
    }
    assert.equal(boundAt(w, 10, 'shared-device-0001'), null, 'still not bound')
  })
  await check('c. a bound row whose cookie was lost, and a session with no device row at all, cost no UPDATE', async () => {
    const w = setup(mutate)
    addRow(w, 10, 'bound-device-00001', { bound: true }); addSession(w, 10, 'bound-device-00001')
    assert.equal((await call(w, '/api/auth/me')).updates, 0, 'bound row')
    w.raw.prepare('DELETE FROM user_sessions').run({})
    addSession(w, 10, 'no-row-device-0001')
    assert.equal((await call(w, '/api/auth/me')).updates, 0, 'no row')
  })
  await check('d. no other route pays for the question: the session read there is the unchanged statement', async () => {
    const w = setup(mutate)
    addRow(w, 10, 'phone-device-0002'); addSession(w, 10, 'phone-device-0002')
    const r = await call(w, '/api/other')
    assert.equal(r.lookupAsksAdoptable, false, 'no adoptable column on another route')
    assert.equal(r.lookups, 1)
  })
  await check('e. a browser that already sent a device cookie does not ask either (adoption returns before it on a valid cookie; the read stays unchanged on any)', async () => {
    const w = setup(mutate)
    addRow(w, 10, 'phone-device-0003'); addSession(w, 10, 'phone-device-0003')
    const valid = await w.cookieLib.signDeviceCookieValue(ENV, 'phone-device-0003')
    const r = await call(w, '/api/auth/me', { deviceCookie: valid })
    assert.equal(r.lookupAsksAdoptable, false)
    assert.equal(r.updates, 0)
  })
  await check('f. the names lib/auth.ts repeats are the ones lib/deviceCookie.ts owns (the files may not import each other)', async () => {
    const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')
    const authText = read('lib/auth.ts')
    const cookieText = read('lib/deviceCookie.ts')
    assert.equal(/PROBE_DEVICE_COOKIE = '([^']+)'/.exec(authText)[1], /export const DEVICE_COOKIE_NAME = '([^']+)'/.exec(cookieText)[1], 'the device cookie name')
    assert.equal(/ADOPTABLE_CONTEXT_KEY = '([^']+)'/.exec(authText)[1], /SESSION_ADOPTABLE_CONTEXT_KEY = '([^']+)'/.exec(cookieText)[1], 'the context key')
    const routes = read('routes/auth.ts')
    assert.equal(routes.split('if (requiresDeviceApproval(user)) await adoptSessionDeviceCookie(c, user.id)').length - 1, 2, 'both /me and /bootstrap adopt, which is what the path pattern covers')
    assert.ok(!/session_device_adoptable/.test(authText.slice(authText.indexOf('...user\n  } = row') + 12)), 'the answer is not left on the user object that /me returns')
  })
  return failures
}

const inFile = (file, from, to) => (text, rel) => {
  if (rel !== file) return text
  assert.ok(text.includes(from), `mutant needs ${from.slice(0, 50)}`)
  return text.replace(from, to)
}
const mutants = [
  ['adoption ignores the answer and always runs its UPDATE', inFile('lib/deviceCookie.ts', "get(SESSION_ADOPTABLE_CONTEXT_KEY) === false) return", "get(SESSION_ADOPTABLE_CONTEXT_KEY) === 'never') return"), ['b.', 'c.']],
  ['every route asks the question in its session read', inFile('lib/auth.ts', "return /\\/auth\\/(me|bootstrap)$/.test(String(c.req?.path ?? '')) && !getCookie(c, PROBE_DEVICE_COOKIE)", 'return true'), ['d.', 'e.']],
  ['a browser with a device cookie asks too', inFile('lib/auth.ts', ' && !getCookie(c, PROBE_DEVICE_COOKIE)', ''), ['e.']],
  ['the answer says no for an adoptable row', inFile('lib/auth.ts', 'td.cookie_bound_at IS NULL AND td.device_id = s.device_id', 'td.cookie_bound_at IS NOT NULL AND td.device_id = s.device_id'), ['a.']],
  ['the answer forgets that another account bound the id', inFile('lib/auth.ts', 'AND NOT EXISTS (SELECT 1 FROM trusted_devices o WHERE o.device_id = td.device_id AND o.user_id <> td.user_id AND o.cookie_bound_at IS NOT NULL)', ''), ['b.']],
]

async function main() {
  let bad = (await suite((t) => t, 'real code')).length
  for (const [name, mutate, expectRed] of mutants) {
    const red = await suite(mutate, `mutant: ${name}`)
    const missing = expectRed.filter((prefix) => !red.some((n) => n.startsWith(prefix)))
    if (missing.length) { console.log(`MUTANT SURVIVED: ${name}; checks ${missing.join(', ')} stayed green`); bad += 1 }
    else console.log(`mutant killed: ${name}`)
  }
  if (bad) { console.log(`\n${bad} problem(s)`); process.exit(1) }
  console.log('\ntest-session-adoption-probe-pure: all checks passed and every mutant was killed')
}
main().catch((error) => { console.error(error); process.exit(1) })
