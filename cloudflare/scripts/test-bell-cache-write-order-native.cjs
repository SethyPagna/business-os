#!/usr/bin/env node
// The bell's plan-lifetime sections on a real workerd Cache API (read-budget world): an entry is stamped with the START of its producer, and a computation that
// started earlier never overwrites an entry that a computation which started later stored (notifications.ts, the ttlOnly branch of `cached`).
//   1. a cold plain summary stores; a second is warm with the same generatedAt;
//   2. after a data write, `?fresh=1` recomputes and the next plain read returns the fresh generatedAt (the entry was replaced);
//   3. a plain miss whose computation STARTED ten minutes earlier (the Worker clock pinned back, so the stored entry reads as "from the future" and misses)
//      must not replace the stored entry: the next plain read keeps step 2's generatedAt. Control: a miss that started later does replace it;
//   4. a recompute makes at most 3 Cache API calls per section (match, the write path's match, put) and the write path touches no D1 and no KV.
// The Cache API calls are counted by a behaviour-preserving source patch (the same facility as MUTANT); the count is read by a later request, after the
// waitUntil writes finished.
// MUTANT=<name> applies one defect: alwaysWrite (the put is not preceded by a newer-entry check), neverWrite (no put), atIsEnd (the entry is stamped with the end).
// Run: node scripts/test-bell-cache-write-order-native.cjs
'use strict'
process.env.READ_BUDGET_DEADLINE_MS ||= '120000'
const fs = require('node:fs')
const path = require('node:path')
const { bootWorld } = require('./read-budget/world.cjs')

const FILE = 'src/routes/notifications.ts'
const COUNT_STORE = {
  name: 'count-cache-calls', file: FILE,
  from: "const store = typeof caches === 'undefined' ? null : caches.default",
  to: "const realStore = typeof caches === 'undefined' ? null : caches.default\n      const bump = () => { (globalThis as any).__bellCacheCalls = ((globalThis as any).__bellCacheCalls || 0) + 1 }\n      const store = realStore ? { match: (r: Request) => { bump(); return realStore.match(r) }, put: (r: Request, s: Response) => { bump(); return realStore.put(r, s) } } : null",
}
const REPORT = {
  name: 'report-cache-calls', file: FILE,
  from: 'sectionLifetimeSeconds: getPlanLimits(c.env).notificationSectionCacheSeconds,',
  to: 'sectionLifetimeSeconds: getPlanLimits(c.env).notificationSectionCacheSeconds,\n    cacheCalls: (globalThis as any).__bellCacheCalls || 0,',
}
const NEWER_CHECK = 'if (Number(stored?.at) > startedAt) return'
const MUTANTS = {
  alwaysWrite: [{ name: 'm-always-write', file: FILE, from: NEWER_CHECK, to: 'void stored' }],
  neverWrite: [{ name: 'm-never-write', file: FILE, from: "await store.put(key, new Response(JSON.stringify({ at, v, value }), {", to: "await Promise.resolve(new Response(JSON.stringify({ at, v, value }), {" }],
  atIsEnd: [{ name: 'm-at-is-end', file: FILE, from: 'const at = startedAt', to: 'const at = Date.now()' }],
}
const mutant = process.env.MUTANT ? MUTANTS[process.env.MUTANT] : null
if (process.env.MUTANT && !mutant) { console.error('unknown MUTANT ' + process.env.MUTANT); process.exit(2) }

