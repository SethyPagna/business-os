// Secret writers refuse without APP_ENCRYPTION_KEY (security lane S-secrets,
// Sep 26 2026). Route-level companion to test-secret-crypto-policy-pure.cjs:
// the REAL routes/ai.ts and routes/auth.ts over the real migrations and the
// real secretCrypto module. Before the fix these routes stored an AI
// provider key / TOTP secret in plaintext when the key was missing.
//
//  - no key: POST /ai/providers and POST /auth/otp/setup answer 400 with
//    code APP_ENCRYPTION_KEY_MISSING (not 500) and write nothing;
//  - key present: the stored value is an enc:v1 envelope that round-trips;
//  - a legacy plaintext provider key still reads (masked) and is
//    re-encrypted by the next edit that keeps it.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

// Transpiles a src module; its relative imports of other src .ts modules are
// transpiled too (cached), unless the request is overridden for that module.
const tsCache = new Map()
function loadReal(relPath, overrides = {}) {
  return loadFile(path.join(__dirname, '..', 'src', relPath), overrides)
}
function loadFile(sourcePath, overrides) {
  if (tsCache.has(sourcePath) && !Object.keys(overrides).length) return tsCache.get(sourcePath)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText
  const nodeRequire = Module.createRequire(sourcePath)
  const localRequire = (request) => {
    if (request in overrides) return overrides[request]
    if (request.startsWith('.')) {
      const candidate = path.resolve(path.dirname(sourcePath), request) + '.ts'
      if (fs.existsSync(candidate)) return loadFile(candidate, {})
    }
    return nodeRequire(request)
  }
  const moduleObj = { exports: {} }
  if (!Object.keys(overrides).length) tsCache.set(sourcePath, moduleObj.exports)
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
    moduleObj.exports, localRequire, moduleObj, sourcePath, path.dirname(sourcePath),
  )
  if (!Object.keys(overrides).length) tsCache.set(sourcePath, moduleObj.exports)
  return moduleObj.exports
}

const KEY = 'c'.repeat(64)
const db = openDb(loadAll())
// The harness answers run() in D1's raw meta shape; lib/db.ts's D1Compat
// (what the routes see) reports lastInsertRowid/changes. Adapt only that.
const dbKernel = {
  getDb: () => ({
    prepare(sql) {
      const stmt = db.prepare(sql)
      return {
        get: (params) => stmt.get(params),
        all: (params) => stmt.all(params),
        run: (params) => {
          const result = stmt.run(params)
          return { changes: Number(result.meta.changes), lastInsertRowid: Number(result.meta.last_row_id) }
        },
      }
    },
    batch: (statements) => db.batch(statements),
  }),
}
const secretCrypto = loadReal('lib/secretCrypto.ts')
const permissions = loadReal('lib/permissions.ts')
const ADMIN = { id: 1, username: 'admin', name: 'Admin', role_code: 'admin', permissions: '{}', role_permissions: '{}' }
const authStub = {
  requireAuth: async (c, next) => { c.set('user', ADMIN); await next() },
}
const common = {
  '../lib/db': dbKernel,
  '../lib/audit': { audit: async () => {} },
  '../lib/permissions': permissions,
  '../lib/secretCrypto': secretCrypto,
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' },
}

const aiGateway = loadReal('lib/aiGateway.ts', { './secretCrypto': secretCrypto })
const aiRoute = loadReal('routes/ai.ts', {
  ...common,
  '../lib/auth': authStub,
  '../lib/aiGateway': aiGateway,
}).default

const authRoute = loadReal('routes/auth.ts', {
  ...common,
  '../lib/auth': {
    ...authStub,
    createSession: async () => ({}), setSessionCookie: () => {}, clearSessionCookie: () => {},
    getSessionUser: async () => ADMIN, revokeSession: async () => {}, revokeUserSessions: async () => {},
  },
}).default

function envWith(key) {
  const env = { DB: {}, CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } }
  if (key !== undefined) env.APP_ENCRYPTION_KEY = key
  return env
}
const ctx = { waitUntil() {}, passThroughOnException() {} }

async function call(app, method, url, body, env) {
  const res = await app.request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env, ctx)
  let json = null
  try { json = await res.json() } catch (_) {}
  return { status: res.status, json }
}

async function providerRows() {
  return db.prepare('SELECT id, api_key_encrypted FROM ai_provider_configs ORDER BY id').all()
}

