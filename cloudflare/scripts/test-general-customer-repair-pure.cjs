// Focused real-SQLite regression for the fixed customer-24969 repair helper.
// No Hono route, network, remote D1 binding, or production data is available.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'generalCustomerRepair.ts')
const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText

let currentCacheToken = 'd2:10'
let suppressCacheAdvance = false
let cacheReadFails = false
const broadcasts = []
const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === './cache') return {
    getVersionWithFallback: async () => {
      if (cacheReadFails) throw new Error('cache read unavailable')
      return currentCacheToken
    },
    bumpVersion: async () => {
      if (!suppressCacheAdvance) currentCacheToken = `d2:${Number(currentCacheToken.split(':')[1]) + 1}`
    },
  }
  if (request === '../durable-objects/broadcastHub') return {
    broadcast: async (_env, channel, payload) => { broadcasts.push({ channel, payload }) },
  }
  return originalLoad.call(this, request, parent, isMain)
}
const moduleObj = { exports: {} }
try {
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
    moduleObj.exports, Module.createRequire(sourcePath), moduleObj, sourcePath, path.dirname(sourcePath),
  )
} finally {
  Module._load = originalLoad
}
const repair = moduleObj.exports

const actor = { id: 7, name: 'owner-admin' }
let db
let nativeBatch
let beforeBatchHook = null
let afterBatchHook = null
let checks = 0

function pass(message) {
  checks += 1
  console.log(`PASS ${message}`)
}

function row(sql, params = {}) { return db.prepare(sql).get(params) }
function all(sql, params = {}) { return db.prepare(sql).all(params) }
function exec(sql) { db.exec(sql) }

function newDb() {
  db = openDb(loadAll())
  nativeBatch = db.batch.bind(db)
  db.batch = async (statements) => {
    if (beforeBatchHook) {
      const hook = beforeBatchHook
      beforeBatchHook = null
      await hook()
    }
    const results = await nativeBatch(statements)
    if (afterBatchHook) {
      const hook = afterBatchHook
      afterBatchHook = null
      await hook()
    }
    return results
  }
  seed()
}

function seed() {
  exec(`
    DELETE FROM audit_logs;
    DELETE FROM action_history;
    DELETE FROM portal_accounts;
    DELETE FROM returns;
    DELETE FROM sales;
    DELETE FROM customers;
    DELETE FROM system_flags WHERE key='maintenance';
  `)
  db.prepare(`INSERT INTO customers(
      id,name,phone,email,address,company,notes,created_at,membership_number,updated_at,gender,phone_normalized,is_anonymous)
    VALUES(@id,@name,@phone,@email,@address,@company,@notes,@created,@membership,@updated,@gender,@normalized,0)`).run({
    id: 24969, name: 'general', phone: '', email: 'private@example.test', address: 'private address',
    company: 'private company', notes: 'private notes', created: '2026-08-01 01:02:03',
    membership: 'LC-04971', updated: '2026-09-04 04:54:57', gender: 'other', normalized: '',
  })
  db.prepare(`INSERT INTO customers(id,name,phone,updated_at,is_anonymous)
    VALUES(22305,'General Real','086897171','2026-09-04 04:54:57',0)`).run()
  for (const id of [101, 102, 103, 104, 105]) {
    db.prepare(`INSERT INTO sales(id,receipt_number,customer_id,customer_name,created_at)
      VALUES(@id,@receipt,24969,'general','2026-09-01 00:00:00')`).run({ id, receipt: `R-${id}` })
  }
  db.prepare(`INSERT INTO returns(id,return_number,customer_id,customer_name,created_at)
    VALUES(201,'RET-201',24969,'general','2026-09-02 00:00:00')`).run()
}

async function preview() {
  return repair.previewGeneralCustomerRepair(db, actor)
}

async function prepared() {
  const current = await preview()
  return repair.prepareGeneralCustomerRepair(db, current.request, actor)
}

