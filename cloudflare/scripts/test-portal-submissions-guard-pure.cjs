// Regression lock for POST /api/portal/submissions (N45).
//
// This route used to be an unauthenticated public write. Anyone could POST a
// membership number and a base64 image; the number is a gap-filling LC-#####
// sequence (lib/membershipNumber.ts), so "knowing" one means counting. The
// images landed under `uploads/`, which index.ts serves to the whole internet
// with a one-year immutable cache header, and nothing in the codebase ever
// deleted them. That is a public image host for photographs of other people,
// attached to a CRM name.
//
// The REAL Hono route is mounted here (transpiled from src/routes/portal.ts)
// and driven with real requests against in-memory SQLite carrying every real
// migration, plus a fake R2 bucket that records what was written. A
// source-shape assertion could be satisfied by dead code; these are responses.
//
// What this pins:
//   1. no bos_portal session -> 401, nothing written, nothing uploaded
//   2. a session whose account has no resolvable customer -> explicit failure, no write
//   3. a signed-in submission is attributed from the SESSION, and a
//      membershipNumber in the BODY is ignored (it cannot name someone else)
//   4. the 4th submission in 24h is refused (per-customer daily cap)
//   5. screenshots land under the private prefix, never `uploads/`, and the
//      stored value is an object key rather than a fetchable URL
//   6. the review queue hands staff a positional URL, never the key
//   7. GET /submissions/:id/screenshot/:n is staff-only and uncacheable
//   8. submissions are OFF unless the merchant switched them on
//   9. retention really deletes: images after review, whole rows if never
//      reviewed -- and a reviewed row KEEPS its reward points
//
// Run (from cloudflare/): node scripts/test-portal-submissions-guard-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')
const SRC = path.join(__dirname, '..', 'src')

function allMigrationSql() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
}

// Same D1Compat wrapper the sibling portal tests use: async, and .run()
// flattened to { changes, lastInsertRowid }.
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

// A miniature CommonJS loader for the real Worker source. routes/portal.ts
// pulls in two dozen relative modules, and Node's own require() will not add a
// `.ts` extension for an extensionless relative request, so this resolves and
// transpiles the whole graph itself. Overrides are keyed by ABSOLUTE path, so
// one entry covers a module however its importers happen to spell it
// ('../lib/db' from routes/, './db' from lib/).
const moduleCache = new Map()
const overrides = new Map()

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
  const source = fs.readFileSync(key, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: key,
  })
  const moduleObj = { exports: {} }
  moduleCache.set(key, moduleObj.exports)
  const packageRequire = Module.createRequire(key)
  const scopedRequire = (request) => (
    request.startsWith('.')
      ? loadFile(resolveTs(path.resolve(path.dirname(key), request)))
      : packageRequire(request)
  )
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, scopedRequire, moduleObj, key, path.dirname(key),
  )
  moduleCache.set(key, moduleObj.exports)
  return moduleObj.exports
}

function override(relPath, exportsObject) {
  overrides.set(path.normalize(path.join(SRC, relPath)), exportsObject)
}

function loadReal(relPath) {
  return loadFile(resolveTs(path.join(SRC, relPath)))
}

// --- a fake R2 bucket that remembers everything ----------------------------
function makeBucket() {
  const objects = new Map()
  return {
    objects,
    async put(key, bytes, options) {
      objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType || '' })
    },
    async get(key) {
      const found = objects.get(key)
      if (!found) return null
      return {
        body: found.bytes,
        httpEtag: '"fake"',
        httpMetadata: { contentType: found.contentType },
        writeHttpMetadata(headers) { if (found.contentType) headers.set('content-type', found.contentType) },
      }
    },
    async delete(keyOrKeys) {
      for (const key of Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]) objects.delete(key)
    },
    async list() { return { objects: [...objects.keys()].map((key) => ({ key })), truncated: false } },
  }
}

