// PERM-UI, 3 Nov 2026: the controls the browser role matrix (e2e/role-matrix.spec.ts) found offered to roles that lacked the grant.
// The browser run is the proof for a rendered page; this file is the fast guard that fails in the unit chain when a gate is removed.
//
//   DOOR   the Promotions page opens for a role if and only if it is offered at least one section on it (behavioural: the production
//          canAccessPage callback and getHubDestinations, over every combination of the grants that matter)
//   PINS   each control is drawn only behind the grant the Worker enforces for the call it makes (source shape, the floor)
//
// Run: node tests/roleMatrixControlGates.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getHubDestinations } from '../src/components/shared/hubNavigation.ts'
import { ROLES, accessFor, deriveRole, type RoleDef } from '../e2e/support/roleMatrix.ts'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
let failed = 0
function test(name: string, run: () => void): void {
  try { run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`, error) }
}

// --- DOOR -----------------------------------------------------------------------------------------------------------------------
const employee = ROLES.find((role) => role.id === 'employee') as RoleDef
const sectionsOf = (role: RoleDef): string[] => {
  const { getPermissionTier, hasPermission, can } = accessFor(role)
  return getHubDestinations('promotions', { getPermissionTier, hasPermission, can }).map((item) => item.id)
}

test('DOOR: the Employee default is not offered a Promotions page with nothing on it', () => {
  const access = accessFor(employee)
  assert.deepEqual(sectionsOf(employee), [], 'the Employee holds none of promotions, customer_portal, or products edit + price')
  assert.equal(access.canAccessPage('promotions'), false)
})

test('DOOR: the page opens exactly when a section is offered, for every combination of the grants that feed its three sections', () => {
  let opened = 0
  let closed = 0
  for (const promotions of [undefined, true, 'view'] as const) {
    for (const portal of [undefined, true] as const) {
      for (const products of [false, true, 'review'] as const) {
        for (const edit of [true, false]) for (const price of [true, false]) for (const view of [true, false]) {
          const patch = {
            ...(promotions === undefined ? {} : { promotions }),
            ...(portal === undefined ? {} : { customer_portal: portal }),
            products,
            'products:edit': edit,
            'products:price': price,
            'products:view': view,
          }
          const role = deriveRole(employee, `door-${promotions}-${portal}-${products}-${edit}-${price}-${view}`, 'door probe', patch)
          const offered = sectionsOf(role)
          const door = accessFor(role).canAccessPage('promotions')
          assert.equal(door, offered.length > 0, `${JSON.stringify(patch)}: door ${door}, sections [${offered.join(',')}]`)
          if (door) opened += 1; else closed += 1
        }
      }
    }
  }
  assert.ok(opened > 0 && closed > 0, `the probe saw both answers (opened ${opened}, closed ${closed})`)
})

test('DOOR: each of the three sections still opens the page on its own, and an administrator always has it', () => {
  const open = (patch: Record<string, boolean | 'view' | 'review'>) => accessFor(deriveRole(employee, 'door-one', 'one grant', patch)).canAccessPage('promotions')
  assert.equal(open({ promotions: true }), true, 'Rules')
  assert.equal(open({ customer_portal: true }), true, 'Loyalty')
  assert.equal(open({ 'products:price': true }), true, 'Discounts: the Employee already holds products view + edit, so the price action is the missing piece')
  assert.equal(open({ 'products:edit': false, 'products:price': true }), false, 'Discounts need Edit product too')
  assert.equal(accessFor(ROLES.find((role) => role.id === 'admin') as RoleDef).canAccessPage('promotions'), true)
})

// --- PINS ------------------------------------------------------------------------------------------------------------------------
/** Every `onClick={handler}` of a button must sit directly inside `{gate ? (<button ... ` -- the nearest conditional is the gate. */
function assertEveryButtonGated(source: string, handler: string, gate: string, expectedCount: number, what: string): void {
  const clicks = [...source.matchAll(new RegExp(`onClick=\\{${handler}\\}`, 'g'))]
  assert.equal(clicks.length, expectedCount, `${what}: ${expectedCount} button(s) call ${handler}, found ${clicks.length}`)
  for (const click of clicks) {
    const before = source.slice(0, click.index)
    assert.match(before, new RegExp(`\\{${gate} \\? \\(\\s*<button[^>]*$`), `${what}: the button calling ${handler} at offset ${click.index} is not directly behind ${gate}`)
  }
}

test('SETTINGS: both Save buttons ride canEditSettings, so a View-tier role gets the read-only badge and no Save', () => {
  const settings = read('../src/components/utils-settings/Settings.tsx')
  assert.match(settings, /const canEditSettings = getPermissionTier\('settings'\) === 'full'/)
  assertEveryButtonGated(settings, 'handleSaveSettings', 'canEditSettings', 2, 'Settings header and page-bottom Save')
})

console.log(failed ? `${failed} role-matrix control gate test(s) failed` : 'all role-matrix control gate tests passed')
process.exitCode = failed ? 1 : 0
