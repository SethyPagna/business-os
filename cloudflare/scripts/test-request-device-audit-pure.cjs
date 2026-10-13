// K8a (claude/fees-k-fix-20261013): an audit row names the device the REQUEST arrived on.
//
// lib/auth.ts requireAuth runs the request inside a scope holding the authenticated session's own device; lib/audit.ts
// buildAuditStatement reads it through a global hook (audit.ts is loaded in isolation by many pure tests, so it does not
// import auth.ts). This file pins the hook key in both files and runs the REAL statement against SQLite:
//   - inside a request, the row names the request's device even when another session of the same user was seen later;
//   - a row written for ANOTHER account in that request keeps that account's own (freshest-session) device;
//   - a request session with no device records none, rather than borrowing another session's;
//   - outside a request (cron, queue) the old freshest-session fallback is unchanged.
// The end-to-end proof over HTTP is K8a in test-al-stock-k-native.cjs.
//
// Run (from cloudflare/): node scripts/test-request-device-audit-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')

const src = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8')
let passed = 0
function check(name, fn) { fn(); passed += 1; console.log('PASS ' + name) }

const KEY_RE = /REQUEST_DEVICE_HOOK_KEY = '([^']+)'/
check('auth.ts and audit.ts name the same hook key', () => {
  const authKey = KEY_RE.exec(src('lib/auth.ts'))
  const auditKey = KEY_RE.exec(src('lib/audit.ts'))
  assert.ok(authKey && auditKey, 'both files declare REQUEST_DEVICE_HOOK_KEY')
  assert.equal(auditKey[1], authKey[1])
})

check('requireAuth runs the rest of the request inside the session-device scope', () => {
  const auth = src('lib/auth.ts').replace(/\r\n/g, '\n')
  assert.match(auth, /s\.device_name AS session_device_name, s\.device_tz AS session_device_tz/, 'the lookup reads the authenticating session\'s own device')
  assert.match(auth, /c\.set\('user', user\)\n  const device = sessionDevices\.get\(user\)[\s\S]{0,200}?requestDeviceScope\.run\(\{ userId, \.\.\.device \}, \(\) => next\(\)\)/)
})

// The real buildAuditStatement.
const auditPath = path.join(__dirname, '..', 'src', 'lib', 'audit.ts')
const output = ts.transpileModule(src('lib/audit.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: auditPath }).outputText
const auditModule = { exports: {} }
new Function('exports', 'require', 'module', output)(auditModule.exports, (request) => {
  if (request === './db') return { getDb: () => { throw new Error('not used') } }
  return require(request)
}, auditModule)
const { buildAuditStatement } = auditModule.exports
const hookKey = Symbol.for(KEY_RE.exec(src('lib/auth.ts'))[1])

const db = new DatabaseSync(':memory:')
db.exec(`
  CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
  CREATE TABLE user_sessions (id INTEGER PRIMARY KEY, user_id INTEGER, device_name TEXT, device_tz TEXT, revoked_at TEXT, last_seen_at TEXT);
  CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, user_id INTEGER, user_name TEXT, action TEXT, entity TEXT, entity_id TEXT, details TEXT,
    table_name TEXT, record_id TEXT, old_value TEXT, new_value TEXT, device_name TEXT, device_tz TEXT);
  INSERT INTO users (id, username) VALUES (5, 'editor'), (6, 'other');
  INSERT INTO user_sessions (user_id, device_name, device_tz, last_seen_at) VALUES
    (5, 'Counter Tablet', 'Asia/Phnom_Penh', datetime('now', '-180 seconds')),
    (5, 'Owner Phone', 'Asia/Bangkok', datetime('now', '-60 seconds')),
    (6, 'Back Office PC', 'Asia/Phnom_Penh', datetime('now', '-10 seconds'));
`)
function write(userId, device) {
  if (device === undefined) delete globalThis[hookKey]
  else globalThis[hookKey] = { current: () => device }
  const statement = buildAuditStatement(userId, null, 'update', 'fee', 1, { k: 1 })
  const names = new Set([...statement.sql.matchAll(/@(\w+)/g)].map((m) => m[1]))
  const params = Object.fromEntries([...names].map((name) => [name, statement.params[name] ?? null]))
  db.prepare(statement.sql).run(params)
  return { ...db.prepare('SELECT device_name, device_tz FROM audit_logs ORDER BY id DESC LIMIT 1').get() }
}
const tablet = { userId: 5, deviceName: 'Counter Tablet', deviceTz: 'Asia/Phnom_Penh' }

check('control: outside a request the freshest live session is used, as before', () => {
  assert.deepEqual(write(5, undefined), { device_name: 'Owner Phone', device_tz: 'Asia/Bangkok' })
})
check('inside a request the row names the request\'s device, not the session seen more recently', () => {
  assert.deepEqual(write(5, tablet), { device_name: 'Counter Tablet', device_tz: 'Asia/Phnom_Penh' })
})
check('a row written for another account keeps that account\'s own device', () => {
  assert.deepEqual(write(6, tablet), { device_name: 'Back Office PC', device_tz: 'Asia/Phnom_Penh' })
})
check('a request session with no device records none, never another session\'s device', () => {
  assert.deepEqual(write(5, { userId: 5, deviceName: null, deviceTz: null }), { device_name: null, device_tz: null })
})
check('a row with no actor names no device', () => {
  assert.deepEqual(write(null, tablet), { device_name: null, device_tz: null })
})
delete globalThis[hookKey]

console.log('\n' + passed + ' request-device check(s) passed.')
