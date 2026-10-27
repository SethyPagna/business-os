import assert from 'node:assert/strict'
import fs from 'node:fs'

// Lane 6.0.1005: the Worker's inventory section lists recorded sale crossings (id crossing-<alert id>,
// anchor product-<id>), never truncated, and GET /api/notifications/summary/items no longer exists.
// The bell must therefore not offer a "Load more" that calls the removed route, and must keep the
// unread (seen-at) stamps keyed by the stable item id.
const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const bell = read('../src/components/shared/NotificationCenter.tsx')
const api = read('../src/api/notificationSummary.ts')

assert.ok(!api.includes('summary/items'), 'no client call to the removed route')
assert.ok(!/getNotificationSectionItems/.test(bell + api), 'the section-items loader is gone')
assert.ok(!/\btruncated\b|unloadedCount|fullSectionItems|unseenTailCount/.test(bell), 'the preview/tail machinery is gone: no section is ever a preview')
assert.ok(!bell.includes("tr('load_more'"), 'no Load more button')
assert.ok(bell.includes('navigateTo(item.pageId || section.pageId'), 'a row opens its page')
assert.ok(bell.includes('item.anchor)'), 'the row passes its product-<id> anchor, so Inventory scrolls to the product')
assert.match(bell, /seenAlertTimes\[[^\]]*item\.id/, 'seen stamps are keyed by the stable item id')
assert.ok(bell.includes('notification_inventory_summary') && bell.includes('notification_inventory_out_of_stock') && bell.includes('notification_inventory_low_stock'), 'the crossing copy keys render')

// Settings copy describes crossings, not a standing list, in both packs.
const en = JSON.parse(read('../src/lang/en.json'))
const km = JSON.parse(read('../src/lang/km.json'))
assert.ok(/sale/i.test(en.notification_inventory_alerts_desc) && /low/i.test(en.notification_inventory_alerts_desc), 'English describes a sale pushing a product low/out')
assert.ok(!/warnings$/i.test(en.notification_inventory_alerts_desc), 'no longer the standing-list wording')
assert.ok(km.notification_inventory_alerts_desc.includes('ការលក់') && km.notification_inventory_alerts_desc !== en.notification_inventory_alerts_desc, 'Khmer describes the sale trigger and is not English')

console.log('PASS bell inventory crossings')
