// G38 S3f (T-F3, T-F4, T-F5, T-F6, T-F9, T-F10): the storefront session read, the hourly stamp, the slide and the devices.
//
// Runs the REAL lib/portalSession.ts, transpiled, on in-memory SQLite with every real migration applied. Only
// hono/cookie and the Hono context are stubbed. Every rule has one mutant, run on a changed copy of the source:
// the test names the mutant and fails when it is not caught.
//
//   T-F3  two requests inside the hour -> one stamp, with last_seen_at stored in the DEFAULT format earlier the same day
//   T-F4  a session created 500 days ago with 150 days left: two requests -> at most one slide write
//   T-F5  the slide extends a session past its half-life and never shortens one
//   T-F6  the session read is one statement per request (warm), and a fresh session writes nothing
//   T-F9  countPortalDevices and revokeOtherPortalSessions at the library level
//   T-F10 createPortalSession writes created_at and last_seen_at in ISO
//
// Run (from cloudflare/): node scripts/test-portal-session-touch-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { loadRealPasswordHash, loadRealFailedSignInCost } = require('./harness/password_hash_stub.cjs')
const { openDb } = require('./harness/d1compat.cjs')

const SRC = path.join(__dirname, '..', 'src')
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')
const HOUR = 3600 * 1000
const DAY = 24 * HOUR

function loadSource(text, relPath, requireOverrides = {}) {
  const sourcePath = path.join(SRC, relPath)
  const { outputText } = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const moduleObj = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
    return moduleObj.exports
  } finally {
    Module._load = originalLoad
  }
}
const readSrc = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')
const loadReal = (rel, overrides) => loadSource(readSrc(rel), rel, overrides)

const migrations = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))

