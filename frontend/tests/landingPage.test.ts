// The sign-in landing for the Dashboard roles (owner, 15 Nov 2026): an Employee (Dashboard view only) lands where it did before the
// Dashboard was opened to it; a Manager and an Administrator still land on the Dashboard. Behaviour of the pure functions the shell
// uses for '/' with no hub page in the URL; the mounted counterpart is e2e/role-matrix.spec.ts (Employee landing).
//
// Run: node tests/landingPage.test.ts
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { resolveRootLanding, resolveRootLandingState } from '../src/app/landingPage.ts'
import { NAV_ITEMS } from '../src/components/shared/navigationConfig.ts'
import { ROLE_PRESETS } from '../src/components/users/rolePresetDefaults.ts'
import { effectivePermissions } from '../src/utils/permissions.ts'

const preset = (key: string) => ROLE_PRESETS.find((entry) => entry.key === key)!.permissions as Record<string, unknown>
const navIds = NAV_ITEMS.map((item) => item.id)
const asUser = (permissions: Record<string, unknown>, role_code = 'staff') => ({ id: 1, role_code, permissions: JSON.stringify(permissions) })
type TestUser = ReturnType<typeof asUser>
function accessFor(user: TestUser) {
  const rules = effectivePermissions(user as never)
  return (id: string) => {
    const item = NAV_ITEMS.find((entry) => entry.id === id)
    if (!item) return false
    return item.permission == null || rules.getPermissionTier(item.permission) !== 'none'
  }
}
const viewOnlyOf = (user: TestUser) => accessFor(user)('dashboard') && !effectivePermissions(user as never).hasPermission('dashboard_export')
const landing = (user: TestUser, settingValue: unknown = undefined, fn: typeof resolveRootLanding = resolveRootLanding) =>
  fn({ settingValue, viewOnlyDashboard: viewOnlyOf(user), navIds, canAccessPage: accessFor(user) })

const employee = asUser(preset('employee'))
const manager = asUser(preset('manager'))
const admin = asUser({ all: true }, 'admin')
const noDashboard = asUser({ ...preset('employee'), dashboard: false })

// The landing at fdcc77055: the Dashboard was not the Employee's, so the shell moved to the first page it could open.
const beforeTheLane = (() => {
  const access = accessFor(noDashboard)
  assert.equal(access('dashboard'), false)
  return navIds.find((id) => access(id))!
})()