function effects() {
  return {
    marker: Number(row('SELECT is_anonymous FROM customers WHERE id=24969')?.is_anonymous ?? -1),
    histories: Number(row(`SELECT COUNT(*) count FROM action_history WHERE entity='customer_anonymous_repair'`)?.count ?? -1),
    audits: Number(row(`SELECT COUNT(*) count FROM audit_logs WHERE action='mark_anonymous_customer'`)?.count ?? -1),
    events: Number(row('SELECT COUNT(*) count FROM sale_record_events')?.count ?? -1),
  }
}

async function expectConflict(run, label) {
  await assert.rejects(run, (error) => error instanceof repair.GeneralCustomerRepairConflictError)
  assert.deepEqual(effects(), { marker: 0, histories: 0, audits: 0, events: 0 })
  pass(label)
}

async function testPreviewPrivacyAndApply() {
  newDb()
  const view = await preview()
  assert.equal(view.outcome, 'ready')
  assert.deepEqual(view.target, {
    id: 24969, name: 'general', phone_state: 'known_empty', address_state: 'known_present',
    is_anonymous: 0, portal_account_count: 0, sale_count: 5, return_count: 1,
  })
  assert.equal(view.protected_customer.id, 22305)
  assert.match(view.request.manifest_sha256, /^[a-f0-9]{64}$/)
  const serialized = JSON.stringify(view)
  for (const secret of ['private@example.test', 'private address', 'private company', 'private notes', 'LC-04971']) {
    assert.ok(!serialized.includes(secret), `preview leaked ${secret}`)
  }
  const plan = await repair.prepareGeneralCustomerRepair(db, view.request, actor)
  const before = row('SELECT * FROM customers WHERE id=24969')
  const result = await repair.applyGeneralCustomerRepair(db, plan)
  assert.deepEqual(result, { outcome: 'applied', changedCustomers: 1, verification_pending: false })
  const after = row('SELECT * FROM customers WHERE id=24969')
  assert.equal(after.is_anonymous, 1)
  assert.notEqual(after.updated_at, before.updated_at)
  for (const key of Object.keys(before)) {
    if (!['is_anonymous', 'updated_at'].includes(key)) assert.equal(after[key], before[key], key)
  }
  assert.deepEqual(all('SELECT id FROM sales WHERE customer_id=24969 ORDER BY id').map((item) => Number(item.id)), [101, 102, 103, 104, 105])
  assert.deepEqual(all('SELECT id FROM returns WHERE customer_id=24969 ORDER BY id').map((item) => Number(item.id)), [201])
  assert.equal(row('SELECT is_anonymous FROM customers WHERE id=22305').is_anonymous, 0)
  assert.deepEqual(effects(), { marker: 1, histories: 1, audits: 1, events: 0 })
  const audit = row(`SELECT details,old_value,new_value FROM audit_logs WHERE action='mark_anonymous_customer'`)
  assert.deepEqual(JSON.parse(audit.details), {
    operation_key: 'f72:shared-general:24969:v1', customer_id: 24969,
    decision: 'owner_confirmed_shared_general', changed_field: 'is_anonymous',
    before: 0, after: 1, preserved_profile: true, preserved_links: true,
  })
  assert.ok(!audit.details.includes(view.request.manifest_sha256))
  pass('preview is redacted and apply changes only marker/version with one privacy-safe receipt and audit')
}

async function testReplayAndConcurrency() {
  newDb()
  const first = await preview()
  const planA = await repair.prepareGeneralCustomerRepair(db, first.request, actor)
  const planB = await repair.prepareGeneralCustomerRepair(db, first.request, actor)
  assert.equal((await repair.applyGeneralCustomerRepair(db, planA)).outcome, 'applied')
  assert.deepEqual(await repair.applyGeneralCustomerRepair(db, planB), {
    outcome: 'already_applied', changedCustomers: 0, verification_pending: false,
  })
  const replayPlan = await repair.prepareGeneralCustomerRepair(db, first.request, actor)
  assert.equal(replayPlan.outcome, 'already_applied')
  assert.equal((await repair.applyGeneralCustomerRepair(db, replayPlan)).outcome, 'already_applied')
  const replayPreview = await preview()
  assert.equal(replayPreview.outcome, 'already_applied')
  assert.deepEqual(replayPreview.request, first.request)
  assert.deepEqual(effects(), { marker: 1, histories: 1, audits: 1, events: 0 })
  pass('two prepared callers converge on one mutation and exact replay remains idempotent')
}

