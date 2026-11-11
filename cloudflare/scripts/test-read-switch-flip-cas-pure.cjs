'use strict'
// The flip batch (lib/readSwitches.ts buildFlipStatements) against the real migrations in SQLite, with the interleavings a
// request-level test cannot force: the row changing between the route's read and its write, a row appearing where there was none,
// writes held, and a failing audit insert. One db.batch is one transaction, as on D1.
//
// Run: node scripts/test-read-switch-flip-cas-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

function load(relative, requireFor) {
  const filename = path.join(__dirname, '..', 'src', relative)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, requireFor, mod, filename, path.dirname(filename))
  return mod.exports
}
const audit = load('lib/audit.ts', (id) => (id === './db' ? { getDb() { throw new Error('no db') } } : require(id)))
const sw = load('lib/readSwitches.ts', (id) => (id === './db' ? { getDb() { throw new Error('no db') } } : id === './analytics' ? { recordAnalytics() {} } : id === './planTier' ? load('lib/planTier.ts', require) : require(id)))

const fulfil = load('lib/onlineOrderFulfil.ts', (id) => (id === './readSwitches' ? sw : id === './moneyPrecision' ? load('lib/moneyPrecision.ts', require) : id === './onlineMethodInvariant' ? load('lib/onlineMethodInvariant.ts', (inner) => (inner === './paymentMethodRegistry' ? load('lib/paymentMethodRegistry.ts', require) : require(inner))) : require(id)))
const db = openDb(loadAll())
const MAINTENANCE = JSON.stringify({ mode: 'restore', token: 't', backupKey: 'k', startedAt: '2026-01-01T00:00:00.000Z', startedBy: 'x', phase: 'deleting', updatedAt: '2026-01-01T00:00:00.000Z' })
const row = () => db.db.prepare("SELECT value FROM system_flags WHERE key = 'read_switches'").get()?.value ?? null
const audits = () => db.db.prepare("SELECT action, entity, entity_id FROM audit_logs WHERE action = 'read_switch_set'").all().length
const reset = (value) => {
  db.db.exec("DELETE FROM system_flags WHERE key IN ('read_switches', 'maintenance', 'stock_transaction_permit')")
  db.db.exec('DELETE FROM audit_logs')
  if (value !== undefined) db.db.prepare("INSERT INTO system_flags (key, value) VALUES ('read_switches', ?)").run(value)
}
const hold = () => {
  db.db.prepare("INSERT OR REPLACE INTO system_flags (key, value) VALUES ('stock_transaction_permit', (SELECT value FROM system_flags WHERE key = 'stock_schema_epoch'))").run()
  db.db.prepare("INSERT INTO system_flags (key, value) VALUES ('maintenance', ?)").run(MAINTENANCE)
}

function statements(storedRaw, name, token, requirement) {
  const current = sw.parseReadSwitches(storedRaw)
  const target = sw.parseFlipState(token)
  const epoch = current.epoch + 1
  const value = sw.serializeReadSwitches(storedRaw, { name, entry: target }, { epoch, setAt: '2026-11-02T01:00:00.000Z', setBy: 1 })
  const from = sw.formatSwitchToken(current.switches[name])
  const to = sw.formatSwitchToken(target)
  const record = audit.buildAuditStatement(1, 'admin', 'read_switch_set', 'read_switch', name, { name, from, to }, audit.changedFields({ state: from, epoch: current.epoch }, { state: to, epoch }))
  return { value, list: sw.buildFlipStatements({ record, value, expected: storedRaw, off: target.state === 'off', requirement }) }
}

let passed = 0
async function check(name, fn) { try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { process.exitCode = 1; console.error(`FAIL ${name}\n  ${error && error.message}`) } }
const rejects = async (promise) => { try { await promise } catch { return true } return false }

