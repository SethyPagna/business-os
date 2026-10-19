import assert from 'node:assert/strict'
import * as dirtyWork from '../src/utils/dirtyWork.ts'
import { createHarness, propsOf, type MountedSurface } from './mountedComponentHarness.ts'
import type { InventoryCheckProduct, InventoryCheckObservation, InventoryCheckPatch } from '../src/types/inventoryChecks.ts'

const products: InventoryCheckProduct[] = [
  { id: 10, name: 'Synthetic family', quantity: 7, is_group: true },
  { id: 11, parent_id: 10, name: 'Synthetic small variant', quantity: 0, sku: 'VARIANT-11', selling_price_usd: 192.75, cost_price_usd: 87.25, qty_sold: 3 },
  { id: 12, parent_id: 10, name: 'Synthetic large variant', quantity: 7, barcode: 'VARIANT-12', damaged_quantity: 1, customer_count: 2 },
]
const originalProducts = JSON.stringify(products)
const calls: Array<{ productId: number | string; patch: InventoryCheckPatch; revision: number }> = []
const harness = await createHarness({ observe: ['utils/dirtyWork.ts'] })
let rejectSave = false
const base = {
  products, observations: {} as Record<string, InventoryCheckObservation>, pending: {}, errors: {},
  canCheck: true, canViewPrice: false, canViewCost: false, t: (key: string) => key,
  onOpenProduct: (product: InventoryCheckProduct) => { opened.push(product.id) },
  onSave: async (productId: number | string, patch: InventoryCheckPatch, revision: number) => {
    calls.push({ productId, patch, revision })
    if (rejectSave) throw new Error('synthetic save refusal')
  },
}
const opened: Array<number | string> = []
const row = (surface: MountedSurface, id: number) => surface.find(node => node.getAttribute('data-inventory-check-row') === String(id), `row ${id}`)
const state = (surface: MountedSurface, id: number) => surface.find(node => node.getAttribute('data-check-status') === String(id), `status ${id}`).textContent
const mount = (props: Record<string, unknown> = {}) => harness.mount({ component: 'components/inventory/InventoryCheckRows.tsx', props: { ...base, ...props }, app: {}, doubles: { 'utils/dirtyWork.ts': dirtyWork } })
try {
  const surface = await mount()
  assert.equal(state(surface, 11), 'Not started')
  assert.equal(surface.findAll(node => node.tagName === 'BUTTON' && node.getAttribute('data-check-action') === 'done').length, 2, 'a family header cannot be checked instead of its two real variants')
  assert.ok(!surface.text().includes('192.75') && !surface.text().includes('87.25'), 'denied price/cost values are absent')
  await surface.click(surface.button('Mark done', row(surface, 11)))
  assert.deepEqual(calls.at(-1), { productId: 11, patch: { state: 'done', counted_quantity: null, reason: null }, revision: 0 })
  assert.equal(state(surface, 11), 'Not started', 'a callback does not create fake optimistic completion')
  const done = { product_id: 11, state: 'done', counted_quantity: 0, reason: null, revision: 3 } satisfies InventoryCheckObservation
  await surface.render({ ...base, observations: { 11: done }, canViewPrice: true, canViewCost: true })
  assert.equal(state(surface, 11), 'Done')
  assert.ok(row(surface, 11).textContent.includes('Counted: 0'), 'checked zero is visible and distinct from unstarted')
  assert.ok(surface.text().includes('192.75') && surface.text().includes('87.25'), 'explicit grants expose their own values')
  await surface.click(surface.button('Clear check', row(surface, 11)))
  assert.deepEqual(calls.at(-1), { productId: 11, patch: { state: 'unstarted', counted_quantity: null, reason: null }, revision: 3 })
  await surface.click(surface.button('Synthetic small variant', row(surface, 11)))
  assert.deepEqual(opened, [11], 'details use the real variant identity')
  await surface.unmount()

  const issue = { product_id: 12, state: 'issue', counted_quantity: null, reason: 'Old reason', revision: 2 } satisfies InventoryCheckObservation
  const editor = await mount({ observations: { 12: issue } })
  await editor.click(editor.button('Edit issue', row(editor, 12)))
  const beforeTyping = calls.length
  await editor.type(editor.field('inventory-check-count-12'), '0')
  await editor.type(editor.field('inventory-check-reason-12'), 'Shelf mismatch')
  assert.equal(calls.length, beforeTyping, 'typing never autosaves or blurs the quantity field')
  assert.equal(propsOf(editor.field('inventory-check-count-12')).inputMode, 'decimal')
  rejectSave = true
  await editor.click(editor.button('Save issue', row(editor, 12)))
  assert.deepEqual(calls.at(-1), { productId: 12, patch: { state: 'issue', counted_quantity: 0, reason: 'Shelf mismatch' }, revision: 2 })
  assert.equal(propsOf(editor.field('inventory-check-count-12')).value, '0')
  assert.equal(propsOf(editor.field('inventory-check-reason-12')).value, 'Shelf mismatch', 'failed save retains the full draft')
  assert.ok(row(editor, 12).textContent.includes('Check not saved'))
  rejectSave = false
  await editor.click(editor.button('Retry', row(editor, 12)))
  assert.equal(calls.at(-1)?.revision, 2, 'retry retains the captured revision rather than silently rebasing a stale draft')
  await editor.render({ ...base, observations: { 12: { ...issue, counted_quantity: 0, reason: 'Shelf mismatch', revision: 3 } } })
  assert.equal(editor.findAll(node => node.getAttribute('id') === 'inventory-check-count-12').length, 0, 'an acknowledged new observation closes the editor')
  await editor.click(editor.button('Edit issue', row(editor, 12)))
  await editor.type(editor.field('inventory-check-count-12'), '')
  await editor.type(editor.field('inventory-check-reason-12'), 'Reason without a count')
  await editor.click(editor.button('Save issue', row(editor, 12)))
  assert.equal(calls.at(-1)?.patch.counted_quantity, null, 'empty optional count remains null, never zero')
  await editor.unmount()

  for (const invalid of ['-1', 'NaN', 'Infinity', '1e999', '0x10', 'abc']) {
    const invalidEditor = await mount()
    await invalidEditor.click(invalidEditor.button('Report issue', row(invalidEditor, 12)))
    await invalidEditor.type(invalidEditor.field('inventory-check-count-12'), invalid)
    await invalidEditor.type(invalidEditor.field('inventory-check-reason-12'), 'Synthetic reason')
    const prior = calls.length
    await invalidEditor.click(invalidEditor.button('Save issue', row(invalidEditor, 12)))
    assert.equal(calls.length, prior, `${invalid} is refused before a save callback`)
    assert.ok(row(invalidEditor, 12).textContent.includes('Enter a valid non-negative quantity'))
    await invalidEditor.unmount()
  }
  const reason = await mount()
  await reason.click(reason.button('Report issue', row(reason, 12)))
  await reason.type(reason.field('inventory-check-reason-12'), '   ')
  const beforeReason = calls.length
  await reason.click(reason.button('Save issue', row(reason, 12)))
  assert.equal(calls.length, beforeReason, 'one issue requires a nonblank reason')
  await reason.click(reason.button('Cancel', row(reason, 12)))
  assert.equal(reason.findAll(node => node.getAttribute('id') === 'inventory-check-count-12').length, 0)
  assert.equal(calls.length, beforeReason, 'Cancel never saves')
  await reason.unmount()

  const pending = await mount({ pending: { 11: true }, errors: { 12: 'Synthetic conflict; reload this check' } })
  assert.equal(propsOf(pending.button('Mark done', row(pending, 11))).disabled, true)
  assert.ok(row(pending, 11).textContent.includes('Saving'))
  assert.ok(row(pending, 12).textContent.includes('Synthetic conflict'))
  await pending.unmount()

  const staleEditor = await mount({ observations: { 12: issue } })
  await staleEditor.click(staleEditor.button('Edit issue', row(staleEditor, 12)))
  await staleEditor.type(staleEditor.field('inventory-check-reason-12'), 'Own unsaved reason')
  await staleEditor.render({ ...base, observations: { 12: { ...issue, reason: 'Another checker reason', revision: 8 } } })
  await staleEditor.click(staleEditor.button('Save issue', row(staleEditor, 12)))
  assert.equal(calls.at(-1)?.revision, 2, 'an arriving observation cannot silently rebase an existing draft')
  assert.equal(calls.at(-1)?.patch.reason, 'Own unsaved reason')
  await staleEditor.render({ ...base, observations: { 12: issue }, canCheck: false })
  assert.equal(staleEditor.findAll(node => node.getAttribute('id') === 'inventory-check-reason-12').length, 0, 'revocation closes the editing surface')
  await staleEditor.render({ ...base, observations: { 12: issue } })
  await staleEditor.click(staleEditor.button('Edit issue', row(staleEditor, 12)))
  assert.equal(propsOf(staleEditor.field('inventory-check-reason-12')).value, 'Old reason', 'restored access does not restore a revoked unsaved draft')
  await staleEditor.unmount()

  let acknowledge: (() => void) | undefined
  const waiting = new Promise<void>(resolve => { acknowledge = resolve })
  const deferred = await mount({ onSave: async () => { await waiting } })
  await deferred.click(deferred.button('Mark done', row(deferred, 11)))
  assert.equal(state(deferred, 11), 'Not started')
  assert.equal(propsOf(deferred.button('Mark done', row(deferred, 11))).disabled, true, 'in-flight callbacks disable duplicate actions without parent optimism')
  acknowledge?.()
  await deferred.settle()
  assert.equal(state(deferred, 11), 'Not started', 'even an acknowledged callback waits for the controlled observation')
  await deferred.unmount()

  const longName = 'សាកល្បងឈ្មោះផលិតផលវែង '.repeat(16)
  const denied = await mount({ products: [{ ...products[1], name: longName }], canCheck: false,
    t: (key: string) => key === 'inventory_check_unstarted' ? 'មិនទាន់ចាប់ផ្តើម' : key })
  assert.equal(denied.findAll(node => node.getAttribute('data-check-action') != null).length, 0)
  assert.ok(denied.text().includes(longName) && denied.text().includes('មិនទាន់ចាប់ផ្តើម'))
  const name = denied.find(node => node.className.includes('product-name-rail'), 'shared long-name rail')
  assert.equal((propsOf(name).style as Record<string, unknown>).overflowWrap, 'anywhere')
  assert.ok(!denied.text().includes('192.75') && !denied.text().includes('87.25'))
  await denied.unmount()
  const mismatched = await mount({ observations: { 11: issue } })
  assert.equal(state(mismatched, 11), 'Not started', 'an observation with another real-product ID cannot mark this variant')
  await mismatched.unmount()
  const implicitHeader = await mount({ products: [{ ...products[0], is_group: undefined }, products[1], products[2]] })
  assert.equal(implicitHeader.findAll(node => node.getAttribute('data-check-action') === 'done').length, 2, 'real member relationships identify headers without trusting optional display flags')
  await implicitHeader.unmount()
  const formatCalls: number[] = []
  const money = await mount({ products: [{ ...products[1], selling_price_usd: 0, cost_price_usd: null }], canViewPrice: true, canViewCost: true,
    fmtUSD: (value: number) => { formatCalls.push(value); return `APP[${value}]` } })
  assert.deepEqual(formatCalls, [0], 'only genuine known money reaches the app formatter; unknown cost never becomes zero')
  assert.ok(money.text().includes('Price: APP[0]') && money.text().includes('Cost: —'))
  await money.render({ ...base, products: [products[1]], fmtUSD: () => { throw new Error('denied money must not be formatted') } })
  assert.ok(!money.text().includes('Price:') && !money.text().includes('Cost:'))
  await money.unmount()
  const blind = await mount({ products: [{ id: 91, name: 'Synthetic blind check', quantity: 4444, damaged_quantity: 3333 }],
    canViewStock: false, observations: { 91: { product_id: 91, state: 'done', counted_quantity: 0, reason: null, revision: 1, baseline_quantity: 2222 } } })
  assert.ok(!blind.text().includes('Stock:') && !blind.text().includes('Damaged:') && !blind.text().includes('4444') && !blind.text().includes('3333') && !blind.text().includes('2222'), 'blind checks hide stock, damage and baseline without deriving mismatch signals')
  assert.ok(blind.text().includes('Counted: 0'), 'the checker can still read their own observation metadata')
  await blind.click(blind.button('Clear check', row(blind, 91)))
  assert.equal(calls.at(-1)?.productId, 91, 'blind stock permission does not disable metadata checks')
  await blind.render({ ...base, products: [{ id: 91, name: 'Synthetic omitted stock' }] })
  assert.ok(blind.text().includes('Stock: —') && !blind.text().includes('Stock: 0') && !blind.text().includes('Sold:') && !blind.text().includes('Customers:'), 'absent stock/metrics never become fabricated zeros')
  await blind.unmount()
  const headerOnly = await mount({ products: [{ id: 92, name: 'Filtered family header', is_group: true, checkable: false }] })
  assert.equal(headerOnly.findAll(node => node.getAttribute('data-check-action') === 'done').length, 0, 'server-ineligible family headers cannot be checked when every child is filtered out')
  await headerOnly.unmount()
  const drift = await mount({ products: [{ id: 93, name: 'Changed stock', quantity: 2 }], observations: { 93: { product_id: 93, state: 'done', counted_quantity: null, reason: null, revision: 1, baseline_quantity: 0, stock_changed: true } } })
  assert.ok(drift.text().includes('Starting stock: 0') && drift.text().includes('Stock: 2') && drift.text().includes('Stock changed'), 'fixed zero baseline and current quantity are distinct and drift is visible')
  await drift.render({ ...base, products: [{ id: 93, name: 'Changed stock', quantity: 2 }], canViewStock: false, observations: { 93: { product_id: 93, state: 'done', counted_quantity: null, reason: null, revision: 1, baseline_quantity: 0, stock_changed: true } } })
  assert.ok(!drift.text().includes('Starting stock') && !drift.text().includes('Stock changed'), 'hidden stock must not leak a derived drift flag')
  await drift.unmount()
  const otherBlind = await mount({ canCheck: false, canViewStock: false, canViewCounts: false, products: [{ id: 94, name: 'Another staff session' }], observations: { 94: { product_id: 94, state: 'done', counted_quantity: 9876, reason: null, revision: 1 } } })
  assert.ok(!otherBlind.text().includes('9876') && !otherBlind.text().includes('Counted:'), 'a blind viewer cannot infer stock from another staff member’s count')
  await otherBlind.unmount()
  const editing: Array<[number | string, boolean]> = []
  const guarded = await mount({ products: [{ id: 95, name: 'Unsaved physical count' }], onEditingChange: (id: number | string, value: boolean) => { editing.push([id, value]) } })
  await guarded.click(guarded.button('Report issue', row(guarded, 95)))
  const registered = dirtyWork.getDirtyWork().find(entry => entry.label === 'Unsaved physical count')
  assert.equal(registered?.pageId, 'inventory', 'the real row editor registers with the shared navigation guard')
  assert.deepEqual(editing.at(-1), [95, true])
  await guarded.click(guarded.button('Cancel', row(guarded, 95)))
  assert.ok(!dirtyWork.getDirtyWork().some(entry => entry.label === 'Unsaved physical count'))
  assert.deepEqual(editing.at(-1), [95, false])
  await guarded.click(guarded.button('Report issue', row(guarded, 95)))
  await guarded.unmount()
  assert.ok(!dirtyWork.getRegisteredWork().some(entry => entry.label === 'Unsaved physical count'), 'scope teardown removes the old row’s registry entry')
  assert.equal(JSON.stringify(products), originalProducts, 'row interaction never mutates stock/product input records')
} finally { await harness.close() }
console.log('PASS mounted Inventory check rows: real variants, blank/zero, explicit issue save/cancel/retry, invalid count/reason, pending/permissions and long Khmer names')
