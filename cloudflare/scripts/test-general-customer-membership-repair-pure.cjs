// Focused real-SQLite regression for the separate legacy membership cleanup.
// No network, remote D1, browser or production data is used.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'generalCustomerMembershipRepair.ts')
const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: sourcePath }).outputText
const Module = require('node:module')
const originalLoad = Module._load
Module._load = function patched(request, parent, isMain) {
  if (request === './cache') return { getVersionWithFallback: async () => 'customers:1', bumpVersion: async () => undefined }
  if (request === '../durable-objects/broadcastHub') return { broadcast: async () => undefined }
  return originalLoad.call(this, request, parent, isMain)
}
const moduleObj = { exports: {} }
try { new Function('exports', 'require', 'module', '__filename', '__dirname', output)(moduleObj.exports, Module.createRequire(sourcePath), moduleObj, sourcePath, path.dirname(sourcePath)) } finally { Module._load = originalLoad }
const repair = moduleObj.exports

const actor = { id: 7, name: 'owner-admin' }
let checks = 0
function pass(label) { checks += 1; console.log(`PASS ${label}`) }
function seed() {
  const db = openDb(loadAll())
  db.exec(`DELETE FROM audit_logs; DELETE FROM action_history; DELETE FROM portal_accounts; DELETE FROM returns; DELETE FROM sales; DELETE FROM customers;`)
  db.prepare(`INSERT INTO customers(id,name,phone,membership_number,updated_at,is_anonymous) VALUES(24969,'general','','LC-04971','2026-09-09 01:52:30',1)`).run()
  db.prepare(`INSERT INTO customers(id,name,phone,membership_number,updated_at,is_anonymous) VALUES(22305,'General','086897171','LC-02448','2026-09-09 01:52:30',0)`).run()
  db.prepare(`INSERT INTO sales(id,receipt_number,customer_id,created_at) VALUES(1,'R-1',24969,'2026-09-09')`).run()
  db.prepare(`INSERT INTO returns(id,return_number,customer_id,created_at) VALUES(1,'RET-1',24969,'2026-09-09')`).run()
  return db
}
function customer(db) { return db.prepare('SELECT membership_number,is_anonymous,updated_at FROM customers WHERE id=24969').get() }

(async () => {
  const db = seed()
  const preview = await repair.previewGeneralCustomerMembershipRepair(db, actor)
  assert.equal(preview.outcome, 'ready')
  assert.equal(preview.target.membership_state, 'legacy_value_present')
  assert.ok(!JSON.stringify(preview).includes('LC-04971'))
  const plan = await repair.prepareGeneralCustomerMembershipRepair(db, preview.request, actor)
  const before = customer(db)
  const applied = await repair.applyGeneralCustomerMembershipRepair(db, plan)
  assert.deepEqual(applied, { outcome: 'applied', changedCustomers: 1, verification_pending: false })
  const after = customer(db)
  assert.equal(after.membership_number, null); assert.equal(after.is_anonymous, 1); assert.notEqual(after.updated_at, before.updated_at)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM action_history WHERE entity='customer_anonymous_repair'").get().n, 1)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='clear_shared_general_membership'").get().n, 1)
  pass('exact preview is redacted and apply clears only membership while preserving marker and links')

  const replay = await repair.prepareGeneralCustomerMembershipRepair(db, preview.request, actor)
  assert.equal(replay.outcome, 'already_applied')
  assert.deepEqual(await repair.applyGeneralCustomerMembershipRepair(db, replay), { outcome: 'already_applied', changedCustomers: 0, verification_pending: false })
  pass('same request replays without a second customer/history/audit mutation')

  const raceDb = seed(); const racePreview = await repair.previewGeneralCustomerMembershipRepair(raceDb, actor); const racePlan = await repair.prepareGeneralCustomerMembershipRepair(raceDb, racePreview.request, actor)
  raceDb.prepare("UPDATE customers SET name='changed' WHERE id=24969").run()
  await assert.rejects(() => repair.applyGeneralCustomerMembershipRepair(raceDb, racePlan), (error) => error instanceof repair.GeneralCustomerMembershipRepairConflictError)
  assert.equal(customer(raceDb).membership_number, 'LC-04971'); assert.equal(raceDb.prepare("SELECT COUNT(*) AS n FROM action_history WHERE entity='customer_anonymous_repair'").get().n, 0)
  pass('profile race fails the exact guard without clearing membership')

  const failureDb = seed(); const failurePreview = await repair.previewGeneralCustomerMembershipRepair(failureDb, actor); const failurePlan = await repair.prepareGeneralCustomerMembershipRepair(failureDb, failurePreview.request, actor)
  failureDb.exec("CREATE TRIGGER fail_membership_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failure'); END")
  await assert.rejects(() => repair.applyGeneralCustomerMembershipRepair(failureDb, failurePlan))
  const failureCustomer = customer(failureDb)
  assert.equal(failureCustomer.membership_number, 'LC-04971'); assert.equal(failureCustomer.is_anonymous, 1); assert.equal(failureCustomer.updated_at, '2026-09-09 01:52:30')
  assert.equal(failureDb.prepare("SELECT COUNT(*) AS n FROM action_history WHERE entity='customer_anonymous_repair'").get().n, 0)
  pass('audit failure rolls back membership and history atomically')
  console.log(`OK ${checks} checks`)
})().catch((error) => { console.error(error); process.exitCode = 1 })
