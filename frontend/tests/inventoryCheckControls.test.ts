import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

// Board 6.0.859 A4 + lane 6.0.933: the toolbar is exactly [Search][Scan][Filters] (Sort is the first section of the Filters menu, limited by what the
// viewer may see), a capped option list says so inside its own section, and every chosen filter and the Sort live only inside the Filters menu.
const fixture = String.raw`
  import React, { useState } from 'react'
  import { createRoot } from 'react-dom/client'
  import { AppContext, FALLBACK_APP_CONTEXT } from '/src/app/AppContextCore.tsx'
  import InventoryCheckControls from '/src/components/inventory/InventoryCheckControls.tsx'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '/src/styles/main.css'
  import '@fontsource/noto-sans-khmer/400.css'
  const params = new URLSearchParams(location.search)
  const language = params.get('lang') || 'en'
  const t = key => (language === 'km' ? km : en)[key] || key
  document.body.className = language === 'km' ? 'lang-km' : ''
  const restricted = params.get('restricted') === 'true'
  function Harness() {
    const [query, setQuery] = useState('')
    const [submitted, setSubmitted] = useState([])
    const [filters, setFilters] = useState({ branchId: '1', stockState: '', state: '', reason: '', brand: 'Synthetic long brand', category: '', sortBy: 'name', sortDirection: 'asc' })
    const fields = Object.fromEntries(['stock','brand','category','sales','customers','received','price','cost'].map(field => [field, !restricted]))
    return <main style={{ width: '100%', padding: 12 }}><InventoryCheckControls
      query={query} onQueryChange={setQuery} onQuerySubmit={value => setSubmitted(old => [...old, value])} filters={filters} onFiltersChange={patch => setFilters(old => ({ ...old, ...patch }))} onClear={() => setFilters(old => ({ ...old, brand: '' }))}
      fields={fields} branches={[{id:1,name:'Synthetic sole active branch'}]} brands={['Synthetic long brand']}
      categories={['Synthetic long category']} reasons={['Shelf mismatch']} showSessionStates={params.get('session') !== 'false'} limited={{ brands: true }} t={t} />
      <output hidden>{JSON.stringify({query, filters, submitted})}</output></main>
  }
  createRoot(document.getElementById('root')).render(<AppContext.Provider value={{...FALLBACK_APP_CONTEXT,t,language}}><Harness /></AppContext.Provider>)
`

