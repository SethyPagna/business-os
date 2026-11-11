// A record that stamps a device must name the device the REQUEST arrived on, and use the user's most recently seen session only when
// the act is outside a request or for another account. The last-seen touch interval grows from 5 to 15 minutes (getPlanLimits), which
// widens the window in which "most recently seen" is the other device of a person signed in twice; so every record that picked the
// freshest session itself now prefers the request's own device first (as lib/audit.ts buildAuditStatement already did).
//
// Covers: the shared helper and the write-receipt statement (real SQL against SQLite, two devices, the OTHER one seen later);
// each raw audit INSERT of contacts (award points), pos, settings, users (source shape: the freshest-session subquery only as the
// fallback, the request-device params passed); the contact-merge JS path; the touch interval comes from the plan, not a literal;
// and that nothing but the Devices list and the fallbacks reads last_seen_at (no idle timeout or security decision).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildSync } = require('esbuild')
const { DatabaseSync } = require('node:sqlite')

const SRC = path.join(__dirname, '..', 'src')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')
let passed = 0
function check(name, fn) { fn(); passed += 1; console.log('PASS ' + name) }

const bundle = buildSync({ entryPoints: [path.join(SRC, 'lib', 'auditWriteReceipt.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2020', logLevel: 'silent' })
const mod = { exports: {} }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, mod, mod.exports)
const { receiptAuditStatement } = mod.exports
const hookKey = Symbol.for(/REQUEST_DEVICE_HOOK_KEY = '([^']+)'/.exec(read('lib/auth.ts'))[1])

const db = new DatabaseSync(':memory:')
db.exec(`
  CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
  CREATE TABLE user_sessions (id INTEGER PRIMARY KEY, user_id INTEGER, device_name TEXT, device_tz TEXT, revoked_at TEXT, last_seen_at TEXT);
  CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, user_id INTEGER, user_name TEXT, action TEXT, entity TEXT, entity_id TEXT, details TEXT,
    table_name TEXT, record_id TEXT, old_value TEXT, new_value TEXT, device_name TEXT, device_tz TEXT);
  CREATE TABLE promo (id INTEGER PRIMARY KEY, v INTEGER);
  INSERT INTO promo VALUES (1, 0);
  INSERT INTO users (id, username) VALUES (5, 'editor'), (6, 'other');
  INSERT INTO user_sessions (user_id, device_name, device_tz, last_seen_at) VALUES
    (5, 'Counter Tablet', 'Asia/Phnom_Penh', datetime('now', '-900 seconds')),
    (5, 'Owner Phone', 'Asia/Bangkok', datetime('now', '-60 seconds')),
    (6, 'Back Office PC', 'Asia/Phnom_Penh', datetime('now', '-10 seconds'));
`)
let counter = 0
function receipt(actorId, device) {
  if (device === undefined) delete globalThis[hookKey]
  else globalThis[hookKey] = { current: () => device }
  counter += 1
  db.exec('UPDATE promo SET v = v + 1 WHERE id = 1')
  const statement = receiptAuditStatement({ key: { actorId, action: 'update', entity: 'promotion', requestId: `req-${counter}-xxxxxxxx` }, actorName: 'x', entityId: 1, details: { k: 1 }, canonical: '{}' })
  const names = new Set([...statement.sql.matchAll(/@(\w+)/g)].map((m) => m[1]))
  db.prepare(statement.sql).run(Object.fromEntries([...names].map((name) => [name, statement.params[name] ?? null])))
  return { ...db.prepare('SELECT device_name, device_tz FROM audit_logs ORDER BY id DESC LIMIT 1').get() }
}
const tablet = { userId: 5, deviceName: 'Counter Tablet', deviceTz: 'Asia/Phnom_Penh' }
const phone = { userId: 5, deviceName: 'Owner Phone', deviceTz: 'Asia/Bangkok' }

check('a user signed in on two devices: a record from the tablet names the tablet although the phone was seen later', () => {
  assert.deepEqual(receipt(5, tablet), { device_name: 'Counter Tablet', device_tz: 'Asia/Phnom_Penh' })
})
check('and a record from the phone names the phone', () => {
  assert.deepEqual(receipt(5, phone), { device_name: 'Owner Phone', device_tz: 'Asia/Bangkok' })
})
check('a record written for another account keeps that account\'s own freshest device', () => {
  assert.deepEqual(receipt(6, tablet), { device_name: 'Back Office PC', device_tz: 'Asia/Phnom_Penh' })
})
check('outside a request the freshest live session is the fallback, as before', () => {
  assert.deepEqual(receipt(5, undefined), { device_name: 'Owner Phone', device_tz: 'Asia/Bangkok' })
})
check('a request session with no device records none, never another session\'s', () => {
  assert.deepEqual(receipt(5, { userId: 5, deviceName: null, deviceTz: null }), { device_name: null, device_tz: null })
})
delete globalThis[hookKey]

