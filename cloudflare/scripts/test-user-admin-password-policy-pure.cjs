// User/admin password-management policy regression guard.
// Run: node scripts/test-user-admin-password-policy-pure.cjs
const fs = require('fs')
const path = require('path')
const assert = require('assert')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'users.ts'), 'utf8')
let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

const handlerStart = source.indexOf('async function handlePasswordChange')
const handlerEnd = source.indexOf('// -- Role CRUD', handlerStart)
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'password handler block missing')
const handler = source.slice(handlerStart, handlerEnd)

check('self change-password route is self-only and requires the current password', () => {
  assert.match(source, /change-password'[^\n]*requireCurrent: true[^\n]*requireSelf: true[^\n]*allowInactive: false/)
  assert.match(handler, /options\.requireSelf && Number\(actor\?\.id \|\| 0\) !== Number\(targetId \|\| 0\)/)
  assert.match(handler, /if \(options\.requireCurrent\) \{[\s\S]*?Current password required[\s\S]*?bcrypt\.compareSync/)
  assert.doesNotMatch(handler, /body\.adminOverride/)
})

check('admin reset route is admin-only, can target another admin, and may reset an inactive account', () => {
  assert.match(source, /reset-password'[^\n]*requireCurrent: false[^\n]*requireAdminControl: true[^\n]*requireSelf: false[^\n]*allowInactive: true/)
  assert.match(handler, /options\.requireAdminControl && !isAdminControlUser\(actor\)/)
  assert.match(handler, /if \(!options\.allowInactive && !user\.is_active\)/)
})

check('peer admins, including the primary recovery admin, are manageable (explicit user decision Sep 1 2026)', () => {
  const manageStart = source.indexOf('function canManageTarget')
  const manageEnd = source.indexOf('async function getUserWithRole', manageStart)
  const manage = source.slice(manageStart, manageEnd)
  assert.match(manage, /if \(!isAdminControlUser\(actor\)\) return false/)
  assert.doesNotMatch(manage, /if \(isPrimaryAdmin\(target\)\) return false/)
  assert.doesNotMatch(manage, /isAdminControlUser\(target\)/)
})

check('admin edit path can change status of another manageable admin, including the primary admin', () => {
  const putStart = source.indexOf("app.put('/users/:id'")
  const putEnd = source.indexOf('// -- Self-service profile', putStart)
  const putBlock = source.slice(putStart, putEnd)
  assert.match(putBlock, /if \(!canManageTarget\(actor, existingSecurity\)\)/)
  assert.match(putBlock, /const nextIsActive = markDeleted \? 0 : \(body\.is_active/)
  assert.match(putBlock, /is_active = @is_active/)
  assert.match(putBlock, /if \(Number\(nextIsActive\) === 0\) \{[\s\S]*?revokeUserSessions\(c\.env, Number\(id\)\)/)
  assert.doesNotMatch(putBlock, /Primary admin account cannot be deactivated or deleted/)
})

console.log(`PASS ${passed} user/admin password policy checks`)
