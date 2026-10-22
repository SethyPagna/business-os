#!/usr/bin/env node
// Which client is this deployment? src/lib/clientIdentity.ts turns optional
// wrangler [vars] into the one identity object the Worker writes into every
// document, both install manifests, the AI persona, the membership prefix and
// the staff app's authenticator label. One build serves Leang Cosmetics and BM
// Shop, so the contract is: every var unset is the neutral Business OS (never
// a client), Leang's own vars reproduce what the code hard-coded before Oct 22
// 2026, and a malformed var falls back to something safe instead of reaching
// a SQLite GLOB, a URL or an HTML page.
//
// Runs the REAL module (transpiled). Leang's values come from wrangler.toml;
// the expected strings below are frozen from the pre-change code.
//
// Run (from cloudflare/): node scripts/test-client-identity-pure.cjs
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const { wranglerVars } = require('./harness/wrangler_vars.cjs')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'clientIdentity.ts')
const moduleObj = { exports: {} }
new Function('exports', 'require', 'module', ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: sourcePath,
}).outputText)(moduleObj.exports, require, moduleObj)
const {
  resolveClientIdentity, membershipPrefixFrom, clientIdentityJson, staffManifest, shopManifest,
  NEUTRAL_CLIENT_IDENTITY, STAFF_ICONS, MANIFEST_ROUTES,
} = moduleObj.exports

let checks = 0
const check = (label, fn) => { fn(); checks += 1; process.stdout.write('  ok  ' + label + '\n') }

// --- the neutral identity ---------------------------------------------------

const NEUTRAL_ICONS = {
  favicon: '/admin-favicon-v1.ico',
  icon192: '/icon-192.png',
  icon512: '/icon-512.png',
  maskable192: '/icon-192-maskable-v2.png',
  maskable512: '/icon-512-maskable-v2.png',
  appleTouch: '/admin-apple-touch-icon-v1.png',
}

check('with no vars at all the identity is the neutral Business OS, never a client', () => {
  assert.deepStrictEqual(resolveClientIdentity({}), {
    shopName: 'Business OS',
    shopNameKm: 'Business OS',
    shopAlias: '',
    shopNames: 'Business OS',
    shopCategory: '',
    shopDescription: 'Browse Business OS products and contact the store.',
    adminTitle: 'Business OS Admin',
    adminShortName: 'Business OS Admin',
    adminDescription: 'Till, stock and sales for Business OS staff',
    organizationName: 'Business OS',
    membershipPrefix: 'M-',
    staffHost: '',
    shopIcons: NEUTRAL_ICONS,
  })
  assert.deepStrictEqual(NEUTRAL_CLIENT_IDENTITY, resolveClientIdentity({}))
  assert.deepStrictEqual(STAFF_ICONS, NEUTRAL_ICONS)
  assert.doesNotMatch(JSON.stringify(resolveClientIdentity({})), /leang|bm shop/i)
})

check('blank, whitespace and null vars count as unset', () => {
  for (const blank of ['', '   ', '\t\n', null, undefined]) {
    const env = {
      BUSINESS_OS_SHOP_NAME: blank, BUSINESS_OS_SHOP_NAME_KM: blank, BUSINESS_OS_SHOP_ALIAS: blank,
      BUSINESS_OS_SHOP_CATEGORY: blank, BUSINESS_OS_SHOP_ICON_PREFIX: blank, BUSINESS_OS_ADMIN_SHORT_NAME: blank,
      BUSINESS_OS_ORGANIZATION_NAME: blank, BUSINESS_OS_MEMBERSHIP_PREFIX: blank,
    }
    assert.deepStrictEqual(resolveClientIdentity(env), NEUTRAL_CLIENT_IDENTITY, JSON.stringify(blank))
  }
})

// --- Leang Cosmetics --------------------------------------------------------

