// The till's online-order strip and the Returns "Through ABA" choice in a real browser (KHQR S6a/S6b, security review F3): the real components over a small harness that plays the
// cart. Pins what a cashier reads while ringing up an order (ordered -> in this sale, line by line; the money difference in plain words; the missing-method warning) and what a
// returner reads before sending a refund through ABA; and that both fit a phone in English and Khmer.
//
// Run: node tests/onlineOrderTillBrowser.test.ts
import assert from 'node:assert/strict'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

const fixtureSource = String.raw`
  import React, { useState } from 'react'
  import { createRoot } from 'react-dom/client'
  import FulfilBanner from '/src/components/online-orders/FulfilBanner.tsx'
  import AbaRefundChoice from '/src/components/returns/AbaRefundChoice.tsx'
  import { abaRefundOffer } from '/src/components/returns/helpers/abaRefund.ts'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '@fontsource/noto-sans-khmer/400.css'
  import '/src/styles/main.css'

  const params = new URLSearchParams(location.search)
  const lang = params.get('lang') || 'en'
  const pack = lang === 'km' ? km : en
  document.body.className = lang === 'km' ? 'lang-km' : ''
  const tt = (key, fallback) => (pack[key] && pack[key] !== key ? pack[key] : fallback)
  const T = tt
  const fmtUSD = (v) => '$' + Number(v).toFixed(2)
  const handoff = { online_order_id: 7, order_no: 'W261109K7Q2', revision: 4, branch_id: 2, customer_name: lang === 'km' ? 'សាកល្បង' : 'Sample Buyer', customer_phone: '*** 678', fulfilment: 'pickup', address: null,
    lines: [{ product_id: 1000, quantity: 2 }, { product_id: 1001, quantity: 1 }], paid_usd: 25 }
  const names = new Map([[1000, lang === 'km' ? 'ក្រែមសាកល្បង' : 'Sample Cream'], [1001, 'Sample Soap'], [1002, 'Sample Mask']])
  const log = window.__log = { added: [], detached: 0, aba: [] }
  const rows = [{ method: 'Cash', amount_usd: 5 }, { method: 'ABA KHQR', amount_usd: 20 }]

  function Harness() {
    const [cart, setCart] = useState([{ productId: 1000, quantity: 2 }, { productId: 1001, quantity: 1 }])
    const [total, setTotal] = useState(25)
    const [credit, setCredit] = useState(12.5)
    const [viaAba, setViaAba] = useState(false)
    const [method, setMethod] = useState(null)
    window.__set = { setCart, setTotal, setCredit, setMethod }
    const offer = abaRefundOffer({ paymentDetails: rows, method: 'ABA KHQR', canRefund: true, creditUsd: credit, exchangeActive: false, returnType: 'refund' })
    return (
      <div style={{ maxWidth: 480 }}>
        <FulfilBanner tt={tt} handoff={handoff} cart={cart} saleTotalUsd={total} names={names} fmtUSD={fmtUSD} methodMissing={method}
          onAddLine={(id) => log.added.push(id)} onDetach={() => { log.detached += 1 }} />
        <div id="aba"><AbaRefundChoice offer={offer} viaAba={viaAba} T={T} fmtUSD={fmtUSD} onChange={(v) => { setViaAba(v); log.aba.push(v) }} /></div>
      </div>
    )
  }
  createRoot(document.getElementById('root')).render(<Harness />)
`

const browser = await launchResolveFixture('online-order-till-browser', fixtureSource)
const { evaluate, pause, open, khmerRoom } = browser

const text = (selector: string) => evaluate<string>(`document.querySelector(${JSON.stringify(selector)})?.innerText.replace(/\\s+/g, ' ').trim() || ''`)
const set = async (call: string) => { await evaluate(`${call}; true`); await pause(120) }
const click = async (scope: string, label: string) => {
  assert.ok(await evaluate<boolean>(`(() => { const b = [...document.querySelector(${JSON.stringify(scope)}).querySelectorAll('button')].find((n) => (n.getAttribute('aria-label') || n.textContent.trim()) === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true })()`), `button ${label}`)
  await pause(120)
}
const READY = `Boolean(document.body.dataset.fixtureError) || Boolean(document.querySelector('[data-online-order-till]'))`

