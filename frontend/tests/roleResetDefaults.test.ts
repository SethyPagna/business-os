// Lane 6.0.893 -- "Reset to Employee defaults" on the role editor.
//
//   * the action loads GET /api/roles/defaults into the editor DRAFT only: nothing is written, the stored role is
//     untouched until Save
//   * Save of an existing role opens the shared ConfirmDialog review listing EVERY changed key, before -> after,
//     with translated labels and the sensitivity shield; the admin confirms and the role is written once
//   * admin only; offered on the seeded Employee/Manager roles only; a failed load keeps the draft
//   * roleDiff is the pure core: absent is "Not set", not Off; unknown keys are listed raw, never dropped
//
// Mounted against the real Users page with the transport doubled. Every case fails on the base: the action,
// the review and roleDiff.ts did not exist.
//
// Run: node tests/roleResetDefaults.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Harness, MemoryNode, MountedSurface } from './mountedComponentHarness.ts'
import { diffRolePermissions, roleValueLabel } from '../src/components/users/roleDiff.ts'
import { resettableRoleCode } from '../src/components/users/roleDefaultsReset.ts'
import { DEFAULT_ROLE_PERMISSIONS } from '../../cloudflare/src/lib/roleDefaults.ts'

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const tr = (key: string, fallback: string) => en[key] ?? fallback

let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

// The live Employee role as an owner may have left it: Dashboard on, cost view on, no supplier switch at all.
const STORED_EMPLOYEE = { pos: true, dashboard: true, product_cost_view: true, products: true, 'products:price': false, 'legacy_unknown_key': true }
const ROLES = [
  { id: 1, name: 'Admin', code: 'admin', permissions: '{"all":true}', is_system: 1 },
  { id: 2, name: 'Employee', code: 'employee', permissions: JSON.stringify(STORED_EMPLOYEE), is_system: 0, updated_at: '2026-10-19 10:00:00' },
  { id: 3, name: 'Night cashier', code: null, permissions: '{"pos":true}', is_system: 0, updated_at: '2026-10-19 10:00:00' },
]
const admin = { id: 1, name: 'Owner Admin', username: 'owner', role_code: 'admin' }
const employee = { id: 5, name: 'Staff', username: 'staff', role_code: 'employee', role_permissions: JSON.stringify(DEFAULT_ROLE_PERMISSIONS.employee) }

const harness: Harness = await (await import('./mountedComponentHarness.ts')).createHarness({ localStorage: { businessos_user: JSON.stringify(admin) } })

type Calls = { defaults: number; updates: Array<{ id: unknown; payload: Record<string, unknown> }>; notices: Array<[string, string]> }

async function mountRoles(options: { user?: Record<string, unknown>; defaultsAnswer?: () => Promise<unknown> } = {}): Promise<{ page: MountedSurface; calls: Calls }> {
  const calls: Calls = { defaults: 0, updates: [], notices: [] }
  const user = options.user ?? admin
  const page = await harness.mount({
    component: 'components/users/Users.tsx',
    app: {
      page: 'settings',
      language: 'en',
      t: (key: string) => en[key] ?? key,
      user,
      notify: (message: string, type: string) => { calls.notices.push([message, type]) },
      hasPermission: () => true,
      can: () => true,
    },
    doubles: {
      'api/userAdminTransport.ts': {
        getUsers: async () => [],
        getRoles: async () => ROLES,
        getPasswordResetRequests: async () => ({ requests: [] }),
        getRoleDefaults: async () => { calls.defaults += 1; return (options.defaultsAnswer ?? (async () => ({ success: true, defaults: DEFAULT_ROLE_PERMISSIONS })))() },
        updateRole: async (id: unknown, payload: Record<string, unknown>) => { calls.updates.push({ id, payload }); return { success: true } },
      },
      'api/actionHistoryTransport.ts': {
        getActionHistory: async () => ({ items: [] }),
        getActionHistoryUsers: async () => [],
      },
    },
  })
  await page.click(page.button(new RegExp(`^${en.roles}$`)))
  // A non-admin never loads the role list at all.
  if (user === admin) await page.waitFor(() => page.text().includes('Night cashier'), 'the roles list')
  return { page, calls }
}

const dialogs = (page: MountedSurface) => page.findAll((node) => node.getAttribute('role') === 'dialog')
const dialogTitled = (page: MountedSurface, title: string): MemoryNode | undefined => dialogs(page).find((dialog) => dialog.querySelector('h2')?.textContent.startsWith(title))

