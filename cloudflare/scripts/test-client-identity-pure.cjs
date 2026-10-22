#!/usr/bin/env node
// Which client is this deployment? src/lib/clientIdentity.ts turns optional
// wrangler [vars] into the one identity object the Worker writes into every
// document, both install manifests, the AI persona, the membership prefix and
// the staff app's authenticator label. One build serves every client, so the
// contract is: every var unset is the neutral Business OS (never a client), a
// client's own vars reproduce what the code hard-coded before Oct 22 2026, and
// a malformed var falls back to something safe instead of reaching a SQLite
// GLOB, a URL or an HTML page.
//
// Runs the REAL module (transpiled). The structural checks read the neutral
// Example Shop fixture (harness/wrangler_vars.cjs: the committed template
// rendered with clients/example.env), so they run everywhere. Leang Cosmetics'
// own values come from the private Records/Clients/leang.env where this
// machine has it; the expected strings below are frozen from the pre-change
// code, and those pins print SKIP where the file is absent.
//
// Run (from cloudflare/): node scripts/test-client-identity-pure.cjs
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const { wranglerVars, leangVars, hasLeang, skipLeang } = require('./harness/wrangler_vars.cjs')

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
  assert.doesNotMatch(JSON.stringify(resolveClientIdentity({})), /leang|example|second shop/i)
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

// The neutral fixture client (rendered_wrangler.cjs identity on clients/example.env's addresses), written out by
// hand in Leang's shape: a name, its Khmer spelling, an alias, a category, an icon prefix, a staff name, a prefix.
const EXAMPLE = {
  shopName: 'Example Shop',
  shopNameKm: '\u17a0\u17b6\u1784\u1782\u17c6\u179a\u17bc',
  shopAlias: 'Example Cosmetics',
  shopNames: 'Example Shop/Example Cosmetics',
  shopCategory: 'beauty',
  shopDescription: 'Browse Example Shop products and contact the store.',
  adminTitle: 'Example Shop Admin',
  adminShortName: 'Ex Admin',
  adminDescription: 'Till, stock and sales for Example Shop staff',
  organizationName: 'Example Shop',
  membershipPrefix: 'EX-',
  staffHost: 'admin.example.com',
  shopIcons: {
    favicon: '/example-shop-favicon-v2.ico',
    icon192: '/example-shop-icon-192-v2.png',
    icon512: '/example-shop-icon-512-v2.png',
    maskable192: '/example-shop-icon-192-maskable-v2.png',
    maskable512: '/example-shop-icon-512-maskable-v2.png',
    appleTouch: '/example-shop-apple-touch-icon-v2.png',
  },
}

check('the fixture client\'s vars resolve to exactly the identity written out by hand, in both configs', () => {
  assert.deepStrictEqual(resolveClientIdentity(wranglerVars('wrangler.toml')), EXAMPLE)
  assert.deepStrictEqual(resolveClientIdentity(wranglerVars('wrangler.free.toml')), EXAMPLE, 'wrangler.free.toml resolves to the same identity as wrangler.toml')
})

if (hasLeang()) {
  check('Leang\'s vars (the private render of wrangler.toml) resolve to exactly the Leang strings the code used to hard-code', () => {
    assert.deepStrictEqual(resolveClientIdentity(leangVars('wrangler.toml')), LEANG)
  })

  check('Leang\'s free-plan render resolves to the same identity as its paid one', () => {
    assert.deepStrictEqual(resolveClientIdentity(leangVars('wrangler.free.toml')), LEANG)
  })
} else {
  skipLeang('test-client-identity-pure', 'Leang\'s vars resolving to the strings the code used to hard-code')
}

// --- one field at a time ----------------------------------------------------

check('the admin title, description and short name follow the shop name', () => {
  const identity = resolveClientIdentity({ BUSINESS_OS_SHOP_NAME: 'Second Shop' })
  assert.strictEqual(identity.adminTitle, 'Second Shop Admin')
  assert.strictEqual(identity.adminShortName, 'Second Shop Admin', 'no short name configured: the full admin title')
  assert.strictEqual(identity.adminDescription, 'Till, stock and sales for Second Shop staff')
  assert.strictEqual(identity.shopDescription, 'Browse Second Shop products and contact the store.')
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_NAME: 'Second Shop', BUSINESS_OS_ADMIN_SHORT_NAME: 'Second Admin' }).adminShortName, 'Second Admin')
})

