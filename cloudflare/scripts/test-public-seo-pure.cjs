// P3-L3 item E: robots.txt / sitemap.xml split by host, and the storefront's
// link-preview tags.
//
// One Worker serves the public shop (example.com) and the internal admin
// app (admin.example.com). The shop should be findable and preview well
// when its link is shared; the admin app must never be indexed or previewed
// as the shop. This runs the REAL lib/publicSeo.ts and the REAL document
// rewrite rules, and pins the wiring that makes them reachable: both paths in
// run_worker_first of BOTH wrangler configs (else the asset layer answers
// them with index.html), handlers above the D1 middleware, and the Open Graph
// tags a preview crawler reads. Since Oct 22 2026 index.html names no client,
// so those tags' values are the ones the Worker writes from wrangler [vars];
// this file reads the neutral Example Shop's from the rendered fixture config
// (harness/wrangler_vars.cjs) and, where this machine has the private
// Records/Clients/leang.env, Leang Cosmetics' from its render. Every host, name
// and icon is read from the client's own vars, so one set of checks holds for both.
//
// Run (from cloudflare/): node scripts/test-public-seo-pure.cjs
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { load } = require('./test-request-body-guard-pure.cjs')
const { wranglerVars, leangVars, hasLeang, skipLeang } = require('./harness/wrangler_vars.cjs')

const CF = path.join(__dirname, '..')
const REPO = path.join(CF, '..')
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const renderedWrangler = require('./harness/rendered_wrangler.cjs')

