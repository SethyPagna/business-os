// T17 (board R7): the one conflict resolver's excel-style grid, driven in a
// real browser inside the real shared Modal, at phone and desktop widths, in
// English and Khmer, light and dark.
//
// What it pins, each against the failure it exists for:
//   - role=grid with rowheaders/columnheaders and aria counts;
//   - the label and Final columns stay pinned (position: sticky, opaque) while
//     the records scroll underneath them -- a transparent pinned column is
//     what the report kit's lazily loaded --ui-* tokens would have produced;
//   - one record per view at 375px with a "1 / 4" indicator that follows the
//     chevrons, three records per view on desktop;
//   - aria-selected follows a pick and Final follows the choice; a press on a
//     copyable value waits for the double-click window and a double-click
//     copies instead of picking;
//   - record names in the header copy (the owner's copy-everywhere rule), and
//     the grid adds no close control of its own: the Modal's X is the one;
//   - roving tabindex: arrows, Home/End and Ctrl+Home/End move exactly one
//     tab stop; Enter/Space pick; Enter/F2 open the Final editor; Escape
//     leaves the editor without changing Final and without closing the modal,
//     and opening Final then leaving it untouched keeps the record pick;
//   - identical rows fold behind "Show all (n)" with aria-expanded;
//   - required rows, per-record options, dispositions inside the grid, locked
//     and masked cells, stale-changed cells, busy = inert;
//   - Khmer rows get Khmer line height, and nothing overflows the page.
//
// Run: node tests/resolveGrid.test.ts
import assert from 'node:assert/strict'
import { CTRL, launchResolveFixture } from './resolveBrowserFixture.ts'

