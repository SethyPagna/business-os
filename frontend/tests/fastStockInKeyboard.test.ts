import assert from 'node:assert/strict'
import { act } from 'react'
import { createHarness, propsOf, MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'

const queryAll = MemoryNode.prototype.querySelectorAll
const rects = MemoryNode.prototype.getClientRects
MemoryNode.prototype.querySelectorAll = function (selector: string): MemoryNode[] {
  return [...new Set(selector.split(',').flatMap(part => {
    const excluded = [...part.matchAll(/:not\(([^)]+)\)/g)].map(match => match[1])
    const simple = part.replace(/:not\([^)]+\)/g, '').trim()
    return queryAll.call(this, simple).filter(node => !excluded.some(value => node.matches(value)))
  }))]
}
MemoryNode.prototype.getClientRects = function (): unknown[] { return this.isConnected ? [{}] : [] }
const harness = await createHarness()
type KeyListener = (event: KeyboardEvent) => void
const listeners = new Set<KeyListener>()
const add = document.addEventListener
const remove = document.removeEventListener
document.addEventListener = ((type: string, listener: KeyListener) => { if (type === 'keydown') listeners.add(listener) }) as typeof add
document.removeEventListener = ((type: string, listener: KeyListener) => { if (type === 'keydown') listeners.delete(listener) }) as typeof remove
const product = { id: 1, name: 'Keyboard fixture', stock_quantity: 10, selling_price_usd: 12, cost_price_usd: 4, branch_stock: [{ branch_id: 1, quantity: 10 }] }
const field = (surface: MountedSurface, label: string): MemoryNode => surface.find(node => node.tagName === 'INPUT' && node.getAttribute('aria-label') === label, label)
async function press(surface: MountedSurface, key: string, shiftKey = false): Promise<void> {
  const event = { key, shiftKey, target: document.activeElement, defaultPrevented: false, preventDefault(this: { defaultPrevented: boolean }) { this.defaultPrevented = true }, stopPropagation() {} } as unknown as KeyboardEvent
  await act(async () => { for (const listener of [...listeners]) listener(event) })
  await surface.settle()
}
async function mount(mode: string, onClose: () => void, extraProps: Record<string, unknown> = {}, commit?: (...args: unknown[]) => Promise<never>): Promise<MountedSurface> {
  localStorage.clear()
  return harness.mount({
    component: 'components/inventory/FastStockInModal.tsx',
    props: { tr: (key: string, fallback?: string) => fallback ?? key, notify() {}, onClose, onDone() {}, initialMode: mode, initialProduct: product, branchOptions: [{ value: '1', label: 'Fixture branch' }], defaultBranchId: '1', initialHeader: { supplier: { supplierId: 4, supplierName: 'Fixture supplier' } }, ...extraProps },
    app: { user: { id: 3, username: 'fixture', role_code: 'admin' }, t: (key: string) => key, can: () => true, notify() {}, usdSymbol: '$', exchangeRate: 4100 },
    doubles: { 'api/batchesTransport.ts': { getProductBatches: async () => ({ batches: [{ id: 11, quantity: 10, received_at: '2026-10-15', supplier_id: 4, supplier_name: 'Fixture supplier' }] }) }, 'api/methods.ts': { getProductFilters: async () => ({ brands: [] }) }, 'api/productSearchIndex.ts': { useProductSearchIndex: () => 0 }, 'api/inventoryWriteTransport.ts': { getInventoryReasons: async () => ({}), ...(commit ? { commitFastStockIn: commit } : {}) } },
  })
}
try {
  for (const mode of ['add', 'remove', 'set']) {
    let closed = 0
    const surface = await mount(mode, () => { closed += 1 })
    const panel = surface.find(node => node.getAttribute('role') === 'dialog', 'actual session dialog')
    const body = surface.find(node => node.className.includes('modal-scroll'), 'actual scroll body')
    assert.equal(body.getAttribute('role'), 'region', `${mode}: keyboard scroll target is named`)
    assert.equal(body.getAttribute('tabindex'), '0')
    assert.equal(body.getAttribute('aria-label'), panel.getAttribute('aria-label'))
    assert.ok(panel.contains(document.activeElement as unknown as MemoryNode), `${mode}: opening focus stays inside`)
    const controls = panel.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
    controls.at(-1)!.focus()
    await press(surface, 'Tab')
    assert.equal(document.activeElement, controls[0] as unknown)
    await press(surface, 'Tab', true)
    assert.equal(document.activeElement, controls.at(-1) as unknown)
    await surface.type(field(surface, mode === 'set' ? 'Set to' : 'Qty'), '2')
    await press(surface, 'Escape')
    assert.equal(closed, 0, `${mode}: dirty Escape cannot discard the draft`)
    assert.ok(surface.findAll(node => node.getAttribute('data-unsaved-actions') != null).length === 1)
    await press(surface, 'Escape')
    assert.equal(surface.findAll(node => node.getAttribute('data-unsaved-actions') != null).length, 0, `${mode}: prompt Escape returns to the unchanged session`)
    assert.equal(closed, 0)
    assert.ok(panel.contains(document.activeElement as unknown as MemoryNode), `${mode}: prompt dismissal returns keyboard focus inside`)
    await press(surface, 'Escape')
    await surface.click(surface.button('Discard'))
    assert.equal(closed, 1, `${mode}: only explicit Discard closes dirty work`)
    assert.equal(propsOf(body).tabIndex, 0)
    await surface.unmount()
  }
  let closed = 0
  const requests: unknown[][] = []
  let failCommit: ((error: Error) => void) | undefined
  const pending = await mount('remove', () => { closed += 1 }, { initialProduct: null, initialLines: [{ product, quantity: 2 }] }, (...args: unknown[]) => {
    requests.push(args)
    return new Promise<never>((_resolve, reject) => { failCommit = reject })
  })
  await pending.click(pending.button('Next'))
  await pending.click(pending.button('Complete Session'), { until: () => requests.length === 1 })
  await press(pending, 'Escape')
  assert.equal(closed, 0, 'an in-flight commit cannot be closed by Escape')
  assert.equal(pending.findAll(node => node.getAttribute('data-unsaved-actions') != null).length, 0)
  assert.equal(propsOf(pending.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'Close', 'busy Close')).disabled, true)
  await act(async () => { failCommit!(new Error('Synthetic lost acknowledgement')) })
  await pending.settle()
  const firstRequest = JSON.stringify(requests[0][0])
  await press(pending, 'Escape')
  assert.equal(closed, 0, 'unknown outcome remains guarded work')
  assert.equal(pending.findAll(node => node.getAttribute('data-unsaved-actions') != null).length, 1)
  await press(pending, 'Escape')
  assert.ok(pending.text().includes('Keyboard fixture'), 'returning from the prompt retains the retry line')
  await pending.click(pending.button('Next'))
  await pending.click(pending.button('Complete Session'), { until: () => requests.length === 2 })
  assert.equal(JSON.stringify(requests[1][0]), firstRequest, 'keyboard dismissal never changes the frozen retry request')
  await act(async () => { failCommit!(new Error('Synthetic repeated lost acknowledgement')) })
  await pending.settle()
  await pending.unmount()
  console.log('PASS actual Add/Remove/Set keyboard containment and guarded Escape; prompt dismissal preserves drafts')
} finally {
  document.addEventListener = add
  document.removeEventListener = remove
  await harness.close()
  MemoryNode.prototype.querySelectorAll = queryAll
  MemoryNode.prototype.getClientRects = rects
}
