import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

// The grouped Inventory Check list in a real browser at 375 and 1280 px, English and Khmer, light and dark: no sideways scroll, compact group headers,
// images that keep a fixed square and never stretch, and a soft see-through blue on a row with an unsaved count that is clearly not an opaque fill.
// Set INVENTORY_CHECK_SHOTS to a folder to also save a screenshot of every combination.
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
  const t = key => (language === 'km' ? km : en)[key] || key
  document.body.className = language === 'km' ? 'lang-km' : ''
  document.documentElement.classList.toggle('dark', params.get('dark') === '1')
  const wide = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><rect width="400" height="120" fill="#c9a34e"/><circle cx="60" cy="60" r="50" fill="#fff"/></svg>')
  const longName = language === 'km' ? 'ទឹកអប់ក្លិនផ្កាម្លិះធម្មជាតិ ១០០មីលីលីត្រ ផលិតផលសាកល្បងឈ្មោះវែង' : 'Synthetic product with a rather long name for the row'
  const row = (id, key, extra = {}) => ({ id, name: id % 2 ? longName : 'Short ' + id, barcode: '885000111' + id, brand: language === 'km' ? 'ម៉ាកសាកល្បង' : 'Brand', category: 'Serum', quantity: 12, unit: 'pcs', image_path: wide, check_status: 'not_checked', group_key: key, ...extra })
  const products = [row(1, 'd:2026-11-12', { check_status: 'ok', check_at: '2026-11-12 08:15:00', check_by: 'amy', check_counted_quantity: 12 }), row(2, 'd:2026-11-12', { check_status: 'issue', check_at: '2026-11-12 08:20:00', check_by: 'amy', check_counted_quantity: 9, check_note: 'Fell off the shelf' }),
    row(3, 'd:2026-11-03', { check_status: 'ok', check_at: '2026-11-03 08:15:00', check_by: 'ben', check_counted_quantity: 12 }), row(4, 'never'), row(5, 'never')]
  const grouping = { by: 'checked', unit: 'family', groups: [
    { key: 'd:2026-11-12', label: null, families: 2, products: 40, continued_before: false, continues_after: true },
    { key: 'd:2026-11-03', label: null, families: 1, products: 7, continued_before: false, continues_after: false },
    { key: 'never', label: null, families: 2, products: 120, continued_before: false, continues_after: false }] }
  const respond = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  const nativeFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(String(input && input.url || input), location.href)
    if (!url.pathname.startsWith('/api/inventory-checks/')) return nativeFetch(input, init)
    if (url.pathname.endsWith('/products')) return respond({ items: products, total: 170, page: 1, pageSize: 20, totalPages: 9, simple: true, branches: [{ id: 1, name: 'Only branch' }],
      summary: { not_checked: 2, in_check: 0, ok: 2, issue: 1, total: 5 }, facets: { brands: ['Brand'], categories: ['Serum'] }, facetsLimited: { brands: false, categories: false },
      capabilities: { groupings: ['checked', 'category'] }, ...(url.searchParams.get('groupBy') === 'checked' ? { grouping } : {}) })
    return respond({ items: [], total: 0, page: 1, pageSize: 20 })
  }
  window.history.replaceState(null, '', '/inventory#hub:inventory:products')
  const app = { ...FALLBACK_APP_CONTEXT, t, language, page: 'inventory', authReady: true, canWriteToServer: true, settings: { navigation_mode: 'sections' }, AccessDenied: () => null,
    user: { id: 7, username: 'alice', role_code: 'employee', permissions: { inventory: true, inventory_checks: true, inventory_check_show_stock: true, inventory_check_show_barcode: true, inventory_check_show_category: true, inventory_check_show_brand: true } },
    navigateTo: () => {} }
  createRoot(document.getElementById('root')).render(<AppContext.Provider value={app}><div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><InventoryChecksPage /></div></AppContext.Provider>)