// A products-shaped harness: four records, one of them starting as Keep
// separate, three identical rows, a required row answered through options, a
// locked cost row with a masked and an invalid cell, and per-record stock
// options. The harness plays the adapter: it keeps the draft and hands the
// grid rows that carry the effective choice.
const fixtureSource = String.raw`
  import React, { useState } from 'react'
  import { createRoot } from 'react-dom/client'
  import ResolveGrid, { resolveCellKey } from '/src/components/shared/ResolveGrid.tsx'
  import Modal from '/src/components/shared/Modal.tsx'
  import { AppContext, FALLBACK_APP_CONTEXT } from '/src/app/AppContextCore.tsx'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '@fontsource/noto-sans-khmer/400.css'
  import '@fontsource/noto-sans-khmer/500.css'
  import '@fontsource/noto-sans-khmer/600.css'
  import '/src/styles/main.css'

  const params = new URLSearchParams(location.search)
  const lang = params.get('lang') || 'en'
  const pack = lang === 'km' ? km : en
  const t = (key) => pack[key] || key
  document.body.className = lang === 'km' ? 'lang-km' : ''
  if (params.get('theme') === 'dark') document.documentElement.classList.add('dark')
  const log = window.__log = { select: [], disposition: [] }

  const COLUMNS = [
    { id: 'p1', title: 'Maybelline Fit Me Matte + Poreless Foundation 30ml', subtitle: '#101 · 12' },
    { id: 'p2', title: 'Fit Me Foundation 30ml', subtitle: '#102 · 3' },
    { id: 'p3', title: 'FIT ME 30ML', subtitle: '#103 · 0', warning: 'Tagged: damaged', start: 'separate' },
    { id: 'p4', title: 'Fit me', subtitle: '#104 · 1' },
  ]
  const VALUES = {
    name: ['Maybelline Fit Me Matte + Poreless Foundation 30ml', 'Fit Me Foundation 30ml', 'FIT ME 30ML', 'Fit me'],
    barcode: ['8850000000011', '8850000000011', '', '0885000000001'],
    brand: ['MAC', 'Mac', 'MaC', 'MAC'],
    category: ['Foundation', 'Foundation', 'Foundation', 'Foundation'],
    unit: ['pcs', 'pcs', 'pcs', 'pcs'],
    selling: [12, 11.5, 12, 10],
    wholesale: [9, 9, 9, 9],
  }
  const STOCK = { p1: 12, p2: 3, p3: 0, p4: 1 }
  const money = (value) => '$' + Number(value).toFixed(2)
  const dispositionOf = (disp, column) => (disp[column.id] && disp[column.id].disposition) || column.start || 'include'

  function buildColumns(disp) {
    return COLUMNS.map((column) => ({
      id: column.id, title: column.title, subtitle: column.subtitle, warning: column.warning,
      disposition: dispositionOf(disp, column),
      dispositions: ['include', 'separate', 'remove'],
      removeReason: disp[column.id] && disp[column.id].reason,
    }))
  }

  function buildRows(choices, disp) {
    const included = COLUMNS.filter((column) => dispositionOf(disp, column) === 'include')
    const valueRow = (key, label, spec) => {
      const format = spec.format || ((value) => value)
      const cells = {}
      COLUMNS.forEach((column, index) => { cells[column.id] = { text: format(VALUES[key][index]) } })
      const fallback = spec.highest
        ? included.slice().sort((a, b) => VALUES[key][COLUMNS.indexOf(b)] - VALUES[key][COLUMNS.indexOf(a)])[0]
        : included[0]
      const choice = choices[key] || (fallback ? { source: fallback.id } : undefined)
      let text = ''
      if (choice && 'source' in choice) text = cells[choice.source].text
      if (choice && 'custom' in choice) text = format(choice.custom)
      if (choice && 'option' in choice) text = ''
      const identical = new Set(included.map((column) => cells[column.id].text)).size <= 1
      return Object.assign({ key, label, kind: 'choice', cells, choice, final: { text }, identical }, spec.row || {})
    }
    const stockChoice = (column) => (choices[resolveCellKey('stock', column.id)] || { option: 'carry' }).option
    const carried = included.filter((column) => column.id === 'p1' || stockChoice(column) === 'carry')
    const sessionChoice = dispositionOf(disp, COLUMNS[1]) !== 'include' ? { option: 'keep' } : choices.session
    const sessionOptions = [
      { id: 'finalize', label: 'Finalize stock-in #12 and merge' },
      { id: 'keep', label: 'Keep this product separate', disposition: { column: 'p2', value: 'separate' } },
    ]
    return [
      valueRow('name', 'Name', { row: { copyable: true, custom: { kind: 'text' } } }),
      valueRow('barcode', 'Barcode', { row: {
        copyable: true,
        options: [{ id: 'none', label: 'No barcode' }],
        custom: { kind: 'text', validate: (value) => (/^[0-9]+$/.test(value) ? null : 'Digits only') },
      } }),
      valueRow('brand', 'Brand', { row: { copyable: true, custom: { kind: 'suggest', suggestions: ['MAC', 'Maybelline', 'M.A.C'] } } }),
      valueRow('category', 'Category', { row: { custom: { kind: 'suggest', suggestions: ['Foundation', 'Powder'] } } }),
      valueRow('unit', 'Unit', {}),
      valueRow('selling', 'Selling', { format: money, highest: true, row: { custom: {
        kind: 'money',
        normalize: (value) => value.replace(/[$,\s]/g, ''),
        validate: (value) => (value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? null : 'Enter a price'),
      } } }),
      valueRow('wholesale', 'Wholesale', { format: money }),
      {
        key: 'cost', label: 'Cost', kind: 'choice', identical: false,
        locked: 'Needs cost edit permission',
        cells: { p1: { text: '$8.00' }, p2: { text: '$7.50' }, p3: { text: '$-4.00', invalid: true }, p4: { text: '', masked: true } },
        options: [{ id: 'average', label: 'Average' }],
        choice: { option: 'average' },
        final: { text: '$7.75' },
      },
      {
        key: 'stock', label: 'Stock', kind: 'computed', identical: false, hint: 'Stock is added per branch.',
        cells: Object.fromEntries(COLUMNS.map((column) => [column.id, column.id === 'p1'
          ? { text: String(STOCK.p1) }
          : { text: String(STOCK[column.id]), options: [{ id: 'carry', label: 'Carry' }, { id: 'writeoff', label: 'Write off' }], choice: stockChoice(column) }])),
        final: { text: carried.reduce((sum, column) => sum + STOCK[column.id], 0) + ' · ' + carried.length + ' lots' },
      },
      {
        key: 'session', label: 'Stock-in session', kind: 'required', optionsOnly: true, identical: false,
        cells: { p1: { text: '' }, p2: { text: 'Stock-in #12 · 24/09/2026 14:05' }, p3: { text: '' }, p4: { text: '' } },
        options: sessionOptions,
        choice: sessionChoice,
        final: { text: sessionChoice ? sessionOptions.find((option) => option.id === sessionChoice.option).label : '' },
      },
    ]
  }

  function Harness() {
    const [choices, setChoices] = useState({})
    const [disp, setDisp] = useState({})
    const [busy, setBusy] = useState(false)
    const [changed, setChanged] = useState([])
    window.__setBusy = setBusy
    window.__setChanged = setChanged
    return (
      <Modal title="Resolve duplicates" onClose={() => { window.__closed = true }} size="xl" unsavedChanges="read-only">
        <ResolveGrid
          columns={buildColumns(disp)}
          rows={buildRows(choices, disp)}
          changedCells={new Set(changed)}
          busy={busy}
          t={t}
          onSelect={(key, choice) => { log.select.push([key, choice]); setChoices((current) => ({ ...current, [key]: choice })) }}
          onDisposition={(id, disposition, reason) => { log.disposition.push([id, disposition, reason == null ? null : reason]); setDisp((current) => ({ ...current, [id]: { disposition, reason } })) }}
        />
      </Modal>
    )
  }

  createRoot(document.getElementById('root')).render(
    <AppContext.Provider value={{ ...FALLBACK_APP_CONTEXT, t }}><Harness /></AppContext.Provider>,
  )
`

