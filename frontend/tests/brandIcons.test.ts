import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import * as pathRouting from '../src/app/pathRouting.ts'
import * as clientIdentity from '../../cloudflare/src/lib/clientIdentity.ts'

// Two brands share one index.html, and mixing them up is a silent, purely
// visual regression that no other test would catch:
//
//   <shop> Admin -> the staff app (admin.* host), BO icon
//   <shop>       -> the PUBLIC storefront, including its favicon and its
//                   "Add to Home Screen" PWA icon
//
// The split is by AUDIENCE and is FIXED, not per-merchant customizable: the
// favicon/PWA-icon customization in Settings + the portal editor was removed
// (11.14-16), so both brands' icons are static assets. WHICH shop it is comes
// from the deployment's identity (wrangler [vars], cloudflare/src/lib/
// clientIdentity.ts): the Worker writes it into the raw document, and the
// static index.html names no client at all.
//   - The raw HTML is storefront-first because iOS may snapshot metadata
//     before JavaScript executes.
//   - The bootstrap picks /manifest.json + the staff icons on the admin host
//     and the identity block's shop icons elsewhere. The manifest used to be
//     built at runtime as a blob: URL, which Chrome refuses to treat as
//     installable, so the storefront lost its Install prompt entirely (16.1).
//     Same-origin manifests ARE installable.
// These assertions pin the split so a future edit cannot quietly ship
// staff branding to customers (or a blob: manifest that kills Install), and
// pin Leang Cosmetics' identity to exactly what it was before it moved into
// configuration.
//
// The icon files' pixels and bytes are tests/pwaIcons.test.ts; this test
// covers the WIRING.

const read = (relPath: string): string =>
  fs.readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8')

function tomlVars(relPath: string): Record<string, string> {
  const text = read(relPath).replace(/\r\n/g, '\n')
  const vars: Record<string, string> = {}
  for (const match of text.slice(text.indexOf('\n[vars]\n')).matchAll(/^([A-Z][A-Z0-9_]*) = "([^"]*)"$/gm)) vars[match[1]] = match[2]
  return vars
}

type IconLedger = { immutable: Record<string, { brand: 'staff' | 'shop'; role: string }>; mutable: Record<string, string> }
const ledger = JSON.parse(read('./fixtures/pwa-icon-ledger.json')) as IconLedger
const leang = clientIdentity.resolveClientIdentity(tomlVars('../../cloudflare/wrangler.toml'))
// BM Shop's URL scheme (owner, 22 Oct 2026): shop at bm.khshop.workers.dev, staff
// at bm-admin.khshop.workers.dev -- a configured staff host, not admin.*.
const bmShop = clientIdentity.resolveClientIdentity({
  BUSINESS_OS_SHOP_NAME: 'BM Shop',
  BUSINESS_OS_ORGANIZATION_NAME: 'BM Shop',
  BUSINESS_OS_MEMBERSHIP_PREFIX: 'BM-',
  BUSINESS_OS_ADMIN_URL: 'https://bm-admin.khshop.workers.dev',
  BUSINESS_OS_PUBLIC_URL: 'https://bm.khshop.workers.dev',
})
const neutral = clientIdentity.NEUTRAL_CLIENT_IDENTITY

// Leang Cosmetics before its identity moved into configuration.
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
assert.deepEqual(
  { '': leang.shopIcons.favicon, '192x192': leang.shopIcons.icon192, '512x512': leang.shopIcons.icon512 },
  SHOP_ICON_BY_SIZE,
  "wrangler.toml's icon prefix yields Leang's shop icons",
)
assert.equal(leang.shopIcons.appleTouch, SHOP_APPLE_TOUCH_ICON)

const indexHtml = read('../index.html')
const manifest = JSON.parse(read('../public/manifest.json')) as {
  name: string
  icons: Array<{ src: string; sizes: string; purpose: string }>
}
const publicCatalog = read('../src/components/catalog/PublicCatalogPage.tsx')
const login = read('../src/components/auth/Login.tsx')

// --- raw HTML is public-first and names no client -------------------------

