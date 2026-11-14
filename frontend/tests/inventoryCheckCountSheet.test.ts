import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

// Lane 6.0.920: the Inventory check rows as a count sheet, in a real browser. At 1024px and up the figures are columns that line up
// row to row and with the header; a count typed on the sheet saves or opens the editor; the editor has a stepper, the difference and
// reason chips; a scan request rings and focuses one row. At 360px (English and Khmer) nothing scrolls sideways and every row button
// is 44px. Rows are mounted straight from the component with a stateful fake of the page's save, so what is measured is the rows.
// The columns are the owner's (1 Nov 2026): product, stock now (damaged as a chip beside it), start, count in a session; status, counted quantity and
// last checked in the list (mode=list: its own rows, a check box before each image, the count typed in the row, one selection bar). Price, cost, sold and customers no longer exist anywhere.
const fixture = String.raw`
  import React, { useState } from 'react'
  import { createRoot } from 'react-dom/client'
  import * as RowsModule from '/src/components/inventory/InventoryCheckRows.tsx'
  import * as ListModule from '/src/components/inventory/InventoryCheckListRows.tsx'
  import { offsetDate } from '/src/utils/dateHelpers.ts'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '/src/styles/main.css'
  import '@fontsource/noto-sans-khmer/400.css'
  const params = new URLSearchParams(location.search)
  const language = params.get('lang') || 'en'
  const sidebar = Number(params.get('sidebar') || 0)
  const list = params.get('mode') === 'list'
  const showStock = params.get('stock') !== '0'
  const editable = params.get('check') !== '0'
  const external = params.get('header') === 'external'
  const pack = language === 'km' ? km : en
  const t = key => pack[key] || key
  document.body.className = language === 'km' ? 'lang-km' : ''
  const khmer = language === 'km'
  const longName = khmer ? 'ទឹកអប់ក្លិនផ្កាម្លិះធម្មជាតិ ១០០មីលីលីត្រ ផលិតផលសាកល្បងឈ្មោះវែងបំផុត' : 'Synthetic long product name for the narrow phone layout check 100ml'
  const reasons = khmer ? ['ខូច', 'បាត់', 'ផុតកំណត់', 'ខូច', 'បាកូដខុស', 'ហូរ', 'ប្រអប់រហែក', 'ជិតផុត', 'ផ្សេងៗ', 'ទីប្រាំបួន'] : ['Damaged', 'Missing', 'Expired', 'damaged', 'Wrong barcode', 'Leaking', 'Torn box', 'Short dated', 'Other', 'Ninth']
  const base = (id, name, extra = {}) => ({ id, name, barcode: '88500011122' + String(id).padStart(2, '0'), brand: khmer ? 'ម៉ាកសាកល្បង' : 'Synthetic brand', category: khmer ? 'ប្រភេទ' : 'Category', quantity: 10, unit: khmer ? 'ដប' : 'pcs', damaged_quantity: 0, ...extra })
  const products = [
    base(1, 'Garnier Micellar 400ml', { quantity: 10 }),
    base(2, longName, { quantity: 12, damaged_quantity: 1 }),
    base(3, 'Short', { quantity: 10, stock_consistent: false, unit: khmer ? 'កញ្ចប់ធំបំផុត' : 'bottles' }),
    base(4, 'Expired lot', { quantity: 5, next_expiry_date: '2001-01-31' }),
    base(5, 'Soon lot', { quantity: 1234, next_expiry_date: offsetDate(10) }),
    base(6, 'Far lot', { quantity: 7, next_expiry_date: '2099-03-15' }),
    base(7, 'Under review', { quantity: 0, unit: null }),
    base(8, 'Done row', { quantity: 10 }),
    base(9, 'Issue row', { quantity: 10 }),
    base(10, 'Small stock row', { quantity: 3 }),
    base(11, 'Row eleven', { quantity: 8 }),
    base(12, 'Row twelve', { quantity: 9 }),
    base(13, 'Row thirteen', { quantity: 9 }),
    base(14, 'Row fourteen', { quantity: 9 }),
    base(20, 'Family header', { quantity: 20, is_group: true }),
    base(21, 'Family small', { parent_id: 20, quantity: 8 }),
    base(22, 'Family large', { parent_id: 20, quantity: 12 }),
  ]
  const listFacts = {
    1: { check_status: 'ok', check_counted_quantity: 10, check_by: 'amy', check_at: '2026-10-30 08:15:00' },
    2: { check_status: 'issue', check_counted_quantity: 9, check_note: khmer ? 'ធ្លាក់ពីធ្នើ' : 'Fell off the shelf', check_by: 'ben', check_at: '2026-10-31 09:00:00' },
    3: { check_status: 'in_check' },
  }
  // Every list row carries the prices the wired list sends (D1 wave 2): selling, wholesale and a live 10% product discount, on the line that holds the barcode and brand.
  const listProducts = products.map(product => ({ ...product, check_status: 'not_checked', ...(listFacts[product.id] ?? {}), selling_price_usd: 12.5, wholesale_price_usd: 10, discount_enabled: 1, discount_type: 'percent', discount_percent: 10 }))
  const startState = (product) => ({ product_id: product.id, state: 'unstarted', counted_quantity: null, reason: null, revision: 0, baseline_quantity: product.quantity, current_quantity: product.quantity, stock_changed: false })
  const initial = Object.fromEntries(products.filter(product => product.id !== 20).map(product => [product.id, startState(product)]))
  initial[2] = { ...initial[2], baseline_quantity: 14, stock_changed: true }
  initial[8] = { ...initial[8], state: 'done', counted_quantity: 10, revision: 1 }
  initial[9] = { ...initial[9], state: 'issue', counted_quantity: 8, reason: khmer ? 'ធ្លាក់ពីធ្នើ' : 'Fell off the shelf', revision: 1 }
  const InventoryCheckRows = RowsModule.default
  const InventoryCheckSheetHeader = RowsModule.InventoryCheckSheetHeader
  window.__saves = []
  window.__refuse = ''
  function Fixture() {
    const [observations, setObservations] = useState(initial)
    const [focusRequest, setFocusRequest] = useState(undefined)
    window.__scan = (id, target) => setFocusRequest({ id, token: String(Math.random()), target })
    const onSave = async (id, patch, expectedRevision) => {
      window.__saves.push({ id: Number(id), patch, expectedRevision })
      if (window.__refuse === 'requires_issue') { window.__refuse = ''; throw Object.assign(new Error('refused'), { code: 'inventory_check_count_requires_issue', status: 409 }) }
      setObservations(previous => ({ ...previous, [id]: { ...previous[id], state: patch.state, ...(Object.hasOwn(patch, 'counted_quantity') ? { counted_quantity: patch.counted_quantity } : {}), reason: patch.reason ?? null, revision: previous[id].revision + 1 } }))
    }
    const flags = { canCheck: editable, canViewStock: showStock, canViewCounts: true }
    return <>
      {external ? <InventoryCheckSheetHeader {...flags} inSession t={t} /> : null}
      <InventoryCheckRows products={products} observations={observations} sheetHeader={external ? 'external' : 'inline'} {...flags} t={t}
        reasonSuggestions={reasons} focusRequest={focusRequest} onOpenProduct={() => {}} onSave={onSave} />
    </>
  }
  // The list: what the page does with the list rows, kept small so what is measured is the rows and the bar.
  function ListFixture() {
    const [drafts, setDrafts] = useState({})
    const [focusRequest, setFocusRequest] = useState(undefined)
    window.__scan = (id, target) => setFocusRequest({ id, token: String(Math.random()), target })
    window.__drafts = drafts
    const patch = (product, change) => setDrafts(previous => {
      const current = previous[String(product.id)] ?? { selected: false, count: '', checked: false, note: '' }
      return { ...previous, [String(product.id)]: { ...current, ...change(current) } }
    })
    const selectable = listProducts.filter(product => !product.is_group)
    const selectedCount = Object.values(drafts).filter(draft => draft.selected).length
    return <>
      {editable ? <ListModule.InventoryCheckSelectionBar selectedCount={selectedCount} blocked="" busy={false} canMarkChecked={showStock}
        onMarkChecked={() => setDrafts(previous => Object.fromEntries(selectable.map(product => [String(product.id), previous[String(product.id)]?.count ? previous[String(product.id)] : { ...(previous[String(product.id)] ?? { note: '' }), selected: true, count: String(product.quantity), checked: true }])))} onClear={() => setDrafts({})} onSubmit={() => { window.__submitted = (window.__submitted || 0) + 1 }} t={t} /> : null}
      <ListModule.InventoryCheckListHeader selecting={editable} canViewStock={showStock} canViewCounts={showStock} t={t} />
      <ListModule.default products={listProducts} drafts={drafts} selecting={editable} canViewStock={showStock} canViewCounts={showStock} focusRequest={focusRequest} t={t} onOpenProduct={() => {}}
        priceText={usd => '$' + Number(usd).toFixed(2)} promotionRules={[]} exchangeRate={4100}
        onCount={(product, value) => patch(product, current => ({ count: value, checked: false, selected: value.trim() !== '' ? true : current.selected }))}
        onMatches={product => patch(product, () => ({ count: String(product.quantity), checked: true, selected: true }))}
        onDiffers={product => patch(product, () => ({ count: '', checked: false, selected: true }))}
        onClear={product => patch(product, () => ({ count: '', checked: false, selected: false, note: '' }))}
        onNote={(product, value) => patch(product, () => ({ note: value }))} />
    </>
  }
  createRoot(document.getElementById('root')).render(<div style={{ display: 'flex', height: '100vh' }}>
    {sidebar ? <aside style={{ width: sidebar, flex: 'none', background: '#e5e7eb' }} /> : null}
    <div className="page-scroll min-w-0 flex-1 p-3" data-fixture-scroller>{list ? <ListFixture /> : <Fixture />}</div>
  </div>)
`

