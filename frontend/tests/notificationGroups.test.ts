import assert from 'node:assert/strict'
import { groupNotificationItems, NOTIFICATION_GROUP_MIN, GROUPABLE_NOTIFICATION_KINDS } from '../src/utils/notificationGroups.ts'

// NOTIF-V2: repeats of one kind fold into one collapsible row, so a busy afternoon reads
// "3 products went low" instead of a wall of near-identical lines.
const item = (id: string, kind: string) => ({ id, kind })
const low = (n: number) => Array.from({ length: n }, (_, i) => item(`low-${i}`, 'inventory_low_stock'))

assert.equal(NOTIFICATION_GROUP_MIN, 4)

// Under the threshold nothing folds (three lines still read fine).
assert.deepEqual(groupNotificationItems(low(3)).map((row) => row.type), ['item', 'item', 'item'])

// At the threshold the kind folds into ONE group holding every member in order.
const folded = groupNotificationItems(low(4))
assert.equal(folded.length, 1)
assert.equal(folded[0].type, 'group')
if (folded[0].type === 'group') {
  assert.equal(folded[0].kind, 'inventory_low_stock')
  assert.deepEqual(folded[0].items.map((entry) => entry.id), ['low-0', 'low-1', 'low-2', 'low-3'])
}

// The group sits where its first member sat; other kinds keep their place around it; order is stable.
const mixed = groupNotificationItems([
  item('out-1', 'inventory_out_of_stock'),
  ...low(5),
  item('pay-1', 'sales_awaiting_payment'),
])
assert.deepEqual(mixed.map((row) => (row.type === 'item' ? row.item.id : `group:${row.kind}`)), ['out-1', 'group:inventory_low_stock', 'pay-1'])

// Each kind is counted on its own: five lows fold, three outs do not.
const perKind = groupNotificationItems([...low(5), ...Array.from({ length: 3 }, (_, i) => item(`out-${i}`, 'inventory_out_of_stock'))])
assert.deepEqual(perKind.map((row) => row.type), ['group', 'item', 'item', 'item'])

// Interleaved members still fold into the one group at the first member's position.
const interleaved = groupNotificationItems([
  item('a1', 'product_expired'), item('x', 'sales_awaiting_payment'), item('a2', 'product_expired'),
  item('y', 'sales_awaiting_delivery'), item('a3', 'product_expired'), item('a4', 'product_expired'),
])
assert.deepEqual(interleaved.map((row) => (row.type === 'item' ? row.item.id : `group:${row.kind}`)), ['group:product_expired', 'x', 'y'])

// A decision for a person never folds, however many there are.
for (const kind of ['security_device_pending', 'security_device_new_country', 'system_drive_sync_connect', 'import_job']) {
  const rows = groupNotificationItems(Array.from({ length: 6 }, (_, i) => item(`${kind}-${i}`, kind)))
  assert.equal(rows.every((row) => row.type === 'item'), true, `${kind} stays individually visible`)
  assert.equal(GROUPABLE_NOTIFICATION_KINDS.has(kind), false)
}

// An unknown or missing kind is never folded either.
assert.equal(groupNotificationItems(Array.from({ length: 6 }, (_, i) => ({ id: String(i) }))).every((row) => row.type === 'item'), true)

// Searching or filtering turns folding off by passing an unreachable minimum.
assert.equal(groupNotificationItems(low(9), Number.POSITIVE_INFINITY).every((row) => row.type === 'item'), true)

console.log('PASS notification groups fold repeats of one kind and nothing else')