async function openEditor(page: MountedSurface, roleName: string): Promise<MemoryNode> {
  const card = page.find((node) => node.getAttribute('class')?.split(' ').includes('card') === true && node.textContent.includes(roleName) && node.querySelectorAll('button').length > 0, `the card of ${roleName}`)
  await page.click(page.button(new RegExp(`^${en.edit}$`), card))
  const editor = dialogTitled(page, `${en.edit_role}: ${roleName}`)
  assert.ok(editor, `the editor of ${roleName} is open`)
  return editor
}

const resetButton = (page: MountedSurface): MemoryNode[] => page.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === en.role_reset_employee_defaults)

await runTest('roleDiff: lists every changed key, absent is Not set (not Off), unknown keys are kept raw', () => {
  const changes = diffRolePermissions(STORED_EMPLOYEE, DEFAULT_ROLE_PERMISSIONS.employee, tr)
  const byKey = new Map(changes.map((change) => [change.key, change]))
  assert.deepEqual([byKey.get('dashboard')?.before, byKey.get('dashboard')?.after], ['on', 'unset'], 'a key the defaults do not carry is Not set, not Off')
  assert.deepEqual([byKey.get('products:supplier')?.before, byKey.get('products:supplier')?.after], ['unset', 'off'])
  assert.deepEqual([byKey.get('product_cost_view')?.before, byKey.get('product_cost_view')?.after], ['on', 'off'])
  assert.equal(byKey.get('product_cost_view')?.sensitivity, 'high', 'a cost switch carries the shield')
  assert.equal(byKey.get('legacy_unknown_key')?.label, 'legacy_unknown_key', 'an unnamed key is listed raw, not dropped')
  assert.equal(byKey.has('pos'), false, 'an unchanged key is not listed')
  assert.equal(byKey.has('products:price'), false, 'false -> false is unchanged')
  assert.equal(byKey.get('products:supplier')?.label, `${en.products}: ${en.perm_act_products_supplier}`)
  assert.deepEqual(diffRolePermissions(DEFAULT_ROLE_PERMISSIONS.employee, DEFAULT_ROLE_PERMISSIONS.employee, tr), [])
  assert.deepEqual(diffRolePermissions('{"products":true}', { products: 'review' }, tr).map((c) => [c.before, c.after]), [['on', 'review']])
})

await runTest('roleDiff: the words are translated and the new keys exist in both packs', () => {
  for (const key of ['perm_value_on', 'perm_value_not_set', 'role_reset_employee_defaults', 'role_reset_manager_defaults', 'role_defaults_load_failed', 'role_defaults_none', 'role_defaults_loaded', 'role_review_title']) {
    assert.ok(en[key] && km[key], key)
    assert.notEqual(km[key], en[key], `${key}: Khmer is not an English placeholder`)
    assert.match(km[key], /[ក-៿]/, key)
  }
  assert.equal(roleValueLabel('unset', tr), en.perm_value_not_set)
  assert.equal(roleValueLabel('review', tr), en.review_required)
})

await runTest('reset is offered on the seeded Employee/Manager roles only', () => {
  assert.equal(resettableRoleCode({ code: 'employee' }), 'employee')
  assert.equal(resettableRoleCode({ code: ' Manager ' }), 'manager')
  assert.equal(resettableRoleCode({ code: 'admin' }), null, 'Admin is rewritten by the Worker at startup')
  assert.equal(resettableRoleCode({ code: null }), null)
  assert.equal(resettableRoleCode(null), null)
})

await runTest('reset loads the defaults into the draft and writes nothing', async () => {
  const { page, calls } = await mountRoles()
  try {
    await openEditor(page, 'Employee')
    assert.equal(resetButton(page).length, 1, 'the icon-only reset action carries its translated aria-label')
    assert.equal(resetButton(page)[0].getAttribute('title'), en.role_reset_employee_defaults, 'and the tooltip')
    await page.click(resetButton(page)[0], { until: () => calls.defaults === 1, waitingFor: 'the defaults request' })
    assert.equal(calls.defaults, 1)
    assert.equal(calls.updates.length, 0, 'loading the defaults is not a write')
    assert.ok(calls.notices.some(([message, type]) => message === en.role_defaults_loaded && type === 'info'))
    assert.ok(dialogTitled(page, `${en.edit_role}: Employee`), 'the editor stays open on the draft')
    assert.equal(dialogTitled(page, en.role_review_title), undefined, 'the review opens on Save, not on reset')
  } finally {
    await page.unmount()
  }
})

