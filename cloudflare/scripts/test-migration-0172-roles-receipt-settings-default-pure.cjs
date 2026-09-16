// Migration 0172: backfill permissions.receipt_settings = true onto the
// built-in Employee/Manager roles.
//
// Why this migration exists (see its own header comment for the full
// story): coreDataInvariants.ts's ensureCoreDataInvariants() only
// force-rewrites the ADMIN role's permissions on every boot -- Manager and
// Employee are inserted once and then left alone as org-editable, so the
// p9/receipt-access code change (Employee defaults to receipt_settings:
// true) never reaches an already-provisioned organization's stored roles
// row. This test runs the REAL migration SQL (not a re-implementation)
// against a synthetic `roles` table shaped like the real one, with a
// positive control (Employee/Manager rows genuinely missing the key), a
// negative control (a role that already explicitly set it to false, which
// must survive untouched), an Admin `{"all":true}` row (must not be
// touched -- it does not need the key at all), and a re-run to prove
// idempotence.
//
// Run: node scripts/test-migration-0172-roles-receipt-settings-default-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const migrationPath = path.join(__dirname, '..', 'migrations', '0172_roles_receipt_settings_default.sql')
const migrationSql = fs.readFileSync(migrationPath, 'utf8')

let passed = 0
const check = (label, fn) => { fn(); passed++; console.log(`PASS ${label}`) }

check('migration file exists, is LF-only, and is the exact SQL this test exercises', () => {
  assert.ok(migrationSql.length > 0)
  assert.equal(migrationSql.includes('\r\n'), false, 'migration must be LF-only (see test-migration-line-endings-pure.cjs)')
  assert.match(migrationSql, /UPDATE roles/)
  assert.match(migrationSql, /WHERE code IN \('employee', 'manager'\)/)
  assert.match(migrationSql, /json_extract\(permissions, '\$\.receipt_settings'\) IS NULL/)
})

function freshDb() {
  const db = new Database(':memory:')
  // Same shape as migrations/0001_init.sql's `roles` table -- only the
  // columns this migration reads/writes matter for this fixture.
  db.exec(`
    CREATE TABLE roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      permissions TEXT DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      code TEXT,
      is_system INTEGER DEFAULT 0,
      updated_at TEXT
    );
  `)
  return db
}

function insertRole(db, { name, code, permissions }) {
  db.prepare('INSERT INTO roles (name, code, permissions, is_system) VALUES (?, ?, ?, 1)').run(name, code, permissions)
  return db.prepare('SELECT last_insert_rowid() AS id').get().id
}

function readReceiptSettings(db, id) {
  const row = db.prepare("SELECT json_extract(permissions, '$.receipt_settings') AS rs, permissions FROM roles WHERE id = ?").get(id)
  return row
}

check('positive control: Employee and Manager rows genuinely missing the key are backfilled to true', () => {
  const db = freshDb()
  const employeeId = insertRole(db, {
    name: 'Employee',
    code: 'employee',
    permissions: JSON.stringify({ pos: true, sales: true, 'sales:status': true }),
  })
  const managerId = insertRole(db, { name: 'Manager', code: 'manager', permissions: '{}' })

  db.exec(migrationSql)

  const employee = readReceiptSettings(db, employeeId)
  const manager = readReceiptSettings(db, managerId)
  assert.equal(employee.rs, 1, 'Employee must be backfilled to true')
  assert.equal(manager.rs, 1, 'Manager must be backfilled to true')
  // Pre-existing keys survive json_set's single-path write.
  assert.equal(JSON.parse(employee.permissions).pos, true, 'unrelated permission keys must be untouched')
  assert.equal(JSON.parse(employee.permissions)['sales:status'], true)
})

check('negative control: a role with an explicit receipt_settings:false is left exactly as-is (owner already chose)', () => {
  const db = freshDb()
  const id = insertRole(db, {
    name: 'Cashier (no receipts)',
    code: 'employee',
    permissions: JSON.stringify({ pos: true, receipt_settings: false }),
  })
  db.exec(migrationSql)
  const row = readReceiptSettings(db, id)
  assert.equal(row.rs, 0, 'an explicit false must never be overwritten by the backfill')
})

