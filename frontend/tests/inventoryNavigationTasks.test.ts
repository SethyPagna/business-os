import assert from 'node:assert/strict'
import * as hubs from '../src/components/shared/hubNavigation.ts'

// The renamed section: an old #hub:inventory:issues link means Tasks (chrome and page agree), and Tasks is offered exactly to someone who may work or issue tasks.
const allowed = ['products', 'sessions', 'tasks']
assert.equal(hubs.resolveChromeSection('inventory', '/inventory', '#hub:inventory:issues', allowed), 'tasks', 'the chrome maps the old anchor')
assert.equal(hubs.resolveHubSection('inventory', '/inventory', '#hub:inventory:issues', allowed, 'products'), 'tasks', 'and so does the page')
assert.equal(hubs.resolveHubSection('inventory', '/inventory', '#hub:inventory:tasks', allowed, 'products'), 'tasks')
assert.equal(hubs.resolveHubSection('inventory', '/inventory', '#hub:inventory:issues', ['products', 'sessions'], 'products'), 'products', 'a viewer without Tasks lands on Inventory')
assert.equal(hubs.resolveChromeSection('branches', '/branches', '#hub:branches:issues', ['overview', 'issues']), 'issues', 'the map is Inventory\'s only: another page keeps its own ids')
const ids = (actions: string[], grants: string[] = []) => hubs.getHubDestinations('inventory', { getPermissionTier: () => 'full', hasPermission: key => grants.includes(key), can: (key, action) => action === 'view' || actions.includes(`${key}:${action}`) }).map(item => item.id)
assert.deepEqual(ids(['inventory_checks:check', 'inventory_checks:tasks']), ['products', 'sessions', 'tasks'], 'work')
assert.deepEqual(ids(['inventory_checks:check'], ['inventory_check_issue']), ['products', 'sessions', 'tasks'], 'issue')
assert.deepEqual(ids(['inventory_checks:check']), ['products', 'sessions'], 'neither')
assert.deepEqual(ids(['inventory_checks:tasks']), ['products', 'sessions'], 'the Tasks action without the count grant')
console.log('inventoryNavigationTasks passed: the old Issues anchor opens Tasks, offered exactly for work or issue')