const problems = []
const check = (label, ok, detail) => { if (!ok) problems.push(label + (detail === undefined ? '' : ': ' + JSON.stringify(detail))); console.log((ok ? 'ok    ' : 'RED   ') + label) }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const source = fs.readFileSync(path.join(__dirname, '..', FILE), 'utf8').replace(/\r\n/g, '\n')
  const start = source.indexOf('c.executionCtx.waitUntil((async () => {')
  const block = source.slice(start, source.indexOf('})().catch(() => {}))', start))
  check('source: the write path is found', start > 0 && block.length > 0)
  check('source: the write path touches no D1 and no KV (only the Cache API)', !/env\.CACHE|getVersion|bumpVersion|getDb|prepare|\bkv\b/.test(block), block.length)

  const world = await bootWorld({ tier: 'free', patches: [COUNT_STORE, REPORT, ...(mutant || [])] })
  try {
    const kv = await world.mf.getKVNamespace('CACHE', 'w0')
    const bump = (namespace) => kv.put('v2:' + namespace, 'wo-' + namespace + '-' + Date.now() + '-' + Math.random())
    const read = (query = '') => world.send('GET', '/api/notifications/summary' + query, undefined, { miss: false })
    const stamp = (r) => Date.parse(r.json.generatedAt)
    const body = (r) => JSON.stringify(r.json.sections)

    const first = await read()
    check('1. the cold summary answers 200', first.status === 200, first.status)
    await sleep(50)
    const second = await read()
    check('1. the second summary is warm: the same generatedAt and sections', second.json.generatedAt === first.json.generatedAt && body(second) === body(first), [first.json.generatedAt, second.json.generatedAt])

    for (const ns of ['sales', 'stock', 'products', 'customers']) await bump(ns)
    await sleep(50)
    const freshRead = await read('?fresh=1')
    check('2. ?fresh=1 after the writes recomputes: a later generatedAt', stamp(freshRead) > stamp(first), [first.json.generatedAt, freshRead.json.generatedAt])
    const afterFresh = await read()
    check('2. the next plain read returns the fresh generatedAt (the entry was replaced)', afterFresh.json.generatedAt === freshRead.json.generatedAt, [freshRead.json.generatedAt, afterFresh.json.generatedAt])
    const g2 = stamp(afterFresh)

    world.clockMs = g2 - 10 * 60 * 1000
    const earlier = await read()
    world.clockMs = null
    check('3. the miss that started ten minutes earlier answers 200 and is stamped with its own start', earlier.status === 200 && stamp(earlier) < g2, [earlier.status, earlier.json && earlier.json.generatedAt])
    const keeps = await read()
    check('3. the next plain read keeps step 2\'s generatedAt: the older computation did not overwrite the newer entry', keeps.json.generatedAt === afterFresh.json.generatedAt && body(keeps) === body(afterFresh), [afterFresh.json.generatedAt, keeps.json.generatedAt])

    const a = await read()
    const b = await read()
    const sections = b.json.cacheCalls - a.json.cacheCalls
    check('4. a warm read makes one Cache API call per plan-lifetime section', sections > 0, sections)
    const miss = await world.send('GET', '/api/notifications/summary', undefined, { miss: true })
    await sleep(200)
    const probe = await read()
    const missCalls = probe.json.cacheCalls - b.json.cacheCalls - sections
    check('4. a recompute makes at most 3 Cache API calls per section (match, the write path\'s match, put) and at least 2', missCalls <= 3 * sections && missCalls >= 2 * sections, { sections, missCalls })
    console.log('cold recompute: ' + sections + ' sections, ' + missCalls + ' Cache API calls, D1 calls ' + miss.calls + ', rows read ' + miss.rr)

    const lifetimeMs = Number(first.json.sectionLifetimeSeconds) * 1000
    check('3. control: the lifetime is reported', lifetimeMs > 0, first.json.sectionLifetimeSeconds)
    const laterAt = Date.now() + lifetimeMs + 5000
    world.clockMs = laterAt
    const later = await read()
    world.clockMs = laterAt + 1000
    const replaced = await read()
    world.clockMs = null
    check('3. control: a miss that started later does replace it (the same read, a moment on, serves the new entry)', stamp(later) > g2 && replaced.json.generatedAt === later.json.generatedAt, [g2, later.json.generatedAt, replaced.json.generatedAt])
  } finally { await world.dispose() }
  if (problems.length) { console.error('\n' + problems.length + ' RED:\n  ' + problems.join('\n  ')); process.exit(1) }
  console.log('\nall green')
}
main().catch((e) => { console.error('crashed: ' + (e && e.stack)); process.exit(1) })
