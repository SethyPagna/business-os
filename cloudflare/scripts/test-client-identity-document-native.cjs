'use strict'
// The REAL Worker (src/index.ts, bundled with esbuild, run in workerd by
// Miniflare) serving the REAL frontend/index.html through its document
// handler, under several deployments' [vars]:
//
//   The fixture client (the committed template rendered with clients/example.env
//   and the Example Shop identity of harness/rendered_wrangler.cjs) runs on every
//   machine: its shop host and staff host must serve exactly the head, the
//   loading-shell names, the identity block and the two manifests that its
//   frozen strings (harness/client_records.cjs) say.
//
//   Leang Cosmetics must serve byte-for-byte the identity it served before the
//   identity moved into configuration: the head values the static index.html
//   carried for the shop host, the values the old admin rewrite wrote for the
//   staff host, and the two manifests public/ used to ship. Those values are
//   frozen in harness/client_records.cjs as literals; its vars come from the
//   private Records/Clients/leang.env, so this pin runs where that file exists
//   and prints SKIP where it does not (CI).
//
//   A second client (its own [vars]) must serve no other client's name, icon or
//   address on either host, in the document or the manifests, and its configured
//   staff host must be the staff app's while its shop host and look-alikes are not.
//
// HTMLRewriter only exists inside workerd, which is why this is native.
//
// Run (from cloudflare/): node scripts/test-client-identity-document-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { wranglerVars, leangVars, hasLeang, skipLeang } = require('./harness/wrangler_vars.cjs')
const { EXAMPLE_RECORD, LEANG_RECORD, withFrozen } = require('./harness/client_records.cjs')

const root = path.resolve(__dirname, '..')
const indexHtml = fs.readFileSync(path.join(root, '..', 'frontend', 'index.html'), 'utf8')

// Only the plan and the Worker's own identity vars reach the test Worker: the rest of a
// rendered config (Sentry, Google, e-mail) is not for a test to carry, whoever's it is.
const identityOnly = (vars) => Object.fromEntries(Object.entries(vars).filter(([key]) => key === 'PLAN_TIER' || key.startsWith('BUSINESS_OS_')))

const EXAMPLE = withFrozen(EXAMPLE_RECORD, identityOnly(wranglerVars('wrangler.toml')))
const LEANG = hasLeang() ? withFrozen(LEANG_RECORD, identityOnly(leangVars('wrangler.toml'))) : null
const CLIENTS = LEANG ? [EXAMPLE, LEANG] : [EXAMPLE]
if (!LEANG) skipLeang('test-client-identity-document-native', "Leang's byte-for-byte head, staff head and manifests")

