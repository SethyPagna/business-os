import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import * as pathRouting from '../src/app/pathRouting.ts'

// Two brands share one index.html, and mixing them up is a silent, purely
// visual regression that no other test would catch:
//
//   Leang Cosmetics Admin -> the staff app (admin.leangbeauty.com), BO icon
//   Leang Cosmetics       -> the PUBLIC storefront (leangbeauty.com),
//                            including its favicon and its "Add to Home
//                            Screen" PWA icon
//
// The split is by AUDIENCE and is FIXED, not per-merchant customizable: the
// favicon/PWA-icon customization in Settings + the portal editor was removed
// (11.14-16), so both brands' icons are static assets now.
//   - The raw HTML is storefront-first because iOS may snapshot metadata
//     before JavaScript executes.
//   - The admin hostname synchronously swaps to /manifest.json + the staff
//     icons; the storefront keeps the static Leang assets. This used to build
//     the manifest at runtime as a
//     blob: URL, which Chrome refuses to treat as installable, so the
//     storefront lost its Install prompt entirely (16.1). Static files ARE
//     installable AND keep the Leang branding, so both hold at once.
// These assertions pin the split so a future edit cannot quietly ship
// staff branding to customers (or a blob: manifest that kills Install).
//
// The icon files' pixels and bytes are tests/pwaIcons.test.ts; this test
// covers the WIRING.

const read = (relPath: string): string =>
  fs.readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8')

type IconLedger = { immutable: Record<string, { brand: 'staff' | 'shop'; role: string }>; mutable: Record<string, string> }
const ledger = JSON.parse(read('./fixtures/pwa-icon-ledger.json')) as IconLedger
const SHOP_ICON_BY_SIZE: Record<string, string> = {
  '': '/leang-cosmetics-favicon-v2.ico',
  '192x192': '/leang-cosmetics-icon-192-v2.png',
  '512x512': '/leang-cosmetics-icon-512-v2.png',
}
const STAFF_ICON_BY_SIZE: Record<string, string> = {
  '': '/admin-favicon-v1.ico',
  '192x192': '/icon-192.png',
  '512x512': '/icon-512.png',
}
const SHOP_APPLE_TOUCH_ICON = '/leang-cosmetics-apple-touch-icon-v2.png'
const STAFF_APPLE_TOUCH_ICON = '/admin-apple-touch-icon-v1.png'

const indexHtml = read('../index.html')
const manifest = JSON.parse(read('../public/manifest.json')) as {
  name: string
  icons: Array<{ src: string; sizes: string; purpose: string }>
}
const publicCatalog = read('../src/components/catalog/PublicCatalogPage.tsx')
const login = read('../src/components/auth/Login.tsx')

// --- raw HTML is public-first; the admin host's bootstrap swaps to staff ----

assert.match(indexHtml, /rel="manifest" href="\/portal-manifest\.json"/, 'raw HTML must identify the storefront before iOS snapshots install metadata')
const staticHead = indexHtml.slice(0, indexHtml.indexOf('<script>'))
const staticIconLinks = [...staticHead.matchAll(/<link rel="icon"([^>]*)>/g)].map(([, attributes]) => ({
  sizes: /sizes="([^"]+)"/.exec(attributes)?.[1] ?? '',
  href: /href="([^"]+)"/.exec(attributes)?.[1],
  type: /type="([^"]+)"/.exec(attributes)?.[1],
}))
assert.deepEqual(Object.fromEntries(staticIconLinks.map((link) => [link.sizes, link.href])), SHOP_ICON_BY_SIZE, 'raw HTML names each size its own shop icon')
assert.equal(staticIconLinks.find((link) => link.sizes === '')?.type, 'image/x-icon', 'the unsized raw favicon link is the ICO')
assert.ok(staticHead.includes(`<link rel="apple-touch-icon" sizes="180x180" href="${SHOP_APPLE_TOUCH_ICON}" />`), 'raw HTML should use the shop Apple touch icon')
assert.match(indexHtml, /adminManifest\.setAttribute\('href', '\/manifest\.json'\)/, 'admin bootstrap should restore the staff manifest')
assert.ok(indexHtml.includes(`adminAppleIcon.setAttribute('href', '${STAFF_APPLE_TOUCH_ICON}')`), 'admin bootstrap should restore the staff Apple icon')
assert.match(indexHtml, /hostname\.indexOf\('admin\.'\) === 0/, 'the bootstrap should distinguish the admin hostname')
assert.match(indexHtml, /pathname === '\/'\s*\? !adminHostname/, 'the public production root must not be classified as admin')

