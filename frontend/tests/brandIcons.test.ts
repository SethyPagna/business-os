import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

// Two brands share one index.html, and mixing them up is a silent, purely
// visual regression that no other test would catch:
//
//   Business OS      -> the ADMIN app (admin.leangcosmetics.dpdns.org)
//   Leang Beauty  -> the PUBLIC storefront (leangcosmetics.dpdns.org),
//                       including its favicon and its "Add to Home Screen"
//                       PWA icon
//
// The split is by AUDIENCE and is FIXED, not per-merchant customizable: the
// favicon/PWA-icon customization in Settings + the portal editor was removed
// (11.14-16), so both brands' icons are static assets now.
//   - Admin keeps the static /manifest.json + /favicon.ico from index.html.
//   - The storefront swaps to STATIC same-origin files -- a Leang icon and
//     /portal-manifest.json. This used to build the manifest at runtime as a
//     blob: URL, which Chrome refuses to treat as installable, so the
//     storefront lost its Install prompt entirely (16.1). Static files ARE
//     installable AND keep the Leang branding, so both hold at once.
// These assertions pin the split so a future edit cannot quietly ship
// Business OS branding to customers (or a blob: manifest that kills Install).
//
// Icon FILES themselves are regenerated from the source logos by
// ops/scripts/assets/generate-app-icons.mjs (run it with --check to verify
// they still match). This test covers the WIRING, not the pixels.

const read = (relPath: string): string =>
  fs.readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8')

const indexHtml = read('../index.html')
const manifest = JSON.parse(read('../public/manifest.json')) as {
  name: string
  icons: Array<{ src: string; sizes: string; purpose: string }>
}
const publicCatalog = read('../src/components/catalog/PublicCatalogPage.tsx')
const login = read('../src/components/auth/Login.tsx')

// --- admin app keeps Business OS branding ---------------------------------

