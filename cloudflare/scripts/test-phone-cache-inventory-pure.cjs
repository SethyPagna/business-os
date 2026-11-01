'use strict'
// P2.8 (6.0.1046): every shared server cache that can hold a phone-bearing body is keyed on the full-phone grant.
//
// A body cached for an account that may read numbers must never be served to one that may not (CACHE-LIFECYCLE.md section 5,
// layer L8). The cache helper that takes the grant is `cachedPhoneJson` (lib/phoneCache.ts); every other Cache API producer
// must be one this file has judged phone-free. A NEW producer added by any later change is not in the inventory, so this
// test goes red until its author states, here, whether its body carries a phone and how it is keyed.
//
// Run (from cloudflare/): node scripts/test-phone-cache-inventory-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.join(__dirname, '..', 'src')
const read = (file) => fs.readFileSync(path.join(SRC, file), 'utf8').split('\r\n').join('\n')
const walk = (dir) => fs.readdirSync(path.join(SRC, dir), { withFileTypes: true }).flatMap((entry) => (
  entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name.endsWith('.ts') ? [path.join(dir, entry.name).split(path.sep).join('/')] : []))
const code = (source) => source.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n')
const count = (source, needle) => code(source).split(needle).length - 1

// file -> { cachedJsonResponse, put, why } : producers judged to carry NO phone number. A count that grows is a new producer.
const PHONE_FREE = {
  'routes/batches.ts': { cachedJsonResponse: 1, why: 'tracked product ids' },
  'routes/notifications.ts': { cachedJsonResponse: 1, why: 'inventory / expiry / inventory-full / supplier_credit sections: products and totals (the loyalty section takes the contacts option, below)' },
  'routes/products.ts': { cachedJsonResponse: 6, put: 1, why: 'product search, bootstrap, filters, facets, clusters, counts' },
  'routes/sales.ts': { cachedJsonResponse: 2, why: '/stats and /stats-strip: counts and totals' },
  'lib/dashboardStockOverview.ts': { put: 1, why: 'stock overview figures' },
  'lib/r2.ts': { put: 1, why: 'image bytes' },
  'routes/portal.ts': { put: 1, why: 'public storefront bodies (the shop\'s own contact phone only)' },
}
// file -> number of grant-keyed producers there must be.
const PHONE_KEYED = {
  'routes/contacts.ts': 4,
  'routes/sales.ts': 1,
  'routes/notifications.ts': 1,
}
// Files that define the helpers, or only delete entries.
const HELPERS = new Set(['lib/cache.ts', 'lib/phoneCache.ts', 'lib/imageVariantStore.ts'])

const files = walk('').filter((file) => !HELPERS.has(file))
const failures = []
const fail = (message) => failures.push(message)

for (const file of files) {
  const source = read(file)
  const json = count(source, 'cachedJsonResponse(')
  const keyed = count(source, 'cachedPhoneJson(')
  const put = (code(source).match(/\bcache\.put\(/g) || []).length
  const freeJson = PHONE_FREE[file]?.cachedJsonResponse ?? 0
  const freePut = PHONE_FREE[file]?.put ?? 0
  const wantKeyed = PHONE_KEYED[file] ?? 0
  // notifications.ts holds its helper (cachedPhoneJson used behind a flag) next to the plain one.
  if (json !== freeJson) fail(`${file}: ${json} cachedJsonResponse( call(s), the inventory judges ${freeJson} phone-free. A new cache producer? State here whether its body carries a phone, and use cachedPhoneJson if it can.`)
  if (keyed !== wantKeyed) fail(`${file}: ${keyed} cachedPhoneJson( call(s), expected ${wantKeyed}`)
  if (put !== freePut + (file === 'lib/dashboardRankingsCache.ts' ? 1 : 0)) fail(`${file}: ${put} Cache API put(s), the inventory judges ${freePut}${file === 'lib/dashboardRankingsCache.ts' ? ' + 1 grant-keyed' : ''} phone-free. A new cache producer?`)
}
for (const file of Object.keys(PHONE_FREE)) assert.ok(fs.existsSync(path.join(SRC, file)), `inventory names a file that is gone: ${file}`)

// Every grant-keyed call hands the helper the ACCOUNT, not a constant.
for (const file of Object.keys(PHONE_KEYED)) {
  const calls = code(read(file)).split('cachedPhoneJson(').slice(1)
  for (const call of calls) {
    const args = call.slice(0, 160)
    if (!/^(c\.req\.raw|request),\s*c\.executionCtx,\s*(c\.get\('user'\)|user),/.test(args)) fail(`${file}: a cachedPhoneJson call does not pass the signed-in account: ${args.split('\n')[0]}`)
  }
}

// The dashboard rankings (top customers carry a phone) fold the variant into the key and store the projected rows.
const rankings = read('lib/dashboardRankingsCache.ts')
if (!/\['phone', phoneCacheVariant\(ctx\.user\)\]/.test(rankings)) fail('dashboardRankingsCache.ts: the key no longer carries the phone variant')
if (!/projectPhones\(rows, ctx\.user\)/.test(rankings)) fail('dashboardRankingsCache.ts: the stored rows are no longer projected for the account')
const compat = read('routes/compat.ts')
if (!/user: c\.get\('user'\)/.test(compat)) fail('compat.ts: the rankings context no longer receives the account')

// The helper itself: a masked entry for everyone without the grant, a distinct key per variant.
const helper = read('lib/phoneCache.ts')
if (!/phone-full/.test(helper) || !/phone-masked/.test(helper)) fail('phoneCache.ts: the two variants are gone')
if (!/projectPhones\(await producer\(\), user\)/.test(helper)) fail('phoneCache.ts: the producer result is no longer projected for the account')
const cacheLib = read('lib/cache.ts')
if (!/searchParams\.set\('_g', variant\)/.test(cacheLib)) fail('cache.ts: the variant no longer joins the Cache API key')

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`)
  process.exit(1)
}
console.log(`PASS phone cache inventory: ${files.length} source files scanned; every Cache API producer is grant-keyed or judged phone-free`)
