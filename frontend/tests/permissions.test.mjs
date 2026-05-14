import assert from 'node:assert/strict'
import { parsePermissionMap } from '../src/utils/permissions.js'

assert.deepEqual(parsePermissionMap('{"products":true,"inventory":false}'), {
  products: true,
  inventory: false,
})

const objectPermissions = { products: true, sales: true }
assert.equal(parsePermissionMap(objectPermissions), objectPermissions)

assert.deepEqual(parsePermissionMap('not-json'), {})
assert.deepEqual(parsePermissionMap(null), {})
assert.deepEqual(parsePermissionMap(['products']), {})

console.log('PASS permission parsing accepts string and object payloads')
