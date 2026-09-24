// Website Editor lane: the staff endpoints that post, edit, delete and order
// the storefront's posts (routes/portal.ts, /api/portal/posts), on the REAL
// routes and real SQLite.
//
//   - reading needs a grant that opens the Website Editor; changing needs
//     portal_posts or the broad settings grant;
//   - every change names the version it was made against: a stale edit or
//     delete answers 409 post_version_conflict with the current post and
//     changes nothing;
//   - every field is validated on the Worker (codes below), each kind keeps
//     only its own fields, and a v1 card list becomes v2 on the first write
//     without changing what a visitor sees of the untouched cards;
//   - the one settings row is written by compare-and-swap: a concurrent
//     writer is never overwritten, the change is applied again to the fresh
//     list once, and a second miss answers 409 posts_busy;
//   - each write leaves an audit row, bumps the settings version (the public
//     /config shows it on the next visit) and tells open editors;
//   - D1 statements per call are held to the numbers in the contract.
//
// Run (from cloudflare/): node scripts/test-portal-posts-staff-pure.cjs
const assert = require('assert')
const { createWorker, atInstant } = require('./harness/real_worker_routes.cjs')

const worker = createWorker()
const portal = worker.mount('/api/portal', 'routes/portal.ts')
worker.kv.set('v2:products', '1')
worker.kv.set('v2:settings', '1')

const ADMIN = { id: 1, username: 'admin', permissions: '{}' }
const POSTER = { id: 2, username: 'poster', permissions: JSON.stringify({ portal_posts: true }) }
const FAQ_EDITOR = { id: 3, username: 'faq', permissions: JSON.stringify({ portal_faq: true }) }
const CASHIER = { id: 4, username: 'cashier', permissions: JSON.stringify({ pos: true, sales: true }) }
const MANAGER = { id: 5, username: 'manager', permissions: JSON.stringify({ settings: true }) }

const NOON_24 = '2026-09-24T05:00:00.000Z' // 12:00 on the 24th in Phnom Penh
const EVENING_24 = '2026-09-24T12:00:00.000Z'

const KEY = 'customer_portal_promo_items'
const storedRaw = () => worker.rawDb.db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY)?.value ?? null
const stored = () => JSON.parse(storedRaw() || '[]')
function storeRaw(value) {
  worker.rawDb.db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(KEY, JSON.stringify(value))
  worker.kv.set('v2:settings', String(Number(worker.kv.get('v2:settings')) + 1))
}
const as = (user) => worker.setUser(user)
const list = () => worker.call(portal, 'GET', '/api/portal/posts')
const put = (id, body) => worker.call(portal, 'PUT', `/api/portal/posts/${id}`, body)
const del = (id, body) => worker.call(portal, 'DELETE', `/api/portal/posts/${id}`, body)
const reorder = (order) => worker.call(portal, 'POST', '/api/portal/posts/reorder', { order })
const publicIds = async () => {
  const res = await worker.call(portal, 'GET', '/api/portal/config')
  assert.strictEqual(res.status, 200)
  return res.body.posts.map((post) => post.id)
}
const auditRows = () => worker.rawDb.db.prepare(
  `SELECT action, entity_id, user_name, old_value, new_value FROM audit_logs WHERE entity = 'portal_post' ORDER BY id`,
).all()

// Two cards stored by the editor before posts existed.
const V1_CARDS = [
  { id: 'promo-serum', eyebrow: 'Promotion', title: 'Serum week', subtitle: '20% off', body: 'All serums.', mediaUrl: '/uploads/serum.jpg', ctaLabel: 'Shop', linkUrl: '', linkProductId: '42', linkProductName: 'Glow Serum' },
  { id: 'promo-branch', eyebrow: 'News', title: 'New branch open', subtitle: '', body: '', mediaUrl: '', ctaLabel: 'Directions', linkUrl: 'https://maps.example.com/branch', linkProductId: '', linkProductName: '' },
]

let checks = 0
async function check(label, fn) { await fn(); checks++; console.log(`PASS ${label}`) }

