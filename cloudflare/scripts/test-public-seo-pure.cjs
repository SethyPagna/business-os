// P3-L3 item E: robots.txt / sitemap.xml split by host, and the storefront's
// link-preview tags.
//
// One Worker serves the public shop (leangbeauty.com) and the internal admin
// app (admin.leangbeauty.com). The shop should be findable and preview well
// when its link is shared; the admin app must never be indexed or previewed
// as the shop. This runs the REAL lib/publicSeo.ts and the REAL admin rewrite
// rules, and pins the wiring that makes them reachable: both paths in
// run_worker_first of BOTH wrangler configs (else the asset layer answers
// them with index.html), handlers above the D1 middleware, and the raw
// index.html carrying the Open Graph tags a preview crawler reads.
//
// Run (from cloudflare/): node scripts/test-public-seo-pure.cjs
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { load } = require('./test-request-body-guard-pure.cjs')

const CF = path.join(__dirname, '..')
const REPO = path.join(CF, '..')
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

// The real host list: the split is only as good as ADMIN_DOCUMENT_HOSTS.
const identity = load('lib/adminDocumentIdentity.ts')
const seo = load('lib/publicSeo.ts', { './adminDocumentIdentity': identity })
const workerIndex = read(path.join(CF, 'src', 'index.ts'))
const indexHtml = read(path.join(REPO, 'frontend', 'index.html'))

let checks = 0
const check = (label, fn) => { fn(); checks += 1; process.stdout.write('  ok  ' + label + '\n') }

const PUBLIC_HOSTS = ['leangbeauty.com', 'www.leangbeauty.com', 'leangcosmetics.dpdns.org']
const ADMIN_HOSTS = ['admin.leangbeauty.com', 'admin.leangcosmetics.dpdns.org', 'localhost', '127.0.0.1']

check('the storefront host is indexable and points at its sitemap', () => {
  for (const host of PUBLIC_HOSTS) {
    const origin = 'https://' + host
    const robots = seo.robotsTxt(host, origin)
    assert.match(robots, /^User-agent: \*\n/, host)
    assert.match(robots, /\nDisallow: \/api\/\n/, host + ': the API is not a page')
    assert.doesNotMatch(robots, /Disallow: \/\n/, host + ': the shop itself is not blocked')
    assert.ok(robots.includes('Sitemap: ' + origin + '/sitemap.xml\n'), host + ': sitemap on the same origin')
  }
})

check('every admin host is fully disallowed and has no sitemap', () => {
  for (const host of ADMIN_HOSTS) {
    assert.equal(seo.robotsTxt(host, 'https://' + host), 'User-agent: *\nDisallow: /\n', host)
    assert.equal(seo.sitemapXml(host, 'https://' + host), null, host + ': nothing to index')
  }
})

check('the sitemap is the home page and the three legal pages, on the request origin', () => {
  const xml = seo.sitemapXml('leangbeauty.com', 'https://leangbeauty.com')
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
  const dbMiddleware = workerIndex.indexOf('await ensureCoreDataInvariantsOnce(c.env)')
  assert.ok(start > 0 && sitemap > 0, 'both handlers exist')
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

check('the raw storefront document carries the link-preview tags', () => {
  const head = indexHtml.slice(0, indexHtml.indexOf('<script>'))
  const meta = (property) => {
    const match = head.match(new RegExp('<meta property="' + property.replace(':', '\\:') + '" content="([^"]*)"'))
    assert.ok(match, property + ' is in the static head, before any script runs')
    return match[1]
  }
  assert.equal(meta('og:type'), 'website')
  assert.equal(meta('og:site_name'), 'Leang Beauty')
  assert.equal(meta('og:title'), 'Leang Beauty')
  assert.ok(meta('og:description').length > 20, 'a real description')
  assert.match(meta('og:image'), /^https:\/\/leangbeauty\.com\/leang-cosmetics-icon-512\.png$/, 'absolute, on the public host')
  assert.match(head, /<meta name="twitter:card" content="summary" \/>/)
  assert.ok(fs.existsSync(path.join(REPO, 'frontend', 'public', 'leang-cosmetics-icon-512.png')), 'the preview image ships')
})

check('the document declares its canonical URL on the primary host, so the alias cannot rank on its own', () => {
  const head = indexHtml.slice(0, indexHtml.indexOf('<script>'))
  const canonical = head.match(/<link rel="canonical" href="([^"]*)"/)
  assert.ok(canonical, 'the static head carries no canonical URL')
  assert.equal(canonical[1], 'https://leangbeauty.com/', 'the canonical is absolute, on the primary host')
  const ogUrl = head.match(/<meta property="og:url" content="([^"]*)"/)
  assert.ok(ogUrl, 'the static head carries no og:url')
  assert.equal(ogUrl[1], canonical[1], 'og:url and the canonical must be the same address')
  // leangcosmetics.dpdns.org serves this exact document. Its own sitemap and
  // robots stay on the request origin (each host answers for itself), and the
  // canonical above is what folds it into leangbeauty.com -- so the alias must
  // never appear in the tag.
  for (const host of PUBLIC_HOSTS.filter((candidate) => candidate !== 'leangbeauty.com')) {
    assert.ok(!canonical[1].includes(host), host + ' must canonicalise to the primary host, not to itself')
  }
  assert.ok(seo.sitemapXml('leangcosmetics.dpdns.org', 'https://leangcosmetics.dpdns.org').includes('https://leangcosmetics.dpdns.org/'), 'the alias still answers for its own URLs')
})

check('the admin host rewrites every preview tag away from the storefront', () => {
  for (const property of ['og:site_name', 'og:title', 'og:description', 'og:image', 'og:url']) {
    const rule = identity.ADMIN_DOCUMENT_REWRITES.find((candidate) => candidate.selector === 'meta[property="' + property + '"]')
    assert.ok(rule, 'no admin rewrite for ' + property)
    const writes = []
    rule.element({
      getAttribute: () => null,
      setAttribute: (_name, value) => writes.push(value),
      setInnerContent: (value) => writes.push(value),
    })
    assert.ok(writes.length === 1 && writes[0], property + ' writes one value')
    assert.doesNotMatch(writes[0], /leang/i, property + ' still names the storefront')
  }
  // The canonical too: an admin document telling a crawler its canonical
  // address is the shop's front page is the same leak in a different tag.
  const canonicalRule = identity.ADMIN_DOCUMENT_REWRITES.find((candidate) => candidate.selector === 'link[rel="canonical"]')
  assert.ok(canonicalRule, 'no admin rewrite for the canonical URL')
  const canonicalWrites = []
  canonicalRule.element({
    getAttribute: () => 'https://leangbeauty.com/',
    setAttribute: (_name, value) => canonicalWrites.push(value),
    setInnerContent: (value) => canonicalWrites.push(value),
  })
  assert.deepEqual(canonicalWrites, ['/'], 'the admin canonical is its own document, never the storefront')
})

console.log('\ntest-public-seo-pure: ' + checks + ' checks passed')