const packs = Object.fromEntries(['en', 'km'].map(lang => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8')) as Record<string, string>]))
const browser = await launchResolveFixture('inventory-count-sheet', fixture)
const row = (id: number | string) => `[data-inventory-check-row="${id}"]`
const ready = `document.querySelector('[data-inventory-check-row="1"]')`
const visible = `(node) => node.getClientRects().length > 0`
const focusedIn = (selector: string) => `(() => { const node = document.querySelector(${JSON.stringify(selector)}); return !!node && node === document.activeElement })()`
const type = async (text: string) => { await browser.send('Input.insertText', { text }) }
const saves = () => browser.evaluate<Array<{ id: number; patch: Record<string, unknown>; expectedRevision: number }>>('window.__saves')
const waitFor = async (label: string, expression: string) => { await browser.waitFor(label, async () => (await browser.evaluate<boolean>(expression)) ? true : null, 8000) }
const lefts = (selector: string) => browser.evaluate<number[]>(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter(${visible}).map(node => Math.round(node.getBoundingClientRect().left * 10) / 10)`)
const noSidewaysScroll = async (label: string) => {
  const measured = await browser.evaluate<{ document: number; scroller: number; rows: number }>(`(() => { const scroller = document.querySelector('[data-fixture-scroller]'); return { document: document.documentElement.scrollWidth - innerWidth, scroller: scroller.scrollWidth - scroller.clientWidth, rows: Math.max(...Array.from(document.querySelectorAll('[data-inventory-check-row]'), node => node.scrollWidth - node.clientWidth)) } })()`)
  assert.ok(measured.document <= 0 && measured.scroller <= 0 && measured.rows <= 1, `${label}: no sideways scroll (${JSON.stringify(measured)})`)
}

await browser.run('PASS Inventory count sheet and list: aligned columns, count entry, editor, scan focus, selection bar and 44px phone rows in English and Khmer', async () => {
  // ---- 1280px beside the 220px sidebar: every column on the sheet ---------------------------------------------------------
  // The first load pays Vite's cold transform of the whole row tree; on a busy machine that can outlast open()'s wait, and the retry is warm.
  await browser.open(1280, 'lang=en&sidebar=220', ready, 760).catch(() => browser.open(1280, 'lang=en&sidebar=220', ready, 760))
  await noSidewaysScroll('1280 sheet')
  const columns: Record<string, number[]> = {}
  for (const field of ['now', 'start', 'count-input']) columns[field] = await lefts(`[data-inventory-check-row] [data-cell="${field}"]`)
  columns.actions = await lefts('[data-inventory-check-row] [data-check-actions]')
  for (const [field, xs] of Object.entries(columns)) {
    assert.ok(xs.length >= 10, `${field}: drawn on every row, empty cells included (${xs.length})`)
    // The family header row carries no count and no actions, so it can only be missing from those two.
    assert.equal(new Set(xs).size, 1, `${field}: every row starts the cell at the same x (${[...new Set(xs)].join(', ')})`)
  }
  const headerLefts = await browser.evaluate<number[]>(`Array.from(document.querySelector('[data-inventory-check-sheet-header]').children, node => Math.round(node.getBoundingClientRect().left * 10) / 10)`)
  assert.deepEqual(headerLefts.slice(1, 5), [columns.now[0], columns.start[0], columns['count-input'][0], columns.actions[0]], 'the header titles sit over the cells they name')
  assert.deepEqual(await browser.evaluate('Array.from(document.querySelector("[data-inventory-check-sheet-header]").children, node => node.textContent)'), ['Product', 'Now', 'Start', 'Count', ''], 'the owner’s session columns, nothing about money or sales')
  assert.equal(await browser.evaluate('document.querySelectorAll("[data-inventory-check-sheet-header]").length'), 1, 'one inline header over a list of several products')
  // Damage is a chip beside Now on the one row that has it, and the cell still holds it.
  assert.deepEqual(await browser.evaluate<string[]>(`Array.from(document.querySelectorAll('[data-damaged]'), node => node.textContent + '|' + node.closest('[data-cell]').dataset.cell + '|' + node.closest('[data-inventory-check-row]').dataset.inventoryCheckRow)`), ['Damaged 1|now|2'])
  assert.equal(await browser.evaluate(`Array.from(document.querySelectorAll('[data-inventory-check-row] [data-cell="now"]')).filter(node => node.scrollWidth > node.clientWidth + 1).length`), 0, 'the damaged chip fits inside the Now cell')
  // On the sheet a title is the column header, not a label beside every figure.
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('${row(1)} [data-cell="now"] > span:first-child > span')).position`), 'absolute', 'row titles are screen-reader only on the sheet')

  // ---- Count entry: equal to Now saves Done with the count, then moves to the next row's Count ---------------------------
  await browser.mouseClick(`${row(1)} [data-check-count]`)
  assert.equal(await browser.evaluate(`document.querySelector('${row(1)} [data-check-count]').placeholder`), '10', 'Now is the placeholder')
  await type('10'); await browser.press('Enter')
  await waitFor('Done saved', `window.__saves.length === 1`)
  assert.deepEqual((await saves())[0], { id: 1, patch: { state: 'done', counted_quantity: 10, reason: null }, expectedRevision: 0 })
  await waitFor('row 1 done', `document.querySelector('${row(1)}').dataset.checkState === 'done'`)
  await waitFor('focus moved on', focusedIn(`${row(2)} [data-check-count]`))
  assert.equal(await browser.evaluate(`document.querySelector('${row(1)}').className.includes('border-l-emerald-500')`), true, 'a done row has an emerald left edge')

  // A different count saves nothing: the editor opens with that count and Reason focused; Enter in Reason saves the issue.
  await type('9'); await browser.press('Enter')
  await waitFor('editor open', `!!document.querySelector('${row(2)} [data-inventory-check-editor]')`)
  assert.equal((await saves()).length, 1, 'a count that differs from stock is never saved by the count field alone')
  await waitFor('reason focused', focusedIn(`#inventory-check-reason-2`))
  assert.equal(await browser.evaluate(`document.querySelector('#inventory-check-count-2').value`), '9')
  assert.equal(await browser.evaluate(`document.querySelector('${row(2)} [data-check-submit]').dataset.checkSubmit`), 'issue')
  await type('Fell off shelf'); await browser.press('Enter')
  await waitFor('issue saved', `window.__saves.length === 2`)
  assert.deepEqual((await saves())[1], { id: 2, patch: { state: 'issue', counted_quantity: 9, reason: 'Fell off shelf' }, expectedRevision: 0 })
  await waitFor('editor closed', `!document.querySelector('${row(2)} [data-inventory-check-editor]')`)
  assert.equal(await browser.evaluate(`document.querySelector('${row(2)}').className.includes('border-l-amber-500')`), true, 'an issue row has an amber left edge')

  // Empty is Done without a count; the same count again changes nothing; Escape drops what was typed; the arrows step by one from Now.
  await browser.mouseClick(`${row(11)} [data-check-count]`)
  await browser.press('ArrowDown')
  assert.equal(await browser.evaluate(`document.querySelector('${row(11)} [data-check-count]').value`), '7', 'ArrowDown steps down from Now (8)')
  await browser.press('ArrowUp'); await browser.press('ArrowUp')
  assert.equal(await browser.evaluate(`document.querySelector('${row(11)} [data-check-count]').value`), '9')
  await browser.press('Escape')
  assert.equal(await browser.evaluate(`document.querySelector('${row(11)} [data-check-count]').value`), '', 'Escape drops the typed count')
  await browser.press('Enter')
  await waitFor('empty is Done', `window.__saves.length === 3`)
  assert.deepEqual((await saves())[2], { id: 11, patch: { state: 'done', counted_quantity: null, reason: null }, expectedRevision: 0 })
  await browser.mouseClick(`${row(8)} [data-check-count]`)
  assert.equal(await browser.evaluate(`document.querySelector('${row(8)} [data-check-count]').value`), '10', 'a saved count fills the field')
  await browser.press('Enter')
  await browser.pause(300)
  assert.equal((await saves()).length, 3, 'the saved count again is not a new request')

  // A count the server refuses as equal-to-stock opens the editor with that number.
  await browser.mouseClick(`${row(12)} [data-check-count]`)
  await browser.evaluate(`window.__refuse = 'requires_issue'`)
  await type('9'); await browser.press('Enter')
  await waitFor('refusal reaches the editor', `!!document.querySelector('${row(12)} [data-inventory-check-editor]')`)
  assert.equal(await browser.evaluate(`document.querySelector('#inventory-check-count-12').value`), '9')
  await waitFor('reason focused after refusal', focusedIn(`#inventory-check-reason-12`))
  await browser.press('Escape')
  await waitFor('refusal editor closed', `!document.querySelector('${row(12)} [data-inventory-check-editor]')`)

  // ---- The editor: stepper, difference, primary button, chips ---------------------------------------------------------------
  await browser.mouseClick(`${row(3)} [data-check-action="issue"]`)
  await waitFor('editor 3', `!!document.querySelector('${row(3)} [data-inventory-check-editor]')`)
  const submit = `document.querySelector('${row(3)} [data-check-submit]').dataset.checkSubmit`
  assert.equal(await browser.evaluate(`document.querySelector('#inventory-check-count-3').value`), '10', 'the count starts at Now')
  assert.equal(await browser.evaluate(submit), 'done', 'equal to Now with no reason is Done')
  assert.equal(await browser.evaluate(`document.activeElement.id`), 'inventory-check-count-3', 'a mouse opens the editor on the count')
  await browser.mouseClick(`${row(3)} [aria-label="${packs.en.decreaseQty}"]`)
  assert.equal(await browser.evaluate(`document.querySelector('#inventory-check-count-3').value`), '9')
  assert.equal(await browser.evaluate(`document.querySelector('${row(3)} [role="img"][aria-label^="${packs.en.inventory_check_difference}"]').getAttribute('aria-label')`), `${packs.en.inventory_check_difference}: −1`)
  assert.equal(await browser.evaluate(submit), 'issue', 'a different count is saved as an issue')
  await browser.mouseClick(`${row(3)} [aria-label="${packs.en.increaseQty}"]`)
  assert.equal(await browser.evaluate(`document.querySelector('#inventory-check-count-3').value`), '10')
  assert.equal(await browser.evaluate(submit), 'done')
  const chips = await browser.evaluate<string[]>(`Array.from(document.querySelectorAll('${row(3)} [role="group"][aria-label="${packs.en.inventory_check_reason_suggestions}"] button'), node => node.textContent)`)
  assert.deepEqual(chips, ['Damaged', 'Missing', 'Expired', 'Wrong barcode', 'Leaking', 'Torn box', 'Short dated', 'Other'], 'at most eight reasons, a repeat in another case dropped')
  await browser.mouseClick(`${row(3)} [data-inventory-check-editor] button[aria-pressed]:nth-child(2)`)
  assert.equal(await browser.evaluate(`document.querySelector('#inventory-check-reason-3').value`), 'Missing', 'tapping a chip replaces the reason')
  assert.equal(await browser.evaluate(submit), 'issue', 'a reason makes it an issue even when the count matches')
  await browser.press('Escape')
  await waitFor('editor 3 closed', `!document.querySelector('${row(3)} [data-inventory-check-editor]')`)
  assert.equal((await saves()).length, 4, 'Escape cancels without saving')

  // ---- More of what a row knows: unit, stock records, expiry --------------------------------------------------------------
  assert.equal(await browser.evaluate(`document.querySelector('${row(3)}').textContent.includes('bottles')`), true, 'the unit follows Now')
  assert.equal(await browser.evaluate(`!!document.querySelector('${row(3)} [data-cell="now"] button[aria-label="${packs.en.inventory_check_stock_inconsistent_hint}"]')`), false, 'the retired stock-records hint is not drawn, even for a row the older list marks stock_consistent: false')
  assert.equal(await browser.evaluate(`!!document.querySelector('${row(1)} [data-cell="now"] button')`), false, 'and no row has a button in its Now cell')
  assert.deepEqual(await browser.evaluate<string[]>(`Array.from(document.querySelectorAll('[data-expiry]'), node => node.dataset.expiry)`), ['expired', 'soon', 'ok'], 'expiry shows as a badge: past, within 30 days, later')
  assert.equal(await browser.evaluate(`document.querySelector('${row(4)} [data-expiry]').textContent`), `${packs.en.inventory_check_expired} 01/2001`)

  // ---- A scan request: ring + focus (count / tick) or ring only, always in view ---------------------------------------------
  await browser.evaluate(`window.__scan(14, 'count')`)
  await waitFor('count focused', focusedIn(`${row(14)} [data-check-count]`))
  assert.equal(await browser.evaluate(`document.querySelector('[data-scan-hit]') === document.querySelector('${row(14)}')`), true, 'the row carries data-scan-hit')
  const inView = (id: number) => browser.evaluate<boolean>(`(() => { const r = document.querySelector('${row(id)}').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight })()`)
  assert.equal(await inView(14), true, 'and is scrolled into view')
  await browser.evaluate(`window.__scan(5, 'action')`)
  await waitFor('tick focused', focusedIn(`${row(5)} [data-check-action="done"]`))
  assert.equal(await inView(5), true)
  await browser.mouseClick(`${row(13)} [data-check-count]`)
  await browser.evaluate(`window.__scan(1, 'none')`)
  await waitFor('ring on row 1', `document.querySelector('[data-scan-hit]') === document.querySelector('${row(1)}')`)
  assert.equal(await browser.evaluate(`document.querySelector('${row(1)}').contains(document.activeElement)`), false, "target 'none' moves no focus")
  assert.equal(await inView(1), true)
  await waitFor('ring fades', `document.querySelector('[data-scan-hit]') === null`)

  // ---- Nothing about money or sales exists on the sheet ---------------------------------------------------------------------
  for (const field of ['price', 'cost', 'sold', 'customers', 'damaged']) assert.equal(await browser.evaluate(`document.querySelectorAll('[data-cell="${field}"]').length`), 0, `no ${field} cell`)
  assert.equal(await browser.evaluate(`/Price|Cost|Sold|Cust|4\\.5|2\\.1/.test(document.querySelector('[data-fixture-scroller]').textContent)`), false, 'no price, cost, sold or customer figure or title')
  // Stock hidden: blind counting keeps its editor and drops the Count input, Now, Start and Damaged.
  await browser.open(1280, 'lang=en&sidebar=220&stock=0', ready, 760)
  for (const field of ['now', 'start', 'count-input']) assert.equal(await browser.evaluate(`document.querySelectorAll('[data-cell="${field}"]').length`), 0, `blind: no ${field} cell`)
  assert.equal(await browser.evaluate(`document.querySelectorAll('[data-damaged]').length`), 0, 'blind: no damaged chip either')
  await browser.mouseClick(`${row(1)} [data-check-action="issue"]`)
  await waitFor('blind editor', `!!document.querySelector('${row(1)} [data-inventory-check-editor]')`)
  assert.equal(await browser.evaluate(`document.querySelector('#inventory-check-count-1').value`), '', 'a blind counter starts from nothing')
  assert.equal(await browser.evaluate(`document.querySelectorAll('${row(1)} [role="img"][aria-label^="${packs.en.inventory_check_difference}"]').length`), 0, 'and sees no difference')
  assert.equal(await browser.evaluate(`document.querySelector('${row(1)} [data-check-submit]').dataset.checkSubmit`), 'issue')

  // ---- 1024px beside the sidebar: the columns that fit, still aligned, no sideways scroll ---------------------------------------
  await browser.open(1024, 'lang=en&sidebar=220', ready, 760)
  await noSidewaysScroll('1024 sheet')
  for (const field of ['now', 'start', 'count-input']) assert.equal(new Set(await lefts(`[data-inventory-check-row] [data-cell="${field}"]`)).size, 1, `${field} lines up at 1024px`)
  assert.equal(await browser.evaluate(`Array.from(document.querySelectorAll('[data-inventory-check-row] [data-cell="now"]')).filter(node => node.scrollWidth > node.clientWidth + 1).length`), 0, 'the damaged chip fits inside the Now cell at 1024px')
  assert.equal(await browser.evaluate(`Array.from(document.querySelector('[data-inventory-check-sheet-header]').children).filter(${visible}).length`), 5, 'the header shows product, Now, Start, Count and the actions cell')

  // ---- 1280px in Khmer: the same columns, titles that fit their cells, glyphs with room ------------------------------------
  await browser.open(1280, 'lang=km&sidebar=220', ready, 760)
  await noSidewaysScroll('km 1280 sheet')
  for (const field of ['now', 'start', 'count-input']) assert.equal(new Set(await lefts(`[data-inventory-check-row] [data-cell="${field}"]`)).size, 1, `km: ${field} lines up beside a long Khmer unit and name`)
  assert.equal(await browser.evaluate(`Array.from(document.querySelectorAll('[data-inventory-check-row] [data-cell="now"]')).filter(node => node.scrollWidth > node.clientWidth + 1).length`), 0, 'km: the damaged chip fits inside the Now cell')
  const clippedTitles = await browser.evaluate<string[]>(`Array.from(document.querySelector('[data-inventory-check-sheet-header]').children).filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent)`)
  assert.deepEqual(clippedTitles, [], 'km: every column title fits its column')
  await browser.khmerRoom('1280px count sheet', '[data-fixture-scroller]', 12)

  // ---- An external header is the page's to mount: the list draws none -------------------------------------------------------
  await browser.open(1280, 'lang=en&sidebar=220&header=external', ready, 760)
  assert.equal(await browser.evaluate(`document.querySelectorAll('[data-inventory-check-sheet-header]').length`), 1, 'only the page-mounted header')

  // ---- The list: the owner's columns, a check box before each image, counts typed in the rows, one selection bar -----------------
  await browser.open(1280, 'lang=en&sidebar=220&mode=list', ready, 760)
  await noSidewaysScroll('1280 list')
  const listColumns: Record<string, number[]> = {}
  for (const field of ['now', 'status', 'counted', 'count-input', 'last']) listColumns[field] = await lefts('[data-inventory-check-row] [data-cell="' + field + '"]')
  for (const [field, xs] of Object.entries(listColumns)) {
    assert.ok(xs.length >= 10, 'list ' + field + ': drawn on every row, empty cells included (' + xs.length + ')')
    assert.equal(new Set(xs).size, 1, 'list ' + field + ': every row starts the cell at the same x (' + [...new Set(xs)].join(', ') + ')')
  }
  assert.deepEqual(await browser.evaluate('Array.from(document.querySelector("[data-inventory-check-sheet-header]").children, node => node.textContent)'), ['', 'Product', 'Now', 'Status', 'Counted', 'Count', 'Last checked'], 'the owner’s list columns, after the image cell (there is no check box column any more)')
  assert.deepEqual(await browser.evaluate<number[]>('Array.from(document.querySelector("[data-inventory-check-sheet-header]").children, node => Math.round(node.getBoundingClientRect().left * 10) / 10)').then(xs => xs.slice(2)), [listColumns.now[0], listColumns.status[0], listColumns.counted[0], listColumns['count-input'][0], listColumns.last[0]], 'and each title sits over its cells')
  const nameLeft = await browser.evaluate<number>('Math.round(document.querySelector("[data-inventory-check-row=\\"1\\"] [data-check-image]").getBoundingClientRect().right)')
  assert.ok(await browser.evaluate<number>('Math.round(document.querySelector("[data-inventory-check-sheet-header]").children[0].getBoundingClientRect().right)') <= nameLeft + 1, 'the header leaves room for the image')
  assert.equal(await browser.evaluate('document.querySelectorAll("[data-check-select], [data-check-select-box], input[type=checkbox]").length'), 0, 'no check box: nothing is ticked by default')
  assert.deepEqual(await browser.evaluate<string[]>("Array.from(document.querySelectorAll('[data-check-status-kind]'), node => node.dataset.checkStatusKind).slice(0, 4)"), ['ok', 'issue', 'in_check', 'not_checked'])
  assert.equal(await browser.evaluate("document.querySelector('" + row(1) + " [data-cell=\"last\"]').textContent.includes('@amy') && document.querySelector('" + row(1) + " [data-cell=\"last\"]').textContent.includes(':')"), true, 'who checked it, and the date and time')
  assert.equal(await browser.evaluate("document.querySelector('" + row(2) + " [data-check-note]').textContent"), 'Fell off the shelf', 'an issue shows its note under the row')
  assert.equal(await browser.evaluate("document.querySelectorAll('[data-check-note]').length"), 1, 'and only an issue does')
  assert.equal(await browser.evaluate("document.querySelectorAll('[data-check-action=\"status\"]').length"), 16, 'a status icon on every real product, none on the family header')
  assert.equal(await browser.evaluate("document.querySelectorAll('" + row(20) + " [data-check-action], " + row(20) + " [data-check-count]').length"), 0)
  // A count typed in the row picks it; the status popover's tick fills the stock; a differing count asks for a note; the bar's mark answers the whole page.
  await browser.mouseClick(row(1) + ' [data-check-count]')
  await type('10')
  await waitFor('row 1 picked', 'window.__drafts[1] && window.__drafts[1].selected === true && window.__drafts[1].count === "10"')
  assert.equal(await browser.evaluate("document.querySelector('[data-selected-count]').textContent"), '1 counted')
  assert.equal(await browser.evaluate("document.querySelector('" + row(1) + "').hasAttribute('data-selected')"), true, 'typing a count picks the row')
  await browser.mouseClick(row(3) + ' [data-check-action="status"]')
  await waitFor('popover open', "document.querySelector('[data-inventory-check-popover]') !== null")
  await browser.mouseClick('[data-popover-action="matches"]')
  await waitFor('row 3 checked', 'window.__drafts[3] && window.__drafts[3].checked === true')
  assert.equal(await browser.evaluate("document.querySelector('" + row(3) + " [data-check-count]').value"), '10', 'the tick fills the stock')
  await browser.mouseClick('[data-popover-action="close"]')
  await waitFor('popover closed', "document.querySelector('[data-inventory-check-popover]') === null")
  await browser.mouseClick(row(2) + ' [data-check-count]')
  await type('7')
  await waitFor('difference note', "document.querySelector('" + row(2) + " [data-check-draft-note]') !== null")
  assert.equal(await browser.evaluate("document.querySelector('" + row(2) + " [data-check-difference]').textContent"), '−5', 'the difference is shown with its sign')
  await noSidewaysScroll('1280 list with a note open')
  await browser.mouseClick('[data-selection-action="mark"]')
  await waitFor('page marked', 'document.querySelector("[data-selected-count]").textContent === "16 counted"')
  assert.equal(await browser.evaluate("document.querySelectorAll('[data-inventory-check-row][data-selected]').length"), 16, 'every real product on the page is answered')
  assert.equal(await browser.evaluate("document.querySelector('" + row(2) + " [data-check-count]').value"), '7', 'a count already typed is never overwritten by the page mark')
  await browser.mouseClick('[data-selection-action="submit"]')
  assert.equal(await browser.evaluate('window.__submitted'), 1, 'Submit reaches the page')
  await browser.mouseClick('[data-selection-action="clear"]')
  await waitFor('cleared', 'document.querySelector("[data-selected-count]").textContent === ""')
  const bar = await browser.evaluate<{ height: number; sub: number; overflow: number }>("(() => { const bar = document.querySelector('[data-inventory-check-selection-bar]'); return { height: bar.getBoundingClientRect().height, sub: document.querySelector('[data-selection-action=\"submit\"]').getBoundingClientRect().height, overflow: bar.scrollWidth - bar.clientWidth } })()")
  assert.ok(bar.height <= 48 && bar.overflow <= 0, 'the selection bar is one line (' + JSON.stringify(bar) + ')')
  await browser.open(1024, 'lang=en&sidebar=220&mode=list', ready, 760)
  await noSidewaysScroll('1024 list')
  assert.deepEqual(await browser.evaluate("Array.from(document.querySelector('[data-inventory-check-sheet-header]').children).filter(" + visible + ").map(node => node.textContent)"), ['', 'Product', 'Now', 'Status', 'Counted', 'Count'], 'Last checked waits for 1280px')
  // Stock hidden: no Now, no Counted, no check button; counting stays. A viewer who may not count has no controls at all.
  await browser.open(1280, 'lang=en&sidebar=220&mode=list&stock=0', ready, 760)
  for (const field of ['now', 'counted']) assert.equal(await browser.evaluate("document.querySelectorAll('[data-cell=\"" + field + "\"]').length"), 0, 'blind list: no ' + field + ' cell')
  assert.equal(await browser.evaluate("document.querySelectorAll('[data-damaged]').length"), 0, 'blind list: no damaged chip')
  assert.ok(await browser.evaluate<number>("document.querySelectorAll('[data-check-count]').length") > 0, 'blind list: the count input stays')
  await browser.open(1280, 'lang=en&sidebar=220&mode=list&check=0', ready, 760)
  assert.equal(await browser.evaluate("document.querySelectorAll('[data-check-count], [data-check-action], [data-inventory-check-selection-bar]').length"), 0, 'a viewer who may not count has no controls')
  // Phone: a square image on the left, the status icon and the count input beside the name, every control at least 40px.
  await browser.open(360, 'lang=en&mode=list', ready, 740)
  await noSidewaysScroll('en 360 list')
  const phonePrices = await browser.evaluate<string>("Array.from(document.querySelectorAll('" + row(2) + " [data-price]'), node => node.textContent.replace(/\\s+/g, ' ').trim()).join(' | ')")
  assert.equal(phonePrices, packs.en.selling_price + ' $12.50 | ' + packs.en.wholesale_price + ' $10.00 | ' + packs.en.promotion + ' $11.25', 'a phone row (long name) carries selling, wholesale and the live promotion price, labels inside (' + phonePrices + ')')
  const listFacts = await browser.evaluate<string>("document.querySelector('" + row(1) + " [data-inventory-check-meta]').textContent.replace(/\\s+/g, ' ').trim()")
  assert.ok(listFacts.includes('Counted 10') && listFacts.includes('Last checked @amy'), 'a phone reads the same facts in one line (' + listFacts + ')')
  const tall = await browser.evaluate<{ image: number[]; info: number[]; side: number[]; count: boolean }>("(() => { const r = document.querySelector('" + row(2) + "'); const box = node => { const b = node.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom), Math.round(b.left), Math.round(b.right)] }; const meta = r.querySelector('[data-inventory-check-meta]'); return { image: box(r.querySelector('[data-check-image]')), info: box(meta.parentElement), side: box(r.querySelector('[data-inventory-check-side]')), count: r.querySelector('[data-check-count]').getClientRects().length > 0 } })()")
  assert.ok(Math.abs((tall.image[1] - tall.image[0]) - (tall.image[3] - tall.image[2])) <= 1, 'the image keeps its square, never stretched to the facts (' + JSON.stringify(tall) + ')')
  assert.ok(tall.side[2] >= tall.info[3] - 1 || tall.side[0] < tall.image[1], 'the status icon and count input sit beside the text, not under it (' + JSON.stringify(tall) + ')')
  assert.equal(tall.count, true, 'the count input is on the phone row')
  const small = await browser.evaluate<string[]>("Array.from(document.querySelectorAll('[data-inventory-check-row] button, [data-inventory-check-row] input, [data-inventory-check-selection-bar] button')).filter(node => !node.closest('[data-cell=\"now\"]')).filter(node => { const r = (node.closest('label') || node).getBoundingClientRect(); return r.width > 0 && (r.width < 40 || r.height < 40) }).map(node => node.getAttribute('aria-label') || node.tagName)")
  assert.deepEqual(small, [], 'every tap target on the phone list is at least 40px each way')
  const smallButtons = await browser.evaluate<string[]>("Array.from(document.querySelectorAll('[data-inventory-check-row] button, [data-inventory-check-selection-bar] button')).filter(node => !node.closest('[data-cell=\"now\"]')).filter(node => { const r = node.getBoundingClientRect(); return r.width > 0 && (r.width < 44 || r.height < 44) }).map(node => node.getAttribute('aria-label') || node.textContent)")
  assert.deepEqual(smallButtons, [], 'and every button is 44px')
  await browser.mouseClick(row(2) + ' [data-check-count]')
  await type('7')
  await waitFor('phone note', "document.querySelector('" + row(2) + " [data-check-draft-note]') !== null")
  await noSidewaysScroll('en 360 list with a note open')
  await browser.open(1280, 'lang=km&sidebar=220&mode=list', ready, 760)
  await noSidewaysScroll('km 1280 list')
  assert.equal(await browser.evaluate("Array.from(document.querySelector('[data-inventory-check-sheet-header]').children).filter(node => node.scrollWidth > node.clientWidth + 1).length"), 0, 'km list: every column title fits its column')
  await browser.khmerRoom('1280px list', '[data-fixture-scroller]', 12)
  await browser.open(360, 'lang=km&mode=list', ready, 740)
  await noSidewaysScroll('km 360 list')
  const phonePricesKm = await browser.evaluate<string>("Array.from(document.querySelectorAll('" + row(2) + " [data-price]'), node => node.textContent.replace(/\\s+/g, ' ').trim()).join(' | ')")
  assert.equal(phonePricesKm, packs.km.selling_price + ' $12.50 | ' + packs.km.wholesale_price + ' $10.00 | ' + packs.km.promotion + ' $11.25', 'km: the same three prices with the Khmer labels (' + phonePricesKm + ')')
  await browser.khmerRoom('360px list', '[data-fixture-scroller]', 12)

  // ---- 360px, English and Khmer ------------------------------------------------------------------------------------------------
  for (const lang of ['en', 'km']) {
    const pack = packs[lang]
    await browser.open(360, `lang=${lang}`, ready, 740)
    await noSidewaysScroll(`${lang} 360`)
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-inventory-check-sheet-header]').length && Array.from(document.querySelectorAll('[data-inventory-check-sheet-header]')).some(${visible})`), false, `${lang}: no column header on a phone`)
    assert.equal(await browser.evaluate(`Array.from(document.querySelectorAll('[data-check-count]')).some(${visible})`), false, `${lang}: the Count input is a sheet control`)
    const small = await browser.evaluate<string[]>(`Array.from(document.querySelectorAll('[data-inventory-check-row] button[title]')).filter(node => { const r = node.getBoundingClientRect(); return r.width < 44 || r.height < 44 }).map(node => node.getAttribute('aria-label'))`)
    assert.deepEqual(small, [], `${lang}: tick, issue and image buttons are 44px or more`)
    const gap = await browser.evaluate<number>(`(() => { const [tick, issue] = document.querySelectorAll('${row(1)} [data-check-action]'); return issue.getBoundingClientRect().left - tick.getBoundingClientRect().right })()`)
    assert.ok(gap >= 3 && gap <= 6, `${lang}: ✓ and ! keep a small gap, not a touching pair (${gap}px)`)
    const facts = await browser.evaluate<string>(`document.querySelector('${row(3)} [data-inventory-check-meta]').textContent.replace(/\\s+/g, ' ').trim()`)
    assert.ok(facts.startsWith(`${pack.inventory_check_now} 10`) && facts.indexOf(pack.inventory_check_start) > facts.indexOf(pack.inventory_check_now), `${lang}: counting facts first, Now then Start (${facts})`)
    assert.ok(!/Price|Cost|Sold|Cust/.test(facts), `${lang}: and nothing about money or sales`)
    await browser.mouseClick(`${row(2)} [data-check-action="issue"]`)
    await waitFor('phone editor', `!!document.querySelector('${row(2)} [data-inventory-check-editor]')`)
    await noSidewaysScroll(`${lang} 360 editor`)
    const editorBox = await browser.evaluate<{ right: number; small: string[]; chips: number }>(`(() => { const editor = document.querySelector('${row(2)} [data-inventory-check-editor]'); const box = editor.getBoundingClientRect(); return { right: box.right, small: Array.from(editor.querySelectorAll('button:not([aria-pressed]), input'), node => node.getBoundingClientRect()).filter(r => r.height < 44).map(r => r.height), chips: editor.querySelectorAll('button[aria-pressed]').length } })()`)
    assert.ok(editorBox.right <= 360, `${lang}: the editor fits the phone (${editorBox.right})`)
    assert.deepEqual(editorBox.small, [], `${lang}: stepper, fields, cancel and the primary button are 44px tall`)
    assert.equal(editorBox.chips, 8, `${lang}: eight reason chips`)
    assert.equal(await browser.evaluate(`document.querySelector('#inventory-check-count-2').placeholder`), pack.inventory_check_count, `${lang}: the label sits inside the count field`)
    assert.equal(await browser.evaluate(`document.querySelector('#inventory-check-reason-2').placeholder`), pack.inventory_check_reason, `${lang}: and inside the reason field`)
    if (lang === 'km') await browser.khmerRoom('360px count sheet', '[data-fixture-scroller]', 12)
  }
})
