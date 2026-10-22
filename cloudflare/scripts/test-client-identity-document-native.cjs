'use strict'
// The REAL Worker (src/index.ts, bundled with esbuild, run in workerd by
// Miniflare) serving the REAL frontend/index.html through its document
// handler, under two deployments' [vars]:
//
//   Leang Cosmetics (cloudflare/wrangler.toml) must serve byte-for-byte the
//   identity it served before the identity moved into configuration: the
//   head values the static index.html carried for the shop host, the values
//   the old admin rewrite wrote for the staff host, and the two manifests
//   public/ used to ship. Those values are frozen below as literals.
//
//   BM Shop (another client, its own [vars]) must serve no Leang name, icon
//   or leangbeauty.com URL on either host, in the document or the manifests.
//
// HTMLRewriter only exists inside workerd, which is why this is native.
//
// Run (from cloudflare/): node scripts/test-client-identity-document-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const indexHtml = fs.readFileSync(path.join(root, '..', 'frontend', 'index.html'), 'utf8')

function tomlVars(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const vars = {}
  for (const match of text.slice(text.indexOf('\n[vars]\n')).matchAll(/^([A-Z][A-Z0-9_]*) = "([^"]*)"$/gm)) vars[match[1]] = match[2]
  return vars
}

const LEANG_VARS = tomlVars(path.join(root, 'wrangler.toml'))
// BM Shop's URL scheme (owner, 22 Oct 2026): the shop at bm.khshop.workers.dev,
// staff at bm-admin.khshop.workers.dev, whose forwarder Worker hands requests to
// this one with the host preserved.
const BM_SHOP_HOST = 'bm.khshop.workers.dev'
const BM_STAFF_HOST = 'bm-admin.khshop.workers.dev'
const BM_SHOP_VARS = {
  PLAN_TIER: 'free',
  BUSINESS_OS_PUBLIC_URL: `https://${BM_SHOP_HOST}`,
  BUSINESS_OS_ADMIN_URL: `https://${BM_STAFF_HOST}`,
  BUSINESS_OS_ORGANIZATION_SLUG: 'bmshop',
  BUSINESS_OS_ORGANIZATION_NAME: 'BM Shop',
  BUSINESS_OS_SHOP_NAME: 'BM Shop',
  BUSINESS_OS_MEMBERSHIP_PREFIX: 'BM-',
}

