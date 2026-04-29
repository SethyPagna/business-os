import assert from 'node:assert/strict'
import {
  beginTrackedRequest,
  createLoaderTimeoutError,
  getFirstLoaderError,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  settleLoaderMap,
  withLoaderTimeout,
} from '../src/utils/loaders.mjs'

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

await runTest('settleLoaderMap keeps successful values when one loader fails', async () => {
  const result = await settleLoaderMap({
    users: async () => ['a'],
    roles: async () => { throw new Error('roles failed') },
  })

  assert.equal(result.hasAnySuccess, true)
  assert.equal(result.hasErrors, true)
  assert.deepEqual(result.values.users, ['a'])
  assert.equal(result.errors.roles.message, 'roles failed')
})

await runTest('getFirstLoaderError returns the first useful message', () => {
  const message = getFirstLoaderError({
    first: new Error('first failed'),
    second: new Error('second failed'),
  })

  assert.equal(message, 'first failed')
})

await runTest('tracked requests only treat the latest request as current', () => {
  const ref = { current: 0 }
  const first = beginTrackedRequest(ref)
  const second = beginTrackedRequest(ref)

  assert.equal(isTrackedRequestCurrent(ref, first), false)
  assert.equal(isTrackedRequestCurrent(ref, second), true)

  invalidateTrackedRequest(ref)
  assert.equal(isTrackedRequestCurrent(ref, second), false)
})

await runTest('createLoaderTimeoutError returns a stable typed timeout error', () => {
  const error = createLoaderTimeoutError('Inventory load', 5000)
  assert.equal(error.name, 'LoaderTimeoutError')
  assert.equal(error.code, 'loader_timeout')
  assert.match(error.message, /Inventory load took longer than 5s/i)
})

await runTest('withLoaderTimeout resolves successful loaders before the timeout', async () => {
  globalThis.window = globalThis
  const result = await withLoaderTimeout(() => Promise.resolve(['ok']), 'Fast load', 50)
  assert.deepEqual(result, ['ok'])
})

await runTest('withLoaderTimeout rejects slow loaders with a timeout error', async () => {
  globalThis.window = globalThis
  await assert.rejects(
    () => withLoaderTimeout(() => new Promise((resolve) => setTimeout(resolve, 25)), 'Slow load', 5),
    (error) => error?.code === 'loader_timeout',
  )
})

if (failed > 0) {
  process.exitCode = 1
}
