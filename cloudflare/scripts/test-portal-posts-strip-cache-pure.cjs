// Website Editor lane: the public announcement strip
// (GET /api/portal/promotions) is served from the Workers Cache API like
// /config, and every strip write invalidates it.
//
// Every storefront page load fetched the strip straight from D1. It is now
// cached under products + 'promotions' versions plus the business date:
//   - a repeat visit costs no D1 query (the free plan allows 50 per request
//     and 100k reads a day, shared with the whole shop);
//   - create / edit / reorder / delete through the REAL routes/promotions.ts
//     each bump 'promotions', so the next visit sees the change at once;
//   - the key carries the Phnom Penh date, so a strip whose window opens at
//     midnight appears at midnight, not up to a TTL later;
//   - a query-string cache-buster cannot force a D1 read.
//
// Run (from cloudflare/): node scripts/test-portal-posts-strip-cache-pure.cjs
const assert = require('assert')
const { createWorker, atInstant } = require('./harness/real_worker_routes.cjs')

const worker = createWorker()
const portal = worker.mount('/api/portal', 'routes/portal.ts')
const strips = worker.mount('/api/promotions', 'routes/promotions.ts')
worker.setUser({ id: 2, username: 'staff', permissions: JSON.stringify({ products: true }) })
// Versions live in KV in production; seeding them keeps the D1 fallback
// read out of the query counts below.
worker.kv.set('v2:products', '1')
worker.kv.set('v2:promotions', '1')

const DAY_24_EVENING = '2026-09-24T16:59:00.000Z' // 23:59 on the 24th in Phnom Penh
const DAY_25_MIDNIGHT = '2026-09-24T17:00:00.000Z' // 00:00 on the 25th in Phnom Penh

const publicStrip = (query = '') => worker.call(portal, 'GET', `/api/portal/promotions${query}`)
const titles = (res) => res.body.items.map((item) => item.title)

let checks = 0
async function check(label, fn) { await fn(); checks++; console.log(`PASS ${label}`) }

;(async () => {
  await atInstant(DAY_24_EVENING, async () => {
    const created = await worker.call(strips, 'POST', '/api/promotions', { title: 'Opening sale' })
    assert.strictEqual(created.status, 200, JSON.stringify(created.body))
    worker.rawDb.db.prepare(`INSERT INTO promotions (title, is_active, sort_order, starts_at) VALUES ('Starts on the 25th', 1, 5, '2026-09-25T00:00:00.000Z')`).run()

    await check('the first visit reads D1 once; a repeat visit is served from the cache with no D1 query', async () => {
      const first = await publicStrip()
      assert.deepStrictEqual(titles(first), ['Opening sale'])
      assert.strictEqual(first.queries, 1, `miss: ${first.queries} D1 queries`)
      const second = await publicStrip()
      assert.deepStrictEqual(second.body, first.body)
      assert.strictEqual(second.queries, 0, `hit: ${second.queries} D1 queries`)
    })

    await check('a cache-buster query string reuses the same entry', async () => {
      const busted = await publicStrip('?bust=123&_v=attacker')
      assert.strictEqual(busted.queries, 0, `${busted.queries} D1 queries`)
      assert.deepStrictEqual(titles(busted), ['Opening sale'])
    })

    await check('the cache really answers: a row changed behind the routes is not seen until a write bumps the version', async () => {
      worker.rawDb.db.prepare(`UPDATE promotions SET title = 'changed behind the routes' WHERE title = 'Opening sale'`).run()
      assert.deepStrictEqual(titles(await publicStrip()), ['Opening sale'])
      worker.rawDb.db.prepare(`UPDATE promotions SET title = 'Opening sale' WHERE title = 'changed behind the routes'`).run()
    })

    const id = worker.rawDb.db.prepare(`SELECT id FROM promotions WHERE title = 'Opening sale'`).get().id
    await check('editing a strip shows on the very next visit', async () => {
      const res = await worker.call(strips, 'PUT', `/api/promotions/${id}`, { title: 'Opening sale, now 20% off' })
      assert.strictEqual(res.status, 200, JSON.stringify(res.body))
      assert.deepStrictEqual(titles(await publicStrip()), ['Opening sale, now 20% off'])
    })

    await check('adding a second strip and reordering both show on the very next visit', async () => {
      const added = await worker.call(strips, 'POST', '/api/promotions', { title: 'Free delivery', sort_order: 1 })
      assert.strictEqual(added.status, 200)
      assert.deepStrictEqual(titles(await publicStrip()), ['Opening sale, now 20% off', 'Free delivery'])
      const reordered = await worker.call(strips, 'PUT', '/api/promotions/reorder/all', { order: [added.body.id, id] })
      assert.strictEqual(reordered.status, 200)
      assert.deepStrictEqual(titles(await publicStrip()), ['Free delivery', 'Opening sale, now 20% off'])
    })

    await check('deleting a strip removes it on the very next visit', async () => {
      const res = await worker.call(strips, 'DELETE', `/api/promotions/${id}`)
      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(titles(await publicStrip()), ['Free delivery'])
    })
  })

  await check('at Phnom Penh midnight the cached day-24 answer is not reused: the strip starting on the 25th appears', async () => {
    await atInstant(DAY_25_MIDNIGHT, async () => {
      const res = await publicStrip()
      assert.deepStrictEqual(titles(res), ['Free delivery', 'Starts on the 25th'])
      assert.strictEqual(res.queries, 1, 'a new day is a new cache entry')
    })
  })

  console.log(`\nALL ${checks} CHECKS PASSED`)
})().catch((error) => { console.error(error); process.exit(1) })
