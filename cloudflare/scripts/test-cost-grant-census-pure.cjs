// The postflight cost-grant census (ops/queries/cost-grant-census-20261117.sql) must count exactly who the Worker treats as a non-admin
// holder of a cost grant: lib/acquisitionCostAccess holdsCostViewGrant / holdsCostEditGrant over lib/permissions' merged permissions.
// Every combination of role and user JSON below is planted as a user, the Worker helpers say who holds, and the SQL's counts must equal that
// (a hand-written SQL that mis-reads the merge is the failure this pins). The four holder columns must be ops:expect-zero, so a deploy with a
// surprise holder fails the postflight instead of waiting for a human to read the row.
// Run: node test-cost-grant-census-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const ts = require('typescript')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const sqlPath = path.join(root, 'ops/queries/cost-grant-census-20261117.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

function load(file) {
  const mod = { exports: {} }
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', source)((name) => (name.startsWith('.') ? load(path.resolve(path.dirname(file), name.endsWith('.ts') ? name : name + '.ts')) : require(name)), mod, mod.exports)
  return mod.exports
}
const access = load(path.join(root, 'cloudflare/src/lib/acquisitionCostAccess.ts'))
const holds = (user) => !require_admin(user) && (access.holdsCostViewGrant(user) || access.holdsCostEditGrant(user))
const perms = load(path.join(root, 'cloudflare/src/lib/permissions.ts'))
function require_admin(user) { return perms.isAdminControlUser(user) }

let passed = 0
const check = (name, fn) => { fn(); passed += 1; console.log('PASS ' + name) }

const ROLES = [
  { key: 'admin-role', code: 'admin', permissions: '{"all":true}' },
  { key: 'all-role', code: 'owner', permissions: '{"all":true}' },
  { key: 'manager-view', code: 'manager', permissions: '{"product_cost_view":true}' },
  { key: 'manager-edit', code: 'Manager2', permissions: '{"product_cost_edit":true}' },
  { key: 'manager-strings', code: 'manager3', permissions: '{"product_cost_view":"true","product_cost_edit":1}' },
  { key: 'manager-none', code: 'cashier', permissions: '{"pos":true}' },
  { key: 'manager-null', code: 'blank', permissions: null },
  { key: 'manager-bad-json', code: 'broken', permissions: '{bad' },
  { key: 'manager-array', code: 'arr', permissions: '[{"product_cost_view":true}]' },
  { key: 'all-false-view', code: 'allfalse', permissions: '{"all":false,"product_cost_view":true}' },
]
const OWNS = [null, '{}', '{bad', '[]', '{"all":false}', '{"product_cost_view":false}', '{"product_cost_edit":false}', '{"product_cost_view":true}',
  '{"product_cost_edit":true}', '{"all":false,"product_cost_view":true}', '{"all":true}', '{"product_cost_view":null}', '{"product_cost_view":"true"}', '{"all":"true"}']
const NO_ROLE = { key: 'no-role', code: null, permissions: null }

