#!/usr/bin/env node
// r2-inventory (ops/scripts/ops-r2-inventory.mjs): every key class, GET only, the cursor walk and its stops, the per-set
// aggregation, and that no object key reaches the public log or the plaintext of the encrypted report.
'use strict'

const assert = require('assert')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..', '..')
const ACCOUNT = '0123456789abcdef0123456789abcdef'
let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1 } catch (e) { console.error(`RED ${name}\n${e && e.stack}`); process.exitCode = 1 }
}

function fakeApi(buckets, calls) {
  return async (method, p) => {
    calls.push(`${method} ${p}`)
    if (method !== 'GET') throw new Error(`a ${method} reached the API`)
    const m = /^\/accounts\/[0-9a-f]{32}\/r2\/buckets\/([a-z0-9-]+)(\/objects\?(.*))?$/.exec(p)
    if (!m) return { ok: false, status: 400, json: { success: false, errors: [{ code: 7003 }] } }
    const b = buckets[m[1]]
    if (!b) return { ok: false, status: 404, json: { success: false, errors: [{ code: 10006 }] } }
    if (b.forbidden) return { ok: false, status: 403, json: { success: false, errors: [{ code: 10000 }] } }
    if (!m[2]) return { ok: true, status: 200, json: { success: true, result: { name: m[1], location: 'apac' } } }
    const q = new URLSearchParams(m[3])
    const page = q.get('cursor') ? Number(q.get('cursor').replace('c', '')) : 0
    const pages = b.pages
    const objects = pages[page] || []
    const last = page >= pages.length - 1
    const cursor = b.loop ? 'c1' : last ? '' : `c${page + 1}`
    return { ok: true, status: 200, json: { success: true, result: objects, result_info: { cursor, per_page: 1000, is_truncated: b.loop ? true : !last } } }
  }
}

const obj = (key, size, extra = {}) => ({ key, size, last_modified: '2026-11-01T00:00:00.000Z', etag: 'e', ...extra })
const PERSONAL = ['uploads/Sokha Chan 012 345 678 receipt-1731-ab12cd34.jpg', 'private/portal-submissions/Dara phone 0977777777.png', 'quarantine/2026-09-27T01-00-00-000Z/uploads/Bopha passport.heic']

