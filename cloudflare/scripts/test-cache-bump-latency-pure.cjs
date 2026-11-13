'use strict'
// W3 Slice A round 2 (review F4). bumpVersions now runs on the response path of the hottest writes (POST /api/sales, POST /api/returns), so its
// KV round trips must not queue up: the per-namespace reads, and the per-namespace writes, are independent and run together (2 round trips, not
// 2N). The real lib/cache.ts runs over a SLOW fake KV (every get/put/delete waits KV_MS) and the elapsed time of a four-namespace bump is
// measured: sequential is >= 8 x KV_MS, parallel is about 2 x KV_MS. The same file pins what must NOT change:
//   - one consumeQuota admission per bumpVersions call, covering every KV candidate;
//   - each namespace advances by exactly one, exactly as before;
//   - a failing put hands ONLY that namespace over to D1 (key deleted, one upsert), the others stay on KV;
//   - a critical/exhausted quota zone moves every candidate to D1 in one upsert;
//   - faults are swallowed (the call never rejects).
// Run (from cloudflare/): node scripts/test-cache-bump-latency-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const KV_MS = 50
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const load = (requireFor) => {
  const filename = path.join(__dirname, '../src/lib/cache.ts')
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, requireFor, mod, filename, path.dirname(filename))
  return mod.exports
}
const quotaCalls = []
const d1Batches = []
let zone = 'ok'
const fakeD1 = { prepare: () => ({ get: async () => undefined, all: async () => [] }), batch: async (statements) => { d1Batches.push(statements); return [] } }
const stubs = {
  './db': { getDb: () => fakeD1 },
  './quotaGuard': { consumeQuota: async (_env, resource, amount) => { quotaCalls.push([resource, amount]); return { zone } } },
  './cacheKey': { cacheIdentity: () => undefined, deploymentId: () => 'dev', isUnsafeVersion: () => false, readDataEpoch: async () => 'e' },
}
const cacheLib = load((id) => (id in stubs ? stubs[id] : require(id)))
const slowKv = (failPutFor) => {
  const store = new Map()
  const log = []
  return {
    store, log,
    CACHE: {
      get: async (key) => { await sleep(KV_MS); return store.has(key) ? store.get(key) : null },
      put: async (key, value) => { await sleep(KV_MS); if (failPutFor && key.includes(failPutFor)) throw new Error('same-key write limit'); store.set(key, value); log.push(`put:${key}`) },
      delete: async (key) => { await sleep(KV_MS); store.delete(key); log.push(`delete:${key}`) },
    },
  }
}
const versionOf = (kv, namespace) => Number([...kv.store].find(([key]) => key.endsWith(`:${namespace}`))?.[1] ?? 0)

;(async () => {
  const namespaces = ['products', 'returns', 'sales', 'stock']
  // 1. latency
  const kv = slowKv()
  for (const namespace of namespaces) kv.store.set(`v2:${namespace}`, '4')
  const keyOf = (namespace) => [...kv.store.keys()].find((key) => key.endsWith(`:${namespace}`))
  assert.ok(namespaces.every(keyOf), 'control: the KV keys are shaped v2:<namespace>')
  quotaCalls.length = 0
  const startedAt = Date.now()
  await cacheLib.bumpVersions({ CACHE: kv.CACHE }, namespaces)
  const elapsed = Date.now() - startedAt
  console.log(`bumpVersions(4 namespaces) over a ${KV_MS} ms KV: ${elapsed} ms (sequential would be about ${namespaces.length * 2 * KV_MS} ms)`)
  assert.ok(elapsed < namespaces.length * 2 * KV_MS * 0.6, `the KV reads and writes run together: ${elapsed} ms for ${namespaces.length} namespaces`)
  assert.equal(quotaCalls.length, 1, 'one quota admission')
  assert.deepEqual(quotaCalls[0], ['kv_write', 4])
  for (const namespace of namespaces) assert.equal(versionOf(kv, namespace), 5, `${namespace} advanced by exactly one`)
  console.log('PASS the four KV reads and four KV writes of one bump overlap; one admission; every namespace +1')

  // 2. a failing put hands only that namespace to D1
  const flaky = slowKv('sales')
  for (const namespace of namespaces) flaky.store.set(`v2:${namespace}`, '9')
  d1Batches.length = 0
  await cacheLib.bumpVersions({ CACHE: flaky.CACHE }, namespaces)
  const flakyKey = (namespace) => [...flaky.store.keys()].find((key) => key.endsWith(`:${namespace}`))
  assert.equal(flakyKey('sales'), undefined, 'the namespace whose put failed left KV')
  for (const namespace of ['products', 'returns', 'stock']) assert.equal(flaky.store.get(flakyKey(namespace)), '10', `${namespace} stayed on KV and advanced`)
  assert.equal(d1Batches.length, 1, 'one D1 batch for the handoff')
  const entries = JSON.parse(d1Batches[0][0].params.entries)
  assert.deepEqual(entries, [{ namespace: 'sales', minimumVersion: 10 }], 'only the failed namespace is handed over, one step beyond the value it replaced')
  console.log('PASS a failing put hands only that namespace to D1')

  // 3. a critical zone moves every candidate to D1 in one upsert and deletes the KV keys
  zone = 'critical'
  const critical = slowKv()
  for (const namespace of namespaces) critical.store.set(`v2:${namespace}`, '2')
  d1Batches.length = 0
  const criticalStart = Date.now()
  await cacheLib.bumpVersions({ CACHE: critical.CACHE }, namespaces)
  const criticalElapsed = Date.now() - criticalStart
  zone = 'ok'
  assert.equal(critical.store.size, 0, 'every KV counter was deleted at the handoff')
  assert.equal(d1Batches.length, 1)
  assert.deepEqual(JSON.parse(d1Batches[0][0].params.entries).map((entry) => `${entry.namespace}:${entry.minimumVersion}`).sort(), ['products:3', 'returns:3', 'sales:3', 'stock:3'])
  assert.ok(criticalElapsed < namespaces.length * 2 * KV_MS * 0.6, `the handoff deletes overlap too: ${criticalElapsed} ms`)
  console.log('PASS a critical quota zone hands every namespace to D1 in one upsert, deletes overlapping')

  // 4. faults never reject
  const failing = { CACHE: { get: async () => { throw new Error('KV down') }, put: async () => { throw new Error('KV down') }, delete: async () => { throw new Error('KV down') } } }
  const original = console.error
  console.error = () => {}
  try { await cacheLib.bumpVersions(failing, namespaces) } finally { console.error = original }
  console.log('PASS a KV outage is swallowed')
  console.log('test-cache-bump-latency-pure: ok')
})().catch((error) => { console.error(error); process.exit(1) })
