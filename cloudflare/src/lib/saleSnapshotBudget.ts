export const SALE_SNAPSHOT_BYTE_BUDGET = 1_800_000
const SALE_SNAPSHOT_FRAMING_RESERVE = 16_384
const encoder = new TextEncoder()

export class SaleSnapshotBudgetError extends Error {
  readonly code = 'sale_snapshot_too_large'
  constructor() {
    super('This sale is too large to save safely. Reduce the items and try again.')
    this.name = 'SaleSnapshotBudgetError'
  }
}

export function serializedSaleSnapshotBytes(value: unknown): number {
  const json = JSON.stringify(value)
  if (typeof json !== 'string') throw new SaleSnapshotBudgetError()
  return encoder.encode(json).byteLength
}

export function assertSaleSnapshotBudget(value: unknown): void {
  if (serializedSaleSnapshotBytes(value) + SALE_SNAPSHOT_FRAMING_RESERVE > SALE_SNAPSHOT_BYTE_BUDGET) {
    throw new SaleSnapshotBudgetError()
  }
}
