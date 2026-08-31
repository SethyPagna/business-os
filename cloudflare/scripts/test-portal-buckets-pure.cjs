// Regression lock for the customer-portal per-area write buckets (Part 557
// slice 8). The storefront editor is split into portal_posts / portal_faq /
// portal_about / customer_portal(config) grants; POST /settings partitions each
// customer_portal_* key into one of those buckets, and a bucket is satisfied by
// its own grant OR the broad `settings` grant (or admin). This test replicates
// the bucket map, asserts the accept/reject matrix, and source-guards that the
// backend (settings.ts) and the frontend mirror (utils/portalPermissions.ts)
// declare identical key sets.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

let passed = 0
const check = (label, fn) => { fn(); passed++; console.log(`PASS ${label}`) }

const PORTAL_POSTS_KEYS = new Set(['customer_portal_promo_items', 'customer_portal_promotions_title', 'customer_portal_promotions_intro', 'customer_portal_show_promotions'])
const PORTAL_FAQ_KEYS = new Set(['customer_portal_faq_items', 'customer_portal_faq_title', 'customer_portal_show_faq'])
const PORTAL_ABOUT_KEYS = new Set(['customer_portal_about_title', 'customer_portal_about_content', 'customer_portal_about_blocks', 'customer_portal_show_about'])

function bucketFor(key) {
  if (PORTAL_POSTS_KEYS.has(key)) return 'portal_posts'
  if (PORTAL_FAQ_KEYS.has(key)) return 'portal_faq'
  if (PORTAL_ABOUT_KEYS.has(key)) return 'portal_about'
  if (key.startsWith('customer_portal_')) return 'customer_portal'
  return null
}
// bucket grant OR settings (admin folds into a caller's grant set upstream)
const canWrite = (key, grants) => {
  const b = bucketFor(key)
  if (!b) return grants.has('settings')
  return grants.has(b) || grants.has('settings')
}

check('each area maps to its own bucket', () => {
  assert.equal(bucketFor('customer_portal_promo_items'), 'portal_posts')
  assert.equal(bucketFor('customer_portal_faq_items'), 'portal_faq')
  assert.equal(bucketFor('customer_portal_about_blocks'), 'portal_about')
  assert.equal(bucketFor('customer_portal_logo_image'), 'customer_portal') // config catch-all
  assert.equal(bucketFor('customer_portal_points_per_usd'), 'customer_portal') // loyalty = config
  assert.equal(bucketFor('business_name'), null) // not a portal key
})

check('a posts-only grant writes posts but NOT faq/about/config', () => {
  const g = new Set(['portal_posts'])
  assert.equal(canWrite('customer_portal_promo_items', g), true)
  assert.equal(canWrite('customer_portal_faq_items', g), false)
  assert.equal(canWrite('customer_portal_about_title', g), false)
  assert.equal(canWrite('customer_portal_logo_image', g), false)
})

check('a config grant writes config + loyalty but NOT posts/faq/about', () => {
  const g = new Set(['customer_portal'])
  assert.equal(canWrite('customer_portal_logo_image', g), true)
  assert.equal(canWrite('customer_portal_points_per_usd', g), true)
  assert.equal(canWrite('customer_portal_promo_items', g), false)
  assert.equal(canWrite('customer_portal_faq_items', g), false)
})

check('full settings is a superset of every portal bucket', () => {
  const g = new Set(['settings'])
  for (const k of ['customer_portal_promo_items', 'customer_portal_faq_items', 'customer_portal_about_title', 'customer_portal_logo_image']) {
    assert.equal(canWrite(k, g), true)
  }
})

check('no grant writes nothing', () => {
  const g = new Set()
  assert.equal(canWrite('customer_portal_promo_items', g), false)
  assert.equal(canWrite('customer_portal_logo_image', g), false)
})

// --- source guards: backend + frontend declare the SAME key sets -----------
function extractSet(src, name) {
  const m = src.match(new RegExp(`${name}\\s*=\\s*new Set(?:<string>)?\\(\\[([\\s\\S]*?)\\]\\)`))
  assert.ok(m, `${name} not found`)
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()
}
check('settings.ts + portalPermissions.ts PORTAL_*_KEYS are identical', () => {
  const be = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'settings.ts'), 'utf8')
  const fe = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'portalPermissions.ts'), 'utf8')
  for (const name of ['PORTAL_POSTS_KEYS', 'PORTAL_FAQ_KEYS', 'PORTAL_ABOUT_KEYS']) {
    assert.deepEqual(extractSet(be, name), extractSet(fe, name), `${name} drifted between backend and frontend`)
    assert.deepEqual(extractSet(be, name), [...({ PORTAL_POSTS_KEYS, PORTAL_FAQ_KEYS, PORTAL_ABOUT_KEYS })[name]].sort(), `${name} drifted from this test`)
  }
})
check('settings.ts settingsBucketPermissionFor returns the portal buckets', () => {
  const be = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'settings.ts'), 'utf8')
  assert.match(be, /if \(PORTAL_POSTS_KEYS\.has\(key\)\) return 'portal_posts'/)
  assert.match(be, /if \(PORTAL_FAQ_KEYS\.has\(key\)\) return 'portal_faq'/)
  assert.match(be, /if \(PORTAL_ABOUT_KEYS\.has\(key\)\) return 'portal_about'/)
  assert.match(be, /if \(key\.startsWith\('customer_portal_'\)\) return 'customer_portal'/)
})

console.log(`\nALL ${passed} CHECKS PASSED`)
