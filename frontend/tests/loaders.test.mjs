import assert from 'node:assert/strict'
import { getFirstLoaderError, settleLoaderMap } from '../src/utils/loaders.mjs'

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

if (failed > 0) {
  process.exitCode = 1
}
