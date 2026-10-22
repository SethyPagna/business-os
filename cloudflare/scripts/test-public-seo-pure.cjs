// P3-L3 item E: robots.txt / sitemap.xml split by host, and the storefront's
// link-preview tags.
//
// One Worker serves the public shop (leangbeauty.com) and the internal admin
// app (admin.leangbeauty.com). The shop should be findable and preview well
// when its link is shared; the admin app must never be indexed or previewed
// as the shop. This runs the REAL lib/publicSeo.ts and the REAL document
// rewrite rules, and pins the wiring that makes them reachable: both paths in
// run_worker_first of BOTH wrangler configs (else the asset layer answers
// them with index.html), handlers above the D1 middleware, and the Open Graph
// tags a preview crawler reads. Since Oct 22 2026 index.html names no client,
// so those tags' values are the ones the Worker writes from wrangler [vars];
// this file reads Leang Cosmetics' from wrangler.toml.
//
// Run (from cloudflare/): node scripts/test-public-seo-pure.cjs
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { load } = require('./test-request-body-guard-pure.cjs')
const { wranglerVars } = require('./harness/wrangler_vars.cjs')

const CF = path.join(__dirname, '..')
const REPO = path.join(CF, '..')
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

// The real host rule (the API gate's): admin.*, loopback and the configured
// staff host, which comes from the deployment's BUSINESS_OS_ADMIN_URL.
const clientIdentity = load('lib/clientIdentity.ts')
const gate = load('lib/publicHostGate.ts')
const identity = load('lib/documentIdentity.ts', { './clientIdentity': clientIdentity, './publicHostGate': gate })
const seo = load('lib/publicSeo.ts', { './publicHostGate': gate })
const LEANG_ENV = wranglerVars('wrangler.toml')
const staffHostOf = (env) => clientIdentity.staffHostFrom(env.BUSINESS_OS_ADMIN_URL, env.BUSINESS_OS_PUBLIC_URL)
const STAFF_HOST = staffHostOf(LEANG_ENV)
// The rules the Worker registers for one request to this host.
const rulesFor = (hostname, env = LEANG_ENV) => identity.documentRewrites({
  identity: clientIdentity.resolveClientIdentity(env),
  hostname,
  shopOrigin: identity.shopOriginFrom(env.BUSINESS_OS_PUBLIC_URL, 'https://' + hostname + '/'),
})
// What one rule writes into an element that starts with these attributes.
function written(rules, selector, attributes = {}) {
  const matching = rules.filter((candidate) => candidate.selector === selector)
  assert.equal(matching.length, 1, 'expected exactly one rule for ' + selector)
  const writes = []
  matching[0].element({
    getAttribute: (name) => (name in attributes ? attributes[name] : null),
    setAttribute: (_name, value) => writes.push(value),
    setInnerContent: (value) => writes.push(value),
  })
  return writes
}
const workerIndex = read(path.join(CF, 'src', 'index.ts'))
const indexHtml = read(path.join(REPO, 'frontend', 'index.html'))

let checks = 0
const check = (label, fn) => { fn(); checks += 1; process.stdout.write('  ok  ' + label + '\n') }

// leangcosmetics.dpdns.org was retired completely (Sep 26 2026) and is no
// longer routed, so it is in neither list.
const PUBLIC_HOSTS = ['leangbeauty.com', 'www.leangbeauty.com']
const ADMIN_HOSTS = ['admin.leangbeauty.com', 'localhost', '127.0.0.1']

check('the storefront host is indexable and points at its sitemap', () => {
  for (const host of PUBLIC_HOSTS) {
    const origin = 'https://' + host
    const robots = seo.robotsTxt(host, origin, STAFF_HOST)
    assert.match(robots, /^User-agent: \*\n/, host)
    assert.match(robots, /\nDisallow: \/api\/\n/, host + ': the API is not a page')
    assert.doesNotMatch(robots, /Disallow: \/\n/, host + ': the shop itself is not blocked')
    assert.ok(robots.includes('Sitemap: ' + origin + '/sitemap.xml\n'), host + ': sitemap on the same origin')
  }
})

check('every admin host is fully disallowed and has no sitemap', () => {
  for (const host of ADMIN_HOSTS) {
    assert.equal(seo.robotsTxt(host, 'https://' + host, STAFF_HOST), 'User-agent: *\nDisallow: /\n', host)
    assert.equal(seo.sitemapXml(host, 'https://' + host, STAFF_HOST), null, host + ': nothing to index')
  }
})

