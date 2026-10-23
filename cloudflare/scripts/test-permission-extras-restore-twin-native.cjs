'use strict'
// lib/permissionExtras.ts is the TypeScript twin of migration 0270, applied by a restore of a pre-0270 backup (lib/backup.ts).
// This runs the SQL file and the twin on the SAME principals (named fixtures and a fuzz of thousands) and requires:
//   - the twin returns exactly the rows the SQL changed, with JSON-equal permission text;
//   - applying the twin to the original data satisfies the same oracle as the migration (new rules on the result === old rules before);
//   - backup.ts runs the twin only for a backup older than 0270, after the rows are inserted, and never for a newer one.
//
// Run: node scripts/test-permission-extras-restore-twin-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const oracle = require('./harness/permission_extras_oracle.cjs')

const directory = path.join(__dirname, '../migrations')
const migration = '0270_permission_extras_materialize.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const base = new Database(':memory:')
for (const file of fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < migration).sort()) base.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
const schema = base.serialize()
base.close()

function loadTwin() {
  const full = path.join(__dirname, '../src/lib/permissionExtras.ts')
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const real = oracle.loadRealRules()
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', code)((request) => {
    if (request === './permissions') return real.permissions
    throw new Error(`unexpected require ${request}`)
  }, mod, mod.exports)
  return mod.exports
}
const twin = loadTwin()
const real = oracle.loadRealRules()
const OLD = oracle.oldRules(real)
const NEW = oracle.newRules(real)

let passed = 0
function check(name, run) { run(); passed++; console.log(`PASS ${name}`) }
const parse = (text) => JSON.parse(text)

for (const seedValue of [270, 31, 977]) {
  const db = new Database(schema)
  const seeded = oracle.seed(db, { seedValue, roleCount: 200, userCount: 2000 })
  const roles = db.prepare('SELECT id, code, permissions FROM roles ORDER BY id').all()
  const users = db.prepare('SELECT id, role_id, permissions FROM users ORDER BY id').all()
  const before = new Map(oracle.readPrincipals(db).map((p) => [p.key, { caps: oracle.capabilities(OLD, p.user), raw: p.raw }]))
  const plan = twin.materializePermissionExtras(roles, users)
  db.exec(sql)
  const rolesAfter = new Map(db.prepare('SELECT id, permissions FROM roles').all().map((r) => [r.id, r.permissions]))
  const usersAfter = new Map(db.prepare('SELECT id, permissions FROM users').all().map((r) => [r.id, r.permissions]))

  check(`seed ${seedValue}: the twin changes exactly the rows the SQL changed, with the same permission text`, () => {
    const changed = (rows, after) => rows.filter((r) => after.get(r.id) !== r.permissions).map((r) => r.id)
    assert.deepEqual(plan.roles.map((r) => r.id).sort((a, b) => a - b), changed(roles, rolesAfter), 'roles')
    assert.deepEqual(plan.users.map((r) => r.id).sort((a, b) => a - b), changed(users, usersAfter), 'users')
    for (const row of plan.roles) assert.deepEqual(parse(row.permissions), parse(rolesAfter.get(row.id)), `role ${row.id} ${seeded.names.get('role:' + row.id)}`)
    for (const row of plan.users) assert.deepEqual(parse(row.permissions), parse(usersAfter.get(row.id)), `user ${row.id} ${seeded.names.get('user:' + row.id)}`)
    assert.ok(plan.roles.length > 20 && plan.users.length > 100, `${plan.roles.length} roles and ${plan.users.length} users changed`)
  })

  check(`seed ${seedValue}: the twin's result satisfies the oracle (new rules after === old rules before)`, () => {
    const fresh = new Database(schema)
    oracle.seed(fresh, { seedValue, roleCount: 200, userCount: 2000 })
    const apply = (table, rows) => { const stmt = fresh.prepare(`UPDATE ${table} SET permissions = ? WHERE id = ?`); for (const row of rows) stmt.run(row.permissions, row.id) }
    apply('roles', plan.roles)
    apply('users', plan.users)
    const problems = []
    for (const p of oracle.readPrincipals(fresh)) {
      const d = oracle.diff(before.get(p.key).caps, oracle.capabilities(NEW, p.user))
      if (d.length) problems.push(`${seeded.names.get(p.key)}: ${d.join(' | ')}`)
    }
    assert.deepEqual(problems.slice(0, 5), [])
  })
}

check('applying the twin to data that is already materialised changes nothing but dormant grants (so backup.ts must gate it on the stamp)', () => {
  const db = new Database(schema)
  oracle.seed(db, { fuzz: true, roleCount: 100, userCount: 600 })
  db.exec(sql)
  const roles = db.prepare('SELECT id, code, permissions FROM roles').all()
  const users = db.prepare('SELECT id, role_id, permissions FROM users').all()
  const plan = twin.materializePermissionExtras(roles, users)
  assert.deepEqual(plan, { roles: [], users: [] }, 'idempotent on migrated data')
  // A deliberate drive_credentials grant WITHOUT Settings Full (legal after 0270) is exactly what the twin would overwrite.
  const deliberate = twin.materializePermissionExtras([{ id: 1, code: 'x', permissions: '{"drive_credentials":true}' }], [])
  assert.deepEqual(deliberate.roles.map((r) => parse(r.permissions)), [{ drive_credentials: false }])
})

check('backup.ts runs the twin only for a pre-0270 backup, after the rows are inserted and before assets', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/backup.ts'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(source, /export const PERMISSION_EXTRAS_MIGRATION = 270/)
  assert.match(source, /orderedTables\.includes\('roles'\) && orderedTables\.includes\('users'\)\s*\n\s*&& \(backupMigrationNumber == null \|\| backupMigrationNumber < PERMISSION_EXTRAS_MIGRATION\)/)
  const flush = source.indexOf('await flush()\n    // A backup older than migration 0270')
  const call = source.indexOf('materializeRestoredPermissionExtras(env, restoreToken')
  const assets = source.indexOf("await onProgress?.({ phase: 'assets' })")
  assert.ok(flush > 0 && call > flush && assets > call, 'order: last insert flush, then the twin, then assets')
})

console.log(`\n${passed} checks passed`)
