import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

// Lane 6.0.933 (spec Lane C + scanner S5): the real Inventory page in a real browser with a doubled server.
//   - typing is read after a 300ms pause (three keystrokes = one read); Enter, the camera and the scanner gun read at once;
//   - a scan never saves anything: it fills Search, narrows the list, and points at the ONE exact row
//     (a desktop focuses its Count box, a tablet its tick, a phone only highlights and scrolls);
//   - a code that is not in the open session says so; a saved scan row clears Search again on a desktop;
//   - a saved tick reads neither the products nor the session again; a query change reads products only;
//   - a gun burst into a Count box puts that box back and fills Search (blocked, and said so, while a row holds unsaved work);
//   - the same for the open editor's Reason box (6.0.940): it saves the issue on Enter, so a burst there must not become a reason;
//   - a burst put back from a field says "Barcode moved to search" like every other surface (6.0.945), but only when the scan is accepted.
const fixture = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import { AppContext, FALLBACK_APP_CONTEXT } from '/src/app/AppContextCore.tsx'
  import { setSyncServerUrl } from '/src/api/httpState.ts'
  import InventoryChecksPage from '/src/components/inventory/InventoryChecksPage.tsx'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '/src/styles/main.css'
  import '@fontsource/noto-sans-khmer/400.css'
  // Writes need a configured server; this one is the page's own origin, answered by the doubled fetch below.
  setSyncServerUrl(location.origin)
  const params = new URLSearchParams(location.search)
  const language = params.get('lang') || 'en'
  const t = key => (language === 'km' ? km : en)[key] || key
  document.body.className = language === 'km' ? 'lang-km' : ''
  const catalog = [
    { id: 12, name: 'Alpha cream', barcode: '8850001112223', quantity: 10 },
    { id: 13, name: 'Beta soap', barcode: '8850001119999', quantity: 5 },
    { id: 14, name: 'Gamma lotion', barcode: '8850001110000', quantity: 7 },
    { id: 15, name: 'Alpha toner', barcode: '7770001112223', quantity: 3 },
  ]
  const inSession = [12, 13, 14]
  const full = p => ({ ...p, brand: 'Brand', category: 'Category', damaged_quantity: 0, qty_sold: 2, customer_count: 1, selling_price_usd: 2.5, cost_price_usd: 1.2 })
  const session = { id: 'check-1', branch_id: 1, created_by: 7, title: 'Stored', status: 'open', revision: 1, scope: {}, started_at: '2026-10-19 02:30:00', updated_at: '2026-10-19 02:30:00', closed_at: null, can_edit: true, branch_name: 'Main', creator_name: 'alice' }
  const items = inSession.map(id => { const p = catalog.find(c => c.id === id); return { product_id: id, state: 'unstarted', revision: 0, counted_quantity: null, reason: null, baseline_quantity: p.quantity, current_quantity: p.quantity, stock_changed: false, product_snapshot: full(p), current_product_available: true, current_product_name: p.name } })
  const progress = () => ({ total: items.length, done: items.filter(i => i.state === 'done').length, issue: items.filter(i => i.state === 'issue').length, unstarted: items.filter(i => i.state === 'unstarted').length })
  const respond = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  window.__calls = []
  window.__enterAt = 0
  document.addEventListener('keydown', event => { if (event.key === 'Enter') window.__enterAt = performance.now() }, true)
  const nativeFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(String(input && input.url || input), location.href)
    if (url.pathname === '/api/inventory/reasons') return respond({ items: [{ id: 1, type: 'adjust', label: 'Shelf mismatch' }] })
    if (!url.pathname.startsWith('/api/inventory-checks/')) return nativeFetch(input, init)
    const at = performance.now()
    if (init && init.method === 'PATCH') {
      const body = JSON.parse(init.body)
      const id = Number(url.pathname.split('/').pop())
      window.__calls.push({ kind: 'patch', id, body, at })
      const item = items.find(i => i.product_id === id)
      Object.assign(item, { state: body.state, counted_quantity: body.counted_quantity ?? null, reason: body.reason ?? null, revision: item.revision + 1 })
      Object.assign(session, { revision: session.revision + 1, progress: progress() })
      return respond({ item, session: { ...session }, receipt: { requestId: body.requestId, eventId: 1, action: 'observe', sessionId: session.id, sessionRevision: session.revision, replayed: false } })
    }
    if (url.pathname.endsWith('/products')) {
      const query = (url.searchParams.get('query') || '').toLowerCase(), sessionId = url.searchParams.get('sessionId') || ''
      window.__calls.push({ kind: 'products', query: url.searchParams.get('query') || '', sessionId, at })
      let rows = catalog.filter(p => !query || p.name.toLowerCase().includes(query) || p.barcode.includes(query))
      if (sessionId) rows = rows.filter(p => inSession.includes(p.id))
      return respond({ items: rows.map(full), total: rows.length, page: 1, pageSize: 20, branches: [{ id: 1, name: 'Main' }], stats: { total_products: rows.length, stock_quantity: 25, low_stock: 0, out_of_stock: 0, qty_sold: 4, unique_customer_count: 2 }, facets: { brands: [], categories: [], reasons: [] }, facetsLimited: { brands: false, categories: false, reasons: false }, rankings: { products: [] }, issues: [] })
    }
    if (url.pathname.endsWith('/history')) return respond({ items: [], total: 0, page: 1, pageSize: 20 })
    if (url.pathname.endsWith('/sessions')) return respond({ items: [{ ...session, progress: progress() }], total: 1, page: 1, pageSize: 20 })
    window.__calls.push({ kind: 'session', id: url.pathname.split('/').pop(), at })
    return respond({ item: { ...session, progress: progress() }, items })
  }
  window.__setSearch = value => {
    const input = document.querySelector('#inventory-check-search')
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  // Three keystrokes a few milliseconds apart, the way a hand types, each stamped with the page clock.
  window.__typeSlowly = async (text, gapMs) => {
    const stamps = []
    for (const letter of text) {
      const input = document.querySelector('#inventory-check-search')
      input.focus()
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, input.value + letter)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      stamps.push(performance.now())
      await new Promise(resolve => setTimeout(resolve, gapMs))
    }
    return stamps
  }
  window.history.replaceState(null, '', '/inventory#hub:inventory:' + (params.get('section') || 'products'))
  const app = { ...FALLBACK_APP_CONTEXT, t, language, page: 'inventory', authReady: true, canWriteToServer: true, notify: (message, kind) => { window.__notices = window.__notices || []; window.__notices.push([message, kind]) }, settings: { navigation_mode: 'sections' }, AccessDenied: () => null,
    user: { id: 7, username: 'alice', role_code: 'employee', permissions: { inventory: true, inventory_checks: true } },
    navigateTo: (page, anchor) => { window.history.pushState(null, '', '/inventory#' + (anchor || '')); window.dispatchEvent(new CustomEvent('bos:navigate', { detail: { page, path: '/inventory', anchor } })) } }
  createRoot(document.getElementById('root')).render(<AppContext.Provider value={app}><div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><InventoryChecksPage /></div></AppContext.Provider>)