check('a configured staff host is the admin host too, by exact hostname', () => {
  // Oct 22 2026: BM Shop's staff app is bm-admin.khshop.workers.dev (a
  // *.workers.dev name cannot start with admin.). Without the configured host
  // it would be served a crawlable robots.txt and a sitemap for the admin app.
  const BM = { BUSINESS_OS_ADMIN_URL: 'https://bm-admin.khshop.workers.dev', BUSINESS_OS_PUBLIC_URL: 'https://bm.khshop.workers.dev' }
  const BM_STAFF = staffHostOf(BM)
  assert.equal(BM_STAFF, 'bm-admin.khshop.workers.dev')
  assert.equal(seo.robotsTxt('bm-admin.khshop.workers.dev', 'https://bm-admin.khshop.workers.dev', BM_STAFF), 'User-agent: *\nDisallow: /\n')
  assert.equal(seo.sitemapXml('bm-admin.khshop.workers.dev', 'https://bm-admin.khshop.workers.dev', BM_STAFF), null)
  for (const host of ['bm.khshop.workers.dev', 'bm-admin.khshop.workers.dev.evil.com', 'xbm-admin.khshop.workers.dev']) {
    assert.match(seo.robotsTxt(host, 'https://' + host, BM_STAFF), new RegExp('Sitemap: https://' + host.replace(/\./g, '\\.') + '/sitemap\\.xml'), host + ' is the storefront')
    assert.ok(seo.sitemapXml(host, 'https://' + host, BM_STAFF).includes('https://' + host + '/'), host)
  }
  // Under Leang's config BM's staff host is just another host.
  assert.doesNotMatch(seo.robotsTxt('bm-admin.khshop.workers.dev', 'https://bm-admin.khshop.workers.dev', STAFF_HOST), /Disallow: \/\n/)
  // No configured staff host: admin.* and local development are the admin app, nothing else.
  assert.equal(seo.robotsTxt('localhost', 'http://localhost:8787', undefined), 'User-agent: *\nDisallow: /\n')
  assert.equal(seo.robotsTxt('admin.leangbeauty.com', 'https://admin.leangbeauty.com', undefined), 'User-agent: *\nDisallow: /\n')
  assert.doesNotMatch(seo.robotsTxt('bm-admin.khshop.workers.dev', 'https://bm-admin.khshop.workers.dev', undefined), /Disallow: \/\n/)
})

check('the sitemap is the home page and the three legal pages, on the request origin', () => {
  const xml = seo.sitemapXml('leangbeauty.com', 'https://leangbeauty.com', STAFF_HOST)
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/)
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  assert.deepEqual(locs, [
    'https://leangbeauty.com/',
    'https://leangbeauty.com/?legal=privacy',
    'https://leangbeauty.com/?legal=terms',
    'https://leangbeauty.com/?legal=cookies',
  ])
  assert.doesNotMatch(xml, /admin|dashboard|pos|login/i, 'no admin route is ever listed')
  // The legal pages really are addressed by that query parameter.
  const legal = read(path.join(REPO, 'frontend', 'src', 'components', 'catalog', 'legal', 'LegalPages.tsx'))
  assert.match(legal, /LEGAL_QUERY_PARAM = 'legal'/)
  const legalKeys = read(path.join(REPO, 'frontend', 'src', 'components', 'catalog', 'legal', 'legalContent.ts'))
  assert.ok(legalKeys.includes("export type LegalPageKey = 'privacy' | 'terms' | 'cookies'"), 'the three slugs the sitemap lists are the legal page keys')
})

check('the handlers are registered above the D1 middleware and never touch the database', () => {
  const start = workerIndex.indexOf("app.on(['GET', 'HEAD'], '/robots.txt'")
  const sitemap = workerIndex.indexOf("app.on(['GET', 'HEAD'], '/sitemap.xml'")
  const dbMiddleware = workerIndex.indexOf('await ensureCoreDataInvariantsForRequest(c.env)')
  assert.ok(start > 0 && sitemap > 0, 'both handlers exist')
  assert.ok(dbMiddleware > 0, 'the seeding middleware exists (a renamed entry must fail here, not pass vacuously)')
  assert.ok(start < dbMiddleware && sitemap < dbMiddleware, 'registered before the seeding middleware')
  const handlers = workerIndex.slice(start, workerIndex.indexOf('\n\n', sitemap))
  assert.doesNotMatch(handlers, /getDb|c\.env\.DB|c\.env\.CACHE/, 'no D1 or KV on a crawler probe')
  assert.match(handlers, /if \(body === null\) return c\.notFound\(\)/, 'the admin sitemap is a 404')
  assert.match(handlers, /application\/xml/, 'the sitemap is served as XML')
})

check('both wrangler configs route the two paths to the Worker', () => {
  for (const file of ['wrangler.toml', 'wrangler.free.toml']) {
    const toml = read(path.join(CF, file))
    const start = toml.indexOf('run_worker_first = [')
    const list = toml.slice(start, toml.indexOf('\n]', start))
    for (const route of ['/robots.txt', '/sitemap.xml']) {
      assert.ok(list.includes('"' + route + '"'), file + ' run_worker_first is missing ' + route)
    }
  }
})

check('the raw document carries every link-preview tag, so the Worker has something to write into', () => {
  // Changed Oct 22 2026: index.html used to hold Leang Cosmetics' values. It is
  // neutral now (test-admin-host-document-rewrite-pure.cjs pins that); what a
  // crawler reads on the shop host is what the next check shows the Worker writes.
  const head = indexHtml.slice(0, indexHtml.indexOf('<script>'))
  for (const property of ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:url', 'og:image']) {
    assert.ok(head.includes('<meta property="' + property + '" content="'), property + ' is in the static head, before any script runs')
  }
  assert.match(head, /<meta property="og:type" content="website" \/>/)
  assert.match(head, /<meta name="twitter:card" content="summary" \/>/)
})