check('Admin ({"all":true}) is not touched -- code is not employee/manager', () => {
  const db = freshDb()
  const id = insertRole(db, { name: 'Admin', code: 'admin', permissions: JSON.stringify({ all: true }) })
  const before = db.prepare('SELECT permissions FROM roles WHERE id = ?').get(id).permissions
  db.exec(migrationSql)
  const after = db.prepare('SELECT permissions FROM roles WHERE id = ?').get(id).permissions
  assert.equal(after, before, 'Admin permissions must be byte-identical after the migration')
  assert.equal(JSON.parse(after).receipt_settings, undefined, 'Admin does not need the key -- all:true already bypasses every check')
})

check('a custom non-system role (code not employee/manager) is not touched', () => {
  const db = freshDb()
  const id = insertRole(db, { name: 'Warehouse Lead', code: 'warehouse_lead', permissions: JSON.stringify({ inventory: true }) })
  db.exec(migrationSql)
  const row = readReceiptSettings(db, id)
  assert.equal(row.rs, null, 'a custom role is unaffected by this migration -- it gets the key from the Permission Editor default when created')
})

check('invalid/malformed JSON rows are skipped, never crash the migration', () => {
  const db = freshDb()
  const id = insertRole(db, { name: 'Broken', code: 'employee', permissions: 'not-json' })
  assert.doesNotThrow(() => db.exec(migrationSql))
  const row = db.prepare('SELECT permissions FROM roles WHERE id = ?').get(id)
  assert.equal(row.permissions, 'not-json', 'a malformed row is left untouched, never guessed at')
})

check('idempotence: running the migration twice changes rows only on the first run', () => {
  const db = freshDb()
  const employeeId = insertRole(db, { name: 'Employee', code: 'employee', permissions: '{}' })
  const managerId = insertRole(db, { name: 'Manager', code: 'manager', permissions: '{}' })

  const first = db.exec(migrationSql) // exec() doesn't return changes(); use run() via prepare for the count instead
  const changesAfterFirst = db.prepare('SELECT changes() AS n').get().n
  // db.exec() runs the whole file as one call, so changes() reflects the
  // LAST statement only -- re-derive via the actual per-row state instead,
  // which is the real thing this test cares about.
  const employeeAfterFirst = readReceiptSettings(db, employeeId)
  const managerAfterFirst = readReceiptSettings(db, managerId)
  assert.equal(employeeAfterFirst.rs, 1)
  assert.equal(managerAfterFirst.rs, 1)

  // Second run: the WHERE clause's IS NULL check now matches nothing for
  // these two rows, so the statement is a true no-op for them.
  const stmt = db.prepare(
    "UPDATE roles SET permissions = json_set(permissions, '$.receipt_settings', json('true')), updated_at = CURRENT_TIMESTAMP " +
    "WHERE code IN ('employee', 'manager') AND json_valid(permissions) AND json_extract(permissions, '$.receipt_settings') IS NULL",
  )
  const secondRunInfo = stmt.run()
  assert.equal(secondRunInfo.changes, 0, 'a second run must touch zero rows -- the key is already present on every eligible row')

  // Values are unchanged after the second run.
  assert.equal(readReceiptSettings(db, employeeId).rs, 1)
  assert.equal(readReceiptSettings(db, managerId).rs, 1)
  void first
  void changesAfterFirst
})

check('running the full migration file itself twice back-to-back is a safe no-op the second time', () => {
  const db = freshDb()
  const employeeId = insertRole(db, { name: 'Employee', code: 'employee', permissions: '{}' })
  db.exec(migrationSql)
  const after1 = readReceiptSettings(db, employeeId).permissions
  db.exec(migrationSql)
  const after2 = readReceiptSettings(db, employeeId).permissions
  assert.equal(after2, after1, 'the stored permissions JSON must be byte-identical after a second run of the whole file')
})

console.log(`\nALL ${passed} CHECKS PASSED`)
