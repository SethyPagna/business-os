import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

// Board 6.0.859 AC-A4: the real Inventory page (Products, Sessions, an open session) in a real browser at phone
// widths, English and Khmer: no horizontal page scroll, controls never taller than their row allows, Khmer text clipped nowhere.
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
      if (section === 'sessions') {
        const rows = await browser.evaluate<string[]>(`Array.from(document.querySelectorAll('[data-inventory-check-session]'), node => node.textContent)`)
        assert.ok(rows[0].includes('09:30') && rows[1].includes('09:31'), `${lang} ${width}: sessions a minute apart read differently`)
      }
      if (lang === 'km') await browser.khmerRoom(`${width}px ${section}`, '[data-inventory-check-page]', 3)
    }
    // An open session: the bar wraps at phone width but never scrolls the page; every bar action is an icon.
    await browser.open(width, `lang=${lang}&section=sessions`, `document.querySelector('[data-inventory-check-session]')`, 700)
    await browser.mouseClick('[data-inventory-check-session="check-1"] button')
    await browser.waitFor('session bar', async () => await browser.evaluate(`document.querySelector('[data-inventory-check-session-bar]') !== null && document.querySelector('[data-inventory-check-row]') !== null`) ? true : null)
    const measured = await browser.evaluate<{ document: number; page: number }>(overflow)
    assert.ok(measured.document <= 0 && measured.page <= 0, `${lang} ${width} session: no horizontal scroll (${JSON.stringify(measured)})`)
    const actions = await browser.evaluate<Array<{ label: string | null; text: string; width: number; height: number }>>(`Array.from(document.querySelectorAll('[data-inventory-check-actions] button'), node => ({ label: node.getAttribute('aria-label'), text: node.textContent, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }))`)
    assert.deepEqual(actions.map(action => action.label), [pack.inventory_check_leave_session, pack.history, pack.inventory_check_close_session, pack.refresh], `${lang} ${width}: bar actions`)
    assert.ok(actions.every(action => action.text === '' && action.width >= 40 && action.height >= 40), `${lang} ${width}: bar actions are touch-sized icons`)
    const rowsFit = await browser.evaluate<boolean>(`Array.from(document.querySelectorAll('[data-inventory-check-row]')).every(row => row.scrollWidth <= row.clientWidth + 1)`)
    assert.ok(rowsFit, `${lang} ${width}: product rows wrap inside their own box`)
    if (lang === 'km') await browser.khmerRoom(`${width}px session`, '[data-inventory-check-page]', 3)
  }
})
