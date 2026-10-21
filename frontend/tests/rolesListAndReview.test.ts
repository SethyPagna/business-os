// Roles list, role editor shell and save review (Permissions page spec, Lane B, 6.0.936; B1-B13).
//
//   * the save review is one row per changed MODULE, in the editor's words; a role's extras are their own lines
//     (Full never folds them in); Administrator and critical changes come first; "Applies right away to {n} people"
//   * Save always opens that review, a new role included; the footer counts the changes and Save is off at zero
//   * the Roles list: Default / Admin badges, the people count opens Users filtered, a level strip with a spelled-out
//     label, icon Edit / Delete (Delete off while the role is assigned), search that filters roles
//   * user detail: one line per module, icon-only Reset password / Reset 2FA
//   * the editor minimizes to a chip and comes back; undo labels are translated
//
// Mounted against the real Users page with the transport doubled. Cases use a namespace import of roleDiff so a base
// without summarizeRoleChangesByModule fails each case on its own assertion instead of one import error.
//
// Run: node tests/rolesListAndReview.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, propsOf, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'
import * as roleDiff from '../src/components/users/roleDiff.ts'
import { actionsForKey } from '../src/utils/permissionActions.ts'
import { MODULE_ROWS } from '../src/components/users/permissionSummary.ts'
import { PERMISSION_DEFS } from '../src/components/users/permissionDefinitions.ts'
import { DEFAULT_ROLE_PERMISSIONS } from '../../cloudflare/src/lib/roleDefaults.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const usersSource = read('../src/components/users/Users.tsx').replace(/\r\n?/g, '\n')
const tr = (key: string, fallback: string) => en[key] ?? fallback
const fill = (template: string, values: Record<string, string | number>) => Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), template)

let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

// The live Employee as an owner may have left it: Dashboard on, cost view on, one switched-off action, an unknown key.
const STORED_EMPLOYEE = { pos: true, dashboard: true, product_cost_view: true, products: true, 'products:price': false, legacy_unknown_key: true }
const ROLES = [
  { id: 1, name: 'Admin', code: 'admin', permissions: '{"all":true}', is_system: 1 },
  { id: 2, name: 'Employee', code: 'employee', permissions: JSON.stringify(STORED_EMPLOYEE), is_system: 0, updated_at: '2026-10-19 10:00:00' },
  { id: 3, name: 'Night cashier', code: null, permissions: '{"pos":true}', is_system: 0, updated_at: '2026-10-19 10:00:00' },
]
const USERS = [
  { id: 9, name: 'Mia Chan', username: 'mia', role_id: 2, role_name: 'Employee', is_active: 1 },
  { id: 10, name: 'Sok Dara', username: 'sok', role_id: 2, role_name: 'Employee', is_active: 1 },
  { id: 11, name: 'Rith Boss', username: 'rith', role_id: 1, role_name: 'Admin', is_active: 1 },
]
const admin = { id: 1, name: 'Owner Admin', username: 'owner', role_code: 'admin' }

const harness = await createHarness({ localStorage: { businessos_user: JSON.stringify(admin) } })

type Calls = { updates: Array<{ id: unknown; payload: Record<string, unknown> }>; creates: Array<Record<string, unknown>>; deletes: unknown[] }
async function mountPage(options: { language?: Record<string, string> } = {}): Promise<{ page: MountedSurface; calls: Calls }> {
  const language = options.language ?? en
  const calls: Calls = { updates: [], creates: [], deletes: [] }
  const page = await harness.mount({
    component: 'components/users/Users.tsx',
    app: {
      page: 'settings',
      language: language === km ? 'km' : 'en',
      t: (key: string) => language[key] ?? key,
      user: admin,
      notify: () => {},
      hasPermission: () => true,
      can: () => true,
    },
    doubles: {
      'api/userAdminTransport.ts': {
        getUsers: async () => USERS,
        getRoles: async () => ROLES,
        getPasswordResetRequests: async () => ({ requests: [] }),
        getRoleDefaults: async () => ({ success: true, defaults: DEFAULT_ROLE_PERMISSIONS }),
        updateRole: async (id: unknown, payload: Record<string, unknown>) => { calls.updates.push({ id, payload }); return { success: true } },
        createRole: async (payload: Record<string, unknown>) => { calls.creates.push(payload); return { success: true, id: 7 } },
        deleteRole: async (id: unknown) => { calls.deletes.push(id); return { success: true } },
      },
      'api/actionHistoryTransport.ts': {
        getActionHistory: async () => ({ items: [] }),
        getActionHistoryUsers: async () => [],
      },
    },
  })
  await page.click(page.button(new RegExp(`^${language.roles}$`)))
  await page.waitFor(() => page.text().includes('Night cashier'), 'the roles list')
  return { page, calls }
}

