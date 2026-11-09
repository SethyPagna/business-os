// The policies when online ordering is on (KHQR S7): what they say must be what the checkout and the Worker really do, and with the switch off
// the storefront must publish none of it. Each case names the wrong implementation it catches.
//
// Run: node tests/orderLegalCopy.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  LEGAL_PAGE_ORDER, LEGAL_PAGE_SECTIONS, LEGAL_PAGE_SECTIONS_ONLINE, LEGAL_STORAGE_ROWS, LEGAL_STORAGE_ROW_ORDERS, PORTAL_LEGAL_EN, PORTAL_LEGAL_KM,
  legalSections, legalStorageRows,
} from '../src/components/catalog/legal/legalContent.ts'
import { buildCheckoutBody, emptyCheckoutForm } from '../src/components/catalog/orders/orderLogic.ts'
import { ORDER_HISTORY_STORAGE_KEY } from '../src/components/catalog/orders/orderPath.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]) => fs.readFileSync(path.join(here, '..', ...parts), 'utf8')
const keysOf = (page: (typeof LEGAL_PAGE_ORDER)[number], online: boolean) => legalSections(page, online).flatMap((section) => [section.heading, ...section.bodies])
const ORDER_KEY = /portal_legal_(?:privacy_orders|privacy_sharing_orders|privacy_retention_orders|terms_catalogue_online|terms_online|terms_orders|store_orders)/

test('with the switch off, no page carries any ordering wording and the old pages are unchanged', () => {
  // CATCHES: a shop that never turned ordering on publishing "you can pay online" (or losing its "no payment" section).
  for (const page of LEGAL_PAGE_ORDER) {
    assert.deepEqual(legalSections(page, false), LEGAL_PAGE_SECTIONS[page])
    assert.deepEqual(keysOf(page, false).filter((key) => ORDER_KEY.test(key)), [], `${page} off`)
  }
  assert.ok(keysOf('terms', false).includes('portal_legal_terms_nopayment_h'))
  assert.deepEqual(legalStorageRows(false), LEGAL_STORAGE_ROWS)
})

test('with the switch on, the no-payment section is replaced, the rest keeps its order, and the cookies page is unchanged', () => {
  // CATCHES: "You cannot pay on this site" next to a Checkout button, a dropped section, and a reordered policy.
  const terms = keysOf('terms', true)
  assert.equal(terms.includes('portal_legal_terms_nopayment_h'), false)
  assert.equal(terms.includes('portal_legal_terms_nopayment_b'), false)
  for (const key of ['portal_legal_terms_online_h', 'portal_legal_terms_online_b', 'portal_legal_terms_orders_h', 'portal_legal_terms_orders_b', 'portal_legal_terms_catalogue_online_b']) assert.ok(terms.includes(key), key)
  assert.equal(terms.includes('portal_legal_terms_catalogue_b'), false, 'the catalogue paragraph says it is the online one')
  const kept = (page: 'privacy' | 'terms') => keysOf(page, true).filter((key) => !ORDER_KEY.test(key))
  assert.deepEqual(kept('terms'), keysOf('terms', false).filter((key) => !/nopayment|catalogue_b$/.test(key)), 'every other terms key stays, in order')
  assert.deepEqual(kept('privacy'), keysOf('privacy', false), 'privacy only gains keys')
  assert.deepEqual(LEGAL_PAGE_SECTIONS_ONLINE.cookies, LEGAL_PAGE_SECTIONS.cookies)
  const privacy = keysOf('privacy', true)
  assert.ok(privacy.indexOf('portal_legal_privacy_orders_h') === privacy.indexOf('portal_legal_privacy_collect_list') + 1, 'orders section sits right after what we keep')
  for (const key of ['portal_legal_privacy_sharing_orders', 'portal_legal_privacy_retention_orders']) assert.ok(privacy.includes(key), key)
})

test('the privacy policy names every personal detail the checkout asks for, and no billing data', () => {
  // CATCHES: a form field (address, contacts, note) the policy never mentions, and a promise about bank data the form contradicts.
  const text = PORTAL_LEGAL_EN.portal_legal_privacy_orders_b
  for (const word of ['name', 'phone number', 'address', 'social contacts', 'note', 'pickup or delivery']) assert.ok(text.includes(word), `the privacy text names the ${word}`)
  // Everything the form can send, filled in: the personal fields of the request body are exactly the ones the policy names.
  const form = { ...emptyCheckoutForm(), name: 'N', phone: '012345678', fulfilment: 'delivery' as const, address: 'A', note: 'x', contacts: { ...emptyCheckoutForm().contacts, telegram: '@t' } }
  assert.deepEqual(Object.keys(buildCheckoutBody(form, [{ id: 1, qty: 1 }], 'abcdefgh12345678')).sort(), ['address', 'client_request_id', 'contacts', 'fulfilment', 'lines', 'name', 'note', 'phone'], 'a new checkout field needs a line in the privacy text')
  assert.match(text, /we never see or keep your bank details, card numbers or passwords/)
})

