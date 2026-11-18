import type { InventoryCheckApprovalLine, InventoryCheckSessionItem } from '../../api/inventoryChecksTransport.ts'
import type { InventoryCheckProduct } from '../../types/inventoryChecks.ts'
import { patchWiredRaw, type WiredRaw } from './inventoryWired.ts'

// What an accepted line leaves on the product's row outside the panel. The approval's answer carries the ordinary stock each line now holds (applied_lines[id].after); the rows take it with no read.
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export type AppliedLines = Readonly<Record<string, Pick<InventoryCheckApprovalLine, 'after' | 'lots'>>>

/** The session's own rows (the older list, which is what a session reads): quantity is the ordinary stock the line wrote plus the units held aside (damaged), as the list sums them. */
export function withAppliedRowStock(rows: readonly InventoryCheckProduct[], stock: Readonly<Record<string, number>>, items: readonly InventoryCheckSessionItem[]): InventoryCheckProduct[] {
  const byId = new Map(items.map(item => [Number(item.product_id), item]))
  return rows.map(row => {
    const after = stock[String(row.id)]
    if (!finite(after)) return row
    const recorded = byId.get(Number(row.id))?.current_stock?.recorded_damaged_quantity
    const damaged = finite(row.damaged_quantity) ? row.damaged_quantity : finite(recorded) ? recorded : 0
    return { ...row, quantity: after + damaged }
  })
}

/**
 * The wired raw rows after lines were applied: the branch quantity takes the answer's after figure and each received date the answer says it moved takes that date's own figure. A line with no dates in the
 * answer (a count made without them) keeps only its branch quantity: nothing is worked out that the answer did not say.
 */
export function patchWiredApplied(raw: WiredRaw, applied: AppliedLines): WiredRaw {
  let next = raw
  for (const [key, line] of Object.entries(applied)) {
    const productId = Number(key)
    if (!finite(line.after) || !next.list.items.some(row => Number(row.id) === productId)) continue
    const dates = (line.lots ?? []).filter(entry => entry.scope === 'lot' && finite(entry.after))
    if (!dates.length) next = patchWiredRaw(next, { productId, branchId: next.branchId, batchId: -1, after: { lotQuantity: 0, branchQuantity: line.after } })
    for (const date of dates) next = patchWiredRaw(next, { productId, branchId: next.branchId, batchId: date.batchId, after: { lotQuantity: date.after as number, branchQuantity: line.after } })
  }
  return next
}
