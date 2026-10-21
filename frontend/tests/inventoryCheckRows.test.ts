import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { act } from 'react'
import * as dirtyWork from '../src/utils/dirtyWork.ts'
import { createHarness, propsOf, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'
import { offsetDate } from '../src/utils/dateHelpers.ts'
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
// Every surface is remembered so a case that fails half way cannot leave its rows in the shared document for the next case to find.
const live: MountedSurface[] = []
const track = async (surface: Promise<MountedSurface>) => { const mounted = await surface; live.push(mounted); return mounted }
const mount = (props: Record<string, unknown> = {}) => track(harness.mount({ component: 'components/inventory/InventoryCheckRows.tsx', props: { ...base, ...props }, app: {}, doubles: { 'utils/dirtyWork.ts': dirtyWork } }))
try {
  // ---- Lane 6.0.920: the count sheet, the count editor and the scan request. Each case stands alone so a red run names every one that fails. ----
  const key = (surface: MountedSurface, node: MemoryNode, name: string) => surface.call(node, 'onKeyDown', [{ key: name, preventDefault() {}, nativeEvent: {}, currentTarget: node, target: node }])
  const active = (surface: MountedSurface) => surface.body.ownerDocument.activeElement
  const countInputs = (surface: MountedSurface) => surface.findAll(node => node.getAttribute('data-check-count') !== null)
  const countInput = (surface: MountedSurface, id: number) => surface.find(node => node.getAttribute('data-check-count') !== null && row(surface, id).contains(node), `Count input of ${id}`)
  const submitOf = (surface: MountedSurface) => surface.find(node => node.getAttribute('data-check-submit') !== null, 'editor primary button')
  const headerOf = (surface: MountedSurface) => surface.find(node => node.getAttribute('data-inventory-check-sheet-header') !== null, 'sheet header')
  const titlesOf = (surface: MountedSurface) => headerOf(surface).children.map(child => child.textContent)
  const metaOf = (surface: MountedSurface, id: number) => surface.find(node => node.getAttribute('data-inventory-check-meta') !== null && row(surface, id).contains(node), `facts of ${id}`).textContent.replace(/\s+/g, ' ').replace(/ ?· ?/g, ' · ').trim()
  const differences = (surface: MountedSurface) => surface.findAll(node => node.getAttribute('role') === 'img' && (node.getAttribute('aria-label') || '').startsWith('Difference')).map(node => node.getAttribute('aria-label'))
  const sheetProducts: InventoryCheckProduct[] = [
    { id: 301, name: 'Count one', quantity: 10, unit: 'pcs', damaged_quantity: 1, qty_sold: 4, customer_count: 3, selling_price_usd: 2.5, cost_price_usd: 1.2 },
    { id: 302, name: 'Count two', quantity: 12 },
    { id: 303, name: 'Count three', quantity: 5 },
  ]
  const started = (id: number, over: Partial<InventoryCheckObservation> = {}): InventoryCheckObservation => ({ product_id: id, state: 'unstarted', counted_quantity: null, reason: null, revision: 0, baseline_quantity: sheetProducts.find(product => product.id === id)?.quantity, ...over })
  const inSession = Object.fromEntries(sheetProducts.map(product => [product.id, started(Number(product.id))])) as Record<string, InventoryCheckObservation>
  const refusal = (code: string) => Object.assign(new Error('refused'), { code, status: 409 })
  const cases: Array<[string, () => Promise<void>]> = [
    ['the phone line counts first: Now with its unit, Start, Counted, Damaged, then price, cost, Sold, Cust', async () => {
      const s = await mount({ products: [sheetProducts[0]], observations: { 301: started(301, { state: 'done', counted_quantity: 9, revision: 2, stock_changed: true, baseline_quantity: 12 }) }, canViewPrice: true, canViewCost: true, fmtUSD: (value: number) => `$${value}`, canCheck: false })
      assert.equal(metaOf(s, 301), 'Now 10 pcs · Start 12 (−2) · Counted 9 · Damaged 1 · Price $2.5 · Cost $1.2 · Sold 4 · Cust 3')
      await s.unmount()
    }],
    ['the state icon of a read-only row sits with the actions, not in the facts; the left edge carries the state', async () => {
      const s = await mount({ canCheck: false, products: sheetProducts, observations: { ...inSession, 301: started(301, { state: 'done', revision: 1 }), 302: started(302, { state: 'issue', reason: 'Torn', revision: 1 }) } })
      const actions = s.find(node => node.getAttribute('data-check-actions') !== null && row(s, 301).contains(node), 'actions of 301')
      assert.equal(s.findAll(node => actions.contains(node) && node.tagName.toLowerCase() === 'svg').length, 1, 'the done glyph is in the actions cell')
      assert.ok(!metaOf(s, 301).includes('Done'), 'and not in the facts line')
      assert.ok(row(s, 301).className.includes('border-l-emerald-500') && row(s, 302).className.includes('border-l-amber-500') && row(s, 303).className.includes('border-l-transparent'), 'done, issue and not started have their own left edge')
      assert.equal(row(s, 302).getAttribute('data-check-state'), 'issue')
      await s.unmount()
    }],
    ['row buttons are 44px under 1024px with a 4px gap', async () => {
      const s = await mount({ products: [sheetProducts[0]], observations: { 301: started(301) } })
      const buttons = s.findAll(node => node.tagName === 'BUTTON' && row(s, 301).contains(node))
      assert.equal(buttons.length, 3, 'image, tick and issue')
      for (const button of buttons) assert.ok(button.className.includes('h-11') && button.className.includes('w-11') && button.className.includes('lg:h-10'), `${button.getAttribute('aria-label')}: 44px, 40px from the sheet up`)
      assert.ok(s.find(node => node.getAttribute('data-check-actions') !== null, 'actions').className.split(' ').includes('gap-1'), 'a 4px gap between ✓ and !')
      await s.unmount()
    }],
    ['the unit follows Now; disagreeing stock records get a hint; an expiry date is a badge that says how close it is', async () => {
      const soon = offsetDate(10), late = offsetDate(-3)
      const pack = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
      const s = await mount({ canCheck: false, t: (name: string) => pack[name] || name, products: [
        { id: 401, name: 'Agreeing', quantity: 3, unit: 'btl', stock_consistent: true },
        { id: 402, name: 'Disagreeing', quantity: 3, stock_consistent: false, next_expiry_date: late },
        { id: 403, name: 'Soon', quantity: 3, next_expiry_date: soon },
        { id: 404, name: 'Far', quantity: 3, next_expiry_date: '2099-03-15' },
        { id: 405, name: 'Unit without stock', unit: 'btl' },
      ] })
      assert.ok(metaOf(s, 401).startsWith('Now 3 btl'), 'unit after Now')
      assert.ok(!metaOf(s, 405).includes('btl'), 'a unit never hangs on an unknown stock')
      const hints = (id: number) => s.findAll(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === pack.inventory_check_stock_inconsistent_hint && row(s, id).contains(node))
      assert.equal(hints(402).length, 1, 'the hint is an InfoHint beside Now')
      assert.equal(hints(401).length + hints(403).length, 0, 'and only on disagreement')
      const badge = (id: number) => s.find(node => node.getAttribute('data-expiry') !== null && row(s, id).contains(node), `expiry of ${id}`)
      assert.deepEqual([402, 403, 404].map(id => badge(id).getAttribute('data-expiry')), ['expired', 'soon', 'ok'])
      assert.equal(badge(402).textContent, `${pack.inventory_check_expired} ${late.slice(5, 7)}/${late.slice(0, 4)}`)
      assert.equal(badge(403).textContent, `${pack.inventory_check_expires_soon} ${soon.slice(5, 7)}/${soon.slice(0, 4)}`)
      assert.equal(badge(404).textContent, `${pack.expiry} 03/2099`)
      assert.equal(s.findAll(node => node.getAttribute('data-expiry') !== null && row(s, 401).contains(node)).length, 0, 'no expiry date, no badge')
      await s.unmount()
    }],
    ['the Count input exists only for someone who can check and see stock', async () => {
      const s = await mount({ products: sheetProducts, observations: inSession })
      assert.equal(countInputs(s).length, 3)
      assert.equal(propsOf(countInput(s, 301)).placeholder, '10', 'Now is the placeholder')
      assert.equal(propsOf(countInput(s, 301)).inputMode, 'numeric')
      await s.render({ ...base, products: sheetProducts, observations: inSession, canCheck: false })
      assert.equal(countInputs(s).length, 0, 'read-only: no input')
      await s.render({ ...base, products: sheetProducts, observations: inSession, canViewStock: false })
      assert.equal(countInputs(s).length, 0, 'blind counting keeps no Count input')
      assert.ok(s.button('Report issue', row(s, 301)), 'but still its editor')
      await s.render({ ...base, products, observations: {}, canCheck: false })
      assert.equal(countInputs(s).length, 0, 'outside a session there is nothing to count')
      await s.unmount()
      const family = await mount({ products, observations: Object.fromEntries(products.slice(1).map(product => [product.id, started(Number(product.id), { baseline_quantity: product.quantity })])) })
      assert.equal(countInputs(family).length, 2, 'a family header has no Count input, its variants do')
      await family.unmount()
    }],
    ['Enter in the Count input: equal to Now saves Done with the count and moves to the next row', async () => {
      const s = await mount({ products: sheetProducts, observations: inSession })
      const before = calls.length
      await s.type(countInput(s, 301), '10')
      await key(s, countInput(s, 301), 'Enter')
      assert.equal(calls.length, before + 1)
      assert.deepEqual(calls.at(-1), { productId: 301, patch: { state: 'done', counted_quantity: 10, reason: null }, revision: 0 })
      assert.equal(active(s), countInput(s, 302), 'focus moves to the next row Count input')
      await s.unmount()
    }],
    ['Enter in the Count input: a different count saves nothing, opens the editor with it and focuses Reason', async () => {
      const s = await mount({ products: sheetProducts, observations: inSession })
      const before = calls.length
      await s.type(countInput(s, 302), '9')
      await key(s, countInput(s, 302), 'Enter')
      assert.equal(calls.length, before, 'nothing is saved by a count that differs')
      assert.equal(propsOf(s.field('inventory-check-count-302')).value, '9')
      assert.equal(active(s), s.field('inventory-check-reason-302'), 'Reason has focus')
      assert.equal(propsOf(countInput(s, 302)).readOnly, true, 'the sheet field mirrors the editor')
      await s.type(s.field('inventory-check-reason-302'), 'Short on shelf')
      await key(s, s.field('inventory-check-reason-302'), 'Enter')
      assert.deepEqual(calls.at(-1), { productId: 302, patch: { state: 'issue', counted_quantity: 9, reason: 'Short on shelf' }, revision: 0 }, 'Enter in Reason saves the issue')
      await s.unmount()
    }],
    ['Enter in the Count input: empty is Done without a count, the saved count again is no request, junk is refused, Escape and the arrows', async () => {
      const s = await mount({ products: sheetProducts, observations: { ...inSession, 303: started(303, { state: 'done', counted_quantity: 5, revision: 1 }) } })
      const input = countInput(s, 301)
      await key(s, input, 'Enter')
      assert.deepEqual(calls.at(-1), { productId: 301, patch: { state: 'done', counted_quantity: null, reason: null }, revision: 0 }, 'empty means Done, no count')
      const before = calls.length
      assert.equal(propsOf(countInput(s, 303)).value, '5', 'a saved count fills the field')
      await key(s, countInput(s, 303), 'Enter')
      assert.equal(calls.length, before, 'the same count on a done row is not a new request')
      await s.type(input, 'abc')
      await key(s, input, 'Enter')
      assert.equal(calls.length, before)
      assert.ok(row(s, 301).textContent.includes('Enter a valid non-negative quantity'))
      await key(s, input, 'Escape')
      assert.equal(propsOf(input).value, '', 'Escape drops what was typed')
      const other = countInput(s, 302)
      await key(s, other, 'ArrowDown')
      assert.equal(propsOf(other).value, '11', 'ArrowDown steps down from Now (12)')
      await key(s, other, 'ArrowUp'); await key(s, other, 'ArrowUp')
      assert.equal(propsOf(other).value, '13')
      await s.type(other, '0')
      await key(s, other, 'ArrowDown')
      assert.equal(propsOf(other).value, '0', 'never below zero')
      await s.unmount()
    }],
    ['a count the server refuses as equal to stock opens the editor with that count', async () => {
      const s = await mount({ products: sheetProducts, observations: inSession, onSave: async (productId: number | string, patch: InventoryCheckPatch, revision: number) => { calls.push({ productId, patch, revision }); throw refusal('inventory_check_count_requires_issue') } })
      await s.type(countInput(s, 301), '10')
      await key(s, countInput(s, 301), 'Enter')
      assert.equal(propsOf(s.field('inventory-check-count-301')).value, '10')
      assert.equal(active(s), s.field('inventory-check-reason-301'))
      await s.unmount()
    }],
    ['the editor: the count starts at Now, stepper, difference, Done or Save, reason chips', async () => {
      const chips = ['Damaged', 'Missing', 'Expired', 'damaged', ' Wrong barcode ', 'Leaking', 'Torn box', 'Short dated', 'Other', 'Ninth', '']
      const s = await mount({ products: [sheetProducts[0]], observations: { 301: started(301) }, reasonSuggestions: chips })
      await s.click(s.button('Report issue', row(s, 301)))
      assert.equal(propsOf(s.field('inventory-check-count-301')).value, '10', 'starts at Now')
      assert.equal(propsOf(s.field('inventory-check-count-301')).placeholder, 'Count', 'the label sits inside the field')
      assert.equal(propsOf(s.field('inventory-check-reason-301')).placeholder, 'Reason')
      assert.equal(submitOf(s).getAttribute('data-check-submit'), 'done', 'equal to Now is Done')
      assert.deepEqual(differences(s), ['Difference: 0'])
      await s.click(s.button('Decrease quantity', row(s, 301)))
      assert.equal(propsOf(s.field('inventory-check-count-301')).value, '9')
      assert.deepEqual(differences(s), ['Difference: −1'])
      assert.equal(submitOf(s).getAttribute('data-check-submit'), 'issue', 'a different count is an issue')
      await s.click(s.button('Increase quantity', row(s, 301)))
      await s.click(s.button('Increase quantity', row(s, 301)))
      assert.deepEqual(differences(s), ['Difference: +1'])
      await s.click(s.button('Decrease quantity', row(s, 301)))
      assert.equal(submitOf(s).getAttribute('data-check-submit'), 'done')
      const group = s.find(node => node.getAttribute('aria-label') === 'Recent reasons', 'reason chips')
      assert.deepEqual(s.findAll(node => node.tagName === 'BUTTON' && group.contains(node)).map(node => node.textContent), ['Damaged', 'Missing', 'Expired', 'Wrong barcode', 'Leaking', 'Torn box', 'Short dated', 'Other'], 'eight at most, case-insensitive repeats and blanks dropped')
      await s.click(s.button('Missing', group))
      assert.equal(propsOf(s.field('inventory-check-reason-301')).value, 'Missing', 'a chip fills the reason')
      await s.click(s.button('Other', group))
      assert.equal(propsOf(s.field('inventory-check-reason-301')).value, 'Other', 'and the next one replaces it')
      assert.equal(submitOf(s).getAttribute('data-check-submit'), 'issue', 'a reason makes it an issue even when the count matches')
      await s.type(s.field('inventory-check-reason-301'), '')
      const before = calls.length
      await s.click(submitOf(s))
      assert.deepEqual(calls.at(-1), { productId: 301, patch: { state: 'done', counted_quantity: 10, reason: null }, revision: 0 }, 'Done saves the count with it')
      assert.equal(calls.length, before + 1)
      await s.unmount()
    }],
    ['a blind counter starts from nothing, sees no difference and always saves an issue', async () => {
      const s = await mount({ products: [sheetProducts[0]], observations: { 301: started(301) }, canViewStock: false })
      await s.click(s.button('Report issue', row(s, 301)))
      assert.equal(propsOf(s.field('inventory-check-count-301')).value, '')
      assert.equal(differences(s).length, 0)
      assert.equal(submitOf(s).getAttribute('data-check-submit'), 'issue')
      await s.unmount()
    }],
    ['the editor takes keyboard focus on a mouse device only', async () => {
      const original = globalThis.matchMedia
      try {
        globalThis.matchMedia = (() => ({ matches: false })) as unknown as typeof matchMedia
        const touch = await mount({ products: [sheetProducts[0]], observations: { 301: started(301) } })
        await touch.click(touch.button('Report issue', row(touch, 301)))
        assert.notEqual(active(touch), touch.field('inventory-check-count-301'), 'no keyboard pop-up on a phone')
        await touch.unmount()
        globalThis.matchMedia = (() => ({ matches: true })) as unknown as typeof matchMedia
        const mouse = await mount({ products: [sheetProducts[0]], observations: { 301: started(301) } })
        await mouse.click(mouse.button('Report issue', row(mouse, 301)))
        assert.equal(active(mouse), mouse.field('inventory-check-count-301'), 'a mouse opens the editor on the count')
        await mouse.unmount()
      } finally { globalThis.matchMedia = original }
    }],
    ['a focus request rings one row, scrolls it to the middle and focuses its Count or tick; the same request is not repeated', async () => {
      const s = await mount({ products: sheetProducts, observations: inSession })
      const scrolled: unknown[] = []
      for (const id of [301, 302, 303]) (row(s, id) as unknown as { scrollIntoView: (arg: unknown) => void }).scrollIntoView = arg => { scrolled.push([id, arg]) }
      const request = (id: number, token: string, target: string) => s.render({ ...base, products: sheetProducts, observations: inSession, focusRequest: { id, token, target } })
      await request(303, 'a', 'count')
      assert.equal(active(s), countInput(s, 303))
      assert.ok(row(s, 303).hasAttribute('data-scan-hit') && !row(s, 301).hasAttribute('data-scan-hit'))
      assert.deepEqual(scrolled, [[303, { block: 'center' }]])
      await request(303, 'a', 'count')
      assert.deepEqual(scrolled.map(entry => (entry as [number, unknown])[0]), [303], 'the same token is not a new request')
      await request(302, 'b', 'action')
      assert.equal(active(s), s.find(node => node.getAttribute('data-check-action') === 'done' && row(s, 302).contains(node), 'tick of 302'))
      countInput(s, 303).focus()
      await request(301, 'c', 'none')
      assert.equal(active(s), countInput(s, 303), 'target none moves no focus')
      assert.ok(row(s, 301).hasAttribute('data-scan-hit'), 'but rings the row')
      assert.deepEqual(scrolled.map(entry => (entry as [number, unknown])[0]), [303, 302, 301], 'and scrolls it')
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 1700)) })
      await s.settle()
      assert.ok(!row(s, 301).hasAttribute('data-scan-hit'), 'the ring fades after about 1.6s')
      await request(302, 'e', 'none')
      assert.ok(row(s, 302).hasAttribute('data-scan-hit'))
      await request(999, 'f', 'count')
      assert.equal(s.findAll(node => node.hasAttribute('data-scan-hit')).length, 0, 'a request for a row that is not listed clears the old ring instead of leaving it on')
      await s.unmount()
    }],
    ['onCommitted hears each confirmed save, and a handled one keeps focus where the page wants it', async () => {
      const heard: unknown[][] = []
      let handled = false
      const s = await mount({ products: sheetProducts, observations: inSession, onCommitted: (id: number, via: string) => { heard.push([id, via]); return handled } })
      await s.click(s.button('Mark done', row(s, 301)))
      await s.type(countInput(s, 302), '12')
      await key(s, countInput(s, 302), 'Enter')
      assert.deepEqual(heard, [[301, 'tick'], [302, 'count']])
      assert.equal(active(s), countInput(s, 303), 'unhandled: the sheet moves on')
      handled = true
      countInput(s, 301).focus()
      await s.type(countInput(s, 301), '10')
      await key(s, countInput(s, 301), 'Enter')
      assert.deepEqual(heard.at(-1), [301, 'count'])
      assert.equal(active(s), countInput(s, 301), 'handled: the sheet keeps its hands off focus')
      await s.unmount()
    }],
    ['the sheet header names the columns this viewer has, and the list draws one only above several products', async () => {
      const flags = { canCheck: true, inSession: true, canViewStock: true, canViewCounts: true, canViewPrice: true, canViewCost: true, canViewSales: true, canViewCustomers: true, t: base.t }
      const header = (props: Record<string, unknown>) => track(harness.mount({ component: 'components/inventory/InventoryCheckRows.tsx', exportName: 'InventoryCheckSheetHeader', props: { ...flags, ...props }, app: {}, doubles: { 'utils/dirtyWork.ts': dirtyWork } }))
      let h = await header({})
      assert.deepEqual(titlesOf(h), ['Product', 'Now', 'Start', 'Damaged', 'Price', 'Cost', 'Sold', 'Cust', 'Count', ''])
      assert.equal(headerOf(h).getAttribute('aria-hidden'), 'true')
      assert.ok(headerOf(h).className.includes('lg:flex'), 'a sheet header exists from 1024px up')
      await h.unmount()
      h = await header({ canViewCost: false })
      assert.ok(!titlesOf(h).includes('Cost'), 'no Cost title without the cost right')
      await h.unmount()
      h = await header({ canViewStock: false, canCheck: false })
      assert.deepEqual(titlesOf(h), ['Product', 'Price', 'Cost', 'Sold', 'Cust', 'Count', ''], 'blind: no stock columns')
      await h.unmount()
      h = await header({ inSession: false, canCheck: false })
      assert.deepEqual(titlesOf(h), ['Product', 'Now', 'Damaged', 'Price', 'Cost', 'Sold', 'Cust'], 'outside a session there is no Start, Count or actions column')
      await h.unmount()
      const headers = (surface: MountedSurface) => surface.findAll(node => node.getAttribute('data-inventory-check-sheet-header') !== null).length
      const list = await mount({ products: sheetProducts, observations: inSession })
      assert.equal(headers(list), 1)
      await list.render({ ...base, products: sheetProducts, observations: inSession, sheetHeader: 'external' })
      assert.equal(headers(list), 0, 'an external header is the page’s to mount')
      await list.render({ ...base, products: [sheetProducts[0]], observations: inSession })
      assert.equal(headers(list), 0, 'a list of one has nothing to line up with')
      await list.unmount()
    }],
    ['without the cost right there is no Cost cell, title or figure; an empty value keeps its cell on the sheet', async () => {
      const s = await mount({ products: [sheetProducts[0], sheetProducts[1]], observations: inSession, canViewPrice: true, canViewCost: false, fmtUSD: (value: number) => `$${value}` })
      assert.ok(!s.text().includes('Cost') && !s.text().includes('1.2'), 'no cost anywhere')
      assert.equal(s.findAll(node => node.getAttribute('data-cell') === 'cost').length, 0)
      const placeholder = s.find(node => node.getAttribute('data-cell') === 'damaged' && row(s, 302).contains(node), 'damaged cell of a row without damage')
      assert.equal(placeholder.getAttribute('aria-hidden'), 'true')
      assert.ok(placeholder.className.includes('hidden') && placeholder.className.includes('xl:block'), 'it is there for the sheet, not on a phone')
      assert.ok(!metaOf(s, 302).includes('Damaged'))
      await s.unmount()
    }],
  ]
  const failures: string[] = []
  for (const [name, run] of cases) {
    try { await run() } catch (cause) { failures.push(`${name}\n    ${(cause instanceof Error ? cause.message : String(cause)).split('\n')[0]}`) } finally { for (const surface of live.splice(0)) await surface.unmount() }
  }
  if (failures.length) throw new Error(`${failures.length} of ${cases.length} count-sheet cases failed:\n  - ${failures.join('\n  - ')}`)

  for (const language of ['en', 'km']) {
    const pack = JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>
    for (const canCheck of [true, false]) for (const savedState of ['unstarted', 'done', 'issue'] as const) {
      const visual = await mount({ products: [{ id: 201, name: 'Saved visual state' }], canCheck,
        observations: { 201: { product_id: 201, state: savedState, counted_quantity: savedState === 'unstarted' ? null : 0, reason: savedState === 'issue' ? 'Saved issue reason' : null, revision: 4 } },
        t: (key: string) => pack[key] || key })
      const status = visual.find(node => node.getAttribute('data-check-status') === '201', 'localized saved status')
      assert.equal(status.textContent, pack[`inventory_check_${savedState}`], `${language}: saved state retains its localized accessible label`)
      const icons = visual.findAll(node => status.contains(node) && node.tagName.toLowerCase() === 'svg')
      if (canCheck || savedState === 'unstarted') {
        assert.ok(status.className.split(' ').includes('sr-only'), 'unstarted and editable status text is visually absent')
        assert.equal(icons.length, 0, 'editable actions must not duplicate their status glyph')
      } else {
        assert.equal(icons.length, 1, 'read-only completed or issue state has one glyph')
        assert.equal(icons[0].getAttribute('aria-hidden'), 'true', 'the localized text supplies the accessible status')
        assert.ok(icons[0].className.includes(savedState === 'done' ? 'lucide-check' : 'lucide-alert-circle'))
        assert.ok(status.className.includes(savedState === 'done' ? 'text-emerald-700' : 'text-amber-700'))
        assert.ok(visual.findAll(node => status.contains(node) && node.className.split(' ').includes('sr-only')).some(node => node.textContent === status.textContent))
      }
      if (canCheck) {
        const action = visual.find(node => node.getAttribute('data-check-action') === 'done', 'done action')
        const glyph = visual.find(node => action.contains(node) && node.tagName.toLowerCase() === 'svg', 'done action glyph')
        assert.ok(glyph.className.includes(savedState === 'done' ? 'lucide-check' : 'lucide-square'), 'unselected done action is unchecked rather than a gray tick')
        assert.equal(action.getAttribute('aria-pressed'), String(savedState === 'done'))
        assert.equal(glyph.getAttribute('aria-hidden'), 'true')
      }
      if (savedState !== 'unstarted') assert.ok(visual.text().includes(`${pack.inventory_check_counted} 0`), 'a saved zero remains visible')
      if (savedState === 'issue') assert.ok(visual.text().includes('Saved issue reason'))
      await visual.unmount()
    }
  }
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
  assert.ok(row(surface, 11).textContent.includes('Counted 0'), 'checked zero is visible and distinct from unstarted')
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
  await reason.type(reason.field('inventory-check-count-12'), '2')
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
  assert.ok(money.text().includes('APP[0]') && money.text().includes('Cost —'), 'a known zero price shows, an unknown cost is a dash and never $0')
  await money.render({ ...base, products: [products[1]], fmtUSD: () => { throw new Error('denied money must not be formatted') } })
  assert.ok(!money.text().includes('Price') && !money.text().includes('Cost') && !money.text().includes('APP['), 'denied money shows no price or cost at all')
  await money.unmount()
  const review = await mount({ products: [{ ...products[1], cost_needs_review: true }], canViewCost: true })
  assert.ok(review.text().includes('87.25') && review.text().includes('Cost needs review'), 'a saved known fallback cost still displays its review tag')
  await review.render({ ...base, products: [{ ...products[1], cost_needs_review: true }], canViewCost: false })
  assert.ok(!review.text().includes('Cost needs review') && !review.text().includes('87.25'), 'a hidden cost cannot leak its derived review status')
  await review.render({ ...base, products: [{ ...products[1], cost_needs_review: false }], canViewCost: true })
  assert.ok(!review.text().includes('Cost needs review'), 'confirmed cost control has no review tag')
  await review.unmount()
  const blind = await mount({ products: [{ id: 91, name: 'Synthetic blind check', quantity: 4444, damaged_quantity: 3333 }],
    canViewStock: false, observations: { 91: { product_id: 91, state: 'done', counted_quantity: 0, reason: null, revision: 1, baseline_quantity: 2222 } } })
  assert.ok(!blind.text().includes('Now') && !blind.text().includes('Start') && !blind.text().includes('Damaged') && !blind.text().includes('4444') && !blind.text().includes('3333') && !blind.text().includes('2222'), 'blind checks hide stock, damage and baseline without deriving mismatch signals')
  assert.ok(blind.text().includes('Counted 0'), 'the checker can still read their own observation metadata')
  await blind.click(blind.button('Clear check', row(blind, 91)))
  assert.equal(calls.at(-1)?.productId, 91, 'blind stock permission does not disable metadata checks')
  await blind.render({ ...base, products: [{ id: 91, name: 'Synthetic omitted stock' }] })
  assert.ok(blind.text().includes('Now —') && !blind.text().includes('Now 0') && !blind.text().includes('Sold') && !blind.text().includes('Cust'), 'absent stock/metrics never become fabricated zeros')
  assert.ok(blind.button('Stock is not known'), 'an unknown stock dash explains itself in an InfoHint')
  await blind.unmount()
  const headerOnly = await mount({ products: [{ id: 92, name: 'Filtered family header', is_group: true, checkable: false }] })
  assert.equal(headerOnly.findAll(node => node.getAttribute('data-check-action') === 'done').length, 0, 'server-ineligible family headers cannot be checked when every child is filtered out')
  await headerOnly.unmount()
  const drift = await mount({ products: [{ id: 93, name: 'Changed stock', quantity: 2 }], observations: { 93: { product_id: 93, state: 'done', counted_quantity: null, reason: null, revision: 1, baseline_quantity: 0, stock_changed: true } } })
  assert.ok(drift.text().includes('Start 0') && drift.text().includes('Now 2'), 'fixed zero baseline and current quantity are distinct')
  assert.equal(drift.find(node => node.getAttribute('role') === 'img', 'drift marker').getAttribute('aria-label'), 'Stock changed +2', 'drift shows its size and says what it is')
  assert.ok(drift.text().indexOf('Now 2') < drift.text().indexOf('Start 0'), 'Now comes before Start')
  await drift.render({ ...base, products: [{ id: 93, name: 'Changed stock', quantity: 2 }], canViewStock: false, observations: { 93: { product_id: 93, state: 'done', counted_quantity: null, reason: null, revision: 1, baseline_quantity: 0, stock_changed: true } } })
  assert.ok(!drift.text().includes('Start') && drift.findAll(node => node.getAttribute('role') === 'img').length === 0, 'hidden stock must not leak a derived drift flag')
  await drift.unmount()
  const otherBlind = await mount({ canCheck: false, canViewStock: false, canViewCounts: false, products: [{ id: 94, name: 'Another staff session' }], observations: { 94: { product_id: 94, state: 'done', counted_quantity: 9876, reason: null, revision: 1 } } })
  assert.ok(!otherBlind.text().includes('9876') && !otherBlind.text().includes('Counted'), 'a blind viewer cannot infer stock from another staff member’s count')
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
  // Board A-M5/A-M6/A-R3: one compact metric line, a drift that shows its size, copyable identity, icon-only buttons, one Retry.
  const full = await mount({ products: [{ id: 301, name: 'Full line product', barcode: '885000111', brand: 'Brand B', category: 'Cat C', quantity: 10, damaged_quantity: 1, qty_sold: 4, customer_count: 3, selling_price_usd: 2.5, cost_price_usd: 1.2 }],
    canViewPrice: true, canViewCost: true, fmtUSD: (value: number) => `$${value}`,
    observations: { 301: { product_id: 301, state: 'done', counted_quantity: 9, reason: null, revision: 2, baseline_quantity: 12, stock_changed: true } } })
  const meta = full.find(node => node.getAttribute('data-inventory-check-meta') !== null, 'metric line').textContent
  assert.equal(meta.replace(/\s+/g, ' ').replace(/ ?· ?/g, ' · ').trim(), 'Now 10 · Start 12 (−2) · Counted 9 · Damaged 1 · Price $2.5 · Cost $1.2 · Sold 4 · Cust 3','Now, Start with drift size, the count, Damaged, price, cost, Sold and Cust read in one line')
  assert.equal(full.find(node => node.getAttribute('role') === 'img', 'drift marker').getAttribute('aria-label'), 'Stock changed −2')
  const copyValues = full.findAll(node => node.getAttribute('data-copy-value') !== null).map(node => node.getAttribute('data-copy-value'))
  assert.deepEqual(copyValues, ['Full line product', '885000111', 'Brand B'], 'name, barcode and brand open the shared copy float')
  const identityLine = full.find(node => node.getAttribute('data-copy-value') === '885000111', 'barcode').parentNode!
  assert.equal(identityLine.textContent.replace(/\s+/g, ''), '885000111·BrandB·CatC', 'barcode, brand and category share line two')
  for (const button of full.findAll(node => node.tagName === 'BUTTON' && row(full, 301).contains(node))) {
    assert.equal(button.textContent.trim(), '', 'a row button is an icon: no visible text')
    assert.ok((button.getAttribute('aria-label') || '').length > 0 && button.getAttribute('title'), 'and it carries a translated aria-label and tooltip')
  }
  await full.unmount()
  const retry = await mount({ products: [products[2]], errors: { 12: 'Not confirmed' }, frozen: { 12: { patch: { state: 'issue', counted_quantity: 1, reason: 'Frozen reason' }, revision: 5 } } })
  assert.equal(retry.findAll(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'Retry').length, 1, 'one Retry per failed row')
  await retry.click(retry.button('Retry', row(retry, 12)))
  assert.deepEqual(calls.at(-1), { productId: 12, patch: { state: 'issue', counted_quantity: 1, reason: 'Frozen reason' }, revision: 5 }, 'the row Retry resends the page-frozen request even when the row itself lost its draft')
  await retry.unmount()
  const badge = await mount({ products: [products[2]], adornments: { 12: 'RENAMED-BADGE' } })
  assert.ok(row(badge, 12).textContent.includes('RENAMED-BADGE'), 'page-supplied badges sit on the row')
  await badge.unmount()
  assert.equal(JSON.stringify(products), originalProducts, 'row interaction never mutates stock/product input records')
} finally { await harness.close() }
console.log('PASS mounted Inventory check rows: real variants, blank/zero, explicit issue save/cancel/retry, invalid count/reason, pending/permissions and long Khmer names')
