// Website Editor lane: the bulk settings save (POST /api/settings) never
// overwrites the Website Editor posts.
//
// Posts change only through /api/portal/posts, one post at a time against its
// version. An editor bundle cached before those endpoints existed still sends
// the whole post list (customer_portal_promo_items) with every editor save.
// The save now IGNORES that key -- no write, no audit, no broadcast -- names
// it back in `ignoredKeys`, and still:
//   - applies every other key of the same save;
//   - requires the posts grant for it, as before;
//   - runs the version check over exactly the keys the client sent, which is
//     what the client scoped its expectedUpdatedAt to (GET /meta?keys=...);
//     scoping it any other way would turn every editor save into a false
//     conflict once a post is newer than the rest of the section.
// REAL routes/settings.ts and routes/portal.ts on real SQLite.
//
// Run (from cloudflare/): node scripts/test-portal-posts-bulk-save-pure.cjs
const assert = require('assert')
const { createWorker, atInstant } = require('./harness/real_worker_routes.cjs')

const worker = createWorker()
const portal = worker.mount('/api/portal', 'routes/portal.ts')
const settings = worker.mount('/api/settings', 'routes/settings.ts')
worker.kv.set('v2:products', '1')
worker.kv.set('v2:settings', '1')
const POSTS_KEY = 'customer_portal_promo_items'

const ADMIN = { id: 1, username: 'admin', permissions: '{}' }
const POSTER = { id: 2, username: 'poster', permissions: JSON.stringify({ portal_posts: true }) }
const FAQ_EDITOR = { id: 3, username: 'faq', permissions: JSON.stringify({ portal_faq: true }) }
const NOON_24 = '2026-09-24T05:00:00.000Z'

const row = (key) => worker.rawDb.db.prepare('SELECT value, updated_at FROM settings WHERE key = ?').get(key)
const stamp = (key, updatedAt) => worker.rawDb.db.prepare('UPDATE settings SET updated_at = ? WHERE key = ?').run(updatedAt, key)
const settingsAudits = () => worker.rawDb.db.prepare(`SELECT details, new_value FROM audit_logs WHERE entity = 'settings' ORDER BY id`).all()

// What settingsTransport.ts does: ask for the version of exactly the keys it
// is about to send, then send them with it.
async function editorSave(values) {
  const meta = await worker.call(settings, 'GET', `/api/settings/meta?keys=${Object.keys(values).map(encodeURIComponent).join(',')}`)
  assert.strictEqual(meta.status, 200)
  return worker.call(settings, 'POST', '/api/settings', { ...values, expectedUpdatedAt: meta.body.updatedAt })
}
// The cards an old editor holds: whatever it loaded, long before the posts
// below were made.
const STALE_CARDS = JSON.stringify([{ id: 'promo-old', title: 'An old card', linkUrl: '' }])

let checks = 0
async function check(label, fn) { await fn(); checks++; console.log(`PASS ${label}`) }

