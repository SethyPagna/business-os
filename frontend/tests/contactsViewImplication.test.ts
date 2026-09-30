// Contacts: Add and Edit imply View (owner, 30 Sep 2026). The Worker enforces it in
// isActionBlocked (cloudflare/src/lib/permissions.ts); the frontend permission
// helpers and the role editor must say the same thing, or a menu offers a page
// the Worker refuses (or hides one it serves).
//
// Run: node tests/contactsViewImplication.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { effectivePermissions } from '../src/utils/permissions.ts'
import { isActionOverriddenOff, isViewImpliedByWrite, toggleActionOverrideMap } from '../src/utils/permissionActions.ts'

function workerModule(relative: string): any {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  new Function('exports', compiled)(module.exports)
  return module.exports
}
const worker = workerModule('../../cloudflare/src/lib/permissions.ts')

const absent = Symbol('absent')
const switches = [absent, false, true]
let cases = 0
for (const tier of [true, 'review', false] as const) {
  for (const view of switches) for (const add of switches) for (const edit of switches) {
    const map: Record<string, unknown> = { contacts: tier }
    if (view !== absent) map['contacts:view'] = view
    if (add !== absent) map['contacts:add'] = add
    if (edit !== absent) map['contacts:edit'] = edit
    const user = { role_code: 'employee', role_permissions: JSON.stringify(map), permissions: '{}' }
    const authority = effectivePermissions(user)
    for (const action of ['view', 'add', 'edit']) {
      const frontend = authority.can('contacts', action)
      const backend = worker.getActionTier(user, 'contacts', action) !== 'none'
      assert.equal(frontend, backend, `frontend and Worker disagree on contacts:${action} for ${JSON.stringify(map)}`)
    }
    if (tier !== false) {
      const anyWrite = add !== false || edit !== false
      assert.equal(authority.can('contacts', 'view'), anyWrite || view !== false, `View expectation for ${JSON.stringify(map)}`)
    }
    cases += 1
  }
}
console.log(`PASS frontend can() and Worker getActionTier agree on ${cases} contacts override combinations`)

const off = { contacts: true, 'contacts:view': false }
assert.equal(isActionOverriddenOff(off, 'contacts', 'view'), false, 'a stored View-off is inert while Add and Edit are on')
assert.equal(isActionOverriddenOff({ ...off, 'contacts:add': false }, 'contacts', 'view'), false, 'Edit alone keeps View')
assert.equal(isActionOverriddenOff({ ...off, 'contacts:edit': false }, 'contacts', 'view'), false, 'Add alone keeps View')
assert.equal(isActionOverriddenOff({ ...off, 'contacts:add': false, 'contacts:edit': false }, 'contacts', 'view'), true)
assert.equal(isActionOverriddenOff({ products: true, 'products:view': false }, 'products', 'view'), true, 'other sections are untouched')
assert.equal(isViewImpliedByWrite({ contacts: true }, 'contacts', 'view'), true)
assert.equal(isViewImpliedByWrite({ contacts: true }, 'contacts', 'add'), false)
assert.equal(isViewImpliedByWrite({ contacts: true, 'contacts:add': false, 'contacts:edit': false }, 'contacts', 'view'), false)
console.log('PASS override reads: View is implied by Add or Edit for contacts only')

const start = { contacts: true } as Record<string, unknown>
assert.equal(toggleActionOverrideMap(start, 'contacts', 'view'), start, 'switching View off is refused (same object) while Add and Edit are on')
const noAdd = toggleActionOverrideMap(start, 'contacts', 'add')
assert.deepEqual(noAdd, { contacts: true, 'contacts:add': false })
assert.equal(toggleActionOverrideMap(noAdd, 'contacts', 'view'), noAdd, 'Edit still on: View stays locked')
const noWrites = toggleActionOverrideMap(noAdd, 'contacts', 'edit')
assert.deepEqual(noWrites, { contacts: true, 'contacts:add': false, 'contacts:edit': false })
const viewOff = toggleActionOverrideMap(noWrites, 'contacts', 'view')
assert.deepEqual(viewOff, { contacts: true, 'contacts:add': false, 'contacts:edit': false, 'contacts:view': false }, 'with both writes off View can be switched off')
const editBack = toggleActionOverrideMap(viewOff, 'contacts', 'edit')
assert.deepEqual(editBack, { contacts: true, 'contacts:add': false }, 'handing Edit back clears the stale View switch-off')
assert.equal(effectivePermissions({ role_permissions: editBack }).can('contacts', 'view'), true)
assert.deepEqual(toggleActionOverrideMap({ products: true }, 'products', 'view'), { products: true, 'products:view': false }, 'other sections toggle View freely')
assert.deepEqual(toggleActionOverrideMap({ contacts: true, 'contacts:delete': false }, 'contacts', 'delete'), { contacts: true }, 'handing an action back deletes the key')
console.log('PASS role editor toggles: View refused while Add/Edit on, released when both are off, stale switch-off cleared')

const editor = readFileSync(new URL('../src/components/users/PermissionEditor.tsx', import.meta.url), 'utf8')
assert.match(editor, /toggleActionOverrideMap\(perms, permissionKey, actionKey\)/, 'the editor toggles through the shared helper')
assert.match(editor, /if \(toggled === perms\) return/, 'a refused toggle does not call onChange')
assert.match(editor, /const viewLocked = tierOutcome !== 'block' && isViewImpliedByWrite\(/, 'the View row locks only when the tier offers it')
assert.match(editor, /disabled=\{!canToggle\}/)
assert.match(editor, /viewLocked\s*\?\s*translate\('perm_view_implied'/, 'the locked row carries the tooltip')
const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))
for (const key of ['perm_view_implied', 'perm_act_contacts_edit']) {
  assert.ok(en[key] && km[key], `${key} exists in both packs`)
  assert.notEqual(en[key], km[key], `${key} is translated`)
}
console.log('PASS role editor wiring and both language packs')
