const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
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

async function main() {
  const { visibility, permissions } = loadTypeScriptHelpers()

  const viewer = { id: 10, username: 'cashier', role_code: 'staff' }
  const ordinary = { id: 11, username: 'ordinary', role_code: 'staff' }
  const reservedAdmin = { id: 12, username: 'ADMIN', role_code: 'staff' }
  const roleAdmin = { id: 13, username: 'owner', role_code: 'admin' }
  const grantAdmin = { id: 14, username: 'manager', permissions: '{"all":true}' }
  const adminLikeName = { id: 15, username: 'admin helper', role_code: 'staff' }

  assert.equal(permissions.isAdminControlUser(reservedAdmin), true)
  assert.deepEqual(
    visibility.getAdministratorOwnerIds([ordinary, reservedAdmin, roleAdmin, grantAdmin, adminLikeName]),
    [12, 13, 14],
    'administrator owner IDs must come from the canonical server classifier',
  )

  assert.equal(visibility.resolveCashierVisibilityMode(undefined, viewer), 'all')
  assert.equal(visibility.resolveCashierVisibilityMode('', viewer), 'all')
  assert.equal(visibility.resolveCashierVisibilityMode('broken', viewer), 'self')
  assert.equal(visibility.resolveCashierVisibilityMode('self', roleAdmin), 'all')

  assert.equal(visibility.isCashierOwnerVisible('self', viewer, viewer), true)
  assert.equal(visibility.isCashierOwnerVisible('self', viewer, ordinary), false)
  assert.equal(visibility.isCashierOwnerVisible('staff', viewer, ordinary), true)
  assert.equal(visibility.isCashierOwnerVisible('staff', viewer, adminLikeName), true)
  assert.equal(visibility.isCashierOwnerVisible('staff', viewer, reservedAdmin), false)
  assert.equal(visibility.isCashierOwnerVisible('staff', viewer, null), false)
  assert.equal(visibility.isCashierOwnerVisible('all', viewer, null), true)

  const narrowed = visibility.buildCashierVisibilityWhere({
    rawMode: 'staff',
    viewer,
    ownerColumn: 'sales.user_id',
    administratorOwnerIds: [12, 13, 14],
    exactOwnerId: 12,
  })
  assert.match(narrowed.sql, /sales\.user_id IS NOT NULL/)
  assert.match(narrowed.sql, /sales\.user_id NOT IN/)
  assert.match(narrowed.sql, /sales\.user_id = @cashierVisibilityExactId/)
  assert.equal(narrowed.params.cashierVisibilityExactId, 12)
  assert.notEqual(narrowed.sql, '1=1', 'an exact owner filter must only add narrowing predicates')

  const self = visibility.buildCashierVisibilityWhere({
    rawMode: 'invalid',
    viewer,
    ownerColumn: 'owner_id',
    exactOwnerId: 11,
  })
  assert.equal(self.mode, 'self')
  assert.match(self.sql, /owner_id = @cashierVisibilityViewerId AND owner_id = @cashierVisibilityExactId/)

  console.log('cashier visibility server helper tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
