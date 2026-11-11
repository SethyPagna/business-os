import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  bellPath, bellRelevantInvalidations, isSaleWritePath, noteOwnWriteForBell, peekBellFresh, requestFreshBell, restoreBellFresh, takeBellFresh,
} from '../src/api/bellFreshness.ts'
import { olderAsOf } from '../src/components/dashboard/stockAsOf.ts'
import { WRITE_FAMILY_INVALIDATES, invalidationsForWritePath } from '../src/api/writeInvalidation.ts'

// Owner, 11 Nov: the bell may be up to 5 minutes old and shows "as of HH:MM"; the actor's OWN write must never show stale.
// The Worker serves the bell's heavy sections from a cache that ignores data versions (routes/notifications.ts), so the only
// way the writer sees its own change is the next bell read asking for ?fresh=1. These pins keep that path whole.

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')

// Start clean (module state is shared by the file).
takeBellFresh('summary'); takeBellFresh('items')

// 1. Which writes count. Every family that moves stock or products reaches the 'inventory' or 'products' read prefixes in
// writeInvalidation.ts; the others (settings, users, fees, shifts...) cannot change a bell count the cache serves.
const STOCK_OR_PRODUCT_WRITERS = ['returns', 'review', 'actionHistory', 'products', 'importJobs', 'inventory', 'batches', 'branches', 'transfers', 'inventoryChecks']
for (const family of STOCK_OR_PRODUCT_WRITERS) {
  assert.ok(bellRelevantInvalidations(WRITE_FAMILY_INVALIDATES[family]), `${family} can change a bell count: its writer must ask for a fresh read`)
}
for (const family of ['settings', 'users', 'fees', 'shifts', 'auth', 'notes', 'telegram', 'files']) {
  assert.ok(!bellRelevantInvalidations(WRITE_FAMILY_INVALIDATES[family]), `${family} changes nothing the cached bell sections read`)
}
// Owner, 11 Nov ("Wait"): a till's own SALE no longer arms a fresh read, whatever it invalidates. Every /api/sales write is a sale;
// returns, products and stock writes are not.
for (const p of ['/api/sales', '/api/sales/42/items', '/api/sales/42/amendments', '/api/sales/42/status', '/api/sales/bulk-update', '/api/sales?x=1']) {
  assert.equal(isSaleWritePath(p), true, p)
  assert.equal(bellRelevantInvalidations(invalidationsForWritePath(p), p), false, `${p} is a sale: the bell may lag`)
}
for (const p of ['/api/returns', '/api/salesperson', '/api/products/3', '/api/inventory/adjust']) {
  assert.equal(isSaleWritePath(p), false, p)
  assert.equal(bellRelevantInvalidations(invalidationsForWritePath(p), p), true, `${p} still arms a fresh read`)
}
noteOwnWriteForBell(invalidationsForWritePath('/api/sales'), '/api/sales')
assert.equal(peekBellFresh('summary'), false, 'a sale leaves the flag down')
// An unmapped family clears every cached read (null); the bell is stale then too.
assert.equal(bellRelevantInvalidations(null), true)
// A read-only preview POST writes nothing.
assert.equal(bellRelevantInvalidations(invalidationsForWritePath('/api/sales/quote')), false)
assert.equal(bellRelevantInvalidations(invalidationsForWritePath('/api/sales')), true, 'by prefixes alone sales still reach stock; only the path rule exempts them')
assert.equal(bellRelevantInvalidations(invalidationsForWritePath('/api/never-mapped-family')), true)

// 2. The flag: set by an own write, consumed exactly once per read kind, restored when the read failed.
assert.equal(peekBellFresh('summary'), false)
noteOwnWriteForBell(invalidationsForWritePath('/api/settings'))
assert.equal(peekBellFresh('summary'), false, 'a settings write leaves the bell cached')
noteOwnWriteForBell(invalidationsForWritePath('/api/inventory/adjust'))
assert.equal(peekBellFresh('summary'), true)
assert.equal(peekBellFresh('summary'), true, 'peek does not consume')
assert.equal(takeBellFresh('summary'), true)
assert.equal(takeBellFresh('summary'), false, 'one fresh read per write')
assert.equal(takeBellFresh('items'), true, 'the expanded list has its own flag')
assert.equal(takeBellFresh('items'), false)
restoreBellFresh('summary')
assert.equal(takeBellFresh('summary'), true, 'a failed fresh read is retried fresh')
requestFreshBell()
assert.equal(takeBellFresh('summary'), true, 'the panel refresh button')
assert.equal(takeBellFresh('items'), true)

// 3. The path.
assert.equal(bellPath('/api/notifications/summary', false), '/api/notifications/summary')
assert.equal(bellPath('/api/notifications/summary', true), '/api/notifications/summary?fresh=1')
assert.equal(bellPath('/api/notifications/summary/items?section=inventory', true), '/api/notifications/summary/items?section=inventory&fresh=1')

// 4. The delivery of ?fresh=1 is proven behaviourally in bellFreshDelivery.test.ts (real http.ts, stub fetch). Here: the panel prints the as-of time and has an icon-only refresh.
const panel = read('../src/components/shared/NotificationCenter.tsx')
assert.match(panel, /stockAsOfText\(olderAsOf\(\[summary\.generatedAt[\s\S]{0,300}tr\('notification_as_of'/)
assert.match(panel, /generatedAt: typeof result\?\.generatedAt === 'string' \? result\.generatedAt : undefined/)
assert.match(panel, /requestFreshBell\(\)/)
assert.match(panel, /aria-label=\{tr\('refresh', 'Refresh'/, 'icon-only refresh keeps a translated label')

assert.match(panel, /olderAsOf\(\[summary\.generatedAt/, 'the header shows the older of the summary and any expanded list')
assert.match(panel, /data-notification-as-of[\s\S]{0,400}inline-flex h-6 w-6/, 'refresh tap target is at least 24 px')

// 4b. B4: header time = older of the summary and the expanded list (never claims fresher than the oldest number shown).
assert.equal(olderAsOf(['2026-11-11T07:04:00.000Z', '2026-11-11T07:00:00.000Z']), '2026-11-11T07:00:00.000Z')
assert.equal(olderAsOf(['2026-11-11T07:00:00.000Z', '2026-11-11T07:04:00.000Z']), '2026-11-11T07:00:00.000Z')
assert.equal(olderAsOf([undefined, 'garbage', '2026-11-11T07:04:00.000Z']), '2026-11-11T07:04:00.000Z')
assert.equal(olderAsOf([undefined, 'garbage']), null)
assert.equal(olderAsOf([]), null)

// 5. Both language packs carry the as-of sentence with its {time} slot, the Khmer one short and not English.
const en = JSON.parse(read('../src/lang/en.json'))
const km = JSON.parse(read('../src/lang/km.json'))
assert.match(en.notification_as_of, /\{time\}/)
assert.match(km.notification_as_of, /\{time\}/)
assert.match(km.notification_as_of, /[ក-៿]/)
assert.notEqual(km.notification_as_of, en.notification_as_of)

console.log('bellFreshness.test.ts: ok')
