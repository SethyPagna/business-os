// Repeats of one kind fold into a single collapsible row (NOTIF-V2, owner 6 Oct 2026: "optimize so it
// doesn't feel content heavy ... group repeats"). A busy afternoon should read "3 products went low",
// not three near-identical lines; opening the group shows the same compact rows.
//
// Pure and order-preserving: the group sits where its first member sat, members keep their order.
// Kinds that are a decision for a person (a new device, a failed import report, the backup warning)
// are never folded -- they stay individually visible however many there are.

export type GroupableNotificationItem = { id: string; kind?: string }

export type NotificationRow<T extends GroupableNotificationItem> =
  | { type: 'item'; item: T }
  | { type: 'group'; key: string; kind: string; items: T[] }

/** How many rows of one kind it takes before they fold. Three still read fine; four is a wall. */
export const NOTIFICATION_GROUP_MIN = 4

export const GROUPABLE_NOTIFICATION_KINDS: ReadonlySet<string> = new Set([
  'inventory_out_of_stock',
  'inventory_low_stock',
  'sales_awaiting_payment',
  'sales_awaiting_delivery',
  'product_expired',
  'product_expiring',
  'supplier_credit_overdue',
  'supplier_credit_due',
  'loyalty_points_balance',
  'portal_pending_review',
  'import_warnings',
])

export function groupNotificationItems<T extends GroupableNotificationItem>(
  items: readonly T[],
  minGroupSize = NOTIFICATION_GROUP_MIN,
): Array<NotificationRow<T>> {
  const byKind = new Map<string, T[]>()
  for (const item of items) {
    const kind = String(item.kind || '')
    if (!GROUPABLE_NOTIFICATION_KINDS.has(kind)) continue
    const bucket = byKind.get(kind)
    if (bucket) bucket.push(item)
    else byKind.set(kind, [item])
  }
  const folded = new Set([...byKind].filter(([, members]) => members.length >= minGroupSize).map(([kind]) => kind))
  const rows: Array<NotificationRow<T>> = []
  const placed = new Set<string>()
  for (const item of items) {
    const kind = String(item.kind || '')
    if (!folded.has(kind)) {
      rows.push({ type: 'item', item })
      continue
    }
    if (placed.has(kind)) continue
    placed.add(kind)
    rows.push({ type: 'group', key: kind, kind, items: byKind.get(kind) || [] })
  }
  return rows
}
