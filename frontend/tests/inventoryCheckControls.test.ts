import assert from 'node:assert/strict'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

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
    const [range, setRange] = useState({ startDate: '2026-10-01', endDate: '2026-10-19', startTime: '', endTime: '' })
    const [query, setQuery] = useState('')
    const [filters, setFilters] = useState({ branchId: '1', stockState: '', state: '', reason: '', brand: '', category: '', sortBy: 'name', sortDirection: 'asc' })
    const fields = Object.fromEntries(['stock','brand','category','sales','customers','received','price','cost'].map(field => [field, !restricted]))
    return <main style={{ width: '100%', padding: 12 }}><InventoryCheckControls range={range} onRangeChange={setRange}
      query={query} onQueryChange={setQuery} filters={filters} onFiltersChange={patch => setFilters(old => ({ ...old, ...patch }))}
      fields={fields} branches={[{id:1,name:'Synthetic sole active branch'}]} brands={['Synthetic long brand']}
      categories={['Synthetic long category']} reasons={['Shelf mismatch']} showSessionStates={params.get('session') !== 'false'} t={t} />
      <output hidden>{JSON.stringify({query, filters})}</output></main>
  }
  createRoot(document.getElementById('root')).render(<AppContext.Provider value={{...FALLBACK_APP_CONTEXT,t,language}}><Harness /></AppContext.Provider>)
`

const browser = await launchResolveFixture('inventory-check-controls', fixture)
await browser.run('PASS Inventory compact controls, sole branch, field visibility and sort/search EN/KM phone/desktop', async () => {
  for (const width of [320, 390, 1280]) for (const lang of ['en', 'km']) for (const restricted of [false, true]) {
    await browser.open(width, `lang=${lang}&restricted=${restricted}`, `document.querySelector('#inventory-check-search')`, 480)
    const geometry = await browser.evaluate<any>(`(() => {
      const dates = document.querySelector('[data-stats-range-controls]').getBoundingClientRect()
      const search = document.querySelector('#inventory-check-search').getBoundingClientRect()
      const rail = document.querySelector('[data-inventory-check-filters]')
      const filters = rail.getBoundingClientRect()
      const children = Array.from(rail.children, child => child.getBoundingClientRect())
      return { overflow:document.documentElement.scrollWidth > innerWidth, datesBottom:dates.bottom, searchTop:search.top, searchBottom:search.bottom, filtersTop:filters.top, tops:children.map(r=>r.top), heights:children.map(r=>r.height), branch:rail.querySelector('button').textContent, selected:Array.from(rail.querySelectorAll('[data-app-select-selected]'), node=>node.textContent) }
    })()`)
    assert.equal(geometry.overflow, false)
    assert.ok(geometry.datesBottom <= geometry.searchTop && geometry.searchBottom <= geometry.filtersTop, 'dates/presets, search and filter rail stay in the requested order')
    assert.equal(new Set(geometry.tops).size, 1, 'filter controls stay on one scrolling row')
    assert.ok(geometry.heights.every((height: number) => height >= 40))
    assert.match(geometry.branch, /Synthetic sole active branch/, 'one active branch remains visible')
    assert.equal(geometry.selected.length, restricted ? 4 : 7, 'hidden stock/brand/category controls are absent')
    assert.equal(await browser.evaluate(`Array.from(document.querySelectorAll('[data-stats-range-controls] button')).every(button => button.matches(':disabled'))`), restricted, 'received-date filters cannot query hidden fields')
    await browser.evaluate(`document.querySelector('[data-inventory-check-filters]').scrollLeft = 100000`)
    await browser.mouseClick('[data-inventory-check-filters] > button:last-child')
    await browser.waitFor('sort direction changes', async () => await browser.evaluate(`JSON.parse(document.querySelector('output').textContent).filters.sortDirection === 'desc'`) ? true : null)
    await browser.evaluate(`(() => { const input=document.querySelector('#inventory-check-search'); input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Synthetic query'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
    await browser.waitFor('search remains controlled', async () => await browser.evaluate(`JSON.parse(document.querySelector('output').textContent).query === 'Synthetic query'`) ? true : null)
    assert.equal(await browser.evaluate(`document.activeElement.id`), 'inventory-check-search')
  }
  for (const [session, expected] of [['false', 2], ['true', 4]] as const) {
    await browser.open(390, `lang=en&session=${session}`, `document.querySelector('#inventory-check-search')`, 480)
    await browser.mouseClick('[data-inventory-check-filters] > :nth-child(2) button')
    await browser.waitFor('count state menu', async () => await browser.evaluate(`document.querySelector('[data-app-select-menu]') !== null`) ? true : null)
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-app-select-menu] [role="option"]').length`), expected, 'Done and Not started require a selected count session; global Issues remains available')
  }
})