function build(extra) {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE roles(id INTEGER PRIMARY KEY, code TEXT, permissions TEXT);
    CREATE TABLE users(id INTEGER PRIMARY KEY, role_id INTEGER, permissions TEXT, is_active INTEGER, deleted_at TEXT);
    CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO d1_migrations(id, name) VALUES (1, '0001_init.sql');`)
  const roleId = new Map()
  for (const role of ROLES) roleId.set(role.key, Number(db.prepare('INSERT INTO roles(code, permissions) VALUES (?, ?)').run(role.code, role.permissions).lastInsertRowid))
  return { db, roleId, ...extra }
}
const row = (db) => db.prepare(sql.replace(/^--.*$/gm, '')).get()

check('the file is one read-only SELECT with the expect-zero header on the four holder columns', () => {
  assert.match(sql, /^-- ops:expect-zero roles_non_admin_cost_view,roles_non_admin_cost_edit,active_non_admin_cost_holder_users,inactive_non_admin_cost_holder_users$/m)
  const body = sql.replace(/^--.*$/gm, '')
  assert.match(body.trim(), /^SELECT/)
  assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|UNION|INTERSECT|EXCEPT)\b/i)
  assert.doesNotMatch(sql, /active_non_admin_users_losing_cost/, 'the stale "losing" column name is gone')
})

const guardPromise = import(pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')).href).then((guard) => {
  const { rules } = guard.guardSql(sql)
  assert.deepEqual(rules.expectZero, ['roles_non_admin_cost_view', 'roles_non_admin_cost_edit', 'active_non_admin_cost_holder_users', 'inactive_non_admin_cost_holder_users'])
  assert.equal(rules.minRows, 1)
  assert.equal(rules.maxRows, 1)
})

check('exhaustive role x own-JSON x active matrix: SQL counts equal the Worker helpers', () => {
  const { db, roleId } = build()
  let expectedActive = 0, expectedInactive = 0, id = 0
  const plant = (role, own, active) => {
    id += 1
    db.prepare('INSERT INTO users(id, role_id, permissions, is_active, deleted_at) VALUES (?, ?, ?, ?, NULL)').run(id, role.key === 'no-role' ? null : roleId.get(role.key), own, active)
    const user = { role_code: role.code, role_permissions: role.permissions, permissions: own }
    if (holds(user)) active ? expectedActive++ : expectedInactive++
  }
  for (const role of [...ROLES, NO_ROLE]) for (const own of OWNS) for (const active of [1, 0]) plant(role, own, active)
  // a deleted user never counts, whatever they hold
  db.prepare('INSERT INTO users(id, role_id, permissions, is_active, deleted_at) VALUES (9001, ?, ?, 1, ?)').run(roleId.get('manager-view'), '{"product_cost_view":true}', '2026-01-01')
  assert.ok(expectedActive > 20 && expectedInactive > 20, 'the matrix plants real holders on both sides')
  const result = row(db)
  assert.equal(result.active_non_admin_cost_holder_users, expectedActive)
  assert.equal(result.inactive_non_admin_cost_holder_users, expectedInactive)
})

check('the two review undercounts are counted: an inactive own grant, and own all:false under an all:true role', () => {
  const { db, roleId } = build()
  db.prepare('INSERT INTO users(id, role_id, permissions, is_active) VALUES (1, ?, ?, 0)').run(roleId.get('manager-none'), '{"product_cost_view":true}')
  assert.deepEqual([row(db).active_non_admin_cost_holder_users, row(db).inactive_non_admin_cost_holder_users], [0, 1], 'inactive user with own grant true')
  db.prepare('DELETE FROM users').run()
  db.prepare('INSERT INTO users(id, role_id, permissions, is_active) VALUES (2, ?, ?, 1)').run(roleId.get('all-role'), '{"all":false,"product_cost_view":true}')
  assert.deepEqual([row(db).active_non_admin_cost_holder_users, row(db).inactive_non_admin_cost_holder_users], [1, 0], 'role all:true, own all:false plus the grant: the Worker treats them as a non-admin holder')
  assert.equal(holds({ role_code: 'owner', role_permissions: '{"all":true}', permissions: '{"all":false,"product_cost_view":true}' }), true, 'the Worker agrees')
  db.prepare('DELETE FROM users').run()
  db.prepare('INSERT INTO users(id, role_id, permissions, is_active) VALUES (3, ?, ?, 1)').run(roleId.get('all-role'), '{"product_cost_view":true}')
  assert.equal(row(db).active_non_admin_cost_holder_users, 0, 'role all:true without an own all:false stays an administrator')
})

check('role columns: a non-admin role with a literal-true grant counts; admin, all:true, strings and bad JSON do not', () => {
  const { db } = build()
  const result = row(db)
  const expected = { view: 0, edit: 0 }
  for (const role of ROLES) {
    const user = { role_code: role.code, role_permissions: role.permissions, permissions: null }
    if (holds(user)) { if (access.holdsCostViewGrant(user)) expected.view++; if (access.holdsCostEditGrant(user)) expected.edit++ }
  }
  assert.equal(result.roles_non_admin_cost_view, expected.view)
  assert.equal(result.roles_non_admin_cost_edit, expected.edit)
  assert.ok(expected.view >= 1 && expected.edit >= 1)
  // the all-false role is judged without a user: `all` false is not an administrator, and it holds the view grant
  assert.match(String(result.role_codes_with_cost_grant), /allfalse/)
})

check('a clean database reads all four holder columns as 0 (the postflight passes)', () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE roles(id INTEGER PRIMARY KEY, code TEXT, permissions TEXT);
    CREATE TABLE users(id INTEGER PRIMARY KEY, role_id INTEGER, permissions TEXT, is_active INTEGER, deleted_at TEXT);
    CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO roles VALUES (1, 'admin', '{"all":true}'), (2, 'manager', '{"products":true,"product_cost_view":false,"product_cost_edit":false}'), (3, 'employee', '{"pos":true}');
    INSERT INTO users VALUES (1, 1, NULL, 1, NULL), (2, 2, '{"product_cost_view":false}', 1, NULL), (3, 3, NULL, 0, NULL);`)
  const result = row(db)
  for (const column of ['roles_non_admin_cost_view', 'roles_non_admin_cost_edit', 'active_non_admin_cost_holder_users', 'inactive_non_admin_cost_holder_users']) assert.equal(result[column], 0, column)
})

guardPromise.then(() => { console.log(`PASS ${passed} cost-grant census checks (+ ops guard header)`) }, (error) => { console.error(error); process.exit(1) })
