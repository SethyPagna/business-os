// The staff Orders screen in a real browser (KHQR G6): the real page and transport over a stubbed network. Pins what staff see and send: the list with its chips,
// filter, search and Previous/Next; an order with its before-and-after confirmations for accept, apply, accept payment, refund and cancel; who is offered what; and that it
// fits a phone in English and Khmer. With SHOTS_DIR set it also writes the 375 px and desktop screenshots (EN and KM) for the owner's review.
//
// Run: node tests/onlineOrdersBrowser.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

const fixtureSource = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import { AppContext, FALLBACK_APP_CONTEXT } from '/src/app/AppContextCore.tsx'
  import { setSyncServerUrl } from '/src/api/http.ts'
  import OnlineOrdersPage from '/src/components/online-orders/OnlineOrdersPage.tsx'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '@fontsource/noto-sans-khmer/400.css'
  import '/src/styles/main.css'

  const params = new URLSearchParams(location.search)
  const lang = params.get('lang') || 'en'
  const perm = params.get('perm') || 'all'
  const pack = lang === 'km' ? km : en
  document.body.className = lang === 'km' ? 'lang-km' : ''
  const t = (key) => pack[key] || key
  const grants = perm === 'all' ? ['view', 'decide', 'refund'] : perm === 'view' ? ['view'] : []
  const can = (key, action) => (key === 'online_orders' && grants.includes(action)) || (key === 'pos' && action === 'view' && perm === 'all')
  const log = window.__log = { calls: [], nav: [] }

  const item = (id, name, quantity, price) => ({ product_id: id, name, quantity, unit_price_usd: price, line_total_usd: price * quantity })
  const base = (over) => ({ id: 7, order_no: 'W261109K7Q2', state: 'paid', revision: 4, sale_id: null, goods_total_usd: 25, currency: 'USD', branch_id: 2, customer_name: 'Sample Buyer', customer_phone: '*** 678', fulfilment: 'pickup', customer_address: null,
    contact_telegram: '@sample', contact_instagram: null, contact_facebook: null, contact_tiktok: null, contact_whatsapp: null, contact_other: null, note: null, created_at: '2026-11-09 03:00:00.000', paid_at: '2026-11-09 03:01:00.000',
    items_json: JSON.stringify([item(1000, 'Sample Cream', 2, 10), item(1001, 'Sample Soap', 1, 5)]), ...over })
  const ev = (id, event, over = {}) => ({ id, event, source: 'customer', actor_name: null, public_comment: null, internal_note: null, amount_usd: null, reference: null, created_at: '2026-11-09 03:0' + id + ':00.000', ...over })
  const pay = (over = {}) => ({ id: 1, purpose: 'order', amount: 25, currency: 'USD', state: 'paid', paid_amount: 25, paid_at: '2026-11-09 03:01:00.000', created_at: '2026-11-09 03:00:00.000', expires_at: null, ...over })
  const store = {
    7: { order: base({}), payments: [pay()], status: 'paid', chips: [], money: { paid_usd: 25, refunded_usd: 0, refund_due_usd: 0, balance_due_usd: 0 },
      requests: [{ id: 11, kind: 'items', stage: 'paid', state: 'pending', before_json: JSON.stringify({ items: [item(1000, 'Sample Cream', 2, 10), item(1001, 'Sample Soap', 1, 5)] }), after_json: JSON.stringify({ items: [item(1000, 'Sample Cream', 3, 10), item(1001, 'Sample Soap', 1, 5)] }), customer_comment: 'Please make it three', created_at: '2026-11-09 04:00:00.000' }],
      events: [ev(1, 'created'), ev(2, 'verified_paid', { source: 'payway' }), ev(3, 'request_submitted')] },
    8: { order: base({ id: 8, order_no: 'W261109M2P5', state: 'review', revision: 6, customer_name: 'សាកល្បង', paid_at: null }), payments: [pay({ id: 2, state: 'review', paid_amount: 20, amount: 25 })], status: 'review', chips: ['needs_review'],
      money: { paid_usd: 0, refunded_usd: 0, refund_due_usd: 0, balance_due_usd: 0 }, requests: [], events: [ev(1, 'created'), ev(2, 'mismatch', { source: 'payway' })] },
    9: { order: base({ id: 9, order_no: 'W261108H4D1', state: 'cancelled', revision: 9, fulfilment: 'delivery', customer_address: '12 Street 271, Phnom Penh' }), payments: [pay({ id: 3, state: 'paid' })], status: 'cancelled', chips: [],
      money: { paid_usd: 25, refunded_usd: 0, refund_due_usd: 25, balance_due_usd: 0 }, requests: [], events: [ev(1, 'created'), ev(2, 'verified_paid', { source: 'payway' }), ev(3, 'cancelled', { source: 'staff', actor_name: 'Sokha', internal_note: 'Duplicate order' })] },
  }
  const row = (id, extra = {}) => { const o = store[id]?.order; return { id, order_no: o.order_no, state: o.state, fulfilment: o.fulfilment, customer_name: o.customer_name, customer_phone: o.customer_phone, goods_total_usd: o.goods_total_usd, created_at: o.created_at, paid_at: o.paid_at, sale_id: null, pending_requests: 0, held_review: 0, refund_due: id === 9, refund_due_usd: id === 9 ? 25 : 0, ...extra } }
  const lists = {
    first: () => ({ rows: [row(7, { pending_requests: 1 }), row(8, { held_review: 1 }), row(9)], next_cursor: '2026-11-08 03:00:00.000|9', page_size: 3 }),
    second: () => ({ rows: [{ ...row(9), id: 4, order_no: 'W261107A1B2', state: 'fulfilled', customer_name: 'Older Buyer' }], next_cursor: null, page_size: 3 }),
    review: () => ({ rows: [row(8, { held_review: 1 })], next_cursor: null, page_size: 3 }),
    requests: () => ({ rows: [row(7, { pending_requests: 1 })], next_cursor: null, page_size: 3 }),
    refund_due: () => ({ rows: [row(9)], next_cursor: null, page_size: 3 }),
  }
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  setSyncServerUrl('https://sync.example.test')
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, 'https://sync.example.test')
    const method = String(init.method || 'GET').toUpperCase()
    let body = null
    try { body = init.body ? JSON.parse(init.body) : null } catch { body = null }
    if (!url.pathname.startsWith('/api/online-orders')) return json({})
    log.calls.push({ method, path: url.pathname, search: url.search, body })
    const parts = url.pathname.split('/').filter(Boolean)
    if (method === 'GET' && parts.length === 2) {
      const filter = url.searchParams.get('filter'); const cursor = url.searchParams.get('cursor')
      if (params.get('empty') === '1') return json({ rows: [], next_cursor: null, page_size: 3 })
      const q = url.searchParams.get('q')
      if (q) {
        const phone = /^[\d+\s\-.()]+$/.test(q); const size = phone ? q.replace(/\D/g, '').length : q.replace(/[\s-]/g, '').length
        if (size < 3) return json({ error: 'short', code: 'search_too_short' }, 400)
        const all = [row(7), row(8), row(9)]
        const wanted = q.replace(/[\s-]/g, '').toLowerCase()
        return json({ rows: all.filter((x) => (phone ? x.customer_phone.replace(/\D/g, '').startsWith(q.replace(/\D/g, '')) : x.order_no.toLowerCase().startsWith(wanted))), next_cursor: null, page_size: 3 })
      }
      return json(cursor ? lists.second() : lists[filter] ? lists[filter]() : lists.first())
    }
    const id = Number(parts[2]); const rec = store[id]
    if (method === 'GET' && rec) return json(rec)
    if (!rec) return json({ error: 'That order does not exist.', code: 'order_not_found' }, 404)
    const action = parts[3]
    if (action === 'requests' && parts[5] === 'decide') { rec.requests[0].state = body.decision === 'accept' ? 'accepted' : 'rejected'; return json({ ok: true }) }
    if (action === 'requests' && parts[5] === 'apply') { rec.requests[0].state = 'applied'; rec.order.revision += 1; return json({ ok: true, top_up_usd: 5 }) }
    if (action === 'resolve') { rec.order.state = 'paid'; rec.money.paid_usd = 20; return json({ ok: true }) }
    if (action === 'cancel') { rec.order.state = 'cancelled'; rec.money.refund_due_usd = rec.money.paid_usd; return json({ ok: true }) }
    if (action === 'refund-note') { if (body.amount_usd > rec.money.refund_due_usd) return json({ error: 'over', code: 'refund_over_due' }, 409); rec.money.refund_due_usd -= body.amount_usd; rec.money.refunded_usd += body.amount_usd; return json({ ok: true, due_after_usd: rec.money.refund_due_usd }, 201) }
    if (action === 'note') return json({ ok: true }, 201)
    if (action === 'recheck') return json({ checked: 1, outcomes: ['noop'] })
    return json({})
  }
  createRoot(document.getElementById('root')).render(
    <AppContext.Provider value={{ ...FALLBACK_APP_CONTEXT, t, can, language: lang, navigateTo: (page, anchor) => log.nav.push([page, anchor]) }}>
      <OnlineOrdersPage embedded />
    </AppContext.Provider>,
  )
