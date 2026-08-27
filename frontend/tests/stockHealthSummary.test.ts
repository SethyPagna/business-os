// Guards the ONE stock-health -> colour mapping (11.20 / 5.5). If any surface
// hard-codes its own green/amber/red for stock status instead of importing
// this, the two can drift; these tests pin the single source.
import assert from 'node:assert/strict'
import { buildStockHealthSegments, stockHealthColour } from '../src/components/inventory/stockHealthSummary.ts'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) }
  catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

runTest('segments are healthy/low/out in order, each with its own colour and label', () => {
  const segs = buildStockHealthSegments(
    { healthy: 42, low: 5, out: 2 },
    { healthy: 'Healthy', low: 'Low', out: 'Out' },
  )
  assert.deepEqual(segs.map((s) => s.key), ['healthy', 'low', 'out'])
  assert.deepEqual(segs.map((s) => s.count), [42, 5, 2])
  assert.deepEqual(segs.map((s) => s.label), ['Healthy', 'Low', 'Out'])
  assert.match(segs[0].colorClass, /emerald/, 'healthy is green')
  assert.match(segs[1].colorClass, /amber/, 'low is amber')
  assert.match(segs[2].colorClass, /red/, 'out is red')
})

runTest('colour classes carry both light and dark variants', () => {
  for (const key of ['healthy', 'low', 'out'] as const) {
    assert.match(stockHealthColour(key), /dark:/, `${key} must define a dark variant`)
  }
})

runTest('the render site colour matches the helper (single source)', () => {
  const segs = buildStockHealthSegments({ healthy: 1, low: 1, out: 1 }, { healthy: 'H', low: 'L', out: 'O' })
  for (const seg of segs) {
    assert.equal(seg.colorClass, stockHealthColour(seg.key), 'segment colour must come from stockHealthColour')
  }
})

runTest('bad/missing counts coerce to 0, never NaN or negatives', () => {
  const segs = buildStockHealthSegments(
    { healthy: NaN, low: undefined, out: -3 },
    { healthy: 'H', low: 'L', out: 'O' },
  )
  assert.deepEqual(segs.map((s) => s.count), [0, 0, 0])
})

runTest('decimals are truncated to whole product counts', () => {
  const segs = buildStockHealthSegments({ healthy: 4.9, low: 2.1, out: 0 }, { healthy: 'H', low: 'L', out: 'O' })
  assert.deepEqual(segs.map((s) => s.count), [4, 2, 0])
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('\nAll stockHealthSummary tests passed')
}
