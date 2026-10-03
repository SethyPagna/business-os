const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const migrationPath = path.join(__dirname, '../migrations/0223_branch_lifecycle_identity.sql')
let failures = 0
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`) }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`) }
}

async function main() {
  await check('0223 preserves every prior table value and accepts legacy fresh seeding', () => {
    assert.ok(fs.existsSync(migrationPath), 'authorized additive migration exists')
    const d1 = openDb(loadAll({ through: 222 }))
    const db = d1.db
    db.exec(`INSERT INTO branches(id,name,notes,is_active,is_default,updated_at) VALUES(1,'Shop','sales',1,1,'same'),(2,'Warehouse','stock',1,0,'same');
      INSERT INTO pending_actions(section,action_type,entity_type,entity_id,payload_json) VALUES('branches','update','branch',1,'{"notes":"waiting"}');
      INSERT INTO stock_session_operations(id,actor_id,request_id,mode,request_json) VALUES('keep',1,'keep','stock_in','{}');`)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map(({ name }) => ({ name, columns: db.prepare(`PRAGMA table_info("${name}")`).all().map(row => row.name) }))
    const snapshot = () => JSON.stringify(tables.map(({ name, columns }) => db.prepare(`SELECT ${columns.map(column => `"${column}"`).join(',')} FROM "${name}"`).all()))
    const before = snapshot()
    const sql = fs.readFileSync(migrationPath, 'utf8')
    assert.equal(sql.includes('\r'), false)
    db.exec(sql)
    assert.equal(snapshot(), before)
    assert.deepEqual(db.prepare('SELECT role,canonical_key,successor_branch_id FROM branches').all().map(row => Object.values(row)), [[null, null, null], [null, null, null]])
    assert.equal(db.prepare('SELECT expected_entity_state_json FROM pending_actions').get().expected_entity_state_json, null)
    db.exec("INSERT INTO branches(name,is_active,is_default) VALUES('Legacy',1,0)")
    assert.equal(db.prepare("SELECT role FROM branches WHERE name='Legacy'").get().role, null)
    db.close()
  })
  await check('0223 rejects malformed lifecycle identity and keeps stable keys', () => {
    assert.ok(fs.existsSync(migrationPath), 'authorized additive migration exists')
    const db = openDb(loadAll()).db
    db.exec("PRAGMA foreign_keys=ON; INSERT INTO branches(id,name,is_active,is_default,canonical_key) VALUES(1,'Shop',1,1,'shop'),(2,'Warehouse',1,0,'warehouse')")
    for (const sql of ["UPDATE branches SET role='bad' WHERE id=1", "UPDATE branches SET canonical_key='warehouse' WHERE id=1", "INSERT INTO branches(name,canonical_key) VALUES('duplicate','shop')", "UPDATE branches SET successor_branch_id=2 WHERE id=1", "UPDATE branches SET is_active=0,successor_branch_id=2 WHERE id=1", "UPDATE branches SET is_active=0,is_default=0,successor_branch_id=1 WHERE id=1", "UPDATE branches SET is_active=0,is_default=0,successor_branch_id=99 WHERE id=1", "UPDATE branches SET is_active=0,is_default=0,successor_branch_id=1.5 WHERE id=2"]) assert.throws(() => db.exec(sql), sql)
    db.exec('UPDATE branches SET is_active=0,is_default=0,successor_branch_id=2 WHERE id=1')
    assert.equal(db.prepare('SELECT successor_branch_id FROM branches WHERE id=1').get().successor_branch_id, 2)
    assert.throws(() => db.exec("INSERT INTO pending_actions(section,action_type,entity_type,expected_entity_state_json) VALUES('branches','update','branch','not JSON')"))
    db.close()
  })
  if (failures) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
