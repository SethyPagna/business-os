// Regression lock for storefront SESSION retention and sliding (N45).
//
// portal_sessions historically carried a visitor's last_ip and user-agent.
// The implementation now stores neither; migration 0131 clears legacy values.
//
//   1. "expired sessions are deleted automatically". The retention sweep in
//      lib/ephemeralRetention.ts deletes rows whose expires_at is in the past.
//      A row stamped ten years out is never in the past, so an abandoned
//      account's IP and user-agent sat in the database for a decade -- long
//      after the cookie that could reach the session had expired at the 399
//      day ceiling.
//
//   2. Signing out should not leave the device details behind. Nothing reads
//      them once a session is revoked.
//
// And one behaviour that is not about privacy at all but has the same cause:
// slidePortalSession() only writes when its candidate expiry is LATER than
// the stored one, and its candidate is capped at MAX_COOKIE_AGE_MS. Against a
// ten-year stored expiry the candidate was always earlier, so the slide never
// fired, the cookie was never re-issued, and a customer who visited every day
// was still signed out at 399 days -- the exact opposite of the "permanent
// memory" the long TTL was chosen for.
//
// This runs the REAL lib/portalSession.ts, transpiled, against in-memory
// SQLite with every real migration applied. Same harness as the sibling portal
// tests; hono/cookie and the Hono context are stubbed because there is no HTTP
// here, everything else is the shipped code.
//
// Run (from cloudflare/): node scripts/test-portal-session-retention-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')
const DAY_MS = 24 * 60 * 60 * 1000

function allMigrationSql() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
}

function wrap(rawDb) {
  return {
    prepare(sql) {
      const stmt = rawDb.prepare(sql)
      return {
        get: async (p) => stmt.get(p),
        all: async (p) => stmt.all(p) || [],
        run: async (p) => {
          const r = stmt.run(p)
          return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
        },
      }
    },
    batch: (items) => rawDb.batch(items),
  }
}

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
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

// A stand-in for hono/cookie backed by one mutable jar, so the test can see
// what the module hands the browser.
const jar = { value: null, lastOptions: null, deleted: false }
const cookieStub = {
  getCookie: () => jar.value,
  setCookie: (_c, _name, value, options) => {
    jar.value = value
    jar.lastOptions = options
    jar.deleted = false
  },
  deleteCookie: () => {
    jar.value = null
    jar.deleted = true
  },
}

const rawDb = openDb(allMigrationSql())
const db = wrap(rawDb)
const session = loadReal('lib/portalSession.ts', { './db': { getDb: () => db }, 'hono/cookie': cookieStub })

// waitUntil runs inline so the assertions see the writes the route would have
// deferred.
const pending = []
const ctx = { env: {}, executionCtx: { waitUntil: (p) => { pending.push(p) } } }
const settle = async () => { while (pending.length) await pending.shift() }

let seedSeq = 0
function seedAccount() {
  seedSeq += 1
  const r = rawDb.prepare(
    'INSERT INTO portal_accounts (membership_id, name, phone, password_hash) VALUES (@m, @n, @p, @h)',
  ).run({ m: `LC-9${String(seedSeq).padStart(4, '0')}`, n: 'Retention Test', p: `0709998${String(seedSeq).padStart(2, '0')}`, h: 'x' })
  return Number(r.meta?.last_row_id ?? 0)
}

function sessionRow(tokenHash) {
  return rawDb.prepare('SELECT * FROM portal_sessions WHERE token_hash = ? LIMIT 1').get([tokenHash])
}

function onlyRow(accountId) {
  return rawDb.prepare('SELECT * FROM portal_sessions WHERE account_id = ? ORDER BY id DESC LIMIT 1').get([accountId])
}

