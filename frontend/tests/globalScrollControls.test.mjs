import assert from 'node:assert/strict'
import { getScrollTarget, getScrollToPosition } from '../src/components/shared/globalScroll.js'

let failed = 0

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('getScrollTarget prefers active page-scroll container', () => {
  const active = { classList: { contains: (name) => name === 'page-scroll' }, scrollHeight: 2000, clientHeight: 400 }
  const fallbackWindow = { document: { querySelector: () => active } }
  assert.equal(getScrollTarget(fallbackWindow), active)
})

await runTest('getScrollToPosition computes bottom offset for elements and windows', () => {
  assert.equal(getScrollToPosition({ scrollHeight: 1000, clientHeight: 300 }, 'bottom'), 700)
  assert.equal(getScrollToPosition({ document: { documentElement: { scrollHeight: 1200, clientHeight: 500 } } }, 'bottom'), 700)
  assert.equal(getScrollToPosition({ scrollHeight: 1000, clientHeight: 300 }, 'top'), 0)
})

if (failed > 0) {
  process.exitCode = 1
}
