'use strict'

const assert = require('node:assert/strict')
const {
  DEFAULT_ROLE_PERMISSIONS,
  isSensitiveActionHistory,
  permissionForActionHistory,
} = require('../src/permissions')

assert.deepEqual(DEFAULT_ROLE_PERMISSIONS.admin, { all: true })
assert.equal(DEFAULT_ROLE_PERMISSIONS.manager.products, true)
assert.equal(DEFAULT_ROLE_PERMISSIONS.manager.inventory, true)
assert.equal(DEFAULT_ROLE_PERMISSIONS.manager.contacts, true)
assert.equal(DEFAULT_ROLE_PERMISSIONS.manager.backup, undefined)
assert.equal(DEFAULT_ROLE_PERMISSIONS.manager.backup_restore, undefined)
assert.equal(DEFAULT_ROLE_PERMISSIONS.manager.drive_credentials, undefined)

assert.equal(DEFAULT_ROLE_PERMISSIONS.employee.pos, true)
assert.equal(DEFAULT_ROLE_PERMISSIONS.employee.products, true)
assert.equal(DEFAULT_ROLE_PERMISSIONS.employee.backup, undefined)
assert.equal(DEFAULT_ROLE_PERMISSIONS.employee.settings, undefined)

assert.equal(permissionForActionHistory({ entity: 'product', scope: 'products' }), 'products')
assert.equal(permissionForActionHistory({ entity: 'inventory', scope: 'inventory' }), 'inventory')
assert.equal(permissionForActionHistory({ entity: 'backup', scope: 'backup' }), 'backup')
assert.equal(permissionForActionHistory({ entity: 'role', scope: 'users' }), 'users')

assert.equal(isSensitiveActionHistory({ entity: 'backup' }), true)
assert.equal(isSensitiveActionHistory({ entity: 'role' }), true)
assert.equal(isSensitiveActionHistory({ entity: 'product' }), false)
assert.equal(isSensitiveActionHistory({ entity: 'settings', payload: { permission: 'drive_credentials' } }), true)

console.log('PASS permission policy separates role defaults, history ownership, and sensitive actions')
