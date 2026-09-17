#!/usr/bin/env node
// G4: the admin host must never serve the storefront's install identity.
//
// One built index.html serves both hosts. Its static <head> names the
// storefront (portal manifest, Leang icons, Leang title) and an inline script
// swaps in the Business OS admin identity before first paint. index.html's own
// comment records why that is not enough on iOS: "Add to Home Screen" can read
// the RAW HTML, so an admin user installing admin.leangbeauty.com could end up
// with a home-screen app called Leang Beauty, wearing the storefront icon and
// pointed at the storefront manifest.
//
// src/index.ts streams the document through HTMLRewriter with the rules in
// src/lib/adminDocumentIdentity.ts, for admin hosts only. HTMLRewriter does
// not exist outside workerd, so these checks run the REAL rule handlers on a
// stub element, drive the REAL gate function across the request shapes that
// must and must not be rewritten, and pin the wiring the rewrite depends on:
// wrangler.toml's run_worker_first (a document route that never reaches the
// Worker is never rewritten), src/index.ts (a route the Worker receives
// without a handler 404s a whole page) and frontend/public/_headers (the
// Worker now produces the document, so it owns that cache rule).
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const CF = path.join(__dirname, '..')
const REPO = path.join(CF, '..')
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

function loadModule(relPath) {
  const source = read(path.join(CF, 'src', relPath))
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  }).outputText
  const module = { exports: {} }
  new Function('exports', 'require', 'module', output)(module.exports, require, module)
  return module.exports
}

const identity = loadModule('lib/adminDocumentIdentity.ts')
const workerIndex = read(path.join(CF, 'src', 'index.ts'))
const wrangler = read(path.join(CF, 'wrangler.toml'))
const headersFile = read(path.join(REPO, 'frontend', 'public', '_headers'))
const pathRouting = read(path.join(REPO, 'frontend', 'src', 'app', 'pathRouting.ts'))
const serviceWorker = read(path.join(REPO, 'frontend', 'src', 'public-runtime', 'service-worker.ts'))

let checks = 0
const check = (label, fn) => { fn(); checks += 1; process.stdout.write('  ok  ' + label + '\n') }

// A stand-in for HTMLRewriter's Element: the same three methods the rules use,
// recording what they did so the assertions read the real behaviour.
function stubElement(attributes = {}) {
  return {
    attributes: { ...attributes },
    innerContent: null,
    // Only what the rule itself wrote, so a check can tell a value the rule
    // produced from one the sample element happened to start with.
    writes: [],
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null },
    setAttribute(name, value) { this.attributes[name] = value; this.writes.push(value) },
    setInnerContent(content) { this.innerContent = content; this.writes.push(content) },
  }
}

const ruleFor = (selector) => {
  const rule = identity.ADMIN_DOCUMENT_REWRITES.find((candidate) => candidate.selector === selector)
  assert.ok(rule, 'no rewrite rule for ' + selector)
  return rule
}

const documentRequest = (overrides) => ({
  hostname: 'admin.leangbeauty.com',
  method: 'GET',
  accept: 'text/html,application/xhtml+xml',
  contentType: 'text/html; charset=utf-8',
  ok: true,
  ...overrides,
})

// --- the gate: what gets rewritten, and what must never be touched ----------

check('an admin navigation is rewritten', () => {
  assert.strictEqual(identity.shouldRewriteAdminDocument(documentRequest({})), true)
  for (const hostname of identity.ADMIN_DOCUMENT_HOSTS) {
    assert.strictEqual(identity.shouldRewriteAdminDocument(documentRequest({ hostname })), true, hostname)
  }
  assert.strictEqual(
    identity.shouldRewriteAdminDocument(documentRequest({ hostname: 'ADMIN.LeangBeauty.com' })),
    true,
    'the host comparison is case-insensitive',
  )
})

check('the storefront host is never rewritten', () => {
  for (const hostname of ['leangbeauty.com', 'www.leangbeauty.com', 'leangcosmetics.dpdns.org', 'admin.evil.example', 'notadmin.leangbeauty.com', '', null]) {
    assert.strictEqual(
      identity.shouldRewriteAdminDocument(documentRequest({ hostname })),
      false,
      String(hostname) + ' must be served the storefront document untouched',
    )
  }
})