assert.match(indexHtml, /href="\/favicon\.ico/, 'admin index.html should link the static favicon.ico')
assert.match(indexHtml, /href="\/icon-192\.png"/, 'admin index.html should link the Business OS 192 icon')
assert.match(indexHtml, /href="\/icon-512\.png"/, 'admin index.html should link the Business OS 512 icon')
assert.match(indexHtml, /hostname\.indexOf\('admin\.'\) === 0/, 'the bootstrap should distinguish the admin hostname')
assert.match(indexHtml, /pathname === '\/'\s*\? !adminHostname/, 'the public production root must not be classified as admin')

assert.equal(manifest.name, 'Business OS', 'the STATIC manifest is the admin app -- the storefront builds its own at runtime')
assert.deepEqual(
  manifest.icons.map((icon) => `${icon.src} ${icon.sizes} ${icon.purpose}`).sort(),
  [
    '/icon-192-maskable.png 192x192 maskable',
    '/icon-192.png 192x192 any',
    '/icon-512-maskable.png 512x512 maskable',
    '/icon-512.png 512x512 any',
  ],
  'admin manifest should offer both any and maskable at 192 and 512, all Business OS',
)
assert.ok(
  !manifest.icons.some((icon) => /leang/i.test(icon.src)),
  'the admin manifest must never reference storefront icons',
)

// --- public storefront uses STATIC Leang Beauty branding ---------------

// The live customer site (PublicCatalogPage) points the tab icon + manifest
// at fixed Leang assets, NOT at anything derived from business config.
assert.match(
  publicCatalog,
  /const STOREFRONT_ICON = '\/leang-cosmetics-icon-512\.png'/,
  'the live storefront should use the static Leang Beauty tab icon, not a Business OS icon or a merchant upload',
)
assert.match(
  publicCatalog,
  /const STOREFRONT_MANIFEST = '\/portal-manifest\.json'/,
  'the live storefront should point at the static Leang portal manifest',
)
assert.match(
  publicCatalog,
  /const STOREFRONT_APPLE_TOUCH_ICON = '\/leang-cosmetics-apple-touch-icon-v1\.png'/,
  'the live storefront must replace the Apple touch icon used by Add to Home Screen',
)
assert.match(
  indexHtml,
  /appleIcon\.setAttribute\('href', '\/leang-cosmetics-apple-touch-icon-v1\.png'\)/,
  'the parser-time bootstrap must select the storefront Apple icon before React loads',
)
// The static portal manifest is the storefront's own brand, and must stay a
// real file (installable) -- the whole point of 16.1.
const portalManifest = JSON.parse(read('../public/portal-manifest.json')) as {
  name: string
  icons: Array<{ src: string }>
}
assert.equal(portalManifest.name, 'Leang Beauty', 'the static portal manifest is the storefront brand, not Business OS')
assert.ok(
  portalManifest.icons.length > 0 && portalManifest.icons.every((icon) => /leang/i.test(icon.src)),
  'every portal-manifest icon must be a Leang asset',
)

// The storefront must NOT reintroduce the runtime blob: manifest (Chrome
// won't install it -- the 16.1 bug) or per-merchant favicon/manifest building.
assert.doesNotMatch(
  publicCatalog,
  /URL\.createObjectURL|buildPortalManifest|createSquareIconDataUrl|createCircularFaviconDataUrl/,
  'the storefront must not build a runtime blob manifest or per-merchant icons -- those are removed (16.1 / 11.14-16)',
)

// Admin sign-in is the one surface deliberately branded Business OS rather
// than the storefront -- split by AUDIENCE (staff sign into the product;
// customers see the shop). See Login.tsx's own comment, which records this
// as reversing an earlier decision at explicit request.
assert.match(
  login,
  /const DEFAULT_LOGIN_LOGO_SRC = '\/icon-512\.png'/,
  'the admin sign-in page should default to the Business OS logo, not the storefront one',
)
assert.doesNotMatch(
  login,
  /const DEFAULT_LOGIN_LOGO_SRC = '\/leang-cosmetics/,
  'admin sign-in must not default to storefront branding',
)

// The storefront must override BOTH the favicon and the manifest link --
// overriding only the favicon leaves Business OS branding on the customer's
// home screen after "Add to Home Screen". It now does this via the static
// files asserted above (STOREFRONT_ICON / STOREFRONT_MANIFEST), so pin that
// it still touches the manifest link element at all.
assert.match(
  publicCatalog,
  /link\[rel="manifest"\]/,
  'the public storefront must replace the manifest link, not just the favicon',
)

// --- every referenced icon file exists ------------------------------------

const referenced = new Set<string>([
  ...manifest.icons.map((icon) => icon.src.replace(/^\//, '')),
  'favicon.ico',
  'apple-touch-icon.png',
  'icon.png',
  'leang-cosmetics-icon-192.png',
  'leang-cosmetics-icon-512.png',
  'leang-cosmetics-icon-192-maskable.png',
  'leang-cosmetics-icon-512-maskable.png',
  'leang-cosmetics-apple-touch-icon-v1.png',
])
const missing = [...referenced].filter(
  (file) => !fs.existsSync(fileURLToPath(new URL(`../public/${file}`, import.meta.url))),
)
assert.deepEqual(missing, [], 'every icon referenced by the manifest or the portal fallbacks must exist on disk')

// Execute the real parser-time bootstrap against small DOM doubles. This is
// the production regression: `/` is storefront on the public hostname but
// remains admin on localhost/admin.*.
const bootstrapMatch = indexHtml.match(/<script>\s*(\(function setInitialBusinessOsRoute\(\)[\s\S]*?\}\(\)\))\s*<\/script>/)
assert.ok(bootstrapMatch, 'the route-aware metadata bootstrap should stay inline in <head>')

function runBootstrap(hostname: string, pathname: string) {
  const attributes = new Map<string, string>()
  const elements = new Map<string, { attrs: Map<string, string>; setAttribute(name: string, value: string): void }>()
  const makeElement = (key: string) => {
    const element = { attrs: new Map<string, string>(), setAttribute(name: string, value: string) { this.attrs.set(name, value) } }
    elements.set(key, element)
    return element
  }
  const favicon = makeElement('favicon')
  const png192 = makeElement('png192')
  const png512 = makeElement('png512')
  const selectors: Record<string, ReturnType<typeof makeElement>> = {
    'meta[name="description"]': makeElement('description'),
    'meta[name="apple-mobile-web-app-title"]': makeElement('apple-title'),
    'link[rel="manifest"]': makeElement('manifest'),
    'link[rel="apple-touch-icon"]': makeElement('apple-icon'),
  }
  const document = {
    title: 'Business OS',
    documentElement: { setAttribute(name: string, value: string) { attributes.set(name, value) } },
    querySelector(selector: string) { return selectors[selector] || null },
    querySelectorAll(selector: string) { return selector === 'link[rel="icon"]' ? [favicon, png192, png512] : [] },
  }
  vm.runInNewContext(bootstrapMatch![1], { window: { location: { hostname, pathname } }, document })
  return { attributes, elements, document, favicon }
}

const publicRoot = runBootstrap('leangcosmetics.dpdns.org', '/')
assert.equal(publicRoot.attributes.get('data-business-os-initial-route'), 'public')
assert.equal(publicRoot.document.title, 'Leang Beauty')
assert.equal(publicRoot.elements.get('manifest')?.attrs.get('href'), '/portal-manifest.json')
assert.equal(publicRoot.elements.get('apple-icon')?.attrs.get('href'), '/leang-cosmetics-apple-touch-icon-v1.png')
assert.equal(publicRoot.favicon.attrs.get('href'), '/leang-cosmetics-icon-512.png')

for (const adminHost of ['admin.leangcosmetics.dpdns.org', 'localhost', '127.0.0.1']) {
  const adminRoot = runBootstrap(adminHost, '/')
  assert.equal(adminRoot.attributes.get('data-business-os-initial-route'), 'admin', `${adminHost}/ should retain admin branding`)
  assert.equal(adminRoot.document.title, 'Business OS')
  assert.equal(adminRoot.elements.get('manifest')?.attrs.get('href'), undefined)
  assert.equal(adminRoot.elements.get('apple-icon')?.attrs.get('href'), undefined)
}

const appleIconBytes = fs.readFileSync(fileURLToPath(new URL('../public/leang-cosmetics-apple-touch-icon-v1.png', import.meta.url)))
assert.equal(appleIconBytes.readUInt32BE(16), 180, 'iPhone icon should be exactly 180px wide')
assert.equal(appleIconBytes.readUInt32BE(20), 180, 'iPhone icon should be exactly 180px high')

console.log('PASS admin/storefront brand icon wiring')