;(async () => {
  await atInstant(NOON_24, async () => {
    storeRaw(V1_CARDS)

    await check('reading needs a grant that opens the Website Editor; changing needs portal_posts or settings', async () => {
      as(null)
      assert.strictEqual((await list()).status, 401)
      as(CASHIER)
      assert.strictEqual((await list()).status, 403)
      assert.strictEqual((await put('p-cashier', { expected_version: 0, title: 'x' })).status, 403)
      assert.strictEqual((await del('promo-serum', { expected_version: 1 })).status, 403)
      assert.strictEqual((await reorder(['promo-branch', 'promo-serum'])).status, 403)
      as(FAQ_EDITOR)
      assert.strictEqual((await list()).status, 200, 'an FAQ editor sees the posts read-only')
      assert.strictEqual((await put('p-faq', { expected_version: 0, title: 'x' })).status, 403)
      assert.deepStrictEqual(stored(), V1_CARDS, 'no refused call wrote anything')
      as(MANAGER)
      const byManager = await put('p-manager', { expected_version: 0, title: 'By the manager' })
      assert.strictEqual(byManager.status, 200, JSON.stringify(byManager.body))
      assert.strictEqual((await del('p-manager', { expected_version: 1 })).status, 200)
      storeRaw(V1_CARDS)
    })

    as(POSTER)
    await check('the editor list reads v1 cards as Live Promotion posts at version 1, in one D1 query', async () => {
      const res = await list()
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.queries, 1)
      assert.strictEqual(res.body.limit, 50)
      assert.deepStrictEqual(res.body.posts.map((post) => [post.id, post.kind, post.version, post.status, post.rule]),
        [['promo-serum', 'promotion', 1, 'live', null], ['promo-branch', 'promotion', 1, 'live', null]])
    })

    let created
    await check('a new post is created at version 1 on top of the list, reaches the site at once, and is audited and announced', async () => {
      assert.deepStrictEqual(await publicIds(), ['promo-serum', 'promo-branch']) // now cached
      worker.broadcasts.length = 0
      const res = await put('open-late', {
        expected_version: 0, kind: 'announcement', title: 'Open late on Friday', body: 'Until 22:00.',
        km: { title: 'បើកយប់ថ្ងៃសុក្រ' }, pinned: true,
      })
      assert.strictEqual(res.status, 200, JSON.stringify(res.body))
      created = res.body.post
      assert.deepStrictEqual([created.id, created.kind, created.version, created.status, created.pinned], ['open-late', 'announcement', 1, 'live', true])
      assert.deepStrictEqual([created.postedAt, created.updatedAt], [NOON_24, NOON_24])
      assert.deepStrictEqual(created.km, { eyebrow: '', title: 'បើកយប់ថ្ងៃសុក្រ', subtitle: '', body: '', ctaLabel: '' })
      assert.deepStrictEqual(res.body.posts.map((post) => post.id), ['open-late', 'promo-serum', 'promo-branch'])
      assert.strictEqual(res.queries, 3, 'read the row, compare-and-swap it, the audit row')
      assert.deepStrictEqual(await publicIds(), ['open-late', 'promo-serum', 'promo-branch'], 'the cached config did not outlive the write')
      const row = auditRows().at(-1)
      assert.deepStrictEqual([row.action, row.entity_id, row.user_name], ['create', 'open-late', 'poster'])
      assert.match(row.new_value, /Open late on Friday/)
      assert.deepStrictEqual(worker.broadcasts, [{ channel: 'settings', payload: { action: 'update', keys: [KEY] } }])
    })

    await check('the first write stores the whole list as v2 and the untouched v1 cards still reach visitors as before', async () => {
      const raw = stored()
      assert.deepStrictEqual(raw.map((post) => [post.id, post.kind, post.version]), [['open-late', 'announcement', 1], ['promo-serum', 'promotion', 1], ['promo-branch', 'promotion', 1]])
      const config = (await worker.call(portal, 'GET', '/api/portal/config')).body
      assert.deepStrictEqual(config.promoItems.slice(1), [
        { id: 'promo-serum', eyebrow: 'Promotion', title: 'Serum week', subtitle: '20% off', body: 'All serums.', mediaUrl: '/uploads/serum.jpg', ctaLabel: 'Shop', linkUrl: '', linkProductId: 42, linkProductName: 'Glow Serum' },
        { id: 'promo-branch', eyebrow: 'News', title: 'New branch open', subtitle: '', body: '', mediaUrl: '', ctaLabel: 'Directions', linkUrl: 'https://maps.example.com/branch', linkProductId: null, linkProductName: '' },
      ])
    })

    await check('an edit names the version it read and changes only the fields it sends', async () => {
      const res = await put('promo-serum', { expected_version: 1, title: 'Serum week, extended' })
      assert.strictEqual(res.status, 200, JSON.stringify(res.body))
      const post = res.body.post
      assert.deepStrictEqual([post.version, post.title, post.image, post.linkProductId, post.body], [2, 'Serum week, extended', '/uploads/serum.jpg', 42, 'All serums.'])
      assert.strictEqual(post.postedAt, NOON_24, 'a card stored before postedAt existed gets it on its first write')
      assert.strictEqual(auditRows().at(-1).action, 'update')
      assert.match(auditRows().at(-1).old_value, /"title":"Serum week"/)
    })

    await check('a stale edit, a create over an existing id and an edit of a removed post answer 409 with the current post and change nothing', async () => {
      const before = storedRaw()
      const stale = await put('promo-serum', { expected_version: 1, title: 'Overwrite from an old tab' })
      assert.strictEqual(stale.status, 409)
      assert.strictEqual(stale.body.code, 'post_version_conflict')
      assert.deepStrictEqual([stale.body.current.version, stale.body.current.title], [2, 'Serum week, extended'])
      assert.strictEqual(stale.body.posts.length, 3)
      const twice = await put('open-late', { expected_version: 0, title: 'Created twice' })
      assert.deepStrictEqual([twice.status, twice.body.code, twice.body.current.version], [409, 'post_version_conflict', 1])
      const gone = await put('deleted-meanwhile', { expected_version: 3, title: 'Edited after a delete' })
      assert.deepStrictEqual([gone.status, gone.body.code, gone.body.current], [409, 'post_version_conflict', null])
      for (const body of [{ title: 'no version' }, { expected_version: '2', title: 'text version' }, { expected_version: -1, title: 'negative' }]) {
        const res = await put('promo-serum', body)
        assert.deepStrictEqual([res.status, res.body.code], [400, 'expected_version_required'], JSON.stringify(body))
      }
      assert.strictEqual(storedRaw(), before)
    })

    await check('every field is validated on the Worker, and a refused write changes nothing', async () => {
      const before = storedRaw()
      const refused = [
        ['bad.id', { title: 'x' }, 'invalid_post_id'],
        ['x'.repeat(65), { title: 'x' }, 'invalid_post_id'],
        ['p1', { kind: 'video', title: 'x' }, 'invalid_post_kind'],
        ['p1', { title: 'x'.repeat(121) }, 'post_field_too_long', 'title', 120],
        ['p1', { title: 'x', km: { body: 'ខ'.repeat(2201) } }, 'post_field_too_long', 'km.body', 2200],
        ['p1', { title: 5 }, 'invalid_post_field', 'title'],
        ['p1', { title: 'x', km: 'not an object' }, 'invalid_post_field', 'km'],
        ['p1', { title: 'x', ctaHref: 'javascript:alert(1)' }, 'invalid_post_link', 'ctaHref'],
        ['p1', { title: 'x', image: '//evil.example/pixel.gif' }, 'invalid_post_link', 'image'],
        ['p1', { title: 'x', image: '/uploads/clip.mp4' }, 'post_image_not_picture', 'image'],
        ['p1', { title: 'x', image: 'https://cdn.example.com/clip.webm?v=2' }, 'post_image_not_picture', 'image'],
        ['p1', { title: 'x', startsOn: 'next week' }, 'invalid_post_date', 'startsOn'],
        ['p1', { title: 'x', endsOn: '2026-13-01' }, 'invalid_post_date', 'endsOn'],
        ['p1', { title: 'x', startsOn: '25/09/2026', endsOn: '24/09/2026' }, 'post_dates_reversed', 'endsOn'],
        ['p1', { title: 'x', pinned: 'yes' }, 'invalid_post_field', 'pinned'],
        ['p1', { title: 'x', linkProductId: -3 }, 'invalid_post_field', 'linkProductId'],
        ['p1', { title: '  ', body: '', image: '' }, 'post_empty'],
      ]
      for (const [id, body, code, field, max] of refused) {
        const res = await put(id, { expected_version: 0, ...body })
        assert.strictEqual(res.status, 400, `${code}: ${JSON.stringify(res.body)}`)
        assert.strictEqual(res.body.code, code)
        if (field) assert.strictEqual(res.body.field, field)
        if (max) assert.strictEqual(res.body.max, max)
      }
      const notAnObject = await worker.call(portal, 'PUT', '/api/portal/posts/p1', [1, 2])
      assert.deepStrictEqual([notAnObject.status, notAnObject.body.code], [400, 'invalid_post_body'])
      assert.strictEqual(storedRaw(), before)
    })

    await check('each kind keeps only its own fields; a product link wins over a typed link; typed dates are stored day-first-read ISO', async () => {
      const story = await put('story-1', { expected_version: 0, kind: 'story', title: 'Behind the counter', startsOn: '01/10/2026', endsOn: '05/10/2026', eventDate: '02/10/2026', location: 'Shop', ruleId: 9 })
      assert.strictEqual(story.status, 200, JSON.stringify(story.body))
      assert.deepStrictEqual([story.body.post.startsOn, story.body.post.endsOn, story.body.post.eventDate, story.body.post.location, story.body.post.ruleId], ['', '', '', '', null])
      const event = await put('event-1', { expected_version: 0, kind: 'event', title: 'Skin clinic day', eventDate: '03/10/2026', location: 'Main branch' })
      assert.deepStrictEqual([event.body.post.eventDate, event.body.post.location, event.body.post.status], ['2026-10-03', 'Main branch', 'live'])
      const linked = await put('linked-1', { expected_version: 0, title: 'Serum of the week', linkProductId: '42', linkProductName: 'Glow Serum', ctaHref: 'https://example.com/other' })
      assert.deepStrictEqual([linked.body.post.linkProductId, linked.body.post.linkProductName, linked.body.post.ctaHref], [42, 'Glow Serum', ''])
      const unlinked = await put('linked-1', { expected_version: 1, linkProductId: null, ctaHref: '/?legal=terms' })
      assert.deepStrictEqual([unlinked.body.post.linkProductId, unlinked.body.post.linkProductName, unlinked.body.post.ctaHref], [null, '', '/?legal=terms'])
    })

    await check('a post scheduled for a later day and a hidden post stay in the editor with their status, off the site', async () => {
      const later = await put('later-1', { expected_version: 0, title: 'October offers', startsOn: '01/10/2026' })
      assert.deepStrictEqual([later.body.post.startsOn, later.body.post.status], ['2026-10-01', 'scheduled'])
      const hidden = await put('event-1', { expected_version: 1, hidden: true })
      assert.strictEqual(hidden.body.post.status, 'hidden')
      const ids = await publicIds()
      assert.ok(!ids.includes('later-1') && !ids.includes('event-1'), ids.join(','))
      assert.ok(ids.includes('story-1'))
    })

    await check('deleting names the version too; the post leaves the site and the list at once, and the audit row keeps what it was', async () => {
      const before = storedRaw()
      const stale = await del('linked-1', { expected_version: 1 })
      assert.deepStrictEqual([stale.status, stale.body.code, stale.body.current.version], [409, 'post_version_conflict', 2])
      const missing = await del('linked-1', {})
      assert.deepStrictEqual([missing.status, missing.body.code], [400, 'expected_version_required'])
      assert.strictEqual(storedRaw(), before)
      const res = await del('linked-1', { expected_version: 2 })
      assert.strictEqual(res.status, 200, JSON.stringify(res.body))
      assert.strictEqual(res.queries, 3, 'read, compare-and-swap, audit')
      assert.strictEqual(res.body.deleted, 'linked-1')
      assert.ok(!res.body.posts.some((post) => post.id === 'linked-1'))
      assert.ok(!(await publicIds()).includes('linked-1'))
      const row = auditRows().at(-1)
      assert.deepStrictEqual([row.action, row.entity_id], ['delete', 'linked-1'])
      assert.match(row.old_value, /Serum of the week/)
      const again = await del('linked-1', { expected_version: 2 })
      assert.deepStrictEqual([again.status, again.body.code], [404, 'post_not_found'])
    })

    await check('reorder takes the whole list: a stale or malformed order is refused, and no post version moves', async () => {
      const current = (await list()).body.posts
      const versions = Object.fromEntries(current.map((post) => [post.id, post.version]))
      const ids = current.map((post) => post.id)
      const reversed = [...ids].reverse()
      const res = await reorder(reversed)
      assert.strictEqual(res.status, 200, JSON.stringify(res.body))
      assert.strictEqual(res.queries, 3, 'read, compare-and-swap, audit')
      assert.deepStrictEqual(res.body.posts.map((post) => post.id), reversed)
      assert.deepStrictEqual(Object.fromEntries(res.body.posts.map((post) => [post.id, post.version])), versions)
      const shown = await publicIds()
      assert.strictEqual(shown[0], 'open-late', 'a pinned post still shows first on the site')
      assert.deepStrictEqual(shown.slice(1), reversed.filter((id) => shown.includes(id) && id !== 'open-late'))
      assert.strictEqual(auditRows().at(-1).action, 'reorder')

      const before = storedRaw()
      const stale = await reorder(reversed.slice(1))
      assert.deepStrictEqual([stale.status, stale.body.code, stale.body.posts.length], [409, 'posts_order_stale', ids.length])
      assert.deepStrictEqual([(await reorder([...reversed.slice(1), 'ghost'])).body.code], ['posts_order_stale'])
      assert.deepStrictEqual([(await reorder([reversed[0], ...reversed.slice(0, -1)])).body.code], ['invalid_post_order'])
      assert.deepStrictEqual([(await reorder('open-late')).status], [400])
      assert.strictEqual(storedRaw(), before)
    })

    // Another tab's write landing between this call's read and its write.
    function interfere(times, write) {
      const prepare = worker.db.prepare
      let left = times
      worker.db.prepare = (sql) => {
        const statement = prepare(sql)
        if (!sql.includes('WHERE settings.value IS @expected')) return statement
        return {
          ...statement,
          run: async (params) => {
            if (left > 0) { left -= 1; write() }
            return statement.run(params)
          },
        }
      }
      return () => { worker.db.prepare = prepare }
    }
    const otherTabPost = (id) => ({ ...stored()[0], id, title: `Posted from another tab (${id})`, version: 1, pinned: false })

    await check('a concurrent write is never overwritten: the change is applied again to the fresh list, once', async () => {
      const restore = interfere(1, () => storeRaw([otherTabPost('other-tab'), ...stored()]))
      const res = await put('mine', { expected_version: 0, title: 'Mine' })
      restore()
      assert.strictEqual(res.status, 200, JSON.stringify(res.body))
      assert.strictEqual(res.queries, 5, 'one more read and one more compare-and-swap')
      assert.deepStrictEqual(stored().slice(0, 2).map((post) => post.id), ['mine', 'other-tab'])
    })

    await check('a second miss answers 409 posts_busy and writes nothing of its own', async () => {
      let n = 0
      const restore = interfere(2, () => storeRaw([otherTabPost(`busy-${++n}`), ...stored()]))
      const res = await put('never', { expected_version: 0, title: 'Never stored' })
      restore()
      assert.deepStrictEqual([res.status, res.body.code], [409, 'posts_busy'])
      assert.ok(!stored().some((post) => post.id === 'never'))
      assert.deepStrictEqual(stored().slice(0, 2).map((post) => post.id), ['busy-2', 'busy-1'])
    })

    await check('Discount posts are refused until they can link a POS rule', async () => {
      const res = await put('deal-1', { expected_version: 0, kind: 'discount', title: '20% off serums' })
      assert.deepStrictEqual([res.status, res.body.code], [400, 'discount_post_unsupported'])
    })

    await check('the list holds at most 50 posts; editing one of them still works', async () => {
      storeRaw(Array.from({ length: 50 }, (_, index) => ({ ...otherTabPost(`p-${index}`), title: `Post ${index}` })))
      const res = await put('p-50', { expected_version: 0, title: 'One too many' })
      assert.deepStrictEqual([res.status, res.body.code, res.body.max], [400, 'posts_limit_reached', 50])
      assert.strictEqual((await put('p-7', { expected_version: 1, title: 'Post 7, edited' })).status, 200)
    })
  })

  await check('a Story\'s 24 hours restart when a post becomes a Story, not on every edit', async () => {
    await atInstant(EVENING_24, async () => {
      const became = await put('p-8', { expected_version: 1, kind: 'story' })
      assert.strictEqual(became.body.post.postedAt, EVENING_24)
      const edited = await put('p-9', { expected_version: 1, title: 'Post 9, edited' })
      assert.notStrictEqual(edited.body.post.postedAt, EVENING_24)
    })
  })

  await check('on the free plan a write costs one more D1 statement: the KV-write quota counter', async () => {
    const free = createWorker()
    free.env.PLAN_TIER = 'free'
    free.kv.set('v2:settings', '1')
    const freePortal = free.mount('/api/portal', 'routes/portal.ts')
    free.setUser(POSTER)
    const res = await free.call(freePortal, 'PUT', '/api/portal/posts/first', { expected_version: 0, title: 'First' })
    assert.strictEqual(res.status, 200, JSON.stringify(res.body))
    assert.strictEqual(res.queries, 4)
  })

  console.log(`\nALL ${checks} CHECKS PASSED`)
})().catch((error) => { console.error(error); process.exit(1) })