check('Leang\'s shop host serves the link preview its static head used to carry', () => {
  const rules = rulesFor('leangbeauty.com')
  const shopManifest = JSON.parse(read(path.join(REPO, 'frontend', 'public', 'portal-manifest.json')))
  const leangManifest = clientIdentity.shopManifest(clientIdentity.resolveClientIdentity(LEANG_ENV))
  assert.equal(shopManifest.name, 'Business OS', 'the committed manifest is the neutral one; the Worker serves Leang\'s')
  assert.deepEqual(written(rules, 'meta[property="og:site_name"]'), [leangManifest.name])
  assert.deepEqual(written(rules, 'meta[property="og:title"]'), ['Leang Cosmetics'])
  const description = written(rules, 'meta[property="og:description"]')
  assert.deepEqual(description, [leangManifest.description], 'the preview describes the shop the way its installed app does')
  // Prices can be hidden from the public storefront, so the preview never promises them.
  assert.doesNotMatch(description[0], /price/i)
  const image = written(rules, 'meta[property="og:image"]')
  assert.match(image[0], /^https:\/\/leangbeauty\.com\/leang-cosmetics-icon-512-v2\.png$/, 'absolute, on the public host')
  assert.ok(fs.existsSync(path.join(REPO, 'frontend', 'public', 'leang-cosmetics-icon-512-v2.png')), 'the preview image ships')
})

check('the shop declares its canonical URL on the primary host, so the alias cannot rank on its own', () => {
  // The Worker writes the CONFIGURED public address whatever host was asked.
  const primary = written(rulesFor('leangbeauty.com'), 'link[rel="canonical"]')
  assert.deepEqual(primary, ['https://leangbeauty.com/'], 'the canonical is absolute, on the primary host')
  assert.deepEqual(written(rulesFor('leangbeauty.com'), 'meta[property="og:url"]'), primary, 'og:url and the canonical must be the same address')
  // An alias host (www.) serving this document keeps its own sitemap and
  // robots on the request origin (each host answers for itself), and the
  // canonical is what folds it into leangbeauty.com -- so the alias must never
  // appear in the tag. The retired leangcosmetics.dpdns.org must not appear
  // either.
  for (const host of PUBLIC_HOSTS.filter((candidate) => candidate !== 'leangbeauty.com')) {
    const rules = rulesFor(host)
    for (const [selector] of [['link[rel="canonical"]'], ['meta[property="og:url"]'], ['meta[property="og:image"]']]) {
      const [value] = written(rules, selector)
      assert.ok(!value.includes(host), host + ' must canonicalise to the primary host, not to itself: ' + selector)
      assert.ok(value.startsWith('https://leangbeauty.com/'), selector + ' names the primary host: ' + value)
    }
  }
  const dpdns = written(rulesFor('www.leangbeauty.com'), 'link[rel="canonical"]')[0]
  assert.ok(!/dpdns|leangcosmetics/i.test(dpdns), 'the retired domain must not be the canonical')
  assert.ok(seo.sitemapXml('www.leangbeauty.com', 'https://www.leangbeauty.com', STAFF_HOST).includes('https://www.leangbeauty.com/'), 'the alias still answers for its own URLs')
})

check('a deployment with no public address canonicalises to the origin it was asked on, never to Leang', () => {
  const bare = { BUSINESS_OS_SHOP_NAME: 'BM Shop' }
  const rules = rulesFor('shop.example.test', bare)
  assert.deepEqual(written(rules, 'link[rel="canonical"]'), ['https://shop.example.test/'])
  assert.doesNotMatch(JSON.stringify(written(rules, 'meta[property="og:image"]')), /leang/i)
})

check('the admin host rewrites every preview tag away from the storefront', () => {
  const shopManifest = clientIdentity.shopManifest(clientIdentity.resolveClientIdentity(LEANG_ENV))
  const storefrontValues = new Set([shopManifest.name, shopManifest.short_name, shopManifest.description])
  const adminRules = rulesFor('admin.leangbeauty.com')
  for (const property of ['og:site_name', 'og:title', 'og:description', 'og:image', 'og:url']) {
    const writes = written(adminRules, 'meta[property="' + property + '"]')
    assert.ok(writes.length === 1 && writes[0], property + ' writes one value')
    assert.ok(!storefrontValues.has(writes[0]), property + ' still names the storefront')
    assert.doesNotMatch(writes[0], /leang-cosmetics-|leangbeauty.com/i, property + ' still points at a storefront file or address')
  }
  // The canonical too: an admin document telling a crawler its canonical
  // address is the shop's front page is the same leak in a different tag.
  assert.deepEqual(written(adminRules, 'link[rel="canonical"]', { href: 'https://leangbeauty.com/' }), ['/'], 'the admin canonical is its own document, never the storefront')
})

console.log('\ntest-public-seo-pure: ' + checks + ' checks passed')
