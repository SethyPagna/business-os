// Stock-history detail semantics shared by the renderer and focused tests.
// These allowlists intentionally mirror the Worker constants rather than
// inferring meaning from batch_id: an adjustment can point at a received lot
// without becoming a receipt, and a sale can point at a lot without becoming
// revertible from the stock ledger.
export const STOCK_RECEIPT_MOVEMENT_TYPES = ['add', 'stock_in'] as const

export const REVERTIBLE_STOCK_MOVEMENT_TYPES = [
  'add', 'remove', 'set', 'adjustment', 'in', 'out', 'csv_import',
] as const

const receiptTypes = new Set<string>(STOCK_RECEIPT_MOVEMENT_TYPES)
const revertibleTypes = new Set<string>(REVERTIBLE_STOCK_MOVEMENT_TYPES)

function normalizedMovementType(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

export function isStockReceiptMovement(value: unknown): boolean {
  return receiptTypes.has(normalizedMovementType(value))
}

export function isRevertibleStockMovement(value: unknown): boolean {
  return revertibleTypes.has(normalizedMovementType(value))
}

export type RecordedMovementCosts = {
  unitUsd: number | null
  unitKhr: number | null
  totalUsd: number | null
  totalKhr: number | null
  hasUnit: boolean
  hasTotal: boolean
}

function recordedNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

// Historical action cost must come only from inventory_movements. Never fall
// back to the mutable product or current lot: a missing movement snapshot is
// displayed honestly as "Not recorded", while an explicit zero remains $0.
export function recordedMovementCosts(row: {
  unit_cost_usd?: unknown
  unit_cost_khr?: unknown
  total_cost_usd?: unknown
  total_cost_khr?: unknown
}): RecordedMovementCosts {
  const unitUsd = recordedNumber(row.unit_cost_usd)
  const unitKhr = recordedNumber(row.unit_cost_khr)
  const totalUsd = recordedNumber(row.total_cost_usd)
  const totalKhr = recordedNumber(row.total_cost_khr)
  return {
    unitUsd,
    unitKhr,
    totalUsd,
    totalKhr,
    hasUnit: unitUsd !== null || unitKhr !== null,
    hasTotal: totalUsd !== null || totalKhr !== null,
  }
}

// Payment state, due date and receipt-session count describe receiving the
// lot. They are relevant only on actual receipt movements, not every later
// action that happens to carry the same batch id.
export function showReceiptAccounting(value: unknown): boolean {
  return isStockReceiptMovement(value)
}
