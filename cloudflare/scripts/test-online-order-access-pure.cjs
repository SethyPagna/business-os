// KHQR S2: who may see online orders, decide a customer request and record a refund. The grant is strict (nothing else implies it),
// the two actions only narrow it, deciding and refunding need view, and the seeded defaults give Admin, Manager and Employee all three
// while a role with no opinion (a stored role from before this key existed) gets none.
//
// Run: node scripts/test-online-order-access-pure.cjs
const assert = require('node:assert/strict')
const { loadTsLibGraph } = require('./harness/load_ts_lib.cjs')
const { onlineOrdersAccess: A, roleDefaults: D } = loadTsLibGraph(['onlineOrdersAccess', 'roleDefaults', 'permissions'])

let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }
const user = (role, permissions) => ({ role_code: role, role_permissions: JSON.stringify(permissions), permissions: null })
const get = (u) => A.getOnlineOrderAccess(u)
const ALL = { canView: true, canDecide: true, canRefund: true }
const NONE = { canView: false, canDecide: false, canRefund: false }

check('admin has all three, whatever the stored permissions say', () => {
  assert.deepEqual(get(user('admin', { all: true })), ALL)
  assert.deepEqual(get(user('admin', {})), ALL)
})
check('the seeded Employee and Manager defaults grant all three', () => {
  for (const code of ['employee', 'manager']) {
    assert.equal(D.DEFAULT_ROLE_PERMISSIONS[code].online_orders, true, code)
    assert.deepEqual(get(user(code, D.DEFAULT_ROLE_PERMISSIONS[code])), ALL, code)
  }
})
check('a stored role with no online_orders key gets nothing (existing roles change only by an admin or a backfill)', () => {
  assert.deepEqual(get(user('employee', { pos: true, sales: true, returns: true, settings: true })), NONE)
})
check('nothing else implies it: Sales, Returns and Settings at Full do not open online orders', () => {
  assert.deepEqual(get(user('manager', { sales: true, returns: true, settings: true, review: true })), NONE)
})
check('each action narrows: decide off keeps view and refund; refund off keeps view and decide', () => {
  assert.deepEqual(get(user('employee', { online_orders: true, 'online_orders:decide': false })), { canView: true, canDecide: false, canRefund: true })
  assert.deepEqual(get(user('employee', { online_orders: true, 'online_orders:refund': false })), { canView: true, canDecide: true, canRefund: false })
})
check('deciding and refunding need view: view off removes all three', () => {
  assert.deepEqual(get(user('employee', { online_orders: true, 'online_orders:view': false })), NONE)
})
check('an action override cannot grant what the section does not: no section key, actions true -> nothing', () => {
  assert.deepEqual(get(user('employee', { 'online_orders:view': true, 'online_orders:decide': true, 'online_orders:refund': true })), NONE)
})
check('review is not a tier of this key: the string "review" grants nothing', () => {
  assert.deepEqual(get(user('employee', { online_orders: 'review' })), NONE)
})
check('no user, no access', () => {
  assert.deepEqual(get(null), NONE)
  assert.deepEqual(get(undefined), NONE)
})
console.log(`\n${passed} checks passed`)