async function testEveryProfileGuard() {
  const mutations = {
    name: "name='changed'", phone: "phone='1'", email: "email='changed'", address: "address='changed'",
    company: "company='changed'", notes: "notes='changed'", created_at: "created_at='2026-08-01 01:02:04'",
    membership_number: "membership_number='LC-X'", updated_at: "updated_at='2026-09-04 04:54:58'",
    gender: "gender='male'", phone_normalized: "phone_normalized='1'", is_anonymous: 'is_anonymous=1',
  }
  for (const [column, assignment] of Object.entries(mutations)) {
    newDb()
    const plan = await prepared()
    beforeBatchHook = () => exec(`UPDATE customers SET ${assignment} WHERE id=24969`)
    await assert.rejects(() => repair.applyGeneralCustomerRepair(db, plan), (error) => error instanceof repair.GeneralCustomerRepairConflictError)
    assert.equal(row('SELECT COUNT(*) count FROM action_history').count, 0, column)
    assert.equal(row('SELECT COUNT(*) count FROM audit_logs').count, 0, column)
  }
  pass('same-second changes to every mutable profile column fail the atomic full-row guard')
}

async function testLinkedAuthorityGuards() {
  for (const [label, hook] of [
    ['linked sale added', () => db.prepare(`INSERT INTO sales(id,receipt_number,customer_id,created_at) VALUES(106,'R-106',24969,'2026-09-01')`).run()],
    ['linked return added', () => db.prepare(`INSERT INTO returns(id,return_number,customer_id,created_at) VALUES(202,'RET-202',24969,'2026-09-01')`).run()],
    ['portal account added', () => db.prepare(`INSERT INTO portal_accounts(id,membership_id,name,phone,password_hash,contact_id) VALUES(1,'M1','x','0123','hash',24969)`).run()],
    ['protected marker changed', () => db.prepare('UPDATE customers SET is_anonymous=1 WHERE id=22305').run()],
  ]) {
    newDb()
    const plan = await prepared()
    beforeBatchHook = hook
    await assert.rejects(() => repair.applyGeneralCustomerRepair(db, plan), (error) => error instanceof repair.GeneralCustomerRepairConflictError, label)
    assert.equal(row('SELECT COUNT(*) count FROM action_history').count, 0)
    assert.equal(row('SELECT COUNT(*) count FROM audit_logs').count, 0)
  }
  pass('linked sale/return, portal-account and protected-customer races abort without repair effects')
}

async function testValidationAndConflictingStates() {
  newDb()
  const view = await preview()
  for (const body of [
    { ...view.request, target_id: 24969 },
    { ...view.request, confirmation: 'wrong' },
    { ...view.request, manifest_sha256: '0'.repeat(64) },
    { ...view.request, expected_updated_at: 'stale' },
  ]) {
    const ErrorType = body.target_id || body.confirmation === 'wrong'
      ? repair.GeneralCustomerRepairValidationError : repair.GeneralCustomerRepairConflictError
    await assert.rejects(() => repair.prepareGeneralCustomerRepair(db, body, actor), (error) => error instanceof ErrorType)
  }
  await assert.rejects(() => repair.previewGeneralCustomerRepair(db, {}), (error) => error instanceof repair.GeneralCustomerRepairValidationError)
  exec("UPDATE customers SET name='General' WHERE id=24969")
  await assert.rejects(() => preview(), (error) => error instanceof repair.GeneralCustomerRepairConflictError)
  newDb()
  exec('UPDATE customers SET is_anonymous=1 WHERE id=24969')
  await assert.rejects(() => preview(), (error) => error instanceof repair.GeneralCustomerRepairConflictError)
  newDb()
  exec(`INSERT INTO system_flags(key,value) VALUES('maintenance','{"mode":"restore"}')`)
  await assert.rejects(() => preview(), (error) => error instanceof repair.GeneralCustomerRepairConflictError)
  pass('request allowlist, actor, digest, identity, unreceipted marker and maintenance checks fail closed')
}

