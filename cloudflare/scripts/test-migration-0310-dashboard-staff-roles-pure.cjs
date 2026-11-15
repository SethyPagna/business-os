// Migration 0310: the Dashboard for the Manager and Employee roles (owner, 15 Nov 2026). Runs the REAL file against SQLite.
//   - Manager and Employee roles gain dashboard=true; Employee also gets dashboard_export=false; Manager gets
//     dashboard_export=true only when the key is absent (an explicit stored value is kept).
//   - Admin, every other role, every other key and every user stay byte-identical.
//   - Case/space variants of the code are reached; invalid JSON and non-object JSON are skipped and never abort the file.
//   - The PRE count and the users-with-own-keys count are recorded in system_flags.
//   - A duplicated dashboard member ends truly true for JSON.parse (last wins), not only for SQLite (first wins).
//   - wrangler's statement splitter yields the 4 real statements (every CASE is parenthesised).
//   - The POST assertion is real: the same file with its UPDATE removed aborts.
// Run (from cloudflare/scripts): node test-migration-0310-dashboard-staff-roles-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const file = path.join(__dirname, '..', 'migrations', '0310_dashboard_for_staff_roles.sql')
const sql = fs.readFileSync(file, 'utf8')
let passed = 0
const check = (name, fn) => { fn(); passed += 1; console.log('PASS ' + name) }

