const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const db = openDb([
  `CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT);
   CREATE TABLE user_sessions(id INTEGER PRIMARY KEY,user_id INTEGER,device_name TEXT,device_tz TEXT,revoked_at TEXT,last_seen_at TEXT);
   CREATE TABLE audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,user_name TEXT,action TEXT,entity TEXT,entity_id TEXT,details TEXT,table_name TEXT,record_id TEXT,new_value TEXT,device_name TEXT,device_tz TEXT,created_at TEXT);`,
])

function loadReal(relPath, overrides = {}) {
  const sourcePath = path.join(cloudflareRoot, 'src', relPath)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request in overrides) return overrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const moduleObject = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', output)(moduleObject.exports, require, moduleObject, sourcePath, path.dirname(sourcePath))
    return moduleObject.exports
  } finally {
    Module._load = originalLoad
  }
}

const permissions = loadReal('lib/permissions.ts')
const addressPresets = loadReal('lib/addressPresets.ts')
let user = { id: 7, username: 'cashier', role_permissions: JSON.stringify({ pos: true }) }
const route = loadReal('routes/pos.ts', {
  '../lib/addressPresets': addressPresets,
  '../lib/actorSnapshot': { actorSnapshot: (actor) => actor?.username || null },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', user); return next() } },
  '../lib/cache': { bumpVersion: async () => {} },
  '../lib/db': { getDb: () => db },
  '../lib/permissions': permissions,
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
}).default
route.onError((_error, c) => c.json({ error: 'Internal Server Error' }, 500))

const env = { DB: db }
const context = { waitUntil(promise) { promise?.catch?.(() => {}) }, passThroughOnException() {} }
async function request(method, body) {
  const response = await route.request('http://local/address-presets', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env, context)
  return { status: response.status, body: await response.json().catch(() => null) }
}

async function main() {
  user = { id: 9, username: 'blocked', role_permissions: '{}' }
  assert.equal((await request('GET')).status, 403)
  console.log('PASS authenticated account without POS access cannot read shared addresses')

  user = { id: 8, username: 'readonly', role_permissions: JSON.stringify({ pos: true, 'pos:manage_address_presets': false }) }
  const readonly = await request('GET')
  assert.equal(readonly.status, 200)
  assert.equal(readonly.body.can_manage, false)
  assert.equal((await request('PUT', { expected_revision: null, presets: { province: [], district: [], subdistrict: [] } })).status, 403)
  console.log('PASS action-narrowed POS access can read but cannot manage presets')

  user = { id: 7, username: 'cashier', role_permissions: JSON.stringify({ pos: true }) }
  const empty = await request('GET')
  assert.deepEqual(empty.body, { configured: false, revision: null, presets: { province: [], district: [], subdistrict: [] }, can_manage: true })
  assert.equal((await request('PUT', { presets: { province: [], district: [], subdistrict: [] } })).status, 400)
  assert.equal((await request('PUT', { expected_revision: null, presets: { province: 'not-an-array', district: [], subdistrict: [] } })).status, 400)
  assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM settings').get({}).n), 0)
  console.log('PASS malformed and unversioned writes fail before settings or audit')
  const first = await request('PUT', {
    expected_revision: null,
    presets: { province: [' Phnom Penh ', 'phnom   penh'], district: ['Chamkar Mon'], subdistrict: ['Tonle Bassac'] },
  })
  assert.equal(first.status, 200)
  assert.deepEqual(first.body.presets.province, ['Phnom Penh'])
  assert.ok(first.body.revision)
  assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity='pos_address_presets'").get({}).n), 1)
  console.log('PASS first full-POS write normalizes and atomically records its audit')

  const stale = await request('PUT', {
    expected_revision: null,
    presets: { province: ['Kandal'], district: [], subdistrict: [] },
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.code, 'write_conflict')
  assert.equal((await request('GET')).body.revision, first.body.revision)
  assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity='pos_address_presets'").get({}).n), 1)
  console.log('PASS stale device changes neither presets nor audit')

  const second = await request('PUT', {
    expected_revision: first.body.revision,
    presets: { province: ['Kandal'], district: ['Khsach Kandal'], subdistrict: [] },
  })
  assert.equal(second.status, 200)
  assert.notEqual(second.body.revision, first.body.revision)
  assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity='pos_address_presets'").get({}).n), 2)

  const beforeAuditFailure = db.prepare("SELECT value FROM settings WHERE key='pos_address_presets_v1'").get({}).value
  db.exec(`CREATE TRIGGER reject_pos_preset_audit BEFORE INSERT ON audit_logs
           WHEN NEW.entity='pos_address_presets' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;`)
  const failed = await request('PUT', {
    expected_revision: second.body.revision,
    presets: { province: ['Siem Reap'], district: [], subdistrict: [] },
  })
  assert.equal(failed.status, 500)
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='pos_address_presets_v1'").get({}).value, beforeAuditFailure)
  console.log('PASS audit failure rolls back the settings CAS in the same native transaction')

  db.exec('DROP TRIGGER reject_pos_preset_audit;')
  db.prepare("UPDATE settings SET value='not-json' WHERE key='pos_address_presets_v1'").run({})
  assert.equal((await request('GET')).status, 500)
  console.log('PASS corrupt stored data fails loudly instead of becoming an empty preset list')

  console.log('PASS POS address presets native route contract')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