async function main() {
  const lib = await import(pathToFileURL(path.join(ROOT, 'ops', 'scripts', 'ops-r2-inventory.mjs')).href)
  const common = await import(pathToFileURL(path.join(ROOT, 'ops', 'scripts', 'ops-common.mjs')).href)

  await check('classifyKey: every prefix the Worker writes has its class; a legacy set splits into manifest, sidecar and assets', () => {
    const table = [
      ['uploads/a-1-abcd1234.jpg', 'uploads'],
      ['variants/w160/a.webp', 'variants/w160'], ['variants/w320/a.webp', 'variants/w320'], ['variants/w640/a.webp', 'variants/w640'], ['variants/w9/a.webp', 'variants/other'],
      ['backups/cloudflare/business-os-cloudflare-20261119-152200Z.json', 'backups/manifest'],
      ['backups/cloudflare/business-os-cloudflare-20261119-152200Z/state.json', 'backups/sidecar'],
      ['backups/cloudflare/business-os-cloudflare-20261001-152200Z/assets/uploads/a.jpg', 'backups/legacy-assets'],
      ['backups/asset-pool/a.jpg@etag', 'backups/asset-pool'],
      ['backups/cloudflare/drive-staged-1abc.json', 'backups/drive-staged'],
      ['backups/cloudflare/some-unstamped-name.json', 'backups/other'],
      ['imports/job1/incoming/a.csv', 'imports/incoming'], ['imports/job1/other.json', 'imports/other'],
      ['private/portal-submissions/a.png', 'private/portal-submissions'], ['private/x', 'private/other'],
      ['quarantine/2026-11-19T00-00-00-000Z/uploads/a.html', 'quarantine'],
      ['system/doctor-uuid', 'system'], ['favicon.ico', 'other'], ['', 'other'],
    ]
    for (const [key, cls] of table) assert.strictEqual(lib.classifyKey(key), cls, key)
    for (const [, cls] of table) assert.ok(lib.CLASSES.includes(cls), cls)
    assert.strictEqual(lib.backupSetOf('backups/cloudflare/business-os-cloudflare-20261119-152200Z/assets/x'), 'business-os-cloudflare-20261119-152200Z')
    assert.strictEqual(lib.backupSetOf('uploads/business-os-cloudflare-20261119-152200Z.json'), null)
  })

  await check('readInventory: GET only, both buckets, every page by cursor, per-set totals', async () => {
    const calls = []
    const apac = { pages: [
      [obj('uploads/a.jpg', 100), obj('variants/w320/a.webp', 10), obj('backups/asset-pool/a.jpg@e', 100)],
      [obj('backups/cloudflare/business-os-cloudflare-20261001-010000Z.json', 250, { custom_metadata: { source: 'scheduled', scope: 'full' } }),
        obj('backups/cloudflare/business-os-cloudflare-20261001-010000Z/assets/uploads/a.jpg', 100), obj('backups/cloudflare/business-os-cloudflare-20261001-010000Z/assets/uploads/b.jpg', 50)],
      [obj('backups/cloudflare/business-os-cloudflare-20261118-150000Z.json', 30, { custom_metadata: { source: 'scheduled', scope: 'full', encoding: 'gzip', lifecycle: 'managed' } }),
        obj('backups/cloudflare/business-os-cloudflare-20261118-150000Z/state.json', 5, { custom_metadata: { status: 'finalized' } }),
        obj('backups/cloudflare/business-os-cloudflare-20261119-150000Z/state.json', 5, { custom_metadata: { status: 'copying' } })],
    ] }
    const old = { pages: [[obj('uploads/a.jpg', 100)], []] }
    const r = await lib.readInventory(fakeApi({ 'business-os-assets-apac': apac, 'business-os-assets': old }, calls), ACCOUNT)
    assert.ok(r.ok, JSON.stringify(r.problems))
    assert.ok(calls.every((c) => c.startsWith('GET ')))
    assert.strictEqual(r.buckets.apac.pages, 3)
    assert.strictEqual(r.buckets.old.pages, 2, 'an empty last page ends the walk')
    const t = r.buckets.apac.tally
    assert.strictEqual(t.objects, 9)
    assert.strictEqual(t.classes.uploads.bytes, 100)
    assert.strictEqual(t.classes['backups/legacy-assets'].objects, 2)
    const legacy = t.sets['business-os-cloudflare-20261001-010000Z']
    assert.deepStrictEqual([legacy.legacyAssetObjects, legacy.legacyAssetBytes, legacy.manifest.bytes, legacy.manifest.gzip, legacy.sidecar], [2, 150, 250, false, null])
    const pool = t.sets['business-os-cloudflare-20261118-150000Z']
    assert.deepStrictEqual([pool.manifest.gzip, pool.manifest.lifecycle, pool.sidecar.status, pool.legacyAssetObjects], [true, 'managed', 'finalized', 0])
    const unfinished = t.sets['business-os-cloudflare-20261119-150000Z']
    assert.deepStrictEqual([unfinished.manifest, unfinished.sidecar.status], [null, 'copying'])
  })

  await check('readInventory: an absent old bucket is not a problem; an absent apac bucket, a 403, a cursor loop and the page cap are', async () => {
    const one = { pages: [[obj('uploads/a.jpg', 1)]] }
    let r = await lib.readInventory(fakeApi({ 'business-os-assets-apac': one }, []), ACCOUNT)
    assert.ok(r.ok && r.buckets.old.state === 'absent' && r.buckets.old.listed === false)
    r = await lib.readInventory(fakeApi({ 'business-os-assets': one }, []), ACCOUNT)
    assert.deepStrictEqual(r.problems, ['apac-bucket-unreadable'])
    const forbidden = { ...one, forbidden: true }
    r = await lib.readInventory(fakeApi({ 'business-os-assets-apac': one, 'business-os-assets': forbidden }, []), ACCOUNT)
    assert.deepStrictEqual(r.problems, ['old-bucket-unreadable'], 'a 403 on the bucket probe is unreadable, not absent')
    const loop = { pages: [[obj('uploads/a.jpg', 1)], [obj('uploads/b.jpg', 1)]], loop: true }
    r = await lib.readInventory(fakeApi({ 'business-os-assets-apac': loop }, []), ACCOUNT)
    assert.deepStrictEqual(r.problems, ['r2-list-cursor-loop'])
    const many = { pages: Array.from({ length: 5 }, (_, i) => [obj(`uploads/${i}.jpg`, 1)]) }
    await assert.rejects(() => lib.listBucket(fakeApi({ b: many }, []), ACCOUNT, 'b', lib.emptyTally(), 3), (e) => e.code === 'r2-list-page-cap')
    await assert.rejects(() => lib.readInventory(fakeApi({}, []), 'not-an-account'), (e) => e.code === 'bad-account-id')
  })

  await check('no object key reaches the public log or the report plaintext', async () => {
    const apac = { pages: [PERSONAL.map((k) => obj(k, 7)).concat([obj('backups/cloudflare/business-os-cloudflare-20261118-150000Z.json', 1, { custom_metadata: { source: 'Sokha Chan 012345678' } })])] }
    const r = await lib.readInventory(fakeApi({ 'business-os-assets-apac': apac }, []), ACCOUNT)
    const lines = lib.publicLines({ result: r, bytes: 123 }).map(([t, v]) => common.formatPublic(t, v))
    const plaintext = JSON.stringify({ classes: lib.CLASSES, ...r })
    for (const text of [lines.join('\n'), plaintext]) {
      for (const needle of ['Sokha', 'Dara', 'Bopha', '012', '0977777777', 'receipt', 'passport', '.jpg', '.png', '.heic']) assert.ok(!text.includes(needle), `${needle} leaked`)
    }
    assert.strictEqual(r.buckets.apac.tally.sets['business-os-cloudflare-20261118-150000Z'].manifest.source, null, 'a metadata value that is not one short word is dropped')
    assert.ok(lines.some((l) => l === 'r2-inventory verdict: PASS'))
  })
  console.log(`test-ops-r2-inventory-pure: ${passed} checks passed`)
}

main().catch((e) => { console.error(`test-ops-r2-inventory-pure: crashed: ${e && e.stack}`); process.exitCode = 1 })
