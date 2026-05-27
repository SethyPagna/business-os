import assert from 'node:assert/strict'
import { runConcurrentTasks } from '../src/utils/bulkOps.mjs'

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

await runTest('runConcurrentTasks preserves input order while limiting concurrency', async () => {
  let active = 0
  let maxActive = 0
  const summary = await runConcurrentTasks([1, 2, 3, 4], async (item, index) => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, item === 1 ? 5 : 0))
    active -= 1
    return `${index}:${item * 2}`
  }, { concurrency: 2 })

  assert.equal(maxActive <= 2, true)
  assert.deepEqual(summary.results.map((entry) => entry.value), ['0:2', '1:4', '2:6', '3:8'])
  assert.equal(summary.successes.length, 4)
  assert.equal(summary.failures.length, 0)
})

await runTest('runConcurrentTasks captures per-item failures without stopping later work', async () => {
  const summary = await runConcurrentTasks(['a', 'bad', 'c'], async (item) => {
    if (item === 'bad') throw new Error('Nope')
    return item.toUpperCase()
  }, { concurrency: 10 })

  assert.deepEqual(summary.successes.map((entry) => entry.value), ['A', 'C'])
  assert.deepEqual(summary.failures.map((entry) => entry.item), ['bad'])
  assert.match(String(summary.failures[0].error?.message || ''), /Nope/)
})

await runTest('runConcurrentTasks treats non-array input as empty work', async () => {
  const summary = await runConcurrentTasks(null, async () => {
    throw new Error('worker should not run')
  })

  assert.deepEqual(summary.results, [])
  assert.deepEqual(summary.successes, [])
  assert.deepEqual(summary.failures, [])
})

if (failed > 0) {
  process.exitCode = 1
}