let failed = 0
function test(name: string, fn: () => void | Promise<void>): Promise<void> | void {
  const done = () => console.log(`PASS ${name}`)
  const fail = (error: unknown) => { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
  try { const out = fn(); if (out) return out.then(done, fail); done() } catch (error) { fail(error) }
}

test('the fixtures are what the cases say they are', () => {
  assert.equal(viewOnlyOf(employee), true)
  assert.equal(viewOnlyOf(manager), false)
  assert.equal(accessFor(manager)('dashboard'), true)
  assert.equal(viewOnlyOf(admin), false)
  assert.equal(accessFor(admin)('dashboard'), true)
  assert.equal(accessFor(noDashboard)('dashboard'), false)
  assert.notEqual(beforeTheLane, 'dashboard')
})
test('setting unset: the Employee lands where it did before the Dashboard was opened to it', () => {
  assert.equal(landing(employee), beforeTheLane)
  assert.equal(landing(employee, ''), beforeTheLane)
  assert.equal(landing(employee, 'not-a-page'), beforeTheLane)
})
test('setting unset: the Manager and the Administrator land on the Dashboard', () => {
  assert.equal(landing(manager), 'dashboard')
  assert.equal(landing(admin), 'dashboard')
})
test('no Dashboard: the plain rule is returned, the shell then falls through as at fdcc77055', () => {
  assert.equal(landing(noDashboard), 'dashboard')
})
test('setting set to the Dashboard: same as unset, for each role', () => {
  assert.equal(landing(employee, 'dashboard'), beforeTheLane)
  assert.equal(landing(manager, 'dashboard'), 'dashboard')
  assert.equal(landing(admin, 'dashboard'), 'dashboard')
})
test('setting set to another page: every role gets that page', () => {
  for (const user of [employee, manager, admin, noDashboard]) {
    assert.equal(landing(user, 'inventory'), 'inventory')
    assert.equal(landing(user, ' Notes '), 'notes')
  }
})
test('an Employee that can open nothing else stays on the Dashboard rather than on no page', () => {
  const only = { settingValue: undefined, viewOnlyDashboard: true, navIds, canAccessPage: (id: string) => id === 'dashboard' }
  assert.equal(resolveRootLanding(only), 'dashboard')
})

// The state the shell holds across a sign-in: pending until applied once, then the page the account holds stands.
const stateOf = (user: TestUser, statePage: string, settled: boolean, settingValue: unknown = undefined) =>
  resolveRootLandingState({ settingValue, viewOnlyDashboard: viewOnlyOf(user), navIds, canAccessPage: accessFor(user), settled, statePage })
test('Employee at sign-in: the landing is both shown and requested, so the Dashboard is never the page', () => {
  assert.deepEqual(stateOf(employee, 'dashboard', false), { pending: true, requested: beforeTheLane, shown: beforeTheLane })
})
test('Employee after the landing: a tap on Dashboard (path /) is not pulled back, and neither is any other page', () => {
  for (const held of ['dashboard', beforeTheLane, 'inventory']) {
    assert.deepEqual(stateOf(employee, held, true), { pending: false, requested: held, shown: held })
  }
})
test('Manager and Administrator: nothing pending, the plain rule, whatever the shell holds', () => {
  for (const user of [manager, admin]) {
    for (const settled of [false, true]) {
      assert.deepEqual(stateOf(user, 'dashboard', settled), { pending: false, requested: 'dashboard', shown: 'dashboard' })
      assert.deepEqual(stateOf(user, 'notes', settled), { pending: false, requested: 'dashboard', shown: 'notes' })
      assert.deepEqual(stateOf(user, 'notes', settled, 'inventory'), { pending: false, requested: 'inventory', shown: 'notes' })
    }
  }
})
test('Employee with a set landing page: that page, pending once', () => {
  assert.deepEqual(stateOf(employee, 'dashboard', false, 'inventory'), { pending: true, requested: 'inventory', shown: 'inventory' })
})
test('App.tsx keeps no second rule that moves the page off the Dashboard', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(app, /landingBounce/)
  assert.match(app, /resolveRootLandingState\(/)
})
await test('MUTANT: a landing that ignores the view-only rule moves the Manager too', async () => {
  const dir = new URL('../src/app/', import.meta.url)
  const source = readFileSync(new URL('landingPage.ts', dir), 'utf8')
  assert.ok(source.includes("base !== 'dashboard' || !viewOnlyDashboard"))
  const mutantUrl = new URL('landingPage.mutant.ts', dir)
  writeFileSync(mutantUrl, source.replace("base !== 'dashboard' || !viewOnlyDashboard", "base !== 'dashboard'"))
  try {
    const mutant = await import(mutantUrl.href) as { resolveRootLanding: typeof resolveRootLanding }
    assert.equal(landing(employee, undefined, mutant.resolveRootLanding), beforeTheLane)
    assert.notEqual(landing(manager, undefined, mutant.resolveRootLanding), 'dashboard')
  } finally { rmSync(mutantUrl) }
})
await test('MUTANT: a landing that never moves leaves the Employee on the Dashboard', async () => {
  const dir = new URL('../src/app/', import.meta.url)
  const source = readFileSync(new URL('landingPage.ts', dir), 'utf8')
  const mutantUrl = new URL('landingPage.mutant2.ts', dir)
  writeFileSync(mutantUrl, source.replace('return navIds.find(', 'return base; navIds.find('))
  try {
    const mutant = await import(mutantUrl.href) as { resolveRootLanding: typeof resolveRootLanding }
    assert.equal(landing(employee, undefined, mutant.resolveRootLanding), 'dashboard')
  } finally { rmSync(mutantUrl) }
})
process.exitCode = failed ? 1 : 0
