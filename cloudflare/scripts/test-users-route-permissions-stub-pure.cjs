// No test may load routes/users.ts with a hand-written `../lib/permissions` stub.
//
// routes/users.ts imports several helpers from lib/permissions.ts (isAdminControlUser, normalizePermissionMap, ...). A stub object lists only the
// functions its author needed on the day, so the next helper the route imports turns every such test red the first time it reaches the save path
// that calls it (6.0.2319: nineteen tests stubbed the module, one reached POST /users and died on normalizePermissionMap). The durable shape is
// harness/permissions_stub.cjs's permissionsWith(overrides): the REAL module with only the named functions replaced. A test that wants the whole
// real module may pass it (`'../lib/permissions': permissions` where permissions = load('lib/permissions.ts')).
//
// Run from the cloudflare directory: node scripts/test-users-route-permissions-stub-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SCRIPTS = __dirname

// The file loads the real routes/users.ts (a source scan of users.ts is not a load).
const LOADS_USERS_ROUTE = [
  /\bload(?:Real)?\(\s*['"](?:\.\/)?routes\/users(?:\.ts)?['"]/,
  /['"]\.\/routes\/users['"]/,
]
// A bare object literal as the permissions stub, in either of the two shapes tests use (a stub map entry, or a require switch).
const BARE_STUB = [
  /['"]\.\.\/lib\/permissions['"]\s*:\s*\{/,
  /request\s*===\s*['"]\.\.\/lib\/permissions['"]\s*\)\s*return\s*\{/,
]

function offendersIn(name, text) {
  if (!LOADS_USERS_ROUTE.some((pattern) => pattern.test(text))) return []
  return BARE_STUB.some((pattern) => pattern.test(text)) ? [name] : []
}

// Positive control: the sweep can fail, and accepts the durable shapes.
assert.deepEqual(offendersIn('bad.cjs', "const app = load('routes/users.ts', {\n  '../lib/permissions': { isAdminControlUser: () => true },\n})"), ['bad.cjs'], 'a bare stub next to a users.ts load is refused')
assert.deepEqual(offendersIn('bad2.cjs', "const m = ['./routes/users']\nif (request === '../lib/permissions') return { getActionTier: () => 'full' }"), ['bad2.cjs'], 'the require-switch shape is refused too')
assert.deepEqual(offendersIn('ok.cjs', "const app = load('routes/users.ts', {\n  '../lib/permissions': require('./harness/permissions_stub.cjs').permissionsWith({ isAdminControlUser: () => true }),\n})"), [], 'permissionsWith is accepted')
assert.deepEqual(offendersIn('ok2.cjs', "const app = load('routes/users.ts', {\n  '../lib/permissions': permissions,\n})"), [], 'the real module is accepted')
assert.deepEqual(offendersIn('scan.cjs', "const rows = [['routes/users.ts', /x/, 'source scan']]\n'../lib/permissions': { hasPermission: () => true }"), [], 'a source scan of users.ts is not a load')

const files = fs.readdirSync(SCRIPTS).filter((name) => /^test-.*\.cjs$/.test(name) && name !== path.basename(__filename))
let loaders = 0
const offenders = []
for (const name of files) {
  const text = fs.readFileSync(path.join(SCRIPTS, name), 'utf8')
  if (LOADS_USERS_ROUTE.some((pattern) => pattern.test(text))) loaders += 1
  offenders.push(...offendersIn(name, text))
}
assert.ok(loaders >= 15, `the sweep must find the tests that load routes/users.ts (found ${loaders}); a sweep that finds none proves nothing`)
assert.deepEqual(offenders, [], `these tests load routes/users.ts with a bare lib/permissions stub; use require('./harness/permissions_stub.cjs').permissionsWith({...}):\n${offenders.join('\n')}`)

// The helper really is the real module with the overrides on top.
const { permissionsWith } = require('./harness/permissions_stub.cjs')
const stub = permissionsWith({ isAdminControlUser: () => 'overridden' })
assert.equal(stub.isAdminControlUser(), 'overridden')
assert.equal(typeof stub.normalizePermissionMap, 'function', 'a helper the route imports is present without being listed')
assert.deepEqual(stub.normalizePermissionMap({ sales: 'true' }), permissionsWith().normalizePermissionMap({ sales: 'true' }))
assert.notEqual(permissionsWith(), permissionsWith(), 'a fresh object each call')

console.log(`test-users-route-permissions-stub-pure: ${loaders} users.ts loaders checked, 0 bare stubs`)
