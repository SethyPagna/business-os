// The award-points audit row (routes/contacts.ts POST /customers/:id/points) reads the freshest user_sessions row ONLY when the actor is not the user being
// served. When the request's own device answers (lib/audit.ts currentRequestDevice), the LEFT JOIN is not emitted at all, and the device written is the same one the
// SQL CASE (requestDeviceColumnSql) chose before. Both branches are run on the real route over the real migration chain:
//   * own device: the statement has no user_sessions join, the row carries the request's device even when another, fresher session exists (kills "join dropped
//     and the session guess used" and "request device ignored");
//   * another account's request: the join is emitted and the row carries the actor's freshest session (kills "join dropped for everyone");
//   * no request device (outside a request): the join is emitted, same fallback.
// Run (from cloudflare/): node scripts/test-contacts-award-points-device-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
function load(file, dependencies = {}) {
  const filename = path.join(root, 'src', file)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename }).outputText
  const module = { exports: {} }
  new Function('require', 'exports', 'module', output)((name) => {
    if (name in dependencies) return dependencies[name]
    if (name.startsWith('.')) return {}
    return require(name)
  }, module.exports, module)
  return module.exports
}

const ADMIN = { id: 1, username: 'owner', name: 'Owner', role_code: 'admin', role_permissions: '{}', permissions: '{}' }
const db = openDb(loadAll())
db.prepare("UPDATE settings SET value='true' WHERE key='loyalty_points_enabled'").run()
db.prepare("INSERT INTO users (id, username, name, password) VALUES (1, 'owner', 'Owner', 'x'), (2, 'manager', 'Manager', 'x')").run()
db.prepare("INSERT INTO customers (id, name, phone, membership_number, is_anonymous) VALUES (5, 'Dara', '012', 'LC-5', 0)").run()
const session = db.prepare('PRAGMA table_info(user_sessions)').all().map((r) => r.name)
assert.ok(session.includes('device_name') && session.includes('device_tz'), 'user_sessions carries the device columns')
const cols = session.filter((n) => ['id', 'user_id', 'token_hash', 'device_name', 'device_tz', 'last_seen_at', 'created_at', 'expires_at'].includes(n))
// the freshest live session of user 1 is the TILL; the request below comes from the PHONE
const insertSession = (id, name, tz, seen) => {
  const row = { id, user_id: 1, token_hash: `h${id}`, device_name: name, device_tz: tz, last_seen_at: seen, created_at: seen, expires_at: '2999-01-01 00:00:00' }
  const use = cols.filter((n) => n in row)
  db.prepare(`INSERT INTO user_sessions (${use.join(',')}) VALUES (${use.map((n) => `@${n}`).join(',')})`).run(row)
}
insertSession(1, 'Phone', 'Asia/Phnom_Penh', '2026-11-11 08:00:00')
insertSession(2, 'Till', 'Asia/Bangkok', '2026-11-11 09:00:00')

const statements = []
const routeDb = { prepare: (sql) => db.prepare(sql), batch: (items) => { for (const item of items) statements.push(item.sql); return db.batch(items) } }
const permissions = load('lib/permissions.ts')
const contactsApp = load('routes/contacts.ts', {
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', ADMIN); return next() } },
  '../lib/db': { getDb: () => routeDb },
  '../lib/audit': load('lib/audit.ts', { './db': { getDb: () => routeDb } }),
  '../lib/permissions': permissions,
  '../lib/loyaltyEligibility': load('lib/loyaltyEligibility.ts'),
  '../lib/actorSnapshot': load('lib/actorSnapshot.ts'),
  '../lib/anonymousCustomer': load('lib/anonymousCustomer.ts'),
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {}, bumpVersions: async () => {} },
}).default
const executionCtx = { waitUntil() {}, passThroughOnException() {} }
const HOOK = Symbol.for('business-os.request-device.v1')
let seq = 0
async function award(requestDevice) {
  globalThis[HOOK] = requestDevice === undefined ? undefined : { current: () => requestDevice }
  statements.length = 0
  const id = `device_test_${String(++seq).padStart(8, '0')}`
  const response = await contactsApp.request('/customers/5/points', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ points: 5, client_request_id: id }) }, {}, executionCtx)
  assert.equal(response.status, 201, await response.text())
  const row = db.prepare("SELECT device_name, device_tz FROM audit_logs WHERE action = 'award_points' ORDER BY id DESC LIMIT 1").get()
  return { row, audit: statements.find((sql) => sql.includes('INTO audit_logs')) }
}

;(async () => {
  let passed = 0
  const check = async (name, body) => { await body(); passed += 1; console.log(`PASS ${name}`) }

  await check("own device: no user_sessions read, the request's device is written even though another session is fresher", async () => {
    const { row, audit } = await award({ userId: 1, deviceName: 'Phone', deviceTz: 'Asia/Phnom_Penh' })
    assert.ok(audit, 'the receipt statement ran')
    assert.ok(!audit.includes('user_sessions'), 'no session join is emitted')
    assert.deepEqual({ ...row }, { device_name: 'Phone', device_tz: 'Asia/Phnom_Penh' })
  })
  await check("another account's request: the join is emitted and the actor's freshest session is written", async () => {
    const { row, audit } = await award({ userId: 2, deviceName: 'Other phone', deviceTz: 'UTC' })
    assert.ok(audit.includes('user_sessions'))
    assert.deepEqual({ ...row }, { device_name: 'Till', device_tz: 'Asia/Bangkok' })
  })
  await check('no request device: the join is emitted and the same fallback is written', async () => {
    const { row, audit } = await award(undefined)
    assert.ok(audit.includes('user_sessions'))
    assert.deepEqual({ ...row }, { device_name: 'Till', device_tz: 'Asia/Bangkok' })
  })
  await check('own device with no name: the columns are the request\'s nulls, not the session guess', async () => {
    const { row, audit } = await award({ userId: 1, deviceName: null, deviceTz: null })
    assert.ok(!audit.includes('user_sessions'))
    assert.deepEqual({ ...row }, { device_name: null, device_tz: null })
  })
  console.log(`${passed} passed`)
})().catch((e) => { console.error(e); process.exit(1) })
