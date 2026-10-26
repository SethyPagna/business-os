// PERMISSION-UI-HIDING#128 + S4-21#149 (lane 6.0.987).
//
// A role without contacts:add / contacts:edit must not be offered Add or Edit on
// the Customers, Suppliers and Delivery tabs, the Worker must refuse the write
// anyway, and the POS quick-add modal must ask before throwing away typed work
// (and only then).
//
// Run: node tests/contactAddEditGates.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { effectivePermissions } from '../src/utils/permissions.ts'
import { stableSnapshot, isDirtySince } from '../src/utils/formDirty.ts'
import { applyCloseGuardEvent } from '../src/utils/closeGuard.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

function workerModule(relative: string): any {
  const compiled = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  new Function('exports', compiled)(module.exports)
  return module.exports
}
const worker = workerModule('../../cloudflare/src/lib/permissions.ts')

// ---- 1. The permission model the tabs read, against the Worker's ----------
const role = (map: Record<string, unknown>) => ({ role_code: 'employee', role_permissions: JSON.stringify(map), permissions: '{}' })
const viewOnly = role({ contacts: true, 'contacts:add': false, 'contacts:edit': false })
const addOnly = role({ contacts: true, 'contacts:edit': false })
const editOnly = role({ contacts: true, 'contacts:add': false })
for (const [name, user, add, edit] of [
  ['view only', viewOnly, false, false],
  ['add only', addOnly, true, false],
  ['edit only', editOnly, false, true],
] as const) {
  const can = effectivePermissions(user).can
  assert.equal(can('contacts', 'add'), add, `${name}: frontend add`)
  assert.equal(can('contacts', 'edit'), edit, `${name}: frontend edit`)
  assert.equal(worker.getActionTier(user, 'contacts', 'add') !== 'none', add, `${name}: Worker add agrees`)
  assert.equal(worker.getActionTier(user, 'contacts', 'edit') !== 'none', edit, `${name}: Worker edit agrees`)
}
// Owner rule (30 Sep): Add and Edit imply View, so a write-only role still reaches the tab.
const writeOnly = role({ contacts: true, 'contacts:view': false })
assert.equal(effectivePermissions(writeOnly).can('contacts', 'view'), true)
assert.equal(worker.getActionTier(writeOnly, 'contacts', 'view') !== 'none', true)
console.log('PASS frontend can() and Worker getActionTier agree for view-only, add-only and edit-only roles')

