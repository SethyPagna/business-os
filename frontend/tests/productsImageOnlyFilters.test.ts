import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'
import { buildQueryString } from '../src/api/query.ts'
import { classesOf, dimension } from './tailwindPixels.ts'

// 6.0.860: the image-only Products view gets the received-date range, stock / category / brand / sort controls
// that the 6.0.854 server contract serves (cloudflare/src/lib/productImageOnlyQuery.ts). Mounted, against a
// transport double that records every request the view sends. F1-F9 are the plan's frontend cases
// (Records/Consolidation/2026-10-19/Inventory/PLAN-854-IMAGE-ONLY-FILTERS.md section 4).

const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8'))])) as Record<string, Record<string, string>>
const harness = await createHarness()

type Params = Record<string, unknown>
type Reply = { items: Array<Record<string, unknown>>; total: number; facets?: { categories?: string[]; brands?: string[] } }
const requests: Params[] = []
let filterVocabularyReads = 0
let respond: (params: Params) => Promise<Reply> = async () => ({ items: [], total: 0 })

const doubles = {
  'api/productReadTransport.ts': {
    searchProducts: async (params: Params) => { requests.push({ ...params }); return respond(params) },
    getProductFilters: async () => { filterVocabularyReads += 1; return { categories: ['LEAKED-category'], brands: ['LEAKED-brand'] } },
  },
}

const ALL_GRANTS = ['batches', 'stock', 'category', 'brand']
async function mountView(lang: string, grants: string[]): Promise<MountedSurface> {
  const pack = packs[lang]
  const granted = new Set(grants.map((name) => `products_image_only_show_${name}`))
  const app = {
    t: (key: string) => pack[key] || key, notify() {}, language: lang,
    hasPermission: (key: string) => granted.has(key),
    fmtUSD: (value: unknown) => `$${Number(value || 0).toFixed(2)}`, fmtKHR: (value: unknown) => `${Number(value || 0)}៛`,
    user: { id: 1, username: 'fixture-image-only', role_code: 'products_image_only' },
  }
  return harness.mount({ component: 'components/products/ProductsImageOnlyView.tsx', app, doubles })
}

const named = (surface: MountedSurface, label: string): MemoryNode =>
  surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === label, `control ${label}`)
const hasNamed = (surface: MountedSurface, label: string): boolean =>
  surface.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === label).length > 0
const optionLabels = (surface: MountedSurface): string[] =>
  surface.findAll((node) => node.getAttribute('role') === 'option').map((node) => node.textContent.trim())
async function choose(surface: MountedSurface, control: string, option: string): Promise<void> {
  await surface.click(named(surface, control))
  await surface.click(surface.find((node) => node.getAttribute('role') === 'option' && node.textContent.trim() === option, `option ${option}`))
}
const cambodiaToday = (): string => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Phnom_Penh' })
const ddmmyyyy = (day: string): string => day.split('-').reverse().join('/')
const sentKeys = (params: Params): string[] => Object.keys(params).filter((key) => params[key] !== '' && params[key] != null).sort()

const rows = (...names: string[]) => names.map((name, index) => ({ id: index + 1, name, image_path: null, updated_at: '2026-10-01T00:00:00Z' }))