// The real host rule (the API gate's): admin.*, loopback and the configured
// staff host, which comes from the deployment's BUSINESS_OS_ADMIN_URL.
const clientIdentity = load('lib/clientIdentity.ts')
const gate = load('lib/publicHostGate.ts')
const identity = load('lib/documentIdentity.ts', { './clientIdentity': clientIdentity, './publicHostGate': gate })
const seo = load('lib/publicSeo.ts', { './publicHostGate': gate })
const staffHostOf = (env) => clientIdentity.staffHostFrom(env.BUSINESS_OS_ADMIN_URL, env.BUSINESS_OS_PUBLIC_URL)
// The clients under test: the neutral fixture always, Leang Cosmetics where its private render exists. Hosts,
// names and the icon prefix come from each client's own vars.
function clientOf(id, env, extra) {
  const shop = new URL(env.BUSINESS_OS_PUBLIC_URL).hostname
  return {
    id,
    env,
    shop,
    www: 'www.' + shop,
    admin: new URL(env.BUSINESS_OS_ADMIN_URL).hostname,
    staffHost: staffHostOf(env),
    name: env.BUSINESS_OS_SHOP_NAME,
    iconPrefix: env.BUSINESS_OS_SHOP_ICON_PREFIX,
    ...extra,
  }
}
// retired: an old alias host that is no longer routed. leak: finds the client's names in anything written for
// another. shipsIcons: its own icon files are committed in frontend/public.
const EXAMPLE = clientOf('example', wranglerVars('wrangler.toml'), { retired: 'example-shop.dpdns.org', leak: /example-shop|example shop|example beauty/i, shipsIcons: false })
const LEANG = hasLeang() ? clientOf('leang', leangVars('wrangler.toml'), { retired: 'leangcosmetics.dpdns.org', leak: /leang/i, shipsIcons: true }) : null
const CLIENTS = LEANG ? [EXAMPLE, LEANG] : [EXAMPLE]
if (!LEANG) skipLeang('test-public-seo-pure', "Leang's own hosts, link preview and shipped preview image")
// The rules the Worker registers for one request to this host.
const rulesFor = (hostname, env) => identity.documentRewrites({
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

const eachClient = (label, fn) => { for (const C of CLIENTS) check(label + ' [' + C.id + ']', () => fn(C)) }

// A second client on a *.workers.dev name, whose staff host cannot start with admin.
const SECOND = { BUSINESS_OS_ADMIN_URL: 'https://second-admin.shops-sub.workers.dev', BUSINESS_OS_PUBLIC_URL: 'https://second.shops-sub.workers.dev' }
const SECOND_STAFF = staffHostOf(SECOND)

eachClient('the storefront host is indexable and points at its sitemap', (C) => {
  // A retired alias host is in neither list: it is no longer routed.
  for (const host of [C.shop, C.www]) {
    const origin = 'https://' + host
    const robots = seo.robotsTxt(host, origin, C.staffHost)
    assert.match(robots, /^User-agent: \*\n/, host)
    assert.match(robots, /\nDisallow: \/api\/\n/, host + ': the API is not a page')
    assert.doesNotMatch(robots, /Disallow: \/\n/, host + ': the shop itself is not blocked')
    assert.ok(robots.includes('Sitemap: ' + origin + '/sitemap.xml\n'), host + ': sitemap on the same origin')
  }
})

eachClient('every admin host is fully disallowed and has no sitemap', (C) => {
  for (const host of [C.admin, 'localhost', '127.0.0.1']) {
    assert.equal(seo.robotsTxt(host, 'https://' + host, C.staffHost), 'User-agent: *\nDisallow: /\n', host)
    assert.equal(seo.sitemapXml(host, 'https://' + host, C.staffHost), null, host + ': nothing to index')
  }
})

check('a configured staff host is the admin host too, by exact hostname', () => {
  // Oct 22 2026: a second client's staff app is second-admin.shops-sub.workers.dev (a
  // *.workers.dev name cannot start with admin.). Without the configured host
  // it would be served a crawlable robots.txt and a sitemap for the admin app.
  const staffHost = 'second-admin.shops-sub.workers.dev'
  assert.equal(SECOND_STAFF, staffHost)
  assert.equal(seo.robotsTxt(staffHost, 'https://' + staffHost, SECOND_STAFF), 'User-agent: *\nDisallow: /\n')
  assert.equal(seo.sitemapXml(staffHost, 'https://' + staffHost, SECOND_STAFF), null)
  for (const host of ['second.shops-sub.workers.dev', staffHost + '.evil.com', 'x' + staffHost]) {
    assert.match(seo.robotsTxt(host, 'https://' + host, SECOND_STAFF), new RegExp('Sitemap: https://' + host.replace(/\./g, '\\.') + '/sitemap\\.xml'), host + ' is the storefront')
    assert.ok(seo.sitemapXml(host, 'https://' + host, SECOND_STAFF).includes('https://' + host + '/'), host)
  }
  // Under another client's config the second client's staff host is just another host.
  for (const C of CLIENTS) {
    assert.doesNotMatch(seo.robotsTxt(staffHost, 'https://' + staffHost, C.staffHost), /Disallow: \/\n/, C.id)
  }
  // No configured staff host: admin.* and local development are the admin app, nothing else.
  assert.equal(seo.robotsTxt('localhost', 'http://localhost:8787', undefined), 'User-agent: *\nDisallow: /\n')
  for (const C of CLIENTS) {
    assert.equal(seo.robotsTxt(C.admin, 'https://' + C.admin, undefined), 'User-agent: *\nDisallow: /\n', C.id)
  }
  assert.doesNotMatch(seo.robotsTxt(staffHost, 'https://' + staffHost, undefined), /Disallow: \/\n/)
})

eachClient('the sitemap is the home page and the three legal pages, on the request origin', (C) => {
  const xml = seo.sitemapXml(C.shop, 'https://' + C.shop, C.staffHost)
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/)
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  assert.deepEqual(locs, [
    'https://' + C.shop + '/',
    'https://' + C.shop + '/?legal=privacy',
    'https://' + C.shop + '/?legal=terms',
    'https://' + C.shop + '/?legal=cookies',
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
  for (const [file, toml] of [['wrangler.toml', renderedWrangler.paid()], ['wrangler.free.toml', renderedWrangler.free()]]) {
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

eachClient('the shop host serves the link preview its static head used to carry', (C) => {
  const rules = rulesFor(C.shop, C.env)
  const shopManifest = JSON.parse(read(path.join(REPO, 'frontend', 'public', 'portal-manifest.json')))
  const clientManifest = clientIdentity.shopManifest(clientIdentity.resolveClientIdentity(C.env))
  assert.equal(shopManifest.name, 'Business OS', 'the committed manifest is the neutral one; the Worker serves the client\'s')
  assert.deepEqual(written(rules, 'meta[property="og:site_name"]'), [clientManifest.name])
  assert.deepEqual(written(rules, 'meta[property="og:title"]'), [C.name])
  const description = written(rules, 'meta[property="og:description"]')
  assert.deepEqual(description, [clientManifest.description], 'the preview describes the shop the way its installed app does')
  // Prices can be hidden from the public storefront, so the preview never promises them.
  assert.doesNotMatch(description[0], /price/i)
  const image = written(rules, 'meta[property="og:image"]')
  assert.equal(image[0], 'https://' + C.shop + C.iconPrefix + 'icon-512-v2.png', 'absolute, on the public host')
  if (C.shipsIcons) assert.ok(fs.existsSync(path.join(REPO, 'frontend', 'public', C.iconPrefix.slice(1) + 'icon-512-v2.png')), 'the preview image ships')
})

eachClient('the shop declares its canonical URL on the primary host, so the alias cannot rank on its own', (C) => {
  // The Worker writes the CONFIGURED public address whatever host was asked.
  const primary = written(rulesFor(C.shop, C.env), 'link[rel="canonical"]')
  assert.deepEqual(primary, ['https://' + C.shop + '/'], 'the canonical is absolute, on the primary host')
  assert.deepEqual(written(rulesFor(C.shop, C.env), 'meta[property="og:url"]'), primary, 'og:url and the canonical must be the same address')
  // An alias host (www.) serving this document keeps its own sitemap and
  // robots on the request origin (each host answers for itself), and the
  // canonical is what folds it into the primary host -- so the alias must never
  // appear in the tag. The retired host must not appear either.
  for (const host of [C.shop, C.www].filter((candidate) => candidate !== C.shop)) {
    const rules = rulesFor(host, C.env)
    for (const [selector] of [['link[rel="canonical"]'], ['meta[property="og:url"]'], ['meta[property="og:image"]']]) {
      const [value] = written(rules, selector)
      assert.ok(!value.includes(host), host + ' must canonicalise to the primary host, not to itself: ' + selector)
      assert.ok(value.startsWith('https://' + C.shop + '/'), selector + ' names the primary host: ' + value)
    }
  }
  const retiredName = C.retired.split('.')[0]
  const canonical = written(rulesFor(C.www, C.env), 'link[rel="canonical"]')[0]
  assert.ok(!new RegExp('dpdns|' + retiredName, 'i').test(canonical), 'the retired domain must not be the canonical')
  assert.ok(seo.sitemapXml(C.www, 'https://' + C.www, C.staffHost).includes('https://' + C.www + '/'), 'the alias still answers for its own URLs')
})

eachClient('a deployment with no public address canonicalises to the origin it was asked on, never to another client', (C) => {
  const bare = { BUSINESS_OS_SHOP_NAME: 'Second Shop' }
  const rules = rulesFor('shop.example.test', bare)
  assert.deepEqual(written(rules, 'link[rel="canonical"]'), ['https://shop.example.test/'])
  assert.doesNotMatch(JSON.stringify(written(rules, 'meta[property="og:image"]')), C.leak)
})

eachClient('the admin host rewrites every preview tag away from the storefront', (C) => {
  const shopManifest = clientIdentity.shopManifest(clientIdentity.resolveClientIdentity(C.env))
  const storefrontValues = new Set([shopManifest.name, shopManifest.short_name, shopManifest.description])
  const adminRules = rulesFor(C.admin, C.env)
  const storefrontFile = new RegExp(C.iconPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '|' + C.shop.replace(/\./g, '\\.'), 'i')
  for (const property of ['og:site_name', 'og:title', 'og:description', 'og:image', 'og:url']) {
    const writes = written(adminRules, 'meta[property="' + property + '"]')
    assert.ok(writes.length === 1 && writes[0], property + ' writes one value')
    assert.ok(!storefrontValues.has(writes[0]), property + ' still names the storefront')
    assert.doesNotMatch(writes[0], storefrontFile, property + ' still points at a storefront file or address')
  }
  // The canonical too: an admin document telling a crawler its canonical
  // address is the shop's front page is the same leak in a different tag.
  assert.deepEqual(written(adminRules, 'link[rel="canonical"]', { href: 'https://' + C.shop + '/' }), ['/'], 'the admin canonical is its own document, never the storefront')
})

console.log('\ntest-public-seo-pure: ' + checks + ' checks passed')
