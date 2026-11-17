import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'
import type { InventoryCheckProduct } from '../src/types/inventoryChecks.ts'

// Inventory redesign, slice C1 review L8 (17 Nov 2026): the whole Inventory row opens the product and is a focus stop (tabIndex 0, Enter), but it had no name, so a screen reader said nothing
// useful on it. Both row lists (the count list and the in-session sheet) now give the row its name, "Open product: <name>" in the viewer's language, and its key (Enter). The row must NOT become
// role="button" / a link: it holds real buttons and inputs, and an interactive role may not contain another one (nested-interactive). So this file pins both halves, on both lists:
//   1. the row names what it does, in English and in Khmer, with the product's own name
//   2. no nested interactive: no interactive element (button, a, input, select, textarea, or an interactive role) has an interactive ancestor inside the row
//   3. the inner controls stay reachable: the status / count controls are still tab stops, and the image button (a duplicate target) is not

const pack = (name: string) => JSON.parse(readFileSync(new URL(`../src/lang/${name}.json`, import.meta.url), 'utf8')) as Record<string, string>
const en = pack('en'), km = pack('km')
const harness = await createHarness({})
const live: MountedSurface[] = []
const track = async (surface: Promise<MountedSurface>) => { const mounted = await surface; live.push(mounted); return mounted }
const translator = (lang: Record<string, string>) => (key: string) => lang[key] ?? key

const listed: InventoryCheckProduct[] = [
  { id: 501, name: 'Listed ok', quantity: 8, unit: 'pcs', barcode: '885000501', check_status: 'ok', check_counted_quantity: 8, check_by: 'amy', check_at: '2026-10-30T08:15:00.000Z' },
  { id: 504, name: 'ទឹកអប់ក្លិនផ្កាម្លិះ', quantity: 9, check_status: 'not_checked' },
]
const sheet: InventoryCheckProduct[] = [{ id: 11, name: 'Sheet variant', quantity: 3, sku: 'VARIANT-11' }, { id: 12, name: 'ក្រែមលាបមុខ', quantity: 7, barcode: 'VARIANT-12' }]
const mountList = (lang: Record<string, string>) => track(harness.mount({ component: 'components/inventory/InventoryCheckListRows.tsx',
  props: { products: listed, drafts: {}, selecting: true, canViewStock: true, canViewCounts: true, t: translator(lang), onOpenProduct: () => {}, onCount: () => {}, onChecked: () => {}, onNote: () => {}, onToggle: () => {} }, app: {}, doubles: {} }))
const mountSheet = (lang: Record<string, string>) => track(harness.mount({ component: 'components/inventory/InventoryCheckRows.tsx',
  props: { products: sheet, observations: {}, pending: {}, errors: {}, canCheck: true, t: translator(lang), onOpenProduct: () => {}, onSave: async () => {} }, app: {}, doubles: {} }))

const INTERACTIVE_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'textbox', 'combobox', 'listbox', 'slider', 'spinbutton', 'tab', 'menuitem', 'option', 'searchbox'])
const isInteractive = (node: MemoryNode) => ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(node.tagName) && !(node.tagName === 'A' && node.getAttribute('href') === null) || INTERACTIVE_ROLES.has(node.getAttribute('role') ?? '')
const rowsOf = (surface: MountedSurface) => surface.findAll(node => node.getAttribute('data-inventory-check-row') !== null)

function descendants(row: MemoryNode): MemoryNode[] {
  const all: MemoryNode[] = []
  const walk = (node: MemoryNode) => { for (const child of node.children) { all.push(child); walk(child) } }
  walk(row)
  return all
}
function nestedInteractive(row: MemoryNode): string[] {
  const found: string[] = []
  for (const node of descendants(row).filter(isInteractive)) {
    for (let up: MemoryNode | null = node.parentElement; up && up !== row.parentElement; up = up.parentElement) {
      if (isInteractive(up)) found.push(`${node.tagName.toLowerCase()}${node.getAttribute('data-check-action') ? `[${node.getAttribute('data-check-action')}]` : ''} inside ${up.tagName.toLowerCase()}${up.getAttribute('role') ? `[role=${up.getAttribute('role')}]` : ''}`)
    }
  }
  return found
}