`

const browser = await launchResolveFixture('online-orders-browser', fixtureSource)
const { evaluate, pause, open, khmerRoom, send, waitFor } = browser

const clickButton = async (label: string, scope = 'document') => {
  const found = await evaluate<boolean>(`(() => { const button = [...${scope}.querySelectorAll('button')].find((node) => (node.getAttribute('aria-label') || node.textContent.trim()) === ${JSON.stringify(label)} && !node.disabled); if (!button) return false; button.click(); return true })()`)
  assert.ok(found, `button "${label}" is on the page and enabled`)
  await pause(120)
}
const hasButton = (label: string, scope = 'document') => evaluate<boolean>(`[...${scope}.querySelectorAll('button')].some((node) => (node.getAttribute('aria-label') || node.textContent.trim()) === ${JSON.stringify(label)})`)
const typeInto = async (selector: string, text: string, tag: 'Input' | 'TextArea' = 'Input') => {
  await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); const set = Object.getOwnPropertyDescriptor(HTML${tag}Element.prototype, 'value').set; set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await pause(60)
}
const dialog = `[...document.querySelectorAll('[role=dialog]')].pop()`
const dialogText = () => evaluate<string>(`(${dialog})?.innerText || ''`)
const calls = () => evaluate<Array<{ method: string; path: string; search: string; body: unknown }>>('__log.calls')
const lastPost = async () => (await calls()).filter((c) => c.method === 'POST').pop()
const READY_LIST = `Boolean(document.body.dataset.fixtureError) || document.querySelectorAll('[data-online-order-row]').length >= 1 || document.body.innerText.includes('No orders here')`
const opened = async (width: number, query: string, height = 760) => {
  await open(width, query, READY_LIST, height)
  assert.equal(await evaluate<string>(`document.body.dataset.fixtureError || ''`), '')
}
const openOrder = async (id: number) => {
  await evaluate(`document.querySelector('[data-online-order-row="${id}"]').click()`)
  await waitFor(`order ${id} detail`, async () => (await evaluate<boolean>(`Boolean(document.querySelector('[data-online-order-detail="${id}"] h3'))`)) ? true : null)
  await pause(100)
}
const shot = async (dir: string, name: string) => {
  fs.mkdirSync(dir, { recursive: true })
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(result.data, 'base64'))
}

async function listScenario() {
  await opened(420, 'lang=en')
  const rowsText = await evaluate<string[]>(`[...document.querySelectorAll('[data-online-order-row]')].map((n) => n.innerText.replace(/\\s+/g, ' '))`)
  assert.equal(rowsText.length, 3)
  assert.match(rowsText[0], /W261109K7Q2.*To fulfil.*Request/, 'a paid order with an unanswered request wears both chips')
  assert.match(rowsText[1], /Needs review/, 'a held payment is flagged on the list')
  assert.match(rowsText[0], /Sample Buyer.*\*\*\* 678.*Pickup/s)
  assert.match(rowsText[2], /Cancelled.*Refund due/, 'a cancelled order that still owes the customer money says so on the list')
  assert.deepEqual((await calls())[0].search, '?filter=attention', 'the screen opens on what needs a person')
  // filter
  await clickButton('Needs review', `document.querySelector('.chip-rail')`)
  await pause(150)
  assert.equal((await calls()).pop()!.search, '?filter=review')
  assert.equal(await evaluate<number>(`document.querySelectorAll('[data-online-order-row]').length`), 1)
  await clickButton('To do', `document.querySelector('.chip-rail')`)
  await pause(150)
  assert.equal(await evaluate<number>(`document.querySelectorAll('[data-online-order-row]').length`), 3)
  // the two newer chips ask the Worker for their own filter
  await clickButton('Requests', `document.querySelector('.chip-rail')`)
  await pause(150)
  assert.equal((await calls()).pop()!.search, '?filter=requests')
  await clickButton('Refund due', `document.querySelector('.chip-rail')`)
  await pause(150)
  assert.equal((await calls()).pop()!.search, '?filter=refund_due')
  assert.match(await evaluate<string>(`document.querySelector('[data-online-order-row]').innerText`), /W261108H4D1/)
  await clickButton('To do', `document.querySelector('.chip-rail')`)
  await pause(150)
  // search asks the Worker, once typing pauses and the text is long enough; it spans every state, so no chip is selected while it shows
  assert.doesNotMatch(await evaluate<string>('document.body.innerText'), /this page|Use Next to look further back/, 'no notice that search covers only one page')
  const before = (await calls()).length
  await typeInto('#oo-search', 'm2')
  await pause(600)
  assert.equal((await calls()).length, before, 'two characters ask nothing')
  assert.match(await evaluate<string>('document.body.innerText'), /Type at least 3 letters or digits to search\./)
  await typeInto('#oo-search', 'w261109m')
  await pause(700)
  assert.equal((await calls()).pop()!.search, '?q=w261109m', 'the search carries no filter')
  assert.equal(await evaluate<number>(`document.querySelectorAll('[data-online-order-row]').length`), 1)
  assert.equal(await evaluate<number>(`document.querySelectorAll('.chip-rail [aria-pressed="true"], .chip-rail [aria-selected="true"], .chip-rail [aria-current="true"]').length`), 0, 'no chip claims to be the view during a search')
  await typeInto('#oo-search', '678')
  await pause(700)
  assert.equal((await calls()).pop()!.search, '?q=678')
  await typeInto('#oo-search', 'nothing like this')
  await pause(700)
  assert.match(await evaluate<string>('document.body.innerText'), /No order matches\./)
  await typeInto('#oo-search', '')
  await pause(700)
  assert.equal((await calls()).pop()!.search, '?filter=attention', 'clearing the search returns to the chip that was open')
  assert.equal(await evaluate<number>(`document.querySelectorAll('[data-online-order-row]').length`), 3)
  // paging
  assert.match(await evaluate<string>('document.body.innerText'), /Page 1/)
  await clickButton('Next')
  await pause(150)
  assert.equal((await calls()).pop()!.search, '?filter=attention&cursor=2026-11-08+03%3A00%3A00.000%7C9', 'Next asks for the page after the Worker\'s cursor')
  assert.match(await evaluate<string>('document.body.innerText'), /Page 2/)
  assert.match(await evaluate<string>('document.body.innerText'), /Older Buyer/)
  assert.equal(await evaluate<boolean>(`[...document.querySelectorAll('button')].find((n) => n.textContent.trim() === 'Next').disabled`), true, 'the last page has no Next')
  await clickButton('Previous')
  await pause(150)
  assert.match(await evaluate<string>('document.body.innerText'), /Page 1/)
  assert.equal(await evaluate<number>(`document.querySelectorAll('[data-online-order-row]').length`), 3)
}

async function paidOrderScenario() {
  await opened(420, 'lang=en')
  await openOrder(7)
  const text = await evaluate<string>(`document.querySelector('[data-online-order-detail]').innerText`)
  assert.match(text, /Customer requests[\s\S]*Change items[\s\S]*Please make it three/)
  assert.match(text, /2 × Sample Cream[\s\S]*3 × Sample Cream/, 'the request reads before and after')
  for (const label of ['Fulfil', 'Check', 'Note', 'Cancel']) assert.ok(await hasButton(label, `document.querySelector('[data-online-order-detail]')`), `${label} is offered on a paid order`)
  assert.equal(await hasButton('Refund'), false, 'no refund button without a refund due')
  assert.equal(await hasButton('Accept payment'), false)
  // Fulfil opens the till: the order goes to the till through session storage (its lines, the online money, the revision it saw) and the app navigates to the POS
  await clickButton('Fulfil', `document.querySelector('[data-online-order-detail]')`)
  assert.match(await dialogText(), /The till opens with this order's items and its online payment filled in/)
  await clickButton('Open the till', dialog)
  await pause(150)
  assert.deepEqual(await evaluate(`__log.nav`), [['pos', null]])
  const handoff = JSON.parse(await evaluate<string>(`sessionStorage.getItem('bos:online-order-fulfil')`))
  assert.deepEqual({ id: handoff.online_order_id, rev: handoff.revision, lines: handoff.lines, paid: handoff.paid_usd }, { id: 7, rev: 4, lines: [{ product_id: 1000, quantity: 2 }, { product_id: 1001, quantity: 1 }], paid: 25 })
  // accept the request: before/after dialog, a message to the customer, the body the Worker reads
  await clickButton('Accept', `document.querySelector('[data-online-order-detail] section[aria-label="Customer requests"]')`)
  assert.match(await dialogText(), /Accept this request\?[\s\S]*Waiting for you → Accepted/)
  await typeInto('[role=dialog] textarea', 'We will pack three', 'TextArea')
  await clickButton('Accept', dialog)
  await pause(250)
  assert.deepEqual((await lastPost())!.body, { decision: 'accept', public_comment: 'We will pack three' })
  assert.equal((await lastPost())!.path, '/api/online-orders/7/requests/11/decide')
  assert.match(await evaluate<string>(`document.querySelector('[data-online-order-detail]').innerText`), /Request accepted\. Apply it to the order next\./)
  // apply it: shows the change, then the top-up the Worker worked out
  await clickButton('Apply')
  assert.match(await dialogText(), /Apply this change to the order\?[\s\S]*2 × Sample Cream[\s\S]*3 × Sample Cream/)
  await clickButton('Apply', dialog)
  await pause(250)
  assert.deepEqual((await lastPost())!.body, { revision: 4 }, 'apply carries the revision this screen saw')
  assert.match(await evaluate<string>(`document.querySelector('[data-online-order-detail]').innerText`), /Applied\. The customer pays \$5\.00 more\./)
  // cancel: before and after, a reason
  await clickButton('Cancel', `document.querySelector('[data-online-order-detail]')`)
  const cancel = await dialogText()
  assert.match(cancel, /Cancel this order\?/)
  assert.match(cancel, /Status[\s\S]*To fulfil → Cancelled/)
  assert.match(cancel, /Refund due[\s\S]*\$0\.00 → \$25\.00/, 'the refund this creates is shown before it is confirmed')
  await typeInto('[role=dialog] textarea', 'Customer asked by phone', 'TextArea')
  await clickButton('Cancel order', dialog)
  await pause(250)
  assert.deepEqual((await lastPost())!.body, { reason: 'Customer asked by phone', revision: 5 }, 'the revision after the apply, not the one from page load')
  assert.match(await evaluate<string>(`document.querySelector('[data-online-order-detail]').innerText`), /The order is cancelled\./)
  assert.ok(await hasButton('Refund'), 'once cancelled with money paid, Refund is offered')
}

async function reviewAndRefundScenario() {
  await opened(420, 'lang=en')
  await openOrder(8)
  assert.match(await evaluate<string>(`document.querySelector('[data-online-order-detail]').innerText`), /A payment came in that does not match this order: \$20\.00 is held\./)
  await clickButton('Accept', `document.querySelector('[data-online-order-detail] [role=group]')`)
  const text = await dialogText()
  assert.match(text, /Accept the held payment\?[\s\S]*Needs review → To fulfil/)
  assert.match(text, /Paid[\s\S]*\$0\.00 → \$20\.00/)
  assert.match(text, /The held money is less than the total\. Collect the difference/, 'a short payment is said before it is accepted')
  await clickButton('Accept payment', dialog)
  await pause(250)
  assert.deepEqual((await lastPost())!.body, { revision: 6 })
  await evaluate(`document.querySelector('[data-online-orders-page] button[aria-label="Refresh"]')?.click()`)
  // a cancelled order with a refund due
  await opened(420, 'lang=en')
  await openOrder(9)
  assert.match(await evaluate<string>(`document.querySelector('[data-online-order-detail]').innerText`), /A refund of \$25\.00 is due to the customer\./)
  await clickButton('Refund', `document.querySelector('[data-online-order-detail]')`)
  assert.equal(await evaluate<string>(`document.querySelector('[role=dialog] input[inputmode=decimal]').value`), '25.00', 'the amount starts at what is due')
  await typeInto('[role=dialog] input[inputmode=decimal]', '30')
  assert.match(await dialogText(), /The refund cannot be more than what is still due\./)
  assert.equal(await evaluate<boolean>(`[...document.querySelectorAll('[role=dialog] button')].find((n) => n.textContent.trim() === 'Save').disabled`), true, 'an over-due refund cannot be saved')
  await typeInto('[role=dialog] input[inputmode=decimal]', '10')
  assert.match(await dialogText(), /Refund due[\s\S]*\$25\.00 → \$15\.00/)
  await typeInto('[role=dialog] input:not([inputmode])', 'ABA-998')
  await clickButton('Save', dialog)
  await pause(250)
  assert.deepEqual((await lastPost())!.body, { amount_usd: 10, reference: 'ABA-998' })
  assert.match(await evaluate<string>(`document.querySelector('[data-online-order-detail]').innerText`), /Refund recorded\.[\s\S]*A refund of \$15\.00 is due/)
}

async function accessScenario() {
  await opened(420, 'lang=en&perm=view')
  await openOrder(7)
  const scope = `document.querySelector('[data-online-order-detail]')`
  assert.ok(await hasButton('Check', scope) && await hasButton('Note', scope), 'view alone may check a payment and add a note')
  assert.equal(await hasButton('Fulfil', scope), false, 'Fulfil is a sale: it needs the till grant as well')
  for (const label of ['Cancel', 'Accept', 'Reject', 'Apply', 'Refund']) assert.equal(await hasButton(label, scope), false, `${label} needs more than view`)
  await open(420, 'lang=en&perm=none', `Boolean(document.body.dataset.fixtureError) || document.body.innerText.includes('You do not have access')`)
  assert.equal(await evaluate<number>(`document.querySelectorAll('[data-online-order-row]').length`), 0)
  assert.equal((await calls()).length, 0, 'without view nothing is even asked for')
}

async function emptyAndErrorScenario() {
  await opened(420, 'lang=en&empty=1')
  assert.match(await evaluate<string>('document.body.innerText'), /No orders here[\s\S]*Orders that customers pay for on the website appear here\./)
}

async function layoutScenario() {
  for (const lang of ['en', 'km']) {
    await opened(375, `lang=${lang}`)
    assert.ok(await evaluate<number>(`document.documentElement.scrollWidth`) <= 375, `${lang}: nothing scrolls sideways at 375 px (list)`)
    await openOrder(8)
    assert.ok(await evaluate<number>(`document.documentElement.scrollWidth`) <= 375, `${lang}: nothing scrolls sideways at 375 px (order)`)
    assert.equal(await evaluate<boolean>(`document.querySelector('[data-online-order-row]').offsetParent === null`), true, 'on a phone the order replaces the list')
    if (lang === 'km') await khmerRoom('km 375 order', '[data-online-orders-page]', 10)
    await clickButton(lang === 'km' ? 'ត្រឡប់ទៅបញ្ជី' : 'Back to the list')
    assert.ok(await evaluate<boolean>(`document.querySelector('[data-online-order-row]').offsetParent !== null`), 'Back returns to the list')
    await opened(1280, `lang=${lang}`, 900)
    await openOrder(7)
    assert.ok(await evaluate<boolean>(`document.querySelector('[data-online-order-row]').offsetParent !== null && Boolean(document.querySelector('[data-online-order-detail]'))`), 'on a desktop the list and the order sit side by side')
    if (lang === 'km') await khmerRoom('km desktop order', '[data-online-orders-page]', 10)
  }
}

async function screenshotScenario() {
  const dir = process.env.SHOTS_DIR
  if (!dir) return
  for (const lang of ['en', 'km']) {
    await opened(375, `lang=${lang}`, 740)
    await shot(dir, `orders-1-list-375-${lang}`)
    await openOrder(7)
    await shot(dir, `orders-2-order-375-${lang}`)
    await clickButton(lang === 'km' ? 'ទទួលយក' : 'Accept', `document.querySelector('[data-online-order-detail]')`)
    await pause(150)
    await shot(dir, `orders-3-accept-dialog-375-${lang}`)
    await opened(1280, `lang=${lang}`, 800)
    await openOrder(7)
    await shot(dir, `orders-4-desktop-${lang}`)
  }
}

await browser.run('PASS the staff Orders screen lists, filters, searches and pages; shows before and after for every action; offers each person only their actions; fits a phone in English and Khmer', async () => {
  await listScenario()
  await paidOrderScenario()
  await reviewAndRefundScenario()
  await accessScenario()
  await emptyAndErrorScenario()
  await layoutScenario()
  await screenshotScenario()
})