check('values are trimmed', () => {
  const identity = resolveClientIdentity({ BUSINESS_OS_SHOP_NAME: '  Second Shop \n', BUSINESS_OS_ORGANIZATION_NAME: ' Second Org ', BUSINESS_OS_ADMIN_SHORT_NAME: ' Second Admin ' })
  assert.strictEqual(identity.shopName, 'Second Shop')
  assert.strictEqual(identity.organizationName, 'Second Org')
  assert.strictEqual(identity.adminShortName, 'Second Admin')
})

check('the Khmer name falls back to the shop name, so no screen is ever blank', () => {
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_NAME: 'Second Shop' }).shopNameKm, 'Second Shop')
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_NAME: 'Second Shop', BUSINESS_OS_SHOP_NAME_KM: '\u1794\u17ca\u17b8' }).shopNameKm, '\u1794\u17ca\u17b8')
})

check('an alias makes "Name/Alias" and is exposed on its own; none, or a blank one, leaves the plain name', () => {
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_ALIAS: '  Example Cosmetics ' }).shopAlias, 'Example Cosmetics', 'trimmed')
  for (const none of [undefined, null, '', '  ']) assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_ALIAS: none }).shopAlias, '', JSON.stringify(none))
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_NAME: 'Example Shop', BUSINESS_OS_SHOP_ALIAS: 'Example Cosmetics' }).shopNames, 'Example Shop/Example Cosmetics')
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_NAME: 'Example Shop' }).shopNames, 'Example Shop')
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_SHOP_NAME: 'Example Shop', BUSINESS_OS_SHOP_ALIAS: '  ' }).shopNames, 'Example Shop')
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
  assert.strictEqual(membershipPrefixFrom('ex-'), 'EX-')
  assert.strictEqual(membershipPrefixFrom('EX-'), 'EX-')
  assert.strictEqual(membershipPrefixFrom('  sm- '), 'SM-', 'trimmed')
  assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_MEMBERSHIP_PREFIX: 'ex-' }).membershipPrefix, 'EX-')
  for (const valid of ['M-', 'SM-', 'SHOP1-', 'A12345-']) assert.strictEqual(membershipPrefixFrom(valid), valid, valid)
})

check('an invalid membership prefix falls back to M-, so nothing unsafe reaches the GLOB', () => {
  const invalid = [
    'ex', 'EX', '', '   ', null, undefined,    // no trailing hyphen / unset
    'E*-', 'E?-', 'E[X]-', 'E]-', "E'-", 'E"-', 'E X-', 'E;-', 'E%-', 'E_-', // GLOB, quote and SQL characters
    'TOOLONGX-', 'A123456-',                     // longer than six before the hyphen
    '-', '1A-', '--', 'EX--', 'EX-1', 'E\u00c9-', // no leading letter, double hyphen, trailing text, non-ASCII
    '\uff25\uff38-',                             // full-width letters are not A-Z
  ]
  for (const value of invalid) {
    assert.strictEqual(membershipPrefixFrom(value), 'M-', JSON.stringify(value))
    assert.strictEqual(resolveClientIdentity({ BUSINESS_OS_MEMBERSHIP_PREFIX: value }).membershipPrefix, 'M-', 'resolve: ' + JSON.stringify(value))
  }
})

// --- the staff host: which host serves the staff app ------------------------

check('the staff host is the host of BUSINESS_OS_ADMIN_URL, lower-cased, without scheme, path or port', () => {
  const staffHost = (admin, pub) => resolveClientIdentity({ BUSINESS_OS_ADMIN_URL: admin, BUSINESS_OS_PUBLIC_URL: pub }).staffHost
  assert.strictEqual(staffHost('https://admin.example.com', 'https://example.com'), 'admin.example.com')
  assert.strictEqual(staffHost('https://Second-Admin.Sub-Example.workers.dev/some/path?x=1', 'https://second.sub-example.workers.dev'), 'second-admin.sub-example.workers.dev')
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
  for (const env of [{}, wranglerVars('wrangler.toml'), { BUSINESS_OS_SHOP_NAME: 'Second Shop & Co "quoted"' }]) {
    const identity = resolveClientIdentity(env)
    assert.strictEqual(clientIdentityJson(identity), JSON.stringify(identity))
  }
})

// --- no state leaks between deployments --------------------------------------

