// Website Editor lane: the post model (lib/portalPosts.ts) and the public
// config that serves it.
//
//   - v1 cards already stored in customer_portal_promo_items read as v2
//     Promotion posts and reach visitors EXACTLY as they did before posts
//     existed (the expected cards below are the output of the old
//     normalizePortalPromoItems at 88f1912c for the same input);
//   - status is derived: Hidden > Ended > Scheduled > Live, with dates on the
//     Phnom Penh business day, an Event ending after its event date, a Story
//     living 24 hours, and a Discount post living exactly while its POS rule
//     is active (the kernel's own isRuleActive);
//   - the public list holds Live posts only, pinned first, with no editing
//     metadata, and a Discount post carries its rule's live label;
//   - GET /api/portal/config and /bootstrap (the REAL routes, real SQLite)
//     carry `posts` plus the v1 `promoItems`, read the rules only when a
//     Discount post exists, and switching the rule off through the REAL
//     rules route ends the offer on the site and at the till together.
//
// Run (from cloudflare/): node scripts/test-portal-posts-model-pure.cjs
const assert = require('assert')
const { createWorker, atInstant } = require('./harness/real_worker_routes.cjs')

const worker = createWorker()
const posts = worker.load('lib/portalPosts.ts')
const { normalizePromotionRule, isRuleActive } = worker.load('lib/promotionRules.ts')
const { readPortalPosts, publicPortalPosts, portalPromoCards, portalPostStatus, MAX_PORTAL_POSTS } = posts

const NOON_24 = '2026-09-24T05:00:00.000Z' // 12:00 on the 24th in Phnom Penh
const LAST_SECOND_24 = '2026-09-24T16:59:59.000Z' // 23:59:59 on the 24th
const MIDNIGHT_25 = '2026-09-24T17:00:00.000Z' // 00:00 on the 25th
const at = (iso) => Date.parse(iso)
const NO_RULES = new Map()

const EMPTY_KM = { eyebrow: '', title: '', subtitle: '', body: '', ctaLabel: '' }
const post = (overrides) => ({
  id: 'p', kind: 'promotion', eyebrow: '', title: 'A post', subtitle: '', body: '', ctaLabel: '', ctaHref: '', image: '',
  linkProductId: null, linkProductName: '', km: { ...EMPTY_KM }, startsOn: '', endsOn: '',
  postedAt: '2026-09-20T02:00:00.000Z', pinned: false, hidden: false, ruleId: null, eventDate: '', location: '',
  version: 1, updatedAt: '2026-09-20T02:00:00.000Z', ...overrides,
})
const rule = (overrides = {}) => normalizePromotionRule({
  id: 9, title: 'Serum Friday', show_title: 1, rule_type: 'percent_off', percent_off: 20, scope_type: 'category',
  category: 'Serum', badge_color: '#123abc', label_style: 'save', is_active: 1, starts_at: null, ends_at: null, ...overrides,
})
const statusAt = (value, iso, rules = NO_RULES) => portalPostStatus(value, at(iso), rules)

// Cards as the editor stored them before posts (portalEditorUtils.ts
// serializePromoItems), including the awkward ones.
const V1_CARDS = [
  { id: 'promo-1726900000000-a1b2c3', eyebrow: 'Promotion', title: 'Serum week', subtitle: '20% off all serums', body: 'Every serum on the shelf.\nThis week only.', mediaUrl: '/uploads/serum-week.jpg', ctaLabel: 'Shop serums', linkUrl: '', linkProductId: '42', linkProductName: 'Glow Serum 30ml' },
  { id: 'promo-1726900000001-d4e5f6', eyebrow: 'News', title: '  New branch open  ', subtitle: '', body: '', mediaUrl: 'https://cdn.example.com/branch.png', ctaLabel: 'Learn more', linkUrl: 'https://maps.example.com/branch', linkProductId: '', linkProductName: '' },
  { id: '', eyebrow: '', title: 'No id card', subtitle: 'kept', body: '  padded body  ', mediaUrl: '', ctaLabel: '', linkUrl: '/?legal=terms', linkProductId: 'abc', linkProductName: '' },
  { id: 'promo-empty', eyebrow: 'Promotion', title: '', subtitle: '', body: '', mediaUrl: '', ctaLabel: 'Learn more', linkUrl: 'https://example.com', linkProductId: '', linkProductName: '' },
  { id: 7, title: 'Numeric id', mediaUrl: 'javascript:alert(1)', linkUrl: 'data:text/html,x', linkProductId: 12.7 },
  null,
  { id: 'promo-image-only', mediaUrl: '/uploads/poster.webp' },
]
// normalizePortalPromoItems(JSON.stringify(V1_CARDS)) at 88f1912c, verbatim.
const V1_CARDS_AS_SERVED_BEFORE = [
  { id: 'promo-1726900000000-a1b2c3', eyebrow: 'Promotion', title: 'Serum week', subtitle: '20% off all serums', body: 'Every serum on the shelf.\nThis week only.', mediaUrl: '/uploads/serum-week.jpg', ctaLabel: 'Shop serums', linkUrl: '', linkProductId: 42, linkProductName: 'Glow Serum 30ml' },
  { id: 'promo-1726900000001-d4e5f6', eyebrow: 'News', title: 'New branch open', subtitle: '', body: '', mediaUrl: 'https://cdn.example.com/branch.png', ctaLabel: 'Learn more', linkUrl: 'https://maps.example.com/branch', linkProductId: null, linkProductName: '' },
  { id: 'promo-3', eyebrow: '', title: 'No id card', subtitle: 'kept', body: 'padded body', mediaUrl: '', ctaLabel: '', linkUrl: '/?legal=terms', linkProductId: null, linkProductName: '' },
  { id: '7', eyebrow: '', title: 'Numeric id', subtitle: '', body: '', mediaUrl: '', ctaLabel: '', linkUrl: '', linkProductId: 12, linkProductName: '' },
  { id: 'promo-image-only', eyebrow: '', title: '', subtitle: '', body: '', mediaUrl: '/uploads/poster.webp', ctaLabel: '', linkUrl: '', linkProductId: null, linkProductName: '' },
]