const dialogs = (page: MountedSurface) => page.findAll((node) => node.getAttribute('role') === 'dialog')
const dialogTitled = (page: MountedSurface, title: string): MemoryNode | undefined => dialogs(page).find((dialog) => dialog.querySelector('h2')?.textContent.startsWith(title))
const cardOf = (page: MountedSurface, roleName: string): MemoryNode => page.find((node) => node.getAttribute('class')?.split(' ').includes('card') === true && node.textContent.includes(roleName) && node.querySelectorAll('button').length > 0, `the card of ${roleName}`)
const within = (node: MemoryNode, root: MemoryNode): boolean => { for (let current: MemoryNode | null = node; current; current = current.parentNode) if (current === root) return true; return false }
const labelled = (scope: MemoryNode, label: string | RegExp): MemoryNode[] => scope.querySelectorAll('button').filter((button) => {
  const name = button.getAttribute('aria-label') ?? ''
  return typeof label === 'string' ? name === label : label.test(name)
})

async function openEditor(page: MountedSurface, roleName: string): Promise<MemoryNode> {
  await page.click(labelled(cardOf(page, roleName), en.edit)[0])
  const editor = dialogTitled(page, `${en.edit_role}: ${roleName}`)
  assert.ok(editor, `the editor of ${roleName} is open`)
  return editor
}
const levelCell = (page: MountedSurface, moduleId: string, level: string): MemoryNode => {
  const root = page.find((node) => node.getAttribute('data-perm-module') === moduleId, `module ${moduleId}`)
  return page.find((node) => node.tagName === 'BUTTON' && node.getAttribute('data-perm-level') === level && within(node, root), `${moduleId} ${level} cell`)
}
const saveButton = (page: MountedSurface, dialog: MemoryNode): MemoryNode => page.button(new RegExp(`^${en.save}`), dialog)
const footerCount = (editor: MemoryNode): string => editor.querySelectorAll('[role=status]')[0]?.textContent ?? ''
const countText = (n: number) => (n === 1 ? en.role_change_one : fill(en.role_changes_count, { n }))

// ---------------------------------------------------------------------------------------------------- the review

