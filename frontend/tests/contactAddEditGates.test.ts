// PERMISSION-UI-HIDING#128 + S4-21#149 (lane 6.0.987, with the review fixes).
//
// A role without contacts:add / contacts:edit must not be offered Add or Edit on the Customers, Suppliers and
// Delivery tabs, the POS rider quick-add, the sale-link "Create contact" or Import; the Worker must refuse the
// write anyway; and the POS quick-add modal must ask before throwing away typed work (and only then).
//
// Where a control is a small real component (DetailModal, QuickAddModal, POSQuickAddModals) it is loaded and
// driven here, not pattern-matched. The three tabs are far too large to mount in node, so their gate is one tiny
// helper (contacts/contactWriteAccess.ts) that is tested by behaviour, plus exact-line checks that each tab takes
// the helper's answer unmodified.
//
// Run: node tests/contactAddEditGates.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import ts from 'typescript'
import { effectivePermissions } from '../src/utils/permissions.ts'
import { contactWriteAccess, isContactFormAllowed } from '../src/components/contacts/contactWriteAccess.ts'

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
for (const [name, user, add, edit] of [
  ['view only', viewOnly, false, false],
  ['add only', addOnly, true, false],
  ['edit only', editOnly, false, true],
] as const) {
  const access = contactWriteAccess(effectivePermissions(user).can)
  assert.deepEqual(access, { canAdd: add, canEdit: edit }, `${name}: tab access`)
  assert.equal(isContactFormAllowed(access, null), add, `${name}: a new-contact form`)
  assert.equal(isContactFormAllowed(access, { id: 1 }), edit, `${name}: an edit form`)
}

