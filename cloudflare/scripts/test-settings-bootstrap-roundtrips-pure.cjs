// F5 (Records/Performance/2026-09-25 I1): app start and settings reads.
//
// GET /api/auth/bootstrap ran the session lookup, THEN the settings read:
// two sequential D1 round trips before the app could paint. The settings
// read does not depend on the user, so it now starts alongside the lookup
// and is simply discarded when there is no user.
//
// GET /api/settings sent its two settings statements (the rows, then the
// global MAX(updated_at)) one after the other. They are now one db.batch().
//
// Security half pinned here too: an unauthenticated bootstrap still returns
// the bare 401 envelope with no settings in it, and a failing discarded read
// cannot turn that 401 into a 500.
//
// Real transpiled routes, real Hono, no SQL engine.
// Run: node scripts/test-settings-bootstrap-roundtrips-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')

function transpile(relative) {
  const filename = path.join(__dirname, '../src', relative)
  return ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText
}

function load(relative, dependencies = {}) {
  const module = { exports: {} }
  const poisoned = new Proxy({}, { get: (_, key) => {
    if (key === '__esModule') return true
    return () => { throw new Error(`Unexpected dependency effect: ${relative}:${String(key)}`) }
  } })
  new Function('require', 'module', 'exports', transpile(relative))((name) => {
    if (name in dependencies) return dependencies[name]
    if (name === 'hono') return { Hono }
    return poisoned
  }, module, module.exports)
  return module.exports
}

const settingsSensitive = load('lib/settingsSensitive.ts')
const SETTINGS_ROWS = [
  { key: 'business_name', value: 'Leang', updated_at: '2026-09-01 00:00:00' },
  { key: 'google_drive_refresh_token', value: 'secret-token', updated_at: '2026-09-02 00:00:00' },
]
const MAX_UPDATED_AT = '2026-09-02 00:00:00'

const trace = { events: [], roundTrips: 0, settingsFail: false }
function resetTrace() { trace.events = []; trace.roundTrips = 0; trace.settingsFail = false }

function answer(sql) {
  if (/^SELECT key, value FROM settings$/.test(sql.trim())) {
    if (trace.settingsFail) throw new Error('D1_ERROR: settings read failed')
    return SETTINGS_ROWS.map(({ key, value }) => ({ key, value }))
  }
  if (/^SELECT MAX\(updated_at\) AS updated_at FROM settings$/.test(sql.trim())) return [{ updated_at: MAX_UPDATED_AT }]
  throw new Error(`unexpected SQL: ${sql}`)
}

const fakeDb = {
  prepare(sql) {
    return {
      all: async () => {
        trace.roundTrips += 1
        trace.events.push('settings:start')
        await new Promise((resolve) => setTimeout(resolve, 5))
        return answer(sql)
      },
      get: async () => {
        trace.roundTrips += 1
        trace.events.push('settings:start')
        await new Promise((resolve) => setTimeout(resolve, 5))
        return answer(sql)[0]
      },
    }
  },
  async batch(items) {
    trace.roundTrips += 1
    trace.events.push('settings:start')
    await new Promise((resolve) => setTimeout(resolve, 5))
    return items.map(({ sql }) => ({ success: true, results: answer(sql), meta: {} }))
  },
}

let sessionUser = null
const USER = { id: 3, username: 'cashier', name: 'Cashier', organization_id: 1, permissions: '{}', role_permissions: '{}' }
const authLib = {
  getSessionUser: async () => {
    trace.events.push('session:start')
    trace.roundTrips += 1
    await new Promise((resolve) => setTimeout(resolve, 20))
    trace.events.push('session:end')
    return sessionUser
  },
  requireAuth: async (c, next) => {
    const user = await authLib.getSessionUser(c)
    if (!user) return c.json({ error: 'Not authenticated', code: 'invalid_session' }, 401)
    c.set('user', user)
    return next()
  },
  hasSessionCookie: (c) => /(^|;\s*)bos_session=/.test(c.req.header('cookie') || ''),
  createSession: () => {}, setSessionCookie: () => {}, clearSessionCookie: () => {}, revokeSession: () => {}, revokeUserSessions: () => {},
}

const authRoute = load('routes/auth.ts', {
  '../lib/db': { getDb: () => fakeDb },
  '../lib/auth': authLib,
  '../lib/settingsSensitive': settingsSensitive,
  '../lib/planTier': { resolvePlanTier: () => 'paid' },
}).default

