// A settings save writes only what changed (owner, 5 Oct 2026: "save buttons
// update EVERYTHING to latest instead of only the changed fields").
//
// The Settings form resends the whole map it loaded and the Website Editor
// resends ~105 keys. POST /api/settings used to upsert every key it was sent:
// one D1 write each, a moved updated_at (so another device's next save of that
// key looked like a conflict), an audit row, a settings-version bump (which on
// the Free plan invalidates the storefront cache) and a broadcast -- even when
// not one value differed.
//
// Drives the REAL routes/settings.ts and the real audit changedFields() against
// the migrated schema, counting the statements the route sends to D1.
// Fails on a284ac64d (100 upserts for a 2-key change; a no-op still writes).
//
// Run: node scripts/test-settings-save-changed-keys-only-pure.cjs

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

const base = openDb(loadAll())
const log = { reads: 0, batches: [], writes: [], audits: [], bumps: 0, broadcasts: [] }
function resetLog() {
  log.reads = 0
  log.batches = []
  log.writes = []
  log.audits = []
  log.bumps = 0
  log.broadcasts = []
}
// The route's own D1 traffic: every SELECT it prepares, every batch it sends.
const db = {
  staging: base,
  prepare(sql) {
    if (/^\s*SELECT/i.test(sql)) log.reads += 1
    else log.writes.push(sql)
    return base.prepare(sql)
  },
  async batch(items) {
    log.batches.push(items.map((item) => item.sql))
    return base.batch(items)
  },
  exec: (sql) => base.exec(sql),
}

let sessionUser = null
const cache = new Map()
const overrides = {
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', sessionUser); return next() } },
  '../lib/audit': {
    get changedFields() { return load('lib/audit.ts').changedFields },
    get auditChangeColumns() { return load('lib/audit.ts').auditChangeColumns },
    get isSecretShapedAuditKey() { return load('lib/audit.ts').isSecretShapedAuditKey },
    audit: async (...args) => { log.audits.push(args) },
  },
  '../durable-objects/broadcastHub': { broadcast: async (...args) => { log.broadcasts.push(args) } },
  '../lib/cache': { bumpVersion: async () => { log.bumps += 1 } },
}
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
const ADMIN = { id: 1, username: 'owner', permissions: JSON.stringify({ all: true }), role_code: 'admin', role_permissions: null }
const SETTINGS_HOLDER = { id: 2, username: 'manager', permissions: JSON.stringify({ settings: true }), role_code: null, role_permissions: null }

async function save(body, user = ADMIN) {
  sessionUser = user
  resetLog()
  const res = await app.request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { DB: db }, { waitUntil() {}, passThroughOnException() {} })
  return { status: res.status, body: await res.json() }
}
const OLD = '2020-01-01 00:00:00'
const row = (key) => base.prepare('SELECT value, updated_at FROM settings WHERE key = @key').get({ key })
function seed(key, value, updatedAt = OLD) {
  base.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (@key, @value, @updatedAt)').run({ key, value, updatedAt })
}
const settingsUpserts = () => log.batches.flat().filter((sql) => /INSERT INTO settings \(key, value, updated_at\)/.test(sql)).length

// The whole form: 100 loaded keys, as the Settings page sends them.
function seedForm(count = 100) {
  const form = {}
  for (let i = 0; i < count; i += 1) {
    form[`form_setting_${i}`] = `value ${i}`
    seed(`form_setting_${i}`, `value ${i}`)
  }
  return form
}