await runTest('B1 reset to defaults over the stored Employee: one row per changed module, no "Not set", every changed key still named', async () => {
  const { page } = await mountPage()
  try {
    const editor = await openEditor(page, 'Employee')
    await page.click(labelled(editor, en.role_reset_employee_defaults)[0])
    await page.click(saveButton(page, editor))
    const review = dialogTitled(page, en.role_review_title)
    assert.ok(review, 'Save opens the review')
    const text = review.textContent
    const stored = roleDiff.diffRolePermissions(STORED_EMPLOYEE, DEFAULT_ROLE_PERMISSIONS.employee, tr)
    const rows = review.querySelectorAll('dt')
    assert.ok(rows.length >= 3 && rows.length < stored.length / 2, `${stored.length} stored keys fold into ${rows.length} module rows`)
    assert.ok(!text.includes(en.perm_value_not_set), 'no storage word ("Not set")')
    // A plain switch that only moves between absent and off changes nothing, and an action switch only means
    // something when it is off (on is what the level already gives); every other change is named.
    const MISSING = []
    for (const change of stored) {
      if (!change.key.includes(':') && ['unset', 'off'].includes(change.before) && ['unset', 'off'].includes(change.after)) continue
      if (change.key.includes(':') && change.before !== 'off' && change.after !== 'off') continue
      const [section, action] = change.key.split(':')
      let word: string | undefined
      if (change.key === 'legacy_unknown_key') word = en.role_other_permission
      else if (action) { const found = actionsForKey(section).find((entry) => entry.key === action); word = found && en[found.shortTKey] }
      else {
        const row = MODULE_ROWS.find((entry) => entry.lead?.key === change.key || entry.extras.some((def) => def.key === change.key) || entry.fields.some((def) => def.key === change.key))
        const def = row?.extras.find((entry) => entry.key === change.key) ?? row?.fields.find((entry) => entry.key === change.key)
        word = def ? (def.shortTKey ? en[def.shortTKey] : en[def.tKey]) : row && (row.sub && row.lead ? en[row.lead.tKey] : en[row.section.tKey])
      }
      if (!word || !text.includes(word)) MISSING.push(`${change.key} -> ${word}`)
    }
    assert.deepEqual(MISSING, [], 'every changed key is still named in the review')
    // The key the catalogue cannot name reads as a plain translated label; the stored key is only the tooltip.
    assert.ok(!text.includes('legacy_unknown_key'), 'the raw key is not in the visible review')
    const unknownRow = page.find((node) => node.getAttribute('title') === 'legacy_unknown_key' && within(node, review), 'the unnamed key row')
    assert.ok(unknownRow.textContent.includes(en.role_other_permission), 'its row is labelled with the generic permission label and carries the key as its tooltip')
  } finally {
    await page.unmount()
  }
})

await runTest('B1 pure: extras are their own lines and Full never folds them in; critical rows come first; unset/off is no change', () => {
  const rows = roleDiff.summarizeRoleChangesByModule(
    { products: 'review', settings: 'view' },
    { dashboard: true, products: true, product_cost_view: true, destructive_delete: true, settings: true, backup: true, backup_restore: true, dashboard_export: false },
    tr,
    { from: 'Staff', to: 'Staff lead' },
  )
  assert.equal(rows[0].kind, 'name', 'the name change comes first')
  assert.equal(rows[0].lines[0].text, 'Staff → Staff lead')
  const moduleRows = rows.filter((row) => row.kind === 'module')
  const firstQuiet = moduleRows.findIndex((row) => row.sensitivity !== 'critical')
  assert.ok(firstQuiet > 0 && moduleRows.slice(firstQuiet).every((row) => row.sensitivity !== 'critical'), 'every module holding a critical change comes before the quiet ones')
  assert.deepEqual(moduleRows.slice(firstQuiet).map((row) => row.id), ['dashboard', 'customer_portal', 'library'], 'the quiet changes keep catalogue order: Dashboard, then the two modules Settings Full now includes')
  const included = en.perm_covered_by_module.replace('{module}', en.perm_section_settings)
  assert.deepEqual(rows.find((row) => row.id === 'customer_portal')?.lines.map((line) => line.text), [included, `+ ${en.perm_short_posts}`, `+ ${en.faq}`, `+ ${en.about}`, `+ ${en.perm_short_site_setup}`], 'Settings Full opens the four Website Editor areas, and the review says why')
  assert.deepEqual(rows.find((row) => row.id === 'library')?.lines.map((line) => line.text), [`${en.none} → ${en.label_full_access}`, included], 'and the Library, which the Worker opens for Settings Full')
  const products = rows.find((row) => row.id === 'products')
  assert.ok(products, 'one row for Products')
  const [level, ...rest] = products.lines
  assert.equal(level.text, `${en.review_required} → ${en.label_full_access}`, 'the level line is the level move and nothing else')
  assert.ok(!level.text.includes(en.perm_short_cost_view), 'Full never folds an extra into its own line')
  assert.deepEqual(rest.map((line) => line.text), [`+ ${en.perm_short_cost_view}`, `+ ${en.perm_short_destructive_imports}`], 'each extra is a line of its own')
  assert.deepEqual(rest.map((line) => line.sensitivity), ['high', 'critical'], 'and carries its own shield')
  assert.equal(products.sensitivity, 'critical')
  const settings = rows.find((row) => row.id === 'settings')
  assert.ok(settings?.lines.some((line) => line.text === `+ ${en.perm_short_identity}`), 'an extra Full already covers is still named as its own line')
  assert.equal(rows.find((row) => row.id === 'dashboard')?.lines.length, 1, 'absent -> off on a plain switch is no change: Dashboard lists its level and not an Export line')
  const admin = roleDiff.summarizeRoleChangesByModule({}, { all: true }, tr)
  assert.deepEqual(admin.map((row) => row.kind), ['admin'], 'Administrator on is one row: it covers every module')
  assert.equal(admin[0].sensitivity, 'critical')
})

