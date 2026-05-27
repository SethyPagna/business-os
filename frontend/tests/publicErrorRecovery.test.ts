import assert from 'node:assert/strict'
import {
  clearPublicDomRecoveryMarker,
  isPublicDomMutationError,
  shouldAttemptPublicDomRecovery,
} from '../src/app/publicErrorRecovery.ts'

type MinimalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function createStorage(): MinimalStorage {
  const data = new Map<string, string>()
  return {
    getItem(key: string) {
      return data.get(key) ?? null
    },
    setItem(key: string, value: string) {
      data.set(key, String(value))
    },
    removeItem(key: string) {
      data.delete(key)
    },
  }
}

const storage = createStorage()

assert.equal(isPublicDomMutationError(new Error("Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.")), true)
assert.equal(isPublicDomMutationError(new Error('Network failed')), false)
assert.equal(shouldAttemptPublicDomRecovery('catalog-public', new Error('insertBefore failed'), storage, 1000), true)
assert.equal(shouldAttemptPublicDomRecovery('catalog-public', new Error('insertBefore failed'), storage, 2000), false)
assert.equal(shouldAttemptPublicDomRecovery('dashboard', new Error('insertBefore failed'), storage, 20000), false)

clearPublicDomRecoveryMarker(storage)
assert.equal(shouldAttemptPublicDomRecovery('catalog-public', new Error('insertBefore failed'), storage, 20000), true)

console.log('publicErrorRecovery tests passed')