// What the code said before the identity was configurable: the strings in
// routes/portal.ts, routes/auth.ts, lib/portalAccounts.ts, lib/adminDocumentIdentity.ts
// and the two manifests at 30fef7c2f. The Khmer name is the wrangler.toml value.
const LEANG = {
  shopName: 'Leang Cosmetics',
  shopNameKm: '\u179b\u17b6\u1784\u0020\u1780\u17bc\u179f\u17d2\u1798\u17c1\u1792\u17b8\u1780',
  shopAlias: 'Leang Beauty',
  shopNames: 'Leang Cosmetics/Leang Beauty',
  shopCategory: 'beauty',
  shopDescription: 'Browse Leang Cosmetics products and contact the store.',
  adminTitle: 'Leang Cosmetics Admin',
  adminShortName: 'Leang Admin',
  adminDescription: 'Till, stock and sales for Leang Cosmetics staff',
  organizationName: 'LeangBeauty',
  membershipPrefix: 'LC-',
  staffHost: 'admin.leangbeauty.com',
  shopIcons: {
    favicon: '/leang-cosmetics-favicon-v2.ico',
    icon192: '/leang-cosmetics-icon-192-v2.png',
    icon512: '/leang-cosmetics-icon-512-v2.png',
    maskable192: '/leang-cosmetics-icon-192-maskable-v2.png',
    maskable512: '/leang-cosmetics-icon-512-maskable-v2.png',
    appleTouch: '/leang-cosmetics-apple-touch-icon-v2.png',
  },
}

check('wrangler.toml\'s vars resolve to exactly the Leang strings the code used to hard-code', () => {
  assert.deepStrictEqual(resolveClientIdentity(wranglerVars('wrangler.toml')), LEANG)
})

check('wrangler.free.toml resolves to the same identity as wrangler.toml', () => {
  assert.deepStrictEqual(resolveClientIdentity(wranglerVars('wrangler.free.toml')), LEANG)
})

// --- one field at a time ----------------------------------------------------

check('the admin title, description and short name follow the shop name', () => {
  const identity = resolveClientIdentity({ BUSINESS_OS_SHOP_NAME: 'BM Shop' })
  assert.strictEqual(identity.adminTitle, 'BM Shop Admin')
  assert.strictEqual(identity.adminShortName, 'BM Shop Admin', 'no short name configured: the full admin title')
  assert.strictEqual(identity.adminDescription, 'Till, stock and sales for BM Shop staff')
  assert.strictEqual(identity.shopDescription, 'Browse BM Shop products and contact the store.')
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_NAME: 'BM Shop', BUSINESS_OS_ADMIN_SHORT_NAME: 'BM Admin' }).adminShortName, 'BM Admin')
})

check('values are trimmed', () => {
  const identity = resolveClientIdentity({ BUSINESS_OS_SHOP_NAME: '  BM Shop \n', BUSINESS_OS_ORGANIZATION_NAME: ' BM Org ', BUSINESS_OS_ADMIN_SHORT_NAME: ' BM Admin ' })
  assert.strictEqual(identity.shopName, 'BM Shop')
  assert.strictEqual(identity.organizationName, 'BM Org')
  assert.strictEqual(identity.adminShortName, 'BM Admin')
})

check('the Khmer name falls back to the shop name, so no screen is ever blank', () => {
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_NAME: 'BM Shop' }).shopNameKm, 'BM Shop')
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_NAME: 'BM Shop', BUSINESS_OS_SHOP_NAME_KM: '\u1794\u17ca\u17b8' }).shopNameKm, '\u1794\u17ca\u17b8')
})

check('an alias makes "Name/Alias" and is exposed on its own; none, or a blank one, leaves the plain name', () => {
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_ALIAS: '  Leang Beauty ' }).shopAlias, 'Leang Beauty', 'trimmed')
  for (const none of [undefined, null, '', '  ']) assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_ALIAS: none }).shopAlias, '', JSON.stringify(none))
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_NAME: 'Leang Cosmetics', BUSINESS_OS_SHOP_ALIAS: 'Leang Beauty' }).shopNames, 'Leang Cosmetics/Leang Beauty')
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_NAME: 'Leang Cosmetics' }).shopNames, 'Leang Cosmetics')
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_NAME: 'Leang Cosmetics', BUSINESS_OS_SHOP_ALIAS: '  ' }).shopNames, 'Leang Cosmetics')
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_ALIAS: 'Alias' }).shopNames, 'Business OS/Alias', 'an alias on the neutral name is still joined, not dropped')
})

