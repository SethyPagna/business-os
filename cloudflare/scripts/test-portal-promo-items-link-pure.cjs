// P3-L3 item C: the editor's "Promotions and posts" cards reach the public
// config, and every link on them is safe to follow.
//
// Before this, buildPortalConfig never emitted promoItems / promotionsTitle
// / promotionsIntro / showPromotions at all -- the cards (and the product
// links on them) only ever showed in the editor's own preview, which builds
// its display config from draft state. And a card's linkUrl was a
// staff-typed string the storefront rendered straight into an <a href>, so
// the same javascript:/data: hole N45 closed for the announcement strip was
// open here. The Worker now sanitises each card's linkUrl ONCE at config
// build with the shared allowlist (lib/safeLinkUrl.ts); the storefront
// re-checks it before following, pinned by frontend/tests/promotionLinks.test.ts.
//
// Run (from cloudflare/): node scripts/test-portal-promo-items-link-pure.cjs
const assert = require('assert')
const portalRoute = require('./harness/load_portal_route.cjs')

const { buildPortalConfig, normalizePortalPromoItems } = portalRoute
assert.strictEqual(typeof normalizePortalPromoItems, 'function', 'normalizePortalPromoItems should be exported')

const ENV = { BUSINESS_OS_PUBLIC_URL: 'https://leangbeauty.com' }
let checks = 0
const check = (label, fn) => { fn(); checks++; console.log(`PASS ${label}`) }

const cards = JSON.stringify([
  { id: 'promo-a', eyebrow: 'Promotion', title: 'Serum week', subtitle: '20% off', body: 'All serums.', mediaUrl: '/uploads/serum.jpg', ctaLabel: 'View', linkUrl: '', linkProductId: '42', linkProductName: 'Glow Serum' },
  { id: 'promo-b', title: 'Read the guide', linkUrl: 'https://example.com/guide', linkProductId: '' },
  { id: 'promo-c', title: 'Evil card', linkUrl: 'javascript:alert(document.cookie)' },
  { id: 'promo-d', title: 'Data card', linkUrl: 'data:text/html,<script>alert(1)</script>' },
  { id: 'promo-e', title: 'Same-site', linkUrl: '/?legal=terms' },
  { id: 'promo-f', title: '', subtitle: '', body: '', mediaUrl: '', linkUrl: 'https://example.com/only-a-link' },
  'not an object',
])

check('the saved cards reach the public config', () => {
  const config = buildPortalConfig({ customer_portal_promo_items: cards, customer_portal_promotions_title: 'Offers', customer_portal_promotions_intro: 'This week' }, ENV)
  assert.strictEqual(config.showPromotions, true)
  assert.strictEqual(config.promotionsTitle, 'Offers')
  assert.strictEqual(config.promotionsIntro, 'This week')
  assert.deepStrictEqual(config.promoItems.map((item) => item.id), ['promo-a', 'promo-b', 'promo-c', 'promo-d', 'promo-e'])
})

check('a product card keeps its product id as a number and its name', () => {
  const [card] = buildPortalConfig({ customer_portal_promo_items: cards }, ENV).promoItems
  assert.strictEqual(card.linkProductId, 42)
  assert.strictEqual(card.linkProductName, 'Glow Serum')
  assert.strictEqual(card.mediaUrl, '/uploads/serum.jpg')
  assert.strictEqual(card.ctaLabel, 'View')
})

check('http(s) and same-site links pass through unchanged', () => {
  const items = normalizePortalPromoItems(cards)
  assert.strictEqual(items.find((item) => item.id === 'promo-b').linkUrl, 'https://example.com/guide')
  assert.strictEqual(items.find((item) => item.id === 'promo-e').linkUrl, '/?legal=terms')
})

check('javascript: and data: links are stripped, the card itself stays', () => {
  const items = normalizePortalPromoItems(cards)
  for (const id of ['promo-c', 'promo-d']) {
    const item = items.find((candidate) => candidate.id === id)
    assert.ok(item, `${id} is still a card`)
    assert.strictEqual(item.linkUrl, '', `${id} must not carry a navigable target`)
  }
})

check('a card with nothing to show is dropped, a non-object entry is ignored', () => {
  const items = normalizePortalPromoItems(cards)
  assert.ok(!items.some((item) => item.id === 'promo-f'), 'a link with no visible card is not a card')
  assert.strictEqual(items.length, 5)
})

check('a missing product id is null, never 0 or NaN', () => {
  const items = normalizePortalPromoItems([{ title: 'x', linkProductId: '' }, { title: 'y', linkProductId: 'abc' }, { title: 'z', linkProductId: 0 }])
  assert.deepStrictEqual(items.map((item) => item.linkProductId), [null, null, null])
})

check('malformed JSON, a non-array and an absent setting all fail closed to no cards', () => {
  assert.deepStrictEqual(normalizePortalPromoItems('{broken'), [])
  assert.deepStrictEqual(normalizePortalPromoItems('{"a":1}'), [])
  assert.deepStrictEqual(buildPortalConfig({}, ENV).promoItems, [])
  assert.strictEqual(buildPortalConfig({}, ENV).promotionsTitle, '', 'an unset title stays empty so the storefront can localise its fallback')
  assert.strictEqual(buildPortalConfig({ customer_portal_show_promotions: '0' }, ENV).showPromotions, false)
})

console.log(`\nALL ${checks} CHECKS PASSED`)
