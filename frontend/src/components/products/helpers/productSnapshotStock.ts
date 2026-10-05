// RET-B F2 / E2 (5 Oct 2026). True when a product snapshot carries stock on
// hand in any branch (or, for an older row without branch detail, in its
// rollup). Re-creating such a product from the Products page would have to
// invent that stock, so its Undo/Redo is refused instead. Statically imported
// by Products.tsx (the history entry is flagged when it is pushed), and
// re-exported by productWriteHelpers.ts.
type SnapshotStock = { branch_stock?: Array<{ quantity?: unknown; [key: string]: unknown }> | null; stock_quantity?: unknown; [key: string]: unknown }

function finite(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function snapshotHoldsStock(snapshot: SnapshotStock = {}): boolean {
  const branches = Array.isArray(snapshot?.branch_stock) ? snapshot.branch_stock : []
  if (branches.some((entry) => finite(entry?.quantity) !== 0)) return true
  return !branches.length && finite(snapshot?.stock_quantity) !== 0
}