await runTest('B1 unnamed keys: a key the catalogue cannot name gets a translated label and the key as a tooltip; a named key never does', () => {
  const unnamed = roleDiff.summarizeRoleChangesByModule({ legacy_unknown_key: true }, {}, tr).filter((row) => row.kind === 'other')
  assert.equal(unnamed.length, 1)
  assert.equal(unnamed[0].label, en.role_other_permission, 'the visible label is the translated generic one')
  assert.equal(unnamed[0].hint, 'legacy_unknown_key', 'the stored key is only the tooltip')
  assert.equal(unnamed[0].lines[0].text, `${en.perm_value_on} → ${en.off}`)
  assert.ok(km.role_other_permission && km.role_other_permission !== en.role_other_permission, 'the Khmer pack has its own words for it')
  for (const def of PERMISSION_DEFS) {
    const keys = [def.key, ...actionsForKey(def.key).map((action) => `${def.key}:${action.key}`)]
    for (const key of keys) {
      const rows = roleDiff.summarizeRoleChangesByModule({}, { [key]: key.includes(':') ? false : true }, tr)
      assert.ok(rows.every((row) => row.kind !== 'other'), `${key} is named by its module, never as an unnamed key`)
    }
  }
})

await runTest('B2 the review says it applies right away to the people holding the role, and never says log out', async () => {
  const { page } = await mountPage()
  try {
    const editor = await openEditor(page, 'Employee')
    assert.doesNotMatch(editor.textContent, /log ?out|sign ?out/i, 'the editor carries no log-out note')
    await page.click(labelled(editor, en.role_reset_employee_defaults)[0])
    await page.click(saveButton(page, editor))
    const review = dialogTitled(page, en.role_review_title)
    assert.ok(review)
    assert.ok(review.textContent.includes(fill(en.role_review_applies_now, { n: 2 })), 'Applies right away to 2 people')
    assert.doesNotMatch(review.textContent, /log ?out|sign ?out/i)
  } finally {
    await page.unmount()
  }
  const { page: other } = await mountPage()
  try {
    const editor = await openEditor(other, 'Night cashier')
    await other.click(levelCell(other, 'dashboard', 'full'))
    await other.click(saveButton(other, editor))
    const review = dialogTitled(other, en.role_review_title)
    assert.ok(review && !review.textContent.includes('Applies right away'), 'nobody holds this role, so the note is left out')
  } finally {
    await other.unmount()
  }
})

await runTest('B3 creating a role opens the review first', async () => {
  const { page, calls } = await mountPage()
  try {
    await page.click(page.button(new RegExp(`^${en.create}`)))
    const editor = dialogTitled(page, en.create_role)
    assert.ok(editor, 'the create form opens')
    assert.equal(propsOf(saveButton(page, editor)).disabled, true, 'Save is off while the name is empty')
    await page.type(page.field('role_name'), 'Shift lead')
    await page.click(levelCell(page, 'pos', 'full'))
    await page.click(saveButton(page, editor))
    const review = dialogTitled(page, en.role_review_title)
    assert.equal(calls.creates.length, 0, 'nothing is written before the admin confirms')
    assert.ok(review, 'Save opens the review')
    assert.ok(review.textContent.includes('Shift lead') && review.textContent.includes(en.perm_section_pos), 'it names the role and the module')
    await page.click(saveButton(page, review), { until: () => calls.creates.length === 1, waitingFor: 'the create call' })
    assert.equal(calls.creates.length, 1)
    assert.equal(calls.creates[0].name, 'Shift lead')
    assert.deepEqual(calls.creates[0].permissions, { pos: true })
  } finally {
    await page.unmount()
  }
})