check('nothing but a document response is rewritten', () => {
  // The Worker only ever sees these paths, but a JSON/asset response reaching
  // the handler (an error page, a redirect body, a 304) must stream through.
  assert.strictEqual(identity.shouldRewriteAdminDocument(documentRequest({ contentType: 'application/json' })), false, 'JSON')
  assert.strictEqual(identity.shouldRewriteAdminDocument(documentRequest({ contentType: 'image/png' })), false, 'an image')
  assert.strictEqual(identity.shouldRewriteAdminDocument(documentRequest({ contentType: '' })), false, 'no content type')
  assert.strictEqual(identity.shouldRewriteAdminDocument(documentRequest({ ok: false })), false, 'a 304 or an error')
  assert.strictEqual(identity.shouldRewriteAdminDocument(documentRequest({ method: 'HEAD' })), false, 'HEAD has no body')
  assert.strictEqual(identity.shouldRewriteAdminDocument(documentRequest({ method: 'POST' })), false, 'POST is not a navigation')
  assert.strictEqual(identity.shouldRewriteAdminDocument(documentRequest({ accept: 'application/json' })), false, 'an explicit JSON fetch')
})

check('the service worker precache fetch is still rewritten', () => {
  // precacheAppShell caches '/index.html' with a wildcard Accept. If that were
  // excluded, the OFFLINE admin shell would carry the storefront identity --
  // the same bug, one layer down.
  assert.match(serviceWorker, /cache\.add\(new Request\(url, \{ cache: 'reload' \}\)\)/, 'the precache still uses a plain Request')
  assert.strictEqual(identity.shouldRewriteAdminDocument(documentRequest({ accept: '*/*' })), true, 'wildcard Accept')
  assert.strictEqual(identity.shouldRewriteAdminDocument(documentRequest({ accept: undefined })), true, 'no Accept header')
})

// --- the rules themselves ---------------------------------------------------

check('the title becomes Business OS', () => {
  const element = stubElement()
  ruleFor('title').element(element)
  assert.strictEqual(element.innerContent, 'Business OS')
})

check('the Apple home-screen name becomes Business OS', () => {
  const element = stubElement({ name: 'apple-mobile-web-app-title', content: 'Leang Beauty' })
  ruleFor('meta[name="apple-mobile-web-app-title"]').element(element)
  assert.strictEqual(element.attributes.content, 'Business OS')
})

check('the description becomes the admin one', () => {
  const element = stubElement({ name: 'description', content: 'Leang Beauty - product catalog, prices and store contact' })
  ruleFor('meta[name="description"]').element(element)
  assert.strictEqual(element.attributes.content, 'Business OS - Offline-first POS, inventory and analytics')
})

check('the installed app points at the ADMIN manifest', () => {
  const element = stubElement({ rel: 'manifest', href: '/portal-manifest.json' })
  ruleFor('link[rel="manifest"]').element(element)
  assert.strictEqual(element.attributes.href, '/manifest.json')
})

check('the home-screen icon is the Business OS one', () => {
  const element = stubElement({ rel: 'apple-touch-icon', sizes: '180x180', href: '/leang-cosmetics-apple-touch-icon-v1.png' })
  ruleFor('link[rel="apple-touch-icon"]').element(element)
  assert.strictEqual(element.attributes.href, '/apple-touch-icon.png')
})

check('every favicon size maps to its admin twin', () => {
  const iconRule = ruleFor('link[rel="icon"]')
  const sized192 = stubElement({ rel: 'icon', type: 'image/png', sizes: '192x192', href: '/leang-cosmetics-icon-192.png' })
  iconRule.element(sized192)
  assert.strictEqual(sized192.attributes.href, '/icon-192.png')
  assert.strictEqual(sized192.attributes.type, 'image/png')

  const sized512 = stubElement({ rel: 'icon', type: 'image/png', sizes: '512x512', href: '/leang-cosmetics-icon-512.png' })
  iconRule.element(sized512)
  assert.strictEqual(sized512.attributes.href, '/icon-512.png')

  const unsized = stubElement({ rel: 'icon', type: 'image/png', href: '/leang-cosmetics-icon-512.png' })
  iconRule.element(unsized)
  assert.strictEqual(unsized.attributes.href, '/favicon.ico?v=business-os')
  assert.strictEqual(unsized.attributes.type, 'image/x-icon')

  // An unknown size must still land on an admin icon, never keep a Leang one.
  const unknown = stubElement({ rel: 'icon', sizes: '64x64', href: '/leang-cosmetics-icon-192.png' })
  iconRule.element(unknown)
  assert.doesNotMatch(unknown.attributes.href, /leang/i)
})

