import type { InventoryCheckSessionItem } from '../../api/inventoryChecksTransport.ts'
import type { InventoryCheckProduct } from '../../types/inventoryChecks.ts'

// What an accepted line leaves on the product's row in the session list. The approval's answer carries the ordinary stock each line now holds (applied_lines[id].after); the rows take it with no read.
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

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