await runTest('B4 the footer counts changes, Save is off at zero, Discard asks before it puts the saved role back', async () => {
  const { page, calls } = await mountPage()
  try {
    const editor = await openEditor(page, 'Night cashier')
    assert.equal(footerCount(editor), countText(0), 'nothing changed yet')
    assert.equal(propsOf(saveButton(page, editor)).disabled, true, 'Save is off at 0 changes')
    const discard = labelled(editor, en.discard_changes)[0]
    assert.ok(discard && discard.textContent.trim() === '', 'Discard is icon-only, named by its label')
    assert.equal(propsOf(discard).disabled, true, 'and off at 0 changes')
    for (const id of ['dashboard', 'products', 'sales']) await page.click(levelCell(page, id, 'full'))
    assert.equal(footerCount(editor), countText(3), '3 changes')
    const save = saveButton(page, editor)
    assert.equal(propsOf(save).disabled, false)
    assert.ok(save.querySelector('svg') && save.textContent.trim() === en.save, 'Save keeps an icon and one word')
    await page.click(discard)
    const prompt = dialogTitled(page, en.unsaved_changes_title)
    assert.ok(prompt, 'Discard asks "Discard unsaved changes?"')
    await page.click(page.button(new RegExp(`^${en.back}$`), prompt))
    assert.equal(footerCount(editor), countText(3), 'Back keeps every edit')
    await page.click(discard)
    await page.click(page.button(new RegExp(`^${en.discard}$`), dialogTitled(page, en.unsaved_changes_title)!))
    assert.equal(footerCount(editor), countText(0), 'Discard puts the saved role back')
    assert.ok(dialogTitled(page, `${en.edit_role}: Night cashier`), 'and the editor stays open')
    assert.equal(calls.updates.length, 0)
    await page.click(levelCell(page, 'dashboard', 'full'))
    await page.click(saveButton(page, editor))
    const review = dialogs(page).find((dialog) => dialog.querySelector('h2')?.textContent.startsWith(en.role_review_title))
    assert.ok(review && review.querySelectorAll('dt').length === 1, 'the review lists the one change')
  } finally {
    await page.unmount()
  }
})

// ---------------------------------------------------------------------------------------------------- the list

await runTest('B5 the Roles search filters roles and does not borrow the Users search', async () => {
  const { page } = await mountPage()
  try {
    assert.equal(page.field('roles_search').getAttribute('placeholder'), en.role_search_placeholder)
    await page.type(page.field('roles_search'), 'night')
    assert.ok(page.text().includes('Night cashier') && !page.text().includes('Employee'), 'only the matching role stays')
    await page.type(page.field('roles_search'), 'zzz')
    assert.ok(!page.text().includes('Night cashier') && page.text().includes(en.no_data), 'no match says so')
    await page.click(page.button(new RegExp(`^${en.users}$`)))
    assert.equal(propsOf(page.field('users_search')).value, '', 'the Users search is untouched')
  } finally {
    await page.unmount()
  }
})

await runTest('B6 Delete is off, with its reason as the tooltip, while people still hold the role', async () => {
  const { page, calls } = await mountPage()
  try {
    const reason = fill(en.role_delete_blocked, { n: 2 })
    const blocked = labelled(cardOf(page, 'Employee'), reason)[0]
    assert.ok(blocked, 'the Employee card offers a Delete that names why it is off')
    assert.equal(propsOf(blocked).disabled, true)
    assert.equal(blocked.getAttribute('title'), reason)
    const free = labelled(cardOf(page, 'Night cashier'), en.delete)[0]
    assert.ok(free && propsOf(free).disabled !== true, 'an unassigned role can be deleted')
    assert.equal(free.textContent.trim(), '', 'Delete is icon-only')
    assert.equal(labelled(cardOf(page, 'Admin'), en.delete).length, 0, 'the system role has no Delete at all')
    assert.equal(calls.deletes.length, 0)
  } finally {
    await page.unmount()
  }
})

