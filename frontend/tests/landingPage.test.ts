// The sign-in landing for the Dashboard roles (owner, 15 Nov 2026): an Employee (Dashboard view only) lands where it did before the
// Dashboard was opened to it; a Manager and an Administrator still land on the Dashboard.
//
// Run: node tests/landingPage.test.ts
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { landingBounceTarget } from '../src/app/landingPage.ts'
import { NAV_ITEMS } from '../src/components/shared/navigationConfig.ts'
import { ROLE_PRESETS } from '../src/components/users/rolePresetDefaults.ts'
import { effectivePermissions } from '../src/utils/permissions.ts'

const preset = (key: string) => ROLE_PRESETS.find((entry) => entry.key === key)!.permissions as Record<string, unknown>
const navIds = NAV_ITEMS.map((item) => item.id)
const asUser = (permissions: Record<string, unknown>, role_code = 'staff') => ({ id: 1, role_code, permissions: JSON.stringify(permissions) })
function accessFor(user: ReturnType<typeof asUser>) {
  const rules = effectivePermissions(user as never)
  return (id: string) => {
    const item = NAV_ITEMS.find((entry) => entry.id === id)
    if (!item) return false
    return item.permission == null || rules.getPermissionTier(item.permission) !== 'none'
  }
}
const landing = (user: ReturnType<typeof asUser>, fn: typeof landingBounceTarget = landingBounceTarget, active = true) => {
  const canAccessPage = accessFor(user)
  const target = fn({
    page: 'dashboard', active, navIds,
    viewOnlyDashboard: canAccessPage('dashboard') && !effectivePermissions(user as never).hasPermission('dashboard_export'),
    canAccessPage,
  })
  return target ?? 'dashboard'
}

// The landing at fdcc77055: the Dashboard was not the Employee's, so the shell moved to the first page it could open.
const beforeTheLane = (() => {
  const user = asUser({ ...preset('employee'), dashboard: false })
  const canAccessPage = accessFor(user)
  assert.equal(canAccessPage('dashboard'), false)
  return navIds.find((id) => canAccessPage(id))!
})()

let failed = 0
function test(name: string, fn: () => void | Promise<void>): Promise<void> | void {
  const done = () => console.log(`PASS ${name}`)
  const fail = (error: unknown) => { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
  try { const out = fn(); if (out) return out.then(done, fail); done() } catch (error) { fail(error) }
}

test('the Employee lands where it did before the Dashboard was opened to it', () => {
  assert.notEqual(beforeTheLane, 'dashboard')
  assert.equal(landing(asUser(preset('employee'))), beforeTheLane)
})
test('the Manager and the Administrator still land on the Dashboard', () => {
  assert.equal(landing(asUser(preset('manager'))), 'dashboard')
  assert.equal(landing(asUser({ all: true }, 'admin')), 'dashboard')
})
test('after the first tap or key the Employee is left where it chose to go', () => {
  assert.equal(landing(asUser(preset('employee')), landingBounceTarget, false), 'dashboard')
})
test('a page other than the Dashboard is never moved', () => {
  const user = asUser(preset('employee'))
  assert.equal(landingBounceTarget({ page: 'notes', active: true, viewOnlyDashboard: true, navIds, canAccessPage: accessFor(user) }), null)
})
test('App.tsx moves the landing through the helper and disarms on the first interaction', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /landingBounceTarget\(\{/)
  assert.match(app, /addEventListener\('pointerdown', disarm/)
  assert.match(app, /hasPermission\('dashboard_export'\)/)
})
await test('MUTANT: a helper that ignores the view-only rule leaves the Employee on the Dashboard', async () => {
  const dir = new URL('../src/app/', import.meta.url)
  const source = readFileSync(new URL('landingPage.ts', dir), 'utf8')
  assert.ok(source.includes('!viewOnlyDashboard || '))
  const mutantUrl = new URL('landingPage.mutant.ts', dir)
  writeFileSync(mutantUrl, source.replace('!viewOnlyDashboard || ', ''))
  try {
    const mutant = await import(mutantUrl.href) as { landingBounceTarget: typeof landingBounceTarget }
    // Without the guard a Manager would be bounced too: the discriminating pair is Employee unchanged, Manager moved.
    assert.equal(landing(asUser(preset('manager')), mutant.landingBounceTarget), beforeTheLane, 'the mutant bounces the Manager, which the real helper does not')
    assert.notEqual(landing(asUser(preset('manager')), mutant.landingBounceTarget), 'dashboard')
  } finally { rmSync(mutantUrl) }
})
await test('MUTANT: a helper that never moves leaves the Employee on the Dashboard', async () => {
  const dir = new URL('../src/app/', import.meta.url)
  const source = readFileSync(new URL('landingPage.ts', dir), 'utf8')
  const mutantUrl = new URL('landingPage.mutant2.ts', dir)
  writeFileSync(mutantUrl, source.replace('return navIds.find(', 'return null; navIds.find('))
  try {
    const mutant = await import(mutantUrl.href) as { landingBounceTarget: typeof landingBounceTarget }
    assert.equal(landing(asUser(preset('employee')), mutant.landingBounceTarget), 'dashboard')
    assert.notEqual(landing(asUser(preset('employee')), mutant.landingBounceTarget), beforeTheLane, 'so the first test above fails against it')
  } finally { rmSync(mutantUrl) }
})
process.exitCode = failed ? 1 : 0
