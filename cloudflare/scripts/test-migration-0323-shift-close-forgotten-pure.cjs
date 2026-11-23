// Migration 0323: the "Close forgotten shifts" grant for the Manager role (owner, 23 Nov 2026, A75). Runs the REAL file against SQLite.
//   - Manager roles gain shift_close_forgotten = true ONLY when the key is absent; an explicit true or false is kept.
//   - Employee, admin, every other role, every other key and every user stay byte-identical.
//   - Case/space variants of the code are reached; invalid JSON and non-object JSON are skipped and never abort the file.
//   - The PRE count is recorded in system_flags; a re-run changes nothing.
//   - wrangler's statement splitter yields the 3 real statements.
//   - The POST assertion is real: the same file with its UPDATE removed aborts.
// Run (from cloudflare/scripts): node test-migration-0323-shift-close-forgotten-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const file = path.join(__dirname, '..', 'migrations', '0323_forgotten_close_grant.sql')
const sql = fs.readFileSync(file, 'utf8')
const FLAG = 'shift_close_forgotten_0323_changed'
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
  assert.ok(statements.filter(Boolean).length >= 3)
  assert.equal(statements.at(-1), '', 'nothing but whitespace after the last semicolon')
})

check('a Manager role gains true when absent and keeps an explicit true or false', () => {
  const db = world()
  role(db, 1, 'manager', { products: true })
  role(db, 2, 'manager', { shift_close_forgotten: false, pos: true })
  role(db, 3, 'manager', { shift_close_forgotten: true })
  db.exec(sql)
  assert.deepEqual(perms(db, 1), { products: true, shift_close_forgotten: true })
  assert.deepEqual(perms(db, 2), { shift_close_forgotten: false, pos: true }, 'an explicit false is never overwritten')
  assert.deepEqual(perms(db, 3), { shift_close_forgotten: true })
})

check('Employee, admin, other roles, invalid JSON, a non-object and users are untouched', () => {
  const db = world()
  role(db, 1, 'admin', { all: true })
  role(db, 2, 'employee', { pos: true })
  role(db, 3, 'warehouse', { inventory: true })
  role(db, 4, 'manager', 'not-json')
  role(db, 5, 'manager', '[1,2]')
  role(db, 6, 'manager', 'null')
  db.prepare("INSERT INTO users(id,username,role_id,permissions) VALUES(1,'u',2,'{\"pos\":true}')").run()
  const before = JSON.stringify(db.prepare('SELECT id,code,permissions,updated_at FROM roles ORDER BY id').all())
  const usersBefore = JSON.stringify(db.prepare('SELECT * FROM users').all())
  db.exec(sql)
  assert.equal(JSON.stringify(db.prepare('SELECT id,code,permissions,updated_at FROM roles ORDER BY id').all()), before)
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM users').all()), usersBefore)
})

check('code is matched on lower(trim(code))', () => {
  const db = world()
  role(db, 1, ' Manager ', {})
  role(db, 2, 'MANAGER', { pos: true })
  role(db, 3, 'managers', {})
  db.exec(sql)
  assert.deepEqual(perms(db, 1), { shift_close_forgotten: true })
  assert.deepEqual(perms(db, 2), { pos: true, shift_close_forgotten: true })
  assert.deepEqual(perms(db, 3), {})
})

check('the PRE count is recorded and an already-conforming manager is not counted', () => {
  const db = world()
  role(db, 1, 'manager', {})
  role(db, 2, 'manager', { shift_close_forgotten: true })
  role(db, 3, 'manager', { shift_close_forgotten: false })
  role(db, 4, 'manager', { pos: true })
  role(db, 5, 'employee', {})
  db.exec(sql)
  assert.equal(flag(db, FLAG), '2')
})

check('a fresh, empty database applies the file and records zero', () => {
  const db = world()
  db.exec(sql)
  assert.equal(flag(db, FLAG), '0')
})

check('re-running changes nothing (updated_at and JSON stay as the first run left them)', () => {
  const db = world()
  role(db, 1, 'manager', { pos: true })
  db.exec(sql)
  db.prepare("UPDATE roles SET updated_at='2000-01-01'").run()
  const once = JSON.stringify(db.prepare('SELECT * FROM roles').all())
  db.exec(sql)
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM roles').all()), once)
  assert.equal(flag(db, FLAG), '0')
})

check('wrangler splits the file into exactly 3 statements (no CASE swallows a boundary)', () => {
  const { unstable_splitSqlQuery: split } = require('wrangler')
  const count = split(sql).length
  console.log('wrangler statement split count: ' + count)
  assert.equal(count, 3)
})

check('the POST assertion is real: the same file without its UPDATE aborts', () => {
  const db = world()
  role(db, 1, 'manager', { pos: true })
  const withoutUpdate = sql.replace(/^UPDATE roles[\s\S]*?;\n/m, '')
  assert.notEqual(withoutUpdate, sql)
  assert.throws(() => db.exec(withoutUpdate), /shift_close_forgotten_0323_post|malformed JSON path/i)
  const ok = world()
  role(ok, 1, 'manager', { pos: true })
  assert.doesNotThrow(() => ok.exec(sql))
})

console.log(passed + ' checks passed')