assert.match(indexHtml, /rel="manifest" href="\/portal-manifest\.json"/, 'raw HTML must identify the storefront before iOS snapshots install metadata')
assert.doesNotMatch(indexHtml, /leang/i, 'the shared document names no client; the Worker writes the identity in')
const staticHead = indexHtml.slice(0, indexHtml.indexOf('<script'))
const staticIconLinks = [...staticHead.matchAll(/<link rel="icon"([^>]*)>/g)].map(([, attributes]) => ({
  sizes: /sizes="([^"]+)"/.exec(attributes)?.[1] ?? '',
  href: /href="([^"]+)"/.exec(attributes)?.[1],
  type: /type="([^"]+)"/.exec(attributes)?.[1],
}))
assert.deepEqual(
  Object.fromEntries(staticIconLinks.map((link) => [link.sizes, link.href])),
  { '': neutral.shopIcons.favicon, '192x192': neutral.shopIcons.icon192, '512x512': neutral.shopIcons.icon512 },
  'raw HTML names each size its own neutral icon',
)
assert.equal(staticIconLinks.find((link) => link.sizes === '')?.type, 'image/x-icon', 'the unsized raw favicon link is the ICO')
assert.ok(staticHead.includes(`<link rel="apple-touch-icon" sizes="180x180" href="${neutral.shopIcons.appleTouch}" />`), 'raw HTML carries the neutral Apple touch icon')
assert.match(indexHtml, /hostname\.indexOf\('admin\.'\) === 0/, 'the bootstrap should distinguish the admin hostname')
assert.match(indexHtml, /var publicRoute = !adminHostname\s*\? documentRoute/, 'on the shop host every document is the storefront (the public site never shows admin)')

// --- the install manifests -------------------------------------------------

const leangStaffManifest = clientIdentity.staffManifest(leang)
const leangShopManifest = clientIdentity.shopManifest(leang)
assert.deepEqual(manifest, clientIdentity.staffManifest(neutral), 'public/manifest.json is the neutral staff manifest (the Worker serves the configured one)')
assert.equal(leangStaffManifest.name, 'Leang Cosmetics Admin', 'Leang installs the staff app as before')
for (const staffManifest of [manifest, leangStaffManifest]) {
  assert.deepEqual(
    staffManifest.icons.map((icon) => `${icon.src} ${icon.sizes} ${icon.purpose}`).sort(),
    [
      '/icon-192-maskable-v2.png 192x192 maskable',
      '/icon-192.png 192x192 any',
      '/icon-512-maskable-v2.png 512x512 maskable',
      '/icon-512.png 512x512 any',
    ],
    'admin manifest should offer both any and maskable at 192 and 512, all staff icons',
  )
}
assert.ok(!leangStaffManifest.icons.some((icon) => /leang/i.test(icon.src)), 'the admin manifest must never reference storefront icons')

const portalManifest = JSON.parse(read('../public/portal-manifest.json')) as typeof leangShopManifest
assert.deepEqual(portalManifest, clientIdentity.shopManifest(neutral), 'public/portal-manifest.json is the neutral shop manifest')
assert.equal(leangShopManifest.name, 'Leang Cosmetics', 'the portal manifest is the storefront brand, not the staff app')
assert.equal(leangShopManifest.short_name, 'Leang Cosmetics', 'the Android launcher label is the full shop name (owner, 19 Oct 2026)')
assert.deepEqual(
  leangShopManifest.icons.map((icon) => `${icon.src} ${icon.sizes} ${icon.purpose}`).sort(),
  [
    '/leang-cosmetics-icon-192-maskable-v2.png 192x192 maskable',
    '/leang-cosmetics-icon-192-v2.png 192x192 any',
    '/leang-cosmetics-icon-512-maskable-v2.png 512x512 maskable',
    '/leang-cosmetics-icon-512-v2.png 512x512 any',
  ],
  'the shop manifest offers the owner-logo icons, any and maskable, at 192 and 512',
)
assert.doesNotMatch(JSON.stringify([clientIdentity.staffManifest(bmShop), clientIdentity.shopManifest(bmShop)]), /leang/i, 'another client installs nothing of Leang')

// --- the public storefront uses the deployment's STATIC branding ---------

// The live customer site (PublicCatalogPage) points the tab icon + manifest
// at the identity's fixed assets, NOT at anything derived from business config.
assert.match(publicCatalog, /const STOREFRONT_IDENTITY = getClientIdentity\(\)/, 'the storefront brand is the deployment identity')
assert.match(publicCatalog, /const STOREFRONT_ICON = STOREFRONT_IDENTITY\.shopIcons\.icon512/, 'the live storefront uses the identity tab icon, not a staff icon or a merchant upload')
assert.match(publicCatalog, /const STOREFRONT_MANIFEST = '\/portal-manifest\.json'/, 'the live storefront points at the portal manifest')
assert.match(publicCatalog, /const STOREFRONT_APPLE_TOUCH_ICON = STOREFRONT_IDENTITY\.shopIcons\.appleTouch/, 'the live storefront must replace the Apple touch icon used by Add to Home Screen')
assert.match(publicCatalog, /const STOREFRONT_NAME = STOREFRONT_IDENTITY\.shopName/)
assert.doesNotMatch(publicCatalog, /'\/leang-cosmetics|'Leang /, 'no client is named in the storefront source')

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
assert.doesNotMatch(login, /leang/i, 'admin sign-in names no client')

