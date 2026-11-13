// B8 review N-1: the session read has two optional columns, users.must_change_password (migration 0202) and the adoption question over
// trusted_devices.cookie_bound_at (migration 0304). A missing column must be recognised BY NAME. The old fallback matched any "no such column", so on a D1
// without 0304 the first /api/auth/me failed, flipped the per-isolate must-change flag, and from then on every route in that isolate stopped seeing
// must_change_password: forced password change silently off.
//
// Drives the REAL lib/auth.ts with real Hono and the real migrations in SQLite, through 0303 (no cookie_bound_at) and through 0304, and through the
// real adoption call. The mutant (the old broad regex) must turn the pre-0304 checks red.
//
// Run: node scripts/test-session-lookup-missing-column-pure.cjs
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
const ENV = { APP_ENCRYPTION_KEY: 'synthetic-key-for-the-session-lookup-test-0123456789' }
const CTX = { waitUntil() {}, passThroughOnException() {} }

// A fresh module set per call is a fresh isolate: the must-change flag is module state.
function isolate({ through, dropMustChange = false }, mutate = (t) => t) {
  const raw = openDb(loadAll(through == null ? {} : { through }))
  if (dropMustChange) raw.prepare('ALTER TABLE users DROP COLUMN must_change_password').run({})
  const log = []
  const db = { prepare: (sql) => { log.push(sql); return raw.prepare(sql) } }
  const overrides = { './db': { getDb: () => db }, '../index': {} }
  const cache = new Map()
  const auth = loadTs('lib/auth.ts', overrides, mutate, cache)
  const cookieLib = loadTs('lib/deviceCookie.ts', overrides, mutate, cache)
  raw.prepare(`INSERT INTO roles (id, code, name, permissions, is_system) VALUES (1, 'cashier', 'Cashier', '{"pos":true}', 0)`).run({})
  raw.prepare(`INSERT INTO users (id, username, name, password, permissions, role_id, is_active) VALUES (10, 'sokha', 'sokha', 'x', '{}', 1, 1)`).run({})
  if (!dropMustChange) raw.prepare('UPDATE users SET must_change_password = 1 WHERE id = 10').run({})
  raw.prepare(`INSERT INTO trusted_devices (user_id, device_id, device_name, status, decided_at) VALUES (10, 'phone-device-0001', 'Phone', 'approved', CURRENT_TIMESTAMP)`).run({})
  raw.prepare(`INSERT INTO user_sessions (user_id, token_hash, device_id, expires_at, last_seen_at) VALUES (10, @hash, 'phone-device-0001', '2999-01-01', @seen)`).run({ hash: TOKEN_HASH, seen: new Date().toISOString() })
  const app = new Hono()
  const meLike = async (c) => {
    try {
      const user = await auth.getSessionUser(c)
      if (!user) return c.json({ error: 'no session' }, 401)
      // only the two routes that really adopt (routes/auth.ts): /me and /bootstrap
      if (c.req.path === '/api/auth/me' || c.req.path === '/api/auth/bootstrap') await cookieLib.adoptSessionDeviceCookie(c, user.id)
      return c.json({ user: { must_change_password: user.must_change_password ?? null, leaked: 'session_device_adoptable' in user } })
    } catch (error) {
      return c.json({ error: String(error.message) }, 500)
    }
  }
  app.get('/api/auth/me', meLike)
  app.get('/api/auth/bootstrap', meLike)
  app.get('/api/portal/auth/me', meLike)
  app.get('/api/other', meLike)
  const call = async (route) => {
    log.length = 0
    const res = await app.request(route, { headers: { Cookie: `bos_session=${TOKEN}` } }, ENV, CTX)
    const body = await res.json().catch(() => ({}))
    return { status: res.status, body, lookups: log.filter((s) => /FROM user_sessions s\b/.test(s)), failedFirst: false, statements: log.length }
  }
  return { raw, call, log }
}

let results = []
async function check(name, fn) {
  try { await fn(); results.push([name, null]) } catch (error) { results.push([name, String(error.message).split('\n')[0]]) }
}