test('PayWay is said to receive only what the Worker sends it: the amount, a reference and the order number', () => {
  // CATCHES: a policy that says PayWay never gets a name while the Worker starts sending one, or one that omits what it does get.
  const worker = read('..', 'cloudflare', 'src', 'lib', 'onlineOrderStore.ts')
  const call = /parsed = await generateQr\(deps\.transport, creds, \{([\s\S]*?)\}\)\r?\n  \} catch/.exec(worker)?.[1] ?? ''
  assert.ok(call.length > 50, 'found the generateQr call in issueQr')
  assert.match(call, /tranId: payment\.tran_id, amount: Number\(payment\.amount\)/)
  assert.match(call, /items: \[\{ name: `Order \$\{order\.order_no\}`/, 'the only text PayWay gets is the order number')
  assert.doesNotMatch(call, /firstName|lastName|phone|email|customer_|address/i, 'no personal field is passed to PayWay')
  const text = PORTAL_LEGAL_EN.portal_legal_privacy_sharing_orders
  assert.match(text, /receives the amount, a payment reference and the order number/)
  assert.match(text, /We never send it your name, phone number or address/)
})

test('no retention period is promised for orders (the Worker does not delete them yet)', () => {
  // CATCHES: "deleted after 90 days" copied from the unpaid-order design when no sweep exists to do it.
  for (const pack of [PORTAL_LEGAL_EN, PORTAL_LEGAL_KM]) {
    for (const key of Object.keys(pack).filter((name) => ORDER_KEY.test(name))) assert.doesNotMatch(pack[key], /\d+\s*(?:days?|months?|ថ្ងៃ|ខែ)|[០-៩]+\s*(?:ថ្ងៃ|ខែ)|deleted after|លុបក្រោយ/i, key)
  }
  assert.match(PORTAL_LEGAL_EN.portal_legal_privacy_retention_orders, /stays in our records/)
  assert.ok(!/scrub|sweep/i.test(PORTAL_LEGAL_EN.portal_legal_privacy_retention_orders))
})

test('the cookie table lists the orders key only when ordering is on, under the key the code really writes', () => {
  // CATCHES: a storage key the policy lists under a different name than orderHistory.ts writes, and the row shown to a shop with ordering off.
  assert.equal(LEGAL_STORAGE_ROW_ORDERS.name, ORDER_HISTORY_STORAGE_KEY)
  assert.deepEqual(legalStorageRows(true), [...LEGAL_STORAGE_ROWS, LEGAL_STORAGE_ROW_ORDERS])
  assert.ok(!legalStorageRows(false).some((row) => row.id === 'orders'))
  assert.match(PORTAL_LEGAL_EN.portal_legal_store_orders_p, /never holds your name, phone number or address/)
  const history = read('src', 'components', 'catalog', 'orders', 'orderHistory.ts')
  assert.match(history, /Never the\s*\/\/ name, phone or address|Never the\r?\n\/\/ name, phone or address/, 'orderHistory.ts still says it stores no name, phone or address')
})

test('the Khmer is Khmer, shares the English placeholders, and cross-refers to the real Returns heading', () => {
  // CATCHES: English left in km, a lost {name} slot, and a "see Returns" that names a heading that does not exist.
  for (const key of Object.keys(PORTAL_LEGAL_EN).filter((name) => ORDER_KEY.test(name) || /^portal_legal_terms_(?:online|orders)_h$|^portal_legal_privacy_orders_h$/.test(name))) {
    assert.match(PORTAL_LEGAL_KM[key], /[ក-៿]/, `${key} is Khmer`)
    assert.notEqual(PORTAL_LEGAL_KM[key], PORTAL_LEGAL_EN[key], key)
    assert.deepEqual(PORTAL_LEGAL_KM[key].match(/\{\w+\}/g) ?? [], PORTAL_LEGAL_EN[key].match(/\{\w+\}/g) ?? [], `${key} slots`)
  }
  assert.ok(PORTAL_LEGAL_KM.portal_legal_terms_orders_b.includes(`«${PORTAL_LEGAL_KM.portal_legal_terms_returns_h}»`))
  assert.ok(PORTAL_LEGAL_EN.portal_legal_terms_orders_b.includes(`${PORTAL_LEGAL_EN.portal_legal_terms_returns_h} section`))
})

test('the footer reads the switch: LegalPages renders the variant it is told, and the storefront tells it', () => {
  // CATCHES: new sections that exist but are never rendered, or rendered for every shop.
  const pages = read('src', 'components', 'catalog', 'legal', 'LegalPages.tsx')
  assert.doesNotMatch(pages, /LEGAL_PAGE_SECTIONS|LEGAL_STORAGE_ROWS/, 'the reader no longer reads the static (ordering-off) tables directly')
  assert.match(pages, /legalSections\(page, onlineOrders\)/)
  assert.match(pages, /legalStorageRows\(onlineOrders\)/)
  assert.match(pages, /onlineOrders = false,/, 'a footer given no flag shows the shortlist wording')
  const page = read('src', 'components', 'catalog', 'PublicCatalogPage.tsx')
  assert.match(page, /<PortalFooter [^>]*onlineOrders=\{onlineOrders\}/)
})
