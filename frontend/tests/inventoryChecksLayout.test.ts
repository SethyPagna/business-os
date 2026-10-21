import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

// Board 6.0.859 AC-A4 + lane 6.0.933: the real Inventory page (Products, Sessions, an open session) in a real browser at phone
// and desktop widths, English and Khmer: no horizontal page scroll, controls never taller than their row allows, Khmer text clipped nowhere,
// the hub chips outside the scroller (one inset, not two), the open session's bar ONE line of at most 48px, and the sheet header pinned over aligned columns.
const fixture = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import { AppContext, FALLBACK_APP_CONTEXT } from '/src/app/AppContextCore.tsx'
  import InventoryChecksPage from '/src/components/inventory/InventoryChecksPage.tsx'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '/src/styles/main.css'
  import '@fontsource/noto-sans-khmer/400.css'
  const params = new URLSearchParams(location.search)
  const language = params.get('lang') || 'en'
  const section = params.get('section') || 'products'
  const t = key => (language === 'km' ? km : en)[key] || key
  document.body.className = language === 'km' ? 'lang-km' : ''
  const longName = language === 'km' ? 'ទឹកអប់ក្លិនផ្កាម្លិះធម្មជាតិ ១០០មីលីលីត្រ ផលិតផលសាកល្បងឈ្មោះវែង' : 'Synthetic long product name for the narrow phone layout check 100ml'
  const branchName = language === 'km' ? 'សាខាសាកល្បងឈ្មោះវែងបំផុតមួយ' : 'Synthetic long branch name'
  const product = (id, name, extra = {}) => ({ id, name, barcode: '8850001112223', brand: language === 'km' ? 'ម៉ាកសាកល្បង' : 'Synthetic brand', category: language === 'km' ? 'ប្រភេទសាកល្បង' : 'Synthetic category', quantity: 10, damaged_quantity: 1, qty_sold: 4, customer_count: 3, selling_price_usd: 2.5, cost_price_usd: 1.2, ...extra })
  const products = [product(12, longName), product(13, longName + ' 2'), product(14, 'Short')]
  const session = { id: 'check-1', branch_id: 1, created_by: 7, title: 'Stored', status: 'open', revision: 1, scope: {}, started_at: '2026-10-19 02:30:00', updated_at: '2026-10-19 02:30:00', closed_at: null, can_edit: true, progress: { total: 3, done: 1, issue: 1, unstarted: 1 }, branch_name: branchName, creator_name: 'alice' }
  const items = [
    { product_id: 12, state: 'issue', revision: 1, counted_quantity: 8, reason: language === 'km' ? 'ធ្លាក់ពីធ្នើ' : 'Fell off the shelf', baseline_quantity: 12, current_quantity: 10, stock_changed: true, product_snapshot: products[0], current_product_available: true, current_product_name: longName },
    { product_id: 13, state: 'done', revision: 1, counted_quantity: null, reason: null, baseline_quantity: 10, current_quantity: 10, stock_changed: false, product_snapshot: products[1], current_product_available: true, current_product_name: longName + ' 2' },
    { product_id: 14, state: 'unstarted', revision: 0, counted_quantity: null, reason: null, baseline_quantity: 10, current_quantity: 10, stock_changed: false, product_snapshot: products[2], current_product_available: true, current_product_name: 'Short' },
  ]
  const respond = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  const nativeFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(String(input && input.url || input), location.href)
    if (url.pathname === '/api/inventory/reasons') return respond({ items: [{ id: 1, type: 'adjust', label: 'Shelf mismatch' }] })
    if (!url.pathname.startsWith('/api/inventory-checks/')) return nativeFetch(input, init)
    if (url.pathname.endsWith('/products')) return respond({ items: products, total: 3, page: 1, pageSize: 20, branches: [{ id: 1, name: branchName }], stats: { total_products: 3, stock_quantity: 30, low_stock: 0, out_of_stock: 0, qty_sold: 12, unique_customer_count: 9 }, facets: { brands: ['Synthetic brand'], categories: [], reasons: [] }, facetsLimited: { brands: false, categories: false, reasons: false }, rankings: { products: [] }, issues: [] })
    if (url.pathname.endsWith('/history')) return respond({ items: [], total: 0, page: 1, pageSize: 20 })
    if (url.pathname.endsWith('/sessions')) return respond({ items: [session, { ...session, id: 'check-2', status: 'closed', closed_at: '2026-10-19 10:00:00', started_at: '2026-10-19 02:31:00', creator_name: 'bobby-with-a-long-name' }], total: 2, page: 1, pageSize: 20 })
    return respond({ item: session, items })
  }
  window.history.replaceState(null, '', '/inventory#hub:inventory:' + section)
  const app = { ...FALLBACK_APP_CONTEXT, t, language, page: 'inventory', authReady: true, canWriteToServer: true, settings: { navigation_mode: 'sections' }, AccessDenied: () => null,
    user: { id: 7, username: 'alice', role_code: 'employee', permissions: { inventory: true, inventory_checks: true } },
    navigateTo: (page, anchor) => { window.history.pushState(null, '', '/inventory#' + (anchor || '')); window.dispatchEvent(new CustomEvent('bos:navigate', { detail: { page, path: '/inventory', anchor } })) } }
  createRoot(document.getElementById('root')).render(<AppContext.Provider value={app}><div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><InventoryChecksPage /></div></AppContext.Provider>)
