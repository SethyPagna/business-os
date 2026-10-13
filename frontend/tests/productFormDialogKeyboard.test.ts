import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { act } from 'react'
import ts from 'typescript'
import { createHarness, MemoryNode, propsOf, type MountedSurface } from './mountedComponentHarness.ts'

// Daily-use A item 6. The product form is the longest-lived dialog in the app
// and had no keyboard contract: Escape did nothing, Tab walked out of it into
// the page behind, and focus was not handed back on close. This runs the real
// ProductForm: Escape goes through the close guard (a pristine form closes, a
// dirty one asks first, a second Escape dismisses the ask), Tab wraps inside
// the panel, focus moves in on open and returns to the opener, and a child
// dialog that is open ABOVE the form (the save review) keeps the Escape for
// itself instead of closing the form underneath it.

const words = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const harness = await createHarness({ observe: ['api/methods.ts'] })

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
const realQuerySelectorAll = MemoryNode.prototype.querySelectorAll
MemoryNode.prototype.querySelectorAll = function (this: MemoryNode, selector: string): MemoryNode[] {
  if (selector !== FOCUSABLE) return realQuerySelectorAll.call(this, selector)
  const found: MemoryNode[] = []
  const visit = (node: MemoryNode): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === 1 && ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(child.tagName) && !propsOf(child).disabled) found.push(child)
      visit(child)
    }
  }
  visit(this)
  return found
}

type KeyListener = (event: Record<string, unknown>) => void
const keyListeners = new Set<KeyListener>()
const realAddListener = document.addEventListener
const realRemoveListener = document.removeEventListener
document.addEventListener = ((type: string, listener: KeyListener) => { if (type === 'keydown') keyListeners.add(listener) }) as typeof document.addEventListener
document.removeEventListener = ((type: string, listener: KeyListener) => { if (type === 'keydown') keyListeners.delete(listener) }) as typeof document.removeEventListener
async function press(key: string, shiftKey = false): Promise<{ defaultPrevented: boolean }> {
  const event = { key, shiftKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
  await act(async () => { for (const listener of [...keyListeners]) listener(event) })
  return event
}
const active = (): unknown => document.activeElement

let closes = 0
async function mountForm(): Promise<MountedSurface> {
  localStorage.clear()
  closes = 0
  const user = { id: 42, organization_id: 1, organization_public_id: 'org-1', role_code: 'admin', role_permissions: { all: true } }
  const app = { user, page: 'products', t: (key: string) => words[key] || '', notify() {}, settings: {}, formatDateTime: String }
  return harness.mount({
    component: 'components/products/forms/ProductForm.tsx',
    props: {
      product: null, categories: [], units: [], branches: [], user, t: (key: string) => words[key] || '', usdSymbol: '$', khrSymbol: '៛', exchangeRate: 4100,
      onClose() { closes += 1 }, onSave: async () => undefined,
    },
    app,
    doubles: { 'api/methods.ts': { searchProducts: async () => ({ items: [] }), getProductFilters: async () => ({ categories: [], brands: [] }) } },
  })
}
const dialogOf = (surface: MountedSurface): MemoryNode => surface.find((node) => node.getAttribute('role') === 'dialog' && node.textContent.includes('Basic Info'), 'the product form dialog')
const focusablesOf = (surface: MountedSurface): MemoryNode[] => dialogOf(surface).querySelectorAll(FOCUSABLE)

try {
{
  const opener = document.createElement('button')
  document.body.appendChild(opener)
  opener.focus()
  const surface = await mountForm()
  const focusables = focusablesOf(surface)
  assert.ok(focusables.length > 6, 'the form has controls to trap focus between')
  assert.ok(dialogOf(surface).contains(active() as MemoryNode), 'focus moves into the dialog when it opens')
  assert.ok(active() === focusables[0], 'and lands on its first control, a button, so a phone keyboard stays down')

  await act(async () => { (active() as MemoryNode).blur() })
  ;(document as unknown as { activeElement: unknown }).activeElement = focusables.at(-1)
  assert.equal((await press('Tab')).defaultPrevented, true, 'Tab on the last control is caught')
  assert.ok(active() === focusables[0], 'and wraps to the first')
  assert.equal((await press('Tab', true)).defaultPrevented, true, 'Shift+Tab on the first control is caught')
  assert.ok(active() === focusables.at(-1), 'and wraps to the last')
  ;(document as unknown as { activeElement: unknown }).activeElement = focusables[3]
  assert.equal((await press('Tab')).defaultPrevented, false, 'Tab between inner controls is left to the browser')

  const escape = await press('Escape')
  assert.equal(escape.defaultPrevented, true, 'Escape is handled by the dialog')
  assert.equal(closes, 1, 'Escape closes a pristine form through the close guard')
  await surface.unmount()
  assert.ok(active() === opener, 'closing hands focus back to what opened the form')
}

{
  const surface = await mountForm()
  await surface.type(surface.find((node) => node.id === 'product-name', 'name'), 'Probe serum')
  await press('Escape')
  assert.equal(closes, 0, 'a form with typed work does not close on the first Escape')
  assert.ok(surface.text().includes(words.unsaved_changes_title), 'it asks before discarding')
  await press('Escape')
  assert.equal(closes, 0, 'a second Escape dismisses the question and keeps the form')
  assert.ok(!surface.text().includes(words.unsaved_changes_title), 'the question is gone')
  assert.equal(surface.find((node) => node.id === 'product-name', 'name').getAttribute('value') ?? String(propsOf(surface.find((node) => node.id === 'product-name', 'name')).value), 'Probe serum', 'the typed name survived')
  await surface.unmount()
}

{
  const surface = await mountForm()
  await surface.type(surface.find((node) => node.id === 'product-name', 'name'), 'Probe serum')
  await surface.click(surface.find((node) => node.tagName === 'BUTTON' && node.className.includes('btn-primary') && node.textContent === words.save, 'Save'))
  assert.ok(surface.text().includes('Selling price'), 'the save review is open above the form')
  await press('Escape')
  assert.equal(closes, 0, 'Escape does not close the form underneath the save review')
  assert.ok(!surface.text().includes(words.unsaved_changes_title), 'and does not ask to discard it')
  assert.ok(surface.text().includes('Selling price'), 'the save review is still there')
  await surface.unmount()
}

console.log('PASS the product form dialog closes on Escape through its guard, traps Tab, restores focus, and yields Escape to a dialog above it')
} finally {
  MemoryNode.prototype.querySelectorAll = realQuerySelectorAll
  document.addEventListener = realAddListener
  document.removeEventListener = realRemoveListener
  await harness.close()
}

const source = readFileSync(new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url), 'utf8')
const file = ts.createSourceFile('ProductForm.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const modals: Array<{ title: string; keyboard: boolean }> = []
const visit = (node: ts.Node): void => {
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(file) === 'Modal') {
    const names = node.attributes.properties.filter(ts.isJsxAttribute).map((attribute) => attribute.name.getText(file))
    const title = node.attributes.properties.filter(ts.isJsxAttribute).find((attribute) => attribute.name.getText(file) === 'title')?.initializer?.getText(file) ?? ''
    modals.push({ title: title.slice(0, 40), keyboard: names.includes('keyboard') })
  }
  ts.forEachChild(node, visit)
}
visit(file)
assert.equal(modals.length, 3, 'the form owns three Modals: itself, the name-match verdict and the name unlock')
assert.deepEqual(modals.filter((modal) => !modal.keyboard), [], 'every Modal this file renders opts into the keyboard contract')
console.log('PASS the form and its two small child dialogs opt into Modal keyboard')

