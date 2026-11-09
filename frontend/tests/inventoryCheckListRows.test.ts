import assert from 'node:assert/strict'
import { createHarness, propsOf, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'
import { fmtDateTime24 } from '../src/utils/formatters.ts'
import type { InventoryCheckProduct } from '../src/types/inventoryChecks.ts'

// Lane 6.0.1044 (P1.6a): the Inventory Check list counts by itself. A check box before each image, the owner's columns (product, barcode,
// stock now, next expiry, check status, counted, note, last checked by and when), the count typed in the row, one check button, a note
// only where the count differs, and a bar with select-all and Submit. No price, cost, sold or customer figure exists on a row.

const at = '2026-10-30T08:15:00.000Z'
const listed: InventoryCheckProduct[] = [
  { id: 501, name: 'Listed ok', quantity: 8, unit: 'pcs', barcode: '885000501', brand: 'Brand A', next_expiry_date: '2031-01-31', check_status: 'ok', check_counted_quantity: 8, check_by: 'amy', check_at: at },
  { id: 502, name: 'Listed issue', quantity: 5, damaged_quantity: 2, check_status: 'issue', check_counted_quantity: 3, check_note: 'Two boxes crushed', check_by: 'ben', check_at: at },
  { id: 503, name: 'Listed in check', quantity: 4, check_status: 'in_check' },
  { id: 504, name: 'Listed untouched', quantity: 9, check_status: 'not_checked' },
  { id: 505, name: 'Listed zero count', quantity: 6, check_status: 'ok', check_counted_quantity: 0, check_by: 'amy', check_at: at },
  { id: 506, name: 'Listed default note', quantity: 7, check_status: 'issue', check_counted_quantity: 6, check_note: 'Count differs from stock', check_by: 'ben', check_at: at },
]
const originalListed = JSON.stringify(listed)
const heading: InventoryCheckProduct = { id: 600, name: 'Family header', quantity: 12, is_group: true }
const locked: InventoryCheckProduct = { id: 601, name: 'Not checkable', quantity: 1, checkable: false }

type Call = [string, ...unknown[]]
const calls: Call[] = []
const base = {
  products: listed, drafts: {}, selecting: true, canViewStock: true, canViewCounts: true, t: (key: string) => key,
  onOpenProduct: (product: InventoryCheckProduct) => { calls.push(['open', product.id]) },
  onToggle: (product: InventoryCheckProduct, selected: boolean) => { calls.push(['toggle', product.id, selected]) },
  onCount: (product: InventoryCheckProduct, value: string) => { calls.push(['count', product.id, value]) },
  onChecked: (product: InventoryCheckProduct) => { calls.push(['checked', product.id]) },
  onNote: (product: InventoryCheckProduct, value: string) => { calls.push(['note', product.id, value]) },
}
const harness = await createHarness({})
const live: MountedSurface[] = []
const track = async (surface: Promise<MountedSurface>) => { const mounted = await surface; live.push(mounted); return mounted }
const mount = (props: Record<string, unknown> = {}) => track(harness.mount({ component: 'components/inventory/InventoryCheckListRows.tsx', props: { ...base, ...props }, app: {}, doubles: {} }))
const mountPart = (exportName: string, props: Record<string, unknown>) => track(harness.mount({ component: 'components/inventory/InventoryCheckListRows.tsx', exportName, props, app: {}, doubles: {} }))
const row = (surface: MountedSurface, id: number) => surface.find(node => node.getAttribute('data-inventory-check-row') === String(id), `row ${id}`)
const inRow = (surface: MountedSurface, id: number, attribute: string) => surface.find(node => node.getAttribute(attribute) !== null && row(surface, id).contains(node), `${attribute} of ${id}`)
const allInRow = (surface: MountedSurface, id: number, attribute: string) => surface.findAll(node => node.getAttribute(attribute) !== null && row(surface, id).contains(node))
const cell = (surface: MountedSurface, id: number, name: string) => surface.findAll(node => node.getAttribute('data-cell') === name && row(surface, id).contains(node))[0]
const flat = (node: MemoryNode | undefined) => (node?.textContent ?? '').replace(/\s+/g, ' ').replace(/ ?· ?/g, ' · ').trim()
const titlesOf = (surface: MountedSurface) => surface.find(node => node.getAttribute('data-inventory-check-sheet-header') !== null, 'list header').children.map(child => child.textContent).filter(Boolean)
const key = (surface: MountedSurface, node: MemoryNode, name: string) => surface.call(node, 'onKeyDown', [{ key: name, preventDefault() {}, nativeEvent: {}, currentTarget: node, target: node }])
const active = (surface: MountedSurface) => surface.body.ownerDocument.activeElement

const cases: Array<[string, () => Promise<void>]> = [
  ['the header names exactly the columns this viewer has, and is hidden below 1024px', async () => {
    const header = async (props: Record<string, unknown>) => mountPart('InventoryCheckListHeader', { selecting: true, canViewStock: true, canViewCounts: true, t: base.t, ...props })
    let h = await header({})
    assert.deepEqual(titlesOf(h), ['Product', 'Now', 'Status', 'Counted', 'Count', 'Last checked'], 'product, stock now, check status, counted quantity, count, last checked')
    const node = h.find(candidate => candidate.getAttribute('data-inventory-check-sheet-header') !== null, 'header')
    assert.equal(node.getAttribute('aria-hidden'), 'true')
    assert.ok(node.className.includes('hidden') && node.className.includes('lg:flex'), 'drawn from 1024px up only')
    await h.unmount()
    h = await header({ selecting: false })
    assert.deepEqual(titlesOf(h), ['Product', 'Now', 'Status', 'Counted', 'Last checked'], 'a viewer who cannot count has no Count column')
    await h.unmount()
    h = await header({ canViewStock: false, canViewCounts: false })
    assert.deepEqual(titlesOf(h), ['Product', 'Status', 'Count', 'Last checked'], 'blind: no stock and no counted figure, status and last checked stay')
    await h.unmount()
    for (const word of ['Price', 'Cost', 'Sold', 'Cust', 'Sales', 'Customers']) assert.ok(!titlesOf(await header({})).includes(word), `no ${word} column`)
  }],
  ['each row shows stock now, next expiry, check status, counted quantity, who and when it was last checked, and an issue’s note', async () => {
    const s = await mount({ selecting: false })
    assert.deepEqual([501, 502, 503, 504, 505, 506].map(id => row(s, id).getAttribute('data-check-list-status')), ['ok', 'issue', 'in_check', 'not_checked', 'ok', 'issue'])
    assert.deepEqual([501, 502, 503, 504].map(id => inRow(s, id, 'data-check-status-text').textContent), ['Checked OK', 'Issue', 'In check', 'Not checked'])
    assert.ok(flat(cell(s, 501, 'now')).startsWith('Now 8 pcs'), 'stock now with its unit')
    assert.ok(flat(cell(s, 502, 'now')).includes('Held 2') && !flat(cell(s, 502, 'now')).includes('Damaged'), 'held units (every tag, not only damaged) ride beside Now as a Held chip')
    assert.equal(flat(cell(s, 501, 'counted')), 'Counted 8')
    assert.equal(flat(cell(s, 505, 'counted')), 'Counted 0', 'a counted zero is a count, not an empty cell')
    assert.equal(cell(s, 503, 'counted').textContent, '', 'no count, no figure')
    assert.equal(flat(cell(s, 501, 'last')), `Last checked @amy · ${fmtDateTime24(at)}`, 'who, and the date AND the time')
    assert.ok(fmtDateTime24(at).includes(':'), 'the time is part of it')
    assert.equal(cell(s, 504, 'last').textContent, '', 'a product nobody checked has no checker')
    const note = (id: number) => allInRow(s, id, 'data-check-note').map(node => node.textContent)
    assert.deepEqual([note(501), note(502), note(503)], [[], ['Two boxes crushed'], []], 'the note shows under an issue row only')
    assert.deepEqual(note(506), ['Count differs from stock'], 'the server’s default note reads in the viewer’s language (falls back to English here)')
    assert.ok(row(s, 501).textContent.includes('885000501') && row(s, 501).textContent.includes('Brand A'), 'barcode and brand')
    assert.ok(allInRow(s, 501, 'data-expiry').length === 1 && inRow(s, 501, 'data-expiry').textContent.includes('01/2031'), 'next expiry as month and year')
    assert.equal(s.findAll(node => node.tagName === 'BUTTON' && node.getAttribute('data-check-action') !== null).length, 0, 'a viewer who cannot count has no check buttons')
    assert.equal(s.findAll(node => node.getAttribute('data-check-select') !== null || node.getAttribute('data-check-count') !== null).length, 0, 'and no check box or count input')
    assert.ok(row(s, 501).className.includes('border-l-emerald-500') && row(s, 502).className.includes('border-l-amber-500') && row(s, 503).className.includes('border-l-sky-500') && row(s, 504).className.includes('border-l-transparent'), 'the left edge follows the status')
    for (const id of [501, 502, 503, 504]) assert.ok(inRow(s, id, 'data-check-status-text').className.includes('rounded-full') && allInRow(s, id, 'data-check-status-text')[0].children.some(child => child.tagName.toLowerCase() === 'svg'), `status ${id} is a chip with an icon, not bare text`)
  }],
  ['a viewer without counts sees no counted figure; one without stock sees no stock, damage or a way to copy it into a count', async () => {
    const s = await mount({ selecting: false, canViewCounts: false })
    assert.ok(!s.text().includes('Counted'), 'no counted figure without the right to see counts')
    await s.render({ ...base, selecting: true, canViewStock: false, canViewCounts: false, products: [{ id: 91, name: 'Synthetic blind row', quantity: 4444, damaged_quantity: 3333, unit: 'pcs' } as InventoryCheckProduct] })
    assert.ok(!s.text().includes('4444') && !s.text().includes('3333') && !s.text().includes('Damaged') && !s.text().includes('Now'), 'blind: no stock, no damage')
    assert.equal(s.findAll(node => node.getAttribute('data-check-action') === 'checked').length, 0, 'blind: nothing to mark as matching')
    const input = inRow(s, 91, 'data-check-count')
    assert.equal(input.getAttribute('placeholder'), '', 'the count input hints nothing')
    await s.type(input, '3')
    assert.deepEqual(calls.at(-1), ['count', 91, '3'], 'a blind viewer can still count')
    assert.equal(allInRow(s, 91, 'data-check-draft-note').length, 0, 'and is never asked about a difference it cannot see')
  }],
  ['the check box comes before the image, and a family header or an uncheckable product has none', async () => {
    const s = await mount({ products: [listed[0], heading, locked] })
    const main = inRow(s, 501, 'data-inventory-check-main')
    const order = main.children.map(child => child.getAttribute('data-check-select-box') !== null ? 'box' : child.getAttribute('data-check-image') !== null ? 'image' : 'other')
    assert.deepEqual(order.slice(0, 2), ['box', 'image'], 'the box sits before the product image')
    assert.equal(allInRow(s, 600, 'data-check-select').length, 0, 'a family header cannot be picked')
    assert.equal(allInRow(s, 601, 'data-check-select').length, 0, 'a product that cannot be checked cannot be picked')
    assert.equal(allInRow(s, 600, 'data-check-count').length + allInRow(s, 601, 'data-check-count').length, 0, 'and has no count input')
    const label = inRow(s, 501, 'data-check-select').getAttribute('aria-label') || ''
    assert.equal(label, 'Select: Listed ok', 'the box is named after its product')
  }],
  ['picking, typing and the check button reach the page; typing a count picks the row (the page decides), Escape clears', async () => {
    const s = await mount({ drafts: { 501: { selected: true, count: '8', checked: false, note: '' } } })
    const box = inRow(s, 501, 'data-check-select')
    assert.equal(box.getAttribute('checked') ?? (box as unknown as { checked?: boolean }).checked, true, 'the box shows the draft’s state')
    await s.call(box, 'onChange', [{ target: { checked: false }, currentTarget: box }])
    assert.deepEqual(calls.at(-1), ['toggle', 501, false])
    await s.call(inRow(s, 502, 'data-check-select'), 'onChange', [{ target: { checked: true } }])
    assert.deepEqual(calls.at(-1), ['toggle', 502, true])
    await s.type(inRow(s, 502, 'data-check-count'), '4')
    assert.deepEqual(calls.at(-1), ['count', 502, '4'])
    await s.click(s.button('Mark checked: Listed issue', row(s, 502)))
    assert.deepEqual(calls.at(-1), ['checked', 502])
    await key(s, inRow(s, 501, 'data-check-count'), 'Escape')
    assert.deepEqual(calls.at(-1), ['count', 501, ''], 'Escape clears the count')
    await s.click(s.button('Listed ok', row(s, 501)))
    assert.deepEqual(calls.at(-1), ['open', 501], 'the product image or name opens its details')
  }],
  ['the count input hints the stock it is compared with; a differing count turns amber, shows the difference and asks for an optional note', async () => {
    const s = await mount({ drafts: { 501: { selected: true, count: '8', checked: true, note: '' }, 502: { selected: true, count: '3', checked: false, note: 'Shelf short' }, 503: { selected: false, count: '9', checked: false, note: '' } } })
    assert.equal(inRow(s, 501, 'data-check-count').getAttribute('placeholder'), '8', 'the placeholder is the stock now')
    assert.equal(allInRow(s, 501, 'data-check-draft-note').length, 0, 'a matching count needs no note')
    const draftNote = inRow(s, 502, 'data-check-draft-note')
    assert.equal(allInRow(s, 502, 'data-check-difference')[0].textContent, '−2', 'the difference is shown with its sign')
    assert.equal((draftNote.children.find(child => child.tagName === 'INPUT') as unknown as { value?: string }).value, 'Shelf short')
    assert.equal(allInRow(s, 503, 'data-check-draft-note').length, 0, 'a row that is not picked asks for nothing yet')
    assert.ok(inRow(s, 502, 'data-check-count').className.includes('border-amber-500'), 'a difference is amber')
    const noteInput = draftNote.children.find(child => child.tagName === 'INPUT') as MemoryNode
    await s.type(noteInput, 'Two missing')
    assert.deepEqual(calls.at(-1), ['note', 502, 'Two missing'])
    assert.equal(propsOf(noteInput).maxLength, 500, 'the note is limited to what the server keeps')
    assert.equal(inRow(s, 501, 'data-check-action').getAttribute('aria-pressed'), 'true', 'the check button shows it was used')
  }],
  ['an invalid count is said in words on its row and nothing differs', async () => {
    const s = await mount({ drafts: { 501: { selected: true, count: 'abc', checked: false, note: '' } } })
    assert.equal(inRow(s, 501, 'data-check-count').getAttribute('aria-invalid'), 'true')
    assert.ok(row(s, 501).textContent.includes('Enter a valid non-negative quantity.'))
    assert.equal(allInRow(s, 501, 'data-check-draft-note').length, 0)
  }],
  ['while a submission is on its way nothing on the list can change', async () => {
    const s = await mount({ locked: true, drafts: { 501: { selected: true, count: '7', checked: false, note: '' } } })
    const box = inRow(s, 501, 'data-check-select')
    assert.equal(box.getAttribute('disabled') !== null || (box as unknown as { disabled?: boolean }).disabled === true, true, 'the box is disabled')
    assert.equal(inRow(s, 501, 'data-check-count').getAttribute('readonly') !== null || (inRow(s, 501, 'data-check-count') as unknown as { readOnly?: boolean }).readOnly === true, true, 'the count is read-only')
    assert.equal(inRow(s, 501, 'data-check-action').getAttribute('disabled') !== null || (inRow(s, 501, 'data-check-action') as unknown as { disabled?: boolean }).disabled === true, true, 'the check button is disabled')
    const before = calls.length
    await key(s, inRow(s, 501, 'data-check-count'), 'Escape')
    assert.equal(calls.length, before, 'Escape does nothing while locked')
  }],
  ['on a phone the image is on the left and as tall as the facts beside it, the facts wrap, the count input fills the line', async () => {
    const s = await mount({})
    const main = inRow(s, 501, 'data-inventory-check-main')
    assert.ok(main.className.includes('items-stretch') && main.className.includes('lg:items-center'), 'phone: the image stretches to the facts; the sheet centres it')
    const image = inRow(s, 501, 'data-check-image')
    assert.ok(image.className.includes('self-stretch') && image.className.includes('w-12') && image.className.includes('min-h-12'), 'a stretched image at least as tall as one line of facts')
    assert.ok(image.className.includes('lg:self-center') && image.className.includes('lg:h-10'), 'and a fixed square on the sheet')
    const meta = inRow(s, 501, 'data-inventory-check-meta')
    assert.ok(meta.className.includes('flex-wrap') && meta.className.includes('lg:contents'), 'facts wrap on a phone and become columns on the sheet')
    const countCell = cell(s, 501, 'count-input')
    assert.ok(countCell.className.includes('w-full') && countCell.className.includes('lg:w-auto'), 'the count line spans a phone row')
    for (const column of ['now', 'status', 'counted', 'last']) assert.ok(/lg:w-/.test(cell(s, 501, column)?.className ?? cell(s, 503, column)?.className ?? 'lg:w-'), `${column} has one fixed width on the sheet`)
    for (const button of s.findAll(node => node.tagName === 'BUTTON' && row(s, 501).contains(node) && node.getAttribute('data-check-image') === null)) {
      assert.equal(button.textContent.trim(), '', 'a row button is an icon with no visible text')
      assert.ok((button.getAttribute('aria-label') || '').length > 0 && button.getAttribute('title'), 'and carries a name and a tooltip')
    }
  }],
  ['no price, cost, sold or customer figure exists on any row, even when an older server still sends it', async () => {
    const legacy = { ...listed[0], selling_price_usd: 2.5, cost_price_usd: 1.2, qty_sold: 4, customer_count: 3 } as unknown as InventoryCheckProduct
    const s = await mount({ products: [legacy], selecting: false })
    const text = s.text()
    for (const word of ['Price', 'Cost', 'Sold', 'Cust', '2.5', '1.2']) assert.ok(!text.includes(word), `no ${word} anywhere`)
  }],
  ['Enter in a valid count moves to the next row’s count input, unless the page handled it', async () => {
    const entered: Array<number | string> = [], invalidEnters: string[] = []
    let handled = false
    const s = await mount({ products: [listed[0], listed[1], listed[2]], drafts: { 501: { selected: true, count: '8', checked: false, note: '' } }, onCountEntered: (id: number | string) => { entered.push(id); return handled } })
    await key(s, inRow(s, 501, 'data-check-count'), 'Enter')
    assert.deepEqual(entered, [501])
    assert.equal(active(s), inRow(s, 502, 'data-check-count'), 'focus moves down to the next count')
    handled = true
    await key(s, inRow(s, 501, 'data-check-count'), 'Enter')
    assert.equal(entered.length, 2)
    await s.render({ ...base, products: [listed[0], listed[1]], drafts: { 501: { selected: true, count: 'x', checked: false, note: '' } }, onCountEntered: () => { invalidEnters.push('entered'); return false } })
    await key(s, inRow(s, 501, 'data-check-count'), 'Enter')
    assert.deepEqual(invalidEnters, [], 'Enter on an invalid count goes nowhere')
  }],
  ['a scan brings its row forward and focuses its count input; nothing is entered', async () => {
    const scrolled: string[] = []
    const s = await mount({ products: [listed[0], listed[1]], selecting: true })
    const target = row(s, 502) as unknown as { scrollIntoView?: (arg: unknown) => void }
    target.scrollIntoView = () => { scrolled.push('502') }
    await s.render({ ...base, products: [listed[0], listed[1]], focusRequest: { id: 502, token: 1, target: 'count' } })
    assert.deepEqual(scrolled, ['502'])
    assert.equal(active(s), inRow(s, 502, 'data-check-count'))
    assert.equal(row(s, 502).getAttribute('data-scan-hit'), '', 'the row is ringed for a moment')
    assert.ok(!calls.some(call => call[0] === 'count' && call[1] === 502 && call.length > 2 && call[2] !== '4' && call[2] !== ''), 'a scan enters no value')
  }],
  ['a count waiting for approval carries the review queue’s mini tag in the row’s own gutter, takes no space, and only that product has it', async () => {
    const waiting = { ...listed[1], check_pending: true }
    const surface = await mount({ products: [waiting, listed[0], { ...listed[5], check_pending: false }] })
    const tag = (id: number) => allInRow(surface, id, 'data-check-pending')
    assert.equal(tag(502).length, 1, 'the waiting product has one tag')
    assert.equal(tag(501).length, 0, 'a product with nothing waiting has none')
    assert.equal(tag(506).length, 0, 'an explicit false draws none')
    const mark = tag(502)[0]
    assert.equal(mark.getAttribute('aria-label'), 'Waiting for approval'); assert.equal(mark.getAttribute('role'), 'img'); assert.equal(mark.getAttribute('title'), 'Waiting for approval')
    assert.equal(mark.textContent, '', 'a glyph only: no word, so the row has no text to make room for')
    for (const word of ['absolute', 'pointer-events-none', 'h-2.5', 'w-2.5']) assert.ok(mark.className.split(/\s+/).includes(word), `the mark is out of the flow and inert (${word})`)
    assert.ok(row(surface, 502).className.split(/\s+/).includes('relative'), 'the row is the mark’s positioning container')
    assert.ok(row(surface, 502).children.includes(mark), 'the mark is the row’s own child, not part of any cell')
    assert.ok(!cell(surface, 502, 'status').contains(mark), 'it is not inside the status cell')
    assert.equal(flat(cell(surface, 502, 'status')), 'Issue', 'the status cell reads exactly what it reads without the mark')
    assert.equal(inRow(surface, 502, 'data-check-status-text').getAttribute('data-check-status-text'), 'issue', 'the status chip is untouched')
    assert.equal(flat(row(surface, 502)).replace('Waiting for approval', ''), flat(row(surface, 502)), 'the row’s text never says it')
    await surface.render({ ...base, products: [{ ...waiting, check_pending: false }, listed[0]] })
    assert.equal(tag(502).length, 0, 'once nothing waits (the line was applied), the mark is gone')
  }],
  ['the selection bar: select-all, how many, mark / clear as icons, and a Submit that says why it cannot go', async () => {
    const barCalls: string[] = []
    const props = (extra: Record<string, unknown> = {}) => ({ pageState: 'none', selectedCount: 0, blocked: '', busy: false, canMarkChecked: true, t: base.t,
      onTogglePage: () => { barCalls.push('page') }, onMarkChecked: () => { barCalls.push('mark') }, onClear: () => { barCalls.push('clear') }, onSubmit: () => { barCalls.push('submit') }, ...extra })
    const bar = await mountPart('InventoryCheckSelectionBar', props())
    const submit = () => bar.find(node => node.getAttribute('data-selection-action') === 'submit', 'Submit')
    assert.equal(bar.findAll(node => node.getAttribute('data-selection-action') === 'mark' || node.getAttribute('data-selection-action') === 'clear').length, 0, 'nothing to mark or clear until something is picked')
    assert.equal(submit().getAttribute('aria-disabled'), 'true', 'Submit waits for a pick')
    await bar.click(submit())
    assert.deepEqual(barCalls, [], 'a disabled Submit does nothing')
    await bar.render(props({ pageState: 'some', selectedCount: 3 }))
    assert.equal(bar.find(node => node.getAttribute('data-selected-count') !== null, 'count').textContent, '3 selected')
    assert.equal(submit().getAttribute('aria-disabled'), null, 'Submit is ready')
    assert.equal(submit().textContent.trim(), 'Submit', 'the main action keeps its word')
    for (const action of ['mark', 'clear']) {
      const button = bar.find(node => node.getAttribute('data-selection-action') === action, action)
      assert.equal(button.textContent.trim(), '', `${action} is an icon`)
      assert.ok((button.getAttribute('aria-label') || '').length > 0 && button.getAttribute('title'), `${action} has a name and a tooltip`)
    }
    await bar.click(bar.find(node => node.getAttribute('data-selection-action') === 'mark', 'mark'))
    await bar.click(bar.find(node => node.getAttribute('data-selection-action') === 'clear', 'clear'))
    await bar.click(submit())
    await bar.call(bar.find(node => node.getAttribute('data-check-select-all') !== null, 'select all'), 'onChange', [{ target: { checked: true } }])
    assert.deepEqual(barCalls, ['mark', 'clear', 'submit', 'page'])
    await bar.render(props({ selectedCount: 2, blocked: 'Enter a count for every selected product.' }))
    assert.equal(submit().getAttribute('aria-disabled'), 'true', 'a blocked Submit is disabled')
    assert.equal(submit().getAttribute('title'), 'Enter a count for every selected product.', 'and says why')
    barCalls.length = 0
    await bar.click(submit())
    assert.deepEqual(barCalls, [])
    await bar.render(props({ selectedCount: 2, busy: true }))
    assert.equal(submit().getAttribute('aria-disabled'), 'true', 'busy: Submit waits')
    await bar.render(props({ selectedCount: 2, submitLabel: 'Retry' }))
    assert.equal(submit().textContent.trim(), 'Retry', 'an unconfirmed attempt offers Retry in the same place')
    await bar.render(props({ selectedCount: 2, canMarkChecked: false }))
    assert.equal(bar.findAll(node => node.getAttribute('data-selection-action') === 'mark').length, 0, 'no stock figure, nothing to mark as matching')
    const all = bar.find(node => node.getAttribute('data-check-select-all') !== null, 'select all')
    assert.equal((all as unknown as { indeterminate?: boolean }).indeterminate ?? false, false)
  }],
]

const failures: string[] = []
try {
  for (const [name, run] of cases) {
    try { await run() } catch (cause) { failures.push(`${name}\n    ${(cause instanceof Error ? cause.message : String(cause)).split('\n')[0]}`) } finally { for (const surface of live.splice(0)) await surface.unmount() }
  }
  assert.equal(JSON.stringify(listed), originalListed, 'rendering never mutates the product records')
} finally { await harness.close() }
if (failures.length) throw new Error(`${failures.length} of ${cases.length} list-row cases failed:\n  - ${failures.join('\n  - ')}`)
console.log(`PASS mounted Inventory check list rows: ${cases.length} cases (columns, status, select, count, note, phone layout, selection bar, blind viewer)`)