async function main() {
  await check('an unchanged row: the swap, its audit row and the guard commit together', async () => {
    const before = JSON.stringify({ epoch: 2, switches: { probe: 'off' } })
    reset(before)
    const { value, list } = statements(before, 'probe', 'on')
    await db.batch(list)
    assert.equal(row(), value)
    assert.equal(audits(), 1)
  })

  await check('no row yet: the first flip creates it with epoch 1', async () => {
    reset()
    const { value, list } = statements(null, 'probe', 'on')
    await db.batch(list)
    assert.equal(row(), value)
    assert.equal(JSON.parse(row()).epoch, 1)
    assert.equal(audits(), 1)
  })

  await check('the row changed between the read and the write: the batch aborts, the other writer\'s row stands, no audit row', async () => {
    const seen = JSON.stringify({ epoch: 2, switches: { probe: 'off' } })
    reset(seen)
    const { list } = statements(seen, 'probe', 'on')
    const theirs = JSON.stringify({ epoch: 3, switches: { probe: 'shadow:0.05' } })
    db.db.prepare("UPDATE system_flags SET value = ? WHERE key = 'read_switches'").run(theirs)
    assert.ok(await rejects(db.batch(list)), 'the guard aborts the batch')
    assert.equal(row(), theirs)
    assert.equal(audits(), 0)
  })

  await check('a row appeared where the route saw none: the swap matches nothing, the batch aborts, nothing is written', async () => {
    reset()
    const { list } = statements(null, 'probe', 'on')
    const theirs = JSON.stringify({ epoch: 1, switches: { probe: 'off' } })
    db.db.prepare("INSERT INTO system_flags (key, value) VALUES ('read_switches', ?)").run(theirs)
    assert.ok(await rejects(db.batch(list)))
    assert.equal(row(), theirs)
    assert.equal(audits(), 0)
  })

  await check('R5-6: online_orders ON with the stored-method precondition inside the swap: the method removed after the route read it aborts the batch, nothing is written; stored, it commits; a switch without the precondition is unchanged', async () => {
    const seen = JSON.stringify({ epoch: 2, switches: { online_orders: 'off' } })
    reset(seen)
    db.db.exec("DELETE FROM settings WHERE key = 'online_order_payment_method'")
    db.db.exec("INSERT INTO settings (key, value) VALUES ('online_order_payment_method', 'ABA KHQR')")
    const { list } = statements(seen, 'online_orders', 'on', fulfil.ONLINE_METHOD_STORED_SQL)
    db.db.exec("DELETE FROM settings WHERE key = 'online_order_payment_method'")
    assert.ok(await rejects(db.batch(list)), 'the swap matches nothing and the guard aborts')
    assert.equal(row(), seen)
    assert.equal(audits(), 0)
    db.db.exec("INSERT INTO settings (key, value) VALUES ('online_order_payment_method', '   ')")
    assert.ok(await rejects(db.batch(statements(seen, 'online_orders', 'on', fulfil.ONLINE_METHOD_STORED_SQL).list)), 'a blank method is no method')
    db.db.exec("UPDATE settings SET value = 'ABA KHQR' WHERE key = 'online_order_payment_method'")
    const stored = statements(seen, 'online_orders', 'on', fulfil.ONLINE_METHOD_STORED_SQL)
    await db.batch(stored.list)
    assert.equal(row(), stored.value)
    assert.equal(audits(), 1)
    reset(seen)
    db.db.exec("DELETE FROM settings WHERE key = 'online_order_payment_method'")
    const probe = statements(seen, 'online_orders', 'off')
    await db.batch(probe.list)
    assert.equal(row(), probe.value, 'OFF needs no method')
  })

  await check('writes held: ON is refused by the statement itself and writes nothing; OFF goes through', async () => {
    const seen = JSON.stringify({ epoch: 4, switches: { probe: 'off' } })
    reset(seen)
    hold()
    assert.ok(await rejects(db.batch(statements(seen, 'probe', 'on').list)))
    assert.equal(row(), seen)
    assert.equal(audits(), 0)
    const onRow = JSON.stringify({ epoch: 5, switches: { probe: 'on' } })
    db.db.prepare("UPDATE system_flags SET value = ? WHERE key = 'read_switches'").run(onRow)
    const { value, list } = statements(onRow, 'probe', 'off')
    await db.batch(list)
    assert.equal(row(), value)
    assert.equal(audits(), 1)
  })

  await check('writes held and no row yet: the first ON flip is refused too, the first OFF flip is not', async () => {
    reset()
    hold()
    assert.ok(await rejects(db.batch(statements(null, 'probe', 'on').list)))
    assert.equal(row(), null)
    assert.equal(audits(), 0)
    const { value, list } = statements(null, 'probe', 'off')
    await db.batch(list)
    assert.equal(row(), value)
    assert.equal(audits(), 1)
  })

  await check('a failing audit insert rolls the swap back (one transaction)', async () => {
    const seen = JSON.stringify({ epoch: 1, switches: { probe: 'off' } })
    reset(seen)
    db.db.exec("CREATE TRIGGER fault_flip_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'read_switch_set' BEGIN SELECT RAISE(ABORT, 'injected'); END")
    try {
      assert.ok(await rejects(db.batch(statements(seen, 'probe', 'on').list)))
      assert.equal(row(), seen)
    } finally { db.db.exec('DROP TRIGGER fault_flip_audit') }
  })

  await check('the batch is exactly three statements in this order: swap, audit tied to the swap, guard', () => {
    const { list } = statements(null, 'probe', 'on')
    assert.equal(list.length, 3)
    assert.match(list[0].sql, /ON CONFLICT\(key\) DO UPDATE SET value = excluded\.value[\s\S]*WHERE system_flags\.value = @expected/)
    assert.match(list[1].sql, /INSERT INTO audit_logs[\s\S]*WHERE changes\(\) = 1\s*$/)
    assert.match(list[2].sql, /changes\(\) = 1 THEN 1 ELSE json_extract/)
  })

  console.log(`${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