check('the category is "beauty" or nothing, whatever the case or spacing', () => {
  for (const beauty of ['beauty', 'Beauty', 'BEAUTY', '  beauty ', 'bEaUtY']) {
    assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_CATEGORY: beauty }).shopCategory, 'beauty', JSON.stringify(beauty))
  }
  for (const other of ['', 'cosmetics', 'beauty-salon', 'beauty shop', 'electronics', 'general', '1', 'true', undefined, null]) {
    assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_CATEGORY: other }).shopCategory, '', JSON.stringify(other))
  }
})

// --- the membership prefix: it reaches a SQLite GLOB ------------------------

check('a valid membership prefix is upper-cased and kept', () => {
  assert.strictEqual(membershipPrefixFrom('lc-'), 'LC-')
  assert.strictEqual(membershipPrefixFrom('LC-'), 'LC-')
  assert.strictEqual(membershipPrefixFrom('  bm- '), 'BM-', 'trimmed')
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_MEMBERSHIP_PREFIX: 'lc-' }).membershipPrefix, 'LC-')
  for (const valid of ['M-', 'BM-', 'SHOP1-', 'A12345-']) assert.strictEqual(membershipPrefixFrom(valid), valid, valid)
})

check('an invalid membership prefix falls back to M-, so nothing unsafe reaches the GLOB', () => {
  const invalid = [
    'lc', 'LC', '', '   ', null, undefined,    // no trailing hyphen / unset
    'L*-', 'L?-', 'L[C]-', 'L]-', "L'-", 'L"-', 'L C-', 'L;-', 'L%-', 'L_-', // GLOB, quote and SQL characters
    'TOOLONGX-', 'A123456-',                     // longer than six before the hyphen
    '-', '1A-', '--', 'LC--', 'LC-1', 'L\u00c9-', // no leading letter, double hyphen, trailing text, non-ASCII
    '\uff2c\uff23-',                             // full-width letters are not A-Z
  ]
  for (const value of invalid) {
    assert.strictEqual(membershipPrefixFrom(value), 'M-', JSON.stringify(value))
    assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_MEMBERSHIP_PREFIX: value }).membershipPrefix, 'M-', 'resolve: ' + JSON.stringify(value))
  }
})

// --- the staff host: which host serves the staff app ------------------------

check('the staff host is the host of BUSINESS_OS_ADMIN_URL, lower-cased, without scheme, path or port', () => {
  const staffHost = (admin, pub) => resolveClientIdentity({ BUSINESS_OS_ADMIN_URL: admin, BUSINESS_OS_PUBLIC_URL: pub }).staffHost
  assert.strictEqual(staffHost('https://admin.leangbeauty.com', 'https://leangbeauty.com'), 'admin.leangbeauty.com')
  assert.strictEqual(staffHost('https://BM-Admin.KhShop.workers.dev/some/path?x=1', 'https://bmshop.khshop.workers.dev'), 'bm-admin.khshop.workers.dev')
  assert.strictEqual(staffHost('http://localhost:8787', 'https://shop.example'), 'localhost', 'a port is not part of a hostname')
  assert.strictEqual(staffHost(' https://admin.example ', undefined), 'admin.example', 'trimmed; no public address configured')
})

check('an unusable admin address means no configured staff host', () => {
  for (const admin of [undefined, null, '', '   ', 'admin.example', 'not a url', 'ftp://admin.example', 'javascript:alert(1)', 'mailto:a@b.c']) {
    assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_ADMIN_URL: admin, BUSINESS_OS_PUBLIC_URL: 'https://shop.example' }).staffHost, '', JSON.stringify(admin))
  }
})

