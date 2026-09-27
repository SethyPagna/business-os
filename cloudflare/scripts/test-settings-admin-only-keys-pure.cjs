// P1-3 (Release 1 auth audit). The generic POST /api/settings wrote ANY key
// for anyone holding `settings`: a settings-only account could re-point
// telegram_chat_id at its own chat, cut audit_log_retention_days to one day,
// write drive_sync_* rows (including the recorded Drive authoriser), or plant
// credential-shaped rows. Those keys now need administrator control to
// CHANGE; resending the stored value unchanged (the Settings form's whole-map
// save) stays allowed so ordinary non-admin saves keep working.
//
// Drives the REAL routes/settings.ts with the real permission module against
// the migrated schema. Fails on a04da325.
//
// Run: node scripts/test-settings-admin-only-keys-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

let passed = 0
const failures = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}: ${String(error.message).split(/\r?\n/)[0]}`)
  }
}

const db = openDb(loadAll())
let sessionUser = null
const overrides = {
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', sessionUser); return next() } },
  '../lib/audit': { changedFields: () => null, auditChangeColumns: () => ({ old_value: null, new_value: null }), isSecretShapedAuditKey: () => false, audit: async () => {} },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
}
const cache = new Map()
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
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

const app = load('routes/settings.ts').default
const SETTINGS_USER = { id: 11, username: 'manager', permissions: JSON.stringify({ settings: true }), role_code: null, role_permissions: null }
const ADMIN = { id: 12, username: 'owner', permissions: JSON.stringify({ all: true }), role_code: null, role_permissions: null }

async function save(user, body) {
  sessionUser = user
  const res = await app.request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { DB: db }, { waitUntil() {}, passThroughOnException() {} })
  return { status: res.status, body: await res.json() }
}
const stored = (key) => db.prepare('SELECT value FROM settings WHERE key = @key').get({ key })?.value ?? null
function seed(key, value) { db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (@key, @value)').run({ key, value }) }

async function main() {
  seed('telegram_chat_id', '-100111')
  seed('audit_log_retention_days', '21')
  seed('drive_sync_authorized_by', '12')

  await check('a settings-only account cannot change the routing, retention or Drive rows', async () => {
    for (const [key, value] of [['telegram_chat_id', '-100999'], ['audit_log_retention_days', '1'], ['drive_sync_authorized_by', '11'], ['drive_sync_enabled', '1'], ['drive_sync_last_synced_at', '2099-01-01T00:00:00.000Z']]) {
      const before = stored(key)
      const res = await save(SETTINGS_USER, { [key]: value })
      assert.equal(res.status, 403, `${key} must be refused`)
      assert.equal(res.body.code, 'admin_control_setting_required')
      assert.equal(stored(key), before, `${key} is unchanged`)
    }
  })

  await check('credential-shaped keys and case/whitespace aliases are refused too', async () => {
    for (const key of ['smtp_refresh_token', 'webhook_token', 'stripe_secret', 'maps_api_key', 'relay_password', 'Telegram_Chat_ID', ' telegram_chat_id ']) {
      const res = await save(SETTINGS_USER, { [key]: 'attacker' })
      assert.equal(res.status, 403, `${JSON.stringify(key)} must be refused`)
      assert.equal(stored(key), null)
    }
  })

  await check('the Settings form resending stored values unchanged still saves ordinary keys', async () => {
    const res = await save(SETTINGS_USER, { business_name: 'Leang Beauty', telegram_chat_id: '-100111', audit_log_retention_days: '21', drive_sync_authorized_by: '12' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(stored('business_name'), 'Leang Beauty')
    assert.equal(stored('telegram_chat_id'), '-100111')
  })

  await check('an all-or-nothing refusal: one changed admin key blocks the whole save', async () => {
    const res = await save(SETTINGS_USER, { business_name: 'Changed', telegram_chat_id: '-100999' })
    assert.equal(res.status, 403)
    assert.equal(stored('business_name'), 'Leang Beauty')
  })

  await check('an administrator can still change them', async () => {
    const res = await save(ADMIN, { telegram_chat_id: '-100222', audit_log_retention_days: '30' })
    assert.equal(res.status, 200)
    assert.equal(stored('telegram_chat_id'), '-100222')
    assert.equal(stored('audit_log_retention_days'), '30')
  })

  await check('source lock: the Settings form never resends Worker-owned drive_sync_* rows', () => {
    const settingsTsx = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'utils-settings', 'Settings.tsx'), 'utf8')
    assert.match(settingsTsx, /const SERVER_OWNED_SETTING_PREFIXES = \['drive_sync_'\]/)
    assert.match(settingsTsx, /const sanitizedForm = withoutServerOwnedSettings\(\{/)
    assert.match(settingsTsx, /saveSettings\(withoutServerOwnedSettings\(normalizedMergedDraft\)/)
  })

  if (failures.length) throw new Error(`${failures.length} check(s) failed`)
  console.log(`test-settings-admin-only-keys-pure.cjs: ${passed} checks passed`)
}

main().catch((error) => {
  console.error('test-settings-admin-only-keys-pure.cjs FAILED')
  console.error(error)
  process.exitCode = 1
})