try {
  const en = packs.en

  // F1 + F3: the default scope sends no date and no stock bound, and All time is the active preset.
  {
    requests.length = 0
    respond = async () => ({ items: rows('Synthetic serum'), total: 1 })
    const surface = await mountView('en', ALL_GRANTS)
    assert.equal(requests.length, 1, 'F1: one request on mount')
    assert.deepEqual(sentKeys(requests[0]), ['page', 'pageSize'], 'F1: default scope sends only the page (no date, stock, category, brand or sort)')
    assert.equal(buildQueryString(requests[0] as never).includes('Date'), false, 'F1: no date on the wire')
    assert.equal(surface.button(en.all_time).getAttribute('aria-pressed'), 'true', 'F1: All time is the active preset')
    assert.equal(surface.button(en.today).getAttribute('aria-pressed'), 'false')
    await surface.unmount()

    requests.length = 0
    const plain = await mountView('en', [])
    assert.equal(plain.findAll((node) => node.hasAttribute('data-date-presets')).length, 0, 'F3: no date row without show_batches')
    assert.equal(plain.findAll((node) => node.hasAttribute('data-stats-range-controls')).length, 0)
    assert.equal(hasNamed(plain, en.stock_status), false, 'F4: no stock select without show_stock')
    assert.equal(hasNamed(plain, en.category), false, 'no category select without show_category')
    assert.equal(hasNamed(plain, en.brand), false, 'no brand select without show_brand')
    assert.ok(hasNamed(plain, en.scan_barcode), 'the scanner stays for every image-only user (barcode search is open to the role)')
    assert.ok(hasNamed(plain, en.sort_by), 'sort is always offered')
    await choose(plain, en.sort_by, en.name_z_a)
    assert.equal(requests.at(-1)?.sort, 'name_desc', 'sort Z-A is sent as name_desc')
    assert.equal(requests.at(-1)?.startDate, undefined, 'F3: dates are never sent without show_batches')
    await plain.unmount()
  }

  // F2: the date row comes first, then search, then the filter row; Today is the Cambodia business day.
  {
    requests.length = 0
    respond = async () => ({ items: rows('Synthetic serum'), total: 1 })
    const surface = await mountView('en', ALL_GRANTS)
    const order = surface.findAll((node) => node.hasAttribute('data-stats-range-controls') || node.id === 'products-image-only-search' || node.hasAttribute('data-products-image-only-filters'))
      .map((node) => (node.hasAttribute('data-stats-range-controls') ? 'dates' : node.hasAttribute('data-products-image-only-filters') ? 'filters' : 'search'))
    assert.deepEqual(order, ['dates', 'search', 'filters'], 'F2: date row, then search, then the filter row')
    await surface.click(surface.button(en.today))
    const today = cambodiaToday()
    assert.equal(requests.length, 2)
    assert.equal(requests[1].startDate, today, 'F2: Today starts on the Cambodia business day')
    assert.equal(requests[1].endDate, today)
    assert.equal(requests[1].page, 1)
    assert.ok(surface.text().includes(ddmmyyyy(today)), `F2: the range reads dd/mm/yyyy (${ddmmyyyy(today)}); it reads: ${surface.text().slice(0, 300)}`)
    assert.equal(surface.button(en.today).getAttribute('aria-pressed'), 'true')
    await surface.click(surface.button(en.all_time))
    assert.equal(requests[2].startDate, undefined, 'back to All time drops the bounds again')
    await surface.unmount()
  }

  // F4 + F5: stock values, and option lists that come from the reply's facets, never the shared vocabulary.
  {
    requests.length = 0
    filterVocabularyReads = 0
    respond = async () => ({ items: rows('Synthetic serum'), total: 1, facets: { categories: ['Hair', 'Skin'], brands: ['Acme'] } })
    const surface = await mountView('en', ALL_GRANTS)
    await surface.click(named(surface, en.stock_status))
    assert.deepEqual(optionLabels(surface), [en.all, en.in_stock, en.low_stock, en.out_of_stock, en.healthy_stock], 'F4: stock options')
    await surface.click(surface.find((node) => node.getAttribute('role') === 'option' && node.textContent.trim() === en.out_of_stock, 'out option'))
    assert.equal(requests.at(-1)?.stockState, 'out', 'F4: Out of Stock is sent as stockState=out')
    for (const [label, wire] of [[en.in_stock, 'in_stock'], [en.low_stock, 'low'], [en.healthy_stock, 'healthy']] as const) {
      await choose(surface, en.stock_status, label)
      assert.equal(requests.at(-1)?.stockState, wire, `F4: ${label} is sent as ${wire}`)
    }
    await choose(surface, en.stock_status, en.all)
    assert.equal(requests.at(-1)?.stockState, undefined, 'F4: All sends no stock state')

    await surface.click(named(surface, en.category))
    assert.deepEqual(optionLabels(surface), [en.all, 'Hair', 'Skin'], 'F5: category options are the reply facets')
    await surface.click(surface.find((node) => node.getAttribute('role') === 'option' && node.textContent.trim() === 'Skin', 'Skin'))
    assert.equal(requests.at(-1)?.category, 'Skin')
    await surface.click(named(surface, en.brand))
    assert.deepEqual(optionLabels(surface), [en.all, 'Acme'], 'F5: brand options are the reply facets')
    await surface.click(surface.find((node) => node.getAttribute('role') === 'option' && node.textContent.trim() === 'Acme', 'Acme'))
    assert.equal(requests.at(-1)?.brand, 'Acme')
    assert.equal(filterVocabularyReads, 0, 'F5: the shared filter vocabulary is never read')
    assert.ok(!surface.text().includes('LEAKED'), 'F5: nothing from the shared vocabulary reaches the screen')
    await surface.unmount()
  }

  // F6: any scope change is one request, and it asks for page 1.
  {
    requests.length = 0
    respond = async (params) => ({ items: rows(`Synthetic ${String(params.page)}`), total: 100, facets: { categories: ['Hair'], brands: ['Acme'] } })
    const surface = await mountView('en', ALL_GRANTS)
    const goToPageTwo = async (): Promise<void> => {
      await surface.click(surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === en.next && !node.hasAttribute('disabled'), 'next page'))
      assert.equal(requests.at(-1)?.page, 2, 'precondition: on page 2')
    }
    const changes: Array<[string, () => Promise<void>]> = [
      ['stock', () => choose(surface, en.stock_status, en.low_stock)],
      ['category', () => choose(surface, en.category, 'Hair')],
      ['brand', () => choose(surface, en.brand, 'Acme')],
      ['sort', () => choose(surface, en.sort_by, en.name_z_a)],
      ['dates', () => surface.click(surface.button(en.today))],
      ['search', async () => { await surface.type(surface.field('products-image-only-search'), 'serum'); await surface.settle({ until: () => requests.at(-1)?.q === 'serum' }) }],
    ]
    for (const [name, change] of changes) {
      await goToPageTwo()
      const before = requests.length
      await change()
      assert.equal(requests.length - before, 1, `F6: changing ${name} sends exactly one request`)
      assert.equal(requests.at(-1)?.page, 1, `F6: changing ${name} goes back to page 1`)
    }
    await surface.unmount()
  }

  // F7: a row whose stock the server did not send is unknown ("—"), never a red "Stock: 0".
  {
    requests.length = 0
    respond = async () => ({
      items: [
        { id: 1, name: 'Unknown stock', stock_quantity: null },
        { id: 2, name: 'Absent stock' },
        { id: 3, name: 'Really zero', stock_quantity: 0, out_of_stock_threshold: 0 },
        { id: 4, name: 'Plenty', stock_quantity: 40, low_stock_threshold: 5 },
      ],
      total: 4,
    })
    const surface = await mountView('en', ['stock'])
    const card = (name: string): MemoryNode => surface.find((node) => node.tagName === 'DIV' && node.className.includes('card') && node.textContent.includes(name), name)
    const pillOf = (name: string): MemoryNode => surface.find((node) => node.tagName === 'SPAN' && node.textContent.startsWith(`${en.stock}:`) && card(name).contains(node), `${name} stock pill`)
    for (const name of ['Unknown stock', 'Absent stock']) {
      const pill = pillOf(name)
      assert.equal(pill.textContent.trim(), `${en.stock}: —`, `F7: ${name} reads a neutral dash`)
      assert.ok(!/red|amber|emerald/.test(pill.className), `F7: ${name} is not coloured as a stock level`)
      assert.ok(!card(name).textContent.includes(`${en.stock}: 0`), `F7: ${name} never reads Stock: 0`)
    }
    assert.equal(pillOf('Really zero').textContent.trim(), `${en.stock}: 0`, 'F7 control: a real zero still reads 0')
    assert.ok(pillOf('Really zero').className.includes('red'), 'F7 control: a real zero is still the out-of-stock tone')
    assert.equal(pillOf('Plenty').textContent.trim(), `${en.stock}: 40`)
    await surface.click(surface.button('Unknown stock'))
    const detail = surface.find((node) => node.tagName === 'DD' && node.textContent.trim() === '—', 'detail stock dash')
    assert.ok(!/red|amber|emerald/.test(detail.childNodes[0]?.className ?? ''), 'F7: the detail stock is neutral too')
    assert.ok(!surface.text().includes(`${en.stock}0`), 'F7: the detail never reads 0 for unknown stock')
    await surface.unmount()
  }

  // F8: a reply that arrives after a newer request was sent is ignored, rows and facets alike.
  {
    requests.length = 0
    const held: Array<{ params: Params; settle: (reply: Reply) => void }> = []
    respond = (params) => new Promise<Reply>((resolve) => { held.push({ params, settle: resolve }) })
    const surface = await mountView('en', ALL_GRANTS)
    assert.equal(held.length, 1)
    held[0].settle({ items: rows('Old scope row'), total: 1, facets: { categories: ['Stale category'] } })
    await surface.settle()
    await surface.click(named(surface, en.stock_status))
    await surface.click(surface.find((node) => node.getAttribute('role') === 'option' && node.textContent.trim() === en.low_stock, 'low'))
    await surface.click(surface.button(en.today))
    assert.equal(held.length, 3, 'two newer requests are in flight')
    held[2].settle({ items: rows('Newest row'), total: 1, facets: { categories: ['Fresh category'] } })
    await surface.settle({ until: () => surface.text().includes('Newest row') })
    held[1].settle({ items: rows('Superseded row'), total: 1, facets: { categories: ['Superseded category'] } })
    await surface.settle()
    assert.ok(surface.text().includes('Newest row'), 'F8: the newest reply is shown')
    assert.ok(!surface.text().includes('Superseded row'), 'F8: the slower, older reply does not overwrite it')
    await surface.click(named(surface, en.category))
    assert.deepEqual(optionLabels(surface), [en.all, 'Fresh category'], 'F8: stale facets are ignored as well')
    await surface.unmount()
  }

  // F9: a refused request (400/403) shows the load error with Retry and keeps what was chosen.
  {
    for (const status of [403, 400]) {
      requests.length = 0
      let failing = false
      respond = async () => {
        if (failing) throw Object.assign(new Error(status === 403 ? 'image_only_filter_hidden' : 'image_only_filter_invalid'), { status })
        return { items: rows('Synthetic serum'), total: 1, facets: { categories: ['Hair'] } }
      }
      const surface = await mountView('en', ALL_GRANTS)
      failing = true
      await choose(surface, en.stock_status, en.out_of_stock)
      assert.ok(surface.text().includes(status === 403 ? 'image_only_filter_hidden' : 'image_only_filter_invalid'), `F9: ${status} shows the load-error state`)
      assert.ok(!surface.text().includes('Synthetic serum'), 'F9: the rows are replaced by the error')
      assert.equal(named(surface, en.stock_status).textContent.includes(en.out_of_stock), true, 'F9: the chosen stock state is kept')
      assert.ok(hasNamed(surface, en.stock_status) && hasNamed(surface, en.sort_by), 'F9: the controls stay reachable to change the choice')
      failing = false
      const before = requests.length
      await surface.click(surface.button(en.retry))
      assert.equal(requests.length - before, 1, 'F9: Retry sends one request')
      assert.equal(requests.at(-1)?.stockState, 'out', 'F9: Retry repeats the chosen scope')
      assert.ok(surface.text().includes('Synthetic serum'), 'F9: Retry recovers the list')
      await surface.unmount()
    }
  }

  // EN / KM render, tap size and containment.
  for (const lang of ['en', 'km']) {
    requests.length = 0
    respond = async () => ({ items: rows('Synthetic serum'), total: 1, facets: { categories: ['Hair'], brands: ['Acme'] } })
    const pack = packs[lang]
    const surface = await mountView(lang, ALL_GRANTS)
    for (const key of ['all_time', 'today', 'yesterday']) assert.ok(surface.button(pack[key]), `${lang}: preset ${key} renders in the pack's own words`)
    for (const key of ['stock_status', 'category', 'brand', 'sort_by', 'scan_barcode']) assert.ok(hasNamed(surface, pack[key]), `${lang}: ${key} control is named ${pack[key]}`)
    await surface.click(named(surface, pack.stock_status))
    assert.deepEqual(optionLabels(surface), [pack.all, pack.in_stock, pack.low_stock, pack.out_of_stock, pack.healthy_stock], `${lang}: stock options in the pack's words`)
    await surface.click(surface.find((node) => node.getAttribute('role') === 'option' && node.textContent.trim() === pack.all, 'all'))
    await surface.click(named(surface, pack.sort_by))
    assert.deepEqual(optionLabels(surface), [pack.name_a_z, pack.name_z_a], `${lang}: sort options`)
    await surface.click(surface.find((node) => node.getAttribute('role') === 'option' && node.textContent.trim() === pack.name_a_z, 'a-z'))
    if (lang === 'km') assert.ok(!surface.text().includes(en.stock_status) && !surface.text().includes(en.all_time), 'km: no English placeholder on the controls')
    for (const label of [pack.stock_status, pack.category, pack.brand, pack.sort_by]) {
      const select = named(surface, label)
      assert.ok(dimension(classesOf(select.className), 'h') >= 44, `${lang}: ${label} is a 44 px target (Khmer needs the room)`)
    }
    const filterRow = surface.find((node) => node.hasAttribute('data-products-image-only-filters'), 'filter row')
    assert.ok(classesOf(filterRow.className).includes('overflow-x-auto') && classesOf(filterRow.className).includes('min-w-0'), `${lang}: the filter row scrolls inside itself instead of widening the page`)
    await surface.unmount()
  }
  console.log('productsImageOnlyFilters.test.ts passed')
} finally {
  await harness.close()
}