let checks = 0
async function check(label, fn) { await fn(); checks++; console.log(`PASS ${label}`) }

;(async () => {
  await check('stored v1 cards read as Promotion posts and reach visitors exactly as the cards did', () => {
    const read = readPortalPosts(JSON.stringify(V1_CARDS))
    assert.deepStrictEqual(read.map((item) => [item.kind, item.version, item.pinned, item.hidden, item.startsOn, item.endsOn]),
      read.map(() => ['promotion', 1, false, false, '', '']))
    assert.ok(read.every((item) => JSON.stringify(item.km) === JSON.stringify(EMPTY_KM)), 'no Khmer yet: the site falls back to English')
    assert.deepStrictEqual(portalPromoCards(publicPortalPosts(read, [], at(NOON_24))), V1_CARDS_AS_SERVED_BEFORE)
    // The same list, already parsed, reads the same.
    assert.deepStrictEqual(readPortalPosts(V1_CARDS), read)
  })

  await check('start and end dates are Phnom Penh business days', () => {
    const starts25 = post({ startsOn: '2026-09-25' })
    assert.strictEqual(statusAt(starts25, LAST_SECOND_24), 'scheduled')
    assert.strictEqual(statusAt(starts25, MIDNIGHT_25), 'live', 'live from local midnight, not from 07:00 when the UTC date turns')
    const ends24 = post({ endsOn: '2026-09-24' })
    assert.strictEqual(statusAt(ends24, LAST_SECOND_24), 'live', 'the end day is shown in full')
    assert.strictEqual(statusAt(ends24, MIDNIGHT_25), 'ended')
    assert.strictEqual(statusAt(post({}), NOON_24), 'live', 'no dates: live from posting, no end')
  })

  await check('Hidden beats every date, and Ended beats Scheduled', () => {
    assert.strictEqual(statusAt(post({ hidden: true }), NOON_24), 'hidden')
    assert.strictEqual(statusAt(post({ hidden: true, endsOn: '2026-01-01' }), NOON_24), 'hidden')
    assert.strictEqual(statusAt(post({ startsOn: '2026-10-01', endsOn: '2026-09-01' }), NOON_24), 'ended')
  })

  await check('an Event with no end date ends after its event date; an end date overrides that', () => {
    const event = post({ kind: 'event', eventDate: '2026-09-24', location: 'Main branch' })
    assert.strictEqual(statusAt(event, LAST_SECOND_24), 'live')
    assert.strictEqual(statusAt(event, MIDNIGHT_25), 'ended')
    assert.strictEqual(statusAt({ ...event, endsOn: '2026-09-30' }, MIDNIGHT_25), 'live')
  })

  await check('a Story is live for 24 hours from posting, whatever its dates say', () => {
    const story = post({ kind: 'story', postedAt: '2026-09-24T03:00:00.000Z', endsOn: '2026-01-01' })
    assert.strictEqual(statusAt(story, '2026-09-25T02:59:59.999Z'), 'live')
    assert.strictEqual(statusAt(story, '2026-09-25T03:00:00.000Z'), 'ended')
    assert.strictEqual(statusAt({ ...story, postedAt: '' }, NOON_24), 'ended', 'a story with no posting time cannot be proven fresh')
  })

  await check('a Discount post is live exactly while its rule is active, by the POS kernel', () => {
    const discount = post({ kind: 'discount', ruleId: 9 })
    const withRule = (value) => new Map([[9, value]])
    assert.strictEqual(statusAt(discount, NOON_24, withRule(rule())), 'live')
    assert.strictEqual(statusAt(discount, NOON_24, withRule(rule({ is_active: 0 }))), 'ended', 'switched off')
    assert.strictEqual(statusAt(discount, NOON_24, withRule(rule({ percent_off: 0 }))), 'ended', 'no benefit left')
    assert.strictEqual(statusAt(discount, NOON_24, withRule(rule({ starts_at: '2026-10-01' }))), 'scheduled')
    assert.strictEqual(statusAt(discount, NOON_24, withRule(rule({ starts_at: '2026-10-01', ends_at: '2026-09-30' }))), 'ended', 'a window that never opens')
    assert.strictEqual(statusAt(discount, NOON_24), 'ended', 'the rule is gone')
    assert.strictEqual(statusAt({ ...discount, hidden: true }, NOON_24, withRule(rule())), 'hidden')
    // The rule's own window edge is the kernel's, not a website copy of it.
    const endsOn25 = rule({ ends_at: '2026-09-25' })
    for (const iso of ['2026-09-24T23:59:59.000Z', '2026-09-25T00:00:01.000Z']) {
      assert.strictEqual(statusAt(discount, iso, withRule(endsOn25)), isRuleActive(endsOn25, at(iso)) ? 'live' : 'ended', iso)
    }
    assert.strictEqual(statusAt(discount, '2026-09-25T00:00:01.000Z', withRule(endsOn25)), 'ended')
  })

  await check('the public list holds Live posts only, pinned first, and no editing metadata', () => {
    const list = [
      post({ id: 'a' }),
      post({ id: 'b', pinned: true }),
      post({ id: 'c', startsOn: '2026-10-01' }),
      post({ id: 'd', hidden: true }),
      post({ id: 'e', pinned: true, km: { ...EMPTY_KM, title: 'ប្រកាស' } }),
      post({ id: 'f', endsOn: '2026-09-01' }),
    ]
    const shown = publicPortalPosts(list, [], at(NOON_24))
    assert.deepStrictEqual(shown.map((item) => item.id), ['b', 'e', 'a'])
    assert.deepStrictEqual(Object.keys(shown[0]).sort(), [
      'body', 'ctaHref', 'ctaLabel', 'endsOn', 'eventDate', 'eyebrow', 'id', 'image', 'kind', 'km', 'linkProductId',
      'linkProductName', 'location', 'pinned', 'postedAt', 'ruleBadgeColor', 'ruleId', 'ruleLabel', 'startsOn', 'subtitle', 'title',
    ])
    assert.strictEqual(shown[1].km.title, 'ប្រកាស', 'Khmer text rides along')
    assert.strictEqual(shown[0].km.title, '', 'empty Khmer stays empty so the site falls back to English')
    assert.deepStrictEqual(portalPromoCards(shown).map((card) => card.id), ['b', 'e', 'a'])
  })

  await check('a Discount post shows its rule\'s live label and colour, and leaves when the rule does', () => {
    const discount = post({ id: 'deal', kind: 'discount', ruleId: 9 })
    const shown = (rules) => publicPortalPosts([discount], rules, at(NOON_24))
    assert.deepStrictEqual(shown([rule()]).map((item) => [item.ruleId, item.ruleLabel, item.ruleBadgeColor]), [[9, 'Serum Friday', '#123abc']])
    assert.strictEqual(shown([rule({ show_title: 0 })])[0].ruleLabel, 'Save 20%', 'a hidden title shows the deal the till gives')
    assert.strictEqual(shown([rule({ title: '' })])[0].ruleLabel, 'Save 20%')
    assert.deepStrictEqual(shown([]), [], 'not in the active rule set: not on the site')
    assert.deepStrictEqual(shown([rule({ id: 10 })]), [], 'another rule does not stand in')
    assert.deepStrictEqual(shown([rule({ is_active: 0 })]), [], 'a rule row that is switched off')
    const plain = publicPortalPosts([post({ id: 'plain', ruleId: 9 })], [rule()], at(NOON_24))[0]
    assert.deepStrictEqual([plain.ruleId, plain.ruleLabel, plain.ruleBadgeColor], [null, '', ''], 'only a Discount post carries a rule')
  })

  await check('at most 50 posts; malformed or absent settings fail closed; a repeated id is made unique', () => {
    const many = Array.from({ length: 60 }, (_, index) => ({ id: `card-${index}`, title: `Card ${index}` }))
    assert.strictEqual(MAX_PORTAL_POSTS, 50)
    assert.strictEqual(readPortalPosts(JSON.stringify(many)).length, 50)
    for (const broken of ['{broken', '{"a":1}', '', undefined, null, 42]) assert.deepStrictEqual(readPortalPosts(broken), [], String(broken))
    const twins = readPortalPosts([{ id: 'same', title: 'One' }, { id: 'same', title: 'Two' }, { id: 'same-2', title: 'Three' }])
    assert.deepStrictEqual(twins.map((item) => item.id), ['same', 'same-2', 'same-2-3'])
  })

  // --- the REAL public routes ----------------------------------------------
  const portal = worker.mount('/api/portal', 'routes/portal.ts')
  const promotions = worker.mount('/api/promotions', 'routes/promotions.ts')
  worker.setUser({ id: 1, username: 'admin', permissions: '{}' })
  worker.kv.set('v2:products', '1')
  worker.kv.set('v2:settings', '1')
  let settingsVersion = 1
  const storePosts = (value) => {
    worker.rawDb.db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('customer_portal_promo_items', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(value))
    worker.kv.set('v2:settings', String(++settingsVersion)) // what a settings write does
  }

  await atInstant(NOON_24, async () => {
    await check('GET /api/portal/config serves stored v1 cards unchanged, as promoItems and as posts, in one D1 query', async () => {
      storePosts(V1_CARDS)
      const res = await worker.call(portal, 'GET', '/api/portal/config')
      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(res.body.promoItems, V1_CARDS_AS_SERVED_BEFORE)
      assert.deepStrictEqual(res.body.posts.map((item) => [item.id, item.kind, item.image, item.ctaHref]),
        V1_CARDS_AS_SERVED_BEFORE.map((card) => [card.id, 'promotion', card.mediaUrl, card.linkUrl]))
      assert.strictEqual(res.queries, 1, 'settings only: no rule read without a Discount post')
    })

    await check('only Live posts reach /config and /bootstrap', async () => {
      storePosts([post({ id: 'live' }), post({ id: 'later', startsOn: '2026-10-01' }), post({ id: 'off', hidden: true }), post({ id: 'over', endsOn: '2026-09-23' })])
      const config = await worker.call(portal, 'GET', '/api/portal/config')
      assert.deepStrictEqual(config.body.posts.map((item) => item.id), ['live'])
      assert.deepStrictEqual(config.body.promoItems.map((item) => item.id), ['live'])
      const bootstrap = await worker.call(portal, 'GET', '/api/portal/bootstrap')
      assert.strictEqual(bootstrap.status, 200)
      assert.deepStrictEqual(bootstrap.body.config.posts.map((item) => item.id), ['live'])
    })

    const created = await worker.call(promotions, 'POST', '/api/promotions/rules', {
      title: 'Serum Friday', rule_type: 'percent_off', percent_off: 20, scope_type: 'category', category: 'Serum', badge_color: '#123abc',
    })
    assert.strictEqual(created.status, 200, JSON.stringify(created.body))
    const ruleId = created.body.id

    await check('a Discount post reaches the site with its POS rule\'s label; /config reads the rules for it, /bootstrap reuses its catalog\'s', async () => {
      storePosts([post({ id: 'live' })])
      const plainBootstrap = await worker.call(portal, 'GET', '/api/portal/bootstrap')
      storePosts([post({ id: 'live' }), post({ id: 'deal', kind: 'discount', ruleId, title: 'Serum Friday is back' })])
      const config = await worker.call(portal, 'GET', '/api/portal/config')
      assert.deepStrictEqual(config.body.posts.map((item) => [item.id, item.ruleLabel, item.ruleBadgeColor]),
        [['live', '', ''], ['deal', 'Serum Friday', '#123abc']])
      assert.strictEqual(config.queries, 2, 'settings + the active rules')
      const bootstrap = await worker.call(portal, 'GET', '/api/portal/bootstrap')
      assert.deepStrictEqual(bootstrap.body.config.posts.map((item) => item.id), ['live', 'deal'])
      assert.strictEqual(bootstrap.queries, plainBootstrap.queries, 'no extra D1 query for the Discount post')
    })

    await check('switching the rule off through the rules route ends the offer on the site and at the till together', async () => {
      const off = await worker.call(promotions, 'PUT', `/api/promotions/rules/${ruleId}`, {
        title: 'Serum Friday', rule_type: 'percent_off', percent_off: 20, scope_type: 'category', category: 'Serum', badge_color: '#123abc', is_active: false,
      })
      assert.strictEqual(off.status, 200, JSON.stringify(off.body))
      const config = await worker.call(portal, 'GET', '/api/portal/config')
      assert.deepStrictEqual(config.body.posts.map((item) => item.id), ['live'], 'the cached config did not outlive the rule')
      const till = await worker.call(promotions, 'GET', '/api/promotions/rules/active')
      assert.ok(!till.body.rules.some((item) => item.id === ruleId), 'the POS rule set agrees')
    })
  })

  console.log(`\nALL ${checks} CHECKS PASSED`)
})().catch((error) => { console.error(error); process.exit(1) })