// A second client's URL scheme (owner, 22 Oct 2026): the shop at
// <client>.<subdomain>.workers.dev, staff at <client>-admin.<subdomain>.workers.dev,
// whose forwarder Worker hands requests to this one with the host preserved.
const SECOND_SHOP_HOST = 'second.shops-sub.workers.dev'
const SECOND_STAFF_HOST = 'second-admin.shops-sub.workers.dev'
const SECOND_SHOP_VARS = {
  PLAN_TIER: 'free',
  BUSINESS_OS_PUBLIC_URL: `https://${SECOND_SHOP_HOST}`,
  BUSINESS_OS_ADMIN_URL: `https://${SECOND_STAFF_HOST}`,
  BUSINESS_OS_ORGANIZATION_SLUG: 'second',
  BUSINESS_OS_ORGANIZATION_NAME: 'Second Shop',
  BUSINESS_OS_SHOP_NAME: 'Second Shop',
  BUSINESS_OS_MEMBERSHIP_PREFIX: 'SM-',
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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

  for (const C of CLIENTS) {
    const worker = await bootWorker(script, C.env)
    try {
      for (const route of ['/', '/index.html', '/products', '/login']) {
        const shop = await fetchText(worker, `https://${C.shopHost}${route}`)
        assert.equal(shop.status, 200, route)
        const head = headOf(shop.text)
        for (const [key, value] of Object.entries(C.shopHead)) assert.equal(head[key], value, `${C.shopHost}${route} ${key}`)
        assert.deepEqual(shellNames(shop.text), { adminTitle: C.adminTitle, shopName: C.shopName })
        assert.equal(shop.headers.get('cache-control'), 'public, max-age=0, must-revalidate')

        const staff = await fetchText(worker, `https://${C.adminHost}${route}`)
        const staffHead = headOf(staff.text)
        for (const [key, value] of Object.entries(C.staffHead)) assert.equal(staffHead[key], value, `${C.adminHost}${route} ${key}`)
      }
      const identity = identityBlock((await fetchText(worker, `https://${C.shopHost}/`)).text)
      assert.equal(identity.shopNames, `${C.shopName}/${C.shopAlias}`)
      assert.equal(identity.membershipPrefix, C.membershipPrefix)
      assert.equal(identity.shopNameKm, C.shopNameKm, 'non-ASCII survives the rewrite')
      assert.equal(identity.staffHost, C.adminHost)
      assert.equal(await gateRefuses(worker, `https://${C.shopHost}/api/products`), true, 'the shop host refuses the staff API')
      assert.equal(await gateRefuses(worker, `https://${C.adminHost}/api/products`), false, 'the staff host reaches it')

      for (const host of [C.shopHost, C.adminHost]) {
        const staff = await fetchText(worker, `https://${host}/manifest.json`, {})
        assert.deepEqual(JSON.parse(staff.text), C.staffManifest, `${host}/manifest.json`)
        assert.match(staff.headers.get('content-type'), /application\/json/)
        const shop = await fetchText(worker, `https://${host}/portal-manifest.json`, {})
        assert.deepEqual(JSON.parse(shop.text), C.shopManifest, `${host}/portal-manifest.json`)
      }
      assert.equal((await fetchText(worker, `https://${C.adminHost}/robots.txt`, {})).text, 'User-agent: *\nDisallow: /\n')
      assert.match((await fetchText(worker, `https://${C.shopHost}/robots.txt`, {})).text, new RegExp(`Sitemap: https:\\/\\/${escapeRegExp(C.shopHost)}\\/sitemap\\.xml`))
      console.log(`  ok  ${C.id} serves the identity it served before, on both hosts, and the same manifests`)
    } finally {
      await worker.dispose()
    }
  }

  const second = await bootWorker(script, SECOND_SHOP_VARS)
  try {
    for (const route of ['/', '/products', '/login', '/manifest.json', '/portal-manifest.json', '/robots.txt', '/sitemap.xml']) {
      for (const host of [SECOND_SHOP_HOST, SECOND_STAFF_HOST]) {
        const served = await fetchText(second, `https://${host}${route}`)
        for (const C of CLIENTS) {
          // another client's name, icon prefix and house numbers, whichever it is
          const other = new RegExp(`${C.leak.source}|${escapeRegExp(C.membershipPrefix)}0`, 'i')
          assert.doesNotMatch(served.text, other, `${host}${route} serves nothing of ${C.id}`)
        }
      }
    }
    const shop = await fetchText(second, `https://${SECOND_SHOP_HOST}/`)
    assert.equal(headOf(shop.text).title, 'Second Shop')
    assert.equal(headOf(shop.text)['link rel=canonical'], `https://${SECOND_SHOP_HOST}/`)
    assert.equal(headOf(shop.text)['meta property=og:image'], `https://${SECOND_SHOP_HOST}/icon-512.png`)
    assert.deepEqual(shellNames(shop.text), { adminTitle: 'Second Shop Admin', shopName: 'Second Shop' })
    const staff = await fetchText(second, `https://${SECOND_STAFF_HOST}/`)
    assert.equal(headOf(staff.text).title, 'Second Shop Admin')
    assert.equal(headOf(staff.text)['link rel=manifest'], '/manifest.json')
    assert.equal(identityBlock(staff.text).membershipPrefix, 'SM-')
    assert.equal(identityBlock(staff.text).staffHost, SECOND_STAFF_HOST, 'the page and the service worker learn the staff host from the document')
    assert.equal(JSON.parse((await fetchText(second, `https://${SECOND_SHOP_HOST}/portal-manifest.json`, {})).text).name, 'Second Shop')
    assert.equal((await fetchText(second, `https://${SECOND_STAFF_HOST}/robots.txt`, {})).text, 'User-agent: *\nDisallow: /\n', 'the configured staff host is never indexed')
    console.log('  ok  a second client serves its own identity and nothing of another')

    // The configured staff host is the staff app's; the shop host and look-alikes are not.
    for (const p of ['/api/products', '/api/auth/login', '/api/settings']) {
      assert.equal(await gateRefuses(second, `https://${SECOND_STAFF_HOST}${p}`), false, `${SECOND_STAFF_HOST}${p} reaches the staff API`)
      for (const host of [SECOND_SHOP_HOST, `${SECOND_STAFF_HOST}.evil.com`, `x${SECOND_STAFF_HOST}`]) {
        assert.equal(await gateRefuses(second, `https://${host}${p}`), true, `${host}${p} is refused`)
      }
    }
    assert.equal(headOf((await fetchText(second, `https://x${SECOND_STAFF_HOST}/`)).text).title, 'Second Shop', 'a look-alike gets the shop identity')
    console.log('  ok  a second client\'s configured staff host is staff; its shop host and look-alikes are not')
  } finally {
    await second.dispose()
  }
}

main().then(() => console.log('PASS test-client-identity-document-native')).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
