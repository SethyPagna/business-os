// P3-L3 item C: the editor's "Promotions and posts" cards reach the public
// config, and every link on them is safe to follow.
//
// Before this, buildPortalConfig never emitted promoItems / promotionsTitle
// / promotionsIntro / showPromotions at all -- the cards (and the product
// links on them) only ever showed in the editor's own preview, which builds
// its display config from draft state. And a card's linkUrl was a
// staff-typed string the storefront rendered straight into an <a href>, so
// the same javascript:/data: hole N45 closed for the announcement strip was
// open here. The Worker sanitises each card's link and image ONCE, when it
// reads the stored posts (lib/portalPosts.ts), with the shared allowlist
// (lib/safeLinkUrl.ts); the storefront re-checks the link before following,
// pinned by frontend/tests/promotionLinks.test.ts.
//
// Since the Website Editor posts (WEB-1) the cards are read as posts and
// served twice by the REAL GET /api/portal/config: as `posts`, and in the
// card shape as `promoItems` for a storefront cached before posts existed.
// Every rule below holds for both, and for a v2 post's image and ctaHref.
//
// Run (from cloudflare/): node scripts/test-portal-promo-items-link-pure.cjs
const assert = require('assert')
const { createWorker, atInstant } = require('./harness/real_worker_routes.cjs')

const worker = createWorker()
const { readPortalPosts, publicPortalPosts, portalPromoCards } = worker.load('lib/portalPosts.ts')
const portal = worker.mount('/api/portal', 'routes/portal.ts')
worker.kv.set('v2:products', '1')
let settingsVersion = 1

const NOON = '2026-09-24T05:00:00.000Z'
// The cards a visitor receives for a stored value (what /config serves as promoItems).
const normalizePortalPromoItems = (value) => portalPromoCards(publicPortalPosts(readPortalPosts(value), [], Date.parse(NOON)))

function storeSettings(values) {
  for (const [key, value] of Object.entries(values)) {
    worker.rawDb.db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value)
  }
  worker.kv.set('v2:settings', String(++settingsVersion))
}
const publicConfig = () => atInstant(NOON, () => worker.call(portal, 'GET', '/api/portal/config')).then((res) => {
  assert.strictEqual(res.status, 200)
  return res.body
})

let checks = 0
async function check(label, fn) { await fn(); checks++; console.log(`PASS ${label}`) }

const cards = JSON.stringify([
  { id: 'promo-a', eyebrow: 'Promotion', title: 'Serum week', subtitle: '20% off', body: 'All serums.', mediaUrl: '/uploads/serum.jpg', ctaLabel: 'View', linkUrl: '', linkProductId: '42', linkProductName: 'Glow Serum' },
  { id: 'promo-b', title: 'Read the guide', linkUrl: 'https://example.com/guide', linkProductId: '' },
  { id: 'promo-c', title: 'Evil card', linkUrl: 'javascript:alert(document.cookie)' },
  { id: 'promo-d', title: 'Data card', linkUrl: 'data:text/html,<script>alert(1)</script>' },
  { id: 'promo-e', title: 'Same-site', linkUrl: '/?legal=terms' },
  { id: 'promo-f', title: '', subtitle: '', body: '', mediaUrl: '', linkUrl: 'https://example.com/only-a-link' },
  'not an object',
])