assert.equal(manifest.name, 'Leang Cosmetics Admin', 'manifest.json remains the staff app manifest')
assert.deepEqual(
  manifest.icons.map((icon) => `${icon.src} ${icon.sizes} ${icon.purpose}`).sort(),
  [
    '/icon-192-maskable-v2.png 192x192 maskable',
    '/icon-192.png 192x192 any',
    '/icon-512-maskable-v2.png 512x512 maskable',
    '/icon-512.png 512x512 any',
  ],
  'admin manifest should offer both any and maskable at 192 and 512, all staff icons',
)
assert.ok(
  !manifest.icons.some((icon) => /leang/i.test(icon.src)),
  'the admin manifest must never reference storefront icons',
)

// --- public storefront uses STATIC Leang Cosmetics branding ------------

// The live customer site (PublicCatalogPage) points the tab icon + manifest
// at fixed Leang assets, NOT at anything derived from business config.
assert.match(
  publicCatalog,
  /const STOREFRONT_ICON = '\/leang-cosmetics-icon-512-v2\.png'/,
  'the live storefront should use the static Leang tab icon, not a staff icon or a merchant upload',
)
assert.match(
  publicCatalog,
  /const STOREFRONT_MANIFEST = '\/portal-manifest\.json'/,
  'the live storefront should point at the static Leang portal manifest',
)
assert.match(
  publicCatalog,
  /const STOREFRONT_APPLE_TOUCH_ICON = '\/leang-cosmetics-apple-touch-icon-v2\.png'/,
  'the live storefront must replace the Apple touch icon used by Add to Home Screen',
)
assert.ok(
  indexHtml.includes(`appleIcon.setAttribute('href', '${SHOP_APPLE_TOUCH_ICON}')`),
  'the parser-time bootstrap must select the storefront Apple icon before React loads',
)
// The static portal manifest is the storefront's own brand, and must stay a
// real file (installable) -- the whole point of 16.1.
const portalManifest = JSON.parse(read('../public/portal-manifest.json')) as {
  name: string
  icons: Array<{ src: string; sizes: string; purpose: string }>
}
assert.equal(portalManifest.name, 'Leang Cosmetics', 'the static portal manifest is the storefront brand, not the staff app')
assert.deepEqual(
  portalManifest.icons.map((icon) => `${icon.src} ${icon.sizes} ${icon.purpose}`).sort(),
  [
    '/leang-cosmetics-icon-192-maskable-v2.png 192x192 maskable',
    '/leang-cosmetics-icon-192-v2.png 192x192 any',
    '/leang-cosmetics-icon-512-maskable-v2.png 512x512 maskable',
    '/leang-cosmetics-icon-512-v2.png 512x512 any',
  ],
  'the shop manifest offers the owner-logo icons, any and maskable, at 192 and 512',
)

// The storefront must NOT reintroduce the runtime blob: manifest (Chrome
// won't install it -- the 16.1 bug) or per-merchant favicon/manifest building.
assert.doesNotMatch(
  publicCatalog,
  /URL\.createObjectURL|buildPortalManifest|createSquareIconDataUrl|createCircularFaviconDataUrl/,
  'the storefront must not build a runtime blob manifest or per-merchant icons -- those are removed (16.1 / 11.14-16)',
)

// Admin sign-in defaults to the staff BO logo rather than the storefront one
// -- split by AUDIENCE (staff sign into the product; customers see the shop).
// See Login.tsx's own comment, which records this as reversing an earlier
// decision at explicit request.
assert.match(
  login,
  /const DEFAULT_LOGIN_LOGO_SRC = '\/icon-512\.png'/,
  'the admin sign-in page should default to the staff BO logo, not the storefront one',
)
assert.doesNotMatch(
  login,
  /const DEFAULT_LOGIN_LOGO_SRC = '\/leang-cosmetics/,
  'admin sign-in must not default to storefront branding',
)

// The storefront must override BOTH the favicon and the manifest link --
// overriding only the favicon leaves staff branding on the customer's home
// screen after "Add to Home Screen". It now does this via the static
// files asserted above (STOREFRONT_ICON / STOREFRONT_MANIFEST), so pin that
// it still touches the manifest link element at all.
assert.match(
  publicCatalog,
  /link\[rel="manifest"\]/,
  'the public storefront must replace the manifest link, not just the favicon',
)

