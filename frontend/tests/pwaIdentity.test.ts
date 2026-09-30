// What a phone installs from each host: the web-app manifests, the host rule
// that picks between them, and the head values that must agree with them.
//
// Owner, 28 Sep 2026: the staff app (admin.leangbeauty.com) installs as
// "Leang Cosmetics Admin" / "Leang Admin" and keeps the blue BO icon; the
// shop (leangbeauty.com) installs as "Leang Cosmetics" / "Leang".
//
// Run: node tests/pwaIdentity.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { PORTAL_LIGHT_SURFACE } from '../src/components/catalog/portalContrast.ts'
import * as pathRouting from '../src/app/pathRouting.ts'
import { ADMIN_DOCUMENT_HOSTS, APP_DOCUMENT_ROUTES } from '../../cloudflare/src/lib/adminDocumentIdentity.ts'

type ManifestIcon = { src: string; sizes: string; type: string; purpose: string }
type WebAppManifest = {
  name: string
  short_name: string
  description: string
  id: string
  start_url: string
  scope: string
  display: string
  background_color: string
  theme_color: string
  icons: ManifestIcon[]
}

const read = (relPath: string): string =>
  fs.readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const publicFile = (src: string): string => fileURLToPath(new URL(`../public/${src.replace(/^\//, '')}`, import.meta.url))

const staffManifestText = read('../public/manifest.json')
const shopManifestText = read('../public/portal-manifest.json')
const staff = JSON.parse(staffManifestText) as WebAppManifest
const shop = JSON.parse(shopManifestText) as WebAppManifest
const navChrome = read('../src/components/navigation/nav-chrome.css')
const indexHtml = read('../index.html')

