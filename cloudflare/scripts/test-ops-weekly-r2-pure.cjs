#!/usr/bin/env node
// The weekly set's R2 store (ops/scripts/weekly/r2-store.mjs) against a local fake: no network, no real R2. It pins the SigV4 signer to the
// published AWS test vector, the prefix guard (nothing outside backups/weekly/ is ever put, read, listed or deleted), the upload-then-HEAD
// check, pruning to exactly four sets without ever touching the newest verified one, and the order marker-last. Planted mutants of the store
// must each fail the same scenario.
'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..', '..')
const WEEKLY = path.join(ROOT, 'ops', 'scripts', 'weekly')
let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1 } catch (err) { process.exitCode = 1; console.error(`FAIL ${name}\n  ${err && err.stack}`) }
}

// An in-memory R2: the bucket's objects plus a log of every call. `faults` bends it (a wrong stored size, a PUT that throws on one key).
function fakeBucket(initial = {}, faults = {}) {
  const objects = new Map(Object.entries(initial).map(([k, v]) => [k, Buffer.from(v)]))
  const calls = []
  return {
    objects, calls,
    async put(key, body) {
      calls.push(['put', key])
      if (faults.failPut && faults.failPut(key)) throw new Error('put refused')
      objects.set(key, Buffer.from(body))
    },
    async head(key) {
      calls.push(['head', key])
      if (!objects.has(key)) return null
      const body = objects.get(key)
      return { size: faults.shortBy && faults.shortBy(key) ? body.length - 1 : body.length, etag: crypto.createHash('md5').update(body).digest('hex') }
    },
    async list(prefix) {
      calls.push(['list', prefix])
      return [...objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, body]) => ({ key, size: body.length }))
    },
    async delete(key) { calls.push(['delete', key]); objects.delete(key) },
  }
}

const files = (n) => [{ name: 'manifest.enc.json', bytes: Buffer.from(`manifest-${n}`) }, { name: 'c000001.enc.json', bytes: Buffer.from(`chunk-${n}`) }]
const setOf = (id) => ({ [`backups/weekly/${id}/manifest.enc.json`]: 'm', [`backups/weekly/${id}/c000001.enc.json`]: 'c' })
const NOW = new Date('2026-11-08T21:00:00Z')
const GOOD = { runId: 'r6', backupOk: true, finishedAt: '2026-11-08T20:50:00Z', manifestSha256: 'ab'.repeat(32) }
// The bell's rules (lane/backup-weekly-bell), copied here on purpose and not imported from cloudflare/src.
function bellRules(m, now) {
  const bad = []
  if (typeof m.format !== 'string' || !m.format.startsWith('business-os-weekly-backup')) bad.push('format')
  if (m.backupOk !== true) bad.push('backupOk')
  const t = Date.parse(m.finishedAt)
  if (!Number.isFinite(t) || t > now.getTime()) bad.push('finishedAt')
  if (typeof m.runId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(m.runId)) bad.push('runId')
  if (typeof m.manifestSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(m.manifestSha256)) bad.push('manifestSha256')
  return bad
}
const OLD_MARKER = '{"format":"old","finishedAt":"2026-11-01T00:00:00Z"}\n'

