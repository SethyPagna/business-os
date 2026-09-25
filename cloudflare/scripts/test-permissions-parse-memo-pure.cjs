// CPU item (Records/Performance/2026-09-25 I1): permission JSON is parsed
// once per user object, not on every check.
//
// hasPermission() ran isAdminControlUser() (merge = 2 JSON.parse) and then
// merged again (2 more) -- four parses per check, and a route with a dozen
// checks, or a list that checks per row, repeated that for the same session
// user. The merge is now memoized per user object in a WeakMap.
//
// What must not change: the answers. The memo is keyed on the object AND the
// two JSON strings it was computed from, so a changed string on the same
// object is re-read, and callers get a copy they may mutate without
// poisoning the next check.
//
// Run: node scripts/test-permissions-parse-memo-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const filename = path.join(__dirname, '../src/lib/permissions.ts')
const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filename,
})
const loaded = { exports: {} }
new Function('require', 'module', 'exports', outputText)(() => { throw new Error('no deps expected') }, loaded, loaded.exports)
const p = loaded.exports

function countParses(fn) {
  const original = JSON.parse
  let count = 0
  JSON.parse = function counted(...args) { count += 1; return original.apply(this, args) }
  try { fn() } finally { JSON.parse = original }
  return count
}

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

const cashier = () => ({
  username: 'cashier', role_code: 'employee',
  role_permissions: '{"pos":true,"sales":true,"products":"review","settings":"view"}',
  permissions: '{"sales":false,"returns":true,"products:delete":false}',
})

check('twenty checks on one user object parse its permission JSON at most twice', () => {
  const user = cashier()
  const parses = countParses(() => {
    for (let i = 0; i < 5; i += 1) {
      p.hasPermission(user, 'pos')
      p.getPermissionTier(user, 'products')
      p.isActionBlocked(user, 'products', 'delete')
      p.isAdminControlUser(user)
    }
  })
  assert.ok(parses <= 2, `expected <= 2 JSON.parse calls, saw ${parses}`)
})

check('answers are unchanged: user overrides win, tiers and action blocks hold', () => {
  const user = cashier()
  assert.equal(p.hasPermission(user, 'pos'), true)
  assert.equal(p.hasPermission(user, 'sales'), false, 'user-level false overrides the role grant')
  assert.equal(p.hasPermission(user, 'returns'), true)
  assert.equal(p.getPermissionTier(user, 'products'), 'review')
  assert.equal(p.getPermissionTier(user, 'settings'), 'view')
  assert.equal(p.getActionTier(user, 'products', 'delete'), 'none')
  assert.equal(p.isAdminControlUser(user), false)
  assert.deepEqual(p.getMergedPermissions(user), {
    pos: true, sales: false, products: 'review', settings: 'view', returns: true, 'products:delete': false,
  })
  assert.deepEqual(p.parsePermissions(user), { sales: false, returns: true, 'products:delete': false })
})

check('a changed permission string on the SAME object is re-read, never served stale', () => {
  const user = cashier()
  assert.equal(p.hasPermission(user, 'backup'), false)
  user.permissions = '{"all":true}'
  assert.equal(p.isAdminControlUser(user), true)
  assert.equal(p.hasPermission(user, 'backup'), true)
  user.role_permissions = null
  user.permissions = null
  assert.equal(p.hasPermission(user, 'pos'), false)
})

check('mutating a returned permission map cannot poison later checks', () => {
  const user = cashier()
  const merged = p.getMergedPermissions(user)
  merged.all = true
  merged.backup = true
  const parsed = p.parsePermissions(user)
  parsed.all = true
  assert.equal(p.isAdminControlUser(user), false)
  assert.equal(p.hasPermission(user, 'backup'), false)
  assert.equal(p.getMergedPermissions(user).all, undefined)
})

check('distinct user objects never share an answer', () => {
  const a = cashier()
  const b = { ...cashier(), permissions: '{"all":true}' }
  assert.equal(p.isAdminControlUser(a), false)
  assert.equal(p.isAdminControlUser(b), true)
  assert.equal(p.isAdminControlUser(a), false)
})

check('null/undefined users and malformed JSON behave as before', () => {
  assert.equal(p.hasPermission(null, 'pos'), false)
  assert.equal(p.hasPermission(undefined, ''), false)
  assert.deepEqual(p.getMergedPermissions(null), {})
  const broken = { permissions: '{not json', role_permissions: '[1,2]' }
  assert.deepEqual(p.getMergedPermissions(broken), {})
  assert.equal(p.hasPermission(broken, 'pos'), false)
})

console.log(`\n${passed} permission memo checks passed.`)