// A 1x1 PNG with a synthetic text metadata chunk. The route must keep the
// real image payload while removing the sentinel before R2 storage.
const PNG_METADATA_SENTINEL = 'GPS=11.5564,104.9282;Artist=private-person'
const BASE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const textPayload = Buffer.from(`Comment\0${PNG_METADATA_SENTINEL}`)
const textChunk = Buffer.alloc(12 + textPayload.length)
textChunk.writeUInt32BE(textPayload.length, 0)
textChunk.write('tEXt', 4, 'ascii')
textPayload.copy(textChunk, 8)
const PNG_WITH_METADATA = Buffer.concat([BASE_PNG.subarray(0, -12), textChunk, BASE_PNG.subarray(-12)])
const PNG_DATA_URL = `data:image/png;base64,${PNG_WITH_METADATA.toString('base64')}`

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const rawDb = openDb(allMigrationSql())
const db = wrap(rawDb)
const bucket = makeBucket()

const dbModule = { getDb: () => db }
// The broadcast hub needs a Durable Object binding; the route only fires it
// through waitUntil, so a no-op keeps the request path honest.
const broadcastModule = { broadcast: async () => {} }
// The AI provider is a different lane's surface entirely.
let portalAiFailure = null
const portalAiModule = {
  generatePortalAiResponse: async () => {
    if (portalAiFailure) throw portalAiFailure
    return { answer: '' }
  },
}
// Image normalization is a queue; the assertion that submissions must NOT be
// enqueued is made below by checking this counter stays at zero.
let normalizationCalls = 0
const imageAuditModule = { enqueueImageNormalization: async () => { normalizationCalls += 1 } }

let staffUser = null
const authModule = {
  requireAuth: async (c, next) => {
    if (!staffUser) return c.json({ error: 'Unauthorized' }, 401)
    c.set('user', staffUser)
    await next()
  },
}

override('lib/db.ts', dbModule)
override('durable-objects/broadcastHub.ts', broadcastModule)
override('lib/portalAi.ts', portalAiModule)
override('lib/imageAudit.ts', imageAuditModule)
override('lib/auth.ts', authModule)

const portalRoute = loadReal('routes/portal.ts')
const app = portalRoute.default

const retention = loadReal('lib/ephemeralRetention.ts')

const env = { ASSETS: bucket, PORTAL_ABUSE_HMAC_SECRET: 'portal-test-secret-is-at-least-thirty-two-characters' }
const ctx = { waitUntil: (promise) => { if (promise && typeof promise.catch === 'function') promise.catch(() => {}) }, passThroughOnException() {} }

function request(pathname, init = {}) {
  return app.request(pathname, init, env, ctx)
}

