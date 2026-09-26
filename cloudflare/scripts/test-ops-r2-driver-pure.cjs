#!/usr/bin/env node
// Offline end-to-end checks for the r2-apac-copy driver (ops/scripts/ops-r2.mjs
// + ops-r2-lib.mjs): the runner-side job talks to the REAL copy Worker code
// (ops/r2-copy-worker/src/index.mjs handle()) through an in-process fetch, on
// top of the in-memory R2 in harness/ops_r2_fake.cjs, with a fake Cloudflare
// API for the production-binding check. No network, no wrangler.
'use strict'

const assert = require('assert')
const crypto = require('crypto')
const path = require('path')
const { pathToFileURL } = require('url')
const { setup, nodeDeps, md5hex, FIXTURE_HTTP, FIXTURE_CUSTOM } = require('./harness/ops_r2_fake.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const load = (...p) => import(pathToFileURL(path.join(ROOT, ...p)).href)

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n  ') : err}`)
    process.exitCode = 1
  }
}

const TOKEN = crypto.randomBytes(32).toString('base64url')
const ACCOUNT = '0123456789abcdef0123456789abcdef'
const V1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const V2 = 'aaaaaaaa-0000-4000-8000-000000000002'

// Fake Cloudflare API: the production Worker's latest deployment and the
// ASSETS binding of each version. `states` is consumed one call at a time
// (the last one repeats), so a test can flip production mid-run.
function fakeApi(...states) {
  const calls = []
  let deploymentsRead = 0
  const bindingFor = new Map()
  async function api(method, p) {
    calls.push(`${method} ${p}`)
    const base = `/accounts/${ACCOUNT}/workers/scripts/business-os`
    if (method === 'GET' && p === `${base}/deployments`) {
      const state = states[Math.min(deploymentsRead, states.length - 1)]
      deploymentsRead += 1
      if (state === 'api-down') return { ok: false, status: 503, json: null }
      const versions = state === 'mixed'
        ? [{ version_id: V1, percentage: 60 }, { version_id: V2, percentage: 40 }]
        : [{ version_id: V1, percentage: 100 }, { version_id: V2, percentage: 0 }]
      bindingFor.set(V1, state === 'destination' || state === 'mixed' ? 'business-os-assets-apac' : state === 'other' ? 'someone-else' : 'business-os-assets')
      bindingFor.set(V2, state === 'mixed' ? 'business-os-assets' : 'business-os-assets-apac')
      return {
        ok: true,
        status: 200,
        json: { success: true, result: { deployments: [
          { id: 'old', created_on: '2026-09-01T00:00:00Z', versions: [{ version_id: V2, percentage: 100 }] },
          { id: 'new', created_on: '2026-09-25T00:00:00Z', versions },
        ] } },
      }
    }
    const m = new RegExp(`^${base}/versions/(${V1}|${V2})$`).exec(p)
    if (method === 'GET' && m) {
      return {
        ok: true,
        status: 200,
        json: { success: true, result: { id: m[1], resources: { bindings: [
          { type: 'kv_namespace', name: 'CACHE', namespace_id: 'x' },
          { type: 'r2_bucket', name: 'ASSETS', bucket_name: bindingFor.get(m[1]) },
        ] } } },
      }
    }
    return { ok: false, status: 404, json: { success: false, errors: [{ code: 10007 }] } }
  }
  return { api, calls }
}