// frontend/index.html's static head at 30fef7c2f, before the identity moved.
const LEANG_SHOP_HEAD = {
  title: 'Leang Cosmetics',
  'meta name=description': 'Browse Leang Cosmetics products and contact the store.',
  'meta name=apple-mobile-web-app-title': 'Leang Cosmetics',
  'meta name=theme-color': '#ffffff',
  'meta name=viewport': 'width=device-width, initial-scale=1, viewport-fit=cover',
  'meta property=og:site_name': 'Leang Cosmetics',
  'meta property=og:title': 'Leang Cosmetics',
  'meta property=og:description': 'Browse Leang Cosmetics products and contact the store.',
  'meta property=og:url': 'https://leangbeauty.com/',
  'meta property=og:image': 'https://leangbeauty.com/leang-cosmetics-icon-512-v2.png',
  'link rel=canonical': 'https://leangbeauty.com/',
  'link rel=manifest': '/portal-manifest.json',
  'link rel=icon': '/leang-cosmetics-favicon-v2.ico',
  'link rel=icon 192x192': '/leang-cosmetics-icon-192-v2.png',
  'link rel=icon 512x512': '/leang-cosmetics-icon-512-v2.png',
  'link rel=apple-touch-icon': '/leang-cosmetics-apple-touch-icon-v2.png',
}
// What the admin-host rewrite wrote at 30fef7c2f.
const LEANG_STAFF_HEAD = {
  title: 'Leang Cosmetics Admin',
  'meta name=description': 'Till, stock and sales for Leang Cosmetics staff',
  'meta name=apple-mobile-web-app-title': 'Leang Admin',
  'meta name=theme-color': '#fffdf8',
  'meta name=viewport': 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
  'meta property=og:site_name': 'Leang Cosmetics Admin',
  'meta property=og:title': 'Leang Cosmetics Admin',
  'meta property=og:description': 'Till, stock and sales for Leang Cosmetics staff',
  'meta property=og:url': '/',
  'meta property=og:image': '/icon-512.png',
  'link rel=canonical': '/',
  'link rel=manifest': '/manifest.json',
  'link rel=icon': '/admin-favicon-v1.ico',
  'link rel=icon 192x192': '/icon-192.png',
  'link rel=icon 512x512': '/icon-512.png',
  'link rel=apple-touch-icon': '/admin-apple-touch-icon-v1.png',
}
const ICONS = (i192, m192, i512, m512) => [
  { src: i192, sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: m192, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
  { src: i512, sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: m512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]
// frontend/public/manifest.json and portal-manifest.json at 30fef7c2f.
const LEANG_STAFF_MANIFEST = {
  name: 'Leang Cosmetics Admin', short_name: 'Leang Admin', description: 'Till, stock and sales for Leang Cosmetics staff',
  id: '/', start_url: '/', scope: '/', display: 'standalone', background_color: '#f4f1ea', theme_color: '#fffdf8',
  icons: ICONS('/icon-192.png', '/icon-192-maskable-v2.png', '/icon-512.png', '/icon-512-maskable-v2.png'),
}
const LEANG_SHOP_MANIFEST = {
  name: 'Leang Cosmetics', short_name: 'Leang Cosmetics', description: 'Browse Leang Cosmetics products and contact the store.',
  id: '/', start_url: '/', scope: '/', display: 'standalone', background_color: '#ffffff', theme_color: '#ffffff',
  icons: ICONS('/leang-cosmetics-icon-192-v2.png', '/leang-cosmetics-icon-192-maskable-v2.png', '/leang-cosmetics-icon-512-v2.png', '/leang-cosmetics-icon-512-maskable-v2.png'),
}

function headOf(html) {
  const head = html.slice(0, html.indexOf('</head>'))
  const values = { title: /<title>([^<]*)<\/title>/.exec(head)?.[1] }
  for (const [, tag, body] of head.matchAll(/<(meta|link)\b([^>]*)>/g)) {
    const attributes = Object.fromEntries([...body.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]))
    if (tag === 'meta' && attributes.name) values[`meta name=${attributes.name}`] = attributes.content
    if (tag === 'meta' && attributes.property) values[`meta property=${attributes.property}`] = attributes.content
    if (tag === 'link') values[`link rel=${attributes.rel}${attributes.sizes && attributes.rel === 'icon' ? ` ${attributes.sizes}` : ''}`] = attributes.href
  }
  return values
}

function identityBlock(html) {
  const match = /<script id="business-os-identity" type="application\/json">([^<]*)<\/script>/.exec(html)
  assert.ok(match, 'the document carries the identity block')
  return JSON.parse(match[1])
}

function shellNames(html) {
  return {
    adminTitle: /data-business-os-identity="adminTitle">([^<]*)</.exec(html)?.[1],
    shopName: /data-business-os-identity="shopName">([^<]*)</.exec(html)?.[1],
  }
}

async function bootWorker(script, vars) {
  const { Miniflare, Log, LogLevel } = require('miniflare')
  return new Miniflare({
    modules: true, script, compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], kvNamespaces: ['CACHE'], r2Buckets: ['ASSETS'],
    durableObjects: { BROADCAST_HUB: 'BroadcastHub', SYNC_UPLOADS: 'SyncUploadSession' },
    // The asset layer, reduced to what a document route needs: the built
    // shell for every path, as Workers Assets' SPA fallback answers it.
    serviceBindings: {
      STATIC_ASSETS: async () => new Response(indexHtml, { status: 200, headers: { 'content-type': 'text/html' } }),
    },
    bindings: vars,
    log: new Log(LogLevel.ERROR),
  })
}

async function fetchText(mf, url, headers = { accept: 'text/html' }) {
  const response = await mf.dispatchFetch(url, { headers })
  return { status: response.status, headers: response.headers, text: await response.text() }
}

// The storefront host gate's own 404 (src/index.ts, lib/publicHostGate.ts).
async function gateRefuses(mf, url) {
  const response = await fetchText(mf, url, { accept: 'application/json' })
  return response.status === 404 && response.text === '{"error":"Not found"}'
}

