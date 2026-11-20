import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  bellPath, bellWriteFor, noteOwnWriteForBell, onBellResolved, peekBellFresh, requestFreshBell, restoreBellFresh, takeBellFresh,
} from '../src/api/bellFreshness.ts'
import { olderAsOf } from '../src/components/dashboard/stockAsOf.ts'
import { WRITE_FAMILY_INVALIDATES, invalidationsForWritePath } from '../src/api/writeInvalidation.ts'

// Owner, 11 Nov: the bell may be up to 5 minutes old and shows "as of HH:MM"; the actor's OWN write must never show stale.
// A write maps to nothing, to everything (?fresh=1) or to the sections it resolves (?fresh=a,b); a named set also wakes the panel.

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const writeOf = (path: string) => bellWriteFor(invalidationsForWritePath(path), path)
const note = (path: string) => noteOwnWriteForBell(invalidationsForWritePath(path), path)
const drain = () => { takeBellFresh('summary'); takeBellFresh('items') }
drain()

// 1. Which writes count. Every family that moves stock or products arms everything; the others cannot change a bell count the cache serves.
const STOCK_OR_PRODUCT_WRITERS = ['returns', 'review', 'actionHistory', 'products', 'inventory', 'batches', 'branches', 'transfers', 'inventoryChecks']
for (const family of STOCK_OR_PRODUCT_WRITERS) {
  assert.equal(bellWriteFor(WRITE_FAMILY_INVALIDATES[family]), 'all', `${family} can change a bell count: everything`)
}
for (const family of ['settings', 'users', 'fees', 'shifts', 'auth', 'notes', 'telegram', 'files']) {
  assert.equal(bellWriteFor(WRITE_FAMILY_INVALIDATES[family]), null, `${family} changes nothing the cached bell sections read`)
}
assert.equal(bellWriteFor(null), 'all', 'an unmapped family clears every cached read')
assert.equal(writeOf('/api/never-mapped-family'), 'all')
for (const p of ['/api/returns', '/api/salesperson', '/api/products/3', '/api/inventory/adjust', '/api/sales-daily/rebuild']) assert.equal(writeOf(p), 'all', p)

// 1a. Owner, 11 Nov ("Wait"): the till's own NEW sale arms nothing (POST /api/sales exactly).
for (const p of ['/api/sales', '/api/sales?x=1', '/api/sales/']) assert.equal(writeOf(p), null, p)
// 1b. Every other write under /api/sales (status, payments, lines, customer, bulk edits, delete) resolves the sales section only; a read-only preview writes nothing.
for (const p of ['/api/sales/42/items', '/api/sales/42/amendments', '/api/sales/42/status', '/api/sales/42/customer', '/api/sales/bulk-update', '/api/sales/bulk-status', '/api/sales/42', '/api/sales/42/payments?x=1']) {
  assert.deepEqual(writeOf(p), ['sales'], p)
}
assert.equal(writeOf('/api/sales/quote'), null, 'a quote writes nothing')
// 1c. A portal submission review resolves the portal section only.
for (const p of ['/api/portal/submissions/7/review', '/api/portal/submissions/7/review?x=1']) assert.deepEqual(writeOf(p), ['portal'], p)
for (const p of ['/api/portal/submissions', '/api/portal/submissions/7/screenshot/0', '/api/portal/settings']) assert.equal(writeOf(p), null, p)
// 1d. An import job cancel, delete or retry resolves the imports section only; the rest of the import family still moves products.
for (const p of ['/api/import-jobs/5/cancel', '/api/import-jobs/5/delete', '/api/import-jobs/5/retry', '/api/import-jobs/5']) assert.deepEqual(writeOf(p), ['imports'], p)
for (const p of ['/api/import-jobs', '/api/import-jobs/5/approve', '/api/import-jobs/5/start', '/api/import-jobs/5/csv']) assert.equal(writeOf(p), 'all', p)