const { send, evaluate, press, mouseClick, waitFor, pause, open: openFixture, khmerRoom, run } = await launchResolveFixture('resolve-grid-fixture', fixtureSource)
const open = (width: number, lang: 'en' | 'km', theme: 'light' | 'dark') => openFixture(width, `lang=${lang}&theme=${theme}`, 'document.querySelector(".resolve-grid tbody [role=rowheader]")')
const assertKhmerRoom = (label: string) => khmerRoom(label, '.resolve-grid-scroll', 10)

const cell = (key: string) => `[data-rg-key="${key}"]`
const active = () => evaluate<string | null>('document.activeElement && document.activeElement.getAttribute("data-rg-key")')
const selected = (key: string) => evaluate<string | null>(`document.querySelector('${cell(key)}').getAttribute('aria-selected')`)
const finalText = (row: string) => evaluate<string>(`document.querySelector('${cell(`${row}|#final`)}').textContent`)
const lastSelect = () => evaluate<[string, Record<string, string>] | null>('window.__log.select.at(-1) || null')
const lastDisposition = () => evaluate<[string, string, string | null] | null>('window.__log.disposition.at(-1) || null')
const headerOrder = () => evaluate<string[]>('[...document.querySelectorAll(".resolve-grid thead th.rg-cell .product-name-rail")].map((node) => node.textContent)')
const rowHeaders = () => evaluate<number>('document.querySelectorAll(".resolve-grid tbody [role=rowheader]").length')

async function assertOneTabStop(label: string): Promise<void> {
  const stops = await evaluate<{ zero: string[]; activeIsZero: boolean }>(`(() => {
    const zero = [...document.querySelectorAll('.resolve-grid [data-rg-key][tabindex="0"]')].map((node) => node.getAttribute('data-rg-key'))
    const activeEl = document.activeElement
    return { zero, activeIsZero: !activeEl || !activeEl.hasAttribute('data-rg-key') || activeEl.getAttribute('tabindex') === '0' }
  })()`)
  assert.equal(stops.zero.length, 1, `${label}: exactly one grid tab stop (saw ${stops.zero.join(', ')})`)
  assert.ok(stops.activeIsZero, `${label}: the focused cell is the tab stop`)
}

type Geometry = {
  scrollerLeft: number; scrollerClientLeft: number; scrollerClientRight: number
  labelLeft: number; finalRight: number; bandLeft: number; bandRight: number
  records: Array<{ left: number; right: number }>
  sticky: string[]; opaque: boolean[]; labelBg: string; pager: string | null
  scrollLeft: number; maxScroll: number; step: number; pageOverflow: number
}
const geometry = () => evaluate<Geometry>(`(() => {
  const scroller = document.querySelector('.resolve-grid-scroll')
  const heads = [...scroller.querySelectorAll('thead th')]
  const bodyLabel = scroller.querySelector('tbody th.rg-label')
  const bodyFinal = scroller.querySelector('tbody td.rg-final')
  const rect = (node) => node.getBoundingClientRect()
  const s = rect(scroller)
  const opaque = (node) => { const parts = getComputedStyle(node).backgroundColor.match(/[0-9.]+/g).map(Number); return parts.length === 3 || parts[3] === 1 }
  const pinned = [heads[0], heads[heads.length - 1], bodyLabel, bodyFinal]
  return {
    scrollerLeft: s.left, scrollerClientLeft: s.left + scroller.clientLeft, scrollerClientRight: s.left + scroller.clientLeft + scroller.clientWidth,
    labelLeft: rect(heads[0]).left, finalRight: rect(heads[heads.length - 1]).right,
    bandLeft: rect(heads[0]).right, bandRight: rect(heads[heads.length - 1]).left,
    records: heads.slice(1, -1).map((node) => ({ left: rect(node).left, right: rect(node).right })),
    sticky: pinned.map((node) => getComputedStyle(node).position),
    opaque: pinned.map(opaque),
    labelBg: getComputedStyle(bodyLabel).backgroundColor,
    pager: document.querySelector('[data-rg-pager]') ? document.querySelector('[data-rg-pager]').textContent : null,
    scrollLeft: scroller.scrollLeft, maxScroll: scroller.scrollWidth - scroller.clientWidth,
    step: heads[1].offsetWidth,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }
})()`)
const fullyVisible = (g: Geometry) => g.records.filter((r) => r.left >= g.bandLeft - 1 && r.right <= g.bandRight + 1).length

async function assertPinnedAndPaged(label: string, expectPerView: number, theme: 'light' | 'dark'): Promise<void> {
  const start = await geometry()
  assert.deepEqual(start.sticky, ['sticky', 'sticky', 'sticky', 'sticky'], `${label}: label and Final columns are sticky`)
  assert.deepEqual(start.opaque, [true, true, true, true], `${label}: pinned cells are opaque, so records never show through`)
  assert.equal(start.labelBg, theme === 'dark' ? 'rgb(31, 41, 55)' : 'rgb(255, 255, 255)', `${label}: pinned cells use the modal surface`)
  assert.equal(start.pageOverflow, 0, `${label}: no page-level horizontal overflow`)
  assert.equal(fullyVisible(start), expectPerView, `${label}: ${expectPerView} record column(s) fully in view`)
  assert.equal(start.pager, expectPerView === 1 ? '1 / 4' : '1–3 / 4', `${label}: pager says where the records are`)
  // Scroll to the far end: the pinned pair must not move with the records.
  await evaluate('document.querySelector(".resolve-grid-scroll").scrollLeft = 99999')
  const end = await waitFor(`${label} scrolled`, async () => { const g = await geometry(); return g.scrollLeft > 0 && g.pager !== start.pager ? g : null })
  assert.ok(end.scrollLeft >= end.maxScroll - 1, `${label}: records scroll to the last one`)
  assert.ok(Math.abs(end.labelLeft - end.scrollerClientLeft) <= 1, `${label}: labels stay pinned left (${end.labelLeft} vs ${end.scrollerClientLeft})`)
  assert.ok(Math.abs(end.finalRight - end.scrollerClientRight) <= 1, `${label}: Final stays pinned right (${end.finalRight} vs ${end.scrollerClientRight})`)
  assert.equal(fullyVisible(end), expectPerView, `${label}: the last record(s) land fully between the pinned columns`)
  assert.equal(end.pager, expectPerView === 1 ? '4 / 4' : '2–4 / 4', `${label}: pager follows the scroll`)
  await evaluate('document.querySelector(".resolve-grid-scroll").scrollLeft = 0')
  await waitFor(`${label} back`, async () => ((await geometry()).pager === start.pager ? true : null))
}

await run('PASS resolve grid: roles, pinned columns, paging, picks, copy, keyboard, editor, folding, required, dispositions, busy at 375/1280 EN/KM light/dark', async () => {
  // ---------------------------------------------------------------- 375 EN
  await open(375, 'en', 'light')
  const structure = await evaluate<any>(`(() => {
    const grid = document.querySelector('[role=dialog] .resolve-grid-scroll table[role=grid]')
    return {
      grids: document.querySelectorAll('table[role=grid]').length,
      colcount: grid.getAttribute('aria-colcount'), rowcount: grid.getAttribute('aria-rowcount'),
      multiselectable: grid.getAttribute('aria-multiselectable'),
      columnheaders: grid.querySelectorAll('thead [role=columnheader]').length,
    }
  })()`)
  assert.deepEqual(structure, { grids: 1, colcount: '6', rowcount: '12', multiselectable: 'true', columnheaders: 6 }, 'grid roles and counts')
  assert.deepEqual(
    await evaluate<string[]>('[...document.querySelectorAll("[role=dialog] button, [role=dialog] [role=button]")].map((node) => node.getAttribute("aria-label") || node.textContent.trim()).filter((label) => /close|cancel|dismiss|back/i.test(label))'),
    ['Close'],
    'the grid adds no close control of its own: the header X is the one close',
  )
  assert.deepEqual(await headerOrder(), ['Maybelline Fit Me Matte + Poreless Foundation 30ml', 'Fit Me Foundation 30ml', 'Fit me', 'FIT ME 30ML'], 'a Keep separate record moves to the end')
  assert.deepEqual(
    await evaluate<string[]>('[...document.querySelectorAll(".resolve-grid thead th.rg-cell")].map((th) => th.querySelector("[data-copy-value]")?.getAttribute("data-copy-value") ?? "")'),
    await headerOrder(),
    'every record name in the header copies like everywhere else',
  )
  await assertPinnedAndPaged('375 en light', 1, 'light')

  // Pager chevrons move one record at a time (smooth scroll: wait to settle).
  await evaluate(`document.querySelector("[aria-label='Next record']").click()`)
  const afterNext = await waitFor('next chevron', async () => {
    const g = await geometry()
    return g.pager === '2 / 4' && Math.abs(g.scrollLeft - g.step) <= 1 && fullyVisible(g) === 1 ? g : null
  })
  assert.ok(afterNext.records[1].left >= afterNext.bandLeft - 1, 'after Next the second record is the one in view')
  await evaluate(`document.querySelector("[aria-label='Previous record']").click()`)
  await waitFor('previous chevron', async () => {
    const g = await geometry()
    return g.pager === '1 / 4' && g.scrollLeft <= 1 ? true : null
  })

  // Mandatory snap: a half-way scroll settles on a record edge.
  const step = (await geometry()).step
  await evaluate(`document.querySelector(".resolve-grid-scroll").scrollLeft = ${Math.round(step * 0.4)}`)
  await pause(400)
  const snapped = (await geometry()).scrollLeft
  assert.ok(Math.abs(snapped) <= 1 || Math.abs(snapped - step) <= 1, `a part scroll snaps to a record edge (scrollLeft ${snapped}, step ${step})`)
  await evaluate('document.querySelector(".resolve-grid-scroll").scrollLeft = 0')

  // Folding: 3 identical rows behind one toggle.
  assert.equal(await rowHeaders(), 7, 'identical rows start folded')
  const fold = cell('#fold')
  assert.equal(await evaluate<string>(`document.querySelector('${fold}').textContent`), '3 matching fields · Show all (3)')
  assert.equal(await evaluate<string>(`document.querySelector('${fold}').getAttribute('aria-expanded')`), 'false')
  await evaluate(`document.querySelector('${fold}').click()`)
  await waitFor('unfold', async () => ((await rowHeaders()) === 10 ? true : null))
  assert.equal(await evaluate<string>(`document.querySelector('${fold}').getAttribute('aria-expanded')`), 'true')
  assert.equal(await evaluate<string>(`document.querySelector('${fold}').textContent`), 'Hide matching fields (3)')
  await evaluate(`document.querySelector('${fold}').click()`)
  await waitFor('fold again', async () => ((await rowHeaders()) === 7 ? true : null))
  await assertOneTabStop('initial')
  assert.equal(await evaluate<string>('document.querySelector(\'.resolve-grid [data-rg-key][tabindex="0"]\').getAttribute("data-rg-key")'), 'name|p1', 'the first cell is the tab stop')

  // A pick moves aria-selected, updates Final and announces it.
  assert.equal(await selected('brand|p1'), 'true', 'the default choice is highlighted like a pick')
  assert.equal(await selected('brand|p2'), 'false')
  await evaluate(`document.querySelector('${cell('brand|p2')}').click()`)
  await waitFor('brand pick', async () => ((await selected('brand|p2')) === 'true' ? true : null))
  assert.equal(await selected('brand|p1'), 'false', 'one choice per row')
  assert.match(await finalText('brand'), /^Mac/, 'Final follows the pick')
  assert.deepEqual(await lastSelect(), ['brand', { source: 'p2' }])
  await waitFor('announcement', async () => ((await evaluate<string>('document.querySelector(".resolve-grid-scroll").parentElement.querySelector("[aria-live=polite]").textContent')) === 'Final Brand: Mac' ? true : null))

  // A press on a copyable value waits out the double-click window...
  await mouseClick(`${cell('name|p2')} [data-copy-value]`)
  await pause(80)
  assert.equal(await selected('name|p2'), 'false', 'a press on a copyable value does not pick at once')
  await waitFor('deferred pick', async () => ((await selected('name|p2')) === 'true' ? true : null), 2000)
  // ...and a double-click copies instead of picking.
  await mouseClick(`${cell('name|p4')} [data-copy-value]`, 1)
  await mouseClick(`${cell('name|p4')} [data-copy-value]`, 2)
  await pause(450)
  assert.equal(await selected('name|p4'), 'false', 'a double-click on a copyable value does not pick')
  assert.equal(await evaluate<boolean>('Boolean(document.querySelector(".text-affordance-float:not([hidden])"))'), true, 'the double-click opens the copy float')
  await press('Escape')

  // Excluded, locked, masked and invalid cells cannot be picked and say why.
  const blocked = await evaluate<any>(`(() => {
    const q = (key) => document.querySelector('${cell('KEY')}'.replace('KEY', key))
    return {
      excluded: [q('name|p3').getAttribute('aria-disabled'), q('name|p3').textContent.includes('Keep separate')],
      locked: [q('cost|p1').getAttribute('aria-disabled'), q('cost|p1').textContent.includes('Needs cost edit permission')],
      masked: q('cost|p4').textContent.startsWith('Hidden'),
      invalid: [Boolean(q('cost|p3').querySelector('s')), q('cost|p3').textContent.includes('Invalid value')],
      average: [q('cost|#final|average').getAttribute('aria-pressed'), q('cost|#final|average').getAttribute('aria-disabled')],
    }
  })()`)
  assert.deepEqual(blocked, {
    excluded: ['true', true], locked: ['true', true], masked: true, invalid: [true, true], average: ['true', 'true'],
  }, 'blocked cells are disabled with their reason')
  const before = (await evaluate<number>('window.__log.select.length'))
  await evaluate(`document.querySelector('${cell('name|p3')}').click(); document.querySelector('${cell('cost|p1')}').click(); document.querySelector('${cell('cost|#final|average')}').click()`)
  await pause(350)
  assert.equal(await evaluate<number>('window.__log.select.length'), before, 'blocked cells and a locked row\'s options never report a choice')

  // Keyboard: roving tabindex across cells, chips and the fold toggle.
  await evaluate(`document.querySelector('${cell('name|p1')}').focus()`)
  await press('ArrowRight'); assert.equal(await active(), 'name|p2')
  await press('ArrowDown'); assert.equal(await active(), 'barcode|p2')
  await assertOneTabStop('after arrows')
  await press('End'); assert.equal(await active(), 'barcode|#final|none', 'End reaches the row\'s last stop (a Final option)')
  await press('Home'); assert.equal(await active(), 'barcode|p1')
  await press('End', CTRL); assert.equal(await active(), '#fold', 'Ctrl+End reaches the fold toggle')
  await press('Home', CTRL); assert.equal(await active(), 'name|p1', 'Ctrl+Home returns to the first cell')
  await press('ArrowUp'); assert.equal(await active(), 'name|p1', 'nothing above the first row')
  await assertOneTabStop('after Ctrl+Home')
  await press('ArrowDown'); await press('ArrowDown'); await press('ArrowRight'); await press('ArrowRight')
  assert.equal(await active(), 'brand|p4')
  await press('Enter')
  await waitFor('Enter picks', async () => ((await selected('brand|p4')) === 'true' ? true : null))
  await press('Home'); await press(' ')
  await waitFor('Space picks', async () => ((await selected('brand|p1')) === 'true' ? true : null))

  // Final editor: Escape keeps Final and the modal; Enter commits a typed value.
  await press('End'); assert.equal(await active(), 'brand|#final')
  await press('Enter')
  await waitFor('editor opens', async () => ((await evaluate<boolean>('Boolean(document.querySelector("[data-rg-editor] input")) && document.activeElement === document.querySelector("[data-rg-editor] input")')) ? true : null))
  assert.equal(await evaluate<boolean>('Boolean(document.querySelector("[role=dialog] [data-rg-editor]"))'), true, 'the editor sits inside the host dialog')
  assert.equal(await evaluate<string>('document.querySelector("[data-rg-editor] input").value'), 'MAC', 'text Final prefills the current value')
  await evaluate('document.querySelector("[data-rg-editor] input").select()')
  await send('Input.insertText', { text: 'M.A.C' })
  await press('Escape')
  await press('Escape')
  await waitFor('editor closes', async () => ((await evaluate<boolean>('!document.querySelector("[data-rg-editor]")')) ? true : null))
  assert.equal(await active(), 'brand|#final', 'Escape returns focus to Final')
  assert.match(await finalText('brand'), /^MAC/, 'Escape discards the typed value')
  assert.equal(await evaluate<boolean>('Boolean(document.querySelector("[role=dialog] .resolve-grid")) && !window.__closed'), true, 'Escape does not close the modal')
  await press('F2')
  await waitFor('F2 opens', async () => ((await evaluate<boolean>('document.activeElement === document.querySelector("[data-rg-editor] input")')) ? true : null))
  await evaluate('document.querySelector("[data-rg-editor] input").select()')
  await send('Input.insertText', { text: 'M.A.C' })
  await press('Enter')
  await waitFor('custom commit', async () => ((await finalText('brand')).startsWith('M.A.C') ? true : null))
  assert.match(await finalText('brand'), /Custom/, 'a typed Final carries the Custom pill')
  assert.deepEqual(await lastSelect(), ['brand', { custom: 'M.A.C' }])
  assert.equal(await selected('brand|p1'), 'false', 'a typed Final clears the record highlight')

  // Money: a bad value keeps the editor open with its error.
  await evaluate(`document.querySelector('${cell('selling|#final')}').click()`)
  await waitFor('money editor', async () => ((await evaluate<boolean>('document.activeElement === document.querySelector("[data-rg-editor] input")')) ? true : null))
  assert.equal(await evaluate<string>('document.querySelector("[data-rg-editor] input").placeholder'), '$12.00', 'money shows the current Final as a hint')
  await send('Input.insertText', { text: 'abc' })
  await press('Enter')
  await waitFor('money error', async () => ((await evaluate<string>('(document.querySelector("[data-rg-editor] [role=alert]") || {}).textContent || ""')) === 'Enter a price' ? true : null))
  await evaluate('document.querySelector("[data-rg-editor] input").select()')
  await send('Input.insertText', { text: '13.5' })
  await press('Enter')
  await waitFor('money commit', async () => ((await finalText('selling')).startsWith('$13.50') ? true : null))

  // Opening Final and leaving without typing changes nothing.
  const quietBefore = await evaluate<number>('window.__log.select.length')
  await evaluate(`document.querySelector('${cell('name|#final')}').click()`)
  await waitFor('untouched name editor', async () => ((await evaluate<boolean>('document.activeElement === document.querySelector("[data-rg-editor] input")')) ? true : null))
  await mouseClick('[role=dialog] h2')
  await waitFor('untouched editor closes', async () => ((await evaluate<boolean>('!document.querySelector("[data-rg-editor]")')) ? true : null))
  assert.equal(await evaluate<number>('window.__log.select.length'), quietBefore, 'an untouched editor reports no choice')
  assert.doesNotMatch(await finalText('name'), /Custom/, 'an untouched editor keeps the record pick')

  // Leaving the editor by clicking elsewhere keeps the typed value.
  await evaluate(`document.querySelector('${cell('name|#final')}').click()`)
  await waitFor('name editor', async () => ((await evaluate<boolean>('document.activeElement === document.querySelector("[data-rg-editor] input")')) ? true : null))
  await evaluate('document.querySelector("[data-rg-editor] input").select()')
  await send('Input.insertText', { text: 'Fit Me 30ml' })
  await mouseClick('[role=dialog] h2')
  await waitFor('blur commit', async () => ((await finalText('name')).startsWith('Fit Me 30ml') ? true : null))
  assert.equal(await evaluate<boolean>('!document.querySelector("[data-rg-editor]")'), true)

  // Required row: unanswered until an option is chosen; an option may be a
  // disposition (council D1) and then re-including restores the order.
  assert.equal(await finalText('session'), 'Choose one' + 'Finalize stock-in #12 and merge' + 'Keep this product separate')
  await evaluate(`document.querySelector('${cell('session|#final|finalize')}').click()`)
  await waitFor('finalize', async () => ((await evaluate<string>(`document.querySelector('${cell('session|#final|finalize')}').getAttribute('aria-pressed')`)) === 'true' ? true : null))
  assert.deepEqual(await lastSelect(), ['session', { option: 'finalize' }])
  await evaluate(`document.querySelector('${cell('session|#final|keep')}').click()`)
  await waitFor('keep separate', async () => ((await lastDisposition())?.[0] === 'p2' ? true : null))
  assert.deepEqual(await lastDisposition(), ['p2', 'separate', null])
  await waitFor('reorder', async () => ((await headerOrder()).join('|') === ['Maybelline Fit Me Matte + Poreless Foundation 30ml', 'Fit me', 'Fit Me Foundation 30ml', 'FIT ME 30ML'].join('|') ? true : null))
  assert.equal(await evaluate<string>(`document.querySelector('${cell('session|#final|keep')}').getAttribute('aria-pressed')`), 'true')
  // Re-include p2 from its header menu (the AppSelect portals its list to body).
  await evaluate(`document.querySelector('[aria-label="What to do with Fit Me Foundation 30ml"]').click()`)
  await waitFor('menu', async () => ((await evaluate<boolean>('Boolean(document.querySelector("[data-app-select-option=include]"))')) ? true : null))
  await evaluate('document.querySelector("[data-app-select-option=include]").click()')
  await waitFor('re-include', async () => ((await lastDisposition())?.[1] === 'include' ? true : null))
  assert.deepEqual(await headerOrder(), ['Maybelline Fit Me Matte + Poreless Foundation 30ml', 'Fit Me Foundation 30ml', 'Fit me', 'FIT ME 30ML'])
  // Remove asks for a reason inside the header.
  await evaluate(`document.querySelector('[aria-label="What to do with Fit me"]').click()`)
  await waitFor('menu 2', async () => ((await evaluate<boolean>('Boolean(document.querySelector("[data-app-select-option=remove]"))')) ? true : null))
  await evaluate('document.querySelector("[data-app-select-option=remove]").click()')
  await waitFor('reason input', async () => ((await evaluate<boolean>('Boolean(document.querySelector("[aria-label=\'Reason to remove Fit me\']"))')) ? true : null))
  assert.equal(await evaluate<number>('document.querySelector("[aria-label=\'Reason to remove Fit me\']").maxLength'), 500)
  await evaluate('document.querySelector("[aria-label=\'Reason to remove Fit me\']").focus()')
  await send('Input.insertText', { text: 'Test record' })
  await waitFor('reason reported', async () => ((await lastDisposition())?.[2] === 'Test record' ? true : null))
  assert.deepEqual(await lastDisposition(), ['p4', 'remove', 'Test record'])

  // Per-record options inside a record cell (D3 Carry / Write off).
  assert.equal(await evaluate<string>(`document.querySelector('${cell('stock|p2|carry')}').getAttribute('aria-pressed')`), 'true')
  await evaluate(`document.querySelector('${cell('stock|p2|writeoff')}').click()`)
  await waitFor('write off', async () => ((await evaluate<string>(`document.querySelector('${cell('stock|p2|writeoff')}').getAttribute('aria-pressed')`)) === 'true' ? true : null))
  assert.deepEqual(await lastSelect(), ['stock|p2', { option: 'writeoff' }])
  assert.equal(await finalText('stock'), '12 · 1 lots', 'Final follows a per-record option')

  // A value that moved under a stale re-read unfolds and is marked.
  const shownBefore = await rowHeaders()
  assert.equal(await evaluate<boolean>(`Boolean(document.querySelector('${cell('category|p2')}'))`), false, 'category starts folded')
  await evaluate('window.__setChanged(["category|p2"])')
  await waitFor('changed row unfolds', async () => ((await rowHeaders()) === shownBefore + 1 ? true : null))
  assert.deepEqual(await evaluate<any>(`(() => { const node = document.querySelector('${cell('category|p2')}'); return [node.classList.contains('rg-changed'), node.textContent.includes('Changed')] })()`), [true, true])

  // Busy: the grid is inert, so nothing in it can take focus or a click.
  await evaluate('window.__setBusy(true)')
  await waitFor('inert', async () => ((await evaluate<boolean>('document.querySelector(".resolve-grid-scroll").parentElement.inert === true')) ? true : null))
  const busyBefore = await evaluate<number>('window.__log.select.length')
  await mouseClick(cell('name|p1'))
  await evaluate(`document.querySelector('${cell('name|p2')}').focus()`)
  await pause(350)
  assert.equal(await evaluate<number>('window.__log.select.length'), busyBefore, 'a busy grid takes no pick')
  assert.notEqual(await active(), 'name|p2', 'a busy grid takes no focus')
  assert.equal(await evaluate<string>('document.querySelector(".resolve-grid").getAttribute("aria-busy")'), 'true')
  await evaluate('window.__setBusy(false)')

  // --------------------------------------------------------- other surfaces
  await open(375, 'km', 'dark')
  await assertPinnedAndPaged('375 km dark', 1, 'dark')
  await assertKhmerRoom('375 km dark')
  assert.equal(await evaluate<string>(`document.querySelector('${cell('#fold')}').textContent`), 'វាលដូចគ្នា 3 · បង្ហាញទាំងអស់ (3)', 'Khmer fold label')
  assert.equal(await finalText('session'), 'សូមជ្រើសរើសមួយ' + 'Finalize stock-in #12 and merge' + 'Keep this product separate')

  await open(1280, 'en', 'dark')
  await assertPinnedAndPaged('1280 en dark', 3, 'dark')
  await evaluate(`document.querySelector('${cell('name|p1')}').focus()`)
  await press('ArrowRight'); await press('ArrowRight'); await press('ArrowRight')
  assert.equal(await active(), 'name|p3', 'arrows walk into the Keep separate column at the end')
  await waitFor('focus scrolls the record into view', async () => {
    const g = await geometry()
    const p3 = g.records[3]
    return p3.left >= g.bandLeft - 1 && p3.right <= g.bandRight + 1 ? true : null
  })

  await open(1280, 'km', 'light')
  await assertPinnedAndPaged('1280 km light', 3, 'light')
  await assertKhmerRoom('1280 km light')
})