async function main() {
  const { build } = require('esbuild')
  const script = (await build({
    entryPoints: [path.join(root, 'src', 'index.ts')],
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], logLevel: 'error',
  })).outputFiles[0].text

  assert.doesNotMatch(indexHtml, /leang/i, 'the shared document names no client')

  const leang = await bootWorker(script, LEANG_VARS)
  try {
    for (const route of ['/', '/index.html', '/products', '/login']) {
      const shop = await fetchText(leang, `https://leangbeauty.com${route}`)
      assert.equal(shop.status, 200, route)
      const head = headOf(shop.text)
      for (const [key, value] of Object.entries(LEANG_SHOP_HEAD)) assert.equal(head[key], value, `leangbeauty.com${route} ${key}`)
      assert.deepEqual(shellNames(shop.text), { adminTitle: 'Leang Cosmetics Admin', shopName: 'Leang Cosmetics' })
      assert.equal(shop.headers.get('cache-control'), 'public, max-age=0, must-revalidate')

      const staff = await fetchText(leang, `https://admin.leangbeauty.com${route}`)
      const staffHead = headOf(staff.text)
      for (const [key, value] of Object.entries(LEANG_STAFF_HEAD)) assert.equal(staffHead[key], value, `admin.leangbeauty.com${route} ${key}`)
    }
    const identity = identityBlock((await fetchText(leang, 'https://leangbeauty.com/')).text)
    assert.equal(identity.shopNames, 'Leang Cosmetics/Leang Beauty')
    assert.equal(identity.membershipPrefix, 'LC-')
    assert.equal(identity.shopNameKm, 'លាង កូស្មេធីក', 'non-ASCII survives the rewrite')
    assert.equal(identity.staffHost, 'admin.leangbeauty.com')
    assert.equal(await gateRefuses(leang, 'https://leangbeauty.com/api/products'), true, 'the shop host refuses the staff API')
    assert.equal(await gateRefuses(leang, 'https://admin.leangbeauty.com/api/products'), false, 'the staff host reaches it')

    for (const host of ['leangbeauty.com', 'admin.leangbeauty.com']) {
      const staff = await fetchText(leang, `https://${host}/manifest.json`, {})
      assert.deepEqual(JSON.parse(staff.text), LEANG_STAFF_MANIFEST, `${host}/manifest.json`)
      assert.match(staff.headers.get('content-type'), /application\/json/)
      const shop = await fetchText(leang, `https://${host}/portal-manifest.json`, {})
      assert.deepEqual(JSON.parse(shop.text), LEANG_SHOP_MANIFEST, `${host}/portal-manifest.json`)
    }
    assert.equal((await fetchText(leang, 'https://admin.leangbeauty.com/robots.txt', {})).text, 'User-agent: *\nDisallow: /\n')
    assert.match((await fetchText(leang, 'https://leangbeauty.com/robots.txt', {})).text, /Sitemap: https:\/\/leangbeauty\.com\/sitemap\.xml/)
    console.log('  ok  Leang serves the identity it served before, on both hosts, and the same manifests')
  } finally {
    await leang.dispose()
  }

  const bmShop = await bootWorker(script, BM_SHOP_VARS)
  try {
    for (const route of ['/', '/products', '/login', '/manifest.json', '/portal-manifest.json', '/robots.txt', '/sitemap.xml']) {
      for (const host of [BM_SHOP_HOST, BM_STAFF_HOST]) {
        const served = await fetchText(bmShop, `https://${host}${route}`)
        assert.doesNotMatch(served.text, /leang|LC-0/i, `${host}${route} serves nothing of Leang`)
      }
    }
    const shop = await fetchText(bmShop, `https://${BM_SHOP_HOST}/`)
    assert.equal(headOf(shop.text).title, 'BM Shop')
    assert.equal(headOf(shop.text)['link rel=canonical'], `https://${BM_SHOP_HOST}/`)
    assert.equal(headOf(shop.text)['meta property=og:image'], `https://${BM_SHOP_HOST}/icon-512.png`)
    assert.deepEqual(shellNames(shop.text), { adminTitle: 'BM Shop Admin', shopName: 'BM Shop' })
    const staff = await fetchText(bmShop, `https://${BM_STAFF_HOST}/`)
    assert.equal(headOf(staff.text).title, 'BM Shop Admin')
    assert.equal(headOf(staff.text)['link rel=manifest'], '/manifest.json')
    assert.equal(identityBlock(staff.text).membershipPrefix, 'BM-')
    assert.equal(identityBlock(staff.text).staffHost, BM_STAFF_HOST, 'the page and the service worker learn the staff host from the document')
    assert.equal(JSON.parse((await fetchText(bmShop, `https://${BM_SHOP_HOST}/portal-manifest.json`, {})).text).name, 'BM Shop')
    assert.equal((await fetchText(bmShop, `https://${BM_STAFF_HOST}/robots.txt`, {})).text, 'User-agent: *\nDisallow: /\n', 'the configured staff host is never indexed')
    console.log('  ok  BM Shop serves its own identity and nothing of Leang')

    // The configured staff host is the staff app's; the shop host and look-alikes are not.
    for (const p of ['/api/products', '/api/auth/login', '/api/settings']) {
      assert.equal(await gateRefuses(bmShop, `https://${BM_STAFF_HOST}${p}`), false, `${BM_STAFF_HOST}${p} reaches the staff API`)
      for (const host of [BM_SHOP_HOST, `${BM_STAFF_HOST}.evil.com`, `x${BM_STAFF_HOST}`]) {
        assert.equal(await gateRefuses(bmShop, `https://${host}${p}`), true, `${host}${p} is refused`)
      }
    }
    assert.equal(headOf((await fetchText(bmShop, `https://x${BM_STAFF_HOST}/`)).text).title, 'BM Shop', 'a look-alike gets the shop identity')
    console.log('  ok  BM Shop\'s configured staff host is staff; its shop host and look-alikes are not')
  } finally {
    await bmShop.dispose()
  }
}

main().then(() => console.log('PASS test-client-identity-document-native')).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
