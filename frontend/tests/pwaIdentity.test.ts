// What a phone installs from each host: the web-app manifests, the host rule
// that picks between them, and the head values that must agree with them.
//
// Owner, 28 Sep 2026: the staff app (admin.leangbeauty.com) installs as
// "Leang Cosmetics Admin" / "Leang Admin" and keeps the blue BO icon; the
// shop (leangbeauty.com) installs as "Leang Cosmetics" / "Leang Cosmetics"
// (owner, 19 Oct 2026: the full name on both home screens; was "Leang").
// Those names are Leang's identity in its rendered Worker config [vars]; the Worker
// builds both manifests from it (cloudflare/src/lib/clientIdentity.ts), and the
// files in public/ are the neutral fallback a document the Worker never saw uses.
//
// Every check runs as the neutral fixture client (the committed template rendered
// with clients/example.env, see clientFixtureIdentity.ts) and, where this machine has
// the private Records/Clients/leang.env, as Leang Cosmetics too; elsewhere (CI) the
// Leang run prints one SKIP line.
//
// Run: node tests/pwaIdentity.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { PORTAL_LIGHT_SURFACE } from '../src/components/catalog/portalContrast.ts'
import * as pathRouting from '../src/app/pathRouting.ts'
import { getClientIdentity } from '../src/app/clientIdentity.ts'
import { APP_DOCUMENT_ROUTES } from '../../cloudflare/src/lib/documentRoutes.ts'
import { clientIdentityJson, resolveClientIdentity, shopManifest, staffManifest, type ClientIdentity } from '../../cloudflare/src/lib/clientIdentity.ts'
import { isStaffHostname as workerSaysStaff } from '../../cloudflare/src/lib/publicHostGate.ts'
import { primeClientIdentity, shopClients, type ShopClient } from './clientFixtureIdentity.ts'

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
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A second client's URL scheme (owner, 22 Oct 2026): the shop at <client>.shops-sub.workers.dev,
// staff at <client>-admin.shops-sub.workers.dev, which a forwarder Worker hands to the
// main one with the host preserved. A *.workers.dev name cannot start with admin.
const SECOND_SHOP_HOST = 'second.shops-sub.workers.dev'
const SECOND_STAFF_HOST = 'second-admin.shops-sub.workers.dev'
const secondShop = resolveClientIdentity({
  BUSINESS_OS_SHOP_NAME: 'Second Shop',
  BUSINESS_OS_ADMIN_URL: `https://${SECOND_STAFF_HOST}`,
  BUSINESS_OS_PUBLIC_URL: `https://${SECOND_SHOP_HOST}`,
})
// The page reads its identity once; the router in this file runs as the second client's.
primeClientIdentity(getClientIdentity, secondShop)
const staticManifests = [JSON.parse(read('../public/manifest.json')), JSON.parse(read('../public/portal-manifest.json'))] as WebAppManifest[]
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

const bootstrapSource = indexHtml.match(/<script>\s*(\(function setInitialBusinessOsRoute\(\)[\s\S]*?\}\(\)\))\s*<\/script>/)?.[1]