// Each tab takes the helper's answer unmodified (nothing OR-ed in) and every entry point sits behind it.
const tabs = ['CustomersTab.tsx', 'SuppliersTab.tsx', 'DeliveryTab.tsx']
for (const file of tabs) {
  const source = read(`../src/components/contacts/${file}`)
  assert.match(source, /^ {2}const contactWrite = contactWriteAccess\(can\)$/m, `${file} derives access from can() only`)
  assert.match(source, /^ {2}const \{ canAdd: canAddContact, canEdit: canEditContact \} = contactWrite$/m, `${file} takes add and edit unmodified`)
  assert.match(source, /\{canAddContact \? \(\s*<button[^]*?<Plus className="h-4 w-4 shrink-0" \/>[^]*?<\/button>\s*\) : null\}/, `${file} renders the Add button only with contacts.add`)
  assert.equal((source.match(/setSelected\(null\); setModal\('form'\)/g) || []).length, 1, `${file} has exactly one Add entry point, and it is the gated button`)
  assert.match(source, /<ThreeDotMenu[^\n]*onEdit=\{canEditContact \? \(\) => \{[^\n]*\} : undefined\}/, `${file} row menu omits Edit without contacts.edit`)
  assert.match(source, /onEdit=\{canEditContact \? \(\) => setModal\('form'\) : undefined\}/, `${file} detail float omits Edit without contacts.edit`)
  assert.doesNotMatch(source, /onEdit=\{\(\) =>/, `${file} has no ungated Edit handler`)
  assert.match(source, /\{modal === 'form' && isContactFormAllowed\(contactWrite, selected\) (?:\? \(\s*<Suspense|\? <SupplierForm|&& <DeliveryForm)/, `${file} mounts the form only through the decision, with nothing OR-ed in`)
  assert.match(source, /const canImportContacts = canBulkContacts && can\('contacts', 'import'\) && \(canAddContact \|\| canEditContact\)/, `${file} offers Import to a role that can add or edit, and to no other`)
}

// A tiny runner that loads a real source file with React's hooks replaced by a per-instance slot store, so a
// function component can be called directly and its returned element tree inspected.
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const { renderToStaticMarkup } = nodeRequire('react-dom/server')
const stub: any = new Proxy(function stubFn() { return null }, { get: (_t, key) => (key === '__esModule' ? true : stub), apply: () => null })
type Store = { slots: any[]; index: number }
function fakeReactFor(store: Store) {
  const slot = (make: () => any): any => { if (store.index >= store.slots.length) store.slots.push(make()); return store.slots[store.index++] }
  return {
    ...React,
    useState: (initial: unknown) => {
      const cell = slot(() => ({ value: typeof initial === 'function' ? (initial as () => unknown)() : initial }))
      return [cell.value, (next: unknown) => { cell.value = typeof next === 'function' ? (next as (v: unknown) => unknown)(cell.value) : next }]
    },
    useRef: (initial: unknown) => slot(() => ({ current: initial })),
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useEffect: () => {},
    useId: () => 'id',
  }
}
function loadModule(file: string, store: Store, overrides: Record<string, unknown> = {}, cache = new Map<string, any>()): any {
  if (cache.has(file)) return cache.get(file)
  const code = transformSync(readFileSync(file, 'utf8'), { loader: file.endsWith('.tsx') ? 'tsx' : 'ts', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, unknown> }
  cache.set(file, mod.exports)
  const dir = file.replace(/[\\/][^\\/]*$/, '')
  const shim = (id: string): unknown => {
    for (const [needle, value] of Object.entries(overrides)) if (id.includes(needle)) return value
    if (id === 'react') return fakeReactFor(store)
    if (id.startsWith('.')) {
      const resolved = decodeURIComponent(new URL(id, `file:///${dir.replace(/\\/g, '/')}/`).pathname.slice(1))
      const exists = (candidate: string) => { try { readFileSync(candidate); return true } catch { return false } }
      const withExt = /\.tsx?$/.test(resolved) ? resolved : (['.tsx', '.ts'].map((ext) => resolved + ext).find(exists) || resolved)
      return loadModule(withExt, store, overrides, cache)
    }
    if (id.startsWith('lucide-react')) return { __esModule: true, default: stub }
    return nodeRequire(id)
  }
  new Function('require', 'module', 'exports', code)(shim, mod, mod.exports)
  cache.set(file, mod.exports)
  return mod.exports
}

// 2a. DetailModal draws Edit / Delete only when handed a handler.
{
  const modalStub = { __esModule: true, default: ({ children }: any) => React.createElement('div', null, children) }
  const { DetailModal } = loadModule(`${sourceRoot}components/contacts/shared.tsx`, { slots: [], index: 0 }, {
    'shared/Modal': modalStub, AppContext: stub, 'api/': stub, 'utils/': stub, PortalMenu: stub,
  })
  const labels: Record<string, string> = { edit: 'EDIT-LABEL', delete: 'DELETE-LABEL', close: 'CLOSE-LABEL' }
  const render = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(DetailModal, { item: { id: 1, name: 'A' }, fields: [], onClose() {}, t: (key: string) => labels[key], ...props }))
  const full = render({ onEdit() {}, onDelete() {} })
  assert.ok(full.includes('EDIT-LABEL') && full.includes('DELETE-LABEL') && full.includes('CLOSE-LABEL'), 'with handlers the float draws Edit, Delete and Close')
  const noEdit = render({ onDelete() {} })
  assert.ok(!noEdit.includes('EDIT-LABEL') && noEdit.includes('DELETE-LABEL'), 'no edit handler: no Edit button, Delete stays')
  const noDelete = render({ onEdit() {} })
  assert.ok(noDelete.includes('EDIT-LABEL') && !noDelete.includes('DELETE-LABEL'), 'no delete handler: no Delete button, Edit stays')
  const neither = render({})
  assert.ok(!neither.includes('EDIT-LABEL') && !neither.includes('DELETE-LABEL') && neither.includes('CLOSE-LABEL'), 'a read-only role still gets Close')
}
assert.match(read('../src/components/contacts/shared.tsx').split('export function ThreeDotMenu')[1], /onEdit && \{ label:/, 'ThreeDotMenu drops Edit when no handler is passed')
console.log('PASS Customers, Suppliers and Delivery withhold Add and Edit without the action; the real DetailModal renders accordingly')

// 2b. The sibling surfaces: POS rider quick-add, sale-link "Create contact", and Import.
const pos = read('../src/components/pos/POS.tsx')
assert.match(pos, /^ {2}const canAddDeliveryContact = can\('contacts', 'add'\)$/m)
assert.equal((pos.match(/setShowAddDelivery\(true\)/g) || []).length, 2, 'the rider quick-add has exactly two entry points')
assert.equal((pos.match(/\{canAddDeliveryContact \? <button[^\n]*setShowAddDelivery\(true\)[^\n]*<\/button> : null\}/g) || []).length, 2, 'both ("+ New" and "Add one") sit behind the Add switch')
const saleLinks = read('../src/components/contacts/SaleLinkConflictsSection.tsx')
assert.match(saleLinks, /^ {2}const canAddContact = can\('contacts', 'add'\)$/m)
assert.match(saleLinks, /\{canRelinkSales && \(linkExisting \|\| canAddContact\) \? <div className="mt-1\.5">/, 'Create contact needs Add; linking to an existing customer does not')
console.log('PASS POS rider quick-add, sale-link Create contact and Import are gated on Add / Edit')

// ---- 3. The Worker refuses those writes regardless of the UI --------------
const contacts = read('../../cloudflare/src/routes/contacts.ts')
function routeHead(signature: string, until = 'await c.req.json'): string {
  const start = contacts.indexOf(signature)
  assert.ok(start >= 0, `route ${signature} exists`)
  return contacts.slice(start, contacts.indexOf(until, start))
}
assert.match(routeHead('app.post(config.path, async (c)'), /getActionTier\(user, 'contacts', 'add'\) === 'none'[^]*?403/, 'POST (create) is refused without contacts.add before the body is read')
assert.match(routeHead('app.put(`${config.path}/:id`, async (c)'), /getActionTier\(user, 'contacts', 'edit'\) === 'none'[^]*?403/, 'PUT (update) is refused without contacts.edit before the body is read')
// resolve-missing: creating (no target) needs Add, ahead of the duplicate check and the INSERT.
const resolveMissing = contacts.slice(contacts.indexOf("app.post('/customers/link-conflicts/resolve-missing'"))
const createBranch = resolveMissing.slice(resolveMissing.indexOf('} else {'), resolveMissing.indexOf('INSERT INTO customers'))
assert.match(createBranch, /getActionTier\(user, 'contacts', 'add'\) === 'none'\) return c\.json\(\{ error: 'You do not have permission[^\n]*403\)/, 'resolve-missing refuses a create without contacts.add before it inserts')
assert.ok(createBranch.indexOf("'contacts', 'add'") < createBranch.indexOf('checkContactDuplicateBlock'), 'the Add check precedes every create side effect')
assert.doesNotMatch(resolveMissing.slice(0, resolveMissing.indexOf('} else {')), /'contacts', 'add'/, 'linking to an existing customer is not an Add')
// Router-wide: no contacts section at all is a 403 on every method and path.
assert.match(contacts, /if \(getPermissionTier\(user, 'contacts'\) === 'none'\) return c\.json\(\{ error: 'You do not have permission/, 'the router-wide gate refuses a role with no contacts access')
// Inventory of every contact write route. A new one fails here until someone decides which action gates it.
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
// Import: the route needs Add or Edit, and the apply refuses each row it may not write (cloudflare test-contact-import-add-edit-pure.cjs drives the engine).
const importJobs = read('../../cloudflare/src/routes/importJobs.ts')
assert.match(importJobs, /overrideSection === 'contacts' && isActionBlocked\(user, 'contacts', 'add'\) && isActionBlocked\(user, 'contacts', 'edit'\)/, 'the import route refuses a role with neither Add nor Edit')
console.log('PASS Worker refuses create without contacts.add (POST and resolve-missing) and update without contacts.edit; write-route inventory pinned')

// ---- 4. QuickAddModal guard (S4-21#149), the real component driven -------
{
  const store: Store = { slots: [], index: 0 }
  const promptStub = function UnsavedChangesPrompt() { return null }
  const overrides = { UnsavedChangesPrompt: { __esModule: true, default: promptStub } }
  const QuickAddModal = loadModule(`${sourceRoot}components/pos/QuickAddModal.tsx`, store, overrides).default
  const calls = { close: 0, save: 0 }
  const render = (formValue: unknown, extra: Record<string, unknown> = {}) => {
    store.index = 0
    return QuickAddModal({ title: 'T', children: null, onSave: () => { calls.save += 1 }, onClose: () => { calls.close += 1 }, formValue, t: (key: string) => key, ...extra })
  }
  const elements = (tree: unknown): any[] => {
    const out: any[] = []
    const walk = (node: any): void => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(walk); return }
      out.push(node)
      walk(node.props?.children)
    }
    walk(tree)
    return out
  }
  const buttons = (tree: unknown) => elements(tree).filter((el) => el.type === 'button')
  const closeButton = (tree: unknown) => buttons(tree).find((el) => el.props['aria-label'] === 'close')
  const cancelButton = (tree: unknown) => buttons(tree).find((el) => String(el.props.className || '').includes('btn-secondary'))
  const guardOf = (tree: unknown) => elements(tree).find((el) => el.type === promptStub)?.props.guard

  const empty = { name: '', phone: '' }
  render(empty)
  closeButton(render(empty)).props.onClick()
  assert.equal(calls.close, 1, 'X on an untouched form closes without a prompt')
  cancelButton(render(empty)).props.onClick()
  assert.equal(calls.close, 2, 'Cancel on an untouched form closes without a prompt')
  assert.equal(guardOf(render(empty)).promptOpen, false)

  store.slots.length = 0; calls.close = 0
  render(empty)
  const typed = { name: 'x', phone: '' }
  closeButton(render(typed)).props.onClick()
  assert.equal(calls.close, 0, 'X on a typed form must not close')
  assert.equal(guardOf(render(typed)).promptOpen, true, 'the prompt is raised and rendered')
  assert.deepEqual(guardOf(render(typed)).options, ['discard', 'back'], 'Discard and Back, nothing else')
  guardOf(render(typed)).dismissPrompt()
  assert.equal(guardOf(render(typed)).promptOpen, false, 'Back returns to the form')
  assert.equal(calls.close, 0)
  cancelButton(render(typed)).props.onClick()
  assert.equal(calls.close, 0, 'Cancel on a typed form must not close either')
  guardOf(render(typed)).discardAndClose()
  assert.equal(calls.close, 1, 'Discard closes')
  // Typing then clearing is clean again.
  store.slots.length = 0; calls.close = 0
  render(empty); render(typed)
  closeButton(render(empty)).props.onClick()
  assert.equal(calls.close, 1, 'restoring the opening values is clean')

  // No handler anywhere on a dirty quick-add may reach the raw onClose (an extra X handler is a bypass).
  store.slots.length = 0; calls.close = 0
  render(empty)
  for (const el of elements(render(typed))) {
    for (const [name, handler] of Object.entries(el.props || {})) {
      if (/^on[A-Z]/.test(name) && typeof handler === 'function' && name !== 'onChange') (handler as (event?: unknown) => void)({ preventDefault() {}, stopPropagation() {} })
    }
  }
  assert.equal(calls.close, 0, 'no control on a dirty quick-add reaches onClose without the prompt')
  assert.equal(closeButton(render(typed, { saving: true })).props.disabled, true, 'X is disabled while saving')
  assert.equal(cancelButton(render(typed, { saving: true })).props.disabled, true, 'Cancel is disabled while saving')

  // POSQuickAddModals hands EACH quick-add its OWN form.
  const QuickAddStub = function QuickAddModalStub() { return null }
  const POSQuickAddModals = loadModule(`${sourceRoot}components/pos/POSQuickAddModals.tsx`, { slots: [], index: 0 }, {
    './QuickAddModal': { __esModule: true, default: QuickAddStub },
    SavingBlockedNote: stub, phoneInput: stub, contactDuplicates: stub,
  }).default
  const customerForm = { name: 'c', phone: '', address: '', membership_number: '' }
  const deliveryForm = { name: 'd', phone: '', area: '' }
  const noop = () => {}
  const out = POSQuickAddModals({
    closeAddCustomerModal: noop, closeAddDeliveryModal: noop, customerDuplicateCheck: null, deliveryDuplicateCheck: null,
    handleAddCustomer: noop, handleAddDelivery: noop, newCustomerForm: customerForm, newDeliveryForm: deliveryForm,
    savingCustomer: false, savingDelivery: false, setNewCustomerForm: noop, setNewDeliveryForm: noop,
    showAddCustomer: true, showAddDelivery: true, t: (key: string) => key,
  })
  const quickAdds = elements(out).filter((el) => el.type === QuickAddStub)
  assert.equal(quickAdds.length, 2, 'both quick-adds render')
  const byTitle = (title: string) => quickAdds.find((el) => el.props.title === title)
  assert.equal(byTitle('add_new_customer').props.formValue, customerForm, 'the customer quick-add watches the customer form')
  assert.equal(byTitle('add_delivery_contact').props.formValue, deliveryForm, 'the delivery quick-add watches its OWN form, not the customer one')
}
assert.match(read('../src/components/pos/QuickAddModal.tsx'), /formValue: unknown/, 'formValue is a required prop, so no caller can ship an unguarded quick-add')
console.log('PASS QuickAddModal (real component): clean closes, dirty prompts, Back/Discard work, no control bypasses the guard, each quick-add watches its own form')

// The prompt itself: title only, Discard and Back, no body text.
assert.match(read('../src/components/shared/UnsavedChangesPrompt.tsx'), /unsaved_changes_title', 'Discard unsaved changes\?'/)
console.log('PASS prompt wording unchanged: "Discard unsaved changes?"')