async function bannerScenario() {
  await open(420, 'lang=en', READY)
  const strip = '[data-online-order-till]'
  let t = await text(strip)
  assert.match(t, /Online order W261109K7Q2/)
  assert.match(t, /Sample Buyer · \*\*\* 678/)
  assert.match(t, /Sample Cream 2 → 2/)
  assert.match(t, /Sample Soap 1 → 1/)
  assert.match(t, /Paid online \$25\.00/)
  assert.match(t, /This sale \$25\.00/)
  assert.equal(await evaluate<string>(`document.querySelector('[data-fulfil-money]').dataset.fulfilMoney`), 'same')
  assert.match(t, /The online payment covers this sale exactly\./)
  assert.equal(await evaluate<number>(`document.querySelectorAll('[data-order-line] button').length`), 0, 'nothing is missing, so no add buttons')

  // the cashier takes a line out: it shows before -> after, the add button appears, and the money sentence follows the total
  await set(`__set.setCart([{ productId: 1000, quantity: 2 }]); __set.setTotal(20)`)
  t = await text(strip)
  assert.match(t, /Sample Soap 1 → 0/)
  assert.equal(await evaluate<string>(`document.querySelector('[data-fulfil-money]').dataset.fulfilMoney`), 'refund_back')
  assert.match(t, /The customer paid \$5\.00 more online than this sale comes to\. After Complete, send \$5\.00 back through ABA from Orders\./)
  await click(strip, 'Add to the sale')
  assert.deepEqual(await evaluate(`__log.added`), [1001])

  // an extra product, and a bigger sale
  await set(`__set.setCart([{ productId: 1000, quantity: 2 }, { productId: 1001, quantity: 1 }, { productId: 1002, quantity: 1 }]); __set.setTotal(31.5)`)
  t = await text(strip)
  assert.match(t, /Sample Mask 0 → 1/, 'a line the order never had is shown as an addition')
  assert.equal(await evaluate<string>(`document.querySelector('[data-fulfil-money]').dataset.fulfilMoney`), 'owe_more')
  assert.match(t, /The sale is \$6\.50 more than the customer paid online\. Take \$6\.50 at the till with another payment below\./)

  // a payment method that is not configured is said before Complete, not as a refusal after it
  assert.equal(await evaluate<number>(`document.querySelectorAll('[data-online-order-till] [role=alert]').length`), 0)
  await set(`__set.setMethod('ABA KHQR')`)
  assert.match(await text('[data-online-order-till] [role=alert]'), /The payment method "ABA KHQR" is not set up, so this sale cannot be saved\./)

  // detaching is one tap with a tooltip
  assert.equal(await evaluate<string>(`document.querySelector('[data-online-order-till] button[aria-label="Sell without this order"]').title`), 'Sell without this order')
  await click(strip, 'Sell without this order')
  assert.equal(await evaluate<number>(`__log.detached`), 1)
}

async function abaScenario() {
  await open(420, 'lang=en', READY)
  const box = '#aba'
  let t = await text(box)
  assert.match(t, /Send the refund/)
  assert.match(t, /\$12\.50 is paid out of the till drawer\./, 'cash is the default and says what it does to the drawer')
  assert.match(t, /Up to \$20\.00 was paid online for this sale\./)
  assert.equal(await evaluate<string>(`document.querySelector('#aba [role=radio][aria-checked=true]').textContent`), 'Cash from the till')
  await click(box, 'Through ABA')
  t = await text(box)
  assert.match(t, /\$12\.50 goes back through ABA\. The till drawer is not touched; send the money from the ABA app after confirming\./)
  assert.equal(await evaluate<string>(`document.querySelector('[data-aba-cap]').dataset.abaCap`), 'ok')
  await set(`__set.setCredit(25)`)
  assert.equal(await evaluate<string>(`document.querySelector('[data-aba-cap]').dataset.abaCap`), 'over')
  assert.match(await text(box), /This is more than the \$20\.00 the customer paid online\. Choose cash, or refund fewer items\./)
  await set(`__set.setCredit(0)`)
  assert.equal(await evaluate<number>(`document.querySelectorAll('#aba [data-section=aba-refund]').length`), 0, 'nothing to refund, nothing to choose')
}

async function layoutScenario() {
  for (const lang of ['en', 'km']) {
    await open(375, `lang=${lang}`, READY)
    assert.ok(await evaluate<number>(`document.documentElement.scrollWidth`) <= 375, `${lang}: nothing scrolls sideways at 375 px`)
    await set(`__set.setCart([{ productId: 1000, quantity: 1 }, { productId: 1002, quantity: 1 }]); __set.setTotal(31.5); __set.setMethod('ABA KHQR')`)
    assert.ok(await evaluate<number>(`document.documentElement.scrollWidth`) <= 375, `${lang}: still fits with a long sentence and a warning`)
    if (lang === 'km') await khmerRoom('km till strip', 'body', 10)
  }
}

await browser.run('PASS the till strip shows ordered -> in this sale and the money difference in words; Through ABA states its effect and cap; both fit a phone in English and Khmer', async () => {
  await bannerScenario()
  await abaScenario()
  await layoutScenario()
})