// iOS and Android cut a home-screen label at about 12 characters.
const HOME_SCREEN_LABEL_LIMIT = 12

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}`)
  }
}

function lightNavToken(token: string): string {
  const match = new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, 'i').exec(navChrome)
  assert.ok(match, `${token} should still be declared as a hex colour in nav-chrome.css`)
  return match[1].toLowerCase()
}

function pngSize(file: string): { width: number; height: number } {
  const bytes = fs.readFileSync(file)
  assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', `${file} should be a PNG`)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

runTest('the staff app installs as "Leang Cosmetics Admin", labelled "Leang Admin"', () => {
  assert.equal(staff.name, 'Leang Cosmetics Admin')
  assert.equal(staff.short_name, 'Leang Admin')
})

runTest('the shop installs as "Leang Cosmetics", labelled "Leang"', () => {
  assert.equal(shop.name, 'Leang Cosmetics')
  assert.equal(shop.short_name, 'Leang')
})

runTest('both home-screen labels fit without being cut', () => {
  for (const manifest of [staff, shop]) {
    assert.ok(manifest.short_name.length <= HOME_SCREEN_LABEL_LIMIT, `"${manifest.short_name}" is longer than ${HOME_SCREEN_LABEL_LIMIT}`)
  }
})

runTest('the rename updates the installed apps instead of adding second ones', () => {
  for (const manifest of [staff, shop]) {
    assert.equal(manifest.id, '/', `${manifest.name}: a changed id installs a second app`)
    assert.equal(manifest.start_url, '/', manifest.name)
    assert.equal(manifest.scope, '/', manifest.name)
    assert.equal(manifest.display, 'standalone', manifest.name)
  }
})

runTest('an installed staff launch opens a document the Worker gives the staff head', () => {
  assert.ok(APP_DOCUMENT_ROUTES.includes(staff.start_url), `${staff.start_url} is not an APP_DOCUMENT_ROUTES entry`)
})

runTest('the staff app is coloured like its top bar and page ground', () => {
  assert.equal(staff.theme_color, lightNavToken('--nav-surface'))
  assert.equal(staff.background_color, lightNavToken('--nav-ground'))
})

runTest('the shop is coloured like the storefront surface', () => {
  assert.equal(shop.theme_color, PORTAL_LIGHT_SURFACE)
  assert.equal(shop.background_color, PORTAL_LIGHT_SURFACE)
})

runTest('no manifest promises offline use or carries a retired name', () => {
  for (const text of [staffManifestText, shopManifestText]) {
    assert.doesNotMatch(text, /offline|business ?os|leang beauty/i)
  }
})

runTest('the raw HTML head names the shop before the bootstrap overwrites it', () => {
  const html = read('../index.html')
  assert.match(html, /<title>Leang Cosmetics<\/title>/)
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Leang" \/>/)
})

runTest('neither manifest names the other host\'s icons', () => {
  assert.ok(staff.icons.length > 0 && shop.icons.length > 0, 'both manifests list icons')
  for (const icon of staff.icons) assert.doesNotMatch(icon.src, /leang/i, `staff manifest names shop icon ${icon.src}`)
  for (const icon of shop.icons) assert.match(icon.src, /^\/leang-cosmetics-/, `shop manifest names non-shop icon ${icon.src}`)
})

runTest('every manifest icon ships at the size it declares', () => {
  for (const icon of [...staff.icons, ...shop.icons]) {
    assert.equal(icon.type, 'image/png', icon.src)
    assert.ok(fs.existsSync(publicFile(icon.src)), `${icon.src} is missing from frontend/public`)
    const { width, height } = pngSize(publicFile(icon.src))
    assert.equal(`${width}x${height}`, icon.sizes, icon.src)
  }
})

// --- the host rule: bootstrap, React router and Worker agree ----------------

const bootstrapSource = indexHtml.match(/<script>\s*(\(function setInitialBusinessOsRoute\(\)[\s\S]*?\}\(\)\))\s*<\/script>/)?.[1]

function bootstrapHead(hostname: string, pathname: string): { manifest: string | null; themeColor: string | null; title: string } {
  assert.ok(bootstrapSource, 'the identity bootstrap should stay inline in <head>')
  const element = () => ({
    attrs: new Map<string, string>(),
    getAttribute(name: string) { return this.attrs.get(name) ?? null },
    setAttribute(name: string, value: string) { this.attrs.set(name, value) },
  })
  const selectors: Record<string, ReturnType<typeof element>> = {
    'meta[name="description"]': element(),
    'meta[name="apple-mobile-web-app-title"]': element(),
    'meta[name="theme-color"]': element(),
    'link[rel="manifest"]': element(),
    'link[rel="apple-touch-icon"]': element(),
  }
  const document = {
    title: '',
    documentElement: { setAttribute() {} },
    head: { appendChild(node: unknown) { return node } },
    createElement: element,
    querySelector: (selector: string) => selectors[selector] || null,
    querySelectorAll: () => [],
  }
  vm.runInNewContext(bootstrapSource, { window: { location: { hostname, pathname } }, document })
  return {
    manifest: selectors['link[rel="manifest"]'].getAttribute('href'),
    themeColor: selectors['meta[name="theme-color"]'].getAttribute('content'),
    title: document.title,
  }
}

function routerSaysAdminHost(hostname: string): boolean {
  const previous = (globalThis as { window?: unknown }).window
  ;(globalThis as { window?: unknown }).window = { location: { hostname } }
  try {
    return !pathRouting.isPublicCatalogPath('/')
  } finally {
    ;(globalThis as { window?: unknown }).window = previous
  }
}

const HOSTNAMES = [
  'admin.leangbeauty.com',
  'leangbeauty.com',
  'www.leangbeauty.com',
  'notadmin.leangbeauty.com',
  'localhost',
  '127.0.0.1',
  '[::1]',
  'admin.example.test',
]
const UNKNOWN_PATH = '/some-unknown-path'

runTest('the browser\'s IPv6 loopback spelling "[::1]" is a staff host everywhere', () => {
  assert.equal(new URL('http://[::1]:5173/').hostname, '[::1]', 'this is the spelling location.hostname reports')
  assert.equal(routerSaysAdminHost('[::1]'), true, 'pathRouting.ts')
  assert.equal(bootstrapHead('[::1]', UNKNOWN_PATH).manifest, '/manifest.json', 'index.html bootstrap')
})

runTest('React uses the same host predicate the bootstrap does', () => {
  assert.equal(typeof pathRouting.isAdminHostname, 'function', 'pathRouting.ts exports isAdminHostname')
  for (const hostname of HOSTNAMES) {
    const bootstrapAdmin = bootstrapHead(hostname, UNKNOWN_PATH).manifest === '/manifest.json'
    assert.equal(routerSaysAdminHost(hostname), bootstrapAdmin, `${hostname}: router and bootstrap disagree`)
    const previous = (globalThis as { window?: unknown }).window
    ;(globalThis as { window?: unknown }).window = { location: { hostname } }
    try {
      assert.equal(pathRouting.isAdminHostname(), bootstrapAdmin, `${hostname}: isAdminHostname() and bootstrap disagree`)
    } finally {
      ;(globalThis as { window?: unknown }).window = previous
    }
  }
})

runTest('every host the Worker rewrites as staff is a staff host in the page too', () => {
  for (const hostname of ADMIN_DOCUMENT_HOSTS) {
    assert.equal(routerSaysAdminHost(hostname), true, `${hostname}: Worker says staff, router says shop`)
    assert.equal(bootstrapHead(hostname, UNKNOWN_PATH).manifest, '/manifest.json', `${hostname}: Worker says staff, bootstrap says shop`)
  }
})

runTest('the head the bootstrap writes matches each host\'s manifest', () => {
  const staticThemeColor = /<meta name="theme-color" content="([^"]+)"/.exec(indexHtml.split('<script>')[0])?.[1]
  assert.equal(staticThemeColor, shop.theme_color, 'the raw HTML is storefront-first, colour included')
  for (const [hostname, manifest, href] of [
    ['leangbeauty.com', shop, '/portal-manifest.json'],
    ['admin.leangbeauty.com', staff, '/manifest.json'],
  ] as const) {
    const head = bootstrapHead(hostname, UNKNOWN_PATH)
    assert.equal(head.manifest, href, hostname)
    assert.equal(head.themeColor, manifest.theme_color, hostname)
    assert.equal(head.title, manifest.name, hostname)
  }
})

if (failed > 0) {
  console.error(`\npwaIdentity: ${failed} failed`)
  process.exit(1)
}
console.log('\npwaIdentity: all passed')