check('resolving one deployment never changes the next (no module-level cache)', () => {
  const second = { BUSINESS_OS_SHOP_NAME: 'Second Shop', BUSINESS_OS_MEMBERSHIP_PREFIX: 'SM-' }
  const first = resolveClientIdentity(second)
  resolveClientIdentity(wranglerVars('wrangler.toml'))
  assert.deepStrictEqual(resolveClientIdentity(second), first)
  assert.deepStrictEqual(resolveClientIdentity({}), NEUTRAL_CLIENT_IDENTITY, 'and an empty env is still neutral after both')
  assert.deepStrictEqual(Object.keys(second), ['BUSINESS_OS_SHOP_NAME', 'BUSINESS_OS_MEMBERSHIP_PREFIX'], 'the env is not written to')
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
    // PREVIOUS_IDENTITIES: the two slugs the organization row was renamed from ('leangcosmetics', the Aug 2026
    // rename, and 'leang-cosmetics', what migration 0030 seeded into every new database before 22 Oct 2026; the
    // second joined with 6.0.957, so a database seeded then is still adopted in place).
    'lib/coreDataInvariants.ts': 2,
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

// The manifests a client's identity must produce, written out from the client's frozen strings: the staff app is
// named and described by the admin fields and wears the staff artwork; the shop is named by the shop fields and
// wears the shop's icons.
const staffExpected = (client) => ({
  name: client.adminTitle,
  short_name: client.adminShortName,
  description: client.adminDescription,
  id: '/',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#f4f1ea',
  theme_color: '#fffdf8',
  icons: icons({ icon192: '/icon-192.png', maskable192: '/icon-192-maskable-v2.png', icon512: '/icon-512.png', maskable512: '/icon-512-maskable-v2.png' }),
})
const shopExpected = (client) => ({
  name: client.shopName,
  short_name: client.shopName,
  description: client.shopDescription,
  id: '/',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#ffffff',
  theme_color: '#ffffff',
  icons: icons(client.shopIcons),
})

check('the staff manifest names the staff app and always wears the staff icons', () => {
  const manifest = staffManifest(resolveClientIdentity(wranglerVars('wrangler.toml')))
  assert.deepStrictEqual(manifest, staffExpected(EXAMPLE))
  assert.doesNotMatch(JSON.stringify(manifest.icons), /example-shop/, 'the shop\'s artwork never installs as the staff app')
})

check('the shop manifest names the shop and wears the shop\'s icons', () => {
  assert.deepStrictEqual(shopManifest(resolveClientIdentity(wranglerVars('wrangler.toml'))), shopExpected(EXAMPLE))
  const second = shopManifest(resolveClientIdentity({ BUSINESS_OS_SHOP_NAME: 'Second Shop' }))
  assert.deepStrictEqual(second.icons, icons(NEUTRAL_ICONS), 'no icon prefix: the staff artwork')
  assert.strictEqual(second.name, 'Second Shop')
})

if (hasLeang()) {
  check('Leang\'s staff manifest is the one the static file carried (name, short name, description, staff icons)', () => {
    const manifest = staffManifest(resolveClientIdentity(leangVars('wrangler.toml')))
    assert.deepStrictEqual(manifest, staffExpected(LEANG))
    assert.strictEqual(manifest.name, 'Leang Cosmetics Admin')
    assert.strictEqual(manifest.short_name, 'Leang Admin')
    assert.doesNotMatch(JSON.stringify(manifest.icons), /leang/i, 'the shop\'s artwork never installs as the staff app')
  })

  check('Leang\'s shop manifest is the one the static file carried (name, description, the shop icons)', () => {
    assert.deepStrictEqual(shopManifest(resolveClientIdentity(leangVars('wrangler.toml'))), shopExpected(LEANG))
  })
} else {
  skipLeang('test-client-identity-pure', 'Leang\'s two install manifests')
}

check('MANIFEST_ROUTES maps each install manifest path to its builder', () => {
  assert.deepStrictEqual(Object.keys(MANIFEST_ROUTES), ['/manifest.json', '/portal-manifest.json'])
  assert.strictEqual(MANIFEST_ROUTES['/manifest.json'], staffManifest)
  assert.strictEqual(MANIFEST_ROUTES['/portal-manifest.json'], shopManifest)
})

process.stdout.write('\nclient identity: ' + checks + ' checks passed\n')