async function scenario(store, constants) {
  const { weeklyStore, storeWeekly, pruneSets, buildMarker, assertWeeklyKey } = store

  // the prefix guard: every verb, every way out of backups/weekly/
  const bucket = fakeBucket({ 'backups/manifest/keep.json': 'x', 'backups/cloudflare/keep.json': 'y' })
  const guarded = weeklyStore(bucket)
  const refused = ['backups/manifest/x.json', 'backups/weekly', 'backups/weekly/', 'backups/weekly/../manifest/x.json', 'backups/weekly/a//b', 'uploads/p.jpg', '/backups/weekly/a/b', 'backups/weekly-evil/a', '', null, undefined, 42, 'backups\\weekly\\a']
  for (const key of refused) {
    await assert.rejects(() => guarded.put(key, Buffer.from('z')), (e) => e.code === 'weekly-key-refused', `put ${String(key)}`)
    await assert.rejects(() => guarded.head(key), (e) => e.code === 'weekly-key-refused', `head ${String(key)}`)
    await assert.rejects(() => guarded.delete(key), (e) => e.code === 'weekly-key-refused', `delete ${String(key)}`)
  }
  for (const prefix of ['backups/', 'backups/manifest/', 'backups/weekly', 'backups/weekly/../', '', 'uploads/']) {
    await assert.rejects(() => guarded.list(prefix), (e) => e.code === 'weekly-key-refused', `list ${prefix}`)
  }
  assert.deepStrictEqual(bucket.calls, [], 'a refused call never reaches the bucket')
  assert.strictEqual(assertWeeklyKeyOk(assertWeeklyKey), true)

  // the marker carries only allowlisted fields
  const marker = buildMarker({ format: 'f/1', runId: '9', backupOk: true, tableRows: { customers: 12 }, customerName: 'CANARY', engines: { node: 'v24' } })
  assert.deepStrictEqual(Object.keys(marker).sort(), ['backupOk', 'engines', 'format', 'runId'])
  assert.ok(!JSON.stringify(marker).includes('CANARY'))

  // a good week: upload, verify, prune to exactly four, marker last
  const full = fakeBucket({ ...setOf('2026-10-04-r1'), ...setOf('2026-10-11-r2'), ...setOf('2026-10-18-r3'), ...setOf('2026-10-25-r4'), ...setOf('2026-11-01-r5'), 'backups/weekly/latest.json': OLD_MARKER, 'backups/manifest/other.json': 'keep' })
  const result = await storeWeekly({ store: weeklyStore(full), setId: '2026-11-08-r6', files: files(6), marker: GOOD, now: NOW })
  assert.strictEqual(result.ok, true)
  const kept = [...full.objects.keys()].filter((k) => k.startsWith('backups/weekly/') && k !== constants.marker).map((k) => k.split('/')[2])
  assert.deepStrictEqual([...new Set(kept)].sort(), ['2026-10-11-r2', '2026-10-18-r3', '2026-10-25-r4', '2026-11-01-r5', '2026-11-08-r6'].slice(1), 'exactly the newest four')
  assert.ok(!full.objects.has('backups/weekly/2026-10-04-r1/manifest.enc.json') && !full.objects.has('backups/weekly/2026-10-11-r2/manifest.enc.json'), 'the two oldest are gone')
  assert.ok(full.objects.has('backups/manifest/other.json'), 'nothing outside the weekly prefix was touched')
  assert.deepStrictEqual(full.calls.filter(([verb]) => verb === 'delete').filter(([, key]) => !key.startsWith('backups/weekly/')), [])
  const lastPut = [...full.calls].reverse().find(([verb]) => verb === 'put')
  assert.strictEqual(lastPut[1], constants.marker, 'the marker is the LAST put')
  const firstDelete = full.calls.findIndex(([verb]) => verb === 'delete')
  const lastDataPut = full.calls.map(([v, k], i) => (v === 'put' && k !== constants.marker ? i : -1)).reduce((a, b) => Math.max(a, b), -1)
  assert.ok(firstDelete > lastDataPut, 'pruning starts only after every file of the new set is uploaded and verified')
  assert.deepStrictEqual(JSON.parse(full.objects.get(constants.marker).toString()), { format: 'business-os-weekly-backup/1', ...GOOD })
  assert.deepStrictEqual(bellRules(JSON.parse(full.objects.get(constants.marker).toString()), NOW), [], 'the Worker bell accepts the marker that was written')

  // a set that fails HEAD: nothing pruned, the old marker stays
  const short = fakeBucket({ ...setOf('2026-10-04-r1'), ...setOf('2026-10-11-r2'), ...setOf('2026-10-18-r3'), ...setOf('2026-10-25-r4'), ...setOf('2026-11-01-r5'), 'backups/weekly/latest.json': OLD_MARKER }, { shortBy: (key) => key.endsWith('c000001.enc.json') && key.includes('2026-11-08') })
  const bad = await storeWeekly({ store: weeklyStore(short), setId: '2026-11-08-r6', files: files(6), marker: GOOD, now: NOW })
  assert.strictEqual(bad.ok, false)
  assert.ok(!short.calls.some(([verb]) => verb === 'delete'), 'no prune when the new set failed its HEAD check')
  assert.strictEqual(short.objects.get(constants.marker).toString(), OLD_MARKER, 'the old marker still stands')

  // a crash between the last data file and the marker: the old marker stands, the error surfaces
  const crash = fakeBucket({ ...setOf('2026-11-01-r5'), 'backups/weekly/latest.json': OLD_MARKER }, { failPut: (key) => key === constants.marker })
  await assert.rejects(() => storeWeekly({ store: weeklyStore(crash), setId: '2026-11-08-r6', files: files(6), marker: GOOD, now: NOW }), /put refused/)
  assert.strictEqual(crash.objects.get(constants.marker).toString(), OLD_MARKER)

  // pruning never deletes the newest verified set, even with keep 1; an unverified call deletes nothing; an incomplete (no manifest) folder never counts as a kept set
  const lone = fakeBucket({ ...setOf('2026-10-25-r4'), ...setOf('2026-11-01-r5'), 'backups/weekly/2026-11-08-r6/c000001.enc.json': 'partial', ...setOf('2026-11-15-r7') })
  const one = await pruneSets({ store: weeklyStore(lone), newestVerifiedId: '2026-11-15-r7', keep: 1 })
  assert.ok(lone.objects.has('backups/weekly/2026-11-15-r7/manifest.enc.json'), 'the newest verified set stays')
  assert.ok(!lone.objects.has('backups/weekly/2026-10-25-r4/manifest.enc.json') && !lone.objects.has('backups/weekly/2026-11-01-r5/manifest.enc.json'))
  assert.strictEqual(one.deleted > 0, true)
  // a complete set NEWER than the verified one takes the only slot, and the verified set still stays
  const newer = fakeBucket({ ...setOf('2026-10-25-r4'), ...setOf('2026-11-01-r5'), ...setOf('2026-11-15-r7') })
  await pruneSets({ store: weeklyStore(newer), newestVerifiedId: '2026-11-01-r5', keep: 1 })
  assert.ok(newer.objects.has('backups/weekly/2026-11-01-r5/manifest.enc.json') && newer.objects.has('backups/weekly/2026-11-15-r7/manifest.enc.json') && !newer.objects.has('backups/weekly/2026-10-25-r4/manifest.enc.json'), 'the verified set is never pruned')
  const untouched = fakeBucket({ ...setOf('2026-10-25-r4'), ...setOf('2026-11-01-r5') })
  assert.deepStrictEqual(await pruneSets({ store: weeklyStore(untouched), newestVerifiedId: '2026-11-01-r5', verified: false }), { deleted: 0, kept: [], skipped: 'new-set-not-verified' })
  assert.deepStrictEqual(await pruneSets({ store: weeklyStore(untouched), newestVerifiedId: '2026-12-01-nope' }), { deleted: 0, kept: ['2026-11-01-r5', '2026-10-25-r4'], skipped: 'newest-not-found' })
  assert.ok(![...untouched.calls].some(([verb]) => verb === 'delete'))
  await assert.rejects(() => pruneSets({ store: weeklyStore(untouched), newestVerifiedId: '2026-11-01-r5', keep: 0 }), (e) => e.code === 'weekly-keep-invalid')
}
const assertWeeklyKeyOk = (assertWeeklyKey) => assertWeeklyKey('backups/weekly/2026-11-08-r6/manifest.enc.json') === 'backups/weekly/2026-11-08-r6/manifest.enc.json'

