import assert from 'node:assert/strict'
import { createHarness, propsOf, type MemoryNode } from './mountedComponentHarness.ts'

const harness = await createHarness()
const shown = new Set(['status'])
const toggled: string[] = []
let resets = 0
const columns = [
  { key: 'status', label: 'Status', required: true },
  { key: 'cashier', label: 'Cashier', defaultVisible: false },
  { key: 'branch', label: 'Branch', defaultVisible: false },
]
const props = {
  columns,
  isVisible: (key: string) => shown.has(key),
  toggle: (key: string) => { toggled.push(key); if (!shown.delete(key)) shown.add(key) },
  reset: () => { resets += 1 },
  label: 'Columns',
  resetLabel: 'Reset',
}
const surface = await harness.mount({ component: 'components/shared/ColumnChooser.tsx', props, app: {}, doubles: {} })
const key = (name: string) => ({ key: name, preventDefault() {}, stopPropagation() {}, nativeEvent: {} })
const trigger = (): MemoryNode => surface.find((node) => node.tagName === 'BUTTON' && propsOf(node)['aria-haspopup'] === 'menu', 'trigger with aria-haspopup=menu')
const menu = (): MemoryNode => surface.find((node) => propsOf(node).role === 'menu', 'role=menu')
const items = (): MemoryNode[] => surface.findAll((node) => /^menuitem/.test(String(propsOf(node).role ?? '')))
const press = async (name: string) => surface.call(menu(), 'onKeyDown', [key(name)])
try {
  assert.equal(propsOf(trigger())['aria-expanded'], false)
  await surface.click(trigger())
  assert.equal(propsOf(trigger())['aria-expanded'], true)

  const list = items()
  assert.deepEqual(list.map((node) => propsOf(node).role), ['menuitemcheckbox', 'menuitemcheckbox', 'menuitemcheckbox', 'menuitem'], 'columns are checkbox items, reset is a plain menuitem')
  assert.deepEqual(list.slice(0, 3).map((node) => propsOf(node)['aria-checked']), [true, false, false])
  assert.equal(propsOf(list[0])['aria-disabled'], true, 'required column is aria-disabled')
  assert.equal(propsOf(list[1])['aria-disabled'], undefined)
  assert.ok(list.every((node) => String(propsOf(node).className).includes('pointer:coarse')), 'every item has a 44px touch target')
  assert.equal(document.activeElement, list[0], 'opening focuses the first item')

  await press('ArrowDown'); assert.equal(document.activeElement, list[1])
  await press('End'); assert.equal(document.activeElement, list[3])
  await press('ArrowDown'); assert.equal(document.activeElement, list[0], 'ArrowDown wraps')
  await press('ArrowUp'); assert.equal(document.activeElement, list[3], 'ArrowUp wraps')
  await press('Home'); assert.equal(document.activeElement, list[0])

  await surface.call(list[0], 'onKeyDown', [key(' ')])
  assert.deepEqual(toggled, [], 'a required column never toggles')
  await surface.click(list[0])
  assert.deepEqual(toggled, [])
  await surface.call(list[1], 'onKeyDown', [key(' ')])
  await surface.call(list[2], 'onKeyDown', [key('Enter')])
  assert.deepEqual(toggled, ['cashier', 'branch'], 'Space and Enter toggle')
  await surface.render(props)
  assert.deepEqual(items().slice(0, 3).map((node) => propsOf(node)['aria-checked']), [true, true, true], 'aria-checked follows visibility')

  await press('Escape')
  assert.equal(surface.findAll((node) => propsOf(node).role === 'menu').length, 0, 'Escape closes')
  assert.equal(document.activeElement, trigger(), 'Escape returns focus to the trigger')

  await surface.click(trigger()); await press('Tab')
  assert.equal(surface.findAll((node) => propsOf(node).role === 'menu').length, 0, 'Tab closes')

  await surface.click(trigger())
  await surface.call(items()[3], 'onKeyDown', [key('Enter')])
  assert.equal(resets, 1, 'reset menuitem activates from the keyboard')
  assert.equal(surface.findAll((node) => propsOf(node).role === 'menu').length, 0)
  assert.ok(trigger().textContent.includes('Columns (3/3)') || trigger().textContent.includes('Columns'), 'accessible name kept')
  console.log('PASS ColumnChooser mounted: aria roles, roving keys, required disabled, Esc/Tab, reset')
} finally {
  await harness.close()
}