async function main() {
  await check('a whole-form save with two edits writes two keys, in one batch, and leaves the other 98 rows alone', async () => {
    const form = seedForm()
    const res = await save({ ...form, form_setting_3: 'edited three', form_setting_77: 'edited seventy-seven' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(settingsUpserts(), 2, 'one upsert per CHANGED key (the old route sent 100)')
    assert.equal(log.batches.length, 1, 'one batch')
    assert.deepEqual([...res.body.keys].sort(), ['form_setting_3', 'form_setting_77'])
    assert.equal(res.body.unchanged.length, 98)
    assert.equal(row('form_setting_3').value, 'edited three')
    assert.equal(row('form_setting_77').value, 'edited seventy-seven')
    assert.equal(row('form_setting_50').updated_at, OLD, 'an unchanged key keeps its updated_at, so no other device sees a false conflict')
    assert.equal(row('form_setting_3').updated_at === OLD, false, 'a changed key is stamped')
  })

  await check('the audit row and the answer name only the changed keys, with before and after per key', async () => {
    const form = seedForm(10)
    const res = await save({ ...form, form_setting_2: 'two!', form_setting_5: 'five!' })
    assert.equal(res.status, 200)
    assert.equal(log.audits.length, 1)
    const [, , , action, entity, , details, change] = log.audits[0]
    assert.equal(action, 'update')
    assert.equal(entity, 'settings')
    assert.deepEqual([...details.keys].sort(), ['form_setting_2', 'form_setting_5'])
    assert.deepEqual(change.before, { form_setting_2: 'value 2', form_setting_5: 'value 5' })
    assert.deepEqual(change.after, { form_setting_2: 'two!', form_setting_5: 'five!' })
  })

  await check('a save that changes nothing writes nothing, audits nothing, bumps no cache version and broadcasts nothing', async () => {
    const form = seedForm()
    const res = await save(form)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(res.body.keys, [])
    assert.equal(log.batches.length, 0, 'no batch')
    assert.equal(log.writes.length, 0, 'no single write either')
    assert.equal(log.audits.length, 0, 'no audit row')
    assert.equal(log.bumps, 0, 'no settings-version bump (it invalidates the storefront cache)')
    assert.equal(log.broadcasts.length, 0, 'no broadcast to every open tab')
    assert.equal(row('form_setting_9').updated_at, OLD)
  })

  await check('a real change still bumps the version once and broadcasts once, naming the keys and a write id', async () => {
    const form = seedForm(5)
    const res = await save({ ...form, form_setting_1: 'changed' })
    assert.equal(log.bumps, 1)
    assert.equal(log.broadcasts.length, 1)
    const [, channel, payload] = log.broadcasts[0]
    assert.equal(channel, 'settings')
    assert.deepEqual(payload.keys, ['form_setting_1'])
    assert.equal(typeof payload.writeId, 'string')
    assert.equal(payload.writeId, res.body.writeId, 'the saver can match the broadcast to its own save')
  })

  await check('the save reads D1 at most twice (was 3-4): one read of the sent keys, one scoped updatedAt', async () => {
    const form = seedForm(100)
    await save({ ...form, form_setting_0: 'x' }, SETTINGS_HOLDER)
    assert.ok(log.reads <= 2, `${log.reads} reads`)
    seedForm(100)
    await save({ ...form, form_setting_0: 'x', expectedUpdatedAt: OLD }, SETTINGS_HOLDER)
    assert.ok(log.reads <= 2, `with an expected version: ${log.reads} reads`)
  })

  await check('false conflict gone: saving only the changed key with that key\'s own version succeeds although a sibling moved later', async () => {
    seed('conf_a', 'a', '2026-10-01 10:00:00')
    seed('conf_b', 'b', '2026-10-05 10:00:00')
    const whole = await save({ conf_a: 'a2', conf_b: 'b', expectedUpdatedAt: '2026-10-01 10:00:00' })
    assert.equal(whole.status, 409, 'the whole-form shape still conflicts: conf_b is newer than the version it carried')
    const onlyChanged = await save({ conf_a: 'a2', expectedUpdatedAt: '2026-10-01 10:00:00' })
    assert.equal(onlyChanged.status, 200, JSON.stringify(onlyChanged.body))
  })

  await check('a conflict still answers with the stored values of the sent keys, and writes nothing', async () => {
    seed('conf_c', 'c', '2026-10-05 10:00:00')
    const res = await save({ conf_c: 'mine', expectedUpdatedAt: '2026-10-01 10:00:00' })
    assert.equal(res.status, 409)
    assert.deepEqual(res.body.currentSettings, { conf_c: 'c' })
    assert.equal(log.batches.length, 0)
    assert.equal(row('conf_c').value, 'c')
  })

  await check('a brand-new key is written even though no row exists to compare with', async () => {
    const res = await save({ brand_new_key: '' })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.keys, ['brand_new_key'])
    assert.equal(row('brand_new_key').value, '')
  })

  await check('values the Worker normalises come back in `saved`, so the saver needs no refetch to see them', async () => {
    seed('receipt_template', JSON.stringify({ font_size: 12, text_contrast: 'normal' }))
    const res = await save({ receipt_template: JSON.stringify({ font_size: 14 }) })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(res.body.keys, ['receipt_template'])
    assert.equal(JSON.parse(res.body.saved.receipt_template).text_contrast, 'normal')
    const plain = await save({ form_plain: 'same' })
    assert.equal(plain.body.saved, undefined, 'an unmodified value is not echoed back')
  })

  await check('a template the Worker would store identically is a no-op (sanitised text compared, not the raw request)', async () => {
    const stored = JSON.stringify({ font_size: 14, text_contrast: 'normal' })
    seed('receipt_template', stored)
    const res = await save({ receipt_template: JSON.stringify({ font_size: 14, text_contrast: 'normal' }) })
    assert.deepEqual(res.body.keys, [])
    assert.equal(log.batches.length, 0)
  })

  await check('payment methods: unchanged list adds no guard statements; a changed list keeps the three-statement guard', async () => {
    seed('pos_payment_methods', JSON.stringify(['Cash', 'ABA']))
    const same = await save({ pos_payment_methods: JSON.stringify(['Cash', 'ABA']) })
    assert.equal(same.status, 200, JSON.stringify(same.body))
    assert.equal(log.batches.length, 0, 'nothing to write')
    const changed = await save({ pos_payment_methods: JSON.stringify(['Cash', 'ABA', 'Wing']) })
    assert.equal(changed.status, 200, JSON.stringify(changed.body))
    assert.equal(log.batches.length, 1)
    assert.equal(log.batches[0].length, 4, 'DELETE guard, INSERT guard, the upsert, DELETE guard')
    assert.deepEqual(JSON.parse(row('pos_payment_methods').value), ['Cash', 'ABA', 'Wing'])
  })

  await check('permission and admin-only checks still run before any diff', async () => {
    seed('some_unbucketed_key', 'v')
    const denied = await save({ some_unbucketed_key: 'v' }, { id: 9, username: 'cashier', permissions: JSON.stringify({}), role_code: null, role_permissions: null })
    assert.equal(denied.status, 403, 'even an unchanged value needs the grant (updatedAt is not readable without it)')
  })

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) process.exit(1)
}

main().catch((error) => { console.error(error); process.exit(1) })