;(async () => {
  await check('the saved cards reach the public config', async () => {
    storeSettings({ customer_portal_promo_items: cards, customer_portal_promotions_title: 'Offers', customer_portal_promotions_intro: 'This week' })
    const config = await publicConfig()
    assert.strictEqual(config.showPromotions, true)
    assert.strictEqual(config.promotionsTitle, 'Offers')
    assert.strictEqual(config.promotionsIntro, 'This week')
    assert.deepStrictEqual(config.promoItems.map((item) => item.id), ['promo-a', 'promo-b', 'promo-c', 'promo-d', 'promo-e'])
    assert.deepStrictEqual(config.posts.map((item) => item.id), ['promo-a', 'promo-b', 'promo-c', 'promo-d', 'promo-e'])
  })

  await check('a product card keeps its product id as a number and its name', async () => {
    const config = await publicConfig()
    const [card] = config.promoItems
    assert.strictEqual(card.linkProductId, 42)
    assert.strictEqual(card.linkProductName, 'Glow Serum')
    assert.strictEqual(card.mediaUrl, '/uploads/serum.jpg')
    assert.strictEqual(card.ctaLabel, 'View')
    const [post] = config.posts
    assert.deepStrictEqual([post.linkProductId, post.linkProductName, post.image], [42, 'Glow Serum', '/uploads/serum.jpg'])
  })

  await check('http(s) and same-site links pass through unchanged', () => {
    const items = normalizePortalPromoItems(cards)
    assert.strictEqual(items.find((item) => item.id === 'promo-b').linkUrl, 'https://example.com/guide')
    assert.strictEqual(items.find((item) => item.id === 'promo-e').linkUrl, '/?legal=terms')
  })

  await check('javascript: and data: links are stripped, the card itself stays', async () => {
    const items = normalizePortalPromoItems(cards)
    const { posts } = await publicConfig()
    for (const id of ['promo-c', 'promo-d']) {
      const item = items.find((candidate) => candidate.id === id)
      assert.ok(item, `${id} is still a card`)
      assert.strictEqual(item.linkUrl, '', `${id} must not carry a navigable target`)
      assert.strictEqual(posts.find((candidate) => candidate.id === id).ctaHref, '', `${id} as a post neither`)
    }
  })

  await check('a card image goes through the SAME allowlist as its link', () => {
    // An <img src> is not a harmless place for a staff-typed URL either: a
    // protocol-relative //evil.example leaks every visitor's IP and referrer to
    // a third party, and data:/javascript: have no business being a shop photo.
    const media = normalizePortalPromoItems([
      { id: 'm-uploaded', title: 'Uploaded', mediaUrl: '/uploads/serum.jpg' },
      { id: 'm-absolute', title: 'Absolute', mediaUrl: 'https://cdn.example.com/serum.jpg' },
      { id: 'm-script', title: 'Script', mediaUrl: 'javascript:alert(1)' },
      { id: 'm-data', title: 'Data', mediaUrl: 'data:text/html,<script>alert(1)</script>' },
      { id: 'm-protocol-relative', title: 'Beacon', mediaUrl: '//evil.example/pixel.gif' },
      { id: 'm-control-char', title: 'Tabbed', mediaUrl: 'java\tscript:alert(1)' },
    ])
    const byId = Object.fromEntries(media.map((item) => [item.id, item.mediaUrl]))
    assert.strictEqual(byId['m-uploaded'], '/uploads/serum.jpg', 'an uploaded image path is what a real card carries')
    assert.strictEqual(byId['m-absolute'], 'https://cdn.example.com/serum.jpg')
    for (const id of ['m-script', 'm-data', 'm-protocol-relative', 'm-control-char']) {
      assert.strictEqual(byId[id], '', `${id} must not reach a visitor's <img src>`)
    }
    // The card itself survives, exactly as it does when its linkUrl is stripped.
    assert.strictEqual(media.length, 6)
    // ...unless the unsafe image was the only thing on it.
    assert.deepStrictEqual(normalizePortalPromoItems([{ id: 'm-only', mediaUrl: 'javascript:alert(1)' }]), [])
  })

  await check('a v2 post\'s image and ctaHref go through the same allowlist', () => {
    const [shown] = publicPortalPosts(readPortalPosts([{
      id: 'v2', kind: 'announcement', version: 3, title: 'Stored before a guard existed',
      image: '//evil.example/pixel.gif', ctaHref: 'javascript:alert(1)',
    }]), [], Date.parse(NOON))
    assert.deepStrictEqual([shown.image, shown.ctaHref], ['', ''])
  })

  await check('a card with nothing to show is dropped, a non-object entry is ignored', () => {
    const items = normalizePortalPromoItems(cards)
    assert.ok(!items.some((item) => item.id === 'promo-f'), 'a link with no visible card is not a card')
    assert.strictEqual(items.length, 5)
  })

  await check('a missing product id is null, never 0 or NaN', () => {
    const items = normalizePortalPromoItems([{ title: 'x', linkProductId: '' }, { title: 'y', linkProductId: 'abc' }, { title: 'z', linkProductId: 0 }])
    assert.deepStrictEqual(items.map((item) => item.linkProductId), [null, null, null])
  })

  await check('malformed JSON, a non-array and an absent setting all fail closed to no cards', async () => {
    assert.deepStrictEqual(normalizePortalPromoItems('{broken'), [])
    assert.deepStrictEqual(normalizePortalPromoItems('{"a":1}'), [])
    storeSettings({ customer_portal_promo_items: '{broken', customer_portal_promotions_title: '' })
    const broken = await publicConfig()
    assert.deepStrictEqual([broken.promoItems, broken.posts], [[], []])
    worker.rawDb.db.prepare(`DELETE FROM settings WHERE key IN ('customer_portal_promo_items', 'customer_portal_promotions_title')`).run()
    storeSettings({ customer_portal_show_promotions: '0' })
    const absent = await publicConfig()
    assert.deepStrictEqual([absent.promoItems, absent.posts], [[], []])
    assert.strictEqual(absent.promotionsTitle, '', 'an unset title stays empty so the storefront can localise its fallback')
    assert.strictEqual(absent.showPromotions, false)
  })

  console.log(`\nALL ${checks} CHECKS PASSED`)
})().catch((error) => { console.error(error); process.exit(1) })