// One world per scenario group: its own database, a log of every statement and its changes.
let readDelayMs = 0
const pause = () => (readDelayMs ? new Promise((resolve) => setTimeout(resolve, readDelayMs)) : null)
function world() {
  const raw = openDb(migrations)
  const log = []
  const db = {
    prepare(sql) {
      const stmt = raw.prepare(sql)
      return {
        get: async (p) => { log.push({ sql, kind: 'read' }); const r = stmt.get(p); await pause(); return r },
        all: async (p) => { log.push({ sql, kind: 'read' }); const r = stmt.all(p) || []; await pause(); return r },
        run: async (p) => {
          const r = stmt.run(p)
          const changes = r.meta?.changes ?? 0
          log.push({ sql, kind: 'write', changes })
          return { changes, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
        },
      }
    },
    batch: (items) => raw.batch(items),
  }
  return { raw, db, log }
}

const phone = loadReal('lib/phone.ts')
const anonymousCustomer = loadReal('lib/anonymousCustomer.ts')
const planTier = loadReal('lib/planTier.ts')
const telegramToken = loadReal('lib/portalTelegramToken.ts', { './phone': phone, './planTier': planTier })
const jar = { value: null }
const cookieStub = {
  getCookie: () => jar.value,
  setCookie: (_c, _n, value, options) => { jar.value = value; jar.options = options },
  deleteCookie: () => { jar.value = null },
}

function sessionModule(db, source = readSrc('lib/portalSession.ts')) {
  const accounts = loadReal('lib/portalAccounts.ts', {
    './db': { getDb: () => db },
    './cache': { bumpVersions: async () => {} },
    './membershipNumber': {},
    './phone': phone,
    './passwordPolicy': {},
    './contactDuplicates': {},
    './anonymousCustomer': anonymousCustomer,
    './passwordHash': loadRealPasswordHash(),
    './failedSignInCost': loadRealFailedSignInCost(),
    './memberCode': loadReal('lib/memberCode.ts'),
  })
  return loadSource(source, 'lib/portalSession.ts', {
    './db': { getDb: () => db },
    './portalAccounts': accounts,
    './anonymousCustomer': anonymousCustomer,
    './planTier': planTier,
    './portalTelegramToken': telegramToken,
    'hono/cookie': cookieStub,
  })
}

// A settable clock. `tick` > 0 advances it one step per read, so two concurrent requests see different instants.
const realNow = Date.now
let clock = Date.parse('2026-11-24T10:00:00.000Z')
let tick = 0
Date.now = () => { const v = clock; clock += tick; return v }

const iso = (ms) => new Date(ms).toISOString()
const dflt = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
const asUtc = (value) => {
  const text = String(value).trim()
  const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text.replace(' ', 'T') : `${text.replace(' ', 'T')}Z`
  return Date.parse(normalized)
}
async function hashOf(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

let seq = 0
function seedAccount(raw) {
  seq += 1
  const r = raw.prepare(
    `INSERT INTO portal_accounts (membership_id, name, phone, password_hash, consent_version, consent_at, consent_locale, age_confirmed_at)
     VALUES (@m, 'Touch Test', @p, 'x', 'portal-legal-2026-10-20', CURRENT_TIMESTAMP, 'en', CURRENT_TIMESTAMP)`,
  ).run({ m: `LC-7${String(seq).padStart(4, '0')}`, p: `0707776${String(seq).padStart(2, '0')}` })
  return Number(r.meta?.last_row_id ?? 0)
}

// A request: the Hono context with its own deferred work, which the caller settles.
function request(env = {}) {
  const pending = []
  const ctx = { env, executionCtx: { waitUntil: (p) => { pending.push(p) } } }
  return { ctx, settle: async () => { while (pending.length) await pending.shift() } }
}
const stamps = (log) => log.filter((e) => e.kind === 'write' && /SET last_seen_at/.test(e.sql) && /UPDATE portal_sessions/.test(e.sql))
const slides = (log) => log.filter((e) => e.kind === 'write' && /UPDATE portal_sessions SET expires_at/.test(e.sql))
const changed = (list) => list.reduce((n, e) => n + e.changes, 0)

async function newSession(w, mod, fields = {}) {
  const accountId = seedAccount(w.raw)
  const { token } = await mod.createPortalSession({}, accountId)
  const hash = await hashOf(token)
  const set = Object.entries(fields)
  if (set.length) {
    w.raw.prepare(`UPDATE portal_sessions SET ${set.map(([k]) => `${k} = @${k}`).join(', ')} WHERE token_hash = @h`).run({ ...fields, h: hash })
  }
  jar.value = token
  w.log.length = 0
  return { accountId, token, hash }
}
const rowOf = (w, hash) => w.raw.prepare('SELECT * FROM portal_sessions WHERE token_hash = ?').get([hash])

let passed = 0
const failures = []
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n  ${error && error.message}`) }
}
// A mutant: the source with one change; `catches` must go red on it, and the change must have applied.
async function mutant(label, from, to, catches) {
  const source = readSrc('lib/portalSession.ts')
  const changedSource = source.replace(from, to)
  assert.notEqual(changedSource, source, `mutant "${label}" did not apply: the source no longer holds the text it replaces`)
  let red = false
  try { await catches(changedSource) } catch (e) { red = true; if (process.env.SHOW_MUTANT_REASON) console.log('   ->', String(e.message).split('\n')[0]) }
  assert.ok(red, `mutant "${label}" stayed green`)
}

// ---- T-F3 ----------------------------------------------------------------
async function scenarioStamp(source) {
  const w = world()
  const mod = sessionModule(w.db, source)
  tick = 0
  clock = Date.parse('2026-11-24T10:00:00.000Z')
  const s = await newSession(w, mod, { last_seen_at: null })
  const first = request()
  assert.equal((await mod.getPortalAccountState(first.ctx)).status, 'authenticated')
  await first.settle()
  clock += 10 * 60 * 1000
  const second = request()
  assert.equal((await mod.getPortalAccountState(second.ctx)).status, 'authenticated')
  await second.settle()
  assert.equal(stamps(w.log).length, 1, 'two requests inside the hour attempt exactly one stamp')
  assert.equal(changed(stamps(w.log)), 1)
  assert.equal(rowOf(w, s.hash).last_seen_at, iso(Date.parse('2026-11-24T10:00:00.000Z')), 'the stamp is the ISO form of the first request')
}
async function scenarioStampDefaultFormat(source) {
  const w = world()
  const mod = sessionModule(w.db, source)
  tick = 0
  clock = Date.parse('2026-11-24T10:00:00.000Z')
  // earlier the same day, DEFAULT format: 30 minutes ago is inside the hour, 2 hours ago is not.
  const fresh = await newSession(w, mod, { last_seen_at: dflt(clock - 30 * 60 * 1000) })
  const r1 = request()
  await mod.getPortalAccountState(r1.ctx)
  await r1.settle()
  assert.equal(stamps(w.log).length, 0, 'a DEFAULT-format stamp 30 minutes old is inside the hour: no write')
  assert.equal(rowOf(w, fresh.hash).last_seen_at, dflt(clock - 30 * 60 * 1000))
  const old = await newSession(w, mod, { last_seen_at: dflt(clock - 2 * HOUR) })
  const r2 = request()
  await mod.getPortalAccountState(r2.ctx)
  await r2.settle()
  assert.equal(changed(stamps(w.log)), 1, 'a DEFAULT-format stamp 2 hours old is due: one write')
  assert.equal(rowOf(w, old.hash).last_seen_at, iso(clock), 'the new stamp is ISO')
}
async function scenarioStampConcurrent(source) {
  const w = world()
  const mod = sessionModule(w.db, source)
  tick = 1 // each read of the clock is 1 ms later than the one before
  clock = Date.parse('2026-11-24T10:00:00.000Z')
  await newSession(w, mod, { last_seen_at: null })
  const a = request()
  const b = request()
  readDelayMs = 20 // both reads land before either deferred write
  await Promise.all([mod.getPortalAccountState(a.ctx), mod.getPortalAccountState(b.ctx)])
  readDelayMs = 0
  await a.settle()
  await b.settle()
  tick = 0
  assert.equal(stamps(w.log).length, 2, 'both concurrent requests found the stamp due and tried it')
  assert.equal(changed(stamps(w.log)), 1, 'the SQL guard lets exactly one of two concurrent requests write')
}

// ---- T-F4, T-F5 ------------------------------------------------------------
async function scenarioSlide(source) {
  const w = world()
  const mod = sessionModule(w.db, source)
  tick = 0
  clock = Date.parse('2026-11-24T10:00:00.000Z')
  const s = await newSession(w, mod, { created_at: iso(clock - 500 * DAY), expires_at: iso(clock + 150 * DAY), last_seen_at: iso(clock) })
  const r1 = request()
  await mod.getPortalAccountState(r1.ctx)
  await r1.settle()
  clock += 2000
  const r2 = request()
  await mod.getPortalAccountState(r2.ctx)
  await r2.settle()
  assert.ok(slides(w.log).length <= 1, `at most one slide attempt for two requests, got ${slides(w.log).length}`)
  assert.equal(changed(slides(w.log)), 1)
  const days = (asUtc(rowOf(w, s.hash).expires_at) - clock) / DAY
  assert.ok(days > 398 && days <= 399.01, `the slide lands at the 399-day lifetime, got ${days}`)
  return w
}
async function scenarioSlideConcurrent(source) {
  const w = world()
  const mod = sessionModule(w.db, source)
  tick = 0
  clock = Date.parse('2026-11-24T10:00:00.000Z')
  await newSession(w, mod, { created_at: iso(clock - 300 * DAY), expires_at: iso(clock + 99 * DAY), last_seen_at: iso(clock) })
  const a = request()
  const b = request()
  readDelayMs = 20 // both reads land before either deferred write
  await Promise.all([mod.getPortalAccountState(a.ctx), mod.getPortalAccountState(b.ctx)])
  readDelayMs = 0
  await a.settle()
  await b.settle()
  assert.equal(slides(w.log).length, 2, 'both concurrent requests found the slide due')
  assert.equal(changed(slides(w.log)), 1, 'the SQL guard writes the slide once')
}

async function main() {
  await check('T-F3 two requests inside the hour write one stamp; the 2nd is not even attempted', () => scenarioStamp(readSrc('lib/portalSession.ts')))
  await check('T-F3 a DEFAULT-format last_seen_at from earlier the same day: 30 minutes old no write, 2 hours old one ISO write', () => scenarioStampDefaultFormat(readSrc('lib/portalSession.ts')))
  await check('T-F3 two concurrent requests: exactly one stamp lands', () => scenarioStampConcurrent(readSrc('lib/portalSession.ts')))
  await check('T-F3 mutant: raw last_seen_at comparison in the SQL guard -> concurrent requests both write', () => mutant(
    'raw stamp comparison',
    'datetime(last_seen_at) < datetime(@now, @touch_window)',
    '(last_seen_at < @now AND @touch_window IS NOT NULL)',
    scenarioStampConcurrent,
  ))
  await check('T-F3 mutant: no SQL guard -> concurrent requests both write', () => mutant(
    'no stamp guard',
    /AND \(last_seen_at IS NULL OR datetime\(last_seen_at\) < datetime\(@now, @touch_window\)\)/,
    'AND @touch_window IS NOT NULL',
    scenarioStampConcurrent,
  ))
  await check('T-F3 mutant: the JS due test always true -> a second request inside the hour attempts a stamp', () => mutant(
    'JS due test removed',
    /if \(stampDue\) \{/,
    'if (true) {',
    scenarioStamp,
  ))

  await check('T-F4 a session created 500 days ago with 150 days left: two requests, at most one slide write', async () => { await scenarioSlide(readSrc('lib/portalSession.ts')) })
  await check('T-F4 mutant: lifetime = expires - created -> a second slide write', () => mutant(
    'ttl from the row',
    /const ttlMs = PORTAL_SESSION_MS\b/,
    'const ttlMs = expiresAt - asUtc(String(row.session_created_at))',
    scenarioSlide,
  ))
  await check('T-F5 two concurrent requests, both due: the slide is written once', () => scenarioSlideConcurrent(readSrc('lib/portalSession.ts')))
  await check('T-F5 mutant: no SQL guard on the slide -> concurrent requests both write', () => mutant(
    'no slide guard',
    /AND datetime\(expires_at\) < datetime\(@next_expires_at\)/,
    'AND @next_expires_at IS NOT NULL',
    scenarioSlideConcurrent,
  ))
  await check('T-F5 the slide extends past the half-life and never shortens, and a young session is left alone', async () => {
    const w = world()
    const mod = sessionModule(w.db)
    tick = 0
    clock = Date.parse('2026-11-24T10:00:00.000Z')
    // just past half-life (199.5 days): 199 days left -> slides
    const past = await newSession(w, mod, { created_at: iso(clock - 200 * DAY), expires_at: iso(clock + 199 * DAY), last_seen_at: iso(clock) })
    const r1 = request()
    await mod.getPortalAccountState(r1.ctx)
    await r1.settle()
    assert.ok(asUtc(rowOf(w, past.hash).expires_at) > clock + 398 * DAY, 'past the half-life it slides to the lifetime')
    assert.ok(jar.options && jar.options.expires instanceof Date, 'the cookie is re-issued with the new expiry')
    // just before the half-life: 200 days left -> untouched
    const young = await newSession(w, mod, { created_at: iso(clock - 199 * DAY), expires_at: iso(clock + 200 * DAY), last_seen_at: iso(clock) })
    const before = rowOf(w, young.hash).expires_at
    const r2 = request()
    await mod.getPortalAccountState(r2.ctx)
    await r2.settle()
    assert.equal(rowOf(w, young.hash).expires_at, before)
    assert.equal(slides(w.log).length, 0, 'before the half-life nothing is attempted')
    // a clock that went backwards (a request on a slow isolate) never shortens the stored expiry
    const slid = rowOf(w, past.hash).expires_at
    clock -= 5 * DAY
    jar.value = past.token
    const r3 = request()
    await mod.getPortalAccountState(r3.ctx)
    await r3.settle()
    assert.equal(rowOf(w, past.hash).expires_at, slid, 'the expiry never moves earlier')
  })

  await check('T-F6 the session read is one statement per request, and a fresh session writes nothing', async () => {
    const w = world()
    const mod = sessionModule(w.db)
    tick = 0
    clock = Date.parse('2026-11-24T10:00:00.000Z')
    await newSession(w, mod, { last_seen_at: iso(clock - 60 * 1000), created_at: iso(clock - 60 * 1000), expires_at: iso(clock + 399 * DAY) })
    const r = request()
    const state = await mod.getPortalAccountState(r.ctx)
    await r.settle()
    assert.equal(state.status, 'authenticated')
    assert.equal(w.log.filter((e) => e.kind === 'read').length, 1, 'one read')
    assert.equal(w.log.filter((e) => e.kind === 'write').length, 0, 'no write inside the hour and before the half-life')
    assert.equal(w.log.length, 1, 'one statement in all')
    // warm: the same again
    const r2 = request()
    await mod.getPortalAccountState(r2.ctx)
    await r2.settle()
    assert.equal(w.log.length, 2, 'one statement per request')
  })
  await check('T-F6 the read returns the session times, so the stamp and the slide need no second read', async () => {
    const source = readSrc('lib/portalSession.ts')
    assert.match(source, /s\.created_at AS session_created_at/)
    assert.match(source, /s\.expires_at AS session_expires_at/)
    assert.match(source, /s\.last_seen_at AS session_last_seen_at/)
    assert.doesNotMatch(source, /SELECT created_at, expires_at FROM portal_sessions/, 'the slide has no read of its own')
  })

  await check('T-F10 createPortalSession writes created_at and last_seen_at in the 24-character ISO form', async () => {
    const w = world()
    const mod = sessionModule(w.db)
    tick = 0
    clock = Date.parse('2026-11-24T10:00:00.123Z')
    const s = await newSession(w, mod)
    const row = rowOf(w, s.hash)
    for (const column of ['created_at', 'last_seen_at', 'expires_at']) {
      assert.match(row[column], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, column)
    }
    assert.equal(row.created_at, '2026-11-24T10:00:00.123Z')
    assert.equal(row.last_seen_at, '2026-11-24T10:00:00.123Z')
  })
  await check('T-F10 mutant: the default time columns (no created_at / last_seen_at bound) -> not ISO', () => mutant(
    'defaults',
    /INSERT INTO portal_sessions \(account_id, token_hash, expires_at, created_at, last_seen_at\)\s+VALUES \(@account_id, @token_hash, @expires_at, @now, @now\)/,
    'INSERT INTO portal_sessions (account_id, token_hash, expires_at) VALUES (@account_id, @token_hash, @expires_at)',
    async (source) => {
      const w = world()
      const mod = sessionModule(w.db, source)
      const s = await newSession(w, mod)
      assert.match(rowOf(w, s.hash).created_at, /T.*Z$/)
    },
  ))

  // ---- T-F9 ----
  await check('T-F9 countPortalDevices counts live, used or recent sessions of the member, never a ticket', async () => {
    const w = world()
    const mod = sessionModule(w.db)
    tick = 0
    clock = Date.parse('2026-11-24T10:00:00.000Z')
    const accountId = seedAccount(w.raw)
    const other = seedAccount(w.raw)
    const ins = (acct, hash, f) => w.raw.prepare(
      'INSERT INTO portal_sessions (account_id, token_hash, expires_at, created_at, last_seen_at, revoked_at) VALUES (@a, @h, @e, @c, @l, @r)',
    ).run({ a: acct, h: hash, e: iso(clock + 100 * DAY), c: iso(clock - 3 * DAY), l: iso(clock - 3 * DAY), r: null, ...f })
    ins(accountId, 'h-used', { l: iso(clock - 2 * DAY) })                              // touched long after creation: counts
    ins(accountId, 'h-recent', { c: iso(clock - HOUR), l: iso(clock - HOUR) })         // created within the day: counts
    ins(accountId, 'h-orphan', {})                                                     // never touched, 3 days old: not counted
    ins(accountId, 'h-revoked', { l: iso(clock - 2 * DAY), r: iso(clock - HOUR) })     // revoked: not counted
    ins(accountId, 'h-expired', { l: iso(clock - 2 * DAY), e: iso(clock - HOUR) })     // expired: not counted
    ins(accountId, `tg1:${'a'.repeat(64)}`, { c: iso(clock - HOUR), l: iso(clock - HOUR) }) // a ticket: not counted
    ins(accountId, 'h-default-format', { c: dflt(clock - 5 * HOUR), l: dflt(clock - 4 * HOUR) }) // DEFAULT format: counts
    ins(other, 'h-other', { l: iso(clock - 2 * DAY) })                                 // another member: not counted
    assert.equal(await mod.countPortalDevices({}, accountId, iso(clock)), 3)
    assert.equal(await mod.countPortalDevices({}, other, iso(clock)), 1)
    assert.equal(await mod.countPortalDevices({}, 999999, iso(clock)), 0)
    assert.equal(w.log.filter((e) => e.kind === 'read').length, 3, 'one statement per call')
  })
  await check('T-F9 revokeOtherPortalSessions revokes every other session and every unclaimed ticket, keeps the current one', async () => {
    const w = world()
    const mod = sessionModule(w.db)
    tick = 0
    clock = Date.parse('2026-11-24T10:00:00.000Z')
    const accountId = seedAccount(w.raw)
    const other = seedAccount(w.raw)
    const ins = (acct, hash, revoked = null) => w.raw.prepare(
      'INSERT INTO portal_sessions (account_id, token_hash, expires_at, created_at, last_seen_at, revoked_at) VALUES (@a, @h, @e, @c, @c, @r)',
    ).run({ a: acct, h: hash, e: iso(clock + DAY), c: iso(clock - HOUR), r: revoked })
    ins(accountId, 'h-current'); ins(accountId, 'h-two'); ins(accountId, 'h-three')
    ins(accountId, `tg1:${'b'.repeat(64)}`); ins(accountId, 'h-old', iso(clock - DAY))
    ins(other, 'h-other')
    w.log.length = 0
    const revoked = await mod.revokeOtherPortalSessions({}, accountId, 'h-current', iso(clock))
    assert.equal(revoked, 3, 'two sessions and one ticket; the already revoked row is not counted')
    const state = (h) => w.raw.prepare('SELECT revoked_at FROM portal_sessions WHERE token_hash = ?').get([h]).revoked_at
    assert.equal(state('h-current'), null)
    assert.equal(state('h-two'), iso(clock))
    assert.equal(state(`tg1:${'b'.repeat(64)}`), iso(clock))
    assert.equal(state('h-old'), iso(clock - DAY), 'an older revocation is left as it was')
    assert.equal(state('h-other'), null, 'another member is untouched')
    assert.equal(w.log.length, 1, 'one statement')
    assert.equal(await mod.revokeOtherPortalSessions({}, accountId, 'h-current', iso(clock)), 0, 'nothing left: 0 writes')
    assert.equal(changed(w.log.filter((e) => e.kind === 'write')), 3)
  })
  await check('T-F9 mutant: sign-out-others also revokes the current session', () => mutant(
    'current kept',
    'AND token_hash <> @token_hash',
    'AND @token_hash IS NOT NULL',
    async (source) => {
      const w = world()
      const mod = sessionModule(w.db, source)
      const accountId = seedAccount(w.raw)
      w.raw.prepare('INSERT INTO portal_sessions (account_id, token_hash, expires_at) VALUES (?, ?, ?)').run([accountId, 'h-current', iso(clock + DAY)])
      await mod.revokeOtherPortalSessions({}, accountId, 'h-current', iso(clock))
      assert.equal(w.raw.prepare("SELECT revoked_at FROM portal_sessions WHERE token_hash = 'h-current'").get().revoked_at, null)
    },
  ))
  await check('T-F9 mutant: the device count includes tickets', () => mutant(
    'tickets counted',
    /AND substr\(token_hash, 1, 4\) <> 'tg1:'\n(\s+)AND datetime\(expires_at\) > datetime\(@now\)\n(\s+)AND \(datetime\(last_seen_at\)/,
    "AND @now IS NOT NULL\n$1AND datetime(expires_at) > datetime(@now)\n$2AND (datetime(last_seen_at)",
    async (source) => {
      const w = world()
      const mod = sessionModule(w.db, source)
      const accountId = seedAccount(w.raw)
      w.raw.prepare('INSERT INTO portal_sessions (account_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
        .run([accountId, `tg1:${'c'.repeat(64)}`, iso(clock + DAY), iso(clock - HOUR), iso(clock - HOUR)])
      assert.equal(await mod.countPortalDevices({}, accountId, iso(clock)), 0)
    },
  ))

  Date.now = realNow
  console.log(`\n${passed} passed${failures.length ? `, ${failures.length} FAILED: ${failures.join(' | ')}` : ''}`)
  if (failures.length) process.exit(1)
}

main().catch((error) => { Date.now = realNow; console.error(error); process.exit(1) })
