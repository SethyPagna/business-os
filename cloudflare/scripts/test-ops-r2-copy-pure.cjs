#!/usr/bin/env node
// Offline checks for the temporary R2 copy Worker (ops/r2-copy-worker/): the
// per-object copy / verify / prune logic and the HTTP surface, driven against
// the in-memory R2 fake in harness/ops_r2_fake.cjs (onlyIf.etagMatches, put's
// md5 integrity check, multipart etags without an MD5, include-limited list
// pages). No network, no wrangler.
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..', '..')

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n  ') : err}`)
    process.exitCode = 1
  }
}

// ------------------------------------------------------------ R2 fake
const { nodeDeps, md5hex, setup, FIXTURE_HTTP: HTTP, FIXTURE_CUSTOM: CUSTOM } = require('./harness/ops_r2_fake.cjs')

async function main() {
  const core = await import(pathToFileURL(path.join(ROOT, 'ops', 'r2-copy-worker', 'src', 'core.mjs')).href)
  const worker = await import(pathToFileURL(path.join(ROOT, 'ops', 'r2-copy-worker', 'src', 'index.mjs')).href)

  const copy = (s, key, extra = {}) => core.copyOne({ source: core.readOnlyBucket(s.source), destination: s.destination, key, deps: nodeDeps, ...extra })

  await check('copies bytes and preserves httpMetadata and customMetadata exactly', async () => {
    const s = setup()
    const content = crypto.randomBytes(50000)
    s.source.seed('uploads/a.webp', content, { httpMetadata: HTTP, customMetadata: CUSTOM })
    const r = await copy(s, 'uploads/a.webp')
    assert.strictEqual(r.outcome, 'copied')
    assert.strictEqual(r.size, 50000)
    const src = s.source.objects.get('uploads/a.webp')
    const dst = s.destination.objects.get('uploads/a.webp')
    assert.ok(dst.data.equals(content))
    assert.deepStrictEqual(core.normalizeHttpMetadata(dst.httpMetadata), core.normalizeHttpMetadata(src.httpMetadata))
    assert.strictEqual(dst.httpMetadata.cacheExpiry.toISOString(), '2027-01-02T03:04:05.678Z')
    assert.deepStrictEqual(dst.customMetadata, CUSTOM)
    assert.strictEqual(dst.etag, src.etag)
    assert.strictEqual(s.source.writes(), 0)
  })

  await check('an object already present and identical is skipped without a write', async () => {
    const s = setup()
    s.source.seed('k', 'same bytes', { httpMetadata: HTTP, customMetadata: CUSTOM })
    s.destination.seed('k', 'same bytes', { httpMetadata: HTTP, customMetadata: CUSTOM })
    const before = s.destination.objects.get('k').version
    const r = await copy(s, 'k', { allowOverwrite: true })
    assert.strictEqual(r.outcome, 'skipped-identical')
    assert.strictEqual(s.destination.writes(), 0)
    assert.strictEqual(s.destination.objects.get('k').version, before)
  })

  await check('force re-puts an identical object only with overwrite allowed, moving its uploaded time forward', async () => {
    const s = setup()
    const meta = { httpMetadata: { contentType: 'application/json' }, customMetadata: { lifecycle: 'managed' } }
    s.source.seed('backups/cloudflare/a.json', 'doc', meta)
    s.destination.seed('backups/cloudflare/a.json', 'doc', meta)
    const before = s.destination.objects.get('backups/cloudflare/a.json')
    assert.strictEqual((await copy(s, 'backups/cloudflare/a.json', { force: true })).outcome, 'skipped-identical', 'force alone must not write')
    assert.strictEqual(s.destination.writes(), 0)
    const r = await copy(s, 'backups/cloudflare/a.json', { force: true, allowOverwrite: true })
    assert.strictEqual(r.outcome, 'rewritten')
    const after = s.destination.objects.get('backups/cloudflare/a.json')
    assert.ok(after.uploaded.getTime() > before.uploaded.getTime(), 'uploaded must move forward')
    assert.notStrictEqual(after.version, before.version)
    assert.strictEqual(after.data.toString(), 'doc')
    assert.deepStrictEqual(after.customMetadata, { lifecycle: 'managed' })
    assert.deepStrictEqual(after.httpMetadata, { contentType: 'application/json' })
    s.source.seed('missing', 'm')
    assert.strictEqual((await copy(s, 'missing', { force: true, allowOverwrite: true })).outcome, 'copied')
    s.source.seed('changed', 'new bytes')
    s.destination.seed('changed', 'old bytes')
    assert.strictEqual((await copy(s, 'changed', { force: true, allowOverwrite: true })).outcome, 'overwritten')
    assert.strictEqual(s.source.writes(), 0)
  })

  await check('a destination that differs is a conflict unless overwrite is allowed; same bytes with different metadata is not identical', async () => {
    const s = setup()
    s.source.seed('k', 'new bytes', { httpMetadata: HTTP })
    s.destination.seed('k', 'old bytes', { httpMetadata: HTTP })
    const c = await copy(s, 'k')
    assert.strictEqual(c.outcome, 'conflict')
    assert.ok(c.diffs.includes('content'))
    assert.strictEqual(s.destination.objects.get('k').data.toString(), 'old bytes')
    const o = await copy(s, 'k', { allowOverwrite: true })
    assert.strictEqual(o.outcome, 'overwritten')
    assert.strictEqual(s.destination.objects.get('k').data.toString(), 'new bytes')

    const m = setup()
    m.source.seed('k', 'bytes', { customMetadata: { a: '1' } })
    m.destination.seed('k', 'bytes', { customMetadata: { a: '2' } })
    const mc = await copy(m, 'k')
    assert.deepStrictEqual(mc.diffs, ['customMetadata'])
    assert.strictEqual((await copy(m, 'k', { allowOverwrite: true })).outcome, 'overwritten')
    assert.deepStrictEqual(m.destination.objects.get('k').customMetadata, { a: '1' })
  })

  await check('every metadata difference is detected: each http field, custom keys (exact case), storage class, size', async () => {
    const base = core.describe({ key: 'k', size: 3, etag: md5hex(Buffer.from('abc')), httpMetadata: HTTP, customMetadata: CUSTOM, storageClass: 'Standard' })
    for (const field of Object.keys(HTTP)) {
      const h = { ...HTTP }
      delete h[field]
      const other = core.describe({ key: 'k', size: 3, etag: base.etag, httpMetadata: h, customMetadata: CUSTOM, storageClass: 'Standard' })
      assert.deepStrictEqual(core.differences(base, other), [`httpMetadata.${field}`])
    }
    const lower = Object.fromEntries(Object.entries(CUSTOM).map(([k, v]) => [k.toLowerCase(), v]))
    assert.deepStrictEqual(core.differences(base, core.describe({ key: 'k', size: 3, etag: base.etag, httpMetadata: HTTP, customMetadata: lower })), ['customMetadata'])
    assert.deepStrictEqual(core.differences(base, core.describe({ key: 'k', size: 3, etag: base.etag, httpMetadata: HTTP, customMetadata: { ...CUSTOM, extra: '' } })), ['customMetadata'])
    assert.deepStrictEqual(core.differences(base, core.describe({ key: 'k', size: 3, etag: base.etag, httpMetadata: HTTP, customMetadata: CUSTOM, storageClass: 'InfrequentAccess' })), ['storageClass'])
    assert.deepStrictEqual(core.differences(base, core.describe({ key: 'k', size: 4, etag: base.etag, httpMetadata: HTTP, customMetadata: CUSTOM })), ['size'])
    // same size, different bytes
    assert.deepStrictEqual(core.differences(base, core.describe({ key: 'k', size: 3, etag: md5hex(Buffer.from('abd')), httpMetadata: HTTP, customMetadata: CUSTOM })), ['content'])
    // a multipart etag on either side is never taken as equal without an MD5
    assert.deepStrictEqual(core.differences(base, core.describe({ key: 'k', size: 3, etag: `${base.etag}-2`, httpMetadata: HTTP, customMetadata: CUSTOM })), ['content-unverified'])
  })

  await check('a multipart source (etag has no MD5) is hashed by streaming, copied, and proven by MD5', async () => {
    const s = setup()
    const content = crypto.randomBytes(123457)
    s.source.seed('backups/cloudflare/big.json', content, { multipartParts: 3, httpMetadata: { contentType: 'application/json' } })
    assert.ok(/-3$/.test(s.source.objects.get('backups/cloudflare/big.json').etag))
    const r = await copy(s, 'backups/cloudflare/big.json')
    assert.strictEqual(r.outcome, 'copied')
    const dst = s.destination.objects.get('backups/cloudflare/big.json')
    assert.ok(dst.data.equals(content))
    assert.strictEqual(dst.etag, md5hex(content))
    const again = await copy(s, 'backups/cloudflare/big.json', { allowOverwrite: true })
    assert.strictEqual(again.outcome, 'skipped-identical', 'a multipart source must be recognised as already copied')
    const v = await core.verifyOne({ source: core.readOnlyBucket(s.source), destination: core.readOnlyBucket(s.destination), key: 'backups/cloudflare/big.json', deps: nodeDeps })
    assert.strictEqual(v.outcome, 'identical')
  })

  await check('a destination that drops or rewrites metadata is reported as a mismatch, never as copied', async () => {
    for (const fault of [{ dropHttpField: 'cacheExpiry' }, { dropHttpField: 'contentType' }, { lowercaseCustomKeys: true }]) {
      const s = setup()
      s.source.seed('k', 'payload', { httpMetadata: HTTP, customMetadata: CUSTOM })
      s.destination.faults = fault
      const r = await copy(s, 'k')
      assert.strictEqual(r.outcome, 'mismatch', JSON.stringify(fault))
      assert.ok(r.diffs.length > 0)
    }
  })

  await check('bytes corrupted in transit are refused by the md5 put check and reported as failed', async () => {
    const s = setup()
    s.source.seed('k', crypto.randomBytes(9000))
    s.destination.faults = { corruptInTransit: true }
    const r = await copy(s, 'k')
    assert.strictEqual(r.outcome, 'failed')
    assert.ok(/MD5/i.test(r.error))
    assert.ok(!s.destination.objects.has('k'))
  })

  await check('a source that changes mid-copy is re-read; a vanished source is reported, not copied', async () => {
    const s = setup()
    s.source.seed('k', 'version one')
    const oldEtag = s.source.objects.get('k').etag
    let flipped = false
    s.source.faults.beforeGet = (key, bucket) => {
      if (!flipped) {
        flipped = true
        bucket.seed(key, 'version two, longer') // replaced between head and get
      }
    }
    const r = await copy(s, 'k', { expectEtag: oldEtag })
    assert.strictEqual(r.outcome, 'copied')
    assert.strictEqual(r.sourceChanged, true)
    assert.strictEqual(s.destination.objects.get('k').data.toString(), 'version two, longer')
    const gone = await copy(s, 'nope')
    assert.strictEqual(gone.outcome, 'source-missing')
    assert.ok(!s.destination.objects.has('nope'))
  })

  await check('empty objects and InfrequentAccess storage class copy exactly', async () => {
    const s = setup()
    s.source.seed('empty', Buffer.alloc(0), { httpMetadata: { contentType: 'text/plain' } })
    s.source.seed('cold', 'cold bytes', { storageClass: 'InfrequentAccess' })
    assert.strictEqual((await copy(s, 'empty')).outcome, 'copied')
    assert.strictEqual(s.destination.objects.get('empty').data.length, 0)
    assert.strictEqual((await copy(s, 'cold')).outcome, 'copied')
    assert.strictEqual(s.destination.objects.get('cold').storageClass, 'InfrequentAccess')
  })

  await check('verifyOne: identical, different, missing and destination-only, all read-only', async () => {
    const s = setup()
    s.source.seed('same', 'x', { customMetadata: CUSTOM })
    s.destination.seed('same', 'x', { customMetadata: CUSTOM })
    s.source.seed('diff', 'x', { httpMetadata: { contentType: 'image/png' } })
    s.destination.seed('diff', 'x', { httpMetadata: { contentType: 'image/jpeg' } })
    s.source.seed('missing', 'x')
    s.destination.seed('extra', 'x')
    const ro = { source: core.readOnlyBucket(s.source), destination: core.readOnlyBucket(s.destination), deps: nodeDeps }
    assert.strictEqual((await core.verifyOne({ ...ro, key: 'same' })).outcome, 'identical')
    const d = await core.verifyOne({ ...ro, key: 'diff' })
    assert.strictEqual(d.outcome, 'different')
    assert.deepStrictEqual(d.diffs, ['httpMetadata.contentType'])
    assert.strictEqual((await core.verifyOne({ ...ro, key: 'missing' })).outcome, 'missing-in-destination')
    assert.strictEqual((await core.verifyOne({ ...ro, key: 'extra' })).outcome, 'destination-only')
    assert.strictEqual(s.source.writes() + s.destination.writes(), 0)
  })

  await check('pruneOne deletes only a destination key the source no longer has', async () => {
    const s = setup()
    s.source.seed('kept', 'x')
    s.destination.seed('kept', 'x')
    s.destination.seed('stale', 'x')
    const args = { source: core.readOnlyBucket(s.source), destination: s.destination }
    assert.strictEqual((await core.pruneOne({ ...args, key: 'kept' })).outcome, 'kept-source-present')
    assert.strictEqual((await core.pruneOne({ ...args, key: 'stale' })).outcome, 'pruned')
    assert.strictEqual((await core.pruneOne({ ...args, key: 'stale' })).outcome, 'already-absent')
    assert.ok(s.destination.objects.has('kept') && !s.destination.objects.has('stale'))
    assert.ok(s.source.objects.has('kept'))
    assert.strictEqual(s.source.writes(), 0)
  })

  await check('the source is structurally read-only: the wrapper exposes head/get/list only', async () => {
    const s = setup()
    const ro = core.readOnlyBucket(s.source)
    assert.deepStrictEqual(Object.keys(ro).sort(), ['get', 'head', 'list'])
    assert.ok(Object.isFrozen(ro))
    assert.strictEqual(ro.put, undefined)
    assert.strictEqual(ro.delete, undefined)
    assert.throws(() => { 'use strict'; ro.put = () => {} })
  })

  await check('Worker source: SOURCE only through the wrapper, one delete (destination prune), no console, no writes to SOURCE', () => {
    const fs = require('fs')
    const read = (f) => fs.readFileSync(path.join(ROOT, 'ops', 'r2-copy-worker', 'src', f), 'utf8')
    const index = read('index.mjs')
    const coreText = read('core.mjs')
    const uses = index.match(/env\.SOURCE\b.{0,1}/g) || []
    assert.deepStrictEqual(uses.sort(), ['env.SOURCE ', 'env.SOURCE)'].sort(), `unexpected use of env.SOURCE: ${uses}`)
    assert.ok(/!env\.SOURCE \|\|/.test(index) && /readOnlyBucket\(env\.SOURCE\)/.test(index))
    for (const [name, text] of [['index.mjs', index], ['core.mjs', coreText]]) {
      assert.ok(!/\bconsole\./.test(text), `${name} writes to the console`)
      assert.ok(!/\bsource\.(put|delete|createMultipartUpload|resumeMultipartUpload)\b/.test(text), `${name} writes to the source`)
    }
    assert.deepStrictEqual(coreText.match(/\.delete\(/g), ['.delete('])
    assert.ok(/await destination\.delete\(key\)/.test(coreText))
    assert.ok(!/\.delete\(/.test(index))
  })

  await check('listPage carries metadata and follows the cursor when R2 returns short pages', async () => {
    const s = setup()
    for (let i = 0; i < 11; i += 1) s.source.seed(`k${String(i).padStart(2, '0')}`, `v${i}`, { customMetadata: { i: String(i) } })
    s.source.includePageCap = 4 // R2 may return fewer than `limit` objects when metadata is included
    const all = []
    let cursor = null
    let pages = 0
    do {
      const page = await core.listPage(core.readOnlyBucket(s.source), cursor, 1000)
      all.push(...page.objects)
      cursor = page.cursor
      pages += 1
      if (!page.truncated) break
    } while (pages < 20)
    assert.strictEqual(all.length, 11)
    assert.strictEqual(pages, 3)
    assert.strictEqual(all[3].customMetadata.i, '3')
    assert.strictEqual(all[0].md5, md5hex(Buffer.from('v0')))
  })

  // ------------------------------------------------------ HTTP surface
  const TOKEN = crypto.randomBytes(32).toString('base64url')
  const request = (method, route, body, token = TOKEN) => new Request(`https://business-os-r2-copy.example.workers.dev${route}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const call = async (env, method, route, body, token) => {
    const res = await worker.handle(request(method, route, body, token), env, nodeDeps)
    return { status: res.status, body: await res.json() }
  }

  await check('the Worker refuses everything without a configured secret or with a wrong bearer', async () => {
    const s = setup()
    const env = { SOURCE: s.source, DESTINATION: s.destination }
    assert.strictEqual((await call(env, 'GET', '/health')).status, 503)
    assert.strictEqual((await call({ ...env, COPY_TOKEN: 'short' }, 'GET', '/health', undefined, 'short')).status, 503)
    const configured = { ...env, COPY_TOKEN: TOKEN }
    assert.strictEqual((await call(configured, 'GET', '/health', undefined, '')).status, 401)
    assert.strictEqual((await call(configured, 'GET', '/health', undefined, `${TOKEN}x`)).status, 401)
    assert.strictEqual((await call(configured, 'GET', '/health', undefined, TOKEN.slice(1))).status, 401)
    const ok = await call(configured, 'GET', '/health')
    assert.strictEqual(ok.status, 200)
    assert.deepStrictEqual(ok.body.capabilities, { digestStreamMd5: true, fixedLengthStream: true })
    assert.strictEqual((await call(configured, 'GET', '/anything')).status, 404)
  })

  await check('the HTTP routes copy, verify, list and prune; prune needs its confirm word; limits hold', async () => {
    const s = setup()
    const env = { SOURCE: s.source, DESTINATION: s.destination, COPY_TOKEN: TOKEN }
    s.source.seed('a', 'A', { httpMetadata: HTTP, customMetadata: CUSTOM })
    s.source.seed('b', 'B')
    s.destination.seed('gone-from-source', 'G')
    const copied = await call(env, 'POST', '/copy', { items: [{ key: 'a' }, { key: 'b' }], allowOverwrite: true })
    assert.strictEqual(copied.status, 200)
    assert.deepStrictEqual(copied.body.results.map((r) => r.outcome), ['copied', 'copied'])
    const verified = await call(env, 'POST', '/verify', { keys: ['a', 'b'] })
    assert.deepStrictEqual(verified.body.results.map((r) => r.outcome), ['identical', 'identical'])
    const listed = await call(env, 'POST', '/list', { bucket: 'destination', limit: 1000 })
    assert.deepStrictEqual(listed.body.objects.map((o) => o.key), ['a', 'b', 'gone-from-source'])
    assert.strictEqual((await call(env, 'POST', '/list', { bucket: 'other' })).status, 400)
    assert.strictEqual((await call(env, 'POST', '/prune', { keys: ['gone-from-source'] })).status, 400)
    const pruned = await call(env, 'POST', '/prune', { keys: ['gone-from-source', 'a'], confirm: 'destination-only' })
    assert.deepStrictEqual(pruned.body.results.map((r) => r.outcome), ['pruned', 'kept-source-present'])
    const tooMany = Array.from({ length: worker.MAX_COPY_ITEMS + 1 }, (_, i) => ({ key: `k${i}` }))
    assert.strictEqual((await call(env, 'POST', '/copy', { items: tooMany })).status, 400)
    assert.strictEqual((await call(env, 'POST', '/copy', { items: [{ key: '' }] })).status, 400)
    assert.strictEqual((await call(env, 'POST', '/verify', { keys: [] })).status, 400)
    const res = await worker.handle(new Request('https://x.example/copy', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: 'not json' }), env, nodeDeps)
    assert.strictEqual(res.status, 400)
    // allowOverwrite must be exactly true: a truthy string does not count
    s.source.seed('a', 'A2')
    const conflict = await call(env, 'POST', '/copy', { items: [{ key: 'a' }], allowOverwrite: 'yes' })
    assert.strictEqual(conflict.body.results[0].outcome, 'conflict')
    // force must be exactly true as well
    const notForced = await call(env, 'POST', '/copy', { items: [{ key: 'b', force: 'yes' }], allowOverwrite: true })
    assert.strictEqual(notForced.body.results[0].outcome, 'skipped-identical')
    const forced = await call(env, 'POST', '/copy', { items: [{ key: 'b', force: true }], allowOverwrite: true })
    assert.strictEqual(forced.body.results[0].outcome, 'rewritten')
    assert.strictEqual(s.source.writes(), 0, 'the source bucket was written')
  })

  if (process.exitCode) console.error(`test-ops-r2-copy-pure: FAILED (${passed} passed)`)
  else console.log(`test-ops-r2-copy-pure: ${passed} checks passed`)
}

main().catch((err) => {
  console.error(`test-ops-r2-copy-pure: crashed: ${err && err.stack}`)
  process.exitCode = 1
})