async function main() {
  const provider = Object.keys(aiGateway.PROVIDER_META)[0]
  assert.ok(provider, 'a provider exists in PROVIDER_META')
  const payload = { name: 'Primary', provider, apiKey: 'sk-live-PLAINTEXT-123456', defaultModel: 'm1' }

  // ---- AI provider create: refused without a key, nothing stored --------
  for (const missing of [undefined, 'not-a-32-byte-key']) {
    const before = (await providerRows()).length
    const res = await call(aiRoute, 'POST', '/providers', payload, envWith(missing))
    assert.equal(res.status, 400, `no/invalid key must be a 400, not a 500 (got ${res.status})`)
    assert.equal(res.json.code, 'APP_ENCRYPTION_KEY_MISSING')
    assert.match(res.json.error, /APP_ENCRYPTION_KEY is not set/)
    assert.equal((await providerRows()).length, before, 'refused create stores no row')
  }
  const allValues = async () => (await providerRows()).map((r) => String(r.api_key_encrypted))
  assert.ok(!(await allValues()).some((v) => v.includes('PLAINTEXT')), 'no plaintext key in D1')

  // ---- AI provider create with a key: encrypted, round-trips -------------
  const created = await call(aiRoute, 'POST', '/providers', payload, envWith(KEY))
  assert.equal(created.status, 200, JSON.stringify(created.json))
  const createdId = created.json.item.id
  const [row] = (await providerRows()).filter((r) => r.id === createdId)
  assert.ok(secretCrypto.isEncryptedSecret(row.api_key_encrypted), 'stored as enc:v1 envelope')
  assert.ok(!row.api_key_encrypted.includes('PLAINTEXT'))
  assert.equal(await secretCrypto.decryptSecret(row.api_key_encrypted, KEY), payload.apiKey)
  assert.ok(!JSON.stringify(created.json).includes(payload.apiKey), 'response never echoes the key')
  assert.ok(!JSON.stringify(created.json).includes(row.api_key_encrypted), 'response never echoes the ciphertext')

  // ---- AI provider update with a new key but no APP key: refused ---------
  const refusedEdit = await call(aiRoute, 'PUT', `/providers/${createdId}`, { ...payload, apiKey: 'sk-live-PLAINTEXT-NEW' }, envWith(undefined))
  assert.equal(refusedEdit.status, 400)
  assert.equal(refusedEdit.json.code, 'APP_ENCRYPTION_KEY_MISSING')
  const [afterRefused] = (await providerRows()).filter((r) => r.id === createdId)
  assert.equal(afterRefused.api_key_encrypted, row.api_key_encrypted, 'refused edit leaves the stored key untouched')

  // ---- legacy plaintext row: reads, then re-encrypted on the next edit ---
  await db.prepare(`UPDATE ai_provider_configs SET api_key_encrypted = 'sk-legacy-plain-abcdef' WHERE id = @id`).run({ id: createdId })
  const listed = await call(aiRoute, 'GET', '/providers', undefined, envWith(undefined))
  assert.equal(listed.status, 200)
  const listedItem = listed.json.items.find((i) => i.id === createdId)
  assert.ok(listedItem, 'legacy row still lists without a key')
  assert.ok(!JSON.stringify(listedItem).includes('sk-legacy-plain-abcdef'), 'legacy key is masked, never returned whole')

  const keptEdit = await call(aiRoute, 'PUT', `/providers/${createdId}`, { ...payload, apiKey: '', name: 'Renamed' }, envWith(KEY))
  assert.equal(keptEdit.status, 200, JSON.stringify(keptEdit.json))
  const [upgraded] = (await providerRows()).filter((r) => r.id === createdId)
  assert.ok(secretCrypto.isEncryptedSecret(upgraded.api_key_encrypted), 'kept legacy key is re-encrypted on the next write')
  assert.equal(await secretCrypto.decryptSecret(upgraded.api_key_encrypted, KEY), 'sk-legacy-plain-abcdef')

  // ---- TOTP enrollment ---------------------------------------------------
  // The actor enrolls themself (canManageOtpTarget: actor.id === target.id).
  db.prepare("INSERT INTO users (username, name, password) VALUES ('owner', 'Owner', 'x')").run({})
  const target = await db.prepare("SELECT id FROM users WHERE username = 'owner' LIMIT 1").get()
  assert.ok(target, 'test user exists')
  ADMIN.id = target.id
  await db.prepare('UPDATE users SET otp_pending_secret = NULL WHERE id = @id').run({ id: target.id })
  const refusedOtp = await call(authRoute, 'POST', '/otp/setup', { userId: target.id }, envWith(undefined))
  assert.equal(refusedOtp.status, 400, `OTP setup without a key must be a 400 (got ${refusedOtp.status})`)
  assert.equal(refusedOtp.json.code, 'APP_ENCRYPTION_KEY_MISSING')
  assert.equal(refusedOtp.json.secret, undefined, 'no enrollment secret handed out when it cannot be stored')
  const pendingAfterRefusal = await db.prepare('SELECT otp_pending_secret FROM users WHERE id = @id').get({ id: target.id })
  assert.equal(pendingAfterRefusal.otp_pending_secret, null, 'refused setup stores no TOTP secret')

  const okOtp = await call(authRoute, 'POST', '/otp/setup', { userId: target.id }, envWith(KEY))
  assert.equal(okOtp.status, 200, JSON.stringify(okOtp.json))
  const pending = await db.prepare('SELECT otp_pending_secret FROM users WHERE id = @id').get({ id: target.id })
  assert.ok(secretCrypto.isEncryptedSecret(pending.otp_pending_secret), 'TOTP secret stored encrypted')
  assert.equal(await secretCrypto.decryptSecret(pending.otp_pending_secret, KEY), okOtp.json.secret)

  console.log('secret routes refuse plaintext: ok')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