async function main() {
  const store = await import(pathToFileURL(path.join(WEEKLY, 'r2-store.mjs')).href)
  const constants = await import(pathToFileURL(path.join(WEEKLY, 'constants.mjs')).href)
  const names = { marker: constants.WEEKLY_MARKER_KEY }

  await check('constants: the prefix, the marker key and keeping four', () => {
    assert.strictEqual(constants.WEEKLY_PREFIX, 'backups/weekly/')
    assert.strictEqual(constants.WEEKLY_MARKER_KEY, 'backups/weekly/latest.json')
    assert.strictEqual(constants.WEEKLY_KEEP, 4)
    assert.strictEqual(constants.EXPORT_MAX_ROWS_READ, 600000)
  })

  await check('SigV4 signer equals the published AWS get-vanilla test vector', () => {
    const auth = store.sigV4Authorization({
      method: 'GET', canonicalUri: '/', headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', amzDate: '20150830T123600Z', region: 'us-east-1', service: 'service',
      accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    })
    assert.strictEqual(auth, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31')
    assert.strictEqual(store.secretFromToken('abc'), crypto.createHash('sha256').update('abc').digest('hex'))
  })

  await check('the store: prefix guard, upload then HEAD, pruning to four, marker last, crash safety', async () => {
    await scenario(store, names)
  })

  await check('the S3 client over a fake fetch: signed requests, paged LIST, 404 on delete is fine, the guard sits in front of it', async () => {
    const objects = new Map()
    const seen = []
    const fakeFetch = async (url, init) => {
      const u = new URL(url)
      seen.push({ method: init.method, path: u.pathname, auth: init.headers.authorization, hash: init.headers['x-amz-content-sha256'] })
      assert.strictEqual(u.host, 'acct.r2.cloudflarestorage.com')
      const key = decodeURIComponent(u.pathname.replace(/^\/bkt\/?/, ''))
      if (init.method === 'PUT') { objects.set(key, Buffer.from(init.body)); return new Response('', { status: 200 }) }
      if (init.method === 'HEAD') return objects.has(key) ? new Response('', { status: 200, headers: { 'content-length': String(objects.get(key).length), etag: `"${crypto.createHash('md5').update(objects.get(key)).digest('hex')}"` } }) : new Response('', { status: 404 })
      if (init.method === 'DELETE') { objects.delete(key); return new Response(null, { status: 204 }) }
      const prefix = u.searchParams.get('prefix')
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort()
      const from = Number(u.searchParams.get('continuation-token') || 0)
      const page = all.slice(from, from + 2)
      const more = from + 2 < all.length
      return new Response(`<ListBucketResult>${page.map((k) => `<Contents><Key>${k.replace(/&/g, '&amp;')}</Key><Size>${objects.get(k).length}</Size></Contents>`).join('')}<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${from + 2}</NextContinuationToken>` : ''}</ListBucketResult>`, { status: 200 })
    }
    const client = store.s3Client({ accountId: 'acct', bucket: 'bkt', accessKeyId: 'id', secretAccessKey: 'secret', fetchFn: fakeFetch, now: () => new Date('2026-11-08T20:30:00.123Z') })
    const guarded = store.weeklyStore(client)
    for (const id of ['2026-10-04-r1', '2026-10-11-r2', '2026-10-18-r3', '2026-10-25-r4', '2026-11-01-r5']) for (const f of files(id)) await guarded.put(`backups/weekly/${id}/${f.name}`, f.bytes)
    assert.strictEqual((await guarded.list('backups/weekly/')).length, 10, 'a LIST of five pages reads every object')
    const done = await store.storeWeekly({ store: guarded, setId: '2026-11-08-r6', files: files('r6'), marker: GOOD, now: NOW })
    assert.strictEqual(done.ok, true)
    assert.ok(seen.every((r) => /^AWS4-HMAC-SHA256 Credential=id\/20261108\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/.test(r.auth)))
    assert.strictEqual([...objects.keys()].filter((k) => k.includes('2026-10-04-r1') || k.includes('2026-10-11-r2')).length, 0, 'older sets pruned through the client')
    await client.delete('backups/weekly/never-was/x')
    await assert.rejects(() => guarded.delete('backups/manifest/x'), (e) => e.code === 'weekly-key-refused')
    assert.strictEqual(seen.filter((r) => r.method === 'DELETE' && !r.path.startsWith('/bkt/backups/weekly/')).length, 0)
  })

  await check('the marker: the exact shape the bell accepts, and a marker the bell would refuse is never written', async () => {
    assert.strictEqual(store.MARKER_FORMAT, 'business-os-weekly-backup/1')
    const ok = { format: store.MARKER_FORMAT, ...GOOD }
    assert.deepStrictEqual(store.markerProblems(ok, NOW), [])
    assert.deepStrictEqual(bellRules(ok, NOW), [])
    const cases = [['backupOk', { backupOk: false }], ['finishedAt', { finishedAt: '2026-11-08T21:00:01Z' }], ['finishedAt', { finishedAt: 'yesterday' }], ['runId', { runId: 'a b' }], ['runId', { runId: 'x'.repeat(65) }], ['manifestSha256', { manifestSha256: 'AB'.repeat(32) }], ['manifestSha256', { manifestSha256: 'ab'.repeat(31) }]]
    for (const [rule, change] of cases) {
      const bad = { ...ok, ...change }
      assert.ok(store.markerProblems(bad, NOW).includes(rule), `${rule} ${JSON.stringify(change)}`)
      assert.ok(bellRules(bad, NOW).includes(rule), `the copied rule agrees: ${rule}`)
      const bucket = fakeBucket({ 'backups/weekly/latest.json': OLD_MARKER })
      await assert.rejects(() => store.storeWeekly({ store: store.weeklyStore(bucket), setId: '2026-11-08-r6', files: files(6), marker: { ...GOOD, ...change }, now: NOW }), (e) => e.code === 'weekly-marker-invalid')
      assert.deepStrictEqual(bucket.calls, [], 'nothing is uploaded for an invalid marker')
    }
    assert.ok(store.markerProblems({ ...ok, format: 'other/1' }, NOW).includes('format'))
  })

  await check('set ids and keys: a plain date-run id only; no secret-looking or climbing names', () => {
    assert.strictEqual(store.setIdFor('2026-11-08T20:30:00Z', '44601234567'), '2026-11-08-44601234567')
    for (const bad of [['2026-11-08', ''], ['nope', '1']]) assert.throws(() => store.setIdFor(...bad), (e) => e.code === 'weekly-set-id-invalid')
    for (const bad of ['backups/weekly/a b/x', 'backups/weekly/a/../x', 'backups/weekly/%2e%2e/x']) assert.throws(() => store.assertWeeklyKey(bad), (e) => e.code === 'weekly-key-refused')
  })

  const mutants = [
    ['prefix guard lets every key through', (s) => s.replace("if (!text.startsWith(WEEKLY_PREFIX) || text.length > 512", "if (false && !text.startsWith(WEEKLY_PREFIX) || text.length > 512")],
    ['keeps five sets, not four', (s) => s.replace("slice(0, keep).map", "slice(0, keep + 1).map")],
    ['the marker is written before the prune and the verify', (s) => s.replace("  const uploaded = await uploadSet({ store, setId, files })\n", "  await store.put(WEEKLY_MARKER_KEY, Buffer.from(`${JSON.stringify(buildMarker(marker))}\\n`))\n  const uploaded = await uploadSet({ store, setId, files })\n")],
    ['prune runs although the new set failed its HEAD', (s) => s.replace("  if (!uploaded.ok) return { ok: false, uploaded, pruned: null, marker: false }\n", "")],
    ['the newest verified set can be pruned', (s) => s.replace("  keepIds.add(newestVerifiedId)\n", "")],
    ['the marker keeps every field', (s) => s.replace("if (Object.prototype.hasOwnProperty.call(fields, name)) marker[name] = fields[name]", "marker[name] = fields[name]; Object.assign(marker, fields)")],
    ['HEAD size is not compared', (s) => s.replace("head.size !== file.bytes.length ||", "false ||")],
  ]
  for (const [label, mutate] of mutants) {
    await check(`mutant caught: ${label}`, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-r2-mutant-'))
      try {
        fs.cpSync(path.join(ROOT, 'ops', 'scripts', 'ops-common.mjs'), path.join(dir, 'ops', 'scripts', 'ops-common.mjs'))
        for (const f of ['ops-crypto.mjs']) fs.cpSync(path.join(ROOT, 'ops', 'scripts', f), path.join(dir, 'ops', 'scripts', f))
        fs.mkdirSync(path.join(dir, 'ops', 'keys'), { recursive: true })
        for (const f of fs.readdirSync(path.join(ROOT, 'ops', 'keys'))) fs.cpSync(path.join(ROOT, 'ops', 'keys', f), path.join(dir, 'ops', 'keys', f))
        fs.mkdirSync(path.join(dir, 'ops', 'scripts', 'weekly'), { recursive: true })
        fs.cpSync(path.join(WEEKLY, 'constants.mjs'), path.join(dir, 'ops', 'scripts', 'weekly', 'constants.mjs'))
        const file = path.join(dir, 'ops', 'scripts', 'weekly', 'r2-store.mjs')
        const source = fs.readFileSync(path.join(WEEKLY, 'r2-store.mjs'), 'utf8').replace(/\r\n/g, '\n')
        const mutated = mutate(source)
        assert.notStrictEqual(mutated, source, 'the mutation must change the store')
        fs.writeFileSync(file, mutated)
        const broken = await import(pathToFileURL(file).href)
        await assert.rejects(() => scenario(broken, names), /./, 'the scenario must go red on this mutant')
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })
  }

  console.log(process.exitCode ? `test-ops-weekly-r2-pure: FAILED (${passed} passed)` : `test-ops-weekly-r2-pure: ${passed} checks passed`)
}

main().catch((err) => { process.exitCode = 1; console.error(err) })
