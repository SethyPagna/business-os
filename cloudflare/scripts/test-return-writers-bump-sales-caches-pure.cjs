// Every writer of a return must bump what the Sales list and stats are keyed on, so another device (and the manager who
// just returned) does not read a cached list for the cache's lifetime. The Sales read key folds sales, returns,
// customers, products and stock (sales.ts getSalesReadCacheVersion); a return moves refunds (returns, sales) and restocks
// (stock, products), never customers. Writers: create, exchange, supplier return, edit, grouped action (and its undo/redo).
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..', 'src')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const shared = read('lib/returnCacheVersions.ts')
const namespaces = [...shared.matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
const salesKey = /const namespaces = \[([^\]]+)\] as const/.exec(read('routes/sales.ts').slice(read('routes/sales.ts').indexOf('async function getSalesReadCacheVersion')))
assert(salesKey, 'the Sales read key namespaces are still declared in one list')
const keyed = [...salesKey[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
for (const namespace of keyed.filter((name) => name !== 'customers')) {
  assert(namespaces.includes(namespace), `a return writer must bump '${namespace}' (the Sales list is keyed on it)`)
}
for (const namespace of ['returns', 'sales', 'stock', 'products']) assert(namespaces.includes(namespace), namespace)

const routes = read('routes/returns.ts')
assert.equal((routes.match(/bumpVersions\(c\.env, RETURN_WRITE_CACHE_NAMESPACES\)/g) || []).length, 7, 'create, supplier return and edit bump the shared list, and so do the four idempotent replays (two creates, two edits; W3 round 2 F8)')
assert(!/bumpVersions\(c\.env, \['products', 'returns', 'sales'\]\)/.test(routes), 'no return writer keeps its own shorter list')
assert(/bumpVersions\(c\.env, RETURN_WRITE_CACHE_NAMESPACES\)/.test(read('lib/returnExchangeCreate.ts')), 'the exchange writer bumps the shared list')

const bulk = read('lib/returnBulkAction.ts')
const notify = bulk.slice(bulk.indexOf('export async function bumpReturnBulkAction'))
assert(/bumpVersions\(env, RETURN_WRITE_CACHE_NAMESPACES\)/.test(notify.slice(0, notify.indexOf('\n}\n'))), 'a grouped return action bumps the shared list')
assert(/export async function notifyReturnBulkAction[^}]*bumpReturnBulkAction\(env\)[^}]*announceReturnBulkAction\(env\)/.test(bulk), 'the replay notifier is the bump followed by the announce')
const history = read('routes/actionHistory.ts')
const listed = (history.match(/case RETURN_BULK_ACTION_KIND: return \[([^\]]*)\]/) || [])[1] || ''
assert.deepEqual([...listed.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort(), [...new Set(namespaces)].sort(), "undo and redo of a grouped return action bump the shared list, in the history route's one bump call")
assert(/RETURN_BULK_ACTION_KIND\s*\?\s*announceReturnBulkAction\(c\.env\)/.test(history), 'undo and redo of a grouped return action announce with the same helper')
console.log('return writers bump the sales caches: ok')