const packs = Object.fromEntries(['en', 'km'].map(lang => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8')) as Record<string, string>]))
const browser = await launchResolveFixture('inventory-check-controls', fixture)
await browser.run('PASS Inventory pinned controls: [Search][Scan][Filters] only, Sort and the capped-list note inside the Filters menu, EN/KM phone/desktop', async () => {
  const output = `JSON.parse(document.querySelector('output').textContent)`
  // A Filters section stays closed until asked for, except the one holding a chosen filter: open it only if it is not open already.
  const openSection = async (id: string) => {
    await browser.waitFor(`${id} section`, async () => await browser.evaluate(`document.querySelector('[data-filter-menu-section="${id}"]') !== null`) ? true : null)
    if (await browser.evaluate(`document.querySelector('[data-filter-menu-section="${id}"] [role="option"]') === null`)) {
      await browser.mouseClick(`[data-filter-menu-section="${id}"] > button`)
      await browser.waitFor(`${id} options`, async () => await browser.evaluate(`document.querySelector('[data-filter-menu-section="${id}"] [role="option"]') !== null`) ? true : null)
    }
  }
  for (const width of [320, 390, 1280]) for (const lang of ['en', 'km']) for (const restricted of [false, true]) {
    const pack = packs[lang]
    await browser.open(width, `lang=${lang}&restricted=${restricted}`, `document.querySelector('#inventory-check-search')`, 480)
    const geometry = await browser.evaluate<any>(`(() => {
      const row = document.querySelector('[data-inventory-check-search-row]')
      const search = document.querySelector('#inventory-check-search').getBoundingClientRect()
      const box = node => { const r = node.getBoundingClientRect(); return { centre: r.top + r.height / 2, height: r.height, width: r.width } }
      const scan = box(row.querySelector('button[aria-label=' + JSON.stringify(${JSON.stringify(pack.scan_barcode)}) + ']'))
      const filters = box(row.querySelector('button[title$="(1)"]'))
      return { overflow: document.documentElement.scrollWidth > innerWidth, searchCentre: search.top + search.height / 2, scan, filters, buttons: Array.from(row.querySelectorAll('button'), node => node.getAttribute('aria-label')), extraRows: document.querySelectorAll('[data-inventory-check-filters], [data-sole-branch], [data-app-select-button]').length }
    })()`)
    assert.equal(geometry.overflow, false, `${lang} ${width}: no horizontal page scroll`)
    assert.ok(Math.abs(geometry.scan.centre - geometry.searchCentre) < 2 && Math.abs(geometry.filters.centre - geometry.searchCentre) < 2, 'search, scan and Filters share one row')
    assert.ok([geometry.scan, geometry.filters].every((button: any) => button.height >= 40 && button.width >= 40), 'scan and Filters are touch-sized')
    assert.equal(geometry.extraRows, 0, 'no sort row, no sort select and no branch label: those are not part of the toolbar')
    assert.deepEqual(geometry.buttons.filter(Boolean), [pack.scan_barcode, pack.filters], `${lang} ${width}: the only controls beside Search are Scan and Filters`)
    // The menu: Sort first, then the filters; a sole branch has no Branch choice; hidden fields have no section.
    await browser.mouseClick('[data-inventory-check-search-row] button[title$="(1)"]')
    await browser.waitFor('filter menu', async () => await browser.evaluate(`document.querySelector('[data-filter-menu-section]') !== null`) ? true : null)
    const sections = await browser.evaluate<string[]>(`Array.from(document.querySelectorAll('[data-filter-menu-section]'), node => node.getAttribute('data-filter-menu-section'))`)
    assert.deepEqual(sections, restricted ? ['sort', 'state', 'reason'] : ['sort', 'state', 'reason', 'stockState', 'brand', 'category'], `${lang} ${width}: Sort leads; sections follow permissions; no Branch for a sole branch`)
    assert.equal(await browser.evaluate(`document.documentElement.scrollWidth > innerWidth`), false, 'the open menu adds no page scroll')
    // Sort choices are limited by permission; each reads "{field}: high → low" in the viewer's language.
    await openSection('sort')
    const named = (key: string, field: string) => pack[key].replace('{field}', field)
    const full = [pack.sort_name_az, pack.sort_name_za,
      named('sort_field_high_low', pack.stock), named('sort_field_low_high', pack.stock),
      named('sort_field_high_low', pack.qty_sold), named('sort_field_low_high', pack.qty_sold),
      named('sort_field_high_low', pack.customers),
      named('sort_field_newest', pack.received_date), named('sort_field_oldest', pack.received_date),
      named('sort_field_high_low', pack.selling_price), named('sort_field_low_high', pack.selling_price),
      named('sort_field_high_low', pack.cost_price), named('sort_field_low_high', pack.cost_price)]
    const options = await browser.evaluate<string[]>(`Array.from(document.querySelectorAll('[data-filter-menu-section="sort"] [role="option"]'), node => node.textContent)`)
    assert.deepEqual(options, restricted ? full.slice(0, 2) : full, `${lang} ${width}: Sort offers only what this viewer may see`)
    const filtersTitle = `document.querySelector('[data-inventory-check-search-row] button[aria-label=' + JSON.stringify(${JSON.stringify(pack.filters)}) + ']').title`
    if (!restricted) {
      await browser.mouseClick('[data-filter-menu-section="sort"] [role="option"]:nth-of-type(3)')
      await browser.waitFor('sort chosen', async () => await browser.evaluate(`${output}.filters.sortBy === 'stock' && ${output}.filters.sortDirection === 'desc'`) ? true : null)
      assert.equal(await browser.evaluate(filtersTitle), `${pack.filters} (2)`, 'a non-default Sort counts in the Filters badge, next to the chosen brand')
      await browser.mouseClick('[data-filter-menu-section="sort"] [role="option"]:nth-of-type(1)')
      await browser.waitFor('default sort restored', async () => await browser.evaluate(`${output}.filters.sortBy === 'name' && ${output}.filters.sortDirection === 'asc'`) ? true : null)
      assert.equal(await browser.evaluate(filtersTitle), `${pack.filters} (1)`, 'the default Sort adds nothing to the badge')
      // The server capped the Brand list: its own section says so; the Category list was not capped and says nothing.
      await openSection('brand')
      assert.ok((await browser.evaluate<string>(`document.querySelector('[data-filter-menu-section="brand"]').textContent`)).includes(pack.inventory_check_filter_options_limited), `${lang} ${width}: a capped Brand list says so inside its section`)
      await openSection('category')
      assert.ok(!(await browser.evaluate<string>(`document.querySelector('[data-filter-menu-section="category"]').textContent`)).includes(pack.inventory_check_filter_options_limited), 'an uncapped list stays quiet')
    }
    await browser.press('Escape')
    await browser.waitFor('menu closed', async () => await browser.evaluate(`document.querySelector('[data-filter-menu-section]') === null`) ? true : null)
    await browser.pause(300) // the menu hands focus back to its trigger as it closes; typing starts after that
    await browser.evaluate(`(() => { const input=document.querySelector('#inventory-check-search'); input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Synthetic query'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
    await browser.waitFor('search remains controlled', async () => await browser.evaluate(`${output}.query === 'Synthetic query'`) ? true : null)
    assert.equal(await browser.evaluate(`document.activeElement.id`), 'inventory-check-search')
    assert.deepEqual(await browser.evaluate(`${output}.submitted`), [], 'typing alone never counts as a scan')
    await browser.press('Enter')
    await browser.waitFor('Enter submits', async () => await browser.evaluate(`${output}.submitted.length === 1`) ? true : null)
    assert.deepEqual(await browser.evaluate(`${output}.submitted`), ['Synthetic query'], 'Enter hands the box text to the page as a scan')
  }
  for (const [session, expected] of [['false', 1], ['true', 3]] as const) {
    await browser.open(390, `lang=en&session=${session}`, `document.querySelector('#inventory-check-search')`, 480)
    await browser.mouseClick('[data-inventory-check-search-row] button[title$="(1)"]')
    await browser.waitFor('filter menu', async () => await browser.evaluate(`document.querySelector('[data-filter-menu-section="state"]') !== null`) ? true : null)
    // The section holding a chosen filter opens with the menu; open Check status only if it is not already open.
    await browser.waitFor('check status options', async () => {
      if (await browser.evaluate(`document.querySelector('[data-filter-menu-section="state"] [role="option"]') !== null`)) return true
      await browser.mouseClick('[data-filter-menu-section="state"] > button')
      await browser.pause(300)
      return null
    })
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-filter-menu-section="state"] [role="option"]').length`), expected, 'Done and Not started require a selected count session; global Issues remains available')
  }
})