check('the admin document never advertises the storefront address', () => {
  // index.html ships an ABSOLUTE canonical and og:url on leangbeauty.com (they
  // are what folds the alias host into the primary one -- test-public-seo-pure
  // .cjs). Left alone, every admin page would tell a crawler or a chat preview
  // that its canonical address is the shop's front page.
  const canonical = stubElement({ rel: 'canonical', href: 'https://leangbeauty.com/' })
  ruleFor('link[rel="canonical"]').element(canonical)
  assert.strictEqual(canonical.attributes.href, '/')

  const ogUrl = stubElement({ property: 'og:url', content: 'https://leangbeauty.com/' })
  ruleFor('meta[property="og:url"]').element(ogUrl)
  assert.strictEqual(ogUrl.attributes.content, '/')

  // Relative on purpose: an absolute value would have to name ONE of the four
  // admin hosts. It is only defensible because nothing indexes the admin app --
  // robots.txt answers Disallow: / on every admin host, pinned in
  // test-public-seo-pure.cjs.
})

check('every tag index.html publishes for the storefront has an admin answer', () => {
  // A new storefront-branded head tag that nobody rewrites is the G4 bug
  // class returning: the raw HTML on the admin host keeps naming Leang Beauty.
  const head = read(path.join(REPO, 'frontend', 'index.html')).split('<script>')[0]
  const published = [
    ...[...head.matchAll(/<meta property="(og:[a-z_]+)"/g)].map((match) => 'meta[property="' + match[1] + '"]'),
    ...(head.includes('<link rel="canonical"') ? ['link[rel="canonical"]'] : []),
  ]
  assert.ok(published.length >= 6, 'the storefront head was read, not missed')
  const rewritten = new Set(identity.ADMIN_DOCUMENT_REWRITES.map((rule) => rule.selector))
  for (const selector of published) {
    // og:type is 'website' on both hosts: a value with no storefront identity
    // in it is the one tag that needs no answer.
    if (selector === 'meta[property="og:type"]') continue
    assert.ok(rewritten.has(selector), selector + ' names the storefront in the raw HTML and no admin rule replaces it')
  }
})

check('no rule leaves a storefront value behind', () => {
  for (const rule of identity.ADMIN_DOCUMENT_REWRITES) {
    const element = stubElement({ href: '/leang-cosmetics-icon-512.png', content: 'Leang Beauty', sizes: '192x192' })
    rule.element(element)
    assert.ok(element.writes.length > 0, rule.selector + ' wrote nothing at all')
    assert.doesNotMatch(element.writes.join(' '), /leang/i, rule.selector + ' still writes a storefront value')
  }
})

// --- how the handler runs it ------------------------------------------------

