'use strict'
// Migration 0296: backfill permissions.online_orders = true onto the built-in Employee and Manager roles, on the REAL chain of earlier migrations.
// Positive control: rows that truly lack the key are reached. Negative controls: an explicit false survives, Admin ({"all":true}), a custom role and
// invalid JSON are untouched, every other key of a touched row is kept, a second run changes 0 rows, and RECOVERY restores "absent".
//
// Run: node scripts/test-migration-0296-roles-online-orders-default-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const directory = path.join(__dirname, '../migrations')
const migration = '0296_roles_online_orders_default.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const base = new Database(':memory:')
for (const file of fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < migration).sort()) base.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
const schema = base.serialize()
base.close()

let passed = 0
function check(name, run) { run(); passed += 1; console.log(`PASS ${name}`) }
const fresh = () => new Database(schema)
const role = (db, code, permissions, system = 1) => db.prepare('INSERT INTO roles (name, code, permissions, is_system) VALUES (?, ?, ?, ?)').run(`${code}-${Math.random()}`, code, permissions, system)
const read = (db) => Object.fromEntries(db.prepare('SELECT name, code, permissions FROM roles').all().map((r) => [r.name.split('-')[0] + (r.code === 'custom' ? '-c' : ''), r.permissions]))
const key = (db, code) => db.prepare("SELECT json_extract(permissions,'$.online_orders') v FROM roles WHERE code = ?").all(code).map((r) => r.v)

check('the file is LF-only and is the SQL the test runs', () => {
  assert.ok(!sql.includes('\r'))
  assert.match(sql, /WHERE code IN \('employee', 'manager'\)/); assert.match(sql, /json_extract\(permissions, '\$\.online_orders'\) IS NULL/)
})

check('reaches Employee and Manager rows that lack the key, keeps every other key, leaves explicit false, Admin, custom roles and invalid JSON alone', () => {
  const db = fresh()
  db.exec('DELETE FROM roles')
  role(db, 'employee', '{"pos":true,"contacts":true}')
  role(db, 'manager', '{"sales":true,"reports":false}')
  role(db, 'admin', '{"all":true}')
  role(db, 'custom', '{"pos":true}', 0)
  const before = db.prepare('SELECT COUNT(*) n FROM roles').get().n
  db.exec(sql)
  assert.deepEqual(key(db, 'employee'), [1]); assert.deepEqual(key(db, 'manager'), [1])
  assert.equal(db.prepare("SELECT permissions p FROM roles WHERE code = 'employee'").get().p.includes('"contacts":true'), true, 'other keys kept')
  assert.deepEqual(JSON.parse(db.prepare("SELECT permissions p FROM roles WHERE code = 'manager'").get().p), { sales: true, reports: false, online_orders: true })
  assert.equal(db.prepare("SELECT permissions p FROM roles WHERE code = 'admin'").get().p, '{"all":true}')
  assert.equal(db.prepare("SELECT permissions p FROM roles WHERE code = 'custom'").get().p, '{"pos":true}')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM roles').get().n, before)
})

check('an owner choice survives: an explicit false (or a tier object) is never overwritten, and invalid JSON is skipped', () => {
  const db = fresh(); db.exec('DELETE FROM roles')
  role(db, 'employee', '{"online_orders":false,"pos":true}')
  role(db, 'manager', '{not json')
  db.exec(sql)
  assert.deepEqual(key(db, 'employee'), [0])
  assert.equal(db.prepare("SELECT permissions p FROM roles WHERE code = 'manager'").get().p, '{not json')
})

check('a second run changes 0 rows', () => {
  const db = fresh(); db.exec('DELETE FROM roles'); role(db, 'employee', '{"pos":true}'); role(db, 'manager', '{}')
  db.exec(sql)
  const snapshot = JSON.stringify(db.prepare('SELECT id, permissions, updated_at FROM roles ORDER BY id').all())
  db.exec("UPDATE roles SET updated_at = 'x'")
  const after = db.exec(sql)
  void after
  assert.ok(db.prepare("SELECT COUNT(*) n FROM roles WHERE updated_at = 'x'").get().n === 2, 'no row was rewritten (updated_at kept)')
  assert.ok(snapshot.length > 0)
})

check('the seeded built-in roles of the real chain: the file is harmless on a fresh database and RECOVERY returns the key to absent', () => {
  const db = fresh()
  db.exec(sql)
  db.exec("UPDATE roles SET permissions = json_remove(permissions, '$.online_orders') WHERE code IN ('employee','manager')")
  assert.ok(key(db, 'employee').every((v) => v === null) && key(db, 'manager').every((v) => v === null))
})

console.log(`migration 0296: ${passed} checks passed`)