function setSetting(key, value) {
  rawDb.prepare('INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run({ key, value: String(value) })
}

async function makeSignedInAccount({ name, phone, membershipId, withCustomer = true }) {
  let customerId = null
  if (withCustomer) {
    const res = rawDb.prepare(
      'INSERT INTO customers (name, phone, phone_normalized, membership_number) VALUES (@name, @phone, @pn, @m)',
    ).run({ name, phone, pn: phone.replace(/\D/g, ''), m: membershipId })
    customerId = Number(res.meta.last_row_id)
  }
  const account = rawDb.prepare(
    `INSERT INTO portal_accounts (
      membership_id, name, phone, password_hash, contact_id,
      consent_version, consent_at, consent_locale
    ) VALUES (@m, @n, @p, @h, @c, 'portal-legal-2026-09-07', CURRENT_TIMESTAMP, 'en')`,
  ).run({ m: membershipId, n: name, p: phone.replace(/\D/g, ''), h: 'x', c: customerId })
  const accountId = Number(account.meta.last_row_id)
  const token = `token-${membershipId}`
  rawDb.prepare(
    'INSERT INTO portal_sessions (account_id, token_hash, expires_at) VALUES (@a, @t, @e)',
  ).run({ a: accountId, t: await sha256Hex(token), e: new Date(Date.now() + 86400000).toISOString() })
  return { accountId, customerId, cookie: `bos_portal=${token}` }
}

function submissionBody(extra = {}) {
  return JSON.stringify({ platform: 'Facebook', note: 'shared it', screenshots: [PNG_DATA_URL], rightsConsent: true, privacyConsent: true, consentLocale: 'en', ...extra })
}

const JSON_HEADERS = { 'content-type': 'application/json' }

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

async function run() {
  // The feature is off by default; every behavioural check below needs it on.
  await check('share submissions are OFF until the merchant switches them on', async () => {
    const config = portalRoute.buildPortalConfig({}, env)
    assert.strictEqual(config.submissionEnabled, false, 'an install with no setting must not accept customer photographs')
    assert.strictEqual(portalRoute.buildPortalConfig({ customer_portal_submission_enabled: 'true' }, env).submissionEnabled, true)
    assert.strictEqual(portalRoute.buildPortalConfig({ customer_portal_submission_enabled: 'false' }, env).submissionEnabled, false)
  })
  setSetting('customer_portal_submission_enabled', 'true')
  for (const [key, value] of Object.entries({
    business_legal_name: 'Example Registered Seller',
    business_registration_number: 'TEST-REG-1',
    business_address: 'Test address',
    business_phone: '012345678',
    business_email: 'test@example.invalid',
  })) setSetting(key, value)

  await check('anonymous AI failures do not disclose provider messages or endpoints', async () => {
    portalAiFailure = new Error('Provider https://secret.vendor.invalid/v1 failed: account quota abc-123')
    const res = await request('/ai/chat', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ question: 'Which cleanser?', dataUseConsent: true }),
    })
    portalAiFailure = null
    assert.strictEqual(res.status, 502)
    const payload = await res.json()
    assert.deepStrictEqual(payload, {
      error: 'The assistant is temporarily unavailable. Please try again later.',
      code: 'portal_ai_unavailable',
    })
    const exposed = JSON.stringify(payload)
    assert.doesNotMatch(exposed, /secret\.vendor|quota|abc-123/i)
  })

  const alice = await makeSignedInAccount({ name: 'Alice', phone: '012 100 100', membershipId: 'LC-90001' })
  const orphan = await makeSignedInAccount({ name: 'Orphan', phone: '012 200 200', membershipId: 'LC-90002', withCustomer: false })

  await check('a session accepted under an older policy cannot write until sign-in records current consent', async () => {
    rawDb.prepare("UPDATE portal_accounts SET consent_version = 'portal-legal-older', consent_at = CURRENT_TIMESTAMP WHERE id = ?").run([alice.accountId])
    const before = rawDb.prepare('SELECT COUNT(*) AS n FROM customer_share_submissions').get().n
    const res = await request('/submissions', {
      method: 'POST', headers: { ...JSON_HEADERS, cookie: alice.cookie }, body: submissionBody(),
    })
    assert.strictEqual(res.status, 428)
    const payload = await res.json()
    assert.strictEqual(payload.code, 'portal_consent_required')
    assert.strictEqual(payload.consentVersion, 'portal-legal-2026-09-07')
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) AS n FROM customer_share_submissions').get().n, before)
    assert.strictEqual(bucket.objects.size, 0)
    rawDb.prepare("UPDATE portal_accounts SET consent_version = 'portal-legal-2026-09-07', consent_at = CURRENT_TIMESTAMP WHERE id = ?").run([alice.accountId])
  })

  await check('a stranger cannot write: no session is 401, and nothing is stored', async () => {
    const before = rawDb.prepare('SELECT COUNT(*) AS n FROM customer_share_submissions').get().n
    const res = await request('/submissions', { method: 'POST', headers: JSON_HEADERS, body: submissionBody({ membershipNumber: 'LC-90001' }) })
    assert.strictEqual(res.status, 401, 'the endpoint must require a portal session')
    const body = await res.json()
    assert.strictEqual(body.code, 'portal_unauthenticated')
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) AS n FROM customer_share_submissions').get().n, before, 'a refused submission wrote a row')
    assert.strictEqual(bucket.objects.size, 0, 'a refused submission uploaded an image')
  })

  await check('a session with no resolvable customer fails and writes nothing', async () => {
    const before = rawDb.prepare('SELECT COUNT(*) AS n FROM customer_share_submissions').get().n
    const res = await request('/submissions', {
      method: 'POST', headers: { ...JSON_HEADERS, cookie: orphan.cookie }, body: submissionBody(),
    })
    assert.strictEqual(res.status, 409, `expected an unresolved-account failure, got ${res.status}`)
    const body = await res.json()
    assert.strictEqual(body.code, 'submission_account_unlinked')
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) AS n FROM customer_share_submissions').get().n, before)
    assert.strictEqual(bucket.objects.size, 0)
  })

  let firstId = 0
  await check('a signed-in submission is attributed from the SESSION, not the body', async () => {
    // The body names a DIFFERENT membership number. Under the old route that
    // string chose the customer; now it must be ignored entirely.
    const res = await request('/submissions', {
      method: 'POST',
      headers: { ...JSON_HEADERS, cookie: alice.cookie },
      body: submissionBody({ membershipNumber: 'LC-90002' }),
    })
    const body = await res.json()
    assert.strictEqual(res.status, 200, `submission failed: ${JSON.stringify(body)}`)
    firstId = body.id
    const row = rawDb.prepare('SELECT customer_id, membership_number, customer_name FROM customer_share_submissions WHERE id = ?').get([firstId])
    assert.strictEqual(row.customer_id, alice.customerId, 'the submission was filed against the wrong customer')
    assert.strictEqual(row.membership_number, 'LC-90001', 'a membership number from the request body reached the row')
    assert.strictEqual(row.customer_name, 'Alice')
  })

  await check('the image lands under the private prefix and the row holds a key, not a URL', async () => {
    const keys = [...bucket.objects.keys()]
    assert.strictEqual(keys.length, 1, `expected one stored object, got ${keys.length}`)
    assert.ok(keys[0].startsWith('private/portal-submissions/'), `stored at ${keys[0]}`)
    assert.ok(!keys[0].startsWith('uploads/'), 'a customer screenshot must never land where GET /uploads/* serves it')
    const stored = JSON.parse(rawDb.prepare('SELECT screenshots_json FROM customer_share_submissions WHERE id = ?').get([firstId]).screenshots_json)
    assert.deepStrictEqual(stored, keys, 'the row must store the object key')
    assert.ok(!stored[0].startsWith('/'), 'the row must not store a fetchable path')
    const storedObject = bucket.objects.get(keys[0])
    assert.strictEqual(storedObject.contentType, 'image/png')
    assert.doesNotMatch(Buffer.from(storedObject.bytes).toString('latin1'), /GPS=|private-person/, 'PNG text metadata reached R2')
    assert.ok(Buffer.from(storedObject.bytes).includes(Buffer.from('IDAT')), 'the minimized object lost its pixel-data chunk')
    assert.strictEqual(normalizationCalls, 0, 'a customer screenshot was sent to the shared normalization pipeline, which can use Cloudinary')
  })

  await check('an /uploads/ string in the body cannot be attached as a screenshot', async () => {
    const res = await request('/submissions', {
      method: 'POST',
      headers: { ...JSON_HEADERS, cookie: alice.cookie },
      body: JSON.stringify({ screenshots: ['/uploads/someone-elses-photo.jpg'] }),
    })
    assert.strictEqual(res.status, 400, 'a bare path was accepted as a screenshot')
  })

  await check('the fourth submission in 24 hours is refused', async () => {
    // One is already stored; two more reach the cap, the fourth must not.
    for (let i = 0; i < 2; i += 1) {
      const ok = await request('/submissions', { method: 'POST', headers: { ...JSON_HEADERS, cookie: alice.cookie }, body: submissionBody() })
      assert.strictEqual(ok.status, 200, `submission ${i + 2} failed: ${JSON.stringify(await ok.json())}`)
    }
    const capped = await request('/submissions', { method: 'POST', headers: { ...JSON_HEADERS, cookie: alice.cookie }, body: submissionBody() })
    assert.strictEqual(capped.status, 429, 'the per-customer daily cap did not fire')
    const body = await capped.json()
    assert.strictEqual(body.code, 'submission_daily_cap')
    assert.ok(capped.headers.get('retry-after'), 'a 429 must say when to come back')
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) AS n FROM customer_share_submissions').get().n, 3)
    assert.strictEqual(bucket.objects.size, 3, 'a capped submission still uploaded its image')
  })

  await check('the review queue hands staff a positional URL, never the object key', async () => {
    staffUser = { id: 1, name: 'Staff', username: 'reviewer', role_code: 'manager', permissions: JSON.stringify({ customer_portal: true }) }
    const res = await request('/submissions/review', { headers: { cookie: 'bos_session=staff' } })
    const rows = await res.json()
    assert.strictEqual(res.status, 200, `review queue failed: ${JSON.stringify(rows)}`)
    const row = rows.find((entry) => entry.id === firstId)
    assert.ok(row, 'the submission is missing from the queue')
    assert.deepStrictEqual(row.screenshots, [`/api/portal/submissions/${firstId}/screenshot/0`])
    assert.ok(!JSON.stringify(rows).includes('private/portal-submissions/'), 'the R2 key leaked into the review response')
  })

  await check('the screenshot route is staff-only, positional, and uncacheable', async () => {
    staffUser = null
    const anonymous = await request(`/submissions/${firstId}/screenshot/0`)
    assert.strictEqual(anonymous.status, 401, 'anyone could fetch a customer screenshot')

    staffUser = { id: 1, name: 'Staff', username: 'reviewer', role_code: 'manager', permissions: JSON.stringify({ customer_portal: true }) }
    const served = await request(`/submissions/${firstId}/screenshot/0`)
    assert.strictEqual(served.status, 200, `staff could not fetch the screenshot: ${served.status}`)
    assert.strictEqual(served.headers.get('cache-control'), 'private, no-store', 'a customer photograph must not be cached')

    const missing = await request(`/submissions/${firstId}/screenshot/9`)
    assert.strictEqual(missing.status, 404, 'an out-of-range index must not resolve')

    // A row still holding a legacy public path must not gain a second door.
    const legacy = rawDb.prepare(
      "INSERT INTO customer_share_submissions (customer_id, membership_number, screenshots_json, status) VALUES (@c, 'LC-90001', @s, 'pending')",
    ).run({ c: alice.customerId, s: JSON.stringify(['/uploads/legacy.jpg']) })
    const legacyId = Number(legacy.meta.last_row_id)
    const refused = await request(`/submissions/${legacyId}/screenshot/0`)
    assert.strictEqual(refused.status, 404, 'the staff route served a value it did not write')
    rawDb.prepare('DELETE FROM customer_share_submissions WHERE id = ?').run([legacyId])
    staffUser = null
  })

  await check('a permission-less staff account is refused the screenshot', async () => {
    staffUser = { id: 2, name: 'Cashier', username: 'cashier', role_code: 'cashier', permissions: '{}' }
    const res = await request(`/submissions/${firstId}/screenshot/0`)
    assert.strictEqual(res.status, 403, 'any signed-in staff user could read the moderation images')
    staffUser = null
  })

  await check('retention deletes reviewed images but keeps the row and its points', async () => {
    const keyBefore = JSON.parse(rawDb.prepare('SELECT screenshots_json FROM customer_share_submissions WHERE id = ?').get([firstId]).screenshots_json)[0]
    assert.ok(bucket.objects.has(keyBefore))
    // Reviewed and approved, long ago.
    rawDb.prepare(
      "UPDATE customer_share_submissions SET status = 'approved', reward_points = 5, reviewed_at = @t WHERE id = @id",
    ).run({ id: firstId, t: '2000-01-01 00:00:00' })

    await retention.maybeRunScheduledEphemeralRetention(env)

    const row = rawDb.prepare('SELECT status, reward_points, screenshots_json FROM customer_share_submissions WHERE id = ?').get([firstId])
    assert.ok(row, 'the reviewed row was deleted -- its approved points would vanish with it')
    assert.strictEqual(row.reward_points, 5, 'the reward points must survive image retention')
    assert.strictEqual(row.screenshots_json, '[]', 'the image reference was not cleared')
    assert.ok(!bucket.objects.has(keyBefore), 'the image itself was not deleted from storage')
  })

  await check('retention purges a submission nobody ever reviewed', async () => {
    const objectKey = 'private/portal-submissions/never-reviewed.jpg'
    await bucket.put(objectKey, new Uint8Array([1, 2, 3]), {})
    const inserted = rawDb.prepare(
      "INSERT INTO customer_share_submissions (customer_id, membership_number, screenshots_json, status, created_at) VALUES (@c, 'LC-90001', @s, 'pending', @t)",
    ).run({ c: alice.customerId, s: JSON.stringify([objectKey]), t: '2000-01-01 00:00:00' })
    const staleId = Number(inserted.meta.last_row_id)

    // Force the next sweep to run (it throttles itself to one per 5 hours).
    rawDb.prepare("DELETE FROM settings WHERE key = 'ephemeral_retention_last_run'").run({})
    await retention.maybeRunScheduledEphemeralRetention(env)

    assert.strictEqual(
      rawDb.prepare('SELECT COUNT(*) AS n FROM customer_share_submissions WHERE id = ?').get([staleId]).n,
      0,
      'a never-reviewed submission was kept past its window',
    )
    assert.ok(!bucket.objects.has(objectKey), 'the never-reviewed image was left in storage')
  })

  await check('retention never reaches an object it did not write', async () => {
    const foreign = 'uploads/product-photo.jpg'
    await bucket.put(foreign, new Uint8Array([9]), {})
    const inserted = rawDb.prepare(
      "INSERT INTO customer_share_submissions (customer_id, membership_number, screenshots_json, status, created_at) VALUES (@c, 'LC-90001', @s, 'pending', @t)",
    ).run({ c: alice.customerId, s: JSON.stringify([foreign]), t: '2000-01-01 00:00:00' })
    rawDb.prepare("DELETE FROM settings WHERE key = 'ephemeral_retention_last_run'").run({})
    await retention.maybeRunScheduledEphemeralRetention(env)
    assert.ok(bucket.objects.has(foreign), 'the sweep deleted a catalogue object that merely appeared in a row')
    rawDb.prepare('DELETE FROM customer_share_submissions WHERE id = ?').run([Number(inserted.meta.last_row_id)])
  })

  await check('the retention windows the code enforces are the ones it publishes', () => {
    assert.strictEqual(retention.SUBMISSION_IMAGE_TTL_DAYS, 90)
    assert.strictEqual(retention.SUBMISSION_UNREVIEWED_TTL_DAYS, 180)
    const source = fs.readFileSync(path.join(SRC, 'lib', 'ephemeralRetention.ts'), 'utf8')
    assert.ok(
      source.includes("const SUBMISSION_OBJECT_PREFIX = 'private/portal-submissions/'"),
      'the retention prefix must match PORTAL_SUBMISSION_PREFIX in routes/portal.ts',
    )
    const route = fs.readFileSync(path.join(SRC, 'routes', 'portal.ts'), 'utf8')
    assert.ok(route.includes("export const PORTAL_SUBMISSION_PREFIX = 'private/portal-submissions/'"))
  })

  console.log(`\nALL ${passed} CHECKS PASSED`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