check('the document is streamed, never buffered', () => {
  // Free plan: 10 ms CPU per invocation. Buffering the document (await
  // response.text(), arrayBuffer(), a regex pass over the body) is exactly
  // what must not come back.
  const handler = workerIndex.slice(
    workerIndex.indexOf('async function serveAppDocument'),
    workerIndex.indexOf('// GET and HEAD:'),
  )
  assert.ok(handler.length > 200, 'the handler was found, not an empty slice')
  assert.match(handler, /new HTMLRewriter\(\)/, 'HTMLRewriter streams the rewrite')
  assert.match(handler, /rewriter\.transform\(new Response\(response\.body/, 'the body is piped, not read')
  assert.doesNotMatch(handler, /response\.text\(\)|response\.arrayBuffer\(\)|response\.json\(\)/, 'the body must never be buffered')
  assert.doesNotMatch(handler, /c\.env\.DB|c\.env\.CACHE|getDb\(/, 'no D1 or KV on a document request')
  assert.match(handler, /if \(!shouldRewrite\) return response/, 'everything else falls through untouched')
})

check('the rewritten body cannot carry a stale Content-Length', () => {
  assert.match(workerIndex, /headers\.delete\('content-length'\)/)
})

check('the static-asset binding the handler reads is declared', () => {
  assert.match(wrangler, /\nbinding = "STATIC_ASSETS"/, 'wrangler.toml binds the built frontend as STATIC_ASSETS')
  assert.match(workerIndex, /STATIC_ASSETS\?: Fetcher/, 'Env declares the binding')
  assert.match(workerIndex, /const assets = c\.env\.STATIC_ASSETS/, 'the document handler reads it')
  assert.match(workerIndex, /app\.on\(\['GET', 'HEAD'\], route, serveAppDocument\)/, 'GET and HEAD are both served')
})

// --- the wiring the rewrite depends on --------------------------------------

function wranglerRunWorkerFirst() {
  const start = wrangler.indexOf('run_worker_first = [')
  assert.ok(start >= 0, 'wrangler.toml declares run_worker_first')
  const end = wrangler.indexOf('\n]', start)
  return [...wrangler.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

check('every document route the Worker handles is routed to the Worker', () => {
  const routed = new Set(wranglerRunWorkerFirst())
  for (const route of identity.APP_DOCUMENT_ROUTES) {
    assert.ok(routed.has(route), 'run_worker_first is missing ' + route + ', so the asset layer would answer it unrewritten')
  }
})

check('no route is sent to the Worker without a handler', () => {
  // /robots.txt and /sitemap.xml: src/index.ts's public SEO handlers
  // (test-public-seo-pure.cjs).
  // /assets/*: src/index.ts's build-asset handler, which turns a chunk the
  // deploy deleted into an honest 404 instead of the SPA document (the Sep 17
  // blank-page outage; test-stale-build-asset-404-pure.cjs).
  const handled = new Set([...identity.APP_DOCUMENT_ROUTES, '/api/*', '/uploads/*', '/health', '/ws', '/robots.txt', '/sitemap.xml', '/assets/*'])
  for (const route of wranglerRunWorkerFirst()) {
    assert.ok(handled.has(route), route + ' reaches the Worker but nothing handles it; that 404s a whole page')
  }
})

check('every admin route this Worker serves is a known admin host', () => {
  const routes = wrangler.slice(wrangler.indexOf('routes = ['), wrangler.indexOf('\n]', wrangler.indexOf('routes = [')))
  const patterns = [...routes.matchAll(/pattern = "([^"]+)"/g)].map((m) => m[1])
  assert.ok(patterns.length >= 4, 'the route table was read, not missed')
  for (const pattern of patterns) {
    const hostname = pattern.split('/')[0].toLowerCase()
    if (!hostname.startsWith('admin.')) continue
    assert.ok(
      identity.ADMIN_DOCUMENT_HOSTS.includes(hostname),
      hostname + ' is deployed as an admin host but is not in ADMIN_DOCUMENT_HOSTS, so it would install as the storefront',
    )
  }
})

check('the SPA segments match the frontend admin route table', () => {
  const table = pathRouting.slice(
    pathRouting.indexOf('ADMIN_ROUTE_PAGE_BY_SEGMENT = new Map'),
    pathRouting.indexOf('const ADMIN_AUTH_ROUTE_SEGMENTS'),
  )
  const frontendSegments = [...table.matchAll(/\['([a-z0-9-]+)',\s*'[a-z_]+'\]/g)].map((m) => m[1])
  assert.ok(frontendSegments.length > 20, 'the frontend route table was read, not missed')
  const auth = /ADMIN_AUTH_ROUTE_SEGMENTS = new Set<string>\(\[([^\]]*)\]/.exec(pathRouting)
  const authSegments = [...auth[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1])
  const covered = new Set(identity.ADMIN_DOCUMENT_SEGMENTS)
  for (const segment of [...frontendSegments, ...authSegments]) {
    assert.ok(covered.has(segment), 'admin route /' + segment + ' serves index.html but is not rewritten on the admin host')
  }
})

check('the document cache rule still matches _headers', () => {
  // The Worker now produces '/' and '/index.html', so its Cache-Control must
  // be the one frontend/public/_headers declares for them -- an old client
  // meeting a new deploy revalidates its navigation because of this rule.
  const rule = /\n\/index\.html\n\s+Cache-Control: ([^\n]+)/.exec(headersFile)
  assert.ok(rule, '_headers still declares a cache rule for /index.html')
  assert.match(
    workerIndex,
    new RegExp("APP_DOCUMENT_CACHE_CONTROL = '" + rule[1].trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'"),
    'the Worker must serve the document with the same Cache-Control as _headers',
  )
  assert.ok(rule[1].includes('must-revalidate'), 'the document must still revalidate')
})

process.stdout.write('\nadmin-host document rewrite: ' + checks + ' checks passed\n')