const FRESHEST = /ORDER BY last_seen_at DESC, ?id DESC/g
function freshestOutsideFallback(text) {
  const bad = []
  for (const match of text.matchAll(FRESHEST)) {
    const before = text.slice(Math.max(0, match.index - 400), match.index)
    const open = before.lastIndexOf('requestDeviceColumnSql(')
    const close = before.lastIndexOf(')}')
    if (open < 0 || close > open) bad.push(match.index)
  }
  return bad
}

check('pos, settings and users: the freshest-session subquery is only the fallback of the request-device CASE, and the params are passed', () => {
  for (const [file, params] of [['routes/pos.ts', 'requestDeviceParams()'], ['routes/settings.ts', 'requestDeviceParams()'], ['routes/users.ts', 'requestDeviceParams()']]) {
    const text = read(file)
    assert.ok(/ORDER BY last_seen_at DESC, ?id DESC/.test(text), `${file} still has its fallback`)
    assert.deepEqual(freshestOutsideFallback(text), [], `${file}: a freshest-session pick outside requestDeviceColumnSql`)
    assert.ok(text.includes(params), `${file} passes the request device`)
    assert.match(text, /requestDeviceColumnSql\('@(userId|user_id)', 'device_name'/)
    assert.match(text, /requestDeviceColumnSql\('@(userId|user_id)', 'device_tz'/)
  }
})
check('contacts: the award-points INSERT and the merge both prefer the request device', () => {
  const text = read('routes/contacts.ts')
  assert.equal([...text.matchAll(FRESHEST)].length, 2, 'only the award-points join fallback and the merge fallback pick the freshest session')
  assert.match(text, /requestDeviceColumnSql\('@actorId', 'device_name', 's\.device_name'\)/)
  assert.match(text, /\.\.\.ledgerParams, \.\.\.requestDeviceParams\(\)/)
  assert.match(text, /requestDevice\.userId === Number\(user\.id\)\) \{\n\s*auditDevice = \{ deviceName: requestDevice\.deviceName/)
  assert.match(text, /\} else if \(user\?\.id\) \{\n\s*try \{\n\s*const device = await db\.prepare\(`\n\s*SELECT device_name, device_tz FROM user_sessions/, 'the session read is only the fallback')
})
check('auditWriteReceipt: no bare freshest-session device', () => {
  const text = read('lib/auditWriteReceipt.ts')
  assert.doesNotMatch(text, /\n\s*s\.device_name, s\.device_tz\n/)
  assert.match(text, /requestDeviceColumnSql\('@receiptActor', 'device_name', 's\.device_name'\)/)
})

check('the touch interval is the plan\'s, in code and in the SQL guard; no literal 5 minutes remains', () => {
  const auth = read('lib/auth.ts')
  assert.doesNotMatch(auth, /SESSION_TOUCH_INTERVAL_MS/)
  assert.doesNotMatch(auth, /'-5 minutes'/)
  assert.match(auth, /const touchSeconds = getPlanLimits\(c\.env\)\.sessionTouchIntervalSeconds/)
  assert.match(auth, /isSessionTouchDue\(lastSeenAt, Date\.parse\(nowIso\), touchSeconds \* 1000\)/)
  assert.match(auth, /datetime\(@observed_at, @touch_window\)/)
  assert.match(auth, /touch_window: `-\$\{touchSeconds\} seconds`/)
  const plan = read('lib/planTier.ts')
  assert.equal([...plan.matchAll(/sessionTouchIntervalSeconds: 15 \* 60,/g)].length, 2, 'Paid and Free both 15 minutes')
})

check('nothing decides on last_seen_at: it is written by the touch, listed on the Devices page and used only as the freshest-session fallback', () => {
  const allowed = new Set(['lib/auth.ts', 'routes/devices.ts', 'lib/audit.ts', 'lib/auditWriteReceipt.ts', 'routes/contacts.ts', 'routes/pos.ts', 'routes/settings.ts', 'routes/users.ts', 'routes/feesCatalog.ts', 'lib/deviceTrust.ts', 'lib/portalSession.ts', 'lib/planTier.ts'])
  const hits = []
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, entry.name); if (entry.isDirectory()) { if (entry.name !== 'migrations') walk(p) } else if (p.endsWith('.ts')) { const rel = path.relative(SRC, p).replace(/\\/g, '/'); if (/last_seen_at/.test(fs.readFileSync(p, 'utf8'))) hits.push(rel) } } }
  walk(SRC)
  assert.deepEqual(hits.filter((rel) => !allowed.has(rel)), [], 'a new reader of last_seen_at needs a review')
  for (const rel of ['lib/auth.ts']) {
    const lines = read(rel).split('\n').filter((line) => /last_seen_at/.test(line))
    for (const line of lines) assert.doesNotMatch(line, /expires_at|revoked_at\s*=|must_change|DELETE/i, 'no expiry or revoke decision on last_seen_at: ' + line)
  }
  const slide = read('lib/auth.ts')
  assert.match(slide, /slideSessionExpiry/, 'expiry slides on expires_at')
})

console.log('\n' + passed + ' session-device check(s) passed.')