// The storefront must override BOTH the favicon and the manifest link --
// overriding only the favicon leaves staff branding on the customer's home
// screen after "Add to Home Screen".
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
assert.match(publicCatalog, /import \{ isAdminHostname(?:, \w+)* \} from '\.\.\/\.\.\/app\/pathRouting\.ts'/, 'the guard uses the one shared host predicate')
assert.match(brandEffect, /appleTitle\.setAttribute\('content', STOREFRONT_NAME\)/, 'the iPhone home-screen label is the full shop name (owner, 19 Oct 2026)')
assert.match(brandEffect, /displayConfig\.title \|\| STOREFRONT_NAME\)/, 'the tab title falls back to the storefront name')

const workerSources = read('../../cloudflare/src/lib/clientIdentity.ts') + read('../../cloudflare/src/lib/documentIdentity.ts')
const iconPath = /\/[\w.-]+\.(?:png|ico)/g
const wiredIcons = new Map<string, string>([
  ...[...leangStaffManifest.icons, ...leangShopManifest.icons].map((icon) => [icon.src, 'Leang manifests'] as [string, string]),
  ...[...manifest.icons, ...portalManifest.icons].map((icon) => [icon.src, 'public manifests'] as [string, string]),
  ...[...indexHtml.matchAll(iconPath)].map(([src]) => [src, 'index.html'] as [string, string]),
  ...[...workerSources.matchAll(iconPath)].map(([src]) => [src, 'cloudflare/src/lib identity'] as [string, string]),
  ...Object.values(leang.shopIcons).map((src) => [src, 'Leang identity'] as [string, string]),
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

// Execute the real parser-time bootstrap against small DOM doubles, with the
// identity block the Worker writes for a deployment.
const bootstrapMatch = indexHtml.match(/<script>\s*(\(function setInitialBusinessOsRoute\(\)[\s\S]*?\}\(\)\))\s*<\/script>/)
assert.ok(bootstrapMatch, 'the route-aware metadata bootstrap should stay inline in <head>')
const staticIdentityBlock = /<script id="business-os-identity" type="application\/json">([^<]*)<\/script>/.exec(indexHtml)?.[1]
assert.ok(staticIdentityBlock, 'the identity block sits before the bootstrap that reads it')
assert.ok(indexHtml.indexOf('id="business-os-identity"') < indexHtml.indexOf('setInitialBusinessOsRoute'))

function runBootstrap(hostname: string, pathname: string, identityJson: string | null = clientIdentity.clientIdentityJson(leang)) {
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
  const replaced: string[] = []
  const document = {
    title: '',
    documentElement: { setAttribute(name: string, value: string) { attributes.set(name, value) } },
    createElement(_tagName: string) { return appendedToHead },
    head: { appendChild(node: unknown) { return node } },
    getElementById(id: string) { return id === 'business-os-identity' && identityJson !== null ? { textContent: identityJson } : null },
    querySelector(selector: string) { return selectors[selector] || null },
    querySelectorAll(selector: string) { return selector === 'link[rel="icon"]' ? [favicon, png192, png512] : [] },
  }
  const location = { hostname, pathname, search: '?q=1', hash: '#top', replace(url: string) { replaced.push(url) } }
  vm.runInNewContext(bootstrapMatch![1], { window: { location }, document })
  return { attributes, elements, document, favicon, png192, png512, replaced }
}

const SHOP_IDENTITY = {
  title: 'Leang Cosmetics',
  appTitle: 'Leang Cosmetics',
  description: 'Browse Leang Cosmetics products and contact the store.',
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
  description: 'Till, stock and sales for Leang Cosmetics staff',
  manifest: '/manifest.json',
  themeColor: '#fffdf8',
  appleIcon: STAFF_APPLE_TOUCH_ICON,
  favicon: `${STAFF_ICON_BY_SIZE['']} image/x-icon`,
  icon192: `${STAFF_ICON_BY_SIZE['192x192']} image/png`,
  icon512: `${STAFF_ICON_BY_SIZE['512x512']} image/png`,
}

function installedIdentity(run: ReturnType<typeof runBootstrap>) {
  return {
    title: run.document.title,
    appTitle: run.elements.get('apple-title')?.attrs.get('content'),
    description: run.elements.get('description')?.attrs.get('content'),
    manifest: run.elements.get('manifest')?.attrs.get('href'),
    themeColor: run.elements.get('theme-color')?.attrs.get('content'),
    appleIcon: run.elements.get('apple-icon')?.attrs.get('href'),
    favicon: `${run.favicon.attrs.get('href')} ${run.favicon.attrs.get('type')}`,
    icon192: `${run.png192.attrs.get('href')} ${run.png192.attrs.get('type')}`,
    icon512: `${run.png512.attrs.get('href')} ${run.png512.attrs.get('type')}`,
  }
}

// What installs follows the HOST; which app renders still follows the route
// (the translate opt-out that goes with it is pinned in
// tests/posCommittedCloseDurability.test.ts).
const identityCases: Array<[hostname: string, pathname: string, identity: typeof SHOP_IDENTITY, route: 'public' | 'admin']> = [
  ['leangbeauty.com', '/', SHOP_IDENTITY, 'public'],
  ['leangbeauty.com', '/some-shop', SHOP_IDENTITY, 'public'],
  // G38 P0 (owner 27 Sep): the shop host never renders the staff app.
  ['leangbeauty.com', '/login', SHOP_IDENTITY, 'public'],
  ['leangbeauty.com', '/pos', SHOP_IDENTITY, 'public'],
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
  assert.deepEqual(installedIdentity(run), identity, `${hostname}${pathname} installs as ${identity.title}`)
}

// Another client's deployment installs as itself, with the staff icons until
// it has its own artwork, and nothing of Leang's.
for (const [hostname, title] of [['bm.khshop.workers.dev', 'BM Shop'], ['bm-admin.khshop.workers.dev', 'BM Shop Admin'], ['bm-admin.khshop.workers.dev.evil.com', 'BM Shop']]) {
  const installed = installedIdentity(runBootstrap(hostname, '/', clientIdentity.clientIdentityJson(bmShop)))
  assert.equal(installed.title, title)
  assert.equal(installed.favicon, `${STAFF_ICON_BY_SIZE['']} image/x-icon`)
  assert.doesNotMatch(JSON.stringify(installed), /leang/i, `${hostname} installs nothing of Leang`)
}

// A document the Worker never rewrote (the Vite dev server, an unknown path
// the asset layer answers itself) installs as the neutral Business OS app.
assert.equal(installedIdentity(runBootstrap('localhost', '/', staticIdentityBlock)).title, neutral.adminTitle)
assert.equal(installedIdentity(runBootstrap('shop.example.test', '/', staticIdentityBlock)).title, neutral.shopName)
// No identity at all leaves the served head as it is, and never throws.
const unbranded = installedIdentity(runBootstrap('shop.example.test', '/', null))
assert.equal(unbranded.title, '')
assert.equal(unbranded.manifest, '/portal-manifest.json')

// A www. alias visit folds into the bare host with its path, query and hash.
assert.deepEqual(runBootstrap('www.leangbeauty.com', '/legal').replaced, ['https://leangbeauty.com/legal?q=1#top'])
assert.deepEqual(runBootstrap('leangbeauty.com', '/legal').replaced, [])
assert.deepEqual(runBootstrap('admin.leangbeauty.com', '/').replaced, [])
assert.doesNotMatch(bootstrapMatch![1], /dpdns|leang/i, 'the bootstrap names no client and no retired domain')

for (const appleIcon of [SHOP_APPLE_TOUCH_ICON, STAFF_APPLE_TOUCH_ICON]) {
  const appleIconBytes = fs.readFileSync(fileURLToPath(new URL(`../public${appleIcon}`, import.meta.url)))
  assert.equal(appleIconBytes.readUInt32BE(16), 180, `${appleIcon}: an iPhone icon is exactly 180px wide`)
  assert.equal(appleIconBytes.readUInt32BE(20), 180, `${appleIcon}: an iPhone icon is exactly 180px high`)
}

type ServiceWorkerHostRules = {
  isAdminHost?: (hostname: string, staffHost?: string) => boolean
  identityUrlsForHost?: (hostname: string, html: string) => string[]
  staffHostFromShell?: (html: string) => string
  shopIconUrlsFromShell?: (html: string) => string[]
  isCacheableStaticPath?: (pathname: string) => boolean
}
const serviceWorker: ServiceWorkerHostRules & { self: unknown; URL: typeof URL } = {
  self: { addEventListener() {}, location: { origin: 'https://leangbeauty.com', hostname: 'leangbeauty.com' }, registration: {} },
  URL,
}
vm.runInNewContext(read('../public/sw.js'), serviceWorker)
const { isAdminHost, identityUrlsForHost, staffHostFromShell, shopIconUrlsFromShell, isCacheableStaticPath } = serviceWorker
assert.ok(identityUrlsForHost, 'sw.js picks its install identity by host (identityUrlsForHost)')
assert.ok(staffHostFromShell, "sw.js reads the configured staff host from the shell's identity block")
assert.ok(shopIconUrlsFromShell, "sw.js reads the shop's icons from the shell's identity block")
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

// A configured staff host: the worker learns it from the shell the Worker
// wrote, the bootstrap from the same identity block.
const shellFor = (identity: clientIdentity.ClientIdentity): string => `<head><script id="business-os-identity" type="application/json">${clientIdentity.clientIdentityJson(identity)}</script></head>`
assert.equal(staffHostFromShell(shellFor(bmShop)), 'bm-admin.khshop.workers.dev')
assert.equal(staffHostFromShell('<html></html>'), '', 'no identity block, no configured staff host')
for (const hostname of ['bm-admin.khshop.workers.dev', 'bm.khshop.workers.dev', 'bm-admin.khshop.workers.dev.evil.com', 'xbm-admin.khshop.workers.dev', 'admin.khshop.workers.dev']) {
  const bootstrapAdmin = runBootstrap(hostname, '/some-unknown-path', clientIdentity.clientIdentityJson(bmShop)).elements.get('manifest')?.attrs.get('href') === '/manifest.json'
  assert.equal(isAdminHost(hostname, staffHostFromShell(shellFor(bmShop))), bootstrapAdmin, `${hostname}: the service worker and the bootstrap disagree`)
  assert.equal(bootstrapAdmin, hostname === 'bm-admin.khshop.workers.dev' || hostname === 'admin.khshop.workers.dev', `${hostname}: staff only on the configured host and admin.*`)
}

const currentIcons = (brand: 'staff' | 'shop'): string[] => Object.entries(ledger.immutable)
  .filter(([, entry]) => entry.brand === brand && entry.role !== 'retired')
  .map(([file]) => `/${file}`)
  .sort()
const manifestHrefFor = (brand: 'staff' | 'shop'): string => (brand === 'staff' ? '/manifest.json' : '/portal-manifest.json')
const leangShell = `<head><script id="business-os-identity" type="application/json">${clientIdentity.clientIdentityJson(leang)}</script></head>`
for (const [hostname, brand, manifestHref] of [
  ['leangbeauty.com', 'shop', '/portal-manifest.json'],
  ['admin.leangbeauty.com', 'staff', '/manifest.json'],
] as const) {
  const identityFiles: string[] = [...identityUrlsForHost(hostname, leangShell)]
  assert.deepEqual(identityFiles.sort(), [manifestHref, ...currentIcons(brand)].sort(), `${hostname} precaches exactly its own manifest and current icons`)
  for (const url of identityFiles) assert.ok(isCacheableStaticPath(url), `${url} is cacheable when the page asks for it`)
}
assert.deepEqual([...shopIconUrlsFromShell('<html></html>')], [], 'no identity block, no shop icons to precache')
assert.deepEqual([...identityUrlsForHost('bm-admin.khshop.workers.dev', shellFor(bmShop))].sort(), [manifestHrefFor('staff'), ...currentIcons('staff')].sort(), "BM Shop's configured staff host keeps the staff identity")
assert.deepEqual([...identityUrlsForHost('bm.khshop.workers.dev', shellFor(bmShop))][0], '/portal-manifest.json', "BM Shop's shop host keeps the shop identity")
assert.deepEqual(
  [...shopIconUrlsFromShell(`<script id="business-os-identity" type="application/json">${clientIdentity.clientIdentityJson(bmShop)}</script>`)].sort(),
  [...new Set(Object.values(clientIdentity.STAFF_ICONS))].sort(),
  'a shop without its own artwork precaches the staff icons',
)
assert.equal(isCacheableStaticPath('/icon.png'), false, 'nothing names /icon.png, so the worker does not keep it')
assert.equal(isCacheableStaticPath('/favicon.ico'), false, 'a conventional probe path is never kept')

console.log('PASS admin/storefront brand icon wiring')