// 2. Accumulation and the exact query string sent: everything wins, otherwise the union (sorted); one read consumes it.
const sent = (): string => bellPath('/api/notifications/summary', takeBellFresh('summary'))
note('/api/sales')
note('/api/settings')
assert.equal(sent(), '/api/notifications/summary', 'a new sale and a settings write leave a plain read')
note('/api/sales/7/status')
assert.equal(peekBellFresh('summary'), 'sales', 'peek does not consume')
assert.equal(sent(), '/api/notifications/summary?fresh=sales')
assert.equal(sent(), '/api/notifications/summary', 'one fresh read per write')
note('/api/portal/submissions/7/review')
note('/api/sales/7/status')
note('/api/sales/8/status')
assert.equal(sent(), '/api/notifications/summary?fresh=portal,sales', 'the union, each name once')
note('/api/sales/7/status')
note('/api/inventory/adjust')
note('/api/portal/submissions/7/review')
assert.equal(sent(), '/api/notifications/summary?fresh=1', 'everything wins over any named set, in either order')
drain()
note('/api/sales/7/status')
assert.equal(takeBellFresh('items'), 'sales', 'the expanded list has its own pending state')
assert.equal(takeBellFresh('items'), '')
assert.equal(bellPath('/api/notifications/summary/items?section=inventory', 'sales'), '/api/notifications/summary/items?section=inventory&fresh=sales')
assert.equal(bellPath('/api/notifications/summary/items?section=inventory', '1'), '/api/notifications/summary/items?section=inventory&fresh=1')
drain()
// A failed fresh read puts exactly what it carried back.
note('/api/sales/7/status')
restoreBellFresh('summary', takeBellFresh('summary'))
assert.equal(sent(), '/api/notifications/summary?fresh=sales', 'a failed fresh read is retried with the same sections')
restoreBellFresh('summary', '1')
assert.equal(takeBellFresh('summary'), '1')
requestFreshBell()
assert.equal(takeBellFresh('summary'), '1', 'the panel refresh button: everything')
assert.equal(takeBellFresh('items'), '1')

// 3. The panel is woken only by a write that names sections.
const heard: string[][] = []
const stop = onBellResolved((sections) => heard.push(sections))
note('/api/portal/submissions/7/review')
assert.deepEqual(heard, [['portal']], 'a review notifies with portal')
note('/api/sales/7/status')
assert.deepEqual(heard.at(-1), ['sales'], 'a sale status write notifies with sales')
note('/api/import-jobs/5/cancel')
assert.deepEqual(heard.at(-1), ['imports'])
const before = heard.length
note('/api/products/9')
note('/api/sales')
note('/api/settings')
assert.equal(heard.length, before, "a product edit, the till's own sale and a settings write notify nobody")
stop()
note('/api/sales/7/status')
assert.equal(heard.length, before, 'unsubscribe stops notices')
drain()

// 4. The delivery of ?fresh=1 is proven behaviourally in bellFreshDelivery.test.ts (real http.ts, stub fetch). Here: the panel prints the as-of time and has an icon-only refresh.
const panel = read('../src/components/shared/NotificationCenter.tsx')
assert.match(panel, /stockAsOfText\(olderAsOf\(\[summary\.generatedAt[\s\S]{0,300}tr\('notification_as_of'/)
assert.match(panel, /generatedAt: typeof result\?\.generatedAt === 'string' \? result\.generatedAt : undefined/)
assert.match(panel, /requestFreshBell\(\)/)
// 4a. The panel subscribes in an effect with cleanup, coalesces the notices of one tick into one read, and the throttled sync list carries portalSubmissions (not the immediate one).
assert.match(panel, /const stop = onBellResolved\(\(\) => \{\s*if \(timer !== null\) return\s*timer = window\.setTimeout\(\(\) => \{ timer = null; void loadSummary\(true\) \}, 0\)[^]{0,200}stop\(\)/, 'the panel re-reads once per tick on an own resolving write')
assert.match(panel, /\['inventory'[^\]]*'portalSubmissions'\]\.includes\(syncChannel\.channel\)/, "other admins' devices pick a review up (throttled)")
assert.match(panel, /NOTIFICATION_IMMEDIATE_SYNC_CHANNELS: ReadonlySet<string> = new Set\(\['notifications'\]\)/, 'portalSubmissions is not an immediate channel')
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
