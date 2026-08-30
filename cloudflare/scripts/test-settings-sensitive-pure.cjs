// Locks the Part-77 HIGH fix (auth audit): secret-bearing settings keys
// (Google Drive OAuth refresh/access tokens etc.) must never leave the
// Worker through the two whole-table dumps every logged-in account can call
// -- GET /api/settings and GET /auth/bootstrap. Tests the REAL transpiled
// lib/settingsSensitive.ts (not a reimplementation) plus source locks
// proving both routes actually pass their maps through it.
//
// Run: node scripts/test-settings-sensitive-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

function transpile(relPath) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', relPath), 'utf8')
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  }).outputText
}

function loadModule(relPath) {
  const module = { exports: {} }
  new Function('exports', 'require', 'module', transpile(relPath))(module.exports, require, module)
  return module.exports
}

const { isSensitiveSettingKey, stripSensitiveSettings } = loadModule('lib/settingsSensitive.ts')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

check('every Drive OAuth key the flow actually stores is classified sensitive', () => {
  // The exact keys lib/googleDrive.ts reads/writes for the token exchange.
  for (const key of ['drive_sync_refresh_token', 'drive_sync_access_token', 'drive_sync_access_token_expires_at']) {
    assert.strictEqual(isSensitiveSettingKey(key), true, `${key} must be sensitive`)
  }
})

check('the suffix net covers the next credential-shaped key without an enumeration edit', () => {
  for (const key of ['telegram_api_key', 'smtp_password', 'webhook_secret', 'x_refresh_token']) {
    assert.strictEqual(isSensitiveSettingKey(key), true, `${key} must be sensitive by suffix`)
  }
})

check('ordinary settings keys pass through untouched', () => {
  const map = {
    drive_sync_enabled: '1',
    drive_sync_folder_name: 'business-os',
    drive_sync_last_synced_at: '2026-08-30',
    drive_sync_account_email: 'x@y.z',
    customer_portal_title: 'Leang Beauty',
    drive_sync_refresh_token: 'SECRET',
    drive_sync_access_token: 'SECRET2',
  }
  const safe = stripSensitiveSettings(map)
  assert.deepStrictEqual(Object.keys(safe).sort(), [
    'customer_portal_title', 'drive_sync_account_email', 'drive_sync_enabled',
    'drive_sync_folder_name', 'drive_sync_last_synced_at',
  ])
  // Status/branding fields the UI genuinely renders survive with values intact.
  assert.strictEqual(safe.drive_sync_enabled, '1')
})

check('source lock: GET /api/settings strips before responding', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'settings.ts'), 'utf8')
  assert.ok(/from '\.\.\/lib\/settingsSensitive'/.test(src), 'settings.ts must import the shared redaction')
  assert.ok(/\.\.\.stripSensitiveSettings\(map\)/.test(src), 'the GET / response must spread the STRIPPED map')
})

check('source lock: GET /auth/bootstrap strips before responding', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.ts'), 'utf8')
  assert.ok(/from '\.\.\/lib\/settingsSensitive'/.test(src), 'auth.ts must import the shared redaction')
  const bootstrapAt = src.indexOf("app.get('/bootstrap'")
  assert.ok(bootstrapAt > -1, 'expected the /bootstrap route')
  assert.ok(/stripSensitiveSettings\(/.test(src.slice(bootstrapAt, bootstrapAt + 900)), 'the bootstrap settings map must pass through stripSensitiveSettings')
})

console.log(`\n${passed} check(s) passed.`)
