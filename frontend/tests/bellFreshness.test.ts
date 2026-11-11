import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  bellPath, bellRelevantInvalidations, noteOwnWriteForBell, peekBellFresh, requestFreshBell, restoreBellFresh, takeBellFresh,
} from '../src/api/bellFreshness.ts'
import { WRITE_FAMILY_INVALIDATES, invalidationsForWritePath } from '../src/api/writeInvalidation.ts'

// Owner, 11 Nov: the bell may be up to 5 minutes old and shows "as of HH:MM"; the actor's OWN write must never show stale.
// The Worker serves the bell's heavy sections from a cache that ignores data versions (routes/notifications.ts), so the only
// way the writer sees its own change is the next bell read asking for ?fresh=1. These pins keep that path whole.

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')

// Start clean (module state is shared by the file).
takeBellFresh('summary'); takeBellFresh('items')

// 1. Which writes count. Every family that moves stock or products reaches the 'inventory' or 'products' read prefixes in
// writeInvalidation.ts; the others (settings, users, fees, shifts...) cannot change a bell count the cache serves.
const STOCK_OR_PRODUCT_WRITERS = ['sales', 'returns', 'review', 'actionHistory', 'products', 'importJobs', 'inventory', 'batches', 'branches', 'transfers', 'inventoryChecks']
for (const family of STOCK_OR_PRODUCT_WRITERS) {
  assert.ok(bellRelevantInvalidations(WRITE_FAMILY_INVALIDATES[family]), `${family} can change a bell count: its writer must ask for a fresh read`)
}
for (const family of ['settings', 'users', 'fees', 'shifts', 'auth', 'notes', 'telegram', 'files']) {
  assert.ok(!bellRelevantInvalidations(WRITE_FAMILY_INVALIDATES[family]), `${family} changes nothing the cached bell sections read`)
}
// An unmapped family clears every cached read (null); the bell is stale then too.
assert.equal(bellRelevantInvalidations(null), true)
// A read-only preview POST writes nothing.
assert.equal(bellRelevantInvalidations(invalidationsForWritePath('/api/sales/quote')), false)
assert.equal(bellRelevantInvalidations(invalidationsForWritePath('/api/sales')), true)
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

// 4. The wiring (source shape): apiFetch's after-mutation hook notes the write; the transport carries the flag; the panel prints the as-of time and has an icon-only refresh.
const http = read('../src/api/http.ts')
assert.match(http, /function invalidateAfterMutation\(path: string\): void \{\s*const prefixes = invalidationsForWritePath\(path\)[\s\S]*?noteOwnWriteForBell\(prefixes\)\s*if \(prefixes === null\)/, 'the hook runs before the unmapped early return')
const transport = read('../src/api/notificationSummary.ts')
assert.match(transport, /takeBellFresh\('summary'\)/)
assert.match(transport, /bellPath\('\/api\/notifications\/summary', fresh\)/)
assert.match(transport, /takeBellFresh\('items'\)/)
assert.match(transport, /if \(fresh\) restoreBellFresh\('summary'\)/)
assert.match(transport, /if \(!peekBellFresh\('summary'\)\) return await notificationSummaryRequestPromise/, 'a read in flight from before the write is not joined')
const panel = read('../src/components/shared/NotificationCenter.tsx')
assert.match(panel, /stockAsOfText\(summary\.generatedAt, tr\('notification_as_of'/)
assert.match(panel, /generatedAt: typeof result\?\.generatedAt === 'string' \? result\.generatedAt : undefined/)
assert.match(panel, /requestFreshBell\(\)/)
assert.match(panel, /aria-label=\{tr\('refresh', 'Refresh'/, 'icon-only refresh keeps a translated label')

// 5. Both language packs carry the as-of sentence with its {time} slot, the Khmer one short and not English.
const en = JSON.parse(read('../src/lang/en.json'))
const km = JSON.parse(read('../src/lang/km.json'))
assert.match(en.notification_as_of, /\{time\}/)
assert.match(km.notification_as_of, /\{time\}/)
assert.match(km.notification_as_of, /[ក-៿]/)
assert.notEqual(km.notification_as_of, en.notification_as_of)

console.log('bellFreshness.test.ts: ok')