await runTest('Save lists every changed key before -> after in the shared review; confirm writes once', async () => {
  const { page, calls } = await mountRoles()
  try {
    const editor = await openEditor(page, 'Employee')
    await page.click(resetButton(page)[0], { until: () => calls.defaults === 1, waitingFor: 'the defaults request' })
    await page.click(page.button(new RegExp(`^${en.save}`), editor))
    const review = dialogTitled(page, en.role_review_title)
    assert.ok(review, 'Save opens the review first')
    assert.equal(calls.updates.length, 0, 'nothing is written before the admin confirms')
    const rows = review.querySelectorAll('dt').map((dt) => dt.textContent)
    const expected = diffRolePermissions(STORED_EMPLOYEE, DEFAULT_ROLE_PERMISSIONS.employee, tr)
    assert.ok(expected.length >= 3)
    assert.equal(review.querySelectorAll('dt').length, expected.length, 'one row per changed key, no more, no fewer')
    const text = review.textContent
    assert.ok(text.includes(`${en.perm_value_on} → ${en.perm_value_not_set}`), 'dashboard: On -> Not set')
    assert.ok(text.includes(`${en.perm_value_not_set} → ${en.off}`), 'supplier: Not set -> Off')
    assert.ok(text.includes(`${en.perm_value_on} → ${en.off}`), 'cost view: On -> Off')
    assert.ok(rows.some((row) => row.includes(`${en.products}: ${en.perm_act_products_supplier}`)), 'translated label of the supplier switch')
    assert.ok(review.querySelectorAll('[role=img]').some((mark) => mark.getAttribute('aria-label') === en.permission_sensitive_high), 'the sensitivity shield marks the cost switch')
    await page.click(page.button(new RegExp(`^${en.save}`), review), { until: () => calls.updates.length === 1, waitingFor: 'the single write' })
    assert.equal(calls.updates.length, 1, 'confirm writes exactly once')
    assert.equal(calls.updates[0].id, 2)
    assert.deepEqual(calls.updates[0].payload.permissions, DEFAULT_ROLE_PERMISSIONS.employee, 'the saved permissions are exactly the defaults')
  } finally {
    await page.unmount()
  }
})

await runTest('cancelling the review writes nothing and keeps the draft', async () => {
  const { page, calls } = await mountRoles()
  try {
    const editor = await openEditor(page, 'Employee')
    await page.click(resetButton(page)[0], { until: () => calls.defaults === 1, waitingFor: 'the defaults request' })
    await page.click(page.button(new RegExp(`^${en.save}`), editor))
    const review = dialogTitled(page, en.role_review_title)
    assert.ok(review)
    await page.click(page.button(new RegExp(`^${en.cancel}`), review))
    assert.equal(dialogTitled(page, en.role_review_title), undefined)
    assert.equal(calls.updates.length, 0)
    assert.ok(dialogTitled(page, `${en.edit_role}: Employee`), 'back in the editor')
  } finally {
    await page.unmount()
  }
})

await runTest('a failed load keeps the draft, says so, and offers no review', async () => {
  const { page, calls } = await mountRoles({ defaultsAnswer: async () => { throw new Error('network down') } })
  try {
    const editor = await openEditor(page, 'Employee')
    await page.click(resetButton(page)[0], { until: () => calls.defaults === 1, waitingFor: 'the defaults request' })
    await page.settle()
    assert.ok(calls.notices.some(([message, type]) => message === 'network down' && type === 'error'), 'the failure is shown, not swallowed')
    await page.click(page.button(new RegExp(`^${en.save}`), editor))
    assert.equal(dialogTitled(page, en.role_review_title), undefined, 'an untouched draft has nothing to review')
    assert.equal(calls.updates.length, 0)
  } finally {
    await page.unmount()
  }
})

await runTest('a custom role has no reset action', async () => {
  const { page } = await mountRoles()
  try {
    await openEditor(page, 'Night cashier')
    assert.equal(page.findAll((node) => node.tagName === 'BUTTON' && /^Reset to /.test(node.getAttribute('aria-label') ?? '')).length, 0)
  } finally {
    await page.unmount()
  }
})

await runTest('a non-admin sees neither the editor nor the reset action', async () => {
  const { page, calls } = await mountRoles({ user: employee })
  try {
    assert.equal(page.findAll((node) => node.tagName === 'BUTTON' && node.textContent === en.edit).length, 0, 'no Edit on the role cards')
    assert.equal(resetButton(page).length, 0)
    assert.equal(calls.defaults, 0)
  } finally {
    await page.unmount()
  }
  const users = readFileSync(new URL('../src/components/users/Users.tsx', import.meta.url), 'utf8')
  assert.match(users, /const roleResetCode = canManage \? resettableRoleCode\(selectedRole\) : null/, 'the gate is the admin check, not a hidden class')
})

await harness.close()
if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1) }
console.log('\nroleResetDefaults: all checks passed')
