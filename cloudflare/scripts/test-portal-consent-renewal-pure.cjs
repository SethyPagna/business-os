// Website accounts re-consent to the age-16 wording (owner, 20 Oct 2026).
//
// Runs the REAL Hono portal route (transpiled from src/routes/portal.ts) with
// real requests against in-memory SQLite carrying every migration, 0262 included.
//   1. 0262 adds one nullable column and rewrites no existing row
//   2. sign-up stores age_confirmed_at beside the consent record
//   3. an account on an older version, or without age_confirmed_at, gets 428
//      portal_consent_required on every account endpoint; sign-out and the
//      public config still answer
//   4. POST /account/consent/renew: 400 without the tick or age, 401 without a
//      session, 200 stamps all four fields, idempotent, audited once, rate-limited
//   5. signing in with the tick also satisfies the renewal
//
// Run (from cloudflare/): node scripts/test-portal-consent-renewal-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')
const SRC = path.join(__dirname, '..', 'src')
const MIGRATION_0262 = '0262_portal_age_confirmed_at.sql'
const OLD = 'portal-legal-2026-09-30'

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

const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
assert.ok(files.includes(MIGRATION_0262), '0262 exists')
const sqlOf = (f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')

// Pre-assertions for 0262 are taken on the chain without it.
const rawDb = openDb(files.filter((f) => f !== MIGRATION_0262).map(sqlOf))
const columnCount = () => rawDb.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('portal_accounts') WHERE name = 'age_confirmed_at'").get().n
assert.strictEqual(columnCount(), 0, 'pre: no age_confirmed_at column yet')
rawDb.prepare("INSERT INTO portal_accounts (membership_id, name, phone, password_hash, consent_version, consent_at, consent_locale) VALUES ('LC-70001','Early','0127000001','x',?,CURRENT_TIMESTAMP,'en')").run([OLD])
const rowsBefore = rawDb.prepare('SELECT * FROM portal_accounts ORDER BY id').all().map((r) => ({ ...r }))
rawDb.exec(sqlOf(MIGRATION_0262))

const dbModule = { getDb: () => wrap(rawDb) }
const overrides = new Map()
const moduleCache = new Map()
function resolveTs(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return base
}
function loadFile(sourcePath) {
  const key = path.normalize(sourcePath)
  if (overrides.has(key)) return overrides.get(key)
  if (moduleCache.has(key)) return moduleCache.get(key)
  const { outputText } = ts.transpileModule(fs.readFileSync(key, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: key,
  })
  const moduleObj = { exports: {} }
  moduleCache.set(key, moduleObj.exports)
  const packageRequire = Module.createRequire(key)
  const scopedRequire = (request) => (request.startsWith('.') ? loadFile(resolveTs(path.resolve(path.dirname(key), request))) : packageRequire(request))
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, scopedRequire, moduleObj, key, path.dirname(key))
  moduleCache.set(key, moduleObj.exports)
  return moduleObj.exports
}
const override = (rel, exp) => overrides.set(path.normalize(path.join(SRC, rel)), exp)
override('lib/db.ts', dbModule)
override('durable-objects/broadcastHub.ts', { broadcast: async () => {} })
override('lib/portalAi.ts', { generatePortalAiResponse: async () => ({ answer: '' }) })
override('lib/imageAudit.ts', { enqueueImageNormalization: async () => {} })
override('lib/auth.ts', { requireAuth: async (c) => c.json({ error: 'Unauthorized' }, 401) })
const portalRoute = loadFile(resolveTs(path.join(SRC, 'routes/portal.ts')))
const accounts = loadFile(resolveTs(path.join(SRC, 'lib/portalAccounts.ts')))
const passwordHash = loadFile(resolveTs(path.join(SRC, 'lib/passwordHash.ts')))
const app = portalRoute.default

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } }
const env = { ASSETS: {}, CACHE: { get: async () => null, put: async () => {} }, PORTAL_ABUSE_HMAC_SECRET: 'portal-test-secret-is-at-least-thirty-two-characters' }
const ctx = { waitUntil: (p) => { if (p && typeof p.catch === 'function') p.catch(() => {}) }, passThroughOnException() {} }
const HEADERS = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }
const request = (url, init = {}) => app.request(url, init, env, ctx)
const post = (url, body, cookie) => request(url, { method: 'POST', headers: { ...HEADERS, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body ?? {}) })
const get = (url, cookie) => request(url, { headers: cookie ? { cookie } : {} })

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function accountWith({ n, version, ageConfirmedAt }) {
  const membershipId = `LC-78${String(n).padStart(4, '0')}`
  const res = rawDb.prepare(
    `INSERT INTO portal_accounts (membership_id, name, phone, password_hash, consent_version, consent_at, consent_locale, age_confirmed_at)
     VALUES (?, 'Renewer', ?, 'x', ?, CURRENT_TIMESTAMP, 'en', ?)`,
  ).run([membershipId, `0128${String(n).padStart(6, '0')}`, version, ageConfirmedAt])
  const accountId = Number(res.meta.last_row_id)
  const token = `token-${membershipId}`
  rawDb.prepare('INSERT INTO portal_sessions (account_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run([accountId, await sha256Hex(token), new Date(Date.now() + 86400000).toISOString()])
  return { accountId, membershipId, cookie: `bos_portal=${token}` }
}
const rowOf = (id) => ({ ...rawDb.prepare('SELECT consent_version, consent_at, consent_locale, age_confirmed_at FROM portal_accounts WHERE id = ?').get([id]) })
const auditCount = () => rawDb.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity = 'portal_account' AND action = 'consent_renew'").get().n

rawDb.prepare("INSERT INTO settings (key, value) VALUES ('customer_portal_submission_enabled', 'true') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run([])

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

async function run() {
  await check('0262 adds one nullable column and rewrites no existing row', () => {
    assert.strictEqual(columnCount(), 1)
    const info = rawDb.prepare("SELECT \"notnull\" AS nn, dflt_value FROM pragma_table_info('portal_accounts') WHERE name = 'age_confirmed_at'").get()
    assert.strictEqual(info.nn, 0)
    assert.strictEqual(info.dflt_value, null)
    const after = rawDb.prepare('SELECT * FROM portal_accounts ORDER BY id').all().map((r) => ({ ...r }))
    assert.deepStrictEqual(after.map(({ age_confirmed_at, ...rest }) => rest), rowsBefore)
    assert.ok(after.every((r) => r.age_confirmed_at === null), 'existing accounts stay NULL, not back-filled')
  })

  await check('the Worker records the 20 Oct 2026 version', () => {
    assert.strictEqual(accounts.PORTAL_CONSENT_VERSION, 'portal-legal-2026-10-20')
  })

  await check('sign-up stores age_confirmed_at in the same write as the consent record (new and existing-customer paths)', async () => {
    const created = await accounts.signupPortalAccount(env, { name: 'New Person', phone: '012 777 801', password: 'sup3rsecret', consent: true, ageConfirmed: true, consentLocale: 'km' })
    assert.strictEqual(created.ok, true, `signup failed: ${created.error || ''}`)
    const row = rowOf(created.accountId)
    assert.strictEqual(row.consent_version, accounts.PORTAL_CONSENT_VERSION)
    assert.ok(row.consent_at && row.age_confirmed_at, 'both stamps present')

    rawDb.prepare("INSERT INTO customers (name, phone, phone_normalized, membership_number) VALUES ('Old Buyer','012 777 803','012777803','LC-79999')").run([])
    const claimed = await accounts.signupPortalAccount(env, { name: 'Old Buyer', phone: '012 777 803', membershipId: 'LC-79999', password: 'sup3rsecret', consent: true, ageConfirmed: true })
    assert.strictEqual(claimed.ok, true, `claim failed: ${claimed.error || ''}`)
    assert.ok(rowOf(claimed.accountId).age_confirmed_at, 'the existing-customer claim path stores it too')
  })

  const stale = await accountWith({ n: 1, version: OLD, ageConfirmedAt: null })
  const noAge = await accountWith({ n: 2, version: accounts.PORTAL_CONSENT_VERSION, ageConfirmedAt: null })
  const fresh = await accountWith({ n: 3, version: accounts.PORTAL_CONSENT_VERSION, ageConfirmedAt: '2026-10-20 01:00:00' })

  await check('every account endpoint refuses a session that has not renewed; sign-out and the public config do not', async () => {
    for (const who of [stale, noAge]) {
      for (const [method, url] of [['GET', '/account/cart'], ['PUT', '/account/cart'], ['GET', '/account/wishlist'], ['PUT', '/account/wishlist'], ['POST', '/submissions'], ['GET', '/auth/me']]) {
        const res = await request(url, { method, headers: { ...HEADERS, cookie: who.cookie }, ...(method === 'GET' ? {} : { body: '{}' }) })
        const body = await res.json()
        assert.strictEqual(res.status, 428, `${method} ${url} for ${who.membershipId}`)
        assert.strictEqual(body.code, 'portal_consent_required')
        assert.strictEqual(body.consentVersion, accounts.PORTAL_CONSENT_VERSION)
      }
    }
    assert.strictEqual((await get('/account/wishlist', fresh.cookie)).status, 200, 'a current account is unaffected')
    const config = await get('/config')
    assert.notStrictEqual(config.status, 428, 'the public site never waits for consent')
    assert.ok(config.status < 500)
    assert.strictEqual((await post('/auth/signout', {}, stale.cookie)).status, 200, 'sign-out is the way out')
    const me = await get('/auth/me', stale.cookie)
    assert.strictEqual(me.status, 200, 'after sign-out the cookie is a guest, not a 428')
    assert.strictEqual((await me.json()).account, null)
  })

  const target = await accountWith({ n: 4, version: OLD, ageConfirmedAt: null })
  await check('renew: no session is 401; a missing tick or age is 400 and writes nothing', async () => {
    assert.strictEqual((await post('/account/consent/renew', { consent: true, ageConfirmed: true })).status, 401)
    for (const [body, code] of [
      [{ ageConfirmed: true }, 'consent_required'],
      [{ consent: false, ageConfirmed: true }, 'consent_required'],
      [{ consent: true }, 'age_confirmation_required'],
      [{ consent: true, ageConfirmed: 'true' }, 'age_confirmation_required'],
    ]) {
      const res = await post('/account/consent/renew', body, target.cookie)
      assert.strictEqual(res.status, 400)
      assert.strictEqual((await res.json()).code, code)
    }
    assert.strictEqual(rowOf(target.accountId).consent_version, OLD)
    assert.strictEqual(rowOf(target.accountId).age_confirmed_at, null)
    assert.strictEqual(auditCount(), 0)
  })

  await check('renew stamps version, time, locale and age; the account endpoints then answer 200', async () => {
    const res = await post('/account/consent/renew', { consent: true, ageConfirmed: true, consentLocale: 'km' }, target.cookie)
    const body = await res.json()
    assert.strictEqual(res.status, 200, JSON.stringify(body))
    assert.strictEqual(body.renewed, true)
    assert.strictEqual(body.account.membershipId, target.membershipId)
    const row = rowOf(target.accountId)
    assert.strictEqual(row.consent_version, accounts.PORTAL_CONSENT_VERSION)
    assert.strictEqual(row.consent_locale, 'km')
    assert.ok(row.consent_at && row.age_confirmed_at)
    assert.strictEqual((await get('/account/cart', target.cookie)).status, 200)
    assert.strictEqual((await get('/auth/me', target.cookie)).status, 200)
    assert.strictEqual(auditCount(), 1, 'the renewal is audited')
  })

  await check('renew is idempotent: a second call is 200, keeps the first stamps and adds no audit row', async () => {
    const first = rowOf(target.accountId)
    const res = await post('/account/consent/renew', { consent: true, ageConfirmed: true, consentLocale: 'en' }, target.cookie)
    assert.strictEqual(res.status, 200)
    assert.strictEqual((await res.json()).renewed, false)
    assert.deepStrictEqual(rowOf(target.accountId), first)
    assert.strictEqual(auditCount(), 1)
  })

  await check('sign-in with the combined tick satisfies the renewal', async () => {
    const hash = await passwordHash.hashPassword('sup3rsecret', env)
    const made = await accountWith({ n: 5, version: OLD, ageConfirmedAt: null })
    rawDb.prepare("UPDATE portal_accounts SET password_hash = ?, name = 'Signer' WHERE id = ?").run([hash, made.accountId])
    const phone = rawDb.prepare('SELECT phone FROM portal_accounts WHERE id = ?').get([made.accountId]).phone
    const res = await post('/auth/signin', { identifier: 'Signer', phone, password: 'sup3rsecret', consent: true, ageConfirmed: true })
    assert.strictEqual(res.status, 200, JSON.stringify(await res.clone().json()))
    const row = rowOf(made.accountId)
    assert.strictEqual(row.consent_version, accounts.PORTAL_CONSENT_VERSION)
    assert.ok(row.age_confirmed_at)
  })

  await check('renew is rate-limited like the other portal writes', async () => {
    let limited = null
    for (let i = 0; i < 14 && !limited; i += 1) {
      const res = await post('/account/consent/renew', { consent: true, ageConfirmed: true }, fresh.cookie)
      if (res.status === 429) limited = res
    }
    assert.ok(limited, 'a flood of renewals reaches 429')
    assert.ok(limited.headers.get('retry-after'))
  })

  console.log(`\nALL ${passed} CHECKS PASSED`)
}

run().catch((error) => { console.error(error); process.exit(1) })