async function suite(mutate) {
  results = []
  await check('pre-0304: /me answers 200 and must_change_password stays enforced on every route after it', async () => {
    const w = isolate({ through: 303 }, mutate)
    assert.equal((await w.call('/api/other')).body.user.must_change_password, 1, 'before /me')
    const me = await w.call('/api/auth/me')
    assert.equal(me.status, 200, `/me status ${me.status} ${JSON.stringify(me.body)}`)
    assert.equal(me.body.user.must_change_password, 1, '/me itself')
    for (const route of ['/api/other', '/api/auth/bootstrap', '/api/portal/auth/me', '/api/auth/me']) {
      const r = await w.call(route)
      assert.equal(r.status, 200, `${route} status`)
      assert.equal(r.body.user.must_change_password, 1, `${route} still enforces the forced change after /me`)
    }
  })
  await check('pre-0304: /bootstrap first is just as safe, and the adoption answer never reaches the user object', async () => {
    const w = isolate({ through: 303 }, mutate)
    const b = await w.call('/api/auth/bootstrap')
    assert.equal(b.status, 200)
    assert.equal(b.body.user.must_change_password, 1)
    assert.equal(b.body.user.leaked, false)
    assert.equal((await w.call('/api/other')).body.user.must_change_password, 1)
  })
  await check('0304+: /me asks the adoption question inside the one session read, forced change enforced, one read', async () => {
    const w = isolate({}, mutate)
    const me = await w.call('/api/auth/me')
    assert.equal(me.status, 200)
    assert.equal(me.body.user.must_change_password, 1)
    assert.equal(me.lookups.length, 1, 'one session read')
    assert.ok(/session_device_adoptable/.test(me.lookups[0]), 'the question rides it')
    const other = await w.call('/api/other')
    assert.equal(other.lookups.length, 1)
    assert.ok(!/session_device_adoptable/.test(other.lookups[0]))
    assert.equal(other.body.user.must_change_password, 1)
  })
  await check('a D1 without must_change_password (pre-0202) still reads, and an unrelated error is not swallowed', async () => {
    const w = isolate({ through: 303, dropMustChange: true }, mutate)
    const me = await w.call('/api/auth/me')
    assert.equal(me.status, 200, `status ${me.status} ${JSON.stringify(me.body)}`)
    assert.equal(me.body.user.must_change_password, null)
    assert.equal((await w.call('/api/other')).status, 200)
    const broken = isolate({}, mutate)
    broken.raw.prepare('DROP TABLE roles').run({})
    assert.equal((await broken.call('/api/other')).status, 500, 'a different missing table still fails loudly')
  })
  return results.filter(([, e]) => e).map(([n]) => n)
}

function replaceIn(text, rel, from, to) {
  if (rel !== 'lib/auth.ts') return text
  assert.ok(text.includes(from), `mutant needs ${from.slice(0, 60)}`)
  return text.replace(from, to)
}

async function main() {
  let bad = 0
  bad += (await suite((t) => t)).length
  for (const [n, e] of results) console.log(`${e ? 'FAIL' : 'PASS'} ${n}${e ? `: ${e}` : ''}`)

  // The shipped B8 shape: the adoption column inside the broad fallback.
  const old = (t, rel) => replaceIn(
    replaceIn(t, rel, "probeAdoption && /no such column:\\s*(td|o)\\.cookie_bound_at/i.test(message)", 'false'),
    rel, '/no such column:\\s*(u\\.)?must_change_password\\b/i.test(message)', '/no such column/i.test(message)')
  const red = await suite(old)
  if (red.some((n) => n.startsWith('pre-0304: /me answers 200'))) console.log('mutant killed: the old broad "no such column" regex')
  else { console.log('MUTANT SURVIVED: the old broad "no such column" regex'); bad += 1 }

  if (bad) { console.log(`\n${bad} problem(s)`); process.exit(1) }
  console.log('\ntest-session-lookup-missing-column-pure: all checks passed and every mutant was killed')
}
main().catch((error) => { console.error(error); process.exit(1) })
