import assert from 'node:assert/strict'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

// REVERT-SET (owner, 6 Oct 2026, relayed: the owner looked at the MAIN Stock
// Changes page -- it opens on today -- and could not find the Revert). The
// page rendered for real in Chromium against a stubbed ledger: the range's
// Reverts count shows as a chip beside In/Out; pressing it asks the Worker for
// view=reverts and pressing again goes back to All; a row reverted on another
// day names that day ("Reverted 06/10/2026"), while a row reverted the same
// day keeps the plain "Reverted". EN and KM, 360 and 1280.

const fixture = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import { AppContext, FALLBACK_APP_CONTEXT } from '/src/app/AppContextCore.tsx'
  import StockChangeSection from '/src/components/products/StockChangeSection.tsx'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '@fontsource/noto-sans-khmer/400.css'
  import '/src/styles/main.css'
  const params = new URLSearchParams(location.search)
  const language = params.get('lang') || 'en'
  const t = (key) => (language === 'km' ? km : en)[key] || key
  document.body.className = language === 'km' ? 'lang-km' : ''
  window.__ledgerViews = []
  const row = (id, patch) => ({ id, product_id: 5357, product_name: 'SK-II Gentle Cleanser 20g', branch_id: 2, branch_name: 'Shop', movement_type: 'remove',
    quantity: 27, signed_quantity: -27, after_qty: 33, before_qty: 60, reason: 'Revert', reference_id: null, user_name: 'Owner', created_at: '2026-10-06 03:00:00',
    reverts_movement_id: null, reverted_by_movement_id: null, reverted_now: 0, reverted_by_at: null, batch_id: 56725, batch_received_at: '2026-09-02', ...patch })
  const items = [
    row(48300, { reference_id: 'revert:48034', reverts_movement_id: 48034 }),
    row(48034, { movement_type: 'adjustment', quantity: 27, signed_quantity: 27, after_qty: 60, before_qty: 33, created_at: '2026-10-01 03:00:00', reverted_by_movement_id: 48300, reverted_now: 1, reverted_by_at: '2026-10-06 03:00:00' }),
    row(48031, { movement_type: 'remove', quantity: 1, signed_quantity: -1, after_qty: 33, before_qty: 34, created_at: '2026-10-01 02:00:00', reverted_by_movement_id: 48032, reverted_now: 1, reverted_by_at: '2026-10-01 02:30:00' }),
  ]
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = String(input && input.url || input)
    if (!url.includes('/api/')) return realFetch(input, init)
    if (url.includes('/api/products/stock-ledger')) {
      const view = new URL(url, location.href).searchParams.get('view') || 'all'
      window.__ledgerViews.push(view)
      const shown = view === 'reverts' ? items : items.slice(0, 2)
      return json({ items: shown, total: shown.length, page: 1, pageSize: 25, totalPages: 1, view,
        summary: { inCount: 1, outCount: 2, inQty: 27, outQty: 28, revertCount: 3, total: 3 } })
    }
    return json({ success: true, items: [], rows: [] })
  }
  const user = { id: 1, name: 'Owner', role_code: 'admin', permissions: {} }
  const value = { ...FALLBACK_APP_CONTEXT, t, language, user, can: () => true, notify() {} }
  createRoot(document.getElementById('root')).render(React.createElement(AppContext.Provider, { value }, React.createElement(StockChangeSection, { t })))
`

const browser = await launchResolveFixture('stock-changes-reverts-browser', fixture)
const chipText = () => browser.evaluate<string>(`(document.querySelector('[data-stock-reverts-filter]') || {}).textContent || ''`)
const tags = () => browser.evaluate<string[]>(`[...document.querySelectorAll('[data-revert-tag="reverted"]')].filter((el) => el.offsetParent !== null).map((el) => el.textContent)`)

await browser.run('PASS Stock Changes shows the range\'s Reverts and the day a row was reverted (EN/KM, 360/1280)', async () => {
  for (const width of [360, 1280]) {
    for (const language of ['en', 'km']) {
      const tr = (en: string, km: string) => language === 'km' ? km : en
      await browser.open(width, 'lang=' + language, `document.querySelector('[data-stock-reverts-filter]')`)
      assert.ok((await chipText()).includes('3'), `${language} ${width}: the count: ${await chipText()}`)
      assert.ok((await chipText()).includes(tr('Reverts', 'ការត្រឡប់វិញ')), `${language}: the word`)
      await browser.waitFor('rows render', async () => (await tags()).length ? true : null)
      assert.deepEqual(await tags(), [tr('Reverted 06/10/2026', 'បានត្រឡប់វិញ 06/10/2026')], 'a row reverted on another day names that day')
      await browser.mouseClick('[data-stock-reverts-filter]')
      await browser.waitFor('the Reverts view loads', async () => (await browser.evaluate<string[]>('window.__ledgerViews')).includes('reverts') ? true : null)
      assert.equal(await browser.evaluate(`document.querySelector('[data-stock-reverts-filter]').getAttribute('aria-pressed')`), 'true')
      await browser.waitFor('three rows', async () => (await tags()).length === 2 ? true : null)
      assert.deepEqual((await tags()).sort(), [tr('Reverted', 'បានត្រឡប់វិញ'), tr('Reverted 06/10/2026', 'បានត្រឡប់វិញ 06/10/2026')].sort(), 'a same-day revert keeps the plain word')
      assert.equal(await browser.evaluate('document.scrollingElement.scrollWidth > innerWidth + 1'), false, 'no sideways scroll')
      await browser.mouseClick('[data-stock-reverts-filter]')
      await browser.waitFor('back to All', async () => (await browser.evaluate<string[]>('window.__ledgerViews')).at(-1) === 'all' ? true : null)
    }
  }
})