// The storefront also renders at unknown paths on admin.*, where its identity
// swap would re-advertise the shop app inside the staff origin.
const brandEffect = publicCatalog.slice(
  publicCatalog.lastIndexOf('useEffect(() => {', publicCatalog.indexOf('link[rel="manifest"]')),
  publicCatalog.indexOf('}, [displayConfig.businessName, displayConfig.title])'),
)
assert.ok(brandEffect.includes('link[rel="manifest"]'), 'the storefront brand effect was read, not missed')
const adminHostGuard = brandEffect.indexOf('if (isAdminHostname()) return')
assert.ok(adminHostGuard > 0, 'the storefront identity swap must stop on an admin hostname')
for (const swapped of ['link[rel="icon"]', 'link[rel="manifest"]', 'link[rel="apple-touch-icon"]', 'meta[name="apple-mobile-web-app-title"]']) {
  assert.ok(brandEffect.indexOf(swapped) > adminHostGuard, `${swapped} is swapped before the admin-host guard`)
}
assert.match(publicCatalog, /import \{ isAdminHostname \} from '\.\.\/\.\.\/app\/pathRouting\.ts'/, 'the guard uses the one shared host predicate')
assert.match(publicCatalog, /const STOREFRONT_HOME_SCREEN_NAME = 'Leang'/, 'the iPhone home-screen label is the owner\'s short name')
assert.match(brandEffect, /appleTitle\.setAttribute\('content', STOREFRONT_HOME_SCREEN_NAME\)/)
assert.match(publicCatalog, /const STOREFRONT_NAME = 'Leang Cosmetics'/)
assert.match(brandEffect, /displayConfig\.title \|\| STOREFRONT_NAME\)/, 'the tab title falls back to the storefront name')
assert.doesNotMatch(brandEffect, /Leang Beauty/, 'the retired storefront name is gone from the storefront identity')

const workerIdentity = read('../../cloudflare/src/lib/adminDocumentIdentity.ts')
const iconPath = /\/[\w.-]+\.(?:png|ico)/g
const wiredIcons = new Map<string, string>([
  ...manifest.icons.map((icon) => [icon.src, 'manifest.json'] as [string, string]),
  ...portalManifest.icons.map((icon) => [icon.src, 'portal-manifest.json'] as [string, string]),
  ...[...indexHtml.matchAll(iconPath)].map(([src]) => [src, 'index.html'] as [string, string]),
  ...[...workerIdentity.matchAll(iconPath)].map(([src]) => [src, 'adminDocumentIdentity.ts'] as [string, string]),
  ...[...publicCatalog.matchAll(/const STOREFRONT_[A-Z_]*ICON = '([^']+)'/g)].map(([, src]) => [src, 'PublicCatalogPage.tsx'] as [string, string]),
])
assert.ok(wiredIcons.size >= 10, 'the wired icon names were read, not missed')
const staleWiring = [...wiredIcons]
  .filter(([src]) => {
    const file = src.replace(/^\//, '')
    const entry = ledger.immutable[file]
    return !entry || entry.role === 'retired' || !fs.existsSync(fileURLToPath(new URL(`../public/${file}`, import.meta.url)))
  })
  .map(([src, owner]) => `${owner}: ${src}`)
assert.deepEqual(staleWiring, [], 'every wired icon is a current file in the icon ledger: not retired art, not a conventional probe path whose bytes may change')

// Execute the real parser-time bootstrap against small DOM doubles.
const bootstrapMatch = indexHtml.match(/<script>\s*(\(function setInitialBusinessOsRoute\(\)[\s\S]*?\}\(\)\))\s*<\/script>/)
assert.ok(bootstrapMatch, 'the route-aware metadata bootstrap should stay inline in <head>')