`

const shots = process.env.INVENTORY_CHECK_SHOTS
if (shots) mkdirSync(shots, { recursive: true })
const browser = await launchResolveFixture('inventory-checks-grouped-layout', fixture)
await browser.run('PASS grouped Inventory Check list layout: 375 and 1280 px, English and Khmer, light and dark', async () => {
  for (const width of [375, 1280]) for (const lang of ['en', 'km']) for (const dark of [0, 1]) {
    const label = `${lang} ${width}px ${dark ? 'dark' : 'light'}`
    await browser.open(width, `lang=${lang}&dark=${dark}`, `document.querySelector('[data-inventory-check-group="never"]') && document.querySelector('[data-inventory-check-row]')`, 800)
    const flow = await browser.evaluate<{ doc: number; page: number; headers: Array<{ key: string; h: number; text: string }>; rowsBeforeFirstHeader: number }>(`(() => {
      const page = document.querySelector('[data-inventory-check-page]')
      return { doc: document.documentElement.scrollWidth - innerWidth, page: page.scrollWidth - page.clientWidth,
        headers: Array.from(document.querySelectorAll('[data-inventory-check-group]'), node => ({ key: node.getAttribute('data-inventory-check-group'), h: node.getBoundingClientRect().height, text: node.textContent })),
        rowsBeforeFirstHeader: 0 }
    })()`)
    assert.ok(flow.doc <= 0 && flow.page <= 0, `${label}: no sideways scroll (${JSON.stringify(flow)})`)
    assert.deepEqual(flow.headers.map(header => header.key), ['d:2026-11-12', 'd:2026-11-03', 'never'], `${label}: three headers, never last`)
    assert.ok(flow.headers[0].text.startsWith('12/11/2026') && flow.headers[0].text.includes('40'), `${label}: dd/mm/yyyy and the server total (${flow.headers[0].text})`)
    assert.ok(flow.headers.every(header => header.h >= 28 && header.h <= 48), `${label}: header rows stay compact (${flow.headers.map(header => header.h)})`)
    const images = await browser.evaluate<Array<{ box: [number, number]; fit: string; natural: [number, number] }>>(`Array.from(document.querySelectorAll('[data-check-image]'), button => { const img = button.querySelector('img'); const r = button.getBoundingClientRect(); return { box: [Math.round(r.width), Math.round(r.height)], fit: img ? getComputedStyle(img).objectFit : 'none', natural: img ? [img.naturalWidth, img.naturalHeight] : [0, 0] } })`)
    assert.ok(images.length === 5 && images.every(image => image.box[0] === image.box[1] && image.fit === 'cover' && image.natural[0] > image.natural[1] * 2), `${label}: a fixed square box, object-fit cover over a 400x120 source (${JSON.stringify(images[0])})`)
    // Type a count in the first row: it is unsaved, so it takes the soft blue; its neighbours stay clear. The tint is a translucent fill, not an opaque one.
    await browser.evaluate(`(() => { const input = document.querySelector('[data-inventory-check-row] [data-check-count]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, '7'); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    await browser.waitFor(`${label} unsaved row`, async () => await browser.evaluate<boolean>(`document.querySelector('[data-inventory-check-row][data-unsaved]') !== null`) || null)
    const tint = await browser.evaluate<{ unsaved: string; plain: string; selected: string }>(`(() => {
      const bg = node => getComputedStyle(node).backgroundColor
      const rows = Array.from(document.querySelectorAll('[data-inventory-check-row]'))
      const probe = document.createElement('div'); probe.className = 'bg-blue-50 dark:bg-blue-900/20'; document.body.appendChild(probe)
      const selected = bg(probe); probe.remove()
      return { unsaved: bg(rows.find(node => node.hasAttribute('data-unsaved'))), plain: bg(rows.find(node => !node.hasAttribute('data-unsaved'))), selected }
    })()`)
    const alpha = (color: string) => { const match = color.match(/rgba?\(([^)]+)\)/); const parts = match ? match[1].split(/[ ,/]+/).filter(Boolean) : []; return parts.length > 3 ? Number(parts[3]) : 1 }
    assert.ok(alpha(tint.unsaved) > 0.04 && alpha(tint.unsaved) <= 0.2, `${label}: the unsaved row has a visible but see-through fill (${tint.unsaved})`)
    assert.notEqual(tint.unsaved, tint.plain, `${label}: it differs from an untouched row (${tint.plain})`)
    assert.notEqual(tint.unsaved, tint.selected, `${label}: and from the selected-row blue (${tint.selected})`)
    // Collapse the group that holds the unsaved row: its header gets a blue dot and the exact number, and stays compact.
    await browser.mouseClick('[data-inventory-check-group="d:2026-11-12"] button')
    await browser.waitFor(`${label} unsaved cue`, async () => await browser.evaluate<boolean>(`document.querySelector('[data-inventory-check-group="d:2026-11-12"] [data-inventory-check-unsaved-cue]') !== null`) || null)
    const cue = await browser.evaluate<{ text: string; count: string | null; title: string | null; alpha: string; header: number; others: number; doc: number }>(`(() => {
      const head = document.querySelector('[data-inventory-check-group="d:2026-11-12"]'); const cue = head.querySelector('[data-inventory-check-unsaved-cue]')
      return { text: cue.textContent.trim(), count: cue.getAttribute('data-inventory-check-unsaved-cue'), title: cue.getAttribute('title'), alpha: getComputedStyle(cue).backgroundColor, header: head.getBoundingClientRect().height,
        others: document.querySelectorAll('[data-inventory-check-unsaved-cue]').length, doc: document.documentElement.scrollWidth - innerWidth }
    })()`)
    assert.ok(cue.text === '1' && cue.count === '1' && cue.others === 1, `${label}: one cue, on the collapsed group, with the exact number (${JSON.stringify(cue)})`)
    assert.ok(cue.title && /[1១]/.test(cue.title) && !cue.title.startsWith('inventory_check_group_unsaved'), `${label}: a translated tooltip (${cue.title})`)
    assert.ok(alpha(cue.alpha) > 0.04 && alpha(cue.alpha) <= 0.2, `${label}: the cue uses the see-through unsaved blue (${cue.alpha})`)
    assert.ok(cue.header >= 28 && cue.header <= 48 && cue.doc <= 0, `${label}: the header stays compact and the page does not scroll sideways with the cue (${JSON.stringify(cue)})`)
    if (lang === 'km') await browser.khmerRoom(label, '[data-inventory-check-page]', 3)
    if (shots) {
      const picture = await browser.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(`${shots}/grouped-${lang}-${width}-${dark ? 'dark' : 'light'}.png`, Buffer.from(picture.data, 'base64'))
    }
  }
})