`

const packs = Object.fromEntries(['en', 'km'].map(lang => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8')) as Record<string, string>]))
const browser = await launchResolveFixture('inventory-checks-layout', fixture)
await browser.run('PASS Inventory page layout: Products, Sessions and an open session at 360/390/1280 px in English and Khmer', async () => {
  const overflow = `(() => { const page = document.querySelector('[data-inventory-check-page]'); return { document: document.documentElement.scrollWidth - innerWidth, page: page.scrollWidth - page.clientWidth } })()`
  for (const width of [360, 390, 1280]) for (const lang of ['en', 'km']) {
    const pack = packs[lang]
    for (const section of ['products', 'sessions']) {
      await browser.open(width, `lang=${lang}&section=${section}`, section === 'products' ? `document.querySelector('[data-inventory-check-row]')` : `document.querySelector('[data-inventory-check-session]')`, 700)
      const measured = await browser.evaluate<{ document: number; page: number }>(overflow)
      assert.ok(measured.document <= 0 && measured.page <= 0, `${lang} ${width} ${section}: no horizontal scroll (${JSON.stringify(measured)})`)
      assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[data-inventory-check-pinned]')).position`), 'sticky', `${lang} ${width}: dates, search and Filters stay pinned`)
      const hub = await browser.evaluate<{ chipsInside: boolean; chips: boolean; pageLeft: number; pinnedInset: number; rows: number; searchCentre: number | null; contextCentre: number | null; searchWidth: number | null; contextTop: number | null; searchBottom: number | null }>(`(() => {
        const page = document.querySelector('[data-inventory-check-page]'), chips = document.querySelector('.hub-section-pills'), pinned = document.querySelector('[data-inventory-check-pinned]')
        const search = document.querySelector('#inventory-check-search'), context = document.querySelector('[data-inventory-check-context]')
        const centre = node => node ? node.getBoundingClientRect().top + node.getBoundingClientRect().height / 2 : null
        return { chipsInside: !!chips && page.contains(chips), chips: !!chips, pageLeft: page.getBoundingClientRect().left, pinnedInset: pinned.firstElementChild.getBoundingClientRect().left - page.getBoundingClientRect().left,
          rows: Array.from(pinned.children).filter(child => child.getBoundingClientRect().height > 0).length, searchCentre: centre(search), contextCentre: centre(context),
          searchWidth: search ? search.closest('fieldset').getBoundingClientRect().width : null, contextTop: context ? context.getBoundingClientRect().top : null, searchBottom: search ? search.getBoundingClientRect().bottom : null }
      })()`)
      // A phone uses the layered "pages" navigation and draws no chips; wider screens must show them, outside the scroller.
      assert.ok(!hub.chipsInside && (hub.chips || width < 768), `${lang} ${width} ${section}: the section chips sit above the scroller, so they stay put and the inset is not doubled`)
      assert.ok(hub.pinnedInset >= 11 && hub.pinnedInset <= 13, `${lang} ${width} ${section}: one 12px inset inside the scroller (${hub.pinnedInset})`)
      if (section === 'sessions') assert.equal(hub.rows, 1, `${lang} ${width}: the Sessions tab pins a single row (Filters, dates, presets, Refresh)`)
      else if (width >= 1024) {
        assert.ok(Math.abs((hub.searchCentre ?? 0) - (hub.contextCentre ?? 99)) < 3, `${lang} ${width}: from 1024px the search group and the context bar share one line`)
        assert.ok(Math.abs((hub.searchWidth ?? 0) - 416) < 2, `${lang} ${width}: the search group is 26rem wide (${hub.searchWidth})`)
      } else assert.ok((hub.contextTop ?? 0) >= (hub.searchBottom ?? 999) - 1, `${lang} ${width}: on a phone the context bar sits under the search row`)
      if (section === 'sessions') {
        const rows = await browser.evaluate<string[]>(`Array.from(document.querySelectorAll('[data-inventory-check-session]'), node => node.textContent)`)
        assert.ok(rows[0].includes('09:30') && rows[1].includes('09:31'), `${lang} ${width}: sessions a minute apart read differently`)
      }
      if (lang === 'km') await browser.khmerRoom(`${width}px ${section}`, '[data-inventory-check-page]', 3)
    }
    // An open session: the bar is ONE line (never wraps, never scrolls the page); every bar action is an icon.
    await browser.open(width, `lang=${lang}&section=sessions`, `document.querySelector('[data-inventory-check-session]')`, 700)
    await browser.mouseClick('[data-inventory-check-session="check-1"] button')
    await browser.waitFor('session bar', async () => await browser.evaluate(`document.querySelector('[data-inventory-check-session-bar]') !== null && document.querySelector('[data-inventory-check-row]') !== null`) ? true : null)
    const measured = await browser.evaluate<{ document: number; page: number }>(overflow)
    assert.ok(measured.document <= 0 && measured.page <= 0, `${lang} ${width} session: no horizontal scroll (${JSON.stringify(measured)})`)
    const actions = await browser.evaluate<Array<{ label: string | null; text: string; width: number; height: number }>>(`Array.from(document.querySelectorAll('[data-inventory-check-actions] button'), node => ({ label: node.getAttribute('aria-label'), text: node.textContent, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }))`)
    assert.deepEqual(actions.map(action => action.label), [pack.inventory_check_leave_session, pack.inventory_check_session_details, pack.history, pack.inventory_check_close_session, pack.refresh], `${lang} ${width}: bar actions (the details hint exists below 640px only through its own button)`)
    assert.ok(actions.every(action => action.text === '' && (action.label === pack.inventory_check_session_details || (action.width >= 40 && action.height >= 40))), `${lang} ${width}: bar actions are touch-sized icons (the small hint trigger aside)`)
    const bar = await browser.evaluate<{ height: number; spread: number; ring: number; counts: number; middle: { left: number; right: number }; ringBox: { left: number; right: number }; countsBox: { left: number; right: number }; details: string; detailsShown: boolean; hint: boolean }>(`(() => {
      const actions = document.querySelector('[data-inventory-check-actions]'), box = node => node.getBoundingClientRect()
      const visible = Array.from(actions.children).filter(child => box(child).height > 0)
      const centres = visible.map(child => box(child).top + box(child).height / 2)
      const middle = box(actions.querySelector('[data-inventory-check-session-bar]')), ring = actions.querySelector('[data-session-progress]'), counts = actions.querySelector('[data-session-counts]'), details = actions.querySelector('[data-session-details]')
      const hint = Array.from(actions.querySelectorAll('button')).find(node => node.getAttribute('aria-label') === ${JSON.stringify(pack.inventory_check_session_details)})
      return { height: box(actions).height, spread: Math.max(...centres) - Math.min(...centres), ring: box(ring).height, counts: box(counts).height, middle: { left: middle.left, right: middle.right }, ringBox: { left: box(ring).left, right: box(ring).right }, countsBox: { left: box(counts).left, right: box(counts).right }, details: details.textContent, detailsShown: box(details).width > 0, hint: box(hint).width > 0 }
    })()`)
    assert.ok(bar.height <= 48, `${lang} ${width}: the session bar is at most 48px tall (${bar.height})`)
    assert.ok(bar.spread < 3, `${lang} ${width}: every part of the session bar sits on one line (centres differ by ${bar.spread})`)
    assert.ok(bar.ringBox.left >= bar.middle.left - 1 && bar.countsBox.right <= bar.middle.right + 1, `${lang} ${width}: the ring and both counts are in view without scrolling the bar`)
    assert.match(bar.details, /^19\/10\/2026 09:30 · .+ · @alice$/, `${lang} ${width}: the details read date, branch, creator`)
    assert.equal(bar.detailsShown, width >= 640, `${lang} ${width}: the details text shows inline from 640px`)
    assert.equal(bar.hint, width < 640, `${lang} ${width}: below 640px the same text sits behind the details hint`)
    if (width >= 1024) {
      const sheet = await browser.evaluate<{ pinned: boolean; header: boolean; aligned: boolean; detail: string }>(`(() => {
        const header = document.querySelector('[data-inventory-check-sheet-header]'), row = document.querySelector('[data-inventory-check-row]')
        const cells = Array.from(row.querySelectorAll('[data-cell]')).filter(cell => cell.getAttribute('data-cell') !== 'count' && cell.getBoundingClientRect().width > 0)
        const titles = Array.from(header.children).slice(1).filter(node => node.getBoundingClientRect().width > 0)
        const right = node => Math.round(node.getBoundingClientRect().right)
        const pairs = cells.slice(0, 3).map((cell, index) => [right(cell), right(titles[index])])
        return { pinned: document.querySelector('[data-inventory-check-pinned]').contains(header), header: getComputedStyle(header).display !== 'none', aligned: pairs.every(([cell, title]) => Math.abs(cell - title) <= 1), detail: JSON.stringify(pairs) }
      })()`)
      assert.ok(sheet.pinned && sheet.header, `${lang} ${width}: the column header is pinned with the controls`)
      assert.ok(sheet.aligned, `${lang} ${width}: the rows' Now, Start and Damaged cells end where the header titles end ${sheet.detail}`)
    }
    const rowsFit = await browser.evaluate<boolean>(`Array.from(document.querySelectorAll('[data-inventory-check-row]')).every(row => row.scrollWidth <= row.clientWidth + 1)`)
    assert.ok(rowsFit, `${lang} ${width}: product rows wrap inside their own box`)
    if (lang === 'km') await browser.khmerRoom(`${width}px session`, '[data-inventory-check-page]', 3)
  }
})