check('an admin address that is the public host counts as none, or the staff API would open on the storefront', () => {
  // A staff host equal to the public host would make every storefront request a staff request.
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_ADMIN_URL: 'https://shop.example', BUSINESS_OS_PUBLIC_URL: 'https://shop.example' }).staffHost, '')
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_ADMIN_URL: 'https://SHOP.example/admin', BUSINESS_OS_PUBLIC_URL: 'https://shop.example' }).staffHost, '', 'case and path do not hide it')
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_ADMIN_URL: 'https://www.shop.example', BUSINESS_OS_PUBLIC_URL: 'https://shop.example' }).staffHost, '', 'the www. alias of the public host too')
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_ADMIN_URL: 'https://admin.shop.example', BUSINESS_OS_PUBLIC_URL: 'https://shop.example' }).staffHost, 'admin.shop.example', 'a different host is kept')
})

// --- the shop's icons: they become <link href> and og:image -----------------

check('an icon prefix builds the six shop icon paths', () => {
  assert.deepStrictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_ICON_PREFIX: '/brand/shop-' }).shopIcons, {
    favicon: '/brand/shop-favicon-v2.ico',
    icon192: '/brand/shop-icon-192-v2.png',
    icon512: '/brand/shop-icon-512-v2.png',
    maskable192: '/brand/shop-icon-192-maskable-v2.png',
    maskable512: '/brand/shop-icon-512-maskable-v2.png',
    appleTouch: '/brand/shop-apple-touch-icon-v2.png',
  })
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_ICON_PREFIX: ' /p- ' }).shopIcons.favicon, '/p-favicon-v2.ico', 'trimmed')
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_ICON_PREFIX: '/' }).shopIcons.icon512, '/icon-512-v2.png', 'the site root is a prefix too')
})

check('an invalid icon prefix falls back to the staff icons, never into an attribute', () => {
  const invalid = [
    '', 'leang-', 'brand/', 'https://evil.example/', 'javascript:alert(1)//',   // not a site-relative path
    '//evil.example/', '//evil-',                                            // protocol-relative: another host
    '/a"b-', "/a'b-", '/a b-', '/a<b-', '/a>b-', '/a\\b-', '/a?b-', '/a#b-', '/a%20b-', '/a.b-', '/a\u00e9-', // characters that break out of or reshape a URL
    '/a\nb-', undefined, null,
  ]
  for (const value of invalid) {
    assert.deepStrictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_ICON_PREFIX: value }).shopIcons, NEUTRAL_ICONS, JSON.stringify(value))
  }
})

// --- the JSON block ---------------------------------------------------------

check('clientIdentityJson escapes every <, so no value can close the script element', () => {
  const identity = resolveClientIdentity({ BUSINESS_OS_SHOP_NAME: '</script><script>alert(1)</script><!-- a < b' })
  const json = clientIdentityJson(identity)
  assert.ok(!json.includes('<'), 'no raw <')
  assert.ok(json.includes('\\u003c/script>'), 'escaped, not dropped')
  assert.strictEqual(JSON.parse(json).shopName, '</script><script>alert(1)</script><!-- a < b', 'the value survives the round trip')
  assert.deepStrictEqual(JSON.parse(json), identity)
})

check('clientIdentityJson leaves an ordinary identity byte-identical to JSON.stringify', () => {
  for (const env of [{}, wranglerVars('wrangler.toml'), { BUSINESS_OS_SHOP_NAME: 'BM Shop & Co "quoted"' }]) {
    const identity = resolveClientIdentity(env)
    assert.strictEqual(clientIdentityJson(identity), JSON.stringify(identity))
  }
})

// --- no state leaks between deployments --------------------------------------

check('resolving one deployment never changes the next (no module-level cache)', () => {
  const bm = { BUSINESS_OS_SHOP_NAME: 'BM Shop', BUSINESS_OS_MEMBERSHIP_PREFIX: 'BM-' }
  const first = resolveClientIdentity(bm)
  resolveClientIdentity(wranglerVars('wrangler.toml'))
  assert.deepStrictEqual(resolveClientIdentity(bm), first)
  assert.deepStrictEqual(resolveClientIdentity({}), NEUTRAL_CLIENT_IDENTITY, 'and an empty env is still neutral after both')
  assert.deepStrictEqual(Object.keys(bm), ['BUSINESS_OS_SHOP_NAME', 'BUSINESS_OS_MEMBERSHIP_PREFIX'], 'the env is not written to')
})

