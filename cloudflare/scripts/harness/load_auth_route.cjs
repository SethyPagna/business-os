// Loads the REAL routes/auth.ts (plus its real lib/loginLockout.ts,
// lib/rateLimit.ts, lib/totp.ts, lib/otpChallenge.ts, secretCrypto, ...)
// against an in-memory SQLite database with every migration applied and a
// Map-backed KV. Only the session layer, audit sink, device trust, email and
// Google OAuth are stubbed -- none of them is what the auth hardening tests
// exercise, and each would otherwise need a live binding.
//
// Usage:
//   const h = createAuthHarness()
//   h.addUser({ id: 5, username: 'dara', email: 'dara@x.test', password: 'pw123456', otpSecret: 'GEZD...' })
//   const res = await h.request('/password-reset/otp', 'POST', { ... }, { ip: '1.2.3.4', actorId: 5 })
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const bcrypt = require('bcryptjs')
const { openDb } = require('./d1compat.cjs')
const { loadAll } = require('./load_migrations.cjs')

function fakeKv() {
  const store = new Map()
  return {
    store,
    put: async (key, value) => { store.set(key, String(value)) },
    get: async (key) => (store.has(key) ? store.get(key) : null),
    delete: async (key) => { store.delete(key) },
  }
}

// lib/db.ts's D1Compat answers run() with { changes, lastInsertRowid };
// the shared harness answers D1's raw { meta: { changes } }. rateLimit.ts
// reads `.changes`, so normalise here rather than accuse correct code.
function dbAdapter(raw) {
  return {
    prepare(sql) {
      const stmt = raw.prepare(sql)
      return {
        get: async (params) => stmt.get(params),
        all: async (params) => stmt.all(params),
        run: async (params) => {
          const info = stmt.run(params)
          return { changes: info.meta?.changes ?? 0, lastInsertRowid: Number(info.meta?.last_row_id ?? 0) }
        },
      }
    },
    batch: (items) => raw.batch(items),
    exec: (sql) => raw.exec(sql),
  }
}

function createAuthHarness(options = {}) {
  const raw = openDb(loadAll())
  const db = dbAdapter(raw)
  const cacheKv = fakeKv()
  const audits = []
  const users = new Map()
  let sessionUserId = null
  // A usable key, as production has: without one lib/secretCrypto.ts refuses
  // every secret write, so /otp/setup could never enrol.
  const env = { DB: raw, CACHE: cacheKv, APP_ENCRYPTION_KEY: 'd'.repeat(64) }

  const overrides = {
    '../lib/db': { getDb: () => db },
    './db': { getDb: () => db },
    '../lib/auth': {
      createSession: async () => ({ token: 'session-token', expiresAt: new Date(Date.now() + 3600e3).toISOString() }),
      setSessionCookie: () => {},
      clearSessionCookie: () => {},
      getSessionUser: async () => (sessionUserId ? users.get(sessionUserId) || null : null),
      revokeSession: async () => {},
      revokeUserSessions: async () => {},
      requireAuth: async (c, next) => {
        const user = sessionUserId ? users.get(sessionUserId) : null
        if (!user) return c.json({ error: 'Not authenticated' }, 401)
        c.set('user', user)
        return next()
      },
    },
    '../lib/audit': { audit: async (...args) => { audits.push(args) } },
    '../lib/verification': {
      issuePasswordResetLink: async () => ({ issued: false }),
      consumePasswordResetLink: async () => ({ ok: false, reason: 'invalid' }),
      normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
      isEmailConfigured: () => false,
    },
    '../lib/deviceTrust': { requiresDeviceApproval: () => false, checkDeviceTrust: async () => ({ status: 'approved' }) },
    '../lib/googleOauth': {
      buildGoogleOauthStartUrl: () => '', exchangeGoogleOauthCode: async () => ({}), getGoogleLoginPublicConfig: () => ({ enabled: false }),
      getGoogleUserFromTokens: async () => ({}), normalizeReturnTarget: (v) => v, verifyState: async () => null,
    },
    ...(options.overrides || {}),
  }

  const cache = new Map()
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel).exports
    const sourcePath = path.join(__dirname, '..', '..', 'src', rel)
    const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: sourcePath,
    }).outputText
    const mod = { exports: {} }
    cache.set(rel, mod)
    const localRequire = (request) => {
      if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
      if (!request.startsWith('.')) return require(request)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
      return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
    }
    new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
    return mod.exports
  }

  const app = load('routes/auth.ts').default
  const totp = load('lib/totp.ts')

  function addUser({ id, username, name, email = null, password = 'correct-horse', otpSecret = null, roleCode = null, permissions = '{}' }) {
    const roleId = roleCode ? (raw.prepare('SELECT id FROM roles WHERE code = @code').get({ code: roleCode })?.id ?? null) : null
    raw.prepare(`INSERT INTO users (id, username, name, password, email, permissions, role_id, is_active, otp_enabled, otp_secret)
      VALUES (@id, @username, @name, @password, @email, @permissions, @roleId, 1, @otpEnabled, @otpSecret)`).run({
      id, username, name: name || username, password: bcrypt.hashSync(password, 4), email, permissions, roleId,
      otpEnabled: otpSecret ? 1 : 0, otpSecret,
    })
    const row = raw.prepare(`SELECT u.*, r.code AS role_code, r.permissions AS role_permissions FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = @id`).get({ id })
    users.set(id, row)
    return row
  }

  function userRow(id) {
    return raw.prepare('SELECT * FROM users WHERE id = @id').get({ id })
  }

  // Requests look like the admin app's own page by default (Sec-Fetch-Site:
  // same-origin, JSON body), as routes/auth.ts's credential guard requires;
  // pass headers to override either, with a value of null to drop a header.
  // rawBody sends a string as-is. Same shape as load_portal_auth_route.cjs.
  async function request(pathname, method = 'POST', body, { ip = '203.0.113.9', actorId = null, headers: extraHeaders = {}, rawBody } = {}) {
    sessionUserId = actorId
    const headers = {
      'CF-Connecting-IP': ip,
      'Sec-Fetch-Site': 'same-origin',
      ...(body !== undefined || rawBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    }
    for (const key of Object.keys(headers)) if (headers[key] == null) delete headers[key]
    const response = await app.request(pathname, {
      method, headers, body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
    }, env, { waitUntil() {}, passThroughOnException() {} })
    let json = null
    try { json = await response.json() } catch (_) {}
    return { status: response.status, body: json }
  }

  // Current six-digit code for a base32 secret at an explicit step offset.
  // Computed independently of lib/totp.ts (RFC 6238 over Web Crypto) so a
  // broken verifier cannot agree with itself.
  async function codeAt(secret, stepOffset = 0) {
    return totpCode(secret, Math.floor(Date.now() / 30000) + stepOffset)
  }

  async function totpCode(secret, counter) {
    const crypto = globalThis.crypto
    const keyBytes = totp.base32Decode(secret)
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
    const msg = new Uint8Array(8)
    let value = counter
    for (let i = 7; i >= 0; i--) { msg[i] = value & 0xff; value = Math.floor(value / 256) }
    const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))
    const offset = hmac[hmac.length - 1] & 0x0f
    const binary = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff)
    return String(binary % 1000000).padStart(6, '0')
  }

  return { env, raw, db, app, audits, cacheKv, addUser, userRow, request, codeAt, totp }
}

module.exports = { createAuthHarness, fakeKv }