const settingsRoute = load('routes/settings.ts', {
  '../lib/db': { getDb: () => fakeDb },
  '../lib/auth': authLib,
  '../lib/settingsSensitive': settingsSensitive,
  '../lib/telegram': { TELEGRAM_TOPIC_KEYS: [] },
  '../lib/lowStockSettings': { MAX_LOW_STOCK_THRESHOLD: 1000, validateLowStockSettingsWrite: () => null },
  '../lib/addressPresets': { POS_ADDRESS_PRESETS_KEY: 'pos_address_presets' },
  '../lib/searchMatch': { normalizedHaystackSql: (sql) => sql },
}).default

const env = {}
const bootstrapRequest = (cookie = 'bos_session=tok') => new Request('https://unit.test/bootstrap', cookie ? { headers: { cookie } } : {})
const ctx = { waitUntil() {}, passThroughOnException() {} }

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await check('bootstrap starts the settings read before the session lookup resolves', async () => {
    resetTrace(); sessionUser = USER
    const res = await authRoute.fetch(bootstrapRequest(), env, ctx)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.user.id, 3)
    assert.equal(body.settings.business_name, 'Leang')
    assert.equal('google_drive_refresh_token' in body.settings, false, 'sensitive keys stay stripped')
    const settingsStart = trace.events.indexOf('settings:start')
    const sessionEnd = trace.events.indexOf('session:end')
    assert.ok(settingsStart !== -1 && settingsStart < sessionEnd,
      `settings must be in flight while the session is looked up: ${trace.events.join(' > ')}`)
  })

  await check('unauthenticated bootstrap: bare 401 envelope, settings discarded', async () => {
    resetTrace(); sessionUser = null
    const res = await authRoute.fetch(bootstrapRequest(), env, ctx)
    assert.equal(res.status, 401)
    assert.deepEqual(await res.json(), { error: 'Not authenticated', code: 'invalid_session' })
  })

  await check('bootstrap with no session cookie (login screen) reads no settings at all', async () => {
    resetTrace(); sessionUser = null
    const res = await authRoute.fetch(bootstrapRequest(null), env, ctx)
    assert.equal(res.status, 401)
    assert.deepEqual(await res.json(), { error: 'Not authenticated', code: 'invalid_session' })
    assert.equal(trace.events.includes('settings:start'), false, 'an anonymous caller must not trigger a settings read')
  })

  await check('unauthenticated bootstrap with a failing settings read is still a 401, not a 500', async () => {
    resetTrace(); sessionUser = null; trace.settingsFail = true
    const unhandled = []
    const onUnhandled = (reason) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      const res = await authRoute.fetch(bootstrapRequest(), env, ctx)
      assert.equal(res.status, 401)
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.equal(unhandled.length, 0, 'the discarded read must not raise an unhandled rejection')
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  await check('authenticated bootstrap with a failing settings read still fails loudly', async () => {
    resetTrace(); sessionUser = USER; trace.settingsFail = true
    const res = await authRoute.fetch(bootstrapRequest(), env, ctx)
    assert.equal(res.status, 500)
  })

  await check('GET /api/settings: the two settings statements are one round trip', async () => {
    resetTrace(); sessionUser = USER
    const res = await settingsRoute.fetch(new Request('https://unit.test/'), env, ctx)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.business_name, 'Leang')
    assert.equal(body.updatedAt, MAX_UPDATED_AT)
    assert.equal('google_drive_refresh_token' in body, false)
    // 1 session lookup + 1 settings round trip (was 1 + 2).
    assert.equal(trace.roundTrips, 2, `saw ${trace.roundTrips} round trips: ${trace.events.join(' > ')}`)
  })

  await check('GET /api/settings: empty table still falls back to a timestamp', async () => {
    resetTrace(); sessionUser = USER
    const saved = SETTINGS_ROWS.splice(0)
    const originalAnswer = fakeDb.batch
    fakeDb.batch = async (items) => {
      trace.roundTrips += 1
      return items.map(({ sql }) => ({ success: true, results: /MAX/.test(sql) ? [{ updated_at: null }] : [], meta: {} }))
    }
    try {
      const res = await settingsRoute.fetch(new Request('https://unit.test/'), env, ctx)
      const body = await res.json()
      assert.ok(Number.isFinite(Date.parse(body.updatedAt)), 'null MAX falls back to now, as before')
    } finally {
      SETTINGS_ROWS.push(...saved)
      fakeDb.batch = originalAnswer
    }
  })

  await check('GET /api/settings without a session is a 401 and reads no settings', async () => {
    resetTrace(); sessionUser = null
    const res = await settingsRoute.fetch(new Request('https://unit.test/'), env, ctx)
    assert.equal(res.status, 401)
    assert.equal(trace.events.includes('settings:start'), false)
  })

  console.log(`\n${passed} settings/bootstrap round-trip checks passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
