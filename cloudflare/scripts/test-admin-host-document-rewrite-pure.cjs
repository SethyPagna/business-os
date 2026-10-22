#!/usr/bin/env node
// G4 and client identity: the admin host must never serve the storefront's
// install identity, and no document may name a client the deployment is not.
//
// One built index.html serves every deployment and both hosts, and it names
// no client: its static head and identity block carry the neutral Business OS
// identity. src/index.ts streams each app document through HTMLRewriter with
// the rules in src/lib/documentIdentity.ts -- the staff identity on the admin
// host, the shop's everywhere else -- both resolved from the deployment's
// wrangler [vars] (src/lib/clientIdentity.ts). index.html's own comment
// records why the rewrite is needed: iOS "Add to Home Screen" can read the RAW
// HTML, so an admin installing admin.leangbeauty.com could otherwise end up
// with a home-screen app named after the shop, and a second client's shop
// could end up named after the first.
//
// HTMLRewriter does not exist outside workerd, so these checks run the REAL
// rule handlers on a stub element, drive the REAL gate function across the
// request shapes that must and must not be rewritten, and pin the wiring the
// rewrite depends on: wrangler.toml and wrangler.free.toml's run_worker_first
// (a document route that never reaches the Worker is never rewritten),
// src/index.ts (a route the Worker receives without a handler 404s a whole
// page) and frontend/public/_headers (the Worker produces the document and the
// manifests, so it owns their cache rule).
//
// Two fixtures carry the weight. LEANG_ADMIN and LEANG_SHOP are the values the
// app wrote BEFORE identity became configurable (Oct 22 2026), frozen from
// commit 30fef7c2f: the admin rewrite module and the static index.html head.
// With wrangler.toml's own [vars] the configurable path must reproduce them to
// the byte. BM_ENV is the second client: with its vars nothing written on
// either host may mention Leang.
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const { wranglerVars, wranglerStringArray, wranglerRoutePatterns } = require('./harness/wrangler_vars.cjs')

const CF = path.join(__dirname, '..')
const REPO = path.join(CF, '..')
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

function loadModule(relPath, dependencies = {}) {
  const source = read(path.join(CF, 'src', relPath))
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  }).outputText
  const module = { exports: {} }
  new Function('exports', 'require', 'module', output)(module.exports, (name) => (name in dependencies ? dependencies[name] : require(name)), module)
  return module.exports
}

const clientIdentity = loadModule('lib/clientIdentity.ts')
const routes = loadModule('lib/documentRoutes.ts')
const gate = loadModule('lib/publicHostGate.ts')
const documents = loadModule('lib/documentIdentity.ts', { './clientIdentity': clientIdentity, './publicHostGate': gate })
const { resolveClientIdentity, NEUTRAL_CLIENT_IDENTITY, STAFF_ICONS, staffManifest, shopManifest, clientIdentityJson, MANIFEST_ROUTES } = clientIdentity

const workerIndex = read(path.join(CF, 'src', 'index.ts'))
const wrangler = read(path.join(CF, 'wrangler.toml'))
const headersFile = read(path.join(REPO, 'frontend', 'public', '_headers'))
const pathRouting = read(path.join(REPO, 'frontend', 'src', 'app', 'pathRouting.ts'))
const serviceWorker = read(path.join(REPO, 'frontend', 'src', 'public-runtime', 'service-worker.ts'))
const indexHtml = read(path.join(REPO, 'frontend', 'index.html'))
const staffManifestFile = JSON.parse(read(path.join(REPO, 'frontend', 'public', 'manifest.json')))
const shopManifestFile = JSON.parse(read(path.join(REPO, 'frontend', 'public', 'portal-manifest.json')))

let checks = 0
const check = (label, fn) => { fn(); checks += 1; process.stdout.write('  ok  ' + label + '\n') }

// --- the two deployments ----------------------------------------------------

// Leang Cosmetics' own configuration, read from the file that deploys it.
const LEANG_ENV = wranglerVars('wrangler.toml')
const LEANG_ADMIN_HOST = 'admin.leangbeauty.com'
const LEANG_SHOP_HOST = 'leangbeauty.com'

// The second client (clients/bmshop): a name, two addresses and a membership
// prefix. No icon prefix, alias or category -- the neutral defaults apply. Its
// addresses follow the owner's scheme (22 Oct 2026): the shop at
// <client>.khshop.workers.dev, staff at <client>-admin.khshop.workers.dev -- a
// configured staff host, since a *.workers.dev name cannot start with admin.
const BM_ENV = {
  BUSINESS_OS_SHOP_NAME: 'BM Shop',
  BUSINESS_OS_PUBLIC_URL: 'https://bm.khshop.workers.dev',
  BUSINESS_OS_ADMIN_URL: 'https://bm-admin.khshop.workers.dev',
  BUSINESS_OS_ORGANIZATION_NAME: 'BM Shop',
  BUSINESS_OS_MEMBERSHIP_PREFIX: 'BM-',
}
const BM_ADMIN_HOST = 'bm-admin.khshop.workers.dev'
const BM_SHOP_HOST = 'bm.khshop.workers.dev'

const NEUTRAL_ENV = {}

// What the admin host rewrote before identity was configurable
// (cloudflare/src/lib/adminDocumentIdentity.ts at 30fef7c2f).
const LEANG_ADMIN = {
  title: 'Leang Cosmetics Admin',
  appTitle: 'Leang Admin',
  description: 'Till, stock and sales for Leang Cosmetics staff',
  themeColor: '#fffdf8',
  manifest: '/manifest.json',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
  appleTouch: '/admin-apple-touch-icon-v1.png',
  favicon: '/admin-favicon-v1.ico',
  icon192: '/icon-192.png',
  icon512: '/icon-512.png',
  ogImage: '/icon-512.png',
  selfUrl: '/',
}

// What the shop host's document carried before identity was configurable: the
// static head of frontend/index.html at 30fef7c2f.
const LEANG_SHOP = {
  title: 'Leang Cosmetics',
  appTitle: 'Leang Cosmetics',
  description: 'Browse Leang Cosmetics products and contact the store.',
  canonical: 'https://leangbeauty.com/',
  ogImage: 'https://leangbeauty.com/leang-cosmetics-icon-512-v2.png',
  favicon: '/leang-cosmetics-favicon-v2.ico',
  icon192: '/leang-cosmetics-icon-192-v2.png',
  icon512: '/leang-cosmetics-icon-512-v2.png',
  appleTouch: '/leang-cosmetics-apple-touch-icon-v2.png',
}

