const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const ts = require('typescript')

function loadTypeScriptHelpers() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cashier-visibility-'))
  for (const name of ['permissions', 'cashierVisibility']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', `${name}.ts`), 'utf8')
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    fs.writeFileSync(path.join(tempDir, `${name}.js`), output)
  }
  return {
    visibility: require(path.join(tempDir, 'cashierVisibility.js')),
    permissions: require(path.join(tempDir, 'permissions.js')),
  }
}

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE roles (id INTEGER PRIMARY KEY, code TEXT, permissions TEXT);
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      role_id INTEGER,
      permissions TEXT
    );
    CREATE TABLE records (
      id INTEGER PRIMARY KEY,
      branch_id INTEGER NOT NULL,
      owner_id INTEGER
    );
  `)

  const insertRole = db.prepare('INSERT INTO roles(id, code, permissions) VALUES (?, ?, ?)')
  insertRole.run(1, 'staff', '{}')
  insertRole.run(2, ' ADMIN ', '{}')
  insertRole.run(3, 'manager', '{"all":true}')

  const insertUser = db.prepare('INSERT INTO users(id, username, role_id, permissions) VALUES (?, ?, ?, ?)')
  insertUser.run(10, 'cashier', 1, '{}')
  insertUser.run(11, 'ordinary', 1, '{}')
  insertUser.run(12, ' ADMIN ', 1, '{}')
  insertUser.run(13, 'role-admin', 2, '{}')
  insertUser.run(14, 'grant-admin', 1, '{"all":true}')
  insertUser.run(15, 'admin helper', 1, '{}')
  insertUser.run(16, 'role-grant-admin', 3, '{}')
  insertUser.run(17, 'role-grant-overridden', 3, '{"all":false}')
  insertUser.run(18, 'invalid-user-permissions', 3, '{broken')

  const insertRecord = db.prepare('INSERT INTO records(id, branch_id, owner_id) VALUES (?, ?, ?)')
  for (const ownerId of [10, 11, 12, 13, 14, 15, 16, 17, 18, null, 999]) {
    insertRecord.run(100 + (ownerId ?? 90), 1, ownerId)
  }
  insertRecord.run(211, 2, 11)
  return db
}

function visibleOwnerIds(db, visibility, options, branchId = 1, canRead = 1) {
  const where = visibility.buildCashierVisibilityWhere({ ownerColumn: 'records.owner_id', ...options })
  const rows = db.prepare(`
    SELECT owner_id
    FROM records
    WHERE @canRead = 1 AND branch_id = @branchId AND (${where.sql})
    ORDER BY id
  `).all({ canRead, branchId, ...where.params })
  return { where, ids: rows.map((row) => row.owner_id) }
}

function main() {
  const { visibility, permissions } = loadTypeScriptHelpers()
  const db = makeDb()

  const viewer = { id: 10, username: 'cashier', role_code: 'staff' }
  const reservedAdmin = { id: 12, username: ' ADMIN ', role_code: 'staff' }
  const roleAdmin = { id: 13, username: 'owner', role_code: ' ADMIN ' }
  const grantAdmin = { id: 14, username: 'manager', permissions: '{"all":true}' }
  const roleGrantOverridden = {
    id: 17,
    username: 'supervisor',
    permissions: '{"all":false}',
    role_permissions: '{"all":true}',
  }

  assert.equal(permissions.isAdminControlUser(reservedAdmin), true)
  assert.equal(permissions.isAdminControlUser(roleAdmin), true)
  assert.equal(permissions.isAdminControlUser(grantAdmin), true)
  assert.equal(permissions.isAdminControlUser(roleGrantOverridden), false)

  for (const rawMode of [undefined, null, '', '   ']) {
    assert.equal(visibility.resolveCashierVisibilityMode(rawMode, viewer), 'all')
  }
  assert.equal(visibility.resolveCashierVisibilityMode(' STAFF ', viewer), 'staff')
  assert.equal(visibility.resolveCashierVisibilityMode('broken', viewer), 'self')
  assert.equal(visibility.resolveCashierVisibilityMode('self', roleAdmin), 'all')

  assert.equal(visibility.isCashierOwnerVisible('self', viewer, viewer), true)
  assert.equal(visibility.isCashierOwnerVisible('self', viewer, { id: 11, username: 'ordinary' }), false)
  assert.equal(visibility.isCashierOwnerVisible('staff', viewer, {
    id: 15,
    username: 'admin helper',
    role_code: 'staff',
    permissions: '{}',
    role_permissions: '{}',
  }), true)
  assert.equal(visibility.isCashierOwnerVisible('staff', viewer, reservedAdmin), false)
  assert.equal(visibility.isCashierOwnerVisible('staff', viewer, { id: 999 }), false)
  assert.equal(visibility.isCashierOwnerVisible('staff', viewer, null), false)
  assert.equal(visibility.isCashierOwnerVisible('all', viewer, null), true)
  assert.equal(visibility.isCashierOwnerVisible('self', roleAdmin, null), true)

  const allExpected = [10, 11, 12, 13, 14, 15, 16, 17, 18, null, 999]
  const staffExpected = [10, 11, 15, 17]
  assert.deepEqual(visibleOwnerIds(db, visibility, { rawMode: undefined, viewer }).ids, allExpected)
  assert.deepEqual(visibleOwnerIds(db, visibility, { rawMode: '', viewer }).ids, allExpected)
  assert.deepEqual(visibleOwnerIds(db, visibility, { rawMode: 'all', viewer }).ids, allExpected)
  assert.deepEqual(visibleOwnerIds(db, visibility, { rawMode: 'staff', viewer }).ids, staffExpected)
  assert.deepEqual(visibleOwnerIds(db, visibility, { rawMode: 'self', viewer }).ids, [10])
  assert.deepEqual(visibleOwnerIds(db, visibility, { rawMode: 'invalid', viewer }).ids, [10])
  assert.deepEqual(visibleOwnerIds(db, visibility, { rawMode: 'self', viewer: roleAdmin }).ids, allExpected)

  const staffWhere = visibleOwnerIds(db, visibility, { rawMode: 'staff', viewer }).where
  assert.match(staffWhere.sql, /EXISTS/)
  assert.match(staffWhere.sql, /FROM users/)
  assert.match(staffWhere.sql, /LEFT JOIN roles/)
  assert.doesNotMatch(staffWhere.sql, /NOT IN/)
  assert.deepEqual(staffWhere.params, {})

  assert.deepEqual(
    visibleOwnerIds(db, visibility, { rawMode: 'staff', viewer, exactOwnerId: 11 }).ids,
    [11],
  )
  assert.deepEqual(
    visibleOwnerIds(db, visibility, { rawMode: 'staff', viewer, exactOwnerId: 12 }).ids,
    [],
  )
  assert.deepEqual(
    visibleOwnerIds(db, visibility, { rawMode: 'self', viewer, exactOwnerId: 11 }).ids,
    [],
  )
  assert.deepEqual(
    visibleOwnerIds(db, visibility, { rawMode: 'self', viewer, exactOwnerId: '0010' }).ids,
    [10],
  )
  assert.deepEqual(
    visibleOwnerIds(db, visibility, { rawMode: 'all', viewer, exactOwnerId: 12 }).ids,
    [12],
  )
  assert.deepEqual(
    visibleOwnerIds(db, visibility, { rawMode: 'all', viewer, exactOwnerId: 999 }).ids,
    [],
    'an orphan owner remains visible in all mode but is not a valid explicit cashier selection',
  )
  assert.deepEqual(
    visibleOwnerIds(db, visibility, { rawMode: 'all', viewer, exactOwnerId: null }).ids,
    [],
  )
  assert.deepEqual(
    visibleOwnerIds(db, visibility, { rawMode: 'all', viewer, exactOwnerId: 'not-an-id' }).ids,
    [],
  )

  const branchIntersection = visibleOwnerIds(db, visibility, {
    rawMode: 'staff',
    viewer,
    exactOwnerId: 11,
  }, 2)
  assert.deepEqual(branchIntersection.ids, [11])
  assert.deepEqual(
    visibleOwnerIds(db, visibility, { rawMode: 'staff', viewer, exactOwnerId: 11 }, 1).ids,
    [11],
    'the cashier predicate must compose with, not replace, the independent branch predicate',
  )
  assert.deepEqual(
    visibleOwnerIds(db, visibility, { rawMode: 'all', viewer }, 1, 0).ids,
    [],
    'all mode must not broaden an existing permission predicate',
  )

  const customPrefix = visibility.buildCashierVisibilityWhere({
    rawMode: 'self',
    viewer,
    ownerColumn: 'records.owner_id',
    exactOwnerId: 10,
    paramPrefix: 'receiptCashier',
  })
  assert.deepEqual(Object.keys(customPrefix.params).sort(), ['receiptCashierExactId', 'receiptCashierViewerId'])
  assert.ok(Object.keys(customPrefix.params).length <= 2, 'bind count must remain constant')
  assert.throws(
    () => visibility.buildCashierVisibilityWhere({ rawMode: 'all', viewer, ownerColumn: 'owner_id OR 1=1' }),
    /Invalid cashier owner column/,
  )
  assert.throws(
    () => visibility.buildCashierVisibilityWhere({
      rawMode: 'all',
      viewer,
      ownerColumn: 'records.owner_id',
      paramPrefix: 'unsafe-prefix',
    }),
    /Invalid cashier parameter prefix/,
  )
  const boundInput = visibility.buildCashierVisibilityWhere({
    rawMode: 'all',
    viewer,
    ownerColumn: 'records.owner_id',
    exactOwnerId: '00011',
  })
  assert.equal(boundInput.params.cashierVisibilityExactId, 11)
  assert.doesNotMatch(boundInput.sql, /00011/)

  console.log('cashier visibility server helper tests passed')
}

try {
  main()
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