async function testInjectedFailureRollsBack() {
  for (const failure of ['history', 'audit', 'final']) {
    newDb()
    const plan = await prepared()
    if (failure === 'history') exec(`CREATE TRIGGER fail_repair_history BEFORE INSERT ON action_history BEGIN SELECT RAISE(ABORT,'history failure'); END`)
    if (failure === 'audit') exec(`CREATE TRIGGER fail_repair_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failure'); END`)
    if (failure === 'final') plan.statements[5] = { sql: "SELECT json_extract('forced final failure','$')", params: {} }
    await assert.rejects(() => repair.applyGeneralCustomerRepair(db, plan))
    assert.deepEqual(effects(), { marker: 0, histories: 0, audits: 0, events: 0 })
  }
  pass('history, audit and final-assertion failures roll back the marker and every receipt')
}

async function testCommittedResultSurvivesVerificationOutage() {
  newDb()
  const plan = await prepared()
  afterBatchHook = () => {
    const stablePrepare = db.prepare.bind(db)
    db.prepare = (sql) => {
      db.prepare = stablePrepare
      throw new Error(`post-commit read unavailable: ${sql.slice(0, 12)}`)
    }
  }
  assert.deepEqual(await repair.applyGeneralCustomerRepair(db, plan), {
    outcome: 'applied', changedCustomers: 1, verification_pending: true,
  })
  assert.deepEqual(effects(), { marker: 1, histories: 1, audits: 1, events: 0 })
  pass('post-commit verification outage reports pending without misreporting the committed mutation')
}

async function testRefreshHealing() {
  currentCacheToken = 'd2:10'
  suppressCacheAdvance = false
  cacheReadFails = false
  broadcasts.length = 0
  const before = await repair.readGeneralCustomerRepairCacheToken({})
  assert.deepEqual(await repair.refreshGeneralCustomerRepair({}, before), {
    cache_invalidated: true, refresh_pending: false, broadcast_requested: true,
  })
  assert.deepEqual(broadcasts.pop(), {
    channel: 'customers', payload: { action: 'update', id: 24969, reason: 'anonymous_marker_repair' },
  })
  suppressCacheAdvance = true
  const stalled = await repair.readGeneralCustomerRepairCacheToken({})
  assert.deepEqual(await repair.refreshGeneralCustomerRepair({}, stalled), {
    cache_invalidated: false, refresh_pending: true, broadcast_requested: true,
  })
  suppressCacheAdvance = false
  assert.deepEqual(await repair.refreshGeneralCustomerRepair({}, stalled), {
    cache_invalidated: true, refresh_pending: false, broadcast_requested: true,
  })
  cacheReadFails = true
  assert.equal(await repair.readGeneralCustomerRepairCacheToken({}), null)
  assert.deepEqual(await repair.refreshGeneralCustomerRepair({}, null), {
    cache_invalidated: false, refresh_pending: true, broadcast_requested: true,
  })
  cacheReadFails = false
  pass('cache advancement is verified and exact retry heals a pending refresh while always requesting broadcast')
}

async function main() {
  await testPreviewPrivacyAndApply()
  await testReplayAndConcurrency()
  await testEveryProfileGuard()
  await testLinkedAuthorityGuards()
  await testValidationAndConflictingStates()
  await testInjectedFailureRollsBack()
  await testCommittedResultSurvivesVerificationOutage()
  await testRefreshHealing()
  console.log(`general customer repair: ${checks} focused groups passed`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