function world() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT, code TEXT, permissions TEXT DEFAULT '{}', is_system INTEGER DEFAULT 0, updated_at TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, role_id INTEGER, permissions TEXT DEFAULT '{}');
    CREATE TABLE system_flags (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);`)
  return db
}
const role = (db, id, code, permissions) => db.prepare('INSERT INTO roles(id,name,code,permissions) VALUES(?,?,?,?)').run(id, 'r' + id, code, typeof permissions === 'string' ? permissions : JSON.stringify(permissions))
const perms = (db, id) => JSON.parse(db.prepare('SELECT permissions FROM roles WHERE id=?').get(id).permissions)
const flag = (db, key) => db.prepare('SELECT value FROM system_flags WHERE key=?').get(key)?.value

check('the file is LF-only and appends no comment-only statement', () => {
  assert.equal(sql.includes('\r'), false)
  const statements = sql.split(';').map(part => part.split('\n').filter(line => !line.trim().startsWith('--')).join('\n').trim())
  assert.ok(statements.filter(Boolean).length >= 4)
  assert.equal(statements.at(-1), '', 'nothing but whitespace after the last semicolon')
})

check('Employee gets dashboard true and dashboard_export false; Manager gets dashboard true and keeps an explicit export', () => {
  const db = world()
  role(db, 1, 'employee', { pos: true, sales: true })
  role(db, 2, 'manager', { products: true, dashboard_export: false })
  role(db, 3, 'employee', { dashboard: false, dashboard_export: true, pos: true })
  role(db, 4, 'manager', { dashboard_export: true })
  role(db, 5, 'manager', { products: true })
  db.exec(sql)
  assert.deepEqual(perms(db, 1), { pos: true, sales: true, dashboard: true, dashboard_export: false })
  assert.deepEqual(perms(db, 2), { products: true, dashboard_export: false, dashboard: true })
  assert.deepEqual(perms(db, 3), { dashboard: true, dashboard_export: false, pos: true }, 'an explicit stored true/false is overwritten on a ROLE row')
  assert.deepEqual(perms(db, 4), { dashboard_export: true, dashboard: true })
  assert.deepEqual(perms(db, 5), { products: true, dashboard: true, dashboard_export: true }, 'an ABSENT manager export key becomes true')
})

check('admin, other roles, invalid JSON, a non-object and users are untouched', () => {
  const db = world()
  role(db, 1, 'admin', { all: true })
  role(db, 2, 'warehouse', { inventory: true })
  role(db, 3, 'employee', 'not-json')
  role(db, 4, 'manager', '[1,2]')
  role(db, 5, 'employee', 'null')
  db.prepare("INSERT INTO users(id,username,role_id,permissions) VALUES(1,'u',1,'{\"dashboard\":false}')").run()
  const before = JSON.stringify(db.prepare('SELECT id,code,permissions,updated_at FROM roles ORDER BY id').all())
  const usersBefore = JSON.stringify(db.prepare('SELECT * FROM users').all())
  db.exec(sql)
  assert.equal(JSON.stringify(db.prepare('SELECT id,code,permissions,updated_at FROM roles ORDER BY id').all()), before)
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM users').all()), usersBefore)
})

check('code is matched on lower(trim(code))', () => {
  const db = world()
  role(db, 1, ' Employee ', {})
  role(db, 2, 'MANAGER', {})
  role(db, 3, 'employees', {})
  db.exec(sql)
  assert.deepEqual(perms(db, 1), { dashboard: true, dashboard_export: false })
  assert.deepEqual(perms(db, 2), { dashboard: true, dashboard_export: true })
  assert.deepEqual(perms(db, 3), {})
})

check('PRE count and the users with their own dashboard keys are recorded', () => {
  const db = world()
  role(db, 1, 'employee', {})
  role(db, 2, 'manager', { dashboard: true, dashboard_export: true })
  role(db, 3, 'manager', {})
  const user = (id, p) => db.prepare('INSERT INTO users(id,username,role_id,permissions) VALUES(?,?,?,?)').run(id, 'u' + id, 1, p)
  user(1, '{"dashboard":false}'); user(2, '{"dashboard_export":true}'); user(3, '{"pos":true}'); user(4, 'broken'); user(5, '{"dashboard":true,"dashboard_export":false}'); user(6, '[]')
  db.exec(sql)
  assert.equal(flag(db, 'dashboard_staff_roles_0310_changed'), '2', 'the already-conforming manager is not counted')
  assert.equal(flag(db, 'dashboard_staff_roles_0310_users_with_own_keys'), '3')
})

check('a fresh, empty database applies the file and records zeros', () => {
  const db = world()
  db.exec(sql)
  assert.equal(flag(db, 'dashboard_staff_roles_0310_changed'), '0')
  assert.equal(flag(db, 'dashboard_staff_roles_0310_users_with_own_keys'), '0')
})

check('re-running changes nothing (updated_at and JSON stay as the first run left them)', () => {
  const db = world()
  role(db, 1, 'employee', { pos: true })
  db.exec(sql)
  db.prepare("UPDATE roles SET updated_at='2000-01-01'").run()
  const once = JSON.stringify(db.prepare('SELECT * FROM roles').all())
  db.exec(sql)
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM roles').all()), once)
  assert.equal(flag(db, 'dashboard_staff_roles_0310_changed'), '0')
})

check('wrangler splits the file into exactly 4 statements (no CASE swallows a boundary)', () => {
  const { unstable_splitSqlQuery: split } = require('wrangler')
  assert.equal(split(sql).length, 4)
})

check('a duplicated dashboard / dashboard_export member ends truly true / false for JSON.parse', () => {
  const db = world()
  role(db, 1, 'employee', '{"dashboard":false,"pos":true,"dashboard":false,"dashboard_export":true,"dashboard_export":true}')
  role(db, 2, 'manager', '{"dashboard":false,"dashboard":false}')
  db.exec(sql)
  assert.deepEqual(perms(db, 1), { pos: true, dashboard: true, dashboard_export: false })
  assert.deepEqual(perms(db, 2), { dashboard: true, dashboard_export: true })
  const raw = db.prepare('SELECT permissions FROM roles WHERE id=1').get().permissions
  assert.equal((raw.match(/"dashboard"/g) || []).length, 1, 'exactly one dashboard member is left')
})

check('MUTANT: without the duplicate removal a duplicated false survives for JSON.parse', () => {
  const noDedup = sql.replace(/json_remove\(permissions, [^)]*\)/g, 'permissions')
  assert.notEqual(noDedup, sql)
  const db = world()
  role(db, 1, 'manager', '{"dashboard":false,"dashboard":false}')
  let broken = false
  try { db.exec(noDedup); broken = perms(db, 1).dashboard !== true } catch { broken = true }
  assert.equal(broken, true)
})

check('MUTANT: the POST assertion is real -- the same file without its UPDATE aborts', () => {
  const noUpdate = sql.replace(/^UPDATE roles[\s\S]*?;\n/m, '')
  assert.notEqual(noUpdate, sql)
  const db = world()
  role(db, 1, 'employee', {})
  assert.throws(() => db.exec(noUpdate), /dashboard_staff_roles_0310_post|malformed JSON path/i)
})

check('MUTANT: an update that forgets the employee export flag aborts at the POST assertion', () => {
  const noExport = sql.replace(", '$.dashboard_export', json('false')", '')
  assert.notEqual(noExport, sql)
  const db = world()
  role(db, 1, 'employee', { dashboard_export: true })
  assert.throws(() => db.exec(noExport))
})

console.log(`\nALL ${passed} CHECKS PASSED`)
