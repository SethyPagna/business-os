import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// Two brands share one index.html, and mixing them up is a silent, purely
// visual regression that no other test would catch:
//
//   Business OS      -> the ADMIN app (admin.leangcosmetics.dpdns.org)
//   Leang Cosmetics  -> the PUBLIC storefront (leangcosmetics.dpdns.org),
//                       including its favicon and its "Add to Home Screen"
//                       PWA icon
//
// The public storefront swaps the favicon and builds its manifest at runtime
// from the merchant's uploaded logo, falling back to the bundled Leang
// Cosmetics asset. The admin app keeps the static manifest.json and
// favicon.ico. These assertions pin that split so a future edit cannot
// quietly ship Business OS branding to customers, or vice versa.
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
const catalogPage = read('../src/components/catalog/CatalogPage.tsx')
const login = read('../src/components/auth/Login.tsx')

// --- admin app keeps Business OS branding ---------------------------------

assert.match(indexHtml, /href="\/favicon\.ico/, 'admin index.html should link the static favicon.ico')
assert.match(indexHtml, /href="\/icon-192\.png"/, 'admin index.html should link the Business OS 192 icon')
assert.match(indexHtml, /href="\/icon-512\.png"/, 'admin index.html should link the Business OS 512 icon')
assert.doesNotMatch(
  indexHtml,
  /leang-cosmetics/i,
  'admin index.html must not hardcode storefront branding -- the public portal swaps its own icons at runtime',
)

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

// --- public storefront falls back to Leang Cosmetics ----------------------

for (const [label, source, constant] of [
  ['PublicCatalogPage (the live customer site)', publicCatalog, 'DEFAULT_PUBLIC_PORTAL_ICON'],
  ['CatalogPage (admin-side preview OF the customer site)', catalogPage, 'DEFAULT_PORTAL_ICON_SRC'],
] as const) {
  const pattern = new RegExp(`const ${constant} = '/leang-cosmetics-icon-512\\.png'`)
  assert.match(source, pattern, `${label} should fall back to the Leang Cosmetics logo, not a Business OS icon`)
}

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

// The storefront must actually override BOTH the favicon and the manifest --
// overriding only the favicon leaves Business OS branding on the customer's
// home screen after "Add to Home Screen", which is the exact bug this pins.
assert.match(
  publicCatalog,
  /link\[rel="manifest"\]/,
  'the public storefront must replace the manifest link, not just the favicon',
)
assert.match(
  publicCatalog,
  /buildPortalManifest/,
  'the public storefront should build its manifest from portal settings',
)

// --- every referenced icon file exists ------------------------------------

const referenced = new Set<string>([
  ...manifest.icons.map((icon) => icon.src.replace(/^\//, '')),
  'favicon.ico',
  'apple-touch-icon.png',
  'icon.png',
  'leang-cosmetics-icon-192.png',
  'leang-cosmetics-icon-512.png',
])
const missing = [...referenced].filter(
  (file) => !fs.existsSync(fileURLToPath(new URL(`../public/${file}`, import.meta.url))),
)
assert.deepEqual(missing, [], 'every icon referenced by the manifest or the portal fallbacks must exist on disk')

console.log('PASS admin/storefront brand icon wiring')
