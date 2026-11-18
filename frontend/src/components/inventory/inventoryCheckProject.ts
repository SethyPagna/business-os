import type { InventoryCheckProduct } from '../../types/inventoryChecks.ts'
import type { InventoryCheckAccess } from '../../utils/inventoryCheckAccess.ts'
import { COST_KEYS, PRICE_KEYS } from './inventoryPriceFacts.ts'
import { STOCK_THRESHOLD_KEYS } from './inventoryStockFacts.ts'

/**
 * A row as THIS viewer may see it: every group of fields their Inventory grants cut is removed before the row reaches a list, a count popover or the detail. The Worker already cuts them (and a row
 * the Products store holds carries more than the Worker sends), so this is the second wall: a row that arrives with a figure it should not have still never shows it. Cost has its own gate
 * (canViewAcquisitionCosts, folded into fields.cost), so a viewer without it never holds the cost keys either, whatever the answer carried.
 */
export function projectProduct(product: InventoryCheckProduct, fields: InventoryCheckAccess['fields']): InventoryCheckProduct {
  const visible = { ...product }
  const loose = visible as Record<string, unknown>
  if (!fields.stock) { delete visible.quantity; delete visible.damaged_quantity; for (const key of STOCK_THRESHOLD_KEYS) delete loose[key] }
  if (!fields.received) delete visible.expiry_alert_days
  if (!fields.brand) delete visible.brand
  if (!fields.category) delete visible.category
  if (!fields.barcode) { delete visible.barcode; delete visible.sku }
  if (!fields.price) for (const key of PRICE_KEYS) delete loose[key]
  if (!fields.cost) for (const key of COST_KEYS) delete loose[key]
  return visible
}
