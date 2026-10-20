import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

// Board 6.0.859 A4: search + scan + Filters share one row, the sort row scrolls under it, a sole branch is a label,
// and every chosen filter lives only inside the Filters menu (the trigger carries the count).
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
    const [filters, setFilters] = useState({ branchId: '1', stockState: '', state: '', reason: '', brand: 'Synthetic long brand', category: '', sortBy: 'name', sortDirection: 'asc' })
    const fields = Object.fromEntries(['stock','brand','category','sales','customers','received','price','cost'].map(field => [field, !restricted]))
    return <main style={{ width: '100%', padding: 12 }}><InventoryCheckControls
      query={query} onQueryChange={setQuery} filters={filters} onFiltersChange={patch => setFilters(old => ({ ...old, ...patch }))} onClear={() => setFilters(old => ({ ...old, brand: '' }))}
      fields={fields} branches={[{id:1,name:'Synthetic sole active branch'}]} brands={['Synthetic long brand']}
      categories={['Synthetic long category']} reasons={['Shelf mismatch']} showSessionStates={params.get('session') !== 'false'} optionsLimited trailing={<button type="button" id="trailing" aria-label="Top" className="h-10 w-10 shrink-0">T</button>} t={t} />
      <output hidden>{JSON.stringify({query, filters})}</output></main>
  }
  createRoot(document.getElementById('root')).render(<AppContext.Provider value={{...FALLBACK_APP_CONTEXT,t,language}}><Harness /></AppContext.Provider>)
`

const packs = Object.fromEntries(['en', 'km'].map(lang => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8')) as Record<string, string>]))
const browser = await launchResolveFixture('inventory-check-controls', fixture)
await browser.run('PASS Inventory pinned controls: search/scan/Filters row, sort row, sole branch, filter menu and sort/search EN/KM phone/desktop', async () => {
  for (const width of [320, 390, 1280]) for (const lang of ['en', 'km']) for (const restricted of [false, true]) {
    await browser.open(width, `lang=${lang}&restricted=${restricted}`, `document.querySelector('#inventory-check-search')`, 480)
    const geometry = await browser.evaluate<any>(`(() => {
      const row = document.querySelector('[data-inventory-check-search-row]')
      const search = document.querySelector('#inventory-check-search').getBoundingClientRect()
      const rail = document.querySelector('[data-inventory-check-filters]')
      const railBox = rail.getBoundingClientRect()
      const box = node => { const r = node.getBoundingClientRect(); return { centre: r.top + r.height / 2, height: r.height, width: r.width } }
      const scan = box(row.querySelector('button[aria-label=' + JSON.stringify(${JSON.stringify(packs[lang].scan_barcode)}) + ']'))
      const filters = box(row.querySelector('button[title$="(1)"]'))
      const children = Array.from(rail.children, child => child.getBoundingClientRect())
      return { overflow: document.documentElement.scrollWidth > innerWidth, searchBottom: search.bottom, searchCentre: search.top + search.height / 2, railTop: railBox.top, scan, filters, centres: children.map(r => r.top + r.height / 2), branch: rail.querySelector('[data-sole-branch]').textContent, selected: Array.from(rail.querySelectorAll('[data-app-select-selected]'), node => node.textContent) }
    })()`)
    assert.equal(geometry.overflow, false, `${lang} ${width}: no horizontal page scroll`)
    assert.ok(geometry.searchBottom <= geometry.railTop, 'the sort row sits under the search row')
    assert.ok(Math.abs(geometry.scan.centre - geometry.searchCentre) < 2 && Math.abs(geometry.filters.centre - geometry.searchCentre) < 2, 'search, scan and Filters share one row')
    assert.ok([geometry.scan, geometry.filters].every((button: any) => button.height >= 40 && button.width >= 40), 'scan and Filters are touch-sized')
    assert.ok(Math.max(...geometry.centres) - Math.min(...geometry.centres) < 2, 'sort controls stay on one scrolling row')
    assert.match(geometry.branch, /Synthetic sole active branch/, 'one active branch is shown as a label')
    assert.equal(geometry.selected.length, 1, 'only Sort remains a pill: filters moved into the menu')
    assert.ok(!geometry.selected.join('').includes('Synthetic long brand'), 'the chosen brand shows only inside the Filters menu')
    // The menu: a sole branch has no Branch choice; hidden fields have no section.
    await browser.mouseClick('[data-inventory-check-search-row] button[title$="(1)"]')
    await browser.waitFor('filter menu', async () => await browser.evaluate(`document.querySelector('[data-filter-menu-section]') !== null`) ? true : null)
    const sections = await browser.evaluate<string[]>(`Array.from(document.querySelectorAll('[data-filter-menu-section]'), node => node.getAttribute('data-filter-menu-section'))`)
    assert.deepEqual(sections, restricted ? ['state', 'reason'] : ['state', 'reason', 'stockState', 'brand', 'category'], `${lang} ${width}: sections follow permissions; no Branch for a sole branch`)
    assert.equal(await browser.evaluate(`document.documentElement.scrollWidth > innerWidth`), false, 'the open menu adds no page scroll')
    await browser.press('Escape')
    await browser.evaluate(`document.querySelector('[data-inventory-check-filters]').scrollLeft = 100000`)
    await browser.mouseClick('[data-inventory-check-filters] > button[aria-label]:not(#trailing)')
    await browser.waitFor('sort direction changes', async () => await browser.evaluate(`JSON.parse(document.querySelector('output').textContent).filters.sortDirection === 'desc'`) ? true : null)
    await browser.evaluate(`(() => { const input=document.querySelector('#inventory-check-search'); input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Synthetic query'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
    await browser.waitFor('search remains controlled', async () => await browser.evaluate(`JSON.parse(document.querySelector('output').textContent).query === 'Synthetic query'`) ? true : null)
    assert.equal(await browser.evaluate(`document.activeElement.id`), 'inventory-check-search')
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