await runTest('B7 the seeded Employee is Default, the admin role is Admin, a custom role has no badge', async () => {
  const { page } = await mountPage()
  try {
    const badges = (name: string) => cardOf(page, name).querySelectorAll('span').filter((node) => node.getAttribute('class')?.includes('badge') === true).map((node) => node.textContent)
    assert.deepEqual(badges('Employee'), [en.default_label])
    assert.deepEqual(badges('Admin'), [en.role_admin_badge])
    assert.deepEqual(badges('Night cashier'), [])
    assert.ok(!page.text().includes(en.custom_role) && !page.text().includes(en.system_role), 'the old Custom / System badges are gone')
  } finally {
    await page.unmount()
  }
})

await runTest('B8 a role row carries a spelled-out level strip, no sentence and no key chips; the people count opens Users filtered', async () => {
  const { page } = await mountPage()
  try {
    const card = cardOf(page, 'Employee')
    const stripOf = (scope: MemoryNode) => scope.querySelectorAll('[role=img]').find((node) => (node.getAttribute('aria-label') ?? '').startsWith(`${en.label_full_access} `))
    assert.equal(stripOf(card)?.getAttribute('aria-label'), fill(en.role_tier_strip_aria, { full: 3, review: 0, view: 0, off: 1 }))
    assert.equal(stripOf(cardOf(page, 'Admin'))?.getAttribute('aria-label'), fill(en.role_tier_strip_aria, { full: MODULE_ROWS.filter((row) => !row.sub).length, review: 0, view: 0, off: 0 }))
    // Every visible segment names its own level, so the strip needs no legend; a level nobody holds is left out.
    assert.equal(stripOf(card)?.textContent, `${en.label_full_access} 3${en.off} 1`, 'Employee: "Full 3" and "Off 1", with no Review or View segment')
    assert.equal(stripOf(cardOf(page, 'Admin'))?.textContent, `${en.label_full_access} ${MODULE_ROWS.filter((row) => !row.sub).length}`, 'Admin: Full only, no Off segment')
    assert.ok(!card.textContent.includes(en.perm_pos) && !card.textContent.includes('Show brands'), 'no key chips')
    assert.ok(!page.text().includes(en.no_permissions), 'no summary sentence')
    await page.click(labelled(card, fill(en.role_people_count, { n: 2 }))[0])
    const text = page.text()
    assert.ok(text.includes('Mia Chan') && text.includes('Sok Dara') && !text.includes('Rith Boss'), 'Users, narrowed to the role')
  } finally {
    await page.unmount()
  }
})

await runTest('B13 Create hugs its icon and word at the right edge; History, the search and Create share one row from 768px', async () => {
  const { page } = await mountPage()
  try {
    const create = page.find((node) => node.tagName === 'BUTTON' && node.getAttribute('title') === en.create_role, 'the Create button')
    const classes = (create.getAttribute('class') ?? '').split(' ')
    assert.ok(!classes.includes('flex-1') && !classes.includes('w-full') && !classes.includes('grow'), 'Create does not stretch')
    assert.ok(classes.includes('shrink-0') && classes.includes('ml-auto'), 'it keeps its own width and sits at the right edge')
    assert.ok(create.textContent.trim() === en.create, 'icon plus the one word')
    const input = page.find((node) => node.getAttribute('id') === 'roles-search', 'the role search')
    const group = input.parentNode?.parentNode as MemoryNode
    assert.ok(group && group.parentNode === create.parentNode, 'History, the search and Create are siblings of one row')
    const groupClasses = (group.getAttribute('class') ?? '').split(' ')
    assert.ok(groupClasses.includes('md:flex-1') && groupClasses.includes('w-full'), 'the search takes the rest of the row from 768px and a line of its own below it')
    const history = create.parentNode?.querySelectorAll('button').find((node) => node.getAttribute('title') === en.history)
    assert.ok(history, 'History is on the same row')
    let slot: MemoryNode | null = history.parentNode
    while (slot && slot.parentNode !== create.parentNode) slot = slot.parentNode
    assert.ok(slot && (slot.getAttribute('class') ?? '').split(' ').includes('w-auto'), 'History hugs its content too')
  } finally {
    await page.unmount()
  }
})

