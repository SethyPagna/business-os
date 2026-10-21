// Branch-cutover maintenance ends (finalize, abort) must move every cache version, as a backup restore does
// (lib/cache.ts invalidateCachesAfterMaintenance): caches filled before or during the run must not outlive the
// fence. A step that leaves the fence held (begin, a refused abort) moves nothing.
// Run (from cloudflare/): node scripts/test-branch-cutover-release-bumps-caches-native.cjs
'use strict'
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { build } = require('esbuild')
const e2e = require('./test-branch-cutover-parent-e2e-native.cjs')
const root = path.resolve(__dirname, '..')
const repo = path.resolve(root, '..')
const TOKEN = 'cutover-operator-test-token-0123456789abcdef'
const ACTOR_USER = 7
const NAMESPACES = ['products', 'settings', 'stock', 'promotions', 'sales', 'returns', 'customers', 'suppliers', 'delivery_contacts', 'inventory', 'audit_log']

async function bundleApp() {
  const entry = `
    import { Hono } from 'hono'
    import route from './src/routes/branchCutoverOperator.ts'
    const app = new Hono()
    app.route('/api/internal/branch-cutover', route)
    export default app`
  const out = await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent' })
  const module = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require)
  return module.exports.default
}
function withFirst(d1) {
  const decorate = (statement) => ({ ...statement, bind: (...values) => decorate(statement.bind(...values)),
    first: async (column) => { const row = (await statement.all()).results[0] ?? null; return column ? row?.[column] ?? null : row } })
  return { prepare: (sql) => decorate(d1.prepare(sql)), batch: (statements) => d1.batch(statements) }
}
function kv() {
  const store = new Map()
  return { store, get: async (key) => store.get(key) ?? null, put: async (key, value) => { store.set(key, String(value)) }, delete: async (key) => { store.delete(key) } }
}
const versions = (cache) => Object.fromEntries(NAMESPACES.map((ns) => [ns, cache.store.get(`v2:${ns}`) ?? null]))

async function main() {
  const loop = await import(pathToFileURL(path.join(repo, 'ops', 'scripts', 'branch-cutover-loop.mjs')).href)
  const app = await bundleApp()
  let failed = 0
  const check = async (name, fn) => {
    try { await fn(); console.log('PASS ' + name) } catch (error) { failed += 1; console.log(`FAIL ${name}\n${error && error.stack ? error.stack : error}`) }
  }
  function setup() {
    const w = e2e.world({ generatedProducts: 2 })
    const cache = kv()
    const env = { DB: withFirst(w.db.d1), CACHE: cache, BRANCH_CUTOVER_OPERATOR_TOKEN: TOKEN }
    const send = async (action, text) => {
      const response = await app.fetch(new Request(`http://operator.test/api/internal/branch-cutover/${action}`,
        { method: 'POST', headers: { 'content-type': 'application/json', 'x-cutover-operator-token': TOKEN }, body: text }), env)
      let json = null
      try { json = await response.json() } catch { }
      return { status: response.status, json }
    }
    return { w, cache, send, client: () => loop.createClient({ send, sleep: () => Promise.resolve() }) }
  }
  const held = (w) => w.raw.prepare("SELECT count(*) n FROM system_flags WHERE key='maintenance'").get().n

  await check('abort releases the fence and moves every cache version; begin, a refused abort and status move nothing', async () => {
    const { w, cache, send, client } = setup()
    const started = await loop.startCutover(client(), { actorUserId: ACTOR_USER, requestId: 'cutover_cache_abort_1' })
    const id = started.state.operationId
    assert.equal(held(w), 1)
    assert.deepEqual(versions(cache), Object.fromEntries(NAMESPACES.map((ns) => [ns, null])), 'begin moves nothing')
    const refused = await send('abort', JSON.stringify({ operationId: id, expectedRevision: started.state.revision, requestId: 'wrong_request_id_1' }))
    assert.equal(refused.status, 409)
    await send('status', JSON.stringify({ operationId: id }))
    assert.equal(held(w), 1)
    assert.equal(cache.store.size, 0, 'a refused abort and a status read move nothing')
    const aborted = await loop.abortCutover(client(), { operationId: id })
    assert.equal(aborted.state.phase, 'aborted')
    assert.equal(held(w), 0)
    for (const [ns, value] of Object.entries(versions(cache))) assert.notEqual(value, null, `abort moved ${ns}`)
    w.raw.close()
  })

  await check('finalize releases the fence and moves every cache version', async () => {
    const { w, cache, client } = setup()
    const started = await loop.startCutover(client(), { actorUserId: ACTOR_USER, requestId: 'cutover_cache_final_1' })
    const id = started.state.operationId
    const ready = await loop.resumeUntilReady(client(), { operationId: id, stepLimit: 4000, deadline: Infinity })
    assert.equal(ready.state.phase, 'ready')
    assert.equal(cache.store.size, 0, 'no step before finalize moves a version')
    await loop.finalizeCutover(client(), { operationId: id })
    assert.equal(held(w), 0)
    for (const [ns, value] of Object.entries(versions(cache))) assert.notEqual(value, null, `finalize moved ${ns}`)
    w.raw.close()
  })

  if (failed) process.exitCode = 1
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