// frontend/public/manifest.json and portal-manifest.json at 30fef7c2f.
const LEANG_STAFF_MANIFEST = {
  name: 'Leang Cosmetics Admin',
  short_name: 'Leang Admin',
  description: 'Till, stock and sales for Leang Cosmetics staff',
  id: '/',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#f4f1ea',
  theme_color: '#fffdf8',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-192-maskable-v2.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-512-maskable-v2.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}
const LEANG_SHOP_MANIFEST = {
  name: 'Leang Cosmetics',
  short_name: 'Leang Cosmetics',
  description: 'Browse Leang Cosmetics products and contact the store.',
  id: '/',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#ffffff',
  theme_color: '#ffffff',
  icons: [
    { src: '/leang-cosmetics-icon-192-v2.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/leang-cosmetics-icon-192-maskable-v2.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/leang-cosmetics-icon-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/leang-cosmetics-icon-512-maskable-v2.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}

// --- harness ----------------------------------------------------------------

// A stand-in for HTMLRewriter's Element: the methods the rules use, recording
// what they did so the assertions read the real behaviour.
function stubElement(attributes = {}) {
  return {
    attributes: { ...attributes },
    innerContent: null,
    innerOptions: undefined,
    // Only what the rule itself wrote, so a check can tell a value the rule
    // produced from one the sample element happened to start with.
    writes: [],
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null },
    setAttribute(name, value) { this.attributes[name] = value; this.writes.push(value) },
    setInnerContent(content, options) { this.innerContent = content; this.innerOptions = options; this.writes.push(content) },
  }
}

// The rules the Worker would register for one request: what src/index.ts's
// rewriteAppDocument builds from the env and the request URL.
function rulesFor(env, hostname) {
  return documents.documentRewrites({
    identity: resolveClientIdentity(env),
    hostname,
    shopOrigin: documents.shopOriginFrom(env.BUSINESS_OS_PUBLIC_URL, 'https://' + hostname + '/'),
  })
}

const ruleFor = (rules, selector) => {
  const matching = rules.filter((candidate) => candidate.selector === selector)
  assert.strictEqual(matching.length, 1, 'expected exactly one rewrite rule for ' + selector + ', found ' + matching.length)
  return matching[0]
}

const run = (rules, selector, attributes) => {
  const element = stubElement(attributes)
  ruleFor(rules, selector).element(element)
  return element
}

// Every rule applied to every shape of its element; returns what was written.
function sweep(rules) {
  const written = []
  for (const rule of rules) {
    for (const sizes of ['', '192x192', '512x512', '64x64']) {
      const element = stubElement(sizes ? { sizes } : {})
      rule.element(element)
      written.push(...element.writes.map((value) => ({ selector: rule.selector, value: String(value) })))
    }
  }
  return written
}

const IDENTITY_SELECTORS = [
  'script#business-os-identity',
  '[data-business-os-identity="adminTitle"]',
  '[data-business-os-identity="shopName"]',
]

const documentRequest = (overrides) => ({
  method: 'GET',
  accept: 'text/html,application/xhtml+xml',
  contentType: 'text/html; charset=utf-8',
  ok: true,
  ...overrides,
})

// --- the gate: what gets rewritten, and what must never be touched ----------

check('a navigation to an app document is rewritten', () => {
  assert.strictEqual(documents.shouldRewriteAppDocument(documentRequest({})), true)
  assert.strictEqual(documents.shouldRewriteAppDocument(documentRequest({ accept: 'TEXT/HTML' })), true, 'Accept is compared case-insensitively')
})

check('the gate no longer looks at the host: the shop host is rewritten with the shop identity (Oct 22 2026)', () => {
  // Until Oct 22 2026 only the admin hosts were rewritten and the shop host was
  // served the static head, which named Leang Cosmetics. index.html now names
  // no client, so the shop host needs its own rewrite or it would install as
  // "Business OS". The gate is host-independent; the HOST picks the rules.
  const staffTitle = run(rulesFor(LEANG_ENV, LEANG_ADMIN_HOST), 'title', {}).innerContent
  for (const hostname of [LEANG_SHOP_HOST, 'www.leangbeauty.com', 'leangcosmetics.dpdns.org', 'admin-evil.example', 'notadmin.leangbeauty.com', '', null]) {
    const rules = rulesFor(LEANG_ENV, hostname)
    assert.ok(rules.length > 0, String(hostname) + ' must get rules')
    assert.strictEqual(run(rules, 'title', {}).innerContent, LEANG_SHOP.title, String(hostname) + ' must be served the shop identity')
    assert.notStrictEqual(run(rules, 'title', {}).innerContent, staffTitle, String(hostname) + ' must not be served the staff identity')
  }
})

check('nothing but a document response is rewritten', () => {
  // The Worker only ever sees these paths, but a JSON/asset response reaching
  // the handler (an error page, a redirect body, a 304) must stream through.
  assert.strictEqual(documents.shouldRewriteAppDocument(documentRequest({ contentType: 'application/json' })), false, 'JSON')
  assert.strictEqual(documents.shouldRewriteAppDocument(documentRequest({ contentType: 'image/png' })), false, 'an image')
  assert.strictEqual(documents.shouldRewriteAppDocument(documentRequest({ contentType: '' })), false, 'no content type')
  assert.strictEqual(documents.shouldRewriteAppDocument(documentRequest({ contentType: undefined })), false, 'no content type header at all')
  assert.strictEqual(documents.shouldRewriteAppDocument(documentRequest({ ok: false })), false, 'a 304 or an error')
  assert.strictEqual(documents.shouldRewriteAppDocument(documentRequest({ ok: 'true' })), false, 'ok must be the boolean true')
  assert.strictEqual(documents.shouldRewriteAppDocument(documentRequest({ method: 'HEAD' })), false, 'HEAD has no body')
  assert.strictEqual(documents.shouldRewriteAppDocument(documentRequest({ method: 'POST' })), false, 'POST is not a navigation')
  assert.strictEqual(documents.shouldRewriteAppDocument(documentRequest({ accept: 'application/json' })), false, 'an explicit JSON fetch')
})

check('the service worker precache fetch is still rewritten', () => {
  // precacheAppShell caches '/index.html' with a wildcard Accept. If that were
  // excluded, the OFFLINE shell would carry the neutral identity -- the same
  // bug, one layer down.
  assert.match(serviceWorker, /new Request\(url, \{ cache: 'reload' \}\)/, 'the precache still asks for the shell with a plain, wildcard-Accept Request')
  // This assertion used to read `cache.add(new Request(...))`, which pinned
  // the Sep 17 blank-page outage in place. `cache.add` FOLLOWS redirects and
  // stores the response with its `redirected` flag set; /index.html answers
  // 301 -> / (Workers Assets html_handling), and the spec turns a redirected
  // response served to a NAVIGATION into a network error. Every install
  // re-poisoned its own cache. The shell is now fetched and put explicitly,
  // so the response can be rejected before it is ever stored --
  // frontend/tests/swNavigationStrategy.test.ts proves that half.
  // Comment lines are stripped first: the source explains WHY cache.add is
  // forbidden, and a naive match would find that warning and pass on it.
  const workerCode = serviceWorker.split(String.fromCharCode(10))
    .filter((line) => !line.trim().startsWith('//')).join(String.fromCharCode(10))
  assert.doesNotMatch(workerCode, /cache\.add\(/, 'the shipped worker must never use cache.add: it stores redirected responses')
  assert.strictEqual(documents.shouldRewriteAppDocument(documentRequest({ accept: '*/*' })), true, 'wildcard Accept')
  assert.strictEqual(documents.shouldRewriteAppDocument(documentRequest({ accept: undefined })), true, 'no Accept header')
})

// --- which host is the admin host -------------------------------------------

// The API gate's rule (lib/publicHostGate.ts isStaffHostname): admin.*, local
// development and the deployment's configured staff host
// (ClientIdentity.staffHost, from BUSINESS_OS_ADMIN_URL, never the public host).
// Asked of the real rewrite: only the staff identity rewrites the manifest link.
const servesStaff = (env, hostname) => rulesFor(env, hostname).some((rule) => rule.selector === 'link[rel="manifest"]')

check('the staff document hosts are admin.*, local development and the configured staff host', () => {
  assert.strictEqual(resolveClientIdentity(LEANG_ENV).staffHost, LEANG_ADMIN_HOST, "Leang's configured staff host")
  for (const hostname of [LEANG_ADMIN_HOST, 'localhost', '127.0.0.1', '[::1]']) {
    assert.strictEqual(servesStaff(LEANG_ENV, hostname), true, hostname)
  }
  assert.strictEqual(gate.isStaffHostname('ADMIN.LeangBeauty.com', LEANG_ADMIN_HOST), true, 'the host comparison is case-insensitive')
  assert.strictEqual(gate.isStaffHostname('  admin.leangbeauty.com ', LEANG_ADMIN_HOST), true, 'surrounding whitespace is ignored')
  assert.strictEqual(resolveClientIdentity(BM_ENV).staffHost, BM_ADMIN_HOST)
  assert.strictEqual(servesStaff(BM_ENV, BM_ADMIN_HOST), true, 'BM Shop staff host: configured, not admin.*')
})

check('storefront hosts and look-alikes are not staff hosts', () => {
  for (const hostname of [LEANG_SHOP_HOST, 'www.leangbeauty.com', 'notadmin.leangbeauty.com', 'leangcosmetics.dpdns.org', '']) {
    assert.strictEqual(servesStaff(LEANG_ENV, hostname), false, String(hostname))
  }
  for (const hostname of [BM_SHOP_HOST, BM_ADMIN_HOST + '.evil.com', 'x' + BM_ADMIN_HOST, 'admin-bm.khshop.workers.dev', BM_ADMIN_HOST + '.']) {
    assert.strictEqual(servesStaff(BM_ENV, hostname), false, hostname)
  }
})

check('a configured staff host is staff only for its own deployment, and never the public host', () => {
  assert.strictEqual(servesStaff(LEANG_ENV, BM_ADMIN_HOST), false, "BM Shop's staff host is not Leang's")
  assert.strictEqual(servesStaff(NEUTRAL_ENV, BM_ADMIN_HOST), false, 'no configured staff host')
  for (const adminUrl of [undefined, null, '', 'not a url', '   ']) {
    assert.strictEqual(servesStaff({ ...BM_ENV, BUSINESS_OS_ADMIN_URL: adminUrl }, BM_ADMIN_HOST), false, JSON.stringify(adminUrl))
    assert.strictEqual(servesStaff({ ...BM_ENV, BUSINESS_OS_ADMIN_URL: adminUrl }, 'localhost'), true, 'local development stays the staff app')
  }
  const misconfigured = { ...BM_ENV, BUSINESS_OS_ADMIN_URL: BM_ENV.BUSINESS_OS_PUBLIC_URL }
  assert.strictEqual(resolveClientIdentity(misconfigured).staffHost, '', 'a staff URL equal to the public one is no staff host')
  assert.strictEqual(servesStaff(misconfigured, BM_SHOP_HOST), false, 'the shop never becomes the staff app')
})

// --- Leang parity: the admin host writes what it wrote before ----------------

const leangAdminRules = rulesFor(LEANG_ENV, LEANG_ADMIN_HOST)
const shopHeadAttributes = { href: LEANG_SHOP.icon512, content: LEANG_SHOP.title }

const ADMIN_ATTRIBUTE_CASES = [
  ['the Apple home-screen name becomes Leang Admin', 'meta[name="apple-mobile-web-app-title"]', { name: 'apple-mobile-web-app-title', content: 'Leang Cosmetics' }, { content: LEANG_ADMIN.appTitle }],
  ['the description becomes the staff one', 'meta[name="description"]', { name: 'description', content: LEANG_SHOP.description }, { content: LEANG_ADMIN.description }],
  ['the browser chrome takes the staff top-bar colour', 'meta[name="theme-color"]', { name: 'theme-color', content: '#ffffff' }, { content: LEANG_ADMIN.themeColor }],
  ['the viewport is the locked staff one', 'meta[name="viewport"]', { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }, { content: LEANG_ADMIN.viewport }],
  ['the installed app points at the ADMIN manifest', 'link[rel="manifest"]', { rel: 'manifest', href: '/portal-manifest.json' }, { href: LEANG_ADMIN.manifest }],
  ['the home-screen icon is the staff BO one', 'link[rel="apple-touch-icon"]', { rel: 'apple-touch-icon', sizes: '180x180', href: LEANG_SHOP.appleTouch }, { href: LEANG_ADMIN.appleTouch }],
  ['the unsized favicon is the admin one, typed as an icon', 'link[rel="icon"]', { rel: 'icon', type: 'image/x-icon', href: LEANG_SHOP.favicon }, { href: LEANG_ADMIN.favicon, type: 'image/x-icon' }],
  ['the 192 icon is the admin one, typed as a png', 'link[rel="icon"]', { rel: 'icon', type: 'image/png', sizes: '192x192', href: LEANG_SHOP.icon192 }, { href: LEANG_ADMIN.icon192, type: 'image/png' }],
  ['the 512 icon is the admin one, typed as a png', 'link[rel="icon"]', { rel: 'icon', type: 'image/png', sizes: '512x512', href: LEANG_SHOP.icon512 }, { href: LEANG_ADMIN.icon512, type: 'image/png' }],
  ['og:site_name names the staff app', 'meta[property="og:site_name"]', { property: 'og:site_name', content: 'Leang Cosmetics' }, { content: LEANG_ADMIN.title }],
  ['og:title names the staff app', 'meta[property="og:title"]', { property: 'og:title', content: 'Leang Cosmetics' }, { content: LEANG_ADMIN.title }],
  ['og:description is the staff description', 'meta[property="og:description"]', { property: 'og:description', content: LEANG_SHOP.description }, { content: LEANG_ADMIN.description }],
  ['og:image is the relative staff icon, not the shop\'s', 'meta[property="og:image"]', { property: 'og:image', content: LEANG_SHOP.ogImage }, { content: LEANG_ADMIN.ogImage }],
  ['og:url is the document itself, never the shop address', 'meta[property="og:url"]', { property: 'og:url', content: LEANG_SHOP.canonical }, { content: LEANG_ADMIN.selfUrl }],
  ['the canonical is the document itself, never the shop address', 'link[rel="canonical"]', { rel: 'canonical', href: LEANG_SHOP.canonical }, { href: LEANG_ADMIN.selfUrl }],
]

check('the admin title becomes Leang Cosmetics Admin', () => {
  const element = run(leangAdminRules, 'title', {})
  assert.strictEqual(element.innerContent, LEANG_ADMIN.title)
  assert.strictEqual(element.innerOptions, undefined, 'a title is written as text, never as HTML')
})

for (const [says, selector, from, expected] of ADMIN_ATTRIBUTE_CASES) {
  check('on ' + LEANG_ADMIN_HOST + ' ' + says, () => {
    const element = run(leangAdminRules, selector, from)
    for (const [name, value] of Object.entries(expected)) assert.strictEqual(element.attributes[name], value, name)
  })
}

check('an icon of an unknown size still lands on an admin icon, never a Leang one', () => {
  const element = run(leangAdminRules, 'link[rel="icon"]', { rel: 'icon', sizes: '64x64', href: LEANG_SHOP.icon192 })
  assert.doesNotMatch(element.attributes.href, /leang/i)
})

check('the admin loading shell names the staff app in one span and the shop in the other', () => {
  // Same two names the pre-change shell carried; CSS shows the one for the route.
  assert.strictEqual(run(leangAdminRules, '[data-business-os-identity="adminTitle"]', {}).innerContent, 'Leang Cosmetics Admin')
  assert.strictEqual(run(leangAdminRules, '[data-business-os-identity="shopName"]', {}).innerContent, 'Leang Cosmetics')
})

check('the rewritten head names the same app the staff manifest installs', () => {
  const manifest = staffManifest(resolveClientIdentity(LEANG_ENV))
  assert.strictEqual(run(leangAdminRules, 'title', {}).innerContent, manifest.name)
  assert.strictEqual(run(leangAdminRules, 'meta[name="apple-mobile-web-app-title"]', {}).attributes.content, manifest.short_name)
  assert.strictEqual(run(leangAdminRules, 'meta[name="description"]', {}).attributes.content, manifest.description)
  assert.strictEqual(run(leangAdminRules, 'meta[name="theme-color"]', {}).attributes.content, manifest.theme_color)
  assert.strictEqual(documents.ADMIN_DOCUMENT_THEME_COLOR, manifest.theme_color)
})

check('the raw admin HTML and the page bootstrap give the staff app the same icons, manifest and colour', () => {
  const bootstrap = indexHtml
  const brand = /icons: \{ favicon: '([^']+)', icon192: '([^']+)', icon512: '([^']+)', appleTouch: '([^']+)' \}/.exec(bootstrap)
  const themeColor = /themeColor: '(#fffdf8)'/.exec(bootstrap)
  const manifest = /manifest: '(\/manifest\.json)'/.exec(bootstrap)
  assert.ok(brand && themeColor && manifest, 'the admin branch of the bootstrap was read, not missed')
  const [, favicon, icon192, icon512, appleTouch] = brand
  assert.deepStrictEqual({ favicon, icon192, icon512, appleTouch }, {
    favicon: STAFF_ICONS.favicon, icon192: STAFF_ICONS.icon192, icon512: STAFF_ICONS.icon512, appleTouch: STAFF_ICONS.appleTouch,
  })
  for (const env of [LEANG_ENV, BM_ENV, NEUTRAL_ENV]) {
    const rules = rulesFor(env, 'localhost')
    for (const [sizes, bootstrapHref] of [['192x192', icon192], ['512x512', icon512], [undefined, favicon]]) {
      const element = run(rules, 'link[rel="icon"]', { rel: 'icon', ...(sizes ? { sizes } : {}), href: '/x.ico' })
      assert.strictEqual(element.attributes.href, bootstrapHref, (sizes || 'unsized') + ' favicon')
    }
    assert.strictEqual(run(rules, 'link[rel="apple-touch-icon"]', { href: '/x.png' }).attributes.href, appleTouch)
    assert.strictEqual(run(rules, 'meta[name="theme-color"]', {}).attributes.content, themeColor[1])
    assert.strictEqual(run(rules, 'link[rel="manifest"]', {}).attributes.href, manifest[1])
  }
})

check('the admin document never advertises the storefront address', () => {
  // The shop's canonical and og:url are ABSOLUTE and name its public address
  // (they are what folds an alias host into the primary one --
  // test-public-seo-pure.cjs). Left alone on the admin host, every admin page
  // would tell a crawler or a chat preview that its canonical address is the
  // shop's front page.
  for (const env of [LEANG_ENV, BM_ENV]) {
    const rules = rulesFor(env, new URL(env.BUSINESS_OS_ADMIN_URL).hostname)
    assert.strictEqual(run(rules, 'link[rel="canonical"]', { href: LEANG_SHOP.canonical }).attributes.href, '/')
    assert.strictEqual(run(rules, 'meta[property="og:url"]', { content: LEANG_SHOP.canonical }).attributes.content, '/')
  }
  // Relative on purpose: an absolute value would have to name ONE admin host.
  // It is only defensible because nothing indexes the admin app -- robots.txt
  // answers Disallow: / on every admin host, pinned in test-public-seo-pure.cjs.
})

check('no staff rule leaves a storefront value behind', () => {
  // The identity block and the two loading-shell spans are shared by both
  // hosts on purpose (they carry BOTH names; CSS shows the route's), so they
  // are the only rules allowed to mention the shop on the admin host.
  const shop = shopManifest(resolveClientIdentity(LEANG_ENV))
  const storefrontValues = new Set([shop.name, shop.short_name, shop.description, shop.theme_color])
  for (const rule of leangAdminRules) {
    if (IDENTITY_SELECTORS.includes(rule.selector)) continue
    const element = stubElement({ ...shopHeadAttributes, sizes: '192x192' })
    rule.element(element)
    assert.ok(element.writes.length > 0, rule.selector + ' wrote nothing at all')
    for (const value of element.writes) {
      assert.ok(!storefrontValues.has(value), rule.selector + ' still writes the storefront value ' + value)
      assert.doesNotMatch(value, /leang-cosmetics-|portal-manifest|leangbeauty\.com/i, rule.selector + ' still points at a storefront file or address')
    }
  }
})

check('every tag index.html publishes for the shop has an answer on both hosts', () => {
  // A new shop-branded head tag that nobody rewrites is the G4 bug class
  // returning: the raw HTML on one host keeps naming the other.
  const head = indexHtml.split('<script>')[0]
  const published = [
    ...[...head.matchAll(/<meta property="(og:[a-z_]+)"/g)].map((match) => 'meta[property="' + match[1] + '"]'),
    ...(head.includes('<link rel="canonical"') ? ['link[rel="canonical"]'] : []),
  ]
  assert.ok(published.length >= 6, 'the shop head was read, not missed')
  for (const [name, rules] of [['admin', leangAdminRules], ['shop', rulesFor(LEANG_ENV, LEANG_SHOP_HOST)]]) {
    const rewritten = new Set(rules.map((rule) => rule.selector))
    for (const selector of published) {
      // og:type is 'website' on both hosts: a value with no identity in it is
      // the one tag that needs no answer.
      if (selector === 'meta[property="og:type"]') continue
      assert.ok(rewritten.has(selector), selector + ' is published in the raw HTML and no ' + name + ' rule replaces it')
    }
  }
})

// What the in-page bootstrap swaps, as selectors: setHeadAttribute('<sel>', ...)
// and querySelector('<sel>'), plus the title.
function bootstrapSelectors() {
  const bootstrap = /\(function setInitialBusinessOsRoute\(\)[\s\S]*?\}\(\)\)/.exec(indexHtml)
  assert.ok(bootstrap, 'the index.html bootstrap was read')
  const swapped = new Set([...bootstrap[0].matchAll(/(?:querySelector(?:All)?|setHeadAttribute)\('([^']+)'/g)].map((match) => match[1]))
  assert.ok(swapped.has('link[rel="manifest"]') && swapped.has('meta[name="theme-color"]') && swapped.has('link[rel="apple-touch-icon"]'), 'the bootstrap selectors were read, not missed')
  if (/document\.title = /.test(bootstrap[0])) swapped.add('title')
  return swapped
}

check('every identity tag the page bootstrap swaps on the admin host is also rewritten', () => {
  // The raw HTML is what iOS may install from, so a tag the bootstrap swaps
  // but the Worker does not reaches an installed staff app with the wrong value.
  const rewritten = new Set(leangAdminRules.map((rule) => rule.selector))
  for (const selector of bootstrapSelectors()) {
    assert.ok(rewritten.has(selector), selector + ' is swapped in the page but never rewritten in the raw admin HTML')
  }
})

check('the shop host rewrites every swapped tag except the three its static head already carries', () => {
  // The static head is the storefront's: portal manifest, white theme colour
  // and the zoomable viewport. Rewriting those on the shop host would be noise;
  // forgetting any other swapped tag would install the shop as neutral.
  const rewritten = new Set(rulesFor(LEANG_ENV, LEANG_SHOP_HOST).map((rule) => rule.selector))
  const notRewritten = [...bootstrapSelectors()].filter((selector) => !rewritten.has(selector)).sort()
  assert.deepStrictEqual(notRewritten, ['link[rel="manifest"]', 'meta[name="theme-color"]', 'meta[name="viewport"]'])
})

check('the admin host serves the locked viewport the page sets, and the shop keeps the zoomable one', () => {
  const staticViewport = /<meta name="viewport" content="([^"]*)"/.exec(indexHtml)
  assert.ok(staticViewport, 'the static head carries a viewport')
  assert.doesNotMatch(staticViewport[1], /user-scalable=no|maximum-scale/, 'the storefront viewport stays zoomable')
  const pageSwap = /adminViewport\.setAttribute\('content', '([^']+)'\)/.exec(indexHtml)
  assert.ok(pageSwap, 'the page bootstrap locks the viewport on admin routes')
  const element = run(leangAdminRules, 'meta[name="viewport"]', { content: staticViewport[1] })
  assert.deepStrictEqual(element.writes, [pageSwap[1]], 'the rule writes exactly the value the page sets')
  assert.strictEqual(pageSwap[1], documents.ADMIN_DOCUMENT_VIEWPORT)
  assert.match(pageSwap[1], /maximum-scale=1/)
  assert.match(pageSwap[1], /user-scalable=no/)
  // Changed Oct 22 2026: the shop document IS rewritten now, so "not rewritten"
  // no longer proves the zoom. What proves it is that no shop rule touches the
  // viewport.
  for (const env of [LEANG_ENV, BM_ENV]) {
    const shopSelectors = rulesFor(env, new URL(env.BUSINESS_OS_PUBLIC_URL).hostname).map((rule) => rule.selector)
    assert.ok(!shopSelectors.includes('meta[name="viewport"]'), 'a shop rule would lock the storefront viewport')
  }
})

// --- Leang parity: the shop host writes what its static head carried --------

const leangShopRules = rulesFor(LEANG_ENV, LEANG_SHOP_HOST)

const SHOP_ATTRIBUTE_CASES = [
  ['the Apple home-screen name is Leang Cosmetics', 'meta[name="apple-mobile-web-app-title"]', { name: 'apple-mobile-web-app-title', content: 'Business OS' }, { content: LEANG_SHOP.appTitle }],
  ['the description is the shop one', 'meta[name="description"]', { name: 'description', content: 'Browse Business OS products and contact the store.' }, { content: LEANG_SHOP.description }],
  ['the home-screen icon is the Leang one', 'link[rel="apple-touch-icon"]', { rel: 'apple-touch-icon', sizes: '180x180', href: '/admin-apple-touch-icon-v1.png' }, { href: LEANG_SHOP.appleTouch }],
  ['the unsized favicon is the Leang one, typed as an icon', 'link[rel="icon"]', { rel: 'icon', type: 'image/x-icon', href: '/admin-favicon-v1.ico' }, { href: LEANG_SHOP.favicon, type: 'image/x-icon' }],
  ['the 192 icon is the Leang one, typed as a png', 'link[rel="icon"]', { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/icon-192.png' }, { href: LEANG_SHOP.icon192, type: 'image/png' }],
  ['the 512 icon is the Leang one, typed as a png', 'link[rel="icon"]', { rel: 'icon', type: 'image/png', sizes: '512x512', href: '/icon-512.png' }, { href: LEANG_SHOP.icon512, type: 'image/png' }],
  ['og:site_name is Leang Cosmetics', 'meta[property="og:site_name"]', { property: 'og:site_name', content: 'Business OS' }, { content: LEANG_SHOP.title }],
  ['og:title is Leang Cosmetics', 'meta[property="og:title"]', { property: 'og:title', content: 'Business OS' }, { content: LEANG_SHOP.title }],
  ['og:description is the shop description', 'meta[property="og:description"]', { property: 'og:description', content: '' }, { content: LEANG_SHOP.description }],
  ['og:image is the ABSOLUTE Leang icon on the public host', 'meta[property="og:image"]', { property: 'og:image', content: '/icon-512.png' }, { content: LEANG_SHOP.ogImage }],
  ['og:url is the ABSOLUTE shop front page', 'meta[property="og:url"]', { property: 'og:url', content: '/' }, { content: LEANG_SHOP.canonical }],
  ['the canonical is the ABSOLUTE shop front page', 'link[rel="canonical"]', { rel: 'canonical', href: '/' }, { href: LEANG_SHOP.canonical }],
]

check('the shop title is Leang Cosmetics', () => {
  const element = run(leangShopRules, 'title', {})
  assert.strictEqual(element.innerContent, LEANG_SHOP.title)
  assert.strictEqual(element.innerOptions, undefined, 'a title is written as text, never as HTML')
})

for (const [says, selector, from, expected] of SHOP_ATTRIBUTE_CASES) {
  check('on ' + LEANG_SHOP_HOST + ' ' + says, () => {
    const element = run(leangShopRules, selector, from)
    for (const [name, value] of Object.entries(expected)) assert.strictEqual(element.attributes[name], value, name)
  })
}

check('the shop loading shell names the same two things the pre-change shell did', () => {
  assert.strictEqual(run(leangShopRules, '[data-business-os-identity="adminTitle"]', {}).innerContent, 'Leang Cosmetics Admin')
  assert.strictEqual(run(leangShopRules, '[data-business-os-identity="shopName"]', {}).innerContent, 'Leang Cosmetics')
})

check('an alias host (www.) is folded into the configured public address, not into itself', () => {
  const rules = rulesFor(LEANG_ENV, 'www.leangbeauty.com')
  assert.strictEqual(run(rules, 'link[rel="canonical"]', {}).attributes.href, LEANG_SHOP.canonical)
  assert.strictEqual(run(rules, 'meta[property="og:url"]', {}).attributes.content, LEANG_SHOP.canonical)
  assert.strictEqual(run(rules, 'meta[property="og:image"]', {}).attributes.content, LEANG_SHOP.ogImage)
})

check('the shop origin is the configured public address, else the request\'s own', () => {
  assert.strictEqual(documents.shopOriginFrom('https://leangbeauty.com', 'https://www.leangbeauty.com/pos'), 'https://leangbeauty.com')
  assert.strictEqual(documents.shopOriginFrom('https://leangbeauty.com/some/path/', 'https://x.test/'), 'https://leangbeauty.com', 'only the origin of a configured address is used')
  for (const unset of [undefined, null, '', 'not a url']) {
    assert.strictEqual(documents.shopOriginFrom(unset, 'http://localhost:5173/x?y=1'), 'http://localhost:5173', JSON.stringify(unset))
  }
})

check('every icon the Leang identity names ships in frontend/public', () => {
  const identity = resolveClientIdentity(LEANG_ENV)
  assert.notDeepStrictEqual(identity.shopIcons, STAFF_ICONS, 'Leang has its own artwork')
  for (const href of [...Object.values(identity.shopIcons), ...Object.values(STAFF_ICONS)]) {
    assert.ok(fs.existsSync(path.join(REPO, 'frontend', 'public', href.slice(1))), href + ' is named by an identity but missing from frontend/public')
  }
})

// --- BM Shop isolation: the second client never reads as the first ----------

check('every value written for BM Shop, on either host, is free of Leang', () => {
  for (const hostname of [BM_ADMIN_HOST, BM_SHOP_HOST]) {
    const written = sweep(rulesFor(BM_ENV, hostname))
    assert.ok(written.length > 15, hostname + ': the rules were swept, not skipped')
    for (const { selector, value } of written) {
      assert.doesNotMatch(value, /leang/i, hostname + ' ' + selector + ' writes ' + value)
    }
  }
})

check('the leak sweep can see a leak: the same sweep over Leang\'s own deployment finds Leang', () => {
  // A sweep that reports every case the same way looks identical to a broken
  // instrument (positive control for the BM check above).
  for (const hostname of [LEANG_ADMIN_HOST, LEANG_SHOP_HOST]) {
    const leaks = sweep(rulesFor(LEANG_ENV, hostname)).filter(({ value }) => /leang/i.test(value))
    assert.ok(leaks.length >= 5, hostname + ': the sweep found only ' + leaks.length + ' Leang values')
  }
})

check('BM Shop gets its own name, its own address and the staff icons on its shop host', () => {
  const admin = rulesFor(BM_ENV, BM_ADMIN_HOST)
  assert.strictEqual(run(admin, 'title', {}).innerContent, 'BM Shop Admin')
  assert.strictEqual(run(admin, 'meta[name="apple-mobile-web-app-title"]', {}).attributes.content, 'BM Shop Admin', 'no short name configured: the full admin title')
  assert.strictEqual(run(admin, 'meta[name="description"]', {}).attributes.content, 'Till, stock and sales for BM Shop staff')

  const shop = rulesFor(BM_ENV, BM_SHOP_HOST)
  assert.strictEqual(run(shop, 'title', {}).innerContent, 'BM Shop')
  assert.strictEqual(run(shop, 'meta[name="description"]', {}).attributes.content, 'Browse BM Shop products and contact the store.')
  assert.strictEqual(run(shop, 'link[rel="canonical"]', {}).attributes.href, 'https://bm.khshop.workers.dev/')
  assert.strictEqual(run(shop, 'meta[property="og:url"]', {}).attributes.content, 'https://bm.khshop.workers.dev/')
  assert.strictEqual(run(shop, 'meta[property="og:image"]', {}).attributes.content, 'https://bm.khshop.workers.dev/icon-512.png', 'no icon prefix: the staff icon, absolute on its own host')
  assert.strictEqual(run(shop, 'link[rel="icon"]', { sizes: '192x192' }).attributes.href, STAFF_ICONS.icon192)
  assert.strictEqual(run(shop, 'link[rel="apple-touch-icon"]', {}).attributes.href, STAFF_ICONS.appleTouch)
})

check('the identity and both install manifests built for BM Shop are free of Leang', () => {
  const identity = resolveClientIdentity(BM_ENV)
  for (const [label, value] of [['identity', identity], ['identity json', clientIdentityJson(identity)], ['staff manifest', staffManifest(identity)], ['shop manifest', shopManifest(identity)]]) {
    assert.doesNotMatch(JSON.stringify(value), /leang/i, label)
  }
  assert.strictEqual(identity.membershipPrefix, 'BM-')
  assert.strictEqual(identity.organizationName, 'BM Shop')
})

// --- the identity block -----------------------------------------------------

const HOST_CASES = [
  ['Leang admin', LEANG_ENV, LEANG_ADMIN_HOST],
  ['Leang shop', LEANG_ENV, LEANG_SHOP_HOST],
  ['BM admin', BM_ENV, BM_ADMIN_HOST],
  ['BM shop', BM_ENV, BM_SHOP_HOST],
  ['neutral admin (local development)', NEUTRAL_ENV, 'localhost'],
  ['neutral shop', NEUTRAL_ENV, 'shop.example'],
]

check('the identity block parses back to exactly the resolved identity, on every host', () => {
  for (const [label, env, hostname] of HOST_CASES) {
    const element = run(rulesFor(env, hostname), 'script#business-os-identity', {})
    assert.deepStrictEqual(JSON.parse(element.innerContent), resolveClientIdentity(env), label)
    assert.strictEqual(element.innerContent, clientIdentityJson(resolveClientIdentity(env)), label + ': the same bytes the build writes')
    assert.deepStrictEqual(element.innerOptions, { html: true }, label + ': raw content, or the JSON would be entity-escaped')
    assert.ok(!element.innerContent.includes('<'), label + ': no raw < in the block')
  }
})

check('a hostile shop name cannot close the identity block or inject markup', () => {
  const env = { ...NEUTRAL_ENV, BUSINESS_OS_SHOP_NAME: 'Bad</script><img src=x onerror=alert(1)><!--', BUSINESS_OS_SHOP_ALIAS: 'A<B' }
  const rules = rulesFor(env, 'shop.example')
  const block = run(rules, 'script#business-os-identity', {}).innerContent
  assert.ok(!block.includes('<'), 'every < is escaped')
  assert.ok(block.includes('\\u003c/script>'), 'the closing tag is neutralised, not removed')
  assert.strictEqual(JSON.parse(block).shopName, env.BUSINESS_OS_SHOP_NAME, 'the name survives the round trip untouched')
  assert.strictEqual(JSON.parse(block).shopNames, env.BUSINESS_OS_SHOP_NAME + '/A<B')
  // Everywhere else the name is TEXT: HTMLRewriter escapes it unless html:true.
  for (const rule of rules) {
    const element = stubElement()
    rule.element(element)
    if (rule.selector === 'script#business-os-identity') continue
    assert.strictEqual(element.innerOptions, undefined, rule.selector + ' must write text, not HTML')
  }
})

check('only the identity block is ever written as HTML', () => {
  for (const [label, env, hostname] of HOST_CASES) {
    const asHtml = rulesFor(env, hostname).filter((rule) => {
      const element = stubElement({ sizes: '192x192' })
      rule.element(element)
      return element.innerOptions !== undefined
    }).map((rule) => rule.selector)
    assert.deepStrictEqual(asHtml, ['script#business-os-identity'], label)
  }
})

// --- the install manifests --------------------------------------------------

check('the Worker serves exactly the two install manifests, each built from the identity', () => {
  assert.deepStrictEqual(Object.keys(MANIFEST_ROUTES), ['/manifest.json', '/portal-manifest.json'])
  assert.strictEqual(MANIFEST_ROUTES['/manifest.json'], staffManifest)
  assert.strictEqual(MANIFEST_ROUTES['/portal-manifest.json'], shopManifest)
})

check('with Leang\'s vars the generated manifests are the pre-change files', () => {
  const identity = resolveClientIdentity(LEANG_ENV)
  assert.deepStrictEqual(staffManifest(identity), LEANG_STAFF_MANIFEST)
  assert.deepStrictEqual(shopManifest(identity), LEANG_SHOP_MANIFEST)
})

check('the manifest files in frontend/public are the neutral manifests', () => {
  assert.deepStrictEqual(staffManifestFile, staffManifest(NEUTRAL_CLIENT_IDENTITY))
  assert.deepStrictEqual(shopManifestFile, shopManifest(NEUTRAL_CLIENT_IDENTITY))
  assert.doesNotMatch(JSON.stringify([staffManifestFile, shopManifestFile]), /leang/i)
})

// --- frontend/index.html: the neutral document -------------------------------

// Comments name the tags they describe; only real elements count.
const indexElements = indexHtml.replace(/<!--[\s\S]*?-->/g, '')

check('index.html names no client at all', () => {
  assert.doesNotMatch(indexHtml, /leang/i, 'index.html carries a Leang literal; the Worker writes it from wrangler [vars]')
})

check('index.html carries the neutral identity block, byte for byte', () => {
  const blocks = [...indexElements.matchAll(/<script id="business-os-identity" type="application\/json">([^]*?)<\/script>/g)]
  assert.strictEqual(blocks.length, 1, 'exactly one identity block')
  assert.strictEqual(blocks[0][1], clientIdentityJson(NEUTRAL_CLIENT_IDENTITY))
})

check('index.html\'s static head is the neutral identity', () => {
  const neutral = NEUTRAL_CLIENT_IDENTITY
  assert.ok(indexElements.includes('<title>' + neutral.shopName + '</title>'), 'title')
  assert.ok(indexElements.includes('<meta name="description" content="' + neutral.shopDescription + '" />'), 'description')
  assert.ok(indexElements.includes('<meta name="apple-mobile-web-app-title" content="' + neutral.shopName + '" />'), 'apple title')
  assert.ok(indexElements.includes('<meta property="og:site_name" content="' + neutral.shopName + '" />'), 'og:site_name')
  assert.ok(indexElements.includes('<link rel="canonical" href="/" />'), 'canonical is relative until the Worker writes the public address')
  assert.ok(indexElements.includes('<meta property="og:url" content="/" />'), 'og:url')
  assert.ok(indexElements.includes('<meta property="og:image" content="' + neutral.shopIcons.icon512 + '" />'), 'og:image')
})

// One regexp per selector SHAPE the rules use. A shape this does not know
// fails loudly, so a new kind of rule cannot slip through unverified.
function elementPattern(selector) {
  let match
  if (selector === 'title') return /<title>[^<]*<\/title>/
  if ((match = /^meta\[(name|property)="([^"]+)"\]$/.exec(selector))) return new RegExp('<meta ' + match[1] + '="' + match[2] + '"')
  if ((match = /^link\[rel="([^"]+)"\]$/.exec(selector))) return new RegExp('<link rel="' + match[1] + '"')
  if (selector === 'script#business-os-identity') return /<script id="business-os-identity" type="application\/json">/
  if ((match = /^\[data-business-os-identity="([^"]+)"\]$/.exec(selector))) return new RegExp('data-business-os-identity="' + match[1] + '"')
  throw new Error('no element pattern for selector shape ' + selector)
}

check('every element a rule targets exists in index.html, for every deployment and host', () => {
  const targeted = new Set()
  for (const [, env, hostname] of HOST_CASES) for (const rule of rulesFor(env, hostname)) targeted.add(rule.selector)
  for (const selector of IDENTITY_SELECTORS) assert.ok(targeted.has(selector), selector + ' is rewritten')
  assert.ok(targeted.size >= 17, 'the rule set was read, not missed')
  for (const selector of targeted) {
    assert.match(indexElements, elementPattern(selector), selector + ' is rewritten by the Worker but absent from index.html, so HTMLRewriter would find nothing to write')
  }
})

check('index.html has one icon link for each size the rules key on', () => {
  const links = [...indexElements.matchAll(/<link rel="icon"([^>]*)>/g)].map((match) => (/sizes="([^"]+)"/.exec(match[1]) || [])[1] || '')
  assert.deepStrictEqual(links.sort(), ['', '192x192', '512x512'])
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

// --- the wiring the rewrite depends on, in BOTH configs ---------------------

const CONFIGS = ['wrangler.toml', 'wrangler.free.toml']
const MANIFEST_PATHS = Object.keys(MANIFEST_ROUTES)

check('every admin route in each wrangler config is the host of that config\'s BUSINESS_OS_ADMIN_URL', () => {
  for (const file of CONFIGS) {
    const vars = wranglerVars(file)
    const adminHost = new URL(vars.BUSINESS_OS_ADMIN_URL).hostname
    const shopHost = new URL(vars.BUSINESS_OS_PUBLIC_URL).hostname
    const hosts = wranglerRoutePatterns(file).map((pattern) => pattern.split('/')[0].toLowerCase())
    assert.ok(hosts.length >= 2, file + ': the route table was read, not missed')
    const adminRoutes = hosts.filter((host) => host.startsWith('admin.'))
    assert.ok(adminRoutes.length >= 1, file + ': an admin route was read')
    for (const host of adminRoutes) {
      assert.strictEqual(host, adminHost, file + ': ' + host + ' is deployed as an admin host but BUSINESS_OS_ADMIN_URL names ' + adminHost + ', so it would install as the storefront')
      assert.ok(servesStaff(vars, host), file + ': ' + host)
    }
    assert.ok(hosts.includes(shopHost), file + ': the shop host ' + shopHost + ' is routed')
    assert.ok(!servesStaff(vars, shopHost), file + ': the shop host must not be an admin host')
  }
})

check('every document route and both manifests are routed to the Worker, in both configs', () => {
  for (const file of CONFIGS) {
    const routed = new Set(wranglerStringArray('run_worker_first', file))
    for (const route of [...routes.APP_DOCUMENT_ROUTES, ...MANIFEST_PATHS]) {
      assert.ok(routed.has(route), file + ' run_worker_first is missing ' + route + ', so the asset layer would answer it with one client\'s file')
    }
  }
})

check('no route is sent to the Worker without a handler, in both configs', () => {
  // /robots.txt and /sitemap.xml: src/index.ts's public SEO handlers
  // (test-public-seo-pure.cjs).
  // /assets/*: src/index.ts's build-asset handler, which turns a chunk the
  // deploy deleted into an honest 404 instead of the SPA document (the Sep 17
  // blank-page outage; test-stale-build-asset-404-pure.cjs).
  // The two manifests: the Worker builds them from the identity.
  const handled = new Set([...routes.APP_DOCUMENT_ROUTES, ...MANIFEST_PATHS, '/api/*', '/uploads/*', '/health', '/ws', '/robots.txt', '/sitemap.xml', '/assets/*'])
  for (const file of CONFIGS) {
    for (const route of wranglerStringArray('run_worker_first', file)) {
      assert.ok(handled.has(route), file + ': ' + route + ' reaches the Worker but nothing handles it; that 404s a whole page')
    }
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
  const covered = new Set(routes.ADMIN_DOCUMENT_SEGMENTS)
  for (const segment of [...frontendSegments, ...authSegments]) {
    assert.ok(covered.has(segment), 'admin route /' + segment + ' serves index.html but is not rewritten on the admin host')
  }
})

check('the document and manifest cache rules still match _headers', () => {
  // The Worker now produces '/' and '/index.html' AND both manifests, so its
  // Cache-Control must be the one frontend/public/_headers declares for them --
  // an old client meeting a new deploy revalidates its navigation because of
  // this rule.
  const constant = /APP_DOCUMENT_CACHE_CONTROL = '([^']+)'/.exec(workerIndex)
  assert.ok(constant, 'the Worker declares its document Cache-Control')
  for (const route of ['/index.html', '/', ...MANIFEST_PATHS]) {
    const rule = new RegExp('\\n' + route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\n\\s+Cache-Control: ([^\\n]+)').exec(headersFile)
    assert.ok(rule, '_headers still declares a cache rule for ' + route)
    assert.strictEqual(rule[1].trim(), constant[1], route + ': the Worker must serve it with the same Cache-Control as _headers')
  }
  assert.ok(constant[1].includes('must-revalidate'), 'the document must still revalidate')
  const manifestHandler = workerIndex.slice(workerIndex.indexOf('for (const [route, manifest] of Object.entries(MANIFEST_ROUTES))'))
  assert.match(manifestHandler.slice(0, 600), /'Cache-Control': APP_DOCUMENT_CACHE_CONTROL/, 'the manifest handler uses the same constant')
})

process.stdout.write('\nadmin-host document rewrite: ' + checks + ' checks passed\n')