async function main() {
  const worker = await load('ops', 'r2-copy-worker', 'src', 'index.mjs')
  const core = await load('ops', 'r2-copy-worker', 'src', 'core.mjs')
  const lib = await load('ops', 'scripts', 'ops-r2-lib.mjs')
  const driver = await load('ops', 'scripts', 'ops-r2.mjs')
  const common = await load('ops', 'scripts', 'ops-common.mjs')

  // A client whose fetch goes straight into the Worker's handle().
  function clientFor(s, { wrap, record } = {}) {
    const env = { SOURCE: s.source, DESTINATION: s.destination, COPY_TOKEN: TOKEN }
    let fetchImpl = async (url, init) => {
      if (record) record.push(`${init.method} ${new URL(url).pathname}`)
      return worker.handle(new Request(url, init), env, nodeDeps)
    }
    if (wrap) fetchImpl = wrap(fetchImpl)
    return driver.workerClient({ baseUrl: 'https://business-os-r2-copy.example.workers.dev', token: TOKEN, fetchImpl, pause: async () => {} })
  }
  const run = (s, mode, { api = fakeApi('source').api, wrap, record, concurrency, onProgress } = {}) =>
    driver.runJob({ mode, client: clientFor(s, { wrap, record }), api, accountId: ACCOUNT, concurrency, onProgress })

  // A realistic source: images with full metadata, backup manifests (one
  // multipart), drive-staged files, backup folder objects, an empty object,
  // an InfrequentAccess object -- listed in short pages.
  function seedSource(s) {
    const t = (d) => new Date(`2026-09-${d}Z`)
    for (let i = 0; i < 9; i += 1) {
      s.source.seed(`uploads/products/p${i}-${crypto.randomBytes(3).toString('hex')}.webp`, crypto.randomBytes(3000 + i * 911), {
        httpMetadata: i % 2 ? FIXTURE_HTTP : { contentType: 'image/jpeg' },
        customMetadata: i % 3 ? FIXTURE_CUSTOM : {},
        uploaded: t(`0${1 + (i % 9)}T10:00:00.000`),
      })
    }
    s.source.seed('uploads/empty.txt', Buffer.alloc(0), { httpMetadata: { contentType: 'text/plain' }, uploaded: t('02T00:00:00.000') })
    s.source.seed('uploads/cold.bin', 'cold', { storageClass: 'InfrequentAccess', uploaded: t('02T00:00:01.000') })
    const json = { contentType: 'application/json; charset=utf-8' }
    // Key order differs from time order on purpose.
    s.source.seed('backups/cloudflare/business-os-cloudflare-b.json', crypto.randomBytes(40000), { httpMetadata: json, customMetadata: { lifecycle: 'managed' }, multipartParts: 3, uploaded: t('20T06:00:00.000') })
    s.source.seed('backups/cloudflare/business-os-cloudflare-a.json', crypto.randomBytes(30000), { httpMetadata: json, customMetadata: { lifecycle: 'managed' }, multipartParts: 2, uploaded: t('21T06:00:00.000') })
    s.source.seed('backups/cloudflare/business-os-cloudflare-c.json', crypto.randomBytes(20000), { httpMetadata: json, uploaded: t('19T06:00:00.000') })
    s.source.seed('backups/cloudflare/drive-staged-zz.json', 'staged-1', { httpMetadata: json, uploaded: t('21T07:00:00.000') })
    s.source.seed('backups/cloudflare/drive-staged-aa.json', 'staged-2', { httpMetadata: json, uploaded: t('21T07:00:00.000') }) // a tie
    s.source.seed('backups/cloudflare/business-os-cloudflare-a/state.json', '{"status":"finalized"}', { httpMetadata: json, uploaded: t('21T06:00:01.000') })
    s.source.seed('backups/cloudflare/business-os-cloudflare-a/assets/products/p1.webp', crypto.randomBytes(1500), { httpMetadata: FIXTURE_HTTP, uploaded: t('21T06:00:02.000') })
    s.source.includePageCap = 4
    s.destination.includePageCap = 3
  }
  const fresh = () => {
    const s = setup('2026-09-26T00:00:00Z')
    seedSource(s)
    return s
  }
  const appKeys = (bucket) => lib.appOrder([...bucket.objects.values()].map((o) => core.describe(bucket.view(o, false))).filter((o) => lib.isOrderSensitive(o.key))).map((o) => o.key)
  const sameObjects = (s) => {
    assert.deepStrictEqual([...s.destination.objects.keys()].sort(), [...s.source.objects.keys()].sort())
    for (const [key, src] of s.source.objects) {
      const dst = s.destination.objects.get(key)
      assert.ok(dst.data.equals(src.data), `bytes of ${key}`)
      assert.deepStrictEqual(core.normalizeHttpMetadata(dst.httpMetadata), core.normalizeHttpMetadata(src.httpMetadata), `httpMetadata of ${key}`)
      assert.deepStrictEqual(dst.customMetadata, src.customMetadata, `customMetadata of ${key}`)
      assert.strictEqual(dst.storageClass, src.storageClass, `storageClass of ${key}`)
    }
  }

  await check('copy: first run copies every object exactly, in backup order, without touching the source; a second run writes nothing', async () => {
    const s = fresh()
    const before = s.source.snapshot()
    const progress = []
    const first = await run(s, 'copy', { onProgress: (done, total) => progress.push([done, total]) })
    assert.strictEqual(first.ok, true, JSON.stringify(first.problems))
    assert.ok(progress.length > 1 && progress.every(([d, t]) => Number.isInteger(d) && Number.isInteger(t) && d >= 1 && d <= t))
    assert.strictEqual(progress[progress.length - 1][0], progress[progress.length - 1][1], 'progress must reach the total')
    sameObjects(s)
    const total = [...s.source.objects.values()].reduce((n, o) => n + o.data.length, 0)
    assert.strictEqual(first.counts.sourceObjects, s.source.objects.size)
    assert.strictEqual(first.counts.sourceBytes, total)
    assert.strictEqual(first.counts.copied, s.source.objects.size)
    assert.strictEqual(first.counts.bytes, total)
    assert.strictEqual(first.counts.mismatched + first.counts.failed + first.counts.conflicts, 0)
    assert.strictEqual(first.counts.orderInversions, 0)
    assert.deepStrictEqual(appKeys(s.destination), appKeys(s.source), 'backup order must match the source')
    assert.strictEqual(s.source.writes(), 0)
    assert.strictEqual(s.source.snapshot(), before, 'the source changed')

    const writesAfterFirst = s.destination.writes()
    const second = await run(s, 'copy')
    assert.strictEqual(second.ok, true, JSON.stringify(second.problems))
    assert.strictEqual(second.counts.planCopy + second.counts.planOrdered + second.counts.planPrune, 0)
    assert.strictEqual(second.counts.skippedIdentical, s.source.objects.size)
    assert.strictEqual(second.counts.copied + second.counts.rewritten + second.counts.overwritten, 0)
    assert.strictEqual(s.destination.writes(), writesAfterFirst, 'a delta re-run wrote to the destination')
    assert.strictEqual(s.source.snapshot(), before)
  })

  await check('verify-only passes after a copy and never writes', async () => {
    const s = fresh()
    assert.ok((await run(s, 'copy')).ok)
    const writes = s.source.writes() + s.destination.writes()
    const routes = []
    const v = await run(s, 'verify-only', { record: routes })
    assert.strictEqual(v.ok, true, JSON.stringify(v.problems))
    assert.strictEqual(v.counts.identical, s.source.objects.size)
    assert.strictEqual(v.counts.sourceObjects, v.counts.destObjects)
    assert.strictEqual(v.counts.sourceBytes, v.counts.destBytes)
    assert.strictEqual(s.source.writes() + s.destination.writes(), writes)
    assert.ok(!routes.some((r) => /\/(copy|prune)$/.test(r)), `verify-only called ${routes.filter((r) => /copy|prune/.test(r))}`)
    assert.ok(routes.includes('POST /verify'), 'multipart objects must be verified by streaming')
  })

  await check('verify-only fails on every kind of difference', async () => {
    const backupA = 'backups/cloudflare/business-os-cloudflare-a.json'
    const perturbations = {
      'same-size content change': (s) => {
        const k = [...s.destination.objects.keys()].find((x) => x.startsWith('uploads/products/'))
        const o = s.destination.objects.get(k)
        o.data = Buffer.from(o.data)
        o.data[0] ^= 1
        o.etag = md5hex(o.data)
        o.checksums = { md5: Uint8Array.from(Buffer.from(o.etag, 'hex')).buffer }
      },
      'multipart source, same-size content change': (s) => {
        const o = s.destination.objects.get(backupA)
        o.data = Buffer.from(o.data)
        o.data[100] ^= 1
        o.etag = md5hex(o.data)
        o.checksums = { md5: Uint8Array.from(Buffer.from(o.etag, 'hex')).buffer }
      },
      'content type': (s) => { s.destination.objects.get('uploads/empty.txt').httpMetadata = { contentType: 'text/html' } },
      'cache expiry dropped': (s) => {
        const k = [...s.source.objects.values()].find((o) => o.httpMetadata.cacheExpiry).key
        delete s.destination.objects.get(k).httpMetadata.cacheExpiry
      },
      'custom metadata key case': (s) => {
        const k = [...s.source.objects.values()].find((o) => o.customMetadata.OriginalName).key
        const o = s.destination.objects.get(k)
        o.customMetadata = Object.fromEntries(Object.entries(o.customMetadata).map(([a, b]) => [a.toLowerCase(), b]))
      },
      'storage class': (s) => { s.destination.objects.get('uploads/cold.bin').storageClass = 'Standard' },
      'missing object': (s) => { s.destination.objects.delete('uploads/cold.bin') },
      'extra object': (s) => { s.destination.seed('uploads/extra.webp', 'x', { httpMetadata: { contentType: 'image/webp' } }) },
      'backup order': (s) => { s.destination.objects.get('backups/cloudflare/business-os-cloudflare-c.json').uploaded = new Date('2026-09-27T00:00:00Z') },
    }
    for (const [label, perturb] of Object.entries(perturbations)) {
      const s = fresh()
      assert.ok((await run(s, 'copy')).ok, label)
      perturb(s)
      const v = await run(s, 'verify-only')
      assert.strictEqual(v.ok, false, `verify-only passed despite: ${label}`)
      assert.ok(v.problems.length > 0, label)
    }
  })

  await check('copy repairs a destination whose backups are out of order, rewriting only from the first unsettled one', async () => {
    const s = fresh()
    assert.ok((await run(s, 'copy')).ok)
    // Make the oldest-but-one backup look newest in the destination.
    const c = 'backups/cloudflare/business-os-cloudflare-c.json' // oldest in the source
    const b = 'backups/cloudflare/business-os-cloudflare-b.json'
    s.destination.objects.get(b).uploaded = new Date(s.clock.t + 5000)
    s.clock.t += 10000
    assert.notDeepStrictEqual(appKeys(s.destination), appKeys(s.source))
    const oldC = s.destination.objects.get(c).version
    const r = await run(s, 'copy')
    assert.strictEqual(r.ok, true, JSON.stringify(r.problems))
    assert.deepStrictEqual(appKeys(s.destination), appKeys(s.source))
    assert.strictEqual(r.counts.orderInversions, 0)
    assert.ok(r.counts.rewritten >= 1, 'identical backups after the break must be re-put')
    assert.strictEqual(s.destination.objects.get(c).version, oldC, 'the settled oldest backup must not be rewritten')
    assert.strictEqual(r.counts.planCopy, 0, 'only backup keys needed work')
    sameObjects(s)
  })

  await check('a new backup in the source is appended without rewriting the settled ones', async () => {
    const s = fresh()
    assert.ok((await run(s, 'copy')).ok)
    s.source.seed('backups/cloudflare/business-os-cloudflare-d.json', 'newest', { httpMetadata: { contentType: 'application/json; charset=utf-8' } })
    const r = await run(s, 'copy')
    assert.strictEqual(r.ok, true, JSON.stringify(r.problems))
    assert.strictEqual(r.counts.planOrdered, 1)
    assert.strictEqual(r.counts.copied, 1)
    assert.strictEqual(r.counts.rewritten, 0)
    assert.deepStrictEqual(appKeys(s.destination), appKeys(s.source))
  })

  await check('copy prunes destination-only keys (a source rotation) and verify-only then converges', async () => {
    const s = fresh()
    assert.ok((await run(s, 'copy')).ok)
    // The app rotates a backup in the source: a folder object and a staged file go away.
    s.source.objects.delete('backups/cloudflare/business-os-cloudflare-a/assets/products/p1.webp')
    s.source.objects.delete('backups/cloudflare/drive-staged-zz.json')
    const failing = await run(s, 'verify-only')
    assert.strictEqual(failing.ok, false)
    assert.ok(failing.problems.includes('destination-only-objects'))
    const before = s.source.snapshot()
    const r = await run(s, 'copy')
    assert.strictEqual(r.ok, true, JSON.stringify(r.problems))
    assert.strictEqual(r.counts.pruned, 2)
    assert.strictEqual(s.source.snapshot(), before)
    assert.strictEqual((await run(s, 'verify-only')).ok, true)
  })

  await check('copy refuses to start after the switch, in a mixed rollout, or when production cannot be read', async () => {
    for (const state of ['destination', 'mixed', 'other', 'api-down']) {
      const s = fresh()
      const routes = []
      const r = await run(s, 'copy', { api: fakeApi(state).api, record: routes })
      assert.strictEqual(r.ok, false, state)
      assert.deepStrictEqual(r.problems, ['production-not-on-source'], state)
      assert.deepStrictEqual(routes, [], `${state}: the Worker was called`)
      assert.strictEqual(s.destination.writes(), 0)
    }
    // verify-only is read-only and may run in any state; it reports the state.
    const s = fresh()
    assert.ok((await run(s, 'copy')).ok)
    const v = await run(s, 'verify-only', { api: fakeApi('destination').api })
    assert.strictEqual(v.production.state, 'destination')
    assert.strictEqual(v.ok, true)
  })

  await check('prune is skipped when production switches during the run', async () => {
    const s = fresh()
    assert.ok((await run(s, 'copy')).ok)
    s.destination.seed('uploads/written-by-the-app-after-the-switch.webp', 'new', { httpMetadata: { contentType: 'image/webp' } })
    const r = await run(s, 'copy', { api: fakeApi('source', 'destination').api })
    assert.strictEqual(r.ok, false)
    assert.ok(r.problems.includes('production-changed-during-run'))
    assert.ok(s.destination.objects.has('uploads/written-by-the-app-after-the-switch.webp'), 'an app object was pruned')
  })

  await check('productionAssetsState reads the newest deployment and every version carrying traffic', async () => {
    assert.strictEqual((await lib.productionAssetsState(fakeApi('source').api, ACCOUNT)).state, 'source')
    assert.strictEqual((await lib.productionAssetsState(fakeApi('destination').api, ACCOUNT)).state, 'destination')
    assert.strictEqual((await lib.productionAssetsState(fakeApi('mixed').api, ACCOUNT)).state, 'mixed')
    assert.strictEqual((await lib.productionAssetsState(fakeApi('other').api, ACCOUNT)).state, 'unknown')
    assert.deepStrictEqual(await lib.productionAssetsState(fakeApi('api-down').api, ACCOUNT), { state: 'unknown', reason: 'deployments-unreadable', detail: { status: 503 } })
    assert.strictEqual(lib.PRODUCTION_WORKER, common.PRODUCTION_WORKER)
    const withBinding = (binding) => async (method, p) => (p.endsWith('/deployments')
      ? { ok: true, status: 200, json: { result: { deployments: [{ created_on: '2026-09-25T00:00:00Z', versions: [{ version_id: V1, percentage: 100 }] }] } } }
      : { ok: true, status: 200, json: { result: { resources: { bindings: binding ? [binding] : [] } } } })
    assert.deepStrictEqual(await lib.productionAssetsState(withBinding(null), ACCOUNT), { state: 'unknown', reason: 'assets-binding-missing', detail: undefined })
    assert.strictEqual((await lib.productionAssetsState(withBinding({ type: 'r2_bucket', name: 'ASSETS', bucket_name: 'business-os-assets', jurisdiction: 'eu' }), ACCOUNT)).state, 'unknown')
    assert.strictEqual((await lib.productionAssetsState(withBinding({ type: 'kv_namespace', name: 'ASSETS' }), ACCOUNT)).state, 'unknown')
    assert.strictEqual((await lib.productionAssetsState(withBinding({ type: 'r2_bucket', name: 'ASSETS', bucket_name: 'business-os-assets' }), ACCOUNT)).state, 'source')
  })

  await check('failures and mismatches are counted and fail the job; the source is never written', async () => {
    const s = fresh()
    const victim = [...s.source.objects.keys()].find((k) => k.startsWith('uploads/products/'))
    s.destination.faults.beforePut = (key) => { if (key === victim) throw new Error('simulated put failure') }
    const r = await run(s, 'copy')
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.counts.failed, 1)
    assert.ok(r.problems.includes('failed') && r.problems.includes('missing-after-copy'))
    assert.strictEqual(r.counts.copied, s.source.objects.size - 1)

    const m = fresh()
    m.destination.faults.dropHttpField = 'contentType'
    const mr = await run(m, 'copy')
    assert.strictEqual(mr.ok, false)
    assert.ok(mr.counts.mismatched > 0)
    assert.ok(mr.problems.includes('mismatched'))

    // A /verify that fails leaves the multipart objects unresolved: never identical.
    const vf = fresh()
    assert.ok((await run(vf, 'copy')).ok)
    const noVerify = await run(vf, 'verify-only', {
      wrap: (inner) => async (url, init) => (new URL(url).pathname === '/verify' ? new Response('{"error":"internal"}', { status: 500 }) : inner(url, init)),
    })
    assert.strictEqual(noVerify.ok, false)
    assert.ok(noVerify.problems.includes('objects-unresolved'))
    assert.ok(noVerify.counts.unresolved >= 2)

    const h = fresh()
    const broken = await run(h, 'copy', {
      wrap: (inner) => async (url, init) => (new URL(url).pathname === '/copy' ? new Response('{"error":"internal"}', { status: 500 }) : inner(url, init)),
    })
    assert.strictEqual(broken.ok, false)
    assert.strictEqual(broken.counts.failed, h.source.objects.size)
    assert.strictEqual(h.source.writes() + s.source.writes() + m.source.writes(), 0)
  })

  await check('positive controls: an empty source or a listing without metadata fails instead of passing vacuously', async () => {
    const empty = setup('2026-09-26T00:00:00Z')
    for (const mode of ['copy', 'verify-only']) {
      const r = await run(empty, mode)
      assert.strictEqual(r.ok, false, mode)
      assert.ok(r.problems.includes('source-listing-empty'), mode)
    }
    // The verdict itself refuses two empty listings, not only the job around it.
    const vacuous = lib.verifyVerdict(lib.classify([], []), { sourceObjects: [], destObjects: [] })
    assert.strictEqual(vacuous.ok, false)
    assert.ok(vacuous.problems.includes('source-listing-empty'))
    const stripMetadata = (inner) => async (url, init) => {
      const res = await inner(url, init)
      if (new URL(url).pathname !== '/list') return res
      const body = await res.json()
      for (const o of body.objects) { o.httpMetadata = {}; o.customMetadata = {} }
      return new Response(JSON.stringify(body), { status: 200 })
    }
    for (const mode of ['copy', 'verify-only']) {
      const s = fresh()
      if (mode === 'verify-only') assert.ok((await run(s, 'copy')).ok)
      const r = await run(s, mode, { wrap: stripMetadata })
      assert.strictEqual(r.ok, false, mode)
      assert.ok(r.problems.includes('listing-without-metadata'), mode)
    }
  })

  await check('a listing cursor that does not advance stops the job; a Worker without MD5 streaming is refused', async () => {
    const s = fresh()
    const loop = (inner) => async (url, init) => {
      if (new URL(url).pathname !== '/list') return inner(url, init)
      return new Response(JSON.stringify({ objects: [], truncated: true, cursor: 'same' }), { status: 200 })
    }
    await assert.rejects(run(s, 'verify-only', { wrap: loop }), (e) => e.code === 'list-cursor-loop')
    const noMd5 = (inner) => async (url, init) => (new URL(url).pathname === '/health'
      ? new Response(JSON.stringify({ ok: true, capabilities: { digestStreamMd5: false, fixedLengthStream: true } }), { status: 200 })
      : inner(url, init))
    const r = await run(fresh(), 'copy', { wrap: noMd5 })
    assert.deepStrictEqual(r.problems, ['worker-capability-missing'])
  })

  await check('a response that skips or reorders keys counts the whole batch as failed', () => {
    const items = [{ key: 'a' }, { key: 'b' }]
    assert.deepStrictEqual(lib.matchResults(items, { results: [{ key: 'a', outcome: 'copied' }, { key: 'b', outcome: 'copied' }] }).length, 2)
    assert.strictEqual(lib.matchResults(items, { results: [{ key: 'b' }, { key: 'a' }] }), null)
    assert.strictEqual(lib.matchResults(items, { results: [{ key: 'a' }] }), null)
    assert.strictEqual(lib.matchResults(items, {}), null)
    const t = lib.tallyCopy([{ outcome: 'copied', size: 5 }, { outcome: 'weird' }, { outcome: 'mismatch' }, { outcome: 'source-missing' }])
    assert.deepStrictEqual([t.copied, t.bytes, t.failed, t.mismatched, t.vanished], [1, 5, 1, 1, 1])
  })

  await check('batches keep order and respect the item and byte limits', () => {
    const items = [5, 5, 5, 50, 1, 1, 1, 1].map((size, i) => ({ key: `k${i}`, size }))
    const b = lib.batches(items, { maxItems: 3, maxBytes: 12 })
    assert.deepStrictEqual(b.map((g) => g.map((i) => i.key)), [['k0', 'k1'], ['k2'], ['k3'], ['k4', 'k5', 'k6'], ['k7']])
    assert.deepStrictEqual(lib.batches([], { maxItems: 3 }), [])
    // the runner never sends more than the Worker accepts
    assert.ok(lib.MAX_ITEMS_PER_COPY <= worker.MAX_COPY_ITEMS)
    assert.ok(lib.MAX_KEYS_PER_VERIFY <= worker.MAX_KEYS)
    assert.ok(lib.MAX_KEYS_PER_PRUNE <= worker.MAX_KEYS)
  })

  await check('appOrder and orderInversions follow the app: newest first, ties in key order', () => {
    const d = (key, uploaded) => ({ key, uploaded })
    // m before a on purpose: a tie must come out in key order whatever the input order
    const src = [d('backups/cloudflare/x.json', '2026-09-01T00:00:00.000Z'), d('backups/cloudflare/m.json', '2026-09-02T00:00:00.000Z'), d('backups/cloudflare/a.json', '2026-09-02T00:00:00.000Z'), d('uploads/u.webp', '2026-09-09T00:00:00.000Z')]
    assert.deepStrictEqual(lib.appOrder(src).map((o) => o.key), ['uploads/u.webp', 'backups/cloudflare/a.json', 'backups/cloudflare/m.json', 'backups/cloudflare/x.json'])
    const same = new Map(src.map((o) => [o.key, { ...o }]))
    assert.deepStrictEqual(lib.orderInversions(src, same), [])
    const swapped = new Map(same)
    swapped.set('backups/cloudflare/x.json', d('backups/cloudflare/x.json', '2026-09-03T00:00:00.000Z'))
    assert.strictEqual(lib.orderInversions(src, swapped).length, 1)
    // a tie resolved the other way round is an inversion
    const tie = new Map(same)
    tie.set('backups/cloudflare/a.json', d('backups/cloudflare/a.json', '2026-09-01T12:00:00.000Z'))
    assert.strictEqual(lib.orderInversions(src, tie).length, 1)
    assert.deepStrictEqual(['APAC', 'apac', ' Apac ', 'EEUR', 'auto', '', null, 'apac-2'].map(lib.normalizeLocation), ['apac', 'apac', 'apac', 'eeur', 'unknown', 'unknown', 'unknown', 'unknown'])
    for (const l of lib.KNOWN_LOCATIONS) assert.strictEqual(common.formatPublic('{l}', { l }), l, 'every location word must be printable')
    assert.ok(lib.isOrderSensitive('backups/cloudflare/drive-staged-x.json'))
    assert.ok(!lib.isOrderSensitive('backups/cloudflare/name/state.json'))
    assert.ok(!lib.isOrderSensitive('uploads/backups/cloudflare/x.json'))
  })

  await check('the public lines carry counts and verdict words only -- never a key, a name or metadata', async () => {
    const s = fresh()
    s.source.seed('uploads/products/Secret Product ផលិតផល 777.webp', 'x', { httpMetadata: { contentType: 'image/webp' }, customMetadata: { note: 'customer Jane' } })
    const victim = 'uploads/products/Secret Product ផលិតផល 777.webp'
    s.destination.faults.beforePut = (key) => { if (key === victim) throw new Error(`failed ${key}`) }
    const results = [await run(s, 'copy')]
    s.destination.faults = {}
    results.push(await run(s, 'verify-only'))
    s.destination.seed('uploads/destination-only-name.webp', 'x', { httpMetadata: { contentType: 'image/webp' } })
    results.push(await run(s, 'verify-only'))
    const words = new Set()
    for (const k of s.source.objects.keys()) for (const part of k.split(/[/. -]/)) if (part.length >= 5) words.add(part)
    for (const extra of ['Secret', 'Jane', 'ផលិតផល', 'destination-only-name', 'image/webp', 'managed']) words.add(extra)
    for (const r of results) {
      const text = driver.runLines(r).map(([t, v]) => common.formatPublic(t, v)).join('\n')
      for (const w of words) assert.ok(!text.includes(w), `public line leaks "${w}":\n${text}`)
      assert.ok(/problem: /.test(text) || r.ok)
    }
  })

  await check('deleteCopyWorker proves the Worker is gone', async () => {
    const api = (del, ...gets) => {
      const calls = []
      let n = 0
      return {
        calls,
        fn: async (method, p) => {
          calls.push(`${method} ${p}`)
          if (method === 'DELETE') return del
          const g = gets[Math.min(n, gets.length - 1)]
          n += 1
          return g
        },
      }
    }
    const ok = { ok: true, status: 200, json: { success: true } }
    const gone = { ok: false, status: 404, json: { success: false, errors: [{ code: 10007 }] } }
    const pause = async () => {}
    const a = api(ok, gone)
    assert.deepStrictEqual(await driver.deleteCopyWorker(a.fn, ACCOUNT, { pause }).then((r) => [r.deleted, r.after, r.ok]), ['deleted', 'absent', true])
    assert.ok(a.calls[0] === `DELETE /accounts/${ACCOUNT}/workers/scripts/business-os-r2-copy?force=true`)
    assert.deepStrictEqual(await driver.deleteCopyWorker(api(gone, gone).fn, ACCOUNT, { pause }).then((r) => [r.deleted, r.ok]), ['already-absent', true])
    assert.deepStrictEqual(await driver.deleteCopyWorker(api(ok, ok, ok, gone).fn, ACCOUNT, { pause }).then((r) => r.after), 'absent')
    assert.deepStrictEqual(await driver.deleteCopyWorker(api(ok, ok).fn, ACCOUNT, { pause }).then((r) => [r.after, r.ok]), ['still-present', false])
    assert.deepStrictEqual(await driver.deleteCopyWorker(api({ ok: false, status: 403, json: null }, { ok: false, status: 403, json: null }).fn, ACCOUNT, { pause }).then((r) => r.ok), false)
  })

  await check('waitForHealth polls through 503/401/network until the Worker answers, and gives up at the deadline', async () => {
    let t = 0
    const seq = [{ status: 0 }, { status: 503, json: { error: 'not-configured' } }, { status: 401, json: {} }, { status: 200, json: { ok: true } }]
    let i = 0
    const client = { probe: async () => seq[Math.min(i++, seq.length - 1)] }
    const r = await driver.waitForHealth(client, { pause: async (ms) => { t += ms }, now: () => t })
    assert.strictEqual(r.polls, 4)
    const never = { probe: async () => ({ status: 503 }) }
    let u = 0
    await assert.rejects(driver.waitForHealth(never, { pause: async (ms) => { u += ms }, now: () => u, deadlineMs: 30000 }), (e) => e.code === 'worker-not-reachable')
  })

  await check('the copy Worker config: same account as the API calls, bound to exactly the two buckets', () => {
    assert.doesNotThrow(() => driver.checkWorkerConfig('743e5b727d139e85ed11679097f6f99e'))
    assert.throws(() => driver.checkWorkerConfig(ACCOUNT), (e) => e.code === 'account-mismatch')
    const good = { accountId: ACCOUNT, bindings: [['SOURCE', 'business-os-assets'], ['DESTINATION', 'business-os-assets-apac']] }
    assert.doesNotThrow(() => driver.checkWorkerConfig(ACCOUNT, good))
    assert.throws(() => driver.checkWorkerConfig(ACCOUNT, { ...good, bindings: [['SOURCE', 'business-os-assets-apac'], ['DESTINATION', 'business-os-assets']] }), (e) => e.code === 'worker-config-mismatch')
    assert.throws(() => driver.checkWorkerConfig(ACCOUNT, { ...good, bindings: [...good.bindings, ['OTHER', 'x']] }), (e) => e.code === 'worker-config-mismatch')
    // the Windows runner checks out with CRLF: same reading
    const text = require('fs').readFileSync(driver.WORKER_TOML, 'utf8')
    const lf = driver.parseWorkerToml(text.replace(/\r\n/g, '\n'))
    assert.deepStrictEqual(driver.parseWorkerToml(text.replace(/\r?\n/g, '\r\n')), lf)
    assert.deepStrictEqual(lf, { accountId: '743e5b727d139e85ed11679097f6f99e', bindings: [['SOURCE', 'business-os-assets'], ['DESTINATION', 'business-os-assets-apac']] })
  })

  if (process.exitCode) console.error(`test-ops-r2-driver-pure: FAILED (${passed} passed)`)
  else console.log(`test-ops-r2-driver-pure: ${passed} checks passed`)
}

main().catch((err) => {
  console.error(`test-ops-r2-driver-pure: crashed: ${err && err.stack}`)
  process.exitCode = 1
})