function runBootstrap(hostname: string, pathname: string) {
  const attributes = new Map<string, string>()
  const elements = new Map<string, { attrs: Map<string, string>; setAttribute(name: string, value: string): void }>()
  const makeElement = (key: string, initial: Record<string, string> = {}) => {
    const element = {
      attrs: new Map<string, string>(Object.entries(initial)),
      getAttribute(name: string) { return this.attrs.get(name) || null },
      setAttribute(name: string, value: string) { this.attrs.set(name, value) },
    }
    elements.set(key, element)
    return element
  }
  const favicon = makeElement('favicon')
  const png192 = makeElement('png192', { sizes: '192x192' })
  const png512 = makeElement('png512', { sizes: '512x512' })
  const selectors: Record<string, ReturnType<typeof makeElement>> = {
    'meta[name="description"]': makeElement('description'),
    'meta[name="apple-mobile-web-app-title"]': makeElement('apple-title'),
    'meta[name="theme-color"]': makeElement('theme-color'),
    'link[rel="manifest"]': makeElement('manifest'),
    'link[rel="apple-touch-icon"]': makeElement('apple-icon'),
  }
  // createElement/head exist because the admin branch also appends the
  // machine-translation opt-out meta (Sep 22 2026, Chrome Translate vs React
  // removeChild -- see tests/posCommittedCloseDurability.test.ts, which owns
  // the assertions about it). Here they only need to keep the double running.
  const appendedToHead = makeElement('appended-head-meta')
  const document = {
    title: '',
    documentElement: { setAttribute(name: string, value: string) { attributes.set(name, value) } },
    createElement(_tagName: string) { return appendedToHead },
    head: { appendChild(node: unknown) { return node } },
    querySelector(selector: string) { return selectors[selector] || null },
    querySelectorAll(selector: string) { return selector === 'link[rel="icon"]' ? [favicon, png192, png512] : [] },
  }
  vm.runInNewContext(bootstrapMatch![1], { window: { location: { hostname, pathname } }, document })
  return { attributes, elements, document, favicon, png192, png512 }
}

const SHOP_IDENTITY = {
  title: 'Leang Cosmetics',
  appTitle: 'Leang',
  manifest: '/portal-manifest.json',
  themeColor: '#ffffff',
  appleIcon: SHOP_APPLE_TOUCH_ICON,
  favicon: `${SHOP_ICON_BY_SIZE['']} image/x-icon`,
  icon192: `${SHOP_ICON_BY_SIZE['192x192']} image/png`,
  icon512: `${SHOP_ICON_BY_SIZE['512x512']} image/png`,
}
const STAFF_IDENTITY = {
  title: 'Leang Cosmetics Admin',
  appTitle: 'Leang Admin',
  manifest: '/manifest.json',
  themeColor: '#fffdf8',
  appleIcon: STAFF_APPLE_TOUCH_ICON,
  favicon: `${STAFF_ICON_BY_SIZE['']} image/x-icon`,
  icon192: `${STAFF_ICON_BY_SIZE['192x192']} image/png`,
  icon512: `${STAFF_ICON_BY_SIZE['512x512']} image/png`,
}

// What installs follows the HOST; which app renders still follows the route
// (the translate opt-out that goes with it is pinned in
// tests/posCommittedCloseDurability.test.ts).
const identityCases: Array<[hostname: string, pathname: string, identity: typeof SHOP_IDENTITY, route: 'public' | 'admin']> = [
  ['leangbeauty.com', '/', SHOP_IDENTITY, 'public'],
  ['leangbeauty.com', '/some-shop', SHOP_IDENTITY, 'public'],
  ['leangbeauty.com', '/login', SHOP_IDENTITY, 'admin'],
  ['leangbeauty.com', '/pos', SHOP_IDENTITY, 'admin'],
  ['admin.leangbeauty.com', '/', STAFF_IDENTITY, 'admin'],
  ['admin.leangbeauty.com', '/pos', STAFF_IDENTITY, 'admin'],
  ['admin.leangbeauty.com', '/some-unknown-path', STAFF_IDENTITY, 'public'],
  ['localhost', '/', STAFF_IDENTITY, 'admin'],
  ['127.0.0.1', '/login', STAFF_IDENTITY, 'admin'],
  ['[::1]', '/', STAFF_IDENTITY, 'admin'],
]
for (const [hostname, pathname, identity, route] of identityCases) {
  const run = runBootstrap(hostname, pathname)
  assert.equal(run.attributes.get('data-business-os-initial-route'), route, `${hostname}${pathname} renders the ${route} app`)
  assert.deepEqual(
    {
      title: run.document.title,
      appTitle: run.elements.get('apple-title')?.attrs.get('content'),
      manifest: run.elements.get('manifest')?.attrs.get('href'),
      themeColor: run.elements.get('theme-color')?.attrs.get('content'),
      appleIcon: run.elements.get('apple-icon')?.attrs.get('href'),
      favicon: `${run.favicon.attrs.get('href')} ${run.favicon.attrs.get('type')}`,
      icon192: `${run.png192.attrs.get('href')} ${run.png192.attrs.get('type')}`,
      icon512: `${run.png512.attrs.get('href')} ${run.png512.attrs.get('type')}`,
    },
    identity,
    `${hostname}${pathname} installs as ${identity.title}`,
  )
}

