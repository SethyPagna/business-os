import assert from 'node:assert/strict'
import {
  createSearchSettler,
  SALES_SEARCH_SETTLE_MS,
} from '../src/components/sales/salesSearchSettle.ts'
import {
  createSalesPageCache,
  pagesToPrefetch,
  planSalesLoad,
  salesLoadKey,
} from '../src/components/sales/salesLoadFlow.ts'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

function clock() {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { at: number; callback: () => void }>()
  return {
    timers: {
      setTimeout: (callback: () => void, ms: number) => { const id = nextId++; timers.set(id, { at: now + ms, callback }); return id },
      clearTimeout: (id: unknown) => { timers.delete(id as number) },
    },
    now: () => now,
    advance(ms: number) {
      const target = now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0]); now = due[1].at; due[1].callback()
      }
      now = target
    },
  }
}

function typing(text: string, gapMs: number, settler: ReturnType<typeof createSearchSettler>, c: ReturnType<typeof clock>) {
  for (let i = 1; i <= text.length; i += 1) { settler.input(text.slice(0, i)); c.advance(gapMs) }
}

runTest('typing "vouch" at a normal pace is one settled search, not one per pause over 180 ms', () => {
  const c = clock(); const settled: string[] = []
  const settler = createSearchSettler('', (v) => settled.push(v), SALES_SEARCH_SETTLE_MS, c.timers)
  typing('vouch', 250, settler, c)
  assert.deepEqual(settled, [], 'still typing: nothing settled')
  c.advance(SALES_SEARCH_SETTLE_MS)
  assert.deepEqual(settled, ['vouch'])
})

runTest('a pause shorter than the settle time never settles', () => {
  const c = clock(); const settled: string[] = []
  const settler = createSearchSettler('', (v) => settled.push(v), SALES_SEARCH_SETTLE_MS, c.timers)
  settler.input('v'); c.advance(SALES_SEARCH_SETTLE_MS - 1); settler.input('vo'); c.advance(SALES_SEARCH_SETTLE_MS - 1)
  assert.deepEqual(settled, [])
  c.advance(1)
  assert.deepEqual(settled, ['vo'])
})

runTest('an IME composition (Khmer, predictive keyboard) settles only after it ends', () => {
  const c = clock(); const settled: string[] = []
  const settler = createSearchSettler('', (v) => settled.push(v), SALES_SEARCH_SETTLE_MS, c.timers)
  settler.compositionStart()
  settler.input('ស'); c.advance(2_000)
  settler.input('សុ'); c.advance(2_000)
  assert.deepEqual(settled, [], 'half-formed fragments are never searched, however long the pause')
  settler.input('សុភាព')
  settler.compositionEnd()
  assert.deepEqual(settled, [], 'the pause starts at the end of the composition')
  c.advance(SALES_SEARCH_SETTLE_MS)
  assert.deepEqual(settled, ['សុភាព'])
})

runTest('a change that arrives after compositionend still settles once with the final text', () => {
  const c = clock(); const settled: string[] = []
  const settler = createSearchSettler('', (v) => settled.push(v), SALES_SEARCH_SETTLE_MS, c.timers)
  settler.compositionStart(); settler.input('សុ'); settler.compositionEnd(); settler.input('សុភាព')
  c.advance(SALES_SEARCH_SETTLE_MS * 3)
  assert.deepEqual(settled, ['សុភាព'])
})

runTest('clearing the box settles at once; unchanged text never settles twice', () => {
  const c = clock(); const settled: string[] = []
  const settler = createSearchSettler('abc', (v) => settled.push(v), SALES_SEARCH_SETTLE_MS, c.timers)
  settler.input(''); assert.deepEqual(settled, [''])
  settler.input('abc'); settler.input(''); c.advance(5_000)
  assert.deepEqual(settled, [''], 'back to the settled text, nothing to do')
})

runTest('dispose cancels a pending settle', () => {
  const c = clock(); const settled: string[] = []
  const settler = createSearchSettler('', (v) => settled.push(v), SALES_SEARCH_SETTLE_MS, c.timers)
  settler.input('abc'); settler.dispose(); c.advance(5_000)
  assert.deepEqual(settled, [])
})

runTest('a different query preempts the read in flight; the same query coalesces', () => {
  const a = salesLoadKey({ search: 'vou', page: 1, limit: 25 })
  const b = salesLoadKey({ page: 1, limit: 25, search: 'vouch' })
  assert.equal(planSalesLoad(null, a), 'start')
  assert.equal(planSalesLoad(a, a), 'coalesce')
  assert.equal(planSalesLoad(a, b), 'preempt', 'B is never queued behind A, and never dropped because A failed')
  assert.equal(salesLoadKey({ page: 1, search: 'x' }), salesLoadKey({ search: 'x', page: 1 }), 'key ignores property order')
  assert.notEqual(salesLoadKey({ page: 1, search: 'x' }), salesLoadKey({ page: 2, search: 'x' }))
})

runTest('prefetch plan: two ahead then one behind, inside the true page count', () => {
  assert.deepEqual(pagesToPrefetch(3, 25, 500, true), [4, 5, 2])
  assert.deepEqual(pagesToPrefetch(1, 25, 500, true), [2, 3], 'nothing before page 1')
  assert.deepEqual(pagesToPrefetch(19, 25, 480, true), [20, 18], 'nothing past the last page')
  assert.deepEqual(pagesToPrefetch(20, 25, 480, true), [19])
  assert.deepEqual(pagesToPrefetch(1, 25, 12, false), [], 'a single short page prefetches nothing')
  assert.deepEqual(pagesToPrefetch(2, 25, null, true), [3, 4, 1], 'total unknown: a full page implies more')
  assert.deepEqual(pagesToPrefetch(2, 25, null, false), [1], 'total unknown: a short page is the last')
})

runTest('page cache serves fresh pages, evicts the oldest, and drops expired ones', () => {
  const c = clock()
  const cache = createSalesPageCache<string>(3, 1000, c.now)
  cache.set('p1', 'one'); cache.set('p2', 'two'); cache.set('p3', 'three')
  assert.equal(cache.get('p1'), 'one')
  cache.set('p4', 'four')
  assert.equal(cache.has('p1'), false, 'oldest evicted')
  assert.equal(cache.get('p4'), 'four')
  c.advance(1001)
  assert.equal(cache.get('p4'), undefined, 'expired')
  cache.set('p5', 'five'); cache.clear()
  assert.equal(cache.has('p5'), false)
})

if (failed) process.exit(1)
console.log('PASS sales search flow')
