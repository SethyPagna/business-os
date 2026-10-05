import assert from 'node:assert/strict'
import fs from 'node:fs'
import { unseenTailCount } from '../src/utils/notificationTail.ts'

// The Worker now sends a 50-row preview of the inventory section (exact `count`, `truncated: true`)
// instead of up to 5,000 rows. The bell badge used to count every listed row, so the rows no longer
// listed must still count -- as one block that obeys the same "unresolved alerts can appear again
// after this interval" rule.
const MINUTE = 60_000
const WINDOW = 10 * MINUTE
const NOW = 1_000 * MINUTE

assert.equal(unseenTailCount(280, undefined, NOW, WINDOW), 280, 'never seen: every unlisted row counts (the old badge counted all of them)')
assert.equal(unseenTailCount(280, { at: NOW - 3 * MINUTE, count: 280 }, NOW, WINDOW), 0, 'seen 3 minutes ago, window 10: suppressed, as the per-row stamps were')
assert.equal(unseenTailCount(285, { at: NOW - 3 * MINUTE, count: 280 }, NOW, WINDOW), 5, 'rows added since it was seen are new, as a never-seen row id was')
assert.equal(unseenTailCount(270, { at: NOW - 3 * MINUTE, count: 280 }, NOW, WINDOW), 0, 'restocking can only shrink the block, never go negative')
assert.equal(unseenTailCount(280, { at: NOW - 10 * MINUTE, count: 280 }, NOW, WINDOW), 280, 'exactly one window later the block counts again (>=, like the per-row rule)')
assert.equal(unseenTailCount(280, { at: NOW - 30 * MINUTE, count: 280 }, NOW, WINDOW), 280, 'long unseen: counts in full')
assert.equal(unseenTailCount(0, undefined, NOW, WINDOW), 0)
assert.equal(unseenTailCount(Number.NaN, undefined, NOW, WINDOW), 0, 'garbage size counts nothing')
assert.equal(unseenTailCount(10, { at: Number.NaN, count: 10 }, NOW, WINDOW), 10, 'a corrupt stored stamp is treated as never seen')

// The panel wires it: preview sections are loaded on demand, the whole list is requested for
// search/filter, and the badge adds the unlisted block on top of the per-row count.
const source = fs.readFileSync(new URL('../src/components/shared/NotificationCenter.tsx', import.meta.url), 'utf8')
assert.match(source, /import \{ unseenTailCount, type SeenTail \} from '\.\.\/\.\.\/utils\/notificationTail\.ts'/)
assert.match(source, /const badgeCount = open \? 0 : badgeVisibleCount \+ tailBadgeCount/)
assert.match(source, /unseenTailCount\(tail\.size, seenTails\[tail\.id\], now, realertMs\)/)
assert.match(source, /getNotificationSectionItemsRequest\(sectionId\)/)
assert.match(source, /section\.truncated && !fullSectionItems\[section\.id\] && section\.unloadedCount > 0/)
assert.match(source, /!normalizedNotificationSearch && toneFilter === 'all'\)\) return/, 'search or a tone filter loads the rest of a preview section')
const api = fs.readFileSync(new URL('../src/api/notificationSummary.ts', import.meta.url), 'utf8')
assert.match(api, /\/api\/notifications\/summary\/items\?section=\$\{encodeURIComponent\(sectionId\)\}/)

console.log('PASS notification preview tail keeps the badge, search and load-more behaviour')