// --- no client literal in Worker code ----------------------------------------

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

check('no line of Worker code names Leang, its LC- numbers or LCMN- ids, outside three pinned historical uses', () => {
  // The identity is configuration now (Oct 22 2026). A literal in code would
  // quietly give the second client the first one's name or number format --
  // the exact thing the client identity exists to prevent -- and none of the
  // route tests would notice while Leang's own vars are in the fixture.
  // Comment-only lines are skipped (they explain the history). What remains is
  // history, not identity:
  const HISTORICAL = {
    // PREVIOUS_IDENTITIES: the slug the organization row was renamed from.
    'lib/coreDataInvariants.ts': 1,
    // The retired hosts a stored override is rejected for (Sep 26 2026).
    'routes/portal.ts': 5,
    // A one-off repair of one Leang customer (LC-04971).
    'lib/generalCustomerMembershipRepair.ts': 1,
  }
  const root = path.join(__dirname, '..', 'src')
  const found = {}
  for (const file of sourceFiles(root)) {
    const relative = path.relative(root, file).split(path.sep).join('/')
    fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n').forEach((line, index) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
      if (/leang|\bLC-|LCMN/i.test(line)) (found[relative] = found[relative] || []).push((index + 1) + ': ' + line.trim().slice(0, 100))
    })
  }
  const counts = Object.fromEntries(Object.entries(found).map(([file, lines]) => [file, lines.length]))
  assert.deepStrictEqual(counts, HISTORICAL, 'a client literal appeared in Worker code (or an allowed one moved): ' + JSON.stringify(found, null, 1))
})

// --- the two install manifests ----------------------------------------------

const icons = (set) => [
  { src: set.icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: set.maskable192, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
  { src: set.icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: set.maskable512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]

check('the staff manifest names the staff app and always wears the staff icons', () => {
  const manifest = staffManifest(resolveClientIdentity(wranglerVars('wrangler.toml')))
  assert.deepStrictEqual(manifest, {
    name: 'Leang Cosmetics Admin',
    short_name: 'Leang Admin',
    description: 'Till, stock and sales for Leang Cosmetics staff',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f4f1ea',
    theme_color: '#fffdf8',
    icons: icons({ icon192: '/icon-192.png', maskable192: '/icon-192-maskable-v2.png', icon512: '/icon-512.png', maskable512: '/icon-512-maskable-v2.png' }),
  })
  assert.doesNotMatch(JSON.stringify(manifest.icons), /leang/i, 'the shop\'s artwork never installs as the staff app')
})

check('the shop manifest names the shop and wears the shop\'s icons', () => {
  assert.deepStrictEqual(shopManifest(resolveClientIdentity(wranglerVars('wrangler.toml'))), {
    name: 'Leang Cosmetics',
    short_name: 'Leang Cosmetics',
    description: 'Browse Leang Cosmetics products and contact the store.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: icons(LEANG.shopIcons),
  })
  const bm = shopManifest(resolveClientIdentity({ BUSINESS_OS_SHOP_NAME: 'BM Shop' }))
  assert.deepStrictEqual(bm.icons, icons(NEUTRAL_ICONS), 'no icon prefix: the staff artwork')
  assert.strictEqual(bm.name, 'BM Shop')
})

check('MANIFEST_ROUTES maps each install manifest path to its builder', () => {
  assert.deepStrictEqual(Object.keys(MANIFEST_ROUTES), ['/manifest.json', '/portal-manifest.json'])
  assert.strictEqual(MANIFEST_ROUTES['/manifest.json'], staffManifest)
  assert.strictEqual(MANIFEST_ROUTES['/portal-manifest.json'], shopManifest)
})

process.stdout.write('\nclient identity: ' + checks + ' checks passed\n')