// The module hashes the token it hands out; recompute the same way it does.
async function hashOf(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const asUtc = (value) => {
  const text = String(value).trim()
  const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text.replace(' ', 'T') : `${text.replace(' ', 'T')}Z`
  return Date.parse(normalized)
}

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

async function run() {
  await check('a new session expires within the cookie ceiling, not a decade out', async () => {
    const accountId = seedAccount()
    const { token, expiresAt } = await session.createPortalSession(ctx.env, accountId)
    const ttlDays = (asUtc(expiresAt) - Date.now()) / DAY_MS
    assert.ok(ttlDays > 390, `a storefront session still has to be long-lived, got ${ttlDays.toFixed(1)} days`)
    assert.ok(
      ttlDays <= 400,
      `a session row must not outlive the cookie that reaches it, or the retention sweep can never collect it -- got ${ttlDays.toFixed(1)} days`,
    )
    const row = sessionRow(await hashOf(token))
    assert.ok(row, 'the session row exists')
    assert.equal(row.last_ip, null, 'a new session must not persist a raw IP')
    assert.equal(row.user_agent, null, 'a new session must not persist a user agent')
  })

  await check('the retention sweep can actually reach an abandoned session', async () => {
    const accountId = seedAccount()
    const { token } = await session.createPortalSession(ctx.env, accountId)
    const tokenHash = await hashOf(token)
    // Fast-forward: pretend the row was created at the far edge of its own TTL
    // window and never used again.
    const stored = sessionRow(tokenHash)
    const ttlMs = asUtc(stored.expires_at) - asUtc(stored.created_at)
    assert.ok(ttlMs > 0 && ttlMs <= 400 * DAY_MS, `the row's own TTL must be inside the ceiling, got ${(ttlMs / DAY_MS).toFixed(1)} days`)
    // The sweep's predicate, verbatim from lib/ephemeralRetention.ts.
    rawDb.prepare("UPDATE portal_sessions SET expires_at = datetime('now', '-1 day') WHERE token_hash = ?").run([tokenHash])
    const collectable = rawDb.prepare(
      "SELECT COUNT(*) AS n FROM portal_sessions WHERE revoked_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP)",
    ).get({}).n
    assert.ok(collectable >= 1, 'an expired session must be visible to the sweep that deletes it')
  })

  await check('signing out revokes a session that contains no device details', async () => {
    const accountId = seedAccount()
    const { token } = await session.createPortalSession(ctx.env, accountId)
    jar.value = token
    const tokenHash = await hashOf(token)
    assert.equal(sessionRow(tokenHash).last_ip, null)
    assert.equal(sessionRow(tokenHash).user_agent, null)

    await session.revokePortalSession(ctx)
    const after = sessionRow(tokenHash)
    assert.ok(after.revoked_at, 'the session is revoked')
    assert.equal(after.last_ip, null, 'a revoked session must not keep the visitor IP')
    assert.equal(after.user_agent, null, 'a revoked session must not keep the user agent')
  })

  await check('revoking every session for an account clears them too', async () => {
    const accountId = seedAccount()
    await session.createPortalSession(ctx.env, accountId)
    await session.createPortalSession(ctx.env, accountId)
    await session.revokePortalSessionsForAccount(ctx.env, accountId)
    const rows = rawDb.prepare('SELECT last_ip, user_agent, revoked_at FROM portal_sessions WHERE account_id = ?').all([accountId])
    assert.equal(rows.length, 2)
    for (const row of rows) {
      assert.ok(row.revoked_at, 'every session is revoked')
      assert.equal(row.last_ip, null, 'a password reset must not leave the IPs behind')
      assert.equal(row.user_agent, null)
    }
  })

  await check('an active visitor slides forward instead of being signed out at the ceiling', async () => {
    const accountId = seedAccount()
    const { token } = await session.createPortalSession(ctx.env, accountId)
    const tokenHash = await hashOf(token)
    jar.value = token
    jar.lastOptions = null

    // Wind the row back so it looks like an account created ~300 days ago and
    // used today: past the halfway mark, so the slide is due.
    const created = new Date(Date.now() - 300 * DAY_MS).toISOString()
    const expires = new Date(Date.now() + 99 * DAY_MS).toISOString()
    rawDb.prepare('UPDATE portal_sessions SET created_at = @c, expires_at = @e WHERE token_hash = @t')
      .run({ c: created, e: expires, t: tokenHash })

    const account = await session.getPortalAccount(ctx)
    assert.ok(account, 'the session still authenticates')
    assert.match(account.membership_id, /^LC-9\d{4}$/)
    await settle()

    const slid = asUtc(sessionRow(tokenHash).expires_at)
    assert.ok(
      slid > asUtc(expires) + DAY_MS,
      'visiting must push the expiry out; with the old ten-year TTL the candidate expiry was always earlier than the stored one and the slide silently did nothing',
    )
    const slidDays = (slid - Date.now()) / DAY_MS
    assert.ok(slidDays > 390 && slidDays <= 400, `the slide lands back at the ceiling, got ${slidDays.toFixed(1)} days`)
    assert.ok(jar.lastOptions, 'the refreshed cookie has to be re-issued to the browser, or the row slides alone and the visitor is still signed out')
    assert.equal(jar.lastOptions.httpOnly, true)
    assert.equal(jar.lastOptions.secure, true)
    assert.equal(jar.lastOptions.sameSite, 'Lax')
    assert.ok(!('domain' in jar.lastOptions), 'the storefront cookie stays host-only so it never reaches the staff origin')
  })

  await check('a fresh visit does not churn the expiry before the halfway mark', async () => {
    const accountId = seedAccount()
    const { token } = await session.createPortalSession(ctx.env, accountId, { ip: '203.0.113.11' })
    const tokenHash = await hashOf(token)
    jar.value = token
    const before = sessionRow(tokenHash).expires_at
    assert.ok(await session.getPortalAccount(ctx))
    await settle()
    assert.equal(sessionRow(tokenHash).expires_at, before, 'a brand-new session has nothing to slide')
  })

  await check('the sweep predicate and the session TTL are read from the shipped sources', () => {
    const retention = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'ephemeralRetention.ts'), 'utf8')
    assert.match(retention, /portal_sessions/, 'portal sessions must still be swept')
    assert.match(retention, /expires_at < CURRENT_TIMESTAMP/, 'the sweep predicate this test relies on must still exist')
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'portalSession.ts'), 'utf8')
    assert.match(source, /const PORTAL_SESSION_MS = MAX_COOKIE_AGE_MS/, 'the row TTL and the cookie ceiling must stay the same number')
    assert.doesNotMatch(source, /10 \* 365 \* 24/, 'the ten-year TTL must not come back')
  })

  console.log(`\n${passed} check group(s) passed.`)
}

run().then(() => { void onlyRow }).catch((error) => {
  console.error(error)
  process.exit(1)
})