;(async () => {
  await atInstant(NOON_24, async () => {
    worker.setUser(ADMIN)
    const first = await editorSave({ customer_portal_promotions_title: 'Offers', customer_portal_show_promotions: 'true' })
    assert.strictEqual(first.status, 200, JSON.stringify(first.body))
    // A post made with its Post button (test-portal-posts-staff-pure.cjs
    // covers that endpoint; the row is stored directly here).
    worker.rawDb.db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`).run(POSTS_KEY, JSON.stringify([
      { id: 'kept', kind: 'announcement', title: 'Posted with the Post button', postedAt: '2026-09-24T04:00:00.000Z', version: 1, updatedAt: '2026-09-24T04:00:00.000Z' },
    ]))
    // The section was saved days ago; the post is the newest row in it.
    stamp('customer_portal_promotions_title', '2026-09-20 03:00:00')
    stamp('customer_portal_show_promotions', '2026-09-20 03:00:00')
    stamp(POSTS_KEY, '2026-09-24 05:00:00')

    await check('an editor save from a bundle cached before posts applies the rest and leaves the posts exactly as posted', async () => {
      const postsBefore = row(POSTS_KEY)
      const auditsBefore = settingsAudits().length
      worker.broadcasts.length = 0
      const res = await editorSave({ [POSTS_KEY]: STALE_CARDS, customer_portal_promotions_title: 'This week', customer_portal_show_promotions: 'true' })
      assert.strictEqual(res.status, 200, `no false conflict: ${JSON.stringify(res.body)}`)
      assert.deepStrictEqual(res.body.keys, ['customer_portal_promotions_title', 'customer_portal_show_promotions'])
      assert.deepStrictEqual(res.body.ignoredKeys, [POSTS_KEY])
      assert.deepStrictEqual(row(POSTS_KEY), postsBefore, 'the posts row -- value and version stamp -- is untouched')
      assert.strictEqual(row('customer_portal_promotions_title').value, 'This week')
      const audits = settingsAudits()
      assert.strictEqual(audits.length, auditsBefore + 1)
      assert.deepStrictEqual(JSON.parse(audits.at(-1).details).keys, ['customer_portal_promotions_title', 'customer_portal_show_promotions'])
      assert.ok(!audits.at(-1).new_value.includes('An old card'), 'the ignored value is not recorded as a change')
      assert.deepStrictEqual(worker.broadcasts.map((item) => item.payload.keys), [['customer_portal_promotions_title', 'customer_portal_show_promotions']])
      const config = await worker.call(portal, 'GET', '/api/portal/config')
      assert.deepStrictEqual(config.body.posts.map((post) => post.id), ['kept'])
      assert.strictEqual(config.body.promotionsTitle, 'This week')
    })

    await check('a save of nothing but the posts row writes, audits and announces nothing', async () => {
      const postsBefore = row(POSTS_KEY)
      const auditsBefore = settingsAudits().length
      const versionBefore = worker.kv.get('v2:settings')
      worker.broadcasts.length = 0
      const res = await editorSave({ [POSTS_KEY]: STALE_CARDS })
      assert.strictEqual(res.status, 200, JSON.stringify(res.body))
      assert.deepStrictEqual([res.body.keys, res.body.ignoredKeys], [[], [POSTS_KEY]])
      assert.deepStrictEqual(row(POSTS_KEY), postsBefore)
      assert.strictEqual(settingsAudits().length, auditsBefore)
      assert.deepStrictEqual(worker.broadcasts, [])
      assert.strictEqual(worker.kv.get('v2:settings'), versionBefore)
    })

    await check('the posts row still needs its grant: no new way in, no new way out', async () => {
      worker.setUser(FAQ_EDITOR)
      const refused = await editorSave({ customer_portal_faq_title: 'Questions', [POSTS_KEY]: STALE_CARDS })
      assert.strictEqual(refused.status, 403)
      assert.strictEqual(row('customer_portal_faq_title'), undefined, 'all-or-nothing, as before')
      worker.setUser(POSTER)
      const allowed = await editorSave({ customer_portal_promotions_intro: 'New every week', [POSTS_KEY]: STALE_CARDS })
      assert.strictEqual(allowed.status, 200, JSON.stringify(allowed.body))
      assert.strictEqual(row('customer_portal_promotions_intro').value, 'New every week')
    })

    await check('a real conflict still reports the posts row as it is now, so an old editor cannot auto-retry over a post made meanwhile', async () => {
      const res = await worker.call(settings, 'POST', '/api/settings', {
        [POSTS_KEY]: STALE_CARDS, customer_portal_promotions_title: 'From a tab left open', expectedUpdatedAt: '2026-09-01 00:00:00',
      })
      assert.strictEqual(res.status, 409)
      assert.strictEqual(res.body.currentSettings[POSTS_KEY], row(POSTS_KEY).value)
      assert.strictEqual(row('customer_portal_promotions_title').value, 'This week')
    })

    await check('the ignored key is the row the posts live in', () => {
      assert.strictEqual(worker.load('lib/portalPosts.ts').PORTAL_POSTS_SETTING_KEY, POSTS_KEY)
    })
  })

  console.log(`\nALL ${checks} CHECKS PASSED`)
})().catch((error) => { console.error(error); process.exit(1) })