`

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const KHMER_DIGITS = ['០', '១', '២', '៣', '៤', '៥', '៦', '៧', '៨', '៩']

const browser = await launchResolveFixture('inventory-check-scan-flow', fixture)
type Call = { kind: 'products' | 'session' | 'patch'; query?: string; sessionId?: string; id?: number | string; body?: Record<string, unknown>; at: number }
const calls = () => browser.evaluate<Call[]>('window.__calls')
const count = async (kind: Call['kind']) => (await calls()).filter(call => call.kind === kind).length
const settleReads = async () => { await browser.pause(700) }
const rowIds = () => browser.evaluate<string[]>(`Array.from(document.querySelectorAll('[data-inventory-check-row]'), row => row.getAttribute('data-inventory-check-row'))`)
const searchValue = () => browser.evaluate<string>(`document.querySelector('#inventory-check-search').value`)
const focused = () => browser.evaluate<{ id: string; count: boolean; action: string | null; row: string | null }>(`(() => { const a = document.activeElement; const row = a && a.closest ? a.closest('[data-inventory-check-row]') : null; return { id: a ? a.id : '', count: !!a && a.hasAttribute('data-check-count'), action: a ? a.getAttribute('data-check-action') : null, row: row ? row.getAttribute('data-inventory-check-row') : null } })()`)
const notices = () => browser.evaluate<unknown[]>('window.__notices || []')
const hitRows = () => browser.evaluate<string[]>(`Array.from(document.querySelectorAll('[data-scan-hit]'), row => row.getAttribute('data-inventory-check-row'))`)

// A scanner gun: trusted key events whose key is the Khmer layout's digit and whose code is the physical key, each `gapMs` after the last by timestamp.
let clock = Date.now() / 1000
async function gunBurst(code: string, gapMs = 4) {
  const keys = [...code].map(digit => ({ key: KHMER_DIGITS[Number(digit)], code: `Digit${digit}`, text: KHMER_DIGITS[Number(digit)], vk: 48 + Number(digit) }))
  keys.push({ key: 'Enter', code: 'Enter', text: '\r', vk: 13 })
  for (const key of keys) {
    clock += gapMs / 1000
    await browser.send('Input.dispatchKeyEvent', { type: key.text ? 'keyDown' : 'rawKeyDown', key: key.key, code: key.code, text: key.text, unmodifiedText: key.text, windowsVirtualKeyCode: key.vk, timestamp: clock })
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: key.key, code: key.code, windowsVirtualKeyCode: key.vk, timestamp: clock })
  }
  clock += 2
}
async function openProducts(width: number, lang = 'en', height = 800) {
  await browser.open(width, `lang=${lang}&section=products`, `document.querySelector('[data-inventory-check-row]')`, height)
  await settleReads()
}
async function openSession(width: number, lang = 'en', height = 800) {
  await browser.open(width, `lang=${lang}&section=sessions`, `document.querySelector('[data-inventory-check-session]')`, height)
  await browser.mouseClick('[data-inventory-check-session="check-1"] button')
  await browser.waitFor('session rows', async () => await browser.evaluate(`document.querySelector('[data-inventory-check-session-bar]') !== null && document.querySelectorAll('[data-inventory-check-row]').length === 3`) ? true : null, 60_000)
  await settleReads()
}
const scanByEnter = async (code: string) => {
  await browser.evaluate(`window.__setSearch(${JSON.stringify(code)})`)
  await browser.press('Enter')
}

await browser.run('PASS Inventory scan flow: debounce, Enter, one-hit focus by screen size, session miss, no read per tick, gun burst, save clears Search', async () => {
  // ---- 1. Typing waits for a pause: three keystrokes make ONE products read, 300ms after the last; Enter reads at once and cancels the pause.
  await openProducts(1280)
  const baseline = await count('products')
  const stamps = await browser.evaluate<number[]>(`window.__typeSlowly('abc', 25)`)
  assert.equal(await count('products'), baseline, 'no read while the keys are still coming')
  await settleReads()
  const afterTyping = (await calls()).filter(call => call.kind === 'products').slice(baseline)
  assert.equal(afterTyping.length, 1, `three keystrokes make exactly one products read (got ${afterTyping.map(call => call.query).join(',')})`)
  assert.equal(afterTyping[0].query, 'abc', 'that read carries the whole word')
  assert.ok(afterTyping[0].at - stamps[2] >= 280, `the read waits out the pause after the last key (${Math.round(afterTyping[0].at - stamps[2])}ms)`)
  console.log(`MEASURE typing: last key -> read ${Math.round(afterTyping[0].at - stamps[2])}ms (pause 300ms)`)

  await browser.evaluate(`window.__setSearch('')`)
  await settleReads()
  const beforeEnter = await count('products')
  await browser.evaluate(`window.__typeSlowly('beta', 10)`)
  await browser.press('Enter')
  const enterAt = await browser.evaluate<number>('window.__enterAt')
  await browser.waitFor('read after Enter', async () => (await count('products')) > beforeEnter ? true : null)
  const enterRead = (await calls()).filter(call => call.kind === 'products').slice(beforeEnter)
  console.log(`MEASURE Enter -> read ${Math.round(enterRead[0].at - enterAt)}ms`)
  assert.ok(enterRead[0].at - enterAt < 50, `Enter reads within 50ms (${Math.round(enterRead[0].at - enterAt)}ms)`)
  await settleReads()
  assert.equal((await calls()).filter(call => call.kind === 'products').slice(beforeEnter).length, 1, 'and the pending pause is cancelled: no second read for the same word')

  // ---- 2. A one-hit scan inside a session: a desktop focuses the Count box, a tablet the tick, a phone only highlights. Nothing is saved.
  for (const [width, expectation] of [[1280, 'count'], [900, 'action'], [360, 'none']] as const) {
    await openSession(width)
    const reads = await count('products'), sessionReads = await count('session')
    await scanByEnter('8850001119999')
    await browser.waitFor('narrowed to the one product', async () => (await rowIds()).join() === '13' ? true : null)
    await browser.waitFor('hit ring', async () => (await hitRows()).join() === '13' ? true : null)
    assert.equal((await count('products')) - reads, 1, `${width}: the scan is one products read`)
    assert.equal(await count('session'), sessionReads, `${width}: and no session read`)
    const where = await focused()
    if (expectation === 'count') assert.deepEqual([where.count, where.row], [true, '13'], `${width}: a desktop focuses the row's Count box`)
    else if (expectation === 'action') assert.deepEqual([where.action, where.row], ['done', '13'], `${width}: a tablet focuses the row's tick`)
    else assert.ok(where.row === null && !where.count && where.action === null, `${width}: a phone focuses nothing in the row, so no keyboard pops up (${JSON.stringify(where)})`)
    const inView = await browser.evaluate<boolean>(`(() => { const r = document.querySelector('[data-inventory-check-row="13"]').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight })()`)
    assert.ok(inView, `${width}: the row is brought into view`)
    assert.equal(await count('patch'), 0, `${width}: a scan never saves anything`)
    assert.equal(await searchValue(), '8850001119999', `${width}: Search keeps the code`)
  }

  // ---- 3. Several rows share the digits: the list narrows and nothing is singled out. A code outside the session says so.
  await openSession(1280)
  await scanByEnter('0001112223')
  await browser.waitFor('narrowed to two', async () => (await rowIds()).join() === '12' ? true : null)
  assert.deepEqual(await hitRows(), [], 'a partial code that is not an exact barcode highlights nothing')
  await scanByEnter('7770001112223')
  await browser.waitFor('miss message', async () => await browser.evaluate(`document.querySelector('[data-inventory-check-empty]') !== null`) ? true : null)
  assert.equal(await browser.evaluate(`document.querySelector('[data-inventory-check-empty]').textContent`).then(text => String(text).includes(en.inventory_check_scan_not_in_session)), true, 'a product that is not in this session says so')
  const selected = await browser.evaluate<{ start: number; end: number; length: number; focused: boolean }>(`(() => { const input = document.querySelector('#inventory-check-search'); return { start: input.selectionStart, end: input.selectionEnd, length: input.value.length, focused: document.activeElement === input } })()`)
  assert.deepEqual([selected.start, selected.end, selected.focused], [0, selected.length, true], 'the missed code is selected in Search, ready to be replaced')
  assert.equal(await count('patch'), 0, 'a miss saves nothing either')
  await openSession(360, 'km')
  await scanByEnter('7770001112223')
  await browser.waitFor('miss message (Khmer)', async () => await browser.evaluate(`document.querySelector('[data-inventory-check-empty]') !== null`) ? true : null)
  assert.ok((await browser.evaluate<string>(`document.querySelector('[data-inventory-check-empty]').textContent`)).includes(km.inventory_check_scan_not_in_session), 'the miss message is translated')
  await openProducts(1280)
  await scanByEnter('1234567890123')
  await browser.waitFor('miss outside a session', async () => await browser.evaluate(`document.querySelector('[data-inventory-check-empty]') !== null`) ? true : null)
  assert.ok((await browser.evaluate<string>(`document.querySelector('[data-inventory-check-empty]').textContent`)).includes(en.inventory_check_scan_no_match), 'outside a session a missing code says no product has it')
  // A word typed and sent with Enter is not a scan: the list narrows and an empty list keeps its ordinary words.
  await scanByEnter('zzzzz')
  await browser.waitFor('word miss', async () => (await browser.evaluate<string>(`(document.querySelector('[data-inventory-check-empty]') || {}).textContent || ''`)).includes(en.inventory_check_empty) ? true : null)
  assert.ok(!(await browser.evaluate<string>(`document.querySelector('[data-inventory-check-empty]').textContent`)).includes(en.inventory_check_scan_no_match), 'a word that matches nothing is not called a code')
  // Outside a session there is nothing to count yet: the exact row is only pointed at, and the keyboard stays in Search.
  await openProducts(1280)
  await scanByEnter('8850001119999')
  await browser.waitFor('hit ring outside a session', async () => (await hitRows()).join() === '13' ? true : null)
  assert.deepEqual([(await rowIds()).join(), (await focused()).id], ['13', 'inventory-check-search'], 'outside a session the one exact row is highlighted and Search keeps the keyboard')

  // ---- 4. A tick reads nothing again; a query change reads products only.
  await openSession(1280)
  const tickReads = [await count('products'), await count('session')]
  await browser.mouseClick('[data-inventory-check-row="14"] [data-check-action="done"]')
  await browser.waitFor('tick saved', async () => (await count('patch')) === 1 ? true : null)
  await settleReads()
  assert.deepEqual([await count('products'), await count('session')], tickReads, 'a saved tick makes zero products reads and zero session reads')
  assert.equal(await browser.evaluate(`document.querySelector('[data-inventory-check-row="14"]').getAttribute('data-check-state')`), 'done', 'and the row shows the saved state from the answer')
  await browser.evaluate(`window.__typeSlowly('gam', 10)`)
  await settleReads()
  assert.equal((await count('products')) - tickReads[0], 1, 'a query change inside a session reads the products once')
  assert.equal(await count('session'), tickReads[1], 'and never the session')

  // ---- 5. Saving the scanned row on a desktop clears Search and focuses it again; on a phone the list stays.
  await openSession(1280)
  await scanByEnter('8850001119999')
  await browser.waitFor('Count focused', async () => (await focused()).count ? true : null)
  await browser.send('Input.insertText', { text: '5' })
  await browser.press('Enter')
  await browser.waitFor('count saved', async () => (await count('patch')) === 1 ? true : null)
  const saved = (await calls()).find(call => call.kind === 'patch')!
  assert.deepEqual([saved.id, saved.body?.state, saved.body?.counted_quantity, saved.body?.reason], [13, 'done', 5, null], 'a count equal to stock is saved as Done with its count')
  await browser.waitFor('Search cleared and focused', async () => (await searchValue()) === '' && (await focused()).id === 'inventory-check-search' ? true : null)
  await browser.waitFor('full list back', async () => (await rowIds()).join() === '12,13,14' ? true : null)
  assert.deepEqual(await hitRows(), [], 'and the ring is gone with the scan')
  await openSession(360)
  await scanByEnter('8850001112223')
  await browser.waitFor('narrowed', async () => (await rowIds()).join() === '12' ? true : null)
  await browser.mouseClick('[data-inventory-check-row="12"] [data-check-action="done"]')
  await browser.waitFor('tick saved', async () => (await count('patch')) === 1 ? true : null)
  await settleReads()
  assert.deepEqual([await searchValue(), (await rowIds()).join()], ['8850001112223', '12'], 'on a phone the saved row stays in the narrowed list and Search keeps its code')

  // ---- 6. A gun burst into a Count box: the box is put back, the code goes to Search, the exact row is pointed at. Nothing is saved.
  await openSession(1280)
  await browser.evaluate(`document.querySelector('[data-inventory-check-row="12"] [data-check-count]').focus()`)
  await gunBurst('8850001119999')
  await browser.waitFor('burst narrowed the list', async () => (await rowIds()).join() === '13' ? true : null)
  assert.equal(await searchValue(), '8850001119999', 'the burst reaches Search as ASCII digits whatever the layout typed')
  await browser.waitFor('hit focused', async () => { const where = await focused(); return where.count && where.row === '13' ? true : null })
  assert.equal(await browser.evaluate(`document.querySelector('[data-inventory-check-row="13"] [data-check-count]').value`), '', 'no digit of the code stayed in a Count box')
  assert.equal(await count('patch'), 0, 'a gun burst saves nothing')
  assert.deepEqual(await notices(), [[en.scan_moved_to_search, 'info']], 'a burst put back from a Count box says the code moved to Search, as every other surface does')
  // With unsaved work in a row the page does not swap the list under it: the box is still put back, the code is not lost silently.
  await openSession(1280)
  await browser.evaluate(`document.querySelector('[data-inventory-check-row="14"] [data-check-count]').focus()`)
  await browser.send('Input.insertText', { text: '5' })
  const readsBeforeBlocked = await count('products')
  await gunBurst('8850001119999')
  await browser.pause(400)
  assert.equal(await browser.evaluate(`document.querySelector('[data-inventory-check-row="14"] [data-check-count]').value`), '5', 'a Count box holding a typed number gets exactly that number back')
  assert.equal(await count('products'), readsBeforeBlocked, 'the unsaved row holds the list still')
  assert.ok((await browser.evaluate<string>(`Array.from(document.querySelectorAll('[role="alert"]'), node => node.textContent).join('|')`)).includes(en.inventory_check_count_blocked_busy), 'and the page says why')
  assert.equal(await count('patch'), 0)
  assert.deepEqual(await notices(), [], 'a blocked scan moved nothing, so it does not say the code moved')
  // 6b. The open editor's Reason box (saves the issue on Enter): the burst is not typed into the reason and saves nothing.
  await openSession(1280)
  await browser.mouseClick('[data-inventory-check-row="14"] [data-check-action="issue"]')
  await browser.waitFor('editor open', async () => await browser.evaluate(`document.querySelector('#inventory-check-reason-14') !== null`) ? true : null)
  await browser.evaluate(`document.querySelector('#inventory-check-reason-14').focus()`)
  await browser.send('Input.insertText', { text: 'Shelf' })
  const readsBeforeReason = await count('products')
  await gunBurst('8850001119999')
  await browser.pause(400)
  assert.equal(await browser.evaluate(`document.querySelector('#inventory-check-reason-14').value`), 'Shelf', 'the Reason box gets exactly its text back: no digit of the code stayed in it')
  assert.equal(await count('patch'), 0, 'the burst\'s Enter did not save the issue')
  assert.equal(await count('products'), readsBeforeReason, 'the open editor holds the list still')
  assert.ok((await browser.evaluate<string>(`Array.from(document.querySelectorAll('[role="alert"]'), node => node.textContent).join('|')`)).includes(en.inventory_check_count_blocked_busy), 'and the page says why')
  // A person typing a reason and pressing Enter still saves the issue.
  await browser.evaluate(`document.querySelector('#inventory-check-reason-14').focus()`)
  await browser.press('Enter')
  await browser.waitFor('issue saved', async () => (await count('patch')) === 1 ? true : null)
  assert.equal(((await calls()).find(call => call.kind === 'patch')?.body as { reason?: string }).reason, 'Shelf', 'the saved reason is what the person typed')
  // A burst with nothing focused goes to Search as well.
  await openProducts(1280)
  await browser.evaluate(`document.activeElement && document.activeElement.blur()`)
  await gunBurst('8850001112223')
  await browser.waitFor('idle burst narrowed', async () => (await rowIds()).join() === '12' ? true : null)
  assert.equal(await searchValue(), '8850001112223', 'a scan with nothing focused is no longer lost')
  assert.deepEqual(await notices(), [], 'nothing was put back from a field, so there is nothing to announce')
})
