import assert from 'node:assert/strict'
import { runConcurrentTasks } from '../src/utils/bulkOps.ts'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('runConcurrentTasks preserves input order while limiting concurrency', async () => {
  let active = 0
  let maxActive = 0
  const summary = await runConcurrentTasks<number, string>([1, 2, 3, 4], async (item: number, index: number) => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise<void>((resolve) => setTimeout(resolve, item === 1 ? 5 : 0))
    active -= 1
    return `${index}:${item * 2}`
  }, { concurrency: 2 })

  assert.equal(maxActive <= 2, true)
  assert.deepEqual(summary.successes.map((entry) => entry.value), ['0:2', '1:4', '2:6', '3:8'])
  assert.equal(summary.successes.length, 4)
  assert.equal(summary.failures.length, 0)
})

await runTest('runConcurrentTasks captures per-item failures without stopping later work', async () => {
  const summary = await runConcurrentTasks<string, string>(['a', 'bad', 'c'], async (item: string) => {
    if (item === 'bad') throw new Error('Nope')
    return item.toUpperCase()
  }, { concurrency: 10 })

  assert.deepEqual(summary.successes.map((entry) => entry.value), ['A', 'C'])
  assert.deepEqual(summary.failures.map((entry) => entry.item), ['bad'])
  const firstFailure = summary.failures[0]
  const message = firstFailure?.error instanceof Error ? firstFailure.error.message : ''
  assert.match(message, /Nope/)
})

await runTest('runConcurrentTasks treats non-array input as empty work', async () => {
  const summary = await runConcurrentTasks(null as unknown as unknown[], async () => {
    throw new Error('worker should not run')
  })

  assert.deepEqual(summary.results, [])
  assert.deepEqual(summary.successes, [])
  assert.deepEqual(summary.failures, [])
})

if (failed > 0) {
  process.exitCode = 1
}
