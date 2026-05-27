import assert from 'node:assert/strict'
import { DEFAULT_MOBILE_PINNED, NAV_ITEMS, orderNavItems, parseNavSetting } from '../src/components/shared/navigationConfig.js'

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

await runTest('parseNavSetting keeps only non-empty string ids', () => {
  assert.deepEqual(parseNavSetting('["sales", "", 4, "pos", "  "]'), ['sales', 'pos'])
  assert.deepEqual(parseNavSetting('not json', DEFAULT_MOBILE_PINNED), DEFAULT_MOBILE_PINNED)
  assert.deepEqual(parseNavSetting({ invalid: true }, ['dashboard']), ['dashboard'])
})

await runTest('orderNavItems applies saved order while preserving unknown items', () => {
  const items = [
    { id: 'dashboard' },
    { id: 'sales' },
    { id: 'pos' },
    { id: 'files' },
  ]
  assert.deepEqual(orderNavItems(items, ['pos', 'sales']).map((item) => item.id), ['pos', 'sales', 'dashboard', 'files'])
})

await runTest('navigation config keeps dashboard and mobile defaults available', () => {
  assert.equal(NAV_ITEMS[0].id, 'dashboard')
  assert.deepEqual(DEFAULT_MOBILE_PINNED, ['dashboard', 'pos', 'products', 'sales'])
})

if (failed > 0) {
  process.exitCode = 1
}
