'use strict'
// GET /api/auth/bootstrap carries the settings map to every signed-in account at login. It once applied only
// stripSensitiveSettings (secrets), so a cashier received the Telegram chat and topic ids, the report switches, the
// non-secret Drive-sync rows and the audit-retention window that GET /api/settings withholds from accounts without
// Settings access. Both routes now call lib/settingsVisibility.ts settingsVisibleTo, one function.
//
// Real transpiled routes/auth.ts over the real lib/settingsVisibility.ts and lib/permissions.ts, real Hono, no engine.
// Includes a MUTANT run: the same route source with settingsVisibleTo swapped back to stripSensitiveSettings alone must
// FAIL the cashier assertions, so a green run here proves the assertions can tell the two implementations apart.
//
// Run (from cloudflare/): node scripts/test-settings-bootstrap-visibility-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')

function transpile(source, filename) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText
}

function load(relative, dependencies = {}, rewrite = (source) => source) {
  const filename = path.join(__dirname, '..', 'src', relative)
  const module = { exports: {} }
  const poisoned = new Proxy({}, { get: (_, key) => {
    if (key === '__esModule') return true
    return () => { throw new Error(`Unexpected dependency effect: ${relative}:${String(key)}`) }
  } })
  new Function('require', 'module', 'exports', transpile(rewrite(fs.readFileSync(filename, 'utf8')), filename))((name) => {
    if (name in dependencies) return dependencies[name]
    if (name === 'hono') return { Hono }
    return poisoned
  }, module, module.exports)
  return module.exports
}

const settingsSensitive = load('lib/settingsSensitive.ts')
const settingsVisibility = load('lib/settingsVisibility.ts', { './permissions': load('lib/permissions.ts'), './settingsSensitive': settingsSensitive })

const ROWS = {
  telegram_chat_id: '-1001234567890',
  telegram_topic_sales: '12',
  telegram_automation_enabled: 'true',
  telegram_summary_sales_enabled: 'true',
  drive_sync_enabled: 'true',
  drive_sync_folder_name: 'BOS Backups',
  drive_sync_refresh_token: 'refresh-secret',
  audit_log_retention_days: '30',
  business_name: 'Leang Cosmetics',
  exchange_rate: '4100',
  receipt_footer: 'Thank you',
  pos_payment_methods: '["Cash","ABA"]',
  shift_scope_mode: 'per_account',
}
const WITHHELD = Object.keys(ROWS).filter((key) => /^(telegram_|drive_sync_|audit_log_retention_days)/.test(key) && key !== 'drive_sync_refresh_token')
const VISIBLE = ['business_name', 'exchange_rate', 'receipt_footer', 'pos_payment_methods', 'shift_scope_mode']

const account = (granted, roleCode = 'staff') => ({ id: 7, username: 'someone', role_code: roleCode, permissions: '{}', role_permissions: JSON.stringify(granted) })
const ACCOUNTS = {
  cashier: account({ pos: true, sales: true, receipt_settings: true }),
  nobody: account({}),
  settingsHolder: account({ settings: true }),
  settingsViewer: account({ settings: 'view' }),
  admin: account({ all: true }, 'admin'),
}

function bootstrapRoute(rewrite) {
  let sessionUser = null
  const db = { prepare: () => ({ all: async () => Object.entries(ROWS).map(([key, value]) => ({ key, value })) }) }
  const authLib = {
    getSessionUser: async () => sessionUser,
    hasSessionCookie: () => true,
    requireAuth: async (c, next) => next(),
    createSession: () => {}, setSessionCookie: () => {}, clearSessionCookie: () => {}, revokeSession: () => {}, revokeUserSessions: () => {},
  }
  const route = load('routes/auth.ts', {
    '../lib/db': { getDb: () => db },
    '../lib/auth': authLib,
    '../lib/settingsSensitive': settingsSensitive,
    '../lib/settingsVisibility': settingsVisibility,
    '../lib/planTier': { resolvePlanTier: () => 'paid' },
  }, rewrite).default
  return async (user) => {
    sessionUser = user
    const response = await route.fetch(new Request('https://unit.test/bootstrap', { headers: { cookie: 'bos_session=tok' } }), {}, { waitUntil() {}, passThroughOnException() {} })
    assert.equal(response.status, 200)
    return (await response.json()).settings
  }
}

// The assertions under test. Throws on the first violation.
async function assertBootstrapFollowsTheRule(bootstrapAs) {
  for (const who of ['cashier', 'nobody']) {
    const settings = await bootstrapAs(ACCOUNTS[who])
    assert.deepEqual(Object.keys(settings).filter((key) => /^(telegram_|drive_sync_)/.test(key) || key === 'audit_log_retention_days'), [], `${who}: no telegram_*, drive_sync_* or audit-retention row`)
    for (const key of VISIBLE) assert.equal(settings[key], ROWS[key], `${who}: keeps ${key}`)
  }
  for (const who of ['settingsHolder', 'settingsViewer', 'admin']) {
    const settings = await bootstrapAs(ACCOUNTS[who])
    for (const key of WITHHELD) assert.equal(settings[key], ROWS[key], `${who}: still receives ${key}`)
    for (const key of VISIBLE) assert.equal(settings[key], ROWS[key], `${who}: keeps ${key}`)
    assert.equal('drive_sync_refresh_token' in settings, false, `${who}: the refresh token never leaves the Worker`)
  }
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await check('bootstrap: a cashier gets no telegram_*, drive_sync_* or audit-retention row; Settings accounts and the admin still get them', async () => {
    await assertBootstrapFollowsTheRule(bootstrapRoute())
  })

  await check('MUTANT: bootstrap reverted to stripSensitiveSettings alone is caught by the same assertions', async () => {
    const mutant = bootstrapRoute((source) => {
      const mutated = source
        .replace("import { settingsVisibleTo } from '../lib/settingsVisibility'", "import { stripSensitiveSettings } from '../lib/settingsSensitive'")
        .replace(/settingsVisibleTo\(\s*user,/, 'stripSensitiveSettings(')
      assert.notEqual(mutated, source, 'the mutation must actually change routes/auth.ts')
      return mutated
    })
    await assert.rejects(() => assertBootstrapFollowsTheRule(mutant), /no telegram_\*, drive_sync_\* or audit-retention row/)
  })

  await check('settingsVisibleTo is exactly strip-then-readable (the one shared rule)', async () => {
    const map = { ...ROWS, cron_rotation_state: 'x', customer_portal_ai_prompt: 'p' }
    for (const user of Object.values(ACCOUNTS)) {
      assert.deepEqual(
        settingsVisibility.settingsVisibleTo(user, map),
        settingsVisibility.settingsReadableBy(user, settingsSensitive.stripSensitiveSettings(map)),
      )
    }
    assert.equal('cron_rotation_state' in settingsVisibility.settingsVisibleTo(ACCOUNTS.admin, map), false, 'system-owned rows are readable by nobody')
  })

  await check('source lock: both settings-map routes call settingsVisibleTo; neither applies a half of the rule alone', async () => {
    const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', file), 'utf8')
    assert.match(read('auth.ts'), /settingsVisibleTo\(\s*user,/)
    assert.match(read('settings.ts'), /settingsVisibleTo\(user, map\)/)
    for (const file of ['auth.ts', 'settings.ts']) {
      assert.equal(/stripSensitiveSettings\(/.test(read(file)), false, `${file} must not call stripSensitiveSettings directly`)
      assert.equal(/settingsReadableBy\(/.test(read(file)), false, `${file} must not call settingsReadableBy directly`)
    }
  })

  console.log(`\n${passed} bootstrap settings-visibility checks passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