// ---------------------------------------------------------------------------------------------------- user detail

await runTest('B9 an Employee in user detail is a few module lines, no "Switched off" chips, icon-only resets', async () => {
  const surface = await harness.mount({
    component: 'components/users/UserDetailSheet.tsx',
    props: {
      user: { id: 7, name: 'Dara', username: 'dara', role_id: 2, is_active: 1, otp_enabled: 1, permissions: '{}' },
      roles: [{ id: 2, name: 'Employee', permissions: JSON.stringify(DEFAULT_ROLE_PERMISSIONS.employee) }],
      canManage: true,
      canRecoverOtp: true,
      onRecoverOtp: () => {},
      onResetPw: () => {},
      onEdit: () => {},
      t: (key: string) => en[key],
    },
    app: { t: (key: string) => en[key] },
    doubles: {},
  })
  try {
    const lines = surface.findAll((node) => node.tagName === 'LI')
    assert.ok(lines.length >= 4 && lines.length <= 8, `${lines.length} module lines for an Employee`)
    assert.doesNotMatch(surface.text(), /Switched off/i)
    const reset = surface.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === en.reset_password)[0]
    assert.ok(reset && reset.textContent.trim() === '' && reset.getAttribute('title') === en.reset_password, 'Reset password is icon-only with a tooltip')
    const twoFactor = surface.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === en.reset_2fa)[0]
    assert.ok(twoFactor && twoFactor.textContent.trim() === '', 'so is Reset 2FA')
    const edit = surface.button(new RegExp(`^${en.edit}$`))
    assert.ok(edit.querySelector('svg'), 'Edit is the main action: icon and word')
    await surface.render({ user: { id: 7, name: 'Dara', username: 'dara', role_id: 1, is_active: 1, permissions: '{}' }, roles: [{ id: 1, name: 'Admin', permissions: '{"all":true}' }], canManage: true, t: (key: string) => en[key] })
    assert.equal(surface.findAll((node) => node.tagName === 'LI').length, 0, 'an Administrator is one chip, not a list')
    assert.ok(surface.text().includes(en.full_access))
  } finally {
    await surface.unmount()
  }
})

// ---------------------------------------------------------------------------------------------------- history, minimize