// leangcosmetics.dpdns.org was retired completely (Sep 26 2026): no route
// serves this document there, so the bootstrap's alias-redirect map must not
// carry it (or any other leangcosmetics.* host), and the live alias must
// still fold into the canonical host.
const redirectLiteral = bootstrapMatch![1].match(/var redirectHosts = (\{[\s\S]*?\})/)
assert.ok(redirectLiteral, 'the alias-redirect map was read, not missed')
const redirectHosts = vm.runInNewContext('(' + redirectLiteral[1] + ')') as Record<string, string>
assert.deepEqual({ ...redirectHosts }, { 'www.leangbeauty.com': 'leangbeauty.com' })
assert.doesNotMatch(bootstrapMatch![1], /dpdns|leangcosmetics\.com/i, 'the retired domain is gone from the bootstrap')

for (const appleIcon of [SHOP_APPLE_TOUCH_ICON, STAFF_APPLE_TOUCH_ICON]) {
  const appleIconBytes = fs.readFileSync(fileURLToPath(new URL(`../public${appleIcon}`, import.meta.url)))
  assert.equal(appleIconBytes.readUInt32BE(16), 180, `${appleIcon}: an iPhone icon is exactly 180px wide`)
  assert.equal(appleIconBytes.readUInt32BE(20), 180, `${appleIcon}: an iPhone icon is exactly 180px high`)
}

type ServiceWorkerHostRules = {
  isAdminHost?: (hostname: string) => boolean
  appShellUrlsForHost?: (hostname: string) => string[]
  isCacheableStaticPath?: (pathname: string) => boolean
}
const serviceWorker: ServiceWorkerHostRules & { self: unknown; URL: typeof URL } = {
  self: { addEventListener() {}, location: { origin: 'https://leangbeauty.com', hostname: 'leangbeauty.com' }, registration: {} },
  URL,
}
vm.runInNewContext(read('../public/sw.js'), serviceWorker)
const { isAdminHost, appShellUrlsForHost, isCacheableStaticPath } = serviceWorker
assert.ok(appShellUrlsForHost, 'sw.js picks its precache list by host (appShellUrlsForHost)')
assert.ok(isAdminHost, 'sw.js has the one host predicate (isAdminHost)')
assert.ok(isCacheableStaticPath, 'sw.js still decides which static paths it keeps')

const HOST_MATRIX = ['admin.leangbeauty.com', 'leangbeauty.com', 'www.leangbeauty.com', 'notadmin.leangbeauty.com', 'localhost', '127.0.0.1', '[::1]', 'admin.example.test']
for (const hostname of HOST_MATRIX) {
  const bootstrapAdmin = runBootstrap(hostname, '/some-unknown-path').elements.get('manifest')?.attrs.get('href') === '/manifest.json'
  const previousWindow = (globalThis as { window?: unknown }).window
  ;(globalThis as { window?: unknown }).window = { location: { hostname } }
  try {
    assert.equal(pathRouting.isAdminHostname(), bootstrapAdmin, `${hostname}: pathRouting and the bootstrap disagree`)
  } finally {
    ;(globalThis as { window?: unknown }).window = previousWindow
  }
  assert.equal(isAdminHost(hostname), bootstrapAdmin, `${hostname}: the service worker and the bootstrap disagree`)
}

const APP_SHELL_DOCUMENTS = ['/', '/index.html', '/business-os-precache.json']
const currentIdentity = (brand: 'staff' | 'shop', manifestHref: string): string[] => [
  manifestHref,
  ...Object.entries(ledger.immutable).filter(([, entry]) => entry.brand === brand && entry.role !== 'retired').map(([file]) => `/${file}`),
].sort()
for (const [hostname, brand, manifestHref] of [
  ['leangbeauty.com', 'shop', '/portal-manifest.json'],
  ['admin.leangbeauty.com', 'staff', '/manifest.json'],
] as const) {
  const precached: string[] = [...appShellUrlsForHost(hostname)]
  for (const shellDocument of APP_SHELL_DOCUMENTS) assert.ok(precached.includes(shellDocument), `${hostname} precaches ${shellDocument}`)
  assert.deepEqual(
    precached.filter((url) => !APP_SHELL_DOCUMENTS.includes(url)).sort(),
    currentIdentity(brand, manifestHref),
    `${hostname} precaches exactly its own manifest and current icons`,
  )
  for (const url of currentIdentity(brand, manifestHref)) assert.ok(isCacheableStaticPath(url), `${url} is cacheable when the page asks for it`)
}
assert.equal(isCacheableStaticPath('/icon.png'), false, 'nothing names /icon.png, so the worker does not keep it')

console.log('PASS admin/storefront brand icon wiring')