// ---- 2. Each tab withholds Add and Edit ------------------------------------
const tabs = ['CustomersTab.tsx', 'SuppliersTab.tsx', 'DeliveryTab.tsx']
for (const file of tabs) {
  const source = read(`../src/components/contacts/${file}`)
  assert.match(source, /const canAddContact = can\('contacts', 'add'\)/, `${file} reads contacts.add`)
  assert.match(source, /const canEditContact = can\('contacts', 'edit'\)/, `${file} reads contacts.edit`)
  // The header Add button sits inside the add gate.
  assert.match(source, /\{canAddContact \? \(\s*<button[^]*?<Plus className="h-4 w-4 shrink-0" \/>[^]*?<\/button>\s*\) : null\}/, `${file} renders the Add button only with contacts.add`)
  assert.equal((source.match(/setSelected\(null\); setModal\('form'\)/g) || []).length, 1, `${file} has exactly one Add entry point, and it is the gated button`)
  // Both Edit entry points (row menu, detail float) take an undefined handler without edit.
  assert.match(source, /<ThreeDotMenu[^\n]*onEdit=\{canEditContact \? \(\) => \{[^\n]*\} : undefined\}/, `${file} row menu omits Edit without contacts.edit`)
  assert.match(source, /onEdit=\{canEditContact \? \(\) => setModal\('form'\) : undefined\}/, `${file} detail float omits Edit without contacts.edit`)
  assert.doesNotMatch(source, /onEdit=\{\(\) =>/, `${file} has no ungated Edit handler`)
  // Revocation while a form is open: the form refuses to stay mounted.
  assert.match(source, /modal === 'form' && \(selected \? canEditContact : canAddContact\)/, `${file} mounts the form only for the matching action`)
}
const shared = read('../src/components/contacts/shared.tsx')
assert.match(shared, /\{onEdit \? <button[^\n]*onClick=\{onEdit\}>/, 'DetailModal draws Edit only when handed an edit handler')
assert.match(shared, /\{onDelete \? <button[^\n]*onClick=\{onDelete\}>/, 'DetailModal draws Delete only when handed a delete handler')
const menu = shared.slice(shared.indexOf('export function ThreeDotMenu'))
assert.match(menu, /onEdit && \{ label:/, 'ThreeDotMenu drops Edit when no handler is passed')
console.log('PASS Customers, Suppliers and Delivery withhold Add and Edit without the action, at every entry point')

// ---- 3. The Worker refuses those writes regardless of the UI --------------
const contacts = read('../../cloudflare/src/routes/contacts.ts')
function routeHead(signature: string): string {
  const start = contacts.indexOf(signature)
  assert.ok(start >= 0, `route ${signature} exists`)
  return contacts.slice(start, contacts.indexOf('await c.req.json', start))
}
assert.match(routeHead('app.post(config.path, async (c)'), /getActionTier\(user, 'contacts', 'add'\) === 'none'[^]*?403/, 'POST (create) is refused without contacts.add before the body is read')
assert.match(routeHead('app.put(`${config.path}/:id`, async (c)'), /getActionTier\(user, 'contacts', 'edit'\) === 'none'[^]*?403/, 'PUT (update) is refused without contacts.edit before the body is read')
// Router-wide: no contacts section at all is a 403 on every method and path.
assert.match(contacts, /if \(getPermissionTier\(user, 'contacts'\) === 'none'\) return c\.json\(\{ error: 'You do not have permission/, 'the router-wide gate refuses a role with no contacts access')
// Inventory of every contact write route. A new one fails here until someone
// decides which action gates it, so Add/Edit cannot quietly gain a bypass.
const writeRoutes = [...contacts.matchAll(/^\s*app\.(post|put|patch|delete)\(([^,]+),/gm)].map((m) => `${m[1].toUpperCase()} ${m[2].trim()}`).sort()
assert.deepEqual(writeRoutes, [
  'DELETE `${config.path}/:id`',
  'POST \'/customers/:id/points\'',
  'POST \'/customers/link-conflicts/dismiss\'',
  'POST \'/customers/link-conflicts/relink\'',
  'POST \'/customers/link-conflicts/resolve-missing\'',
  'POST \'/customers/link-conflicts/undismiss\'',
  'POST `${config.path}/:id/portal-reset`',
  'POST `${config.path}/bulk-delete-jobs/:id/cancel`',
  'POST `${config.path}/bulk-delete-jobs`',
  'POST `${config.path}/duplicates/dismiss`',
  'POST `${config.path}/duplicates/undismiss`',
  'POST `${config.path}/merge`',
  'POST `/customers/gender-restoration/${operation}`',
  'POST config.path',
  'PUT `${config.path}/:id`',
].sort(), 'the set of contact write routes changed -- decide its gate, then update this list')
console.log('PASS Worker refuses create without contacts.add and update without contacts.edit; write-route inventory pinned')

// ---- 4. QuickAddModal guard (S4-21#149) -----------------------------------
const quickAdd = read('../src/components/pos/QuickAddModal.tsx')
const posModals = read('../src/components/pos/POSQuickAddModals.tsx')
assert.match(quickAdd, /formValue: unknown/, 'formValue is a required prop, so no caller can ship an unguarded quick-add')
assert.match(quickAdd, /const \{ dirty \} = useFormDirty\(formValue\)/)
assert.match(quickAdd, /useCloseGuard\(\{ dirty \}, onClose\)/)
assert.equal((quickAdd.match(/onClick=\{requestClose\}/g) || []).length, 2, 'the X and Cancel both take the guarded close')
assert.doesNotMatch(quickAdd, /onClick=\{onClose\}/, 'no control bypasses the guard')
assert.match(quickAdd, /<UnsavedChangesPrompt guard=\{guard\} \/>/, 'the prompt is rendered, or a dirty modal could never be closed')
assert.equal((posModals.match(/formValue=\{new(?:Customer|Delivery)Form\}/g) || []).length, 2, 'customer and delivery quick-adds both pass their form')
assert.doesNotMatch(posModals, /<UnsavedChangesPrompt/, 'the prompt has one home, in the shell')

// Drive the real guard with the real dirty rule: clean closes straight through,
// dirty prompts with Back / Discard and no close, Back keeps the edits,
// Discard closes.
function session(form: unknown) {
  const baseline = stableSnapshot({ name: '', phone: '', address: '', membership_number: '' })
  const state = { closed: 0, prompt: false }
  const event = (name: 'close-requested' | 'back' | 'discard-confirmed') => applyCloseGuardEvent({
    event: name,
    declaration: { dirty: isDirtySince(baseline, form) },
    setPromptOpen: (open: boolean) => { state.prompt = open },
    onClose: () => { state.closed += 1 },
  })
  return { state, event }
}
const clean = session({ name: '', phone: '', address: '', membership_number: '' })
assert.equal(clean.event('close-requested'), 'closed')
assert.deepEqual(clean.state, { closed: 1, prompt: false }, 'untouched form closes without a prompt')
const dirty = session({ name: 'x', phone: '', address: '', membership_number: '' })
assert.equal(dirty.event('close-requested'), 'prompted')
assert.deepEqual(dirty.state, { closed: 0, prompt: true }, 'typed form prompts and stays open')
dirty.event('back')
assert.deepEqual(dirty.state, { closed: 0, prompt: false }, 'Back returns to the form')
dirty.event('close-requested')
dirty.event('discard-confirmed')
assert.deepEqual(dirty.state, { closed: 1, prompt: false }, 'Discard closes')
console.log('PASS QuickAddModal guard prompts only when the form is dirty; Back keeps edits, Discard closes')

// The prompt itself: title only, Discard and Back, no body text.
const prompt = read('../src/components/shared/UnsavedChangesPrompt.tsx')
assert.match(prompt, /unsaved_changes_title', 'Discard unsaved changes\?'/)
console.log('PASS prompt wording unchanged: "Discard unsaved changes?"')