const cases: Array<[string, () => Promise<void>]> = [
  ['the count list: each row is named "Open product: <name>" in English and Khmer, keeps Enter, and is a list item (never a button)', async () => {
    for (const [lang, word] of [[en, en.open_product], [km, km.open_product]] as const) {
      const s = await mountList(lang)
      const rows = rowsOf(s)
      assert.equal(rows.length, listed.length)
      rows.forEach((row, index) => {
        assert.equal(row.tagName, 'LI')
        assert.equal(row.getAttribute('aria-label'), `${word}: ${listed[index].name}`, 'the name says what the row does, with the product')
        assert.equal(row.getAttribute('aria-keyshortcuts'), 'Enter')
        assert.equal(row.getAttribute('tabindex') ?? row.getAttribute('tabIndex'), '0', 'still a focus stop')
        assert.ok(!['button', 'link'].includes(row.getAttribute('role') ?? ''), 'not an interactive role: the row contains real controls')
      })
      await s.unmount()
    }
    assert.ok(km.open_product && km.open_product !== en.open_product && /[ក-៿]/.test(km.open_product), 'the Khmer word is real Khmer, not English')
  }],
  ['the in-session sheet: the same name, key and role', async () => {
    for (const [lang, word] of [[en, en.open_product], [km, km.open_product]] as const) {
      const s = await mountSheet(lang)
      const rows = rowsOf(s)
      assert.equal(rows.length, sheet.length)
      rows.forEach((row, index) => {
        assert.equal(row.getAttribute('aria-label'), `${word}: ${sheet[index].name}`)
        assert.equal(row.getAttribute('aria-keyshortcuts'), 'Enter')
        assert.ok(!['button', 'link'].includes(row.getAttribute('role') ?? ''))
      })
      await s.unmount()
    }
  }],
  ['no nested interactive on either list: nothing interactive sits inside an interactive element of the row', async () => {
    for (const mount of [mountList, mountSheet]) {
      const s = await mount(en)
      for (const row of rowsOf(s)) {
        const inner = descendants(row).filter(isInteractive)
        assert.ok(inner.length >= 2, `control: the row has its own buttons and inputs (${inner.length}), so a button role on the row would nest them`)
        assert.deepEqual(nestedInteractive(row), [], `row ${row.getAttribute('data-inventory-check-row')}`)
      }
      await s.unmount()
    }
    // The checker is not blind: a button that holds a button is found.
    const probe = await track(harness.mount({ component: 'components/inventory/InventoryCheckListRows.tsx', props: { products: [], drafts: {}, selecting: false, canViewStock: true, canViewCounts: true, t: translator(en), onOpenProduct: () => {} }, app: {}, doubles: {} }))
    const doc = probe.body.ownerDocument
    const outer = doc.createElement('li'); const asButton = doc.createElement('div'); asButton.setAttribute('role', 'button'); const inner = doc.createElement('button')
    asButton.appendChild(inner); outer.appendChild(asButton)
    assert.equal(nestedInteractive(outer as unknown as MemoryNode).length, 1, 'positive control: a role=button wrapper around a button is reported')
  }],
  ['the inner controls stay reachable: status and count are tab stops; the image button is not (the row itself is)', async () => {
    const s = await mountList(en)
    for (const row of rowsOf(s)) {
      const status = row.querySelectorAll('[data-check-action="status"]')
      assert.equal(status.length, 1)
      assert.notEqual(status[0].getAttribute('tabindex'), '-1', 'the status button is reachable by keyboard')
      const count = row.querySelectorAll('[data-check-count]')
      assert.equal(count.length, 1)
      assert.notEqual(count[0].getAttribute('tabindex'), '-1', 'so is the count input')
      assert.equal(row.querySelectorAll('[data-check-image]')[0].getAttribute('tabindex'), '-1', 'the image button is a second way to the same action: out of the tab order')
    }
  }],
]

const failures: string[] = []
try {
  for (const [name, run] of cases) {
    try { await run() } catch (cause) { failures.push(`${name}\n    ${(cause instanceof Error ? cause.message : String(cause)).split('\n').slice(0, 6).join(' | ')}`) } finally { for (const surface of live.splice(0)) await surface.unmount() }
  }
} finally { await harness.close() }
if (failures.length) throw new Error(`${failures.length} of ${cases.length} row accessibility cases failed:\n  - ${failures.join('\n  - ')}`)
console.log(`inventoryCheckRowAccessibility passed: ${cases.length} cases (named rows en + km, Enter, no nested interactive, controls reachable)`)