await runTest('B10 undo labels are translated: no hard-coded English template, keys in both packs', () => {
  assert.doesNotMatch(usersSource, /label: `(Edit|Add|Delete) (role|user) \$\{/, 'no English template literal builds a history label')
  for (const key of ['role_history_edit', 'role_history_add', 'role_history_delete', 'user_history_edit']) {
    assert.match(usersSource, new RegExp(`tr\\('${key}'`), `${key} labels the entry`)
    assert.ok(en[key].includes('{name}') && km[key].includes('{name}'), `${key} carries the name in both packs`)
    assert.match(km[key], /[ក-៿]/, `${key}: Khmer, not an English placeholder`)
  }
  for (const key of ['affected_users_logout_warning', 'users_assigned_count', 'role_preset_label', 'perm_switched_off_heading']) {
    assert.equal(key in en || key in km, false, `${key} is retired from both packs`)
    assert.equal(usersSource.includes(key), false, `${key} has no caller left`)
  }
})

await runTest('B11 the role editor minimizes to a chip with its draft and comes back from it', async () => {
  assert.match(usersSource, /onMinimize=\{canMinimizeRoleForm \? preserveRoleForm : undefined\}/, 'the modal supplies a draft-preserving minimize')
  assert.match(usersSource, /headerExtra=\{canMinimizeRoleForm \? <MinimizeButton/, 'with the shared MinimizeButton beside the close')
  const { page } = await mountPage()
  let chip: Record<string, unknown> | undefined
  try {
    const editor = await openEditor(page, 'Night cashier')
    await page.click(levelCell(page, 'dashboard', 'full'))
    const minimize = labelled(editor, en.minimize)[0]
    assert.ok(minimize, 'the header carries a Minimize beside the close')
    await page.click(minimize)
    assert.equal(dialogTitled(page, `${en.edit_role}: Night cashier`), undefined, 'the editor closes')
    const registryKey = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) as string).find((key) => key.includes('minimized_work'))
    assert.ok(registryKey, 'a chip is parked')
    const parked = JSON.parse(localStorage.getItem(registryKey) as string).data as Array<Record<string, unknown>>
    chip = parked.find((entry) => entry.kind === 'role_form')
    assert.ok(chip, 'the chip is a role_form')
    assert.deepEqual(chip.payload, { roleId: 3 })
    assert.equal(chip.pageId, 'settings')
    const draft = JSON.parse(localStorage.getItem(chip.draftKey as string) as string).data
    assert.deepEqual(draft, { name: 'Night cashier', permissions: { pos: true, dashboard: true } }, 'the draft is stored with it')
  } finally {
    await page.unmount()
  }
  // The chip's restore reaches the page the way the tray does: pending until the page mounts (utils/minimizedWork.ts).
  // React keeps `key` out of props, and the pending path never reads it.
  const restorable = Object.fromEntries(Object.entries(chip!).filter(([name]) => name !== 'key'))
  const restorer = await harness.mount({ component: 'utils/minimizedWork.ts', exportName: 'dispatchRestore', props: restorable, app: {}, doubles: {} })
  await restorer.unmount()
  const { page: back } = await mountPage()
  try {
    const editor = await back.waitFor(() => dialogTitled(back, `${en.edit_role}: Night cashier`) !== undefined, 'the restored editor').then(() => dialogTitled(back, `${en.edit_role}: Night cashier`)!)
    assert.equal(footerCount(editor), countText(1), 'the draft is back: one change against the saved role')
    assert.equal(localStorage.getItem(chip!.draftKey as string), null, 'and the stored draft is cleared once it is in the editor')
  } finally {
    await back.unmount()
  }
})

await runTest('B12 the Khmer role list and review use Khmer words, with room for the glyphs', async () => {
  const { page } = await mountPage({ language: km })
  try {
    const card = cardOf(page, 'Employee')
    assert.ok(card.textContent.includes(km.default_label), 'Default badge in Khmer')
    assert.ok(card.textContent.includes(`${km.label_full_access} 3`) && card.textContent.includes(`${km.off} 1`), 'the level strip reads in Khmer words')
    const editor = await (async () => { await page.click(labelled(card, km.edit)[0]); return dialogTitled(page, `${km.edit_role}: Employee`)! })()
    await page.click(labelled(editor, km.role_reset_employee_defaults)[0])
    assert.ok(footerCount(editor).includes('ការផ្លាស់ប្ដូរ'), 'the footer count reads in Khmer')
    await page.click(page.button(new RegExp(`^${km.save}`), editor))
    const review = dialogTitled(page, km.role_review_title)
    assert.ok(review, 'the review opens')
    assert.ok(review.textContent.includes(`${km.label_full_access} → ${km.none}`), 'level words in Khmer')
    assert.ok(review.textContent.includes(km.role_other_permission), 'the unnamed key reads in Khmer')
    assert.ok(!/[A-Za-z]{4,}/.test(review.textContent.replace(/Employee/g, '')), 'no English word leaks into the Khmer review, the stored key included')
  } finally {
    await page.unmount()
  }
})

await harness.close()
if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1) }
console.log('\nrolesListAndReview: all checks passed')