function bootstrapHead(hostname: string, pathname: string, identity: ClientIdentity): { manifest: string | null; themeColor: string | null; title: string } {
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
    getElementById: (id: string) => (id === 'business-os-identity' ? { textContent: clientIdentityJson(identity) } : null),
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

const UNKNOWN_PATH = '/some-unknown-path'

function pwaIdentity({ record, vars, shipsIcons }: ShopClient): void {
  const test = (name: string, fn: () => void): void => runTest(`[${record.id}] ${name}`, fn)
  const client = resolveClientIdentity(vars)
  const staff = staffManifest(client) as WebAppManifest
  const shop = shopManifest(client) as WebAppManifest

  test(`the staff app installs as "${record.adminTitle}", labelled "${record.adminShortName}"`, () => {
    assert.equal(staff.name, record.adminTitle)
    assert.equal(staff.short_name, record.adminShortName)
  })

  test(`the shop installs as "${record.shopName}", labelled "${record.shopName}"`, () => {
    assert.equal(shop.name, record.shopName)
    assert.equal(shop.short_name, record.shopName)
  })

  test('the staff home-screen label fits without being cut', () => {
    assert.ok(staff.short_name.length <= HOME_SCREEN_LABEL_LIMIT, `"${staff.short_name}" is longer than ${HOME_SCREEN_LABEL_LIMIT}`)
  })

  // The shop's full name (15 characters) is the owner's choice; whether a phone launcher truncates
  // it is a real-device check, so only the staff label is length-checked here.

  test('the rename updates the installed apps instead of adding second ones', () => {
    for (const manifest of [staff, shop]) {
      assert.equal(manifest.id, '/', `${manifest.name}: a changed id installs a second app`)
      assert.equal(manifest.start_url, '/', manifest.name)
      assert.equal(manifest.scope, '/', manifest.name)
      assert.equal(manifest.display, 'standalone', manifest.name)
    }
  })

  test('an installed staff launch opens a document the Worker gives the staff head', () => {
    assert.ok(APP_DOCUMENT_ROUTES.includes(staff.start_url), `${staff.start_url} is not an APP_DOCUMENT_ROUTES entry`)
  })

  test('the staff app is coloured like its top bar and page ground', () => {
    assert.equal(staff.theme_color, lightNavToken('--nav-surface'))
    assert.equal(staff.background_color, lightNavToken('--nav-ground'))
  })

  test('the shop is coloured like the storefront surface', () => {
    assert.equal(shop.theme_color, PORTAL_LIGHT_SURFACE)
    assert.equal(shop.background_color, PORTAL_LIGHT_SURFACE)
  })

  test('no manifest promises offline use or carries a retired name', () => {
    for (const manifest of [staff, shop]) assert.doesNotMatch(JSON.stringify(manifest), new RegExp(`offline|business ?os|${escapeRegExp(record.shopAlias)}`, 'i'))
    for (const manifest of staticManifests) assert.doesNotMatch(JSON.stringify(manifest), new RegExp(`offline|${record.leak.source}`, 'i'))
  })

  test('the raw HTML head names no client: the Worker writes the shop in', () => {
    assert.match(indexHtml, /<title>Business OS<\/title>/)
    assert.match(indexHtml, /<meta name="apple-mobile-web-app-title" content="Business OS" \/>/)
    assert.doesNotMatch(indexHtml, record.leak)
  })

  test('neither manifest names the other host\'s icons', () => {
    assert.ok(staff.icons.length > 0 && shop.icons.length > 0, 'both manifests list icons')
    for (const icon of staff.icons) assert.doesNotMatch(icon.src, record.leak, `staff manifest names shop icon ${icon.src}`)
    for (const icon of shop.icons) assert.ok(icon.src.startsWith(record.iconPrefix), `shop manifest names non-shop icon ${icon.src}`)
  })

  test('every manifest icon ships at the size it declares', () => {
    // A client's own art is committed in frontend/public only for the client whose art the icon ledger lists;
    // another client's shop icons are held to the declared type and square sizes instead.
    const shipped = [...staff.icons, ...(shipsIcons ? shop.icons : []), ...staticManifests.flatMap((manifest) => manifest.icons)]
    for (const icon of shipped) {
      assert.equal(icon.type, 'image/png', icon.src)
      assert.ok(fs.existsSync(publicFile(icon.src)), `${icon.src} is missing from frontend/public`)
      const { width, height } = pngSize(publicFile(icon.src))
      assert.equal(`${width}x${height}`, icon.sizes, icon.src)
    }
    if (!shipsIcons) {
      for (const icon of shop.icons) {
        assert.equal(icon.type, 'image/png', icon.src)
        assert.match(icon.sizes, /^(192x192|512x512)$/, icon.src)
      }
    }
  })

  // --- the host rule: bootstrap, React router and Worker agree ----------------

  const HOSTNAMES = [
    record.adminHost,
    record.shopHost,
    record.wwwHost,
    record.lookalikeAdmin,
    'localhost',
    '127.0.0.1',
    '[::1]',
    'admin.example.test',
    SECOND_SHOP_HOST,
    SECOND_STAFF_HOST,
    'Second-Admin.shops-sub.workers.dev',
    'admin.shops-sub.workers.dev',
    `${SECOND_STAFF_HOST}.evil.com`,
    `x${SECOND_STAFF_HOST}`,
    `${SECOND_STAFF_HOST}.`,
  ]

  test('the browser\'s IPv6 loopback spelling "[::1]" is a staff host everywhere', () => {
    assert.equal(new URL('http://[::1]:5173/').hostname, '[::1]', 'this is the spelling location.hostname reports')
    assert.equal(routerSaysAdminHost('[::1]'), true, 'pathRouting.ts')
    assert.equal(bootstrapHead('[::1]', UNKNOWN_PATH, client).manifest, '/manifest.json', 'index.html bootstrap')
  })

  test('React uses the same host predicate the bootstrap does', () => {
    assert.equal(typeof pathRouting.isAdminHostname, 'function', 'pathRouting.ts exports isAdminHostname')
    for (const hostname of HOSTNAMES) {
      const bootstrapAdmin = bootstrapHead(hostname, UNKNOWN_PATH, secondShop).manifest === '/manifest.json'
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

  test('the Worker (API gate and document identity), the bootstrap and the router agree on every host', () => {
    for (const hostname of HOSTNAMES) {
      const worker = workerSaysStaff(hostname.toLowerCase(), secondShop.staffHost)
      assert.equal(routerSaysAdminHost(hostname), worker, `${hostname}: Worker and router disagree`)
      assert.equal(bootstrapHead(hostname.toLowerCase(), UNKNOWN_PATH, secondShop).manifest === '/manifest.json', worker, `${hostname}: Worker and bootstrap disagree`)
    }
  })

  test('the configured staff host is staff; the public host, look-alikes and an unset var are not', () => {
    assert.equal(secondShop.staffHost, SECOND_STAFF_HOST)
    assert.equal(client.staffHost, record.adminHost, `${record.id}'s staff host comes from its BUSINESS_OS_ADMIN_URL`)
    assert.equal(workerSaysStaff(SECOND_STAFF_HOST, secondShop.staffHost), true)
    for (const hostname of [SECOND_SHOP_HOST, `${SECOND_STAFF_HOST}.evil.com`, `x${SECOND_STAFF_HOST}`, `${SECOND_STAFF_HOST}.`, 'admin-second.shops-sub.workers.dev']) {
      assert.equal(workerSaysStaff(hostname, secondShop.staffHost), false, `${hostname} must be the storefront`)
      assert.equal(routerSaysAdminHost(hostname), false, `${hostname} must be the storefront in the page`)
    }
    assert.equal(workerSaysStaff(SECOND_STAFF_HOST, resolveClientIdentity({}).staffHost), false, 'unset: no configured staff host')
    assert.equal(workerSaysStaff(SECOND_STAFF_HOST), false, 'no staff host passed')
    for (const [adminUrl, publicUrl] of [
      [`https://${SECOND_SHOP_HOST}`, `https://${SECOND_SHOP_HOST}`],
      [`https://www.${SECOND_SHOP_HOST}/`, `https://${SECOND_SHOP_HOST}`],
      [`ftp://${SECOND_STAFF_HOST}`, `https://${SECOND_SHOP_HOST}`],
      ['not a url', `https://${SECOND_SHOP_HOST}`],
    ]) {
      const identity = resolveClientIdentity({ BUSINESS_OS_ADMIN_URL: adminUrl, BUSINESS_OS_PUBLIC_URL: publicUrl })
      assert.equal(identity.staffHost, '', `${adminUrl}: the public host (or an unusable URL) never becomes a staff host`)
      assert.equal(workerSaysStaff(SECOND_SHOP_HOST, identity.staffHost), false, `${adminUrl}: the shop stays the storefront`)
    }
  })

  test('the head the bootstrap writes matches each host\'s manifest', () => {
    const staticThemeColor = /<meta name="theme-color" content="([^"]+)"/.exec(indexHtml.split('<script>')[0])?.[1]
    assert.equal(staticThemeColor, shop.theme_color, 'the raw HTML is storefront-first, colour included')
    for (const [hostname, manifest, href] of [
      [record.shopHost, shop, '/portal-manifest.json'],
      [record.adminHost, staff, '/manifest.json'],
    ] as const) {
      const head = bootstrapHead(hostname, UNKNOWN_PATH, client)
      assert.equal(head.manifest, href, hostname)
      assert.equal(head.themeColor, manifest.theme_color, hostname)
      assert.equal(head.title, manifest.name, hostname)
    }
  })
}

for (const client of shopClients('pwaIdentity.test', "Leang's install names, hosts and shipped shop icons")) pwaIdentity(client)

if (failed > 0) {
  console.error(`\npwaIdentity: ${failed} failed`)
  process.exit(1)
}
console.log('\npwaIdentity: all passed')
